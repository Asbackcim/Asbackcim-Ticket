const crypto = require("crypto");
const { ChannelType } = require("discord.js");
const express = require("express");
const session = require("express-session");
const path = require("path");
const { loadCommands } = require("../Handlers/commandHandler");
const { BRANDING } = require("../services/branding");
const { syncHistoricalLogs } = require("../services/historySyncService");
const {
  findLog,
  getLogs,
  getPanelMeta,
  listOpenTickets,
  upsertTicketLog,
} = require("../services/panelStore");
const {
  getGuildSettings,
  updateGuildSettings,
} = require("../services/settingsService");
const { ensureStoredTranscript } = require("../services/transcriptService");

let serverInstance = null;

const PANEL_ADMIN_PERMISSION = 0x8n;
const PANEL_MANAGE_GUILD_PERMISSION = 0x20n;
const MAX_TICKET_TYPE_SLOTS = 6;

function serializeGuild(guild) {
  return {
    id: guild.id,
    name: guild.name,
    memberCount: guild.memberCount,
    iconUrl: guild.iconURL({ extension: "png", size: 128 }) || null,
  };
}

function sortGuilds(guilds) {
  return [...guilds].sort((left, right) => left.name.localeCompare(right.name, "tr"));
}

function filterLogs(logs, filters) {
  return logs.filter((log) => {
    if (filters.guildId && log.guildId !== filters.guildId) {
      return false;
    }

    if (filters.action && log.action !== filters.action) {
      return false;
    }

    if (!filters.q) {
      return true;
    }

    const query = filters.q.toLowerCase();
    const haystack = [
      log.guildName,
      log.channelName,
      log.openedByTag,
      log.openedById,
      log.archivedByTag,
      log.archivedById,
      log.reason,
      log.ticketTypeLabel,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

function listGuildCollections(guild) {
  const textChannels = guild.channels.cache
    .filter((channel) => channel.isTextBased() && channel.type === ChannelType.GuildText)
    .map((channel) => ({ id: channel.id, name: `#${channel.name}` }))
    .sort((left, right) => left.name.localeCompare(right.name, "tr"));

  const categories = guild.channels.cache
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .map((channel) => ({ id: channel.id, name: channel.name }))
    .sort((left, right) => left.name.localeCompare(right.name, "tr"));

  const roles = guild.roles.cache
    .filter((role) => role.id !== guild.id)
    .map((role) => ({ id: role.id, name: role.name }))
    .sort((left, right) => left.name.localeCompare(right.name, "tr"));

  return { textChannels, categories, roles };
}

function normalizeIdList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  if (value === null || value === undefined || value === "") {
    return [];
  }

  return [String(value).trim()].filter(Boolean);
}

function toBigInt(value) {
  try {
    return BigInt(value || 0);
  } catch {
    return 0n;
  }
}

function hasGuildManagementAccess(guild) {
  const permissions = toBigInt(guild.permissions);

  return (
    Boolean(guild.owner) ||
    (permissions & PANEL_ADMIN_PERMISSION) === PANEL_ADMIN_PERMISSION ||
    (permissions & PANEL_MANAGE_GUILD_PERMISSION) === PANEL_MANAGE_GUILD_PERMISSION
  );
}

function buildDiscordAvatarUrl(user) {
  if (!user?.id || !user?.avatar) {
    return "https://cdn.discordapp.com/embed/avatars/0.png";
  }

  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=160`;
}

function getDiscordAuthConfig(client) {
  const panelConfig = client.config.panel || {};
  const authConfig = panelConfig.discordAuth || {};
  const panelHost = panelConfig.host || "127.0.0.1";
  const panelPort = Number.parseInt(panelConfig.port, 10) || 3000;
  const callbackPath = String(authConfig.callbackPath || "/auth/discord/callback");
  const normalizedCallbackPath = callbackPath.startsWith("/") ? callbackPath : `/${callbackPath}`;
  const publicUrl = String(
    authConfig.publicUrl || panelConfig.publicUrl || `http://${panelHost}:${panelPort}`,
  ).replace(/\/+$/g, "");

  return {
    enabled: Boolean(authConfig.enabled),
    clientId: String(authConfig.clientId || client.user?.id || "").trim(),
    clientSecret: String(authConfig.clientSecret || "").trim(),
    publicUrl,
    callbackPath: normalizedCallbackPath,
    redirectUri: `${publicUrl}${normalizedCallbackPath}`,
    scopes:
      Array.isArray(authConfig.scopes) && authConfig.scopes.length
        ? authConfig.scopes
        : ["identify", "guilds"],
    adminUserIds: normalizeIdList(authConfig.adminUserIds),
    allowedUserIds: normalizeIdList(authConfig.allowedUserIds),
  };
}

function getPasswordAuthConfig(client) {
  const panelConfig = client.config.panel || {};

  return {
    enabled: Boolean(panelConfig.username && panelConfig.password),
    username: String(panelConfig.username || "").trim(),
    password: String(panelConfig.password || ""),
  };
}

function isDiscordAuthReady(discordAuth) {
  return Boolean(
    discordAuth.enabled &&
      discordAuth.clientId &&
      discordAuth.clientSecret &&
      discordAuth.redirectUri,
  );
}

function isPanelAdminId(userId, client, discordAuth) {
  return Boolean(
    userId &&
      (
        String(client.config.DeveloperID || "").trim() === userId ||
        discordAuth.adminUserIds.includes(userId) ||
        discordAuth.allowedUserIds.includes(userId)
      ),
  );
}

function isDeveloperId(userId, client) {
  return Boolean(userId && String(client.config.DeveloperID || "").trim() === userId);
}

function getAccessibleGuildIds(client, discordGuilds, userId, discordAuth) {
  if (isPanelAdminId(userId, client, discordAuth)) {
    return [...client.guilds.cache.keys()];
  }

  const manageableGuildIds = new Set(
    discordGuilds.filter(hasGuildManagementAccess).map((guild) => guild.id),
  );

  return [...client.guilds.cache.keys()].filter((guildId) => manageableGuildIds.has(guildId));
}

function getPrimaryPanelGuildId(client, allowedGuildIds) {
  const preferredGuildId = String(
    client.config.panel?.primaryGuildId || client.config.panel?.guildId || "",
  ).trim();

  if (preferredGuildId && allowedGuildIds.has(preferredGuildId)) {
    return preferredGuildId;
  }

  const sortedGuilds = sortGuilds(
    [...client.guilds.cache.values()]
      .filter((guild) => allowedGuildIds.has(guild.id))
      .map(serializeGuild),
  );

  return sortedGuilds[0]?.id || null;
}

function getAuthorizedGuildIdSet(req, client, authEnabled) {
  const baseGuildIds = !authEnabled
    ? new Set(client.guilds.cache.keys())
    : new Set(req.session?.panelUser?.guildIds || []);

  const primaryGuildId = getPrimaryPanelGuildId(client, baseGuildIds);

  if (!primaryGuildId) {
    return new Set();
  }

  return new Set([primaryGuildId]);
}

function getAuthorizedGuilds(req, client, authEnabled) {
  const allowedGuildIds = getAuthorizedGuildIdSet(req, client, authEnabled);

  return sortGuilds(
    [...client.guilds.cache.values()]
      .filter((guild) => allowedGuildIds.has(guild.id))
      .map(serializeGuild),
  );
}

function ensureGuildAccess(req, res, client, authEnabled, guildId, renderError) {
  const allowedGuildIds = getAuthorizedGuildIdSet(req, client, authEnabled);

  if (allowedGuildIds.has(guildId)) {
    return true;
  }

  if (typeof renderError === "function") {
    renderError(req, res, {
      statusCode: 403,
      title: "Sunucu Erisimi Engellendi",
      summary: "Bu sunucuyu goruntuleme veya duzenleme yetkin yok.",
      description: "Discord oturumunda yonetici oldugun veya panel yoneticisine izin verilen sunucular listelenir.",
      selectedGuildId: guildId,
    });
    return false;
  }

  res.status(403).send("Bu sunucuya erisim yetkiniz yok.");
  return false;
}

function filterAuthorizedLogs(logs, allowedGuildIds) {
  return logs.filter((log) => allowedGuildIds.has(log.guildId));
}

function filterAuthorizedTickets(tickets, allowedGuildIds) {
  return tickets.filter((ticket) => allowedGuildIds.has(ticket.guildId));
}

function normalizeArrayInput(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === null || value === undefined || value === "") {
    return [];
  }

  return [value];
}

function parseTicketTypesFromBody(body) {
  const values = normalizeArrayInput(body.ticketTypeValue);
  const labels = normalizeArrayInput(body.ticketTypeLabel);
  const descriptions = normalizeArrayInput(body.ticketTypeDescription);
  const emojis = normalizeArrayInput(body.ticketTypeEmoji);
  const length = Math.max(values.length, labels.length, descriptions.length, emojis.length);

  return Array.from({ length }, (_, index) => ({
    value: values[index] || "",
    label: labels[index] || "",
    description: descriptions[index] || "",
    emoji: emojis[index] || "",
  }));
}

function buildTicketTypeSlots(ticketTypes) {
  return Array.from({ length: MAX_TICKET_TYPE_SLOTS }, (_, index) => ticketTypes[index] || {
    value: "",
    label: "",
    description: "",
    emoji: "",
  });
}

async function fetchDiscordJson(url, options) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API ${response.status}: ${errorText.slice(0, 180)}`);
  }

  return response.json();
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function buildGuildSetupStatus(settings) {
  return [
    {
      label: "Log kanali",
      ready: Boolean(settings?.logChannelId),
      value: settings?.logChannelId ? "Hazir" : "Eksik",
    },
    {
      label: "Yetkili rol",
      ready: Boolean(settings?.staffRoleId),
      value: settings?.staffRoleId ? "Hazir" : "Eksik",
    },
    {
      label: "Ticket kategorisi",
      ready: Boolean(settings?.categoryId),
      value: settings?.categoryId ? "Hazir" : "Eksik",
    },
    {
      label: "Ticket tipleri",
      ready: Boolean(settings?.ticketTypes?.length),
      value: `${settings?.ticketTypes?.length || 0} aktif tip`,
    },
  ];
}

function ensurePanelAdmin(renderError) {
  return (req, res, next) => {
    if (!req.panelAuthEnabled || req.session?.panelUser?.isAdmin) {
      next();
      return;
    }

    if (typeof renderError === "function") {
      renderError(req, res, {
        statusCode: 403,
        title: "Yonetici Yetkisi Gerekli",
        summary: "Bu islem sadece panel yoneticileri icin acik.",
        description: "Hesabiniz bu panel eylemini calistirma yetkisine sahip degil.",
      });
      return;
    }

    res.status(403).send("Bu islem icin panel yoneticisi yetkisi gerekli.");
  };
}

function startWebPanel(client) {
  if (serverInstance || client.config.panel?.enabled === false) {
    return serverInstance;
  }

  const app = express();
  const appRoot = path.join(__dirname, "..");
  const panelHost = client.config.panel?.host || "127.0.0.1";
  const panelPort = Number.parseInt(client.config.panel?.port, 10) || 3000;
  const discordAuth = getDiscordAuthConfig(client);
  const passwordAuth = getPasswordAuthConfig(client);
  const useDiscordAuth = isDiscordAuthReady(discordAuth);
  const usePasswordAuth = passwordAuth.enabled && !useDiscordAuth;
  const authEnabled = useDiscordAuth || usePasswordAuth;

  if (discordAuth.enabled && !useDiscordAuth) {
    console.warn(
      usePasswordAuth
        ? "Discord OAuth2 aktif edildi ancak ayarlar eksik. Sifreli giris moduna donuluyor."
        : "Discord OAuth2 aktif edildi ancak ayarlar eksik. Panel auth tamamlanana kadar web panel baslatilmayacak.",
    );
  }

  if (!authEnabled) {
    console.warn("Web panel baslatilmadi: Discord OAuth2 veya panel sifresi tanimlanmadi.");
    return null;
  }

  function buildErrorActions(req) {
    const guilds = req.authorizedGuilds || getAuthorizedGuilds(req, client, authEnabled);
    const actions = [
      {
        label: "Kontrol merkezine don",
        href: "/",
        variant: "primary",
      },
    ];

    if (guilds[0]) {
      actions.push({
        label: "Sunucu ayarlari",
        href: `/guilds/${guilds[0].id}`,
        variant: "secondary",
      });
    }

    actions.push({
      label: "Log arsivi",
      href: "/logs",
      variant: "secondary",
    });

    return actions;
  }

  function renderPanelError(req, res, options = {}) {
    const statusCode = Number(options.statusCode || 500);
    const guilds = req.authorizedGuilds || getAuthorizedGuilds(req, client, authEnabled);
    const isDeveloper = !authEnabled || Boolean(req.session?.panelUser?.isDeveloper);
    const copyByStatus = {
      403: {
        title: "Erisim Reddedildi",
        summary: "Bu alana ulasmak icin yeterli yetkin yok.",
        description: "Discord tarafinda yonetici oldugun veya panel yoneticisi tarafindan izin verilen sunuculara erisebilirsin.",
      },
      404: {
        title: "Sayfa Bulunamadi",
        summary: "Istedigin panel kaynagi bulunamadi.",
        description: "Kayit silinmis, tasinmis veya baglanti gecersiz olabilir.",
      },
      500: {
        title: "Beklenmeyen Bir Hata Olustu",
        summary: "Panel istegi islenirken bir sunucu hatasi olustu.",
        description: "Sayfayi yenileyip yeniden deneyin. Sorun devam ederse loglari kontrol edin.",
      },
    };
    const resolvedCopy = copyByStatus[statusCode] || copyByStatus[500];

    res.status(statusCode);
    res.render("pages/error", {
      title: options.title || resolvedCopy.title,
      guilds,
      selectedGuildId: options.selectedGuildId || null,
      errorCode: statusCode,
      errorEyebrow: options.eyebrow || `${statusCode} PANEL HATASI`,
      errorTitle: options.title || resolvedCopy.title,
      errorSummary: options.summary || resolvedCopy.summary,
      errorDescription: options.description || resolvedCopy.description,
      errorDetails: isDeveloper ? String(options.details || "").trim() : "",
      actions: Array.isArray(options.actions) && options.actions.length
        ? options.actions
        : buildErrorActions(req),
    });
  }

  app.disable("x-powered-by");
  app.set("view engine", "ejs");
  app.set("views", path.join(appRoot, "views"));

  app.locals.BRANDING = BRANDING;
  app.locals.MAX_TICKET_TYPE_SLOTS = MAX_TICKET_TYPE_SLOTS;
  app.locals.formatDate = (value) => {
    if (!value) {
      return "-";
    }

    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  };
  app.locals.formatDuration = (ms) => {
    if (!ms) {
      return "0 dk";
    }

    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const parts = [];

    if (days) {
      parts.push(`${days} gun`);
    }

    if (hours) {
      parts.push(`${hours} sa`);
    }

    if (minutes || !parts.length) {
      parts.push(`${minutes} dk`);
    }

    return parts.join(" ");
  };

  app.use(express.urlencoded({ extended: true }));

  if (authEnabled) {
    const sessionSecret =
      client.config.panel?.sessionSecret || crypto.randomBytes(32).toString("hex");

    if (!client.config.panel?.sessionSecret) {
      console.warn("panel.sessionSecret tanimli degil. Gecici session secret kullaniliyor.");
    }

    app.use(session({
      name: "panel.sid",
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: discordAuth.publicUrl.startsWith("https://"),
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    }));
  }

  app.use((req, res, next) => {
    const authorizedGuilds = getAuthorizedGuilds(req, client, authEnabled);

    req.panelUsesDiscordAuth = useDiscordAuth;
    req.panelUsesPasswordAuth = usePasswordAuth;
    req.panelAuthEnabled = authEnabled;
    req.authorizedGuilds = authorizedGuilds;
    res.locals.currentUser = authEnabled ? req.session?.panelUser || null : null;
    res.locals.currentPath = req.path;
    res.locals.guilds = authorizedGuilds;
    res.locals.selectedGuildId = null;
    res.locals.panelUsesDiscordAuth = useDiscordAuth;
    res.locals.panelUsesPasswordAuth = usePasswordAuth;
    res.locals.panelAuthEnabled = authEnabled;
    res.locals.canViewDeveloperStats = !authEnabled || Boolean(req.session?.panelUser?.isDeveloper);
    res.locals.canUseAdminActions = !authEnabled || Boolean(req.session?.panelUser?.isAdmin);
    next();
  });

  app.use("/assets", express.static(path.join(appRoot, "public")));

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      guildCount: client.guilds.cache.size,
      uptimeMs: client.uptime || 0,
    });
  });

  if (authEnabled) {
    app.get("/login", (req, res) => {
      if (req.session?.panelUser) {
        res.redirect("/");
        return;
      }

      res.render("pages/login", {
        loginUrl: `/auth/discord${req.query.returnTo ? `?returnTo=${encodeURIComponent(req.query.returnTo)}` : ""}`,
        passwordEnabled: usePasswordAuth,
        passwordUsername: passwordAuth.username,
        discordEnabled: useDiscordAuth,
        returnTo:
          typeof req.query.returnTo === "string" && req.query.returnTo.startsWith("/")
            ? req.query.returnTo
            : "/",
        message: req.query.message || "",
        stats: {
          online: client.isReady(),
          ping: client.ws.ping,
          guildCount: client.guilds.cache.size,
          openTicketCount: listOpenTickets().length,
          logCount: getLogs().length,
        },
      });
    });

    app.post("/login/password", (req, res) => {
      if (!usePasswordAuth) {
        res.redirect("/login?message=Sifre+girisi+aktif+degil");
        return;
      }

      const username = String(req.body.username || passwordAuth.username || "").trim();
      const password = String(req.body.password || "");

      if (username !== passwordAuth.username || password !== passwordAuth.password) {
        res.redirect("/login?message=Kullanici+adi+veya+sifre+hatali");
        return;
      }

      req.session.panelUser = {
        id: "password-login",
        username: passwordAuth.username,
        handle: passwordAuth.username,
        avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png",
        guildIds: [...client.guilds.cache.keys()],
        isAdmin: true,
        isDeveloper: true,
        authMethod: "password",
      };

      const nextUrl =
        typeof req.body.returnTo === "string" && req.body.returnTo.startsWith("/")
          ? req.body.returnTo
          : "/";

      req.session.save(() => {
        res.redirect(nextUrl);
      });
    });

    app.get("/auth/discord", (req, res) => {
      if (!useDiscordAuth) {
        res.redirect("/login?message=Discord+girisi+aktif+degil");
        return;
      }

      const state = crypto.randomBytes(16).toString("hex");
      req.session.oauthState = state;
      req.session.returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/";

      const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
      authorizeUrl.search = new URLSearchParams({
        client_id: discordAuth.clientId,
        response_type: "code",
        redirect_uri: discordAuth.redirectUri,
        scope: discordAuth.scopes.join(" "),
        state,
      }).toString();

      res.redirect(authorizeUrl.toString());
    });

    app.get(discordAuth.callbackPath, async (req, res) => {
      const { code, error, state } = req.query;

      if (error) {
        res.redirect("/login?message=Discord+giris+iptal+edildi");
        return;
      }

      if (!code || !state || state !== req.session.oauthState) {
        res.redirect("/login?message=OAuth+oturumu+dogrulanamadi");
        return;
      }

      delete req.session.oauthState;

      try {
        const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: discordAuth.clientId,
            client_secret: discordAuth.clientSecret,
            grant_type: "authorization_code",
            code: String(code),
            redirect_uri: discordAuth.redirectUri,
          }),
        });

        if (!tokenResponse.ok) {
          throw new Error("Discord token olusturulamadi");
        }

        const tokenData = await tokenResponse.json();
        const authorization = {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
          },
        };

        const [user, guilds] = await Promise.all([
          fetchDiscordJson("https://discord.com/api/users/@me", authorization),
          fetchDiscordJson("https://discord.com/api/users/@me/guilds", authorization),
        ]);

        const accessibleGuildIds = getAccessibleGuildIds(client, guilds, user.id, discordAuth);

        if (!accessibleGuildIds.length) {
          req.session.destroy(() => {
            res.redirect("/login?message=Panele+erisiminiz+icin+uygun+sunucu+yetkisi+bulunamadi");
          });
          return;
        }

        req.session.panelUser = {
          id: user.id,
          username: user.global_name || user.username,
          handle:
            user.discriminator && user.discriminator !== "0"
              ? `${user.username}#${user.discriminator}`
              : user.username,
          avatarUrl: buildDiscordAvatarUrl(user),
          guildIds: accessibleGuildIds,
          isAdmin: isPanelAdminId(user.id, client, discordAuth),
          isDeveloper: isDeveloperId(user.id, client),
          authMethod: "discord",
        };

        const nextUrl = typeof req.session.returnTo === "string" ? req.session.returnTo : "/";
        delete req.session.returnTo;

        req.session.save(() => {
          res.redirect(nextUrl);
        });
      } catch (error) {
        console.error("Discord OAuth callback failed:", error);
        res.redirect("/login?message=Discord+giris+tamamlanamadi");
      }
    });

    app.get("/logout", (req, res) => {
      req.session.destroy(() => {
        res.redirect("/login");
      });
    });

    app.use((req, res, next) => {
      if (req.path === "/login" || req.path.startsWith("/auth/")) {
        next();
        return;
      }

      if (req.session?.panelUser) {
        next();
        return;
      }

      const returnTo = encodeURIComponent(req.originalUrl || "/");
      res.redirect(`/login?returnTo=${returnTo}`);
    });
  } else {
    app.get("/logout", (req, res) => {
      res.redirect("/");
    });
  }

  app.use(
    "/transcripts",
    express.static(path.join(appRoot, "storage", "transcripts")),
  );

  app.get("/", (req, res) => {
    const guilds = req.authorizedGuilds;
    const allowedGuildIds = getAuthorizedGuildIdSet(req, client, authEnabled);
    const primaryGuild = guilds[0] || null;
    const openTickets = filterAuthorizedTickets(listOpenTickets(), allowedGuildIds);
    const logs = filterAuthorizedLogs(getLogs(), allowedGuildIds);
    const meta = getPanelMeta();
    const canViewDeveloperStats = !authEnabled || Boolean(req.session?.panelUser?.isDeveloper);
    const primarySettings = primaryGuild ? getGuildSettings(primaryGuild.id) : null;
    const setupStatus = primarySettings ? buildGuildSetupStatus(primarySettings) : [];
    const savedLogCount = logs.filter((log) => log.action === "saved").length;
    const closedLogCount = logs.filter((log) => log.action === "closed").length;

    res.render("pages/dashboard", {
      guilds,
      primaryGuild,
      primarySettings,
      setupStatus,
      selectedGuildId: primaryGuild?.id || null,
      stats: {
        guildCount: guilds.length,
        openTicketCount: openTickets.length,
        logCount: logs.length,
        online: canViewDeveloperStats ? client.isReady() : null,
        ping: canViewDeveloperStats ? client.ws.ping : null,
        uptimeMs: canViewDeveloperStats ? client.uptime || 0 : null,
        lastHistorySync: canViewDeveloperStats ? meta.lastHistorySync || null : null,
      },
      logSummary: {
        savedCount: savedLogCount,
        closedCount: closedLogCount,
      },
      openTickets: openTickets.slice(0, 8),
      recentLogs: logs.slice(0, 8),
      message: req.query.message || "",
    });
  });

  app.get("/guilds/:guildId", asyncRoute(async (req, res) => {
    if (!ensureGuildAccess(req, res, client, authEnabled, req.params.guildId, renderPanelError)) {
      return;
    }

    const guild = await client.guilds.fetch(req.params.guildId).catch(() => null);

    if (!guild) {
      renderPanelError(req, res, {
        statusCode: 404,
        title: "Sunucu Bulunamadi",
        summary: "Istedigin sunucuya panel tarafinda ulasilamadi.",
        description: "Bot sunucudan ayrilmis olabilir veya baglanti artik gecerli degil.",
        selectedGuildId: req.params.guildId,
      });
      return;
    }

    await guild.channels.fetch().catch(() => null);
    await guild.roles.fetch().catch(() => null);

    const { textChannels, categories, roles } = listGuildCollections(guild);
    const openTickets = listOpenTickets().filter((ticket) => ticket.guildId === guild.id);
    const settings = getGuildSettings(guild.id);

    res.render("pages/guild", {
      guilds: req.authorizedGuilds,
      guild: serializeGuild(guild),
      settings,
      channels: textChannels,
      roles,
      categories,
      openTickets,
      setupStatus: buildGuildSetupStatus(settings),
      ticketTypeSlots: buildTicketTypeSlots(settings.ticketTypes),
      selectedGuildId: guild.id,
      message: req.query.message || "",
    });
  }));

  app.post("/guilds/:guildId/settings", asyncRoute(async (req, res) => {
    if (!ensureGuildAccess(req, res, client, authEnabled, req.params.guildId, renderPanelError)) {
      return;
    }

    const guild = await client.guilds.fetch(req.params.guildId).catch(() => null);

    if (!guild) {
      renderPanelError(req, res, {
        statusCode: 404,
        title: "Sunucu Bulunamadi",
        summary: "Ayarlarini kaydetmek istedigin sunucu bulunamadi.",
        description: "Sunucu artik erisilebilir degil veya bot bu sunucuda degil.",
        selectedGuildId: req.params.guildId,
      });
      return;
    }

    await guild.channels.fetch().catch(() => null);
    await guild.roles.fetch().catch(() => null);

    const limit = Number.parseInt(req.body.limit, 10);
    const { textChannels, categories, roles } = listGuildCollections(guild);
    const channelIds = new Set(textChannels.map((channel) => channel.id));
    const categoryIds = new Set(categories.map((category) => category.id));
    const roleIds = new Set(roles.map((role) => role.id));
    const logChannelId = String(req.body.logChannelId || "");
    const staffRoleId = String(req.body.staffRoleId || "");
    const categoryId = String(req.body.categoryId || "");

    if (!Number.isFinite(limit) || limit < 1 || limit > 10) {
      res.redirect(`/guilds/${guild.id}?message=Limit+1+ile+10+arasinda+olmali`);
      return;
    }

    if (logChannelId && !channelIds.has(logChannelId)) {
      res.redirect(`/guilds/${guild.id}?message=Secilen+log+kanali+gecersiz`);
      return;
    }

    if (staffRoleId && !roleIds.has(staffRoleId)) {
      res.redirect(`/guilds/${guild.id}?message=Secilen+yetkili+rol+gecersiz`);
      return;
    }

    if (categoryId && !categoryIds.has(categoryId)) {
      res.redirect(`/guilds/${guild.id}?message=Secilen+ticket+kategorisi+gecersiz`);
      return;
    }

    updateGuildSettings(guild.id, {
      logChannelId: logChannelId || null,
      staffRoleId: staffRoleId || null,
      categoryId: categoryId || null,
      limit,
      ticketTypes: parseTicketTypesFromBody(req.body),
    });

    res.redirect(`/guilds/${guild.id}?message=Ayarlar+kaydedildi`);
  }));

  app.post("/actions/reload-commands", ensurePanelAdmin(renderPanelError), asyncRoute(async (req, res) => {
    await loadCommands(client);
    res.redirect("/?message=Slash+komutlari+yenilendi");
  }));

  app.post("/actions/sync-history", ensurePanelAdmin(renderPanelError), asyncRoute(async (req, res) => {
    await syncHistoricalLogs(client);
    res.redirect("/logs?message=Gecmis+loglar+yenilendi");
  }));

  app.get("/logs", (req, res) => {
    const guilds = req.authorizedGuilds;
    const allowedGuildIds = getAuthorizedGuildIdSet(req, client, authEnabled);
    const filters = {
      guildId: req.query.guildId || "",
      action: req.query.action || "",
      q: req.query.q || "",
    };

    if (filters.guildId && !allowedGuildIds.has(filters.guildId)) {
      renderPanelError(req, res, {
        statusCode: 403,
        title: "Log Erisimi Engellendi",
        summary: "Bu sunucunun log kayitlarini goruntuleyemezsin.",
        description: "Sadece yonetici oldugun ortak sunucularin log arsivine ulasabilirsin.",
        selectedGuildId: filters.guildId,
      });
      return;
    }

    const logs = filterLogs(filterAuthorizedLogs(getLogs(), allowedGuildIds), filters);

    res.render("pages/logs", {
      guilds,
      logs,
      filters,
      selectedGuildId: filters.guildId || null,
      logSummary: {
        total: logs.length,
        savedCount: logs.filter((log) => log.action === "saved").length,
        closedCount: logs.filter((log) => log.action === "closed").length,
      },
      message: req.query.message || "",
    });
  });

  app.get("/logs/:logId", asyncRoute(async (req, res) => {
    let log = findLog(req.params.logId);

    if (!log) {
      renderPanelError(req, res, {
        statusCode: 404,
        title: "Log Bulunamadi",
        summary: "Istedigin log kaydi panel arsivinde bulunamadi.",
        description: "Kayit silinmis olabilir veya URL artik gecersiz.",
      });
      return;
    }

    const allowedGuildIds = getAuthorizedGuildIdSet(req, client, authEnabled);

    if (!allowedGuildIds.has(log.guildId)) {
      renderPanelError(req, res, {
        statusCode: 403,
        title: "Log Erisimi Engellendi",
        summary: "Bu log kaydini acma yetkin yok.",
        description: "Loglar sadece erisim izni olan sunucular icin gosterilir.",
        selectedGuildId: log.guildId,
      });
      return;
    }

    if (!log.transcriptPath && log.transcriptFileName) {
      const transcript = await ensureStoredTranscript({
        transcriptFileName: log.transcriptFileName,
        transcriptUrl: log.transcriptUrl,
      }).catch(() => null);

      if (transcript) {
        log = upsertTicketLog({
          ...log,
          transcriptFileName: transcript.fileName,
          transcriptPath: transcript.relativePath,
        });
      }
    }

    res.render("log-detail", {
      guilds: req.authorizedGuilds,
      log,
      selectedGuildId: log.guildId,
    });
  }));

  app.use((req, res) => {
    renderPanelError(req, res, {
      statusCode: 404,
      title: "Sayfa Bulunamadi",
      summary: "Istedigin panel sayfasi bulunamadi.",
      description: "Adres degismis olabilir veya ulasmaya calistigin baglanti artik mevcut degil.",
    });
  });

  app.use((error, req, res, next) => {
    console.error("Web panel request failed:", error);

    if (res.headersSent) {
      next(error);
      return;
    }

    renderPanelError(req, res, {
      statusCode: 500,
      title: "Panel Hatasi",
      summary: "Istek islenirken beklenmeyen bir hata olustu.",
      description: "Sayfayi yenileyip tekrar deneyin. Sorun surerse panel loglarini inceleyin.",
      details: error?.stack || error?.message || String(error || ""),
    });
  });

  serverInstance = app.listen(panelPort, panelHost, () => {
    console.info(
      "\x1b[36m%s\x1b[0m",
      `Web panel hazir: http://${panelHost}:${panelPort}`,
    );
  });

  return serverInstance;
}

module.exports = {
  startWebPanel,
};

const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(appRoot, "config.json");
const LOCAL_CONFIG_PATH = path.join(appRoot, "config.local.json");

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, cloneValue(nestedValue)]),
    );
  }

  return value;
}

function mergeConfig(baseValue, overrideValue) {
  if (overrideValue === undefined) {
    return cloneValue(baseValue);
  }

  if (Array.isArray(overrideValue)) {
    return overrideValue.map((item) => cloneValue(item));
  }

  if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
    const mergedEntries = new Map();

    for (const [key, value] of Object.entries(baseValue)) {
      mergedEntries.set(key, mergeConfig(value, undefined));
    }

    for (const [key, value] of Object.entries(overrideValue)) {
      mergedEntries.set(key, mergeConfig(baseValue?.[key], value));
    }

    return Object.fromEntries(mergedEntries);
  }

  if (isPlainObject(overrideValue)) {
    return cloneValue(overrideValue);
  }

  return cloneValue(overrideValue);
}

function readJsonFile(filePath, { required }) {
  if (!fs.existsSync(filePath)) {
    if (required) {
      throw new Error(`Konfigurasyon dosyasi bulunamadi: ${path.basename(filePath)}`);
    }

    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${path.basename(filePath)} okunamadi: ${error.message}`);
  }
}

function parseBoolean(value) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function parseStringList(value) {
  if (value === undefined) {
    return undefined;
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function applyEnvironmentOverrides(config) {
  const panelEnabled = parseBoolean(process.env.PANEL_ENABLED);
  const oauthEnabled = parseBoolean(process.env.DISCORD_OAUTH_ENABLED);
  const autoSyncHistoricalLogs = parseBoolean(process.env.PANEL_AUTO_SYNC_HISTORICAL_LOGS);
  const panelPort = process.env.PANEL_PORT
    ? Number.parseInt(process.env.PANEL_PORT, 10)
    : undefined;

  const overrides = {
    token: process.env.BOT_TOKEN,
    DeveloperID: process.env.DEVELOPER_ID,
    DestekSunucuLink: process.env.SUPPORT_SERVER_URL,
    panel: {
      enabled: panelEnabled,
      host: process.env.PANEL_HOST,
      port: Number.isFinite(panelPort) ? panelPort : undefined,
      publicUrl: process.env.PANEL_PUBLIC_URL,
      primaryGuildId: process.env.PANEL_PRIMARY_GUILD_ID,
      username: process.env.PANEL_USERNAME,
      password: process.env.PANEL_PASSWORD,
      sessionSecret: process.env.PANEL_SESSION_SECRET,
      autoSyncHistoricalLogs,
      discordAuth: {
        enabled: oauthEnabled,
        clientId: process.env.DISCORD_OAUTH_CLIENT_ID,
        clientSecret: process.env.DISCORD_OAUTH_CLIENT_SECRET,
        callbackPath: process.env.DISCORD_OAUTH_CALLBACK_PATH,
        adminUserIds: parseStringList(process.env.DISCORD_OAUTH_ADMIN_USER_IDS),
        allowedUserIds: parseStringList(process.env.DISCORD_OAUTH_ALLOWED_USER_IDS),
      },
    },
  };

  return mergeConfig(config, overrides);
}

function isMissingValue(value) {
  const normalized = String(value || "").trim();

  return (
    !normalized ||
    /^changeme$/i.test(normalized.replace(/[-_\s]/g, "")) ||
    /^<.+>$/.test(normalized) ||
    /^your[-_\s]/i.test(normalized)
  );
}

function validateConfig(config) {
  const errors = [];
  const panelConfig = config.panel || {};
  const discordAuth = panelConfig.discordAuth || {};
  const hasPasswordAuth = Boolean(
    String(panelConfig.username || "").trim() && String(panelConfig.password || ""),
  );
  const hasDiscordAuthSecret = Boolean(
    discordAuth.enabled && !isMissingValue(discordAuth.clientSecret),
  );

  if (isMissingValue(config.token)) {
    errors.push("token");
  }

  if (panelConfig.enabled !== false && !hasPasswordAuth && !hasDiscordAuthSecret) {
    errors.push("panel authentication");
  }

  return errors;
}

function loadConfig() {
  const baseConfig = readJsonFile(CONFIG_PATH, { required: true });
  const localConfig = readJsonFile(LOCAL_CONFIG_PATH, { required: false });
  const mergedConfig = applyEnvironmentOverrides(mergeConfig(baseConfig, localConfig));
  const configErrors = validateConfig(mergedConfig);

  if (configErrors.length) {
    throw new Error(
      [
        "Paylasilabilir repo sabloni yuklendi ancak gizli alanlar tamamlanmadi.",
        `Eksik alanlar: ${configErrors.join(", ")}`,
        "config.local.json olusturup kendi token ve gizli bilgilerinizi oraya yazin.",
      ].join(" "),
    );
  }

  return mergedConfig;
}

module.exports = {
  CONFIG_PATH,
  LOCAL_CONFIG_PATH,
  loadConfig,
};

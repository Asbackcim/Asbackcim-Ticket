const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Collection,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { loadEvents } = require("./Handlers/eventHandler");
const { BRANDING, applyFooter } = require("./services/branding");
const { loadConfig } = require("./services/config");
const { syncHistoricalLogs } = require("./services/historySyncService");
const { getGuildSettings } = require("./services/settingsService");
const {
  buildTicketActionRow,
  buildTicketTypeRow,
  countUserOpenTickets,
  addUserTicketChannel,
  clearOpenTicketState,
  getTicketOwner,
  getTicketTypeByValue,
  registerOpenTicket,
  setTicketOwner,
} = require("./services/ticketService");
const { archiveTicketConversation } = require("./services/ticketArchiveService");
const { startWebPanel } = require("./web/panel");

const { Guilds, GuildMembers, GuildMessages, MessageContent } = GatewayIntentBits;
const { User, Message, GuildMember, ThreadMember } = Partials;

const client = new Client({
  intents: [Guilds, GuildMembers, GuildMessages, MessageContent],
  partials: [User, Message, GuildMember, ThreadMember],
});

try {
  client.config = loadConfig();
} catch (error) {
  console.error("Konfigurasyon yuklenemedi:", error.message);
  process.exit(1);
}

client.commands = new Collection();
client.subCommands = new Collection();
client.events = new Collection();

loadEvents(client);

function sanitizeChannelName(value) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.slice(0, 16) || "destek";
}

function buildTicketPromptEmbed(user) {
  return applyFooter(new EmbedBuilder()
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setTitle("Ticket olustur")
    .setDescription("Asagidaki menuden destek tipini secip yeni ticket acabilirsiniz.")
    .setColor(0x4b9ce2));
}

function buildTicketWelcomeEmbed(user, type) {
  return applyFooter(new EmbedBuilder()
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setTitle("Ticket acildi")
    .setDescription(
      `Hos geldin **${user.username}**.\nYetkililer kisa sure icinde seninle ilgilenecek.\n\nSecilen destek tipi: **${type.label}**`,
    )
    .setColor(0x2b8378));
}

function buildCloseConfirmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Kapat")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅")
      .setCustomId("sil"),
  );
}

function buildCloseConfirmEmbed(user) {
  return applyFooter(new EmbedBuilder()
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setTitle("Kapatmayi onayla")
    .setDescription("Ticket kanalini kapatmak istediginize emin misiniz?")
    .setColor(0xe87351));
}

function buildReasonModal() {
  const modal = new ModalBuilder()
    .setCustomId("neden_soyle")
    .setTitle("Kapatma nedeni");

  const reasonInput = new TextInputBuilder()
    .setCustomId("neden_belirt")
    .setLabel("Ticket neden kapatiliyor?")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(4)
    .setMaxLength(1024)
    .setPlaceholder('Ornek: "Sorun cozuldu"')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  return modal;
}

function canManageTicket(member, staffRoleId, openerId) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    (staffRoleId ? member.roles.cache.has(staffRoleId) : false) ||
    member.id === openerId
  );
}

function canArchiveTicket(member, staffRoleId) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    (staffRoleId ? member.roles.cache.has(staffRoleId) : false)
  );
}

function scheduleTicketDeletion(channel, guildId, openerId) {
  clearOpenTicketState(guildId, channel.id, openerId);

  setTimeout(async () => {
    await channel.delete("Ticket kapatildi").catch(() => null);
  }, 5000);
}

async function handleCreatePrompt(interaction) {
  if (!interaction.guild) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const settings = getGuildSettings(interaction.guild.id);

  if (!settings.staffRoleId) {
    await interaction.editReply(
      "Yetkili rolu ayarli degil. `/ticket ayarla-yetkili` komutunu kullanin.",
    );
    return;
  }

  if (!settings.categoryId) {
    await interaction.editReply(
      "Ticket kategorisi ayarli degil. `/ticket ayarla-kategori` komutunu kullanin.",
    );
    return;
  }

  await interaction.editReply({
    embeds: [buildTicketPromptEmbed(interaction.user)],
    components: [buildTicketTypeRow(interaction.guild.id)],
  });
}

async function handleTicketTypeSelection(interaction) {
  if (!interaction.guild) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ticketType = getTicketTypeByValue(interaction.guild.id, interaction.values[0]);

  if (!ticketType) {
    await interaction.editReply("Gecersiz bir ticket tipi secildi.");
    return;
  }

  const { guild, user } = interaction;
  const settings = getGuildSettings(guild.id);

  if (!settings.staffRoleId || !settings.categoryId || !settings.limit) {
    await interaction.editReply(
      "Ticket sistemi eksik ayarli. `/ticket ayarlar` ile kontrol edin.",
    );
    return;
  }

  if (countUserOpenTickets(guild.id, user.id) >= settings.limit) {
    await interaction.editReply(
      `Maksimum **${settings.limit}** adet acik ticket bulundurabilirsiniz.`,
    );
    return;
  }

  const channelName = `ticket-${sanitizeChannelName(user.username)}-${user.id.slice(-4)}`;
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: settings.categoryId,
    reason: "Ticket olusturuldu",
    permissionOverwrites: [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: settings.staffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ],
  });

  addUserTicketChannel(guild.id, user.id, channel.id);
  setTicketOwner(guild.id, channel.id, user.id);
  registerOpenTicket({
    guild,
    channel,
    user,
    type: ticketType,
  });

  await channel.send({
    content: `${user} <@&${settings.staffRoleId}>`,
    embeds: [buildTicketWelcomeEmbed(user, ticketType)],
    components: [buildTicketActionRow()],
  });

  await interaction.editReply(
    `Ticket basariyla olusturuldu. Kanal: <#${channel.id}>`,
  );
}

async function handleClosePrompt(interaction) {
  if (!interaction.guild || !interaction.member) {
    return;
  }

  const settings = getGuildSettings(interaction.guild.id);
  const openerId = getTicketOwner(interaction.guild.id, interaction.channel.id);

  if (!canManageTicket(interaction.member, settings.staffRoleId, openerId)) {
    await interaction.reply({
      content: "Bu ticketi kapatmak icin yetkiniz yok.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [buildCloseConfirmEmbed(interaction.user)],
    components: [buildCloseConfirmRow()],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleArchive(interaction, action, reason) {
  if (!interaction.guild || !interaction.channel || !interaction.member) {
    return;
  }

  const settings = getGuildSettings(interaction.guild.id);
  const openerId = getTicketOwner(interaction.guild.id, interaction.channel.id);
  const canProceed =
    action === "saved"
      ? canArchiveTicket(interaction.member, settings.staffRoleId)
      : canManageTicket(interaction.member, settings.staffRoleId, openerId);

  if (!canProceed) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("Bu islem icin yetkiniz yok.");
    } else {
      await interaction.reply({
        content: "Bu islem icin yetkiniz yok.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  const archiveResult = await archiveTicketConversation({
    client,
    guild: interaction.guild,
    channel: interaction.channel,
    actor: interaction.user,
    action,
    reason,
  });

  const discordNotice = archiveResult.discordLogged
    ? "Discord log kanalina da gonderildi."
    : "Discord log kanalina gonderilemedi, ancak panel arsivine kaydedildi.";

  if (action === "saved") {
    await interaction.editReply(`Ticket arsivlendi. ${discordNotice}`);
    return;
  }

  await interaction.editReply(
    `Ticket 5 saniye sonra kapatilacak. ${discordNotice}`,
  );

  scheduleTicketDeletion(interaction.channel, interaction.guild.id, archiveResult.openerId);
}

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === "ticketolustur") {
        await handleCreatePrompt(interaction);
        return;
      }

      if (interaction.customId === "kapat") {
        await handleClosePrompt(interaction);
        return;
      }

      if (interaction.customId === "nedenlekapat") {
        if (!interaction.guild || !interaction.member) {
          return;
        }

        const settings = getGuildSettings(interaction.guild.id);
        const openerId = getTicketOwner(interaction.guild.id, interaction.channel.id);

        if (!canManageTicket(interaction.member, settings.staffRoleId, openerId)) {
          await interaction.reply({
            content: "Bu ticketi bu sekilde kapatmak icin yetkiniz yok.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.showModal(buildReasonModal());
        return;
      }

      if (interaction.customId === "kaydet") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await handleArchive(interaction, "saved");
        return;
      }

      if (interaction.customId === "sil") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await handleArchive(interaction, "closed");
      }

      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "ticket_type_select") {
        await handleTicketTypeSelection(interaction);
      }

      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "neden_soyle") {
      const reason = interaction.fields.getTextInputValue("neden_belirt");
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await handleArchive(interaction, "closed", reason);
    }
  } catch (error) {
    console.error("Interaction handling failed:", error);

    if (interaction.deferred || interaction.replied) {
      await interaction
        .editReply({
          content: "Islem sirasinda beklenmeyen bir hata olustu.",
          components: [],
        })
        .catch(() => null);
      return;
    }

    await interaction
      .reply({
        content: "Islem sirasinda beklenmeyen bir hata olustu.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => null);
  }
});

client.once("clientReady", async () => {
  startWebPanel(client);

  if (client.config.panel?.autoSyncHistoricalLogs !== false) {
    await syncHistoricalLogs(client).catch((error) => {
      console.error("Historical log sync failed:", error);
    });
  }
});

const LOGIN_RETRY_BASE_MS = 15000;
const LOGIN_RETRY_MAX_MS = 60000;

function shouldRetryDiscordLogin(error) {
  return [
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
  ].includes(String(error?.code || "").toUpperCase());
}

function describeDiscordLoginError(error) {
  if (shouldRetryDiscordLogin(error)) {
    return "Discord gateway hostu gecici olarak cozumlenemedi veya baglanti kurulurken ag hatasi olustu.";
  }

  if (String(error?.name || "").includes("TokenInvalid")) {
    return "Discord bot tokeni gecersiz gorunuyor.";
  }

  return "Discord istemcisi baslatilirken beklenmeyen bir hata olustu.";
}

async function loginClient(attempt = 1) {
  try {
    await client.login(client.config.token);
  } catch (error) {
    const attemptDelay = Math.min(LOGIN_RETRY_BASE_MS * attempt, LOGIN_RETRY_MAX_MS);

    console.error("Discord girisi basarisiz:", error);
    console.error(describeDiscordLoginError(error));

    if (!shouldRetryDiscordLogin(error)) {
      process.exitCode = 1;
      return;
    }

    console.error(
      `Ag erisimi tekrar denenecek. ${Math.round(attemptDelay / 1000)} saniye sonra yeni deneme yapiliyor...`,
    );

    setTimeout(() => {
      loginClient(attempt + 1).catch(() => null);
    }, attemptDelay);
  }
}

loginClient().catch((error) => {
  console.error("Bot baslatilamadi:", error);
  process.exitCode = 1;
});

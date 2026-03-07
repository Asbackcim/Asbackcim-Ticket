const { getGuildSettings } = require("./settingsService");
const { updatePanelMeta, upsertTicketLog } = require("./panelStore");
const { getStoredTranscriptInfo } = require("./transcriptService");

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function getField(embed, needles) {
  return (
    embed.fields?.find((field) =>
      needles.some((needle) => normalizeText(field.name).includes(needle)),
    ) || null
  );
}

function parseMention(value) {
  const match = String(value || "").match(/<@!?(\d+)>/);
  return match?.[1] || null;
}

function cleanCodeBlock(value) {
  return String(value || "")
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "")
    .trim();
}

function parseHistoricalLog(message, guild) {
  if (!message.embeds?.length || !message.attachments?.size) {
    return null;
  }

  const embed = message.embeds[0];
  const normalizedTitle = normalizeText(embed.title);
  const transcript = [...message.attachments.values()].find((attachment) =>
    attachment.name?.endsWith(".html"),
  );

  if (!normalizedTitle.includes("destek talebi") || !transcript) {
    return null;
  }

  const openerField = getField(embed, ["acan kisi"]);
  const actorField = getField(embed, ["kapatan kisi", "arsivleyen kisi", "kaydeden kisi"]);
  const reasonField = getField(embed, ["sebep"]);
  const messageCountField = getField(embed, ["mesaj sayisi"]);
  const ticketTypeField = getField(embed, ["ticket tipi"]);
  const action = normalizedTitle.includes("kapatildi") ? "closed" : "saved";
  const localTranscript = getStoredTranscriptInfo(transcript.name);

  return {
    id: `discord-${message.id}`,
    action,
    source: "discord",
    guildId: guild.id,
    guildName: guild.name,
    channelId: null,
    channelName: transcript.name?.replace(/\.html$/i, "") || null,
    openedById: parseMention(openerField?.value),
    archivedById: parseMention(actorField?.value),
    reason: cleanCodeBlock(reasonField?.value || "Neden belirtilmemis"),
    ticketTypeLabel: ticketTypeField?.value || null,
    createdAt: null,
    archivedAt: message.createdAt.toISOString(),
    messageCount: Number.parseInt(messageCountField?.value || "0", 10) || 0,
    transcriptFileName: localTranscript?.fileName || transcript.name || null,
    transcriptPath: localTranscript?.exists ? localTranscript.relativePath : null,
    transcriptUrl: transcript.url,
    discordMessageId: message.id,
  };
}

async function syncHistoricalLogs(client) {
  const stats = [];

  for (const guild of client.guilds.cache.values()) {
    const settings = getGuildSettings(guild.id);

    if (!settings.logChannelId) {
      continue;
    }

    const logChannel = await guild.channels.fetch(settings.logChannelId).catch(() => null);

    if (!logChannel?.isTextBased()) {
      continue;
    }

    let before;
    let imported = 0;

    while (true) {
      const batch = await logChannel.messages.fetch({ limit: 100, before }).catch(() => null);

      if (!batch?.size) {
        break;
      }

      for (const message of batch.values()) {
        const parsed = parseHistoricalLog(message, guild);

        if (!parsed) {
          continue;
        }

        upsertTicketLog(parsed);
        imported += 1;
      }

      before = batch.last().id;

      if (batch.size < 100) {
        break;
      }
    }

    stats.push({
      guildId: guild.id,
      guildName: guild.name,
      imported,
    });
  }

  updatePanelMeta({
    lastHistorySync: new Date().toISOString(),
    lastHistorySyncStats: stats,
  });

  return stats;
}

module.exports = {
  syncHistoricalLogs,
};

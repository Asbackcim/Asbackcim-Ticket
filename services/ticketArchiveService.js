const {
  AttachmentBuilder,
  EmbedBuilder,
  codeBlock,
} = require("discord.js");
const { getPanelMeta, getOpenTicket, upsertTicketLog } = require("./panelStore");
const { getGuildSettings } = require("./settingsService");
const { saveTranscript } = require("./transcriptService");
const { getFooterText } = require("./branding");
const { getTicketOwner } = require("./ticketService");

async function fetchAllMessages(channel) {
  const messages = [];
  let before;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before });

    if (!batch.size) {
      break;
    }

    messages.push(...batch.values());
    before = batch.last().id;

    if (batch.size < 100) {
      break;
    }
  }

  return messages.sort(
    (left, right) => left.createdTimestamp - right.createdTimestamp,
  );
}

function buildLogEmbed({ guild, openerId, actor, action, reason, messageCount, ticketTypeLabel }) {
  const isClosed = action === "closed";

  const embed = new EmbedBuilder()
    .setAuthor({
      name: guild.name,
      iconURL: guild.iconURL() || actor.displayAvatarURL(),
    })
    .setTitle(isClosed ? "Destek Talebi Kapatildi" : "Destek Talebi Arsivlendi")
    .addFields(
      { name: "Acan kisi", value: openerId ? `<@${openerId}>` : "Bilinmiyor", inline: true },
      { name: isClosed ? "Kapatan kisi" : "Arsivleyen kisi", value: `${actor}`, inline: true },
      { name: "Mesaj sayisi", value: String(messageCount), inline: true },
      { name: "Ticket tipi", value: ticketTypeLabel || "Belirtilmedi", inline: true },
      { name: "Sebep", value: codeBlock("yaml", reason || "Neden belirtilmemis"), inline: false },
    )
    .setColor(isClosed ? 0xff6b6b : 0x31c48d)
    .setTimestamp();

  const footerText = getFooterText(actor.username);

  if (footerText) {
    embed.setFooter({ text: footerText });
  }

  return embed;
}

async function archiveTicketConversation({
  client,
  guild,
  channel,
  actor,
  action,
  reason,
}) {
  const openerId = getTicketOwner(guild.id, channel.id);
  const openTicket = getOpenTicket(channel.id);
  const messages = await fetchAllMessages(channel);
  const transcript = await saveTranscript({
    channel,
    messages,
    ticket: openTicket,
  });

  const baseEntry = {
    action,
    source: "local",
    guildId: guild.id,
    guildName: guild.name,
    channelId: channel.id,
    channelName: channel.name,
    openedById: openerId,
    openedByTag: openTicket?.openedByTag || null,
    archivedById: actor.id,
    archivedByTag: actor.tag,
    reason: reason || "Neden belirtilmemis",
    ticketTypeValue: openTicket?.ticketType?.value || null,
    ticketTypeLabel: openTicket?.ticketType?.label || null,
    createdAt: openTicket?.createdAt || channel.createdAt?.toISOString() || null,
    archivedAt: new Date().toISOString(),
    messageCount: transcript.messageCount,
    transcriptFileName: transcript.fileName,
    transcriptPath: transcript.relativePath,
  };

  const settings = getGuildSettings(guild.id);
  let sentMessage = null;

  if (settings.logChannelId) {
    const logChannel = await client.channels.fetch(settings.logChannelId).catch(() => null);

    if (logChannel?.isTextBased()) {
      const embed = buildLogEmbed({
        guild,
        openerId,
        actor,
        action,
        reason: baseEntry.reason,
        messageCount: transcript.messageCount,
        ticketTypeLabel: baseEntry.ticketTypeLabel,
      });

      sentMessage = await logChannel
        .send({
          embeds: [embed],
          files: [new AttachmentBuilder(transcript.buffer, { name: transcript.fileName })],
        })
        .catch(() => null);
    }
  }

  const entry = upsertTicketLog({
    ...baseEntry,
    discordMessageId: sentMessage?.id || null,
  });

  return {
    entry,
    openerId,
    transcript,
    discordLogged: Boolean(sentMessage),
    lastHistorySync: getPanelMeta().lastHistorySync || null,
  };
}

module.exports = {
  archiveTicketConversation,
};

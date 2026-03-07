const db = require("croxydb");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");
const { upsertOpenTicket, removeOpenTicket } = require("./panelStore");
const { DEFAULT_TICKET_TYPES, getGuildSettings } = require("./settingsService");

function getTicketTypes(guildId) {
  if (!guildId) {
    return DEFAULT_TICKET_TYPES.map((type) => ({ ...type }));
  }

  return getGuildSettings(guildId).ticketTypes;
}

function buildTicketTypeRow(guildId) {
  const ticketTypes = getTicketTypes(guildId);

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ticket_type_select")
      .setPlaceholder("Bir ticket tipi sec")
      .addOptions(
        ticketTypes.map((type) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(type.label)
            .setDescription(type.description || "Destek kaydi olustur")
            .setValue(type.value)
            .setEmoji(type.emoji),
        ),
      ),
  );
}

function buildTicketActionRow() {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("kapat")
        .setLabel("Kapat")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger),
    )
    .addComponents(
      new ButtonBuilder()
        .setCustomId("nedenlekapat")
        .setLabel("Nedeniyle kapat")
        .setEmoji("🧾")
        .setStyle(ButtonStyle.Secondary),
    )
    .addComponents(
      new ButtonBuilder()
        .setCustomId("kaydet")
        .setLabel("Arsivle")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),
    );
}

function getTicketTypeByValue(guildId, value) {
  return getTicketTypes(guildId).find((type) => type.value === value) || null;
}

function userTicketKey(guildId, userId) {
  return `mzrkanal_${guildId}_${userId}`;
}

function ownerKey(guildId, channelId) {
  return `mzruye_${guildId}_${channelId}`;
}

function getUserTicketChannelIds(guildId, userId) {
  return db.get(userTicketKey(guildId, userId)) || [];
}

function countUserOpenTickets(guildId, userId) {
  return getUserTicketChannelIds(guildId, userId).length;
}

function addUserTicketChannel(guildId, userId, channelId) {
  const currentChannels = getUserTicketChannelIds(guildId, userId);

  if (!currentChannels.includes(channelId)) {
    db.set(userTicketKey(guildId, userId), [...currentChannels, channelId]);
  }
}

function removeUserTicketChannel(guildId, userId, channelId) {
  const nextChannels = getUserTicketChannelIds(guildId, userId).filter(
    (id) => id !== channelId,
  );

  if (nextChannels.length) {
    db.set(userTicketKey(guildId, userId), nextChannels);
    return;
  }

  db.delete(userTicketKey(guildId, userId));
}

function setTicketOwner(guildId, channelId, userId) {
  db.set(ownerKey(guildId, channelId), userId);
}

function getTicketOwner(guildId, channelId) {
  return db.get(ownerKey(guildId, channelId)) || null;
}

function clearTicketOwner(guildId, channelId) {
  db.delete(ownerKey(guildId, channelId));
}

function registerOpenTicket({ guild, channel, user, type }) {
  return upsertOpenTicket({
    channelId: channel.id,
    channelName: channel.name,
    guildId: guild.id,
    guildName: guild.name,
    openedById: user.id,
    openedByTag: user.tag,
    createdAt: new Date().toISOString(),
    ticketType: {
      value: type.value,
      label: type.label,
    },
  });
}

function clearOpenTicketState(guildId, channelId, openedById) {
  if (openedById) {
    removeUserTicketChannel(guildId, openedById, channelId);
  }

  clearTicketOwner(guildId, channelId);
  removeOpenTicket(channelId);
}

module.exports = {
  buildTicketTypeRow,
  buildTicketActionRow,
  getTicketTypes,
  getTicketTypeByValue,
  countUserOpenTickets,
  addUserTicketChannel,
  removeUserTicketChannel,
  setTicketOwner,
  getTicketOwner,
  registerOpenTicket,
  clearOpenTicketState,
};

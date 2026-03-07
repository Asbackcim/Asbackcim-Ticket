const db = require("croxydb");

const DEFAULT_TICKET_TYPES = Object.freeze([
  {
    value: "server",
    label: "Sunucu ici",
    description: "Sunucu tarafli teknik veya yonetim sorunlari",
    emoji: "🏡",
  },
  {
    value: "member",
    label: "Uye islemleri",
    description: "Uyelerle ilgili sikayet ve destek talepleri",
    emoji: "🙍‍♂️",
  },
  {
    value: "other",
    label: "Diger konu",
    description: "Listede olmayan farkli bir destek konusu",
    emoji: "❓",
  },
]);

const SETTINGS_KEYS = Object.freeze({
  logChannelId: "mzrlog_",
  staffRoleId: "mzryetkili_",
  limit: "mzrlimit_",
  categoryId: "mzrkategori_",
  ticketTypes: "mzrtypes_",
});

function sanitizeTicketTypeValue(value, fallbackLabel = "", index = 0) {
  const source = String(value || fallbackLabel || `ticket-${index + 1}`)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return source || `ticket-${index + 1}`;
}

function normalizeTicketTypes(ticketTypes) {
  if (!Array.isArray(ticketTypes)) {
    return DEFAULT_TICKET_TYPES.map((type) => ({ ...type }));
  }

  const seenValues = new Set();
  const normalized = ticketTypes
    .map((entry, index) => {
      const label = String(entry?.label || "").trim();

      if (!label) {
        return null;
      }

      const value = sanitizeTicketTypeValue(entry?.value, label, index);

      if (seenValues.has(value)) {
        return null;
      }

      seenValues.add(value);

      return {
        value,
        label,
        description: String(entry?.description || "").trim().slice(0, 100),
        emoji: String(entry?.emoji || "").trim().slice(0, 32) || "🎫",
      };
    })
    .filter(Boolean)
    .slice(0, 6);

  if (normalized.length) {
    return normalized;
  }

  return DEFAULT_TICKET_TYPES.map((type) => ({ ...type }));
}

function getGuildSettings(guildId) {
  const limit = db.get(`${SETTINGS_KEYS.limit}${guildId}`);

  return {
    logChannelId: db.get(`${SETTINGS_KEYS.logChannelId}${guildId}`) || null,
    staffRoleId: db.get(`${SETTINGS_KEYS.staffRoleId}${guildId}`) || null,
    limit: typeof limit === "number" ? limit : null,
    categoryId: db.get(`${SETTINGS_KEYS.categoryId}${guildId}`) || null,
    ticketTypes: normalizeTicketTypes(db.get(`${SETTINGS_KEYS.ticketTypes}${guildId}`)),
  };
}

function setValue(key, value) {
  if (value === null || value === undefined || value === "") {
    db.delete(key);
    return;
  }

  db.set(key, value);
}

function updateGuildSettings(guildId, partialSettings) {
  if (Object.prototype.hasOwnProperty.call(partialSettings, "logChannelId")) {
    setValue(`${SETTINGS_KEYS.logChannelId}${guildId}`, partialSettings.logChannelId);
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "staffRoleId")) {
    setValue(`${SETTINGS_KEYS.staffRoleId}${guildId}`, partialSettings.staffRoleId);
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "limit")) {
    const parsedLimit = Number(partialSettings.limit);
    setValue(
      `${SETTINGS_KEYS.limit}${guildId}`,
      Number.isFinite(parsedLimit) ? parsedLimit : null,
    );
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "categoryId")) {
    setValue(`${SETTINGS_KEYS.categoryId}${guildId}`, partialSettings.categoryId);
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "ticketTypes")) {
    setValue(
      `${SETTINGS_KEYS.ticketTypes}${guildId}`,
      normalizeTicketTypes(partialSettings.ticketTypes),
    );
  }

  return getGuildSettings(guildId);
}

module.exports = {
  DEFAULT_TICKET_TYPES,
  SETTINGS_KEYS,
  getGuildSettings,
  normalizeTicketTypes,
  updateGuildSettings,
};

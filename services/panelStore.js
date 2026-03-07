const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const STORAGE_DIR = path.join(PROJECT_ROOT, "storage");
const TRANSCRIPTS_DIR = path.join(STORAGE_DIR, "transcripts");
const LOGS_FILE = path.join(STORAGE_DIR, "ticket-logs.json");
const STATE_FILE = path.join(STORAGE_DIR, "panel-state.json");

function ensureStorage() {
  fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });

  if (!fs.existsSync(LOGS_FILE)) {
    fs.writeFileSync(LOGS_FILE, JSON.stringify({ logs: [] }, null, 2));
  }

  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ tickets: {}, meta: {} }, null, 2),
    );
  }
}

function readJson(filePath, fallback) {
  ensureStorage();

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureStorage();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function sortByNewest(items, fieldName) {
  return [...items].sort((left, right) => {
    const leftValue = new Date(left[fieldName] || 0).getTime();
    const rightValue = new Date(right[fieldName] || 0).getTime();
    return rightValue - leftValue;
  });
}

function normalizeLogEntry(entry) {
  return {
    id: entry.id || crypto.randomUUID(),
    action: entry.action || "saved",
    source: entry.source || "local",
    guildId: entry.guildId || null,
    guildName: entry.guildName || null,
    channelId: entry.channelId || null,
    channelName: entry.channelName || null,
    openedById: entry.openedById || null,
    openedByTag: entry.openedByTag || null,
    archivedById: entry.archivedById || null,
    archivedByTag: entry.archivedByTag || null,
    reason: entry.reason || "Neden belirtilmemis",
    ticketTypeValue: entry.ticketTypeValue || null,
    ticketTypeLabel: entry.ticketTypeLabel || null,
    createdAt: entry.createdAt || null,
    archivedAt: entry.archivedAt || new Date().toISOString(),
    messageCount: Number.isFinite(entry.messageCount) ? entry.messageCount : 0,
    transcriptFileName: entry.transcriptFileName || null,
    transcriptPath: entry.transcriptPath || null,
    transcriptUrl: entry.transcriptUrl || null,
    discordMessageId: entry.discordMessageId || null,
  };
}

function getLogs() {
  const data = readJson(LOGS_FILE, { logs: [] });
  return sortByNewest(data.logs || [], "archivedAt");
}

function upsertTicketLog(entry) {
  const data = readJson(LOGS_FILE, { logs: [] });
  const normalized = normalizeLogEntry(entry);
  const existingIndex = data.logs.findIndex((item) => {
    if (normalized.discordMessageId && item.discordMessageId === normalized.discordMessageId) {
      return true;
    }

    return item.id === normalized.id;
  });

  if (existingIndex >= 0) {
    data.logs[existingIndex] = {
      ...data.logs[existingIndex],
      ...normalized,
    };
  } else {
    data.logs.push(normalized);
  }

  data.logs = sortByNewest(data.logs, "archivedAt");
  writeJson(LOGS_FILE, data);
  return normalized;
}

function findLog(logId) {
  return getLogs().find((log) => log.id === logId) || null;
}

function getPanelState() {
  return readJson(STATE_FILE, { tickets: {}, meta: {} });
}

function listOpenTickets() {
  const state = getPanelState();
  return sortByNewest(Object.values(state.tickets || {}), "createdAt");
}

function getOpenTicket(channelId) {
  const state = getPanelState();
  return state.tickets?.[channelId] || null;
}

function upsertOpenTicket(ticket) {
  const state = getPanelState();
  state.tickets ||= {};
  state.tickets[ticket.channelId] = ticket;
  writeJson(STATE_FILE, state);
  return ticket;
}

function removeOpenTicket(channelId) {
  const state = getPanelState();

  if (state.tickets?.[channelId]) {
    delete state.tickets[channelId];
    writeJson(STATE_FILE, state);
  }
}

function getPanelMeta() {
  const state = getPanelState();
  return state.meta || {};
}

function updatePanelMeta(partialMeta) {
  const state = getPanelState();
  state.meta ||= {};
  state.meta = { ...state.meta, ...partialMeta };
  writeJson(STATE_FILE, state);
  return state.meta;
}

ensureStorage();

module.exports = {
  STORAGE_DIR,
  TRANSCRIPTS_DIR,
  getLogs,
  upsertTicketLog,
  findLog,
  listOpenTickets,
  getOpenTicket,
  upsertOpenTicket,
  removeOpenTicket,
  getPanelMeta,
  updatePanelMeta,
};

const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'security.json');

function ensureDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({}, null, 2));
}

function loadAll() {
  ensureDb();
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function saveAll(obj) {
  ensureDb();
  fs.writeFileSync(dbPath, JSON.stringify(obj, null, 2));
}

function getGuild(guildId) {
  return loadAll()[guildId] || null;
}

function setGuild(guildId, data) {
  const all = loadAll();
  all[guildId] = { ...(all[guildId] || {}), ...data };
  saveAll(all);
  return all[guildId];
}

const DEFAULT_ANTIRAID = {
  enabled: true,
  logChannelId: null,
  // raid (join burst)
  maxJoins: 8,          // max joins allowed...
  joinWindowSec: 10,    // ...inside this window before it counts as a raid
  raidAction: 'kick',   // kick | ban | timeout — what to do to suspected raiders
  lockdownOnRaid: true, // lock all text channels for @everyone when a raid fires
  lockdownMins: 5,      // auto-unlock after X mins (0 = stay locked until manual /unlock)
  accountAgeMinHours: 0, // 0 = off. e.g. 24 = kick accounts younger than 24h during raid mode only (never kicks normally)
  // nuke (rogue admin mass channel/role/ban/kick)
  antiNuke: true,
  nukeThreshold: 3,     // max destructive actions...
  nukeWindowSec: 15,    // ...inside this window before punishing the executor
  nukePunishment: 'ban', // ban | kick | strip (strip = remove all their roles)
  whitelistRoleId: null, // role that bypasses anti-nuke (e.g. owner / co-owner)
};

function getAntiRaid(guildId) {
  const g = getGuild(guildId);
  return { ...DEFAULT_ANTIRAID, ...(g?.antiraid || {}) };
}

function setAntiRaid(guildId, data) {
  const g = getGuild(guildId) || {};
  const merged = { ...DEFAULT_ANTIRAID, ...(g.antiraid || {}), ...data };
  return setGuild(guildId, { ...g, antiraid: merged }).antiraid;
}

function getJail(guildId) {
  const g = getGuild(guildId);
  return g?.jail || null;
}

function setJail(guildId, data) {
  const g = getGuild(guildId) || {};
  const merged = { ...(g.jail || {}), ...data };
  return setGuild(guildId, { ...g, jail: merged }).jail;
}

// jailed: { [userId]: { reason, jailedAt, roles: [roleIds], expiresAt } }
function getJailed(guildId) {
  return getJail(guildId)?.jailed || {};
}

function addJailed(guildId, userId, entry) {
  const j = getJail(guildId) || {};
  const jailed = { ...(j.jailed || {}), [userId]: entry };
  return setJail(guildId, { ...j, jailed });
}

function removeJailed(guildId, userId) {
  const j = getJail(guildId) || {};
  const jailed = { ...(j.jailed || {}) };
  delete jailed[userId];
  return setJail(guildId, { ...j, jailed });
}

module.exports = {
  getGuild,
  setGuild,
  getAntiRaid,
  setAntiRaid,
  getJail,
  setJail,
  getJailed,
  addJailed,
  removeJailed,
  DEFAULT_ANTIRAID,
};

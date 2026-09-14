const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'media.json');

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

function setGuild(guildId, data) {
  const all = loadAll();
  all[guildId] = { ...(all[guildId] || {}), ...data };
  saveAll(all);
}

function getGuild(guildId) {
  return loadAll()[guildId] || null;
}

function removeGuild(guildId) {
  const all = loadAll();
  delete all[guildId];
  saveAll(all);
}

function getAll() {
  return loadAll();
}

module.exports = { setGuild, getGuild, removeGuild, getAll };

const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'verified.json');

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

function saveUser(userId, data) {
  const all = loadAll();
  all[userId] = { ...(all[userId] || {}), ...data };
  saveAll(all);
}

function getUser(userId) {
  return loadAll()[userId] || null;
}

module.exports = { loadAll, saveAll, saveUser, getUser, dbPath };

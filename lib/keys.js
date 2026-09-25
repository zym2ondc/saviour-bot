const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'keys.json');

// shape: { available: string[], claimed: { [key]: { claimedBy, claimedAt } } }
function ensureDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({ available: [], claimed: {} }, null, 2));
}

function load() {
  ensureDb();
  try {
    const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8') || '{}');
    if (!Array.isArray(raw.available)) raw.available = [];
    if (!raw.claimed || typeof raw.claimed !== 'object') raw.claimed = {};
    // normalize: trim, drop empties
    raw.available = raw.available.map(k => String(k).trim()).filter(Boolean);
    return raw;
  } catch {
    return { available: [], claimed: {} };
  }
}

function save(db) {
  ensureDb();
  const tmp = dbPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbPath);
}

function count() {
  return load().available.length;
}

function addOne(key) {
  key = String(key || '').trim();
  if (!key) return { ok: false, reason: 'empty' };
  const db = load();
  if (db.available.includes(key) || db.claimed[key]) return { ok: false, reason: 'duplicate' };
  db.available.push(key);
  save(db);
  return { ok: true, stock: db.available.length };
}

function addMany(keys) {
  const db = load();
  let added = 0, dups = 0;
  for (let k of keys) {
    k = String(k || '').trim();
    if (!k) continue;
    if (db.available.includes(k) || db.claimed[k]) { dups++; continue; }
    db.available.push(k);
    added++;
  }
  save(db);
  return { added, dups, stock: db.available.length };
}

// Single-use claim: pops index 0, records who took it. Never re-issued.
function claim(userId) {
  const db = load();
  if (!db.available.length) return { ok: false, reason: 'out_of_stock' };
  const key = db.available.shift();
  db.claimed[key] = { claimedBy: String(userId), claimedAt: new Date().toISOString() };
  save(db);
  return { ok: true, key, remaining: db.available.length };
}

function alreadyClaimed(userId) {
  const db = load();
  for (const [key, rec] of Object.entries(db.claimed)) {
    if (rec && rec.claimedBy === String(userId)) return { key, ...rec };
  }
  return null;
}

module.exports = { load, save, count, addOne, addMany, claim, alreadyClaimed, dbPath };

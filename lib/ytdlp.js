// Runtime downloader for the static yt-dlp binary.
// Why: the yt-dlp-exec npm package needs `python` at install time, which
// minimal Docker images (Pterodactyl yolks) don't have. Downloading the
// release binary on first use avoids that entirely.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const ASSET = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp_linux';

function binPath() {
  const dir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, ASSET);
}

function usable(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK | fs.constants.X_OK);
    return fs.statSync(p).size > 1_000_000;
  } catch {
    // Windows has no X_OK concept — existence + size is enough
    try { return process.platform === 'win32' && fs.statSync(p).size > 1_000_000; } catch { return false; }
  }
}

function fetch(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'saviour-bot' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetch(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`yt-dlp download failed (HTTP ${res.statusCode})`));
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function ensureBin() {
  const dest = binPath();
  if (usable(dest)) return dest;
  const res = await fetch(BASE + ASSET);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest, { mode: 0o755 });
    res.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.on('error', reject);
  });
  try { fs.chmodSync(dest, 0o755); } catch {}
  if (!usable(dest)) throw new Error('yt-dlp download incomplete, try again.');
  return dest;
}

module.exports = { ensureBin, binPath };

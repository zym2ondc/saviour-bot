// Optional outbound proxy — for hosts whose IP Discord rate-limits (HTTP 429).
// Set ONE of these in .env (leave unset = direct connection):
//   PROXY_URL=http://user:pass@host:port
// (HTTPS_PROXY / HTTP_PROXY / lowercase variants also work.)
// Covers: Discord REST, Discord gateway (wss), and all fetch() calls (OAuth, TikTok, ...).

function getProxyUrl() {
  const raw = process.env.PROXY_URL
    || process.env.HTTPS_PROXY
    || process.env.HTTP_PROXY
    || process.env.https_proxy
    || process.env.http_proxy
    || '';
  return raw.trim().replace(/^["']|["']$/g, '') || null;
}

function mask(url) {
  try {
    return String(url).replace(/:\/\/([^@\/]+)@/, '://***@');
  } catch {
    return url;
  }
}

// Call ONCE at boot, BEFORE creating the Discord client.
// Returns { proxyUrl, restAgent } or null when no proxy is configured.
function applyProxy() {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) {
    console.log('🌐 proxy: none (direct connection)');
    return null;
  }
  let ProxyAgent, setGlobalDispatcher;
  try {
    ({ ProxyAgent, setGlobalDispatcher } = require('undici'));
  } catch (e) {
    console.error(`💥 proxy needs the "undici" package: ${e.message} — run: npm install undici`);
    process.exit(1);
  }
  const restAgent = new ProxyAgent(proxyUrl);
  // 1) All fetch() calls (OAuth, TikTok lookups, connectivity checks)
  try {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  } catch (e) {
    console.warn('⚠️ proxy: could not set global fetch dispatcher:', e.message);
  }
  // 2) Discord gateway — the `ws` package goes through https.globalAgent for wss
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    require('node:https').globalAgent = new HttpsProxyAgent(proxyUrl);
  } catch (e) {
    console.error(`💥 proxy needs the "https-proxy-agent" package: ${e.message} — run: npm install https-proxy-agent`);
    process.exit(1);
  }
  console.log(`🌐 proxy: enabled via ${mask(proxyUrl)} (REST + gateway + fetch)`);
  return { proxyUrl, restAgent };
}

module.exports = { getProxyUrl, applyProxy, mask };

// OAuth2 helpers for verify + restore (guilds.join flow)
const API = 'https://discord.com/api/v10';

function getConfig() {
  return {
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    redirectUri: process.env.OAUTH_REDIRECT_URI || `http://localhost:${process.env.PORT || 3000}/callback`,
  };
}

function buildVerifyUrl(userId, guildId) {
  const { clientId, redirectUri } = getConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'identify guilds guilds.join',
    state: `${userId}.${guildId || ''}`,
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code, redirectUri) {
  const { clientId, clientSecret } = getConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri || getConfig().redirectUri,
  });
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...Object.fromEntries(body),
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

async function refreshAccessToken(refresh_token) {
  const { clientId, clientSecret } = getConfig();
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getMe(accessToken) {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`getMe failed: ${res.status}`);
  return res.json();
}

async function getMyGuilds(accessToken) {
  const res = await fetch(`${API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  return res.json();
}

// PUT /guilds/{guild.id}/members/{user.id} — adds user to guild using their oauth access_token.
// Returns { status, ok, alreadyHere }
async function addMemberToGuild(guildId, userId, userAccessToken, botToken) {
  const res = await fetch(`${API}/guilds/${guildId}/members/${userId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ access_token: userAccessToken }),
  });
  if (res.status === 201) return { status: 201, ok: true, added: true };
  if (res.status === 204) return { status: 204, ok: true, added: false, alreadyHere: true };
  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    return { status: 429, ok: false, rateLimited: true, retryAfter: data.retry_after || 5 };
  }
  const text = await res.text().catch(() => '');
  return { status: res.status, ok: false, error: text.slice(0, 300) };
}

module.exports = { buildVerifyUrl, exchangeCode, refreshAccessToken, getMe, getMyGuilds, addMemberToGuild };

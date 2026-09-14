// Minimal TikTok fetcher using the free TikWM public API (no key needed).
// Docs: https://www.tikwm.com/api/ — GET /api/user/posts?unique_id=xxx&count=1

// Accepts: plain username, @username, profile URL, or video URL.
// Returns the @username, or null if it can't be determined.
function parseTikTokUsername(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  // Full/partial TikTok URL containing /@username
  const atMatch = raw.match(/tiktok\.com\/@([^/?\s#]+)/i);
  if (atMatch) return atMatch[1].replace(/^@/, '');

  // Plain @username or username (letters, numbers, underscore, dot).
  // Usernames never contain spaces — reject anything multi-word outright.
  if (/\s/.test(raw)) return null;
  const plain = raw.replace(/^@/, '');
  if (/^[A-Za-z0-9_.]{2,24}$/.test(plain) && !plain.includes('.com') && !plain.includes('://')) {
    return plain;
  }
  return null;
}

// Resolve short share links (vm.tiktok.com / vt.tiktok.com) to get the username,
// then fall back to plain parsing. Returns username or throws.
async function resolveTikTokUsername(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Paste a TikTok link or username');

  const direct = parseTikTokUsername(raw);
  // If it already parsed AND isn't a short link, we're done
  if (direct && !/v[mt]\.tiktok\.com/i.test(raw)) return direct;

  // Try to follow short links / any tiktok URL to its final destination
  if (/tiktok\.com/i.test(raw)) {
    try {
      const res = await fetch(raw, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SaviourBot/1.0' },
      });
      const finalUrl = res.url || '';
      const fromFinal = parseTikTokUsername(finalUrl);
      if (fromFinal) return fromFinal;
      // Last resort: short-link pages sometimes embed the username in HTML
      const html = await res.text().catch(() => '');
      const htmlMatch = html.match(/tiktok\.com\/@([^/?\s"'#&]+)/i);
      if (htmlMatch) return htmlMatch[1];
    } catch {
      // fall through to error below
    }
  }

  if (direct) return direct;
  throw new Error('Could not get a username from that link. Paste a tiktok.com video/profile link or the @username');
}

const TIKWM_COOKIE = process.env.TIKWM_COOKIE || '';
// When the cookie is set we mimic the browser it came from (Cloudflare
// checks the clearance cookie, and matching UA/Referer helps it pass).
const TIKWM_HEADERS = TIKWM_COOKIE
  ? {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.tikwm.com/',
      'Cookie': `cf_clearance=${TIKWM_COOKIE}`,
    }
  : { 'User-Agent': 'SaviourBot/1.0' };

async function fetchLatestVideo(username) {
  const clean = String(username || '').trim().replace(/^@/, '');
  if (!clean) throw new Error('Empty TikTok username');

  const url = `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(clean)}&count=1`;
  let res;
  try {
    res = await fetch(url, { headers: TIKWM_HEADERS });
  } catch (err) {
    throw new Error(`Couldn't reach TikTok lookup service (${err.message})`);
  }
  if (res.status === 403) {
    throw new Error(
      'TikTok auto-check is blocked from this server (TikWM is bot-checking this IP). ' +
      (TIKWM_COOKIE
        ? 'The TIKWM_COOKIE looks expired/invalid — grab a fresh cf_clearance (see .env.example) and restart.'
        : 'Fix: set TIKWM_COOKIE in .env (see .env.example, 2-min job) and restart — or use `/media post` to announce manually.')
    );
  }
  if (!res.ok) throw new Error(`TikTok lookup failed (HTTP ${res.status})`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.msg || 'TikTok user not found');

  const videos = json.data?.videos;
  if (!videos || !videos.length) throw new Error('No videos found for this user (account may be private / empty / wrong name)');

  const v = videos[0];
  const authorUniqueId = v.author?.unique_id || clean;
  return {
    id: String(v.video_id || v.id),
    url: `https://www.tiktok.com/@${authorUniqueId}/video/${v.video_id || v.id}`,
    desc: v.title || 'New TikTok!',
    cover: v.cover || v.ai_dynamic_cover || null,
    authorName: v.author?.nickname || authorUniqueId,
    authorUniqueId,
    createTime: v.create_time || null,
  };
}

function buildPostMessage({ roleId, video, customMessage }) {
  const text = customMessage || '🔥 **New TikTok just dropped!**';
  return `${roleId ? `<@&${roleId}> ` : ''}${text}\n${video.url}`;
}

// Validate + get info for ONE pasted video link via TikTok's official oEmbed
// (no key needed, works from any server). Throws with a friendly message.
async function fetchVideoOEmbed(input) {
  const raw = String(input || '').trim();
  const m = raw.match(/tiktok\.com\/@([^/?\s#]+)\/video\/(\d+)/i);
  if (!m) throw new Error('Paste a TikTok **video** link (e.g. https://www.tiktok.com/@user/video/123...) — profile links won\'t work here.');

  const authorUniqueId = m[1];
  const videoId = m[2];
  const videoUrl = `https://www.tiktok.com/@${authorUniqueId}/video/${videoId}`;

  let res;
  try {
    res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`, {
      headers: { 'User-Agent': 'SaviourBot/1.0' },
    });
  } catch (err) {
    throw new Error(`Couldn't reach TikTok (${err.message})`);
  }
  if (!res.ok) throw new Error('TikTok didn\'t recognise that video link. Check it opens in a browser.');
  const data = await res.json();
  return {
    id: videoId,
    url: videoUrl,
    desc: data.title || 'New TikTok!',
    // oEmbed author_name is the display name; keep @handle from the URL too
    authorName: data.author_name || authorUniqueId,
    authorUniqueId,
    authorUrl: data.author_url || `https://www.tiktok.com/@${authorUniqueId}`,
    thumbnail: data.thumbnail_url || null,
  };
}

module.exports = { fetchLatestVideo, buildPostMessage, parseTikTokUsername, resolveTikTokUsername, fetchVideoOEmbed };

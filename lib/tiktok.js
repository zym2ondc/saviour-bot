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

async function fetchLatestVideo(username) {
  const clean = String(username || '').trim().replace(/^@/, '');
  if (!clean) throw new Error('Empty TikTok username');

  const url = `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(clean)}&count=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'SaviourBot/1.0' } });
  if (!res.ok) throw new Error(`TikWM HTTP ${res.status}`);
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

module.exports = { fetchLatestVideo, buildPostMessage, parseTikTokUsername, resolveTikTokUsername };

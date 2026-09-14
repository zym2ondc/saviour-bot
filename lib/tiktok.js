// Minimal TikTok fetcher using the free TikWM public API (no key needed).
// Docs: https://www.tikwm.com/api/ — GET /api/user/posts?unique_id=xxx&count=1

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

module.exports = { fetchLatestVideo, buildPostMessage };

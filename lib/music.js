const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
} = require('@discordjs/voice');
const { spawn } = require('node:child_process');
const path = require('node:path');
const playdl = require('play-dl');
const { ensureBin } = require('./ytdlp');

// Optional YouTube cookies (helps avoid "Sign in to confirm you're not a bot").
// Set YT_COOKIE in .env to the value of your YouTube LOGIN_INFO / cookie header if needed.
if (process.env.YT_COOKIE) {
  playdl.setToken({ youtube: { cookie: process.env.YT_COOKIE } }).catch(() => {});
}

// guildId -> { connection, player, queue: Track[], current: Track|null, textChannelId }
const states = new Map();

function getState(guildId) {
  return states.get(guildId) || null;
}

function ensureState(guild, textChannelId) {
  let s = states.get(guild.id);
  if (s) {
    if (textChannelId) s.textChannelId = textChannelId;
    return s;
  }
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });

  s = { connection: null, player, queue: [], current: null, textChannelId: textChannelId || null };
  states.set(guild.id, s);

  player.on(AudioPlayerStatus.Idle, () => {
    const st = states.get(guild.id);
    if (!st) return;
    st.current = null;
    const next = st.queue.shift();
    if (next) {
      playTrack(guild, next).catch((e) => {
        console.error('play next failed:', e.message);
        // try the one after it instead of going silent
        const st2 = states.get(guild.id);
        if (st2 && st2.queue.length) {
          const n2 = st2.queue.shift();
          playTrack(guild, n2).catch(() => {});
        }
      });
    }
    // else: queue empty -> STAY in VC (do nothing until /disconnect)
  });

  player.on('error', (err) => {
    console.error('audio player error:', err.message);
    try {
      const st = states.get(guild.id);
      if (st) {
        st.current = null;
        const next = st.queue.shift();
        if (next) playTrack(guild, next).catch(() => {});
      }
    } catch {}
  });

  return s;
}

async function joinChannel(guild, voiceChannel) {
  const s = ensureState(guild);
  if (s.connection) {
    try {
      const chId = s.connection.joinConfig.channelId;
      if (chId === voiceChannel.id) {
        try { await entersState(s.connection, VoiceConnectionStatus.Ready, 5_000); } catch {}
        return s.connection;
      }
      s.connection.destroy();
    } catch {}
    s.connection = null;
  }
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });
  // Failure-only diagnostic: remember the last voice close code so a failed
  // join can report WHY (one line, only on failure — no console spam).
  let lastCloseCode = null;
  connection.on('stateChange', (oldState, newState) => {
    try {
      if (newState.networking && newState.networking.once) {
        newState.networking.once('close', (code) => { lastCloseCode = code; });
      }
    } catch {}
  });
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  } catch (e) {
    try { connection.destroy(); } catch {}
    if (states.get(guild.id)?.connection === connection) states.get(guild.id).connection = null;
    const extra = lastCloseCode !== null && lastCloseCode !== undefined ? ` (voice close code: ${lastCloseCode})` : '';
    console.error(`voice join failed${extra}`);
    throw new Error(`Could not join your voice channel in time${extra}. Check I have **Connect** + **Speak** perms there.`);
  }
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      // Only give up if the user asked to disconnect (state deleted) — otherwise stay/reconnect.
      if (states.get(guild.id)?.connection === connection) {
        try { connection.rejoin(); } catch {}
      }
    }
  });
  connection.subscribe(s.player);
  s.connection = connection;
  return connection;
}

function isUrl(str) {
  return /^https?:\/\//i.test(str);
}

async function resolveTracks(query, requestedBy) {
  // Direct links, or search terms.
  if (isUrl(query)) {
    let host = '';
    try { host = new URL(query).hostname.toLowerCase(); } catch {}
    if (host.includes('spotify.')) {
      throw new Error('Spotify links aren\'t supported yet (needs Spotify API setup). Send a YouTube link or search terms instead.');
    }
    if (host.includes('soundcloud.')) {
      // play-dl's SoundCloud auth is broken upstream; use yt-dlp for metadata instead
      const meta = await ytDlpJson(query);
      return [{
        title: meta.title || 'Unknown title',
        url: meta.webpage_url || query,
        duration: formatDur(meta.duration || 0),
        thumbnail: meta.thumbnail || null,
        requestedBy,
      }];
    }
    const ytType = playdl.yt_validate(query);
    if (ytType === 'video') {
      try {
        const info = await playdl.video_info(query);
        const d = info.video_details;
        return [{
          title: d.title || 'Unknown title',
          url: d.url || query,
          duration: formatDur(d.durationInSec || 0),
          thumbnail: d.thumbnails?.[d.thumbnails.length - 1]?.url || null,
          requestedBy,
        }];
      } catch (e) {
        if (!isBotBlock(e)) throw e;
        // play-dl is bot-blocked on this network — yt-dlp handles it better
        const m = await ytDlpJson(query);
        return [trackFromYtDlp(m, query, requestedBy)];
      }
    }
    if (ytType === 'playlist' || ytType === 'mix') {
      try {
        const playlist = await playdl.playlist_info(query, { incomplete: true });
        const videos = await playlist.all_videos();
        return videos.slice(0, 50).map((v) => ({
          title: v.title || 'Unknown title',
          url: v.url || query,
          duration: formatDur(v.durationInSec || 0),
          thumbnail: v.thumbnails?.[v.thumbnails.length - 1]?.url || null,
          requestedBy,
        }));
      } catch (e) {
        if (!isBotBlock(e)) throw e;
        const m = await ytDlpJson(query, ['--flat-playlist']);
        const entries = Array.isArray(m.entries) ? m.entries.slice(0, 50) : [];
        if (!entries.length) throw new Error('Could not read that playlist.');
        return entries.map((v) => ({
          title: v.title || 'Unknown title',
          url: v.url?.startsWith?.('http') ? v.url : `https://www.youtube.com/watch?v=${v.id || v.url}`,
          duration: formatDur(v.duration || 0),
          thumbnail: v.thumbnail || v.thumbnails?.slice?.(-1)?.[0]?.url || null,
          requestedBy,
        }));
      }
    }
    // Fallback: treat any other URL as a single playable stream (e.g. direct audio file)
    return [{ title: query, url: query, duration: 'LIVE', thumbnail: null, requestedBy }];
  }

  // Search terms -> top YouTube result
  try {
    const results = await playdl.search(query, { limit: 1, source: { youtube: 'video' } });
    if (!results.length) throw new Error('No results found for that search.');
    const r = results[0];
    return [{
      title: r.title || query,
      url: r.url,
      duration: formatDur(r.durationInSec || 0),
      thumbnail: r.thumbnails?.[r.thumbnails.length - 1]?.url || null,
      requestedBy,
    }];
  } catch (e) {
    if (!isBotBlock(e)) throw e;
    const m = await ytDlpJson(`ytsearch1:${query}`);
    const hit = Array.isArray(m.entries) ? m.entries[0] : m;
    if (!hit) throw new Error('No results found for that search.');
    return [trackFromYtDlp(hit, hit.webpage_url || query, requestedBy)];
  }
}

function isBotBlock(e) {
  return /sign in to confirm|confirm you.?re not a bot|bot|403|410|unavailable|age-?restricted/i.test(e?.message || '');
}

function trackFromYtDlp(m, fallbackUrl, requestedBy) {
  let url = m.webpage_url || fallbackUrl;
  const id = m.id || m.url;
  if ((!url || url.startsWith('ytsearch')) && id && !String(id).startsWith('http')) {
    url = `https://www.youtube.com/watch?v=${id}`;
  } else if (url && !url.startsWith('http') && id) {
    url = `https://www.youtube.com/watch?v=${id}`;
  }
  return {
    title: m.title || 'Unknown title',
    url,
    duration: formatDur(m.duration || 0),
    thumbnail: m.thumbnail || m.thumbnails?.slice?.(-1)?.[0]?.url || null,
    requestedBy,
  };
}

function ytDlpJson(url, extraArgs = []) {
  const { execFile } = require('node:child_process');
  return new Promise((resolve, reject) => {
    ensureBin().then((bin) => {
      execFile(bin, ['--dump-single-json', '--no-playlist', '--no-warnings', ...extraArgs, url], { timeout: 40_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`Could not read that link: ${(stderr || err.message).slice(-200)}`));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Could not read that link.')); }
      });
    }, reject);
  });
}

function formatDur(totalSec) {  totalSec = Math.floor(Number(totalSec) || 0);
  if (!totalSec) return 'LIVE';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function playTrack(guild, track) {
  const s = states.get(guild.id);
  if (!s || !s.connection) throw new Error('Not connected. Use /play first.');
  // Kill any previous extractor (skip/disconnect/replay leaking processes)
  try { s.proc?.kill('SIGKILL'); } catch {}
  s.proc = null;

  const args = ['--no-playlist', '-f', 'bestaudio/best', '-o', '-', '--no-part', '--no-progress', '--no-warnings', '--retries', '3', track.url];
  if (process.env.YT_COOKIE) args.splice(0, 0, '--add-header', `Cookie:${process.env.YT_COOKIE}`);
  const proc = spawn(await ensureBin(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  s.proc = proc;
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 2000) stderr = stderr.slice(-2000); });
  proc.on('error', (e) => { console.error('yt-dlp spawn failed:', e.message); });

  // Wait for the first audio bytes (or a fast failure) so /play reports real errors
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Audio extractor timed out (no data in 20s).')); }, 20_000);
    const cleanup = () => { clearTimeout(timer); proc.stdout.off('readable', onData); proc.off('close', onClose); proc.off('error', onErr); };
    const onData = () => { cleanup(); resolve(); };
    const onClose = (code) => { cleanup(); reject(new Error(code ? `Audio extractor failed (code ${code}): ${stderr.slice(-300) || 'unknown error'}` : 'Audio extractor ended before sending data.')); };
    const onErr = (e) => { cleanup(); reject(new Error(`Audio extractor failed to start: ${e.message}`)); };
    proc.stdout.once('readable', onData);
    proc.once('close', onClose);
    proc.once('error', onErr);
  });

  // Arbitrary container (webm/opus) -> prism-ffmpeg transcodes via bundled ffmpeg-static
  const resource = createAudioResource(proc.stdout, { inputType: StreamType.Arbitrary, inlineVolume: true });
  resource.playStream.on('error', () => { try { proc.kill('SIGKILL'); } catch {} });
  if (resource.volume) resource.volume.setVolume(0.8);
  s.current = track;
  s.player.play(resource);
}

async function enqueue(guild, voiceChannel, query, requestedBy, textChannelId) {
  const s = ensureState(guild, textChannelId);
  await joinChannel(guild, voiceChannel);
  const tracks = await resolveTracks(query, requestedBy);
  const [first, ...rest] = tracks;
  const playing = s.current || s.player.state.status === AudioPlayerStatus.Playing || s.player.state.status === AudioPlayerStatus.Buffering;
  if (!playing && s.queue.length === 0) {
    await playTrack(guild, first);
    if (rest.length) s.queue.push(...rest);
    return { started: first, queued: rest.length, position: 0 };
  }
  s.queue.push(first, ...rest);
  return { started: null, queued: tracks.length, position: s.queue.length - tracks.length + 1 };
}

function pause(guildId) {
  const s = states.get(guildId);
  if (!s || !s.current) return false;
  return s.player.pause();
}

function resume(guildId) {
  const s = states.get(guildId);
  if (!s || !s.current) return false;
  return s.player.unpause();
}

function disconnect(guildId) {
  const s = states.get(guildId);
  if (!s) return false;
  try { s.player.stop(true); } catch {}
  try { s.proc?.kill('SIGKILL'); } catch {}
  try { s.connection?.destroy(); } catch {}
  states.delete(guildId);
  return true;
}

function status(guildId) {
  const s = states.get(guildId);
  if (!s) return null;
  return {
    connected: !!s.connection,
    paused: s.player.state.status === AudioPlayerStatus.Paused,
    playing: s.player.state.status === AudioPlayerStatus.Playing,
    current: s.current,
    queue: [...s.queue],
  };
}

module.exports = { enqueue, pause, resume, disconnect, status, getState };

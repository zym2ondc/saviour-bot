const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const playdl = require('play-dl');

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
    debug: true,
  });
  connection.on('debug', (msg) => {
    try { console.log(`[voice-debug] ${msg}`); } catch {}
  });
  connection.on('stateChange', (oldState, newState) => {
    try {
      const net = newState.networking ? ` networking=${newState.networking.state?.code ?? newState.networking.state?.status}` : '';
      console.log(`[voice] ${oldState.status} -> ${newState.status}${net}`);
      if (newState.networking && newState.networking.once) {
        newState.networking.once('close', (code) => {
          try { console.log(`[voice] networking closed with code ${code}`); } catch {}
        });
      }
    } catch {}
  });
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  } catch (e) {
    try { console.log(`[voice] FAILED, stuck at ${connection.state.status}`); } catch {}
    try { connection.destroy(); } catch {}
    if (states.get(guild.id)?.connection === connection) states.get(guild.id).connection = null;
    throw new Error('Could not join your voice channel in time. Check I have **Connect** + **Speak** perms there.');
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
      throw new Error('SoundCloud is currently unsupported (their API change broke playback). Send a YouTube link or search terms instead.');
    }
    const ytType = playdl.yt_validate(query);
    if (ytType === 'video') {
      const info = await playdl.video_info(query);
      const d = info.video_details;
      return [{
        title: d.title || 'Unknown title',
        url: d.url || query,
        duration: formatDur(d.durationInSec || 0),
        thumbnail: d.thumbnails?.[d.thumbnails.length - 1]?.url || null,
        requestedBy,
      }];
    }
    if (ytType === 'playlist' || ytType === 'mix') {
      const playlist = await playdl.playlist_info(query, { incomplete: true });
      const videos = await playlist.all_videos();
      return videos.slice(0, 50).map((v) => ({
        title: v.title || 'Unknown title',
        url: v.url || query,
        duration: formatDur(v.durationInSec || 0),
        thumbnail: v.thumbnails?.[v.thumbnails.length - 1]?.url || null,
        requestedBy,
      }));
    }
    // Fallback: treat any other URL as a single playable stream (e.g. direct audio file)
    return [{ title: query, url: query, duration: 'LIVE', thumbnail: null, requestedBy }];
  }

  // Search terms -> top YouTube result
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
}

function formatDur(totalSec) {
  totalSec = Math.floor(Number(totalSec) || 0);
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
  const { stream, type } = await playdl.stream(track.url, { discordPlayerCompatibility: true });
  const resource = createAudioResource(stream, { inputType: type, inlineVolume: true });
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

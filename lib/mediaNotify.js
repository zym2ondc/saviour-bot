const { EmbedBuilder } = require('discord.js');
const mediaConfig = require('./mediaConfig');
const { fetchLatestVideo, buildPostMessage } = require('./tiktok');

const POLL_MS = 2 * 60 * 1000; // check every 2 minutes

let started = false;

function startMediaNotifier(client) {
  if (started) return;
  started = true;

  async function poll() {
    try {
      const all = mediaConfig.getAll();
      for (const [guildId, cfg] of Object.entries(all)) {
        if (!cfg?.tiktok || !cfg?.channelId) continue;
        try {
          const latest = await fetchLatestVideo(cfg.tiktok);
          if (!latest.id || latest.id === cfg.lastVideoId) continue;

          // First run after setup already seeds lastVideoId, but guard anyway:
          // if there's no lastVideoId yet, just save it without pinging old videos
          if (!cfg.lastVideoId) {
            mediaConfig.setGuild(guildId, { lastVideoId: latest.id });
            continue;
          }

          const guild = await client.guilds.fetch(guildId).catch(() => null);
          if (!guild) continue;
          const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
          if (!channel || !channel.isTextBased?.()) continue;

          const content = buildPostMessage({ roleId: cfg.roleId, video: latest, customMessage: cfg.customMessage });
          const embed = new EmbedBuilder()
            .setTitle(`🎵 @${latest.authorUniqueId} — new TikTok!`)
            .setDescription((latest.desc || 'New TikTok!').slice(0, 300))
            .setURL(latest.url)
            .setColor(0xfe2c55)
            .setTimestamp();
          if (latest.cover) embed.setImage(latest.cover);

          await channel.send({ content, embeds: [embed] }).catch(() => {});
          mediaConfig.setGuild(guildId, { lastVideoId: latest.id });
          console.log(`📱 [media] Posted new TikTok @${cfg.tiktok} → ${guild.name}: ${latest.url}`);
        } catch (err) {
          console.warn(`📱 [media] check failed for ${cfg?.tiktok}:`, err.message);
        }
      }
    } catch (err) {
      console.warn('📱 [media] poll error:', err.message);
    }
  }

  // Small delay on boot, then interval
  setTimeout(poll, 30 * 1000);
  setInterval(poll, POLL_MS).unref?.();
  console.log(`📱 Media notifier started (every ${POLL_MS / 60000} min)`);
}

module.exports = { startMediaNotifier };

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const mediaConfig = require('../lib/mediaConfig');
const { fetchLatestVideo, buildPostMessage, resolveTikTokUsername } = require('../lib/tiktok');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('media')
    .setDescription('Auto-post new TikToks + ping a role')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Watch a TikTok account and ping a role on new posts')
        .addStringOption(opt =>
          opt.setName('link')
            .setDescription('Paste a TikTok video/profile link (or @username)')
            .setRequired(true))
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('Channel to post new TikToks in')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true))
        .addRoleOption(opt =>
          opt.setName('role')
            .setDescription('Role to @ when a new TikTok drops')
            .setRequired(true))
        .addStringOption(opt =>
          opt.setName('message')
            .setDescription('Custom ping message (default: New TikTok just dropped!)')
            .setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('Show current TikTok watcher config'))
    .addSubcommand(sub =>
      sub.setName('check')
        .setDescription('Force-check for a new TikTok right now'))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Stop watching TikTok / disable notifications')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'setup') {
      // Accept pasted link (or plain @username). Fall back to old 'tiktok' option for backwards compat.
      const pasted = (interaction.options.getString('link') || interaction.options.getString('tiktok') || '').trim();
      const channel = interaction.options.getChannel('channel');
      const role = interaction.options.getRole('role');
      const message = interaction.options.getString('message') || null;

      await interaction.deferReply({ ephemeral: true });

      let tiktok;
      try {
        tiktok = await resolveTikTokUsername(pasted);
      } catch (err) {
        return interaction.editReply({ content: `❌ ${err.message}` });
      }

      // Validate we can actually find this TikTok account before saving
      let latest;
      try {
        latest = await fetchLatestVideo(tiktok);
      } catch (err) {
        return interaction.editReply({ content: `❌ Couldn't find TikTok \`@${tiktok}\` (from your link). Error: ${err.message}` });
      }

      mediaConfig.setGuild(guildId, {
        tiktok,
        channelId: channel.id,
        roleId: role.id,
        customMessage: message,
        lastVideoId: latest.id, // start from latest so we don't spam old videos
        updatedAt: Date.now(),
      });

      const embed = new EmbedBuilder()
        .setTitle('📱 Media notifications ON')
        .setDescription(`Watching **@${tiktok}**\nPosts go to ${channel} + pings ${role}\n\nLatest video found (won't re-post it):\n${latest.url}`)
        .setColor(0xfe2c55)
        .setTimestamp();
      if (latest.cover) embed.setThumbnail(latest.cover);

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'status') {
      const cfg = mediaConfig.getGuild(guildId);
      if (!cfg?.tiktok) return interaction.reply({ content: '📱 No TikTok watcher set up. Use `/media setup` first.', ephemeral: true });
      const ch = interaction.guild.channels.cache.get(cfg.channelId);
      const role = interaction.guild.roles.cache.get(cfg.roleId);
      return interaction.reply({
        content: `📱 Watching **@${cfg.tiktok}** → ${ch ? `${ch}` : `(deleted channel ${cfg.channelId})`} + ${role ? `${role}` : `(deleted role)`}\nLast posted video ID: \`${cfg.lastVideoId || 'none yet'}\`\nChecks every ~2 min. Use \`/media check\` to force-check.`,
        ephemeral: true,
      });
    }

    if (sub === 'check') {
      const cfg = mediaConfig.getGuild(guildId);
      if (!cfg?.tiktok) return interaction.reply({ content: '📱 No TikTok watcher set up. Use `/media setup` first.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      try {
        const latest = await fetchLatestVideo(cfg.tiktok);
        if (latest.id === cfg.lastVideoId) {
          return interaction.editReply({ content: `✅ No new TikTok. Latest is still:\n${latest.url}` });
        }
        // New video → post it now
        const channel = await interaction.guild.channels.fetch(cfg.channelId).catch(() => null);
        if (!channel) return interaction.editReply({ content: '❌ Saved channel was deleted. Re-run `/media setup`.' });
        const content = buildPostMessage({ roleId: cfg.roleId, video: latest, customMessage: cfg.customMessage });
        const embed = new EmbedBuilder()
          .setTitle(`🎵 @${latest.authorUniqueId} — new TikTok!`)
          .setDescription(latest.desc?.slice(0, 300) || 'New TikTok!')
          .setURL(latest.url)
          .setColor(0xfe2c55)
          .setTimestamp();
        if (latest.cover) embed.setImage(latest.cover);
        await channel.send({ content, embeds: [embed] });
        mediaConfig.setGuild(guildId, { lastVideoId: latest.id });
        return interaction.editReply({ content: `✅ Found + posted new video:\n${latest.url}` });
      } catch (err) {
        return interaction.editReply({ content: `❌ Check failed: ${err.message}` });
      }
    }

    if (sub === 'remove') {
      mediaConfig.removeGuild(guildId);
      return interaction.reply({ content: '📱 TikTok notifications disabled.', ephemeral: true });
    }
  },
};

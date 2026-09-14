const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const security = require('../lib/securityConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setupantiraid')
    .setDescription('Setup anti-raid + anti-nuke protection for this server')
    .addBooleanOption(o => o.setName('enabled').setDescription('Turn protection on/off (default: on)').setRequired(false))
    .addChannelOption(o => o.setName('log-channel').setDescription('Where to send raid/nuke alerts').addChannelTypes(ChannelType.GuildText).setRequired(false))
    .addIntegerOption(o => o.setName('max-joins').setDescription('Max joins before raid fires (default 8)').setMinValue(2).setMaxValue(50).setRequired(false))
    .addIntegerOption(o => o.setName('join-window').setDescription('...inside this many seconds (default 10)').setMinValue(5).setMaxValue(120).setRequired(false))
    .addStringOption(o => o.setName('raid-action').setDescription('What to do to raiders (default kick)').addChoices(
      { name: 'kick', value: 'kick' },
      { name: 'ban', value: 'ban' },
      { name: 'timeout 10m', value: 'timeout' },
    ).setRequired(false))
    .addBooleanOption(o => o.setName('lockdown').setDescription('Lock all channels when a raid fires? (default on)').setRequired(false))
    .addIntegerOption(o => o.setName('lockdown-mins').setDescription('Auto-unlock after X mins (0 = stay locked, default 5)').setMinValue(0).setMaxValue(60).setRequired(false))
    .addBooleanOption(o => o.setName('anti-nuke').setDescription('Punish rogue admins mass-deleting/banning? (default on)').setRequired(false))
    .addIntegerOption(o => o.setName('nuke-limit').setDescription('Max destructive actions before punish (default 3)').setMinValue(2).setMaxValue(10).setRequired(false))
    .addStringOption(o => o.setName('nuke-punishment').setDescription('Punishment for nukers (default ban)').addChoices(
      { name: 'ban', value: 'ban' },
      { name: 'kick', value: 'kick' },
      { name: 'strip roles', value: 'strip' },
    ).setRequired(false))
    .addRoleOption(o => o.setName('whitelist-role').setDescription('Role that bypasses anti-nuke (e.g. co-owner)').setRequired(false))
    .addBooleanOption(o => o.setName('status').setDescription('Just show current settings').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    const me = guild.members.me;

    // Sanity: warn about missing perms (don't hard-block, raid detection still partly works)
    const missing = [];
    if (!me.permissions.has(PermissionFlagsBits.KickMembers)) missing.push('Kick Members');
    if (!me.permissions.has(PermissionFlagsBits.BanMembers)) missing.push('Ban Members');
    if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) missing.push('Timeout Members');
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) missing.push('Manage Channels (lockdown)');
    if (!me.permissions.has(PermissionFlagsBits.ViewAuditLog)) missing.push('View Audit Log (anti-nuke needs this!)');
    if (!me.permissions.has(PermissionFlagsBits.ManageMessages)) missing.push('Manage Messages (spam cleanup)');

    if (interaction.options.getBoolean('status')) {
      const c = security.getAntiRaid(guild.id);
      const embed = new EmbedBuilder()
        .setTitle('🛡️ Anti-Raid Status')
        .setDescription(
          `**Enabled:** ${c.enabled ? '✅' : '❌'}\n` +
          `**Log channel:** ${c.logChannelId ? `<#${c.logChannelId}>` : 'none'}\n` +
          `**Raid:** ${c.maxJoins} joins / ${c.joinWindowSec}s → ${c.raidAction}${c.lockdownOnRaid ? ` + lockdown (${c.lockdownMins ? c.lockdownMins + 'm auto-unlock' : 'stays locked'})` : ''}\n` +
          `**Anti-nuke:** ${c.antiNuke ? `✅ ${c.nukeThreshold} actions / ${c.nukeWindowSec}s → ${c.nukePunishment}` : '❌'}\n` +
          `**Whitelist role:** ${c.whitelistRoleId ? `<@&${c.whitelistRoleId}>` : 'none (owner always bypasses)'}\n` +
          (missing.length ? `\n⚠️ I'm missing: **${missing.join(', ')}** — give my role these perms for full protection.` : '\n✅ I have all perms needed.')
        )
        .setColor(c.enabled ? 0x57f287 : 0xed4245)
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    const patch = {};
    const get = (n) => interaction.options.get(n)?.value ?? null;
    if (interaction.options.getBoolean('enabled') !== null) patch.enabled = interaction.options.getBoolean('enabled');
    else if (!security.getGuild(guild.id)?.antiraid) patch.enabled = true; // first run = enable
    if (interaction.options.getChannel('log-channel')) patch.logChannelId = interaction.options.getChannel('log-channel').id;
    if (get('max-joins') !== null) patch.maxJoins = interaction.options.getInteger('max-joins');
    if (get('join-window') !== null) patch.joinWindowSec = interaction.options.getInteger('join-window');
    if (interaction.options.getString('raid-action')) patch.raidAction = interaction.options.getString('raid-action');
    if (interaction.options.getBoolean('lockdown') !== null) patch.lockdownOnRaid = interaction.options.getBoolean('lockdown');
    if (get('lockdown-mins') !== null) patch.lockdownMins = interaction.options.getInteger('lockdown-mins');
    if (interaction.options.getBoolean('anti-nuke') !== null) patch.antiNuke = interaction.options.getBoolean('anti-nuke');
    if (get('nuke-limit') !== null) patch.nukeThreshold = interaction.options.getInteger('nuke-limit');
    if (interaction.options.getString('nuke-punishment')) patch.nukePunishment = interaction.options.getString('nuke-punishment');
    if (interaction.options.getRole('whitelist-role')) patch.whitelistRoleId = interaction.options.getRole('whitelist-role').id;

    const c = security.setAntiRaid(guild.id, patch);

    const embed = new EmbedBuilder()
      .setTitle('🛡️ Anti-Raid enabled')
      .setDescription(
        `**Raid protection:** ${c.enabled ? '✅ ON' : '❌ OFF'}\n` +
        `• **${c.maxJoins} joins / ${c.joinWindowSec}s** → ${c.raidAction} suspects` +
        (c.lockdownOnRaid ? ` + lock ${'all channels'}${c.lockdownMins ? ` (${c.lockdownMins}m auto-unlock)` : ''}` : '') + `\n` +
        `• Spam / mention-raid → timeout + delete burst\n` +
        `**Anti-nuke:** ${c.antiNuke ? `✅ ON — ${c.nukeThreshold} deletes/bans/kicks in ${c.nukeWindowSec}s → ${c.nukePunishment}` : '❌ OFF'}\n` +
        `**Alerts:** ${c.logChannelId ? `<#${c.logChannelId}>` : '⚠️ no log channel set — re-run with `log-channel`'}\n` +
        `**Whitelist:** ${c.whitelistRoleId ? `<@&${c.whitelistRoleId}>` : 'server owner only'}` +
        (missing.length ? `\n\n⚠️ Give me these perms for full protection: **${missing.join(', ')}**` : '')
      )
      .setColor(0x57f287)
      .setFooter({ text: 'Saviour Security • re-run /setupantiraid status anytime' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

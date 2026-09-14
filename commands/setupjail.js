const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const security = require('../lib/securityConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setupjail')
    .setDescription('Create the Jailed role + #jail channel (jailed users can ONLY see that channel)')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Use an existing channel as jail (defaults to creating #jail)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    const me = guild.members.me;

    if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply('❌ I need **Manage Roles** + **Manage Channels** (and my role must be at the TOP of the role list, above Jailed and above any role you want me to jail).');
    }

    // 1. Jailed role (no permissions at all)
    let jailedRole = guild.roles.cache.find(r => r.name === 'Jailed');
    if (!jailedRole) {
      try {
        jailedRole = await guild.roles.create({ name: 'Jailed', color: 0x2b2d31, permissions: [], reason: 'Saviour jail setup' });
      } catch (e) {
        return interaction.editReply('❌ Could not create the Jailed role. Make sure my role is above where Jailed would go and I have Manage Roles.');
      }
    } else {
      try { await jailedRole.setPermissions([], 'Saviour jail setup: strip permissions'); } catch {}
    }

    // 2. Jail channel
    let jailChannel = interaction.options.getChannel('channel') || null;
    if (jailChannel) {
      jailChannel = await guild.channels.fetch(jailChannel.id).catch(() => null);
      if (!jailChannel) return interaction.editReply('❌ Could not find that channel.');
    } else {
      jailChannel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === 'jail') || null;
      if (!jailChannel) {
        try {
          jailChannel = await guild.channels.create({
            name: 'jail',
            type: ChannelType.GuildText,
            topic: '🔒 Jailed users can only see this channel. Wait for staff.',
            reason: 'Saviour jail setup',
          });
        } catch (e) {
          return interaction.editReply('❌ Could not create #jail. I need Manage Channels.');
        }
      }
    }

    // 3. Jail channel perms: NOBODY sees it except Jailed + staff/bot. Jailed can read+talk, can't invite.
    try {
      await jailChannel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }).catch(() => {});
      await jailChannel.permissionOverwrites.edit(jailedRole, {
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
        AttachFiles: false, AddReactions: true, CreateInstantInvite: false,
      }).catch(() => {});
      await jailChannel.permissionOverwrites.edit(me, {
        ViewChannel: true, SendMessages: true, ManageChannels: true, ManageMessages: true,
      }).catch(() => {});
    } catch {}

    // 4. Hide EVERY other channel/category from Jailed
    let locked = 0, failed = 0;
    try {
      const channels = await guild.channels.fetch();
      for (const [, ch] of channels) {
        try {
          if (!ch || ch.id === jailChannel.id) continue;
          if (ch.isDMBased?.()) continue;
          await ch.permissionOverwrites.edit(jailedRole, { ViewChannel: false }).catch(() => { throw new Error(); });
          locked++;
        } catch { failed++; }
      }
    } catch {}

    security.setJail(guild.id, { roleId: jailedRole.id, channelId: jailChannel.id, jailed: security.getJailed(guild.id) });

    const embed = new EmbedBuilder()
      .setTitle('🔒 Jail ready')
      .setDescription(
        `**Role:** ${jailedRole}\n**Channel:** ${jailChannel} (only jailed users + staff can see it)\n` +
        `🔒 Hid **${locked}** other channels/categories from Jailed${failed ? ` (${failed} skipped)` : ''}.\n\n` +
        `Use \`/jail @user [reason]\` to lock someone in, \`/unjail @user\` to release.\n` +
        `⚠️ Keep my role **above Jailed** and above member roles or jailing will fail.`
      )
      .setColor(0x57f287)
      .setTimestamp();

    try {
      await jailChannel.send('🔒 This is **jail**. Jailed members can only see this channel.\nStaff: use `/unjail @user` to release someone.').catch(() => {});
    } catch {}
    await interaction.editReply({ embeds: [embed] });
  },
};

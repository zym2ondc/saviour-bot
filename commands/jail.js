const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const security = require('../lib/securityConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('jail')
    .setDescription('Lock a user so they can ONLY see the jail channel')
    .addUserOption(o => o.setName('user').setDescription('User to jail').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Why are they being jailed?').setRequired(false))
    .addIntegerOption(o => o.setName('minutes').setDescription('Auto-release after X minutes (0 = forever)').setMinValue(0).setMaxValue(10080).setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason given';
    const minutes = interaction.options.getInteger('minutes') || 0;

    const jail = security.getJail(guild.id);
    if (!jail?.roleId || !jail?.channelId) {
      return interaction.editReply('❌ Jail is not set up yet. Run `/setupjail` first.');
    }
    const jailedRole = await guild.roles.fetch(jail.roleId).catch(() => null);
    const jailChannel = await guild.channels.fetch(jail.channelId).catch(() => null);
    if (!jailedRole || !jailChannel) {
      return interaction.editReply('❌ Jail role/channel was deleted. Run `/setupjail` again.');
    }

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) return interaction.editReply('❌ That user is not in this server.');
    if (member.id === guild.ownerId) return interaction.editReply('❌ You cannot jail the server owner.');
    if (member.id === guild.client.user.id) return interaction.editReply('❌ I cannot jail myself.');
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply('❌ You cannot jail an administrator (remove their admin first).');
    }
    if (!member.manageable) {
      return interaction.editReply('❌ I cannot jail them — my role must be **above** their highest role and above Jailed.');
    }
    if (member.roles.cache.has(jailedRole.id)) {
      return interaction.editReply(`⚠️ ${targetUser.tag} is already jailed in ${jailChannel}.`);
    }

    // Save their roles so /unjail can restore them
    const rolesToSave = member.roles.cache
      .filter(r => r.id !== guild.id && r.id !== jailedRole.id && !r.managed && r.position < guild.members.me.roles.highest.position)
      .map(r => r.id);

    try {
      if (rolesToSave.length) await member.roles.remove(rolesToSave, `Jailed by ${interaction.user.tag}: ${reason}`).catch(() => {});
      await member.roles.add(jailedRole, `Jailed by ${interaction.user.tag}: ${reason}`);
      // No timeout — the Jailed role itself restricts them to the jail channel only.
    } catch (e) {
      return interaction.editReply(`❌ Jailing failed: ${e.message}`);
    }

    const expiresAt = minutes > 0 ? Date.now() + minutes * 60 * 1000 : null;
    security.addJailed(guild.id, member.id, {
      reason, jailedAt: Date.now(), jailedBy: interaction.user.id,
      roles: rolesToSave, expiresAt,
    });

    if (expiresAt) {
      setTimeout(async () => {
        try {
          const still = security.getJailed(guild.id)[member.id];
          if (!still) return;
          // Clear record first so enforcement doesn't re-add the role mid-release
          security.removeJailed(guild.id, member.id);
          const g = await interaction.client.guilds.fetch(guild.id).catch(() => null);
          if (!g) return;
          const m = await g.members.fetch(member.id).catch(() => null);
          const j = security.getJail(g.id);
          const role = j ? await g.roles.fetch(j.roleId).catch(() => null) : null;
          if (m && role && m.roles.cache.has(role.id)) {
            await m.roles.remove(role, 'Jail expired').catch(() => {});
            if (still.roles?.length) await m.roles.add(still.roles.filter(id => g.roles.cache.has(id)), 'Jail expired: restore').catch(() => {});
          }
          const ch = j ? await g.channels.fetch(j.channelId).catch(() => null) : null;
          if (ch?.isTextBased?.()) ch.send(`🔓 <@${member.id}> jail time expired — released.`).catch(() => {});
        } catch {}
      }, minutes * 60 * 1000).unref?.();
    }

    try {
      await jailChannel.send(`🔒 ${member} was jailed by ${interaction.user} — **${reason}**${minutes ? ` (auto-release in ${minutes}m)` : ''}.`).catch(() => {});
    } catch {}

    const embed = new EmbedBuilder()
      .setTitle('🔒 User jailed')
      .setDescription(`${member} (${targetUser.tag}) can now **only** see ${jailChannel}.\n**Reason:** ${reason}${minutes ? `\n**Auto-release:** in ${minutes} minute(s)` : '\n**Release:** `/unjail @user`'}`)
      .setColor(0xed4245)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};

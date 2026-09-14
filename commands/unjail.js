const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const security = require('../lib/securityConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unjail')
    .setDescription('Release a user from jail and restore their roles')
    .addUserOption(o => o.setName('user').setDescription('User to release').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    const targetUser = interaction.options.getUser('user');

    const jail = security.getJail(guild.id);
    if (!jail?.roleId) return interaction.editReply('❌ Jail is not set up yet. Run `/setupjail` first.');
    const jailedRole = await guild.roles.fetch(jail.roleId).catch(() => null);

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      // They left: just clear DB so a rejoin doesn't re-jail wrongly... actually keep it cleared
      security.removeJailed(guild.id, targetUser.id);
      return interaction.editReply('⚠️ They already left the server. Cleared their jail record.');
    }

    const record = security.getJailed(guild.id)[member.id] || null;

    // Delete the jail record FIRST — otherwise the jail-enforcement listener
    // sees the Jailed role vanish while they're still listed as jailed
    // and puts it straight back on them.
    security.removeJailed(guild.id, member.id);

    try {
      if (jailedRole && member.roles.cache.has(jailedRole.id)) {
        await member.roles.remove(jailedRole, `Unjailed by ${interaction.user.tag}`);
      }
      if (member.moderatable) await member.timeout(null, 'Unjailed').catch(() => {});
      // Restore saved roles (only ones that still exist + below bot)
      if (record?.roles?.length) {
        const restorable = record.roles.filter(id => guild.roles.cache.has(id) && guild.roles.cache.get(id).position < guild.members.me.roles.highest.position);
        if (restorable.length) await member.roles.add(restorable, 'Unjail: restore previous roles').catch(() => {});
      }
    } catch (e) {
      return interaction.editReply(`❌ Unjail failed: ${e.message}\n(My role must be above Jailed and I need Manage Roles.)`);
    }

    const embed = new EmbedBuilder()
      .setTitle('🔓 User released')
      .setDescription(`${member} (${targetUser.tag}) is out of jail${record?.roles?.length ? ' — previous roles restored' : ''}.`)
      .setColor(0x57f287)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};

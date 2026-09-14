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

    let restored = 0;
    const notRestored = [];

    try {
      if (jailedRole && member.roles.cache.has(jailedRole.id)) {
        await member.roles.remove(jailedRole, `Unjailed by ${interaction.user.tag}`);
      }
      // Restore EVERY saved role that still exists, one by one so a single
      // high role doesn't block the rest.
      if (record?.roles?.length) {
        for (const id of record.roles) {
          if (!guild.roles.cache.has(id)) continue; // role was deleted
          try { await member.roles.add(id, 'Unjail: restore previous roles'); restored++; }
          catch { notRestored.push(`<@&${id}>`); }
        }
      }
    } catch (e) {
      return interaction.editReply(`❌ Unjail failed: ${e.message}\n(My role must be above Jailed and I need Manage Roles.)`);
    }

    const embed = new EmbedBuilder()
      .setTitle('🔓 User released')
      .setDescription(
        `${member} (${targetUser.tag}) is out of jail.` +
        (record?.roles?.length ? `\n**Roles restored:** ${restored}/${record.roles.length}` : '') +
        (notRestored.length ? `\n⚠️ Couldn't restore ${notRestored.length} role(s) — my role must be **above** them, re-add manually: ${notRestored.join(', ')}` : '')
      )
      .setColor(0x57f287)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};

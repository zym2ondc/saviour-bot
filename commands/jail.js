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
    if (member.id === guild.ownerId) return interaction.editReply('❌ You cannot jail the server owner (Discord forbids it).');
    if (member.id === guild.client.user.id) return interaction.editReply('❌ I cannot jail myself.');
    if (member.id === interaction.user.id) return interaction.editReply('❌ You cannot jail yourself — you would lock yourself in with no admin powers left.');
    if (member.roles.cache.has(jailedRole.id)) {
      return interaction.editReply(`⚠️ ${targetUser.tag} is already jailed in ${jailChannel}.`);
    }
    if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.editReply('❌ I need the **Manage Roles** permission.');
    }

    // Save + strip EVERY role they have (except @everyone, Jailed, and managed
    // integration roles which Discord won't let anyone remove). No admin bypass,
    // no hierarchy filter — we attempt all of them and report what stuck.
    const rolesToSave = member.roles.cache
      .filter(r => r.id !== guild.id && r.id !== jailedRole.id && !r.managed)
      .map(r => r.id);

    const audit = `Jailed by ${interaction.user.tag}: ${reason}`;
    const stripped = [];
    const failed = [];
    if (rolesToSave.length) {
      try {
        await member.roles.remove(rolesToSave, audit);
        stripped.push(...rolesToSave);
      } catch {
        // Bulk failed (usually one role above the bot) — do them one by one
        // so a single high role doesn't protect the rest.
        for (const rid of rolesToSave) {
          try { await member.roles.remove(rid, audit); stripped.push(rid); }
          catch { failed.push(rid); }
        }
      }
    }
    try {
      await member.roles.add(jailedRole, audit);
      // No timeout — the Jailed role itself restricts them to the jail channel only.
    } catch (e) {
      return interaction.editReply(`❌ Could not add the Jailed role: ${e.message}\nPut my role **above Jailed** in Server Settings → Roles.`);
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
            if (still.roles?.length) {
              for (const id of still.roles) {
                if (!g.roles.cache.has(id)) continue;
                await m.roles.add(id, 'Jail expired: restore').catch(() => {});
              }
            }
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
      .setDescription(
        `${member} (${targetUser.tag}) can now **only** see ${jailChannel}.\n` +
        `**Reason:** ${reason}${minutes ? `\n**Auto-release:** in ${minutes} minute(s)` : '\n**Release:** `/unjail @user`'}` +
        `\n**Roles stripped:** ${stripped.length}/${rolesToSave.length}` +
        (failed.length ? `\n⚠️ Couldn't remove ${failed.length} role(s) — my role must be **above** them: ${failed.map(id => `<@&${id}>`).join(', ')}` : '')
      )
      .setColor(0xed4245)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};

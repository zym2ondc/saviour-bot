const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlock a locked channel so people can type again')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel to unlock (defaults to current)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    const me = interaction.guild.members.me;
    if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply('❌ I need **Manage Channels** in that channel.');
    }

    try {
      // null = back to inherit (normal), instead of forced allow
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
      await interaction.editReply(`🔓 Unlocked ${channel} — people can type there again.`);
    } catch (e) {
      console.error('unlock failed:', e.message);
      await interaction.editReply('❌ Could not unlock that channel. Check my permissions.');
    }
  },
};

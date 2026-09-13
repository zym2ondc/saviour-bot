const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock a channel so no one can type in it')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel to lock (defaults to current)')
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
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
      await interaction.editReply(`🔒 Locked ${channel} — no one can type there now. Use \`/unlock\` to open it.`);
    } catch (e) {
      console.error('lock failed:', e.message);
      await interaction.editReply('❌ Could not lock that channel. Check my role is above @everyone and I have Manage Channels.');
    }
  },
};

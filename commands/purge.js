const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete recent messages in a channel')
    .addIntegerOption(o =>
      o.setName('amount')
        .setDescription('How many messages to delete (1-100)')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true))
    .addUserOption(o =>
      o.setName('user')
        .setDescription('Only delete messages from this user (optional)')
        .setRequired(false))
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel to purge (defaults to current)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const amount = interaction.options.getInteger('amount');
    const targetUser = interaction.options.getUser('user') || null;
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    if (!channel.isTextBased?.()) {
      return interaction.editReply('❌ That channel is not a text channel.');
    }

    // Bot needs perms in target channel
    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.ManageMessages) || !perms?.has(PermissionFlagsBits.ReadMessageHistory)) {
      return interaction.editReply('❌ I need **Manage Messages** + **Read Message History** in that channel.');
    }

    try {
      const fetched = await channel.messages.fetch({ limit: amount });
      let msgs = [...fetched.values()];
      if (targetUser) msgs = msgs.filter(m => m.author.id === targetUser.id);
      if (!msgs.length) return interaction.editReply('Nothing to delete.');

      // true = skip messages older than 14 days (Discord won't bulk-delete those)
      const deleted = await channel.bulkDelete(msgs, true);
      await interaction.editReply(`🧹 Deleted **${deleted.size}** message${deleted.size === 1 ? '' : 's'} in ${channel}${targetUser ? ` from ${targetUser.tag}` : ''}.`);
    } catch (e) {
      console.error('purge failed:', e.message);
      await interaction.editReply('❌ Purge failed. Messages older than 14 days must be deleted manually.');
    }
  },
};

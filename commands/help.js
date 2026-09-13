const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List all Saviour bot commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('SAVIOUR BOT — Help')
      .setDescription('/ticketsetup [#channel] — Post the SAVIOUR TICKETS panel\n/verifysetup [#channel] — Post verification + lock other channels for Unverified\n/restore — Add all verified users to THIS server\n/verifiedcount — How many verified\n/purge <amount> [@user] [#channel] — Delete recent messages\n/lock [#channel] — No one can type there\n/unlock [#channel] — Open it back up\n/help — Show this message')
      .setColor(0x5865f2)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

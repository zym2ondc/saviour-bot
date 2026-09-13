const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const store = require('../lib/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verifiedcount')
    .setDescription('Show how many users have verified')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const all = store.loadAll();
    const ids = Object.keys(all);
    const embed = new EmbedBuilder()
      .setTitle('Verified users')
      .setDescription(`Total verified: **${ids.length}**`)
      .setColor(0x57f287)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

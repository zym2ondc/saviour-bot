const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const keys = require('../lib/keys');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('keystock')
    .setDescription('Show how many saviour.win keys are left (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const db = keys.load();
    const embed = new EmbedBuilder()
      .setTitle('KEY STOCK')
      .setDescription(`Available (unclaimed): **${db.available.length}**\nClaimed total: **${Object.keys(db.claimed).length}**`)
      .setColor(0x5865f2)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

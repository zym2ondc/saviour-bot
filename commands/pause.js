const { SlashCommandBuilder } = require('discord.js');
const music = require('../lib/music');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current song'),
  async execute(interaction) {
    const ok = music.pause(interaction.guildId);
    await interaction.reply({
      content: ok ? '⏸️ Paused. Use `/resume` to keep playing.' : '❌ Nothing is playing right now.',
      ephemeral: true,
    });
  },
};

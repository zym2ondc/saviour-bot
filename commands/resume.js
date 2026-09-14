const { SlashCommandBuilder } = require('discord.js');
const music = require('../lib/music');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume (play) the paused song'),
  async execute(interaction) {
    const ok = music.resume(interaction.guildId);
    await interaction.reply({
      content: ok ? '▶️ Resumed!' : '❌ Nothing is paused right now. Use `/play <link>` first.',
      ephemeral: true,
    });
  },
};

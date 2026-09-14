const { SlashCommandBuilder } = require('discord.js');
const music = require('../lib/music');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Disconnect the bot from voice and clear the queue'),
  async execute(interaction) {
    const ok = music.disconnect(interaction.guildId);
    await interaction.reply({
      content: ok ? '👋 Disconnected and cleared the queue.' : '❌ I\'m not in a voice channel.',
      ephemeral: true,
    });
  },
};

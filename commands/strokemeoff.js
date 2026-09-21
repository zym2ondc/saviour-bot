const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// ONLY these two Discord user IDs can ever see/use this command
const ALLOWED_IDS = new Set(['234770541716832257', '1521439381838233610']);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('strokemeoff')
    .setDescription('...'),
  async execute(interaction) {
    if (!ALLOWED_IDS.has(interaction.user.id)) {
      return interaction.reply({ content: '❌ nah.', ephemeral: true });
    }
    const embed = new EmbedBuilder()
      .setTitle('STROKED ✅')
      .setDescription(`<@${interaction.user.id}> got stroked off. squeak.`)
      .setColor(0xff69b4)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

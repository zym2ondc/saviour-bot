const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// SAVIOUR server: + role gates usage, denied users get slapped with it as shame
const PLUS_ROLE_ID = '1551730442955137034';
const WEIRDO_ROLE_ID = '1551730442955137034';
const FREAK_GIF = 'https://media.tenor.com/onsxR4iXQh4AAAAC/freaky.gif';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('strokemeoff')
    .setDescription('...'),
  async execute(interaction) {
    const member = interaction.member;
    if (!member?.roles?.cache?.has(PLUS_ROLE_ID)) {
      try {
        await member.roles.add(WEIRDO_ROLE_ID, 'tried /strokemeoff without + role');
      } catch {}
      return interaction.reply({ content: 'weirdo role earned. squeak.', ephemeral: true });
    }
    const embed = new EmbedBuilder()
      .setTitle('STROKED ✅')
      .setDescription(`<@${interaction.user.id}> got stroked off.`)
      .setImage(FREAK_GIF)
      .setColor(0xff69b4)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};

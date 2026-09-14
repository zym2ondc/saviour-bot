const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');

const DOWNLOAD_URL = 'https://gofile.io/d/LiN4aP23';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setupdownload')
    .setDescription('Post the download loader panel')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to send the panel in (defaults to current channel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

    const embed = new EmbedBuilder()
      .setTitle('DOWNLOAD LOADER HERE')
      .setDescription(`${DOWNLOAD_URL}`)
      .setColor(0x57f287)
      .setFooter({ text: 'Saviour' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Download Loader')
        .setStyle(ButtonStyle.Link)
        .setURL(DOWNLOAD_URL)
        .setEmoji('⬇️')
    );

    try {
      await targetChannel.send({ embeds: [embed], components: [row] });
      await interaction.editReply({ content: `✅ Download panel sent in ${targetChannel}` });
    } catch (err) {
      console.error(err);
      await interaction.editReply({ content: '❌ I could not send in that channel. Check I have View + Send Messages + Embed Links there.' });
    }
  },
};

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');

const STORE_URL = 'https://blessedcheats.mysellauth.com/';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purchase')
    .setDescription('Post the purchase panel with store link')
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
      .setTitle('PURCHASE')
      .setDescription(`${STORE_URL}\n\n**PAYMENT OPTIONS**\n- PayPal\n- Litecoin/Bitcoin\n- CashApp`)
      .setColor(0x57f287)
      .setFooter({ text: 'Saviour' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Purchase')
        .setStyle(ButtonStyle.Link)
        .setURL(STORE_URL)
        .setEmoji('🛒')
    );

    try {
      await targetChannel.send({ embeds: [embed], components: [row] });
      await interaction.editReply({ content: `✅ Purchase panel sent in ${targetChannel}` });
    } catch (err) {
      console.error(err);
      await interaction.editReply({ content: '❌ I could not send in that channel. Check I have View + Send Messages + Embed Links there.' });
    }
  },
};

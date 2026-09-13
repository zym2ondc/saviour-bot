const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const ticketConfig = require('../lib/ticketConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketsetup')
    .setDescription('Setup the SAVIOUR TICKETS panel in this channel')
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
      .setTitle('SAVIOUR TICKETS')
      .setDescription('Need help? Click the button below to create a private ticket.\n\nOur staff team will assist you shortly.')
      .setColor(0x2b2d31)
      // .setThumbnail(interaction.guild.iconURL()) // uncomment if you want server icon
      .setFooter({ text: 'Saviour Support' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('create_ticket')
        .setLabel('Create Ticket')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎫')
    );

    try {
      await targetChannel.send({ embeds: [embed], components: [row] });
      // Remember this channel's category so tickets open in the same place
      ticketConfig.setGuild(interaction.guild.id, { panelChannelId: targetChannel.id, categoryId: targetChannel.parentId || null });
      await interaction.editReply({ content: `✅ Ticket panel sent in ${targetChannel}${targetChannel.parentId ? ' — new tickets will open in the same category' : ' (that channel has no category, so tickets will open at the top)'}` });
    } catch (err) {
      console.error(err);
      await interaction.editReply({ content: '❌ I could not send in that channel. Check I have View + Send Messages + Embed Links there.' });
    }
  },
};

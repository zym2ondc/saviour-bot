const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const keys = require('../lib/keys');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('keyadd')
    .setDescription('Stock saviour.win keys (admin only, single or bulk)')
    .addStringOption(o =>
      o.setName('keys')
        .setDescription('One key, or MANY keys separated by spaces/commas/newlines')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const raw = interaction.options.getString('keys', true);
    // split on whitespace, commas, newlines — paste a whole list at once
    const list = raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    if (!list.length) {
      await interaction.reply({ content: '❌ No keys found in that input.', ephemeral: true });
      return;
    }
    const res = keys.addMany(list);
    const embed = new EmbedBuilder()
      .setTitle('KEYS STOCKED')
      .setDescription(`Added: **${res.added}**${res.dups ? `\nSkipped duplicates: **${res.dups}**` : ''}\nIn stock now: **${res.stock}**`)
      .setColor(0x57f287)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

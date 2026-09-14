const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('membercount')
    .setDescription('Show how many members are in this server (humans + bots)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;

    try {
      // Fetch all members so counts are accurate, not just cached
      const members = await guild.members.fetch();
      const total = members.size;
      let bots = 0;
      members.each(m => { if (m.user.bot) bots++; });
      const humans = total - bots;

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${guild.name} — Member Count`)
        .setDescription(`**Total:** ${total}\n👤 **Humans:** ${humans}\n🤖 **Bots:** ${bots}`)
        .setColor(0x5865f2)
        .setThumbnail(guild.iconURL() || null)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (e) {
      console.error('membercount failed:', e.message);
      // Fallback to Discord's approximate count (no fetch needed)
      await interaction.editReply(`📊 **${guild.name}** has roughly **${guild.memberCount}** members. (Enable Server Members Intent for exact human/bot split.)`);
    }
  },
};

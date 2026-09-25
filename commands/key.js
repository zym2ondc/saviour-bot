const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const keys = require('../lib/keys');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('key')
    .setDescription('Get your saviour.win key (one-time, single-use)'),
  // NOTE: no setDefaultMemberPermissions on purpose — everyone can use /key.
  // index.js has a PUBLIC_COMMANDS bypass so the owner-only gate skips this command.
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // One key per user — if they already claimed, reshow theirs instead of burning a new one
    const prev = keys.alreadyClaimed(interaction.user.id);
    if (prev) {
      const embed = new EmbedBuilder()
        .setTitle('SAVIOUR.WIN — YOUR KEY')
        .setDescription(`You already claimed a key. Same one, no new key burned.\n\n\`\`\`${prev.key}\`\`\`\nClaimed: <t:${Math.floor(new Date(prev.claimedAt).getTime() / 1000)}:R>`)
        .setColor(0xf59e0b)
        .setFooter({ text: 'Saviour — do not share your key' })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      // best-effort DM as well
      await interaction.user.send({ embeds: [embed] }).catch(() => {});
      return;
    }

    const res = keys.claim(interaction.user.id);
    if (!res.ok) {
      await interaction.editReply('❌ Out of keys right now. Make a ticket and staff will restock soon.');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('SAVIOUR.WIN — YOUR KEY')
      .setDescription(`Here is your one-time key. It has been **removed from stock** and can never be given to anyone else.\n\n\`\`\`${res.key}\`\`\`\nRedeem it in **saviour.win**.\n\nKeys left after you: **${res.remaining}**`)
      .setColor(0x57f287)
      .setFooter({ text: 'Saviour — do not share your key' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    // best-effort DM backup (fails silently if DMs closed — ephemeral reply above is the real delivery)
    await interaction.user.send({ embeds: [embed] }).catch(() => {});
  },
};

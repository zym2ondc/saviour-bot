const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List all Saviour bot commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('SAVIOUR BOT — Help')
      .setDescription('/ticketsetup [#channel] — Post the SAVIOUR TICKETS panel\n/purchase [#channel] — Post the purchase panel\n/setupdownload [#channel] — Post the DOWNLOAD LOADER HERE panel\n/verifysetup [#channel] — Post verification + lock other channels for Unverified\n/restore — Add all verified users to THIS server\n/verifiedcount — How many verified\n/purge <amount> [@user] [#channel] — Delete recent messages\n/lock [#channel] — No one can type there\n/unlock [#channel] — Open it back up\n/setupantiraid [options] — Anti-raid + anti-nuke (join burst, spam, mass ban/delete) — `status` to view\n/setupjail [#channel] — Create Jailed role + #jail channel\n/jail @user [reason] [minutes] — Lock user to ONLY the jail channel\n/unjail @user — Release + restore roles\n/membercount — Total / humans / bots\n/play <link or search> — Join YOUR vc + play (stays until /disconnect)\n/pause — Pause the song\n/resume — Play/resume the paused song\n/disconnect — Leave vc + clear queue\n/help — Show this message')
      .setColor(0x5865f2)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

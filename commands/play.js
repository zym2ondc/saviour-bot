const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const music = require('../lib/music');

module.exports = {
  // No setDefaultMemberPermissions -> everyone can use it (see index.js MUSIC_COMMANDS bypass)
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Join your voice channel and play a song (stays until /disconnect)')
    .addStringOption(o =>
      o.setName('query')
        .setDescription('YouTube/SoundCloud link or search terms')
        .setRequired(true)),
  async execute(interaction) {
    const vc = interaction.member?.voice?.channel;
    if (!vc) return interaction.reply({ content: '❌ Join a voice channel first, then use `/play`.', ephemeral: true });

    const me = interaction.guild.members.me;
    const perms = vc.permissionsFor(me);
    if (!perms?.has('Connect') || !perms?.has('Speak')) {
      return interaction.reply({ content: `❌ I need **Connect** + **Speak** in ${vc}.`, ephemeral: true });
    }

    const query = interaction.options.getString('query', true);
    await interaction.deferReply();

    try {
      const res = await music.enqueue(interaction.guild, vc, query, interaction.user.tag, interaction.channelId);
      if (res.started) {
        const e = new EmbedBuilder()
          .setTitle(res.queued > 0 ? `▶️ Now playing (+${res.queued} queued)` : '▶️ Now playing')
          .setDescription(`**[${res.started.title}](${res.started.url})**\n\`${res.started.duration}\` • requested by ${interaction.user}`)
          .setColor(0x57f287)
          .setFooter({ text: `Staying in ${vc.name} until /disconnect` });
        if (res.started.thumbnail) e.setThumbnail(res.started.thumbnail);
        await interaction.editReply({ embeds: [e] });
      } else {
        await interaction.editReply(`✅ Queued **${res.queued}** track${res.queued === 1 ? '' : 's'} at position #${res.position}. I'm staying in ${vc} until \`/disconnect\`.`);
      }
    } catch (err) {
      console.error('play failed:', err.message);
      let msg = '❌ Could not play that. Try a different link/search.';
      if (/Sign in to confirm|bot/i.test(err.message)) msg += '\n(YouTube is blocking the server — owner: set `YT_COOKIE` in `.env`.)';
      else if (/Spotify|SoundCloud/i.test(err.message)) msg = `❌ ${err.message}`;
      await interaction.editReply(msg).catch(() => {});
    }
  },
};

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const store = require('../lib/store');
const { refreshAccessToken, addMemberToGuild } = require('../lib/oauth');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getValidAccessToken(userId, record) {
  // refresh if expiring in <60s or missing
  if (record.access_token && record.expires_at && Date.now() < record.expires_at - 60000) {
    return record.access_token;
  }
  if (!record.refresh_token) throw new Error('no refresh_token');
  const fresh = await refreshAccessToken(record.refresh_token);
  const updated = {
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token || record.refresh_token,
    expires_at: Date.now() + (fresh.expires_in * 1000),
  };
  store.saveUser(userId, updated);
  return updated.access_token;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restore')
    .setDescription('Add all verified users back to THIS server (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    const botToken = process.env.DISCORD_TOKEN;
    const all = store.loadAll();
    const ids = Object.keys(all);

    if (!ids.length) {
      return interaction.editReply('No verified users saved yet. Have members click **Verify** first.');
    }

    await interaction.editReply(`🔄 Restoring ${ids.length} verified users to **${guild.name}**... (this can take a while due to rate limits)`);

    let added = 0, already = 0, failed = 0;
    const failures = [];

    for (const userId of ids) {
      const rec = all[userId];
      try {
        const accessToken = await getValidAccessToken(userId, rec);
        const result = await addMemberToGuild(guild.id, userId, accessToken, botToken);

        if (result.ok && result.added) added++;
        else if (result.ok && result.alreadyHere) already++;
        else if (result.rateLimited) {
          console.warn(`Rate limited, sleeping ${result.retryAfter}s`);
          await sleep((result.retryAfter + 1) * 1000);
          // retry once
          const retry = await addMemberToGuild(guild.id, userId, accessToken, botToken);
          if (retry.ok && retry.added) added++;
          else if (retry.ok) already++;
          else { failed++; failures.push(`${userId} (${retry.status})`); }
        } else {
          failed++;
          if (failures.length < 20) failures.push(`${rec.username || userId} (${result.status})`);
        }
      } catch (e) {
        failed++;
        console.warn(`restore ${userId} failed:`, e.message);
        if (failures.length < 20) failures.push(`${rec.username || userId} (token)`);
      }
      await sleep(800); // be gentle with rate limits
    }

    const embed = new EmbedBuilder()
      .setTitle('Restore complete')
      .setDescription(`Server: **${guild.name}**\n\n✅ Added: **${added}**\n➖ Already here: **${already}**\n❌ Failed: **${failed}**\n\nTotal verified in DB: ${ids.length}`)
      .setColor(0x5865f2)
      .setTimestamp();

    if (failures.length) embed.addFields({ name: 'Some failures', value: failures.join('\n').slice(0, 1000) });

    await interaction.editReply({ embeds: [embed] });
  },
};

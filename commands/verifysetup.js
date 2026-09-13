const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verifysetup')
    .setDescription('Post the verification panel with a Verify button')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel to post in (defaults to current)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getChannel('channel') || interaction.channel;
    const guild = interaction.guild;

    // Auto-create Verified / Unverified roles if missing
    let verifiedRole = guild.roles.cache.find(r => r.name === 'Verified') || null;
    let unverifiedRole = guild.roles.cache.find(r => r.name === 'Unverified') || null;
    const created = [];
    try {
      if (!verifiedRole) {
        verifiedRole = await guild.roles.create({
          name: 'Verified',
          color: 0x57f287,
          reason: 'Saviour verify setup',
        });
        created.push('Verified');
      }
      if (!unverifiedRole) {
        unverifiedRole = await guild.roles.create({
          name: 'Unverified',
          color: 0x808080,
          reason: 'Saviour verify setup',
        });
        created.push('Unverified');
      }
    } catch (e) {
      console.error('role create failed:', e.message);
      await interaction.editReply('❌ I need **Manage Roles** permission (and my role must be above Verified/Unverified).');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('SAVIOUR VERIFICATION')
      .setDescription('Click **Verify** below to verify.\n\nYou will be asked to authorize with **"Join servers for you"** so we can restore your access if we ever have to rebuild the server.')
      .setColor(0x57f287)
      .setFooter({ text: 'Saviour Security' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify_start')
        .setLabel('Verify')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅')
    );

    // Lock every other channel/category for Unverified, keep verify channel open
    let locked = 0, lockFailed = 0;
    try {
      // Verify channel stays visible + usable for everyone
      await target.permissionOverwrites.edit(unverifiedRole, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      }).catch(() => { lockFailed++; });
      await target.permissionOverwrites.edit(guild.roles.everyone, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      }).catch(() => {});

      const skipCategoryId = target.parentId || null;
      const channels = await guild.channels.fetch();
      for (const [, ch] of channels) {
        if (!ch || ch.id === target.id) continue;
        if (ch.isDMBased?.()) continue;
        // Skip the verify channel's category so the verify channel stays reachable;
        // sibling channels still get locked individually below.
        if (ch.type === ChannelType.GuildCategory && ch.id === skipCategoryId) continue;
        try {
          await ch.permissionOverwrites.edit(unverifiedRole, { ViewChannel: false });
          locked++;
        } catch {
          lockFailed++;
        }
      }
    } catch (e) {
      console.error('lockdown failed:', e.message);
    }

    try {
      await target.send({ embeds: [embed], components: [row] });
      const roleMsg = created.length ? `\nCreated roles: ${created.join(', ')}` : `\nRoles ready: Verified + Unverified`;
      await interaction.editReply(`✅ Verify panel sent in ${target}.${roleMsg}\n🔒 Locked ${locked} other channels/categories for Unverified${lockFailed ? ` (${lockFailed} skipped — check my permissions)` : ''}. Only ${target} stays visible until they verify.`);
    } catch (e) {
      console.error(e);
      await interaction.editReply('❌ Could not send there. Check View + Send Messages + Embed Links.');
    }
  },
};

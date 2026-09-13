require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  Collection,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

const { buildVerifyUrl } = require('./lib/oauth');
const { startAuthServer } = require('./server');
const store = require('./lib/store');
const ticketConfig = require('./lib/ticketConfig');

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ Missing DISCORD_TOKEN in .env (copy .env.example to .env and fill it)');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Load slash commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const cmd = require(path.join(commandsPath, file));
    client.commands.set(cmd.data.name, cmd);
  }
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    startAuthServer(client);
  } catch (e) {
    console.error('Auth server failed to start:', e.message);
  }
});

// Auto-lock newly created channels for Unverified (except ticket channels, which manage their own perms)
client.on('channelCreate', async (channel) => {
  try {
    if (!channel.guild || channel.isDMBased?.()) return;
    if (channel.name.startsWith('ticket-')) return;
    const guild = channel.guild;
    const unverified = guild.roles.cache.find(r => r.name === (process.env.UNVERIFIED_ROLE_NAME || 'Unverified'));
    if (!unverified) return;
    await channel.permissionOverwrites.edit(unverified, { ViewChannel: false }).catch(() => {});
  } catch {}
});

client.on('interactionCreate', async (interaction) => {
  try {
    // --- Slash commands ---
    if (interaction.isChatInputCommand()) {
      // Admin-only bot: block every slash command for non-administrators
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Only administrators can use this bot.', ephemeral: true }).catch(() => {});
      }
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) {
        return interaction.reply({ content: `❌ Unknown command \`/${interaction.commandName}\`. Try \`/ticketsetup\`, \`/verifysetup\`, \`/restore\` or \`/help\`.`, ephemeral: true }).catch(() => {});
      }
      await cmd.execute(interaction);
      return;
    }

    // --- Buttons ---
    if (!interaction.isButton()) return;

    // VERIFY START
    if (interaction.customId === 'verify_start') {
      const existing = store.getUser(interaction.user.id);
      if (existing?.access_token) {
        return interaction.reply({ content: '✅ You are already verified!', ephemeral: true });
      }
      if (!process.env.CLIENT_SECRET) {
        return interaction.reply({ content: '❌ Verify is not configured yet (owner: set CLIENT_SECRET in .env).', ephemeral: true });
      }
      const url = buildVerifyUrl(interaction.user.id, interaction.guildId);
      const embed = new EmbedBuilder()
        .setTitle('SAVIOUR VERIFICATION')
        .setDescription('Click **Authorize** below.\n\nDiscord will ask:\n• See what servers you\'re in\n• Join servers for you\n\nClick **Authorize** there and you\'re verified — that\'s what lets `/restore` add you back if we rebuild.')
        .setColor(0x57f287);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Authorize')
          .setStyle(ButtonStyle.Link)
          .setURL(url)
          .setEmoji('🔗')
      );
      return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    // CREATE TICKET
    if (interaction.customId === 'create_ticket') {
      const guild = interaction.guild;
      const user = interaction.user;

      // Prevent duplicate tickets (one open ticket per user)
      const existing = guild.channels.cache.find(
        c => c.type === ChannelType.GuildText && c.name === `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`
      );
      if (existing) {
        return interaction.reply({ content: `⚠️ You already have an open ticket: ${existing}`, ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const staffRoleId = process.env.TICKET_STAFF_ROLE_ID || null;
      // Same category as the ticket panel (set by /ticketsetup), else env override, else top
      let categoryId = process.env.TICKET_CATEGORY_ID || null;
      const savedCategory = ticketConfig.getGuild(guild.id)?.categoryId || null;
      if (savedCategory && guild.channels.cache.has(savedCategory)) categoryId = savedCategory;

      const permissionOverwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
        },
        {
          id: guild.members.me.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
        },
      ];
      if (staffRoleId) {
        permissionOverwrites.push({
          id: staffRoleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
      }

      const channelName = `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`;

      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: categoryId || null,
        topic: `Ticket for ${user.tag} (${user.id})`,
        permissionOverwrites,
      });

      const ticketEmbed = new EmbedBuilder()
        .setTitle('SAVIOUR TICKETS')
        .setDescription(`Hey ${user}, thanks for creating a ticket!\nDescribe your issue and staff will be with you shortly.`)
        .setColor(0x5865f2)
        .setTimestamp();

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('Close Ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒')
      );

      await ticketChannel.send({ content: `${user} ${staffRoleId ? `<@&${staffRoleId}>` : ''}`, embeds: [ticketEmbed], components: [closeRow] });
      await interaction.editReply({ content: `✅ Ticket created: ${ticketChannel}` });

      const logId = process.env.TICKET_LOG_CHANNEL_ID;
      if (logId) {
        const log = guild.channels.cache.get(logId);
        if (log) log.send(`🎫 ${user.tag} opened ${ticketChannel}`).catch(() => {});
      }
      return;
    }

    // CLOSE TICKET
    if (interaction.customId === 'close_ticket') {
      if (!interaction.channel.name.startsWith('ticket-')) {
        return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
      }
      await interaction.reply('🔒 Closing ticket in 5 seconds...');
      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 5000);

      const logId = process.env.TICKET_LOG_CHANNEL_ID;
      if (logId) {
        const log = interaction.guild.channels.cache.get(logId);
        if (log) log.send(`🔒 ${interaction.user.tag} closed ${interaction.channel.name}`).catch(() => {});
      }
      return;
    }
  } catch (err) {
    console.error(err);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: '❌ Something went wrong.', ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: '❌ Something went wrong.', ephemeral: true }).catch(() => {});
    }
  }
});

client.login(token);

require('dotenv').config();
console.log(`🚀 Booting saviour-bot | node ${process.version} | cwd=${process.cwd()} | PORT=${process.env.PORT || '3000'}`);
process.on('unhandledRejection', (e) => console.error('⚠️ unhandledRejection:', e?.message || e));
process.on('uncaughtException', (e) => console.error('💥 uncaughtException:', e?.message || e));
const fs = require('node:fs');
const path = require('node:path');
// Proxy first: must be set before the Discord client / any fetch runs.
const proxy = require('./lib/proxy').applyProxy();
function safeRequire(name) {
  try {
    const m = require(name);
    console.log(`📦 loaded ${name} ✅`);
    return m;
  } catch (e) {
    console.error(`💥 failed to load ${name}: ${e?.message || e}`);
    console.error(e?.stack || e);
    process.exit(1);
  }
}
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
} = safeRequire('discord.js');

const { buildVerifyUrl } = safeRequire('./lib/oauth');
const { startAuthServer } = safeRequire('./server');
const store = safeRequire('./lib/store');
const ticketConfig = safeRequire('./lib/ticketConfig');
const security = safeRequire('./lib/securityConfig');
const antiRaid = safeRequire('./lib/antiRaid');
const { AuditLogEvent } = safeRequire('discord.js');

const token = process.env.DISCORD_TOKEN;
console.log(`🔑 DISCORD_TOKEN ${token ? `present (len=${token.length})` : 'MISSING'} | CLIENT_ID=${process.env.CLIENT_ID ? 'present' : 'missing'} | CLIENT_SECRET=${process.env.CLIENT_SECRET ? 'present' : 'missing'}`);
if (!token) {
  console.error('❌ Missing DISCORD_TOKEN in .env (copy .env.example to .env and fill it)');
  process.exit(1);
}

// ---- Owner-only lock: ONLY these Discord user IDs can use the bot ----
const ALLOWED_USER_IDS = new Set(
  (process.env.OWNER_IDS || '1521439381838233610,1523272880043855925')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildVoiceStates,
  ],
  // Route Discord REST through the proxy when one is configured
  ...(proxy ? { rest: { agent: proxy.restAgent } } : {}),
});

// Load slash commands (one broken command must not kill the whole bot)
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    try {
      const cmd = require(path.join(commandsPath, file));
      client.commands.set(cmd.data.name, cmd);
      console.log(`⌨️ loaded command /${cmd.data.name} ✅`);
    } catch (e) {
      console.error(`⚠️ skipped command ${file}: ${e?.message || e}`);
    }
  }
  console.log(`⌨️ commands ready: ${client.commands.size} loaded`);
}

console.log('🌐 testing connectivity to discord.com...');
fetch('https://discord.com/api/v10/gateway', { signal: AbortSignal.timeout(15000) })
  .then(async (r) => console.log(`🌐 discord.com reachable ✅ (http ${r.status})`))
  .catch((e) => console.error(`🌐 discord.com UNREACHABLE 💥: ${e?.message || e} — host is blocking Discord API, open a ticket with KeritCloud`));

// Start the verify web page immediately — it must stay up even while Discord login retries.
try {
  startAuthServer(client);
} catch (e) {
  console.error('Auth server failed to start:', e.message);
}

let readyOnce = false;
function onReady() {
  if (readyOnce) return;
  readyOnce = true;
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    require('./lib/mediaNotify').startMediaNotifier(client);
  } catch (e) {
    console.error('Media notifier failed to start:', e.message);
  }
  // Re-schedule jail auto-releases that survive restarts
  try {
    for (const [guildId, guildData] of Object.entries(require('./lib/securityConfig').getGuild ? (() => { try { return JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, 'data', 'security.json'), 'utf8')); } catch { return {}; } })() : {})) {
      const jailed = guildData?.jail?.jailed || {};
      for (const [userId, rec] of Object.entries(jailed)) {
        if (!rec?.expiresAt) continue;
        const ms = rec.expiresAt - Date.now();
        if (ms <= 0) continue;
        setTimeout(async () => {
          try {
            const g = await client.guilds.fetch(guildId).catch(() => null);
            if (!g) return;
            const security = require('./lib/securityConfig');
            const still = security.getJailed(guildId)[userId];
            if (!still) return;
            // Clear record first so enforcement doesn't re-add the role mid-release
            security.removeJailed(guildId, userId);
            const m = await g.members.fetch(userId).catch(() => null);
            const j = security.getJail(guildId);
            const role = j ? await g.roles.fetch(j.roleId).catch(() => null) : null;
            if (m && role && m.roles.cache.has(role.id)) {
              await m.roles.remove(role, 'Jail expired').catch(() => {});
              if (still.roles?.length) {
                for (const id of still.roles) {
                  if (!g.roles.cache.has(id)) continue;
                  await m.roles.add(id, 'Jail expired: restore').catch(() => {});
                }
              }
            }
          } catch {}
        }, ms).unref?.();
      }
    }
  } catch {}
}
client.once('ready', onReady); // discord.js v14
client.once('clientReady', onReady); // v15 forward-compat

// Give Unverified to everyone who joins (only if verify is set up — Unverified role exists)
// + anti-raid join-burst check + re-jail on rejoin
client.on('guildMemberAdd', async (member) => {
  try {
    // Re-jail: if they were jailed and left, put them straight back
    try {
      const jail = security.getJail(member.guild.id);
      if (jail?.roleId && security.getJailed(member.guild.id)[member.id]) {
        const role = await member.guild.roles.fetch(jail.roleId).catch(() => null);
        if (role) await member.roles.add(role, 'Re-join while jailed').catch(() => {});
      }
    } catch {}
    // Anti-raid join burst (skips bots internally)
    antiRaid.handleJoin(member).catch(() => {});
    if (member.user.bot) return;
    const guild = member.guild;
    let unverifiedRole = null;
    if (process.env.UNVERIFIED_ROLE_ID) {
      unverifiedRole = await guild.roles.fetch(process.env.UNVERIFIED_ROLE_ID).catch(() => null);
    }
    if (!unverifiedRole) unverifiedRole = guild.roles.cache.find(r => r.name === (process.env.UNVERIFIED_ROLE_NAME || 'Unverified')) || null;
    if (!unverifiedRole) return; // verify not set up yet — do nothing
    if (member.roles.cache.has(unverifiedRole.id)) return;
    await member.roles.add(unverifiedRole, 'Auto Unverified on join').catch(e => console.warn('unverified add failed:', e.message));
  } catch {}
});

// Auto-lock newly created channels for Unverified (except ticket channels, which manage their own perms)
// + hide new channels from Jailed + anti-nuke channel-create check
client.on('channelCreate', async (channel) => {
  try {
    if (!channel.guild || channel.isDMBased?.()) return;
    const guild = channel.guild;
    if (!channel.name.startsWith('ticket-')) {
      const unverified = guild.roles.cache.find(r => r.name === (process.env.UNVERIFIED_ROLE_NAME || 'Unverified'));
      if (unverified) await channel.permissionOverwrites.edit(unverified, { ViewChannel: false }).catch(() => {});
    }
    // Hide new channels from Jailed
    try {
      const jail = security.getJail(guild.id);
      if (jail?.roleId && channel.id !== jail.channelId) {
        const role = guild.roles.cache.get(jail.roleId);
        if (role) await channel.permissionOverwrites.edit(role, { ViewChannel: false }).catch(() => {});
      }
    } catch {}
    // Anti-nuke: who created this channel?
    antiRaid.handleAuditAction(guild, AuditLogEvent.ChannelCreate, 'channel create').catch(() => {});
  } catch {}
});

// ---- Anti-nuke watchers ----
client.on('channelDelete', async (channel) => {
  try {
    if (!channel.guild) return;
    antiRaid.handleAuditAction(channel.guild, AuditLogEvent.ChannelDelete, 'channel delete').catch(() => {});
  } catch {}
});
client.on('roleCreate', async (role) => {
  try { antiRaid.handleAuditAction(role.guild, AuditLogEvent.RoleCreate, 'role create').catch(() => {}); } catch {}
});
client.on('roleDelete', async (role) => {
  try { antiRaid.handleAuditAction(role.guild, AuditLogEvent.RoleDelete, 'role delete').catch(() => {}); } catch {}
});
client.on('guildBanAdd', async (ban) => {
  try { antiRaid.handleAuditAction(ban.guild, AuditLogEvent.MemberBanAdd, 'ban').catch(() => {}); } catch {}
});
client.on('guildMemberRemove', async (member) => {
  try {
    // Kicks show up as MemberKick in audit log
    antiRaid.handleAuditAction(member.guild, AuditLogEvent.MemberKick, 'kick').catch(() => {});
  } catch {}
});
client.on('webhookUpdate', async (channel) => {
  try {
    if (!channel.guild) return;
    antiRaid.handleAuditAction(channel.guild, AuditLogEvent.WebhookCreate, 'webhook create').catch(() => {});
  } catch {}
});
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    // Jail enforcement: if someone removes the Jailed role manually, put it back
    const jail = security.getJail(newMember.guild.id);
    if (jail?.roleId && security.getJailed(newMember.guild.id)[newMember.id]) {
      if (!newMember.roles.cache.has(jail.roleId)) {
        const role = await newMember.guild.roles.fetch(jail.roleId).catch(() => null);
        if (role) await newMember.roles.add(role, 'Jail enforcement: role removed').catch(() => {});
      }
    }
  } catch {}
});

// ---- Anti-raid spam / mention-raid watcher ----
client.on('messageCreate', async (message) => {
  try { antiRaid.handleMessage(message).catch(() => {}); } catch {}
});

// Buttons anyone is allowed to press (verify + tickets must work for all members)
const PUBLIC_BUTTON_IDS = new Set(['verify_start', 'create_ticket', 'close_ticket']);
// Slash commands anyone is allowed to use (must bypass the owner-only gate)
const PUBLIC_COMMANDS = new Set(['key']);

client.on('interactionCreate', async (interaction) => {
  try {
    // Public buttons bypass the owner-only gate so every member can verify / open tickets
    const isPublicButton = interaction.isButton() && PUBLIC_BUTTON_IDS.has(interaction.customId);
    const isPublicCommand = interaction.isChatInputCommand() && PUBLIC_COMMANDS.has(interaction.commandName);

    // Owner-only gate: blocks slash commands + non-public buttons from anyone else
    if (!isPublicButton && !isPublicCommand && !ALLOWED_USER_IDS.has(interaction.user.id)) {
      const msg = '❌ This bot is restricted and you are not authorized to use it.';
      if (interaction.isChatInputCommand() || interaction.isButton()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
        } else {
          await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
        }
      }
      return;
    }

    // --- Slash commands ---
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) {
        return interaction.reply({ content: `❌ Unknown command \`/${interaction.commandName}\`. Try \`/help\` for the full list.`, ephemeral: true }).catch(() => {});
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Shared-host IPs get 429'd: retry patiently (5 min) instead of dying or spam-restarting.
async function loginWithRetry() {
  let attempt = 1;
  for (;;) {
    console.log(`🔌 logging in to Discord... (attempt ${attempt})`);
    readyOnce = false;
    try {
      await Promise.race([
        client.login(token),
        sleep(60000).then(() => { throw new Error('login timed out after 60s (rate-limited IP?)'); }),
      ]);
      // Wait a bit for ready to fire (login resolves before ready on v14)
      for (let i = 0; i < 30 && !readyOnce; i++) await sleep(1000);
      if (readyOnce) return;
      throw new Error('login sent but no ready within 30s (rate-limited IP?)');
    } catch (e) {
      console.error(`💥 Discord login attempt ${attempt} failed: ${e?.message || e}`);
    }
    try { await client.destroy().catch(() => {}); } catch {}
    console.log('⏳ retrying in 5 minutes (do NOT spam-restart — it worsens 429s)...');
    await sleep(5 * 60 * 1000);
    attempt++;
  }
}
loginWithRetry();

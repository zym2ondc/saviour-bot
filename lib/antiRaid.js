const { EmbedBuilder, PermissionFlagsBits, AuditLogEvent } = require('discord.js');
const security = require('./securityConfig');

// ---- in-memory trackers (reset on restart, that's fine) ----
const joinBuckets = new Map(); // guildId -> [timestamps]
const nukeBuckets = new Map(); // `${guildId}:${executorId}` -> [{ type, ts }]
const msgBuckets = new Map();  // `${guildId}:${userId}` -> [timestamps]
const recentJoins = new Map(); // guildId -> [{ id, ts }] (for punishing raiders)
const raidCooldown = new Map(); // guildId -> ts (don't fire raid twice in a row)
const nukeCooldown = new Map(); // `${guildId}:${executorId}` -> ts

function prune(arr, windowMs) {
  const now = Date.now();
  return arr.filter(t => now - (typeof t === 'object' ? t.ts : t) < windowMs);
}

async function sendLog(guild, cfg, embed) {
  try {
    if (!cfg.logChannelId) return;
    const ch = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
    if (!ch?.isTextBased?.()) return;
    await ch.send({ embeds: [embed] }).catch(() => {});
  } catch {}
}

function isWhitelisted(memberOrUser, guild, cfg) {
  try {
    if (!memberOrUser) return false;
    const id = memberOrUser.id;
    if (id === guild.ownerId) return true;          // server owner always bypasses
    if (id === guild.client.user.id) return true;   // the bot itself
    const member = guild.members.cache.get(id) || memberOrUser;
    if (member?.permissions?.has?.(PermissionFlagsBits.Administrator) && member.id === guild.ownerId) return true;
    if (cfg.whitelistRoleId && member?.roles?.cache?.has?.(cfg.whitelistRoleId)) return true;
    return false;
  } catch {
    return false;
  }
}

async function punishRaider(member, action, reason) {
  try {
    if (!member?.manageable) return 'not-manageable';
    if (action === 'ban') {
      await member.ban({ reason }).catch(() => {});
      return 'banned';
    }
    if (action === 'timeout') {
      await member.timeout(10 * 60 * 1000, reason).catch(() => {});
      return 'timed-out';
    }
    await member.kick(reason).catch(() => {});
    return 'kicked';
  } catch {
    return 'failed';
  }
}

async function lockdownGuild(guild, cfg, triggerText) {
  // Deny SendMessages for @everyone in every text channel
  let locked = 0;
  try {
    const channels = await guild.channels.fetch();
    const jailChannelId = security.getJail(guild.id)?.channelId || null;
    for (const [, ch] of channels) {
      try {
        if (!ch || ch.id === jailChannelId) continue;
        if (!ch.isTextBased?.() || ch.isDMBased?.() || ch.isThread?.()) continue;
        const me = guild.members.me;
        if (!ch.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) continue;
        await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});
        locked++;
      } catch {}
    }
  } catch {}
  const mins = cfg.lockdownMins || 0;
  if (mins > 0 && locked > 0) {
    setTimeout(async () => {
      try {
        const fresh = await guild.fetch().catch(() => null);
        if (!fresh) return;
        const channels = await fresh.channels.fetch().catch(() => null);
        if (!channels) return;
        for (const [, ch] of channels) {
          try {
            if (!ch?.isTextBased?.() || ch.isDMBased?.() || ch.isThread?.()) continue;
            await ch.permissionOverwrites.edit(fresh.roles.everyone, { SendMessages: null }).catch(() => {});
          } catch {}
        }
        const logCfg = security.getAntiRaid(guild.id);
        await sendLog(fresh, logCfg, new EmbedBuilder()
          .setTitle('🔓 Raid lockdown lifted')
          .setDescription(`Server auto-unlocked after ${mins} min.\nTrigger was: ${triggerText}`)
          .setColor(0x57f287)
          .setTimestamp());
      } catch {}
    }, mins * 60 * 1000).unref?.();
  }
  return locked;
}

// ============ RAID (join burst) ============
async function handleJoin(member) {
  try {
    const guild = member.guild;
    if (member.user.bot) return; // bots handled via bot-add nuke check instead
    const cfg = security.getAntiRaid(guild.id);
    if (!cfg.enabled) return;

    const now = Date.now();
    const windowMs = Math.max(5, cfg.joinWindowSec) * 1000;

    const arr = prune(joinBuckets.get(guild.id) || [], windowMs);
    arr.push(now);
    joinBuckets.set(guild.id, arr);

    const joins = prune(recentJoins.get(guild.id) || [], windowMs);
    joins.push({ id: member.id, ts: now });
    recentJoins.set(guild.id, joins);

    // Optional: flag very new accounts in the log (never auto-punish outside raids)
    if (cfg.accountAgeMinHours > 0) {
      const ageHrs = (now - member.user.createdTimestamp) / 3600000;
      if (ageHrs < cfg.accountAgeMinHours) {
        await sendLog(guild, cfg, new EmbedBuilder()
          .setTitle('⚠️ Suspicious new account joined')
          .setDescription(`${member} (${member.user.tag}) account is only **${ageHrs < 1 ? Math.round(ageHrs * 60) + ' mins' : ageHrs.toFixed(1) + ' hrs'}** old.`)
          .setColor(0xfee75c)
          .setTimestamp());
      }
    }

    if (arr.length < cfg.maxJoins) return;

    // Cooldown: don't re-fire more than once per window
    const last = raidCooldown.get(guild.id) || 0;
    if (now - last < windowMs) return;
    raidCooldown.set(guild.id, now);

    // Punish everyone who joined inside the window
    let punished = 0;
    for (const j of joins) {
      try {
        const m = await guild.members.fetch(j.id).catch(() => null);
        if (!m || m.user.bot) continue;
        if (isWhitelisted(m, guild, cfg)) continue;
        const res = await punishRaider(m, cfg.raidAction, `Anti-raid: join burst (${arr.length} joins in ${cfg.joinWindowSec}s)`);
        if (res === 'kicked' || res === 'banned' || res === 'timed-out') punished++;
      } catch {}
    }

    let locked = 0;
    if (cfg.lockdownOnRaid) locked = await lockdownGuild(guild, cfg, `join burst (${arr.length} joins)`);

    await sendLog(guild, cfg, new EmbedBuilder()
      .setTitle('🚨 RAID DETECTED — join burst')
      .setDescription(`**${arr.length}** joins in **${cfg.joinWindowSec}s** (limit: ${cfg.maxJoins}).\n**Action:** ${cfg.raidAction} × ${punished} suspect(s)${locked ? `\n**Lockdown:** ${locked} channels locked${cfg.lockdownMins ? ` (auto-unlock in ${cfg.lockdownMins}m)` : ' (manual /unlock needed)'}` : ''}`)
      .setColor(0xed4245)
      .setTimestamp());

    // Clear bucket so next burst re-triggers cleanly
    joinBuckets.set(guild.id, []);
    recentJoins.set(guild.id, []);
  } catch (e) {
    console.warn('antiRaid handleJoin failed:', e.message);
  }
}

// ============ NUKE (rogue admin mass actions) ============
async function handleAuditAction(guild, auditType, actionLabel) {
  try {
    const cfg = security.getAntiRaid(guild.id);
    if (!cfg.enabled || !cfg.antiNuke) return;

    const me = guild.members.me;
    if (!me?.permissions?.has(PermissionFlagsBits.ViewAuditLog)) return;

    const logs = await guild.fetchAuditLogs({ type: auditType, limit: 1 }).catch(() => null);
    const entry = logs?.entries?.first?.();
    if (!entry || !entry.executor) return;
    const exec = entry.executor;
    if (exec.bot && exec.id === guild.client.user.id) return;

    let execMember = null;
    try { execMember = await guild.members.fetch(exec.id).catch(() => null); } catch {}
    if (execMember && isWhitelisted(execMember, guild, cfg)) return;
    // Owner bypasses even if fetch failed (compare IDs directly)
    if (exec.id === guild.ownerId) return;
    // Ignore very old audit entries (bot was offline etc.)
    if (entry.createdTimestamp && Date.now() - entry.createdTimestamp > 30_000) return;

    const now = Date.now();
    const windowMs = Math.max(5, cfg.nukeWindowSec) * 1000;
    const key = `${guild.id}:${exec.id}`;
    const bucket = prune(nukeBuckets.get(key) || [], windowMs);
    bucket.push({ type: actionLabel, ts: now });
    nukeBuckets.set(key, bucket);

    if (bucket.length < cfg.nukeThreshold) {
      // Still log the first suspicious action so mods see it early
      if (bucket.length === 1) {
        await sendLog(guild, cfg, new EmbedBuilder()
          .setTitle('⚠️ Destructive action logged')
          .setDescription(`<@${exec.id}> (${exec.tag || exec.id}) did **${actionLabel}** (1/${cfg.nukeThreshold} in ${cfg.nukeWindowSec}s before auto-punish).`)
          .setColor(0xfee75c)
          .setTimestamp());
      }
      return;
    }

    const lastPunish = nukeCooldown.get(key) || 0;
    if (now - lastPunish < windowMs) return;
    nukeCooldown.set(key, now);

    // Punish executor
    let result = 'failed';
    try {
      if (!execMember) execMember = await guild.members.fetch(exec.id).catch(() => null);
      if (execMember) {
        if (cfg.nukePunishment === 'strip') {
          const removable = execMember.roles.cache.filter(r => r.id !== guild.id && r.managed === false && r.position < me.roles.highest.position);
          await execMember.roles.remove(removable, `Anti-nuke: ${bucket.length} destructive actions`).catch(() => {});
          result = `stripped ${removable.size} role(s)`;
        } else if (cfg.nukePunishment === 'kick') {
          if (execMember.manageable) { await execMember.kick(`Anti-nuke: mass ${actionLabel}`).catch(() => {}); result = 'kicked'; }
          else result = 'not-manageable (role too high?)';
        } else {
          if (execMember.bannable) { await execMember.ban({ reason: `Anti-nuke: ${bucket.length} destructive actions in ${cfg.nukeWindowSec}s` }).catch(() => {}); result = 'banned'; }
          else result = 'not-bannable (role too high?)';
        }
      } else {
        result = 'left server already';
      }
    } catch (e) {
      result = `failed: ${e.message}`;
    }

    await sendLog(guild, cfg, new EmbedBuilder()
      .setTitle('🛡️ ANTI-NUKE TRIGGERED')
      .setDescription(`<@${exec.id}> (${exec.tag || exec.id}) did **${bucket.length}** destructive actions in **${cfg.nukeWindowSec}s** (limit: ${cfg.nukeThreshold}).\nActions: ${bucket.map(b => b.type).join(', ')}\n**Punishment (${cfg.nukePunishment}):** ${result}`)
      .setColor(0xed4245)
      .setTimestamp());

    nukeBuckets.set(key, []);
  } catch (e) {
    console.warn('antiNuke failed:', e.message);
  }
}

// ============ SPAM / MENTION RAID (message burst) ============
const SPAM_LIMIT = 6;      // msgs...
const SPAM_WINDOW = 8;     // ...in 8s = spam
const MENTION_LIMIT = 5;   // total @mentions in window = mention raid

async function handleMessage(message) {
  try {
    if (!message.guild || message.author.bot) return;
    const guild = message.guild;
    const cfg = security.getAntiRaid(guild.id);
    if (!cfg.enabled) return;
    const member = message.member;
    if (member && isWhitelisted(member, guild, cfg)) return;
    if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return;

    const now = Date.now();
    const windowMs = SPAM_WINDOW * 1000;
    const key = `${guild.id}:${message.author.id}`;
    const bucket = prune(msgBuckets.get(key) || [], windowMs);
    bucket.push(now);
    msgBuckets.set(key, bucket);

    const mentions = (message.mentions?.users?.size || 0) + (message.mentions?.roles?.size || 0);

    if (bucket.length >= SPAM_LIMIT || mentions >= MENTION_LIMIT) {
      msgBuckets.set(key, []); // reset so we don't punish 10x for one burst
      const me = guild.members.me;
      let action = 'none';
      try {
        if (me?.permissions?.has(PermissionFlagsBits.ModerateMembers) && member?.moderatable) {
          await member.timeout(10 * 60 * 1000, 'Anti-raid: spam / mention raid').catch(() => {});
          action = 'timed out 10m';
        }
        // Delete the spam burst
        if (me?.permissions?.has(PermissionFlagsBits.ManageMessages)) {
          const recent = await message.channel.messages.fetch({ limit: 15 }).catch(() => null);
          if (recent) {
            const spam = [...recent.values()].filter(m => m.author.id === message.author.id && Date.now() - m.createdTimestamp < 30_000);
            for (const m of spam.slice(0, 10)) await m.delete().catch(() => {});
          }
        }
      } catch {}
      await sendLog(guild, cfg, new EmbedBuilder()
        .setTitle('🚨 Spam / mention raid blocked')
        .setDescription(`${message.author} (${message.author.tag}) sent **${bucket.length}** msgs in ${SPAM_WINDOW}s in ${message.channel} (${mentions} mentions).\n**Action:** ${action}`)
        .setColor(0xed4245)
        .setTimestamp());
    }
  } catch {}
}

module.exports = {
  handleJoin,
  handleAuditAction,
  handleMessage,
  lockdownGuild,
  AuditLogEvent,
};

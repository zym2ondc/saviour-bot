const { REST, Routes, Client, GatewayIntentBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // optional: single-guild override for testing

// Use proxy for Discord REST when configured (same PROXY_URL as the bot)
const proxy = require('./lib/proxy').applyProxy();

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const cmd = require(path.join(commandsPath, file));
  commands.push(cmd.data.toJSON());
}

const rest = new REST({ version: '10', ...(proxy ? { agent: proxy.restAgent } : {}) }).setToken(token);

(async () => {
  try {
    // Single-guild override (fastest for testing)
    if (guildId) {
      console.log(`Registering ${commands.length} guild command(s) to ${guildId}...`);
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log('Guild commands registered instantly ✅');
      return;
    }

    // No GUILD_ID needed: deploy instantly to every server the bot is in
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await client.login(token);
    const guilds = [...client.guilds.cache.values()];
    console.log(`Bot is in ${guilds.length} server(s). Registering ${commands.length} command(s) to each (instant)...`);

    for (const g of guilds) {
      try {
        await rest.put(Routes.applicationGuildCommands(clientId, g.id), { body: commands });
        console.log(`  ✅ ${g.name} (${g.id})`);
      } catch (err) {
        console.error(`  ❌ ${g.name} (${g.id}):`, err.message);
      }
    }
    await client.destroy();
    // Wipe global commands — they linger from the old deploy method and show
    // every command twice (once global, once per-server). Guild copies are instant.
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log('Cleared leftover global commands (no more duplicates) ✅');
    console.log('Done — commands should appear instantly (press Ctrl+R in Discord if not). ✅');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();

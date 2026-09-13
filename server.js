const express = require('express');
const { exchangeCode, getMe, getMyGuilds } = require('./lib/oauth');
const store = require('./lib/store');

function startAuthServer(discordClient) {
  const app = express();
  const port = process.env.PORT || 3000;
  const redirectUri = process.env.OAUTH_REDIRECT_URI || `http://localhost:${port}/callback`;

  app.get('/', (req, res) => res.send('Saviour verify server running ✅ — go back to Discord and click Verify.'));

  app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('Missing code. Try clicking Verify again in Discord.');

    const [stateUserId, stateGuildId] = String(state || '').split('.');

    try {
      if (!process.env.CLIENT_SECRET) {
        return res.status(500).send('Server missing CLIENT_SECRET in .env — ask the bot owner to set it.');
      }
      const tokens = await exchangeCode(code, redirectUri);
      const me = await getMe(tokens.access_token);

      // Basic anti-hijack: state user should match oauth user
      if (stateUserId && stateUserId !== me.id) {
        console.warn(`State mismatch: ${stateUserId} vs oauth ${me.id}`);
      }

      const guilds = await getMyGuilds(tokens.access_token).catch(() => []);

      store.saveUser(me.id, {
        username: `${me.username}`,
        discriminator: me.discriminator || '0',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in * 1000),
        guilds_count: Array.isArray(guilds) ? guilds.length : 0,
        guild_ids: Array.isArray(guilds) ? guilds.map(g => g.id).slice(0, 200) : [],
        verified_at: new Date().toISOString(),
        verified_in_guild: stateGuildId || null,
      });

      // Give Verified, remove Unverified (by ID env or by name)
      if (stateGuildId && discordClient) {
        try {
          const guild = await discordClient.guilds.fetch(stateGuildId).catch(() => null);
          if (guild) {
            const member = await guild.members.fetch(me.id).catch(() => null);
            if (member) {
              let verifiedRole = null;
              let unverifiedRole = null;
              if (process.env.VERIFIED_ROLE_ID) {
                verifiedRole = await guild.roles.fetch(process.env.VERIFIED_ROLE_ID).catch(() => null);
              }
              if (process.env.UNVERIFIED_ROLE_ID) {
                unverifiedRole = await guild.roles.fetch(process.env.UNVERIFIED_ROLE_ID).catch(() => null);
              }
              if (!verifiedRole) verifiedRole = guild.roles.cache.find(r => r.name === 'Verified') || null;
              if (!unverifiedRole) unverifiedRole = guild.roles.cache.find(r => r.name === 'Unverified') || null;
              if (verifiedRole) await member.roles.add(verifiedRole).catch(e => console.warn('verified add failed:', e.message));
              if (unverifiedRole) await member.roles.remove(unverifiedRole).catch(() => {});
              // DM confirmation so Discord "does something" after authorize
              await member.send(`✅ You're verified in **${guild.name}**!`).catch(() => {});
            }
          }
        } catch (e) {
          console.warn('role assign error:', e.message);
        }
      }

      console.log(`✅ Verified ${me.username} (${me.id}) — in ${Array.isArray(guilds) ? guilds.length : '?'} servers`);
      res.send(`
        <html><body style="font-family:sans-serif;background:#111;color:#fff;text-align:center;padding:60px">
          <h1>✅ You are verified!</h1>
          <p><b>${me.username}</b> — you can close this tab and return to Discord.</p>
          <p style="opacity:.6">Saviour Security</p>
        </body></html>
      `);
    } catch (err) {
      console.error('OAuth callback error:', err);
      res.status(500).send(`Verification failed: ${err.message}. Go back and click Verify again.`);
    }
  });

  app.listen(port, () => console.log(`🔐 Verify server listening on :${port} → ${redirectUri}`));
}

module.exports = { startAuthServer };

// Gateway events: ready, guildCreate, guildMemberAdd and guildDelete.
const { ActivityType, EmbedBuilder } = require('discord.js');
const { client } = require('./client');
const { commandBuilders } = require('./commands/definitions');
const { activeTimeouts, activeWarnings, configCache, deleteActiveTimeout, getConfig, initDB, pool, purgeGuildData, saveConfig, timeoutKey } = require('./db');
const { banTimers, pendingUnwarns, scheduleBanExpiry, scheduleWarningRemoval, warningTimers } = require('./warnings');
const { getGlobalScamHashes, scamHashCache } = require('./scam/store');
const { SUPPORT_SERVER_URL } = require('./constants');
const { keepAlive } = require('./web/server');
const { spamTracker } = require('./spam/spam');
const { crossPostTracker } = require('./spam/crosspost');

// ── Bot ready ──────────────────────────────────────────────────────────────
client.once('ready', async () => {
    console.log(`✅ Police bot online as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: 'Monitoring the security cameras.', type: ActivityType.Watching }], status: 'online' });
    const commands = commandBuilders.map(c => c.toJSON());
    client.application.commands.set(commands);
    console.log('✅ Commands registered');
    try {
        await initDB();
        const [wRes, cRes] = await Promise.all([pool.query('SELECT key, data FROM warnings'), pool.query('SELECT guild_id, data FROM configs')]);
        for (const { key, data } of wRes.rows) activeWarnings.set(key, data);
        for (const { guild_id, data } of cRes.rows) configCache.set(guild_id, data);
        for (const [key, w] of activeWarnings.entries()) if (!w.isForever) scheduleWarningRemoval(key, w.guildId, w.userId, w.roleId, w.expiresAt, w.channelId);
        const atRes = await pool.query('SELECT guild_id, user_id, data FROM active_timeouts');
        const now = Date.now(); let expiredTimeouts = 0;
        for (const { guild_id, user_id, data } of atRes.rows) {
            if (data.expiresAt && data.expiresAt > now) activeTimeouts.set(timeoutKey(guild_id, user_id), data);
            else { expiredTimeouts++; pool.query('DELETE FROM active_timeouts WHERE guild_id = $1 AND user_id = $2', [guild_id, user_id]).catch(() => {}); }
        }
        if (expiredTimeouts) console.log(`🧹 Purged ${expiredTimeouts} already-expired tracked timeout(s)`);
        setInterval(() => {
            const cutoff = Date.now();
            for (const [key, data] of activeTimeouts.entries()) if (data.expiresAt && data.expiresAt <= cutoff) deleteActiveTimeout(data.guildId, data.userId);
        }, 10 * 60 * 1000);
        const shRes = await pool.query('SELECT guild_id, id, hash, label, added_by, added_at FROM scam_hashes ORDER BY id');
        for (const r of shRes.rows) { const arr = scamHashCache.get(r.guild_id) ?? []; arr.push({ id: r.id, hash: r.hash, label: r.label, addedBy: r.added_by, addedAt: r.added_at }); scamHashCache.set(r.guild_id, arr); }
        const loadedGlobalHashes = await getGlobalScamHashes();
        console.log(`✅ Loaded scam hashes for ${scamHashCache.size} guild(s), ${loadedGlobalHashes.length} global`);
        const banRes = await pool.query("SELECT guild_id, user_id, data FROM history WHERE data->>'type' = 'ban' AND data->>'expiresAt' IS NOT NULL ORDER BY id DESC");
        const seenBans = new Set();
        for (const { guild_id, user_id, data } of banRes.rows) {
            const bkey = `${guild_id}-${user_id}`; if (seenBans.has(bkey)) continue; seenBans.add(bkey);
            const unbanRes = await pool.query("SELECT id FROM history WHERE guild_id = $1 AND user_id = $2 AND data->>'type' = 'unban' AND id > (SELECT id FROM history WHERE guild_id = $1 AND user_id = $2 AND data = $3::jsonb LIMIT 1) LIMIT 1", [guild_id, user_id, JSON.stringify(data)]);
            if (!unbanRes.rows.length && data.expiresAt > Date.now()) scheduleBanExpiry(guild_id, user_id, data.userTag, data.expiresAt, data.reason);
        }
    } catch (e) { console.error('❌ DB init failed:', e.message); }
    // One-time retroactive announcement of the support server link in existing log channels
    try {
        let announced = 0;
        for (const [guildId, cfg] of configCache.entries()) {
            if (!cfg.logChannelId || cfg.supportLinkAnnounced) continue;
            const guild = client.guilds.cache.get(guildId);
            const ch = guild?.channels.cache.get(cfg.logChannelId);
            if (ch) {
                await ch.send(`📌 **Join my Support Server:** ${SUPPORT_SERVER_URL}`).catch(() => {});
                announced++;
            }
            cfg.supportLinkAnnounced = true;
            saveConfig(guildId, cfg);
        }
        if (announced) console.log(`✅ Posted support server link in ${announced} existing log channel(s)`);
    } catch (e) { console.error('❌ Retroactive support link announcement failed:', e.message); }
    keepAlive();
});

client.on('guildCreate', async guild => {
    const cfg = await getConfig(guild.id); if (!cfg.levels) saveConfig(guild.id, { levels: {} });
    try {
        const logs = await guild.fetchAuditLogs({ type: 28, limit: 5 });
        const entry = logs.entries.find(e => e.target?.id === client.user.id && Date.now() - e.createdTimestamp < 60000);
        if (guild.systemChannel) guild.systemChannel.send({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('👋 Thanks for adding Police Bot!').setDescription(`${entry?.executor?.id ? `<@${entry.executor.id}>, please` : 'An administrator should'} run \`/config access\` to set up command permissions.\n\n**Quick Start:**\n1. \`/config access\` — set the moderator role\n2. \`/config set\` — set up warning levels\n3. \`/warning give\` — start moderating!`).setFooter({ text: 'Use /help to see all commands' })] }).catch(() => {});
    } catch (e) { console.error('guildCreate error:', e); }
});

client.on('guildMemberAdd', async member => {
    const userWarnings = [...activeWarnings.entries()].filter(([, w]) => w.guildId === member.guild.id && w.userId === member.id);
    if (!userWarnings.length) return;
    for (const [, w] of userWarnings) { const role = member.guild.roles.cache.get(w.roleId); if (role) await member.roles.add(role).catch(() => {}); }
    member.send({ embeds: [new EmbedBuilder().setColor('#ff0000').setTitle('⚠️ Warning Reinstated').setDescription(`Your active warning(s) in **${member.guild.name}** have been reapplied because you rejoined.`).addFields({ name: 'Active Warnings', value: userWarnings.map(([, w]) => `Level ${w.level} — ${w.isForever ? 'Permanent' : `expires <t:${Math.floor(w.expiresAt / 1000)}:R>`}`).join('\n') }).setTimestamp()] }).catch(() => {});
});


// Removed from a server: delete everything stored for it (the privacy policy promises this).
client.on('guildDelete', async guild => {
    const guildId = guild.id, prefix = `${guildId}-`;
    try {
        for (const [key, t] of warningTimers) if (key.startsWith(prefix)) { clearTimeout(t); warningTimers.delete(key); }
        for (const [key, t] of banTimers) if (key.startsWith(prefix)) { clearTimeout(t); banTimers.delete(key); }
        for (const key of spamTracker.keys()) if (key.startsWith(prefix)) spamTracker.delete(key);
        for (const key of crossPostTracker.keys()) if (key.startsWith(prefix)) crossPostTracker.delete(key);
        for (const [id, p] of pendingUnwarns) if (p.guildId === guildId) pendingUnwarns.delete(id);
        scamHashCache.delete(guildId);
        await purgeGuildData(guildId);
        console.log(`🗑️ Removed from ${guild.name ?? guildId}: stored data deleted`);
    } catch (e) { console.error('guildDelete purge failed:', e.message); }
});

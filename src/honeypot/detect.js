// Message listener for the sting channel, plus the optional daily channel rename.
const { PermissionFlagsBits: P } = require('discord.js');
const { client } = require('../client');
const { configCache, getConfig } = require('../db');
const { getStingConfig, isStingChannel, randomChannelName, updateStingConfig } = require('./config');
const { runSting } = require('./punish');

// Spam bots post many messages at once. The first one starts the punishment; the rest just get deleted.
const inFlight = new Set();

// Staff are never punished, so a moderator who wanders in (or tests the channel) is left alone.
function isExempt(member, cfg) {
    const perms = member.permissions;
    return perms.has(P.Administrator) || perms.has(P.ManageMessages) || perms.has(P.ManageGuild) || !!(cfg.accessRoleId && member.roles.cache.has(cfg.accessRoleId));
}

client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    const guildId = message.guild.id;
    if (!await isStingChannel(guildId, message.channel.id)) return;
    // Resolve everything that needs an await first, so the check-and-claim below has none in between.
    // (A burst of messages would otherwise all pass the check before the first one claimed the user.)
    const cfg = await getConfig(guildId), member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (member && isExempt(member, cfg)) return;
    const key = `${guildId}-${message.author.id}`;
    if (inFlight.has(key)) { message.delete().catch(() => {}); return; }
    inFlight.add(key); setTimeout(() => inFlight.delete(key), 30_000).unref();
    try { await runSting(message, member, await getStingConfig(guildId)); }
    catch (e) { console.error('sting: handler failed:', e); }
});

// Daily rename: spam bots can learn a fixed channel name, so servers can opt in to a new one every day.
const DAY = 24 * 60 * 60 * 1000;
setInterval(async () => {
    const now = Date.now();
    for (const [guildId, cfg] of [...configCache.entries()]) {
        const st = cfg.sting; if (!st?.enabled || !st.dailyRename || !st.channelId || now - (st.lastRenameAt ?? 0) < DAY) continue;
        const ch = client.guilds.cache.get(guildId)?.channels.cache.get(st.channelId);
        if (!ch || !ch.guild.members.me?.permissionsIn(ch).has(P.ManageChannels)) continue;
        try { await ch.setName(randomChannelName(), 'Sting Operation: daily rename'); await updateStingConfig(guildId, { lastRenameAt: now }); }
        catch (e) { console.error('sting: rename failed:', e.message); }
    }
}, 60 * 60 * 1000).unref();

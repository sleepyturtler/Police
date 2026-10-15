// Cross-channel copy-paste detection for text and images.
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { addHistory, getConfig, saveActiveTimeout } = require('../db');
const { client } = require('../client');
const { logMod } = require('../helpers');

// ── Cross-post protection (same message pasted across many channels) ───────
// Separate from same-channel spam above: this catches things like referral-link ads
// pasted into several different channels a few minutes apart, which spamTracker's short
// windowMs would never catch since those messages are neither in the same channel nor
// close together in time.
const crossPostTracker = new Map(), crossPostCooldown = new Set();

setInterval(() => {
    const now = Date.now();
    for (const [key, entries] of crossPostTracker.entries()) {
        const fresh = entries.filter(e => now - e.ts < 30 * 60 * 1000); // hard ceiling well above any configurable window
        if (!fresh.length) crossPostTracker.delete(key); else crossPostTracker.set(key, fresh);
    }
}, 10 * 60 * 1000);

async function getCrossPostConfig(guildId) { const cfg = await getConfig(guildId); return { enabled: true, count: 3, windowMs: 5 * 60 * 1000, windowDisplay: '5m', timeoutMs: 10 * 60 * 1000, timeoutDisplay: '10m', deleteMsg: true, similarityThreshold: 0.85, matchImages: true, imageThreshold: 10, ...cfg.crossPostProt }; }

async function handleCrossPost(guild, author, matchedEntries, cpc, matchType) {
    const guildId = guild.id, key = `${guildId}-${author.id}`;
    if (crossPostCooldown.has(key)) return;
    crossPostCooldown.add(key); setTimeout(() => crossPostCooldown.delete(key), 5000);
    const botMember = guild.members.me;
    let deletedCount = 0;
    if (cpc.deleteMsg) {
        const byChannel = new Map();
        for (const e of matchedEntries) { if (e.hasReactions) continue; if (!byChannel.has(e.channelId)) byChannel.set(e.channelId, []); byChannel.get(e.channelId).push(e.msgId); }
        for (const [chId, msgIds] of byChannel) {
            const ch = guild.channels.cache.get(chId);
            if (!ch || !botMember.permissionsIn(ch).has(PermissionFlagsBits.ManageMessages)) continue;
            try { await ch.bulkDelete(msgIds); deletedCount += msgIds.length; }
            catch { for (const id of msgIds) { const msg = await ch.messages.fetch(id).catch(() => null); if (msg) { await msg.delete().catch(() => {}); deletedCount++; } } }
        }
    }
    let timedOut = false;
    if (cpc.timeoutMs && botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        const member = guild.members.cache.get(author.id) ?? await guild.members.fetch(author.id).catch(() => null);
        if (member && !member.permissions.has(PermissionFlagsBits.Administrator)) {
            timedOut = await member.timeout(cpc.timeoutMs, 'Cross-channel spam detection').then(() => true).catch(() => false);
            if (timedOut) saveActiveTimeout(guildId, author.id, { guildId, userId: author.id, userTag: author.tag, reason: 'Cross-channel spam detection', issuedBy: client.user.tag, issuedAt: Date.now(), expiresAt: Date.now() + cpc.timeoutMs, durationDisplay: cpc.timeoutDisplay });
        }
    }
    const distinctChannels = new Set(matchedEntries.map(e => e.channelId)).size, what = matchType === 'image' ? 'image' : 'message';
    const cfg = await getConfig(guildId);
    const E2 = (c, t) => new EmbedBuilder().setColor(c).setTitle(t).setTimestamp();
    const contentValue = matchType === 'image' ? `[image attachment, hash \`${matchedEntries[0]?.imgHash ?? 'unknown'}\`]` : (matchedEntries[0]?.content?.slice(0, 200) || '(empty)');
    if (cfg.warnDm !== false) author.send({ embeds: [E2('#ff6600','Your messages were removed').setDescription(`You posted the same ${what} across **${distinctChannels}** channels in **${guild.name}**, which was detected as cross-channel spam.`).addFields(...(timedOut ? [{ name: 'Consequence', value: `Timed out for ${cpc.timeoutDisplay}`, inline: true }] : [])).setFooter({ text: 'If you believe this is a mistake, contact a moderator' })] }).catch(() => {});
    logMod(guild, guildId, E2('#ff6600','Cross-Channel Spam Auto-Removed').addFields({ name: 'User', value: `${author} (${author.tag})`, inline: true }, { name: 'Type', value: matchType === 'image' ? 'Image' : 'Text', inline: true }, { name: 'Channels', value: `${distinctChannels}`, inline: true }, { name: 'Messages Removed', value: `${deletedCount}`, inline: true }, ...(timedOut ? [{ name: 'Timeout', value: cpc.timeoutDisplay, inline: true }] : []), { name: 'Content', value: contentValue }));
    addHistory(guildId, author.id, { guildId, userId: author.id, userTag: author.tag, type: 'crosspost_remove', reason: `Cross-posted ${what} across ${distinctChannels} channels`, issuedBy: client.user.tag, issuedAt: Date.now() });
}

module.exports = { crossPostCooldown, crossPostTracker, getCrossPostConfig, handleCrossPost };

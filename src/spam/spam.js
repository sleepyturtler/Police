// Same-channel repeated message detection.
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { addHistory, getConfig, saveActiveTimeout } = require('../db');
const { client } = require('../client');
const { logMod } = require('../helpers');

// ── Spam protection ────────────────────────────────────────────────────────
const spamTracker = new Map(), spamCooldown = new Set();

// spamTracker gets a key for every user who posts in a spam-protected server, but only ever
// deletes a key when that user is actually caught spamming — everyone else's entry sits there
// forever. Spam window is capped at 60s (see /spam config), so anything older than that is
// dead weight; sweep it out periodically instead of letting the Map grow with every unique poster.
setInterval(() => {
    const cutoff = Date.now() - 65_000;
    for (const [key, entries] of spamTracker.entries()) {
        if (!entries.length || entries[entries.length - 1].ts < cutoff) spamTracker.delete(key);
    }
}, 10 * 60 * 1000);

function normalise(s) { return s.trim().toLowerCase().replace(/\s+/g, ' '); }

function similarity(a, b) {
    if (a === b) return 1; if (!a.length || !b.length) return 0;
    if (a.length <= 4 && b.length <= 4 && a.split('').sort().join('') === b.split('').sort().join('')) return 0.9;
    if (a.length < 2 || b.length < 2) return 0;
    const bg = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i+2); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
    const aMap = bg(a), bMap = bg(b); let ix = 0;
    for (const [k, c] of aMap) ix += Math.min(c, bMap.get(k) ?? 0);
    return (2 * ix) / (a.length - 1 + b.length - 1);
}

async function getSpamConfig(guildId) { const cfg = await getConfig(guildId); return { enabled: true, count: 5, windowMs: 10_000, timeoutMs: 10 * 60 * 1000, timeoutDisplay: '10m', deleteMsg: true, similarityThreshold: 0.7, ...cfg.spamProt }; }

async function handleSpam(message, matchedMessages, spc) {
    const { guild, author, channel } = message, guildId = guild.id, key = `${guildId}-${author.id}`;
    if (spamCooldown.has(key)) return;
    spamCooldown.add(key); setTimeout(() => spamCooldown.delete(key), 5000);
    const botMember = guild.members.me, canDelete = spc.deleteMsg && botMember.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages);
    if (canDelete) {
        // Skip messages that have reactions — may be pinned/community content
        const idsToDelete = matchedMessages.filter(m => !m.hasReactions).map(m => m.msgId);
        if (idsToDelete.length) channel.bulkDelete(idsToDelete).catch(async () => {
            for (const id of idsToDelete) { const msg = await channel.messages.fetch(id).catch(() => null); if (msg) msg.delete().catch(() => {}); }
        });
    }
    let timedOut = false;
    if (spc.timeoutMs && botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        const member = guild.members.cache.get(author.id) ?? await guild.members.fetch(author.id).catch(() => null);
        if (member && !member.permissions.has(PermissionFlagsBits.Administrator)) {
            timedOut = await member.timeout(spc.timeoutMs, 'Spam detection').then(() => true).catch(() => false);
            if (timedOut) saveActiveTimeout(guildId, author.id, { guildId, userId: author.id, userTag: author.tag, reason: 'Spam detection', issuedBy: client.user.tag, issuedAt: Date.now(), expiresAt: Date.now() + spc.timeoutMs, durationDisplay: spc.timeoutDisplay });
        }
    }
    const cfg = await getConfig(guildId);
    const E2 = (c, t) => new EmbedBuilder().setColor(c).setTitle(t).setTimestamp();
    channel.send({ embeds: [E2('#ff6600','Spam Detected').setDescription(`${author}'s repeated messages were removed.`).addFields({ name: 'Messages Removed', value: `${matchedMessages.length}`, inline: true }, ...(timedOut ? [{ name: 'Consequence', value: `Timed out for ${spc.timeoutDisplay}`, inline: true }] : []))] }).catch(() => {});
    if (cfg.warnDm !== false) author.send({ embeds: [E2('#ff6600','Your messages were removed').setDescription(`You were detected as spamming in **${guild.name}**.`).addFields(...(timedOut ? [{ name: 'Consequence', value: `Timed out for ${spc.timeoutDisplay}`, inline: true }] : [])).setFooter({ text: 'If you believe this is a mistake, contact a moderator' })] }).catch(() => {});
    logMod(guild, guildId, E2('#ff6600','Spam Auto-Removed').addFields({ name: 'User', value: `${author} (${author.tag})`, inline: true }, { name: 'Channel', value: `${channel}`, inline: true }, { name: 'Messages Removed', value: `${matchedMessages.length}`, inline: true }, ...(timedOut ? [{ name: 'Timeout', value: spc.timeoutDisplay, inline: true }] : []), { name: 'Content', value: matchedMessages[0]?.content?.slice(0, 200) || '(empty)' }));
    addHistory(guildId, author.id, { guildId, userId: author.id, userTag: author.tag, type: 'spam_remove', reason: `Spam: ${matchedMessages.length}x`, issuedBy: client.user.tag, issuedAt: Date.now() });
}

module.exports = { getSpamConfig, handleSpam, normalise, similarity, spamCooldown, spamTracker };

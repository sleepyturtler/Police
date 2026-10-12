// Warning roles, expiry timers, timed bans and escalation.
const { EmbedBuilder } = require('discord.js');
const { activeWarnings, addHistory, deleteWarning, getConfig, saveActiveTimeout, saveWarning } = require('./db');
const { client } = require('./client');
const { logMod } = require('./helpers');

// ── Warning timers ─────────────────────────────────────────────────────────
const warningTimers = new Map(), pendingUnwarns = new Map(), banTimers = new Map();

async function handleWarningExpiry(key, guildId, userId, roleId, channelId) {
    const w = activeWarnings.get(key);
    try {
        const guild = client.guilds.cache.get(guildId); if (!guild) return;
        const member = await guild.members.fetch(userId).catch(() => null), role = guild.roles.cache.get(roleId);
        if (member && role && member.roles.cache.has(roleId)) {
            await member.roles.remove(role);
            member.user.send({ embeds: [new EmbedBuilder().setColor('#00ff00').setTitle('Warning Expired').setDescription(`Your warning in **${guild.name}** has expired and the role has been removed.`).addFields({ name: 'Warning Level', value: `${w?.level ?? 'Unknown'}`, inline: true }, { name: 'Role Removed', value: role.name, inline: true }).setFooter({ text: 'You no longer carry this warning role' }).setTimestamp()] }).catch(() => {});
            const ch = guild.channels.cache.get(channelId);
            if (ch) ch.send({ embeds: [new EmbedBuilder().setColor('#00ff00').setTitle('Warning Expired').setDescription(`<@${userId}>'s warning has expired and the role has been removed.`).setTimestamp()] });
        }
    } catch (e) {
        console.error(`Failed to remove role: ${e}`);
        try { const ch = client.guilds.cache.get(guildId)?.channels.cache.get(channelId); if (ch) ch.send({ embeds: [new EmbedBuilder().setColor('#ff0000').setTitle('Warning Removal Failed').setDescription(`Could not remove role from <@${userId}>. Check bot permissions.`).setTimestamp()] }); } catch {}
    }
    if (w) addHistory(guildId, userId, { ...w, endedAt: Date.now(), endReason: 'expired' });
    warningTimers.delete(key); deleteWarning(key);
}

// setTimeout's delay is a 32-bit signed int (~24.8 days max). For longer delays, chain timeouts recursively.
const MAX_TIMEOUT_DELAY = 2147483647;

function scheduleWarningRemoval(key, guildId, userId, roleId, expiresAt, channelId) {
    const t = expiresAt - Date.now();
    if (t <= 0) return handleWarningExpiry(key, guildId, userId, roleId, channelId);
    const schedule = (delay) => {
        if (delay <= MAX_TIMEOUT_DELAY) {
            warningTimers.set(key, setTimeout(() => handleWarningExpiry(key, guildId, userId, roleId, channelId), delay));
        } else {
            warningTimers.set(key, setTimeout(() => schedule(delay - MAX_TIMEOUT_DELAY), MAX_TIMEOUT_DELAY));
        }
    };
    schedule(t);
}

function scheduleBanExpiry(guildId, userId, userTag, expiresAt, reason) {
    const t = expiresAt - Date.now(); if (t <= 0) return;
    const key = `${guildId}-${userId}`;
    const run = async () => {
        banTimers.delete(key);
        try {
            const guild = client.guilds.cache.get(guildId); if (!guild) return;
            const ban = await guild.bans.fetch(userId).catch(() => null); if (!ban) return;
            await guild.members.unban(userId, 'Timed ban expired');
            addHistory(guildId, userId, { guildId, userId, userTag, type: 'unban', reason: 'Timed ban expired', issuedBy: client.user.tag, issuedAt: Date.now() });
            logMod(guild, guildId, new EmbedBuilder().setColor('#00ff00').setTitle('Timed Ban Expired').addFields({ name: 'User', value: `${userTag} (${userId})`, inline: true }, { name: 'Original Reason', value: reason }).setTimestamp());
        } catch (e) { console.error('Ban expiry failed:', e.message); }
    };
    const schedule = (delay) => {
        if (delay <= MAX_TIMEOUT_DELAY) banTimers.set(key, setTimeout(run, delay));
        else banTimers.set(key, setTimeout(() => schedule(delay - MAX_TIMEOUT_DELAY), MAX_TIMEOUT_DELAY));
    };
    schedule(t);
}

async function applyWarning(guild, member, user, guildId, level, reason, channelId, issuedByTag) {
    const cfg = await getConfig(guildId), lc = cfg.levels[level], role = guild.roles.cache.get(lc?.roleId);
    if (!lc || !role) return { error: `Level ${level} config or role not found.` };
    if (role.position >= guild.members.me.roles.highest.position) return { error: `Role hierarchy: my role must be above ${role.name}.` };
    await member.roles.add(role);
    if (cfg.warnDm !== false) user.send({ embeds: [new EmbedBuilder().setColor('#ff0000').setTitle('⚠️ You Received a Warning').setDescription(`You have been warned in **${guild.name}**.`).addFields({ name: 'Warning Level', value: `${level}`, inline: true }, { name: 'Duration', value: lc.durationDisplay || 'Unknown', inline: true }, { name: 'Reason', value: reason }).setFooter({ text: `Use /mywarnings in ${guild.name} to check when this warning expires` }).setTimestamp()] }).catch(() => {});
    const base = { guildId, userId: user.id, userTag: user.tag, roleId: role.id, roleName: role.name, level, reason, issuedBy: issuedByTag, issuedAt: Date.now() };
    const key = `${guildId}-${user.id}-${level}-${Date.now()}`;
    if (!lc.isForever) { const expiresAt = Date.now() + lc.durationMs; saveWarning(key, { ...base, expiresAt, channelId, isForever: false }); scheduleWarningRemoval(key, guildId, user.id, role.id, expiresAt, channelId); }
    else saveWarning(key, { ...base, expiresAt: null, channelId, isForever: true });
    return { success: true, role, config: lc };
}

async function checkEscalation(guild, member, user, guildId, level, channelId, issuedByTag) {
    const cfg = await getConfig(guildId), esc = cfg.escalation ?? {}, cap = esc.cap, nextLevel = level + 1;
    if (cap != null && nextLevel > cap) return { atCap: true, cap };
    const count = [...activeWarnings.values()].filter(w => w.guildId === guildId && w.userId === user.id && w.level === level).length;
    const toCfg = esc.timeouts?.[nextLevel];
    if (toCfg?.threshold != null) {
        if (count < toCfg.threshold) return { counted: true, count, threshold: toCfg.threshold };
        if (!cfg.levels[nextLevel]) return { noNextLevel: true, nextLevel };
        const r = await applyWarning(guild, member, user, guildId, nextLevel, `Auto-escalated from Level ${level}`, channelId, issuedByTag);
        if (r.error) return { escalationError: r.error };
        const timeoutOk = await member.timeout(toCfg.durationMs, `Auto-escalated to Level ${nextLevel}`).then(() => true).catch(() => false);
        if (timeoutOk) saveActiveTimeout(guildId, user.id, { guildId, userId: user.id, userTag: user.tag, reason: `Auto-escalated to Level ${nextLevel}`, issuedBy: issuedByTag, issuedAt: Date.now(), expiresAt: Date.now() + toCfg.durationMs, durationDisplay: toCfg.durationDisplay });
        user.send({ embeds: [new EmbedBuilder().setColor('#ff6600').setTitle('⚠️ You Have Been Timed Out').setDescription(`You were auto-timed-out in **${guild.name}** upon reaching Warning Level ${nextLevel}.`).addFields({ name: 'Timeout Duration', value: toCfg.durationDisplay, inline: true }).setTimestamp()] }).catch(() => {});
        return { escalated: true, nextLevel, role: r.role, config: r.config, hitCap: cap != null && nextLevel === cap, timedOut: true, timeoutDisplay: toCfg.durationDisplay };
    }
    const threshold = esc.thresholds?.[level]; if (!threshold) return null;
    if (count < threshold) return { counted: true, count, threshold };
    if (!cfg.levels[nextLevel]) return { noNextLevel: true, nextLevel };
    const r = await applyWarning(guild, member, user, guildId, nextLevel, `Auto-escalated from Level ${level}`, channelId, issuedByTag);
    if (r.error) return { escalationError: r.error };
    return { escalated: true, nextLevel, role: r.role, config: r.config, hitCap: cap != null && nextLevel === cap, timedOut: false };
}

module.exports = { applyWarning, banTimers, checkEscalation, pendingUnwarns, scheduleBanExpiry, scheduleWarningRemoval, warningTimers };

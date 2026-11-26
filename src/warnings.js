// Warning roles, expiry timers, timed bans and escalation.
const { EmbedBuilder } = require('discord.js');
const { activeWarnings, addHistory, deleteWarning, getConfig, saveActiveTimeout, saveWarning } = require('./db');
const { client } = require('./client');
const { logMod } = require('./helpers');
const { getPath, multiPath, pathLabel, warningPathId } = require('./paths');

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

// opts: { pathId, offense }. pathId picks the ladder (the first path if omitted); offense is the label shown to the user and kept in history.
async function applyWarning(guild, member, user, guildId, level, reason, channelId, issuedByTag, opts = {}) {
    const cfg = await getConfig(guildId), path = getPath(cfg, opts.pathId), lc = path.levels[level], role = guild.roles.cache.get(lc?.roleId);
    if (!lc || !role) return { error: `Level ${level} config or role not found${multiPath(cfg) ? ` on ${path.name}` : ''}.` };
    if (role.position >= guild.members.me.roles.highest.position) return { error: `Role hierarchy: my role must be above ${role.name}.` };
    await member.roles.add(role);
    const extra = [...(opts.offense ? [{ name: 'Offense', value: opts.offense.slice(0, 200), inline: true }] : []), ...(multiPath(cfg) ? [{ name: 'Path', value: pathLabel(path), inline: true }] : [])];
    if (cfg.warnDm !== false) user.send({ embeds: [new EmbedBuilder().setColor('#ff0000').setTitle('⚠️ You Received a Warning').setDescription(`You have been warned in **${guild.name}**.`).addFields({ name: 'Warning Level', value: `${level}`, inline: true }, { name: 'Duration', value: lc.durationDisplay || 'Unknown', inline: true }, ...extra, { name: 'Reason', value: reason }).setFooter({ text: `Use /mywarnings in ${guild.name} to check when this warning expires` }).setTimestamp()] }).catch(() => {});
    const base = { guildId, userId: user.id, userTag: user.tag, roleId: role.id, roleName: role.name, level, reason, issuedBy: issuedByTag, issuedAt: Date.now(), pathId: path.id, pathName: path.name, ...(opts.offense ? { offense: opts.offense } : {}) };
    const key = `${guildId}-${user.id}-${level}-${Date.now()}`;
    if (!lc.isForever) { const expiresAt = Date.now() + lc.durationMs; saveWarning(key, { ...base, expiresAt, channelId, isForever: false }); scheduleWarningRemoval(key, guildId, user.id, role.id, expiresAt, channelId); }
    else saveWarning(key, { ...base, expiresAt: null, channelId, isForever: true });
    return { success: true, role, config: lc, pathId: path.id };
}

// Active warnings a user has at one level of one path.
const countActive = (cfg, guildId, userId, pathId, level) => [...activeWarnings.values()].filter(w => w.guildId === guildId && w.userId === userId && w.level === level && warningPathId(w, cfg) === pathId).length;

// What issuing one more warning at `level` would do on this path, for the confirmation screen. Null when no rule applies.
function forecastEscalation(cfg, guildId, userId, pathId, level) {
    const path = getPath(cfg, pathId), esc = path.escalation ?? {}, nextLevel = level + 1;
    if (esc.cap != null && nextLevel > esc.cap) return { atCap: true, cap: esc.cap };
    const toCfg = esc.timeouts?.[nextLevel], threshold = toCfg?.threshold ?? esc.thresholds?.[level];
    if (!threshold) return null;
    const count = countActive(cfg, guildId, userId, path.id, level) + 1; // this warning counts too
    return { count, threshold, nextLevel, willEscalate: count >= threshold, timeout: toCfg?.threshold != null ? toCfg.durationDisplay : null, nextConfigured: !!path.levels[nextLevel] };
}

// Same rules as before, applied inside one path: only that path's warnings count, and its own thresholds, timeouts and cap apply.
async function checkEscalation(guild, member, user, guildId, level, channelId, issuedByTag, opts = {}) {
    const cfg = await getConfig(guildId), path = getPath(cfg, opts.pathId), esc = path.escalation ?? {}, cap = esc.cap, nextLevel = level + 1;
    if (cap != null && nextLevel > cap) return { atCap: true, cap };
    const count = countActive(cfg, guildId, user.id, path.id, level);
    const toCfg = esc.timeouts?.[nextLevel], nextCfg = path.levels[nextLevel];
    // A level that only exists as a timeout step has no role to give, so only the timeout is applied.
    const giveNext = async () => nextCfg.isTimeoutLevel ? { role: null, config: nextCfg } : applyWarning(guild, member, user, guildId, nextLevel, `Auto-escalated from Level ${level}`, channelId, issuedByTag, { pathId: path.id });
    if (toCfg?.threshold != null) {
        if (count < toCfg.threshold) return { counted: true, count, threshold: toCfg.threshold };
        if (!nextCfg) return { noNextLevel: true, nextLevel };
        const r = await giveNext();
        if (r.error) return { escalationError: r.error };
        const timeoutOk = await member.timeout(toCfg.durationMs, `Auto-escalated to Level ${nextLevel}`).then(() => true).catch(() => false);
        if (timeoutOk) saveActiveTimeout(guildId, user.id, { guildId, userId: user.id, userTag: user.tag, reason: `Auto-escalated to Level ${nextLevel}`, issuedBy: issuedByTag, issuedAt: Date.now(), expiresAt: Date.now() + toCfg.durationMs, durationDisplay: toCfg.durationDisplay });
        user.send({ embeds: [new EmbedBuilder().setColor('#ff0000').setTitle('⚠️ You Have Been Timed Out').setDescription(`You were auto-timed-out in **${guild.name}** upon reaching Warning Level ${nextLevel}.`).addFields({ name: 'Timeout Duration', value: toCfg.durationDisplay, inline: true }).setTimestamp()] }).catch(() => {});
        return { escalated: true, nextLevel, role: r.role, config: r.config, hitCap: cap != null && nextLevel === cap, timedOut: true, timeoutDisplay: toCfg.durationDisplay, pathId: path.id };
    }
    const threshold = esc.thresholds?.[level]; if (!threshold) return null;
    if (count < threshold) return { counted: true, count, threshold };
    if (!nextCfg || nextCfg.isTimeoutLevel) return { noNextLevel: true, nextLevel };
    const r = await giveNext();
    if (r.error) return { escalationError: r.error };
    return { escalated: true, nextLevel, role: r.role, config: r.config, hitCap: cap != null && nextLevel === cap, timedOut: false, pathId: path.id };
}

module.exports = { applyWarning, banTimers, checkEscalation, countActive, forecastEscalation, pendingUnwarns, scheduleBanExpiry, scheduleWarningRemoval, warningTimers };

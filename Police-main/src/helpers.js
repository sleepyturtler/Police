// Permission checks, mod-log posting, durations, bulk delete and the @everyone ping check.
const { PermissionFlagsBits } = require('discord.js');
const { DELETE_CONCURRENCY, DELETE_OLD_MAX } = require('./constants');
const { getConfig } = require('./db');

// ── Helpers ────────────────────────────────────────────────────────────────
// Every mod-log entry is red, whatever color the embed was built with.
async function logMod(guild, guildId, embed) { embed.setColor('#ff0000'); const cfg = await getConfig(guildId); const ch = cfg.logChannelId && guild.channels.cache.get(cfg.logChannelId); if (ch) ch.send({ embeds: [embed] }).catch(() => {}); }

async function hasCommandPermission(interaction, guildId) { if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return true; const cfg = await getConfig(guildId); return cfg.accessRoleId ? interaction.member.roles.cache.has(cfg.accessRoleId) : false; }

function mentionEveryoneRisk(guild) {
    const risky = [];
    const everyoneRole = guild.roles.everyone;
    if (everyoneRole.permissions.has(PermissionFlagsBits.MentionEveryone)) risky.push('@everyone (default role)');
    for (const role of guild.roles.cache.values()) {
        if (role.id === guild.id || role.managed) continue;
        if (role.permissions.has(PermissionFlagsBits.Administrator)) continue; // admins are expected to have this
        if (role.permissions.has(PermissionFlagsBits.MentionEveryone)) risky.push(role.name);
    }
    return risky;
}

function mentionEveryoneWarningField(guild) {
    const risky = mentionEveryoneRisk(guild);
    if (!risky.length) return null;
    return {
        name: '⚠️ @everyone/@here Ping Risk',
        value: `**${risky.join(', ')}** can currently ping @everyone/@here in this server.\n` +
            `Scam images are removed instantly, but the **ping itself still goes through** before the message is deleted — everyone gets notified regardless.\n` +
            `Restrict **"Mention @everyone, @here, and All Roles"** to **Administrators or a trusted role only** to stop scammers abusing this.`
    };
}

function parseDuration(s) {
    s = s.trim();
    if (s.toLowerCase() === 'forever') return { days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: null, isForever: true };
    // Natural shorthand: 1d, 2h, 30m, 90s, or combinations like 1d12h, 1h30m
    if (/^(\d+d)?(\d+h)?(\d+m)?(\d+s)?$/i.test(s) && /\d/.test(s)) {
        const m = s.match(/^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
        const days = parseInt(m[1] || 0), hours = parseInt(m[2] || 0), minutes = parseInt(m[3] || 0), seconds = parseInt(m[4] || 0);
        const totalMs = (days * 86400 + hours * 3600 + minutes * 60 + seconds) * 1000;
        return (totalMs <= 0 || totalMs > 365 * 86400 * 1000) ? null : { days, hours, minutes, seconds, totalMs, isForever: false };
    }
    const parts = s.split(':').map(p => { const n = parseInt(p.trim()); return (n < 0 || n > 9999) ? NaN : n; });
    if (parts.some(isNaN) || parts.length < 2 || parts.length > 4) return null;
    let days = 0, hours = 0, minutes = 0, seconds = 0;
    if (parts.length === 2) [minutes, seconds] = parts;
    else if (parts.length === 3) [hours, minutes, seconds] = parts;
    else [days, hours, minutes, seconds] = parts;
    const totalMs = (days * 86400 + hours * 3600 + minutes * 60 + seconds) * 1000;
    return (totalMs <= 0 || totalMs > 365 * 86400 * 1000) ? null : { days, hours, minutes, seconds, totalMs, isForever: false };
}

function formatDuration(d, h, m, s, isForever = false) { if (isForever) return 'Forever'; return [d && `${d}d`, h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' ') || '0s'; }

// Fetch+bulkDelete messages in a channel matching optional userId and since timestamp. Returns count deleted.
// ── Deleting messages ──────────────────────────────────────────────────────
// Discord bulk-deletes only messages under 14 days old, refuses a whole batch if one message in it cannot be
// deleted, and gives no "messages by this user" lookup, so history has to be paged through. This helper:
//   - counts what Discord really deleted (not what it tried to),
//   - retries a refused batch one message at a time so one bad message does not block the rest,
//   - stops a channel on a permission error and records it,
//   - deletes messages older than 14 days one at a time, up to a shared budget (DELETE_OLD_MAX per run),
//   - stops at maxPages / a deadline and says so (stats.capped) instead of silently stopping.
// It returns the number deleted; pass `stats` (and a shared `budget`) to also get the details.
const MAX_AGE = 1_209_600_000; // 14 days, Discord's bulk delete limit
const isPermissionError = e => e?.code === 50013 || e?.code === 50001;
const isGone = e => e?.code === 10008; // Unknown Message: already deleted by someone else

async function deleteBatch(channel, batch, st) {
    try { const res = await channel.bulkDelete(batch, true); st.deleted += res?.size ?? batch.length; return; }
    catch (e) { if (isPermissionError(e)) { st.failed += batch.length; st.error = e.message; throw e; } }
    for (const m of batch) { // the batch was refused as a whole, so go one by one
        try { await m.delete(); st.deleted++; }
        catch (e) { if (isGone(e)) continue; st.failed++; if (isPermissionError(e)) { st.error = e.message; throw e; } }
    }
}

async function bulkDeleteInRange(channel, { userId, since, maxCount = Infinity, maxPages = Infinity, deadline = Infinity, stats, budget } = {}) {
    const st = stats ?? {}, old = budget ?? { old: DELETE_OLD_MAX };
    for (const k of ['deleted', 'failed', 'tooOld', 'oldDeleted']) st[k] ??= 0;
    st.capped ??= false; st.error ??= null;
    const start = st.deleted; let lastId, pages = 0;
    try {
        while (true) {
            const fetched = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
            if (!fetched.size) break;
            const now = Date.now(), fresh = [], aged = [];
            for (const m of fetched.values()) {
                if ((userId && m.author.id !== userId) || (since && m.createdTimestamp < since)) continue;
                (now - m.createdTimestamp < MAX_AGE ? fresh : aged).push(m);
            }
            let room = maxCount - (st.deleted - start);
            if (fresh.length && room > 0) await deleteBatch(channel, fresh.slice(0, room), st);
            room = maxCount - (st.deleted - start);
            for (const m of aged) {
                if (room <= 0) break;
                if (old.old <= 0) { st.tooOld++; continue; }
                old.old--;
                try { await m.delete(); st.deleted++; st.oldDeleted++; room--; }
                catch (e) { if (isGone(e)) continue; st.failed++; if (isPermissionError(e)) throw e; }
            }
            if (maxCount - (st.deleted - start) <= 0 || (since && fetched.last().createdTimestamp < since)) break;
            if (++pages >= maxPages || Date.now() > deadline) { st.capped = true; break; }
            lastId = fetched.last().id;
        }
    } catch (e) {
        st.error ??= e.message;
        console.error(`bulkDeleteInRange failed in channel ${channel.id}:`, e.message);
    }
    return st.deleted - start;
}

// Sweeps several channels at once (DELETE_CONCURRENCY at a time) and collects what happened.
async function purgeChannels(channels, { userId, since, maxPages = Infinity, deadline = Infinity, concurrency = DELETE_CONCURRENCY } = {}) {
    const list = [...channels], budget = { old: DELETE_OLD_MAX };
    const out = { deleted: 0, failed: 0, tooOld: 0, oldDeleted: 0, scanned: 0, affected: 0, capped: [], errors: [], skipped: [] };
    let next = 0;
    const worker = async () => {
        while (next < list.length) {
            const ch = list[next++];
            if (Date.now() > deadline) { out.skipped.push(ch); continue; }
            const st = {}; out.scanned++;
            await bulkDeleteInRange(ch, { userId, since, maxPages, deadline, stats: st, budget });
            out.deleted += st.deleted; out.failed += st.failed; out.tooOld += st.tooOld; out.oldDeleted += st.oldDeleted;
            if (st.deleted > 0) out.affected++;
            if (st.capped) out.capped.push(ch);
            if (st.error) out.errors.push(ch);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, worker));
    return out;
}

// Plain-language lines about anything that did not go perfectly. `command` is what a moderator can run to finish.
function purgeNotes(out, command = null) {
    const names = chs => { const shown = chs.slice(0, 5).map(c => `<#${c.id}>`).join(', '); return chs.length > 5 ? `${shown} and ${chs.length - 5} more` : shown; };
    const notes = [];
    if (out.errors.length) notes.push(`Could not delete in ${names(out.errors)} (missing permissions).`);
    if (out.failed) notes.push(`${out.failed} message${out.failed === 1 ? '' : 's'} could not be deleted.`);
    if (out.capped.length) notes.push(`The scan limit was reached in ${names(out.capped)}, so older messages there may remain.`);
    if (out.skipped.length) notes.push(`${out.skipped.length} channel${out.skipped.length === 1 ? ' was' : 's were'} not reached before the time limit.`);
    if (out.oldDeleted) notes.push(`${out.oldDeleted} message${out.oldDeleted === 1 ? '' : 's'} older than 14 days ${out.oldDeleted === 1 ? 'was' : 'were'} deleted one at a time.`);
    if (out.tooOld) notes.push(`${out.tooOld} message${out.tooOld === 1 ? '' : 's'} older than 14 days ${out.tooOld === 1 ? 'was' : 'were'} left (limit of ${DELETE_OLD_MAX} per run).`);
    if (command && (out.capped.length || out.skipped.length || out.tooOld)) notes.push(`To finish, run ${command}`);
    return notes;
}

module.exports = { bulkDeleteInRange, formatDuration, hasCommandPermission, logMod, mentionEveryoneWarningField, parseDuration, purgeChannels, purgeNotes };

// Permission checks, mod-log posting, durations, bulk delete and the @everyone ping check.
const { ActionRowBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, RoleSelectMenuBuilder } = require('discord.js');
const { getConfig } = require('./db');

// ── Helpers ────────────────────────────────────────────────────────────────
async function logMod(guild, guildId, embed) { const cfg = await getConfig(guildId); const ch = cfg.logChannelId && guild.channels.cache.get(cfg.logChannelId); if (ch) ch.send({ embeds: [embed] }).catch(() => {}); }

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

async function showAccessControlConfig(interaction, guildId) {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('🔒 Access Configuration').setDescription('Select which role should have access to moderation commands:\n\n**Commands affected:**\n• `/warning give` `/warning remove` `/timeout` `/config set/view`\n• `/config access` `/warning list` `/warning history` `/escalation`\n\n**Note:** Server administrators always have access.').setFooter({ text: 'Select a role from the dropdown below' })], components: [new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`access_role_${guildId}`).setPlaceholder('Select a role for command access').setMinValues(1).setMaxValues(1))], flags: [MessageFlags.Ephemeral] });
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
async function bulkDeleteInRange(channel, { userId, since, maxCount = Infinity } = {}) {
    let deleted = 0, lastId;
    const MAX_AGE = 1_209_600_000; // 14 days — Discord bulkDelete limit
    try {
        do {
            const fetched = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
            if (!fetched.size) break;
            const eligible = fetched.filter(m => (!userId || m.author.id === userId) && (!since || m.createdTimestamp >= since) && (Date.now() - m.createdTimestamp < MAX_AGE));
            const batch = [...eligible.values()].slice(0, maxCount - deleted);
            if (batch.length) { await channel.bulkDelete(batch).catch(e => console.error(`bulkDelete failed in ${channel.id}:`, e.message)); deleted += batch.length; }
            if (deleted >= maxCount || (since && fetched.last()?.createdTimestamp < since)) break;
            lastId = fetched.last()?.id;
        } while (true);
    } catch (e) {
        console.error(`bulkDeleteInRange failed in channel ${channel.id}:`, e.message);
    }
    return deleted;
}

module.exports = { bulkDeleteInRange, formatDuration, hasCommandPermission, logMod, mentionEveryoneWarningField, parseDuration, showAccessControlConfig };

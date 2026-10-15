// /config and /escalation.
const { MessageFlags } = require('discord.js');
const { formatDuration, parseDuration, showAccessControlConfig } = require('../helpers');
const { getConfig, saveConfig } = require('../db');
const { buildConfigViewEmbed, buildEscalationViewEmbed, buildLogChannelEmbed } = require('../ui/embeds');
const { MAX_TIMEOUT_MS } = require('../constants');

async function runConfig(ctx) {
    const { interaction, guildId, E, reply } = ctx;
    const sub = interaction.options.getSubcommand();
    if (sub === 'access') { await showAccessControlConfig(interaction, guildId); }
    else if (sub === 'set') {
        const level = interaction.options.getInteger('level'), role = interaction.options.getRole('role'), durationStr = interaction.options.getString('duration');
        if (level < 1 || level > 100) return reply('❌ Level must be between 1 and 100.');
        const dur = parseDuration(durationStr); if (!dur) return reply('❌ Invalid duration. Use `m:s`, `h:m:s`, `d:h:m:s`, or `forever`. Max 365 days.');
        const cfg = await getConfig(guildId); cfg.levels ??= {};
        cfg.levels[level] = { roleId: role.id, roleName: role.name, durationMs: dur.totalMs, isForever: dur.isForever, durationDisplay: formatDuration(dur.days, dur.hours, dur.minutes, dur.seconds, dur.isForever) };
        saveConfig(guildId, cfg);
        await reply({ embeds: [E('#00ff00','Warning Level Configured').addFields({ name: 'Level', value: `${level}`, inline: true }, { name: 'Role', value: `${role}`, inline: true }, { name: 'Duration', value: formatDuration(dur.days, dur.hours, dur.minutes, dur.seconds, dur.isForever), inline: true })], flags: [MessageFlags.Ephemeral] });
    } else if (sub === 'view') {
        const { embeds, components } = await buildConfigViewEmbed(guildId);
        await reply({ embeds, components, flags: [MessageFlags.Ephemeral] });
    } else if (sub === 'logchannel') {
        const { embeds, components } = await buildLogChannelEmbed(guildId);
        await reply({ embeds, components, flags: [MessageFlags.Ephemeral] });
    } else if (sub === 'notifications') {
        const enabled = interaction.options.getBoolean('enabled'), cfg = await getConfig(guildId); cfg.warnDm = enabled; saveConfig(guildId, cfg);
        await reply({ embeds: [E(enabled ? '#00ff00' : '#FFA500', enabled ? 'Notifications Enabled' : 'Notifications Disabled').setDescription(enabled ? "Users will be DM'd for warnings, scam removals, and spam removals." : "Users will **not** be DM'd for warnings, scam removals, or spam removals.")], flags: [MessageFlags.Ephemeral] });
    }
}

async function runEscalation(ctx) {
    const { interaction, guildId, reply } = ctx;
    const sub = interaction.options.getSubcommand(), cfg = await getConfig(guildId);
    cfg.escalation ??= { thresholds: {} }; const esc = cfg.escalation;
    if (sub === 'set') {
        const level = interaction.options.getInteger('level'), threshold = interaction.options.getInteger('threshold');
        if (level < 1 || level > 100) return reply('❌ Level must be between 1 and 100.');
        if (threshold < 2 || threshold > 50) return reply('❌ Threshold must be between 2 and 50.');
        if (!cfg.levels?.[level]) return reply(`❌ Level ${level} not configured. Use /config set first.`);
        const targetLevel = level + 1; if (!cfg.levels?.[targetLevel]) return reply(`❌ Level ${targetLevel} not configured. Use /config set first.`);
        esc.thresholds[level] = threshold; saveConfig(guildId, cfg);
        await reply(`**${threshold}x** Level ${level} → auto Level ${targetLevel}.`);
    } else if (sub === 'cap') {
        const level = interaction.options.getInteger('level'); if (level < 1 || level > 100) return reply('❌ Cap must be between 1 and 100.');
        esc.cap = level; saveConfig(guildId, cfg); await reply(`Level cap set to **${level}**.`);
    } else if (sub === 'timeout') {
        const level = interaction.options.getInteger('level'), threshold = interaction.options.getInteger('threshold'), durationStr = interaction.options.getString('duration');
        if (level < 2 || level > 100) return reply('❌ Target level must be between 2 and 100.');
        if (threshold < 2 || threshold > 50) return reply('❌ Threshold must be between 2 and 50.');
        const dur = parseDuration(durationStr); if (!dur || dur.isForever) return reply('❌ Invalid duration.'); if (dur.totalMs > MAX_TIMEOUT_MS) return reply('❌ Timeouts cannot exceed 28 days.');
        cfg.levels ??= {};
        if (!cfg.levels[level]) cfg.levels[level] = { isTimeoutLevel: true, timeoutDurationMs: dur.totalMs, timeoutDisplay: formatDuration(dur.days, dur.hours, dur.minutes, dur.seconds) };
        esc.timeouts ??= {}; esc.timeouts[level] = { durationMs: dur.totalMs, durationDisplay: formatDuration(dur.days, dur.hours, dur.minutes, dur.seconds), threshold };
        saveConfig(guildId, cfg); await reply(`Timeout escalation: **${threshold}x** Level ${level-1} → Level ${level} + **${esc.timeouts[level].durationDisplay}** timeout.`);
    } else if (sub === 'view') {
        const { embeds, components } = await buildEscalationViewEmbed(guildId);
        await reply({ embeds, components, flags: [MessageFlags.Ephemeral] });
    }
}

module.exports = { runConfig, runEscalation };

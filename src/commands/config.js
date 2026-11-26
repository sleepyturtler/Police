// /config (the two panels) and /escalation (quick rules for a warning path).
const { MAX_TIMEOUT_MS } = require('../constants');
const { getConfig } = require('../db');
const { formatDuration, parseDuration } = require('../helpers');
const P = require('../paths');
const { openSettings, openWarnings } = require('../panels');

async function runConfig(ctx) {
    const sub = ctx.interaction.options.getSubcommand();
    if (sub === 'settings') return openSettings(ctx);
    if (sub === 'warnings') return openWarnings(ctx, { pathId: ctx.interaction.options.getString('path') });
}

// Every rule lands on one path: the one in the `path` option, or the first. The Escalation tab of /config warnings does the same with buttons.
async function runEscalation(ctx) {
    const { interaction, guildId, reply } = ctx, sub = interaction.options.getSubcommand(), cfg = await getConfig(guildId), pathOpt = interaction.options.getString('path');
    if (pathOpt && !P.getPaths(cfg)[pathOpt]) return reply('\u274C Unknown path. Pick one from the list that appears as you type.');
    const path = P.getPath(cfg, pathOpt), where = P.multiPath(cfg) ? ` on **${path.name}**` : '';
    if (sub === 'view') return openWarnings(ctx, { pathId: path.id, tab: 'es' });
    const level = interaction.options.getInteger('level'), threshold = interaction.options.getInteger('threshold');
    if (sub === 'set') {
        if (level < 1 || level > 100) return reply('\u274C Level must be between 1 and 100.');
        if (threshold < 2 || threshold > 50) return reply('\u274C Threshold must be between 2 and 50.');
        const r = await P.addRule(guildId, path.id, { level, threshold, timeout: null });
        return reply(r.error ? `\u274C ${r.error}` : `**${threshold}x** Level ${level} \u2192 auto Level ${r.target}${where}.`);
    }
    if (sub === 'cap') {
        if (level < 1 || level > 100) return reply('\u274C Cap must be between 1 and 100.');
        const r = await P.setCap(guildId, path.id, level);
        return reply(r.error ? `\u274C ${r.error}` : `Level cap set to **${level}**${where}.`);
    }
    if (sub === 'timeout') { // `level` is the level reached, so the rule starts one below it
        if (level < 2 || level > 100) return reply('\u274C Target level must be between 2 and 100.');
        if (threshold < 2 || threshold > 50) return reply('\u274C Threshold must be between 2 and 50.');
        const dur = parseDuration(interaction.options.getString('duration'));
        if (!dur || dur.isForever) return reply('\u274C Invalid duration.');
        if (dur.totalMs > MAX_TIMEOUT_MS) return reply('\u274C Timeouts cannot exceed 28 days.');
        const display = formatDuration(dur.days, dur.hours, dur.minutes, dur.seconds);
        const r = await P.addRule(guildId, path.id, { level: level - 1, threshold, timeout: { ms: dur.totalMs, display } });
        return reply(r.error ? `\u274C ${r.error}` : `Timeout escalation: **${threshold}x** Level ${level - 1} \u2192 Level ${level} + **${display}** timeout${where}.`);
    }
}

module.exports = { runConfig, runEscalation };

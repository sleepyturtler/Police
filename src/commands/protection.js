// /spam and /crosspost.
const { MessageFlags } = require('discord.js');
const { getConfig, saveConfig } = require('../db');
const { formatDuration, parseDuration } = require('../helpers');
const { MAX_TIMEOUT_MS } = require('../constants');

async function runSpam(ctx) {
    const { interaction, guildId, E, reply } = ctx;
    const sub = interaction.options.getSubcommand();
    const spamEmbed = (sp) => { const s = { enabled: true, count: 5, windowMs: 10_000, timeoutMs: 10*60*1000, timeoutDisplay: '10m', deleteMsg: true, similarityThreshold: 0.7, ...sp }; return E('#ff6600','Spam Protection Config').addFields({ name: 'Detection', value: s.enabled?'Enabled':'Disabled', inline: true }, { name: 'Trigger', value: `${s.count} similar msgs within ${s.windowMs/1000}s`, inline: true }, { name: 'Similarity', value: `${Math.round(s.similarityThreshold*100)}%`, inline: true }, { name: 'Delete Messages', value: s.deleteMsg?'Yes':'No', inline: true }, { name: 'Timeout', value: s.timeoutMs?s.timeoutDisplay:'None', inline: true }); };
    if (sub === 'config') {
        const enabled = interaction.options.getBoolean('enabled'), del = interaction.options.getBoolean('delete'), count = interaction.options.getInteger('count'), window = interaction.options.getInteger('window'), toStr = interaction.options.getString('timeout'), simPct = interaction.options.getInteger('similarity');
        const cfg = await getConfig(guildId); cfg.spamProt ??= {};
        if (enabled !== null) cfg.spamProt.enabled = enabled;
        if (del !== null) cfg.spamProt.deleteMsg = del;
        if (count !== null) cfg.spamProt.count = count;
        if (window !== null) cfg.spamProt.windowMs = window * 1000;
        if (simPct !== null) cfg.spamProt.similarityThreshold = simPct / 100;
        if (toStr !== null) {
            if (toStr.toLowerCase() === 'none') { cfg.spamProt.timeoutMs = null; cfg.spamProt.timeoutDisplay = 'None'; }
            else { const dur = parseDuration(toStr); if (!dur || dur.isForever) return reply('❌ Invalid timeout.'); if (dur.totalMs > MAX_TIMEOUT_MS) return reply('❌ Timeouts cannot exceed 28 days.'); cfg.spamProt.timeoutMs = dur.totalMs; cfg.spamProt.timeoutDisplay = formatDuration(dur.days, dur.hours, dur.minutes, dur.seconds); }
        }
        saveConfig(guildId, cfg);
        await reply({ embeds: [spamEmbed(cfg.spamProt)], flags: [MessageFlags.Ephemeral] });
    } else {
        const cfg = await getConfig(guildId);
        await reply({ embeds: [spamEmbed(cfg.spamProt)], flags: [MessageFlags.Ephemeral] });
    }
}

async function runCrosspost(ctx) {
    const { interaction, guildId, E, reply } = ctx;
    const sub = interaction.options.getSubcommand();
    const cpEmbed = (cp) => { const s = { enabled: true, count: 3, windowMs: 5*60*1000, timeoutMs: 10*60*1000, timeoutDisplay: '10m', deleteMsg: true, similarityThreshold: 0.85, matchImages: true, imageThreshold: 10, ...cp }; return E('#ff6600','Cross-Channel Spam Protection Config').setDescription('Catches the same message or image copy-pasted into multiple different channels (e.g. referral/ad links, unregistered scam screenshots).').addFields({ name: 'Detection', value: s.enabled?'Enabled':'Disabled', inline: true }, { name: 'Trigger', value: `${s.count} channels within ${Math.round(s.windowMs/1000)}s`, inline: true }, { name: 'Text Similarity', value: `${Math.round(s.similarityThreshold*100)}%`, inline: true }, { name: 'Image Matching', value: s.matchImages ? `Enabled (threshold ${s.imageThreshold})` : 'Disabled', inline: true }, { name: 'Delete Messages', value: s.deleteMsg?'Yes':'No', inline: true }, { name: 'Timeout', value: s.timeoutMs?s.timeoutDisplay:'None', inline: true }); };
    if (sub === 'config') {
        const enabled = interaction.options.getBoolean('enabled'), del = interaction.options.getBoolean('delete'), count = interaction.options.getInteger('count'), window = interaction.options.getInteger('window'), toStr = interaction.options.getString('timeout'), simPct = interaction.options.getInteger('similarity'), matchImages = interaction.options.getBoolean('match_images'), imgThresh = interaction.options.getInteger('image_threshold');
        const cfg = await getConfig(guildId); cfg.crossPostProt ??= {};
        if (enabled !== null) cfg.crossPostProt.enabled = enabled;
        if (del !== null) cfg.crossPostProt.deleteMsg = del;
        if (count !== null) cfg.crossPostProt.count = count;
        if (window !== null) cfg.crossPostProt.windowMs = window * 1000;
        if (simPct !== null) cfg.crossPostProt.similarityThreshold = simPct / 100;
        if (matchImages !== null) cfg.crossPostProt.matchImages = matchImages;
        if (imgThresh !== null) cfg.crossPostProt.imageThreshold = imgThresh;
        if (toStr !== null) {
            if (toStr.toLowerCase() === 'none') { cfg.crossPostProt.timeoutMs = null; cfg.crossPostProt.timeoutDisplay = 'None'; }
            else { const dur = parseDuration(toStr); if (!dur || dur.isForever) return reply('❌ Invalid timeout.'); if (dur.totalMs > MAX_TIMEOUT_MS) return reply('❌ Timeouts cannot exceed 28 days.'); cfg.crossPostProt.timeoutMs = dur.totalMs; cfg.crossPostProt.timeoutDisplay = formatDuration(dur.days, dur.hours, dur.minutes, dur.seconds); }
        }
        saveConfig(guildId, cfg);
        await reply({ embeds: [cpEmbed(cfg.crossPostProt)], flags: [MessageFlags.Ephemeral] });
    } else {
        const cfg = await getConfig(guildId);
        await reply({ embeds: [cpEmbed(cfg.crossPostProt)], flags: [MessageFlags.Ephemeral] });
    }
}

module.exports = { runCrosspost, runSpam };

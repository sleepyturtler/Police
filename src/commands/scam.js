// /scam and /globalhashes.
const { MessageFlags } = require('discord.js');
const { MAX_TIMEOUT_MS, OWNER_ID } = require('../constants');
const { buildGlobalHashesEmbed, buildScamListEmbed } = require('../ui/embeds');
const { dHash, fetchImageBuffer, hammingDistance } = require('../scam/hashing');
const { addGlobalScamHash, addScamHash, getGlobalScamHashes, getScamHashes, getScamProtConfig } = require('../scam/store');
const { formatDuration, mentionEveryoneWarningField, parseDuration } = require('../helpers');
const { getConfig, saveConfig } = require('../db');

async function runGlobalHashes(ctx) {
    const { interaction, E, reply } = ctx;
    if (interaction.user.id !== OWNER_ID) return reply('❌ This command is restricted to the bot owner.');
    const sub = interaction.options.getSubcommand();
    if (sub === 'view') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const { embeds, components } = await buildGlobalHashesEmbed();
        await interaction.editReply({ embeds, components });
    } else if (sub === 'add') {
        const att = interaction.options.getAttachment('image'), label = interaction.options.getString('label').slice(0,100).replace(/[\x00-\x1F\x7F]/g,'');
        if (!att.contentType?.startsWith('image/') && !/\.(png|jpg|jpeg|gif|webp)$/i.test(att.name ?? '')) return reply('❌ Please attach an image file (PNG, JPG, GIF, or WebP).');
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        let buffer; try { buffer = await fetchImageBuffer(att.url); } catch (e) { return reply(`❌ Failed to download image: ${e.message}`); }
        let hash; try { hash = await dHash(buffer); } catch (e) { return reply(`❌ Failed to process image: ${e.message}`); }
        const existing = await getGlobalScamHashes();
        for (const e of existing) { if (hammingDistance(hash, e.hash) <= 10) return reply(`❌ Already registered (or similar to) **${e.label}** (ID: \`${e.id}\`).`); }
        const entry = await addGlobalScamHash(hash, label, interaction.user.tag);
        await reply({ embeds: [E('#00ff00','Global Scam Image Registered').addFields({ name: 'Label', value: label, inline: true }, { name: 'ID', value: `${entry.id}`, inline: true }, { name: 'Hash', value: `\`${hash}\``, inline: false }).setFooter({ text: 'Any similar image posted in any server will now be auto-removed and timed out' })] });
    }
}

async function runScam(ctx) {
    const { interaction, guildId, E, reply } = ctx;
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') {
        const att = interaction.options.getAttachment('image'), label = interaction.options.getString('label').slice(0,100).replace(/[\x00-\x1F\x7F]/g,'');
        if (!att.contentType?.startsWith('image/') && !/\.(png|jpg|jpeg|gif|webp)$/i.test(att.name ?? '')) return reply('❌ Please attach an image file (PNG, JPG, GIF, or WebP).');
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        let buffer; try { buffer = await fetchImageBuffer(att.url); } catch (e) { return reply(`❌ Failed to download image: ${e.message}`); }
        let hash; try { hash = await dHash(buffer); } catch (e) { return reply(`❌ Failed to process image: ${e.message}`); }
        const existing = await getScamHashes(guildId), spc = await getScamProtConfig(guildId);
        for (const e of existing) { if (hammingDistance(hash, e.hash) <= spc.threshold) return reply(`❌ Already registered (or similar to) **${e.label}** (ID: \`${e.id}\`).`); }
        const entry = await addScamHash(guildId, hash, label, interaction.user.tag);
        const addEmbed = E('#00ff00','Scam Image Registered').addFields({ name: 'Label', value: label, inline: true }, { name: 'ID', value: `${entry.id}`, inline: true }, { name: 'Hash', value: `\`${hash}\``, inline: false }).setFooter({ text: 'Any similar image posted in this server will now be actioned' });
        const addWarnField = mentionEveryoneWarningField(interaction.guild); if (addWarnField) addEmbed.addFields(addWarnField);
        await reply({ embeds: [addEmbed] });
    } else if (sub === 'list') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const { embeds, components } = await buildScamListEmbed(guildId);
        await interaction.editReply({ embeds, components });
    } else if (sub === 'config') {
        const enabled = interaction.options.getBoolean('enabled'), del = interaction.options.getBoolean('delete'), toStr = interaction.options.getString('timeout'), thresh = interaction.options.getInteger('threshold');
        const cfg = await getConfig(guildId); cfg.scamProt ??= {};
        if (enabled !== null) cfg.scamProt.enabled = enabled;
        if (del !== null) cfg.scamProt.deleteMsg = del;
        if (thresh !== null) cfg.scamProt.threshold = thresh;
        if (toStr !== null) {
            if (toStr.toLowerCase() === 'none') { cfg.scamProt.timeoutMs = null; cfg.scamProt.timeoutDisplay = 'None'; }
            else { const dur = parseDuration(toStr); if (!dur || dur.isForever) return reply('❌ Invalid timeout.'); if (dur.totalMs > MAX_TIMEOUT_MS) return reply('❌ Timeouts cannot exceed 28 days.'); cfg.scamProt.timeoutMs = dur.totalMs; cfg.scamProt.timeoutDisplay = formatDuration(dur.days, dur.hours, dur.minutes, dur.seconds); }
        }
        saveConfig(guildId, cfg);
        const spc = { enabled: true, threshold: 10, timeoutMs: 5*60*1000, timeoutDisplay: '5m', deleteMsg: true, ...cfg.scamProt };
        const cfgEmbed = E('#5865F2','Scam Protection Config').addFields({ name: 'Detection', value: spc.enabled?'Enabled':'Disabled', inline: true }, { name: 'Delete Messages', value: spc.deleteMsg?'Yes':'No', inline: true }, { name: 'Timeout', value: spc.timeoutMs?spc.timeoutDisplay:'None', inline: true }, { name: 'Threshold', value: `${spc.threshold}`, inline: true });
        const cfgWarnField = mentionEveryoneWarningField(interaction.guild); if (cfgWarnField) cfgEmbed.addFields(cfgWarnField);
        await reply({ embeds: [cfgEmbed], flags: [MessageFlags.Ephemeral] });
    }
}

module.exports = { runGlobalHashes, runScam };

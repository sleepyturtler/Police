// /scam and /globalhashes.
const { MessageFlags } = require('discord.js');
const { MAX_TIMEOUT_MS, OWNER_ID, SCAM_GLOBAL_THRESHOLD } = require('../constants');
const { buildGlobalHashesEmbed, buildScamListEmbed } = require('../ui/embeds');
const { computeSignature, fetchImageBuffer } = require('../scam/hashing');
const { findMatch } = require('../scam/match');
const { addGlobalScamHash, addScamHash, getGlobalScamHashes, getScamHashes, getScamProtConfig, upgradeGlobalScamHash, upgradeScamHash } = require('../scam/store');
const { formatDuration, mentionEveryoneWarningField, parseDuration } = require('../helpers');
const { getConfig, saveConfig } = require('../db');

// Shown after registering an image: its label, ID and hashes, plus a warning when it has too little detail to match reliably.
function signatureEmbed(E, title, entry, sig, footer) {
    const embed = E('#00ff00', title).addFields({ name: 'Label', value: entry.label, inline: true }, { name: 'ID', value: `${entry.id}`, inline: true }, { name: 'Hash', value: `\`${sig.dhash}\` / \`${sig.phash}\``, inline: false }).setFooter({ text: footer });
    if (sig.flat) embed.addFields({ name: '⚠️ Low detail', value: 'This image has very little detail (mostly flat colour), so its hash is weak. It will only match near-exact copies. A screenshot with more visible content works much better.' });
    return embed;
}

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
        let sig; try { sig = await computeSignature(buffer); } catch (e) { return reply(`❌ Failed to process image: ${e.message}`); }
        // An old dHash-only entry that this image matches almost exactly is upgraded in place with a full signature.
        const dup = findMatch(sig, await getGlobalScamHashes(), { threshold: SCAM_GLOBAL_THRESHOLD, legacyMax: 2 });
        if (dup?.legacy) { const up = await upgradeGlobalScamHash(dup.entry.id, sig); if (up) return reply({ embeds: [signatureEmbed(E, 'Global Scam Image Upgraded', up, sig, 'The old entry now has a full signature, so it is checked far more strictly')] }); }
        else if (dup) return reply(`❌ Already registered (or similar to) **${dup.entry.label}** (ID: \`${dup.entry.id}\`).`);
        const entry = await addGlobalScamHash(sig, label, interaction.user.tag);
        await reply({ embeds: [signatureEmbed(E, 'Global Scam Image Registered', entry, sig, 'Any similar image posted in any server will now be auto-removed and timed out')] });
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
        let sig; try { sig = await computeSignature(buffer); } catch (e) { return reply(`❌ Failed to process image: ${e.message}`); }
        const existing = await getScamHashes(guildId), spc = await getScamProtConfig(guildId);
        // An old dHash-only entry that this image matches almost exactly is upgraded in place with a full signature.
        const dup = findMatch(sig, existing, { threshold: spc.threshold, legacyMax: 2 });
        if (dup && !dup.legacy) return reply(`❌ Already registered (or similar to) **${dup.entry.label}** (ID: \`${dup.entry.id}\`).`);
        const up = dup ? await upgradeScamHash(guildId, dup.entry.id, sig) : null;
        const entry = up ?? await addScamHash(guildId, sig, label, interaction.user.tag);
        const addEmbed = signatureEmbed(E, up ? 'Scam Image Upgraded' : 'Scam Image Registered', entry, sig, up ? 'The old entry now has a full signature, so it is checked far more strictly' : 'Any similar image posted in this server will now be actioned');
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
        const spc = await getScamProtConfig(guildId);
        const cfgEmbed = E('#5865F2','Scam Protection Config').addFields({ name: 'Detection', value: spc.enabled?'Enabled':'Disabled', inline: true }, { name: 'Delete Messages', value: spc.deleteMsg?'Yes':'No', inline: true }, { name: 'Timeout', value: spc.timeoutMs?spc.timeoutDisplay:'None', inline: true }, { name: 'Threshold', value: `${spc.threshold}`, inline: true });
        const cfgWarnField = mentionEveryoneWarningField(interaction.guild); if (cfgWarnField) cfgEmbed.addFields(cfgWarnField);
        await reply({ embeds: [cfgEmbed], flags: [MessageFlags.Ephemeral] });
    }
}

module.exports = { runGlobalHashes, runScam };

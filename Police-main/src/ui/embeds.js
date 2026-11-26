// Embed and component builders for list, config and note views.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { activeTimeouts, activeWarnings, configCache, getNotes } = require('../db');
const { getPath, multiPath, warningPathId } = require('../paths');
const { getGlobalScamHashes, getScamHashes, getScamProtConfig } = require('../scam/store');
const { client } = require('../client');
const { SCAM_GLOBAL_THRESHOLD } = require('../constants');
const { mentionEveryoneWarningField } = require('../helpers');

// ── Warnlist / Help ────────────────────────────────────────────────────────
function activeTimeoutsField(guildId) {
    const now = Date.now();
    const list = [...activeTimeouts.values()].filter(t => t.guildId === guildId && t.expiresAt > now);
    if (!list.length) return null;
    const shown = list.slice(0, 15).map(t => `• ${t.userTag} — ${t.durationDisplay ? `${t.durationDisplay}, ` : ''}expires <t:${Math.floor(t.expiresAt / 1000)}:R>`).join('\n');
    return { name: `⏱️ Active Timeouts (${list.length})`, value: list.length > 15 ? `${shown}\n*…and ${list.length - 15} more*` : shown };
}

function buildWarnlistEmbed(guildId, page) {
    const all = [...activeWarnings.values()].filter(w => w.guildId === guildId), byUser = {};
    for (const w of all) { byUser[w.userId] ??= []; byUser[w.userId].push(w); }
    const userIds = Object.keys(byUser), total = Math.max(1, Math.ceil(userIds.length / 10));
    page = Math.max(0, Math.min(page, total - 1));
    const embed = new EmbedBuilder().setColor('#FFA500').setTitle(`Active Warnings (${all.length})`).setTimestamp().setFooter({ text: total > 1 ? `Page ${page + 1} of ${total}` : `${userIds.length} user(s) warned` });
    const cfg = configCache.get(guildId), multi = !!cfg && multiPath(cfg); // path names are only shown when the server has more than one
    const toField = activeTimeoutsField(guildId);
    if (!userIds.length) { embed.setDescription('No active warnings in this server.'); if (toField) embed.addFields(toField); return { embed, totalPages: total, page }; }
    for (const uid of userIds.slice(page * 10, (page + 1) * 10)) {
        const w0 = byUser[uid][0];
        embed.addFields({ name: w0.userTag || `<@${uid}>`, value: byUser[uid].map(w => `• Level ${w.level}${multi ? ` (${getPath(cfg, warningPathId(w, cfg)).name})` : ''} — ${w.isForever ? 'Permanent' : `expires <t:${Math.floor(w.expiresAt / 1000)}:R>`}`).join('\n') });
    }
    if (page === 0 && toField) embed.addFields(toField);
    return { embed, totalPages: total, page };
}

function warnlistRow(page, total, guildId) {
    const refresh = new ButtonBuilder().setCustomId(`wl_${page}_${guildId}`).setLabel('↻ Refresh').setStyle(ButtonStyle.Secondary);
    if (total <= 1) return [new ActionRowBuilder().addComponents(refresh)];
    return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`wl_${page - 1}_${guildId}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page === 0), refresh, new ButtonBuilder().setCustomId(`wl_${page + 1}_${guildId}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page === total - 1))];
}

const refreshBtn = (id) => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(id).setLabel('↻ Refresh').setStyle(ButtonStyle.Secondary));

const customIdMatches = (id, prefixes) => prefixes.some(p => id.startsWith(p));

// Entries registered before full signatures existed are checked more strictly; re-adding the image upgrades them.
const legacyNote = h => h.thumb ? '' : '\n⚠️ Old format (hash only). Re-add this image with the add command to upgrade it.';

async function buildGlobalHashesEmbed() {
    const hashes = await getGlobalScamHashes();
    if (!hashes.length) return { embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('Global Scam Image Registry').setDescription('No global scam images registered.')], components: [] };
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('Global Scam Image Registry').setTimestamp().setDescription(`**${hashes.length}** image${hashes.length>1?'s':''} registered — applies to **all servers**, always deletes + times out (distance threshold ${SCAM_GLOBAL_THRESHOLD}).`);
    for (const h of hashes.slice(0,20)) embed.addFields({ name: `ID ${h.id} — ${h.label}`, value: `Hash: \`${h.hash}\`${legacyNote(h)}` });
    if (hashes.length > 20) embed.setFooter({ text: `Showing first 20 of ${hashes.length}` });
    const components = [refreshBtn('globalhashes_refresh')];
    components.unshift(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('globalhashes_remove').setPlaceholder('Remove a global scam image…').addOptions(hashes.slice(0,25).map(h => ({ label: `ID ${h.id} — ${h.label}`.slice(0,100), value: `${h.id}` })))));
    return { embeds: [embed], components };
}

async function buildScamListEmbed(guildId) {
    const hashes = await getScamHashes(guildId), spc = await getScamProtConfig(guildId), meGuild = client.guilds.cache.get(guildId), warnField = meGuild ? mentionEveryoneWarningField(meGuild) : null;
    if (!hashes.length) { const emptyEmbed = new EmbedBuilder().setColor('#5865F2').setTitle('Scam Image Registry').setDescription('No scam images registered. Use `/scam add` to add one.'); if (warnField) emptyEmbed.addFields(warnField); return { embeds: [emptyEmbed], components: [] }; }
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('Scam Image Registry').setTimestamp().setDescription(`**${hashes.length}** image${hashes.length>1?'s':''} registered — detection **${spc.enabled?'enabled':'disabled'}**`).addFields({ name: 'Threshold', value: `${spc.threshold} (Hamming distance)`, inline: true }, { name: 'On Detection', value: [spc.deleteMsg?'Delete message':null, spc.timeoutMs?`Timeout ${spc.timeoutDisplay}`:null].filter(Boolean).join(' + ')||'No action', inline: true });
    if (warnField) embed.addFields(warnField);
    for (const h of hashes.slice(0,20)) embed.addFields({ name: `ID ${h.id} — ${h.label}`, value: `Hash: \`${h.hash}\` · Added by ${h.addedBy} <t:${Math.floor(h.addedAt/1000)}:R>${legacyNote(h)}` });
    if (hashes.length > 20) embed.setFooter({ text: `Showing first 20 of ${hashes.length}` });
    const components = [refreshBtn(`scamlist_refresh_${guildId}`)];
    components.unshift(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`scamlist_remove_${guildId}`).setPlaceholder('Remove a scam image…').addOptions(hashes.slice(0,25).map(h => ({ label: `ID ${h.id} — ${h.label}`.slice(0,100), value: `${h.id}` })))));
    return { embeds: [embed], components };
}

async function buildNoteViewEmbed(guildId, user) {
    const notes = await getNotes(guildId, user.id);
    if (!notes.length) return { embeds: [new EmbedBuilder().setColor('#5865F2').setTitle(`Notes — ${user.tag}`).setDescription('No notes found for this user.')], components: [] };
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`Notes — ${user.tag}`).setTimestamp().setDescription(`${notes.length} note${notes.length>1?'s':''} on record.`);
    const shown = notes.slice(-10);
    for (const n of shown) embed.addFields({ name: `ID: ${n.id} — <t:${Math.floor(n.addedAt/1000)}:d> — ${n.addedBy}`, value: n.text });
    if (notes.length > 10) embed.setFooter({ text: `Showing last 10 of ${notes.length} notes` });
    const components = [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`noteview_remove_${guildId}_${user.id}`).setPlaceholder('Remove a note…').addOptions(shown.slice(0,25).map(n => ({ label: `ID ${n.id} — ${n.text.slice(0,80)}`.slice(0,100), value: `${n.id}` }))))];
    return { embeds: [embed], components };
}

async function buildNoteListEmbed(guildId, user) {
    const notes = await getNotes(guildId, user.id);
    if (!notes.length) return new EmbedBuilder().setColor('#5865F2').setTitle(`Notes — ${user.tag}`).setDescription('No notes found for this user.');
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`Notes — ${user.tag}`).setTimestamp().setDescription(`${notes.length} note${notes.length>1?'s':''} on record.`);
    const shown = notes.slice(-25);
    for (const n of shown) embed.addFields({ name: `ID: ${n.id} — <t:${Math.floor(n.addedAt/1000)}:d> — ${n.addedBy}`, value: n.text });
    if (notes.length > 25) embed.setFooter({ text: `Showing last 25 of ${notes.length} notes` });
    return embed;
}

module.exports = { buildGlobalHashesEmbed, buildNoteListEmbed, buildNoteViewEmbed, buildScamListEmbed, buildWarnlistEmbed, customIdMatches, refreshBtn, warnlistRow };

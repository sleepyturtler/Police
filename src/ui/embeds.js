// Embed and component builders for list, config and note views.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { activeTimeouts, activeWarnings, getConfig, getNotes } = require('../db');
const { getGlobalScamHashes, getScamHashes, getScamProtConfig } = require('../scam/store');
const { client } = require('../client');
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
    const toField = activeTimeoutsField(guildId);
    if (!userIds.length) { embed.setDescription('No active warnings in this server.'); if (toField) embed.addFields(toField); return { embed, totalPages: total, page }; }
    for (const uid of userIds.slice(page * 10, (page + 1) * 10)) {
        const w0 = byUser[uid][0];
        embed.addFields({ name: w0.userTag || `<@${uid}>`, value: byUser[uid].map(w => `• Level ${w.level} — ${w.isForever ? 'Permanent' : `expires <t:${Math.floor(w.expiresAt / 1000)}:R>`}`).join('\n') });
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

async function buildGlobalHashesEmbed() {
    const hashes = await getGlobalScamHashes();
    if (!hashes.length) return { embeds: [new EmbedBuilder().setColor('#ff0000').setTitle('Global Scam Image Registry').setDescription('No global scam images registered.')], components: [] };
    const embed = new EmbedBuilder().setColor('#ff0000').setTitle('Global Scam Image Registry').setTimestamp().setDescription(`**${hashes.length}** image${hashes.length>1?'s':''} registered — applies to **all servers**, always deletes + times out (10 Hamming distance threshold).`);
    for (const h of hashes.slice(0,20)) embed.addFields({ name: `ID ${h.id} — ${h.label}`, value: `Hash: \`${h.hash}\`` });
    if (hashes.length > 20) embed.setFooter({ text: `Showing first 20 of ${hashes.length}` });
    const components = [refreshBtn('globalhashes_refresh')];
    components.unshift(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('globalhashes_remove').setPlaceholder('Remove a global scam image…').addOptions(hashes.slice(0,25).map(h => ({ label: `ID ${h.id} — ${h.label}`.slice(0,100), value: `${h.id}` })))));
    return { embeds: [embed], components };
}

async function buildScamListEmbed(guildId) {
    const hashes = await getScamHashes(guildId), spc = await getScamProtConfig(guildId), meGuild = client.guilds.cache.get(guildId), warnField = meGuild ? mentionEveryoneWarningField(meGuild) : null;
    if (!hashes.length) { const emptyEmbed = new EmbedBuilder().setColor('#ff0000').setTitle('Scam Image Registry').setDescription('No scam images registered. Use `/scam add` to add one.'); if (warnField) emptyEmbed.addFields(warnField); return { embeds: [emptyEmbed], components: [] }; }
    const embed = new EmbedBuilder().setColor('#ff0000').setTitle('Scam Image Registry').setTimestamp().setDescription(`**${hashes.length}** image${hashes.length>1?'s':''} registered — detection **${spc.enabled?'enabled':'disabled'}**`).addFields({ name: 'Threshold', value: `${spc.threshold} (Hamming distance)`, inline: true }, { name: 'On Detection', value: [spc.deleteMsg?'Delete message':null, spc.timeoutMs?`Timeout ${spc.timeoutDisplay}`:null].filter(Boolean).join(' + ')||'No action', inline: true });
    if (warnField) embed.addFields(warnField);
    for (const h of hashes.slice(0,20)) embed.addFields({ name: `ID ${h.id} — ${h.label}`, value: `Hash: \`${h.hash}\` · Added by ${h.addedBy} <t:${Math.floor(h.addedAt/1000)}:R>` });
    if (hashes.length > 20) embed.setFooter({ text: `Showing first 20 of ${hashes.length}` });
    const components = [refreshBtn(`scamlist_refresh_${guildId}`)];
    components.unshift(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`scamlist_remove_${guildId}`).setPlaceholder('Remove a scam image…').addOptions(hashes.slice(0,25).map(h => ({ label: `ID ${h.id} — ${h.label}`.slice(0,100), value: `${h.id}` })))));
    return { embeds: [embed], components };
}

async function buildLogChannelEmbed(guildId) {
    const cfg = await getConfig(guildId);
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('Mod-Log Channel').setTimestamp()
        .setDescription(cfg.logChannelId ? `Mod actions are currently logged to <#${cfg.logChannelId}>.` : 'No mod-log channel is currently set.');
    const row1 = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`logchannel_select_${guildId}`).setPlaceholder('Select a channel…').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1));
    const components = [row1];
    if (cfg.logChannelId) components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`removelogchannel_${guildId}`).setLabel('Remove Log Channel').setStyle(ButtonStyle.Danger)));
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

async function buildConfigViewEmbed(guildId) {
    const cfg = await getConfig(guildId);
    if (!cfg.levels || !Object.keys(cfg.levels).length) return { embeds: [new EmbedBuilder().setColor('#0099ff').setTitle('Warning Configuration').setDescription('📋 No warning levels configured yet.')], components: [] };
    const embed = new EmbedBuilder().setColor('#0099ff').setTitle('Warning Configuration').setTimestamp(), normalLevels = {}, timeoutLevels = {};
    for (const [lvl, d] of Object.entries(cfg.levels)) { if (d.isTimeoutLevel) timeoutLevels[lvl] = d; else normalLevels[lvl] = d; }
    if (Object.keys(normalLevels).length) for (const [lvl, d] of Object.entries(normalLevels)) embed.addFields({ name: `Level ${lvl}`, value: `Role: <@&${d.roleId}>\nDuration: ${d.durationDisplay}`, inline: true });
    if (Object.keys(timeoutLevels).length) embed.addFields({ name: '⏱️ Timeout Levels (Auto-Escalation)', value: Object.entries(timeoutLevels).sort(([a],[b])=>a-b).map(([lvl,t])=>`• **Level ${lvl}** — Timeout: **${t.timeoutDisplay}**`).join('\n'), inline: false });
    embed.addFields({ name: 'Notifications', value: cfg.warnDm === false ? 'Disabled' : 'Enabled', inline: true });
    const components = [refreshBtn(`configview_refresh_${guildId}`)];
    const levelKeys = Object.keys(cfg.levels);
    if (levelKeys.length) components.unshift(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`configview_removelevel_${guildId}`).setPlaceholder('Remove a warning level…').addOptions(levelKeys.slice(0,25).map(lvl => ({ label: `Level ${lvl}${cfg.levels[lvl].roleName ? ` — ${cfg.levels[lvl].roleName}` : ''}`, value: lvl })))));
    return { embeds: [embed], components };
}

async function buildEscalationViewEmbed(guildId) {
    const cfg = await getConfig(guildId), esc = cfg.escalation ?? {}, th = esc.thresholds ?? {}, to = esc.timeouts ?? {};
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('Escalation Configuration').setTimestamp();
    if (!Object.keys(th).length && !esc.cap && !Object.keys(to).length) embed.setDescription('No escalation rules configured. Use `/escalation set` to add thresholds.');
    else {
        if (Object.keys(th).length) embed.addFields({ name: 'Thresholds', value: Object.entries(th).sort(([a],[b])=>a-b).map(([l,t])=>`• **${t}x** Level ${l} → auto Level ${parseInt(l)+1}`).join('\n') });
        if (Object.keys(to).length) embed.addFields({ name: 'Timeouts on Escalation', value: Object.entries(to).sort(([a],[b])=>a-b).map(([l,t])=>`• ${t.threshold}x Level ${parseInt(l)-1} → auto Level ${l} + **${t.durationDisplay}** timeout`).join('\n') });
        embed.addFields({ name: 'Level Cap', value: esc.cap ? `Level **${esc.cap}**` : 'None' });
    }
    const components = [];
    const thKeys = Object.keys(th), toKeys = Object.keys(to);
    if (thKeys.length) components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`escview_removethreshold_${guildId}`).setPlaceholder('Remove a threshold…').addOptions(thKeys.slice(0,25).map(l => ({ label: `Level ${l} (${th[l]}x → Level ${parseInt(l)+1})`, value: l })))));
    if (toKeys.length) components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`escview_removetimeout_${guildId}`).setPlaceholder('Remove a timeout escalation…').addOptions(toKeys.slice(0,25).map(l => ({ label: `Level ${l} (${to[l].threshold}x → +${to[l].durationDisplay} timeout)`, value: l })))));
    const lastRow = [refreshBtn(`escalationview_refresh_${guildId}`).components[0]];
    if (esc.cap) lastRow.push(new ButtonBuilder().setCustomId(`escview_removecap_${guildId}`).setLabel('Remove Level Cap').setStyle(ButtonStyle.Danger));
    components.push(new ActionRowBuilder().addComponents(...lastRow));
    return { embeds: [embed], components };
}

module.exports = { buildConfigViewEmbed, buildEscalationViewEmbed, buildGlobalHashesEmbed, buildLogChannelEmbed, buildNoteListEmbed, buildNoteViewEmbed, buildScamListEmbed, buildWarnlistEmbed, customIdMatches, refreshBtn, warnlistRow };

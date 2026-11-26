// /warning and /mywarnings.
const { ActionRowBuilder, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const { activeWarnings, getConfig, getHistory } = require('../db');
const { pendingUnwarns } = require('../warnings');
const { formatDuration } = require('../helpers');
const { defaultPathId, getPaths, getPath, multiPath, warningPathId } = require('../paths');
const { issueWarning, startFlow } = require('../warnflow');
const { buildWarnlistEmbed, refreshBtn, warnlistRow } = require('../ui/embeds');

// /warning give user:           guided flow (path, offense, details, confirmation)
// /warning give user level:     one step, on the chosen path (or the first one), as before
async function runWarningGive(ctx) {
    const { interaction, guildId, reply } = ctx;
    const user = interaction.options.getUser('user'), level = interaction.options.getInteger('level'), pathOpt = interaction.options.getString('path'), reasonOpt = interaction.options.getString('reason');
    // getMember comes with the command itself; the member cache is capped per server, so cache.get alone can miss real members.
    const member = interaction.options.getMember('user') ?? await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return reply(`❌ ${user} is not in this server.`);
    const cfg = await getConfig(guildId);
    if (pathOpt && !getPaths(cfg)[pathOpt]) return reply('❌ Unknown path. Pick one from the list that appears as you type.');
    if (level === null) return startFlow(ctx, { user, member, pathId: pathOpt, reason: reasonOpt });
    if (level < 1 || level > 100) return reply('❌ Level must be between 1 and 100.');
    const reason = (reasonOpt || 'No reason provided').slice(0, 1000).replace(/[\x00-\x1F\x7F]/g, '');
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    try {
        const r = await issueWarning({ guild: interaction.guild, issuer: interaction.user, channelId: interaction.channel.id, user, member, pathId: pathOpt ?? defaultPathId(cfg), level, reason });
        if (r.error) return reply(`❌ ${r.error}`);
        await reply({ embeds: [r.embed] });
    } catch (e) { console.error(e); await reply('❌ Failed to assign warning. Check permissions.'); }
}

async function runWarningRemove(ctx) {
    const { interaction, guildId, E, reply } = ctx;
    const user = interaction.options.getUser('user'), member = interaction.guild.members.cache.get(user.id);
    if (!member) return reply(`❌ ${user} is not in this server.`);
    const userWarnings = [...activeWarnings.entries()].filter(([, w]) => w.guildId === guildId && w.userId === user.id);
    if (!userWarnings.length) return reply(`❌ ${user} has no active warnings.`);
    const cfg = await getConfig(guildId), multi = multiPath(cfg), whichPath = w => (multi ? ` (${getPath(cfg, warningPathId(w, cfg)).name})` : '');
    const embed = E('#FFA500','⚠️ Remove a Warning').setDescription(`${user} has **${userWarnings.length}** active warning${userWarnings.length>1?'s':''}. Select one below to remove it.`).setFooter({ text: 'Expires in 60 seconds' });
    const options = userWarnings.slice(0, 25).map(([key, w]) => {
        let expires;
        if (w.isForever) expires = 'Permanent';
        else { const s = Math.max(0, Math.floor((w.expiresAt - Date.now()) / 1000)), d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60), sec = s%60; expires = `Expires in ${[d&&`${d}d`,h&&`${h}h`,m&&`${m}m`,(!d&&!h)&&`${sec}s`].filter(Boolean).join(' ')||'<1m'}`; }
        embed.addFields({ name: `Level ${w.level} — ${w.roleName}${whichPath(w)}`, value: `${expires}${w.offense ? `\nOffense: ${w.offense}` : ''}\nReason: ${(w.reason||'No reason').slice(0,100)}` });
        return { label: `Level ${w.level} — ${w.roleName}${whichPath(w)}`.slice(0, 100), description: `${expires} · ${(w.reason||'No reason').slice(0,50)}`, value: key };
    });
    const pendingId = interaction.id;
    pendingUnwarns.set(pendingId, { targetUserId: user.id, targetUserTag: user.tag, guildId, modId: interaction.user.id });
    setTimeout(() => pendingUnwarns.delete(pendingId), 60_000);
    await reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`unwarn_select_${pendingId}`).setPlaceholder('Select a warning to remove…').addOptions(options))], flags: [MessageFlags.Ephemeral] });
}

async function runMyWarnings(ctx) {
    const { interaction, guildId, E, reply } = ctx;
    const userWarnings = [...activeWarnings.values()].filter(w => w.guildId === guildId && w.userId === interaction.user.id);
    if (!userWarnings.length) return reply('You have no active warnings!');
    const cfg = await getConfig(guildId), embed = E('#FFA500','Your Active Warnings').setDescription(`You have ${userWarnings.length} active warning${userWarnings.length>1?'s':''}`).setFooter({ text: 'Warnings are automatically removed when they expire' });
    for (const w of userWarnings) {
        const pth = getPath(cfg, warningPathId(w, cfg)), lc = pth.levels?.[w.level], name = `Level ${w.level} — ${lc?.roleName || w.roleName || 'Unknown Role'}${multiPath(cfg) ? ` (${pth.name})` : ''}`;
        if (w.isForever) embed.addFields({ name, value: ' **Duration:** Forever\n **Status:** Permanent' });
        else { const t = w.expiresAt - Date.now(); embed.addFields({ name, value: t <= 0 ? 'Expired (will be removed shortly)' : (() => { const s = Math.floor(t/1000); return `**Time Left:** ${formatDuration(Math.floor(s/86400),Math.floor((s%86400)/3600),Math.floor((s%3600)/60),s%60)}\n**Expires:** <t:${Math.floor(w.expiresAt/1000)}:F>`; })() }); }
    }
    await reply({ embeds: [embed], components: [refreshBtn(`mywarnings_refresh_${interaction.user.id}`)], flags: [MessageFlags.Ephemeral] });
}

async function runWarningList(ctx) {
    const { guildId, reply } = ctx;
    const { embed, totalPages, page } = buildWarnlistEmbed(guildId, 0);
    await reply({ embeds: [embed], components: warnlistRow(page, totalPages, guildId), flags: [MessageFlags.Ephemeral] });
}

async function runWarningHistory(ctx) {
    const { interaction, guildId, E } = ctx;
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const user = interaction.options.getUser('user'), entries = await getHistory(guildId, user.id);
    if (!entries.length) return interaction.editReply({ content: `❌ No warning history found for ${user}.` });
    const embed = E('#5865F2',`Warning History — ${user.tag}`).setDescription(`Showing last ${entries.length} record${entries.length>1?'s':''}.`);
    for (const e of entries) {
        const dateStr = `<t:${Math.floor(e.issuedAt/1000)}:d>`;
        if (e.type === 'kick') embed.addFields({ name: `Kick — ${dateStr}`, value: `by ${e.issuedBy}\n${e.reason}` });
        else if (e.type === 'ban') embed.addFields({ name: `Ban — ${dateStr}`, value: `by ${e.issuedBy}\n${e.reason}` });
        else if (e.type === 'unban') embed.addFields({ name: `Unban — ${dateStr}`, value: `by ${e.issuedBy}\n${e.reason}` });
        else if (e.type === 'timeout') embed.addFields({ name: `Timeout (${e.duration || 'Unknown'}) — ${dateStr}`, value: `by ${e.issuedBy}\n${e.reason}` });
        else if (e.type === 'timeout_remove') embed.addFields({ name: `Timeout Removed — ${dateStr}`, value: `by ${e.issuedBy}\n${e.reason}` });
        else if (e.type === 'scam_remove') embed.addFields({ name: `Scam Message Removed — ${dateStr}`, value: `by ${e.issuedBy}\n${e.reason}` });
        else if (e.type === 'spam_remove') embed.addFields({ name: `Spam Messages Removed — ${dateStr}`, value: `by ${e.issuedBy}\n${e.reason}` });
        else if (e.type === 'sting_remove') embed.addFields({ name: `Sting Operation${e.stingLevel ? ` (${e.stingLevel})` : ''} - ${dateStr}`, value: `by ${e.issuedBy}\n${e.reason}` });
        else if (e.type === 'crosspost_remove') embed.addFields({ name: `Cross-Channel Spam Removed — ${dateStr}`, value: `by ${e.issuedBy}\n${e.reason}` });
        else { const s = e.endReason==='expired'?'Expired':e.endReason==='manual'?'Removed':'Active'; embed.addFields({ name: `Level ${e.level} — ${e.roleName}${e.pathName ? ` (${e.pathName})` : ''} — ${dateStr}`, value: `${s} • by ${e.issuedBy}${e.offense ? `\nOffense: ${e.offense}` : ''}\n${e.reason}` }); }
    }
    await interaction.editReply({ embeds: [embed] });
}

module.exports = { runMyWarnings, runWarningGive, runWarningHistory, runWarningList, runWarningRemove };

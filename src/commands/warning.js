// /warning and /mywarnings.
const { ActionRowBuilder, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder } = require('discord.js');
const { activeWarnings, getConfig, getHistory } = require('../db');
const { applyWarning, checkEscalation, pendingUnwarns } = require('../warnings');
const { formatDuration, logMod } = require('../helpers');
const { buildWarnlistEmbed, refreshBtn, warnlistRow } = require('../ui/embeds');

async function runWarningGive(ctx) {
    const { interaction, guildId, E, reply } = ctx;
    const user = interaction.options.getUser('user'), member = interaction.guild.members.cache.get(user.id);
    const level = interaction.options.getInteger('level'), reason = (interaction.options.getString('reason') || 'No reason provided').slice(0,1000).replace(/[\x00-\x1F\x7F]/g,'');
    if (level < 1 || level > 100) return reply('❌ Level must be between 1 and 100.');
    if (!member) return reply(`❌ ${user} is not in this server.`);
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const cfg = await getConfig(guildId);
    if (!cfg.levels?.[level]) return reply(`❌ Level ${level} is not configured. Use /config set first.`);
    const botMember = interaction.guild.members.me, configRole = interaction.guild.roles.cache.get(cfg.levels[level].roleId);
    if (!configRole) return reply('❌ Configured role not found. Please re-run /config set.');
    if (configRole.position >= botMember.roles.highest.position) return reply(`❌ My role must be above ${configRole} in the role list.`);
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return reply('❌ I need the "Manage Roles" permission.');
    try {
        const result = await applyWarning(interaction.guild, member, user, guildId, level, reason, interaction.channel.id, interaction.user.tag);
        if (result.error) return reply(`❌ ${result.error}`);
        logMod(interaction.guild, guildId, E('#ff0000','Warning Issued').addFields({ name: 'User', value: `${user} (${user.tag})`, inline: true }, { name: 'Level', value: `${level}`, inline: true }, { name: 'Duration', value: result.config.durationDisplay||'Unknown', inline: true }, { name: 'Reason', value: reason }, { name: 'Moderator', value: `${interaction.user}` }));
        await reply({ embeds: [E('#ff0000','Warning Issued').addFields({ name: 'User', value: `${user}`, inline: true }, { name: 'Level', value: `${level}`, inline: true }, { name: 'Role', value: `${result.role}`, inline: true }, { name: 'Duration', value: result.config.durationDisplay||'Unknown', inline: true }, { name: 'Reason', value: reason }, { name: 'Issued by', value: `${interaction.user}` })] });
        const esc = await checkEscalation(interaction.guild, member, user, guildId, level, interaction.channel.id, interaction.user.tag);
        if (esc?.escalated) await interaction.followUp({ content: `${user} auto-escalated to **Level ${esc.nextLevel}** (${esc.role}).${esc.timedOut?` Timeout: **${esc.timeoutDisplay}**.`:''}${esc.hitCap?`\nReached cap (Level ${esc.nextLevel}).`:''}`, flags: [MessageFlags.Ephemeral] });
        else if (esc?.atCap) await interaction.followUp({ content: `Threshold hit for Level ${level}, but cap (Level ${esc.cap}) prevents further escalation.`, flags: [MessageFlags.Ephemeral] });
        else if (esc?.noNextLevel) await interaction.followUp({ content: `Threshold hit for Level ${level}, but Level ${esc.nextLevel} isn't configured.`, flags: [MessageFlags.Ephemeral] });
        else if (esc?.counted) await interaction.followUp({ content: `Escalation: ${esc.count}/${esc.threshold} warnings at Level ${level}.`, flags: [MessageFlags.Ephemeral] });
    } catch (e) { console.error(e); await reply('❌ Failed to assign warning. Check permissions.'); }
}

async function runWarningRemove(ctx) {
    const { interaction, guildId, E, reply } = ctx;
    const user = interaction.options.getUser('user'), member = interaction.guild.members.cache.get(user.id);
    if (!member) return reply(`❌ ${user} is not in this server.`);
    const userWarnings = [...activeWarnings.entries()].filter(([, w]) => w.guildId === guildId && w.userId === user.id);
    if (!userWarnings.length) return reply(`❌ ${user} has no active warnings.`);
    const embed = E('#FFA500','⚠️ Remove a Warning').setDescription(`${user} has **${userWarnings.length}** active warning${userWarnings.length>1?'s':''}. Select one below to remove it.`).setFooter({ text: 'Expires in 60 seconds' });
    const options = userWarnings.slice(0, 25).map(([key, w]) => {
        let expires;
        if (w.isForever) expires = 'Permanent';
        else { const s = Math.max(0, Math.floor((w.expiresAt - Date.now()) / 1000)), d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60), sec = s%60; expires = `Expires in ${[d&&`${d}d`,h&&`${h}h`,m&&`${m}m`,(!d&&!h)&&`${sec}s`].filter(Boolean).join(' ')||'<1m'}`; }
        embed.addFields({ name: `Level ${w.level} — ${w.roleName}`, value: `${expires}\nReason: ${(w.reason||'No reason').slice(0,100)}` });
        return { label: `Level ${w.level} — ${w.roleName}`, description: `${expires} · ${(w.reason||'No reason').slice(0,50)}`, value: key };
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
        const lc = cfg.levels?.[w.level], name = `Level ${w.level} — ${lc?.roleName||'Unknown Role'}`;
        if (w.isForever) embed.addFields({ name, value: ' **Duration:** Forever\n **Status:** Permanent' });
        else { const t = w.expiresAt - Date.now(); embed.addFields({ name, value: t <= 0 ? 'Expired (will be removed shortly)' : (() => { const s = Math.floor(t/1000); return `**Time Left:** ${formatDuration(Math.floor(s/86400),Math.floor((s%86400)/3600),Math.floor((s%3600)/60),s%60)}\n**Expires:** <t:${Math.floor(w.expiresAt/1000)}:F>`; })() }); }
    }
    await reply({ embeds: [embed], components: [refreshBtn(`mywarnings_refresh_${interaction.user.id}`)], flags: [MessageFlags.Ephemeral] });
}

async function runWarningList(ctx) {
    const { guildId, reply } = ctx;
    const { embed, totalPages, page } = buildWarnlistEmbed(guildId, 0);
    await reply({ embeds: [embed], components: warnlistRow(page, totalPages, guildId) });
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
        else if (e.type === 'crosspost_remove') embed.addFields({ name: `Cross-Channel Spam Removed — ${dateStr}`, value: `by ${e.issuedBy}\n${e.reason}` });
        else { const s = e.endReason==='expired'?'Expired':e.endReason==='manual'?'Removed':'Active'; embed.addFields({ name: `Level ${e.level} — ${e.roleName} — ${dateStr}`, value: `${s} • by ${e.issuedBy}\n${e.reason}` }); }
    }
    await interaction.editReply({ embeds: [embed] });
}

module.exports = { runMyWarnings, runWarningGive, runWarningHistory, runWarningList, runWarningRemove };

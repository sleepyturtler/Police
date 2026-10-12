// Buttons, select menus and modals.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } = require('discord.js');
const { OWNER_ID, SUPPORT_SERVER_URL } = require('./constants');
const { addGlobalScamHash, addScamHash, clearGlobalScamHashCache, getScamHashes, getScamProtConfig, pendingNearMatches, removeGlobalScamHash, removeScamHash, scamHashCache } = require('./scam/store');
const { buildConfigViewEmbed, buildEscalationViewEmbed, buildGlobalHashesEmbed, buildLogChannelEmbed, buildNoteViewEmbed, buildScamListEmbed, buildWarnlistEmbed, customIdMatches, refreshBtn, warnlistRow } = require('./ui/embeds');
const { formatDuration, hasCommandPermission, logMod } = require('./helpers');
const { activeWarnings, addHistory, deleteNote, deleteWarning, getAllHistory, getConfig, getNotes, saveConfig } = require('./db');
const { pendingUnwarns, warningTimers } = require('./warnings');
const { hammingDistance } = require('./scam/hashing');
const { helpOverviewEmbed, helpPages, helpRows } = require('./ui/help');

async function handleComponents(interaction) {
    if (interaction.isStringSelectMenu() && interaction.customId === 'globalhashes_remove') {
        if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Restricted to the bot owner.', flags: [MessageFlags.Ephemeral] });
        await interaction.deferUpdate();
        await removeGlobalScamHash(parseInt(interaction.values[0]));
        const { embeds, components } = await buildGlobalHashesEmbed();
        return interaction.editReply({ embeds, components });
    }
    if (interaction.isStringSelectMenu() && customIdMatches(interaction.customId, ['configview_removelevel_','escview_removethreshold_','escview_removetimeout_','scamlist_remove_','noteview_remove_'])) {
        if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
        const { customId, values } = interaction, value = values[0];
        await interaction.deferUpdate();
        if (customId.startsWith('configview_removelevel_')) {
            const guildId = customId.slice(23), cfg = await getConfig(guildId);
            delete cfg.levels?.[value]; saveConfig(guildId, cfg);
            const { embeds, components } = await buildConfigViewEmbed(guildId);
            return interaction.editReply({ embeds, components });
        }
        if (customId.startsWith('escview_removethreshold_')) {
            const guildId = customId.slice(25), cfg = await getConfig(guildId);
            delete cfg.escalation?.thresholds?.[value]; saveConfig(guildId, cfg);
            const { embeds, components } = await buildEscalationViewEmbed(guildId);
            return interaction.editReply({ embeds, components });
        }
        if (customId.startsWith('escview_removetimeout_')) {
            const guildId = customId.slice(22), cfg = await getConfig(guildId);
            delete cfg.escalation?.timeouts?.[value]; saveConfig(guildId, cfg);
            const { embeds, components } = await buildEscalationViewEmbed(guildId);
            return interaction.editReply({ embeds, components });
        }
        if (customId.startsWith('scamlist_remove_')) {
            const guildId = customId.slice(16);
            await removeScamHash(guildId, parseInt(value));
            const { embeds, components } = await buildScamListEmbed(guildId);
            return interaction.editReply({ embeds, components });
        }
        if (customId.startsWith('noteview_remove_')) {
            const parts = customId.slice(16).split('_'), guildId = parts[0], userId = parts[1];
            await deleteNote(guildId, userId, parseInt(value));
            const user = await interaction.client.users.fetch(userId).catch(() => null);
            if (!user) return interaction.editReply({ content: '❌ Could not fetch user.', embeds: [], components: [] });
            const { embeds, components } = await buildNoteViewEmbed(guildId, user);
            return interaction.editReply({ embeds, components });
        }
        return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('unban_select_')) {
        if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
        const targetUserId = interaction.values[0];
        const modal = new ModalBuilder().setCustomId(`unban_modal_${targetUserId}`).setTitle('Unban User')
            .addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason for unban').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(512).setPlaceholder('No reason provided')),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('invite').setLabel('Send the user an invite back? (yes/no)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(3).setPlaceholder('no'))
            );
        return interaction.showModal(modal);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('unban_modal_')) {
        if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
        const userId = interaction.customId.slice(12), guildId = interaction.guild.id;
        const reason = (interaction.fields.getTextInputValue('reason') || 'No reason provided').slice(0,512).replace(/[\x00-\x1F\x7F]/g,'');
        const sendInvite = ['yes','y','true'].includes((interaction.fields.getTextInputValue('invite') || '').trim().toLowerCase());
        await interaction.deferUpdate();
        try {
            const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
            if (!ban) return interaction.editReply({ content: '❌ That user is no longer banned.', embeds: [], components: [] });
            await interaction.guild.members.unban(userId, reason);
            const user = ban.user;
            addHistory(guildId, userId, { guildId, userId, userTag: user.tag, type: 'unban', reason, issuedBy: interaction.user.tag, issuedAt: Date.now() });
            logMod(interaction.guild, guildId, new EmbedBuilder().setColor('#00ff00').setTitle('Member Unbanned').addFields({ name: 'User', value: `${user} (${user.tag})`, inline: true }, { name: 'Moderator', value: `${interaction.user}`, inline: true }, { name: 'Reason', value: reason }).setTimestamp());
            let inviteResult = null;
            if (sendInvite) {
                const botMember = interaction.guild.members.me;
                const channel = interaction.guild.channels.cache.find(c => c.isTextBased() && c.type !== ChannelType.GuildAnnouncement && botMember.permissionsIn(c).has(PermissionFlagsBits.CreateInstantInvite));
                if (channel) {
                    try {
                        const invite = await channel.createInvite({ maxUses: 1, maxAge: 86400, unique: true, reason: `Unban invite for ${user.tag}` });
                        await user.send({ embeds: [new EmbedBuilder().setColor('#00ff00').setTitle("You've been unbanned").setDescription(`You were unbanned from **${interaction.guild.name}**.\n\nHere's an invite back: ${invite.url}\n*(expires in 24h, single use)*`).addFields({ name: 'Reason', value: reason })] });
                        inviteResult = 'sent';
                    } catch (e) { console.error('unban invite:', e.message); inviteResult = 'failed'; }
                } else inviteResult = 'failed';
            }
            const inviteField = sendInvite ? [{ name: 'Invite', value: inviteResult === 'sent' ? '✅ Sent via DM' : '❌ Failed to send (DMs closed or no invitable channel)', inline: true }] : [];
            await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#00ff00').setTitle('Member Unbanned').addFields({ name: 'User', value: `${user.tag}`, inline: true }, { name: 'Reason', value: reason }, { name: 'Unbanned by', value: `${interaction.user}`, inline: true }, ...inviteField).setTimestamp()], components: [] });
        } catch (e) { console.error(e); await interaction.editReply({ content: '❌ Failed to unban.', embeds: [], components: [] }); }
        return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('unwarn_select_')) {
        if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
        const pendingId = interaction.customId.slice(14), pending = pendingUnwarns.get(pendingId);
        if (!pending) return interaction.update({ content: '❌ Confirmation expired.', embeds: [], components: [] });
        if (interaction.user.id !== pending.modId) return interaction.reply({ content: '❌ Only the moderator who ran this command can use this.', flags: [MessageFlags.Ephemeral] });
        const selectedKey = interaction.values[0], w = activeWarnings.get(selectedKey);
        if (!w) return interaction.update({ content: '❌ Warning no longer exists.', embeds: [], components: [] });
        pendingUnwarns.set(pendingId, { ...pending, selectedKey, roleId: w.roleId, level: w.level });
        const role = interaction.guild.roles.cache.get(w.roleId);
        await interaction.update({ embeds: [new EmbedBuilder().setColor('#FFA500').setTitle('⚠️ Confirm Unwarn').setDescription(`Remove **Level ${w.level}** warning from <@${pending.targetUserId}>?`).addFields({ name: 'Role', value: role ? `${role}` : w.roleName, inline: true }, { name: 'Issued', value: `<t:${Math.floor(w.issuedAt/1000)}:R>`, inline: true }, { name: 'Reason', value: w.reason || 'No reason' }).setFooter({ text: 'Expires in 60 seconds' }).setTimestamp()], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`unwarn_confirm_${pendingId}`).setLabel('Confirm').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`unwarn_cancel_${pendingId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary))] });
        return;
    }
    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('logchannel_select_')) {
        if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
        const guildId = interaction.customId.slice(19), channel = interaction.channels.first();
        if (!channel) return interaction.reply({ content: '❌ No channel selected.', flags: [MessageFlags.Ephemeral] });
        await interaction.deferUpdate();
        const cfg = await getConfig(guildId); cfg.logChannelId = channel.id; cfg.supportLinkAnnounced = true; saveConfig(guildId, cfg);
        channel.send(`📌 **Join my Support Server:** ${SUPPORT_SERVER_URL}`).catch(() => {});
        const { embeds, components } = await buildLogChannelEmbed(guildId);
        return interaction.editReply({ embeds, components });
    }
    if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('access_role_')) {
        const guildId = interaction.customId.replace('access_role_', '');
        if (guildId !== interaction.guild.id) return interaction.reply({ content: '❌ Invalid interaction.', flags: [MessageFlags.Ephemeral] });
        const role = interaction.roles.first();
        if (!role) return interaction.reply({ content: '❌ No role selected.', flags: [MessageFlags.Ephemeral] });
        if (role.id === interaction.guild.id) return interaction.update({ content: '❌ Cannot use @everyone.', components: [] });
        if (role.managed) return interaction.update({ content: '❌ Cannot use managed/bot roles.', components: [] });
        const cfg = await getConfig(guildId); cfg.accessRoleId = role.id; saveConfig(guildId, cfg);
        await interaction.update({ embeds: [new EmbedBuilder().setColor('#00ff00').setTitle('Access Control Updated').setDescription(`Members with the ${role} role can now use moderation commands.\n\n*Server administrators always have access.*`).setTimestamp()], components: [] });
        return;
    }
    if (interaction.isButton()) {
        const { customId } = interaction;
        if (customId.startsWith('nearmatch_addserver_') || customId.startsWith('nearmatch_addglobal_')) {
            const isGlobalAdd = customId.startsWith('nearmatch_addglobal_');
            if (isGlobalAdd) {
                if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Only the bot owner can add to the global scam list.', flags: [MessageFlags.Ephemeral] });
            } else {
                if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            }
            const pendingId = customId.slice(20);
            const pending = pendingNearMatches.get(pendingId);
            if (!pending) return interaction.reply({ content: '❌ This review has expired (30 min limit). Use `/scam add` with the image manually instead.', flags: [MessageFlags.Ephemeral] });
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const label = `${pending.label} (variant)`;
            try {
                if (isGlobalAdd) {
                    const entry = await addGlobalScamHash(pending.hash, label, interaction.user.tag);
                    await interaction.editReply(`✅ Added to **global** scam list as "${label}" (ID: \`${entry.id}\`). This image will now be auto-removed in **all servers**.`);
                } else {
                    const guildId = interaction.guild.id;
                    const existing = await getScamHashes(guildId), spc = await getScamProtConfig(guildId);
                    for (const e of existing) { if (hammingDistance(pending.hash, e.hash) <= spc.threshold) return interaction.editReply(`❌ Already registered (or similar to) **${e.label}** (ID: \`${e.id}\`).`); }
                    const entry = await addScamHash(guildId, pending.hash, label, interaction.user.tag);
                    await interaction.editReply(`✅ Added to this server's scam list as "${label}" (ID: \`${entry.id}\`).`);
                }
                pendingNearMatches.delete(pendingId);
            } catch (e) { console.error('nearmatch add:', e.message); await interaction.editReply('❌ Failed to add hash.'); }
            return;
        }
        if (customId.startsWith('help_') && customId !== 'help_back') { const embed = helpPages[customId]; if (!embed) return; return interaction.update({ embeds: [embed], components: helpRows(customId) }); }
        if (customId === 'help_back') return interaction.update({ embeds: [helpOverviewEmbed()], components: helpRows() });
        if (customId.startsWith('wl_')) {
            if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            const parts = customId.split('_'), page = parseInt(parts[1]), guildId = parts.slice(2).join('_');
            const { embed, totalPages, page: p } = buildWarnlistEmbed(guildId, page);
            return interaction.update({ embeds: [embed], components: warnlistRow(p, totalPages, guildId) });
        }
        if (customId.startsWith('mywarnings_refresh_')) {
            const ownerId = customId.slice(19);
            if (interaction.user.id !== ownerId) return interaction.reply({ content: '❌ This button is not for you.', flags: [MessageFlags.Ephemeral] });
            const guildId = interaction.guild.id, userWarnings = [...activeWarnings.values()].filter(w => w.guildId === guildId && w.userId === interaction.user.id);
            if (!userWarnings.length) return interaction.update({ embeds: [new EmbedBuilder().setColor('#00ff00').setTitle('Your Active Warnings').setDescription('You have no active warnings!').setTimestamp()], components: [] });
            const cfg = await getConfig(guildId), embed = new EmbedBuilder().setColor('#FFA500').setTitle('Your Active Warnings').setDescription(`You have ${userWarnings.length} active warning${userWarnings.length>1?'s':''}`).setFooter({ text: 'Warnings are automatically removed when they expire' }).setTimestamp();
            for (const w of userWarnings) {
                const lc = cfg.levels?.[w.level], name = `Level ${w.level} — ${lc?.roleName||'Unknown Role'}`;
                if (w.isForever) embed.addFields({ name, value: ' **Duration:** Forever\n **Status:** Permanent' });
                else { const t = w.expiresAt - Date.now(); embed.addFields({ name, value: t <= 0 ? 'Expired (will be removed shortly)' : (() => { const s = Math.floor(t/1000); return `**Time Left:** ${formatDuration(Math.floor(s/86400),Math.floor((s%86400)/3600),Math.floor((s%3600)/60),s%60)}\n**Expires:** <t:${Math.floor(w.expiresAt/1000)}:F>`; })() }); }
            }
            return interaction.update({ embeds: [embed], components: [refreshBtn(customId)] });
        }
        if (customId.startsWith('userinfo_refresh_')) {
            if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            const parts = customId.slice(17).split('_'), userId = parts[0], guildId = parts[1];
            await interaction.deferUpdate();
            const user = await interaction.client.users.fetch(userId).catch(() => null);
            if (!user) return interaction.editReply({ content: '❌ Could not fetch user.', embeds: [], components: [] });
            const [member, history, notes] = await Promise.all([interaction.guild.members.fetch(userId).catch(() => null), getAllHistory(guildId, userId), getNotes(guildId, userId)]);
            const embed = new EmbedBuilder().setColor('#5865F2').setAuthor({ name: user.tag, iconURL: user.displayAvatarURL({ size: 256 }) }).setThumbnail(user.displayAvatarURL({ size: 256 })).addFields({ name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp/1000)}:F>\n<t:${Math.floor(user.createdTimestamp/1000)}:R>`, inline: true }, { name: 'Joined Server', value: member ? `<t:${Math.floor(member.joinedTimestamp/1000)}:F>\n<t:${Math.floor(member.joinedTimestamp/1000)}:R>` : '*Not in server*', inline: true }).setTimestamp();
            const activeUserWarnings = [...activeWarnings.values()].filter(w => w.guildId === guildId && w.userId === userId), activeByLevel = {};
            for (const w of activeUserWarnings) activeByLevel[w.level] = (activeByLevel[w.level] || 0) + 1;
            embed.addFields({ name: 'Active Warnings', value: Object.keys(activeByLevel).length ? Object.entries(activeByLevel).sort(([a],[b])=>a-b).map(([l,c])=>`Level ${l}: **${c}**`).join('\n') : 'None', inline: true });
            const warnCounts = {}, timeoutCount = history.filter(e => e.type === 'timeout').length, kickCount = history.filter(e => e.type === 'kick').length, banCount = history.filter(e => e.type === 'ban').length;
            for (const e of history) if (e.level != null) warnCounts[e.level] = (warnCounts[e.level] || 0) + 1;
            if (Object.keys(warnCounts).length) embed.addFields({ name: 'Warn History', value: Object.entries(warnCounts).sort(([a],[b])=>a-b).map(([l,c])=>`Level ${l}: **${c}**`).join('\n'), inline: true });
            const modLines = [...(timeoutCount?[`Timeouts: **${timeoutCount}**`]:[]), ...(kickCount?[`Kicks: **${kickCount}**`]:[]), ...(banCount?[`Bans: **${banCount}**`]:[])];
            if (modLines.length) embed.addFields({ name: 'Mod Actions', value: modLines.join('\n'), inline: true });
            if (notes.length) { const shown = notes.slice(-5); embed.addFields({ name: `Notes (${notes.length})`, value: shown.map(n => `\`${n.id}\` <t:${Math.floor(n.addedAt/1000)}:d> by **${n.addedBy}**\n${n.text.slice(0,100)}${n.text.length>100?'…':''}`).join('\n\n') }); if (notes.length > 5) embed.setFooter({ text: `Showing last 5 of ${notes.length} notes` }); }
            return interaction.editReply({ embeds: [embed], components: [refreshBtn(customId)] });
        }
        if (customId.startsWith('removelogchannel_')) {
            if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            await interaction.deferUpdate();
            const guildId = customId.slice(18), cfg = await getConfig(guildId);
            delete cfg.logChannelId; saveConfig(guildId, cfg);
            const { embeds, components } = await buildLogChannelEmbed(guildId);
            return interaction.editReply({ embeds, components });
        }
        if (customId.startsWith('configview_refresh_')) {
            if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            await interaction.deferUpdate();
            const { embeds, components } = await buildConfigViewEmbed(customId.slice(19));
            return interaction.editReply({ embeds, components });
        }
        if (customId.startsWith('escalationview_refresh_')) {
            if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            await interaction.deferUpdate();
            const { embeds, components } = await buildEscalationViewEmbed(customId.slice(23));
            return interaction.editReply({ embeds, components });
        }
        if (customId.startsWith('escview_removecap_')) {
            if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            await interaction.deferUpdate();
            const guildId = customId.slice(19), cfg = await getConfig(guildId);
            delete cfg.escalation?.cap; saveConfig(guildId, cfg);
            const { embeds, components } = await buildEscalationViewEmbed(guildId);
            return interaction.editReply({ embeds, components });
        }
        if (customId.startsWith('scamlist_refresh_')) {
            if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            await interaction.deferUpdate();
            const guildId = customId.slice(17); scamHashCache.delete(guildId);
            const { embeds, components } = await buildScamListEmbed(guildId);
            return interaction.editReply({ embeds, components });
        }
        if (customId === 'globalhashes_refresh') {
            if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Restricted to the bot owner.', flags: [MessageFlags.Ephemeral] });
            await interaction.deferUpdate();
            clearGlobalScamHashCache();
            const { embeds, components } = await buildGlobalHashesEmbed();
            return interaction.editReply({ embeds, components });
        }
        if (customId.startsWith('unwarn_confirm_') || customId.startsWith('unwarn_cancel_')) {
            const isConfirm = customId.startsWith('unwarn_confirm_'), pendingId = customId.slice(isConfirm ? 15 : 13), pending = pendingUnwarns.get(pendingId);
            if (!pending) return interaction.update({ content: '❌ Confirmation expired.', embeds: [], components: [] });
            if (interaction.user.id !== pending.modId) return interaction.reply({ content: '❌ Only the moderator who ran this command can confirm.', flags: [MessageFlags.Ephemeral] });
            if (!isConfirm) { pendingUnwarns.delete(pendingId); return interaction.update({ content: 'Unwarn cancelled.', embeds: [], components: [] }); }
            pendingUnwarns.delete(pendingId);
            const { targetUserId, targetUserTag, level, guildId, roleId, selectedKey } = pending;
            const member = interaction.guild.members.cache.get(targetUserId), role = interaction.guild.roles.cache.get(roleId);
            if (!member) return interaction.update({ content: '❌ User is no longer in this server.', embeds: [], components: [] });
            if (!role) return interaction.update({ content: '❌ Role not found.', embeds: [], components: [] });
            await member.roles.remove(role);
            const keys = selectedKey ? [selectedKey] : [...activeWarnings.entries()].filter(([, w]) => w.userId === targetUserId && w.guildId === guildId && w.level === level).map(([k]) => k);
            for (const k of keys) { addHistory(guildId, targetUserId, { ...activeWarnings.get(k), endedAt: Date.now(), endReason: 'manual' }); clearTimeout(warningTimers.get(k)); warningTimers.delete(k); deleteWarning(k); }
            logMod(interaction.guild, guildId, new EmbedBuilder().setColor('#00ff00').setTitle('Warning Removed').addFields({ name: 'User', value: `<@${targetUserId}> (${targetUserTag})`, inline: true }, { name: 'Level', value: `${level}`, inline: true }, { name: 'Role', value: `${role}`, inline: true }, { name: 'Removed by', value: `${interaction.user}` }).setTimestamp());
            await interaction.update({ embeds: [new EmbedBuilder().setColor('#00ff00').setTitle('Warning Removed').addFields({ name: 'User', value: `<@${targetUserId}>`, inline: true }, { name: 'Level', value: `${level}`, inline: true }, { name: 'Role', value: `${role}`, inline: true }, { name: 'Removed by', value: `${interaction.user}` }).setTimestamp()], components: [] });
        }
        return;
    }
}

module.exports = { handleComponents };

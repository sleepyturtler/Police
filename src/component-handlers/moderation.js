// Unban and unwarn flows, warning list paging and the personal warnings refresh.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } = require('discord.js');
const { formatDuration, hasCommandPermission, logMod } = require('../helpers');
const { activeWarnings, addHistory, deleteWarning, getConfig } = require('../db');
const { pendingUnwarns, warningTimers } = require('../warnings');
const { buildWarnlistEmbed, refreshBtn, warnlistRow } = require('../ui/embeds');

function matches(interaction) {
    const id = interaction.customId;
    if (interaction.isStringSelectMenu()) return id.startsWith('unban_select_') || id.startsWith('unwarn_select_');
    if (interaction.isModalSubmit()) return id.startsWith('unban_modal_');
    if (interaction.isButton()) return id.startsWith('wl_') || id.startsWith('mywarnings_refresh_') || id.startsWith('unwarn_confirm_') || id.startsWith('unwarn_cancel_');
    return false;
}

async function handle(interaction) {
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
    if (interaction.isButton()) {
        const { customId } = interaction;
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

module.exports = { matches, handle };

// /timeout, /kick and /ban.
const { ActionRowBuilder, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder } = require('discord.js');
const { bulkDeleteInRange, formatDuration, logMod, parseDuration } = require('../helpers');
const { MAX_TIMEOUT_MS } = require('../constants');
const { addHistory, deleteActiveTimeout, saveActiveTimeout } = require('../db');
const { scheduleBanExpiry } = require('../warnings');

async function runTimeout(ctx) {
    const { interaction, guildId, E, reply } = ctx;
    const sub = interaction.options.getSubcommand(), user = interaction.options.getUser('user'), member = interaction.guild.members.cache.get(user.id);
    const reason = (interaction.options.getString('reason') || 'No reason provided').slice(0,512).replace(/[\x00-\x1F\x7F]/g,'');
    if (!member) return reply(`❌ ${user} is not in this server.`);
    const botMember = interaction.guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) return reply('❌ I need the "Moderate Members" permission.');
    if (member.roles.highest.position >= botMember.roles.highest.position) return reply(`❌ Cannot ${sub === 'give' ? 'timeout' : 'remove timeout from'} this user — their role is equal to or above mine.`);
    if (sub === 'give') {
        const dur = parseDuration(interaction.options.getString('duration'));
        if (!dur || dur.isForever) return reply('❌ Invalid duration. Use `m:s`, `h:m:s`, or `d:h:m:s`. Max 28 days.');
        if (dur.totalMs > MAX_TIMEOUT_MS) return reply('❌ Discord timeouts cannot exceed 28 days.');
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            await member.timeout(dur.totalMs, reason);
            const dd = formatDuration(dur.days, dur.hours, dur.minutes, dur.seconds), exTs = Math.floor((Date.now()+dur.totalMs)/1000);
            saveActiveTimeout(guildId, user.id, { guildId, userId: user.id, userTag: user.tag, reason, issuedBy: interaction.user.tag, issuedAt: Date.now(), expiresAt: Date.now() + dur.totalMs, durationDisplay: dd });
            logMod(interaction.guild, guildId, E('#ff6600','Member Timed Out').addFields({ name: 'User', value: `${user} (${user.tag})`, inline: true }, { name: 'Duration', value: dd, inline: true }, { name: 'Expires', value: `<t:${exTs}:R>`, inline: true }, { name: 'Reason', value: reason }, { name: 'Moderator', value: `${interaction.user}` }));
            user.send({ embeds: [E('#ff6600','You Have Been Timed Out').setDescription(`You were timed out in **${interaction.guild.name}**.`).addFields({ name: 'Duration', value: dd, inline: true }, { name: 'Expires', value: `<t:${exTs}:R>`, inline: true }, { name: 'Reason', value: reason })] }).catch(() => {});
            addHistory(guildId, user.id, { guildId, userId: user.id, userTag: user.tag, type: 'timeout', reason, issuedBy: interaction.user.tag, issuedAt: Date.now(), duration: dd });
            await reply({ embeds: [E('#ff6600','Timeout Applied').addFields({ name: 'User', value: `${user}`, inline: true }, { name: 'Duration', value: dd, inline: true }, { name: 'Expires', value: `<t:${exTs}:R>`, inline: true }, { name: 'Reason', value: reason }, { name: 'Issued by', value: `${interaction.user}` })] });
        } catch (e) { console.error(e); await reply('❌ Failed to apply timeout.'); }
    } else {
        if (!member.communicationDisabledUntilTimestamp || member.communicationDisabledUntilTimestamp < Date.now()) return reply(`❌ ${user} is not currently timed out.`);
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            await member.timeout(null, reason);
            deleteActiveTimeout(guildId, user.id);
            logMod(interaction.guild, guildId, E('#00ff00','Timeout Removed').addFields({ name: 'User', value: `${user} (${user.tag})`, inline: true }, { name: 'Reason', value: reason }, { name: 'Moderator', value: `${interaction.user}` }));
            addHistory(guildId, user.id, { guildId, userId: user.id, userTag: user.tag, type: 'timeout_remove', reason, issuedBy: interaction.user.tag, issuedAt: Date.now() });
            await reply({ embeds: [E('#00ff00','Timeout Removed').addFields({ name: 'User', value: `${user}`, inline: true }, { name: 'Reason', value: reason }, { name: 'Removed by', value: `${interaction.user}` })] });
        } catch (e) { console.error(e); await reply('❌ Failed to remove timeout.'); }
    }
}

async function runKick(ctx) {
    const { interaction, guildId, E, reply } = ctx;
    const user = interaction.options.getUser('user'), member = interaction.guild.members.cache.get(user.id);
    const reason = interaction.options.getString('reason').slice(0,512).replace(/[\x00-\x1F\x7F]/g,'');
    if (!member) return reply(`❌ ${user} is not in this server.`);
    const botMember = interaction.guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) return reply('❌ I need the "Kick Members" permission.');
    if (member.roles.highest.position >= botMember.roles.highest.position) return reply('❌ Cannot kick this user — their role is equal to or above mine.');
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    try {
        user.send({ embeds: [E('#ff6600','You have been kicked').setDescription(`You were kicked from **${interaction.guild.name}**.`).addFields({ name: 'Reason', value: reason })] }).catch(() => {});
        await member.kick(reason);
        deleteActiveTimeout(guildId, user.id);
        addHistory(guildId, user.id, { guildId, userId: user.id, userTag: user.tag, type: 'kick', reason, issuedBy: interaction.user.tag, issuedAt: Date.now() });
        logMod(interaction.guild, guildId, E('#ff6600','Member Kicked').addFields({ name: 'User', value: `${user} (${user.tag})`, inline: true }, { name: 'Moderator', value: `${interaction.user}`, inline: true }, { name: 'Reason', value: reason }));
        await reply({ embeds: [E('#ff6600','Member Kicked').addFields({ name: 'User', value: `${user}`, inline: true }, { name: 'Reason', value: reason }, { name: 'Kicked by', value: `${interaction.user}` })] });
    } catch (e) { console.error(e); await reply('❌ Failed to kick user.'); }
}

async function runBan(ctx) {
    const { interaction, guildId, E, reply } = ctx;
    const sub = interaction.options.getSubcommand(), botMember = interaction.guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) return reply('❌ I need the "Ban Members" permission.');
    if (sub === 'give') {
        const user = interaction.options.getUser('user'), member = interaction.guild.members.cache.get(user.id);
        const reason = interaction.options.getString('reason').slice(0,512).replace(/[\x00-\x1F\x7F]/g,''), deleteDays = interaction.options.getInteger('delete_days') ?? 0;
        const durationStr = interaction.options.getString('duration'), dur = durationStr ? parseDuration(durationStr) : null;
        const deleteMessagesStr = interaction.options.getString('delete_messages');
        const delMsgDur = deleteMessagesStr ? parseDuration(deleteMessagesStr) : null;
        if (durationStr && (!dur || dur.isForever)) return reply('❌ Invalid duration. Omit for permanent ban.');
        if (deleteMessagesStr && (!delMsgDur || delMsgDur.isForever)) return reply('❌ Invalid delete_messages duration. Use `m:s`, `h:m:s`, or `d:h:m:s`.');
        if (member && member.roles.highest.position >= botMember.roles.highest.position) return reply('❌ Cannot ban this user — their role is equal to or above mine.');
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            const dd = dur ? formatDuration(dur.days, dur.hours, dur.minutes, dur.seconds) : null, expiresAt = dur ? Date.now() + dur.totalMs : null, exTs = expiresAt ? Math.floor(expiresAt / 1000) : null;
            if (member) user.send({ embeds: [E('#ff0000','You have been banned').setDescription(`You were banned from **${interaction.guild.name}**.`).addFields({ name: 'Reason', value: reason }, ...(dd ? [{ name: 'Duration', value: dd, inline: true }, { name: 'Expires', value: `<t:${exTs}:R>`, inline: true }] : []))] }).catch(() => {});
            await interaction.guild.members.ban(user, { reason, deleteMessageDays: deleteDays });
            deleteActiveTimeout(guildId, user.id);
            addHistory(guildId, user.id, { guildId, userId: user.id, userTag: user.tag, type: 'ban', reason, issuedBy: interaction.user.tag, issuedAt: Date.now(), deleteDays, expiresAt });
            if (expiresAt) scheduleBanExpiry(guildId, user.id, user.tag, expiresAt, reason);
            // Time-based message deletion across all channels
            let deletedMsgCount = 0;
            if (delMsgDur) {
                const since = Date.now() - delMsgDur.totalMs;
                const channels = interaction.guild.channels.cache.filter(c => c.isTextBased() && c.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.ManageMessages));
                for (const ch of channels.values()) deletedMsgCount += await bulkDeleteInRange(ch, { userId: user.id, since }).catch(() => 0);
            }
            const delDisplay = delMsgDur ? formatDuration(delMsgDur.days, delMsgDur.hours, delMsgDur.minutes, delMsgDur.seconds) : null;
            logMod(interaction.guild, guildId, E('#ff0000','Member Banned').addFields({ name: 'User', value: `${user} (${user.tag})`, inline: true }, { name: 'Moderator', value: `${interaction.user}`, inline: true }, { name: 'Duration', value: dd || 'Permanent', inline: true }, ...(exTs ? [{ name: 'Expires', value: `<t:${exTs}:R>`, inline: true }] : []), { name: 'Messages Deleted', value: deleteDays ? `${deleteDays} day(s) via Discord` : delDisplay ? `${deletedMsgCount} msgs in last ${delDisplay}` : 'None', inline: true }, { name: 'Reason', value: reason }));
            await reply({ embeds: [E('#ff0000','Member Banned').addFields({ name: 'User', value: `${user}`, inline: true }, { name: 'Duration', value: dd || 'Permanent', inline: true }, ...(exTs ? [{ name: 'Expires', value: `<t:${exTs}:R>`, inline: true }] : []), { name: 'Messages Deleted', value: deleteDays ? `${deleteDays} day(s) via Discord` : delDisplay ? `${deletedMsgCount} msgs in last ${delDisplay}` : 'None', inline: true }, { name: 'Reason', value: reason }, { name: 'Banned by', value: `${interaction.user}` })] });
        } catch (e) { console.error(e); await reply('❌ Failed to ban user.'); }
    } else {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const bans = await interaction.guild.bans.fetch().catch(() => null);
        if (!bans || !bans.size) return reply('📋 There are no banned users in this server.');
        const list = [...bans.values()];
        const embed = E('#ff0000','🔓 Unban a User').setDescription(`This server has **${list.length}** banned user${list.length>1?'s':''}. Select one below to unban.`);
        for (const b of list.slice(0, 25)) embed.addFields({ name: b.user.tag, value: `Reason: ${(b.reason || 'No reason provided').slice(0,200)}` });
        if (list.length > 25) embed.setFooter({ text: `Showing first 25 of ${list.length}` });
        const options = list.slice(0, 25).map(b => ({ label: b.user.tag.slice(0,100), description: `ID: ${b.user.id}`, value: b.user.id }));
        await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`unban_select_${guildId}`).setPlaceholder('Select a user to unban…').addOptions(options))] });
    }
}

module.exports = { runBan, runKick, runTimeout };

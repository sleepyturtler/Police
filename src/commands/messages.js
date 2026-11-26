// /messages.
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { DELETE_MANUAL_BUDGET_MS } = require('../constants');
const { bulkDeleteInRange, formatDuration, logMod, parseDuration, purgeChannels, purgeNotes } = require('../helpers');

async function runMessages(ctx) {
    const { interaction, guildId, E, reply } = ctx;
    const sub = interaction.options.getSubcommand();
    const botMember = interaction.guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)) return reply('❌ I need the "Manage Messages" permission.');

    if (sub === 'delete') {
        const filterUser = interaction.options.getUser('user'), count = interaction.options.getInteger('count') ?? 100;
        const withinStr = interaction.options.getString('within'), withinDur = withinStr ? parseDuration(withinStr) : null;
        if (withinStr && (!withinDur || withinDur.isForever)) return reply('❌ Invalid within duration. Use `m:s`, `h:m:s`, or `d:h:m:s`.');
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!botMember.permissionsIn(interaction.channel).has(PermissionFlagsBits.ManageMessages)) return reply('❌ I need ManageMessages in this channel.');
        const since = withinDur ? Date.now() - withinDur.totalMs : null;
        const stats = {}, deleted = await bulkDeleteInRange(interaction.channel, { userId: filterUser?.id, since, maxCount: count, deadline: Date.now() + DELETE_MANUAL_BUDGET_MS, stats });
        const notes = purgeNotes({ failed: stats.failed, tooOld: stats.tooOld, oldDeleted: stats.oldDeleted, capped: [], errors: stats.error ? [interaction.channel] : [], skipped: [] });
        const withinDisplay = withinDur ? formatDuration(withinDur.days, withinDur.hours, withinDur.minutes, withinDur.seconds) : null;
        logMod(interaction.guild, guildId, E('#ff0000','Messages Deleted').addFields({ name: 'Channel', value: `${interaction.channel}`, inline: true }, { name: 'Deleted', value: `${deleted}`, inline: true }, ...(filterUser ? [{ name: 'User Filter', value: `${filterUser}`, inline: true }] : []), ...(withinDisplay ? [{ name: 'Within', value: withinDisplay, inline: true }] : []), { name: 'Moderator', value: `${interaction.user}`, inline: true }));
        await reply(`${deleted ? '✅' : '⚠️'} Deleted **${deleted}** message${deleted !== 1 ? 's' : ''} in ${interaction.channel}.${notes.length ? '\n' + notes.map(n => `• ${n}`).join('\n') : ''}`);
    }
    else if (sub === 'purge') {
        const withinStr = interaction.options.getString('within'), filterUser = interaction.options.getUser('user');
        const withinDur = parseDuration(withinStr);
        if (!withinDur || withinDur.isForever) return reply('❌ Invalid within duration. Use `m:s`, `h:m:s`, or `d:h:m:s`.');
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const since = Date.now() - withinDur.totalMs;
        const channels = interaction.guild.channels.cache.filter(c => c.isTextBased() && botMember.permissionsIn(c).has(PermissionFlagsBits.ManageMessages));
        const out = await purgeChannels(channels.values(), { userId: filterUser?.id, since, deadline: Date.now() + DELETE_MANUAL_BUDGET_MS });
        const totalDeleted = out.deleted, channelsAffected = out.affected;
        const notes = purgeNotes(out, `the same command again${filterUser ? '' : ' (or add a user to narrow it)'}.`);
        const withinDisplay = formatDuration(withinDur.days, withinDur.hours, withinDur.minutes, withinDur.seconds);
        logMod(interaction.guild, guildId, E('#ff0000','Messages Purged').addFields({ name: 'Deleted', value: `${totalDeleted} messages`, inline: true }, { name: 'Channels Affected', value: `${channelsAffected}`, inline: true }, { name: 'Within', value: withinDisplay, inline: true }, ...(filterUser ? [{ name: 'User Filter', value: `${filterUser}`, inline: true }] : []), { name: 'Moderator', value: `${interaction.user}`, inline: true }));
        await reply(`✅ Purged **${totalDeleted}** message${totalDeleted !== 1 ? 's' : ''} across **${channelsAffected}** channel${channelsAffected !== 1 ? 's' : ''} in the last **${withinDisplay}**.${notes.length ? '\n' + notes.map(n => `• ${n}`).join('\n') : ''}`);
    }
}

module.exports = { runMessages };

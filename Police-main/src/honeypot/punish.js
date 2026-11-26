// What happens when someone posts in the sting channel: DM, punishment by level, message cleanup, log and history.
const { EmbedBuilder, PermissionFlagsBits: P } = require('discord.js');
const { client } = require('../client');
const { STING_DELETE_WINDOW_MS, STING_PURGE_BUDGET_MS, STING_PURGE_MAX_PAGES } = require('../constants');
const { addHistory, deleteActiveTimeout, getConfig, saveActiveTimeout } = require('../db');
const { logMod, purgeChannels, purgeNotes } = require('../helpers');
const { STING_LEVELS, windowText } = require('./config');

// Deletes the user's messages from the last STING_DELETE_WINDOW_MS in every channel the bot can manage.
// The message cache is off, so this fetches history; it is bounded per channel (pages) and overall (time budget),
// sweeps several channels at once, and reports anything it could not finish.
async function purgeUserMessages(guild, userId) {
    const me = guild.members.me;
    const channels = [...guild.channels.cache.values()].filter(ch => ch.isTextBased() && me.permissionsIn(ch).has([P.ViewChannel, P.ReadMessageHistory, P.ManageMessages]));
    const out = await purgeChannels(channels, { userId, since: Date.now() - STING_DELETE_WINDOW_MS, maxPages: STING_PURGE_MAX_PAGES, deadline: Date.now() + STING_PURGE_BUDGET_MS });
    out.truncated = out.capped.length > 0 || out.skipped.length > 0;
    return out;
}

const NEEDS = { delete: [P.ManageMessages], timeout: [P.ManageMessages, P.ModerateMembers], softban: [P.BanMembers], ban: [P.BanMembers] };
const PERM_NAMES = { [P.ManageMessages]: 'Manage Messages', [P.ModerateMembers]: 'Timeout Members', [P.BanMembers]: 'Ban Members' };

function dmEmbed(guild, level, st) {
    const w = windowText();
    const what = { delete: `The message you sent in the restricted channel was removed, along with your messages from the last ${w}.`, timeout: `You have been timed out for **${st.timeoutDisplay}** and your messages from the last ${w} were deleted.`, softban: `You were removed from the server and your messages from the last ${w} were deleted. This was a softban, so you are able to rejoin.`, ban: `You have been banned and your messages from the last ${w} were deleted.` }[level];
    return new EmbedBuilder().setColor('#ff0000').setTitle('🚨 You have been arrested').setDescription(`You posted in the restricted channel of **${guild.name}**, which only exists to catch spam bots and hijacked accounts.\n\n${what}`).setFooter({ text: 'If your account was hijacked: change your password and remove unknown authorised apps. Then contact a moderator.' }).setTimestamp();
}

async function runSting(message, member, st) {
    const { guild, author } = message, guildId = guild.id, me = guild.members.me, level = st.level, L = STING_LEVELS[level];
    const reason = `Sting Operation: posted in the restricted channel (${L.label})`;
    const notes = []; let timedOut = false, banned = false, unbanned = false, purge = null;

    // The trap message itself goes first, whatever the level.
    const content = (message.content || '').slice(0, 300), attachmentCount = message.attachments.size;
    message.delete().catch(() => {});

    // Can the chosen punishment be applied? If not, fall back to just cleaning up what we are able to.
    const missing = NEEDS[level].filter(perm => !me.permissions.has(perm));
    let blocked = null;
    if (missing.length) blocked = `I am missing: ${missing.map(m => PERM_NAMES[m]).join(', ')}`;
    else if (level === 'timeout' && !member) blocked = 'The user already left the server';
    else if (level !== 'delete' && member && member.roles.highest.position >= me.roles.highest.position) blocked = 'Their top role is equal to or above mine';
    if (blocked) notes.push(`Punishment not applied: ${blocked}.`);

    if (!blocked) {
        // DM before a ban or softban: afterwards the user shares no server with the bot and the DM would fail.
        if ((await getConfig(guildId)).warnDm !== false) await author.send({ embeds: [dmEmbed(guild, level, st)] }).catch(() => {});
        try {
            if (level === 'timeout') {
                await member.timeout(st.timeoutMs, reason); timedOut = true;
                saveActiveTimeout(guildId, author.id, { guildId, userId: author.id, userTag: author.tag, reason, issuedBy: client.user.tag, issuedAt: Date.now(), expiresAt: Date.now() + st.timeoutMs, durationDisplay: st.timeoutDisplay });
            } else if (level === 'softban' || level === 'ban') {
                // Discord deletes the user's messages from the window as part of the ban itself, in every channel.
                await guild.members.ban(author.id, { reason, deleteMessageSeconds: Math.floor(STING_DELETE_WINDOW_MS / 1000) }); banned = true;
                deleteActiveTimeout(guildId, author.id);
                if (level === 'softban') { await guild.members.unban(author.id, 'Sting Operation: softban').then(() => { unbanned = true; }).catch(e => notes.push(`The unban failed, so the user is still banned: ${e.message}`)); }
            }
        } catch (e) { notes.push(`Punishment failed: ${e.message}`); }
    }

    // Delete and timeout levels (and any level whose ban did not happen) clean up by fetching history.
    if (!banned && me.permissions.has(P.ManageMessages)) {
        purge = await purgeUserMessages(guild, author.id);
        notes.push(...purgeNotes(purge, `\`/messages purge within:${Math.round(STING_DELETE_WINDOW_MS / 3_600_000)}:0:0 user:${author.tag}\``));
    }

    const applied = banned ? (level === 'softban' ? (unbanned ? 'Softbanned' : 'Banned (unban failed)') : 'Banned') : timedOut ? `Timed out for ${st.timeoutDisplay}` : blocked ? 'Not punished' : level === 'delete' ? 'Messages deleted' : 'Not punished';
    const cleaned = banned ? `Last ${windowText()}, deleted by Discord` : purge ? `${purge.deleted} (scanned ${purge.scanned} channel${purge.scanned === 1 ? '' : 's'})` : 'None';
    const ok = banned || timedOut || (level === 'delete' && !blocked);
    const embed = new EmbedBuilder().setColor(ok ? '#ff0000' : '#ff9900').setTitle(ok ? '🚨 Suspect Apprehended' : '⚠️ Sting Triggered, Punishment Not Applied').setTimestamp()
        .addFields({ name: 'Suspect', value: `${author} (${author.tag})`, inline: true }, { name: 'Channel', value: `${message.channel}`, inline: true }, { name: 'Level', value: L.label, inline: true }, { name: 'Result', value: applied, inline: true }, { name: 'Messages Removed', value: cleaned, inline: true },
            { name: 'Posted', value: (content || (attachmentCount ? '' : '(empty)')) + (attachmentCount ? `${content ? '\n' : ''}[${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}]` : '') });
    if (notes.length) embed.addFields({ name: 'Notes', value: notes.join('\n').slice(0, 1000) });
    logMod(guild, guildId, embed);
    addHistory(guildId, author.id, { guildId, userId: author.id, userTag: author.tag, type: 'sting_remove', stingLevel: level, reason: `Posted in the sting channel: ${applied}`, issuedBy: client.user.tag, issuedAt: Date.now() });
    console.log(`🚨 Sting: ${author.tag} in ${guildId} (${level}: ${applied})`);
}

module.exports = { NEEDS, PERM_NAMES, purgeUserMessages, runSting };

// /sting: set up and manage the sting channel (a trap for spam bots and hijacked accounts).
const { ChannelType, MessageFlags, PermissionFlagsBits: P } = require('discord.js');
const { MAX_TIMEOUT_MS } = require('../constants');
const { formatDuration, parseDuration } = require('../helpers');
const { STING_LEVELS, getStingConfig, randomChannelName, refreshWarning, updateStingConfig, windowText } = require('../honeypot/config');
const { NEEDS, PERM_NAMES } = require('../honeypot/punish');

// Things that would stop the sting from working, shown on every reply so they are hard to miss.
function problems(guild, st) {
    const out = [], me = guild.members.me, ch = st.channelId && guild.channels.cache.get(st.channelId);
    if (st.enabled && st.channelId && !ch) out.push('The sting channel no longer exists. Run `/sting setup` or `/sting channel`.');
    if (ch) {
        const everyone = ch.permissionsFor(guild.roles.everyone);
        if (!everyone?.has(P.ViewChannel) || !everyone.has(P.SendMessages)) out.push('@everyone cannot both see and post in the channel, so spam bots may never reach it.');
        if (!me.permissionsIn(ch).has([P.ViewChannel, P.SendMessages, P.ManageMessages])) out.push('I need View Channel, Send Messages and Manage Messages in the sting channel.');
    }
    const missing = NEEDS[st.level].filter(perm => !me.permissions.has(perm));
    if (missing.length) out.push(`The **${STING_LEVELS[st.level].label}** level needs these permissions, which I do not have: ${missing.map(m => PERM_NAMES[m]).join(', ')}.`);
    if (st.dailyRename && !me.permissions.has(P.ManageChannels)) out.push('Daily rename needs the Manage Channels permission, which I do not have.');
    return out;
}

function statusEmbed(ctx, guild, st, title = 'Sting Operation') {
    const embed = ctx.E('#5865F2', title).setDescription('A channel that real members have no reason to post in. Spam bots and hijacked accounts post in every channel they can see, and anyone who posts here gets the punishment below. Staff are never punished, so test it with an alt account.')
        .addFields({ name: 'Status', value: st.enabled ? 'Active' : 'Off', inline: true }, { name: 'Channel', value: st.channelId ? `<#${st.channelId}>` : 'Not set (use `/sting setup` or `/sting channel`)', inline: true }, { name: 'Level', value: `**${STING_LEVELS[st.level].label}**: ${STING_LEVELS[st.level].short} (last ${windowText()})`, inline: false },
            { name: 'Timeout length', value: `${st.timeoutDisplay}${st.level === 'timeout' ? '' : ' (only used by the timeout level)'}`, inline: true }, { name: 'Warning message', value: st.warningMessage ? 'Posted in the channel' : 'Off', inline: true }, { name: 'Daily rename', value: st.dailyRename ? 'On' : 'Off', inline: true });
    const issues = problems(guild, st);
    if (issues.length) embed.addFields({ name: '⚠️ Needs attention', value: issues.map(i => `• ${i}`).join('\n').slice(0, 1024) });
    return embed;
}

async function runSting(ctx) {
    const { interaction, guildId, reply } = ctx, guild = interaction.guild, sub = interaction.options.getSubcommand(), eph = { flags: [MessageFlags.Ephemeral] };
    let st = await getStingConfig(guildId);

    if (sub === 'view') return reply({ embeds: [statusEmbed(ctx, guild, st)], ...eph });

    if (sub === 'setup') {
        const me = guild.members.me;
        if (!me.permissions.has(P.ManageChannels)) return reply('❌ I need the "Manage Channels" permission to create the channel. Give it to me, or make a channel yourself and use `/sting channel`.');
        await interaction.deferReply(eph);
        const raw = interaction.options.getString('name'), name = (raw ? raw.toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().replace(/\s+/g, '-').slice(0, 90) : '') || randomChannelName();
        try {
            const channel = await guild.channels.create({ name, type: ChannelType.GuildText, topic: 'Restricted area. Do not post here.', position: 0, permissionOverwrites: [{ id: guild.roles.everyone.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] }], reason: `Sting Operation setup by ${interaction.user.tag}` });
            st = await updateStingConfig(guildId, { enabled: true, channelId: channel.id, warningMessageId: null, lastRenameAt: Date.now() });
            const id = await refreshWarning(channel, st); if (id) st = await updateStingConfig(guildId, { warningMessageId: id });
            return reply({ embeds: [statusEmbed(ctx, guild, st, 'Sting Operation Active')] });
        } catch (e) { console.error('sting setup:', e.message); return reply(`❌ Could not create the channel: ${e.message}`); }
    }

    if (sub === 'channel') {
        const channel = interaction.options.getChannel('channel');
        await interaction.deferReply(eph);
        st = await updateStingConfig(guildId, { enabled: true, channelId: channel.id, warningMessageId: null, lastRenameAt: Date.now() });
        const id = await refreshWarning(channel, st); if (id) st = await updateStingConfig(guildId, { warningMessageId: id });
        return reply({ embeds: [statusEmbed(ctx, guild, st, 'Sting Operation Active')] });
    }

    if (sub === 'action') {
        const level = interaction.options.getString('level'), toStr = interaction.options.getString('timeout'), changes = { level };
        if (toStr !== null) {
            const dur = parseDuration(toStr);
            if (!dur || dur.isForever) return reply('❌ Invalid timeout length. Use something like `1d`, `12h` or `30m`.');
            if (dur.totalMs > MAX_TIMEOUT_MS) return reply('❌ Timeouts cannot exceed 28 days.');
            changes.timeoutMs = dur.totalMs; changes.timeoutDisplay = formatDuration(dur.days, dur.hours, dur.minutes, dur.seconds);
        }
        await interaction.deferReply(eph);
        st = await updateStingConfig(guildId, changes);
        const channel = st.channelId && guild.channels.cache.get(st.channelId);
        if (channel && st.warningMessage) { const id = await refreshWarning(channel, st); if (id && id !== st.warningMessageId) st = await updateStingConfig(guildId, { warningMessageId: id }); } // keep the posted text in step with the level
        return reply({ embeds: [statusEmbed(ctx, guild, st, 'Sting Level Updated')] });
    }

    if (sub === 'options') {
        const warn = interaction.options.getBoolean('warning_message'), rename = interaction.options.getBoolean('daily_rename');
        await interaction.deferReply(eph);
        const changes = {}; if (warn !== null) changes.warningMessage = warn; if (rename !== null) { changes.dailyRename = rename; if (rename) changes.lastRenameAt = Date.now(); }
        const before = st; st = await updateStingConfig(guildId, changes);
        const channel = st.channelId && guild.channels.cache.get(st.channelId);
        if (channel && warn !== null) {
            if (warn) { const id = await refreshWarning(channel, st); if (id) st = await updateStingConfig(guildId, { warningMessageId: id }); }
            else if (before.warningMessageId) { await channel.messages.delete(before.warningMessageId).catch(() => {}); st = await updateStingConfig(guildId, { warningMessageId: null }); }
        }
        return reply({ embeds: [statusEmbed(ctx, guild, st, 'Sting Options Updated')] });
    }

    if (sub === 'disable') {
        st = await updateStingConfig(guildId, { enabled: false });
        return reply({ embeds: [statusEmbed(ctx, guild, st, 'Sting Operation Off').setFooter({ text: 'The channel and its warning message were left as they are. Delete them yourself if you no longer want them.' })], ...eph });
    }
}

module.exports = { runSting };

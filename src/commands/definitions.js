// Slash command definitions.
const { ChannelType, SlashCommandBuilder } = require('discord.js');
const { CROSSPOST_DEFAULT_IMAGE_THRESHOLD, CROSSPOST_MAX_IMAGE_THRESHOLD, SCAM_DEFAULT_THRESHOLD, SCAM_MAX_THRESHOLD } = require('../constants');

// Slash command definitions, registered on startup by the ready handler.
const commandBuilders = [
        new SlashCommandBuilder().setName('invite').setDescription('Get a link to invite this bot to another server'),
        new SlashCommandBuilder().setName('warning').setDescription('Manage warnings')
            .addSubcommand(s => s.setName('give').setDescription('Give a warning (guided: pick the path and offense)').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addIntegerOption(o => o.setName('level').setDescription('Skip the guide and give this level straight away')).addStringOption(o => o.setName('path').setDescription('Warning path (default: ask, or the first one)').setAutocomplete(true)).addStringOption(o => o.setName('reason').setDescription('Reason')))
            .addSubcommand(s => s.setName('remove').setDescription('Remove a warning').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('View all active warnings'))
            .addSubcommand(s => s.setName('history').setDescription('View warning history').addUserOption(o => o.setName('user').setDescription('User').setRequired(true))),
        new SlashCommandBuilder().setName('timeout').setDescription('Manage timeouts')
            .addSubcommand(s => s.setName('give').setDescription('Timeout a user').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addStringOption(o => o.setName('duration').setDescription('m:s / h:m:s / d:h:m:s').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')))
            .addSubcommand(s => s.setName('remove').setDescription('Remove a timeout').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason'))),
        new SlashCommandBuilder().setName('mywarnings').setDescription('Check your active warnings'),
        new SlashCommandBuilder().setName('kick').setDescription('Kick a user').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),
        new SlashCommandBuilder().setName('ban').setDescription('Manage bans')
            .addSubcommand(s => s.setName('give').setDescription('Ban a user').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)).addStringOption(o => o.setName('duration').setDescription('Optional timed ban duration')).addIntegerOption(o => o.setName('delete_days').setDescription('Days of messages to delete (0-7)').setMinValue(0).setMaxValue(7)).addStringOption(o => o.setName('delete_messages').setDescription('Also delete messages in last X time after ban (e.g. 1:0:0 = 1 hour)')))
            .addSubcommand(s => s.setName('remove').setDescription('Unban a user')),
        new SlashCommandBuilder().setName('userinfo').setDescription('View user info and mod history').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
        new SlashCommandBuilder().setName('note').setDescription('Manage mod notes')
            .addSubcommand(s => s.setName('add').setDescription('Add a note').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addStringOption(o => o.setName('text').setDescription('Note content').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List all notes for a user').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('View and remove notes').addUserOption(o => o.setName('user').setDescription('User').setRequired(true))),
        new SlashCommandBuilder().setName('config').setDescription('Configure the bot')
            .addSubcommand(s => s.setName('warnings').setDescription('Warning paths, levels, escalation and offenses').addStringOption(o => o.setName('path').setDescription('Warning path to open (default: the first one)').setAutocomplete(true)))
            .addSubcommand(s => s.setName('settings').setDescription('Access role, mod-log channel and DM notifications')),
        new SlashCommandBuilder().setName('escalation').setDescription('Configure auto-escalation rules')
            .addSubcommand(s => s.setName('set').setDescription('Set escalation threshold').addIntegerOption(o => o.setName('level').setDescription('Warning level').setRequired(true)).addIntegerOption(o => o.setName('threshold').setDescription('Number of warnings to trigger').setRequired(true)).addStringOption(o => o.setName('path').setDescription('Warning path (default: the first one)').setAutocomplete(true)))
            .addSubcommand(s => s.setName('cap').setDescription('Set max escalation level').addIntegerOption(o => o.setName('level').setDescription('Cap level').setRequired(true)).addStringOption(o => o.setName('path').setDescription('Warning path (default: the first one)').setAutocomplete(true)))
            .addSubcommand(s => s.setName('timeout').setDescription('Configure timeout-escalation').addIntegerOption(o => o.setName('level').setDescription('Target level (>=2)').setRequired(true)).addIntegerOption(o => o.setName('threshold').setDescription('Warnings needed').setRequired(true)).addStringOption(o => o.setName('duration').setDescription('Timeout duration').setRequired(true)).addStringOption(o => o.setName('path').setDescription('Warning path (default: the first one)').setAutocomplete(true)))
            .addSubcommand(s => s.setName('view').setDescription('View escalation rules').addStringOption(o => o.setName('path').setDescription('Warning path (default: the first one)').setAutocomplete(true))),
        new SlashCommandBuilder().setName('help').setDescription('View all commands and features'),
        new SlashCommandBuilder().setName('globalhashes').setDescription('View and manage global scam image hashes (bot owner only)')
            .addSubcommand(s => s.setName('view').setDescription('View all global scam hashes'))
            .addSubcommand(s => s.setName('add').setDescription('Register a global scam image').addAttachmentOption(o => o.setName('image').setDescription('The scam image').setRequired(true)).addStringOption(o => o.setName('label').setDescription('Label').setRequired(true))),
        new SlashCommandBuilder().setName('scam').setDescription('Manage scam image protection')
            .addSubcommand(s => s.setName('add').setDescription('Register a scam image').addAttachmentOption(o => o.setName('image').setDescription('The scam image').setRequired(true)).addStringOption(o => o.setName('label').setDescription('Label').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List registered scam images'))
            .addSubcommand(s => s.setName('config').setDescription('Configure scam protection').addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable')).addBooleanOption(o => o.setName('delete').setDescription('Delete scam messages')).addStringOption(o => o.setName('timeout').setDescription('Timeout duration or "none"')).addIntegerOption(o => o.setName('threshold').setDescription(`Match strictness, lower = stricter (default ${SCAM_DEFAULT_THRESHOLD}, max ${SCAM_MAX_THRESHOLD})`).setMinValue(0).setMaxValue(SCAM_MAX_THRESHOLD))),
        new SlashCommandBuilder().setName('messages').setDescription('Bulk delete messages')
            .addSubcommand(s => s.setName('delete').setDescription('Delete messages in this channel')
                .addUserOption(o => o.setName('user').setDescription('Only delete messages from this user'))
                .addIntegerOption(o => o.setName('count').setDescription('Max number of messages to delete (default 100)').setMinValue(1).setMaxValue(1000))
                .addStringOption(o => o.setName('within').setDescription('Only delete messages sent in the last X time (e.g. 1:0:0 = 1 hour)')))
            .addSubcommand(s => s.setName('purge').setDescription('Delete all messages in all channels in the last X time')
                .addStringOption(o => o.setName('within').setDescription('Time window (e.g. 1:0:0 = 1 hour)').setRequired(true))
                .addUserOption(o => o.setName('user').setDescription('Only purge messages from this user'))),
        new SlashCommandBuilder().setName('spam').setDescription('Configure spam protection')
            .addSubcommand(s => s.setName('config').setDescription('Configure spam detection').addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable')).addBooleanOption(o => o.setName('delete').setDescription('Delete spam messages')).addIntegerOption(o => o.setName('count').setDescription('Messages to trigger (default 5)').setMinValue(2).setMaxValue(20)).addIntegerOption(o => o.setName('window').setDescription('Time window in seconds (default 10)').setMinValue(3).setMaxValue(60)).addStringOption(o => o.setName('timeout').setDescription('Timeout duration or "none"')).addIntegerOption(o => o.setName('similarity').setDescription('Similarity % (default 70)').setMinValue(50).setMaxValue(100)))
            .addSubcommand(s => s.setName('view').setDescription('View spam protection settings')),
        new SlashCommandBuilder().setName('crosspost').setDescription('Configure cross-channel spam protection (same message pasted in many channels)')
            .addSubcommand(s => s.setName('config').setDescription('Configure cross-channel detection').addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable')).addBooleanOption(o => o.setName('delete').setDescription('Delete the cross-posted messages')).addIntegerOption(o => o.setName('count').setDescription('Distinct channels to trigger (default 3)').setMinValue(2).setMaxValue(20)).addIntegerOption(o => o.setName('window').setDescription('Time window in seconds (default 300)').setMinValue(10).setMaxValue(1800)).addStringOption(o => o.setName('timeout').setDescription('Timeout duration or "none"')).addIntegerOption(o => o.setName('similarity').setDescription('Text similarity % (default 85)').setMinValue(50).setMaxValue(100)).addBooleanOption(o => o.setName('match_images').setDescription('Also match cross-posted images (default true)')).addIntegerOption(o => o.setName('image_threshold').setDescription(`Image match strictness, lower = stricter (default ${CROSSPOST_DEFAULT_IMAGE_THRESHOLD}, max ${CROSSPOST_MAX_IMAGE_THRESHOLD})`).setMinValue(0).setMaxValue(CROSSPOST_MAX_IMAGE_THRESHOLD)))
            .addSubcommand(s => s.setName('view').setDescription('View cross-channel protection settings')),
        new SlashCommandBuilder().setName('sting').setDescription('Sting Operation: a trap channel that punishes spam bots and hijacked accounts')
            .addSubcommand(s => s.setName('setup').setDescription('Create a new sting channel and switch the trap on').addStringOption(o => o.setName('name').setDescription('Channel name (default: a random police-themed name)').setMaxLength(90)))
            .addSubcommand(s => s.setName('channel').setDescription('Use an existing channel as the sting channel').addChannelOption(o => o.setName('channel').setDescription('The channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
            .addSubcommand(s => s.setName('action').setDescription('Choose the punishment for anyone who posts in the sting channel')
                .addStringOption(o => o.setName('level').setDescription('Punishment').setRequired(true).addChoices({ name: 'Delete only: delete their last 24h of messages', value: 'delete' }, { name: 'Timeout + delete: timeout, delete last 24h', value: 'timeout' }, { name: 'Softban: ban + unban, delete last 24h', value: 'softban' }, { name: 'Ban: permanent, delete last 24h', value: 'ban' }))
                .addStringOption(o => o.setName('timeout').setDescription('Timeout length for the timeout level, e.g. 1d or 12h (default 1d)')))
            .addSubcommand(s => s.setName('options').setDescription('Fine-tune the sting channel').addBooleanOption(o => o.setName('warning_message').setDescription('Post the warning embed in the channel (default on)')).addBooleanOption(o => o.setName('daily_rename').setDescription('Rename the channel to a random name every day (needs Manage Channels)')))
            .addSubcommand(s => s.setName('view').setDescription('View the sting settings'))
            .addSubcommand(s => s.setName('disable').setDescription('Turn the sting off')),
    ];

module.exports = { commandBuilders };

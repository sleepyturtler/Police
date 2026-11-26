// Sting operation (trap channel): config, the warning embed posted in the channel, and channel names.
const { EmbedBuilder } = require('discord.js');
const { STING_DEFAULT_TIMEOUT_MS, STING_DELETE_WINDOW_MS } = require('../constants');
const { getConfig, saveConfig } = require('../db');

// What happens to anyone who posts in the sting channel. Every level also removes the trap message itself.
const STING_LEVELS = {
    delete:  { label: 'Delete only',      short: 'their recent messages are deleted' },
    timeout: { label: 'Timeout + delete', short: 'they are timed out and their recent messages are deleted' },
    softban: { label: 'Softban',          short: 'they are removed from the server (ban, then unban) and their recent messages are deleted' },
    ban:     { label: 'Ban',              short: 'they are banned and their recent messages are deleted' },
};

const windowText = () => { const h = Math.round(STING_DELETE_WINDOW_MS / 3_600_000); return `${h} hour${h === 1 ? '' : 's'}`; };

async function getStingConfig(guildId) {
    const cfg = await getConfig(guildId);
    const st = { enabled: false, channelId: null, level: 'softban', timeoutMs: STING_DEFAULT_TIMEOUT_MS, timeoutDisplay: '1d', warningMessage: true, dailyRename: false, ...cfg.sting };
    if (!STING_LEVELS[st.level]) st.level = 'softban';
    return st;
}

// Merges changes into the saved sting config (stored inside the server's config object).
async function updateStingConfig(guildId, changes) {
    const cfg = await getConfig(guildId); cfg.sting = { ...cfg.sting, ...changes }; saveConfig(guildId, cfg); return getStingConfig(guildId);
}

// Called for every message by the other listeners, so it must stay cheap: getConfig is an in-memory lookup.
async function isStingChannel(guildId, channelId) { const cfg = await getConfig(guildId); return !!(cfg.sting?.enabled && cfg.sting.channelId === channelId); }

const warningEmbed = st => new EmbedBuilder().setColor('#ff0000').setTitle('🚨 RESTRICTED AREA').setDescription(`**Do not post in this channel.**\n\nThis is a trap for spam bots and hijacked accounts. Anyone who sends a message here is arrested on the spot: ${STING_LEVELS[st.level].short} (last ${windowText()}).\n\nNothing in here is for you. Keep moving.`).setFooter({ text: 'Police Bot - Sting Operation' });

// Posts the warning embed, or edits the one already posted. Returns the message id, or null if it could not be posted.
async function refreshWarning(channel, st) {
    if (!st.warningMessage) return null;
    try {
        if (st.warningMessageId) { const old = await channel.messages.fetch(st.warningMessageId).catch(() => null); if (old?.editable) { await old.edit({ embeds: [warningEmbed(st)] }); return old.id; } }
        return (await channel.send({ embeds: [warningEmbed(st)] })).id;
    } catch (e) { console.error('sting: warning post failed:', e.message); return null; }
}

const NAMES = ['restricted-area', 'crime-scene', 'evidence-room', 'no-entry', 'police-line', 'stakeout', 'interrogation-room', 'impound-lot', 'holding-cell', 'do-not-cross', 'witness-box', 'lineup'];
const EMOJI = ['🚨', '🚓', '🚧', '🔒', '👮'];
const pick = list => list[Math.floor(Math.random() * list.length)];
const randomChannelName = () => `${pick(EMOJI)}-${pick(NAMES)}`;

module.exports = { STING_LEVELS, getStingConfig, isStingChannel, randomChannelName, refreshWarning, updateStingConfig, warningEmbed, windowText };

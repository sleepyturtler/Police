// The /config warnings panel ("cw:") and the /config settings panel ("cs:"), plus a friendly reply for panels
// that were opened before this version (the old /config view, access and logchannel screens).
const { MessageFlags } = require('discord.js');
const { handleSettings, handleWarnings } = require('../panels');

const OLD = ['configview_', 'escview_', 'escalationview_', 'access_role_', 'logchannel_select_', 'removelogchannel_'];

const matches = interaction => typeof interaction.customId === 'string' && (/^c[ws]:/.test(interaction.customId) || OLD.some(p => interaction.customId.startsWith(p)));

async function handle(interaction) {
    const id = interaction.customId;
    if (id.startsWith('cw:')) return handleWarnings(interaction);
    if (id.startsWith('cs:')) return handleSettings(interaction);
    return interaction.reply({ content: '\u26A0\uFE0F This panel is from an older version. Run `/config warnings` or `/config settings` for the new one.', flags: [MessageFlags.Ephemeral] });
}

module.exports = { matches, handle };

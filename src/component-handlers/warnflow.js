// The guided warning flow (buttons, menus and the details pop-up all share the "wf:" prefix).
const { handleFlow } = require('../warnflow');

const matches = interaction => typeof interaction.customId === 'string' && interaction.customId.startsWith('wf:');

module.exports = { matches, handle: handleFlow };

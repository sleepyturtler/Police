// Routes buttons, select menus and modals to the module that owns their customId prefix.
const handlers = [require('./warnflow'), require('./panels'), require('./scam'), require('./moderation'), require('./records'), require('./help')];

async function handleComponents(interaction) {
    const handler = handlers.find(h => h.matches(interaction));
    if (handler) return handler.handle(interaction);
}

module.exports = { handleComponents };

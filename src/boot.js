// Entry point: loads every module, then logs in.
require('./events');
require('./scam/detect');
require('./spam/detect');
require('./interactions');
require('./diagnostics');
require('./web/server');
const { client } = require('./client');

process.on('unhandledRejection', e => console.error('⚠️ Unhandled rejection:', e));

client.on('error', e => console.error('⚠️ Discord client error:', e));

client.login(process.env.DISCORD_TOKEN);

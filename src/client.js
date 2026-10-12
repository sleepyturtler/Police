// The single shared Discord client and its cache limits.
const { Client, GatewayIntentBits, Options } = require('discord.js');

// discord.js v14 only caps MessageManager by default (200/channel) — GuildMemberManager and
// UserManager default to Infinity. Every message author and every member ever resolved via a
// command (kick/ban/timeout/warning/scam/spam/crosspost, all of it) gets cached forever with
// no eviction, which is the actual driver of the slow multi-hour memory climb: it grows with
// cumulative traffic, not with any single event, and only resets on restart. Bounding these
// doesn't change command behavior — the target of any command is freshly resolved by the
// interaction itself and lands in the cache right when the handler runs, regardless of size.
// guild.members.me is just a lookup in this cache, and eviction is oldest-first. The bot's own member
// is added first, so once a server fills the cache it would be evicted, guild.members.me would become
// null, and every permission check in that server would throw. keepOverLimit below prevents that.
const MEMBER_CACHE_LIMIT = parseInt(process.env.MEMBER_CACHE_LIMIT) || 150;

   // per guild
const USER_CACHE_LIMIT = parseInt(process.env.USER_CACHE_LIMIT) || 2000;

     // global, shared across all guilds
// discord.js keeps the last 200 messages per channel by default. With the MessageContent intent each
// cached message holds its full text, embeds and attachment data, and the total scales with how many
// channels are active. Nothing in this bot reads the message cache: the spam and cross-post trackers
// keep their own small records, and every delete goes through the API by id. 0 disables it.
// (Not parseInt(...) || default, because 0 is a valid value here.)
const MESSAGE_CACHE_LIMIT = Number.isFinite(parseInt(process.env.MESSAGE_CACHE_LIMIT)) ? parseInt(process.env.MESSAGE_CACHE_LIMIT) : 0;

 // per channel
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: MESSAGE_CACHE_LIMIT, GuildMemberManager: { maxSize: MEMBER_CACHE_LIMIT, keepOverLimit: member => member.id === client.user?.id }, UserManager: USER_CACHE_LIMIT }),
});

module.exports = { client };

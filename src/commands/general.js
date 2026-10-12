// /invite and /help.
const { MessageFlags } = require('discord.js');
const { INVITE_PERMISSIONS } = require('../constants');
const { client } = require('../client');
const { helpOverviewEmbed, helpRows } = require('../ui/help');

async function runInvite(ctx) {
    const { E, reply } = ctx;
    const perms = INVITE_PERMISSIONS;
    return reply({ embeds: [E('#5865F2','➕ Invite Police Bot').setDescription(`[**Click here to invite me**](https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=${perms}&scope=bot%20applications.commands)\n\nThis link requests the minimum permissions needed to function correctly.`).addFields({ name: 'Permissions Requested', value: '• Manage Roles — assign/remove warning roles\n• Kick & Ban Members — moderation commands\n• Moderate Members — timeouts\n• Manage Messages - delete scam and spam messages\n• Send Messages & Embed Links — responses\n• View Audit Log — detect who added the bot\n• Read Message History — channel access' }).setFooter({ text: 'You can adjust permissions after inviting' })], flags: [MessageFlags.Ephemeral] });
}

async function runHelp(ctx) {
    const { reply } = ctx; await reply({ embeds: [helpOverviewEmbed()], components: helpRows(), flags: [MessageFlags.Ephemeral] }); 
}

module.exports = { runHelp, runInvite };

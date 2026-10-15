// /userinfo and /note.
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { activeWarnings, addNote, getAllHistory, getNotes } = require('../db');
const { buildNoteListEmbed, buildNoteViewEmbed, refreshBtn } = require('../ui/embeds');

async function runUserinfo(ctx) {
    const { interaction, guildId } = ctx;
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const user = interaction.options.getUser('user');
    const [member, history, notes] = await Promise.all([interaction.guild.members.fetch(user.id).catch(() => null), getAllHistory(guildId, user.id), getNotes(guildId, user.id)]);
    const embed = new EmbedBuilder().setColor('#5865F2').setAuthor({ name: user.tag, iconURL: user.displayAvatarURL({ size: 256 }) }).setThumbnail(user.displayAvatarURL({ size: 256 })).addFields({ name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp/1000)}:F>\n<t:${Math.floor(user.createdTimestamp/1000)}:R>`, inline: true }, { name: 'Joined Server', value: member ? `<t:${Math.floor(member.joinedTimestamp/1000)}:F>\n<t:${Math.floor(member.joinedTimestamp/1000)}:R>` : '*Not in server*', inline: true }).setTimestamp();
    const activeUserWarnings = [...activeWarnings.values()].filter(w => w.guildId === guildId && w.userId === user.id), activeByLevel = {};
    for (const w of activeUserWarnings) activeByLevel[w.level] = (activeByLevel[w.level] || 0) + 1;
    embed.addFields({ name: 'Active Warnings', value: Object.keys(activeByLevel).length ? Object.entries(activeByLevel).sort(([a],[b])=>a-b).map(([l,c])=>`Level ${l}: **${c}**`).join('\n') : 'None', inline: true });
    const warnCounts = {}, timeoutCount = history.filter(e => e.type === 'timeout').length, kickCount = history.filter(e => e.type === 'kick').length, banCount = history.filter(e => e.type === 'ban').length;
    for (const e of history) if (e.level != null) warnCounts[e.level] = (warnCounts[e.level] || 0) + 1;
    if (Object.keys(warnCounts).length) embed.addFields({ name: 'Warn History', value: Object.entries(warnCounts).sort(([a],[b])=>a-b).map(([l,c])=>`Level ${l}: **${c}**`).join('\n'), inline: true });
    const modLines = [...(timeoutCount?[`Timeouts: **${timeoutCount}**`]:[]), ...(kickCount?[`Kicks: **${kickCount}**`]:[]), ...(banCount?[`Bans: **${banCount}**`]:[])];
    if (modLines.length) embed.addFields({ name: 'Mod Actions', value: modLines.join('\n'), inline: true });
    if (notes.length) { const shown = notes.slice(-5); embed.addFields({ name: `Notes (${notes.length})`, value: shown.map(n => `\`${n.id}\` <t:${Math.floor(n.addedAt/1000)}:d> by **${n.addedBy}**\n${n.text.slice(0,100)}${n.text.length>100?'…':''}`).join('\n\n') }); if (notes.length > 5) embed.setFooter({ text: `Showing last 5 of ${notes.length} notes` }); }
    await interaction.editReply({ embeds: [embed], components: [refreshBtn(`userinfo_refresh_${user.id}_${guildId}`)] });
}

async function runNote(ctx) {
    const { interaction, guildId, reply } = ctx;
    const sub = interaction.options.getSubcommand(), user = interaction.options.getUser('user');
    if (sub === 'add') {
        const text = interaction.options.getString('text').slice(0,1000).replace(/[\x00-\x1F\x7F]/g,'');
        const note = { id: Date.now(), text, addedBy: interaction.user.tag, addedAt: Date.now() };
        addNote(guildId, user.id, note); await reply(`✅ Note added to ${user} (ID: \`${note.id}\`).`);
    } else if (sub === 'list') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const embed = await buildNoteListEmbed(guildId, user);
        await interaction.editReply({ embeds: [embed] });
    } else if (sub === 'remove') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const { embeds, components } = await buildNoteViewEmbed(guildId, user);
        await interaction.editReply({ embeds, components });
    }
}

module.exports = { runNote, runUserinfo };

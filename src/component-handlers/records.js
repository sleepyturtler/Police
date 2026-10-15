// Note removal menu and the userinfo refresh button.
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { buildNoteViewEmbed, customIdMatches, refreshBtn } = require('../ui/embeds');
const { hasCommandPermission } = require('../helpers');
const { activeWarnings, deleteNote, getAllHistory, getNotes } = require('../db');

function matches(interaction) {
    const id = interaction.customId;
    if (interaction.isStringSelectMenu()) return id.startsWith('noteview_remove_');
    if (interaction.isButton()) return id.startsWith('userinfo_refresh_');
    return false;
}

async function handle(interaction) {
    if (interaction.isStringSelectMenu() && customIdMatches(interaction.customId, ['noteview_remove_'])) {
        if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
        const { customId, values } = interaction, value = values[0];
        await interaction.deferUpdate();
        if (customId.startsWith('noteview_remove_')) {
            const parts = customId.slice(16).split('_'), guildId = parts[0], userId = parts[1];
            await deleteNote(guildId, userId, parseInt(value));
            const user = await interaction.client.users.fetch(userId).catch(() => null);
            if (!user) return interaction.editReply({ content: '❌ Could not fetch user.', embeds: [], components: [] });
            const { embeds, components } = await buildNoteViewEmbed(guildId, user);
            return interaction.editReply({ embeds, components });
        }
        return;
    }
    if (interaction.isButton()) {
        const { customId } = interaction;
        if (customId.startsWith('userinfo_refresh_')) {
            if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            const parts = customId.slice(17).split('_'), userId = parts[0], guildId = parts[1];
            await interaction.deferUpdate();
            const user = await interaction.client.users.fetch(userId).catch(() => null);
            if (!user) return interaction.editReply({ content: '❌ Could not fetch user.', embeds: [], components: [] });
            const [member, history, notes] = await Promise.all([interaction.guild.members.fetch(userId).catch(() => null), getAllHistory(guildId, userId), getNotes(guildId, userId)]);
            const embed = new EmbedBuilder().setColor('#5865F2').setAuthor({ name: user.tag, iconURL: user.displayAvatarURL({ size: 256 }) }).setThumbnail(user.displayAvatarURL({ size: 256 })).addFields({ name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp/1000)}:F>\n<t:${Math.floor(user.createdTimestamp/1000)}:R>`, inline: true }, { name: 'Joined Server', value: member ? `<t:${Math.floor(member.joinedTimestamp/1000)}:F>\n<t:${Math.floor(member.joinedTimestamp/1000)}:R>` : '*Not in server*', inline: true }).setTimestamp();
            const activeUserWarnings = [...activeWarnings.values()].filter(w => w.guildId === guildId && w.userId === userId), activeByLevel = {};
            for (const w of activeUserWarnings) activeByLevel[w.level] = (activeByLevel[w.level] || 0) + 1;
            embed.addFields({ name: 'Active Warnings', value: Object.keys(activeByLevel).length ? Object.entries(activeByLevel).sort(([a],[b])=>a-b).map(([l,c])=>`Level ${l}: **${c}**`).join('\n') : 'None', inline: true });
            const warnCounts = {}, timeoutCount = history.filter(e => e.type === 'timeout').length, kickCount = history.filter(e => e.type === 'kick').length, banCount = history.filter(e => e.type === 'ban').length;
            for (const e of history) if (e.level != null) warnCounts[e.level] = (warnCounts[e.level] || 0) + 1;
            if (Object.keys(warnCounts).length) embed.addFields({ name: 'Warn History', value: Object.entries(warnCounts).sort(([a],[b])=>a-b).map(([l,c])=>`Level ${l}: **${c}**`).join('\n'), inline: true });
            const modLines = [...(timeoutCount?[`Timeouts: **${timeoutCount}**`]:[]), ...(kickCount?[`Kicks: **${kickCount}**`]:[]), ...(banCount?[`Bans: **${banCount}**`]:[])];
            if (modLines.length) embed.addFields({ name: 'Mod Actions', value: modLines.join('\n'), inline: true });
            if (notes.length) { const shown = notes.slice(-5); embed.addFields({ name: `Notes (${notes.length})`, value: shown.map(n => `\`${n.id}\` <t:${Math.floor(n.addedAt/1000)}:d> by **${n.addedBy}**\n${n.text.slice(0,100)}${n.text.length>100?'…':''}`).join('\n\n') }); if (notes.length > 5) embed.setFooter({ text: `Showing last 5 of ${notes.length} notes` }); }
            return interaction.editReply({ embeds: [embed], components: [refreshBtn(customId)] });
        }
        return;
    }
}

module.exports = { matches, handle };

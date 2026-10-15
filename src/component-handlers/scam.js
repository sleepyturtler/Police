// Scam registry buttons, menus and near-match review.
const { MessageFlags } = require('discord.js');
const { OWNER_ID } = require('../constants');
const { addGlobalScamHash, addScamHash, clearGlobalScamHashCache, getScamHashes, getScamProtConfig, pendingNearMatches, removeGlobalScamHash, removeScamHash, scamHashCache } = require('../scam/store');
const { buildGlobalHashesEmbed, buildScamListEmbed, customIdMatches } = require('../ui/embeds');
const { hasCommandPermission } = require('../helpers');
const { hammingDistance } = require('../scam/hashing');

function matches(interaction) {
    const id = interaction.customId;
    if (interaction.isStringSelectMenu()) return id === 'globalhashes_remove' || id.startsWith('scamlist_remove_');
    if (interaction.isButton()) return id.startsWith('nearmatch_addserver_') || id.startsWith('nearmatch_addglobal_') || id.startsWith('scamlist_refresh_') || id === 'globalhashes_refresh';
    return false;
}

async function handle(interaction) {
    if (interaction.isStringSelectMenu() && interaction.customId === 'globalhashes_remove') {
        if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Restricted to the bot owner.', flags: [MessageFlags.Ephemeral] });
        await interaction.deferUpdate();
        await removeGlobalScamHash(parseInt(interaction.values[0]));
        const { embeds, components } = await buildGlobalHashesEmbed();
        return interaction.editReply({ embeds, components });
    }
    if (interaction.isStringSelectMenu() && customIdMatches(interaction.customId, ['scamlist_remove_'])) {
        if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
        const { customId, values } = interaction, value = values[0];
        await interaction.deferUpdate();
        if (customId.startsWith('scamlist_remove_')) {
            const guildId = customId.slice(16);
            await removeScamHash(guildId, parseInt(value));
            const { embeds, components } = await buildScamListEmbed(guildId);
            return interaction.editReply({ embeds, components });
        }
        return;
    }
    if (interaction.isButton()) {
        const { customId } = interaction;
        if (customId.startsWith('nearmatch_addserver_') || customId.startsWith('nearmatch_addglobal_')) {
            const isGlobalAdd = customId.startsWith('nearmatch_addglobal_');
            if (isGlobalAdd) {
                if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Only the bot owner can add to the global scam list.', flags: [MessageFlags.Ephemeral] });
            } else {
                if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            }
            const pendingId = customId.slice(20);
            const pending = pendingNearMatches.get(pendingId);
            if (!pending) return interaction.reply({ content: '❌ This review has expired (30 min limit). Use `/scam add` with the image manually instead.', flags: [MessageFlags.Ephemeral] });
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const label = `${pending.label} (variant)`;
            try {
                if (isGlobalAdd) {
                    const entry = await addGlobalScamHash(pending.hash, label, interaction.user.tag);
                    await interaction.editReply(`✅ Added to **global** scam list as "${label}" (ID: \`${entry.id}\`). This image will now be auto-removed in **all servers**.`);
                } else {
                    const guildId = interaction.guild.id;
                    const existing = await getScamHashes(guildId), spc = await getScamProtConfig(guildId);
                    for (const e of existing) { if (hammingDistance(pending.hash, e.hash) <= spc.threshold) return interaction.editReply(`❌ Already registered (or similar to) **${e.label}** (ID: \`${e.id}\`).`); }
                    const entry = await addScamHash(guildId, pending.hash, label, interaction.user.tag);
                    await interaction.editReply(`✅ Added to this server's scam list as "${label}" (ID: \`${entry.id}\`).`);
                }
                pendingNearMatches.delete(pendingId);
            } catch (e) { console.error('nearmatch add:', e.message); await interaction.editReply('❌ Failed to add hash.'); }
            return;
        }
        if (customId.startsWith('scamlist_refresh_')) {
            if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            await interaction.deferUpdate();
            const guildId = customId.slice(17); scamHashCache.delete(guildId);
            const { embeds, components } = await buildScamListEmbed(guildId);
            return interaction.editReply({ embeds, components });
        }
        if (customId === 'globalhashes_refresh') {
            if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Restricted to the bot owner.', flags: [MessageFlags.Ephemeral] });
            await interaction.deferUpdate();
            clearGlobalScamHashCache();
            const { embeds, components } = await buildGlobalHashesEmbed();
            return interaction.editReply({ embeds, components });
        }
        return;
    }
}

module.exports = { matches, handle };

// Config and escalation views, mod-log channel and access role pickers.
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { buildConfigViewEmbed, buildEscalationViewEmbed, buildLogChannelEmbed, customIdMatches } = require('../ui/embeds');
const { hasCommandPermission } = require('../helpers');
const { getConfig, saveConfig } = require('../db');
const { SUPPORT_SERVER_URL } = require('../constants');

function matches(interaction) {
    const id = interaction.customId;
    if (interaction.isStringSelectMenu()) return id.startsWith('configview_removelevel_') || id.startsWith('escview_removethreshold_') || id.startsWith('escview_removetimeout_');
    if (interaction.isChannelSelectMenu()) return id.startsWith('logchannel_select_');
    if (interaction.isRoleSelectMenu()) return id.startsWith('access_role_');
    if (interaction.isButton()) return id.startsWith('removelogchannel_') || id.startsWith('configview_refresh_') || id.startsWith('escalationview_refresh_') || id.startsWith('escview_removecap_');
    return false;
}

async function handle(interaction) {
    if (interaction.isStringSelectMenu() && customIdMatches(interaction.customId, ['configview_removelevel_','escview_removethreshold_','escview_removetimeout_'])) {
        if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
        const { customId, values } = interaction, value = values[0];
        await interaction.deferUpdate();
        if (customId.startsWith('configview_removelevel_')) {
            const guildId = customId.slice(23), cfg = await getConfig(guildId);
            delete cfg.levels?.[value]; saveConfig(guildId, cfg);
            const { embeds, components } = await buildConfigViewEmbed(guildId);
            return interaction.editReply({ embeds, components });
        }
        if (customId.startsWith('escview_removethreshold_')) {
            const guildId = customId.slice(25), cfg = await getConfig(guildId);
            delete cfg.escalation?.thresholds?.[value]; saveConfig(guildId, cfg);
            const { embeds, components } = await buildEscalationViewEmbed(guildId);
            return interaction.editReply({ embeds, components });
        }
        if (customId.startsWith('escview_removetimeout_')) {
            const guildId = customId.slice(22), cfg = await getConfig(guildId);
            delete cfg.escalation?.timeouts?.[value]; saveConfig(guildId, cfg);
            const { embeds, components } = await buildEscalationViewEmbed(guildId);
            return interaction.editReply({ embeds, components });
        }
        return;
    }
    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('logchannel_select_')) {
        if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
        const guildId = interaction.customId.slice(19), channel = interaction.channels.first();
        if (!channel) return interaction.reply({ content: '❌ No channel selected.', flags: [MessageFlags.Ephemeral] });
        await interaction.deferUpdate();
        const cfg = await getConfig(guildId); cfg.logChannelId = channel.id; cfg.supportLinkAnnounced = true; saveConfig(guildId, cfg);
        channel.send(`📌 **Join my Support Server:** ${SUPPORT_SERVER_URL}`).catch(() => {});
        const { embeds, components } = await buildLogChannelEmbed(guildId);
        return interaction.editReply({ embeds, components });
    }
    if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('access_role_')) {
        const guildId = interaction.customId.replace('access_role_', '');
        if (guildId !== interaction.guild.id) return interaction.reply({ content: '❌ Invalid interaction.', flags: [MessageFlags.Ephemeral] });
        const role = interaction.roles.first();
        if (!role) return interaction.reply({ content: '❌ No role selected.', flags: [MessageFlags.Ephemeral] });
        if (role.id === interaction.guild.id) return interaction.update({ content: '❌ Cannot use @everyone.', components: [] });
        if (role.managed) return interaction.update({ content: '❌ Cannot use managed/bot roles.', components: [] });
        const cfg = await getConfig(guildId); cfg.accessRoleId = role.id; saveConfig(guildId, cfg);
        await interaction.update({ embeds: [new EmbedBuilder().setColor('#00ff00').setTitle('Access Control Updated').setDescription(`Members with the ${role} role can now use moderation commands.\n\n*Server administrators always have access.*`).setTimestamp()], components: [] });
        return;
    }
    if (interaction.isButton()) {
        const { customId } = interaction;
        if (customId.startsWith('removelogchannel_')) {
            if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            await interaction.deferUpdate();
            const guildId = customId.slice(18), cfg = await getConfig(guildId);
            delete cfg.logChannelId; saveConfig(guildId, cfg);
            const { embeds, components } = await buildLogChannelEmbed(guildId);
            return interaction.editReply({ embeds, components });
        }
        if (customId.startsWith('configview_refresh_')) {
            if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            await interaction.deferUpdate();
            const { embeds, components } = await buildConfigViewEmbed(customId.slice(19));
            return interaction.editReply({ embeds, components });
        }
        if (customId.startsWith('escalationview_refresh_')) {
            if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            await interaction.deferUpdate();
            const { embeds, components } = await buildEscalationViewEmbed(customId.slice(23));
            return interaction.editReply({ embeds, components });
        }
        if (customId.startsWith('escview_removecap_')) {
            if (!await hasCommandPermission(interaction, interaction.guild.id)) return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            await interaction.deferUpdate();
            const guildId = customId.slice(19), cfg = await getConfig(guildId);
            delete cfg.escalation?.cap; saveConfig(guildId, cfg);
            const { embeds, components } = await buildEscalationViewEmbed(guildId);
            return interaction.editReply({ embeds, components });
        }
        return;
    }
}

module.exports = { matches, handle };

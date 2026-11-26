// The guided /warning give flow: path, offense, details, confirmation. Everything happens in one ephemeral message
// that only the moderator who started it can use, expires after FLOW_TTL_MS, and issues the warning exactly once.
//
//   /warning give user:        guided flow
//   /warning give user level:  the old one-step shortcut (on the chosen or first path)
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits,
    StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { FLOW_TTL_MS } = require('./constants');
const { activeWarnings, getConfig } = require('./db');
const { hasCommandPermission, logMod } = require('./helpers');
const { getPath, getPaths, multiPath, pathLabel, pathList, warnableLevels, warningPathId } = require('./paths');
const { applyWarning, checkEscalation, forecastEscalation } = require('./warnings');

const EPH = [MessageFlags.Ephemeral], BLUE = '#5865F2', RED = '#ff0000';
const flows = new Map(); // flowId -> state. Bounded and short lived.
const MAX_FLOWS = 200;

const emb = (title, color = BLUE) => new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
const btn = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const cleanReason = s => String(s ?? '').slice(0, 1000).replace(/[\x00-\x1F\x7F]/g, '').trim();
const trim = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '\u2026' : String(s));

function remember(flow) {
    if (flows.size >= MAX_FLOWS) flows.delete(flows.keys().next().value);
    flows.set(flow.id, flow);
    setTimeout(() => flows.delete(flow.id), FLOW_TTL_MS).unref();
}

// What a warning on this path would do, in words, for the user and the moderator.
function describeEscalation(esc, level, user) {
    if (!esc) return null;
    if (esc.escalated) return `${user} auto-escalated to **Level ${esc.nextLevel}**${esc.role ? ` (${esc.role})` : ''}.${esc.timedOut ? ` Timeout: **${esc.timeoutDisplay}**.` : ''}${esc.hitCap ? ` Reached the cap (Level ${esc.nextLevel}).` : ''}`;
    if (esc.atCap) return `Threshold reached for Level ${level}, but the cap (Level ${esc.cap}) prevents further escalation.`;
    if (esc.noNextLevel) return `Threshold reached for Level ${level}, but Level ${esc.nextLevel} is not configured on this path.`;
    if (esc.escalationError) return `\u26A0\uFE0F Escalation failed: ${esc.escalationError}`;
    if (esc.counted) return `${esc.count} of ${esc.threshold} warnings at Level ${level}.`;
    return null;
}

// Applies the warning, logs it, runs escalation. Returns { error } or { embed }. Used by the guided flow and the one-step shortcut.
async function issueWarning({ guild, issuer, channelId, user, member, pathId, level, reason, offense = null }) {
    const guildId = guild.id, cfg = await getConfig(guildId), path = getPath(cfg, pathId), lc = path.levels[level];
    if (!lc || lc.isTimeoutLevel) return { error: `Level ${level} is not configured${multiPath(cfg) ? ` on ${path.name}` : ''}. Use /config warnings to add it.` };
    const role = guild.roles.cache.get(lc.roleId), me = guild.members.me;
    if (!role) return { error: 'The configured role no longer exists. Add this level again in /config warnings.' };
    if (role.position >= me.roles.highest.position) return { error: `My role must be above ${role} in the role list.` };
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return { error: 'I need the "Manage Roles" permission.' };
    const result = await applyWarning(guild, member, user, guildId, level, reason, channelId, issuer.tag, { pathId: path.id, offense });
    if (result.error) return { error: result.error };
    const multi = multiPath(cfg), where = [...(multi ? [{ name: 'Path', value: pathLabel(path), inline: true }] : []), ...(offense ? [{ name: 'Offense', value: offense, inline: true }] : [])];
    logMod(guild, guildId, emb('Warning Issued', RED).addFields({ name: 'User', value: `${user} (${user.tag})`, inline: true }, { name: 'Level', value: `${level}`, inline: true }, { name: 'Duration', value: result.config.durationDisplay || 'Unknown', inline: true }, ...where, { name: 'Reason', value: reason }, { name: 'Moderator', value: `${issuer}` }));
    const esc = await checkEscalation(guild, member, user, guildId, level, channelId, issuer.tag, { pathId: path.id });
    const text = describeEscalation(esc, level, user);
    const embed = emb('Warning Issued', RED).addFields({ name: 'User', value: `${user}`, inline: true }, { name: 'Level', value: `${level}`, inline: true }, { name: 'Role', value: `${result.role}`, inline: true }, { name: 'Duration', value: result.config.durationDisplay || 'Unknown', inline: true }, ...where, { name: 'Reason', value: reason }, { name: 'Issued by', value: `${issuer}` });
    if (text) embed.addFields({ name: 'Escalation', value: text });
    return { embed, esc };
}

// ── Screens ────────────────────────────────────────────────────────────────

const cancelRow = (flow, ...before) => new ActionRowBuilder().addComponents(...before, btn(`wf:${flow.id}:cancel`, 'Cancel', ButtonStyle.Danger));
const select = (flow, action, placeholder, options) => new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`wf:${flow.id}:${action}`).setPlaceholder(placeholder).addOptions(options));

// Which step comes before this one, or null if it is the first.
function previousStep(flow, cfg) {
    const path = getPath(cfg, flow.pathId), multi = multiPath(cfg) && !flow.pathLocked;
    if (flow.step === 'confirm') return 'details';
    if (flow.step === 'details') return flow.viaLevel ? 'level' : 'offense';
    if (flow.step === 'level') return path.offenses.length ? 'offense' : multi ? 'path' : null;
    if (flow.step === 'offense') return multi ? 'path' : null;
    return null;
}

function progress(flow, cfg, path) {
    return [{ name: 'User', value: `<@${flow.targetId}> (${flow.targetTag})`, inline: true },
        ...(multiPath(cfg) && flow.pathId ? [{ name: 'Path', value: pathLabel(path), inline: true }] : []),
        ...(flow.offenseLabel ? [{ name: 'Offense', value: flow.offenseLabel, inline: true }] : []),
        ...(flow.level ? [{ name: 'Level', value: `${flow.level}`, inline: true }] : [])];
}

async function render(flow, note = null) {
    const cfg = await getConfig(flow.guildId), path = getPath(cfg, flow.pathId), multi = multiPath(cfg);
    const e = emb('\u26A0\uFE0F Warn Member');
    const back = previousStep(flow, cfg), backBtn = back ? [btn(`wf:${flow.id}:back`, 'Back')] : [];
    const fields = progress(flow, cfg, path);
    if (note) e.setDescription(note);

    if (flow.step === 'path') {
        e.setDescription((note ? note + '\n\n' : '') + 'What kind of offense is this?').addFields(fields);
        return { embeds: [e], components: [select(flow, 'path', 'Choose a path\u2026', pathList(cfg).map(p => ({ label: trim(pathLabel(p), 100), description: trim(p.description || `${Object.keys(p.levels).length} levels, ${p.offenses.length} offenses`, 100), value: p.id }))), cancelRow(flow)] };
    }
    if (flow.step === 'offense') {
        const options = [...path.offenses.map(o => ({ label: trim(o.label, 100), description: trim(o.level && path.levels[o.level] ? `Level ${o.level}: ${o.reason}` : o.reason, 100), value: o.id })), { label: 'Other (choose a level)', description: 'Pick the level yourself', value: 'other' }];
        e.setDescription((note ? note + '\n\n' : '') + `Which offense${multi ? ` on **${path.name}**` : ''}?`).addFields(fields);
        return { embeds: [e], components: [select(flow, 'offense', 'Choose an offense\u2026', options), cancelRow(flow, ...backBtn)] };
    }
    if (flow.step === 'level') {
        const levels = warnableLevels(path);
        if (!levels.length) {
            flows.delete(flow.id);
            return { embeds: [emb('No Warning Levels', BLUE).setDescription(`${multi ? `**${path.name}** has` : 'This server has'} no warning levels yet. Open \`/config warnings\` to add one, then run \`/warning give\` again.`)], components: [] };
        }
        e.setDescription((note ? note + '\n\n' : '') + 'Which level?').addFields(fields);
        return { embeds: [e], components: [select(flow, 'level', 'Choose a level\u2026', levels.slice(0, 25).map(n => ({ label: `Level ${n}: ${path.levels[n].roleName || 'role'}`, description: path.levels[n].durationDisplay || 'Unknown duration', value: `${n}` }))), cancelRow(flow, ...backBtn)] };
    }
    if (flow.step === 'details') {
        e.setDescription((note ? note + '\n\n' : '') + `**Reason:** ${flow.reason}\n\nAdd more detail, or continue with this reason.`).addFields(fields);
        return { embeds: [e], components: [cancelRow(flow, btn(`wf:${flow.id}:details`, 'Add details', ButtonStyle.Primary), btn(`wf:${flow.id}:continue`, 'Continue', ButtonStyle.Success), ...backBtn)] };
    }
    // confirm
    const lc = path.levels[flow.level], fc = forecastEscalation(cfg, flow.guildId, flow.targetId, path.id, flow.level);
    const mine = [...activeWarnings.values()].filter(w => w.guildId === flow.guildId && w.userId === flow.targetId && warningPathId(w, cfg) === path.id), byLevel = {};
    for (const w of mine) byLevel[w.level] = (byLevel[w.level] ?? 0) + 1;
    const have = Object.keys(byLevel).sort((a, b) => a - b).map(l => `Level ${l} x${byLevel[l]}`).join(', ') || 'None';
    let forecast = 'No escalation rule applies at this level.';
    if (fc?.atCap) forecast = `The cap (Level ${fc.cap}) is reached, so there is no further escalation.`;
    else if (fc) forecast = fc.willEscalate
        ? `**${fc.count} of ${fc.threshold}: this warning escalates them to Level ${fc.nextLevel}${fc.timeout ? ` with a ${fc.timeout} timeout` : ''}.**${fc.nextConfigured ? '' : ` Level ${fc.nextLevel} is not configured, so it cannot happen.`}`
        : `${fc.count} of ${fc.threshold} at Level ${flow.level}. ${fc.threshold - fc.count} more before Level ${fc.nextLevel}${fc.timeout ? ` and a ${fc.timeout} timeout` : ''}.`;
    e.setTitle('\u26A0\uFE0F Confirm Warning').setDescription((note ? note + '\n\n' : '') + `This will warn <@${flow.targetId}> and give them the role below.`)
        .addFields(...fields.filter(f => f.name !== 'Level'), { name: 'Level', value: `${flow.level}`, inline: true }, { name: 'Role', value: `<@&${lc.roleId}>`, inline: true }, { name: 'Duration', value: lc.durationDisplay || 'Unknown', inline: true }, { name: 'Reason', value: flow.reason }, { name: `Active warnings${multi ? ` on ${path.name}` : ''}`, value: have }, { name: 'Escalation', value: forecast });
    return { embeds: [e], components: [cancelRow(flow, btn(`wf:${flow.id}:confirm`, 'Confirm', ButtonStyle.Success), ...backBtn)] };
}

// ── Entry points ───────────────────────────────────────────────────────────

async function startFlow(ctx, { user, member, pathId, reason }) {
    const { interaction, guildId, reply } = ctx, cfg = await getConfig(guildId);
    const flow = { id: interaction.id, modId: interaction.user.id, guildId, channelId: interaction.channel.id, targetId: user.id, targetTag: user.tag, pathId: pathId ?? null, pathLocked: !!pathId, offenseId: null, offenseLabel: null, level: null, viaLevel: false, customReason: !!reason, reason: cleanReason(reason) || 'No reason provided' };
    if (!flow.pathId) { if (multiPath(cfg)) flow.step = 'path'; else { flow.pathId = getPath(cfg).id; flow.step = getPath(cfg).offenses.length ? 'offense' : 'level'; } }
    else flow.step = getPath(cfg, flow.pathId).offenses.length ? 'offense' : 'level';
    remember(flow);
    await reply({ ...(await render(flow)), flags: EPH });
}

const reject = (interaction, text) => interaction.reply({ content: text, flags: EPH });

async function handleFlow(interaction) {
    const [, flowId, action] = interaction.customId.split(':'), flow = flows.get(flowId);
    const gone = () => (interaction.isFromMessage?.() || interaction.isMessageComponent?.()
        ? interaction.update({ embeds: [emb('Warning Flow Expired').setDescription('This flow timed out or was already finished. Run `/warning give` again.')], components: [] })
        : reject(interaction, '\u274C This warning flow expired. Run `/warning give` again.'));
    if (!flow) return gone();
    if (interaction.user.id !== flow.modId) return reject(interaction, '\u274C This is not your warning flow.');
    if (!interaction.guild || interaction.guild.id !== flow.guildId || !await hasCommandPermission(interaction, flow.guildId)) return reject(interaction, '\u274C You no longer have permission to do this.');
    const cfg = await getConfig(flow.guildId);

    if (action === 'cancel') { flows.delete(flowId); return interaction.update({ embeds: [emb('Warning Cancelled').setDescription('No warning was issued.')], components: [] }); }

    if (action === 'back') { const prev = previousStep(flow, cfg); if (prev) flow.step = prev; return interaction.update(await render(flow)); }

    if (action === 'path') {
        const id = interaction.values?.[0]; if (!getPaths(cfg)[id]) return interaction.update(await render(flow, '\u274C That path no longer exists.'));
        Object.assign(flow, { pathId: id, offenseId: null, offenseLabel: null, level: null, viaLevel: false });
        flow.step = getPath(cfg, id).offenses.length ? 'offense' : 'level';
        return interaction.update(await render(flow));
    }

    if (action === 'offense') {
        const path = getPath(cfg, flow.pathId), id = interaction.values?.[0], o = path.offenses.find(x => x.id === id);
        flow.level = null; flow.viaLevel = false;
        if (id === 'other' || !o) { flow.offenseId = null; flow.offenseLabel = null; flow.step = 'level'; return interaction.update(await render(flow)); }
        flow.offenseId = o.id; flow.offenseLabel = o.label; if (!flow.customReason) flow.reason = cleanReason(o.reason) || o.label;
        if (o.level && path.levels[o.level] && !path.levels[o.level].isTimeoutLevel) { flow.level = o.level; flow.step = 'details'; return interaction.update(await render(flow)); }
        flow.step = 'level'; return interaction.update(await render(flow, `No valid suggested level for **${o.label}**. Pick one.`));
    }

    if (action === 'level') {
        const n = Number(interaction.values?.[0]), path = getPath(cfg, flow.pathId);
        if (!path.levels[n] || path.levels[n].isTimeoutLevel) return interaction.update(await render(flow, '\u274C That level is no longer configured.'));
        flow.level = n; flow.viaLevel = true; flow.step = 'details'; return interaction.update(await render(flow));
    }

    if (action === 'details') {
        return interaction.showModal(new ModalBuilder().setCustomId(`wf:${flowId}:modal`).setTitle('Warning details').addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setValue(flow.reason.slice(0, 1000)))));
    }
    if (action === 'modal') {
        const r = cleanReason(interaction.fields.getTextInputValue('reason')); flow.reason = r || flow.reason; flow.customReason = true; flow.step = 'confirm';
        return interaction.update(await render(flow));
    }

    if (action === 'continue') { flow.step = 'confirm'; return interaction.update(await render(flow)); }

    if (action === 'confirm') {
        // Map.delete reports whether the flow was still there, so of two clicks that arrive together exactly one gets to continue.
        // (Both have already read the flow above; only this line decides who proceeds.)
        if (!flows.delete(flowId)) return gone();
        await interaction.deferUpdate();
        const guild = interaction.guild, member = await guild.members.fetch(flow.targetId).catch(() => null);
        const restore = async text => { flows.set(flowId, flow); flow.step = 'confirm'; return interaction.editReply(await render(flow, `\u274C ${text}`)); };
        if (!member) { flows.delete(flowId); return interaction.editReply({ embeds: [emb('Warning Cancelled').setDescription(`<@${flow.targetId}> is no longer in this server.`)], components: [] }); }
        try {
            const r = await issueWarning({ guild, issuer: interaction.user, channelId: flow.channelId, user: member.user, member, pathId: flow.pathId, level: flow.level, reason: flow.reason, offense: flow.offenseLabel });
            if (r.error) return restore(r.error);
            return interaction.editReply({ embeds: [r.embed], components: [] });
        } catch (e) {
            console.error('warning flow:', e);
            return interaction.editReply({ embeds: [emb('Warning Failed').setDescription('Failed to assign the warning. Check my permissions and role order.')], components: [] });
        }
    }
}

module.exports = { describeEscalation, flows, handleFlow, issueWarning, render, startFlow };

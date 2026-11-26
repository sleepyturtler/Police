// The two live config panels. Each is one ephemeral message that updates in place as you click.
//
//   /config warnings   tabs for Levels, Escalation, Offenses and Paths, for one warning path at a time
//   /config settings   access role, mod-log channel and DM notifications in one place
//
// A panel keeps no state of its own: every button, menu and pop-up carries what it needs in its customId
//   cw:<guildId>:<pathId>:<tab>:<action>[:<arg>]     warnings panel
//   cs:<guildId>:<action>                            settings panel
// so a panel keeps working for as long as the message exists, and every click re-checks permissions.
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder,
    RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { MAX_OFFENSES, MAX_PATHS, MAX_TIMEOUT_MS, SUPPORT_SERVER_URL } = require('./constants');
const { activeWarnings, getConfig, saveConfig } = require('./db');
const { formatDuration, hasCommandPermission, parseDuration } = require('./helpers');
const P = require('./paths');

const EPH = [MessageFlags.Ephemeral], BLUE = '#5865F2';
const TABS = [['lv', 'Levels'], ['es', 'Escalation'], ['of', 'Offenses'], ['pa', 'Paths']];
const trim = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '\u2026' : String(s));
const cid = (...parts) => parts.filter(x => x !== undefined && x !== null).join(':');
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const reject = (interaction, text) => interaction.reply({ content: text, flags: EPH });
const input = (id, label, { style = TextInputStyle.Short, required = true, placeholder, value, max = 100 } = {}) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
    if (placeholder) t.setPlaceholder(placeholder); if (value !== undefined && value !== null && value !== '') t.setValue(String(value).slice(0, max)); return row(t);
};
const modal = (id, title, ...inputs) => new ModalBuilder().setCustomId(id).setTitle(title).addComponents(...inputs);
// Joins lines but never exceeds `max` characters (an embed description may hold 4096), ending with "...and N more" when cut.
function listText(lines, max = 3000) {
    const out = []; let used = 0;
    for (let i = 0; i < lines.length; i++) {
        const need = lines[i].length + 1;
        if (used + need > max - 24) { out.push(`\u2026and ${lines.length - i} more`); break; }
        out.push(lines[i]); used += need;
    }
    return out.join('\n');
}
const durationText = d => formatDuration(d.days, d.hours, d.minutes, d.seconds, d.isForever);

// ══ Warnings panel ═══════════════════════════════════════════════════════════

function levelLines(path) {
    const nums = Object.keys(path.levels).map(Number).sort((a, b) => a - b);
    if (!nums.length) return 'No levels yet. Press **Add warning level** to create the first one.';
    return listText(nums.map(n => { const l = path.levels[n]; return l.isTimeoutLevel ? `**Level ${n}** (timeout step only): ${l.timeoutDisplay || 'timeout'}` : `**Level ${n}**: <@&${l.roleId}> for **${l.durationDisplay || 'Unknown'}**`; }));
}

function ruleLines(path) {
    const esc = path.escalation ?? {}, lines = [];
    for (const [lvl, thr] of Object.entries(esc.thresholds ?? {}).sort((a, b) => a[0] - b[0])) lines.push(`**${thr}x** Level ${lvl} \u2192 Level ${Number(lvl) + 1}`);
    for (const [tgt, t] of Object.entries(esc.timeouts ?? {}).sort((a, b) => a[0] - b[0])) lines.push(`**${t.threshold}x** Level ${Number(tgt) - 1} \u2192 Level ${tgt} + **${t.durationDisplay}** timeout`);
    if (esc.cap != null) lines.push(`Level cap: **${esc.cap}**`);
    return lines.length ? listText(lines) : 'No escalation rules. Press **Add rule** to create one.';
}

async function renderWarnings(guild, pathId, tab = 'lv', opts = {}) {
    const g = guild.id, cfg = await getConfig(g), path = P.getPath(cfg, pathId), multi = P.multiPath(cfg), p = path.id;
    const e = new EmbedBuilder().setColor(BLUE).setTitle(`\u2699\uFE0F Warning Config${multi ? `: ${P.pathLabel(path)}` : ''}`).setTimestamp();
    const note = opts.note ? opts.note + '\n\n' : '';
    const tabRow = row(...TABS.map(([t, label]) => button(cid('cw', g, p, t, 'view'), label, t === tab ? ButtonStyle.Primary : ButtonStyle.Secondary)));
    const pathRow = multi && tab !== 'pa' ? [row(new StringSelectMenuBuilder().setCustomId(cid('cw', g, p, tab, 'path')).setPlaceholder('Switch path\u2026').addOptions(P.pathList(cfg).map(x => ({ label: trim(P.pathLabel(x), 100), value: x.id, default: x.id === p }))))] : [];
    let rows = [tabRow, ...pathRow];

    if (tab === 'lv' && opts.pickRole) {
        e.setDescription(`${note}Pick the role this warning level will give. Next you enter the level number and how long it lasts. Entering a number that already exists replaces that level.`);
        return { embeds: [e], components: [row(new RoleSelectMenuBuilder().setCustomId(cid('cw', g, p, 'lv', 'role')).setPlaceholder('Select the warning role\u2026').setMinValues(1).setMaxValues(1)), row(button(cid('cw', g, p, 'lv', 'view'), 'Cancel', ButtonStyle.Danger))] };
    }
    if (tab === 'lv') {
        e.setDescription(`${note}${path.description ? `*${path.description}*\n\n` : ''}${levelLines(path)}`);
        const nums = Object.keys(path.levels).map(Number).sort((a, b) => a - b);
        rows.push(row(button(cid('cw', g, p, 'lv', 'add'), 'Add warning level', ButtonStyle.Success)));
        if (nums.length) rows.push(row(new StringSelectMenuBuilder().setCustomId(cid('cw', g, p, 'lv', 'rm')).setPlaceholder('Remove a level\u2026').addOptions(nums.slice(0, 25).map(n => ({ label: `Level ${n}`, description: trim(path.levels[n].isTimeoutLevel ? 'Timeout step' : path.levels[n].roleName || 'role', 100), value: `${n}` })))));
    } else if (tab === 'es') {
        e.setDescription(`${note}Rules for **${path.name}**. Only this path's warnings count toward them.\n\n${ruleLines(path)}`);
        rows.push(row(button(cid('cw', g, p, 'es', 'addrule'), 'Add rule', ButtonStyle.Success), button(cid('cw', g, p, 'es', 'cap'), 'Set level cap')));
        const rules = [...Object.entries(path.escalation.thresholds ?? {}).map(([l, t]) => ({ label: `${t}x Level ${l} to Level ${Number(l) + 1}`, value: `t:${l}` })), ...Object.entries(path.escalation.timeouts ?? {}).map(([tg, t]) => ({ label: `${t.threshold}x Level ${Number(tg) - 1} to Level ${tg} + ${t.durationDisplay} timeout`, value: `o:${tg}` }))];
        if (rules.length) rows.push(row(new StringSelectMenuBuilder().setCustomId(cid('cw', g, p, 'es', 'rm')).setPlaceholder('Remove a rule\u2026').addOptions(rules.slice(0, 25).map(r => ({ ...r, label: trim(r.label, 100) })))));
    } else if (tab === 'of') {
        const lines = path.offenses.map(o => `**${trim(o.label, 60)}** (${o.level ? `Level ${o.level}${path.levels[o.level] ? '' : ', not configured'}` : 'no suggested level'}): ${trim(o.reason, 100)}`);
        e.setDescription(`${note}Offenses moderators can pick when warning on **${path.name}**. Each can suggest a level.\n\n${lines.length ? listText(lines) : 'No offenses yet. Press **Add offense**.'}`);
        rows.push(row(button(cid('cw', g, p, 'of', 'add'), 'Add offense', ButtonStyle.Success, path.offenses.length >= MAX_OFFENSES)));
        if (path.offenses.length) rows.push(row(new StringSelectMenuBuilder().setCustomId(cid('cw', g, p, 'of', 'rm')).setPlaceholder('Remove an offense\u2026').addOptions(path.offenses.slice(0, 25).map(o => ({ label: trim(o.label, 100), value: o.id })))));
    } else {
        const all = P.pathList(cfg);
        if (opts.confirmRemove && P.getPaths(cfg)[opts.confirmRemove]) {
            const target = P.getPath(cfg, opts.confirmRemove);
            e.setDescription(`${note}Remove **${P.pathLabel(target)}**? Its ${Object.keys(target.levels).length} levels, escalation rules and ${target.offenses.length} offenses are deleted. This cannot be undone.`);
            return { embeds: [e], components: [tabRow, row(button(cid('cw', g, p, 'pa', 'rmdo', target.id), 'Remove path', ButtonStyle.Danger), button(cid('cw', g, p, 'pa', 'view'), 'Cancel'))] };
        }
        const active = id => [...activeWarnings.values()].filter(w => w.guildId === g && P.warningPathId(w, cfg) === id).length;
        e.setDescription(`${note}Each path is its own ladder with separate levels, escalation and offenses. Strikes never count across paths. (${all.length} of ${MAX_PATHS})\n\n${listText(all.map(x => `${x.id === p ? '\u25B6 ' : ''}${P.pathLabel(x)} \`${x.id}\`: ${Object.keys(x.levels).length} levels, ${x.offenses.length} offenses, ${active(x.id)} active warnings`))}`);
        const full = all.length >= MAX_PATHS, has = name => all.some(x => x.name.toLowerCase() === name.toLowerCase());
        rows.push(row(button(cid('cw', g, p, 'pa', 'preset', 'discord'), 'Add Discord preset', ButtonStyle.Success, full || has(P.PRESETS.discord.name)), button(cid('cw', g, p, 'pa', 'preset', 'ingame'), 'Add In-game preset', ButtonStyle.Success, full || has(P.PRESETS.ingame.name)), button(cid('cw', g, p, 'pa', 'new'), 'Add custom path', ButtonStyle.Success, full)));
        rows.push(row(button(cid('cw', g, p, 'pa', 'rename'), `Rename ${trim(path.name, 30)}`)));
        if (all.length > 1) rows.push(row(new StringSelectMenuBuilder().setCustomId(cid('cw', g, p, 'pa', 'rm')).setPlaceholder('Remove a path\u2026').addOptions(all.map(x => ({ label: trim(P.pathLabel(x), 100), value: x.id })))));
    }
    return { embeds: [e], components: rows };
}

const levelModal = (g, p, roleId, next) => modal(cid('cw', g, p, 'lv', 'modal', roleId), 'Add warning level',
    input('level', 'Level number', { placeholder: '1', value: next, max: 3 }),
    input('duration', 'How long it lasts', { placeholder: 'e.g. 7d, 12h, 1d12h, 30m or forever', max: 30 }));

async function handleWarnings(interaction) {
    const [, guildId, pathId, tab, action, arg] = interaction.customId.split(':'), guild = interaction.guild;
    if (!guild || guild.id !== guildId) return reject(interaction, '\u274C Invalid interaction.');
    if (!await hasCommandPermission(interaction, guildId)) return reject(interaction, '\u274C No permission.');
    const show = async (t = tab, opts = {}, p = pathId) => interaction.update(await renderWarnings(guild, p, t, opts));
    const fail = (text, t = tab) => show(t, { note: `\u274C ${text}` });
    const num = s => { const t = String(s ?? '').trim(); return /^\d+$/.test(t) ? parseInt(t, 10) : NaN; };
    const field = n => interaction.fields.getTextInputValue(n);
    const cfg = await getConfig(guildId), path = P.getPath(cfg, pathId);

    if (action === 'view') return show();
    if (action === 'path') return show(tab, {}, interaction.values[0]);

    // ── Levels
    if (tab === 'lv') {
        if (action === 'add') return show('lv', { pickRole: true });
        if (action === 'role') {
            const role = interaction.roles.first();
            if (!role) return fail('No role selected.');
            if (role.id === guild.id) return fail('You cannot use @everyone.');
            if (role.managed) return fail('You cannot use a managed or bot role.');
            if (role.position >= guild.members.me.roles.highest.position) return fail(`My role must be above ${role} in the role list, otherwise I cannot give it out.`);
            const next = Math.max(0, ...Object.keys(path.levels).map(Number)) + 1;
            return interaction.showModal(levelModal(guildId, pathId, role.id, next));
        }
        if (action === 'modal') {
            const level = num(field('level')), dur = parseDuration(field('duration') || ''), role = guild.roles.cache.get(arg);
            if (!(level >= 1 && level <= 100)) return fail('The level must be a whole number from 1 to 100.');
            if (!dur) return fail('Invalid duration. Use `7d`, `12h`, `1d12h`, `30m`, `d:h:m:s` or `forever`. Max 365 days.');
            if (!role) return fail('That role no longer exists.');
            const r = await P.setLevel(guildId, pathId, level, { roleId: role.id, roleName: role.name, durationMs: dur.totalMs, isForever: dur.isForever, durationDisplay: durationText(dur) });
            if (r.error) return fail(r.error);
            return show('lv', { note: `\u2705 Level ${level} ${r.existed ? 'updated' : 'added'}: ${role} for **${durationText(dur)}**.` });
        }
        if (action === 'rm') {
            const level = Number(interaction.values[0]), r = await P.removeLevel(guildId, pathId, level);
            if (r.error) return fail(r.error);
            return show('lv', { note: `\u2705 Level ${level} removed.${r.removed.length ? ` Escalation rules removed with it: ${r.removed.join(', ')}.` : ''}` });
        }
    }

    // ── Escalation
    if (tab === 'es') {
        if (action === 'addrule') return interaction.showModal(modal(cid('cw', guildId, pathId, 'es', 'rulemodal'), 'Add escalation rule',
            input('level', 'From level', { placeholder: 'e.g. 1', max: 3 }), input('threshold', 'Warnings needed (2 to 50)', { placeholder: 'e.g. 3', max: 2 }),
            input('timeout', 'Also time them out for (optional)', { required: false, placeholder: 'e.g. 1h or 1d. Leave empty for none', max: 20 })));
        if (action === 'rulemodal') {
            const level = num(field('level')), threshold = num(field('threshold')), tStr = field('timeout').trim();
            let timeout = null;
            if (tStr) {
                const d = parseDuration(tStr);
                if (!d || d.isForever) return fail('Invalid timeout length.');
                if (d.totalMs > MAX_TIMEOUT_MS) return fail('Timeouts cannot exceed 28 days.');
                timeout = { ms: d.totalMs, display: formatDuration(d.days, d.hours, d.minutes, d.seconds) };
            }
            const r = await P.addRule(guildId, pathId, { level, threshold, timeout });
            if (r.error) return fail(r.error);
            return show('es', { note: `\u2705 **${threshold}x** Level ${level} \u2192 Level ${r.target}${timeout ? ` + **${timeout.display}** timeout` : ''}.` });
        }
        if (action === 'cap') return interaction.showModal(modal(cid('cw', guildId, pathId, 'es', 'capmodal'), 'Set level cap',
            input('cap', 'Highest level escalation can reach', { required: false, placeholder: 'Leave empty to remove the cap', value: path.escalation.cap, max: 3 })));
        if (action === 'capmodal') {
            const raw = field('cap').trim(), cap = raw ? num(raw) : null;
            const r = await P.setCap(guildId, pathId, Number.isNaN(cap) ? -1 : cap);
            if (r.error) return fail(r.error);
            return show('es', { note: cap === null ? '\u2705 Level cap removed.' : `\u2705 Level cap set to **${cap}**.` });
        }
        if (action === 'rm') {
            const [kind, level] = interaction.values[0].split(':'), r = await P.removeRule(guildId, pathId, kind, Number(level));
            return r.error ? fail(r.error) : show('es', { note: '\u2705 Rule removed.' });
        }
    }

    // ── Offenses
    if (tab === 'of') {
        if (action === 'add') return interaction.showModal(modal(cid('cw', guildId, pathId, 'of', 'modal'), 'Add offense',
            input('label', 'Offense', { placeholder: 'e.g. Cheating or exploits', max: 50 }),
            input('reason', 'Reason shown to the member (optional)', { required: false, placeholder: 'Defaults to the offense name', max: 200 }),
            input('level', 'Suggested level (optional)', { required: false, placeholder: 'e.g. 2', max: 3 })));
        if (action === 'modal') {
            const raw = field('level').trim(), level = raw ? num(raw) : null;
            const r = await P.addOffense(guildId, pathId, { label: field('label'), reason: field('reason'), level: Number.isNaN(level) ? -1 : level });
            if (r.error) return fail(r.error);
            const warn = level && !path.levels[level] ? ` Level ${level} is not configured on this path yet.` : '';
            return show('of', { note: `\u2705 Offense added.${warn}` });
        }
        if (action === 'rm') { const r = await P.removeOffense(guildId, pathId, interaction.values[0]); return r.error ? fail(r.error) : show('of', { note: '\u2705 Offense removed.' }); }
    }

    // ── Paths
    if (tab === 'pa') {
        if (action === 'preset') {
            const r = await P.addPreset(guildId, arg);
            return r.error ? fail(r.error) : show('lv', { note: `\u2705 Path created with example offenses. Add its warning levels below, then edit the offenses on the Offenses tab.` }, r.id);
        }
        if (action === 'new') return interaction.showModal(modal(cid('cw', guildId, pathId, 'pa', 'newmodal'), 'Add warning path',
            input('name', 'Path name', { placeholder: 'e.g. Tournament', max: 30 }), input('emoji', 'Emoji (optional)', { required: false, placeholder: 'e.g. \u{1F3C6}', max: 8 })));
        if (action === 'newmodal') {
            const r = await P.addPath(guildId, { name: field('name'), emoji: field('emoji'), description: '' });
            return r.error ? fail(r.error) : show('lv', { note: `\u2705 Path created. Add its warning levels below.` }, r.id);
        }
        if (action === 'rename') return interaction.showModal(modal(cid('cw', guildId, pathId, 'pa', 'renmodal'), 'Rename path',
            input('name', 'Path name', { value: path.name, max: 30 }), input('emoji', 'Emoji (optional)', { required: false, value: path.emoji, max: 8 })));
        if (action === 'renmodal') { const r = await P.renamePath(guildId, pathId, { name: field('name'), emoji: field('emoji') }); return r.error ? fail(r.error) : show('pa', { note: '\u2705 Path renamed.' }); }
        if (action === 'rm') return show('pa', { confirmRemove: interaction.values[0] });
        if (action === 'rmdo') {
            const r = await P.removePath(guildId, arg);
            if (r.error) return show('pa', { note: `\u274C ${r.error}` });
            return show('pa', { note: '\u2705 Path removed.' }, arg === pathId ? undefined : pathId);
        }
    }
}

// ══ Settings panel ═══════════════════════════════════════════════════════════

async function renderSettings(guild, note = null) {
    const g = guild.id, cfg = await getConfig(g), dm = cfg.warnDm !== false;
    const e = new EmbedBuilder().setColor(BLUE).setTitle('\u2699\uFE0F Server Settings').setTimestamp()
        .setDescription(`${note ? note + '\n\n' : ''}Changes apply right away.`)
        .addFields({ name: 'Access role', value: cfg.accessRoleId ? `<@&${cfg.accessRoleId}> can use the moderation commands. Administrators always can.` : 'Administrators only. No role is set.' },
            { name: 'Mod-log channel', value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'Not set. Mod actions are not logged anywhere.' },
            { name: 'DM notifications', value: dm ? 'On. Members are messaged about warnings, scam removals and spam removals.' : 'Off. Members are not messaged.' });
    const roleMenu = new RoleSelectMenuBuilder().setCustomId(cid('cs', g, 'access')).setPlaceholder('Set the access role\u2026').setMinValues(1).setMaxValues(1);
    if (cfg.accessRoleId && guild.roles.cache.has(cfg.accessRoleId)) roleMenu.setDefaultRoles(cfg.accessRoleId);
    const chanMenu = new ChannelSelectMenuBuilder().setCustomId(cid('cs', g, 'log')).setPlaceholder('Set the mod-log channel\u2026').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1);
    if (cfg.logChannelId && guild.channels.cache.has(cfg.logChannelId)) chanMenu.setDefaultChannels(cfg.logChannelId);
    return { embeds: [e], components: [row(roleMenu), row(chanMenu), row(
        button(cid('cs', g, 'dm'), `DM notifications: ${dm ? 'On' : 'Off'}`, dm ? ButtonStyle.Success : ButtonStyle.Secondary),
        button(cid('cs', g, 'clearrole'), 'Clear access role', ButtonStyle.Secondary, !cfg.accessRoleId),
        button(cid('cs', g, 'clearlog'), 'Remove log channel', ButtonStyle.Danger, !cfg.logChannelId),
        button(cid('cs', g, 'view'), 'Refresh'))] };
}

async function handleSettings(interaction) {
    const [, guildId, action] = interaction.customId.split(':'), guild = interaction.guild;
    if (!guild || guild.id !== guildId) return reject(interaction, '\u274C Invalid interaction.');
    if (!await hasCommandPermission(interaction, guildId)) return reject(interaction, '\u274C No permission.');
    const show = async note => interaction.update(await renderSettings(guild, note)), cfg = await getConfig(guildId);

    if (action === 'view') return show();
    if (action === 'access') {
        const role = interaction.roles.first();
        if (!role) return show('\u274C No role selected.');
        if (role.id === guildId) return show('\u274C You cannot use @everyone.');
        if (role.managed) return show('\u274C You cannot use a managed or bot role.');
        cfg.accessRoleId = role.id; saveConfig(guildId, cfg);
        return show(`\u2705 Members with ${role} can now use the moderation commands.`);
    }
    if (action === 'clearrole') { delete cfg.accessRoleId; saveConfig(guildId, cfg); return show('\u2705 Access role cleared. Only administrators have access now.'); }
    if (action === 'log') {
        const channel = interaction.channels.first();
        if (!channel) return show('\u274C No channel selected.');
        cfg.logChannelId = channel.id; cfg.supportLinkAnnounced = true; saveConfig(guildId, cfg);
        channel.send(`\u{1F4CC} **Join my Support Server:** ${SUPPORT_SERVER_URL}`).catch(() => {});
        return show(`\u2705 Mod actions are now logged to ${channel}.`);
    }
    if (action === 'clearlog') { delete cfg.logChannelId; saveConfig(guildId, cfg); return show('\u2705 Mod-log channel removed.'); }
    if (action === 'dm') { cfg.warnDm = cfg.warnDm === false; saveConfig(guildId, cfg); return show(`\u2705 DM notifications are now ${cfg.warnDm ? 'on' : 'off'}.`); }
}

// ══ Entry points ═════════════════════════════════════════════════════════════

const openWarnings = async (ctx, { pathId, tab = 'lv' } = {}) => ctx.reply({ ...(await renderWarnings(ctx.interaction.guild, pathId, tab)), flags: EPH });
const openSettings = async ctx => ctx.reply({ ...(await renderSettings(ctx.interaction.guild)), flags: EPH });

module.exports = { handleSettings, handleWarnings, openSettings, openWarnings, renderSettings, renderWarnings };

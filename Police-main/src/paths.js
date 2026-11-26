// Warning paths: independent ladders inside one server. Each path has its own levels (role + duration), escalation
// rules, timeout escalations, level cap and list of offenses. Strikes on one path never count toward another.
//
// Storage: cfg.paths = { [id]: { name, emoji, description, levels, escalation, offenses } }.
// A server configured before paths existed has no cfg.paths. Its old cfg.levels / cfg.escalation are shown as a path
// called "Discord" without writing anything. The first edit copies them into cfg.paths and leaves the old keys exactly
// as they were, so rolling back to an older build still finds the old setup.
const { MAX_OFFENSES, MAX_PATHS } = require('./constants');
const { activeWarnings, getConfig, saveConfig } = require('./db');

const LEGACY_ID = 'discord';
const clone = x => JSON.parse(JSON.stringify(x));
const norm = (s, n) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const slug = name => String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'path';

const legacyPath = cfg => ({ name: 'Discord', emoji: '\u{1F4AC}', description: 'Offenses on Discord', levels: cfg.levels ?? {}, escalation: cfg.escalation ?? { thresholds: {} }, offenses: [] });

// ── Reading ────────────────────────────────────────────────────────────────
const getPaths = cfg => (cfg.paths && Object.keys(cfg.paths).length ? cfg.paths : { [LEGACY_ID]: legacyPath(cfg) });
const defaultPathId = cfg => Object.keys(getPaths(cfg))[0];

// One path with its id attached. An unknown id falls back to the first path. The nested objects are the stored ones.
function getPath(cfg, id) {
    const all = getPaths(cfg), key = all[id] ? id : defaultPathId(cfg), p = all[key];
    p.levels ??= {}; p.escalation ??= { thresholds: {} }; p.escalation.thresholds ??= {}; p.offenses ??= [];
    return { id: key, ...p };
}
const pathList = cfg => Object.keys(getPaths(cfg)).map(id => getPath(cfg, id));
const multiPath = cfg => Object.keys(getPaths(cfg)).length > 1;
const pathLabel = p => `${p.emoji ? p.emoji + ' ' : ''}${p.name}`;

// Which path a stored warning belongs to. Warnings issued before paths existed (or on a path since removed) belong to the first path.
function warningPathId(w, cfg) { const all = getPaths(cfg); return w.pathId && all[w.pathId] ? w.pathId : defaultPathId(cfg); }

// Display lines counting warnings per level, grouped by path ("Level 1: **2**", or "In-game, Level 1: **2**" on a server with several paths).
function levelCounts(cfg, items) {
    const multi = multiPath(cfg), counts = new Map(), order = Object.keys(getPaths(cfg));
    for (const w of items) { const key = `${warningPathId(w, cfg)}|${w.level}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
    return [...counts.entries()].map(([key, c]) => { const [pid, level] = key.split('|'); return { pid, level: Number(level), c }; })
        .sort((a, b) => order.indexOf(a.pid) - order.indexOf(b.pid) || a.level - b.level)
        .map(({ pid, level, c }) => `${multi ? `${getPath(cfg, pid).name}, ` : ''}Level ${level}: **${c}**`);
}

// Levels a moderator can pick when issuing a warning (a timeout-only level has no role to give).
const warnableLevels = path => Object.keys(path.levels).map(Number).filter(n => !path.levels[n].isTimeoutLevel).sort((a, b) => a - b);

// ── Writing ────────────────────────────────────────────────────────────────
// Runs fn(paths, cfg) on the editable paths (migrating the old setup first if needed) and saves unless fn returns { error }.
// fn must validate before it changes anything.
async function editPaths(guildId, fn) {
    const cfg = await getConfig(guildId);
    if (!cfg.paths || !Object.keys(cfg.paths).length) cfg.paths = { [LEGACY_ID]: clone(legacyPath(cfg)) };
    const out = (await fn(cfg.paths, cfg)) ?? {};
    if (!out.error) saveConfig(guildId, cfg);
    return out;
}

function uniqueId(paths, name) { const base = slug(name); let id = base, i = 2; while (paths[id]) id = `${base.slice(0, 17)}-${i++}`; return id; }

const PRESETS = {
    discord: { name: 'Discord', emoji: '\u{1F4AC}', description: 'Offenses on Discord', offenses: [
        { label: 'Spam', reason: 'Spamming', level: 1 }, { label: 'Advertising', reason: 'Unwanted advertising', level: 1 },
        { label: 'Harassment', reason: 'Harassing other members', level: 2 }, { label: 'NSFW content', reason: 'Posting NSFW content', level: 2 },
        { label: 'Scam links', reason: 'Posting scam links', level: 3 }] },
    ingame: { name: 'In-game', emoji: '\u{1F3AE}', description: 'Offenses in the game', offenses: [
        { label: 'Toxic chat in game', reason: 'Toxic behavior in game chat', level: 1 }, { label: 'Griefing', reason: 'Griefing other players', level: 2 },
        { label: 'Boosting or account sharing', reason: 'Boosting or sharing an account', level: 2 },
        { label: 'Cheating or exploits', reason: 'Cheating or abusing an exploit', level: 3 }, { label: 'Ban evasion', reason: 'Evading a game ban', level: 3 }] },
};

async function addPath(guildId, { name, emoji, description, offenses }) {
    return editPaths(guildId, paths => {
        if (Object.keys(paths).length >= MAX_PATHS) return { error: `A server can have at most ${MAX_PATHS} warning paths.` };
        const n = norm(name, 30); if (!n) return { error: 'The path needs a name.' };
        if (Object.values(paths).some(p => p.name.toLowerCase() === n.toLowerCase())) return { error: `A path called **${n}** already exists.` };
        const id = uniqueId(paths, n);
        paths[id] = { name: n, emoji: norm(emoji, 8), description: norm(description, 100), levels: {}, escalation: { thresholds: {} },
            offenses: (offenses ?? []).slice(0, MAX_OFFENSES).map((o, i) => ({ id: `o${i + 1}`, label: o.label, reason: o.reason, level: o.level })) };
        return { id };
    });
}

const addPreset = (guildId, key) => PRESETS[key] ? addPath(guildId, PRESETS[key]) : { error: 'Unknown preset.' };

async function renamePath(guildId, id, { name, emoji }) {
    return editPaths(guildId, paths => {
        const p = paths[id]; if (!p) return { error: 'That path no longer exists.' };
        const n = norm(name, 30); if (!n) return { error: 'The path needs a name.' };
        if (Object.entries(paths).some(([k, o]) => k !== id && o.name.toLowerCase() === n.toLowerCase())) return { error: `A path called **${n}** already exists.` };
        p.name = n; p.emoji = norm(emoji, 8); return {};
    });
}

async function removePath(guildId, id) {
    return editPaths(guildId, (paths, cfg) => {
        if (!paths[id]) return { error: 'That path no longer exists.' };
        if (Object.keys(paths).length <= 1) return { error: 'You cannot remove the only path.' };
        const active = [...activeWarnings.values()].filter(w => w.guildId === guildId && warningPathId(w, cfg) === id).length;
        if (active) return { error: `**${paths[id].name}** still has ${active} active warning${active === 1 ? '' : 's'}. Remove them or let them expire first.` };
        delete paths[id]; return {};
    });
}

// Adds a level, or replaces it if the number is already configured. `data` is { roleId, roleName, durationMs, isForever, durationDisplay }.
async function setLevel(guildId, pathId, level, data) {
    return editPaths(guildId, paths => {
        const p = paths[pathId]; if (!p) return { error: 'That path no longer exists.' };
        const existed = !!p.levels[level]; p.levels[level] = data; return { existed };
    });
}

// Removing a level also removes the escalation rules that would lead to it or start from it, so none is left pointing at nothing.
async function removeLevel(guildId, pathId, level) {
    return editPaths(guildId, paths => {
        const p = paths[pathId]; if (!p?.levels[level]) return { error: `Level ${level} is not configured.` };
        const esc = p.escalation ??= { thresholds: {} }; esc.thresholds ??= {}; const removed = [];
        delete p.levels[level];
        if (esc.thresholds[level] != null) { delete esc.thresholds[level]; removed.push(`${level} to ${level + 1}`); }
        if (esc.thresholds[level - 1] != null) { delete esc.thresholds[level - 1]; removed.push(`${level - 1} to ${level}`); }
        if (esc.timeouts?.[level]) { delete esc.timeouts[level]; removed.push(`${level - 1} to ${level} (timeout)`); }
        if (esc.timeouts?.[level + 1]) { delete esc.timeouts[level + 1]; removed.push(`${level} to ${level + 1} (timeout)`); }
        return { removed };
    });
}

// A threshold rule: `threshold` active warnings at `level` become one at level + 1. With a timeout it is a timeout rule instead.
async function addRule(guildId, pathId, { level, threshold, timeout }) {
    return editPaths(guildId, paths => {
        const p = paths[pathId]; if (!p) return { error: 'That path no longer exists.' };
        if (!Number.isInteger(level) || level < 1 || level > 99) return { error: 'The starting level must be between 1 and 99.' };
        if (!Number.isInteger(threshold) || threshold < 2 || threshold > 50) return { error: 'The threshold must be between 2 and 50.' };
        const target = level + 1; if (!p.levels[level]) return { error: `Level ${level} is not configured on this path. Add it first.` };
        const esc = p.escalation ??= { thresholds: {} }; esc.thresholds ??= {};
        if (timeout) {
            if (!p.levels[target]) p.levels[target] = { isTimeoutLevel: true, timeoutDurationMs: timeout.ms, timeoutDisplay: timeout.display };
            esc.timeouts ??= {}; esc.timeouts[target] = { durationMs: timeout.ms, durationDisplay: timeout.display, threshold };
        } else {
            if (!p.levels[target]) return { error: `Level ${target} is not configured on this path. Add it first.` };
            esc.thresholds[level] = threshold;
        }
        return { target };
    });
}

async function removeRule(guildId, pathId, kind, level) {
    return editPaths(guildId, paths => {
        const esc = paths[pathId]?.escalation; if (!esc) return { error: 'That path no longer exists.' };
        if (kind === 't' && esc.thresholds?.[level] != null) delete esc.thresholds[level];
        else if (kind === 'o' && esc.timeouts?.[level]) delete esc.timeouts[level];
        else return { error: 'That rule no longer exists.' };
        return {};
    });
}

async function setCap(guildId, pathId, cap) {
    return editPaths(guildId, paths => {
        const p = paths[pathId]; if (!p) return { error: 'That path no longer exists.' };
        if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 100)) return { error: 'The cap must be between 1 and 100.' };
        const esc = p.escalation ??= { thresholds: {} }; if (cap === null) delete esc.cap; else esc.cap = cap; return {};
    });
}

async function addOffense(guildId, pathId, { label, reason, level }) {
    return editPaths(guildId, paths => {
        const p = paths[pathId]; if (!p) return { error: 'That path no longer exists.' };
        p.offenses ??= [];
        if (p.offenses.length >= MAX_OFFENSES) return { error: `A path can have at most ${MAX_OFFENSES} offenses.` };
        const l = norm(label, 50); if (!l) return { error: 'The offense needs a label.' };
        if (level !== null && (!Number.isInteger(level) || level < 1 || level > 100)) return { error: 'The suggested level must be a whole number between 1 and 100.' };
        let n = 1; while (p.offenses.some(o => o.id === `o${n}`)) n++;
        p.offenses.push({ id: `o${n}`, label: l, reason: norm(reason, 200) || l, level }); return { id: `o${n}` };
    });
}

async function removeOffense(guildId, pathId, offenseId) {
    return editPaths(guildId, paths => {
        const p = paths[pathId]; const i = p?.offenses?.findIndex(o => o.id === offenseId) ?? -1;
        if (i < 0) return { error: 'That offense no longer exists.' };
        p.offenses.splice(i, 1); return {};
    });
}

module.exports = {
    LEGACY_ID, PRESETS, addOffense, addPath, addPreset, addRule, defaultPathId, getPath, getPaths, levelCounts, multiPath, pathLabel, pathList, removeLevel,
    removeOffense, removePath, removeRule, renamePath, setCap, setLevel, warnableLevels, warningPathId,
};

// Components V2 for every screen the bot shows, in one style: one accent-colored container whose sections are
// divided by separators, with buttons and menus outside it.
//
//   view(color, blocks, rows)   build a screen directly: one container (blocks = text sections) + the rows under it
//   toV2Payload()               turns any payload that carries embeds (or V2 parts) into a valid V2 payload
//   wrapInteraction()           makes every reply/update/edit of an interaction valid without touching call sites:
//                               it sets the IsComponentsV2 flag (even when a call adds its own `flags`), turns embeds
//                               into containers, turns a stray `content` line into a text line above the container
//                               (V2 messages can't hold content), and turns a content-only edit of a V2 message into
//                               a V2 text message
//   install()                   does the same for everything that is not an interaction: channel and DM sends,
//                               message replies and message edits. Called once from client.js, so every
//                               EmbedBuilder in the bot (and any added later) comes out as a V2 container.
//
// Embeds convert like this: title as a heading, description and fields as text sections, footer and timestamp as a
// small line at the bottom, image as a media gallery, thumbnail or author icon as the first section's thumbnail.
// The side color has two values: red for embeds built red (the bad ones: warnings given, punishments, removals, and
// every mod-log entry), dark blue for everything else, whatever other color the embed asked for.

const {
    ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SectionBuilder, SeparatorBuilder,
    SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} = require('discord.js');

const toInt = hex => parseInt(String(hex).replace('#', ''), 16);
const colorEnv = (name, def) => { const n = process.env[name] ? toInt(process.env[name]) : NaN; return Number.isFinite(n) ? n : def; };

const RED = 0xE74C3C, ORANGE = 0xE67E22, GREEN = 0x2ECC71;
const BLUE = colorEnv('UI_ACCENT_COLOR', 0x1E40AF); // the dark blue side color of converted embeds

// An embed built in a red (such as #ff0000 or #E74C3C) is a "bad" one and keeps a red side color. Orange, green, blurple
// and everything else become dark blue.
function accentFor(e) {
    const c = Number.isInteger(e?.color) ? e.color : null;
    if (c === null) return BLUE;
    const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    return r >= 190 && g <= 90 && b <= 90 ? RED : BLUE;
}
const V2_TYPES = new Set([9, 10, 11, 12, 13, 14, 17]); // section, text, thumbnail, gallery, file, separator, container

// Discord's limits for a V2 message: 40 components in total (nested ones and each row's buttons count), and 4000
// characters of text across all text displays. The text budget is a little under that to leave room for a content line.
const MAX_COMPONENTS = 40, TEXT_BUDGET = 3900, MAX_BLOCKS = 12;
const noPings = { parse: [] }; // embed text never pinged anyone, so converted text must not either

const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '\u2026' : String(s));
const text = s => new TextDisplayBuilder().setContent(clip(String(s), 3900));
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

function typeOf(c) { try { return (typeof c?.toJSON === 'function' ? c.toJSON() : c)?.type; } catch { return undefined; } }
const isV2Part = c => V2_TYPES.has(typeOf(c));

function box(color, blocks) {
    const c = new ContainerBuilder();
    if (color !== null && color !== undefined) c.setAccentColor(typeof color === 'string' ? toInt(color) : color);
    blocks.filter(Boolean).forEach((b, i) => {
        if (i) c.addSeparatorComponents(sep());
        c.addTextDisplayComponents(text(b));
    });
    return c;
}

const view = (color, blocks, rows = []) => ({ components: [box(color, blocks), ...rows] });

// ── Embed conversion ───────────────────────────────────────────────────────

// Splits an embed into text blocks. Consecutive short inline fields share one block (a column of "Name: value"
// lines); every other field gets its own block.
function embedParts(e) {
    const blocks = [], head = [];
    if (e.author?.name) head.push(`**${e.author.name}**`);
    if (e.title) head.push(`## ${e.title}`);
    if (e.description) head.push(e.description);
    if (head.length) blocks.push(head.join('\n'));
    let run = [];
    const flush = () => { if (run.length) { blocks.push(run.join('\n')); run = []; } };
    for (const f of e.fields ?? []) {
        const name = String(f.name), value = String(f.value);
        if (f.inline && !value.includes('\n') && value.length <= 60 && name.length <= 30) run.push(`**${name}:** ${value}`);
        else { flush(); blocks.push(`**${name}**\n${value}`); }
    }
    flush();
    const time = e.timestamp ? Math.floor(Date.parse(e.timestamp) / 1000) : null;
    const foot = [e.footer?.text, Number.isFinite(time) ? `<t:${time}:f>` : null].filter(Boolean).join(' \u00b7 ');
    return { blocks, foot: foot ? `-# ${foot}` : null, thumb: e.thumbnail?.url ?? e.author?.icon_url ?? null, image: e.image?.url ?? null };
}

// Brings blocks within a block count and a total character budget. The overflow is merged into the last block and
// then clipped, so nothing makes Discord reject the message.
function fit(blocks, maxBlocks, maxChars) {
    let out = blocks.slice();
    if (out.length > maxBlocks) out = [...out.slice(0, maxBlocks - 1), out.slice(maxBlocks - 1).join('\n\n')];
    let left = maxChars;
    const result = [];
    for (let i = 0; i < out.length; i++) {
        const blocksLeft = out.length - i;
        const room = Math.max(40, Math.floor(left / blocksLeft)); // each remaining block can always keep at least its share
        const b = out[i].length <= left - 40 * (blocksLeft - 1) ? out[i] : clip(out[i], Math.max(room, left - 40 * (blocksLeft - 1)));
        result.push(b); left -= b.length;
    }
    return result;
}

function embedToContainer(embed, { maxComponents = MAX_COMPONENTS, maxChars = TEXT_BUDGET } = {}) {
    const e = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
    const { blocks, foot, thumb, image } = embedParts(e);
    const extras = (thumb ? 2 : 0) + (image ? 2 : 0); // a section with a thumbnail, and a gallery plus its separator
    const maxBlocks = Math.max(1, Math.min(MAX_BLOCKS, Math.floor((maxComponents - extras) / 2)));
    const footLen = foot ? foot.length : 0;
    const all = fit(blocks, foot ? maxBlocks - 1 || 1 : maxBlocks, Math.max(80, maxChars - footLen));
    if (foot) all.push(clip(foot, 400));
    if (!all.length) all.push('-# (empty)');

    const c = new ContainerBuilder().setAccentColor(accentFor(e));
    all.forEach((b, i) => {
        if (i) c.addSeparatorComponents(sep());
        if (i === 0 && thumb && /^https?:\/\//.test(thumb) && b !== foot) c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(b)).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb)));
        else c.addTextDisplayComponents(text(b));
    });
    if (image && /^https?:\/\//.test(image)) { c.addSeparatorComponents(sep()); c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image))); }
    return c;
}

// How many of the 40 components a row (the row itself plus its buttons or menu) takes.
function rowCost(part) {
    if (isV2Part(part)) return 6;
    try { const j = typeof part?.toJSON === 'function' ? part.toJSON() : part; return 1 + (j?.components?.length ?? 1); } catch { return 6; }
}

// V2 messages carry no content or embeds, so these two keys are always dropped from a converted payload.
function toV2Payload(payload, { alreadyV2 = false } = {}) {
    if (typeof payload === 'string' && alreadyV2) payload = { content: payload }; // editReply('text') on a V2 message
    if (!payload || typeof payload !== 'object') return payload;
    const parts = Array.isArray(payload.components) ? payload.components : [];
    const embeds = Array.isArray(payload.embeds) ? payload.embeds.filter(Boolean) : [];
    const hasV2 = parts.some(isV2Part);
    const content = typeof payload.content === 'string' && payload.content ? payload.content : null;
    if (!hasV2 && !embeds.length && !(alreadyV2 && !('files' in payload) && (content || 'embeds' in payload || 'content' in payload))) return payload;

    const { content: _c, embeds: _e, components: _p, ...rest } = payload;
    let containers = [];
    if (embeds.length) {
        const used = parts.reduce((n, p) => n + rowCost(p), 0) + (content ? 1 : 0);
        const maxComponents = Math.max(3, Math.floor((MAX_COMPONENTS - used) / embeds.length));
        const maxChars = Math.floor((TEXT_BUDGET - (content ? clip(content, 3900).length : 0)) / embeds.length);
        containers = embeds.map(e => embedToContainer(e, { maxComponents, maxChars }));
        if (rest.allowedMentions === undefined) rest.allowedMentions = noPings;
    }
    const flags = [].concat(payload.flags || []);
    if (!flags.includes(MessageFlags.IsComponentsV2)) flags.push(MessageFlags.IsComponentsV2);
    return { ...rest, flags, components: [...(content ? [text(content)] : []), ...containers, ...parts] };
}

// ── Interactions ───────────────────────────────────────────────────────────

function wrapInteraction(interaction) {
    if (!interaction || interaction.__v2wrapped) return interaction;
    interaction.__v2wrapped = true;
    const isV2 = () => Boolean(interaction.__v2 || interaction.message?.flags?.has?.(MessageFlags.IsComponentsV2));

    // A deferred reply that will turn out to be V2 has to be deferred with the V2 flag, and almost every reply
    // here ends up as a container, so every deferred reply is created as V2 (a text-only ending is converted).
    if (typeof interaction.deferReply === 'function') {
        const origDefer = interaction.deferReply.bind(interaction);
        interaction.deferReply = (opts = {}, ...rest) => {
            const flags = [].concat(opts?.flags || []);
            if (!flags.includes(MessageFlags.IsComponentsV2)) flags.push(MessageFlags.IsComponentsV2);
            interaction.__v2 = true;
            return origDefer({ ...opts, flags }, ...rest);
        };
    }
    for (const m of ['reply', 'update', 'editReply', 'followUp']) {
        const orig = typeof interaction[m] === 'function' ? interaction[m].bind(interaction) : null;
        if (!orig) continue;
        interaction[m] = (payload, ...rest) => {
            // A message can't be turned into V2 after it was sent. Editing a message that is not V2 (a panel sent
            // before this update, or a plain-text reply) keeps its old form instead of failing.
            if ((m === 'update' || m === 'editReply') && !isV2()) return orig(payload, ...rest);
            const out = toV2Payload(payload, { alreadyV2: m === 'update' || m === 'editReply' });
            // Only the first response decides what the original message is; a follow-up is a separate message.
            if (m === 'reply' && out !== payload && [].concat(out.flags || []).includes(MessageFlags.IsComponentsV2)) interaction.__v2 = true;
            return orig(out, ...rest);
        };
    }
    return interaction;
}

// ── Everything that is not an interaction ───────────────────────────────────

const patched = new Map(); // prototype that owns the method -> methods already wrapped (so nothing is wrapped twice)

// `send` is not defined on every class itself (TextChannel inherits it), so this finds the prototype that owns it.
function patchMethod(proto, method, convert) {
    let owner = proto;
    while (owner && !Object.prototype.hasOwnProperty.call(owner, method)) owner = Object.getPrototypeOf(owner);
    if (!owner || typeof owner[method] !== 'function') return false;
    const done = patched.get(owner) ?? new Set();
    if (done.has(method)) return true;
    const orig = owner[method];
    owner[method] = function (payload, ...rest) { return orig.call(this, convert(this, payload), ...rest); };
    done.add(method); patched.set(owner, done);
    return true;
}

function install(d = require('discord.js')) {
    const senders = [d.TextChannel, d.NewsChannel, d.VoiceChannel, d.StageChannel, d.ThreadChannel, d.DMChannel, d.PartialGroupDMChannel, d.User, d.GuildMember];
    for (const C of senders) if (C?.prototype) patchMethod(C.prototype, 'send', (_, p) => toV2Payload(p));
    if (d.Message?.prototype) {
        patchMethod(d.Message.prototype, 'reply', (_, p) => toV2Payload(p));
        // A message that is not V2 (sent before this update) keeps its embeds when edited, since V2 can't be added later.
        patchMethod(d.Message.prototype, 'edit', (msg, p) => (msg.flags?.has?.(MessageFlags.IsComponentsV2) ? toV2Payload(p, { alreadyV2: true }) : p));
    }
}

module.exports = { BLUE, GREEN, accentFor, ORANGE, RED, box, clip, embedToContainer, install, isV2Part, patchMethod, toInt, toV2Payload, view, wrapInteraction };

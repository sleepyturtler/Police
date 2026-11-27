// The public website: landing and status page, Terms of Service and Privacy Policy. Plain server-rendered HTML, no scripts.
// Every page shares one layout: a header with the logo and the invite button, the content, and a footer with the links.
const { BANNER_SIZE, hasBanner } = require('./assets');

const LEGAL_LAST_UPDATED = 'November 26, 2026';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
:root{--accent:#1E40AF;--accent-dark:#17328a;--link:#1E40AF;--gold:#C9A24A;--bg:#ffffff;--card:#f3f5fa;--text:#15192a;--muted:#5a6483;--line:#dbe0ee;--danger-bg:#f8d7da;--danger:#842029}
@media (prefers-color-scheme:dark){:root{--accent:#3B63D9;--accent-dark:#2f52b8;--link:#8FA8FF;--bg:#0d1220;--card:#141b2e;--text:#e8ecf6;--muted:#9aa6c4;--line:#243052;--danger-bg:#3a1a1e;--danger:#f1aeb5}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.65}
a{color:var(--link)}
header{border-bottom:1px solid var(--line)}
.bar{max-width:880px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.2em;color:var(--text);text-decoration:none;margin-right:auto}
.brand img{width:34px;height:34px;border-radius:8px}
nav{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
nav a{text-decoration:none;color:var(--muted);font-weight:500}nav a:hover{color:var(--text)}
.btn{display:inline-block;background:var(--accent);color:#fff!important;font-weight:700;text-decoration:none;padding:10px 20px;border-radius:10px}
.btn:hover{background:var(--accent-dark)}
.btn.big{font-size:1.15em;padding:14px 30px}
nav a.btn{color:#fff;padding:7px 14px;font-size:.95em}
main{max-width:880px;margin:0 auto;padding:10px 20px 50px}
.hero{text-align:center;padding:26px 0 8px}
.hero img.banner{width:100%;height:auto;border-radius:16px;border:1px solid var(--line);display:block}
.hero img.logo{width:96px;height:96px;border-radius:20px}
.hero h1.name{margin:10px 0 0}
.hero p.lead{font-size:1.15em;max-width:660px;margin:18px auto}
.links{display:flex;gap:18px;justify-content:center;flex-wrap:wrap;margin-top:16px}
.status{display:inline-block;margin:6px 0 0;font-size:.95em;color:var(--muted)}
.status strong{color:var(--text)}
.status.down{background:var(--danger-bg);color:var(--danger);padding:10px 14px;border-radius:8px}
.ok{color:#1c8a45;font-weight:700}@media (prefers-color-scheme:dark){.ok{color:#4bd37b}}
h1{font-size:2em;margin:28px 0 6px}h2{margin-top:32px;font-size:1.35em}
.updated{color:var(--muted);font-size:.9em;margin-top:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;margin-top:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;border-top:3px solid var(--gold)}
.card h3{margin:0 0 6px;font-size:1.05em}.card p{margin:0;color:var(--muted)}
code{background:var(--card);border:1px solid var(--line);border-radius:5px;padding:1px 6px;font-size:.92em}
li{margin:5px 0}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:.92em}
footer .bar{justify-content:space-between}
footer a{color:var(--muted)}
.fine{max-width:880px;margin:0 auto;padding:0 20px 28px;color:var(--muted);font-size:.85em}
`;

// ctx: { online, inviteUrl, supportUrl, contactEmail, serverCount, baseUrl, githubUrl, topggUrl }
// baseUrl (no trailing slash) is only used so the link preview image has an absolute address.
function layout(ctx, { title, description, body }) {
    const base = ctx.baseUrl ? esc(ctx.baseUrl) : '';
    const desc = esc(description || 'Police is a Discord moderation bot: warnings that carry roles, separate paths for Discord and in-game offenses, timeouts, bans, notes and automatic scam, spam and cross-channel protection.');
    const invite = ctx.inviteUrl ? `<a class="btn" href="${esc(ctx.inviteUrl)}">Add to server</a>` : '';
    const topgg = ctx.topggUrl ? ` &nbsp;&middot;&nbsp; <a href="${esc(ctx.topggUrl)}">top.gg</a>` : '';
    const preview = base && hasBanner ? `<meta property="og:image" content="${base}/banner.jpg"><meta name="twitter:card" content="summary_large_image">` : '';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${desc}"><meta name="theme-color" content="#1E40AF">
<link rel="icon" type="image/png" href="/icon.png">
<meta property="og:site_name" content="Police"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${desc}">${preview}
<style>${CSS}</style></head><body>
<header><div class="bar"><a class="brand" href="/"><img src="/icon.png" alt="Police logo" width="34" height="34"><span>Police</span></a>
<nav><a href="/">Home</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a>${invite}</nav></div></header>
<main>${body}</main>
<footer><div class="bar"><span>Police</span><span><a href="/terms">Terms of Service</a> &nbsp;&middot;&nbsp; <a href="/privacy">Privacy Policy</a>${topgg} &nbsp;&middot;&nbsp; <a href="${esc(ctx.githubUrl)}">GitHub</a> &nbsp;&middot;&nbsp; <a href="${esc(ctx.supportUrl)}">Support server</a></span></div></footer>
<p class="fine">Police is not affiliated with, endorsed by or sponsored by Discord Inc.</p>
</body></html>`;
}

const contactHtml = ctx => (ctx.contactEmail ? `<a href="mailto:${esc(ctx.contactEmail)}">${esc(ctx.contactEmail)}</a> or the <a href="${esc(ctx.supportUrl)}">support server</a>` : `the <a href="${esc(ctx.supportUrl)}">support server</a>`);

// "In 85 servers". Nothing is shown when the bot has not reported a count yet.
const serversText = n => (Number.isInteger(n) && n > 0 ? `In <strong>${n.toLocaleString('en-US')}</strong> server${n === 1 ? '' : 's'}` : '');

// ---------- landing and status ----------
function buildLanding(ctx) {
    const count = serversText(ctx.serverCount);
    const status = ctx.online
        ? `<p class="status">Status: <span class="ok">&#9679; Online</span>${count ? ` &nbsp;&middot;&nbsp; ${count}` : ''}</p>`
        : '<p class="status down">&#128308; <strong>Police is currently offline</strong>. This page is still up, but the Discord connection is not. It reconnects on its own, so check back shortly.</p>';
    const addButton = ctx.inviteUrl ? `<p><a class="btn big" href="${esc(ctx.inviteUrl)}">Add Police to your server</a></p>` : '';
    const topgg = ctx.topggUrl ? `<a href="${esc(ctx.topggUrl)}">View on top.gg</a>` : '';
    const art = hasBanner
        ? `<img class="banner" src="/banner.jpg" alt="Police: a Discord Officer badge behind warning tape" width="${BANNER_SIZE.width}" height="${BANNER_SIZE.height}">`
        : '<img class="logo" src="/icon.png" alt="Police logo" width="96" height="96"><h1 class="name">Police</h1>';
    return layout(ctx, {
        title: 'Police | Discord moderation bot',
        body: `
<section class="hero">
${art}
<p class="lead">Police is a Discord moderation bot. Warnings carry roles and expire on their own, Discord and in-game offenses get their own paths, and scam images, spam and copy-pasted messages are caught automatically.</p>
${addButton}
<div class="links">${topgg}<a href="${esc(ctx.githubUrl)}">Source on GitHub</a><a href="${esc(ctx.supportUrl)}">Support server</a></div>
${status}
</section>

<h2>What it does</h2>
<div class="grid">
<div class="card"><h3>Warnings with roles</h3><p>Each warning level gives a role for a set time, then removes it on its own. If someone leaves and rejoins, their active warning roles come back.</p></div>
<div class="card"><h3>Warning paths</h3><p>Keep separate ladders, such as one for Discord offenses and one for in-game offenses, each with its own levels, escalation and list of offenses.</p></div>
<div class="card"><h3>Guided warnings</h3><p>Moderators pick the path and the offense, add details and confirm. The confirmation shows exactly what escalation the warning will trigger.</p></div>
<div class="card"><h3>Escalation</h3><p>Repeated warnings move a member up a level by themselves, optionally with a timeout, up to a cap you choose.</p></div>
<div class="card"><h3>Timeouts, kicks and bans</h3><p>Including timed bans that lift themselves, and optional cleanup of a banned user's recent messages.</p></div>
<div class="card"><h3>Notes and history</h3><p>Private moderator notes, and a record of every warning, timeout, kick and ban for each member.</p></div>
<div class="card"><h3>Scam image protection</h3><p>Register a known scam image once. Reposts, resized copies and copies with a border are removed and the sender is timed out, while unrelated screenshots are left alone.</p></div>
<div class="card"><h3>Spam and cross-channel protection</h3><p>Repeated or near-identical messages are removed, and the same message or image pasted into several channels is caught everywhere it was posted.</p></div>
<div class="card"><h3>Sting Operation</h3><p>A trap channel for spam bots and hijacked accounts. Anyone who posts in it is deleted, timed out, softbanned or banned, and staff are never touched.</p></div>
<div class="card"><h3>Message cleanup</h3><p>Delete a member's messages across every channel for a time window, or clear a channel with filters. It reports anything it could not delete instead of claiming success.</p></div>
<div class="card"><h3>Mod-log and access control</h3><p>Log every action to a channel you choose. Administrators always have access, and you pick which extra role can use the moderation commands.</p></div>
<div class="card"><h3>Your data stays with your server</h3><p>Records belong to your server and are deleted when the bot is removed. Scam images are never stored, only small fingerprints used to recognise them.</p></div>
</div>

<h2>Get started</h2>
<ol>
<li>${ctx.inviteUrl ? 'Add Police to your server with the button above.' : 'Add Police to your server. The invite button appears here as soon as the bot is online.'}</li>
<li>An admin runs <code>/config settings</code> to choose the moderator role and the mod-log channel.</li>
<li>Run <code>/config warnings</code> to add warning levels (a role and how long it lasts) and, if you want them, separate paths such as In-game.</li>
<li>Moderators use <code>/warning give</code> and the other commands. <code>/help</code> lists every command.</li>
</ol>

<h2>Legal</h2>
<p><a href="/terms">Terms of Service</a> &nbsp;&middot;&nbsp; <a href="/privacy">Privacy Policy</a></p>`,
    });
}

// ---------- terms ----------
function buildTerms(ctx) {
    return layout(ctx, {
        title: 'Terms of Service | Police',
        description: 'The terms for using the Police Discord moderation bot.',
        body: `
<h1>Terms of Service</h1>
<p class="updated">Last updated: ${LEGAL_LAST_UPDATED}</p>
<p>These Terms govern your use of the Police Bot Discord bot ("the Bot"). By adding the Bot to a server or using its commands, you agree to them. If you do not agree, do not use the Bot.</p>

<h2>What the Bot does</h2>
<p>The Bot gives server moderators tools for warnings (including separate warning paths for different kinds of offenses), timeouts, kicks, bans, notes and history, and it can act automatically: it can delete messages, time out, kick or ban members, and apply or escalate warnings based on the settings your server chose. This includes Sting Operation, a trap channel that punishes anyone who posts in it. Automatic actions happen without a moderator pressing anything.</p>

<h2>Server administrators and moderators</h2>
<p>Adding the Bot to a server requires the Manage Server permission. Administrators decide how the Bot is configured and which role may use its moderation commands. You are responsible for how the Bot is used in your server, and moderators are responsible for the decisions they make with it.</p>

<h2>Acceptable use</h2>
<ul>
<li>You must follow Discord's <a href="https://discord.com/terms">Terms of Service</a> and <a href="https://discord.com/guidelines">Community Guidelines</a>, and any laws that apply to you.</li>
<li>Use moderation powers fairly and in good faith. Do not use the Bot to harass, target or discriminate against anyone, or to remove messages or members for illegitimate reasons.</li>
<li>Automatic detection can make mistakes. You are responsible for choosing sensible settings, for reviewing what the Bot does, and for reversing actions that were wrong (for example with <code>/warning remove</code>, <code>/timeout remove</code> or <code>/ban remove</code>).</li>
<li>Only register images in a scam registry if they really are scams.</li>
<li>If you use Sting Operation, choose a channel that members have no reason to post in, and pick a punishment you are comfortable applying automatically. The Bot never punishes administrators or members who can manage messages or the server, but it will punish anyone else who posts there.</li>
<li>Do not try to abuse, overload or reverse-engineer the Bot, or to evade its protections.</li>
</ul>

<h2>Global scam image list</h2>
<p>The Bot's operator maintains a global list of known scam images. In any server where scam protection is turned on (it is on by default), a matching image is removed and its sender is timed out, regardless of that server's own scam settings. The match is recorded in that server's moderation history. If you believe an image was matched in error, contact us.</p>

<h2>Permissions</h2>
<p>The Bot asks for the permissions it needs, such as managing roles, kicking and banning members, moderating members (timeouts) and managing messages. Creating a Sting Operation channel or renaming it daily also needs the Manage Channels permission, which is optional. If you remove a permission, the features that depend on it will stop working.</p>

<h2>No warranty</h2>
<p>The Bot is provided "as is," without warranty of any kind. It may be unavailable, delayed or wrong at times, and automatic detection may miss things or flag the wrong thing. You are responsible for your server and its members.</p>

<h2>Limitation of liability</h2>
<p>To the maximum extent permitted by law, the Bot's operator is not liable for any indirect, incidental or consequential damages, or for any loss arising from your use of the Bot, including actions the Bot takes in your server.</p>

<h2>Termination</h2>
<p>We may suspend or end the Bot's access to your server, or stop running the Bot, at any time, for example if these Terms are broken. You can stop using the Bot at any time by removing it from your server, which also deletes the data stored for that server (see the <a href="/privacy">Privacy Policy</a>).</p>

<h2>Changes</h2>
<p>We may update these Terms from time to time. Continued use of the Bot after a change means you accept the updated Terms.</p>

<h2>Contact</h2>
<p>Questions about these Terms can be sent to ${contactHtml(ctx)}.</p>`,
    });
}

// ---------- privacy ----------
function buildPrivacy(ctx) {
    return layout(ctx, {
        title: 'Privacy Policy | Police',
        description: 'What data the Police Discord moderation bot stores and how it is used.',
        body: `
<h1>Privacy Policy</h1>
<p class="updated">Last updated: ${LEGAL_LAST_UPDATED}</p>
<p>This Privacy Policy explains what data the Police Bot Discord bot ("the Bot") stores and processes, and what we do with it.</p>

<h2>Data we store</h2>
<ul>
<li><b>Server configuration:</b> the server (guild) ID, the IDs of the channels and roles you set up (mod-log channel, moderator role, warning roles, the Sting Operation channel), your warning paths with their levels, escalation rules and offense lists, and your spam, cross-channel, scam protection and Sting Operation settings.</li>
<li><b>Moderation records:</b> when a warning, timeout, kick, ban, unban, Sting Operation hit or automatic removal happens, we store the affected user's Discord ID and username at that time, the moderator's username (or the Bot, for automatic actions), the reason text, the warning path and offense where one was chosen, the time, and the duration where there is one.</li>
<li><b>Active warnings and timeouts:</b> the same details, kept so the Bot can remove warning roles and track timeouts when they expire.</li>
<li><b>Moderator notes:</b> the note text a moderator writes about a user, with the author's username and the time.</li>
<li><b>Scam image fingerprints:</b> for each registered scam image, a short perceptual hash (a fingerprint, not the image), a very small greyscale thumbnail (32 by 32 pixels, used to confirm matches and far too small to show the original), the image's dimensions, a label, and who added it. We do not keep the images themselves.</li>
</ul>

<h2>Data we process but do not store</h2>
<ul>
<li><b>Message text:</b> the Bot reads messages to detect spam, the same message posted across channels, and posts in a Sting Operation channel. A short record of recent messages is kept in memory only, for the detection window (seconds to minutes depending on your settings, never longer than 30 minutes), and is never written to the database.</li>
<li><b>Images:</b> when a message has an image attachment, the Bot briefly downloads it from Discord's servers into memory, computes a fingerprint to compare with registered scam images, and discards the image.</li>
<li><b>Message cleanup:</b> when the Bot deletes someone's messages (for example after a Sting Operation hit, or with <code>/messages purge</code>), it reads recent message history in the server's channels to find that person's messages. Nothing it reads is stored.</li>
<li><b>What can appear in your server:</b> if you set a mod-log channel, the Bot posts records of its actions there. For removed spam this can include up to 200 characters of the message text, for a Sting Operation hit up to 300 characters of the message that was posted, and for near-matches of scam images the image itself is shown for review. That channel belongs to your server, and its visibility is up to you.</li>
</ul>

<h2>Messages the Bot sends</h2>
<p>The Bot sends direct messages to members it acts on, for example to tell them about a warning, timeout, kick, ban or automatic removal. Servers can turn off messages about warnings and about automatic removals (spam, cross-channel, scam and Sting Operation) with <code>/config settings</code>. Messages about timeouts, kicks and bans are always attempted.</p>

<h2>How we use data</h2>
<p>Data is used only to run the Bot's moderation features: applying and expiring warnings, showing history and notes to your moderators, and detecting spam and scam images. We do not sell data, use it for advertising, or build profiles from it.</p>

<h2>Who can see it</h2>
<p>Moderation records, notes and history for a server are visible to that server's moderators through the Bot's commands and to anyone who can read its mod-log channel. We do not share data with other servers, except that a match against the global scam image list is recorded in the server where it happened. We use hosting and database providers to run the Bot, and the Bot communicates with Discord to function.</p>

<h2>Retention and deletion</h2>
<ul>
<li>Warnings expire automatically, but a record of them stays in that member's history.</li>
<li>Moderators can remove notes, scam images and warning levels with the Bot's commands.</li>
<li><b>When the Bot is removed from a server, we delete all data stored for that server.</b></li>
<li>To ask what is stored about you, or to have records about you deleted, contact us (see below). Records are kept per server, so please tell us which server.</li>
</ul>

<h2>Security</h2>
<p>Data is kept in a private database that only the Bot's operator can access, and it is encrypted at rest by the database provider. No system is perfectly secure, but we take reasonable steps to protect it.</p>

<h2>Children</h2>
<p>The Bot is only for people who are old enough to use Discord (13 or older, or higher where local law requires). We do not knowingly collect data from younger children.</p>

<h2>Changes</h2>
<p>We may update this policy from time to time. The date at the top shows when it last changed.</p>

<h2>Contact</h2>
<p>Questions or requests about this policy can be sent to ${contactHtml(ctx)}.</p>`,
    });
}

module.exports = { buildLanding, buildPrivacy, buildTerms, esc, layout };

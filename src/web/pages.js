// Landing page, terms of service and privacy policy.
const { LOGO_URI } = require('./logo');

const LEGAL_LAST_UPDATED = 'October 10, 2026';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(title, bodyHtml) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} Police</title>
<link rel="icon" type="image/png" href="${LOGO_URI}">
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;color:#1a1a1a;} .brand{display:flex;align-items:center;gap:10px;margin-bottom:20px;} .brand img{width:44px;height:44px;border-radius:8px;} .brand span{font-weight:600;font-size:1.15em;} h1{margin-bottom:4px;} .updated{color:#666;font-size:0.9em;margin-top:0;} h2{margin-top:28px;} a{color:#5865F2;} code{background:#f0f0f3;padding:1px 5px;border-radius:4px;font-size:0.92em;}</style>
</head><body><div class="brand"><img src="${LOGO_URI}" alt="Police Bot logo"><span>Police</span></div>${bodyHtml}</body></html>`;
}

function contactLine(ctx) {
    const parts = [`our <a href="${esc(ctx.supportUrl)}">support server</a>`];
    if (ctx.contactEmail) parts.unshift(`<a href="mailto:${esc(ctx.contactEmail)}">${esc(ctx.contactEmail)}</a>`);
    return parts.join(' or ');
}

function buildLanding(ctx) {
    const statusLine = ctx.online
        ? '<p class="updated">Status: <strong style="color:#3ba55d">● Online</strong></p>'
        : '<p class="updated" style="background:#f8d7da;color:#842029;padding:10px 14px;border-radius:6px;display:inline-block;">🔴 <strong>Bot is currently disconnected from Discord.</strong> It reconnects automatically; if this lasts more than a few minutes, check the support server.</p>';
    const addLink = ctx.inviteUrl ? `<a href="${esc(ctx.inviteUrl)}">Add Police to your server</a> &nbsp;·&nbsp;` : '';
    return page('', `
<h1>Police</h1>
${statusLine}
<p style="font-size:1.1em;">Police is a Discord moderation bot. It gives your moderators warnings that carry roles and expire on their own, timeouts, kicks and bans, private notes and a full history, plus automatic protection against scam images, spam, and the same message copied across many channels.</p>

<h2>What it does</h2>
<ul>
<li><strong>Warnings with roles</strong>: each warning level gives a role for a set time, then removes it automatically. If someone leaves and rejoins, their active warning roles come back.</li>
<li><strong>Escalation</strong>: repeated warnings can move a member up a level on their own, optionally with a timeout.</li>
<li><strong>Timeouts, kicks and bans</strong>: including timed bans that lift themselves, and optional cleanup of a banned user's recent messages.</li>
<li><strong>Notes and history</strong>: private moderator notes, and a record of every warning, timeout, kick and ban for each member.</li>
<li><strong>Scam image protection</strong>: register a known scam image once, and similar images (including cropped versions) are removed and the sender is timed out.</li>
<li><strong>Spam protection</strong>: repeated or near-identical messages are removed and the sender is timed out.</li>
<li><strong>Cross-channel protection</strong>: the same message or image pasted into several channels is caught and removed everywhere it was posted.</li>
<li><strong>Mod-log</strong>: every action can be logged to a channel you choose.</li>
<li><strong>You stay in control</strong>: administrators always have access, and you pick which extra role can use moderation commands.</li>
</ul>

<h2>How it works</h2>
<p>An admin invites Police, then runs <code>/config access</code> to choose the moderator role and <code>/config set</code> to define warning levels. <code>/help</code> lists every command. Moderators then use commands such as <code>/warning give</code>, <code>/timeout give</code> and <code>/note add</code>, and the automatic protections run in the background using each server's settings.</p>

<h2>Get started</h2>
<p>
${addLink}
<a href="${esc(ctx.supportUrl)}">Support server</a>
</p>

<h2>Legal</h2>
<p>
<a href="/terms">Terms of Service</a> &nbsp;·&nbsp;
<a href="/privacy">Privacy Policy</a>
</p>
`);
}

function buildTerms(ctx) {
    return page('Terms of Service', `
<h1>Terms of Service</h1>
<p class="updated">Last updated: ${LEGAL_LAST_UPDATED}</p>
<p>These Terms govern your use of the Police Bot Discord bot ("the Bot"). By adding the Bot to a server or using its commands, you agree to them. If you do not agree, do not use the Bot.</p>

<h2>What the Bot does</h2>
<p>The Bot gives server moderators tools for warnings, timeouts, kicks, bans, notes and history, and it can act automatically: it can delete messages, time out members, and apply or escalate warnings based on the settings your server chose. Automatic actions happen without a moderator pressing anything.</p>

<h2>Server administrators and moderators</h2>
<p>Adding the Bot to a server requires the Manage Server permission. Administrators decide how the Bot is configured and which role may use its moderation commands. You are responsible for how the Bot is used in your server, and moderators are responsible for the decisions they make with it.</p>

<h2>Acceptable use</h2>
<ul>
<li>You must follow Discord's <a href="https://discord.com/terms">Terms of Service</a> and <a href="https://discord.com/guidelines">Community Guidelines</a>, and any laws that apply to you.</li>
<li>Use moderation powers fairly and in good faith. Do not use the Bot to harass, target or discriminate against anyone, or to remove messages or members for illegitimate reasons.</li>
<li>Automatic detection can make mistakes. You are responsible for choosing sensible settings, for reviewing what the Bot does, and for reversing actions that were wrong (for example with <code>/warning remove</code>, <code>/timeout remove</code> or <code>/ban remove</code>).</li>
<li>Only register images in a scam registry if they really are scams.</li>
<li>Do not try to abuse, overload or reverse-engineer the Bot, or to evade its protections.</li>
</ul>

<h2>Global scam image list</h2>
<p>The Bot's operator maintains a global list of known scam images. In any server where scam protection is turned on (it is on by default), a matching image is removed and its sender is timed out, regardless of that server's own scam settings. The match is recorded in that server's moderation history. If you believe an image was matched in error, contact us.</p>

<h2>Permissions</h2>
<p>The Bot asks for the permissions it needs, such as managing roles, kicking and banning members, and moderating members (timeouts). If you remove a permission, the features that depend on it will stop working.</p>

<h2>No warranty</h2>
<p>The Bot is provided "as is," without warranty of any kind. It may be unavailable, delayed or wrong at times, and automatic detection may miss things or flag the wrong thing. You are responsible for your server and its members.</p>

<h2>Limitation of liability</h2>
<p>To the maximum extent permitted by law, the Bot's operator is not liable for any indirect, incidental or consequential damages, or for any loss arising from your use of the Bot, including actions the Bot takes in your server.</p>

<h2>Termination</h2>
<p>We may suspend or end the Bot's access to your server, or stop running the Bot, at any time, for example if these Terms are broken. You can stop using the Bot at any time by removing it from your server, which also deletes the data stored for that server (see the <a href="/privacy">Privacy Policy</a>).</p>

<h2>Changes</h2>
<p>We may update these Terms from time to time. Continued use of the Bot after a change means you accept the updated Terms.</p>

<h2>Contact</h2>
<p>Questions about these Terms can be sent to ${contactLine(ctx)}.</p>
`);
}

function buildPrivacy(ctx) {
    return page('Privacy Policy', `
<h1>Privacy Policy</h1>
<p class="updated">Last updated: ${LEGAL_LAST_UPDATED}</p>
<p>This Privacy Policy explains what data the Police Bot Discord bot ("the Bot") stores and processes, and what we do with it.</p>

<h2>Data we store</h2>
<ul>
<li><strong>Server configuration:</strong> the server (guild) ID, the IDs of the channel and roles you set up (mod-log channel, moderator role, warning roles), and your warning level, escalation, spam, cross-channel and scam protection settings.</li>
<li><strong>Moderation records:</strong> when a warning, timeout, kick, ban, unban or automatic removal happens, we store the affected user's Discord ID and username at that time, the moderator's username (or the Bot, for automatic actions), the reason text, the time, and the duration where there is one.</li>
<li><strong>Active warnings and timeouts:</strong> the same details, kept so the Bot can remove warning roles and track timeouts when they expire.</li>
<li><strong>Moderator notes:</strong> the note text a moderator writes about a user, with the author's username and the time.</li>
<li><strong>Scam image fingerprints:</strong> for each registered scam image, a short perceptual hash (a fingerprint, not the image), a label, and who added it. We do not keep the images themselves.</li>
</ul>

<h2>Data we process but do not store</h2>
<ul>
<li><strong>Message text:</strong> the Bot reads messages to detect spam and the same message posted across channels. A short record of recent messages is kept in memory only, for the detection window (seconds to minutes depending on your settings, never longer than 30 minutes), and is never written to the database.</li>
<li><strong>Images:</strong> when a message has an image attachment, the Bot briefly downloads it from Discord's servers into memory, computes a fingerprint to compare with registered scam images, and discards the image.</li>
<li><strong>What can appear in your server:</strong> if you set a mod-log channel, the Bot posts records of its actions there. For removed spam this can include up to 200 characters of the message text, and for near-matches of scam images the image itself is shown for review. That channel belongs to your server, and its visibility is up to you.</li>
</ul>

<h2>Messages the Bot sends</h2>
<p>The Bot sends direct messages to members it acts on, for example to tell them about a warning, timeout, kick, ban or automatic removal. Servers can turn off warning and automatic-removal notifications with <code>/config notifications</code>; notices for kicks, bans and timeouts given by a moderator are always attempted.</p>

<h2>How we use data</h2>
<p>Data is used only to run the Bot's moderation features: applying and expiring warnings, showing history and notes to your moderators, and detecting spam and scam images. We do not sell data, use it for advertising, or build profiles from it.</p>

<h2>Who can see it</h2>
<p>Moderation records, notes and history for a server are visible to that server's moderators through the Bot's commands and to anyone who can read its mod-log channel. We do not share data with other servers, except that a match against the global scam image list is recorded in the server where it happened. We use hosting and database providers to run the Bot, and the Bot communicates with Discord to function.</p>

<h2>Retention and deletion</h2>
<ul>
<li>Warnings expire automatically, but a record of them stays in that member's history.</li>
<li>Moderators can remove notes, scam images and warning levels with the Bot's commands.</li>
<li><strong>When the Bot is removed from a server, we delete all data stored for that server.</strong></li>
<li>To ask what is stored about you, or to have records about you deleted, contact us (see below). Records are kept per server, so please tell us which server.</li>
</ul>

<h2>Security</h2>
<p>Data is kept in a private database that only the Bot's operator can access. No system is perfectly secure, but we take reasonable steps to protect it.</p>

<h2>Children</h2>
<p>The Bot is only for people who are old enough to use Discord (13 or older, or higher where local law requires). We do not knowingly collect data from younger children.</p>

<h2>Changes</h2>
<p>We may update this policy from time to time. The date at the top shows when it last changed.</p>

<h2>Contact</h2>
<p>Questions or requests about this policy can be sent to ${contactLine(ctx)}.</p>
`);
}

module.exports = { buildLanding, buildPrivacy, buildTerms };

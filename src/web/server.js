// Small HTTP server: landing page, terms, privacy, the two site images and the health check.
const http = require('http');
const { client } = require('../client');
const { GITHUB_URL, INVITE_PERMISSIONS, SUPPORT_SERVER_URL, TOPGG_URL } = require('../constants');
const { ASSETS } = require('./assets');
const { buildLanding, buildPrivacy, buildTerms } = require('./pages');

// ── Keep-alive ─────────────────────────────────────────────────────────────
function keepAlive() {
    const ping = () => { const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`; fetch(`${url}/health`).then(() => console.log('🏓 Keep-alive ping')).catch(() => {}); };
    setTimeout(ping, 5000); setInterval(ping, 14 * 60 * 1000);
}

const PORT = process.env.PORT || 3000;
// Optional public contact address shown in the Terms and Privacy Policy. The support server link is always shown.
const CONTACT_EMAIL = process.env.LEGAL_CONTACT_EMAIL || null;

// The site's own address, used only to give the link preview image an absolute URL. RENDER_EXTERNAL_URL is set on Render;
// otherwise it is built from the request, and a Host header that does not look like a host name is ignored.
function baseUrl(req) {
    if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '');
    const host = String(req.headers.host || '');
    if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return '';
    return `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${host}`;
}

function pageContext(req) {
    const inviteUrl = client.user ? `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands` : null;
    const online = client.isReady();
    return { online, serverCount: online ? client.guilds.cache.size : null, inviteUrl, supportUrl: SUPPORT_SERVER_URL, contactEmail: CONTACT_EMAIL, githubUrl: GITHUB_URL, topggUrl: TOPGG_URL, baseUrl: baseUrl(req) };
}

const ROUTES = { '/': buildLanding, '/terms': buildTerms, '/privacy': buildPrivacy };

function send(req, res, status, headers, body) {
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
}

http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    if (pathname === '/health') return send(req, res, 200, { 'Content-Type': 'text/plain' }, 'Police bot is running!');
    const asset = ASSETS[pathname];
    if (asset) return send(req, res, 200, { 'Content-Type': asset.type, 'Cache-Control': 'public, max-age=86400' }, asset.body);
    const render = ROUTES[pathname];
    if (!render) return send(req, res, 404, { 'Content-Type': 'text/plain' }, 'Not found');
    send(req, res, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }, render(pageContext(req)));
}).listen(PORT, () => console.log(`🌐 HTTP server on port ${PORT}`));

module.exports = { keepAlive };

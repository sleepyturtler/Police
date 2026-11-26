// Small HTTP server: landing page, terms, privacy and the health check.
const http = require('http');
const { client } = require('../client');
const { INVITE_PERMISSIONS, SUPPORT_SERVER_URL } = require('../constants');
const { buildLanding, buildPrivacy, buildTerms } = require('./pages');

// ── Keep-alive ─────────────────────────────────────────────────────────────
function keepAlive() {
    const ping = () => { const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`; fetch(`${url}/health`).then(() => console.log('🏓 Keep-alive ping')).catch(() => {}); };
    setTimeout(ping, 5000); setInterval(ping, 14 * 60 * 1000);
}

const PORT = process.env.PORT || 3000;
// Optional public contact address shown in the Terms and Privacy Policy. The support server link is always shown.
const CONTACT_EMAIL = process.env.LEGAL_CONTACT_EMAIL || null;

function pageContext() {
    const inviteUrl = client.user ? `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands` : null;
    return { online: client.isReady(), inviteUrl, supportUrl: SUPPORT_SERVER_URL, contactEmail: CONTACT_EMAIL };
}

const ROUTES = { '/': buildLanding, '/terms': buildTerms, '/privacy': buildPrivacy };

http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    if (pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('Police bot is running!'); }
    const render = ROUTES[pathname];
    if (!render) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(render(pageContext()));
}).listen(PORT, () => console.log(`🌐 HTTP server on port ${PORT}`));

module.exports = { keepAlive };

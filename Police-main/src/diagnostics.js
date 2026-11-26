// Periodic memory diagnostics log line.
const sharp = require('sharp');
const { client } = require('./client');
const { activeTimeouts, activeWarnings, configCache } = require('./db');
const { pendingNearMatches, scamHashCache } = require('./scam/store');
const { spamCooldown, spamTracker } = require('./spam/spam');
const { crossPostCooldown, crossPostTracker } = require('./spam/crosspost');
const { banTimers, pendingUnwarns, warningTimers } = require('./warnings');
const { imageInfoCache, imageStats } = require('./scam/hashing');

// ── Memory diagnostics ─────────────────────────────────────────────────────
// Logs one line every few minutes so a slow climb can be traced to a cause. Read it like this:
//   rss up, heapUsed flat           -> native memory (sharp/libvips, buffers), not a JS object leak
//   heapUsed up with a cache count  -> that cache is the leak (users, members, msgs)
//   heapUsed up with a Map count    -> that tracker Map is the leak
//   arrayBuffers/external up        -> image buffers or sockets not being released
// Set DIAG_INTERVAL_MIN=0 to turn it off.
const DIAG_INTERVAL_MIN = Number.isFinite(parseInt(process.env.DIAG_INTERVAL_MIN)) ? parseInt(process.env.DIAG_INTERVAL_MIN) : 10;

function logMemoryDiagnostics() {
    const mb = n => (n / 1048576).toFixed(1), m = process.memoryUsage();
    let members = 0, msgs = 0;
    let meMissing = 0;
    for (const g of client.guilds.cache.values()) { members += g.members.cache.size; if (!g.members.me) meMissing++; }
    for (const ch of client.channels.cache.values()) if (ch.messages?.cache) msgs += ch.messages.cache.size;
    let sharpInfo = '';
    try { const c = sharp.counters(), k = sharp.cache(); sharpInfo = ` | sharp queue=${c.queue} proc=${c.process} cacheItems=${k.items?.current ?? 0}`; } catch {}
    console.log(
        `📊 mem rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB heapTotal=${mb(m.heapTotal)}MB external=${mb(m.external)}MB arrayBuffers=${mb(m.arrayBuffers)}MB` +
        ` | guilds=${client.guilds.cache.size} meMissing=${meMissing} users=${client.users.cache.size} members=${members} msgs=${msgs}` +
        ` | maps config=${configCache.size} warn=${activeWarnings.size} timeouts=${activeTimeouts.size} scamHash=${scamHashCache.size} nearMatch=${pendingNearMatches.size}` +
        ` spam=${spamTracker.size} spamCd=${spamCooldown.size} cross=${crossPostTracker.size} crossCd=${crossPostCooldown.size}` +
        ` warnTimers=${warningTimers.size} unwarns=${pendingUnwarns.size} banTimers=${banTimers.size}` +
        sharpInfo + ` | img hashed=${imageStats.hashed} overPixelCap=${imageStats.skippedPixels} failed=${imageStats.failed} inflight=${imageInfoCache.size}` + ` | up=${Math.round(process.uptime() / 60)}m`
    );
}

if (DIAG_INTERVAL_MIN > 0) setInterval(logMemoryDiagnostics, DIAG_INTERVAL_MIN * 60 * 1000);

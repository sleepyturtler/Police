// Scam image hash registry (per server and global) and scam protection config.
const { getConfig, pool } = require('../db');
const { SCAM_DEFAULT_THRESHOLD, SCAM_FLAT_MIN_STDDEV, SCAM_MAX_THRESHOLD } = require('../constants');
const { stdDev } = require('./hashing');

const scamHashCache = new Map();

// Pending near-match review actions: pendingId -> { hash, sig, label, attUrl, dims }
const pendingNearMatches = new Map();

// Entries registered before signatures existed have no phash/thumb (see isLegacy in match.js).
const SCAM_COLS = 'id, hash, phash, thumb, width, height, label, added_by, added_at';

function rowToEntry(r, global = false) {
    const thumb = r.thumb ?? null;
    const entry = { id: r.id, hash: r.hash, phash: r.phash ?? null, thumb, width: r.width ?? null, height: r.height ?? null, label: r.label, addedBy: r.added_by, addedAt: r.added_at, flat: thumb ? stdDev(thumb) < SCAM_FLAT_MIN_STDDEV : false };
    if (global) entry.global = true;
    return entry;
}

async function getScamHashes(guildId) {
    if (scamHashCache.has(guildId)) return scamHashCache.get(guildId);
    const res = await pool.query(`SELECT ${SCAM_COLS} FROM scam_hashes WHERE guild_id = $1 ORDER BY id`, [guildId]);
    const hashes = res.rows.map(r => rowToEntry(r));
    scamHashCache.set(guildId, hashes); return hashes;
}

async function addScamHash(guildId, sig, label, addedBy) {
    const res = await pool.query(`INSERT INTO scam_hashes (guild_id, hash, phash, thumb, width, height, label, added_by, added_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${SCAM_COLS}`, [guildId, sig.dhash, sig.phash, sig.thumb, sig.width, sig.height, label, addedBy, Date.now()]);
    const entry = rowToEntry(res.rows[0]);
    const cached = scamHashCache.get(guildId) ?? []; cached.push(entry); scamHashCache.set(guildId, cached); return entry;
}

// Gives an old dHash-only entry a full signature, from a fresh copy of the same image.
async function upgradeScamHash(guildId, id, sig) {
    const res = await pool.query(`UPDATE scam_hashes SET hash = $3, phash = $4, thumb = $5, width = $6, height = $7 WHERE guild_id = $1 AND id = $2 RETURNING ${SCAM_COLS}`, [guildId, id, sig.dhash, sig.phash, sig.thumb, sig.width, sig.height]);
    if (!res.rowCount) return null;
    const entry = rowToEntry(res.rows[0]);
    scamHashCache.set(guildId, (scamHashCache.get(guildId) ?? []).map(h => h.id === id ? entry : h)); return entry;
}

async function removeScamHash(guildId, id) {
    const res = await pool.query('DELETE FROM scam_hashes WHERE guild_id = $1 AND id = $2', [guildId, id]);
    if (res.rowCount > 0) scamHashCache.set(guildId, (scamHashCache.get(guildId) ?? []).filter(h => h.id !== id));
    return res.rowCount > 0;
}

async function addGlobalScamHash(sig, label, addedBy) {
    const res = await pool.query('INSERT INTO global_scam_hashes (hash, phash, thumb, width, height, label, added_by, added_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, hash, phash, thumb, width, height, label', [sig.dhash, sig.phash, sig.thumb, sig.width, sig.height, label, addedBy, Date.now()]);
    const entry = rowToEntry(res.rows[0], true);
    if (globalScamHashCache !== null) globalScamHashCache.push(entry);
    return entry;
}

async function upgradeGlobalScamHash(id, sig) {
    const res = await pool.query('UPDATE global_scam_hashes SET hash = $2, phash = $3, thumb = $4, width = $5, height = $6 WHERE id = $1 RETURNING id, hash, phash, thumb, width, height, label', [id, sig.dhash, sig.phash, sig.thumb, sig.width, sig.height]);
    if (!res.rowCount) return null;
    const entry = rowToEntry(res.rows[0], true);
    if (globalScamHashCache !== null) globalScamHashCache = globalScamHashCache.map(h => h.id === id ? entry : h);
    return entry;
}

async function removeGlobalScamHash(id) {
    const res = await pool.query('DELETE FROM global_scam_hashes WHERE id = $1', [id]);
    if (res.rowCount > 0 && globalScamHashCache !== null) globalScamHashCache = globalScamHashCache.filter(h => h.id !== id);
    return res.rowCount > 0;
}

// Global hashes — can also be managed in DB directly:
// INSERT INTO global_scam_hashes (hash, label, added_by, added_at) VALUES ('...', 'label', 'admin', extract(epoch from now())*1000);
let globalScamHashCache = null;

async function getGlobalScamHashes() {
    if (globalScamHashCache !== null) return globalScamHashCache;
    const res = await pool.query('SELECT id, hash, phash, thumb, width, height, label FROM global_scam_hashes ORDER BY id');
    globalScamHashCache = res.rows.map(r => rowToEntry(r, true)); return globalScamHashCache;
}

setInterval(() => { globalScamHashCache = null; }, 5 * 60 * 1000);

// The threshold is clamped to SCAM_MAX_THRESHOLD: servers that saved the old, looser values (up to 20) get the stricter cap.
async function getScamProtConfig(guildId) {
    const cfg = await getConfig(guildId), spc = { enabled: true, threshold: SCAM_DEFAULT_THRESHOLD, timeoutMs: 5 * 60 * 1000, timeoutDisplay: '5m', deleteMsg: true, ...cfg.scamProt };
    spc.threshold = Math.min(Math.max(0, spc.threshold), SCAM_MAX_THRESHOLD); return spc;
}

// A module-level `let` cannot be reassigned from another file, so other modules call this.
function clearGlobalScamHashCache() { globalScamHashCache = null; }

module.exports = { addGlobalScamHash, addScamHash, clearGlobalScamHashCache, getGlobalScamHashes, getScamHashes, getScamProtConfig, pendingNearMatches, removeGlobalScamHash, removeScamHash, rowToEntry, scamHashCache, upgradeGlobalScamHash, upgradeScamHash };

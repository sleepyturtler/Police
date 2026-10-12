// Scam image hash registry (per server and global) and scam protection config.
const { getConfig, pool } = require('../db');

const scamHashCache = new Map();

// Pending near-match review actions: pendingId -> { hash, label, attUrl, dims }
const pendingNearMatches = new Map();

async function getScamHashes(guildId) {
    if (scamHashCache.has(guildId)) return scamHashCache.get(guildId);
    const res = await pool.query('SELECT id, hash, label, added_by, added_at FROM scam_hashes WHERE guild_id = $1 ORDER BY id', [guildId]);
    const hashes = res.rows.map(r => ({ id: r.id, hash: r.hash, label: r.label, addedBy: r.added_by, addedAt: r.added_at }));
    scamHashCache.set(guildId, hashes); return hashes;
}

async function addScamHash(guildId, hash, label, addedBy) {
    const res = await pool.query('INSERT INTO scam_hashes (guild_id, hash, label, added_by, added_at) VALUES ($1, $2, $3, $4, $5) RETURNING id', [guildId, hash, label, addedBy, Date.now()]);
    const entry = { id: res.rows[0].id, hash, label, addedBy, addedAt: Date.now() };
    const cached = scamHashCache.get(guildId) ?? []; cached.push(entry); scamHashCache.set(guildId, cached); return entry;
}

async function removeScamHash(guildId, id) {
    const res = await pool.query('DELETE FROM scam_hashes WHERE guild_id = $1 AND id = $2', [guildId, id]);
    if (res.rowCount > 0) scamHashCache.set(guildId, (scamHashCache.get(guildId) ?? []).filter(h => h.id !== id));
    return res.rowCount > 0;
}

async function addGlobalScamHash(hash, label, addedBy) {
    const res = await pool.query('INSERT INTO global_scam_hashes (hash, label, added_by, added_at) VALUES ($1, $2, $3, $4) RETURNING id', [hash, label, addedBy, Date.now()]);
    const entry = { id: res.rows[0].id, hash, label, global: true };
    if (globalScamHashCache !== null) globalScamHashCache.push(entry);
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
    const res = await pool.query('SELECT id, hash, label FROM global_scam_hashes ORDER BY id');
    globalScamHashCache = res.rows.map(r => ({ id: r.id, hash: r.hash, label: r.label, global: true })); return globalScamHashCache;
}

setInterval(() => { globalScamHashCache = null; }, 5 * 60 * 1000);

async function getScamProtConfig(guildId) { const cfg = await getConfig(guildId); return { enabled: true, threshold: 10, timeoutMs: 5 * 60 * 1000, timeoutDisplay: '5m', deleteMsg: true, ...cfg.scamProt }; }


// A module-level `let` cannot be reassigned from another file, so other modules call this.
function clearGlobalScamHashCache() { globalScamHashCache = null; }

module.exports = { addGlobalScamHash, addScamHash, clearGlobalScamHashCache, getGlobalScamHashes, getScamHashes, getScamProtConfig, pendingNearMatches, removeGlobalScamHash, removeScamHash, scamHashCache };

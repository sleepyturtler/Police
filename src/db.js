// PostgreSQL pool, schema, and storage for configs, warnings, timeouts, history and notes.
const dns = require('dns');
const { Pool } = require('pg');

 dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── DB ─────────────────────────────────────────────────────────────────────
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS configs            (guild_id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}');
        CREATE TABLE IF NOT EXISTS warnings           (key TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS history            (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS notes              (id BIGINT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS scam_hashes        (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, hash TEXT NOT NULL, label TEXT, added_by TEXT, added_at BIGINT);
        CREATE TABLE IF NOT EXISTS global_scam_hashes (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, label TEXT NOT NULL, added_by TEXT, added_at BIGINT);
        CREATE TABLE IF NOT EXISTS active_timeouts    (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (guild_id, user_id));
        CREATE INDEX IF NOT EXISTS warnings_guild_user ON warnings(guild_id, user_id);
        CREATE INDEX IF NOT EXISTS history_guild_user  ON history(guild_id, user_id);
        CREATE INDEX IF NOT EXISTS notes_guild_user    ON notes(guild_id, user_id);
        CREATE INDEX IF NOT EXISTS scam_hashes_guild   ON scam_hashes(guild_id);
    `);
}

const configCache = new Map(), activeWarnings = new Map(), activeTimeouts = new Map();

async function getConfig(guildId) {
    if (configCache.has(guildId)) return configCache.get(guildId);
    const res = await pool.query('SELECT data FROM configs WHERE guild_id = $1', [guildId]);
    const data = res.rows[0]?.data ?? { levels: {} };
    configCache.set(guildId, data); return data;
}

function saveConfig(guildId, data) {
    configCache.set(guildId, data);
    pool.query('INSERT INTO configs (guild_id, data) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET data = $2', [guildId, data]).catch(e => console.error('saveConfig:', e.message));
}

function saveWarning(key, data) {
    activeWarnings.set(key, data);
    pool.query('INSERT INTO warnings (key, guild_id, user_id, data) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO UPDATE SET data = $4', [key, data.guildId, data.userId, data]).catch(e => console.error('saveWarning:', e.message));
}

function deleteWarning(key) { activeWarnings.delete(key); pool.query('DELETE FROM warnings WHERE key = $1', [key]).catch(e => console.error('deleteWarning:', e.message)); }

// Tracks timeouts the bot itself has applied (native Discord timeouts, not warning roles) so they
// can be surfaced in the active warnings list. One entry per guild+user — Discord only allows one
// active timeout per member anyway, so a new timeout just overwrites the old tracked entry.
function timeoutKey(guildId, userId) { return `${guildId}-${userId}`; }

function saveActiveTimeout(guildId, userId, data) {
    activeTimeouts.set(timeoutKey(guildId, userId), data);
    pool.query('INSERT INTO active_timeouts (guild_id, user_id, data) VALUES ($1, $2, $3) ON CONFLICT (guild_id, user_id) DO UPDATE SET data = $3', [guildId, userId, data]).catch(e => console.error('saveActiveTimeout:', e.message));
}

function deleteActiveTimeout(guildId, userId) {
    activeTimeouts.delete(timeoutKey(guildId, userId));
    pool.query('DELETE FROM active_timeouts WHERE guild_id = $1 AND user_id = $2', [guildId, userId]).catch(e => console.error('deleteActiveTimeout:', e.message));
}

function addHistory(guildId, userId, entry) { pool.query('INSERT INTO history (guild_id, user_id, data) VALUES ($1, $2, $3)', [guildId, userId, entry]).catch(e => console.error('addHistory:', e.message)); }

async function getHistory(guildId, userId) { const res = await pool.query('SELECT data FROM history WHERE guild_id = $1 AND user_id = $2 ORDER BY id DESC LIMIT 10', [guildId, userId]); return res.rows.map(r => r.data).reverse(); }

async function getAllHistory(guildId, userId) { const res = await pool.query('SELECT data FROM history WHERE guild_id = $1 AND user_id = $2 ORDER BY id', [guildId, userId]); return res.rows.map(r => r.data); }

async function getNotes(guildId, userId) { const res = await pool.query('SELECT data FROM notes WHERE guild_id = $1 AND user_id = $2 ORDER BY id', [guildId, userId]); return res.rows.map(r => r.data); }

function addNote(guildId, userId, note) { pool.query('INSERT INTO notes (id, guild_id, user_id, data) VALUES ($1, $2, $3, $4)', [note.id, guildId, userId, note]).catch(e => console.error('addNote:', e.message)); }

async function deleteNote(guildId, userId, id) { const res = await pool.query('DELETE FROM notes WHERE guild_id = $1 AND user_id = $2 AND id = $3', [guildId, userId, id]); return res.rowCount > 0; }


// Deletes everything stored for a server. Called when the bot is removed from it.
async function purgeGuildData(guildId) {
    for (const [key, w] of activeWarnings) if (w.guildId === guildId) activeWarnings.delete(key);
    for (const [key, t] of activeTimeouts) if (t.guildId === guildId) activeTimeouts.delete(key);
    configCache.delete(guildId);
    for (const table of ['configs', 'warnings', 'history', 'notes', 'scam_hashes', 'active_timeouts']) await pool.query(`DELETE FROM ${table} WHERE guild_id = $1`, [guildId]);
}

module.exports = { activeTimeouts, activeWarnings, addHistory, addNote, configCache, deleteActiveTimeout, deleteNote, deleteWarning, getAllHistory, getConfig, getHistory, getNotes, initDB, pool, purgeGuildData, saveActiveTimeout, saveConfig, saveWarning, timeoutKey };

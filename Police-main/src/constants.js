// Fixed values and size limits shared across the bot.
const { PermissionFlagsBits } = require('discord.js');

const OWNER_ID = '1193912522999336960';

const SUPPORT_SERVER_URL = 'https://discord.gg/Qrp82cRhUW';

const MAX_SCAM_IMAGE_BYTES = parseInt(process.env.MAX_SCAM_IMAGE_BYTES) || 15 * 1024 * 1024;

 // skip decoding unusually large attachments; scam images are typically small screenshots anyway
// The byte cap above limits the file, not the decoded size: a small PNG can expand to 60MB+ of raw pixels.
// This caps decoded pixels (16 megapixels is roughly a 4000x4000 image; phone screenshots are 2 to 3).
// sharp checks it from the header, so an oversized image is rejected before any pixel memory is allocated.
// Note: an image over this limit is not scanned at all, so raise it if you ever need to catch bigger ones.
const MAX_SCAM_IMAGE_PIXELS = parseInt(process.env.MAX_SCAM_IMAGE_PIXELS) || 16_000_000;

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

// Reads a number from the environment, falling back to the hardcoded default when unset or invalid.
// (Not `parseInt(...) || default`, because 0 is a valid value for several of these.)
const numEnv = (name, def, parse = parseInt) => { const n = parse(process.env[name]); return Number.isFinite(n) ? n : def; };

// ── Image matching ──────────────────────────────────────────────────────────
// A registered image is matched by comparing signatures: the 32x32 greyscale thumbnails must correlate
// (this is the strong signal), the pHash must agree, and the dHash must be within the threshold unless the
// thumbnails are near-identical (JPEG noise flips dHash bits on dark images). Full-image matches must also
// have a similar aspect ratio. Every value here can be overridden with the env var of the same name.
const SCAM_DEFAULT_THRESHOLD = numEnv('SCAM_DEFAULT_THRESHOLD', 6);          // dHash bits (of 64), server default
const SCAM_MAX_THRESHOLD = numEnv('SCAM_MAX_THRESHOLD', 8);                  // highest value /scam config may set; saved higher values are clamped
const SCAM_GLOBAL_THRESHOLD = numEnv('SCAM_GLOBAL_THRESHOLD', 6);            // dHash bits for the global list
const SCAM_PHASH_MAX_DISTANCE = numEnv('SCAM_PHASH_MAX_DISTANCE', 10);       // pHash bits (of 64) that must also agree
const SCAM_NCC_MIN = numEnv('SCAM_NCC_MIN', 0.9, parseFloat);                // thumbnail correlation, 1 = identical
const SCAM_CROP_MAX_DISTANCE = numEnv('SCAM_CROP_MAX_DISTANCE', 6);          // dHash limit for cropped-region matches (they are verified harder by SCAM_CROP_NCC_MIN)
const SCAM_CROP_NCC_MIN = numEnv('SCAM_CROP_NCC_MIN', 0.92, parseFloat);     // stricter thumbnail correlation for cropped-region matches
const SCAM_NCC_STRONG = numEnv('SCAM_NCC_STRONG', 0.97, parseFloat);         // at or above this the dHash limit is waived (the picture is the same)
const SCAM_LEGACY_MAX_DISTANCE = numEnv('SCAM_LEGACY_MAX_DISTANCE', 6);      // old entries only have a dHash, no thumbnail to verify with
const SCAM_CROP_LEGACY_MAX_DISTANCE = numEnv('SCAM_CROP_LEGACY_MAX_DISTANCE', 3);
const SCAM_ASPECT_TOLERANCE = numEnv('SCAM_ASPECT_TOLERANCE', 0.1, parseFloat); // allowed aspect ratio difference for full-image matches
const SCAM_FLAT_MIN_STDDEV = numEnv('SCAM_FLAT_MIN_STDDEV', 12, parseFloat); // thumbnail pixel spread below this = too little detail to hash reliably
const CROSSPOST_DEFAULT_IMAGE_THRESHOLD = numEnv('CROSSPOST_DEFAULT_IMAGE_THRESHOLD', 4);
const CROSSPOST_MAX_IMAGE_THRESHOLD = numEnv('CROSSPOST_MAX_IMAGE_THRESHOLD', 8);

// ── Sting operation (trap channel) ──────────────────────────────────────────
const STING_DELETE_WINDOW_MS = numEnv('STING_DELETE_WINDOW_HOURS', 24) * 60 * 60 * 1000; // how far back a hit's messages are deleted
const STING_DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000;
// The delete and timeout levels have to fetch history to find the user's messages (the message cache is off),
// so a hit is bounded: at most this many pages of 100 per channel, and this long overall.
const STING_PURGE_MAX_PAGES = numEnv('STING_PURGE_MAX_PAGES', 50);
const STING_PURGE_BUDGET_MS = numEnv('STING_PURGE_BUDGET_SECONDS', 180) * 1000;

// ── Message deletion (sting cleanup, /messages, ban cleanup) ────────────────
// Discord only bulk-deletes messages under 14 days old. Older ones can be deleted one at a time, which is slow
// (a few per second at best), so a single run deletes at most this many of them and reports the rest.
const DELETE_OLD_MAX = numEnv('DELETE_OLD_MAX', 200);
const DELETE_CONCURRENCY = numEnv('DELETE_CONCURRENCY', 4);                      // channels swept at the same time
const DELETE_MANUAL_BUDGET_MS = numEnv('DELETE_MANUAL_BUDGET_SECONDS', 600) * 1000; // /messages purge and ban cleanup

// ── Warning paths ───────────────────────────────────────────────────────────
const MAX_PATHS = numEnv('MAX_WARNING_PATHS', 5);
const MAX_OFFENSES = numEnv('MAX_PATH_OFFENSES', 20);
const FLOW_TTL_MS = numEnv('WARNING_FLOW_MINUTES', 5) * 60 * 1000;


// Permissions requested by the invite link (used by /invite and the landing page).
const INVITE_PERMISSIONS = PermissionFlagsBits.ManageRoles | PermissionFlagsBits.KickMembers | PermissionFlagsBits.BanMembers | PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.ViewAuditLog | PermissionFlagsBits.ManageMessages;

module.exports = {
    CROSSPOST_DEFAULT_IMAGE_THRESHOLD, CROSSPOST_MAX_IMAGE_THRESHOLD, INVITE_PERMISSIONS, MAX_SCAM_IMAGE_BYTES, MAX_SCAM_IMAGE_PIXELS, MAX_TIMEOUT_MS, OWNER_ID,
    SCAM_ASPECT_TOLERANCE, SCAM_CROP_LEGACY_MAX_DISTANCE, SCAM_CROP_MAX_DISTANCE, SCAM_CROP_NCC_MIN, SCAM_DEFAULT_THRESHOLD, SCAM_FLAT_MIN_STDDEV, SCAM_GLOBAL_THRESHOLD,
    SCAM_LEGACY_MAX_DISTANCE, SCAM_MAX_THRESHOLD, SCAM_NCC_MIN, SCAM_NCC_STRONG, SCAM_PHASH_MAX_DISTANCE,
    STING_DEFAULT_TIMEOUT_MS, STING_DELETE_WINDOW_MS, STING_PURGE_BUDGET_MS, STING_PURGE_MAX_PAGES, SUPPORT_SERVER_URL,
    DELETE_CONCURRENCY, DELETE_MANUAL_BUDGET_MS, DELETE_OLD_MAX, FLOW_TTL_MS, MAX_OFFENSES, MAX_PATHS,
};

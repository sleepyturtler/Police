// Decides whether an incoming image signature matches a registered one. Used by scam detection,
// /scam add, the near-match buttons and cross-channel image matching.
const { SCAM_ASPECT_TOLERANCE, SCAM_CROP_LEGACY_MAX_DISTANCE, SCAM_CROP_MAX_DISTANCE, SCAM_CROP_NCC_MIN, SCAM_LEGACY_MAX_DISTANCE, SCAM_NCC_MIN, SCAM_NCC_STRONG, SCAM_PHASH_MAX_DISTANCE } = require('../constants');
const { hammingDistance } = require('./hashing');

// Registered before thumbnails existed: only a dHash is stored, so there is nothing to verify against.
const isLegacy = entry => !entry.thumb || !entry.phash;

// Normalised cross-correlation of two equal-size greyscale thumbnails, from -1 to 1 (1 = same picture,
// ignoring overall brightness and contrast).
function ncc(a, b) {
    const n = a.length; let sa = 0, sb = 0;
    for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
    const ma = sa / n, mb = sb / n; let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
    const denom = Math.sqrt(da * db);
    if (denom < 1e-6) return Math.abs(ma - mb) < 4 ? 1 : 0; // both flat: the same only if the same shade
    return num / denom;
}

function aspectOk(sig, entry) {
    if (!entry.width || !entry.height || !sig.width || !sig.height) return true;
    return Math.abs((sig.width / sig.height) / (entry.width / entry.height) - 1) <= SCAM_ASPECT_TOLERANCE;
}

// Returns null for no match, or the evidence for one. opts: { threshold, crop, legacyMax }.
function compare(sig, entry, opts) {
    const { threshold, crop = false } = opts, distance = hammingDistance(sig.dhash, entry.hash);
    if (isLegacy(entry)) {
        const max = Math.min(threshold, opts.legacyMax ?? (crop ? SCAM_CROP_LEGACY_MAX_DISTANCE : SCAM_LEGACY_MAX_DISTANCE));
        if (distance > max) return null;
        if (sig.flat && distance > 1) return null; // a low-detail image's dHash is mostly noise
        return { distance, legacy: true };
    }
    // Cheap checks first. The pHash must agree, and a full-image match must have a similar shape.
    const phashDistance = hammingDistance(sig.phash, entry.phash);
    if (phashDistance > SCAM_PHASH_MAX_DISTANCE) return null;
    if (!crop && !aspectOk(sig, entry)) return null;
    // The thumbnails must correlate. Unrelated screenshots that share a layout (e.g. two dark-mode chats) stay well below this.
    const correlation = ncc(sig.thumb, entry.thumb);
    if (correlation < (crop ? SCAM_CROP_NCC_MIN : SCAM_NCC_MIN)) return null;
    // The dHash must be within the threshold, unless the thumbnails are near-identical (JPEG noise flips dHash bits).
    if (distance > (crop ? Math.min(threshold, SCAM_CROP_MAX_DISTANCE) : threshold) && correlation < SCAM_NCC_STRONG) return null;
    if ((sig.flat || entry.flat) && (distance > 2 || correlation < SCAM_NCC_STRONG)) return null;
    return { distance, phashDistance, correlation, legacy: false };
}

// Best match among entries (lowest distance, highest correlation), or null.
function findMatch(sig, entries, opts) {
    let best = null;
    for (const entry of entries) {
        const r = compare(sig, entry, opts); if (!r) continue;
        if (!best || r.distance - (r.correlation ?? 0) < best.distance - (best.correlation ?? 0)) best = { entry, ...r };
    }
    return best;
}

// Two incoming images (cross-channel check): both hashes must agree. Low-detail images have near-meaningless
// hashes (every solid colour hashes the same), so those must also have the same overall brightness.
function imagesAlike(a, b, threshold) {
    const distance = hammingDistance(a.dhash, b.dhash);
    if (distance > threshold || hammingDistance(a.phash, b.phash) > SCAM_PHASH_MAX_DISTANCE) return false;
    if (!(a.flat || b.flat)) return true;
    return distance <= 1 && a.mean != null && b.mean != null && Math.abs(a.mean - b.mean) <= 6;
}

module.exports = { compare, findMatch, imagesAlike, isLegacy, ncc };

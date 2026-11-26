// Image fetching and image signatures (dHash + pHash + 32x32 thumbnail), including crop variants.
const sharp = require('sharp');
const https = require('https');
const http = require('http');
const { MAX_SCAM_IMAGE_BYTES, MAX_SCAM_IMAGE_PIXELS, SCAM_FLAT_MIN_STDDEV } = require('../constants');

// sharp/libvips keeps its own native memory outside the JS heap. We never reuse a decoded
// image across calls, so its operation cache buys nothing here and only adds RSS — and
// capping concurrency bounds how many images can be decoded in parallel on a small instance.
sharp.cache(false);

sharp.concurrency(parseInt(process.env.SHARP_CONCURRENCY) || 2);

const openImage = buf => sharp(buf, { limitInputPixels: MAX_SCAM_IMAGE_PIXELS, sequentialRead: true });

// ── Image signatures ───────────────────────────────────────────────────────
// A signature has three parts:
//   dhash : 64-bit difference hash of a 9x8 greyscale copy. Computed exactly as before, so every hash
//           already stored in the database keeps working.
//   phash : 64-bit DCT hash of the 32x32 thumbnail. A second, independent opinion on the same image.
//   thumb : the 32x32 greyscale thumbnail itself (1 KB). Used to verify a candidate match by correlation.
// A match needs the cheap hashes to agree AND the thumbnails to correlate (see match.js), which is what
// stops two different screenshots with a similar layout from colliding.
const THUMB = 32;
const WHITE = '#ffffff';

function dhashFromPixels(data) {
    let hash = 0n;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) if (data[row * 9 + col] > data[row * 9 + col + 1]) hash |= (1n << BigInt(row * 8 + col));
    return hash.toString(16).padStart(16, '0');
}

async function dHash(buffer) {
    return dhashFromPixels(await openImage(buffer).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer());
}

function hammingDistance(a, b) { let diff = BigInt('0x' + a) ^ BigInt('0x' + b), dist = 0; while (diff) { dist += Number(diff & 1n); diff >>= 1n; } return dist; }

// Low frequencies of a 2D DCT over the thumbnail, thresholded at their median. Only the 8x8 corner is needed,
// so this is a separable transform: 32 samples -> 8 frequencies along rows, then along columns.
const DCT = Array.from({ length: 8 }, (_, u) => Float64Array.from({ length: THUMB }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * THUMB))));

function pHashFromThumb(grey) {
    const rows = new Float64Array(THUMB * 8);
    for (let y = 0; y < THUMB; y++) for (let u = 0; u < 8; u++) { let sum = 0; for (let x = 0; x < THUMB; x++) sum += grey[y * THUMB + x] * DCT[u][x]; rows[y * 8 + u] = sum; }
    const coef = new Float64Array(64);
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { let sum = 0; for (let y = 0; y < THUMB; y++) sum += rows[y * 8 + u] * DCT[v][y]; coef[v * 8 + u] = sum; }
    const median = Array.from(coef).slice(1).sort((a, b) => a - b)[31]; // the DC term (index 0) is just overall brightness
    let hash = 0n;
    for (let i = 1; i < 64; i++) if (coef[i] > median) hash |= (1n << BigInt(i));
    return hash.toString(16).padStart(16, '0');
}

function meanOf(buf) { let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i]; return sum / buf.length; }

function stdDev(buf) {
    const mean = meanOf(buf); let sq = 0;
    for (let i = 0; i < buf.length; i++) sq += (buf[i] - mean) ** 2;
    return Math.sqrt(sq / buf.length);
}

// `make` returns a fresh sharp pipeline over the same pixels (each call decodes independently, one at a time,
// so the memory use stays that of a single decode).
async function signatureFrom(make, width, height) {
    const dhash = dhashFromPixels(await make().resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer());
    const thumb = await make().resize(THUMB, THUMB, { fit: 'fill' }).flatten({ background: WHITE }).greyscale().raw().toBuffer();
    if (thumb.length !== THUMB * THUMB) throw new Error('unexpected thumbnail size');
    const spread = stdDev(thumb);
    return { dhash, phash: pHashFromThumb(thumb), thumb, width, height, mean: meanOf(thumb), stddev: spread, flat: spread < SCAM_FLAT_MIN_STDDEV };
}

async function computeSignature(buffer) {
    const meta = await openImage(buffer).metadata();
    const swap = meta.orientation >= 5; // EXIF-rotated photos are stored sideways
    return signatureFrom(() => openImage(buffer), swap ? meta.height : meta.width, swap ? meta.width : meta.height);
}

// Edge trims, as fractions of the image. A scam screenshot re-posted with a border, a header bar or a footer
// bar still contains the original; trimming that margin recovers it. The thumbnail correlation check is what
// keeps this safe: a crop only counts if it correlates strongly with the registered image.
const CROP_TRIMS = (() => {
    const trims = [];
    for (const f of [0.03, 0.05, 0.08, 0.12, 0.16, 0.2]) trims.push({ l: f, t: f, r: f, b: f });                         // border on every side
    for (const f of [0.06, 0.1, 0.15, 0.2]) for (const side of ['l', 't', 'r', 'b']) trims.push({ [side]: f });          // one extra bar or margin
    for (const f of [0.08, 0.15]) { trims.push({ t: f, b: f }); trims.push({ l: f, r: f }); }                            // bars on opposite sides
    return trims;
})();

// Signatures of the cropped sub-regions. Only called when the full image did not match.
// IMPORTANT: we downscale once up front and crop from that small raw copy. Cropping the original directly
// would re-decode the full-size image for every crop, which is what once caused the memory spike.
async function generateCropSignatures(buffer) {
    let small;
    try { small = await openImage(buffer).resize(256, 256, { fit: 'inside', withoutEnlargement: true }).flatten({ background: WHITE }).raw().toBuffer({ resolveWithObject: true }); } catch { return []; }
    const { width, height, channels } = small.info;
    if (!width || !height || width < 32 || height < 32) return [];
    const out = [];
    for (const t of CROP_TRIMS) {
        const left = Math.round(width * (t.l ?? 0)), top = Math.round(height * (t.t ?? 0));
        const rect = { left, top, width: width - left - Math.round(width * (t.r ?? 0)), height: height - top - Math.round(height * (t.b ?? 0)) };
        if (rect.width < 16 || rect.height < 16) continue;
        try { out.push(await signatureFrom(() => sharp(small.data, { raw: { width, height, channels } }).extract(rect), rect.width, rect.height)); } catch { /* skip invalid crop */ }
    }
    return out;
}

function fetchImageBuffer(url) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { headers: { 'User-Agent': 'PoliceBot/1.0' }, timeout: 15_000 }, res => {
            if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
            let total = 0; const chunks = [];
            res.on('data', c => {
                total += c.length;
                if (total > MAX_SCAM_IMAGE_BYTES) { res.destroy(); req.destroy(); return reject(new Error('response exceeded size cap')); }
                chunks.push(c);
            });
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('timeout', () => req.destroy(new Error('request timed out'))).on('error', reject);
    });
}

async function getImageDimensions(buffer) {
    try { const meta = await sharp(buffer).metadata(); return { width: meta.width, height: meta.height }; } catch { return null; }
}

// Two message listeners (scam check and cross-post check) both need the hash of the same attachment.
// Sharing one in-flight download+decode between them halves the image work per attachment.
// Entries are dropped after a short time so the buffer is not kept around, and failures are not cached.
const imageInfoCache = new Map(), imageStats = { hashed: 0, skippedPixels: 0, failed: 0 };

const IMAGE_INFO_TTL_MS = 15_000, IMAGE_INFO_MAX = 40;

function getImageInfo(att) {
    const hit = imageInfoCache.get(att.id);
    if (hit) return hit;
    if (imageInfoCache.size >= IMAGE_INFO_MAX) imageInfoCache.delete(imageInfoCache.keys().next().value);
    const promise = fetchImageBuffer(att.url).then(async buffer => {
        try { const sig = await computeSignature(buffer); imageStats.hashed++; return { buffer, hash: sig.dhash, sig }; }
        catch (e) { if (/pixel limit/i.test(e.message)) imageStats.skippedPixels++; else imageStats.failed++; throw e; }
    });
    imageInfoCache.set(att.id, promise);
    const drop = () => imageInfoCache.delete(att.id);
    promise.catch(drop);
    setTimeout(drop, IMAGE_INFO_TTL_MS).unref();
    return promise;
}

module.exports = { computeSignature, dHash, fetchImageBuffer, generateCropSignatures, getImageDimensions, getImageInfo, hammingDistance, imageInfoCache, imageStats, stdDev };

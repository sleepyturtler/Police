// Image fetching and perceptual hashing (dHash), including crop variants.
const sharp = require('sharp');
const https = require('https');
const http = require('http');
const { MAX_SCAM_IMAGE_BYTES, MAX_SCAM_IMAGE_PIXELS } = require('../constants');

// sharp/libvips keeps its own native memory outside the JS heap. We never reuse a decoded
// image across calls, so its operation cache buys nothing here and only adds RSS — and
// capping concurrency bounds how many images can be decoded in parallel on a small instance.
sharp.cache(false);

sharp.concurrency(parseInt(process.env.SHARP_CONCURRENCY) || 2);

const openImage = buf => sharp(buf, { limitInputPixels: MAX_SCAM_IMAGE_PIXELS, sequentialRead: true });

// ── Scam protection ────────────────────────────────────────────────────────
async function dHash(buffer) {
    const result = await openImage(buffer).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const data = result.data; let hash = 0n;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) if (data[row * 9 + col] > data[row * 9 + col + 1]) hash |= (1n << BigInt(row * 8 + col));
    return hash.toString(16).padStart(16, '0');
}

function hammingDistance(a, b) { let diff = BigInt('0x' + a) ^ BigInt('0x' + b), dist = 0; while (diff) { dist += Number(diff & 1n); diff >>= 1n; } return dist; }

// Generates dHashes for several cropped sub-regions of an image, so that a registered
// scam image can still be matched even if it was posted with different padding/framing
// (e.g. wrapped in a screenshot border, or a slightly different crop).
// Only called when the full-image hash doesn't already match (see usage below), to keep
// the common (non-scam) case cheap.
// IMPORTANT: we downscale once up front and crop from that small copy. Cropping the
// original directly would re-decode the full-size image on every one of the ~36 crops —
// on a multi-MB photo that's 36x the decode cost and memory per image, which is what
// caused the memory spike. Working from a small copy keeps it cheap regardless of how
// large the original attachment is.
async function generateCropHashes(buffer) {
    let small;
    try { small = await openImage(buffer).resize(256, 256, { fit: 'inside', withoutEnlargement: true }).toBuffer(); } catch { return []; }
    let meta; try { meta = await sharp(small).metadata(); } catch { return []; }
    const { width, height } = meta;
    if (!width || !height || width < 16 || height < 16) return [];
    const scales = [0.9, 0.8, 0.7, 0.6];
    const rects = new Map();
    for (const scale of scales) {
        const cw = Math.max(8, Math.round(width * scale)), ch = Math.max(8, Math.round(height * scale));
        const xs = new Set([0, Math.round((width - cw) / 2), width - cw]);
        const ys = new Set([0, Math.round((height - ch) / 2), height - ch]);
        for (const left of xs) for (const top of ys) rects.set(`${left}_${top}_${cw}_${ch}`, { left, top, width: cw, height: ch });
    }
    const hashes = [];
    for (const rect of rects.values()) {
        try { hashes.push(await dHash(await sharp(small).extract(rect).toBuffer())); } catch { /* skip invalid crop */ }
    }
    return hashes;
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
        try { const hash = await dHash(buffer); imageStats.hashed++; return { buffer, hash }; }
        catch (e) { if (/pixel limit/i.test(e.message)) imageStats.skippedPixels++; else imageStats.failed++; throw e; }
    });
    imageInfoCache.set(att.id, promise);
    const drop = () => imageInfoCache.delete(att.id);
    promise.catch(drop);
    setTimeout(drop, IMAGE_INFO_TTL_MS).unref();
    return promise;
}

module.exports = { dHash, fetchImageBuffer, generateCropHashes, getImageDimensions, getImageInfo, hammingDistance, imageInfoCache, imageStats };

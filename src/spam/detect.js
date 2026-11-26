// Message listener for spam and cross-post detection.
const { PermissionFlagsBits } = require('discord.js');
const { client } = require('../client');
const { CROSSPOST_MAX_IMAGE_THRESHOLD, MAX_SCAM_IMAGE_BYTES } = require('../constants');
const { isStingChannel } = require('../honeypot/config');
const { getSpamConfig, handleSpam, normalise, similarity, spamTracker } = require('./spam');
const { crossPostTracker, getCrossPostConfig, handleCrossPost } = require('./crosspost');
const { getImageInfo } = require('../scam/hashing');
const { imagesAlike } = require('../scam/match');

// ── Spam detection ─────────────────────────────────────────────────────────
client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    if (await isStingChannel(message.guild.id, message.channel.id)) return; // the sting channel has its own handler
    const imageAtts = [...message.attachments.values()].filter(a => (/\.(png|jpg|jpeg|gif|webp)$/i.test(a.name ?? '') || a.contentType?.startsWith('image/')) && a.size <= MAX_SCAM_IMAGE_BYTES);
    if (!message.content && !imageAtts.length) return;
    const guildId = message.guild.id, now = Date.now(), latest = message.content ? normalise(message.content) : null;
    if (latest) {
        const spc2 = await getSpamConfig(guildId);
        if (spc2.enabled) {
            const spamKey = `${guildId}-${message.author.id}`;
            const fresh = (spamTracker.get(spamKey) ?? []).filter(e => now - e.ts < spc2.windowMs);
            fresh.push({ content: latest, msgId: message.id, channelId: message.channel.id, ts: now, hasReactions: message.reactions.cache.size > 0 });
            spamTracker.set(spamKey, fresh);
            const matches = fresh.filter(e => e.channelId === message.channel.id && similarity(e.content, latest) >= spc2.similarityThreshold);
            if (matches.length >= spc2.count) { spamTracker.delete(spamKey); await handleSpam(message, matches, spc2); return; }
        }
    }
    // Cross-channel: same message (or same image) copy-pasted into several different channels, often
    // minutes apart (referral/affiliate ads, scam screenshots not caught by the registered-hash system
    // below because they were never registered) — same-channel spam above won't catch this.
    const cpc = await getCrossPostConfig(guildId);
    if (!cpc.enabled) return;
    // Administrators are exempt from cross-channel detection entirely: nothing is tracked, deleted, logged or sent.
    if (message.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    let imgHash = null, imgSig = null;
    if (cpc.matchImages && imageAtts.length) {
        try { const info = await getImageInfo(imageAtts[0]); imgHash = info.hash; imgSig = info.sig; } catch (e) { console.error('crosspost: hash failed:', e.message); }
    }
    const hasText = latest && latest.length >= 20;
    if (!hasText && !imgHash) return;
    const cpKey = `${guildId}-${message.author.id}`;
    const freshCp = (crossPostTracker.get(cpKey) ?? []).filter(e => now - e.ts < cpc.windowMs);
    freshCp.push({ content: hasText ? latest : null, imgHash, imgPhash: imgSig?.phash ?? null, imgFlat: !!imgSig?.flat, imgMean: imgSig?.mean ?? null, msgId: message.id, channelId: message.channel.id, ts: now, hasReactions: message.reactions.cache.size > 0 });
    crossPostTracker.set(cpKey, freshCp);
    if (hasText) {
        const textMatches = freshCp.filter(e => e.content && similarity(e.content, latest) >= cpc.similarityThreshold);
        const distinctChannels = new Set(textMatches.map(e => e.channelId)).size;
        if (distinctChannels >= cpc.count) { crossPostTracker.delete(cpKey); await handleCrossPost(message.guild, message.author, textMatches, cpc, 'text'); return; }
    }
    if (imgHash) {
        // Both hashes must agree, and low-detail images (where a hash is mostly noise) must be near-identical.
        const cur = { dhash: imgHash, phash: imgSig.phash, flat: imgSig.flat, mean: imgSig.mean }, thr = Math.min(cpc.imageThreshold, CROSSPOST_MAX_IMAGE_THRESHOLD);
        const imageMatches = freshCp.filter(e => e.imgHash && e.imgPhash && imagesAlike({ dhash: e.imgHash, phash: e.imgPhash, flat: e.imgFlat, mean: e.imgMean }, cur, thr));
        const distinctChannels = new Set(imageMatches.map(e => e.channelId)).size;
        if (distinctChannels >= cpc.count) { crossPostTracker.delete(cpKey); await handleCrossPost(message.guild, message.author, imageMatches, cpc, 'image'); }
    }
});

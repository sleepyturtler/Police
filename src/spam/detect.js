// Message listener for spam and cross-post detection.
const { client } = require('../client');
const { MAX_SCAM_IMAGE_BYTES } = require('../constants');
const { getSpamConfig, handleSpam, normalise, similarity, spamTracker } = require('./spam');
const { crossPostTracker, getCrossPostConfig, handleCrossPost } = require('./crosspost');
const { getImageInfo, hammingDistance } = require('../scam/hashing');

// ── Spam detection ─────────────────────────────────────────────────────────
client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
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
    let imgHash = null;
    if (cpc.matchImages && imageAtts.length) {
        try { imgHash = (await getImageInfo(imageAtts[0])).hash; } catch (e) { console.error('crosspost: hash failed:', e.message); }
    }
    const hasText = latest && latest.length >= 20;
    if (!hasText && !imgHash) return;
    const cpKey = `${guildId}-${message.author.id}`;
    const freshCp = (crossPostTracker.get(cpKey) ?? []).filter(e => now - e.ts < cpc.windowMs);
    freshCp.push({ content: hasText ? latest : null, imgHash, msgId: message.id, channelId: message.channel.id, ts: now, hasReactions: message.reactions.cache.size > 0 });
    crossPostTracker.set(cpKey, freshCp);
    if (hasText) {
        const textMatches = freshCp.filter(e => e.content && similarity(e.content, latest) >= cpc.similarityThreshold);
        const distinctChannels = new Set(textMatches.map(e => e.channelId)).size;
        if (distinctChannels >= cpc.count) { crossPostTracker.delete(cpKey); await handleCrossPost(message.guild, message.author, textMatches, cpc, 'text'); return; }
    }
    if (imgHash) {
        const imageMatches = freshCp.filter(e => e.imgHash && hammingDistance(e.imgHash, imgHash) <= cpc.imageThreshold);
        const distinctChannels = new Set(imageMatches.map(e => e.channelId)).size;
        if (distinctChannels >= cpc.count) { crossPostTracker.delete(cpKey); await handleCrossPost(message.guild, message.author, imageMatches, cpc, 'image'); }
    }
});

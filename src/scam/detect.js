// Message listener that matches posted images against registered scam hashes.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { client } = require('../client');
const { MAX_SCAM_IMAGE_BYTES } = require('../constants');
const { getGlobalScamHashes, getScamHashes, getScamProtConfig, pendingNearMatches } = require('./store');
const { generateCropHashes, getImageDimensions, getImageInfo, hammingDistance } = require('./hashing');
const { addHistory, getConfig, saveActiveTimeout } = require('../db');

// ── Scam detection ─────────────────────────────────────────────────────────
client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    const attachments = [...message.attachments.values()].filter(a => (/\.(png|jpg|jpeg|gif|webp)$/i.test(a.name ?? '') || a.contentType?.startsWith('image/')) && a.size <= MAX_SCAM_IMAGE_BYTES);
    if (!attachments.length) return;
    const guildId = message.guild.id, spc = await getScamProtConfig(guildId);
    if (!spc.enabled) return;
    const hashes = await getScamHashes(guildId), globalHashes = await getGlobalScamHashes();
    if (!hashes.length && !globalHashes.length) return;
    const botMember = message.guild.members.me;
    const canTimeout = botMember.permissions.has(PermissionFlagsBits.ModerateMembers);
    for (const att of attachments) {
        let buffer, imgHash; try { ({ buffer, hash: imgHash } = await getImageInfo(att)); } catch (e) { console.error('scam: fetch/hash failed:', e.message); continue; }
        let match = null, isGlobal = false, matchDistance = 0, matchedVia = 'full image';
        for (const entry of globalHashes) { const dist = hammingDistance(imgHash, entry.hash); if (dist <= 10) { match = entry; isGlobal = true; matchDistance = dist; break; } }
        if (!match) { for (const entry of hashes) { const dist = hammingDistance(imgHash, entry.hash); if (dist <= spc.threshold) { match = entry; matchDistance = dist; break; } } }
        if (!match) {
            // Full image didn't match a registered scam — it may be a cropped/re-framed
            // version of one, so check a handful of cropped sub-regions before giving up.
            const cropHashes = await generateCropHashes(buffer).catch(() => []);
            outer: for (const ch of cropHashes) {
                for (const entry of globalHashes) { const dist = hammingDistance(ch, entry.hash); if (dist <= 10) { match = entry; isGlobal = true; matchDistance = dist; matchedVia = 'cropped region'; break outer; } }
                for (const entry of hashes) { const dist = hammingDistance(ch, entry.hash); if (dist <= spc.threshold) { match = entry; matchDistance = dist; matchedVia = 'cropped region'; break outer; } }
            }
        }
        if (!match) continue;
        console.log(`🚨 ${isGlobal ? '[GLOBAL] ' : ''}Scam: ${message.author.tag} in ${guildId} ("${match.label}")`);
        const cfg2 = await getConfig(guildId);
        const shouldDelete = isGlobal ? true : spc.deleteMsg, shouldTimeout = isGlobal ? true : !!spc.timeoutMs;
        const timeoutMs = isGlobal ? (spc.timeoutMs ?? 5 * 60 * 1000) : spc.timeoutMs, timeoutDisplay = isGlobal ? (spc.timeoutDisplay ?? '5m') : spc.timeoutDisplay;
        const canDelete = shouldDelete && botMember.permissionsIn(message.channel).has(PermissionFlagsBits.ManageMessages);
        if (shouldDelete) { if (canDelete) message.delete().catch(e => console.error('scam: delete failed:', e.message)); else console.error(`scam: cannot delete in ${message.channel.id} — missing ManageMessages`); }
        let timedOut = false;
        if (shouldTimeout && timeoutMs && canTimeout) {
            const member = message.guild.members.cache.get(message.author.id) ?? await message.guild.members.fetch(message.author.id).catch(() => null);
            if (member && !member.permissions.has(PermissionFlagsBits.Administrator)) {
                timedOut = await member.timeout(timeoutMs, `${isGlobal ? '[Global] ' : ''}Scam: ${match.label}`).then(() => true).catch(() => false);
                if (timedOut) saveActiveTimeout(guildId, message.author.id, { guildId, userId: message.author.id, userTag: message.author.tag, reason: `${isGlobal ? '[Global] ' : ''}Scam: ${match.label}`, issuedBy: client.user.tag, issuedAt: Date.now(), expiresAt: Date.now() + timeoutMs, durationDisplay: timeoutDisplay });
            }
        }
        const E2 = (c, t) => new EmbedBuilder().setColor(c).setTitle(t).setTimestamp();
        const logCh = cfg2.logChannelId && message.guild.channels.cache.get(cfg2.logChannelId);
        const wasDeleted = shouldDelete && canDelete;
        const detectedEmbed = E2('#ff0000','Scam Image Detected').setDescription(wasDeleted ? `${message.author}'s message was removed — it matched a known scam image.` : `${message.author}'s message in ${message.channel} matched a known scam image but **was not deleted** (missing permissions or delete disabled).`).addFields({ name: 'Matched', value: match.label, inline: true }, ...(timedOut ? [{ name: 'Consequence', value: `Timed out for ${timeoutDisplay}`, inline: true }] : []));
        if (wasDeleted) message.channel.send({ embeds: [detectedEmbed] }).catch(() => {});
        else if (logCh) logCh.send({ embeds: [detectedEmbed] }).catch(() => {});
        if (cfg2.warnDm !== false) message.author.send({ embeds: [E2('#ff0000','Your message was removed').setDescription(`A message you sent in **${message.guild.name}** was detected as a known scam image and removed.`).addFields({ name: 'Matched Pattern', value: match.label, inline: true }, ...(timedOut ? [{ name: 'Consequence', value: `You have been timed out for ${timeoutDisplay}`, inline: true }] : [])).setFooter({ text: 'If you believe this is a mistake, contact a moderator' })] }).catch(() => {});
        if (logCh) {
            await logCh.send({ embeds: [E2('#ff0000',`Scam Image Auto-Removed${isGlobal ? ' (Global)' : ''}`).addFields({ name: 'User', value: `${message.author} (${message.author.tag})`, inline: true }, { name: 'Channel', value: `${message.channel}`, inline: true }, { name: 'Matched', value: `${match.label}${isGlobal ? ' *(global)*' : ''}`, inline: true }, ...(timedOut ? [{ name: 'Timeout', value: timeoutDisplay, inline: true }] : []), { name: 'Message Deleted', value: wasDeleted ? 'Yes' : shouldDelete ? 'No (missing ManageMessages)' : 'No', inline: true }, { name: 'Match Distance', value: matchDistance === 0 ? 'Exact' : `${matchDistance} bit${matchDistance !== 1 ? 's' : ''} different`, inline: true }, { name: 'Match Type', value: matchedVia === 'full image' ? 'Full image' : 'Cropped region', inline: true })] }).catch(() => {});
            if (matchDistance > 0 || matchedVia === 'cropped region') {
                const incomingDim = await getImageDimensions(buffer);
                const incomingRatio = incomingDim ? (incomingDim.width / incomingDim.height).toFixed(3) : 'unknown';
                const dimsField = incomingDim ? `${incomingDim.width}×${incomingDim.height} (ratio ${incomingRatio})` : 'unknown';
                const pendingId = `${message.id}_${att.id}`;
                pendingNearMatches.set(pendingId, { hash: imgHash, label: match.label, attUrl: att.url, dims: incomingDim });
                setTimeout(() => pendingNearMatches.delete(pendingId), 30 * 60 * 1000); // 30 min
                const reviewEmbed = E2('#ff9900','⚠️ Near-Match — Please Review')
                    .setDescription(`This image was **similar but not identical** to the registered scam hash for **${match.label}**${matchedVia === 'cropped region' ? ' (matched via a cropped sub-region, not the full image)' : ''}.\nIf this is a false positive, use \`/scam list\` to remove it or adjust the threshold with \`/scam config threshold\`.\nIf it's a cropped/edited variant of a real scam, use the buttons below to register this exact image as a new hash.`)
                    .setImage(att.url)
                    .addFields(
                        { name: 'Similarity', value: `${matchDistance} bit${matchDistance !== 1 ? 's' : ''} different (threshold: ${isGlobal ? 10 : spc.threshold})`, inline: true },
                        { name: 'Dimensions', value: dimsField, inline: true },
                        { name: 'Match Type', value: matchedVia === 'full image' ? 'Full image' : 'Cropped region', inline: true }
                    );
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`nearmatch_addserver_${pendingId}`).setLabel('Add to Server Scams').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`nearmatch_addglobal_${pendingId}`).setLabel('Add to Global Scams').setStyle(ButtonStyle.Danger)
                );
                await logCh.send({ embeds: [reviewEmbed], components: [row] }).catch(() => {});
            }
        }
        addHistory(guildId, message.author.id, { guildId, userId: message.author.id, userTag: message.author.tag, type: 'scam_remove', reason: `Scam: ${match.label}`, issuedBy: client.user.tag, issuedAt: Date.now() });
        break;
    }
});

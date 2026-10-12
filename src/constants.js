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


// Permissions requested by the invite link (used by /invite and the landing page).
const INVITE_PERMISSIONS = PermissionFlagsBits.ManageRoles | PermissionFlagsBits.KickMembers | PermissionFlagsBits.BanMembers | PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.ViewAuditLog | PermissionFlagsBits.ManageMessages;

module.exports = { INVITE_PERMISSIONS, MAX_SCAM_IMAGE_BYTES, MAX_SCAM_IMAGE_PIXELS, MAX_TIMEOUT_MS, OWNER_ID, SUPPORT_SERVER_URL };

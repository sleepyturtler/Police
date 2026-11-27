// The two images the site serves. The banner is a file next to this one (src/web/banner.jpg); the icon is the logo
// that is already embedded in logo.js, decoded once, so there is no second copy of it to keep in step.
const fs = require('fs');
const path = require('path');
const { LOGO_URI } = require('./logo');

let banner = null;
try { banner = fs.readFileSync(path.join(__dirname, 'banner.jpg')); } catch { console.warn('web: src/web/banner.jpg not found, the site will show no banner'); }
const icon = Buffer.from(LOGO_URI.split(',')[1], 'base64');

// Size of banner.jpg, used for the width and height attributes so the page does not jump while it loads.
const BANNER_SIZE = { width: 1600, height: 654 };

const ASSETS = {
    '/banner.jpg': banner && { type: 'image/jpeg', body: banner },
    '/icon.png': { type: 'image/png', body: icon },
    '/favicon.ico': { type: 'image/png', body: icon },
};

module.exports = { ASSETS, BANNER_SIZE, hasBanner: !!banner };

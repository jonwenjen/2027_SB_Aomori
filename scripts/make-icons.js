// Render the app icons from one SVG so they are reproducible, not hand-made.
//   node scripts/make-icons.js
// Writes icons/icon-192.png, icons/icon-512.png, icons/apple-touch-icon.png.
//
// Gold snowflake on the Midnight ink. The mark sits well inside the central
// 80% circle, so the same art works as a maskable icon on Android.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'icons');
const GOLD = '#C9AB76';
const INK = '#0B0B0D';

function arm(angle) {
  // one arm with two pairs of side branches, drawn pointing up then rotated
  return '<g transform="rotate(' + angle + ' 256 256)">' +
    '<line x1="256" y1="256" x2="256" y2="118"/>' +
    '<polyline points="228,168 256,146 284,168"/>' +
    '<polyline points="238,204 256,190 274,204"/>' +
    '</g>';
}

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
  '<rect width="512" height="512" fill="' + INK + '"/>' +
  '<circle cx="256" cy="256" r="176" fill="none" stroke="' + GOLD + '" stroke-opacity=".35" stroke-width="3"/>' +
  '<g fill="none" stroke="' + GOLD + '" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">' +
  [0, 60, 120, 180, 240, 300].map(arm).join('') +
  '</g>' +
  '<circle cx="256" cy="256" r="12" fill="' + GOLD + '"/>' +
  '</svg>';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const [name, size] of [['icon-512', 512], ['icon-192', 192], ['apple-touch-icon', 180]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent('<html><body style="margin:0;background:' + INK + '">' +
      SVG.replace('<svg ', '<svg width="' + size + '" height="' + size + '" ') + '</body></html>');
    await page.screenshot({ path: path.join(OUT, name + '.png'), omitBackground: false });
    await page.close();
    console.log('wrote icons/' + name + '.png (' + size + 'x' + size + ')');
  }
  fs.writeFileSync(path.join(OUT, 'icon.svg'), SVG + '\n');
  console.log('wrote icons/icon.svg');
  await browser.close();
})();

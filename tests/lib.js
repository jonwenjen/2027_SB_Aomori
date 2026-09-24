// Shared plumbing for the browser suites.
//
// Every suite is a plain node script that prints PASS/FAIL lines and exits
// non-zero on any failure; tests/run.js runs them all. Nothing here knows
// about the machine it runs on -- the few things that differ between a dev
// sandbox and CI come in through environment variables:
//
//   TARGET            page to test (default: file:// URL of the built index.html)
//   CHROMIUM_PATH     use this Chromium binary instead of Playwright's own
//   FONT_FIXTURE_DIR  serve Google Fonts from a local copy (for sandboxes
//                     whose browser cannot reach fonts.googleapis.com)
//   SCREENSHOT_DIR    also write screenshots here

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SHIPPED = path.join(ROOT, 'index.html');
const TARGET = process.env.TARGET || 'file://' + SHIPPED;

function launch() {
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
}

// Google Fonts: real network by default; a local copy when asked.
async function routeFonts(ctx) {
  const dir = process.env.FONT_FIXTURE_DIR;
  if (!dir) return;
  const css = fs.readFileSync(path.join(dir, 'bodoni.css'), 'utf8');
  await ctx.route('https://fonts.googleapis.com/**', r =>
    r.fulfill({ status: 200, contentType: 'text/css', body: css }));
  await ctx.route('https://fonts.gstatic.com/**', r => {
    const f = path.join(dir, path.basename(new URL(r.request().url()).pathname));
    return fs.existsSync(f)
      ? r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(f) })
      : r.abort();
  });
}

// A real, decodable PNG built at runtime, so map panels can be driven into
// their success state without any network or checked-in binary.
function makePng(w, h) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = buf => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const v = Math.round(30 + 90 * x / w + 60 * y / h);
      row[1 + x * 3] = v; row[2 + x * 3] = v + 8; row[3 + x * 3] = v + 18;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const MAP_PNG = makePng(320, 150);

async function shot(page, name, opts) {
  const dir = process.env.SCREENSHOT_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot(Object.assign({ path: path.join(dir, name + '.png') }, opts || {}));
}

function suite(title) {
  const results = [];
  return {
    check(name, pass, detail) {
      results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
    },
    finish() {
      let bad = 0;
      for (const r of results) {
        if (!r.pass) bad++;
        console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail ? '   [' + r.detail + ']' : ''));
      }
      console.log('\n' + (results.length - bad) + '/' + results.length + ' ' + title + ' checks passed');
      process.exit(bad ? 1 : 0);
    },
  };
}

module.exports = { ROOT, SHIPPED, TARGET, launch, routeFonts, MAP_PNG, shot, suite };

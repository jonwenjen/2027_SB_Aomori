// Offline: the page must open with no signal once it has been visited.
// Service workers need a real origin, so this suite serves the repo over
// http://127.0.0.1 itself (file:// has no service workers).
const fs = require('fs');
const http = require('http');
const path = require('path');
const lib = require('./lib');
const t = lib.suite('offline');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css',
};

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(lib.ROOT, p);
      if (!file.startsWith(lib.ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const b = await lib.launch();
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ daily_units: {}, daily: { time: ['2027-02-11'], snowfall_sum: [1],
      temperature_2m_max: [0], temperature_2m_min: [-5], wind_gusts_10m_max: [10] } }),
  }));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));

  // ── install ───────────────────────────────────────────────────────
  await p.goto(base, { waitUntil: 'load' });
  // `ready` never settles if nothing registers, so it is raced against a
  // deadline: a broken worker must fail this suite, not hang the CI job.
  const controlled = await p.evaluate(async () => {
    const ready = await Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise(r => setTimeout(() => r(false), 6000)),
    ]);
    if (!ready) return false;
    for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    return !!navigator.serviceWorker.controller;
  });
  t.check('service worker installs and takes control', controlled);
  if (!controlled) {
    // nothing below can mean anything without a worker; report and stop
    await b.close(); server.close(); t.finish();
    return;
  }

  const cacheNames = await p.evaluate(() => caches.keys());
  const pageCache = cacheNames.find(n => n.startsWith('page-'));
  t.check('page cache is versioned by build hash', /^page-[0-9a-f]{12}$/.test(pageCache || ''), cacheNames.join(','));
  const shippedSw = fs.readFileSync(path.join(lib.ROOT, 'sw.js'), 'utf8');
  t.check('cache name matches the shipped sw.js', !!pageCache && shippedSw.includes(pageCache.slice(5)));

  // ── manifest ──────────────────────────────────────────────────────
  const man = await p.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]').href;
    const m = await (await fetch(href)).json();
    const icons = await Promise.all(m.icons.map(async i => {
      const r = await fetch(new URL(i.src, href));
      return { src: i.src, ok: r.ok, type: r.headers.get('content-type') };
    }));
    return { name: m.name, display: m.display, start: m.start_url, icons };
  });
  t.check('manifest is linked and parses', !!man.name, man.name);
  t.check('manifest installs standalone', man.display === 'standalone');
  t.check('manifest icons resolve as PNG', man.icons.length >= 2 && man.icons.every(i => i.ok && /png/.test(i.type)),
    JSON.stringify(man.icons));

  // live forecast must never be cached
  await p.locator('#venue-hakkoda .venue-head').click();
  await p.waitForTimeout(800);
  const meteoCached = await p.evaluate(async () => {
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      if ((await c.keys()).some(r => r.url.includes('open-meteo'))) return true;
    }
    return false;
  });
  t.check('Open-Meteo responses are never cached', meteoCached === false);

  // ── offline ───────────────────────────────────────────────────────
  await ctx.setOffline(true);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(700);
  t.check('page opens offline', await p.locator('.day-card').count() === 16, await p.locator('.day-card').count());
  t.check('emergency numbers are there offline', await p.locator('#emergency a.tel-row').count() === 13);
  t.check('offline banner is shown', await p.locator('#offline-bar').isVisible());

  await p.goto(base + '?today=2027-02-13', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  t.check('today view works offline with a query string',
    /第 5 \/ 16 天/.test(await p.locator('#today').innerText()));

  await p.locator('.cl-group[data-group="booking"] .cl-group-head').click();
  await p.locator('#bk-flight').check();
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(600);
  t.check('checklist still saves offline', await p.locator('#bk-flight').isChecked());

  await ctx.setOffline(false);
  await p.waitForTimeout(300);
  t.check('banner clears when the signal returns', await p.locator('#offline-bar').isHidden());

  // a file:// copy must keep working without a service worker
  const fp = await ctx.newPage();
  await fp.goto('file://' + lib.SHIPPED, { waitUntil: 'load' });
  await fp.waitForTimeout(500);
  t.check('file:// copy still renders (no service worker there)',
    await fp.locator('.day-card').count() === 16);

  t.check('no JS errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  server.close();
  t.finish();
})();

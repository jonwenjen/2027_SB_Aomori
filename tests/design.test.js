// Design system: theme default/toggle/persistence, typeface, contrast, layout.
const lib = require('./lib');

const FILE = lib.TARGET;

async function prep(ctx) {
  await lib.routeFonts(ctx);
  await ctx.route(url => /\.(jpg|jpeg|png|webp)/i.test(url.pathname), r => {
    if (r.request().url().startsWith('file:')) return r.continue();
    r.fulfill({ status: 200, contentType: 'image/png', body: lib.MAP_PNG });
  });
}

(async () => {
  const browser = await lib.launch();
  const results = [];
  const check = (n, p, d) => results.push({ n, p, d: d === undefined ? '' : String(d) });

  // ── desktop, dark ───────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await prep(ctx);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(FILE, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(900);

  check('default theme is dark', await p.evaluate(() => document.documentElement.dataset.theme) === 'dark');
  const fontUsed = await p.evaluate(() => {
    const h = document.querySelector('h1.hero-title');
    return getComputedStyle(h).fontFamily.split(',')[0].replace(/['"]/g, '');
  });
  check('display font resolves to Bodoni Moda', fontUsed === 'Bodoni Moda', fontUsed);
  const bodoniLoaded = await p.evaluate(() => document.fonts.check('400 3rem "Bodoni Moda"'));
  check('Bodoni Moda actually loaded', bodoniLoaded, bodoniLoaded);

  await lib.shot(p, 'd-hero-dark');

  const measure = () => ({
    sample: (() => {
      function lum(c) {
        const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => {
          v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      function ratio(fg, bg) {
        const a = lum(fg), b = lum(bg);
        return ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
      }
      const bg = getComputedStyle(document.body).backgroundColor;
      const q = s => document.querySelector(s);
      const out = {};
      out.bodyText = ratio(getComputedStyle(q('.rec-desc') || document.body).color, bg).toFixed(2);
      out.heroLede = ratio(getComputedStyle(q('.hero-lede')).color, bg).toFixed(2);
      out.dayDate = ratio(getComputedStyle(q('.day-date')).color, bg).toFixed(2);
      const statBg = getComputedStyle(q('.stat')).backgroundColor;
      out.statLabel = ratio(getComputedStyle(q('.stat-label')).color, statBg).toFixed(2);
      out.statValue = ratio(getComputedStyle(q('.stat-value')).color, statBg).toFixed(2);
      out.navBtn = ratio(getComputedStyle(q('.nav-btn')).color, bg).toFixed(2);
      return out;
    })()
  });

  await p.locator('#venue-hakkoda').scrollIntoViewIfNeeded().catch(() => {});
  await p.locator('#venue-hakkoda .venue-head').click();
  await p.waitForTimeout(900);

  // stacked text must actually stack: a span styled like a block but left
  // inline silently runs the label, value and sub-line together on one line
  const stacked = await p.evaluate(() => {
    const groups = [
      ['.stat', ['.stat-label', '.stat-value', '.stat-sub']],
      ['.venue-head-main', ['.venue-kind', '.venue-name', '.venue-name-sub', '.venue-days']]
    ];
    const bad = [];
    groups.forEach(([parentSel, childSels]) => {
      document.querySelectorAll(parentSel).forEach(parent => {
        // collapsed cards are display:none, so every rect is 0 — skip them
        const pr = parent.getBoundingClientRect();
        if (pr.width === 0 || pr.height === 0) return;
        const tops = [];
        childSels.forEach(cs => {
          const n = parent.querySelector(cs);
          if (!n) return;
          const r = n.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;
          tops.push([cs, Math.round(r.top)]);
        });
        for (let i = 1; i < tops.length; i++) {
          if (tops[i][1] <= tops[i - 1][1]) bad.push(parentSel + ' ' + tops[i][0] + ' shares a line');
        }
      });
    });
    return [...new Set(bad)];
  });
  check('stat + venue-head lines stack vertically', stacked.length === 0, stacked.slice(0, 4).join(' | '));

  const darkC = (await p.evaluate(measure)).sample;
  Object.keys(darkC).forEach(k => {
    check('dark: ' + k + ' >= 4.5:1', parseFloat(darkC[k]) >= 4.5, darkC[k]);
  });
  await p.locator('#venue-hakkoda .venue-head').click();
  await p.waitForTimeout(300);

  await p.locator('#venues').scrollIntoViewIfNeeded();
  await p.waitForTimeout(500);
  await p.locator('#venue-hakkoda .venue-head').click();
  await p.waitForTimeout(1400);
  await p.locator('#venue-hakkoda').scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  const mapImgs = await p.locator('#venue-hakkoda .map-frame img').count();
  check('map renders in-card when the host is reachable', mapImgs === 1, 'imgs=' + mapImgs);
  await lib.shot(p, 'd-venue-dark');

  await p.locator('#day-5').scrollIntoViewIfNeeded();
  await p.waitForTimeout(600);
  await lib.shot(p, 'd-day-dark');

  // ── theme toggle + persistence ──────────────────────────────────
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(400);
  await p.locator('#theme-toggle').click();
  await p.waitForTimeout(700);
  check('toggle switches to light', await p.evaluate(() => document.documentElement.dataset.theme) === 'light');
  // innerText reflects text-transform:uppercase, so compare case-insensitively
  const themeLabel = await p.locator('#theme-label').innerText();
  check('toggle label updates', themeLabel.toLowerCase() === 'bone', themeLabel);
  const storedTheme = await p.evaluate(() => localStorage.getItem('sb2027.theme.v1'));
  check('theme stored in localStorage', storedTheme === 'light', storedTheme);
  const metaLight = await p.getAttribute('meta[name="theme-color"]', 'content');
  check('theme-color meta updates', metaLight === '#F4F1EA', metaLight);

  await lib.shot(p, 'd-hero-light');

  await p.reload({ waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  check('light theme persists after reload',
        await p.evaluate(() => document.documentElement.dataset.theme) === 'light');

  await p.locator('#venues').scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  await p.locator('#venue-okunakayama .venue-head').click();
  await p.waitForTimeout(1400);
  await p.locator('#venue-okunakayama').scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  await lib.shot(p, 'd-venue-light');

  // contrast sampling in light theme
  const contrast = await p.evaluate(() => {
    function lum(c) {
      const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => {
        v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    function ratio(fg, bg) {
      const a = lum(fg), b = lum(bg);
      return ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
    }
    const bg = getComputedStyle(document.body).backgroundColor;
    const body = getComputedStyle(document.querySelector('.rec-desc') || document.body).color;
    const gold = getComputedStyle(document.querySelector('.stat-label')).color;
    const val = getComputedStyle(document.querySelector('.stat-value')).color;
    const statBg = getComputedStyle(document.querySelector('.stat')).backgroundColor;
    return {
      bodyText: ratio(body, bg).toFixed(2),
      statLabel: ratio(gold, statBg).toFixed(2),
      statValue: ratio(val, statBg).toFixed(2)
    };
  });
  check('light: body text >= 4.5:1', parseFloat(contrast.bodyText) >= 4.5, contrast.bodyText);
  check('light: stat label >= 4.5:1', parseFloat(contrast.statLabel) >= 4.5, contrast.statLabel);
  check('light: stat value >= 4.5:1', parseFloat(contrast.statValue) >= 4.5, contrast.statValue);

  await ctx.close();

  // ── mobile, dark ────────────────────────────────────────────────
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await prep(m);
  const mp = await m.newPage();
  mp.on('pageerror', e => errs.push(e.message));
  await mp.goto(FILE, { waitUntil: 'load' });
  await mp.evaluate(() => document.fonts.ready);
  await mp.waitForTimeout(900);
  await lib.shot(mp, 'm-hero-dark');

  const ov = await mp.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('mobile: no horizontal overflow', ov <= 1, 'overflow=' + ov);

  await mp.locator('#venues').scrollIntoViewIfNeeded();
  await mp.waitForTimeout(400);
  await mp.locator('#venue-amihari .venue-head').click();
  await mp.waitForTimeout(1300);
  await mp.locator('#venue-amihari').scrollIntoViewIfNeeded();
  await mp.waitForTimeout(400);
  await lib.shot(mp, 'm-venue-dark');

  const tapTargets = await mp.evaluate(() => {
    const sel = ['.theme-toggle', '.venue-head', '.filter-btn', '.cl-group-head', '.venue-chip', '.lnk'];
    const small = [];
    sel.forEach(s => document.querySelectorAll(s).forEach(n => {
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.height < 30) small.push(s + ':' + Math.round(r.height));
    }));
    return small.slice(0, 6);
  });
  check('mobile: tap targets >= 30px tall', tapTargets.length === 0, tapTargets.join(' '));

  check('no JS errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();

  let bad = 0;
  results.forEach(r => { if (!r.p) bad++; console.log((r.p ? 'PASS  ' : 'FAIL  ') + r.n + (r.d ? '   [' + r.d + ']' : '')); });
  console.log('\n' + (results.length - bad) + '/' + results.length + ' design checks passed');
  process.exit(bad ? 1 : 0);
})();

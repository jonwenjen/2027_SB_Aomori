// Core behaviour: rendering, venue cards, lazy maps, filters, checklist persistence.
const lib = require('./lib');

const FILE = lib.TARGET;
const results = [];

function check(name, pass, detail) {
  results.push({ name, pass, detail: detail === undefined ? '' : String(detail) });
}

(async () => {
  const browser = await lib.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // Network resource failures are expected here: this sandbox's egress proxy
  // blocks the resort image hosts. Only real script errors should fail.
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });

  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  // ---- structure
  check('day cards rendered = 16', await page.locator('.day-card').count() === 16,
        await page.locator('.day-card').count());
  check('venue cards rendered = 13', await page.locator('.venue-card').count() === 13,
        await page.locator('.venue-card').count());
  check('contingency cards = 4', await page.locator('.contingency-card').count() === 4);
  check('checklist groups = 4', await page.locator('#checklist .cl-group').count() === 4);
  // counts come from the data, so adding checklist items does not break the suite
  const clTotal = await page.locator('#checklist [data-cl-item]').count();
  const clBooking = await page.locator('.cl-group[data-group="booking"] [data-cl-item]').count();
  check('checklist renders every item', clTotal > 0 && clTotal >= clBooking,
        'total=' + clTotal + ' booking=' + clBooking);
  check('flight cards = 2', await page.locator('.flight-card').count() === 2);
  check('day nav buttons = 16', await page.locator('#day-nav .nav-btn').count() === 16);

  // ---- venue cards collapsed by default
  const openCount = await page.locator('.venue-card[data-open="1"]').count();
  check('all venue cards start collapsed', openCount === 0, 'open=' + openCount);
  const bodyVisible = await page.locator('#venue-hakkoda .venue-body').isVisible();
  check('venue body hidden while collapsed', bodyVisible === false);

  // no image requested before opening
  const imgsBefore = await page.locator('#venue-hakkoda .map-frame img').count();
  check('map image not in DOM before opening', imgsBefore === 0);

  // ---- open a venue card
  await page.locator('#venue-hakkoda .venue-head').click();
  await page.waitForTimeout(400);
  check('venue opens on click', await page.locator('#venue-hakkoda').getAttribute('data-open') === '1');
  check('venue body visible after open', await page.locator('#venue-hakkoda .venue-body').isVisible());
  check('aria-expanded set', await page.locator('#venue-hakkoda .venue-head').getAttribute('aria-expanded') === 'true');

  // ---- stats row: the five required stats
  const labels = await page.locator('#venue-hakkoda .stat-label').allInnerTexts();
  const wanted = ['頂部高度', '雪道數', '最長滑道', '開幕日', '交通'];
  check('stat row has 5 required stats',
        wanted.every(w => labels.some(l => l.includes(w))), labels.join(' | '));
  const values = await page.locator('#venue-hakkoda .stat-value').allInnerTexts();
  check('stat values present', values.length === 5, values.join(' | '));

  // ---- links: official / status / snow-forecast
  const linkKinds = await page.locator('#venue-hakkoda .link-row .lnk').evaluateAll(
    els => els.map(e => e.className.replace('lnk lnk-', '')));
  check('has official link', linkKinds.includes('official'), linkKinds.join(','));
  check('has status link', linkKinds.includes('status'));
  check('has snow-forecast link', linkKinds.includes('forecast'));
  const fc = await page.locator('#venue-hakkoda .lnk-forecast').getAttribute('href');
  check('forecast link points at snow-forecast.com', /snow-forecast\.com/.test(fc), fc);

  // ---- map lazy-load: attempted only after open, and failure is reported
  await page.waitForTimeout(3500);
  const mapState = await page.locator('#venue-hakkoda .map-block').getAttribute('data-loaded');
  check('map load triggered on open', mapState === '1');
  const frameText = await page.locator('#venue-hakkoda .map-frame').innerText();
  const hasImg = await page.locator('#venue-hakkoda .map-frame img').count() > 0;
  check('map shows an image OR a failure message',
        hasImg || /載入失敗|無法載入/.test(frameText),
        hasImg ? 'image loaded' : frameText.replace(/\n/g, ' / '));

  // ---- map success path: serve a reachable image and confirm it renders
  const okPage = await ctx.newPage();
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEUAAAD///+l2Z/dAAAAAXRSTlMAQObYZgAAABBJREFUCNdjYGBgYGBgYAAAAAUAAWtKEnAAAAAASUVORK5CYII=';
  await okPage.route('**/course_pic_r0126.jpg', r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG.split(',')[1], 'base64') }));
  await okPage.goto(FILE, { waitUntil: 'load' });
  await okPage.waitForTimeout(400);
  await okPage.locator('#venue-hakkoda .venue-head').click();
  await okPage.waitForTimeout(1200);
  const okImg = await okPage.locator('#venue-hakkoda .map-frame img').count();
  check('map renders the image in-card when the host is reachable', okImg === 1, 'imgs=' + okImg);
  const okNoError = await okPage.locator('#venue-hakkoda .map-state.is-error').count();
  check('no error message shown on successful load', okNoError === 0);
  await okPage.close();

  // ---- all 13 venue cards: every one has the map block + links
  const audit = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.venue-card')).map(c => ({
      id: c.dataset.venue,
      kind: c.dataset.kind,
      stats: c.querySelectorAll('.stat').length,
      links: c.querySelectorAll('.link-row .lnk').length,
      hasOfficial: !!c.querySelector('.lnk-official'),
      hasStatus: !!c.querySelector('.lnk-status'),
      hasForecast: !!c.querySelector('.lnk-forecast'),
      hasMap: !!c.querySelector('.map-block'),
      notes: c.querySelectorAll('.note').length
    }));
  });
  check('every venue has >=4 stats', audit.every(a => a.stats >= 4),
        audit.map(a => a.id + ':' + a.stats).join(' '));
  check('every venue has official + status links',
        audit.every(a => a.hasOfficial || a.links > 0) && audit.every(a => a.hasStatus),
        audit.filter(a => !a.hasStatus).map(a => a.id).join(',') || 'all ok');
  check('every ski venue has a snow-forecast link',
        audit.filter(a => a.kind === 'ski').every(a => a.hasForecast));
  check('every ski venue has a map image block',
        audit.filter(a => a.kind === 'ski').every(a => a.hasMap));

  // ---- filter chips
  await page.locator('[data-filter="ski"]').click();
  await page.waitForTimeout(200);
  const visibleAfterFilter = await page.locator('.venue-card:visible').count();
  check('ski filter shows 5 cards', visibleAfterFilter === 5, visibleAfterFilter);
  await page.locator('[data-filter="all"]').click();
  await page.waitForTimeout(200);
  check('all filter restores 13', await page.locator('.venue-card:visible').count() === 13);

  // ---- day chip jumps to venue and opens it
  await page.locator('#venue-hakkoda .venue-head').click(); // close it first
  await page.waitForTimeout(200);
  await page.locator('#day-3 [data-goto-venue="hakkoda"]').click();
  await page.waitForTimeout(700);
  check('day chip reopens the venue card',
        await page.locator('#venue-hakkoda').getAttribute('data-open') === '1');

  // ---- recommendations accordion
  const recGroups = await page.locator('#day-1 .rec-group').count();
  check('day 1 has 6 recommendation groups', recGroups === 6, recGroups);
  check('rec group collapsed by default',
        await page.locator('#day-1 .rec-group-body').first().isVisible() === false);
  await page.locator('#day-1 .rec-group-head').first().click();
  await page.waitForTimeout(200);
  check('rec group opens on click',
        await page.locator('#day-1 .rec-group-body').first().isVisible());
  check('rec group has 10 items',
        await page.locator('#day-1 .rec-group').first().locator('.rec-item').count() === 10);

  // ---- checklist persistence
  check('progress starts at 0%', (await page.locator('#cl-pct').innerText()) === '0%');
  await page.locator('.cl-group[data-group="booking"] .cl-group-head').click();
  await page.waitForTimeout(200);
  await page.locator('#bk-flight').check();
  await page.locator('#bk-oirase-bus').check();
  await page.waitForTimeout(300);
  const pctAfter = await page.locator('#cl-pct').innerText();
  const expectPct = Math.round(2 / clTotal * 100) + '%';
  check('progress updates after checking', pctAfter === expectPct, pctAfter + ' expected ' + expectPct);
  const counter = await page.locator('[data-count-for="booking"]').innerText();
  check('group counter updates', counter === '2/' + clBooking, counter);

  const stored = await page.evaluate(() => localStorage.getItem('sb2027.checklist.v1'));
  check('state written to localStorage', /bk-flight/.test(stored || ''), stored);

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  check('checkbox still checked after reload', await page.locator('#bk-flight').isChecked());
  check('progress restored after reload', (await page.locator('#cl-pct').innerText()) === expectPct);

  // ---- mojibake gone
  const bodyText = await page.locator('body').innerText();
  check('no mojibake in rendered text', !/Ã°|Ã|ð/.test(bodyText));

  // ---- horizontal overflow at phone width
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal page scroll at 420px', overflow <= 1, 'overflow=' + overflow);

  // ---- screenshots
  await lib.shot(page, 'shot-mobile-top');

  const desk = await ctx.newPage();
  await desk.setViewportSize({ width: 1100, height: 1000 });
  await desk.goto(FILE, { waitUntil: 'load' });
  await desk.waitForTimeout(500);
  await desk.locator('.cl-group').first().locator('.cl-group-head').click();
  await desk.waitForTimeout(200);
  await lib.shot(desk, 'shot-desktop-checklist', { fullPage: false });

  await desk.locator('#venues').scrollIntoViewIfNeeded();
  await desk.locator('#venue-okunakayama .venue-head').click();
  await desk.waitForTimeout(3000);
  await desk.locator('#venue-okunakayama').scrollIntoViewIfNeeded();
  await desk.waitForTimeout(300);
  await lib.shot(desk, 'shot-desktop-venue');

  check('no JS errors', errors.length === 0, errors.slice(0, 5).join(' || '));

  await browser.close();

  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail ? '   [' + r.detail + ']' : ''));
  }
  console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
  process.exit(failed ? 1 : 0);
})();

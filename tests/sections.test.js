// Checks for the emergency card and the packing list.
const fs = require('fs');
const lib = require('./lib');

const FILE = lib.TARGET;

const results = [];
const check = (n, p, d) => results.push({ n, p, d: d === undefined ? '' : String(d) });

(async () => {
  const browser = await lib.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await lib.routeFonts(ctx);

  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForTimeout(900);

  // ── packing list ────────────────────────────────────────────────
  const pkGroups = await p.locator('#packing .cl-group').count();
  const pkItems = await p.locator('#packing [data-cl-item]').count();
  check('packing groups rendered', pkGroups === 6, pkGroups);
  check('packing items rendered', pkItems === 49, pkItems);
  check('packing ring starts at 0%', (await p.locator('#pk-pct').innerText()) === '0%');

  // the two lists must not share state
  await p.locator('#packing .cl-group').first().locator('.cl-group-head').click();
  await p.waitForTimeout(250);
  await p.locator('#pk-board').check();
  await p.waitForTimeout(300);
  const pkPct = await p.locator('#pk-pct').innerText();
  const clPct = await p.locator('#cl-pct').innerText();
  check('ticking a packing item moves the packing ring', pkPct !== '0%', pkPct);
  check('...and leaves the checklist ring alone', clPct === '0%', clPct);

  // Both keys exist from load (the component probes whether storage is
  // writable). What matters is that a packing tick lands only in the packing
  // key and leaves the checklist state empty.
  const stores = await p.evaluate(() => ({
    packing: localStorage.getItem('sb2027.packing.v1'),
    checklist: localStorage.getItem('sb2027.checklist.v1')
  }));
  check('packing tick lands in the packing key', /pk-board/.test(stores.packing || ''), stores.packing);
  check('...and the checklist store stays empty',
        (stores.checklist || '{}') === '{}', stores.checklist);

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(800);
  check('packing state survives reload', await p.locator('#pk-board').isChecked());

  // ── emergency: visible immediately, no animation gate ───────────
  // innerText reads fine at opacity:0, so assert computed opacity instead.
  const sosVisible = await p.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('#emergency .sos-block'));
    return {
      total: nodes.length,
      hidden: nodes.filter(n => parseFloat(getComputedStyle(n).opacity) < 0.99).length,
      riseInside: document.querySelectorAll('#emergency .rise').length
    };
  });
  check('every emergency block is opaque on load without scrolling',
        sosVisible.total > 0 && sosVisible.hidden === 0,
        'total=' + sosVisible.total + ' hidden=' + sosVisible.hidden);
  check('emergency section uses no reveal animation', sosVisible.riseInside === 0,
        'rise nodes=' + sosVisible.riseInside);

  // failsafe: nothing anywhere may stay invisible
  await p.waitForTimeout(4600);
  const stuck = await p.evaluate(() =>
    Array.from(document.querySelectorAll('.rise')).filter(n => !n.classList.contains('in')).length);
  check('failsafe reveals any remaining hidden block', stuck === 0, 'stuck=' + stuck);

  const telLinks = await p.locator('#emergency a.tel-row').count();
  check('emergency numbers render as tap-to-call', telLinks === 13, telLinks);

  const hrefs = await p.locator('#emergency a.tel-row').evaluateAll(
    els => els.map(e => e.getAttribute('href')));
  check('every tel: href is well formed',
        hrefs.every(h => /^tel:\+?[0-9]+$/.test(h)),
        hrefs.filter(h => !/^tel:\+?[0-9]+$/.test(h)).join(',') || 'all ok');
  check('110 and 119 are present and dialable',
        hrefs.includes('tel:110') && hrefs.includes('tel:119'), hrefs.slice(0, 3).join(' '));

  // the Taiwan 0800 line must NOT be tappable from Japan
  const noDial = await p.locator('#emergency .tel-row.no-dial').count();
  const noDialText = await p.locator('#emergency .tel-row.no-dial').innerText();
  check('undialable number rendered as plain text', noDial === 1, 'count=' + noDial);
  check('...and says why', /撥不通|代撥/.test(noDialText), noDialText.replace(/\n/g, ' / ').slice(0, 70));

  check('avalanche procedure has steps',
        await p.locator('#emergency .proc-steps li').count() >= 10,
        await p.locator('#emergency .proc-steps li').count());
  check('japanese phrases render', await p.locator('#emergency .phrase').count() === 11,
        await p.locator('#emergency .phrase').count());

  // ── personal fields: local only ──────────────────────────────────
  await p.locator('#pf-ins-policy').fill('TEST-POLICY-123');
  await p.locator('#pf-contact-tel').fill('+886912345678');
  await p.waitForTimeout(400);
  const callLink = await p.locator('[data-call-for="contact-tel"]').getAttribute('href');
  check('a phone field offers a tap-to-call link', callLink === 'tel:+886912345678', callLink);

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(800);
  check('personal fields survive reload',
        (await p.locator('#pf-ins-policy').inputValue()) === 'TEST-POLICY-123');

  const personalRaw = await p.evaluate(() => localStorage.getItem('sb2027.personal.v1'));
  check('personal data stays in localStorage only', /TEST-POLICY-123/.test(personalRaw || ''));
  // and must never have been baked into the shipped file
  const shipped = fs.readFileSync(lib.SHIPPED, 'utf8');
  check('no personal data in the published file', !/TEST-POLICY-123/.test(shipped));

  // ── layout ──────────────────────────────────────────────────────
  const ov = await p.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow at 390px', ov <= 1, 'overflow=' + ov);

  const smallTaps = await p.evaluate(() => {
    const bad = [];
    document.querySelectorAll('#emergency a.tel-row').forEach(n => {
      const r = n.getBoundingClientRect();
      if (r.height > 0 && r.height < 44) bad.push(Math.round(r.height));
    });
    return bad;
  });
  check('tel rows are >=44px tall (cold hands)', smallTaps.length === 0, smallTaps.join(','));

  await p.locator('#emergency').scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  await lib.shot(p, 'm-emergency');
  await p.locator('#packing').scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  await lib.shot(p, 'm-packing');

  const desk = await ctx.newPage();
  await desk.setViewportSize({ width: 1180, height: 1250 });
  await desk.goto(FILE, { waitUntil: 'load' });
  await desk.evaluate(() => document.fonts.ready);
  await desk.waitForTimeout(700);
  await desk.locator('#emergency').scrollIntoViewIfNeeded();
  await desk.waitForTimeout(400);
  await lib.shot(desk, 'd-emergency');

  check('no JS errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();

  let bad = 0;
  results.forEach(r => { if (!r.p) bad++; console.log((r.p ? 'PASS  ' : 'FAIL  ') + r.n + (r.d ? '   [' + r.d + ']' : '')); });
  console.log('\n' + (results.length - bad) + '/' + results.length + ' new-feature checks passed');
  process.exit(bad ? 1 : 0);
})();

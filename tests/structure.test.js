// Structure: lazy recommendation rendering, accessible accordions, transit
// step formatting, and a DOM budget so the 12k-node load cannot creep back.
const lib = require('./lib');
const t = lib.suite('structure');

(async () => {
  const b = await lib.launch();
  const p = await b.newPage({ viewport: { width: 420, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(lib.TARGET, { waitUntil: 'load' });
  await p.waitForTimeout(600);

  // ── DOM budget ────────────────────────────────────────────────────
  const nodes = await p.evaluate(() => document.getElementsByTagName('*').length);
  t.check('DOM at load stays under 4,000 nodes', nodes < 4000, 'nodes=' + nodes);
  t.check('no recommendation items built at load',
    await p.locator('.rec-item').count() === 0, await p.locator('.rec-item').count());

  // ── lazy fill ─────────────────────────────────────────────────────
  const g = p.locator('#day-3 .rec-group').first();
  await g.locator('.rec-group-head').click();
  await p.waitForTimeout(150);
  t.check('opening a group renders its 10 items', await g.locator('.rec-item').count() === 10,
    await g.locator('.rec-item').count());
  await g.locator('.rec-group-head').click();
  await p.waitForTimeout(100);
  await g.locator('.rec-group-head').click();
  await p.waitForTimeout(150);
  t.check('reopening does not render twice', await g.locator('.rec-item').count() === 10,
    await g.locator('.rec-item').count());
  t.check('only the opened group was built', await p.locator('.rec-item').count() === 10);
  const esc = await g.locator('.rec-item').first().innerHTML();
  t.check('lazily rendered items are escaped markup, not raw', !/<script/i.test(esc));

  // ── accordions announce their state ───────────────────────────────
  const head = p.locator('#day-3 .rec-group-head').first();
  t.check('open rec group reports aria-expanded=true', await head.getAttribute('aria-expanded') === 'true');
  const ctl = await head.getAttribute('aria-controls');
  t.check('aria-controls points at a real element', !!ctl && await p.locator('#' + ctl).count() === 1, ctl);

  const clHead = p.locator('#checklist .cl-group-head').first();
  t.check('checklist group starts aria-expanded=false', await clHead.getAttribute('aria-expanded') === 'false');
  await clHead.click();
  await p.waitForTimeout(100);
  t.check('checklist group flips to aria-expanded=true', await clHead.getAttribute('aria-expanded') === 'true');
  const clCtl = await clHead.getAttribute('aria-controls');
  t.check('checklist aria-controls resolves', !!clCtl && await p.locator('#' + clCtl).count() === 1, clCtl);
  t.check('no leftover non-standard open-state attributes',
    await p.locator('[open-state]').count() === 0);

  const ids = await p.evaluate(() =>
    Array.from(document.querySelectorAll('[aria-controls]')).map(n => n.getAttribute('aria-controls')));
  t.check('every aria-controls id is unique', new Set(ids).size === ids.length, ids.length + ' ids');

  // ── transit steps ─────────────────────────────────────────────────
  t.check('Day 4 marks its main line', await p.locator('#day-4 .transit-step.is-main .step-tag').count() >= 1);
  const tag = await p.locator('#day-4 .transit-step.is-main .step-tag').first().innerText();
  t.check('main-line tag drops the ★ and the brackets', !/[★【】]/.test(tag), tag);
  t.check('Day 4 marks fallbacks separately', await p.locator('#day-4 .transit-step.is-alt').count() >= 1);
  t.check('Day 3 marks the 酸ヶ湯 suggestion as a tip',
    await p.locator('#day-3 .transit-step.is-tip').count() === 1);
  t.check('unverified times are visually flagged',
    await p.locator('#day-6 .tbc, #day-10 .tbc, #day-14 .tbc').count() >= 3,
    await p.locator('#day-6 .tbc, #day-10 .tbc, #day-14 .tbc').count());
  t.check('warnings are styled as warnings', await p.locator('#day-4 .transit-step.is-warn').count() >= 1);

  t.check('no JS errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  t.finish();
})();

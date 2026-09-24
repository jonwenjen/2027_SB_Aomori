// Today view: the three date states, day boundaries, and the day-strip marker.
const lib = require('./lib');
const t = lib.suite('today-view');

(async () => {
  const b = await lib.launch();
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  const errs = [];

  async function open(q) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(lib.TARGET + (q || ''), { waitUntil: 'load' });
    await p.waitForTimeout(700);
    return p;
  }

  // before the trip (a date well ahead of 2027-02-09)
  let p = await open('?today=2026-10-01');
  t.check('panel visible before the trip', await p.locator('#today').isVisible());
  let txt = await p.locator('#today').innerText();
  t.check('shows a countdown', /Countdown/i.test(txt) && /天後出發/.test(txt), txt.split('\n').slice(0, 4).join(' / '));
  t.check('countdown is the right number of days', /\n131\n/.test('\n' + txt + '\n'), txt.split('\n').slice(0, 4).join(' / '));
  await p.close();

  // mid-trip
  p = await open('?today=2027-02-13');
  txt = await p.locator('#today').innerText();
  t.check('mid-trip shows TODAY', /Today/i.test(txt), txt.split('\n')[0]);
  t.check('mid-trip names the right day', /第 5 \/ 16 天/.test(txt), txt.split('\n').slice(0, 3).join(' / '));
  t.check('mid-trip shows the stay', /十和田荘/.test(txt));
  t.check('links to the full day card', await p.locator('#today a[href="#day-5"]').count() === 1);
  t.check('today is marked in the day strip',
    await p.locator('#day-nav a[href="#day-5"].is-today').count() === 1);
  await p.close();

  // boundaries
  p = await open('?today=2027-02-09');
  t.check('first day resolves to Day 1', /第 1 \/ 16 天/.test(await p.locator('#today').innerText()));
  await p.close();
  p = await open('?today=2027-02-24');
  t.check('last day resolves to Day 16', /第 16 \/ 16 天/.test(await p.locator('#today').innerText()));
  await p.close();

  // after
  p = await open('?today=2027-03-01');
  txt = await p.locator('#today').innerText();
  t.check('after the trip shows the wrap-up', /旅程已結束/.test(txt), txt.split('\n').slice(0, 3).join(' / '));
  await p.close();

  // on Day 1 the today card itself should surface the salon
  p = await open('?today=2027-02-09');
  txt = await p.locator('#today').innerText();
  t.check('Day 1 today card mentions the salon', /剪染/.test(txt), txt.split('\n').slice(0, 4).join(' / '));
  await p.close();

  t.check('no JS errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  t.finish();
})();

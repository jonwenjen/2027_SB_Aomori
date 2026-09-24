// Open-Meteo is unreachable from this sandbox, so the live call is stubbed.
// That is a feature here: it lets every branch be exercised deterministically,
// including the gust threshold boundary and each failure mode.
const lib = require('./lib');

const BASE = lib.TARGET;
const API = 'https://api.open-meteo.com/**';
const results = [];
const check = (n, p, d) => results.push({ n, p, d: d === undefined ? '' : String(d) });

// 39 km/h and 40 km/h sit either side of the threshold on purpose
const PAYLOAD = {
  daily_units: { snowfall_sum: 'cm', wind_gusts_10m_max: 'km/h' },
  daily: {
    time: ['2027-02-13', '2027-02-14', '2027-02-15'],
    snowfall_sum: [12.4, 0, 3.6],
    temperature_2m_max: [-2.3, 0.4, -1.1],
    temperature_2m_min: [-8.7, -5.2, -6.9],
    wind_gusts_10m_max: [52.1, 39.4, 40.0]
  }
};

(async () => {
  const browser = await lib.launch();
  const errs = [];

  async function page(handler) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
    await ctx.route(API, handler);
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE, { waitUntil: 'load' });
    await p.waitForTimeout(700);
    return { p, ctx };
  }

  // ── happy path ──────────────────────────────────────────────────
  let captured = null;
  let { p, ctx } = await page(r => {
    captured = r.request().url();
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAYLOAD) });
  });

  check('no request before the card is opened', captured === null, String(captured));

  await p.locator('#venue-hakkoda .venue-head').click();
  await p.waitForTimeout(900);

  check('request fires on expand', !!captured);
  if (captured) {
    const u = new URL(captured);
    check('sends the four daily fields',
          (u.searchParams.get('daily') || '') ===
          'snowfall_sum,temperature_2m_max,temperature_2m_min,wind_gusts_10m_max',
          u.searchParams.get('daily'));
    check('asks for 3 days', u.searchParams.get('forecast_days') === '3');
    check('uses Asia/Tokyo', u.searchParams.get('timezone') === 'Asia/Tokyo');
    check('passes the summit elevation', u.searchParams.get('elevation') === '1324',
          u.searchParams.get('elevation'));
    check('pins units explicitly',
          u.searchParams.get('wind_speed_unit') === 'kmh' &&
          u.searchParams.get('temperature_unit') === 'celsius',
          u.searchParams.get('wind_speed_unit') + '/' + u.searchParams.get('temperature_unit'));
    check('coordinates match the data',
          u.searchParams.get('latitude') === '40.68093' && u.searchParams.get('longitude') === '140.83166',
          u.searchParams.get('latitude') + ',' + u.searchParams.get('longitude'));
  }

  const days = p.locator('#venue-hakkoda .fc-day');
  check('renders 3 day cells', await days.count() === 3, await days.count());

  const txt = await p.locator('#venue-hakkoda .fc-block').innerText();
  check('shows new snow in cm', /12\s*cm/.test(txt), txt.replace(/\n/g, ' / ').slice(0, 90));
  check('shows max/min temp', /-2°\s*\/\s*-9°|-2°\s*\/\s*-9/.test(txt) || /-2°/.test(txt));
  check('shows gust in km/h', /52\s*km\/h/.test(txt));

  // threshold: 52 and 40 windy, 39 not
  const windy = await p.locator('#venue-hakkoda .fc-day.is-windy').count();
  check('gusts >= 40 flagged, < 40 not (52,39,40 -> 2)', windy === 2, 'windy=' + windy);
  const flags = await p.locator('#venue-hakkoda .fc-flag').count();
  check('warning label shown on the windy days only', flags === 2, 'flags=' + flags);
  const flagText = await p.locator('#venue-hakkoda .fc-flag').first().innerText();
  check('warning says lifts may stop', /易停駛/.test(flagText), flagText);

  const foot = await p.locator('#venue-hakkoda .fc-foot').innerText();
  check('footer states the forecast elevation', /1324\s*m/.test(foot), foot.replace(/\n/g, ' / '));
  check('footer marks hakkoda as verified', /已查證/.test(foot));
  check('footer states the threshold', /40 km\/h/.test(foot));

  // estimated coordinates must say so
  await p.locator('#venue-amihari .venue-head').click();
  await p.waitForTimeout(800);
  const footEst = await p.locator('#venue-amihari .fc-foot').innerText();
  check('estimated coordinates are labelled as such', /估算值/.test(footEst), footEst.replace(/\n/g, ' / '));

  // cache: reopening must not refire
  const before = captured;
  captured = null;
  await p.locator('#venue-hakkoda .venue-head').click();
  await p.waitForTimeout(250);
  await p.locator('#venue-hakkoda .venue-head').click();
  await p.waitForTimeout(700);
  check('reopening does not refetch', captured === null, String(captured));
  check('data still shown after reopen', await p.locator('#venue-hakkoda .fc-day').count() === 3);
  await ctx.close();

  // ── non-ski venues have no forecast ─────────────────────────────
  ({ p, ctx } = await page(r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAYLOAD) })));
  await p.locator('#venue-warasse .venue-head').click();
  await p.waitForTimeout(600);
  check('museum card has no forecast panel',
        await p.locator('#venue-warasse .fc-block').count() === 0);
  const skiWith = await p.evaluate(() =>
    Array.from(document.querySelectorAll('.venue-card[data-kind="ski"]'))
      .filter(c => c.querySelector('.fc-block')).length);
  check('all 5 ski cards carry a forecast panel', skiWith === 5, skiWith);
  await ctx.close();

  // ── failure paths ───────────────────────────────────────────────
  ({ p, ctx } = await page(r => r.abort('failed')));
  await p.locator('#venue-hakkoda .venue-head').click();
  await p.waitForTimeout(1500);
  let state = await p.locator('#venue-hakkoda .fc-frame').innerText();
  check('network failure shows a message, not a blank panel', /讀取失敗/.test(state),
        state.replace(/\n/g, ' / ').slice(0, 80));
  check('failure offers Snow-Forecast as the fallback', /Snow-Forecast/.test(state));
  check('failure offers a retry button',
        await p.locator('#venue-hakkoda [data-fc-retry]').count() === 1);
  await ctx.close();

  ({ p, ctx } = await page(r => r.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' })));
  await p.locator('#venue-hakkoda .venue-head').click();
  await p.waitForTimeout(1500);
  state = await p.locator('#venue-hakkoda .fc-frame').innerText();
  check('HTTP 500 reported', /HTTP 500/.test(state), state.replace(/\n/g, ' / ').slice(0, 60));
  await ctx.close();

  // unexpected shape must degrade, not throw
  ({ p, ctx } = await page(r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"hello":"world"}' })));
  await p.locator('#venue-hakkoda .venue-head').click();
  await p.waitForTimeout(1200);
  state = await p.locator('#venue-hakkoda .fc-frame').innerText();
  check('unexpected payload shape handled', /格式非預期/.test(state), state.replace(/\n/g, ' / ').slice(0, 60));
  await ctx.close();

  // nulls in the arrays render as em dashes rather than NaN
  const holey = JSON.parse(JSON.stringify(PAYLOAD));
  holey.daily.snowfall_sum = [null, 5, null];
  holey.daily.wind_gusts_10m_max = [null, null, null];
  ({ p, ctx } = await page(r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(holey) })));
  await p.locator('#venue-hakkoda .venue-head').click();
  await p.waitForTimeout(900);
  const holeyTxt = await p.locator('#venue-hakkoda .fc-block').innerText();
  check('null values render as a dash, never NaN',
        /—/.test(holeyTxt) && !/NaN/.test(holeyTxt), holeyTxt.replace(/\n/g, ' / ').slice(0, 80));
  check('no windy flag when gusts are unknown',
        await p.locator('#venue-hakkoda .fc-day.is-windy').count() === 0);

  // retry after a failure succeeds
  await ctx.close();
  let failFirst = true;
  ({ p, ctx } = await page(r => {
    if (failFirst) { failFirst = false; return r.abort('failed'); }
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAYLOAD) });
  }));
  await p.locator('#venue-hakkoda .venue-head').click();
  await p.waitForTimeout(1400);
  await p.locator('#venue-hakkoda [data-fc-retry]').click();
  await p.waitForTimeout(1200);
  check('retry recovers after a failure',
        await p.locator('#venue-hakkoda .fc-day').count() === 3,
        await p.locator('#venue-hakkoda .fc-day').count());
  await ctx.close();

  check('no JS errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();

  let bad = 0;
  results.forEach(r => { if (!r.p) bad++; console.log((r.p ? 'PASS  ' : 'FAIL  ') + r.n + (r.d ? '   [' + r.d + ']' : '')); });
  console.log('\n' + (results.length - bad) + '/' + results.length + ' forecast checks passed');
  process.exit(bad ? 1 : 0);
})();

// Stay maps: one card per place we sleep, every recommendation of its days
// listed once and grouped by category, a Google map created only on open,
// and the My Maps import files the build writes.
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const t = lib.suite('maps');

const data = JSON.parse(fs.readFileSync(path.join(lib.ROOT, 'itinerary.json'), 'utf8'));
const CATS = ['restaurant', 'dessert_pastry', 'beverage', 'souvenir', 'specialty_shops', 'attractions'];

// what each stay card should hold: its days' picks, de-duplicated per category
function placesOf(stay) {
  const seen = new Map();
  for (const n of stay.days) {
    const recs = data.days[n - 1].recommendations || {};
    for (const c of CATS) for (const it of recs[c] || []) {
      const key = c + '|' + it.map_url;
      if (!seen.has(key)) seen.set(key, { cat: c, days: [] });
      if (!seen.get(key).days.includes(n)) seen.get(key).days.push(n);
    }
  }
  return [...seen.values()];
}

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ── import files (no browser needed) ──────────────────────────────────
const files = fs.readdirSync(path.join(lib.ROOT, 'maps')).filter(f => f.endsWith('.csv')).sort();
t.check('build writes 7 My Maps layer files', files.length === 7, files.join(', '));
const stayCsv = parseCsv(fs.readFileSync(path.join(lib.ROOT, 'maps', files[0]), 'utf8'));
t.check('first layer lists every stay', stayCsv.length - 1 === data.stays.length, stayCsv.length - 1);
let rowsOk = true; let csvRows = 0;
for (const f of files.slice(1)) {
  const rows = parseCsv(fs.readFileSync(path.join(lib.ROOT, 'maps', f), 'utf8'));
  const head = rows[0];
  const iName = head.indexOf('名稱'), iLoc = head.indexOf('地點');
  if (iName < 0 || iLoc < 0) rowsOk = false;
  for (const r of rows.slice(1)) {
    csvRows++;
    if (r.length !== head.length || !r[iName] || !r[iLoc]) rowsOk = false;
  }
}
t.check('every layer row has a name and a place to geocode', rowsOk);
const uniqueAll = new Set();
data.days.forEach(d => CATS.forEach(c => (d.recommendations?.[c] || []).forEach(it => uniqueAll.add(c + '|' + it.map_url))));
t.check('layers hold each recommended place exactly once', csvRows === uniqueAll.size, csvRows + ' vs ' + uniqueAll.size);

// ── page ──────────────────────────────────────────────────────────────
(async () => {
  const b = await lib.launch();
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  const embeds = [];
  const stub = r => { embeds.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/html', body: '<p>map</p>' }); };
  await ctx.route('https://maps.google.com/**', stub);
  await ctx.route('https://www.google.com/maps/**', stub);
  const errs = [];
  const open = async (url) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(url, { waitUntil: 'load' });
    await p.waitForTimeout(600);
    return p;
  };

  let p = await open(lib.TARGET);
  t.check('one card per stay', await p.locator('.stay-card').count() === data.stays.length,
    await p.locator('.stay-card').count());
  t.check('all stay cards start collapsed', await p.locator('.stay-card[data-open="1"]').count() === 0);
  t.check('no map iframe at load', await p.locator('.stay-map iframe').count() === 0);
  t.check('no stay list items at load', await p.locator('.stay-list .rec-item').count() === 0);
  t.check('nav links to the section', await p.locator('.navbar a[href="#stays"]').count() === 1);

  let countsOk = true; const countDetail = [];
  for (const st of data.stays) {
    const head = await p.locator('#stay-' + st.id + ' .venue-days').innerText();
    const want = placesOf(st).length;
    if (!head.includes(want + ' 個在地推薦')) { countsOk = false; countDetail.push(st.id + ':' + head); }
  }
  t.check('card headers count the de-duplicated picks', countsOk, countDetail.join(' | '));

  // open Aomori
  const aomori = data.stays.find(s => s.id === 'aomori');
  const ap = placesOf(aomori);
  await p.locator('#stay-aomori .venue-head').click();
  await p.waitForTimeout(300);
  t.check('opening reports aria-expanded=true',
    await p.locator('#stay-aomori .venue-head').getAttribute('aria-expanded') === 'true');
  t.check('opening lists every pick once', await p.locator('#stay-aomori .rec-item').count() === ap.length,
    await p.locator('#stay-aomori .rec-item').count() + ' vs ' + ap.length);
  t.check('picks are grouped into 6 categories', await p.locator('#stay-aomori .stay-cat').count() === 6);
  const src = await p.locator('#stay-aomori .stay-map iframe').getAttribute('src');
  t.check('opening creates exactly one Google map', await p.locator('.stay-map iframe').count() === 1);
  t.check('without a My Maps id the map shows the hotel',
    /^https:\/\/maps\.google\.com\/maps\?q=Hotel%20Route-Inn/.test(src) && /output=embed/.test(src), src);
  t.check('other cards stay unbuilt', await p.locator('.stay-list .rec-item').count() === ap.length);

  const multi = ap.find(x => x.days.length > 1);
  if (multi) {
    const tags = await p.locator('#stay-aomori .rec-days').allInnerTexts();
    t.check('a place picked on two days shows both days',
      tags.includes('Day ' + multi.days.sort((a, b) => a - b).join('・')), multi.days.join(','));
  }

  // category tabs
  const nRest = ap.filter(x => x.cat === 'restaurant').length;
  await p.locator('#stay-aomori [data-stay-cat="restaurant"]').click();
  await p.waitForTimeout(100);
  t.check('a category tab shows only that category',
    await p.locator('#stay-aomori .rec-item:visible').count() === nRest &&
    await p.locator('#stay-aomori .stay-cat:visible').count() === 1);
  t.check('the tab reports aria-pressed',
    await p.locator('#stay-aomori [data-stay-cat="restaurant"]').getAttribute('aria-pressed') === 'true');
  await p.locator('#stay-aomori [data-stay-cat="all"]').click();
  await p.waitForTimeout(100);
  t.check('全部 shows everything again', await p.locator('#stay-aomori .rec-item:visible').count() === ap.length);

  // day card → stay card
  await p.locator('#day-12 .stay-jump').click();
  await p.waitForTimeout(900);
  t.check('a day card opens its stay map', await p.locator('#stay-okunakayama').getAttribute('data-open') === '1');
  const top = await p.locator('#stay-okunakayama').evaluate(n => n.getBoundingClientRect().top);
  t.check('…and scrolls to it', top >= -5 && top < 300, top);
  t.check('every day card with a stay links to it',
    await p.locator('.day-card .stay-jump').count() === data.stays.reduce((n, s) => n + s.days.length, 0));

  // setup kit
  t.check('import guide is shown while no My Maps id is set', await p.locator('#stay-kit .stay-kit-box').count() === 1);
  const hrefs = await p.locator('#stay-kit a[download]').evaluateAll(as => as.map(a => a.getAttribute('href')));
  t.check('guide links all 7 layer files', hrefs.length === 7, hrefs.length);
  t.check('every guide link points at a real file',
    hrefs.every(h => fs.existsSync(path.join(lib.ROOT, decodeURIComponent(h)))), hrefs.join(' '));
  await p.close();

  // deep link + today view
  p = await open(lib.TARGET + '#stay-shinjuku');
  t.check('#stay- deep link opens the card', await p.locator('#stay-shinjuku').getAttribute('data-open') === '1');
  await p.close();
  p = await open(lib.TARGET + '?today=2027-02-18');
  const cta = p.locator('#today [data-goto-stay]');
  t.check('today view links to the current stay map', await cta.getAttribute('data-goto-stay') === 'okunakayama');
  await cta.click();
  await p.waitForTimeout(600);
  t.check('…and opens it', await p.locator('#stay-okunakayama').getAttribute('data-open') === '1');
  await p.close();

  // offline: say so instead of an iframe error page, recover on retry
  p = await open(lib.TARGET);
  await ctx.setOffline(true);
  await p.locator('#stay-towada .venue-head').click();
  await p.waitForTimeout(200);
  t.check('offline open says the map needs a signal',
    await p.locator('#stay-towada .stay-map .is-error').count() === 1 &&
    await p.locator('#stay-towada .stay-map iframe').count() === 0);
  t.check('offline open still lists the picks', await p.locator('#stay-towada .rec-item').count() > 0);
  await ctx.setOffline(false);
  await p.locator('#stay-towada [data-stay-map-retry]').click();
  await p.waitForTimeout(200);
  t.check('retry loads the map once back online', await p.locator('#stay-towada .stay-map iframe').count() === 1);
  await p.close();

  // with a My Maps id: categorised pins, centred on the stay
  const html = fs.readFileSync(lib.SHIPPED, 'utf8').replace('"my_maps_mid":""', '"my_maps_mid":"1AbCdEfGhIjKlMnOp"');
  p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.setContent(html, { waitUntil: 'load' });
  await p.waitForTimeout(500);
  await p.locator('#stay-amihari .venue-head').click();
  await p.waitForTimeout(200);
  const st = data.stays.find(s => s.id === 'amihari');
  const mySrc = await p.locator('#stay-amihari .stay-map iframe').getAttribute('src');
  t.check('with an id the map is the shared My Maps',
    mySrc === 'https://www.google.com/maps/d/embed?mid=1AbCdEfGhIjKlMnOp&ll=' + st.center.lat + ',' +
      st.center.lon + '&z=' + st.zoom, mySrc);
  t.check('…the open link goes to the My Maps viewer',
    /maps\/d\/viewer\?mid=1AbCdEfGhIjKlMnOp/.test(await p.locator('#stay-amihari .lnk-forecast').getAttribute('href')));
  t.check('…and the import guide is gone', await p.locator('#stay-kit').isHidden());
  await p.close();

  t.check('no JS errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  t.finish();
})();

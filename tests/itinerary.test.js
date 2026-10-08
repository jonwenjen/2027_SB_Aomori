// Itinerary content: the schedule decisions the page has to reflect.
// These guard specific trip facts, so a later edit that quietly reverts one
// (the salon back on Day 2, gear shipped twice, 八食中心 on a night it is
// closed, a bus that does not run in winter) fails loudly instead of shipping.
// Timetable facts were verified on 2026-10-08 against the 2025-26 winter
// bus timetables and the 2026-03-14 rail timetables.
const fs = require('fs');
const lib = require('./lib');
const t = lib.suite('itinerary');

const data = JSON.parse(fs.readFileSync(require('path').join(lib.ROOT, 'itinerary.json'), 'utf8'));
const day = n => data.days[n - 1];
const text = n => [day(n).day_title, day(n).transit.summary].concat(day(n).transit.details).join('\n');

// ── salon: decided on Day 1 ──────────────────────────────────────────
t.check('Day 1 books the salon at 16:30', /16:30/.test(text(1)) && /LOVINA 4F/.test(text(1)));
t.check('Day 1 carries a flight-delay fallback', /延誤/.test(text(1)) && /超過 1 小時/.test(text(1)));
t.check('Day 2 no longer schedules the salon as the plan', !/★ 剪染/.test(text(2)));
t.check('Day 2 rides the 09:25 bus (no 08時台 on weekdays)', /09:25/.test(text(2)) && !/08:30 青森市營/.test(text(2)));
t.check('Day 2 returns on the 17:05 last bus', /17:05/.test(text(2)) && !/17:50 市營巴士/.test(text(2)));
t.check('Day 2 night skiing names the taxi back', /夜滑/.test(text(2)) && /計程車/.test(text(2)));

// ── Day 3/4: Hakkoda's winter bus is はっこうだ号, last one down 15:03 ─
for (const n of [3, 4]) {
  t.check('Day ' + n + ' uses the winter はっこうだ号', /はっこうだ號/.test(text(n)));
  t.check('Day ' + n + ' leaves the ropeway on the 15:03 last bus', /15:03/.test(text(n)));
  t.check('Day ' + n + ' no longer plans a 16:45 bus', !/16:45 (末班 )?JR 巴士/.test(text(n)));
  t.check('Day ' + n + ' uses the ¥1,290 fare', /¥1,290/.test(text(n)) && !/¥1,200/.test(text(n)));
}
t.check('Day 3 酸ヶ湯 tip uses the 14:50 last bus from 酸ヶ湯', /14:50/.test(text(3)));

// ── Day 4: Aoimori to Hachinohe ──────────────────────────────────────
t.check('Day 4 main line is the 16:17 Aoimori train', /青森 16:17/.test(text(4)));
t.check('Day 4 keeps 18:15 as the Moya fallback', /18:15/.test(text(4)));
t.check('Day 4 uses the ¥2,700 Aoimori fare', /¥2,700/.test(text(4)) && !/¥2,320/.test(text(4)));
t.check('Day 4 says the one-day pass is weekends only', /ワンデーパス/.test(text(4)) && /不能用/.test(text(4)));
t.check('Day 4 warns the hotel needs a late-arrival notice', /通知飯店/.test(text(4)));
t.check('Day 4 dinner is みろく横丁', /みろく橫丁/.test(text(4)));
t.check('八食中心 is not planned on Day 4 (closes 18:00)', !day(4).venue_ids.includes('hasshoku-center'));

// ── Day 5/6: 冬のおいらせ号 runs once each way ──────────────────────
t.check('Day 5 rides the 13:20 冬のおいらせ号', /西口 13:20/.test(text(5)) && !/搭乘 09:35/.test(text(5)));
t.check('Day 5 counts the ¥300 seat reservation', /¥300/.test(text(5)));
t.check('八食中心 moved to Day 5 morning', day(5).venue_ids.includes('hasshoku-center') && /八食中心/.test(text(5)));
t.check('八食中心 is off Day 6', !day(6).venue_ids.includes('hasshoku-center'));
const hs = data.venues.find(v => v.id === 'hasshoku-center');
t.check('八食中心 venue points at Day 5 only', JSON.stringify(hs.days) === '[5]', JSON.stringify(hs.days));
t.check('2027-02-13 is not a Wednesday (八食 closed Wed)', new Date(Date.UTC(2027, 1, 13)).getUTCDay() !== 3);
t.check('Day 6 rides the 10:00 bus back', /10:00「冬のおいらせ号」/.test(text(6)));
t.check('Day 6 takes the 13:40 はやぶさ', /13:40/.test(text(6)));
t.check('Day 6 connects to the 14:45 休暇村 shuttle', /14:45/.test(text(6)) && !/14:30 休暇村/.test(text(6)));
t.check('the abolished 網張 bus is not offered as a fallback',
  [6, 10].every(n => !/15:30 岩手縣交通|14:30 岩手縣交通/.test(text(n))));

// ── Day 10: ski longer, Okunakayama around 17:15 ─────────────────────
t.check('Day 10 skis until 14:00', /14:00/.test(text(10)));
t.check('Day 10 takes the 16:18 IGR', /16:18 IGR/.test(text(10)) && !/16:00 IGR/.test(text(10)));
t.check('Day 10 uses the ¥1,240 IGR fare', /¥1,240/.test(text(10)));

// ── Day 13 / 14: gear ships once, Day 14 skis longer ─────────────────
const shipsOn = [13, 14].filter(n => /(今天寄|17:00 前在飯店櫃台辦理)/.test(text(n)));
t.check('ski gear ships on exactly one day (Day 13)', JSON.stringify(shipsOn) === '[13]', JSON.stringify(shipsOn));
t.check('Day 13 explains the 2/3-day Yamato rule', /出發前 2 天/.test(text(13)));
t.check('Day 14 uses rental gear on the main line', /租借雪具/.test(text(14)));
t.check('Day 14 warns against shipping on 2/22', /不建議今天下午才寄/.test(text(14)));
t.check('Day 14 takes the 14:14 IGR to 二戶', /14:14 IGR/.test(text(14)));
t.check('Day 14 rides the 15:19 はやぶさ (there is no 16時台)', /二戶 15:19/.test(text(14)) && /沒有 16 時台/.test(text(14)));
t.check('Day 14 offers the 17:19 train for a longer ski day', /17:19/.test(text(14)));

// ── Day 1, 15, 16: fares ─────────────────────────────────────────────
t.check('Day 1 airport bus fare is ¥980', /¥980/.test(text(1)) && !/¥860/.test(text(1)));
t.check('Day 15 bus leaves Busta at 07:05', /07:05/.test(text(15)));
t.check('Day 16 N\'EX 13:08 reaches the airport at 14:31 for ¥3,330', /14:31/.test(text(16)) && /¥3,330/.test(text(16)));

// ── checklist follows the schedule ───────────────────────────────────
const items = {};
data.predeparture_checklist.forEach(g => g.items.forEach(i => { items[i.id] = i; }));
for (const id of ['bk-late-checkin', 'bk-rental-day14', 'bk-taxi-day10', 'bk-okunakayama-shuttle',
                  'tt-ninohe-hayabusa', 'tt-hachinohe-hayabusa', 'tt-igr', 'tt-hakkoda-bus']) {
  t.check('checklist has ' + id, !!items[id]);
}
t.check('salon checklist item names Day 1', /Day 1/.test((items['bk-salon'] || {}).text || ''));

// ── unverified times are marked, never passed off as checked ─────────
const flagged = [1, 2, 3, 5, 6, 10, 14, 15].filter(n => /〔[^〕]+〕/.test(text(n)));
t.check('days with not-yet-published timetables carry a 〔…〕 marker', flagged.length === 8, JSON.stringify(flagged));
t.check('the transit check date is recorded', /2026-10-08/.test(data.data_notes.transit_check || ''));

// ── rendered page agrees with the data ───────────────────────────────
(async () => {
  const b = await lib.launch();
  const p = await b.newPage({ viewport: { width: 420, height: 900 } });
  await p.goto(lib.TARGET, { waitUntil: 'load' });
  await p.waitForTimeout(700);
  const hero = await p.locator('#hero-lede').innerText();
  t.check('hero counts ski days from the venues (11)', /11 個滑雪日/.test(hero), hero);
  const d4 = await p.locator('#day-4').innerText();
  t.check('Day 4 card renders the 16:17 plan', /16:17/.test(d4));
  await b.close();
  t.finish();
})();

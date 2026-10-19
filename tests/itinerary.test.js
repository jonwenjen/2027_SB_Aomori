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

// ── 2026-10-19 review: newly published 2026-27 facts ─────────────────
t.check('Day 3 says the Hakkoda bus is booked on WILLER (return needs none)',
  /WILLER/.test(text(3)) && /回程從纜車站／酸ヶ湯上車不用預約/.test(text(3)));
t.check('Day 3 offers 弘前城雪燈籠まつり after the 15:03 bus', /雪燈籠/.test(text(3)) && /16:45/.test(text(3)));
t.check('Day 5 names the 2027 Winter Story dates (2/6–2/14)', /2\/6–2\/14/.test(text(5)));
t.check('Day 5 offers 陸奥湊 breakfast on a Saturday', /陸奥湊/.test(text(5)) && /週六有開/.test(text(5)));
t.check('Day 9 is the Morioka half day on the free shuttle', /★ 盛岡城下町半日/.test(text(9)) && /16:45/.test(text(9)));
t.check('Day 8 no longer promises an 8-minute ¥1,600 taxi', !/08:38/.test(text(8)) && !/¥1,600/.test(text(8)));
t.check('Day 11 (Friday) no longer plans night skiing', !/18:00 再戰夜滑/.test(text(11)) && /週五沒有/.test(text(11)));
t.check('Day 11 offers えんぶり on the 12:12 IGR', /えんぶり/.test(text(11)) && /12:12/.test(text(11)));
t.check('Day 12 (Saturday) carries the night session', /夜滑/.test(text(12)));
t.check('2027-02-19 is a Friday and 2027-02-20 a Saturday',
  new Date(Date.UTC(2027, 1, 19)).getUTCDay() === 5 && new Date(Date.UTC(2027, 1, 20)).getUTCDay() === 6);
t.check('Day 14 starts at the weekday lift time 08:40', /08:40–12:45/.test(text(14)));
t.check('Day 15 puts T2 SHINJUKU in Nishi-Shinjuku', /西新宿 7-1-1/.test(text(15)) && !/歌舞伎町東寶大樓旁「T2/.test(text(15)));
t.check('Day 16 explains the tax-free refund system', /免稅手續端末/.test(text(16)) && /2026-11-01/.test(text(16)));
t.check('UA837 departs 17:50', data.flights[1].departure.time === '17:50' && /17:50 UA837/.test(text(16)));
// suggestions adopted into the plan on 2026-10-19 (all but luggage forwarding)
t.check('Day 3 evening is 弘前 as the plan, not a tip', /【★ 晚間・弘前城雪燈籠まつり/.test(text(3)));
t.check('Day 2 no longer carries a second 弘前 option', !/雪燈籠/.test(text(2)) && !day(2).venue_ids.includes('hirosaki-snow-lantern'));
t.check('Day 4 does not forward luggage', !/行李減量|宅急便把大行李/.test(text(4)));
t.check('Day 5 breakfast at 陸奥湊 is the plan', /【★ 早餐・陸奥湊/.test(text(5)));
t.check('Day 5 books the lakeshore ice-fall night tour', /【★ 冰瀑夜間導覽/.test(text(5)) && /frozen-oirase\.com/.test(text(5)) && /17:15/.test(text(5)));
t.check('Day 5 moves Towadaso dinner after the tour', /19:30 以後/.test(text(5)));
t.check('Day 5 reaches the festival in time for the 20:00 fireworks', /20:00 冬花火/.test(text(5)));
t.check('Day 11 えんぶり is the plan', /【★ 八戶えんぶり/.test(text(11)) && /【★ 回奧中山】/.test(text(11)));
t.check('Day 14 evening projection mapping is the plan', /【★ 晚間・東京都廳光雕投影】/.test(text(14)));
const vById = Object.fromEntries(data.venues.map(v => [v.id, v]));
for (const [id, n] of [['hirosaki-snow-lantern', 3], ['mutsuminato-market', 5], ['hachinohe-enburi', 11], ['morioka-city', 9]]) {
  t.check('venue ' + id + ' exists and is on Day ' + n,
    !!vById[id] && vById[id].days.includes(n) && day(n).venue_ids.includes(id));
}
t.check('the Oirase card links the ice-fall booking site first',
  vById['oirase'].links[0].url === 'https://frozen-oirase.com/');
t.check('十和田湖冬物語 card shows the 2027 dates',
  vById['towadako-winter'].stats.some(s => s.value === '2027/2/6–2/14'));
t.check('Okunakayama card says night skiing is weekends only',
  vById['okunakayama'].notes.some(n => /週六日/.test(n)));

// ── checklist follows the schedule ───────────────────────────────────
const items = {};
data.predeparture_checklist.forEach(g => g.items.forEach(i => { items[i.id] = i; }));
for (const id of ['bk-late-checkin', 'bk-rental-day14', 'bk-taxi-day10', 'bk-okunakayama-shuttle',
                  'tt-ninohe-hayabusa', 'tt-hachinohe-hayabusa', 'tt-igr', 'tt-hakkoda-bus',
                  'tt-hirosaki', 'tt-okunakayama-night', 'op-taxfree',
                  'bk-salon-verify', 'bk-enburi', 'bk-towadaso-dinner']) {
  t.check('checklist has ' + id, !!items[id]);
}
t.check('the luggage-forwarding item is gone', !items['bg-forward-day4']);
t.check('the ice-fall booking item links frozen-oirase.com',
  ((items['bk-icefall'] || {}).link || {}).url === 'https://frozen-oirase.com/');
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

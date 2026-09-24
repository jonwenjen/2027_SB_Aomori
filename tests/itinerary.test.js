// Itinerary content: the schedule decisions the page has to reflect.
// These guard specific trip facts, so a later edit that quietly reverts one
// (the salon back on Day 2, gear shipped twice, 八食中心 on a night it is
// closed) fails loudly instead of shipping.
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
t.check('Day 2 is a full ski day with night skiing', /夜滑/.test(text(2)) && /17:50/.test(text(2)));
t.check('Day 2 fallback still names the taxi constraint', /16:40/.test(text(2)) || /計程車/.test(text(2)));

// ── Day 4: ski late, hotel around 19:30–20:00 ────────────────────────
t.check('Day 4 skis to 16:30', /滑到 16:30/.test(text(4)));
t.check('Day 4 takes the 18:15 Aoimori train', /18:15/.test(text(4)));
t.check('Day 4 warns the hotel needs a late-arrival notice', /通知飯店/.test(text(4)));
t.check('Day 4 dinner is みろく横丁', /みろく橫丁/.test(text(4)));
t.check('八食中心 is not planned on Day 4 (closes 18:00)', !day(4).venue_ids.includes('hasshoku-center'));

// ── Day 6: 八食中心 lunch, still makes the 14:30 shuttle ─────────────
t.check('八食中心 moved to Day 6', day(6).venue_ids.includes('hasshoku-center') && /八食中心/.test(text(6)));
t.check('Day 6 still connects to the 14:30 休暇村 shuttle', /14:30/.test(text(6)));
t.check('Day 6 keeps the 15:30 bus as a safety net', /15:30/.test(text(6)));
const hs = data.venues.find(v => v.id === 'hasshoku-center');
t.check('八食中心 venue points at Day 6 only', JSON.stringify(hs.days) === '[6]', JSON.stringify(hs.days));
t.check('2027-02-14 is not a Wednesday (八食 closed Wed)', new Date(Date.UTC(2027, 1, 14)).getUTCDay() !== 3);

// ── Day 10: ski longer, Okunakayama around 17:00 ─────────────────────
t.check('Day 10 skis until 14:00', /14:00/.test(text(10)));
t.check('Day 10 arrives around 17:10', /17:10/.test(text(10)));
t.check('Day 10 takes the 16:00 IGR', /16:00 IGR/.test(text(10)));

// ── Day 13 / 14: gear ships once, Day 14 skis longer ─────────────────
const shipsOn = [13, 14].filter(n => /(今天寄|17:00 前在飯店櫃台辦理)/.test(text(n)));
t.check('ski gear ships on exactly one day (Day 13)', JSON.stringify(shipsOn) === '[13]', JSON.stringify(shipsOn));
t.check('Day 13 explains the 2/3-day Yamato rule', /出發前 2 天/.test(text(13)));
t.check('Day 14 uses rental gear on the main line', /租借雪具/.test(text(14)));
t.check('Day 14 warns against shipping on 2/22', /不建議今天下午才寄/.test(text(14)));
t.check('Day 14 reaches Shinjuku around 19:30', /19:30/.test(text(14)) && /新宿/.test(text(14)));
t.check('Day 14 rides a 16 時台 はやぶさ from 二戶', /16 時台/.test(text(14)));

// ── checklist follows the schedule ───────────────────────────────────
const items = {};
data.predeparture_checklist.forEach(g => g.items.forEach(i => { items[i.id] = i; }));
for (const id of ['bk-late-checkin', 'bk-rental-day14', 'bk-taxi-day10', 'bk-okunakayama-shuttle',
                  'tt-ninohe-hayabusa', 'tt-hachinohe-hayabusa', 'tt-igr']) {
  t.check('checklist has ' + id, !!items[id]);
}
t.check('salon checklist item names Day 1', /Day 1/.test((items['bk-salon'] || {}).text || ''));

// ── unverified times are marked, never passed off as checked ─────────
const flagged = [6, 10, 14].filter(n => /待確認|出發前確認|出發前以/.test(text(n)));
t.check('days with unverifiable times carry a 待確認 marker', flagged.length === 3, JSON.stringify(flagged));

// ── rendered page agrees with the data ───────────────────────────────
(async () => {
  const b = await lib.launch();
  const p = await b.newPage({ viewport: { width: 420, height: 900 } });
  await p.goto(lib.TARGET, { waitUntil: 'load' });
  await p.waitForTimeout(700);
  const hero = await p.locator('#hero-lede').innerText();
  t.check('hero counts ski days from the venues (11)', /11 個滑雪日/.test(hero), hero);
  const d4 = await p.locator('#day-4').innerText();
  t.check('Day 4 card renders the 18:15 plan', /18:15/.test(d4));
  await b.close();
  t.finish();
})();

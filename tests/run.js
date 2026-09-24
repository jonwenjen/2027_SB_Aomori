// Run every tests/*.test.js suite in its own process and report a total.
// Suites are independent scripts, so one crashing cannot mask another.
//
//   npm test                 all suites
//   npm test -- forecast     only suites whose name contains "forecast"

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const filter = process.argv[2] || '';
const suites = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.test.js') && f.includes(filter))
  .sort();

if (!suites.length) {
  console.error('no suites match "' + filter + '"');
  process.exit(1);
}

let failed = 0;
let passed = 0;
let checks = 0;
const summary = [];

// A suite that hangs must fail, not stall CI for hours.
const SUITE_TIMEOUT_MS = 180000;

for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s)],
    { encoding: 'utf8', env: process.env, timeout: SUITE_TIMEOUT_MS });
  let out = (r.stdout || '') + (r.stderr || '');
  if (r.error && r.error.code === 'ETIMEDOUT') {
    out += '\nFAIL  suite timed out after ' + SUITE_TIMEOUT_MS / 1000 + 's';
  }
  const tally = /(\d+)\/(\d+) .*checks passed/.exec(out);
  const ok = r.status === 0;
  if (tally) { passed += +tally[1]; checks += +tally[2]; }
  if (!ok) {
    failed++;
    // show only what went wrong, not every PASS line
    console.log('\n── ' + s + ' ──');
    console.log(out.split('\n').filter(l => /^FAIL|Error|at |^\s*\d+\/\d+/.test(l)).join('\n') || out);
  }
  summary.push((ok ? '  ✓ ' : '  ✗ ') + s.replace('.test.js', '').padEnd(12) +
    (tally ? tally[1] + '/' + tally[2] : 'crashed'));
}

console.log('\n' + summary.join('\n'));
console.log('\n' + passed + '/' + checks + ' checks across ' + suites.length + ' suites' +
  (failed ? ' — ' + failed + ' suite(s) failed' : ''));
process.exit(failed ? 1 : 0);

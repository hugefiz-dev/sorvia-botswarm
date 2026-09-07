'use strict';

/* Headless sanity check for the non-Electron logic (engine + versions).
 * Run with: npm run smoke
 */

const BotManager = require('./bot-manager');
const versions = require('./versions');

(async () => {
  let fail = 0;

  // 1) BotManager constructs and sanitizes/caps input.
  const events = [];
  const bm = new BotManager((e) => events.push(e));

  // over-limit values must be clamped
  const res = bm.start({
    host: '', // invalid on purpose
    count: 9999,
    durationMin: 999
  });
  if (res.ok || res.error !== 'no-host') {
    console.error('FAIL: empty host should be rejected'); fail++;
  } else {
    console.log('OK: empty host rejected');
  }

  // sanitize caps (access via internal for the test)
  const c = bm._sanitize({ host: 'localhost', count: 9999, durationMin: 999, joinDelay: -5 });
  if (c.count !== 100) { console.error('FAIL: bot cap', c.count); fail++; }
  else console.log('OK: bot count capped at 100');
  if (c.durationMin !== 30) { console.error('FAIL: duration cap', c.durationMin); fail++; }
  else console.log('OK: duration capped at 30 min');
  if (c.joinDelay !== 0) { console.error('FAIL: negative delay', c.joinDelay); fail++; }
  else console.log('OK: negative join delay clamped to 0');

  // 2) versions module returns a shape (may be local fallback offline).
  try {
    const v = await versions.getVersions();
    if (!v || !Array.isArray(v.supported)) { console.error('FAIL: versions shape'); fail++; }
    else console.log(`OK: versions source=${v.source}, count=${v.supported.length}, latest=${v.latest}`);
  } catch (err) {
    console.error('FAIL: versions threw', err.message); fail++;
  }

  console.log(fail === 0 ? '\nSMOKE PASSED' : `\nSMOKE FAILED (${fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();

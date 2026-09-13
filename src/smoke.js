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
  const c = bm._sanitize({ host: 'localhost', count: 9999, durationMin: 99999, joinDelay: -5 });
  if (c.count !== 1000) { console.error('FAIL: bot cap', c.count); fail++; }
  else console.log('OK: bot count capped at 1000');
  if (c.durationMin !== 1440) { console.error('FAIL: duration cap', c.durationMin); fail++; }
  else console.log('OK: duration capped at 1440 min (24 h)');
  if (c.joinDelay !== 0) { console.error('FAIL: negative delay', c.joinDelay); fail++; }
  else console.log('OK: negative join delay clamped to 0');

  // 1b) chat placeholders resolve against the bot's current position.
  const fakeBot = { entity: { position: { x: 12.9, y: 64, z: -7.2 } } };
  const line = bm._expandChat('at {coordinates} (x={x})', fakeBot);
  if (line !== 'at 12 64 -8 (x=12)') { console.error('FAIL: {coordinates} expansion ->', line); fail++; }
  else console.log('OK: {coordinates} expands to the live position');
  if (bm._expandChat('plain text', fakeBot) !== 'plain text') { console.error('FAIL: plain chat text altered'); fail++; }
  else console.log('OK: chat text without placeholders is untouched');
  if (bm._expandChat('{coords}', {}) !== '?') { console.error('FAIL: position-less bot'); fail++; }
  else console.log('OK: {coords} degrades to "?" before spawn');

  // 1c) movement stays inside the chunks the server actually sent.
  bm.config = { viewDistance: 8 };
  if (bm._loadedRadius() !== 112) { console.error('FAIL: loaded radius', bm._loadedRadius()); fail++; }
  else console.log('OK: roam/goto legs bounded by the loaded chunk radius');
  bm.config = null;

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

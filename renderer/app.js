'use strict';
(function () {

const api = window.api;
let lang = 'tr';
let settingsLoaded = false;
const T = (k) => (window.I18N[lang] && window.I18N[lang][k]) || k;
const $ = (id) => document.getElementById(id);

/* ------------------------------ theme ----------------------------------- */
const THEME_DEFAULT = { accent: '#ff7a18', bg: '#14100e', opacity: 72, winTransparency: 0, particles: true };
let theme = Object.assign({}, THEME_DEFAULT);
let particlesOn = true;
let particleRgb = { r: 255, g: 150, b: 40 }; // background canvas follows the accent
let fxAlpha = 1; // background effects fade out as the window turns to glass
let lastWinTransparency = null;
let winTransparencyWarned = false;

function hexToRgb(h) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(h || ''));
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 20, g: 16, b: 14 };
}
function lighten(hex, amt) {
  const c = hexToRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
  return `#${[f(c.r), f(c.g), f(c.b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
function applyTheme() {
  const root = document.documentElement.style;
  const a = theme.accent || THEME_DEFAULT.accent;
  const a2 = lighten(a, 30);
  const deep = lighten(a, -40);
  // Only the colour variables are set here — the gradients, the page
  // background and the glows are all derived from them in CSS, so a change
  // animates everywhere at once (see the @property block in styles.css).
  root.setProperty('--accent', a);
  root.setProperty('--accent2', a2);
  root.setProperty('--accent-deep', deep);
  const bg = hexToRgb(theme.bg || THEME_DEFAULT.bg);
  root.setProperty('--bg', theme.bg || THEME_DEFAULT.bg);
  root.setProperty('--bg-hi', lighten(theme.bg || THEME_DEFAULT.bg, 22));
  const op = Math.max(0.3, Math.min(1, (Number(theme.opacity) || 72) / 100));
  root.setProperty('--panel', `rgba(${bg.r},${bg.g},${bg.b},${op})`);
  const brd = hexToRgb(a);
  root.setProperty('--panel-brd', `rgba(${brd.r},${brd.g},${brd.b},0.16)`);
  // Text/icon colour that stays readable on top of the accent colour.
  const lum = (0.2126 * brd.r + 0.7152 * brd.g + 0.0722 * brd.b) / 255;
  root.setProperty('--on-accent', lum > 0.55 ? '#1a0f08' : '#ffffff');
  particleRgb = hexToRgb(a2);
  particlesOn = theme.particles !== false;
  applyWindowTransparency();
}
// Window transparency: the app's BACKGROUND becomes see-through (panels, text
// and buttons keep their own opacity), and the frosting grows with it — the
// page blurs its own backdrop, and the main process asks the OS to blur the
// desktop behind the window. Capped at 60 so the app never disappears.
function applyWindowTransparency() {
  const v = Math.max(0, Math.min(90, Number(theme.winTransparency) || 0));
  if (v === lastWinTransparency) return;
  lastWinTransparency = v;
  // The page only goes see-through once the main process confirms the OS will
  // frost what's behind the window. Otherwise the hole would show as a black
  // rectangle instead of the desktop, so the app stays solid and says why.
  Promise.resolve()
    .then(() => api.setWindowTransparency(v))
    .then((res) => {
      const applied = res && res.material === 'acrylic' ? v : 0;
      const root = document.documentElement.style;
      // The slider IS the percentage: at 90 the page keeps a tenth of its own
      // background and the rest is the frosted desktop behind the window.
      root.setProperty('--page-alpha', (1 - applied / 100).toFixed(3));
      root.setProperty('--page-blur', (applied * 0.25).toFixed(1) + 'px');
      root.setProperty('--panel-blur', (14 + applied * 0.35).toFixed(1) + 'px');
      // Glows and particles are painted ON the background; they'd sit in front
      // of the glass like smudges, so they fade out as it clears.
      root.setProperty('--fx-alpha', (1 - applied / 100).toFixed(3));
      fxAlpha = 1 - applied / 100;
      if (v > 0 && !applied && !winTransparencyWarned) {
        winTransparencyWarned = true;
        logLocal('warn', T('win_transparency_unsupported'));
      }
    })
    .catch(() => {});
}
function syncThemeControls() {
  if ($('tpAccent')) $('tpAccent').value = theme.accent;
  if ($('tpBg')) $('tpBg').value = theme.bg;
  if ($('tpOpacity')) $('tpOpacity').value = theme.opacity;
  if ($('tpWinTransparency')) $('tpWinTransparency').value = theme.winTransparency != null ? theme.winTransparency : 0;
  if ($('tpParticles')) $('tpParticles').checked = theme.particles !== false;
}
function wireTheme() {
  $('themeBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const p = $('themePanel'); p.hidden = !p.hidden; if (!p.hidden) syncThemeControls();
  });
  document.addEventListener('click', (e) => {
    const p = $('themePanel');
    if (!p.hidden && !p.contains(e.target) && e.target.id !== 'themeBtn') p.hidden = true;
  });
  $('tpPresets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-accent]'); if (!b) return;
    theme.accent = b.dataset.accent; applyTheme(); syncThemeControls(); persist();
  });
  $('tpAccent').addEventListener('input', () => { theme.accent = $('tpAccent').value; applyTheme(); persist(); });
  $('tpBg').addEventListener('input', () => { theme.bg = $('tpBg').value; applyTheme(); persist(); });
  $('tpOpacity').addEventListener('input', () => { theme.opacity = +$('tpOpacity').value; applyTheme(); persist(); });
  $('tpWinTransparency').addEventListener('input', () => { theme.winTransparency = +$('tpWinTransparency').value; applyTheme(); persist(); });
  $('tpParticles').addEventListener('change', () => { theme.particles = $('tpParticles').checked; applyTheme(); persist(); });
  $('tpReset').addEventListener('click', () => { theme = Object.assign({}, THEME_DEFAULT); applyTheme(); syncThemeControls(); persist(); });
}

/* ------------------------------ i18n apply ------------------------------ */
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.setAttribute('placeholder', T(el.getAttribute('data-i18n-ph'))); });
  document.querySelectorAll('.lang-switch button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
  renderScenarios();
  refreshStatusText();
}

/* --------------------------- window controls ---------------------------- */
$('winMin').onclick = () => api.winMinimize();
$('winMax').onclick = () => api.winMaximize();
$('winClose').onclick = () => api.winClose();

/* ------------------------------- tabs ----------------------------------- */
$('tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (!b) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b));
  const tab = b.dataset.tab;
  $('tab-test').hidden = tab !== 'test';
  $('tab-analysis').hidden = tab !== 'analysis';
  if (tab === 'analysis' && !$('aHost').value) { $('aHost').value = $('host').value; $('aPort').value = $('port').value; }
});

/* ------------------------------- meta ----------------------------------- */
(async () => {
  try { const m = await api.meta(); $('copyright').textContent = `© ${m.brand}`; } catch (_) {}
})();

/* ------------------------------ versions -------------------------------- */
function fillVersions(v, preferred) {
  const sel = $('version'); const hint = $('versionHint');
  if (!v || !Array.isArray(v.supported)) return;
  sel.innerHTML = '';
  const auto = document.createElement('option'); auto.value = ''; auto.textContent = T('ver_auto'); sel.appendChild(auto);
  v.supported.forEach((item) => {
    const o = document.createElement('option'); o.value = item.id; o.textContent = item.id; sel.appendChild(o);
  });
  if (preferred && v.supported.some((x) => x.id === preferred)) sel.value = preferred;
  else if (v.latest) sel.value = v.latest;
  const src = v.source === 'mojang' ? T('ver_source_mojang') : T('ver_source_local');
  hint.textContent = `${src} · ${T('ver_latest')}: ${v.latest || '?'} (${v.supported.length})`;
}
async function loadVersions(preferred) {
  const sel = $('version'); const hint = $('versionHint');
  if (!sel.querySelector('option[value]')) sel.innerHTML = `<option>${T('ver_loading')}</option>`;
  try {
    const v = await api.listVersions();
    fillVersions(v, preferred || sel.value);
    api.setSettings({ versionsCache: v }); // cache for instant startup next launch
    return v;
  } catch (err) {
    if (!sel.querySelector('option[value]')) { sel.innerHTML = '<option value="">-</option>'; hint.textContent = String(err.message || err); }
    return null;
  }
}
$('refreshVersions').onclick = () => loadVersions($('version').value);

/* ------------------------------ scenarios ------------------------------- */
const DEFAULTS = {
  wait: { type: 'wait', seconds: 5 }, chat: { type: 'chat', text: '' },
  roam: { type: 'roam', radius: 100, seconds: 30 }, jump: { type: 'jump', seconds: 3 }, look: { type: 'look', seconds: 5 },
  goto: { type: 'goto', x: 0, y: 64, z: 0 }, chestclick: { type: 'chestclick', slot: 0 },
  reconnect: { type: 'reconnect', seconds: 3 }
};
const ICONS = { wait: '⏱', chat: '💬', roam: '🧭', jump: '⤴', look: '👁', goto: '🎯', chestclick: '📦', reconnect: '🔌' };
let scenarios = [
  { type: 'wait', seconds: 5 }, { type: 'chat', text: '/spawn' }, { type: 'roam', radius: 100, seconds: 60 }
];
function stepName(t) { return { wait: T('s_wait'), chat: T('s_chat'), roam: T('s_roam'), jump: T('s_jump'), look: T('s_look'), goto: T('s_goto'), chestclick: T('s_chestclick'), reconnect: T('s_reconnect') }[t] || t; }

function numberField(labelKey, value, onInput, attrs = {}) {
  const wrap = document.createElement('label'); wrap.className = 'sf';
  const span = document.createElement('span'); span.textContent = T(labelKey);
  const inp = document.createElement('input'); inp.type = 'number'; inp.value = value;
  Object.entries(attrs).forEach(([k, v]) => inp.setAttribute(k, v));
  inp.addEventListener('input', () => { onInput(inp.value); persist(); });
  wrap.append(span, inp); return wrap;
}
function textField(labelKey, value, onInput) {
  const wrap = document.createElement('label'); wrap.className = 'sf grow';
  const span = document.createElement('span'); span.textContent = T(labelKey);
  const inp = document.createElement('input'); inp.type = 'text'; inp.value = value; inp.placeholder = T('chat_ph');
  inp.addEventListener('input', () => { onInput(inp.value); persist(); });
  wrap.append(span, inp); return wrap;
}
// A full-width note under a step's inputs (e.g. the chat placeholders).
function fieldHint(key) {
  const d = document.createElement('div'); d.className = 'sf-hint'; d.textContent = T(key); return d;
}
function renderScenarios() {
  const tree = $('scenarioTree'); if (!tree) return; tree.innerHTML = '';
  if (!scenarios.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = T('empty_scenarios'); tree.appendChild(e); return; }
  const tpl = $('tpl-step');
  scenarios.forEach((step, i) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.index = i;
    node.querySelector('.step-icon').textContent = ICONS[step.type] || '•';
    node.querySelector('.step-name').textContent = stepName(step.type);
    node.querySelector('.step-idx').textContent = `#${i + 1}`;
    if (i === scenarios.length - 1) node.classList.add('last');
    const fields = node.querySelector('.step-fields');
    if (step.type === 'wait') fields.append(numberField('f_seconds', step.seconds, (v) => (step.seconds = +v), { min: 0 }));
    else if (step.type === 'chat') fields.append(textField('f_text', step.text, (v) => (step.text = v)), fieldHint('chat_coords_hint'));
    else if (step.type === 'roam') fields.append(numberField('f_radius', step.radius, (v) => (step.radius = +v), { min: 1, max: 256 }), numberField('f_seconds', step.seconds, (v) => (step.seconds = +v), { min: 1 }));
    else if (step.type === 'jump' || step.type === 'look') fields.append(numberField('f_seconds', step.seconds, (v) => (step.seconds = +v), { min: 1 }));
    else if (step.type === 'goto') fields.append(numberField('f_x', step.x, (v) => (step.x = +v)), numberField('f_y', step.y, (v) => (step.y = +v)), numberField('f_z', step.z, (v) => (step.z = +v)));
    else if (step.type === 'chestclick') fields.append(numberField('f_slot', step.slot, (v) => (step.slot = +v), { min: 0 }));
    else if (step.type === 'reconnect') fields.append(numberField('f_rejoin_after', step.seconds, (v) => (step.seconds = +v), { min: 0 }));
    node.querySelector('.step-del').onclick = () => { scenarios.splice(i, 1); renderScenarios(); persist(); };
    node.addEventListener('dragstart', (e) => { node.classList.add('dragging'); e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; });
    node.addEventListener('dragend', () => node.classList.remove('dragging'));
    node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('drop-target'); });
    node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
    node.addEventListener('drop', (e) => {
      e.preventDefault(); node.classList.remove('drop-target');
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10); const to = i;
      if (isNaN(from) || from === to) return;
      const [m] = scenarios.splice(from, 1); scenarios.splice(to, 0, m); renderScenarios(); persist();
    });
    tree.appendChild(node);
  });
}
document.querySelector('.add-btns').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-add]'); if (!b) return;
  scenarios.push({ ...DEFAULTS[b.dataset.add] }); renderScenarios(); persist();
  const tree = $('scenarioTree'); tree.scrollTop = tree.scrollHeight;
});

/* --------------------------- console (batched) -------------------------- */
const consoleEl = $('console');
let logQueue = []; let rafPending = false;
function makeLine(it) {
  const line = document.createElement('div'); line.className = `cl cl-${it.level || 'info'}`;
  const time = new Date(it.ts || Date.now()).toLocaleTimeString();
  const who = it.bot ? `<span class="cl-bot">[${it.bot}]</span> ` : '';
  line.innerHTML = `<span class="cl-time">${time}</span> ${who}<span class="cl-msg"></span>`;
  line.querySelector('.cl-msg').textContent = it.msg;
  return line;
}
function queueLogs(items) {
  for (const it of items) logQueue.push(it);
  // A large swarm can out-produce the DOM. Keep the newest lines and say how
  // many were skipped, rather than letting the panel fall behind the test.
  if (logQueue.length > 600) {
    const dropped = logQueue.length - 600;
    logQueue = logQueue.slice(-600);
    logQueue.unshift({ level: 'warn', msg: `… ${dropped} ${T('log_skipped')}`, ts: Date.now() });
  }
  if (!rafPending) { rafPending = true; requestAnimationFrame(flushLogs); }
}
function flushLogs() {
  rafPending = false; if (!logQueue.length) return;
  const items = logQueue; logQueue = [];
  const frag = document.createDocumentFragment();
  for (const it of items) frag.appendChild(makeLine(it));
  consoleEl.appendChild(frag);
  while (consoleEl.childElementCount > 800) consoleEl.removeChild(consoleEl.firstChild);
  if ($('autoscroll').checked) consoleEl.scrollTop = consoleEl.scrollHeight;
}
function logLocal(level, msg, bot) { queueLogs([{ level, msg, bot, ts: Date.now() }]); }
$('clearConsole').onclick = () => (consoleEl.innerHTML = '');

/* ------------------------------- stats ---------------------------------- */
let running = false;
function fmt(ms) { const s = Math.floor(ms / 1000); const m = Math.floor(s / 60); return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function refreshStatusText() { $('statusText').textContent = running ? T('st_running') : T('idle'); }
function updateStartEnabled() { $('startBtn').disabled = running || !$('ownConfirm').checked; }
function setRunningUI(on) {
  running = on;
  $('stopBtn').disabled = !on;
  $('updateBtn').disabled = !on;
  $('statusDot').classList.toggle('live', on);
  updateStartEnabled(); refreshStatusText();
}
$('ownConfirm').addEventListener('change', () => { updateStartEnabled(); persist(); });

api.onBotEvent((ev) => {
  if (!ev) return;
  if (ev.kind === 'logbatch') queueLogs(ev.items || []);
  else if (ev.kind === 'log') queueLogs([ev]);
  else if (ev.kind === 'stat') {
    const d = ev.data;
    $('stOnline').textContent = d.online; $('stConnecting').textContent = d.connecting;
    $('stTarget').textContent = d.target; $('stError').textContent = d.error;
    $('timer').textContent = fmt(d.elapsedMs);
    $('progressFill').style.width = (d.totalMs ? Math.min(100, (d.elapsedMs / d.totalMs) * 100) : 0) + '%';
  } else if (ev.kind === 'state') setRunningUI(ev.running);
  else if (ev.kind === 'done') {
    setRunningUI(false);
    $('statusText').textContent = ev.reason === 'duration-reached' ? T('st_finished') : T('st_stopped');
  }
});

/* ------------------------------ start/stop ------------------------------ */
function buildConfig() {
  return {
    host: $('host').value.trim(), port: parseInt($('port').value, 10) || 25565, version: $('version').value,
    count: parseInt($('count').value, 10) || 1, joinDelay: parseFloat($('joinDelay').value) || 0,
    viewDistance: parseInt($('viewDistance').value, 10) || 4, durationMin: parseFloat($('durationMin').value) || 5,
    autoRespawn: $('resilience').checked, autoReconnect: $('resilience').checked,
    usernamePrefix: $('usernamePrefix').value || 'LoadBot', loopScenarios: $('loopScenarios').checked, scenarios
  };
}
$('startBtn').onclick = async () => {
  const host = $('host').value.trim();
  if (!host) { logLocal('error', T('err_no_host')); shake($('host')); return; }
  if (!$('ownConfirm').checked) { logLocal('error', T('err_own')); shake($('ownWrap')); return; }
  persist();
  logLocal('info', T('starting'));
  const res = await api.startTest(buildConfig());
  if (!res || !res.ok) logLocal('error', res && res.error ? res.error : 'start-failed');
};
$('updateBtn').onclick = async () => {
  if (!running) return;
  const res = await api.updateTest(buildConfig());
  if (!res || !res.ok) logLocal('error', res && res.error ? res.error : 'update-failed');
  else logLocal('ok', T('updated'));
  persist();
};
$('stopBtn').onclick = async () => { await api.stopTest(); logLocal('warn', T('stopped_by_user')); };
function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

/* =============================== ANALYSIS =============================== */
$('pingBtn').onclick = async () => {
  const box = $('pingResult'); box.hidden = false;
  box.innerHTML = `<div class="ping-loading">${T('ping_pinging')}</div>`;
  const r = await api.pingServer({ host: $('aHost').value, port: $('aPort').value });
  if (!r || r.error) { box.innerHTML = `<div class="ping-bad">✕ ${T('ping_fail')}${r && r.error ? ' — ' + r.error : ''}</div>`; return; }
  if (r.serverType && r.serverType !== 'unknown') { $('aType').value = r.serverType; }
  const rows = [
    ['ping_type', (r.serverType || '?') + (r.serverType && r.serverType !== 'unknown' ? ` — ${T('ping_detected')}` : '')],
    ['ping_version', r.versionName],
    ['ping_players', r.players ? `${r.players.online} / ${r.players.max}` : '?'],
    ['ping_latency', r.latency != null ? r.latency + ' ms' : '?'],
    ['ping_motd', r.motd || '—']
  ];
  box.innerHTML = rows.map(([k, v]) => `<div class="pr"><span class="pr-k">${T(k)}</span><span class="pr-v"></span></div>`).join('');
  box.querySelectorAll('.pr-v').forEach((el, i) => (el.textContent = rows[i][1]));
  persist();
};

let sparkResult = null;

function sparkErr(r) {
  const code = r && r.error;
  if (code === 'heap-report') return T('spark_err_heap');
  if (code === 'health-report') return T('spark_err_health');
  if (code === 'bad-url') return T('spark_err_bad');
  return T('spark_err_generic') + (code ? ' (' + code + ')' : '');
}
function sparkSummaryLine(r) {
  const p = [];
  p.push((r.brand || r.serverType || '?') + (r.mcVersion ? ' ' + r.mcVersion : ''));
  if (r.tps) p.push('TPS ' + r.tps.last1m);
  if (r.mspt) p.push('MSPT ' + r.mspt.median + '/' + r.mspt.max);
  if (r.players != null) p.push(r.players + ' ' + T('sum_players_short'));
  if (r.entities != null) p.push(r.entities + ' entity');
  return T('spark_ok') + ' ' + p.join(' · ');
}
const isSparkLink = (t) => /spark\.lucko\.me\/|spark-usercontent\.lucko\.me\//i.test(t) || /^[A-Za-z0-9]{6,}$/.test(String(t).trim());

$('parseSparkBtn').onclick = async () => {
  const text = $('aSpark').value.trim();
  const out = $('sparkParsed'); out._parsed = null; sparkResult = null;
  if (!text) { out.textContent = T('spark_none'); out.className = 'spark-parsed bad'; return; }

  // A spark link/code → fetch & decode the real report.
  if (isSparkLink(text)) {
    out.textContent = T('spark_fetching'); out.className = 'spark-parsed';
    let r;
    try { r = await api.fetchSpark(text); } catch (e) { r = { ok: false, error: e.message }; }
    if (!r || !r.ok) { out.textContent = sparkErr(r); out.className = 'spark-parsed bad'; return; }
    sparkResult = r;
    if (r.serverType && r.serverType !== 'unknown') $('aType').value = r.serverType;
    if (r.heapMaxGb) $('aRam').value = Math.max(1, Math.round(r.heapMaxGb));
    if (r.players != null) $('aPlayers').value = r.players;
    if (r.configs && r.configs.viewDistance != null) $('aView').value = r.configs.viewDistance;
    if (r.configs && r.configs.simDistance != null) $('aSim').value = r.configs.simDistance;
    if (r.suggestedIssue) $('aIssue').value = r.suggestedIssue;
    out._parsed = {
      tps: r.tps ? { s5: r.tps.last1m } : {},
      mspt: r.mspt ? { median: r.mspt.median, max: r.mspt.max } : {},
      memory: r.heapMaxGb ? { totalGb: r.heapMaxGb } : null
    };
    out.textContent = sparkSummaryLine(r); out.className = 'spark-parsed ok';
    doAdvise();
    persist();
    return;
  }

  // Otherwise treat as pasted /spark tps + /spark health TEXT.
  const r = await api.parseSpark(text);
  if (r && r.isLink) { out.textContent = T('spark_link_msg'); out.className = 'spark-parsed bad'; return; }
  if (!r || !r.found) { out.textContent = T('spark_none'); out.className = 'spark-parsed bad'; return; }
  const parts = [];
  if (r.tps && r.tps.s5 != null) parts.push('TPS ' + r.tps.s5);
  if (r.mspt && r.mspt.median != null) parts.push('MSPT ~' + r.mspt.median + (r.mspt.max ? ' (max ' + r.mspt.max + ')' : ''));
  if (r.cpu && (r.cpu.process != null || r.cpu.system != null)) parts.push('CPU ' + (r.cpu.process != null ? r.cpu.process + '%p' : '') + (r.cpu.system != null ? ' ' + r.cpu.system + '%s' : ''));
  if (r.memory) parts.push('RAM ' + r.memory.usedGb.toFixed(1) + '/' + r.memory.totalGb.toFixed(1) + 'GB');
  out.textContent = T('spark_ok') + ' ' + parts.join(' · ');
  out.className = 'spark-parsed ok';
  out._parsed = r;
  if (r.memory && r.memory.totalGb) $('aRam').value = Math.round(r.memory.totalGb);
};

$('adviseBtn').onclick = () => doAdvise();

async function doAdvise() {
  const parsed = $('sparkParsed')._parsed || {};
  const hot = sparkResult && sparkResult.topMethods && sparkResult.topMethods[0] ? sparkResult.topMethods[0] : null;
  const input = {
    serverType: $('aType').value, ramGb: parseFloat($('aRam').value) || 0,
    players: parseInt($('aPlayers').value, 10) || 0, viewDistance: parseInt($('aView').value, 10) || 0,
    simDistance: parseInt($('aSim').value, 10) || 0, mainIssue: $('aIssue').value, aikarFlags: $('aFlags').checked,
    tps: parsed.tps && parsed.tps.s5 != null ? parsed.tps.s5 : null,
    mspt: parsed.mspt && (parsed.mspt.max != null ? parsed.mspt.max : parsed.mspt.median) != null
      ? (parsed.mspt.max != null ? parsed.mspt.max : parsed.mspt.median) : null,
    entities: sparkResult ? sparkResult.entities : null,
    hotMethod: hot
  };
  const list = await api.advise(input);
  renderResults(list, sparkResult);
  persist();
}

const SEV_CLASS = { 3: 'crit', 2: 'high', 1: 'med', 0: 'tip' };

function renderResults(list, spark) {
  const el = $('adviceList'); el.innerHTML = '';
  if (spark) {
    el.appendChild(buildSummaryCard(spark));
    if (spark.topMethods && spark.topMethods.length) el.appendChild(buildMethodsCard(spark));
    if (spark.configs && (spark.configs.viewDistance != null || spark.configs.simDistance != null || (spark.configs.files && spark.configs.files.length))) el.appendChild(buildConfigCard(spark));
  }
  if (list && list.length) { list.forEach((a, idx) => el.appendChild(buildAdviceCard(a, idx))); }
  else if (!spark) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = T('adv_none'); el.appendChild(e); }
}

function buildAdviceCard(a, idx) {
  const card = document.createElement('div');
  card.className = `advice sev-${SEV_CLASS[a.severity] || 'tip'} fade-in`;
  card.style.animationDelay = (idx * 0.02) + 's';
  card.innerHTML = `<div class="advice-head"><span class="sev-badge">${T('sev_' + a.severity)}</span><span class="area-tag">${a.area}</span><span class="advice-title"></span></div><div class="advice-detail"></div>`;
  card.querySelector('.advice-title').textContent = a.title;
  card.querySelector('.advice-detail').textContent = a.detail;
  if (a.config) {
    const cfg = document.createElement('div'); cfg.className = 'advice-config';
    const code = document.createElement('code'); code.textContent = a.config;
    const btn = document.createElement('button'); btn.className = 'copy-btn'; btn.textContent = T('copy');
    btn.onclick = () => { copyText(a.config); btn.textContent = T('copied'); setTimeout(() => (btn.textContent = T('copy')), 1200); };
    cfg.append(code, btn); card.appendChild(cfg);
  }
  return card;
}

function buildSummaryCard(r) {
  const card = document.createElement('div'); card.className = 'advice prof-summary fade-in';
  const rows = [
    [T('sum_server'), (r.brand || r.serverType || '?') + (r.mcVersion ? ' · ' + r.mcVersion : '')],
    ['TPS', r.tps ? `${r.tps.last1m} / ${r.tps.last5m} / ${r.tps.last15m}` : '—'],
    ['MSPT', r.mspt ? `${T('sum_median')} ${r.mspt.median} · 95% ${r.mspt.p95} · max ${r.mspt.max}` : '—'],
    ['CPU', r.cpu ? `${r.cpu.process != null ? r.cpu.process + '% proc' : ''} ${r.cpu.system != null ? '· ' + r.cpu.system + '% sys' : ''}`.trim() : '—'],
    [T('sum_ram'), (r.heapUsedGb != null ? `${r.heapUsedGb} / ${r.heapMaxGb} GB` : '—')],
    [T('sum_players'), r.players != null ? r.players : '—'],
    [T('sum_entities'), r.entities != null ? r.entities : '—'],
    ['online-mode', r.onlineMode]
  ];
  card.innerHTML = `<div class="advice-head"><span class="area-tag">SPARK</span><span class="advice-title">${T('prof_summary')}</span></div>`;
  const grid = document.createElement('div'); grid.className = 'sum-grid';
  rows.forEach(([k, v]) => { const c = document.createElement('div'); c.className = 'sum-cell'; const kk = document.createElement('span'); kk.className = 'sum-k'; kk.textContent = k; const vv = document.createElement('span'); vv.className = 'sum-v'; vv.textContent = v; c.append(kk, vv); grid.appendChild(c); });
  card.appendChild(grid);
  if (r.entityTop && r.entityTop.length) {
    const et = document.createElement('div'); et.className = 'ent-top';
    et.textContent = r.entityTop.map((e) => `${e.type.replace('minecraft:', '')} ×${e.count}`).join('   ·   ');
    card.appendChild(et);
  }
  return card;
}

function buildMethodsCard(r) {
  const card = document.createElement('div'); card.className = 'advice prof-methods fade-in';
  card.innerHTML = `<div class="advice-head"><span class="area-tag">PROFILER</span><span class="advice-title">${T('top_methods')}</span></div>`;
  const max = r.topMethods[0] ? r.topMethods[0].pct : 100;
  r.topMethods.forEach((m) => {
    const row = document.createElement('div'); row.className = 'mrow';
    const lbl = document.createElement('span'); lbl.className = 'mlbl'; lbl.textContent = m.label;
    const track = document.createElement('div'); track.className = 'mtrack';
    const bar = document.createElement('div'); bar.className = 'mbar'; bar.style.width = Math.max(4, (m.pct / (max || 1)) * 100) + '%';
    track.appendChild(bar);
    const pct = document.createElement('span'); pct.className = 'mpct'; pct.textContent = m.pct + '%';
    row.append(lbl, track, pct); card.appendChild(row);
  });
  return card;
}

function buildConfigCard(r) {
  const card = document.createElement('div'); card.className = 'advice prof-config fade-in';
  card.innerHTML = `<div class="advice-head"><span class="area-tag">CONFIG</span><span class="advice-title">${T('detected_config')}</span></div>`;
  const d = document.createElement('div'); d.className = 'advice-detail';
  const bits = [];
  if (r.configs.viewDistance != null) bits.push('view-distance = ' + r.configs.viewDistance);
  if (r.configs.simDistance != null) bits.push('simulation-distance = ' + r.configs.simDistance);
  d.textContent = bits.join('   ·   ') || '—';
  card.appendChild(d);
  if (r.configs.files && r.configs.files.length) { const f = document.createElement('div'); f.className = 'cfg-files'; f.textContent = r.configs.files.join(', '); card.appendChild(f); }
  return card;
}
function copyText(t) {
  try { navigator.clipboard.writeText(t); }
  catch (_) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); }
}

/* --------------------------- settings persistence ----------------------- */
let saveTimer = null;
function collect() {
  return {
    lang,
    host: $('host').value, port: $('port').value, version: $('version').value,
    count: $('count').value, joinDelay: $('joinDelay').value, viewDistance: $('viewDistance').value,
    durationMin: $('durationMin').value, resilience: $('resilience').checked,
    usernamePrefix: $('usernamePrefix').value, loopScenarios: $('loopScenarios').checked,
    ownConfirm: $('ownConfirm').checked, scenarios, theme,
    aHost: $('aHost').value, aPort: $('aPort').value, aType: $('aType').value, aRam: $('aRam').value,
    aPlayers: $('aPlayers').value, aIssue: $('aIssue').value, aView: $('aView').value, aSim: $('aSim').value, aFlags: $('aFlags').checked
  };
}
function persist() { if (!settingsLoaded) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => api.setSettings(collect()), 400); }
function applySettings(s) {
  if (!s) return;
  const setV = (id, v) => { if (v != null && $(id)) $(id).value = v; };
  const setC = (id, v) => { if (v != null && $(id)) $(id).checked = !!v; };
  setV('host', s.host); setV('port', s.port); setV('count', s.count); setV('joinDelay', s.joinDelay);
  setV('viewDistance', s.viewDistance); setV('durationMin', s.durationMin); setV('usernamePrefix', s.usernamePrefix);
  setC('resilience', s.resilience); setC('loopScenarios', s.loopScenarios); setC('ownConfirm', s.ownConfirm);
  if (s.theme) {
    theme = Object.assign(theme, s.theme);
    // Migrate the old whole-window opacity slider (40–100, higher = solid) to
    // the transparency it means now (0–60, higher = more see-through).
    if (theme.winTransparency == null && s.theme.winOpacity != null) {
      theme.winTransparency = Math.max(0, Math.min(60, 100 - Number(s.theme.winOpacity)));
    }
    delete theme.winOpacity;
    applyTheme(); syncThemeControls();
  }
  setV('aHost', s.aHost); setV('aPort', s.aPort); setV('aType', s.aType); setV('aRam', s.aRam);
  setV('aPlayers', s.aPlayers); setV('aIssue', s.aIssue); setV('aView', s.aView); setV('aSim', s.aSim); setC('aFlags', s.aFlags);
  if (Array.isArray(s.scenarios) && s.scenarios.length) scenarios = s.scenarios;
}

// persist on any input change (covers most fields)
document.addEventListener('input', persist);
document.addEventListener('change', persist);

/* ---------------------------- background fx ----------------------------- */
(function bg() {
  const c = $('bg'); const ctx = c.getContext('2d'); let w, h, parts;
  function resize() {
    w = c.width = window.innerWidth; h = c.height = window.innerHeight;
    const n = Math.min(60, Math.floor((w * h) / 30000));
    parts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.22, vy: (Math.random() - 0.5) * 0.22, r: Math.random() * 1.6 + 0.4 }));
  }
  resize(); window.addEventListener('resize', resize);
  let cleared = false;
  function tick() {
    requestAnimationFrame(tick);
    if (document.hidden) return; // save CPU when not visible
    if (!particlesOn) { if (!cleared) { ctx.clearRect(0, 0, w, h); cleared = true; } return; }
    cleared = false;
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = `rgba(${particleRgb.r},${particleRgb.g},${particleRgb.b},${0.35 * fxAlpha})`; ctx.fill();
    }
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j]; const dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy;
      if (d2 < 15000) { ctx.strokeStyle = `rgba(${particleRgb.r},${particleRgb.g},${particleRgb.b},${0.12 * fxAlpha * (1 - d2 / 15000)})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }
  }
  tick();
})();

/* ------------------------------- init ----------------------------------- */
let loaderHidden = false;
const LOADER_MIN_MS = 1000; // keep the loading screen up for at least 1s
const loaderStart = Date.now();
function hideLoader() {
  if (loaderHidden) return;
  const wait = Math.max(0, LOADER_MIN_MS - (Date.now() - loaderStart));
  if (wait > 0) { setTimeout(hideLoader, wait); return; } // enforce minimum time
  loaderHidden = true;
  const l = $('loader'); if (!l || l.hidden) return;
  l.classList.add('closing');
  setTimeout(() => (l.hidden = true), 450);
}

async function init() {
  wireTheme();
  applyTheme(); // defaults first; applySettings() overrides if the user saved a theme
  let s = {};
  try { s = await api.getSettings(); } catch (_) {}
  if (s && s.lang) {
    // returning user: keep the animated loader up briefly, use cached versions
    // for an instant dropdown, then refresh from Mojang in the background.
    lang = s.lang; $('splash').hidden = true;
    applySettings(s);
    settingsLoaded = true;
    applyLang();
    if (s.versionsCache && s.versionsCache.supported) { fillVersions(s.versionsCache, s.version); hideLoader(); }
    loadVersions(s.version).then(hideLoader);
    setTimeout(hideLoader, 6000); // safety: never stick on the loader
  } else {
    // first run: no loader, just ask language.
    $('loader').hidden = true;
    $('splash').hidden = false;
    document.querySelectorAll('.splash-lang').forEach((b) => {
      b.addEventListener('click', async () => {
        lang = b.dataset.lang;
        $('splash').classList.add('closing');
        setTimeout(() => ($('splash').hidden = true), 550);
        settingsLoaded = true;
        applyLang();
        await api.setSettings({ lang });
        await loadVersions();
      });
    });
    applyLang();
  }
  renderScenarios();
  updateStartEnabled();
}
init();

})();

'use strict';

/*
 * BotManager — spawns and drives mineflayer bots for load / optimization
 * testing of a Minecraft server you operate.
 *
 * Safety rails (abuse mitigation):
 *   - MAX_BOTS      : hard cap of 100 concurrent bots.
 *   - MAX_DURATION  : hard cap of 60 minutes (unlocked by the ownership
 *                     confirmation in the UI; still a fixed ceiling).
 *   - Auto-stop     : the run tears itself down when the timer ends.
 *
 * Resilience:
 *   - Respawn        : if a bot dies, it respawns and restarts its scenario.
 *   - Reconnect      : if a bot can't connect / drops, it retries with backoff
 *                      while the test is running.
 *
 * Performance:
 *   - Log batching   : log lines are buffered and flushed together, so 100 bots
 *                      don't flood the UI process (prevents freezing).
 *   - Light movement : movement loops use relaxed intervals; pathfinder is only
 *                      loaded when AI is enabled.
 */

// mineflayer is required lazily (only when a test starts) so the app's idle
// memory stays low — requiring it eagerly pulls the whole prismarine stack.
let mineflayer = null;

const MAX_BOTS = 100;
const MAX_DURATION_MIN = 60;
const LOG_FLUSH_MS = 150;
const RECONNECT_MAX_BACKOFF_MS = 15000;

class BotManager {
  constructor(emit) {
    this.emit = emit || (() => {});
    this.slots = new Map(); // id -> rec
    this.running = false;
    this.config = null;
    this.spawnTimers = [];
    this.endTimer = null;
    this.statTimer = null;
    this.logTimer = null;
    this.startedAt = 0;
    this.counters = { target: 0, connecting: 0, online: 0, ended: 0, error: 0, reconnects: 0 };
    this._pathfinder = null;
    this._logBuf = [];
    this._loopTimers = new Set();
    this._settleResolvers = {};
    this._settleTimeouts = {};
  }

  /* --------------------------- logging (batched) --------------------------- */
  log(level, msg, bot) {
    this._logBuf.push({ level, msg, bot: bot || null, ts: Date.now() });
    if (this._logBuf.length > 400) this._flushLogs(); // avoid unbounded growth
  }
  _flushLogs() {
    if (!this._logBuf.length) return;
    const items = this._logBuf;
    this._logBuf = [];
    this.emit({ kind: 'logbatch', items });
  }

  pushStats() {
    const elapsed = this.running ? Date.now() - this.startedAt : 0;
    const totalMs = this.config ? this.config.durationMin * 60 * 1000 : 0;
    this.emit({
      kind: 'stat',
      data: {
        running: this.running,
        ...this.counters,
        elapsedMs: elapsed,
        totalMs,
        remainingMs: Math.max(0, totalMs - elapsed)
      }
    });
  }

  status() {
    return { running: this.running, counters: { ...this.counters }, startedAt: this.startedAt };
  }

  /* ------------------------------- start -------------------------------- */
  start(rawConfig) {
    if (this.running) return { ok: false, error: 'already-running' };
    const cfg = this._sanitize(rawConfig);
    if (cfg.error) return { ok: false, error: cfg.error };

    // Lazy-load the (heavy) bot engine only now, on first test start.
    if (!mineflayer) {
      try { mineflayer = require('mineflayer'); }
      catch (e) { return { ok: false, error: 'engine-load-failed: ' + e.message }; }
    }

    this.config = cfg;
    this.running = true;
    this.startedAt = Date.now();
    this.counters = { target: cfg.count, connecting: 0, online: 0, ended: 0, error: 0, reconnects: 0 };
    this._verHintShown = false;

    if (cfg.ai) {
      try {
        this._pathfinder = require('mineflayer-pathfinder');
        this.log('info', 'AI (pathfinder) enabled — bots avoid obstacles while roaming.');
      } catch (err) {
        this._pathfinder = null;
        this.log('warn', 'pathfinder unavailable; using simple movement.');
      }
    }

    this.log('info', `Starting → ${cfg.host}:${cfg.port} | ${cfg.version || 'auto'} | ${cfg.count} bots | ${cfg.durationMin} min`);
    this.emit({ kind: 'state', running: true });

    // Sequential join: connect ONE bot, wait until it actually spawns (or
    // fails/times out), then move to the next. This spreads the CPU/packet
    // load over time so the panel never freezes, and honors "one at a time".
    this._spawnLoop().catch((e) => this.log('warn', 'spawn loop: ' + e.message));

    this.endTimer = setTimeout(() => {
      this.log('info', 'Duration reached — stopping all bots.');
      this.stopAll('duration-reached');
    }, cfg.durationMin * 60 * 1000);

    this.statTimer = setInterval(() => this.pushStats(), 1000);
    this.logTimer = setInterval(() => this._flushLogs(), LOG_FLUSH_MS);
    this.pushStats();
    return { ok: true };
  }

  /* --------------------- sequential join queue -------------------------- */
  async _spawnLoop() {
    const cfg = this.config;
    for (let i = 0; i < cfg.count; i++) {
      if (!this.running) return;
      await this._connectAndWait(i + 1);      // wait until this bot is in (or failed)
      if (!this.running) return;
      if (cfg.joinDelay > 0) await this._plainSleep(cfg.joinDelay * 1000);
    }
  }

  _connectAndWait(id) {
    return new Promise((resolve) => {
      this._settleResolvers[id] = resolve;
      // Safety: don't let one stuck connection stall the whole queue.
      this._settleTimeouts[id] = setTimeout(() => this._settle(id), 15000);
      this._connectSlot(id);
    });
  }

  _settle(id) {
    const r = this._settleResolvers[id];
    if (!r) return; // already settled (idempotent)
    delete this._settleResolvers[id];
    if (this._settleTimeouts[id]) { clearTimeout(this._settleTimeouts[id]); delete this._settleTimeouts[id]; }
    r();
  }

  _plainSleep(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { this._loopTimers.delete(t); resolve(); }, Math.max(0, ms));
      this._loopTimers.add(t);
    });
  }

  _sanitize(c) {
    c = c || {};
    const host = String(c.host || '').trim();
    if (!host) return { error: 'no-host' };
    const port = parseInt(c.port, 10) || 25565;
    const version = String(c.version || '').trim() || false;

    let count = parseInt(c.count, 10) || 1;
    count = Math.max(1, Math.min(MAX_BOTS, count));

    let joinDelay = Number(c.joinDelay);
    if (!isFinite(joinDelay) || joinDelay < 0) joinDelay = 0;
    joinDelay = Math.min(joinDelay, 60);

    let viewDistance = parseInt(c.viewDistance, 10);
    if (!isFinite(viewDistance)) viewDistance = 4;
    viewDistance = Math.max(2, Math.min(32, viewDistance));

    let durationMin = Number(c.durationMin);
    if (!isFinite(durationMin) || durationMin <= 0) durationMin = 5;
    durationMin = Math.min(MAX_DURATION_MIN, durationMin);

    const ai = !!c.ai;
    const usernamePrefix = (String(c.usernamePrefix || 'LoadBot').replace(/[^A-Za-z0-9_]/g, '') || 'LoadBot').slice(0, 10);
    const loopScenarios = c.loopScenarios !== false;
    const autoRespawn = c.autoRespawn !== false;
    const autoReconnect = c.autoReconnect !== false;
    const scenarios = Array.isArray(c.scenarios) ? c.scenarios : [];

    return { host, port, version, count, joinDelay, viewDistance, durationMin,
      ai, usernamePrefix, loopScenarios, autoRespawn, autoReconnect, scenarios };
  }

  /* ------------------------- connect / reconnect ------------------------ */
  _connectSlot(id) {
    if (!this.running) return;
    const cfg = this.config;
    let rec = this.slots.get(id);
    if (!rec) {
      rec = {
        id, username: `${cfg.usernamePrefix}_${String(id).padStart(3, '0')}`,
        state: 'connecting', timers: new Set(), origin: null,
        attempts: 0, gen: 0, restartOnSpawn: false, intentional: false, countedOnline: false
      };
      this.slots.set(id, rec);
    }
    rec.intentional = false;
    rec.attempts++;
    this.counters.connecting++;
    this.log('info', rec.attempts > 1 ? `Connecting… (try ${rec.attempts})` : 'Connecting…', rec.username);

    let bot;
    try {
      bot = mineflayer.createBot({
        host: cfg.host, port: cfg.port, username: rec.username,
        version: cfg.version, auth: 'offline',
        viewDistance: cfg.viewDistance, checkTimeoutInterval: 30000, hideErrors: true
      });
    } catch (err) {
      this.counters.connecting = Math.max(0, this.counters.connecting - 1);
      this.counters.error++;
      this.log('error', `create failed: ${err.message}`, rec.username);
      if (this._isVersionError(err.message)) { rec.fatal = true; this._versionHint(); }
      this._settle(id);
      this._scheduleReconnect(rec);
      return;
    }
    rec.bot = bot;

    bot.once('login', () => this.log('info', 'Logged in.', rec.username));

    bot.on('spawn', () => {
      // Fires on first spawn AND after each respawn.
      if (!rec.countedOnline) {
        this.counters.connecting = Math.max(0, this.counters.connecting - 1);
        this.counters.online++;
        rec.countedOnline = true;
      }
      rec.state = 'online';
      rec.origin = bot.entity ? bot.entity.position.clone() : rec.origin;
      this._settle(id); // this bot is in → queue may start the next one

      if (cfg.ai && this._pathfinder && !rec.pfLoaded) {
        try {
          const { pathfinder, Movements } = this._pathfinder;
          bot.loadPlugin(pathfinder);
          const moves = new Movements(bot);
          moves.canDig = false;
          moves.allow1by1towers = false;
          bot.pathfinder.setMovements(moves);
          rec.pfLoaded = true;
        } catch (err) { this.log('warn', `pathfinder init: ${err.message}`, rec.username); }
      }

      const wasRestart = rec.restartOnSpawn;
      rec.restartOnSpawn = false;
      this.log(wasRestart ? 'ok' : 'ok', wasRestart ? 'Respawned — restarting scenario.' : 'Spawned in world.', rec.username);

      rec.gen++;
      const gen = rec.gen;
      this._runScenarios(rec, gen).catch((e) => this.log('warn', `scenario: ${e.message}`, rec.username));
    });

    bot.on('death', () => {
      this.log('warn', 'Died.', rec.username);
      rec.gen++; // cancel current scenario loop
      for (const t of rec.timers) clearTimeout(t);
      rec.timers.clear();
      if (cfg.autoRespawn && this.running) {
        rec.restartOnSpawn = true;
        // mineflayer usually auto-respawns; nudge it a few ways just in case.
        try { if (typeof bot.respawn === 'function') bot.respawn(); } catch (_) {}
        try { bot._client.write('client_command', { actionId: 0, payload: 0 }); } catch (_) {}
      }
    });

    bot.on('kicked', (reason) => this.log('warn', `Kicked: ${this._clean(reason)}`, rec.username));

    bot.on('error', (err) => {
      this.counters.error++;
      this.log('error', `${err.code || 'ERR'}: ${err.message}`, rec.username);
      if (this._isVersionError(err.message)) { rec.fatal = true; this._versionHint(); }
    });

    bot.once('end', (reason) => {
      if (rec.countedOnline) this.counters.online = Math.max(0, this.counters.online - 1);
      else this.counters.connecting = Math.max(0, this.counters.connecting - 1);
      rec.countedOnline = false;
      rec.pfLoaded = false;
      rec.state = 'ended';
      rec.gen++;
      for (const t of rec.timers) clearTimeout(t);
      rec.timers.clear();
      this._settle(id); // if it dropped before spawning, let the queue continue
      if (rec.intentional || !this.running) {
        this.counters.ended++;
        return;
      }
      this.log('info', `Disconnected (${reason || 'end'}).`, rec.username);
      this._scheduleReconnect(rec);
    });
  }

  _scheduleReconnect(rec) {
    if (rec.fatal) { this.counters.ended++; return; } // unsupported version: retrying is futile
    if (!this.running || !this.config.autoReconnect) { this.counters.ended++; return; }
    const backoff = Math.min(RECONNECT_MAX_BACKOFF_MS, 1000 * Math.pow(2, Math.min(rec.attempts, 4)));
    this.counters.reconnects++;
    this.log('info', `Reconnecting in ${Math.round(backoff / 1000)}s (try ${rec.attempts})…`, rec.username);
    const t = setTimeout(() => { rec.timers.delete(t); this._connectSlot(rec.id); }, backoff);
    rec.timers.add(t);
  }

  /* --------------------------- scenario engine -------------------------- */
  async _runScenarios(rec, gen) {
    const cfg = this.config;
    if (!cfg.scenarios.length) return;
    do {
      for (const step of cfg.scenarios) {
        if (!this._alive(rec, gen)) return;
        try { await this._runStep(rec, gen, step); }
        catch (err) { this.log('warn', `step "${step.type}": ${err.message}`, rec.username); }
      }
    } while (this._alive(rec, gen) && cfg.loopScenarios);
  }

  _alive(rec, gen) {
    return this.running && rec.gen === gen && rec.state === 'online' && rec.bot;
  }

  _sleep(rec, ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { rec.timers.delete(t); resolve(); }, Math.max(0, ms));
      rec.timers.add(t);
    });
  }

  async _runStep(rec, gen, step) {
    const bot = rec.bot;
    const type = step && step.type;

    if (type === 'wait') {
      const s = Math.max(0, Number(step.seconds) || 0);
      this.log('info', `wait ${s}s`, rec.username);
      await this._sleep(rec, s * 1000);
      return;
    }
    if (type === 'chat') {
      const text = String(step.text || '').slice(0, 256);
      if (text) { this.log('info', `chat: ${text}`, rec.username); try { bot.chat(text); } catch (_) {} }
      return;
    }
    if (type === 'jump') {
      const s = Math.max(0, Number(step.seconds) || 2);
      this.log('info', `jump ${s}s`, rec.username);
      const end = Date.now() + s * 1000;
      while (Date.now() < end && this._alive(rec, gen)) {
        try { bot.setControlState('jump', true); } catch (_) {}
        await this._sleep(rec, 500);
        try { bot.setControlState('jump', false); } catch (_) {}
        await this._sleep(rec, 400);
      }
      try { bot.setControlState('jump', false); } catch (_) {}
      return;
    }
    if (type === 'look') {
      const s = Math.max(0, Number(step.seconds) || 3);
      this.log('info', `look around ${s}s`, rec.username);
      const end = Date.now() + s * 1000;
      while (Date.now() < end && this._alive(rec, gen)) {
        try { await bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.6, false); } catch (_) {}
        await this._sleep(rec, 800);
      }
      return;
    }
    if (type === 'roam') {
      const radius = Math.max(1, Math.min(256, Number(step.radius) || 100));
      const s = Math.max(1, Number(step.seconds) || 10);
      this.log('info', `roam r=${radius} ${s}s`, rec.username);
      await this._roam(rec, gen, radius, s * 1000);
      return;
    }
    this.log('warn', `unknown step: ${type}`, rec.username);
  }

  async _roam(rec, gen, radius, durationMs) {
    const bot = rec.bot;
    const cfg = this.config;
    const end = Date.now() + durationMs;
    const origin = rec.origin || (bot.entity && bot.entity.position);
    if (!origin) return;

    if (cfg.ai && this._pathfinder && bot.pathfinder) {
      const { goals } = this._pathfinder;
      while (Date.now() < end && this._alive(rec, gen)) {
        const ang = Math.random() * Math.PI * 2;
        const dist = Math.random() * radius;
        const gx = Math.floor(origin.x + Math.cos(ang) * dist);
        const gz = Math.floor(origin.z + Math.sin(ang) * dist);
        const gy = Math.floor(origin.y);
        try { await bot.pathfinder.goto(new goals.GoalNear(gx, gy, gz, 2)); }
        catch (_) { await this._sleep(rec, 400); }
        await this._sleep(rec, 400);
      }
      try { bot.pathfinder.setGoal(null); } catch (_) {}
    } else {
      try { bot.setControlState('forward', true); } catch (_) {}
      while (Date.now() < end && this._alive(rec, gen)) {
        const pos = bot.entity && bot.entity.position;
        let yaw = Math.random() * Math.PI * 2;
        if (pos) {
          const dx = pos.x - origin.x, dz = pos.z - origin.z;
          if (Math.sqrt(dx * dx + dz * dz) > radius) yaw = Math.atan2(-(origin.x - pos.x), origin.z - pos.z);
        }
        try { await bot.look(yaw, 0, false); } catch (_) {}
        if (Math.random() < 0.2) {
          try { bot.setControlState('jump', true); } catch (_) {}
          await this._sleep(rec, 350);
          try { bot.setControlState('jump', false); } catch (_) {}
        }
        await this._sleep(rec, 1100);
      }
      try { bot.setControlState('forward', false); bot.setControlState('jump', false); } catch (_) {}
    }
  }

  /* ------------------------------- stop --------------------------------- */
  stopAll(reason) {
    if (!this.running && this.slots.size === 0) return;
    const wasRunning = this.running;
    this.running = false;

    for (const t of this.spawnTimers) clearTimeout(t);
    this.spawnTimers = [];
    for (const t of this._loopTimers) clearTimeout(t);
    this._loopTimers.clear();
    // unblock the sequential join queue
    for (const id of Object.keys(this._settleResolvers)) this._settle(id);
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    if (this.statTimer) { clearInterval(this.statTimer); this.statTimer = null; }

    for (const rec of this.slots.values()) {
      rec.intentional = true;
      rec.gen++;
      for (const t of rec.timers) clearTimeout(t);
      rec.timers.clear();
      try {
        if (rec.bot) {
          // rec.intentional is already true, so our 'end' handler won't reconnect.
          // Let mineflayer tear itself down (this stops its physics tick and
          // internal timers). Do NOT null bot internals here — the physics loop
          // may still fire once and would crash on nulled state.
          try { rec.bot.quit(reason || 'stopped'); } catch (_) { try { rec.bot.end(); } catch (_) {} }
        }
      } catch (_) {}
      rec.bot = null; rec.origin = null; // drop our reference so GC can collect it
    }
    this.slots.clear();
    this._settleResolvers = {};
    this._settleTimeouts = {};

    // Reclaim memory: bot worlds/chunks are large. Give listeners a tick to
    // detach, then force GC (available because main enables --expose-gc).
    setTimeout(() => { try { if (global.gc) { global.gc(); } } catch (_) {} }, 800);

    if (wasRunning) {
      this.log('info', `All bots stopped (${reason || 'stopped'}).`);
      this.counters.online = 0;
      this.counters.connecting = 0;
      this._flushLogs();
      this.pushStats();
      this.emit({ kind: 'state', running: false });
      this.emit({ kind: 'done', reason: reason || 'stopped' });
    }
    if (this.logTimer) { clearInterval(this.logTimer); this.logTimer = null; }
    this._flushLogs();
  }

  _isVersionError(msg) {
    return /no data available for version|unsupported protocol version|unknown version|unsupported version/i.test(String(msg || ''));
  }

  _versionHint() {
    if (this._verHintShown) return;
    this._verHintShown = true;
    this.log('warn', 'This Minecraft version is not supported by the bot engine yet (newest supported is 26.1). Fixes: (1) install ViaVersion + ViaBackwards on your test server and select 26.1 in the app, or (2) test a server on 26.1 or older. Newer versions become available via a library update (npm update) once PrismarineJS ships support.');
    this.log('warn', 'Bu MC sürümü bot motoru tarafından henüz desteklenmiyor (en yeni 26.1). Çözüm: sunucuna ViaVersion+ViaBackwards kurup uygulamada 26.1 seç, ya da 26.1 ve altı bir sunucu test et. Yeni sürümler kütüphane güncellenince (npm update) gelir.');
    this.stopAll('unsupported-version');
  }

  _clean(reason) {
    try {
      if (typeof reason === 'string') { const j = JSON.parse(reason); return j.text || j.translate || reason; }
      if (reason && reason.text) return reason.text;
    } catch (_) {}
    return String(reason);
  }
}

module.exports = BotManager;

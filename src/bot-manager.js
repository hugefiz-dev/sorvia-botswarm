'use strict';

/*
 * BotManager — spawns and drives mineflayer bots for load / optimization
 * testing of a Minecraft server you operate.
 *
 * Safety rails (abuse mitigation):
 *   - MAX_BOTS      : hard cap of 1000 concurrent bots.
 *   - MAX_DURATION  : hard cap of 1440 minutes / 24 h (the run still needs the
 *                     ownership confirmation in the UI before it may start).
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
 *   - Light movement : roam/goto walk in short legs inside loaded chunks, and
 *                      only a few bots may run a path search at a time, so the
 *                      shared event loop never stalls (steady movement, no
 *                      latency spikes).
 */

// mineflayer is required lazily (only when a test starts) so the app's idle
// memory stays low — requiring it eagerly pulls the whole prismarine stack.
let mineflayer = null;

const MAX_BOTS = 1000;
const MAX_DURATION_MIN = 1440; // 24 hours
const LOG_FLUSH_MS = 150;
const RECONNECT_MAX_BACKOFF_MS = 15000;
// A scenario lap never runs faster than this. Without it a list of instant
// steps (a single chat step, say) spins the event loop with no breathing room,
// which freezes the app and gets the bots kicked for spam.
const MIN_SCENARIO_LAP_MS = 1000;
// How many bots may be created back-to-back before yielding to the event loop.
const SPAWN_BURST = 8;
// Above this many bots, only the first few slots narrate their movement steps —
// otherwise the console (and the UI process) drowns in per-step chatter.
const LOG_SAMPLE_FROM = 10;
const LOG_SAMPLE_SLOTS = 5;

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
    this._pathBusy = 0;   // bots currently computing a path
    this._pathLimit = 4;  // how many may compute at the same time (see _pathSlot)
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
    this._pathBusy = 0;
    this._pathLimit = this._movementProfile(cfg.count).slots;

    // Pathfinder is always available (used by roam/goto for obstacle-avoiding
    // movement). Loaded lazily to keep idle memory low.
    try {
      this._pathfinder = require('mineflayer-pathfinder');
    } catch (err) {
      this._pathfinder = null;
      this.log('warn', 'pathfinder unavailable; roam/goto will use simple movement.');
    }

    this.log('info', `Starting → ${cfg.host}:${cfg.port} | ${cfg.version || 'auto'} | ${cfg.count} bots | ${cfg.durationMin} min | join ${cfg.joinDelay === 0 ? 'all-at-once' : cfg.joinDelay + 's'}`);
    this.emit({ kind: 'state', running: true });

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

  /* --------------------------- join scheduler --------------------------- */
  async _spawnLoop() {
    const cfg = this.config;
    if (cfg.joinDelay === 0) {
      // Join interval 0 → inject ALL bots at once. "At once" still has to yield:
      // every createBot opens a socket and pulls version data, so a few hundred
      // of them in one synchronous burst blocks the event loop and freezes the
      // app before the test has even started. Handing control back every few
      // bots keeps the UI alive while the swarm still lands within a moment.
      for (let i = 0; i < cfg.count; i++) {
        if (!this.running) return;
        this._connectSlot(i + 1);
        if ((i + 1) % SPAWN_BURST === 0) await this._plainSleep(0);
      }
      return;
    }
    // Join interval > 0 → connect one, wait the interval, then the next.
    for (let i = 0; i < cfg.count; i++) {
      if (!this.running) return;
      this._connectSlot(i + 1);
      if (i < cfg.count - 1) await this._plainSleep(cfg.joinDelay * 1000);
    }
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

  /* --------------------------- live update ------------------------------ */
  // Apply scenario / settings changes to a RUNNING test WITHOUT disconnecting
  // the bots. Restarts each bot's scenario loop with the new steps, adjusts
  // the duration timer, and scales the bot count up/down in place.
  update(rawCfg) {
    if (!this.running) return { ok: false, error: 'not-running' };
    const cfg = this._sanitize(rawCfg);
    if (cfg.error) return { ok: false, error: cfg.error };
    const old = this.config;

    // Live-updatable fields (host/port/version/prefix stay fixed for the run).
    old.scenarios = cfg.scenarios;
    old.loopScenarios = cfg.loopScenarios;
    old.autoRespawn = cfg.autoRespawn;
    old.autoReconnect = cfg.autoReconnect;
    old.joinDelay = cfg.joinDelay;
    old.viewDistance = cfg.viewDistance; // affects newly added bots only

    // Duration change → reschedule the auto-stop timer.
    if (cfg.durationMin !== old.durationMin) {
      old.durationMin = cfg.durationMin;
      if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
      const remaining = cfg.durationMin * 60 * 1000 - (Date.now() - this.startedAt);
      if (remaining <= 0) { this.stopAll('duration-reached'); return { ok: true }; }
      this.endTimer = setTimeout(() => { this.log('info', 'Duration reached — stopping all bots.'); this.stopAll('duration-reached'); }, remaining);
    }

    // Restart scenario loops for online bots with the new scenarios.
    for (const rec of this.slots.values()) {
      if (rec.state === 'online' && rec.bot) {
        rec.gen++;
        for (const t of rec.timers) clearTimeout(t);
        rec.timers.clear();
        const gen = rec.gen;
        this._runScenarios(rec, gen).catch(() => {});
      }
    }

    // Scale bot count up or down in place.
    const ids = [...this.slots.keys()];
    const curMax = ids.length ? Math.max(...ids) : 0;
    old.count = cfg.count;
    this.counters.target = cfg.count;
    // resize the path gate with the swarm (see _pathSlot)
    this._pathLimit = this._movementProfile(cfg.count).slots;
    if (cfg.count > curMax) {
      for (let i = curMax; i < cfg.count; i++) {
        const id = i + 1;
        // Same reasoning as _spawnLoop: never create a pile of bots in one
        // synchronous burst, or a live scale-up freezes the app.
        const delay = cfg.joinDelay > 0
          ? (i - curMax) * cfg.joinDelay * 1000
          : Math.floor((i - curMax) / SPAWN_BURST) * 15;
        const t = setTimeout(() => this._connectSlot(id), delay);
        this.spawnTimers.push(t);
      }
      this.log('info', `Live update: scaled up to ${cfg.count} bots.`);
    } else if (cfg.count < curMax) {
      for (const [id, rec] of [...this.slots]) {
        if (id > cfg.count) {
          rec.intentional = true; rec.gen++;
          for (const t of rec.timers) clearTimeout(t); rec.timers.clear();
          if (rec.countedOnline) this.counters.online = Math.max(0, this.counters.online - 1);
          try { rec.bot && rec.bot.quit('scaled-down'); } catch (_) {}
          this.slots.delete(id);
        }
      }
      this.log('info', `Live update: scaled down to ${cfg.count} bots.`);
    }

    this.log('ok', 'Live update applied (bots stayed connected).');
    this.pushStats();
    return { ok: true };
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
    joinDelay = Math.min(joinDelay, 300);

    let viewDistance = parseInt(c.viewDistance, 10);
    if (!isFinite(viewDistance)) viewDistance = 4;
    viewDistance = Math.max(2, Math.min(32, viewDistance));

    let durationMin = Number(c.durationMin);
    if (!isFinite(durationMin) || durationMin <= 0) durationMin = 5;
    durationMin = Math.min(MAX_DURATION_MIN, durationMin);

    const usernamePrefix = (String(c.usernamePrefix || 'LoadBot').replace(/[^A-Za-z0-9_]/g, '') || 'LoadBot').slice(0, 10);
    const loopScenarios = c.loopScenarios !== false;
    const autoRespawn = c.autoRespawn !== false;
    const autoReconnect = c.autoReconnect !== false;
    const scenarios = Array.isArray(c.scenarios) ? c.scenarios : [];

    return { host, port, version, count, joinDelay, viewDistance, durationMin,
      usernamePrefix, loopScenarios, autoRespawn, autoReconnect, scenarios };
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

    // Resource packs: answer the server's request without downloading the file.
    // Many servers hold every joining player on a loading screen until the
    // client confirms the pack, so the bots must reply or they never spawn —
    // but pulling the pack once per bot would only measure our own bandwidth
    // and RAM, not the server. See _ackResourcePack().
    try {
      const onPack = (packet) => this._ackResourcePack(bot, rec, packet);
      bot._client.on('resource_pack_send', onPack); // up to 1.20.2
      bot._client.on('add_resource_pack', onPack);  // 1.20.3+ (packet was renamed)
    } catch (_) {
      bot.on('resourcePack', () => { try { bot.acceptResourcePack(); } catch (_) {} });
    }

    bot.on('spawn', () => {
      // Fires on first spawn AND after each respawn.
      if (!rec.countedOnline) {
        this.counters.connecting = Math.max(0, this.counters.connecting - 1);
        this.counters.online++;
        rec.countedOnline = true;
      }
      rec.state = 'online';
      rec.origin = bot.entity ? bot.entity.position.clone() : rec.origin;
      this._settle(id);

      // Pathfinder for roam/goto, with obstacle avoidance tuned to be safe:
      // no digging, limited drop height (avoid big cliffs), and water/lava
      // added to the avoid list (don't walk into liquids).
      if (this._pathfinder && !rec.pfLoaded) {
        try {
          const { pathfinder, Movements } = this._pathfinder;
          bot.loadPlugin(pathfinder);
          const moves = new Movements(bot);
          moves.canDig = false;
          moves.allow1by1towers = false;
          moves.maxDropDown = 3;                 // don't leap off big cliffs
          moves.infiniteLiquidDropdownDistance = false;
          // Mobility stays at the library defaults: parkour and sprinting are
          // what let a bot hop a 1-block ledge, cross a gap or get around a
          // tree. Turning them off is what left bots stuck against trivial
          // obstacles — the stutter they seemed to cause came from a starved
          // event loop, which is handled by the path gate instead.
          moves.allowParkour = true;
          moves.allowSprinting = true;
          try {
            const md = require('minecraft-data')(bot.version);
            for (const n of ['water', 'lava', 'flowing_water', 'flowing_lava']) {
              const b = md && md.blocksByName && md.blocksByName[n];
              if (b && moves.blocksToAvoid) moves.blocksToAvoid.add(b.id);
            }
          } catch (_) {}
          bot.pathfinder.setMovements(moves);
          // Search budget scales with the swarm: a small test gets the library
          // defaults (full obstacle avoidance), a big one trades some search
          // speed for a responsive event loop. `thinkTimeout` is wall-clock, so
          // it grows as the per-tick slice shrinks — otherwise a bot that only
          // gets 10 ms per tick times out halfway around a tree and gives up.
          const prof = this._movementProfile();
          bot.pathfinder.tickTimeout = prof.tick;
          bot.pathfinder.thinkTimeout = prof.think;
          bot.pathfinder.searchRadius = 192;
          bot.pathfinder.enablePathShortcut = false; // known to get bots stuck on obstacles
          rec.pfLoaded = true;
        } catch (err) { this.log('warn', `pathfinder init: ${err.message}`, rec.username); }
      }

      // Chunk-load verification: for the first bot, report how many chunk
      // columns the server actually sent for the requested view-distance.
      if (id === 1 && !rec.chunkChecked) {
        rec.chunkChecked = true;
        const t = setTimeout(() => {
          rec.timers.delete(t);
          try {
            let cols = 0;
            if (bot.world && typeof bot.world.getColumns === 'function') cols = bot.world.getColumns().length;
            else if (bot.world && bot.world.columns) cols = Object.keys(bot.world.columns).length;
            const vd = this.config.viewDistance;
            const expected = (2 * vd + 1) * (2 * vd + 1);
            this.log('ok', `Chunk check: view-distance=${vd} → server sent ${cols} chunk columns (≈${expected} expected within radius; server's own view-distance may cap this).`, rec.username);
          } catch (e) { this.log('warn', `chunk check failed: ${e.message}`, rec.username); }
        }, 6000);
        rec.timers.add(t);
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
      // A "reconnect" scenario step asked for this disconnect: rejoin on its
      // own schedule, independent of the resilience/backoff logic.
      if (rec.rejoin && this.running) {
        rec.rejoin = false;
        rec.attempts = 0; // a planned rejoin isn't a failure — no backoff
        const ms = rec.rejoinDelayMs || 3000;
        this.log('info', `Scenario reconnect: rejoining in ${Math.round(ms / 1000)}s…`, rec.username);
        const t = setTimeout(() => { rec.timers.delete(t); this._connectSlot(rec.id); }, ms);
        rec.timers.add(t);
        return;
      }
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

  /* ----------------------- resource pack (no download) ------------------ */
  // Walk the server through the same status sequence a real client reports —
  // ACCEPTED → (DOWNLOADED) → SUCCESSFULLY_LOADED — without fetching the file.
  // That releases the server's "waiting for resource pack" join gate, which is
  // what actually blocks a swarm from spawning, while keeping every bot's
  // memory and bandwidth free for the load test itself.
  _ackResourcePack(bot, rec, packet) {
    // During the configuration phase mineflayer answers the pack itself
    // (accepted + loaded, no download). Answering a second time can get the bot
    // kicked for an unexpected packet, so leave that phase to it.
    if (bot._client && bot._client.state === 'configuration') {
      this._logMove(rec, 'info', 'Resource pack: confirmed during configuration (nothing downloaded).');
      return;
    }
    const send = (result) => {
      if (!bot || !bot._client) return;
      // Unknown keys are ignored by the packet serializer, so one payload fits
      // every protocol: old versions want `hash`, 1.20.3+ wants `uuid`.
      try {
        bot._client.write('resource_pack_receive', {
          uuid: packet && packet.uuid,
          hash: (packet && packet.hash) || '',
          result
        });
      } catch (_) {}
    };
    const proto = bot.protocolVersion || (bot._client && bot._client.protocolVersion) || 0;
    send(3); // ACCEPTED
    const t1 = setTimeout(() => {
      rec.timers.delete(t1);
      if (proto >= 765) send(4); // DOWNLOADED — only exists from 1.20.3 on
      const t2 = setTimeout(() => {
        rec.timers.delete(t2);
        send(0); // SUCCESSFULLY_LOADED — the server stops waiting for us
        this._logMove(rec, 'info', 'Resource pack: reported as loaded (nothing downloaded).');
      }, 60 + Math.floor(Math.random() * 120));
      rec.timers.add(t2);
    }, 40 + Math.floor(Math.random() * 80));
    rec.timers.add(t1);
  }

  /* ------------------------- movement scheduling ------------------------ */
  // How much CPU the swarm's pathfinding may take. Small tests get the library
  // defaults and behave like a single well-behaved bot; large ones cap how many
  // bots may search at once and how long each A* slice runs, so the shared
  // event loop (and with it the UI, the stats and every bot's physics) stays
  // responsive instead of stalling in bursts.
  _movementProfile(count) {
    const n = count != null ? count : ((this.config && this.config.count) || 1);
    if (n <= 25) return { slots: Math.max(1, n), tick: 40, think: 10000 };
    if (n <= 100) return { slots: 8, tick: 25, think: 10000 };
    if (n <= 300) return { slots: 6, tick: 15, think: 12000 };
    return { slots: 4, tick: 10, think: 15000 };
  }

  // Per-step movement chatter, sampled: with hundreds of bots the console (and
  // the UI process behind it) can't keep up with every bot narrating every leg.
  _logMove(rec, level, msg) {
    const n = (this.config && this.config.count) || 1;
    if (n <= LOG_SAMPLE_FROM || rec.id <= LOG_SAMPLE_SLOTS) this.log(level, msg, rec.username);
  }

  // When a leg fails, or ends with the bot still in the same spot, give it a
  // physical nudge: face a new direction, jump and walk for a moment. This is
  // what gets a bot over a ledge or off a corner the planner couldn't solve
  // inside its budget.
  async _unstick(rec, gen, before) {
    const bot = rec.bot;
    const p = bot && bot.entity && bot.entity.position;
    if (!p || !before) return;
    const moved = Math.hypot(p.x - before.x, p.z - before.z);
    if (moved > 1.5) { rec.stuck = 0; return; }
    rec.stuck = (rec.stuck || 0) + 1;
    if (rec.stuck < 2) return; // a single failed leg is normal; don't thrash
    this._logMove(rec, 'info', `stuck — nudging free (${rec.stuck})`);
    try {
      await bot.look(Math.random() * Math.PI * 2, 0, true);
      bot.setControlState('forward', true);
      bot.setControlState('jump', true);
      await this._sleep(rec, 450);
      bot.setControlState('jump', false);
      await this._sleep(rec, 300);
      bot.setControlState('forward', false);
    } catch (_) { try { bot.clearControlStates(); } catch (_) {} }
    if (rec.stuck > 4 && bot.entity) { rec.stuck = 0; rec.origin = bot.entity.position.clone(); } // re-anchor roam here
  }
  // Pathfinding is CPU-bound and runs on the same thread as every bot's physics
  // tick. When hundreds of bots search at once the event loop stalls, movement
  // packets go out late and in bursts, and the server reports the bots as
  // lagging (the "stuttering walk" + ping spikes). Letting only a few bots
  // search at a time trades a little path latency for steady movement.
  async _pathSlot(rec, gen, fn) {
    let waited = 0;
    while (this._pathBusy >= this._pathLimit && this.running && this._alive(rec, gen) && waited < 30000) {
      const w = 60 + Math.floor(Math.random() * 90);
      waited += w;
      await this._sleep(rec, w);
    }
    if (!this._alive(rec, gen)) return;
    this._pathBusy++;
    try { return await fn(); }
    finally { this._pathBusy = Math.max(0, this._pathBusy - 1); }
  }

  // How far from a bot it is safe to walk: beyond the chunks the server has
  // actually sent, the bot walks into unloaded terrain and gets pulled back.
  _loadedRadius() {
    const vd = (this.config && this.config.viewDistance) || 4;
    return Math.max(16, vd * 16 - 16);
  }

  /* --------------------------- scenario engine -------------------------- */
  async _runScenarios(rec, gen) {
    const cfg = this.config;
    if (!cfg.scenarios.length) return;
    do {
      const lapStart = Date.now();
      for (const step of cfg.scenarios) {
        if (!this._alive(rec, gen)) return;
        try { await this._runStep(rec, gen, step); }
        catch (err) { this.log('warn', `step "${step.type}": ${err.message}`, rec.username); }
      }
      if (!this._alive(rec, gen) || !cfg.loopScenarios) break;
      // Steps like chat finish instantly. Looping them with no pause would spin
      // the event loop forever — freezing the app and spamming the server — so
      // every lap costs at least MIN_SCENARIO_LAP_MS.
      const lap = Date.now() - lapStart;
      if (lap < MIN_SCENARIO_LAP_MS) await this._sleep(rec, MIN_SCENARIO_LAP_MS - lap);
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
      this._logMove(rec, 'info', `wait ${s}s`);
      await this._sleep(rec, s * 1000);
      return;
    }
    if (type === 'chat') {
      const text = this._expandChat(String(step.text || ''), bot).slice(0, 256);
      if (text) { this._logMove(rec, 'info', `chat: ${text}`); try { bot.chat(text); } catch (_) {} }
      return;
    }
    if (type === 'jump') {
      const s = Math.max(0, Number(step.seconds) || 2);
      this._logMove(rec, 'info', `jump ${s}s`);
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
      this._logMove(rec, 'info', `look around ${s}s`);
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
      this._logMove(rec, 'info', `roam r=${radius} ${s}s`);
      await this._roam(rec, gen, radius, s * 1000);
      return;
    }
    if (type === 'goto') {
      const x = Math.floor(Number(step.x) || 0);
      const y = Math.floor(Number(step.y) || 0);
      const z = Math.floor(Number(step.z) || 0);
      this._logMove(rec, 'info', `goto ${x} ${y} ${z}`);
      await this._goto(rec, gen, x, y, z);
      return;
    }
    if (type === 'reconnect') {
      const s = Math.max(0, Number(step.seconds != null ? step.seconds : 3));
      rec.rejoinDelayMs = s * 1000;
      rec.rejoin = true;
      rec.gen++; // cancel this scenario loop; the fresh join starts a new one
      this.log('info', `reconnect: leaving the server, back in ${s}s`, rec.username);
      try { bot.quit('scenario-reconnect'); } catch (_) { try { bot.end(); } catch (_) {} }
      return;
    }
    if (type === 'chestclick') {
      const slot = Math.max(0, Number(step.slot) || 0);
      await this._chestClick(rec, gen, slot);
      return;
    }
    this.log('warn', `unknown step: ${type}`, rec.username);
  }

  // One pathfinder leg. Returns 'ok', or a short reason the walk didn't finish
  // (noPath, timeout, GoalChanged…) so the caller can retry, nudge or log it.
  async _walk(rec, goal) {
    const bot = rec.bot;
    if (!bot || !bot.pathfinder) return 'no-pathfinder';
    try {
      await bot.pathfinder.goto(goal);
      return 'ok';
    } catch (e) {
      return (e && (e.name || e.message)) ? String(e.name || e.message).slice(0, 60) : 'failed';
    } finally {
      try { bot.pathfinder.setGoal(null); } catch (_) {}
    }
  }

  // Placeholders a chat step may use: {coordinates} (or {coords}) expands to
  // "x y z" at the moment the line is sent, {x} / {y} / {z} to a single axis.
  _expandChat(text, bot) {
    if (text.indexOf('{') === -1) return text;
    const p = bot && bot.entity && bot.entity.position;
    const n = (v) => (p ? String(Math.floor(v)) : '?');
    return text
      .replace(/{coord(?:inate)?s?}/gi, p ? `${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}` : '?')
      .replace(/{x}/gi, n(p && p.x))
      .replace(/{y}/gi, n(p && p.y))
      .replace(/{z}/gi, n(p && p.z));
  }

  async _goto(rec, gen, x, y, z) {
    const bot = rec.bot;
    if (this._pathfinder && bot.pathfinder) {
      const { goals } = this._pathfinder;
      const reach = this._loadedRadius();
      await this._sleep(rec, Math.floor(Math.random() * 600)); // desync the swarm
      let failures = 0;
      for (let leg = 0; leg < 60 && this._alive(rec, gen); leg++) {
        const p = bot.entity && bot.entity.position;
        if (!p) break;
        const dx = x - p.x, dz = z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= 2.5 && Math.abs(p.y - y) <= 2.5) break;
        const before = { x: p.x, y: p.y, z: p.z };
        // A target beyond the chunks the server has sent can't be pathed to —
        // the bot would walk into unloaded terrain and get yanked back. So walk
        // there in legs: each leg ends inside loaded chunks, and the next one
        // starts once the server has streamed the terrain ahead.
        const far = dist > reach;
        let goal;
        if (far) {
          const k = reach / dist;
          // Intermediate legs use a goal that ignores Y: the ground height
          // ahead is unknown, and demanding an exact Y makes every hill or
          // tree between here and there look like "no path".
          goal = new goals.GoalNearXZ(Math.floor(p.x + dx * k), Math.floor(p.z + dz * k), 3);
          if (leg === 0) this._logMove(rec, 'info', `goto: ${Math.round(dist)} blocks away — walking it in legs (loaded area ≈${reach} blocks; raise the render distance for longer hops).`);
        } else {
          // Close in: exact spot first, then progressively looser goals rather
          // than giving up because the exact block is occupied/unreachable.
          goal = failures === 0 ? new goals.GoalNear(x, y, z, 1)
            : (failures === 1 ? new goals.GoalNear(x, y, z, 3) : new goals.GoalNearXZ(x, z, 2));
        }
        const res = await this._pathSlot(rec, gen, () => this._walk(rec, goal));
        if (!this._alive(rec, gen)) break;
        if (res !== 'ok') {
          failures++;
          this._logMove(rec, 'warn', `goto leg: ${res} (try ${failures})`);
          await this._unstick(rec, gen, before);
          if (failures >= 4) { this._logMove(rec, 'warn', 'goto: no route found, giving up on this pass'); break; }
        } else {
          failures = 0; rec.stuck = 0;
          if (!far) break; // arrived
        }
        await this._sleep(rec, 250 + Math.floor(Math.random() * 250));
      }
    } else {
      // Fallback: walk toward the target for a bounded time.
      const end = Date.now() + 20000;
      try { bot.setControlState('forward', true); } catch (_) {}
      while (Date.now() < end && this._alive(rec, gen)) {
        const p = bot.entity && bot.entity.position;
        if (!p) break;
        if (Math.hypot(p.x - x, p.z - z) < 1.5) break;
        try { await bot.look(Math.atan2(-(x - p.x), z - p.z), 0, false); } catch (_) {}
        await this._sleep(rec, 500);
      }
      try { bot.setControlState('forward', false); } catch (_) {}
    }
  }

  async _chestClick(rec, gen, slot) {
    const bot = rec.bot;
    // If a container/GUI is already open, click it; otherwise wait for one to
    // open (e.g. the server opens a menu) for up to 10s, then click the slot.
    let win = bot.currentWindow;
    if (!win) {
      this.log('info', `chest: waiting for a window to open…`, rec.username);
      win = await new Promise((resolve) => {
        let done = false;
        const onOpen = (w) => { if (done) return; done = true; cleanup(); resolve(w); };
        const to = setTimeout(() => { if (done) return; done = true; cleanup(); resolve(null); }, 10000);
        const cleanup = () => { try { bot.removeListener('windowOpen', onOpen); } catch (_) {} clearTimeout(to); rec.timers.delete(to); };
        rec.timers.add(to);
        try { bot.on('windowOpen', onOpen); } catch (_) { done = true; resolve(null); }
      });
    }
    if (!win || !this._alive(rec, gen)) { this.log('warn', `chest: no window opened.`, rec.username); return; }
    this.log('info', `chest: clicking slot ${slot}`, rec.username);
    try { await bot.clickWindow(slot, 0, 0); }
    catch (e) { this.log('warn', `chest click failed: ${e.message}`, rec.username); }
  }

  async _roam(rec, gen, radius, durationMs) {
    const bot = rec.bot;
    const cfg = this.config;
    const end = Date.now() + durationMs;
    const origin = rec.origin || (bot.entity && bot.entity.position);
    if (!origin) return;

    if (this._pathfinder && bot.pathfinder) {
      const { goals } = this._pathfinder;
      // Short legs inside the loaded chunks: a quick search the bot can finish
      // without stalling the event loop, and terrain the server has really sent.
      const reach = Math.max(12, Math.min(radius, this._loadedRadius(), 48));
      await this._sleep(rec, Math.floor(Math.random() * 800)); // desync the swarm
      while (Date.now() < end && this._alive(rec, gen)) {
        const base = (bot.entity && bot.entity.position) || origin;
        const before = { x: base.x, y: base.y, z: base.z };
        const ang = Math.random() * Math.PI * 2;
        const legLen = 6 + Math.random() * Math.max(6, reach - 6);
        let gx = base.x + Math.cos(ang) * legLen;
        let gz = base.z + Math.sin(ang) * legLen;
        // Keep the bot inside its roam radius instead of drifting away.
        const ox = gx - origin.x, oz = gz - origin.z;
        const off = Math.hypot(ox, oz);
        if (off > radius) { const k = radius / off; gx = origin.x + ox * k; gz = origin.z + oz * k; }
        // GoalNearXZ ignores height: the ground level at a random point is
        // unknown, and pinning Y to the bot's current height turns every hill,
        // tree or staircase into an unreachable goal.
        const res = await this._pathSlot(rec, gen, () => this._walk(rec, new goals.GoalNearXZ(Math.floor(gx), Math.floor(gz), 2)));
        if (!this._alive(rec, gen)) break;
        if (res !== 'ok') this._logMove(rec, 'warn', 'roam leg: ' + res);
        await this._unstick(rec, gen, before);
        // A short pause between legs keeps the walk natural and hands the path
        // gate to the next bot in line.
        await this._sleep(rec, 350 + Math.floor(Math.random() * 500));
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

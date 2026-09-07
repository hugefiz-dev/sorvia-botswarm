'use strict';

/*
 * advisor.js — pure logic (no Electron), unit-testable.
 *
 *  - detectServerType(versionName): guess Paper/Purpur/Spigot/Fabric/Vanilla
 *  - parseSparkText(text): pull TPS / MSPT / CPU / memory out of the text that
 *    `/spark tps` and `/spark health` print in chat.
 *  - advise(input): rules-based optimization suggestions, ranked by severity.
 *
 * This does NOT parse Spark's binary profiler dumps (that's a protobuf format);
 * it reads the human-readable /spark tps + /spark health chat output, which is
 * what a developer can copy in seconds.
 */

function detectServerType(name) {
  const s = String(name || '').toLowerCase();
  if (s.includes('purpur')) return 'purpur';
  if (s.includes('paper')) return 'paper';
  if (s.includes('pufferfish')) return 'pufferfish';
  if (s.includes('folia')) return 'folia';
  if (s.includes('spigot')) return 'spigot';
  if (s.includes('fabric')) return 'fabric';
  if (s.includes('forge')) return 'forge';
  if (s.includes('bukkit') || s.includes('craftbukkit')) return 'bukkit';
  if (s.includes('velocity') || s.includes('bungee') || s.includes('waterfall')) return 'proxy';
  if (s.includes('vanilla')) return 'vanilla';
  return 'unknown';
}

function num(m) { return m ? parseFloat(m[1].replace(',', '.')) : null; }

function parseSparkText(text) {
  const t = String(text || '');
  const out = { tps: {}, mspt: {}, cpu: {}, memory: null, found: false, isLink: false, link: null };

  // Detect a pasted Spark web link (that's a /spark profiler report, not the
  // /spark tps + /spark health TEXT the advisor reads).
  const linkMatch = t.match(/https?:\/\/spark\.lucko\.me\/\S+/i);
  if (linkMatch) out.link = linkMatch[0];

  // TPS: "TPS from last 5s, 10s, 1m, 5m, 15m: 20.0, 20.0, 19.9, ..."
  const tpsNums = t.match(/TPS[^:]*:\s*\*?([\d.,]+)[,\s]+\*?([\d.,]+)?[,\s]*\*?([\d.,]+)?/i);
  if (tpsNums) {
    out.tps.s5 = parseFloat(tpsNums[1]);
    if (tpsNums[2]) out.tps.s10 = parseFloat(tpsNums[2]);
    if (tpsNums[3]) out.tps.m1 = parseFloat(tpsNums[3]);
    out.found = true;
  }
  // Generic: any "20.0" near "tps"
  if (out.tps.s5 == null) {
    const g = t.match(/([\d.]+)\s*tps/i);
    if (g) { out.tps.s5 = parseFloat(g[1]); out.found = true; }
  }

  // MSPT: values print as a slash group like "3.1/12.5/28.0/55.2"
  // (min / median / 95%ile / max). Match the NUMERIC slash group so the
  // "(min/med/95%/max)" text label can't fool it.
  const msptLine = t.match(/([\d.]+)\s*\/\s*([\d.]+)\s*\/\s*([\d.]+)(?:\s*\/\s*([\d.]+))?/);
  if (msptLine) {
    const vals = [msptLine[1], msptLine[2], msptLine[3], msptLine[4]].filter((x) => x != null).map(parseFloat);
    out.mspt.median = vals.length >= 2 ? vals[1] : vals[0];
    out.mspt.max = vals[vals.length - 1];
    out.found = true;
  }

  // CPU: "42% (system) ... 61% (process)" — anchor the number to its label.
  const cpuSys = t.match(/([\d.]+)\s*%\s*\(?\s*system/i);
  const cpuProc = t.match(/([\d.]+)\s*%\s*\(?\s*process/i);
  if (cpuSys) out.cpu.system = parseFloat(cpuSys[1]);
  if (cpuProc) out.cpu.process = parseFloat(cpuProc[1]);
  if (cpuSys || cpuProc) out.found = true;

  // Memory: "Memory usage: 4.2 GB / 8.0 GB"
  const mem = t.match(/([\d.]+)\s*(GB|MB)\s*\/\s*([\d.]+)\s*(GB|MB)/i);
  if (mem) {
    const toGb = (v, u) => (u.toUpperCase() === 'MB' ? parseFloat(v) / 1024 : parseFloat(v));
    out.memory = { usedGb: toGb(mem[1], mem[2]), totalGb: toGb(mem[3], mem[4]) };
    out.found = true;
  }

  // If we found a Spark link but no numbers, flag it so the UI can explain.
  if (!out.found && out.link) out.isLink = true;
  return out;
}

// severity: 3 critical, 2 high, 1 medium, 0 tip
function advise(input) {
  const i = input || {};
  const type = (i.serverType || 'unknown').toLowerCase();
  const players = Number(i.players) || 0;
  const ram = Number(i.ramGb) || 0;
  const view = Number(i.viewDistance) || 0;
  const sim = Number(i.simDistance) || 0;
  const tps = i.tps != null ? Number(i.tps) : null;
  const mspt = i.mspt != null ? Number(i.mspt) : null;
  const issue = (i.mainIssue || 'unknown').toLowerCase();
  const flags = !!i.aikarFlags;
  const s = [];

  const add = (severity, area, title, detail, config) => s.push({ severity, area, title, detail, config: config || '' });

  // --- Platform ---
  if (type === 'vanilla' || type === 'bukkit' || type === 'craftbukkit') {
    add(3, 'platform', 'Switch to Paper (or Purpur)',
      'Vanilla/CraftBukkit have almost no performance tuning. Paper fixes hundreds of inefficiencies and exposes the config knobs the tips below rely on. This is the single biggest win.',
      'Download: https://papermc.io  →  drop paper-*.jar in place of your server jar.');
  } else if (type === 'spigot') {
    add(2, 'platform', 'Upgrade Spigot → Paper',
      'Paper is a drop-in Spigot fork with far better performance and the async chunk/entity settings used below.',
      'https://papermc.io (keeps your plugins & worlds).');
  } else if (type === 'forge') {
    add(1, 'platform', 'Consider a performance modpack base',
      'On Forge, add Lithium/Canary-style optimization mods (or run a performance-focused loader) to cut tick time.', '');
  } else if (type === 'fabric') {
    add(1, 'platform', 'Add Fabric performance mods',
      'Lithium, FerriteCore, Krypton and C2ME dramatically reduce MSPT and memory on Fabric.',
      'Lithium + FerriteCore + Krypton + C2ME (ModRinth).');
  }

  // --- RAM / JVM ---
  if (ram > 0 && ram < 4 && players > 10) {
    add(3, 'memory', 'Too little RAM for this player count',
      `${ram} GB is low for ~${players} players. Aim for at least 4–6 GB (more for big worlds/plugins).`,
      '-Xms and -Xmx set to the same value, e.g. -Xmx6G');
  }
  if (!flags && ram >= 4) {
    add(2, 'jvm', 'Use Aikar’s GC flags',
      'Default JVM GC causes lag spikes (long pauses). Aikar’s G1GC flags smooth tick times a lot.',
      '-Xms=Xmx (fixed heap) + Aikar G1 flags: -XX:+UseG1GC -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 ... (generate at flags.sh)');
  }
  if (ram >= 12) {
    add(0, 'jvm', 'Large heap tuning',
      'With 12 GB+, use the large-heap Aikar variant (bump G1 region size / reserve %). Also verify the box actually has the physical RAM free.', '');
  }

  // --- View / simulation distance ---
  if (view >= 10 && players >= 20) {
    add(3, 'chunks', 'View-distance too high for the load',
      `view-distance ${view} with ~${players} players multiplies chunk work. Lower it — players rarely notice 8 vs 12.`,
      'server.properties: view-distance=8   (or per-world in paper config)');
  } else if (view > 12) {
    add(1, 'chunks', 'Lower view-distance a bit',
      `view-distance ${view} is generous. 8–10 is a good balance.`,
      'view-distance=10');
  }
  if (sim === 0 && (type === 'paper' || type === 'purpur' || type === 'pufferfish')) {
    add(1, 'chunks', 'Set simulation-distance lower than view-distance',
      'simulation-distance controls where entities/redstone/tick logic runs. Keeping it low (e.g. 4–6) saves a lot of MSPT while players still SEE far.',
      'server.properties: simulation-distance=5');
  } else if (sim >= 10) {
    add(2, 'chunks', 'simulation-distance is high',
      `simulation-distance ${sim} makes far chunks tick. Drop to 4–6.`,
      'simulation-distance=5');
  } else if (sim > 0 && view > 0 && sim >= view) {
    add(1, 'chunks', 'simulation-distance ≥ view-distance',
      `sim ${sim} and view ${view} are equal. Entities/redstone tick out to simulation-distance, so keeping it as high as view wastes MSPT. Set sim a few chunks lower than view — players still SEE just as far.`,
      `simulation-distance=${Math.max(3, view - 3)}   (view stays ${view})`);
  }

  // --- RAM baseline (even with Aikar flags on) ---
  if (ram > 0 && ram <= 4 && !(ram < 4 && players > 10)) {
    add(1, 'memory', '4 GB is the practical floor',
      'Fine for a small vanilla-ish server, but many plugins or a large/explored world will want 6–8 GB. Watch the memory graph in /spark health — if it sits near the top and GCs often, add RAM.',
      '-Xms=Xmx, e.g. -Xmx6G  (only if the machine has the physical RAM)');
  }

  // --- Baseline Paper/Purpur tuning reminder ---
  if (type === 'paper' || type === 'purpur' || type === 'pufferfish') {
    add(0, 'config', 'Verify the key Paper/Purpur optimizations',
      'Defaults run, but a load test benefits from tuned entity activation ranges, mob spawn caps, hopper optimizations and item-despawn rates. Check these before adding players.',
      'paper-world-defaults.yml: entities.spawning (mob caps), entities.entity-activation-range; hopper.disable-move-event=true; alt-item-despawn-rate');
  }

  // --- Issue-specific ---
  if (issue === 'entities' || issue === 'mobs') {
    add(2, 'entities', 'Tighten entity/mob settings',
      'Too many mobs or item entities is a classic MSPT killer. Cap spawns, merge items, and despawn faster.',
      'paper: entity-spawning mob caps ↓, merge-radius item=3 exp=4, despawn-ranges soft=28 hard=48; spigot.yml mob-spawn-range=4');
  }
  if (issue === 'redstone') {
    add(2, 'redstone', 'Redstone / tick machines',
      'Redstone contraptions and hoppers are heavy. Use Paper’s optimizations and consider limiting farms.',
      'paper: use-faster-eigencraft-redstone=true; hopper.disable-move-event=true; alt-item-despawn-rate for drops');
  }
  if (issue === 'chunks' || issue === 'gen' || issue === 'worldgen') {
    add(2, 'chunks', 'Chunk generation / loading pressure',
      'Lots of exploration or /tp spreads chunk gen across the main thread. Pre-generate the world and cap chunk load rate.',
      'Pre-generate with Chunky plugin; paper: max-auto-save-chunks-per-tick↓, keep-spawn-loaded-range↓');
  }
  if (issue === 'gc' || issue === 'memory') {
    add(3, 'jvm', 'GC pauses causing lag spikes',
      'Sawtooth memory + periodic freezes = GC pauses. Fix the heap flags and don’t over-allocate beyond physical RAM.',
      'Fixed -Xms=Xmx, Aikar G1 flags; add FerriteCore/Hydrogen if modded.');
  }
  if (issue === 'plugins') {
    add(2, 'plugins', 'A plugin is eating tick time',
      'Use Spark’s profiler (/spark profiler) and read the tree — the top self-time entries name the culprit plugin/method. Update or replace it.',
      '/spark profiler --timeout 120  then open the report and expand the hottest branch.');
  }

  // --- Entity count (from Spark world stats) ---
  const entities = i.entities != null ? Number(i.entities) : null;
  if (entities != null) {
    if (entities > 20000) {
      add(3, 'entities', `Very high entity count (${entities})`,
        'This many entities alone can tank MSPT. Cap mob spawns, cull/merge items, and check for entity farms or accumulation in loaded chunks.',
        'paper mob caps ↓, merge-radius item=3, despawn-ranges soft=28 hard=48; find hotspots with /spark profiler');
    } else if (entities > 10000) {
      add(2, 'entities', `High entity count (${entities})`,
        'Entity ticking is likely a big share of your MSPT. Tighten spawn caps and despawn ranges.',
        'paper: entity-activation-range ↓, mob caps ↓');
    }
  }

  // --- Hottest profiled method (names the culprit) ---
  if (i.hotMethod && i.hotMethod.label) {
    add(1, 'profiler', `Hottest method: ${i.hotMethod.label} (${i.hotMethod.pct}%)`,
      'This method used the most self-time in the profile. If it belongs to a plugin/mod, update or reconfigure it; if it’s vanilla entity/chunk/redstone code, apply the matching item above. Expand it in the Spark report to see the call path.',
      '');
  }

  // --- Metric-driven ---
  if (mspt != null && mspt > 50) {
    add(3, 'tick', `MSPT ${mspt}ms > 50ms (server can’t keep 20 TPS)`,
      'Anything over 50ms/tick means the server is falling behind. Apply the chunk + entity + JVM items above; profile to find the top offender.', '');
  } else if (mspt != null && mspt > 35) {
    add(2, 'tick', `MSPT ${mspt}ms is getting high`,
      'You have headroom now but little margin under load. Trim view/sim distance and entity work before adding players.', '');
  }
  if (tps != null && tps < 19) {
    add(3, 'tick', `TPS ${tps} below 19`,
      'Players will feel this as lag. Combine the fixes above; if TPS drops only under load, it’s usually chunks + entities.', '');
  }

  // --- No metrics loaded ---
  if (tps == null && mspt == null) {
    add(0, 'metrics', 'No Spark numbers loaded',
      'Advice below is from your inputs. Paste the TEXT of /spark tps and /spark health (run them in-game — they print numbers in chat) to unlock TPS/MSPT-based checks.',
      '');
  }

  // --- Unknown issue → how to find it ---
  if (issue === 'unknown') {
    add(0, 'monitor', 'Not sure what’s lagging? Profile it',
      'Run /spark profiler during peak (or during your bot test), open the report link, and expand the hottest self-time branch — it names the cause (a plugin, entities, chunk gen, redstone…).',
      '/spark profiler --timeout 120');
  }

  // --- General good practice ---
  add(0, 'monitor', 'Keep profiling with Spark',
    'Run /spark profiler during your bot test, then /spark tps and /spark health after. Compare before/after each change so you know what actually helped.',
    '/spark profiler --timeout 300');

  if (players >= 60) {
    add(1, 'network', 'High player count — check network & async',
      'At 60+ players, network compression threshold and async settings matter. Ensure the host has real cores (not shared vCPU) and low latency.',
      'server.properties: network-compression-threshold=256 (or -1 on LAN)');
  }

  s.sort((a, b) => b.severity - a.severity);
  return s;
}

module.exports = { detectServerType, parseSparkText, advise };

'use strict';

/*
 * spark-fetch.js — download and decode a spark profiler report from its URL.
 *
 * Flow:
 *   1. Extract the report CODE from a https://spark.lucko.me/CODE link.
 *   2. GET https://spark-usercontent.lucko.me/CODE  (raw bytebin data).
 *   3. The Content-Type says the kind (application/x-spark-sampler = profiler).
 *   4. Body is gzip-compressed protobuf → inflate → decode as SamplerData.
 *   5. Extract: platform (type/version), live stats (TPS/MSPT/CPU/RAM/players),
 *      world entity counts, exported server configs (view/simulation-distance),
 *      and the hottest methods by self-time (the "most resource-using tasks").
 *
 * Schema is embedded below (subset of lucko/spark's spark.proto + sampler),
 * with only the fields we read — protobuf skips the rest safely.
 */

const zlib = require('zlib');
let protobuf = null;
try { protobuf = require('protobufjs'); } catch (_) {}

const PROTO = `
syntax = "proto3";
package spark;

message SamplerData {
  SamplerMetadata metadata = 1;
  repeated ThreadNode threads = 2;
  map<int32, WindowStatistics> time_window_statistics = 7;
}
message SamplerMetadata {
  PlatformMetadata platform_metadata = 7;
  PlatformStatistics platform_statistics = 8;
  SystemStatistics system_statistics = 9;
  map<string, string> server_configurations = 10;
  int32 number_of_ticks = 12;
  map<string, string> extra_platform_metadata = 14;
}
message PlatformMetadata {
  int32 type = 1;
  string name = 2;
  string version = 3;
  string minecraft_version = 4;
  int32 spark_version = 7;
  string brand = 8;
}
message PlatformStatistics {
  Memory memory = 1;
  int64 uptime = 3;
  Tps tps = 4;
  Mspt mspt = 5;
  int64 player_count = 7;
  WorldStatistics world = 8;
  int32 online_mode = 9;
}
message SystemStatistics {
  Cpu cpu = 1;
  int64 uptime = 7;
}
message Cpu { int32 threads = 1; Usage process_usage = 2; Usage system_usage = 3; string model_name = 4; }
message Usage { double last1m = 1; double last15m = 2; }
message Memory { MemoryUsage heap = 1; MemoryUsage non_heap = 2; }
message MemoryUsage { int64 used = 1; int64 committed = 2; int64 init = 3; int64 max = 4; }
message Tps { double last1m = 1; double last5m = 2; double last15m = 3; int32 game_target_tps = 4; }
message Mspt { RollingAverageValues last1m = 1; RollingAverageValues last5m = 2; int32 game_max_ideal_mspt = 3; }
message RollingAverageValues { double mean = 1; double max = 2; double min = 3; double median = 4; double percentile95 = 5; }
message WorldStatistics { int32 total_entities = 1; map<string, int32> entity_counts = 2; }
message WindowStatistics {
  int32 ticks = 1; double cpu_process = 2; double cpu_system = 3; double tps = 4;
  double mspt_median = 5; double mspt_max = 6; int32 players = 7; int32 entities = 8;
  int32 tile_entities = 9; int32 chunks = 10;
}
message ThreadNode {
  string name = 1;
  repeated StackTraceNode children = 3;
  repeated double times = 4;
  repeated int32 children_refs = 5;
}
message StackTraceNode {
  string class_name = 3;
  string method_name = 4;
  int32 parent_line_number = 5;
  int32 line_number = 6;
  string method_desc = 7;
  repeated double times = 8;
  repeated int32 children_refs = 9;
}
`;

let TYPE = null;
function samplerType() {
  if (TYPE) return TYPE;
  if (!protobuf) throw new Error('protobufjs not installed');
  const root = protobuf.parse(PROTO, { keepCase: true }).root;
  TYPE = root.lookupType('spark.SamplerData');
  return TYPE;
}

function codeFromUrl(url) {
  const s = String(url || '').trim();
  const m = s.match(/(?:spark\.lucko\.me|spark-usercontent\.lucko\.me)\/([A-Za-z0-9]+)/i);
  if (m) return m[1];
  // maybe they pasted just the code
  if (/^[A-Za-z0-9]{6,}$/.test(s)) return s;
  return null;
}

function sum(arr) { let t = 0; if (arr) for (const v of arr) t += (+v || 0); return t; }
function toGb(bytes) { return bytes ? Number(bytes) / (1024 * 1024 * 1024) : 0; }

const SERVER_TYPES = ['purpur', 'pufferfish', 'folia', 'paper', 'spigot', 'fabric', 'forge', 'bukkit', 'vanilla'];
function typeFrom(brand, name) {
  const s = ((brand || '') + ' ' + (name || '')).toLowerCase();
  for (const t of SERVER_TYPES) if (s.includes(t)) return t === 'folia' ? 'paper' : t;
  return 'unknown';
}

// Walk a thread's flat node array via children_refs, summing self-time per method.
function accumulateSelfTimes(thread, acc) {
  const nodes = thread.children || [];
  if (!nodes.length) return;
  for (const node of nodes) {
    const total = sum(node.times);
    let childTotal = 0;
    const refs = node.children_refs || [];
    for (const r of refs) { const c = nodes[r]; if (c) childTotal += sum(c.times); }
    const self = Math.max(0, total - childTotal);
    if (self <= 0) continue;
    const cls = node.class_name || '';
    const method = node.method_name || '';
    const key = cls ? `${cls}.${method}` : (method || '(unknown)');
    acc.set(key, (acc.get(key) || 0) + self);
  }
}

function shortLabel(key) {
  // net.minecraft.server.level.ServerLevel.tick -> ServerLevel.tick (keep package hint)
  const parts = key.split('.');
  if (parts.length <= 2) return key;
  const method = parts.pop();
  const cls = parts.pop();
  return `${cls}.${method}`;
}

function guessIssue(topMethods, entities) {
  const blob = topMethods.slice(0, 6).map((m) => m.key.toLowerCase()).join(' ');
  const nonMc = topMethods.slice(0, 5).find((m) => {
    const k = m.key.toLowerCase();
    return k && !/^(net\.minecraft|com\.mojang|java\.|jdk\.|sun\.|io\.netty|org\.bukkit|org\.spigotmc|io\.papermc|net\.minecraftforge|net\.fabricmc)/.test(k);
  });
  if (/redstone|piston|hopper/.test(blob)) return 'redstone';
  if (/chunk|noise|worldgen|chunkmap|chunkstatus/.test(blob)) return 'chunks';
  if (/entity|livingentity|mob|pathfind|goal|navigation|ai\./.test(blob)) return 'entities';
  if (nonMc) return 'plugins';
  if (entities && entities > 12000) return 'entities';
  return 'unknown';
}

function deepFind(obj, keyName, depth) {
  if (obj == null || depth > 6) return undefined;
  if (typeof obj !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, keyName)) return obj[keyName];
  for (const k of Object.keys(obj)) {
    const v = deepFind(obj[k], keyName, depth + 1);
    if (v !== undefined) return v;
  }
  return undefined;
}

function extractConfigs(map) {
  const out = { viewDistance: null, simDistance: null, files: [] };
  if (!map) return out;
  for (const [name, raw] of Object.entries(map)) {
    out.files.push(name);
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) { continue; }
    const vd = deepFind(parsed, 'view-distance', 0);
    const sd = deepFind(parsed, 'simulation-distance', 0);
    if (out.viewDistance == null && vd != null) out.viewDistance = parseInt(vd, 10);
    if (out.simDistance == null && sd != null) out.simDistance = parseInt(sd, 10);
  }
  return out;
}

async function fetchSparkReport(url) {
  const code = codeFromUrl(url);
  if (!code) return { ok: false, error: 'bad-url' };
  if (!protobuf) return { ok: false, error: 'no-protobuf' };

  let res;
  try {
    res = await fetch(`https://spark-usercontent.lucko.me/${code}`, {
      headers: { 'User-Agent': 'Sorvia-BotSwarm' }
    });
  } catch (e) { return { ok: false, error: 'network: ' + e.message }; }
  if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };

  const ct = res.headers.get('content-type') || '';
  if (/heap/i.test(ct)) return { ok: false, error: 'heap-report' };
  if (/health/i.test(ct)) return { ok: false, error: 'health-report' };

  let buf = Buffer.from(await res.arrayBuffer());
  // Inflate if gzip-compressed (spark stores gzipped protobuf).
  try {
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  } catch (_) { /* not gzip / already inflated */ }

  let out;
  try { out = decodeSampler(buf); }
  catch (e) { return { ok: false, error: 'decode: ' + e.message }; }
  out.ok = true; out.code = code;
  return out;
}

function decodeSampler(buf) {
  const data = samplerType().decode(buf);
  const meta = data.metadata || {};
  const pm = meta.platform_metadata || {};
  const ps = meta.platform_statistics || {};
  const ss = meta.system_statistics || {};

  const serverType = typeFrom(pm.brand, pm.name);
  const mcVersion = pm.minecraft_version || '';

  const tps = ps.tps ? {
    last1m: round(ps.tps.last1m), last5m: round(ps.tps.last5m), last15m: round(ps.tps.last15m)
  } : null;
  let mspt = null;
  if (ps.mspt && ps.mspt.last1m) {
    mspt = {
      median: round(ps.mspt.last1m.median), max: round(ps.mspt.last1m.max),
      p95: round(ps.mspt.last1m.percentile95), mean: round(ps.mspt.last1m.mean)
    };
  }
  let cpu = null;
  if (ss.cpu) {
    cpu = {
      process: ss.cpu.process_usage ? Math.round(ss.cpu.process_usage.last1m * 100) : null,
      system: ss.cpu.system_usage ? Math.round(ss.cpu.system_usage.last1m * 100) : null,
      model: ss.cpu.model_name || null, threads: ss.cpu.threads || null
    };
  }
  let heapUsedGb = null, heapMaxGb = null;
  if (ps.memory && ps.memory.heap) {
    heapUsedGb = round(toGb(ps.memory.heap.used));
    heapMaxGb = round(toGb(ps.memory.heap.max));
  }
  const players = ps.player_count != null ? Number(ps.player_count) : null;

  let entities = null, entityTop = [];
  if (ps.world) {
    entities = ps.world.total_entities || null;
    const ec = ps.world.entity_counts || {};
    entityTop = Object.entries(ec).map(([k, v]) => ({ type: k, count: v }))
      .sort((a, b) => b.count - a.count).slice(0, 8);
  }

  const configs = extractConfigs(meta.server_configurations);

  // Hottest methods (self-time) across all threads.
  const acc = new Map();
  for (const thread of (data.threads || [])) accumulateSelfTimes(thread, acc);
  let grand = 0; for (const v of acc.values()) grand += v;
  const topMethods = Array.from(acc.entries())
    .map(([key, self]) => ({ key, label: shortLabel(key), self, pct: grand ? +(100 * self / grand).toFixed(1) : 0 }))
    .sort((a, b) => b.self - a.self).slice(0, 12);

  const onlineMode = ps.online_mode === 1 ? 'offline' : ps.online_mode === 2 ? 'online' : 'unknown';
  const suggestedIssue = guessIssue(topMethods, entities);

  return {
    serverType, brand: pm.brand || pm.name || '', mcVersion,
    tps, mspt, cpu, heapUsedGb, heapMaxGb, players, entities, entityTop,
    configs, topMethods, onlineMode, suggestedIssue
  };
}

function round(v) { return v == null ? null : Math.round(v * 100) / 100; }

module.exports = { fetchSparkReport, decodeSampler, _internal: { extractConfigs, guessIssue, accumulateSelfTimes, samplerType } };

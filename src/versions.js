'use strict';

/*
 * Version provider.
 *
 * Goal (from spec): every time the app launches, check Minecraft versions
 * online and keep the version dropdown current WITHOUT needing an app update.
 *
 * How it works:
 *   1. We read the set of versions the installed protocol stack can actually
 *      speak (via `minecraft-data`, which mineflayer uses under the hood).
 *   2. We fetch Mojang's official version manifest for the up-to-date, ordered
 *      list of releases + release dates.
 *   3. We intersect them: the dropdown shows every release Mojang lists that
 *      our bot engine can actually connect with, newest first.
 *
 * When mineflayer/minecraft-data later gains support for a brand-new MC
 * release, it automatically appears here on the next launch — no rebuild.
 *
 * Offline fallback: if the manifest can't be fetched, we return the locally
 * supported set so the app still works.
 */

const MANIFEST_URL =
  'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

let cache = null; // { supported:[], generatedAt, source }

function getSupportedSet() {
  // Versions the installed engine can actually CONNECT with.
  // Source of truth = node-minecraft-protocol's supportedVersions (the protocol
  // layer mineflayer uses to log in). Using minecraft-data's full list here was
  // the bug: it includes versions/snapshots the protocol can't speak (e.g. 26.2,
  // 26.3-snapshot), which caused "invalid protocol" on connect.
  const set = new Set();
  try {
    const mp = require('minecraft-protocol');
    const list = Array.isArray(mp.supportedVersions)
      ? mp.supportedVersions
      : (mp.supportedVersions && mp.supportedVersions.pc) || [];
    for (const v of list) set.add(v);
  } catch (err) { /* leave empty -> caller handles */ }
  return set;
}

// crude semver-ish comparison for "1.20.4" style strings (desc order helper)
function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function fetchManifest(timeoutMs = 8000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(MANIFEST_URL, { signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function getVersions(force = false) {
  if (cache && !force) return cache;

  const supported = getSupportedSet();
  let list = [];
  let source = 'local';

  try {
    const manifest = await fetchManifest();
    const releases = (manifest.versions || []).filter(
      (v) => v.type === 'release'
    );
    // Keep only releases our engine can actually speak.
    list = releases
      .filter((v) => supported.has(v.id))
      .map((v) => ({ id: v.id, releaseTime: v.releaseTime }));
    source = 'mojang';
    if (list.length === 0) throw new Error('no-supported-overlap');
  } catch (err) {
    // Offline / blocked / no overlap -> fall back to local supported set.
    list = Array.from(supported)
      .filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v))
      .map((id) => ({ id, releaseTime: null }));
    source = 'local';
  }

  // Sort newest-first.
  list.sort((a, b) => cmpVersion(a.id, b.id));

  // De-dup while preserving order.
  const seen = new Set();
  const deduped = [];
  for (const item of list) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }

  cache = {
    supported: deduped,
    latest: deduped.length ? deduped[0].id : null,
    generatedAt: new Date().toISOString(),
    source
  };
  return cache;
}

module.exports = { getVersions };

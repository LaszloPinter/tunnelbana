// Turns data/platforms.json + data/routes.json into data/platform-plan.json:
// for every station, its platforms grouped by LEVEL, and for each platform the
// services that call there and which way they are pointing.
//
// Two facts the game cannot get anywhere else:
//
//   LEVEL. OSM tags a platform with the storey it is on. T-Centralen is -2,
//   -3 and -4; Fridhemsplan and Odenplan are -2 and -4. Platforms sharing a
//   level stand side by side and you can walk between them; platforms on
//   different levels are separate rooms and you need a shaft.
//
//   WHO STOPS WHERE. A route relation's stop node sits ON the track, so the
//   platform a service uses is settled by which platform polygon that node
//   stands next to. This is what distinguishes the two arrangements the game
//   has to draw: at most interchanges each island belongs to one LINE and
//   takes both directions, but at Gamla stan and Slussen the islands are split
//   by DIRECTION, one takes green and red northbound, the other takes both
//   southbound, and no amount of platform geometry says which is which.
//
//   node --experimental-strip-types scripts/build-platform-plan.mjs
//
// Data © OpenStreetMap contributors, ODbL.

import { readFileSync, writeFileSync } from 'node:fs';
import { SERVICES } from '../src/core/network.ts';

const platforms = JSON.parse(readFileSync('data/platforms.json', 'utf8'));
const routes = JSON.parse(readFileSync('data/routes.json', 'utf8'));

/** a platform shorter than this is an entrance stub, not somewhere a train stops */
const MIN_PLATFORM_M = 60;
/** how far a stop node may stand from the platform it serves */
const MAX_STOP_M = 40;

const toLocal = (lat, lon, lat0, lon0) => [
  (lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180),
  (lat - lat0) * 110540,
];

const svcById = new Map(SERVICES.map((s) => [s.id, s]));

/** the storey a platform is on. `level` is the storey proper; `layer` is
 * drawing order and stands in where it is the only one tagged */
const levelOf = (tags) => {
  const raw = tags?.level ?? tags?.layer;
  const n = raw === undefined ? NaN : Number(String(raw).split(';')[0]);
  return Number.isFinite(n) ? n : null;
};

/**
 * Which way along the service's station list a route is running WHERE IT CALLS,
 * taken from the order of its own calls, not from its terminus.
 *
 * The terminus is the obvious handle and it is the wrong one: OSM runs line 17
 * to Hasselby strand where the game runs it to Akeshov, so matching on the
 * name dropped one direction of 17 and 18 outright and left half of Gamla
 * stan's northbound platform empty. Consecutive calls cannot lie about which
 * way the train is pointing.
 */
const dirAt = (svc, here, neighbour, ahead) => {
  const i = svc.stations.indexOf(here);
  const j = svc.stations.indexOf(neighbour);
  if (i < 0 || j < 0 || i === j) return null;
  return (j > i ? 1 : -1) * (ahead ? 1 : -1);
};

const out = { source: routes.source, built: new Date().toISOString(), stations: {} };
const notes = [];

// every platform polygon we hold, by its OSM identity, this is the join
const byOsm = new Map();
const ownerOf = new Map();
for (const st of platforms.stations) {
  for (const p of st.platforms ?? []) {
    byOsm.set(`${p.osmType}/${p.osmId}`, p);
    ownerOf.set(`${p.osmType}/${p.osmId}`, st);
  }
}

/** platformId -> [{service, dir}] */
const serves = new Map();
let exact = 0;
let byProximity = 0;
let unplaced = 0;

for (const route of routes.routes) {
  const svc = svcById.get(route.ref);
  if (!svc) continue;
  const stopCalls = route.calls
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.type === 'node' && /^stop/.test(c.role));
  // calls alternate stop, platform: a stop names the station, the platform
  // that follows it says exactly which one the train pulls up at, which is the
  // only thing that works where platforms are STACKED, in plan view a station
  // on three levels is three platforms drawn on top of each other, so nothing
  // measured across the ground can tell them apart
  for (let n = 0; n < stopCalls.length; n++) {
    const { c: call, i } = stopCalls[n];
    {
      // the station after this one tells the heading; at the last call, the one
      // before it does, read backwards
      const after = stopCalls[n + 1]?.c.name;
      const before = stopCalls[n - 1]?.c.name;
      const dir =
        (after ? dirAt(svc, call.name, after, true) : null) ??
        (before ? dirAt(svc, call.name, before, false) : null);
      if (dir === null) continue;
      const next = route.calls[i + 1];
      const key = next && /^platform/.test(next.role) ? `${next.type}/${next.ref}` : null;
      let hit = key && byOsm.has(key) ? key : null;
      if (hit) exact += 1;
      else {
        // The route points at a platform we hold no polygon for, some are
        // mapped as a node, some as the edge line rather than the area. Match
        // it by the storey it declares: at a stacked station the platforms sit
        // on top of each other in plan view, so proximity alone would put a
        // red-line train on the green-line platform. Level first, ground
        // distance only to choose between platforms on the SAME level.
        const st = platforms.stations.find((x) => x.name === call.name);
        if (!st || call.lat === undefined) {
          unplaced += 1;
          continue;
        }
        const memberLevel = levelOf(next?.tags);
        const cands = (st.platforms ?? []).filter((p) => p.lengthM >= MIN_PLATFORM_M);
        const levels = new Set(cands.map((p) => levelOf(p.tags)).filter((l) => l !== null));
        const sameLevel = memberLevel === null ? cands : cands.filter((p) => levelOf(p.tags) === memberLevel);
        const pool = sameLevel.length > 0 ? sameLevel : cands;
        // if the station is stacked and we could not tell which storey, guessing
        // is worse than admitting it
        if (levels.size > 1 && sameLevel.length === 0) {
          unplaced += 1;
          notes.push(
            `${call.name}: line ${route.ref} ${dir > 0 ? '→' : '←'}: stacked station, member declares no level`,
          );
          continue;
        }
        // Measure from BOTH anchors and take whichever lands closer: the stop
        // node sits on the track beside the platform, the platform member is
        // the platform itself, but a member mapped as a long edge line or a
        // multipolygon can have a centroid nowhere near this station, so
        // neither can be trusted alone.
        let bestD = Infinity;
        for (const src of [next, call]) {
          if (!src || src.lat === undefined) continue;
          const [sx, sy] = toLocal(src.lat, src.lon, st.lat, st.lon);
          for (const p of pool) {
            for (const [px, py] of p.points) {
              const d = Math.hypot(px - sx, py - sy);
              if (d < bestD) {
                bestD = d;
                hit = `${p.osmType}/${p.osmId}`;
              }
            }
          }
        }
        // where the station has exactly one platform there is nothing to be
        // wrong about, whatever the distance says, several are mapped with
        // their station node up at the street entrance
        if (!hit || (bestD > MAX_STOP_M && pool.length > 1)) {
          unplaced += 1;
          notes.push(
            `${call.name}: line ${route.ref} ${dir > 0 ? '→' : '←'} has no platform (nearest ${bestD === Infinity ? 'none' : Math.round(bestD) + 'm'})`,
          );
          continue;
        }
        byProximity += 1;
      }
      const at = serves.get(hit) ?? [];
      at.push({ service: route.ref, dir, to: route.to });
      serves.set(hit, at);
    }
  }
}

for (const st of platforms.stations) {
  const built = (st.platforms ?? [])
    .map((p) => ({
      osmId: p.osmId,
      osmType: p.osmType,
      level: levelOf(p.tags),
      lengthM: Math.round(p.lengthM * 10) / 10,
      widthM: p.widthM,
      closed: p.closed,
      serves: (serves.get(`${p.osmType}/${p.osmId}`) ?? [])
        .filter((s, i, arr) => arr.findIndex((q) => q.service === s.service && q.dir === s.dir) === i)
        .sort((a, b) => a.service.localeCompare(b.service) || a.dir - b.dir),
    }))
    .filter((p) => p.serves.length > 0);
  if (built.length === 0) continue;

  // A station where nothing is tagged is one level by definition. Where only
  // SOME platforms are tagged, the untagged ones join the shallowest level
  // rather than inventing a storey of their own.
  const known = built.map((p) => p.level).filter((l) => l !== null);
  const fallback = known.length ? Math.max(...known) : 0;
  for (const p of built) if (p.level === null) p.level = fallback;

  const levels = [...new Set(built.map((p) => p.level))].sort((a, b) => b - a);
  out.stations[st.name] = {
    levels: levels.map((level) => ({ level, platforms: built.filter((p) => p.level === level) })),
  };
}

console.log(`calls placed: ${exact} by OSM id, ${byProximity} by proximity, ${unplaced} unplaced`);

writeFileSync('data/platform-plan.json', JSON.stringify(out, null, 1));

// ---- what we got -----------------------------------------------------------
const names = Object.keys(out.stations);
const multi = names.filter((n) => out.stations[n].levels.length > 1);
const colorOf = (id) => svcById.get(id)?.color ?? '?';
const byDirection = names.filter((n) =>
  out.stations[n].levels.some((l) =>
    l.platforms.some((p) => new Set(p.serves.map((s) => colorOf(s.service))).size > 1),
  ),
);

console.log(`${names.length}/${platforms.stations.length} stations planned`);
console.log(`\nstacked over more than one level (${multi.length}):`);
for (const n of multi) {
  const l = out.stations[n].levels;
  console.log(
    `  ${n.padEnd(18)} ${l.map((x) => `${x.level}:[${x.platforms.map((p) => [...new Set(p.serves.map((s) => colorOf(s.service)))].join('+')).join(' ')}]`).join('  ')}`,
  );
}
console.log(`\nplatforms shared by more than one LINE. The direction-paired ones (${byDirection.length}):`);
for (const n of byDirection) {
  for (const l of out.stations[n].levels) {
    for (const p of l.platforms) {
      const cols = [...new Set(p.serves.map((s) => colorOf(s.service)))];
      if (cols.length < 2) continue;
      console.log(
        `  ${n.padEnd(14)} level ${String(l.level).padStart(2)}  ${p.serves.map((s) => `${s.service}${s.dir > 0 ? '→' : '←'}`).join(' ')}`,
      );
    }
  }
}
if (notes.length) console.log(`\nnotes:\n  ${notes.join('\n  ')}`);

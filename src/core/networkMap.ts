import raw from '../../data/platforms.json' with { type: 'json' };
import * as C from '../config.ts';
import { dcos, dsin, datan2, dist } from '../sim/det.ts';
import { legBetween } from '../data/legGeometry.ts';
import { departuresFrom } from './network.ts';

/**
 * THE WHOLE NETWORK, ON ONE MAP.
 *
 * Every station in the tunnelbana has a real position, data/platforms.json
 * carries lat and lon for all hundred of them, and a bearing for each platform,
 * so the network does not need inventing. It needs projecting.
 *
 * This is the foundation the tunnel rework stands on. Until now there was no
 * such thing as "the network" in the code: one station existed at a time, in
 * its own coordinate space, and everything else was extrapolated from it, the
 * tunnel was the current station's geometry stretched outward, the next station
 * was a container nudged along x, and the world WRAPPED when a train ran far
 * enough that the whole thing could be rebuilt as somewhere else. Every seam
 * bug came from that: two stations disagreeing about where the ground was,
 * because neither of them was anywhere in particular.
 *
 * Here a station is somewhere. Slussen is at a point, Gamla stan is 600 m from
 * it on a bearing, and the tunnel between them is a curve joining the two. No
 * wrap, no re-layout, no seam, the seam was an artefact of not having a map.
 *
 * ---- the projection ----
 *
 * Equirectangular about the network's own centre. Over a city twenty
 * kilometres across the error against a proper conformal projection is metres,
 * which is nothing next to LEG_SCALE, the game already draws legs at 0.42 of
 * their real length so that a walk between stations is not two and a half
 * minutes of empty tunnel (§config). Real proportions, playable distances.
 *
 * ---- determinism ----
 *
 * This is `src/core`, so it is simulation: where a station sits decides where
 * everything on it sits. Trig comes from sim/det.ts, never from Math, and the
 * whole map is a pure function of the data file. Two clients build the same
 * network without exchanging a word.
 */

interface RawPlatform {
  angleDeg?: number;
  lengthM?: number;
  widthM?: number;
}
interface RawStation {
  name: string;
  lat: number;
  lon: number;
  platforms?: RawPlatform[];
}

const STATIONS = (raw as { stations: RawStation[] }).stations.filter(
  (s) => typeof s.lat === 'number' && typeof s.lon === 'number',
);

/** metres per degree of latitude; near enough anywhere, and exact enough here */
const M_PER_DEG_LAT = 111_132;

export interface MapStation {
  name: string;
  /** where it is, in game px, on the network's own map */
  x: number;
  y: number;
  /** the direction the platform runs, radians, +x is east */
  angle: number;
  /** how long the platform really is, in px */
  lengthPx: number;
}

/** the centre of the network, so the map's origin is somewhere meaningful */
const centre = (() => {
  let lat = 0;
  let lon = 0;
  for (const s of STATIONS) {
    lat += s.lat;
    lon += s.lon;
  }
  return { lat: lat / STATIONS.length, lon: lon / STATIONS.length };
})();

/** metres per degree of longitude shrinks with latitude; Stockholm is at 59.3° */
const M_PER_DEG_LON = M_PER_DEG_LAT * dcos((centre.lat * Math.PI) / 180);

/** real metres -> game px, the same 0.42 the rest of the game already uses */
const toPx = (metres: number) => metres * C.LEG_SCALE * C.PX_PER_M;

function project(lat: number, lon: number): { x: number; y: number } {
  return {
    x: toPx((lon - centre.lon) * M_PER_DEG_LON),
    // north is up: latitude increases northward, screen y increases downward
    y: -toPx((lat - centre.lat) * M_PER_DEG_LAT),
  };
}

const byName = new Map<string, MapStation>();
for (const s of STATIONS) {
  const p = project(s.lat, s.lon);
  // the platform's own bearing, where OSM knew it. angleDeg is measured the
  // way a compass is, so it becomes a screen angle by the usual quarter turn.
  const plat = (s.platforms ?? []).find((q) => typeof q.angleDeg === 'number');
  const angle = plat ? ((plat.angleDeg as number) * Math.PI) / 180 : 0;
  byName.set(s.name, {
    name: s.name,
    x: p.x,
    y: p.y,
    angle,
    lengthPx: toPx(plat?.lengthM ?? 140),
  });
}

export const mapStation = (name: string): MapStation | undefined => byName.get(name);
export const allMapStations = (): MapStation[] => [...byName.values()];

/**
 * The tunnel between two adjacent stations, as a curve in the plane.
 *
 * A cubic Hermite from one platform's end to the other's, leaving and arriving
 * along the platforms' own bearings, a train cannot turn at a platform, so the
 * tunnel has to. The tangent lengths are a third of the leg, which is the usual
 * choice for a Hermite that should look like a road rather than a rubber band.
 *
 * The result is C1 at both ends by construction: the same curve is produced
 * whichever end you ask from, so two stations cannot disagree about the ground
 * between them. That disagreement was the seam.
 */
export interface LegPath {
  from: string;
  to: string;
  /** px along the curve, which is a little more than the straight-line distance */
  lengthPx: number;
  /** the point at u in 0..1 */
  at(u: number): { x: number; y: number };
  /** the heading at u, radians */
  headingAt(u: number): number;
}

/**
 * Which end of each platform the tunnel joins.
 *
 * THE DEPARTURE DIRECTION DECIDES, not the bearing: the simulation's one hard
 * convention is that dir = +1 trains leave the +x end, so the leg toward a
 * station's dir = +1 neighbour must start there or the map and the sim would
 * disagree about which mouth of the station a tunnel is. A dot-product guess
 * agrees almost everywhere, but where the line bends sharply across a
 * station (Duvbo–Sundbybergs centrum–Solna strand turns ~150°) the platform
 * bearing is near-perpendicular to both legs and the guess picked the wrong
 * end by 236 m. The guess remains only for pairs no service actually runs.
 */
function endSignOf(from: string, to: string, fallback: () => 1 | -1): 1 | -1 {
  return departuresFrom(from).find((d) => d.next === to)?.dir ?? fallback();
}

function endpointsOf(a: MapStation, b: MapStation) {
  const fa = stationFrame(a.name)!;
  const fb = stationFrame(b.name)!;
  const ax = dcos(fa.axis);
  const ay = dsin(fa.axis);
  const bx = dcos(fb.axis);
  const by = dsin(fb.axis);
  const sa = endSignOf(a.name, b.name, () => ((b.x - a.x) * ax + (b.y - a.y) * ay >= 0 ? 1 : -1));
  const sb = endSignOf(b.name, a.name, () => ((a.x - b.x) * bx + (a.y - b.y) * by >= 0 ? 1 : -1));
  return {
    p0: { x: a.x + ax * fa.halfLen * sa, y: a.y + ay * fa.halfLen * sa },
    p1: { x: b.x + bx * fb.halfLen * sb, y: b.y + by * fb.halfLen * sb },
    // tangents point the way the train is travelling
    t0: { x: ax * sa, y: ay * sa },
    t1: { x: -bx * sb, y: -by * sb },
  };
}

const legCache = new Map<string, LegPath | null>();

export function legPath(from: string, to: string): LegPath | null {
  const key = `${from}|${to}`;
  const hit = legCache.get(key);
  if (hit !== undefined) return hit;

  const a = byName.get(from);
  const b = byName.get(to);
  if (!a || !b) {
    legCache.set(key, null);
    return null;
  }
  const { p0, p1, t0, t1 } = endpointsOf(a, b);
  const straight = dist(p1.x - p0.x, p1.y - p0.y);
  // a third of the span each: enough to hold the platform's heading out of the
  // station without the curve doubling back on itself
  const k = straight / 3;
  const m0 = { x: t0.x * k, y: t0.y * k };
  const m1 = { x: t1.x * k, y: t1.y * k };

  const at = (u: number) => {
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    return {
      x: h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x,
      y: h00 * p0.y + h10 * m0.y + h01 * p1.y + h11 * m1.y,
    };
  };

  // arc length by sampling; the curve is gentle, so 64 chords is well inside a
  // pixel and the number is stable, which matters because it feeds the ride
  let lengthPx = 0;
  let prev = at(0);
  for (let i = 1; i <= 64; i++) {
    const q = at(i / 64);
    lengthPx += dist(q.x - prev.x, q.y - prev.y);
    prev = q;
  }

  const headingAt = (u: number) => {
    const h = 0.002;
    const q0 = at(Math.max(0, u - h));
    const q1 = at(Math.min(1, u + h));
    return datan2(q1.y - q0.y, q1.x - q0.x);
  };

  const path: LegPath = { from, to, lengthPx, at, headingAt };
  legCache.set(key, path);
  return path;
}

/** what the real data says this leg measures, in px, for checking the map */
export const legStraightPx = (from: string, to: string): number | null => {
  const leg = legBetween(from, to);
  return leg ? toPx(leg.distM) : null;
};

/**
 * A station's frame on the map: where its local coordinates sit in the world.
 *
 * The simulation lays every station out in its own axis-aligned space with
 * the platform running along local +x and dir = +1 trains leaving to the
 * right. On the map the platform runs along its real bearing, so the frame
 * is the map point plus the world heading of local +x, which is the
 * platform's bearing turned to point at the dir = +1 neighbour. That choice
 * is what makes a leg's two ends agree: the end of A nearest B is A's +x end
 * exactly when B is where A's rightward trains go.
 */
export interface StationFrame {
  x: number;
  y: number;
  /** world heading of the station's local +x axis, radians */
  axis: number;
  /** half the platform's length in map px, the +x end is at x + cos(axis)·halfLen */
  halfLen: number;
}

const frameCache = new Map<string, StationFrame | null>();

export function stationFrame(name: string): StationFrame | null {
  const hit = frameCache.get(name);
  if (hit !== undefined) return hit;
  const s = byName.get(name);
  if (!s) {
    frameCache.set(name, null);
    return null;
  }
  // orient the platform bearing so +x points at the dir=+1 neighbour (or,
  // at a terminus with only dir=-1 departures, away from the -1 one)
  const deps = departuresFrom(name);
  const fwd = deps.find((d) => d.dir === 1)?.next;
  const back = fwd ? undefined : deps.find((d) => d.dir === -1)?.next;
  const ref = byName.get(fwd ?? back ?? '');
  let axis = s.angle;
  if (ref) {
    const dot = (ref.x - s.x) * dcos(axis) + (ref.y - s.y) * dsin(axis);
    const want = fwd ? 1 : -1;
    if ((dot >= 0 ? 1 : -1) !== want) axis += Math.PI;
  }
  const frame = { x: s.x, y: s.y, axis, halfLen: s.lengthPx / 2 };
  frameCache.set(name, frame);
  return frame;
}

/** the whole map's extent, for anything that needs to know how big this is */
export function mapBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of byName.values()) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x);
    maxY = Math.max(maxY, s.y);
  }
  return { minX, minY, maxX, maxY };
}

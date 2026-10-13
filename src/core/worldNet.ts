import layoutData from '../../data/worldLayout.json' with { type: 'json' };
import * as C from '../config.ts';
import { datan2, dcos, dsin, dist } from '../sim/det.ts';
import { departuresFrom, orderSign, SERVICES } from './network.ts';
import { stationGeo } from '../data/stationGeometry.ts';
import { bandOfService, stationBands } from './stationLayout.ts';
import { stationPlan } from '../data/platformPlan.ts';

/**
 * THE ONE WORLD (decided in chat 2026-09-02: "DO THE WHOLE NETWORK, no
 * squeezing, no smoke and mirrors, no swapping the station under you").
 *
 * Everything is in one continuous plane, laid out by data/worldLayout.json
 * (scripts/gen/worldLayout.ts). A station is a full-scale arena at a fixed
 * position and bearing; its local coordinates, the ones every arena routine
 * has always used, platform along +x, the first island's spine on
 * GAME_HEIGHT/2, are a rigid rotation+translation of the world, nothing
 * more. A leg is a real corridor: a centreline curve joining two platform
 * ends, walls a fixed distance either side, recesses cut into them every
 * 90 m, and two tracks that transition from the stations' own band offsets
 * to the bore gauge. Nothing squeezes, nothing is rebased; where you are is
 * a point on this plane.
 *
 * Everything here is pure data and arithmetic off it, simulation-safe, trig
 * from sim/det.ts, no randomness.
 */

export interface WFrame {
  name: string;
  /** which storey of the station this frame is, a station's levels share a
   * position but each has its OWN bearing: at T-Centralen the green/red
   * storeys run the north-south corridor and the blue storey the east-west
   * one, and forcing one axis on both put a corridor on the wrong mouth */
  levelIndex: number;
  x: number;
  y: number;
  /** world heading of local +x on this storey, radians */
  axis: number;
  ux: number;
  uy: number;
  /** half the platform's length, px, full scale, the arena's own span */
  halfLen: number;
}

/** where local coordinates anchor: the platform centre, on the bore spine */
export const ANCHOR_X = C.M(185 + 120) / 2;
export const ANCHOR_Y = C.GAME_HEIGHT / 2;

const positions = new Map<string, { x: number; y: number; axis: number }>();
for (const s of (layoutData as { stations: { name: string; x: number; y: number; axis: number }[] })
  .stations) {
  positions.set(s.name, s);
}

/** the stations adjacent to `name` along the services calling at its storey */
function levelNeighbours(name: string, levelIndex: number): string[] {
  const bands = stationBands(name, levelIndex);
  const ids = new Set<string>();
  for (const t of bands.tracks) for (const s of t.services) ids.add(s);
  const out = new Set<string>();
  for (const svc of SERVICES) {
    if (!ids.has(svc.id)) continue;
    const i = svc.stations.indexOf(name);
    if (i < 0) continue;
    if (i > 0) out.add(svc.stations[i - 1]);
    if (i + 1 < svc.stations.length) out.add(svc.stations[i + 1]);
  }
  return [...out];
}

/** by name, then storey, no key string to build on every ask, and this is
 * asked for every point a station's plan is turned into a place on the map */
const frames = new Map<string, (WFrame | undefined)[]>();

export function frameOf(name: string, levelIndex = 0): WFrame | undefined {
  let row = frames.get(name);
  if (!row) frames.set(name, (row = []));
  const hit = row[levelIndex];
  if (hit) return hit;
  const p = positions.get(name);
  if (!p) return undefined;
  // the storey's own bearing: the principal direction of its neighbours,
  // a LINE, not a signed direction (the per-service dir labels disagree
  // about which way "+1" points at an interchange)
  let xx = 0;
  let xy = 0;
  let yy = 0;
  let n = 0;
  for (const nb of levelNeighbours(name, levelIndex)) {
    const q = positions.get(nb);
    if (!q) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = dist(dx, dy);
    if (len < 1) continue;
    const ux = dx / len;
    const uy = dy / len;
    xx += ux * ux;
    xy += ux * uy;
    yy += uy * uy;
    n += 1;
  }
  let axis = p.axis;
  if (n > 0) {
    const tr = xx + yy;
    const det = xx * yy - xy * xy;
    const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    if (Math.abs(xy) > 1e-9) axis = datan2(xy, l1 - yy);
    else axis = xx >= yy ? 0 : Math.PI / 2;
  }
  // WHICH WAY +x POINTS is not arbitrary: the arena puts the storey's first
  // track on TOP, and its trains must run rightward there, so +x points at
  // the station those trains go to next. Every station along a line then
  // agrees which side of the bore each direction runs on, left-hand
  // running, as SL does, and a direction's track never has to cross to the
  // other side between two platforms (measured before this: 207 of 290 leg
  // traversals swapped sides, and the tracks drew as crossing every leg).
  const tracks = stationBands(name, levelIndex).tracks;
  const top = tracks[0];
  const svc = top ? SERVICES.find((q) => q.id === top.services[0]) : undefined;
  if (top && svc) {
    const i = svc.stations.indexOf(name);
    // at a TERMINUS every track is a departure, so "top runs +x" would turn
    // the axis back on the line it ends; the line simply continues through
    // it instead, and its departures run -x from either platform
    // ...along the LINE's forward direction (network.ts orderSign), which
    // the layout has put on the top track (stationLayout), so the axis
    // never turns between two stations of a line, and at a line's end it
    // simply continues on past the last platform
    const fwd = orderSign(svc.color);
    const ahead = svc.stations[i + fwd];
    const behind = svc.stations[i - fwd];
    const ref = positions.get(ahead ?? '') ?? positions.get(behind ?? '');
    const want = ahead !== undefined && positions.has(ahead) ? 1 : -1;
    if (ref) {
      const dot = (ref.x - p.x) * dcos(axis) + (ref.y - p.y) * dsin(axis);
      if ((dot >= 0 ? 1 : -1) !== want) axis += Math.PI;
    }
  }
  const f: WFrame = {
    name,
    levelIndex,
    x: p.x,
    y: p.y,
    axis,
    ux: dcos(axis),
    uy: dsin(axis),
    halfLen: C.M(stationGeo(name).lengthM) / 2,
  };
  row[levelIndex] = f;
  return f;
}

export const allFrames = (): WFrame[] => [...positions.keys()].map((n) => frameOf(n)!);

/**
 * THE BORE'S CENTRE on a storey, in local y: the midline of its running
 * tracks. On an island platform that is the island's spine (ANCHOR_Y); at a
 * side-platform station both tracks lie below the first deck, and anchoring
 * the bore on that deck put its centreline above both, so the left/right
 * sense flipped against the island station one stop along and every
 * direction's track crossed to the other side in the tunnel between.
 */
export function boreYOf(name: string, levelIndex: number, toward?: string): number {
  let tracks = stationBands(name, levelIndex).tracks;
  // THE LEG'S OWN TRACKS: at a junction a storey carries a third track for
  // the other branch, and the midline of all three is not the centre of
  // the bore that leaves toward `toward`, the branch's forward track sat
  // below it and crossed the bore in the tunnel (check-plan, Huvudsta to
  // Västra skogen, 2026-09-03)
  if (toward) {
    const runs = tracks.filter((t) =>
      t.services.some((id) => {
        const sv = SERVICES.find((q) => q.id === id);
        if (!sv) return false;
        const i = sv.stations.indexOf(name);
        return i >= 0 && (sv.stations[i - 1] === toward || sv.stations[i + 1] === toward);
      }),
    );
    if (runs.length > 0) tracks = runs;
  }
  if (tracks.length === 0) return ANCHOR_Y;
  let sum = 0;
  for (const t of tracks) sum += (t.bandTop + t.bandBottom) / 2;
  return sum / tracks.length;
}

/** how many storeys this station has (frames exist for each) */
export const levelCountOf = (name: string): number => stationPlan(name).levels.length;

/** station-local -> world */
export function toWorld(f: WFrame, lx: number, ly: number): { x: number; y: number } {
  const dx = lx - ANCHOR_X;
  const dy = ly - ANCHOR_Y;
  return { x: f.x + f.ux * dx - f.uy * dy, y: f.y + f.uy * dx + f.ux * dy };
}

/** world -> station-local */
export function toLocal(f: WFrame, wx: number, wy: number): { x: number; y: number } {
  const dx = wx - f.x;
  const dy = wy - f.y;
  return { x: ANCHOR_X + f.ux * dx + f.uy * dy, y: ANCHOR_Y - f.uy * dx + f.ux * dy };
}

/**
 * Which end of a storey's platform the leg toward `to` joins: PURELY
 * GEOMETRIC, the end whose axis direction points at the neighbour. The
 * per-service `dir` labels cannot decide this: at an interchange different
 * services' "+1" leave by opposite physical ends (green +1 south, red +1
 * north at T-Centralen), and using them put a corridor on the wrong mouth by
 * a whole platform.
 */
export function endSignF(f: WFrame, to: string): 1 | -1 {
  const b = positions.get(to);
  if (!b) return 1;
  return (b.x - f.x) * f.ux + (b.y - f.y) * f.uy >= 0 ? 1 : -1;
}

/**
 * THE WATER CROSSINGS. `cover` tells us a leg runs in the OPEN, but open sky
 * is not the same as open water, most surface legs are embankments and
 * cuttings. These are the real bridges of the Stockholm tunnelbana, the ones
 * that genuinely cross water and get water drawn under them (the rest of the
 * open legs are daylight ground). Curated, because "is there water here" is a
 * fact about Stockholm, not something `cover` can tell us.
 */
const WATER_LEGS = new Set(
  [
    ['Gamla stan', 'Slussen'], // Söderström
    ['Skanstull', 'Gullmarsplan'], // Skanstullsbron / Johanneshovsbron
    ['Alvik', 'Kristineberg'], // Tranebergsbron
    ['Hornstull', 'Liljeholmen'], // Liljeholmsbron
    ['Aspudden', 'Liljeholmen'],
  ].map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)),
);

export function isWaterLeg(a: string, b: string): boolean {
  return WATER_LEGS.has(a < b ? `${a}|${b}` : `${b}|${a}`);
}

/** the storey a leg connects to at `a`, where its services actually stop */
export function legLevel(a: string, b: string): number {
  const dep = departuresFrom(a).find((d) => d.next === b);
  if (!dep) return 0;
  return bandOfService(a, dep.service.id, dep.dir)?.levelIndex ?? 0;
}

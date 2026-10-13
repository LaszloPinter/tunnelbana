import * as C from '../config.ts';
import { SERVICES, departuresFrom, type Service } from './network.ts';
import { bandOfService } from './stationLayout.ts';
import { ANCHOR_X, ANCHOR_Y, boreYOf, endSignF, frameOf, toWorld, type WFrame } from './worldNet.ts';
import { BLEND_LEN, corridorPos, type Corridor } from './corridor.ts';
import { corridorFor, corridorMouth } from './tube.ts';
import { bandForCorridor, boreLateralOf, isWideBore } from './boreSlots.ts';
import { BORE_GAUGE } from './corridor.ts';

/**
 * A LINE AS ONE CONTINUOUS TRACK THROUGH THE WORLD, and a train as a position
 * along it, from the reversing siding past one terminus to the siding past
 * the other. This is what makes a train one object for its whole working
 * life (§18, demanded outright 2026-09-02): it is not manufactured in a
 * tunnel and despawned at a platform; it emerges from the siding, calls at
 * every stop, runs into the far siding, reverses, and comes back as the next
 * departure the other way. Presence at a station is arithmetic on this path,
 * never a spawn.
 *
 * A path is per (service, direction): the two directions run different
 * tracks, their own bands through each station, opposite sides of the bore.
 */

interface PieceBase {
  s0: number;
  len: number;
}
/** across a station at its band lateral */
export interface StationPiece extends PieceBase {
  kind: 'station';
  st: WFrame;
  /** local line start and direction */
  lx0: number;
  ly0: number;
  dlx: 1 | -1;
}
/** a reversing siding: the lateral blends linearly from ly0 (at s0) to lyB (at the end) */
export interface StubPiece extends PieceBase {
  kind: 'stub';
  st: WFrame;
  lx0: number;
  ly0: number;
  dlx: 1 | -1;
  lyB: number;
}
/** a corridor traversal: from arc sA to arc sB of the canonical corridor
 * (sB < sA when traveling b->a), its two true mouths */
export interface CorridorPiece extends PieceBase {
  kind: 'corridor';
  cor: Corridor;
  sA: number;
  sB: number;
  /** corridor-frame laterals: entering, in the bore, and leaving */
  tIn: number;
  tBore: number;
  /** more than two tracks abreast: the lateral runs tIn to tOut the whole way */
  wide: boolean;
  tOut: number;
}
export type PathPiece = StationPiece | StubPiece | CorridorPiece;

export interface LinePath {
  service: Service;
  dir: 1 | -1;
  pieces: PathPiece[];
  length: number;
  /** path S of each stop's STOP POINT (a full train's centre), station order
   * matching the journey's stops */
  stopS: number[];
  stations: string[];
  /** the rest point in each siding: S=0 (origin) and S=length (far end) */
}

/** how far past the platform the reversing siding reaches */
export const SIDING_LEN = C.M(180);

const paths = new Map<string, LinePath>();

export function linePathOf(serviceId: string, dir: 1 | -1): LinePath | null {
  const key = `${serviceId}:${dir}`;
  const hit = paths.get(key);
  if (hit) return hit;
  const service = SERVICES.find((s) => s.id === serviceId);
  if (!service) return null;
  const stations = dir === 1 ? [...service.stations] : [...service.stations].reverse();

  const pieces: PathPiece[] = [];
  const stopS: number[] = [];
  let S = 0;

  /** the service's dir LABEL at station i (which band it stops on) */
  const serviceDir = (i: number): 1 | -1 => {
    const next = stations[i + 1];
    if (next !== undefined) {
      const d = departuresFrom(stations[i]).find((q) => q.next === next && q.service.id === serviceId)?.dir;
      if (d !== undefined) return d;
    }
    const prev = stations[i - 1];
    const back = departuresFrom(stations[i]).find((q) => q.next === prev && q.service.id === serviceId)?.dir;
    return back !== undefined ? (-back as 1 | -1) : dir;
  };

  /** the storey frame this service calls at, and its band's lateral there,
   * at a terminus, the platform that keeps it on its side of the bore */
  const bandAt = (i: number): { f: WFrame; L: number } | null => {
    const nb = stations[i + 1] ?? stations[i - 1];
    const c = nb !== undefined ? corridorFor(stations[i], nb, serviceId, serviceDir(i)) : null;
    const band = c
      ? bandForCorridor(c, stations[i], serviceId, serviceDir(i))
      : bandOfService(stations[i], serviceId, serviceDir(i));
    const f = frameOf(stations[i], band?.levelIndex ?? 0);
    if (!f) return null;
    const L = band ? (band.track.bandTop + band.track.bandBottom) / 2 - ANCHOR_Y : 0;
    return { f, L };
  };

  for (let i = 0; i < stations.length; i++) {
    const here = bandAt(i);
    if (!here) return null;
    const { f, L } = here;
    // the physical ends this storey's platform presents to the previous and
    // next stations, GEOMETRIC (worldNet.endSignF): which mouth a leg uses
    // is a fact about the solved layout, never about a service's dir label
    const e: 1 | -1 =
      stations[i + 1] !== undefined
        ? endSignF(f, stations[i + 1])
        : (-endSignF(f, stations[i - 1]) as 1 | -1);
    if (i === 0) {
      // THE ORIGIN SIDING runs straight out past the platform end ON THIS
      // SERVICE'S OWN TRACK. It used to converge to the bore's centre over
      // its 130 m, which is not what a stabling siding does and drew two
      // waiting trains crossing in an X over the platform (from play at
      // Mörby centrum, 2026-09-04).
      pieces.push({
        s0: S,
        len: SIDING_LEN,
        kind: 'stub',
        st: f,
        lx0: ANCHOR_X - e * (f.halfLen + SIDING_LEN),
        ly0: sidingY(stations[i], f.levelIndex, L),
        dlx: e,
        lyB: ANCHOR_Y + L,
      });
      S += SIDING_LEN;
    }
    // across the station at the band lateral
    pieces.push({
      s0: S,
      len: 2 * f.halfLen,
      kind: 'station',
      st: f,
      lx0: ANCHOR_X - e * f.halfLen,
      ly0: ANCHOR_Y + L,
      dlx: e,
    });
    stopS.push(S + f.halfLen);
    S += 2 * f.halfLen;
    if (i + 1 < stations.length) {
      const to = stations[i + 1];
      // THE TUBE THIS SERVICE RUNS, not the pair's first: at a stacked
      // station each direction has its own
      const c = corridorFor(stations[i], to, serviceId, serviceDir(i));
      const there = bandAt(i + 1);
      if (!c || !there) return null;
      // MOUTH TO MOUTH, EXACTLY. The piece runs from this station's mouth
      // arc to the next one's, and its end laterals are the two bands' own
      // local laterals turned into the corridor's axis, so it meets the
      // station segments exactly in arc AND in lateral, whatever storey,
      // axis or lateral either side has. (Projecting the band end points
      // onto the curve instead landed a far-lateral band a few metres in
      // and short, which was a step at every wide station's mouth.)
      const ma = corridorMouth(c, stations[i], f.levelIndex);
      const mb = corridorMouth(c, to, there.f.levelIndex);
      const len = Math.max(1, Math.abs(mb.s - ma.s));
      const bandHere = ANCHOR_Y + L;
      const bandThere = ANCHOR_Y + there.L;
      pieces.push({
        s0: S,
        len,
        kind: 'corridor',
        cor: c,
        sA: ma.s,
        sB: mb.s,
        tIn: (bandHere - ma.y) * ma.sign,
        tBore: boreLateralOf(c, serviceId, dir),
        tOut: (bandThere - mb.y) * mb.sign,
        wide: isWideBore(c),
      });
      S += len;
    } else {
      // the far siding: straight out past the exit end, on this track
      pieces.push({
        s0: S,
        len: SIDING_LEN,
        kind: 'stub',
        st: f,
        lx0: ANCHOR_X + e * f.halfLen,
        ly0: ANCHOR_Y + L,
        dlx: e,
        lyB: sidingY(stations[i], f.levelIndex, L),
      });
      S += SIDING_LEN;
    }
  }

  const path: LinePath = { service, dir, pieces, length: S, stopS, stations };
  paths.set(key, path);
  return path;
}

/**
 * The world position and travel heading at path arc S.
 *
 * PAST EITHER END THE TRACK STILL RUNS. A journey at rest has its CENTRE at
 * the end of its path, in the siding, so seventy metres of train is past
 * the end of the world, and clamping put all of it on one point: nine cars
 * stacked on the buffer stop, drawn as a heap (probe traincars2d, 15.3 m
 * between neighbouring cars). A siding is straight where it ends, so running
 * on along its own last heading is both simple and right.
 */
export type PathPoint = { x: number; y: number; tx: number; ty: number };

/** ...written INTO `out`, a fresh object per sample was the largest churn left (2026-09-17) */
export function pathPosInto(path: LinePath, S: number, out: PathPoint): PathPoint {
  if (S < 0 || S > path.length) {
    const at = S < 0 ? 0 : path.length;
    const back = S < 0 ? C.M(1) : -C.M(1);
    const here = pathPos(path, at);
    const near = pathPos(path, at + back);
    const dx = here.x - near.x;
    const dy = here.y - near.y;
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    const over = Math.abs(S - at);
    out.x = here.x + (dx / l) * over;
    out.y = here.y + (dy / l) * over;
    out.tx = here.tx;
    out.ty = here.ty;
    return out;
  }
  const s = Math.max(0, Math.min(path.length, S));
  let lo = 0;
  let hi = path.pieces.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.pieces[mid].s0 <= s) lo = mid;
    else hi = mid;
  }
  const p = path.pieces[hi].s0 <= s ? path.pieces[hi] : path.pieces[lo];
  const d = Math.max(0, Math.min(p.len, s - p.s0));
  if (p.kind !== 'corridor') {
    const slope = p.kind === 'stub' ? (p.lyB - p.ly0) / p.len : 0;
    const ly = p.kind === 'stub' ? p.ly0 + (p.lyB - p.ly0) * (d / p.len) : p.ly0;
    const w = toWorld(p.st, p.lx0 + p.dlx * d, ly);
    // heading: along the local travel direction, INCLUDING the way the
    // lateral is running, because a siding slides sideways as it goes
    const ax = p.dlx;
    const al = Math.sqrt(ax * ax + slope * slope) || 1;
    const lx = ax / al;
    const lyDir = slope / al;
    out.x = w.x;
    out.y = w.y;
    out.tx = p.st.ux * lx - p.st.uy * lyDir;
    out.ty = p.st.uy * lx + p.st.ux * lyDir;
    return out;
  }
  const frac = p.len > 0 ? d / p.len : 0;
  const sC = p.sA + (p.sB - p.sA) * frac;
  const q = corridorPos(p.cor, sC);
  const t = corridorLateral(p, d);
  // +t is the corridor tangent rotated +90°
  const tl = Math.max(1e-9, Math.sqrt(q.tx * q.tx + q.ty * q.ty));
  const nx = -q.ty / tl;
  const ny = q.tx / tl;
  const sign = p.sB >= p.sA ? 1 : -1;
  /**
   * A TRACK IS NOT ITS TUNNEL'S CENTRELINE. Leaving a platform the track
   * crosses from the station's band to the bore's gauge over a turnout some
   * seven times the swing (corridorLateral above); that crossover is the
   * shape of the switch, so a train there faces along the whole curve, not
   * the tube. Taking the bore's tangent instead put every car ON the
   * crossover and POINTED along the tube, twelve degrees at the steepest,
   * three metres of lateral step per car, a staircase of cars (from play
   * 2026-09-11), and the crushable metal was the same skewed strip.
   */
  const step = Math.min(C.M(1), Math.max(1, p.len * 0.01));
  const ahead = d + step <= p.len ? corridorLateral(p, d + step) - t : t - corridorLateral(p, d - step);
  const slope = ahead / step;
  const ux = (q.tx / tl) * sign + nx * slope;
  const uy = (q.ty / tl) * sign + ny * slope;
  const ul = Math.sqrt(ux * ux + uy * uy) || 1;
  out.x = q.x + nx * t;
  out.y = q.y + ny * t;
  out.tx = ux / ul;
  out.ty = uy / ul;
  return out;
}

export const pathPos = (path: LinePath, S: number): PathPoint =>
  pathPosInto(path, S, { x: 0, y: 0, tx: 0, ty: 0 });

/**
 * WHERE METAL RESTS: a siding is its OWN track, a gauge clear of the running
 * line and on the far side of it from the bore's centre, so a train standing
 * in it is not in the throat that through traffic runs down. It used to rest
 * ON the running line, where a departing train ran through it and the
 * picture had to hide one of the two (2026-09-05).
 */
function sidingY(station: string, levelIndex: number, L: number): number {
  const band = ANCHOR_Y + L;
  const bore = boreYOf(station, levelIndex);
  const away = band >= bore ? 1 : -1;
  return band + away * 2 * BORE_GAUGE;
}

/** the corridor-frame lateral of this traversal, d px into it (travel arc).
 * The blend from a station band to the bore gauge is a real crossover: the
 * bigger the lateral swing, the longer it takes (about a 1:7 turnout), so a
 * band 20 m off the centreline does not lurch to the gauge in 55 m. */
export function corridorLateral(p: CorridorPiece, d: number): number {
  if (p.wide) {
    // a wide section: from where this station lays the track to where the
    // next one does, across the whole leg, the braid, as a flyover reads
    // from above
    const f = Math.max(0, Math.min(1, p.len > 0 ? d / p.len : 0));
    return p.tIn + (p.tOut - p.tIn) * f * f * (3 - 2 * f);
  }
  // HOW LONG A CROSSOVER TAKES. The ratio is the turnout's: so much along for
  // each across. A smoothstep's slope PEAKS at one and a half times its
  // average, so a blend cut to 1:7 is really 1:4.7 in the middle, eight
  // degrees of swing one way and eight back inside a single car's length, and
  // a train of straight cars drawn on it is visibly kinked (probe
  // traincars2d: 36.5° between neighbours). 1:14 is an ordinary main-line
  // turnout and leaves the peak near 1:9.
  const bIn = Math.min(Math.max(BLEND_LEN, Math.abs(p.tBore - p.tIn) * 14), p.len / 2);
  const bOut = Math.min(Math.max(BLEND_LEN, Math.abs(p.tBore - p.tOut) * 14), p.len / 2);
  if (d < bIn) {
    const f = d / bIn;
    const e = f * f * (3 - 2 * f);
    return p.tIn + (p.tBore - p.tIn) * e;
  }
  if (d > p.len - bOut) {
    const f = (p.len - d) / bOut;
    const e = f * f * (3 - 2 * f);
    return p.tOut + (p.tBore - p.tOut) * e;
  }
  return p.tBore;
}

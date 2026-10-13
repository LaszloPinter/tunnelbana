import * as C from '../config.ts';
import { mulberry32 } from '../core/lineData.ts';
import { stationGeo } from '../data/stationGeometry.ts';
import type { Platform } from '../core/world.ts';

/**
 * WHERE everything at a station stands, decided with no renderer in the room.
 *
 * The simulation collides with benches and columns, spawns at exits, rides
 * shafts, shops at kiosks, so where those stand is simulation state, and it
 * used to be decided inside the drawing code, interleaved with the ads. This
 * module is that decision alone: pure data in, pure data out, seeded by the
 * station's name so the same station furnishes the same way on every client
 * and in a Node process with no engine at all. The renderer DRESSES the plan
 * (stationFurniture.ts) and rolls its own cosmetics separately; it re-rolls
 * nothing that is decided here.
 *
 * Nothing here is scattered. A platform is a built thing: each piece claims
 * the floor it occupies as it lands and nothing else is placed on a claimed
 * one, in a fixed order, shafts first (a station whose only stair is behind
 * a vending machine is not a station), then exits, then the roof's columns,
 * then the machines and the kiosk, then the benches in whatever bays remain.
 */

/** an axis-aligned solid on the floor */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ExitPlan {
  x: number;
  midY: number;
  dirOut: 1 | -1;
  withLift: boolean;
}

export interface ShaftPlan {
  x: number;
  y: number;
  w: number;
  h: number;
  delta: -1 | 1;
  label: string;
}

export interface StationPlan {
  platformX0: number;
  platformX1: number;
  midX: number;
  span: number;
  outdoor: boolean;
  /** the floor-projected departure boards, by rail index, furniture keeps clear */
  boardXs: number[];
  benches: Box[];
  pillars: Box[];
  /** the exits' feet: where the horde comes down and the run walks out */
  escalators: { x: number; y: number }[];
  exits: ExitPlan[];
  shafts: ShaftPlan[];
  manaMachines: { x: number; y: number }[];
  healthMachines: { x: number; y: number }[];
  kiosks: { x: number; y: number }[];
  /** whether each platform's island carries a file of columns */
  pillarsByPlatform: boolean[];
}

/** the station's own seed: the same name, the same station, everywhere */
export function stationSeed(station: string): number {
  let seed = 13;
  for (let i = 0; i < station.length; i++) seed = (seed * 31 + station.charCodeAt(i)) | 0;
  return seed;
}

/**
 * TUTORIALSTORG'S LAYOUT: while a tutorial run is being built, the tutorial
 * station's machines stand close together at the middle of the platform,
 * MANA a few metres one way, HEALTH the other, the kiosk between, so a
 * small pen holds them all on one screen (sim/tutorialTrain.ts tutorialPen).
 * Set by the run before it builds its places (sim/runStart.ts).
 */
let tutorialLayoutFor: string | null = null;
export function setTutorialLayout(station: string | null) {
  tutorialLayoutFor = station;
}

export function planStation(
  station: string,
  worldW: number,
  platforms: Platform[],
  rails: { edgeY: number; inward: 1 | -1 }[],
  shaftsTo: { delta: -1 | 1; label: string }[],
): StationPlan {
  const geo = stationGeo(station);
  const rng = mulberry32(stationSeed(station));
  const midX = worldW / 2;
  const lenPx = C.M(geo.lengthM);
  const platformX0 = midX - lenPx / 2;
  const platformX1 = midX + lenPx / 2;
  const span = platformX1 - platformX0;
  const outdoor = geo.outdoor;

  // the boards, before the furniture, which keeps clear of them
  const boardXs = rails.map(() => midX + (rng() - 0.5) * C.M(24));

  const benches: Box[] = [];
  const pillars: Box[] = [];
  const escalators: { x: number; y: number }[] = [];
  const exits: ExitPlan[] = [];
  const shafts: ShaftPlan[] = [];
  const manaMachines: { x: number; y: number }[] = [];
  const healthMachines: { x: number; y: number }[] = [];
  const kiosks: { x: number; y: number }[] = [];
  const pillarsByPlatform: boolean[] = [];

  // Rock caverns hold their own roof, the blue line is bored through granite
  // and has no columns. The shallow cut-and-cover stations do; nothing above
  // ground needs them.
  const pillarsFor = (color: string) => !outdoor && color !== 'blue';

  for (const pf of platforms) {
    const midY = (pf.top + pf.bottom) / 2;
    const taken: { x0: number; x1: number }[] = [];
    const free = (x0: number, x1: number) => !taken.some((t) => x0 < t.x1 && x1 > t.x0);
    const claim = (x0: number, x1: number) => taken.push({ x0, x1 });

    // shafts claim first: the way between storeys must never be blocked
    shaftsTo.forEach((s, i) => {
      const side = s.delta > 0 ? -1 : 1;
      const cx = midX + side * (C.M(13) + i * C.M(3));
      const w = C.M(4.2);
      const h = C.M(3.4);
      shafts.push({ x: cx, y: midY, w, h, delta: s.delta, label: s.label });
      claim(cx - w / 2 - C.M(1), cx + w / 2 + C.M(1));
    });

    // the exits: an end exit puts its foot at the last few metres and sends
    // the flight out over the track; a mid-platform one sits under a mezzanine
    const placeExit = (cx: number, dirOut: 1 | -1, withLift: boolean) => {
      const footL = C.M(3);
      let x0 = cx - footL / 2 - C.M(0.5);
      let x1 = cx + footL / 2 + C.M(0.5);
      if (withLift) {
        const lx = cx - dirOut * (footL / 2 + C.M(2));
        x0 = Math.min(x0, lx - C.M(1.7));
        x1 = Math.max(x1, lx + C.M(1.7));
      }
      claim(x0, x1);
      escalators.push({ x: cx, y: midY });
      exits.push({ x: cx, midY, dirOut, withLift });
    };
    const endInset = C.M(5);
    const midOffset = 0.22 + rng() * 0.1;
    if (span > C.M(118)) {
      placeExit(platformX0 + endInset, -1, true);
      if (rng() < 0.45) placeExit(midX + midOffset * span, 1, false);
      else placeExit(platformX1 - endInset, 1, false);
    } else {
      placeExit(rng() < 0.5 ? platformX0 + endInset : platformX1 - endInset, rng() < 0.5 ? -1 : 1, true);
    }

    // the roof's columns, evenly spaced down the middle, stepping around
    // whatever already stands there
    const hasPillars = pillarsFor(pf.color);
    pillarsByPlatform.push(hasPillars);
    const mine: Box[] = [];
    if (hasPillars) {
      const gap = C.M(9);
      const half = C.M(0.55);
      for (let px = midX - Math.floor(span / 2 / gap) * gap; px <= platformX1 - C.M(6); px += gap) {
        if (px < platformX0 + C.M(6)) continue;
        if (!free(px - half - C.M(0.6), px + half + C.M(0.6))) continue;
        const box = { x0: px - half, y0: midY - half, x1: px + half, y1: midY + half };
        pillars.push(box);
        mine.push(box);
        claim(px - half - C.M(0.6), px + half + C.M(0.6));
      }
    }

    // the machines: against the first clear stretch either side of centre,
    // never under a departure board
    const placeMachine = (side: -1 | 1) => {
      const w = C.M(1.25);
      let mx = midX + side * C.M(12);
      for (let tries = 0; tries < 40; tries++) {
        const cand = midX + side * (C.M(7) + tries * C.M(1.4));
        if (cand < platformX0 + C.M(6) || cand > platformX1 - C.M(6)) break;
        const clashBoard = boardXs.some((bx) => Math.abs(bx - cand) < C.M(7));
        if (!clashBoard && free(cand - w, cand + w)) {
          mx = cand;
          break;
        }
      }
      claim(mx - w, mx + w);
      return { x: mx, y: midY };
    };
    if (tutorialLayoutFor === station) {
      manaMachines.push({ x: midX - C.M(7), y: midY });
      healthMachines.push({ x: midX + C.M(7), y: midY });
    } else {
      manaMachines.push(placeMachine(-1));
      healthMachines.push(placeMachine(1));
    }

    // the kiosk, the SL window, one per island, near the centre (§16)
    {
      const w = C.M(2.2);
      let kx = midX;
      let found = false;
      for (let tries = 0; tries < 30 && !found; tries++) {
        for (const side of [1, -1] as const) {
          const cand = midX + side * (C.M(2) + tries * C.M(1.2));
          if (cand < platformX0 + C.M(6) || cand > platformX1 - C.M(6)) continue;
          const clashBoard = boardXs.some((bx) => Math.abs(bx - cand) < C.M(6));
          if (!clashBoard && free(cand - w, cand + w)) {
            kx = cand;
            found = true;
            break;
          }
        }
      }
      if (tutorialLayoutFor === station) kiosks.push({ x: midX + C.M(1.5), y: midY });
      else if (found) {
        claim(kx - w, kx + w);
        kiosks.push({ x: kx, y: midY });
      }
    }

    // benches take the bays between the columns, back to back across the
    // centre line where there are columns to sit against; to one side or the
    // other where there are none, never straddling the spine
    const bw = C.M(2.4);
    const bh = C.M(0.8);
    const spots: number[] = [];
    if (hasPillars && mine.length > 1) {
      for (let i = 1; i < mine.length; i += 3) {
        const a = (mine[i - 1].x0 + mine[i - 1].x1) / 2;
        const b = (mine[i].x0 + mine[i].x1) / 2;
        if (b - a < C.M(14)) spots.push((a + b) / 2);
      }
    } else {
      const benchGap = C.M(26);
      for (
        let bx = midX - Math.floor(span / 2 / benchGap) * benchGap;
        bx <= platformX1 - C.M(10);
        bx += benchGap
      ) {
        if (bx >= platformX0 + C.M(10)) spots.push(bx);
      }
    }
    let alternate = 1;
    for (const bx of spots) {
      if (!free(bx - bw / 2, bx + bw / 2)) continue;
      claim(bx - bw / 2, bx + bw / 2);
      const sides = hasPillars ? [-1, 1] : [(alternate *= -1)];
      for (const side of sides) {
        const by = midY + side * C.M(0.85) - bh / 2;
        benches.push({ x0: bx - bw / 2, y0: by, x1: bx + bw / 2, y1: by + bh });
      }
    }
  }

  return {
    platformX0,
    platformX1,
    midX,
    span,
    outdoor,
    boardXs,
    benches,
    pillars,
    escalators,
    exits,
    shafts,
    manaMachines,
    healthMachines,
    kiosks,
    pillarsByPlatform,
  };
}

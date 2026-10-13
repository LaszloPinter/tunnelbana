import * as C from '../config.ts';
import { inPatch, type Ground, type Patch, type Solid } from './bake.ts';
import type { Place } from '../sim/place.ts';

/**
 * THE MAP, CUT UP, for looking, not for meaning.
 *
 * The walkable world is one set of flat patches (src/world/bake.ts). This
 * puts them in a grid so a point can be answered without asking all of them,
 * and so a camera can draw a corner of Stockholm without touching the rest.
 *
 * That is the only thing chunking is for. It used to be that the world was
 * cut into rooms and each cut was a change of coordinates, which is where
 * every tunnel bug came from. A chunk boundary means nothing: a patch that
 * straddles one is in both, a body that crosses one does not notice, and no
 * number changes.
 */

/** within `r` of a quad: the body has width, and a column it can stand
 * halfway inside is a column it is inside */
function nearPatch(p: Patch, x: number, y: number, r: number): boolean {
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) & 3;
    const ex = p.x[j] - p.x[i];
    const ey = p.y[j] - p.y[i];
    const len2 = ex * ex + ey * ey || 1;
    let f = ((x - p.x[i]) * ex + (y - p.y[i]) * ey) / len2;
    f = Math.max(0, Math.min(1, f));
    const dx = x - (p.x[i] + ex * f);
    const dy = y - (p.y[i] + ey * f);
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

/** a grid cell is about a train long: big enough that few patches straddle
 * one, small enough that a lookup touches a handful */
const CELL = C.M(150);

export interface Found {
  kind: Ground | Solid;
  place: Place;
  index: number;
}

/** a cell's key as one number, not a string built per lookup: the map is
 * asked seventeen times a body a tick, and the lookup itself was the cost */
const cellKey = (cx: number, cy: number) => (cx + 0x8000) * 0x10000 + (cy + 0x8000);

export class Chunks {
  private readonly cells = new Map<number, Patch[]>();
  readonly patches: Patch[];

  constructor(patches: Patch[]) {
    this.patches = patches;
    for (const p of patches) {
      for (let cx = Math.floor(p.x0 / CELL); cx <= Math.floor(p.x1 / CELL); cx++) {
        for (let cy = Math.floor(p.y0 / CELL); cy <= Math.floor(p.y1 / CELL); cy++) {
          const key = cellKey(cx, cy);
          const list = this.cells.get(key);
          if (list) list.push(p);
          else this.cells.set(key, [p]);
        }
      }
    }
  }

  /**
   * What is under this point on the map, or null for open air.
   *
   * `inside` is the place the asker is already in, if any. TWO BORES CAN
   * SHARE GROUND: the map has no up, and at T-Centralen the bore to Hötorget
   * leaves one storey's frame and the bore to Östermalmstorg the next
   * storey's, from the same end of the same footprint, so for their first
   * stretch they lie over each other. A body there is in whichever it came
   * from, not in whichever patch happens to be first in the cell, which
   * handed a walker back and forth between the two every few metres and,
   * once the live set only kept the storey it was actually on, left it
   * standing in a tunnel whose floor had gone (probe run2d, 2026-09-13).
   */
  /**
   * `inside`: the place the body is in, which wins where bores share ground.
   * `prefer`: where it is GOING, the bore of its route's next leg, which
   * wins when it is in neither, i.e. stepping off a platform into a hall
   * two bores leave together. Without it the first bore baked took every
   * walker who left T-Centralen northward, the green to Hötorget, whichever
   * line they meant (from play 2026-09-25).
   */
  at(x: number, y: number, inside?: string, prefer?: string): Found | null {
    const list = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!list) return null;
    // A PLATFORM WINS A TIE. Near a mouth the bore's floor and the platform's
    // are the same ground described twice, that overlap is exactly what
    // makes stepping off the end of a platform continuous, so when both
    // cover a point, the answer is the one with rules attached: the islands,
    // the beds and the trains standing on them.
    let bore: Found | null = null;
    let rank = -1;
    for (const p of list) {
      if (p.kind === 'pillar' || p.kind === 'bench') continue;
      if (!inPatch(p, x, y)) continue;
      if (p.kind === 'bore') {
        const r = p.place.id === inside ? 2 : p.place.id === prefer ? 1 : 0;
        if (r > rank) {
          rank = r;
          bore = { kind: p.kind, place: p.place, index: p.index };
        }
        continue;
      }
      return { kind: p.kind, place: p.place, index: p.index };
    }
    return bore;
  }

  /** is there any floor at all here? */
  solid(x: number, y: number): boolean {
    return this.at(x, y) !== null;
  }

  /**
   * IS SOMETHING IN THE WAY, a roof column, a bench. Baked flat like the
   * floor and looked up the same way, so a body meets the world's furniture
   * by standing somewhere rather than by asking a station about its own
   * coordinates.
   */
  /**
   * ...and WHAT KIND, when that matters. A body is stopped by anything: a
   * roof column, a bench, whatever is in the way. A SHOT is not, a bench is
   * knee-high and a bolt goes over it; only the stone eats one. The old world
   * asked about pillars by name and the map asked about everything, so every
   * bench on the platform became a wall to your own fire (from play
   * 2026-09-12: "something stops my shots where the benches are").
   */
  blocked(x: number, y: number, r: number, only?: Solid): boolean {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++)
        for (const p of this.cells.get(cellKey(cx, cy)) ?? []) {
          if (only ? p.kind !== only : p.kind !== 'pillar' && p.kind !== 'bench') continue;
          if (x < p.x0 - r || x > p.x1 + r || y < p.y0 - r || y > p.y1 + r) continue;
          if (inPatch(p, x, y) || nearPatch(p, x, y, r)) return true;
        }
    return false;
  }

  /** what is in the way here, if anything, its middle, so a body can tell
   * which side of it to go round */
  blockerMid(x: number, y: number, r: number): { x: number; y: number } | null {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++)
        for (const p of this.cells.get(cellKey(cx, cy)) ?? []) {
          if (p.kind !== 'pillar' && p.kind !== 'bench') continue;
          if (x < p.x0 - r || x > p.x1 + r || y < p.y0 - r || y > p.y1 + r) continue;
          if (inPatch(p, x, y) || nearPatch(p, x, y, r))
            return { x: (p.x0 + p.x1) / 2, y: (p.y0 + p.y1) / 2 };
        }
    return null;
  }

  /** every patch overlapping this box, for drawing a corner of the map */
  near(x0: number, y0: number, x1: number, y1: number): Patch[] {
    const out = new Set<Patch>();
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++)
        for (const p of this.cells.get(cellKey(cx, cy)) ?? []) {
          if (p.x1 >= x0 && p.x0 <= x1 && p.y1 >= y0 && p.y0 <= y1) out.add(p);
        }
    return [...out];
  }
}

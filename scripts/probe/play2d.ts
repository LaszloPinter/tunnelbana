// THE WORLD JOINS UP: A DECK, A TUNNEL, THE NEXT DECK.
//
// Not steering, connectivity. From a platform's deck, is the next station's
// deck reachable by legal steps across the map? That is the question a seam
// used to be able to answer wrongly, and it does not depend on how cleverly
// anything is aimed: flood the walkable world outward and see where it goes.
//
// Legal means what it means for a body (src/world/body2d.ts): there is floor
// under you, nothing is in the way, and you may not step DOWN off a deck onto
// a track bed, climbing out is free, falling in is not. Crossing between two
// islands therefore needs the tracks, which needs a dash, so a station's
// decks are not all one region and are not expected to be.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { corridorsToward } from '../../src/sim/places.ts';
import { showLevel } from '../../src/sim/stationBuild.ts';
import { bakeFloor } from '../../src/world/bake.ts';
import { Chunks } from '../../src/world/chunks.ts';
import { fromPlatform } from '../../src/world/floor.ts';
import { mayGo } from '../../src/world/body2d.ts';
import * as C from '../../src/config.ts';

const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
sim.beginRun();

const R = C.M(0.55);
// finer than the furniture: a roof column is about 1.1 m across and a body
// 1.1 m wide, so a metre grid cannot get round one that a body walks past
const STEP = C.M(0.4);
const faults: string[] = [];
let tried = 0;
let joined = 0;
let worstCells = 0;

for (const name of ALL_STATIONS) {
  const st = asStation(sim.ensurePlace(name));
  if (!st || st.rails.length === 0 || st.platforms.length === 0) continue;
  for (const e of [1, -1] as const) {
    const c = corridorsToward(st, e)[0];
    if (!c) continue;
    const a = asStation(sim.ensurePlace(c.a));
    const b = asStation(sim.ensurePlace(c.b));
    if (!a || !b || !a.platforms.length || !b.platforms.length) continue;
    showLevel(sim, a, c.la);
    showLevel(sim, b, c.lb);
    const leg = sim.ensureLeg(c);
    const map = new Chunks(bakeFloor([a, b, leg]));
    const home = c.a === name ? a : b;
    const far = c.a === name ? b : a;

    // every deck of the home station: at least one has to reach the far one
    // ...standing somewhere a body could actually be put down: the middle of
    // a deck is where the columns are
    const starts: { x: number; y: number }[] = [];
    for (const isl of home.platforms) {
      for (let f = 0.1; f < 0.95; f += 0.06) {
        const lx = home.platformX0 + (home.platformX1 - home.platformX0) * f;
        const q = fromPlatform(home, lx, (isl.top + isl.bottom) / 2);
        if (map.at(q.x, q.y)?.kind !== 'platform' || map.blocked(q.x, q.y, R)) continue;
        starts.push(q);
        break;
      }
    }
    if (starts.length === 0) {
      faults.push(`${home.name}: cannot stand on any of its decks`);
      continue;
    }
    tried += 1;

    let reached = false;
    let cells = 0;
    for (const start of starts) {
      const seen = new Set<string>();
      const queue: { x: number; y: number }[] = [start];
      seen.add(`${Math.round(start.x / STEP)}|${Math.round(start.y / STEP)}`);
      while (queue.length > 0 && !reached) {
        const at = queue.shift()!;
        const here = map.at(at.x, at.y);
        if (!here) continue;
        cells += 1;
        if (here.place === far && here.kind !== 'bore') {
          reached = true;
          break;
        }
        for (let i = 0; i < 8; i++) {
          const ang = (i * Math.PI) / 4;
          const nx = at.x + Math.cos(ang) * STEP;
          const ny = at.y + Math.sin(ang) * STEP;
          const key = `${Math.round(nx / STEP)}|${Math.round(ny / STEP)}`;
          if (seen.has(key)) continue;
          const on = map.at(nx, ny);
          if (!on || !mayGo(here, on, false) || map.blocked(nx, ny, R)) continue;
          seen.add(key);
          queue.push({ x: nx, y: ny });
        }
      }
      if (reached) break;
    }
    worstCells = Math.max(worstCells, cells);
    if (reached) joined += 1;
    else faults.push(`${home.name} -> ${far.name} along ${leg.id}: no deck reaches the far platform`);
  }
}

const ok = faults.length === 0;
console.log(
  `play2d: ${joined}/${tried} tunnels join a deck to the next station's deck, worst flood ${worstCells} cells / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 8)) console.log(`  ${f}`);
if (!ok) console.log(`  ...${faults.length} in all`);
process.exit(ok ? 0 : 1);

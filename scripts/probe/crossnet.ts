// NO TWO BORES OF DIFFERENT COLOURS ARE ONE TUNNEL unless they join the same
// two stations. Every pair of bores that overlap on the map is found and
// asked of the walker's own rule (world/body2d.ts oneTunnelHere): a walker
// may cross between them only when they are one colour forking from one
// platform, or the same two stations' bores side by side. Out of
// T-Centralen the green to Hötorget lay beside the red to Östermalmstorg
// and a walk switched lines (from play 2026-09-25).
import { SERVICES } from '../../src/core/lines.ts';
import {
  corridorOf,
  corridorPos,
  corridorProject,
  BORE_WALL,
  type Corridor,
} from '../../src/core/corridor.ts';
import { corridorColours, corridorLevelAt } from '../../src/core/tube.ts';
import { MOUTH_ZONE, oneTunnelHere } from '../../src/world/body2d.ts';
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import type { Found } from '../../src/world/chunks.ts';
const cors = new Map<string, Corridor>();
for (const svc of SERVICES)
  for (let i = 0; i + 1 < svc.stations.length; i++) {
    const c = corridorOf(svc.stations[i], svc.stations[i + 1]);
    if (c) cors.set(`${c.a}|${c.b}|${c.la}|${c.lb}`, c);
  }
const list = [...cors.values()];
const faults: string[] = [];
let pairs = 0;
const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
const found = (c: Corridor): Found => ({ kind: 'bore', place: sim.ensureLeg(c), index: 0 }) as Found;
const rows: string[] = [];
void rows;
for (let i = 0; i < list.length; i++)
  for (let j = i + 1; j < list.length; j++) {
    const a = list[i],
      b = list[j];
    const ends = (c: Corridor) => [c.a, c.b].sort().join('~');
    if (ends(a) === ends(b)) continue; // the same two stations: one tunnel by design
    let minAng = Infinity,
      overlapM = 0;
    for (let s = a.s0; s <= a.s1; s += 18 * 2) {
      const p = corridorPos(a, s);
      const pr = corridorProject(b, p.x, p.y);
      if (pr.d < BORE_WALL && pr.s > b.s0 && pr.s < b.s1) {
        overlapM += 2;
        const q = corridorPos(b, pr.s);
        const sin = Math.abs(p.tx * q.ty - p.ty * q.tx);
        minAng = Math.min(minAng, (Math.asin(Math.min(1, sin)) * 180) / Math.PI);
      }
    }
    if (overlapM === 0) continue;
    const shared = [a.a, a.b].filter((st) => st === b.a || st === b.b);
    const ca = corridorColours(a),
      cb = corridorColours(b);
    const sameColour = [...cb].some((c) => ca.has(c));
    const sameLevel = shared.some((st) => corridorLevelAt(a, st) === corridorLevelAt(b, st));
    pairs += 1;
    // the walker's rule, asked DEEP in the overlap, past the shared
    // station's approach, where two bores of different colours are their own
    let crossable = false;
    for (let s = a.s0; s <= a.s1 && !crossable; s += 18 * 2) {
      const p = corridorPos(a, s);
      const pr = corridorProject(b, p.x, p.y);
      if (pr.d < BORE_WALL && pr.s > b.s0 && pr.s < b.s1) {
        const deep = shared.every((st) => (st === a.a ? s - a.s0 : a.s1 - s) > MOUTH_ZONE);
        if (deep) crossable = oneTunnelHere(found(a), found(b), p.x, p.y);
      }
    }
    const fine = sameColour && sameLevel;
    if (crossable && !fine)
      faults.push(
        `${a.a}→${a.b} [${[...ca]}] and ${b.a}→${b.b} [${[...cb]}] overlap ${overlapM} m at ${minAng.toFixed(0)}° and a walker may cross between them past the approach`,
      );
    rows.push('');
  }
const ok = faults.length === 0;
console.log(
  `crossnet: ${list.length} bores, ${pairs} overlapping pairs of different ends, none crossable between colours past the approach / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);

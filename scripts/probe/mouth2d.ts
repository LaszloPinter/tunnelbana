// WHICH BORE YOU ARE IN when two leave a station together is the one your
// route means. Out of T-Centralen the green to Hötorget and the red to
// Östermalmstorg share their first ninety metres; the ground there was
// answered by whichever bore was baked first, so a walk meant for the red
// line was filed into the green from its first step and came out at
// Hötorget (from play 2026-09-25). For every such pair on the network this
// walks each bore's own centreline out of the shared station with the route
// set to that bore's line, and asks that the walker is filed in it.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { SERVICES } from '../../src/core/lines.ts';
import { findRoute } from '../../src/core/network.ts';
import {
  corridorOf,
  corridorPos,
  corridorProject,
  BORE_WALL,
  type Corridor,
} from '../../src/core/corridor.ts';
import { corridorColours } from '../../src/core/tube.ts';
import { asStation } from '../../src/sim/place.ts';
import { showLevel } from '../../src/sim/stationBuild.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { spawnAt } from '../../src/world/walk2d.ts';
import { legIdOf } from '../../src/sim/leg.ts';
import { fromPlatform } from '../../src/world/floor.ts';
import * as C from '../../src/config.ts';

const cors = new Map<string, Corridor>();
for (const svc of SERVICES)
  for (let i = 0; i + 1 < svc.stations.length; i++) {
    const c = corridorOf(svc.stations[i], svc.stations[i + 1]);
    if (c) cors.set(`${c.a}|${c.b}|${c.la}|${c.lb}`, c);
  }
const list = [...cors.values()];
const faults: string[] = [];
let walks = 0;
const ends = (c: Corridor) => [c.a, c.b].sort().join('~');
for (let i = 0; i < list.length; i++)
  for (let j = i + 1; j < list.length; j++) {
    const a = list[i];
    const b = list[j];
    if (ends(a) === ends(b)) continue;
    const shared = [a.a, a.b].filter((st) => st === b.a || st === b.b);
    if (shared.length !== 1) continue;
    const ca = corridorColours(a);
    if ([...corridorColours(b)].some((col) => ca.has(col))) continue;
    let overlap = 0;
    for (let s = a.s0; s <= a.s1; s += C.M(2)) {
      const p = corridorPos(a, s);
      const pr = corridorProject(b, p.x, p.y);
      if (pr.d < BORE_WALL && pr.s > b.s0 && pr.s < b.s1) overlap += 2;
    }
    if (overlap < 20) continue;
    const st = shared[0];
    for (const c of [a, b]) {
      const far = c.a === st ? c.b : c.a;
      const sim = new Run(NULL_HOST);
      sim.seedPinned = true;
      sim.runSeed = 1;
      sim.startRun();
      sim.beginRun();
      goFlat(sim);
      const legs = findRoute(st, far);
      if (!legs) continue;
      sim.route = legs;
      const home = asStation(sim.ensurePlace(st));
      if (!home) continue;
      showLevel(sim, home, c.a === st ? c.la : c.lb);
      sim.ensureLeg(c);
      sim.hereId = home.id;
      const me = sim.me;
      const isl = home.platforms[0];
      const at = fromPlatform(home, (home.platformX0 + home.platformX1) / 2, (isl.top + isl.bottom) / 2);
      spawnAt(sim, me, at.x, at.y);
      me.placeId = home.id;
      const edges = new InputEdges();
      const fromA = c.a === st;
      // walk the bore's own centreline seventy metres out, as a body would follow it
      walks += 1;
      let filed = '';
      for (let k = 0; k < 2400; k++) {
        me.health = 999;
        me.iframesUntil = sim.gameNow + 60_000;
        me.noTrainHitUntil = sim.gameNow + 60_000;
        for (const pl of sim.places.values()) pl.enemies.length = 0;
        const pr = corridorProject(c, me.x, me.y);
        const out = fromA ? pr.s - c.s0 : c.s1 - pr.s;
        // on the platform: along it, toward the mouth; in the bore: down the middle
        let dx: number;
        let dy: number;
        if (out < 0) {
          const t = corridorPos(c, fromA ? c.s0 : c.s1);
          dx = fromA ? t.tx : -t.tx;
          dy = fromA ? t.ty : -t.ty;
        } else {
          const ahead = corridorPos(c, Math.max(c.s0, Math.min(c.s1, pr.s + (fromA ? C.M(3) : -C.M(3)))));
          dx = ahead.x - me.x;
          dy = ahead.y - me.y;
        }
        const d = Math.hypot(dx, dy) || 1;
        sim.runTick(edges.sample(0, dx / d, dy / d, me.x, me.y, answerPicks(sim)));
        if (out > C.M(70)) {
          filed = sim.placeOf(me).id;
          break;
        }
      }
      if (filed !== legIdOf(c))
        faults.push(
          `${st} → ${far} [${[...corridorColours(c)]}]: seventy metres out the walker is filed in ${filed || 'nowhere yet'}, not ${legIdOf(c)}`,
        );
    }
  }
const ok = faults.length === 0;
console.log(
  `mouth2d: ${walks} walks out of a shared hall, each filed in the bore its route meant / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);

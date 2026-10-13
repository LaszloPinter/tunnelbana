// TUNNELS DO NOT MEET. Where two bores cross on the map, the red line
// into Slussen from Mariatorget over the green from Medborgarplatsen, they
// share ground, and a walker in one could turn and run off down the other
// (from play 2026-09-24). This walks the crossing and asks that the walker
// is only ever filed in the bore it entered, or a station.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { asLeg, asStation } from '../../src/sim/place.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { routeTo } from '../../src/world/route2d.ts';
import { corridorsToward } from '../../src/sim/places.ts';
import * as C from '../../src/config.ts';
import { corridorOf, corridorPos, corridorProject, type Corridor } from '../../src/core/corridor.ts';
import { boreWallOf } from '../../src/core/boreSlots.ts';
import { spawnAt } from '../../src/world/walk2d.ts';

/** the two bores meet at more than 15° here: one above the other, not side by side */
function boresCross(a: Corridor, b: Corridor, x: number, y: number): boolean {
  const pa = corridorPos(a, corridorProject(a, x, y).s);
  const pb = corridorPos(b, corridorProject(b, x, y).s);
  return Math.abs(pa.tx * pb.ty - pa.ty * pb.tx) >= 0.26;
}

const faults: string[] = [];
let walks = 0;
let crossings = 0;
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  for (const dir of [1, -1] as const) {
    const sim = new Run(NULL_HOST);
    sim.seedPinned = true;
    sim.runSeed = seed;
    sim.startRun();
    sim.beginRun();
    goFlat(sim);
    const me = sim.me;
    const edges = new InputEdges();
    const home = asStation(sim.here);
    const c = home && corridorsToward(home, dir)[0];
    if (!home || !c) continue;
    const far = sim.ensurePlace(c.a === home.name ? c.b : c.a);
    const mine = new Set([home.id, far.id]);
    const safe = () => {
      me.health = 999;
      me.alive = true;
      me.downed = false;
      me.iframesUntil = sim.gameNow + 60_000;
      me.noTrainHitUntil = sim.gameNow + 60_000;
      for (const pl of sim.places.values()) pl.enemies.length = 0;
    };
    safe();
    sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
    const route = routeTo(sim, { x: me.x, y: me.y }, far, me.r);
    if (!route) continue;
    walks += 1;
    let k = 0;
    let sawOther = false;
    let entered: string | null = null;
    for (let t = 0; t < 12000; t++) {
      safe();
      while (k < route.length - 1 && Math.hypot(route[k].x - me.x, route[k].y - me.y) < C.M(1.5)) k += 1;
      const aim = route[k];
      const dx = aim.x - me.x;
      const dy = aim.y - me.y;
      const d = Math.hypot(dx, dy) || 1;
      sim.runTick(edges.sample(0, dx / d, dy / d, me.x, me.y, answerPicks(sim)));
      const pl = sim.placeOf(me);
      const leg = asLeg(pl);
      if (leg) {
        if (!entered) entered = pl.id;
        // is another bore under our feet here? then this is a crossing
        const under = sim.map.near(me.x - 1, me.y - 1, me.x + 1, me.y + 1);
        if (under.some((q) => q.kind === 'bore' && q.place.id !== pl.id)) sawOther = true;
        if (pl.id !== entered) {
          // two bores running together into one station are one tunnel
          // (world/body2d.ts oneTunnelHere); only a CROSSING is a fault
          const was = asLeg(sim.places.get(entered));
          if (was && boresCross(was.cor, leg.cor, me.x, me.y))
            faults.push(`seed ${seed} ${home.name} -> ${far.name}: crossed out of ${entered} into ${pl.id}`);
          entered = pl.id;
        }
      } else if (!mine.has(pl.id)) {
        faults.push(`seed ${seed} ${home.name} -> ${far.name}: ended up in ${pl.id}`);
        break;
      }
      const on = sim.map.at(me.x, me.y);
      if (on && on.place === far && on.kind !== 'bore') break;
    }
    if (sawOther) crossings += 1;
  }
}
// ---- and the real crossing: the green to Hötorget over the red to
// Östermalmstorg, 69° apart. Stand in the green bore where the red lies
// under it and push along the red: the body must stay in the green.
{
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 1;
  sim.startRun();
  sim.beginRun();
  goFlat(sim);
  const green = corridorOf('Hötorget', 'T-Centralen');
  const red = corridorOf('T-Centralen', 'Östermalmstorg');
  const gLeg = green && sim.ensureLeg(green);
  const rLeg = red && sim.ensureLeg(red);
  if (green && red && gLeg && rLeg) {
    const me = sim.me;
    let spot: { x: number; y: number; tx: number; ty: number } | null = null;
    for (let sArc = green.s0; sArc <= green.s1 && !spot; sArc += C.M(2)) {
      const p = corridorPos(green, sArc);
      const pr = corridorProject(red, p.x, p.y);
      if (pr.d < boreWallOf(red) * 0.5 && pr.s > red.s0 && pr.s < red.s1 && boresCross(green, red, p.x, p.y))
        spot = corridorPos(red, pr.s);
    }
    if (!spot) faults.push('the green and red bores out of T-Centralen do not cross where they used to');
    else {
      sim.hereId = gLeg.id;
      me.placeId = gLeg.id;
      spawnAt(sim, me, spot.x, spot.y);
      me.placeId = gLeg.id;
      const edges = new InputEdges();
      for (const sign of [1, -1] as const) {
        me.x = spot.x;
        me.y = spot.y;
        me.placeId = gLeg.id;
        for (let t = 0; t < 180; t++) {
          me.health = 999;
          me.iframesUntil = sim.gameNow + 60_000;
          me.noTrainHitUntil = sim.gameNow + 60_000;
          for (const pl of sim.places.values()) pl.enemies.length = 0;
          sim.runTick(edges.sample(0, spot.tx * sign, spot.ty * sign, me.x, me.y, answerPicks(sim)));
        }
        const at = sim.placeOf(me);
        if (at.id === rLeg.id)
          faults.push(
            `pushed ${sign > 0 ? 'along' : 'against'} the red bore at the T-Centralen crossing, the walker went from the green into the red`,
          );
        else crossings += 1;
      }
    }
  }
}

const ok = faults.length === 0;
console.log(
  `crossing2d: ${walks} walks, ${crossings} through a crossing, never into the other bore / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 8)) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);

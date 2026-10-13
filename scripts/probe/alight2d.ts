// STEPPING OFF A TRAIN LANDS ON THE GROUND.
//
// A rider who pushes out through a door is put down half a car's width out
// on "the platform side" (sim/ride.ts wayOut). On the map a car lies at its
// line's bearing beside a platform that may be on either hand, so the side
// is a real question, and the far side of an outer track is the wall, which
// is no ground at all (from play 2026-09-24: "I can walk on the walls").
// For every rail at every station this boards a standing train and pushes
// out both ways: the way out must land on this station's bed or platform,
// the other way must be a wall.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { seatHeading, seatOnMap } from '../../src/world/trainSeat.ts';
import { spawnAt } from '../../src/world/walk2d.ts';

const faults: string[] = [];
let tried = 0;
let landed = 0;

const only = process.argv[2];
const seeds = only ? [1, 2, 3, 4, 5, 6] : [2];
for (const name of only ? [only] : ALL_STATIONS.slice(0, 24)) {
  for (const seed of seeds) {
    const sim = new Run(NULL_HOST);
    sim.seedPinned = true;
    sim.runSeed = seed;
    sim.startRun();
    sim.beginRun();
    goFlat(sim);
    sim.hereId = sim.ensurePlace(name).id;
    for (const p of sim.players) p.placeId = sim.hereId;
    const st = asStation(sim.here);
    if (!st) continue;
    const me = sim.me;
    const edges = new InputEdges();
    const safe = () => {
      me.health = 999;
      me.alive = true;
      me.downed = false;
      me.iframesUntil = sim.gameNow + 60_000;
      me.noTrainHitUntil = sim.gameNow + 60_000;
      for (const pl of sim.places.values()) pl.enemies.length = 0;
    };
    const done = new Set<number>();
    for (let k = 0; k < 9000 && done.size < st.rails.length; k++) {
      safe();
      sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
      for (let ti = 0; ti < st.rails.length; ti++) {
        const rail = st.rails[ti];
        if (done.has(ti) || !rail.journey || !rail.train.doorsOpen || rail.train.phase !== 'dwell') continue;
        done.add(ti);
        tried += 1;
        // sit in the middle of the train and push out each way
        const results: string[] = [];
        // sit IN A DOORWAY and push straight across the car, each way
        const doors = rail.train.doors;
        const d0 = doors[Math.floor(doors.length / 2)];
        const doorRx = d0 ? (d0.x0 + d0.x1) / 2 : rail.train.length / 2;
        const head = seatHeading(rail.journey, doorRx, sim.gameNow);
        for (const side of [1, -1] as const) {
          const seat = { kind: 'aboard' as const, ti, rx: doorRx, ry: 0, jid: rail.journey };
          const at = seatOnMap(st, seat, sim.gameNow);
          if (!at || !head) continue;
          spawnAt(sim, me, at.x, at.y);
          me.frame = { ...seat };
          me.placeId = st.id;
          // a push that is purely across the car once said in the car's terms (sim/ride.ts)
          const mx = -head.ty * side;
          const my = head.tx * side;
          let off = false;
          for (let t = 0; t < 120 && !off; t++) {
            safe();
            sim.runTick(edges.sample(0, mx, my, me.x, me.y, answerPicks(sim)));
            if ((me.frame as { kind: string }).kind === 'world') off = true;
          }
          if (!off) {
            results.push(`${side > 0 ? '+' : '-'}: held in`);
            continue;
          }
          const on = sim.map.at(me.x, me.y);
          results.push(
            `${side > 0 ? '+' : '-'}: off onto ${on ? `${on.kind} of ${on.place.name}` : 'NOTHING'}`,
          );
          if (!on)
            faults.push(
              `${name} rail ${ti} (${rail.journey}): stepped off onto NOTHING (pushing ${side > 0 ? '+' : '-'})`,
            );
          else if (on.place !== st) faults.push(`${name} rail ${ti}: stepped off into ${on.place.id}`);
          else landed += 1;
        }
        if (!results.some((r) => r.includes('off')))
          faults.push(`${name} rail ${ti}: no way off the train (${results.join(', ')})`);
      }
    }
  }
}

const ok = faults.length === 0 && tried > 0;
console.log(
  `alight2d: ${tried} standing trains, ${landed} exits onto this station's ground / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 12)) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);

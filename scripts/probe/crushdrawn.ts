// YOU ARE CRUSHED WHERE THE CAR IS, AND ONLY THERE.
//
// A leg's traffic carries the lateral of its track at the train's CENTRE
// (`t`) and the lateral anywhere along it (`latAt`). The picture was moved
// onto latAt when a 140 m body straddling a mouth turned out to be drawn on
// one lateral while its rails swung 12 m across (probe `ontrack`) -- but the
// crush was left on `t`. So out near a mouth the metal that kills you is up
// to twelve metres from the metal you can see: standing clear of a train, on
// a lateral its far end runs at, kills you (from play 2026-09-07: "I was
// killed by a train I did not touch").
//
// The rule: a point on a moving car's drawn centreline is fatal, and a point
// a full car-width off that car's drawn line is not.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { corridorsToward } from '../../src/sim/places.ts';
import { boreTraffic, legCrush } from '../../src/sim/bore.ts';
import * as C from '../../src/config.ts';

const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
sim.beginRun();

const R = C.M(0.5);
const faults: string[] = [];
let onCar = 0;
let missed = 0;
let clear = 0;
let phantom = 0;
let worst = 0;
let worstAt = '';

const seen = new Set<string>();
for (let k = 0; k < 30; k++) {
  const now = 60_000 + k * 5_000;
  sim.gameNow = now;
  for (const name of ALL_STATIONS.slice(0, 30)) {
    const st = asStation(sim.ensurePlace(name));
    if (!st) continue;
    for (const e of [1, -1] as const) {
      for (const c of corridorsToward(st, e)) {
        const leg = sim.ensureLeg(c);
        if (seen.has(`${leg.id}|${now}`)) continue;
        seen.add(`${leg.id}|${now}`);
        for (const tr of boreTraffic(sim, leg)) {
          if (Math.abs(tr.vS) <= C.TRAIN_CRUSH_MIN) continue;
          for (let f = -0.45; f <= 0.45; f += 0.15) {
            const x = tr.s + tr.len * f;
            if (x < leg.x0 || x > leg.x1) continue;
            const y = tr.latAt(x);
            if (leg.inRefuge(x, y, R)) continue;
            // how far the crush's idea of this car is from the drawn one
            const off = Math.abs(tr.t - y);
            if (off > worst) {
              worst = off;
              worstAt = `${leg.id} ${tr.jid}`;
            }
            // ON the car as drawn: fatal
            onCar += 1;
            if (!legCrush(sim, leg, x, y, R)) {
              missed += 1;
              faults.push(
                `${leg.id} ${tr.jid}: standing on the drawn car at ${(off / C.PX_PER_M).toFixed(1)} m from its centre's rails is not fatal`,
              );
            }
            // a full car-width clear of it, on the same arc: not fatal
            for (const s of [1, -1] as const) {
              const yc = y + s * (C.CAR_WIDTH * 1.5 + R);
              const band = leg.bandAt(x);
              if (yc < band.top + R || yc > band.bottom - R) continue;
              if (leg.inRefuge(x, yc, R)) continue;
              // ...unless another track's car is there, which is fair
              if (boreTraffic(sim, leg).some((o) => Math.abs(yc - o.latAt(x)) < C.CAR_WIDTH)) continue;
              clear += 1;
              if (legCrush(sim, leg, x, yc, R)) {
                phantom += 1;
                faults.push(`${leg.id} ${tr.jid}: killed standing clear of every drawn car`);
              }
            }
          }
        }
      }
    }
  }
}

const ok = faults.length === 0;
console.log(
  `crushdrawn: ${onCar} points on a moving car (${missed} not fatal), ${clear} points clear of every car (${phantom} fatal); the crush's lateral is up to ${(worst / C.PX_PER_M).toFixed(2)} m from the drawn one${worstAt ? ` (${worstAt})` : ''} / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 6)) console.log(`  ${f}`);
if (!ok) console.log(`  ...${faults.length} in all`);
process.exit(ok ? 0 : 1);

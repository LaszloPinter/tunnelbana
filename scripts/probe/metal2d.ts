// A TRAIN IS WHERE ITS TRACK IS, AND ONLY THERE.
//
// A journey's motion is one number: how far along its line it is. A line is a
// real path across Stockholm, straight through the platforms, curving
// between them, so the metal is a strip of the map laid along that path
// (src/world/trains2d.ts), and it needs no frame at all.
//
// What this replaces went wrong twice in one day. A car was drawn at the
// lateral of the TRAIN'S CENTRE while its own rails swung twelve metres
// across, so the metal that killed you was not the metal you could see. And a
// short train, whose centre sits 23.55 m further along than the schedule's
// nominal one, was drawn that far behind itself out in a tunnel and jumped
// forward when a platform took over painting it.
//
// The rule, on the map: every point down the middle of a train is inside it,
// and a point a clear car-width to either side is not.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { corridorsToward } from '../../src/sim/places.ts';
import { boreTraffic } from '../../src/sim/bore.ts';
import { linePathOf, pathPos } from '../../src/core/linePath.ts';
import { journeyById } from '../../src/core/fleet.ts';
import { journeyS } from '../../src/core/journeyMotion.ts';
import { noseOffset, trainLenOf } from '../../src/core/corridorTraffic.ts';
import { inBody, trainBody } from '../../src/world/trains2d.ts';
import * as C from '../../src/config.ts';

const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
sim.beginRun();

const faults: string[] = [];
let bodies = 0;
let along = 0;
let missed = 0;
let beside = 0;
let phantom = 0;

const seen = new Set<string>();
for (let k = 0; k < 25; k++) {
  const now = 60_000 + k * 6_000;
  sim.gameNow = now;
  for (const name of ALL_STATIONS.slice(0, 40)) {
    const st = asStation(sim.ensurePlace(name));
    if (!st) continue;
    for (const e of [1, -1] as const) {
      for (const c of corridorsToward(st, e)) {
        const leg = sim.ensureLeg(c);
        for (const tr of boreTraffic(sim, leg)) {
          if (seen.has(`${tr.jid}|${now}`)) continue;
          seen.add(`${tr.jid}|${now}`);
          const body = trainBody(tr.jid, now);
          const j = journeyById(tr.jid);
          const path = j && linePathOf(j.service.id, j.dir);
          const js = journeyS(tr.jid, now);
          if (!body || !j || !path || !js) continue;
          bodies += 1;
          const len = trainLenOf(tr.jid, j.service.color);
          const mid = js.S + noseOffset(len);
          for (let f = -0.48; f <= 0.48; f += 0.08) {
            const s = mid + len * f;
            if (s < 0 || s > path.length) continue;
            const p = pathPos(path, s);
            along += 1;
            if (!inBody(body, p.x, p.y)) {
              missed += 1;
              faults.push(`${tr.jid}: the middle of the train at ${(f * 100).toFixed(0)}% is not inside it`);
            }
            // a clear car-width to either side is not the train
            for (const sgn of [1, -1] as const) {
              const off = C.CAR_WIDTH * 1.5;
              const q = { x: p.x + p.ty * off * sgn, y: p.y - p.tx * off * sgn };
              beside += 1;
              if (inBody(body, q.x, q.y)) {
                phantom += 1;
                faults.push(`${tr.jid}: a point a clear car-width beside the track is inside the train`);
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
  `metal2d: ${bodies} trains on the map. ${along} points down the middle (${missed} outside the metal), ${beside} points clear of the track (${phantom} inside it) / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 6)) console.log(`  ${f}`);
if (!ok) console.log(`  ...${faults.length} in all`);
process.exit(ok ? 0 : 1);

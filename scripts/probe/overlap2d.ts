// TWO TRAINS IN ONE PLACE, ON THE MAP.
//
// The sametrack probe places journeys the way the old chart did; this asks
// the map itself. Over twenty minutes of timetable, every journey near every
// station gets its body (world/trains2d.ts trainBody) and any car whose
// middle lies inside another train's body is two trains on top of each other
// (from play 2026-09-21: a short 17 drawn through a standing train at
// Brommaplan).
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { journeysAt, whereIs, type Journey } from '../../src/core/fleet.ts';
import { inBody, trainBody, type Body } from '../../src/world/trains2d.ts';
import * as C from '../../src/config.ts';

const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
const only = process.argv[2];
const faults = new Map<string, number>();
const samples: string[] = [];
let checked = 0;
const minutes = Number(process.argv[3] ?? 40);
for (let now = 0; now < minutes * 60_000; now += 1000) {
  const seen = new Map<string, { b: Body; j: Journey }>();
  for (const name of ALL_STATIONS) {
    if (only && name !== only) continue;
    for (const j of journeysAt(name, now, 60_000, 60_000)) {
      if (seen.has(j.id)) continue;
      // only trains on the line: the ones resting beyond a terminus stack in
      // the siding by design, and a line crossing another on a lower storey
      // overlaps it in plan without meeting it
      const b = trainBody(j.id, now);
      if (b) seen.set(j.id, { b, j });
    }
  }
  const all = [...seen.values()];
  const bodies = all.map((v) => v.b);
  const colour = (jid: string) => seen.get(jid)!.j.service.color;
  for (let i = 0; i < bodies.length; i++) {
    for (let k = i + 1; k < bodies.length; k++) {
      const a = bodies[i];
      const b = bodies[k];
      if (colour(a.jid) !== colour(b.jid)) continue;
      const wa = whereIs(seen.get(a.jid)!.j, now).kind;
      const wb = whereIs(seen.get(b.jid)!.j, now).kind;
      const running = (w: string) => w === 'at' || w === 'leg';
      // a pair resting in a siding together is by design; one resting where
      // another runs is not
      if (!running(wa) && !running(wb)) continue;
      if (a.box.x1 < b.box.x0 || b.box.x1 < a.box.x0 || a.box.y1 < b.box.y0 || b.box.y1 < a.box.y0) continue;
      checked += 1;
      const mid = (q: { x: number[]; y: number[] }) => ({
        x: (q.x[0] + q.x[1] + q.x[2] + q.x[3]) / 4,
        y: (q.y[0] + q.y[1] + q.y[2] + q.y[3]) / 4,
      });
      const hit =
        a.quads.some((q) => {
          const m = mid(q);
          return inBody(b, m.x, m.y, -C.M(0.5));
        }) ||
        b.quads.some((q) => {
          const m = mid(q);
          return inBody(a, m.x, m.y, -C.M(0.5));
        });
      if (!hit) continue;
      const key = `${a.jid} × ${b.jid}`;
      faults.set(key, (faults.get(key) ?? 0) + 1);
      if (samples.length < 40 && (faults.get(key) ?? 0) === 1)
        samples.push(
          `t=${now / 1000}s ${key} speeds ${(a.speed / C.PX_PER_M).toFixed(1)} / ${(b.speed / C.PX_PER_M).toFixed(1)} m/s at ${JSON.stringify(whereIs(seen.get(a.jid)!.j, now))} / ${JSON.stringify(whereIs(seen.get(b.jid)!.j, now))}`,
        );
    }
  }
}
const total = [...faults.values()].reduce((s, n) => s + n, 0);
const ok = total === 0;
console.log(
  `overlap2d: ${checked} near pairs checked, ${faults.size} train pairs overlapped over ${total} seconds / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const s of samples) console.log(`  ${s}`);
process.exit(ok ? 0 : 1);

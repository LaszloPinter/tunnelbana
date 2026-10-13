// THE END OF THE LINE, RIDDEN: board a train that terminates, ride it in,
// and stay aboard. Its doors must open onto the platform, and the rider must
// end up standing on that platform, never carried on into the siding past
// it, where there is no ground (from play 2026-10-13: a train ridden into
// Norsborg never pulled in and ran on into the dark; at half the termini the
// doors opened onto the rails).
//
//   node --experimental-strip-types scripts/probe/terminus.ts
import * as C from '../../src/config.ts';
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { asStation } from '../../src/sim/place.ts';
import { journeyById } from '../../src/core/fleet.ts';
import { doorNormalOf } from '../../src/world/metal.ts';
import { aboardPoint } from '../../src/world/trainSeat.ts';

// a one-track terminus whose arrivals are held outside, and three two-track
// ones where the arriving train must be put on the right track
const CASES: [string, string][] = [
  ['Hallunda', 'Norsborg'],
  ['Danderyds sjukhus', 'Mörby centrum'],
  ['Husby', 'Akalla'],
  ['Gärdet', 'Ropsten'],
];
const faults: string[] = [];

for (const [from, end] of CASES) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 7;
  sim.startRun();
  sim.beginRun();
  sim.station = from;
  const me = sim.me;
  const st0 = asStation(sim.here)!;
  me.frame = { kind: 'world' };
  me.x = (st0.platformX0 + st0.platformX1) / 2;
  me.y = (st0.platforms[0].top + st0.platforms[0].bottom) / 2;
  const edges = new InputEdges();
  let boardedAt = -1;
  let doors = '';
  let finalGround = '';
  for (let t = 0; t < 60 * 60 * 9; t++) {
    for (const pl of sim.places.values()) pl.enemies.length = 0;
    me.health = 999;
    me.iframesUntil = sim.gameNow + 5000;
    if (boardedAt < 0) {
      const st = asStation(sim.here);
      const ti = st
        ? st.rails.findIndex(
            (r) =>
              r.journey &&
              r.train.phase === 'dwell' &&
              r.train.doorsOpen &&
              journeyById(r.journey)?.stops.at(-1)?.station === end,
          )
        : -1;
      if (st && ti >= 0) {
        const rail = st.rails[ti];
        me.frame = { kind: 'aboard', ti, rx: rail.train.length / 2, ry: 0, jid: rail.journey! };
        boardedAt = t;
      }
    }
    sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
    // the doors at the end of the line: which way do they open?
    const f = me.frame;
    if (!doors && f.kind === 'aboard' && f.jid && me.placeId === `st:${end}`) {
      const st = asStation(sim.places.get(me.placeId))!;
      const rail = st.rails[f.ti];
      if (rail.train.phase === 'dwell' && rail.train.doorsOpen) {
        const side = doorNormalOf(sim, f.jid, sim.gameNow);
        const wrong = rail.train.doors.filter((d) => {
          const p = aboardPoint(f.jid!, (d.x0 + d.x1) / 2, side * C.M(2.6), sim.gameNow);
          return !p || sim.map.at(p.x, p.y, st.id)?.kind !== 'platform';
        }).length;
        doors = `${rail.train.doors.length - wrong}/${rail.train.doors.length} doors onto the platform`;
        if (wrong > 0)
          faults.push(`${end}: ${wrong} of ${rail.train.doors.length} doors opened away from the platform`);
      }
    }
    if (boardedAt >= 0 && t - boardedAt > 60 * 60 * 4) {
      const on = sim.map.at(me.x, me.y);
      finalGround = `${me.frame.kind} on ${on?.kind ?? 'nothing'}`;
      if (me.frame.kind !== 'world' || on?.kind !== 'platform' || me.placeId !== `st:${end}`)
        faults.push(`${end}: four minutes after boarding the rider is ${finalGround} at ${me.placeId}`);
      break;
    }
  }
  if (boardedAt < 0) faults.push(`${end}: no train to it ever stood open at ${from}`);
  else if (!doors) faults.push(`${end}: the ridden train never stood with its doors open there`);
  console.log(`  ${end}: ${doors || 'doors never opened'}; then the rider was ${finalGround || '?'}`);
}
console.log(
  `terminus: ${CASES.length} ends of the line ridden in and stayed on / ${faults.length ? 'FAIL' : 'PASS'}`,
);
for (const f of faults) console.log('  ' + f);
if (faults.length) process.exitCode = 1;

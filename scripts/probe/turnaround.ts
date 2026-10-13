// THE TERMINUS TURNAROUND, watched from the platform: a train arrives, runs
// past the platform into the siding, rests, and comes back as the next
// departure the other way, the same metal, never despawned, never
// manufactured (demanded outright 2026-09-02).
//
//   node --experimental-strip-types scripts/probe/turnaround.ts

import * as C from '../../src/config.ts';
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { EMPTY_INPUT } from '../../src/sim/tick.ts';
import { turnsInto } from '../../src/core/journeyMotion.ts';

let failed = 0;
const fail = (s: string) => {
  failed += 1;
  console.log('  FAIL ' + s);
};

const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
sim.beginRun();
sim.station = 'Mörby centrum';
const me = sim.me;
me.frame = { kind: 'world' };
me.x = (sim.here.platformX0 + sim.here.platformX1) / 2;
me.y = (sim.here.platforms[0].top + sim.here.platforms[0].bottom) / 2;

interface Snap {
  t: number;
  rails: { journey: string | null; phase: string; x: number; len: number; speed: number }[];
}
const snaps: Snap[] = [];
let teleports = 0;
for (let tick = 0; tick < 60 * 480; tick++) {
  me.health = 999;
  me.iframesUntil = sim.gameNow + 9e9;
  me.noTrainHitUntil = sim.gameNow + 9e9;
  sim.here.enemies.length = 0;
  sim.runTick(EMPTY_INPUT);
  const snap: Snap = {
    t: sim.gameNow,
    rails: sim.here.rails.map((r) => ({
      journey: r.journey ?? null,
      phase: r.train.phase,
      x: r.train.x,
      len: r.train.length,
      speed: r.train.speed,
    })),
  };
  const prev = snaps[snaps.length - 1];
  if (prev) {
    for (let i = 0; i < snap.rails.length; i++) {
      const a = prev.rails[i];
      const b = snap.rails[i];
      // while a rail keeps its journey, its body must move continuously
      if (a.journey && a.journey === b.journey && Math.abs(b.x - a.x) > C.M(3)) {
        teleports += 1;
        if (teleports <= 3)
          fail(
            `rail ${i} (${b.journey}) jumped ${((b.x - a.x) / 18).toFixed(0)} m in one tick at t=${(snap.t / 1000).toFixed(0)}s`,
          );
      }
    }
  }
  snaps.push(snap);
}

// find an arrival that was seen dwelling, then seen at rest in the siding,
// then find its paired return journey active on some rail afterwards
const outEnd = sim.here.platformX1;
const inEnd = sim.here.platformX0;
let shown = 0;
let handovers = 0;
const seenDwell = new Set<string>();
const seenSiding = new Map<string, { t: number; x: number }>();
for (const s of snaps) {
  for (const r of s.rails) {
    if (!r.journey) continue;
    if (r.phase === 'dwell') seenDwell.add(r.journey);
    const beyond = r.x > outEnd + C.M(30) || r.x + 1 < inEnd - C.M(30) - 1;
    // fully clear of the platform: the whole body past one end or the other
    if (
      seenDwell.has(r.journey) &&
      Math.abs(r.speed) < 1 &&
      (r.x > outEnd + C.M(5) || r.x + r.len < inEnd - C.M(5))
    ) {
      if (!seenSiding.has(r.journey)) seenSiding.set(r.journey, { t: s.t, x: r.x });
    }
    void beyond;
  }
}
for (const [jid, rest] of seenSiding) {
  shown += 1;
  const next = turnsInto(jid);
  if (!next) continue;
  // a rest that began near the end of the window turns after it closes
  if (rest.t > 480_000 - 160_000) continue;
  // was the return journey later shown moving on some rail?
  const returned = snaps.some(
    (s) => s.t > rest.t && s.rails.some((r) => r.journey === next && Math.abs(r.speed) > 1),
  );
  if (returned) handovers += 1;
  else fail(`${jid} rested in the siding but its return ${next} never ran`);
}
console.log(
  `watched Mörby centrum for 8 min: ${seenDwell.size} journeys called, ` +
    `${shown} ran visibly into the siding and rested, ${handovers} came back as their paired return`,
);
if (shown === 0) fail('no train was ever seen at rest in the siding');
if (teleports > 0) fail(`${teleports} single-tick teleports of an owned body`);

// and nothing is ever realised twice: one journey, one body
for (const s of snaps) {
  const ids = s.rails.filter((r) => r.journey).map((r) => r.journey);
  if (new Set(ids).size !== ids.length) {
    fail(`the same journey was on two rails at t=${(s.t / 1000).toFixed(0)}s`);
    break;
  }
}

console.log(failed ? `\n${failed} FAILED` : '\nPASS');
process.exit(failed ? 1 : 0);

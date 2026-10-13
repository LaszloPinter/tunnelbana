// CAN YOU GET DOWN ONTO THE TRACKS?
//
// A platform's edge is the one rule a deck ever had: you may always climb OUT
// of the tracks, but stepping DOWN off a deck takes a dash or an open door, so
// nobody falls in by accident (world/body2d.ts mayGo). It is also how you
// cross to the far island, how you take the tunnel on foot, and half of what
// a dash is for.
//
// The map's walker never told the floor whether it was in the air, so the
// answer was always "on its feet" and the edge held against everything: the
// bed, the far platform and the bores were all unreachable (from play
// 2026-09-11: "I cannot get down to the tracks even by dash").
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges, BTN } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { asStation } from '../../src/sim/place.ts';
import { stationFrame } from '../../src/world/floor.ts';

/** ACROSS the platform, in the world, a station lies at its own bearing, so
 * pushing "down the screen" at one that runs north-south walks you along it
 * and out of the far end into the bore, which is a different thing entirely */
function acrossOf(st: NonNullable<ReturnType<typeof asStation>>) {
  const f = stationFrame(st);
  return f ? { x: -f.uy, y: f.ux } : { x: 0, y: 1 };
}

const faults: string[] = [];
let tried = 0;
let got = 0;
let held = 0;

for (const seed of [1, 3, 5, 8, 11, 14]) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  goFlat(sim);
  const edges = new InputEdges();
  const me = sim.me;
  const st = asStation(sim.here);
  if (!st) continue;
  tried += 1;
  const safe = () => {
    me.health = 999;
    me.alive = true;
    me.downed = false;
    me.iframesUntil = sim.gameNow + 600_000;
    me.noTrainHitUntil = sim.gameNow + 600_000;
    for (const pl of sim.places.values()) pl.enemies.length = 0;
  };
  // which way is off the deck: try both, one of them is a bed
  let onBed = false;
  let walkedOff = false;
  const across = acrossOf(st);
  for (const side of [1, -1] as const) {
    for (let k = 0; k < 240 && !onBed; k++) {
      safe();
      // walk toward the edge; every so often, dash
      const dash = k % 40 === 20 ? BTN.dash : 0;
      sim.runTick(edges.sample(dash, across.x * side, across.y * side, me.x, me.y, answerPicks(sim)));
      const on = sim.map.at(me.x, me.y);
      if (on?.kind === 'bed') onBed = true;
      else if (on?.kind === 'bore') onBed = true;
    }
    if (onBed) break;
  }
  // ...and WITHOUT a dash the edge must still hold
  {
    const sim2 = new Run(NULL_HOST);
    sim2.seedPinned = true;
    sim2.runSeed = seed;
    sim2.startRun();
    sim2.beginRun();
    goFlat(sim2);
    const e2 = new InputEdges();
    const m2 = sim2.me;
    let fell = false;
    let cameFrom = '?';
    const a2 = acrossOf(asStation(sim2.here)!);
    for (const side of [1, -1] as const)
      for (let k = 0; k < 200 && !fell; k++) {
        m2.health = 999;
        m2.noTrainHitUntil = sim2.gameNow + 600_000;
        for (const pl of sim2.places.values()) pl.enemies.length = 0;
        sim2.runTick(e2.sample(0, a2.x * side, a2.y * side, m2.x, m2.y, answerPicks(sim2)));
        const before = cameFrom;
        const on = sim2.map.at(m2.x, m2.y);
        cameFrom = on?.kind ?? 'nothing';
        // ...unless a door is open there, which is the OTHER way onto the
        // tracks and is meant to be walkable (world/metal.ts doorOpenOn), and
        // unless it came off a BORE's floor, which is not a deck to fall from
        if (on?.kind === 'bed' && before === 'platform' && !sim2.doorOpenOn(on.place, on.index)) {
          fell = true;
          cameFrom = before;
        }
      }
    walkedOff = fell;
  }
  if (onBed) got += 1;
  else faults.push(`${st.name}: dashed at the edge from both sides and never got down to the tracks`);
  if (!walkedOff) held += 1;
  else faults.push(`${st.name}: walked off the deck onto the tracks with no dash at all`);
}

const ok = faults.length === 0;
console.log(
  `onthetracks: ${got}/${tried} got down with a dash, ${held}/${tried} held at the edge without one / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults) console.log(`   ${f}`);
process.exit(ok ? 0 : 1);

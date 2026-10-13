// Is a recorded input log ENOUGH to re-run a run?
//
//   node --experimental-strip-types scripts/check-log.ts [seeds…]
//
// check-replay.ts proves that the same inputs give the same run. That is the
// determinism claim. This proves the thing a LEADERBOARD needs, which is not
// the same claim: that the bytes we actually store, packed to the §11c wire
// format, with aim rounded to int32, replay to the same state as the live
// run they were recorded from.
//
// If this ever fails, every score submitted with a log becomes unverifiable,
// and no amount of server cleverness afterwards can recover it. Which is why
// it runs in `npm run check` alongside the determinism suite rather than
// waiting for a leaderboard to exist.

import { NULL_HOST, Run } from '../src/sim/run.ts';
import { fingerprint } from '../src/sim/fingerprint.ts';
import { InputEdges, type TickInput } from '../src/sim/tick.ts';
import { InputLog, toBase64, fromBase64 } from '../src/sim/inputLog.ts';
import { bot } from './lib/drive.ts';

const TICKS = 60 * 90;
const EVERY = 60;

/** the same scripted commuter as check-replay: patrols, shoots, boards */

function fresh(seed: number): Run {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  return sim;
}

const seeds = process.argv.slice(2).map(Number).filter(Boolean);
let failed = 0;

for (const seed of seeds.length ? seeds : [1, 2, 3, 4, 5, 6]) {
  // ---- the live run, recording as it goes ----
  const live = fresh(seed);
  const edges = new InputEdges();
  const log = new InputLog(1);
  const marks: { tick: number; fp: number }[] = [];

  for (let t = 0; t < TICKS; t++) {
    const c = bot(live, t);
    // ROUNDED here exactly as DemoScene.readControls rounds it, the whole
    // point is to record what the simulation was actually fed
    const input: TickInput = edges.sample(c.held, c.mx, c.my, Math.round(c.aimX), Math.round(c.aimY), 0);
    log.push([input]);
    live.runTickWith([input]);
    if (t % EVERY === 0) marks.push({ tick: t, fp: fingerprint(live.simState()) });
  }

  // ---- through base64 and back, as a submission would go ----
  const wire = toBase64(log.toBytes());
  const decoded = InputLog.decode(fromBase64(wire), 1);

  if (decoded.length !== TICKS) {
    console.log(`  FAIL seed ${seed}: decoded ${decoded.length} ticks, recorded ${TICKS}`);
    failed += 1;
    continue;
  }

  // ---- the replay, from the bytes alone: no bot, no aim logic, nothing ----
  const replay = fresh(seed);
  let diverged = -1;
  let mark = 0;
  for (let t = 0; t < TICKS; t++) {
    replay.runTickWith(decoded[t]);
    if (t % EVERY === 0) {
      const fp = fingerprint(replay.simState());
      if (fp !== marks[mark].fp) {
        diverged = t;
        break;
      }
      mark += 1;
    }
  }

  const kb = (log.bytes / 1024).toFixed(0);
  const b64 = (wire.length / 1024).toFixed(0);
  if (diverged >= 0) {
    console.log(`  FAIL seed ${seed}: replay from the log diverged at tick ${diverged}`);
    failed += 1;
  } else if (log.truncated) {
    console.log(`  FAIL seed ${seed}: the log truncated, which it must not at this length`);
    failed += 1;
  } else {
    console.log(
      `  ok   seed ${seed}    ${TICKS} ticks · ${kb} KB packed · ${b64} KB base64 · replays identical`,
    );
  }
}

// ---- and the encoder itself, at the edges ----
const edge = new InputLog(1);
const extremes: TickInput[] = [
  { held: 0xfff, pressed: 0xfff, mx: -1, my: 1, aimX: -25000, aimY: 999999, choice: 255 },
  { held: 0, pressed: 0, mx: 1, my: -1, aimX: 0, aimY: -999999, choice: 0 },
];
for (const e of extremes) edge.push([e]);
const back = InputLog.decode(edge.toBytes(), 1);
for (let i = 0; i < extremes.length; i++) {
  const a = extremes[i];
  const b = back[i][0];
  const same =
    a.held === b.held &&
    a.pressed === b.pressed &&
    a.mx === b.mx &&
    a.my === b.my &&
    a.aimX === b.aimX &&
    a.aimY === b.aimY &&
    a.choice === b.choice;
  if (!same) {
    console.log(`  FAIL encoder round-trip at extreme ${i}: ${JSON.stringify(b)}`);
    failed += 1;
  }
}
if (!failed) console.log('  ok   encoder round-trips the full range of a seat payload');

console.log(failed ? `\n${failed} FAILED` : '\nPASS');
process.exit(failed ? 1 : 0);

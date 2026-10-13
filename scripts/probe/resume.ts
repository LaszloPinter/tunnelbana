// A SAVE IS THE SEED AND THE LOG. Play a while with the bot, keep the input
// log, and load it into a fresh run of the same seed (sim/inputLog.ts load +
// decode, the resume path in scenes/session.ts): the world must be the same
// world, tick for tick, and the reloaded log the same bytes.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { InputLog, gzip, gunzip, toBase64, fromBase64 } from '../../src/sim/inputLog.ts';
import { fingerprint } from '../../src/sim/fingerprint.ts';
import { answerPicks, bot } from '../lib/drive.ts';

const faults: string[] = [];
for (const seed of [1, 2, 3]) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  const log = new InputLog(1);
  const edges = new InputEdges();
  for (let t = 0; t < 3000; t++) {
    const b = bot(sim, t);
    // the scene feeds the sim ROUNDED aim, which is what the log holds
    // (inputLog.ts), and pushes TURNED with the view, so they are floats
    // like a turned key's, which the log holds in hundredths (tick.ts)
    const a = 0.7 + seed * 0.3;
    const mx = b.mx * Math.cos(a) - b.my * Math.sin(a);
    const my = b.mx * Math.sin(a) + b.my * Math.cos(a);
    const input = edges.sample(b.held, mx, my, Math.round(b.aimX), Math.round(b.aimY), answerPicks(sim));
    log.push([input]);
    sim.runTickWith([input]);
  }
  const print = fingerprint(sim.simState());
  // through the save's own encoding and back
  const packed = toBase64(await gzip(log.toBytes()));
  const bytes = await gunzip(fromBase64(packed));
  const again = new InputLog(1);
  again.load(bytes);
  if (again.ticks !== log.ticks)
    faults.push(`seed ${seed}: reloaded log has ${again.ticks} ticks, not ${log.ticks}`);
  if (toBase64(again.toBytes()) !== toBase64(log.toBytes()))
    faults.push(`seed ${seed}: reloaded log differs`);
  const sim2 = new Run(NULL_HOST);
  sim2.seedPinned = true;
  sim2.runSeed = seed;
  sim2.startRun();
  sim2.beginRun();
  for (const row of InputLog.decode(bytes, 1)) sim2.runTickWith(row);
  const print2 = fingerprint(sim2.simState());
  if (print !== print2) faults.push(`seed ${seed}: the resumed world differs (${print} vs ${print2})`);
  if (sim2.clock.tick !== sim.clock.tick)
    faults.push(`seed ${seed}: tick ${sim2.clock.tick} vs ${sim.clock.tick}`);
  console.log(
    `  seed ${seed}: ${log.ticks} ticks, ${packed.length} bytes saved, ride ${sim.ride + 1} at ${sim.station}`,
  );
}
const ok = faults.length === 0;
console.log(`resume: 3 saved runs replayed to the same world / ${ok ? 'PASS' : 'FAIL'}`);
for (const f of faults) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);

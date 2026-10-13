// Replays a run file from the debug panel (L → Download run) headless and
// prints what happened, a line a second of game time and one per change of
// place, ride or pause, so a report from play can be read tick by tick.
//
//   node --experimental-strip-types scripts/replay-file.ts <file.json> [--every 60] [--to <tick>]
import { readFileSync } from 'node:fs';
import { Run } from '../src/sim/run.ts';
import { NULL_HOST } from '../src/sim/runHost.ts';
import { InputLog, fromBase64, gunzip } from '../src/sim/inputLog.ts';
import { fingerprint } from '../src/sim/fingerprint.ts';

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--'));
if (!path) throw new Error('usage: replay-file.ts <file.json> [--every 60] [--to <tick>]');
const opt = (name: string, dflt: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const every = opt('every', 60);
const file = JSON.parse(readFileSync(path, 'utf8'));
const rows = InputLog.decode(await gunzip(fromBase64(file.log)), 1);
const to = Math.min(rows.length, opt('to', rows.length));
console.log(
  `seed ${file.seed} · build ${file.build} · ${rows.length} ticks · dev ${file.dev} · taken at`,
  file.where,
);

const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = file.seed >>> 0;
if (file.curve) sim.setCurve(file.curve);
sim.startRun();
sim.beginRun();
let last = '';
for (let t = 0; t < to; t++) {
  sim.runTickWith(rows[t]);
  const me = sim.me;
  const key = `${me.placeId} ride=${sim.ride} pause=${sim.pause?.kind ?? '-'} frame=${me.frame.kind}`;
  if (key !== last || t % every === 0 || t === to - 1) {
    console.log(
      `t${sim.clock.tick} ${key} xy=${Math.round(me.x)},${Math.round(me.y)} hp=${Math.round(me.health)} lvl=${sim.party.level} stops=${sim.stopsTraveled} → ${sim.destStation}${sim.over ? ` OVER ${sim.over.kind}` : ''}`,
    );
    last = key;
  }
  if (sim.over) break;
}
console.log(`fingerprint ${fingerprint(sim.simState())}`);
const w = file.where ?? {};
if (w.place && w.place !== sim.me.placeId)
  console.log(`!! parted ways: the file says ${w.place}, the replay ${sim.me.placeId}`);
const spikes = file.spikes ?? [];
if (spikes.length) {
  const worst = [...spikes].sort((a: { ms: number }, b: { ms: number }) => b.ms - a.ms).slice(0, 10);
  console.log(`${spikes.length} frame spikes; worst:`);
  for (const s of worst) console.log('  ', JSON.stringify(s));
}

// Every world probe, run at once. They are independent and each replays
// minutes of timetable, so serially they were the slowest part of the gate
// (from 2026-09-04). One child per probe, all cores.
import { spawn } from 'node:child_process';

const PROBES = [
  'worldview',
  'wholenet',
  'turnaround',
  'vendor',
  'recess-enter',
  'sametrack',
  'legfight',
  'nopop',
  'ambush',
  'followme',
  'crushdrawn',
  'solidcolumn',
  'map2d',
  'walk2d',
  'mapasks',
  'baked',
  'metal2d',
  'play2d',
  'run2d',
  'ride2d',
  'doors2d',
  'doorway',
  'tutorial',
  'bergakungen',
  'restart2d',
  'fixtures2d',
  'onthetracks',
  'shafts2d',
  'storeys2d',
  'traincars2d',
  'shoot2d',
  'gathered2d',
  'perkcaps',
  'boomerang2d',
  'ward2d',
  'laddning2d',
  'chain2d',
  'knock2d',
  'aboardfight',
  'overlap2d',
  'railcross',
  'resume',
  'crossing2d',
  'crossnet',
  'mouth2d',
  'alight2d',
  'legshots',
  'network',
  'tickets',
  'guard',
  'paxspawn',
  'paxride',
  'paxtalk',
  'langaren',
  'terminus',
];

const run = (name: string) =>
  new Promise<{ name: string; code: number; out: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', new URL(`${name}.ts`, import.meta.url).pathname],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    // a probe that cannot start, or never stops, FAILS the gate rather than
    // hanging it: a spawn error never fires 'close', and a runaway loop
    // never exits
    const limit = setTimeout(() => {
      out += `\n${name}: killed after ${PROBE_TIMEOUT_MS / 60000} minutes\n`;
      child.kill();
    }, PROBE_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(limit);
      resolve({ name, code: 1, out: `${out}\n${name}: ${err.message}\n` });
    });
    child.on('close', (code) => {
      clearTimeout(limit);
      resolve({ name, code: code ?? 1, out });
    });
  });

/** longer than the slowest probe by a wide margin (nopop, a few minutes) */
const PROBE_TIMEOUT_MS = 15 * 60_000;

/**
 * ...BUT NOT ALL AT ONCE. Each probe holds a whole network in memory,
 * every station built, a timetable replayed, and two dozen of them together
 * took the machine's memory out from under the gate (killed mid-run,
 * 2026-09-11). A few at a time still uses every core.
 */
const LANES = 4;
const results: { name: string; code: number; out: string }[] = [];
{
  const queue = [...PROBES];
  const lane = async () => {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) return;
      results.push(await run(next));
    }
  };
  await Promise.all(Array.from({ length: LANES }, lane));
  results.sort((a, b) => PROBES.indexOf(a.name) - PROBES.indexOf(b.name));
}
let failed = 0;
for (const r of results) {
  process.stdout.write(r.out);
  if (r.code !== 0) failed += 1;
}
console.log(failed ? `\n${failed} world probe(s) FAILED` : '\nworld probes: all PASS');
process.exit(failed ? 1 : 0);

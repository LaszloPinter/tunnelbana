// THE GOLDEN CHECK: does the simulation still build every station exactly
// as it did, and replay the bot's six runs to the same fingerprints?
//
//   node --experimental-strip-types scripts/check-golden.ts           compare
//   node --experimental-strip-types scripts/check-golden.ts --update  re-baseline
//
// A pure refactor must diff to nothing. A deliberate change to the sim
// (a timetable, a layout rule, a combat number) re-baselines with --update,
// and the diff in scripts/golden/baseline.txt goes into the commit, where
// a reviewer can see exactly which stations and which seconds it touched.

import { readFileSync, writeFileSync } from 'node:fs';
import { goldenDump } from './lib/golden.ts';

const file = new URL('./golden/baseline.txt', import.meta.url);
const now = goldenDump();
if (process.argv.includes('--update')) {
  writeFileSync(file, now);
  console.log(`golden: baseline written (${now.split('\n').length - 1} lines)`);
  process.exit(0);
}
let before = '';
try {
  before = readFileSync(file, 'utf8');
} catch {
  console.log('golden: no baseline yet, run with --update');
  process.exit(1);
}
const a = before.split('\n');
const b = now.split('\n');
let diffs = 0;
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i] === b[i]) continue;
  diffs += 1;
  if (diffs <= 6) {
    console.log(`  line ${i + 1}:`);
    console.log(`    - ${(a[i] ?? '<none>').slice(0, 160)}`);
    console.log(`    + ${(b[i] ?? '<none>').slice(0, 160)}`);
  }
}
console.log(
  diffs
    ? `golden: ${diffs} lines differ from the baseline. A sim change; re-baseline with --update if it was meant\nFAIL`
    : 'golden: every station laid out and every seed replayed exactly as the baseline\nPASS',
);
process.exit(diffs ? 1 : 0);

// Checks the simulation's deterministic arithmetic (src/sim/det.ts).
//
// Two things matter, and only one of them is accuracy:
//
//   1. These must be CLOSE to the Math.* they replace, or the game changes
//      feel. The tolerances below are what a player could never see: a
//      hundredth of a pixel over the longest shot in the game.
//   2. They must use only + - * / and Math.sqrt, which IEEE 754 pins down
//      exactly, so four clients in lockstep compute identical bits. That is
//      not testable from one engine, it is a property of what the code is
//      allowed to call, so this script also greps for the forbidden ones.
//
//   node --experimental-strip-types scripts/check-det.mjs

import { readFileSync } from 'node:fs';
import { dsin, dcos, datan2, dacos, dist, makeRng } from '../src/sim/det.ts';

let failed = 0;
const check = (name, got, limit) => {
  const ok = got <= limit;
  if (!ok) failed += 1;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(22)} ${got.toExponential(2)} (limit ${limit.toExponential(1)})`,
  );
};
const worst = (f, g, samples) => {
  let e = 0;
  for (const [a, b] of samples) {
    const d = Math.abs(f(a, b) - g(a, b));
    if (d > e) e = d;
  }
  return e;
};

const angles = [];
for (let i = 0; i < 40000; i++) angles.push([(i / 40000) * 60 - 30, 0]);
const pairs = [];
for (let i = 0; i < 40000; i++) {
  const t = (i / 40000) * Math.PI * 2;
  pairs.push([Math.sin(t) * (1 + (i % 700)), Math.cos(t) * (1 + (i % 913))]);
}
const unit = [];
for (let i = 0; i <= 40000; i++) unit.push([i / 20000 - 1, 0]);

console.log('accuracy against Math.*:');
check(
  'dsin',
  worst(
    (a) => dsin(a),
    (a) => Math.sin(a),
    angles,
  ),
  1e-9,
);
check(
  'dcos',
  worst(
    (a) => dcos(a),
    (a) => Math.cos(a),
    angles,
  ),
  1e-9,
);
check('datan2', worst(datan2, Math.atan2, pairs), 2e-5);
check(
  'dacos',
  worst(
    (a) => dacos(a),
    (a) => Math.acos(a),
    unit,
  ),
  5e-5,
);
check('dist vs hypot', worst(dist, Math.hypot, pairs), 1e-9);

console.log('\nrandom stream:');
const r1 = makeRng(0xc0ffee);
const r2 = makeRng(0xc0ffee);
let same = true;
let sum = 0;
const N = 500000;
for (let i = 0; i < N; i++) {
  const a = r1();
  const b = r2();
  if (a !== b) same = false;
  sum += a;
}
if (!same) failed += 1;
console.log(`  ${same ? 'ok  ' : 'FAIL'} same seed, same stream`);
check('mean', Math.abs(sum / N - 0.5), 0.005);

console.log('\nforbidden calls in det.ts (must use only + - * / sqrt):');
const src = readFileSync(new URL('../src/sim/det.ts', import.meta.url), 'utf8')
  // the file's own doc names the unsafe calls in order to warn about them
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');
const banned = src.match(/Math\.(sin|cos|tan|atan2|atan|asin|acos|pow|exp|log|log2|log10|hypot|cbrt)\b/g);
if (banned) {
  failed += 1;
  console.log(`  FAIL uses ${[...new Set(banned)].join(', ')}`);
} else {
  console.log('  ok   only sqrt/floor/imul');
}

// ---- the rule, enforced rather than remembered -----------------------------
// Every source of randomness the SIMULATION consults has to be the run's own
// stream. Two classes have already slipped in: bare Math.random, and Phaser's
// global RNG (Phaser.Math.Between / FloatBetween), which is seeded from the
// clock, aboard enemies landed in different seats on every replay of a seed
// until that was found. Cosmetic files may use whatever they like.
console.log('\nrandom sources in simulation files:');
const SIM_FILES = [
  'src/combat/combat.ts',
  'src/combat/enemies.ts',
  'src/combat/enemyAI.ts',
  'src/combat/projectiles.ts',
  'src/combat/hazards.ts',
  'src/combat/loot.ts',
  'src/combat/shield.ts',
  'src/combat/progression.ts',
  'src/sim/player.ts',
  'src/core/train.ts',
  'src/core/network.ts',
  // the map itself: every body's step goes through it
  'src/world/body2d.ts',
  'src/world/walk2d.ts',
  'src/world/route2d.ts',
  'src/world/bearing.ts',
  'src/world/bake.ts',
  'src/world/metal.ts',
  'src/world/trains2d.ts',
  'src/world/trainSeat.ts',
];
for (const rel of SIM_FILES) {
  const text = readFileSync(new URL('../' + rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const hits = text.match(/Math\.random\b|Phaser\.Math\.(Between|FloatBetween|RND)\b/g);
  if (hits) {
    failed += 1;
    console.log(`  FAIL ${rel.padEnd(28)} ${[...new Set(hits)].join(', ')}`);
  }
}
if (!failed) console.log('  ok   all draw from the run stream');

console.log(failed === 0 ? '\nPASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

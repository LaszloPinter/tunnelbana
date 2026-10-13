// Does the world still draw in the right order?
//
//   node scripts/check-depth.mjs
//
// The depth order (src/render/depth.ts) is a contract, and it was being kept
// as forty scattered magic numbers with nothing asserting it. One layer broke
// it, the neighbouring station, an entire container at 8.6, and that single
// number produced three separate bug reports: the tunnel going black, the
// player vanishing at a seam, and the tunnel lights appearing only behind you.
//
// So it is checked rather than remembered. Two rules:
//
//   1. Nothing belonging to a PLACE may be drawn at or above the gloom.
//   2. Nothing that MOVES may be drawn below it.
//
// A file is judged by what it draws, which is what the two lists below say.

import { readFileSync } from 'node:fs';

const GLOOM = 5.6;
const ACTOR_MIN = 5.7;

/** files that draw the world you walk through */
const PLACE_FILES = [
  'src/render/stationBuilder.ts',
  'src/render/stationFurniture.ts',
  'src/render/wallArt.ts',
  'src/render/groundView.ts',
  'src/core/platformPath.ts',
  'src/render/labelArt.ts',
  'src/render/mapView.ts',
];

/** files that draw something that moves under its own steam */
const ACTOR_FILES = [
  'src/render/playerRig.ts',
  'src/render/playerView.ts',
  'src/render/passengerView.ts',
  'src/render/enemyRig.ts',
  'src/render/enemyView.ts',
  'src/render/projectileView.ts',
  // a train moves, so it is an actor: the tunnel's dark must not blacken it,
  // nor the people riding in it (from play 2026-09-11)
  'src/render/mapMetal.ts',
  'src/render/mapDoors.ts',
];

/** deliberately in front of a person: light, and things overhead */
const ALLOWED_ABOVE = new Set([7.5, 8.55, 8.6]);

/**
 * ...AND THE NAMED ONES COUNT TOO. This read only bare numbers, so the moment
 * a file said `setDepth(DEPTH.ACTOR_MIN)`, which is the RIGHT way to write
 * it, and what depth.ts exists for, the check quietly stopped seeing that
 * file at all. A contract nobody can break is not the same as one nobody is
 * checking.
 */
const NAMED = Object.fromEntries(
  [
    ...readFileSync(new URL('../src/render/depth.ts', import.meta.url), 'utf8').matchAll(
      /export const ([A-Z_]+) = ([0-9]+(?:\.[0-9]+)?)/g,
    ),
  ].map((m) => [m[1], Number(m[2])]),
);

const depthsIn = (rel) => {
  const src = readFileSync(new URL('../' + rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const out = [...src.matchAll(/setDepth\(\s*([0-9]+(?:\.[0-9]+)?)\s*\)/g)].map((m) => Number(m[1]));
  for (const m of src.matchAll(/setDepth\(\s*DEPTH\.([A-Z_]+)\s*(?:([+-])\s*([0-9]+(?:\.[0-9]+)?))?\s*\)/g)) {
    const base = NAMED[m[1]];
    if (base === undefined) throw new Error(`${rel}: setDepth(DEPTH.${m[1]}): no such depth`);
    out.push(m[2] === '-' ? base - Number(m[3]) : m[2] === '+' ? base + Number(m[3]) : base);
  }
  return out;
};

let failed = 0;
console.log('the world draws in the right order:');

for (const rel of PLACE_FILES) {
  const bad = depthsIn(rel).filter((d) => d >= GLOOM && !ALLOWED_ABOVE.has(d));
  if (bad.length) {
    failed += 1;
    console.log(
      `  FAIL ${rel} draws place art at ${[...new Set(bad)].join(', ')}: at or above the gloom (${GLOOM})`,
    );
  }
}

for (const rel of ACTOR_FILES) {
  const bad = depthsIn(rel).filter((d) => d < ACTOR_MIN);
  if (bad.length) {
    failed += 1;
    console.log(
      `  FAIL ${rel} draws something that moves at ${[...new Set(bad)].join(', ')}: below the gloom, which would paint the tunnel over it`,
    );
  }
}

// And the one that actually broke: a whole station in one container. Any
// container in the scene is a LAYER of many things at once, so a raw depth on
// one is exactly the mistake that put a station on top of the player.
const scene = readFileSync(new URL('../src/render/placeView.ts', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');
const containerDepths = [...scene.matchAll(/\.container\([\s\S]{0,200}?\.setDepth\(\s*([0-9.]+)\s*\)/g)].map(
  (m) => Number(m[1]),
);
for (const d of containerDepths) {
  if (d >= ACTOR_MIN) {
    failed += 1;
    console.log(`  FAIL a container is at depth ${d}. A whole layer above everything that moves`);
  }
}

console.log(failed ? `\n${failed} FAILED` : '  ok   place art below the gloom, actors above it\n\nPASS');
process.exit(failed ? 1 : 0);

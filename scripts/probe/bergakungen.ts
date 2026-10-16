// BERGAKUNGEN MARKS THE GROUND, FROM A DISTANCE, AND IT HURTS.
//
// The king was a slow blob whose one blow landed at his own feet (from play
// 2026-09-25). Now he marks where you stand from up to twenty-four metres,
// keeps up to three marks at once, and each comes down hard a second later.
// This stands a player still fifteen metres from him and asks that a mark
// appears within two seconds, that three are held at once, that one landing
// on a standing player takes a big bite, and that a player who steps out of
// the circles is not touched.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { asStation } from '../../src/sim/place.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import { onPlatform } from '../../src/world/floor.ts';
import { clearSpot } from '../../src/world/walk2d.ts';
import * as C from '../../src/config.ts';
import { EASE_STOPS } from '../../src/sim/chain.ts';

const faults: string[] = [];
const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 4;
sim.station = 'T-Centralen';
sim.startRun();
sim.beginRun();
// met as he usually is, past the first ride's gentle start (sim/chain.ts easeOf):
// the probe is about his marks, not about the ease
sim.stopsTraveled = EASE_STOPS;
goFlat(sim);
const me = sim.me;
const edges = new InputEdges();
const st = asStation(sim.here);
if (!st) throw new Error('no station');
for (const pl of sim.places.values()) pl.enemies.length = 0;
const aim = clearSpot(sim, me.x + C.M(15), me.y, C.M(2), 'platform');
const local = onPlatform(st, aim.x, aim.y);
if (!local) throw new Error('nowhere to stand the king');
const king = spawnEnemy(sim.hostFor(st), 'boss', { kind: 'world' }, local.x, local.y, true);
king.hp = king.maxHp = 99999;
king.leapCdUntil = sim.gameNow + 600_000; // no leap: this is about the marks
king.acidAt = sim.gameNow + 600_000; // no summons either
const hp0 = 100;
let firstMarkAt = -1;
let most = 0;
let hurtAt = -1;
let hurtBy = 0;
for (let k = 0; k < 360; k++) {
  me.health = hp0;
  me.iframesUntil = 0;
  for (const pl of sim.places.values()) pl.enemies = pl.enemies.filter((e) => e === king);
  sim.runTick(edges.sample(0, 0, 0, king.x, king.y, answerPicks(sim)));
  if (king.marks.length > 0 && firstMarkAt < 0) firstMarkAt = k;
  most = Math.max(most, king.marks.length);
  if (me.health < hp0 && hurtAt < 0) {
    hurtAt = k;
    hurtBy = hp0 - me.health;
  }
}
if (firstMarkAt < 0 || firstMarkAt > 120)
  faults.push(`first mark at tick ${firstMarkAt}, wanted within two seconds`);
if (most < 3) faults.push(`held at most ${most} marks at once, wanted 3`);
if (hurtAt < 0) faults.push('a player standing on the marks was never hit');
else if (hurtBy < 30) faults.push(`a mark took ${hurtBy}, wanted a real bite`);
const dKing = Math.hypot(king.x - me.x, king.y - me.y) / C.M(1);
// now a player who keeps stepping out: put down a fresh king far off and dodge every mark
for (const pl of sim.places.values()) pl.enemies.length = 0;
const king2 = spawnEnemy(sim.hostFor(st), 'boss', { kind: 'world' }, local.x, local.y, true);
king2.hp = king2.maxHp = 99999;
king2.leapCdUntil = sim.gameNow + 600_000;
king2.acidAt = sim.gameNow + 600_000;
king2.speedMul = 0;
let dodgedHits = 0;
for (let k = 0; k < 600; k++) {
  me.health = hp0;
  me.iframesUntil = 0;
  for (const pl of sim.places.values()) pl.enemies = pl.enemies.filter((e) => e === king2);
  // a mark is laid where you STAND, so the dodge is to keep walking: steadily
  // away from the king along the platform, never dithering between circles
  const mx = -1;
  sim.runTick(edges.sample(0, mx, 0, king2.x, king2.y, answerPicks(sim)));
  if (me.health < hp0) dodgedHits += 1;
}
if (dodgedHits > 2)
  faults.push(`a player stepping out of the circles was still hit ${dodgedHits} times in ten seconds`);

const ok = faults.length === 0;
console.log(
  `bergakungen: first mark at ${(firstMarkAt / 60).toFixed(1)} s from ${dKing.toFixed(0)} m, ${most} held, a standing player took ${hurtBy}, a dodging one ${dodgedHits} hits / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);

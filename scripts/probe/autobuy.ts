// RUNNING PAST A MACHINE TOPS YOU UP (combat/machines.ts autoBuy), and A
// DEATH KEEPS WHAT YOU CARRIED (sim/chain.ts finalScore). From play
// 2026-10-15: casual players never found E at the mana machine, and a first
// ride lost scored 0 for four stations of kills.
//
//   node --experimental-strip-types scripts/probe/autobuy.ts
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { asStation } from '../../src/sim/place.ts';
import { manaMax, maxHp } from '../../src/sim/player.ts';
import { fromPlatform } from '../../src/world/floor.ts';
import { finalScore } from '../../src/sim/chain.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];

function atMachine(kind: 'mana' | 'health', mana: number, hp: number, money: number, ticks = 120) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 5;
  sim.startRun();
  sim.beginRun();
  const st = asStation(sim.here)!;
  const m = (kind === 'mana' ? st.manaMachines : st.healthMachines)[0];
  const me = sim.me;
  // beside the machine, on its platform side
  const at = fromPlatform(st, m.x, m.y + C.M(1.2));
  me.x = at.x;
  me.y = at.y;
  me.mana = mana * manaMax(sim.party, me);
  me.health = hp * maxHp(me);
  me.money = money;
  const before = { mana: me.mana, hp: me.health, money: me.money };
  const edges = new InputEdges();
  for (let t = 0; t < ticks; t++) {
    for (const pl of sim.places.values()) pl.enemies.length = 0;
    me.iframesUntil = sim.gameNow + 5000;
    sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
  }
  return { sim, me, before };
}

// low mana, money in pocket: buys without E
{
  const { me, before } = atMachine('mana', 0.2, 1, 300);
  if (!(me.mana > before.mana && me.money < before.money))
    faults.push(
      `mana at 20% beside the machine: ${Math.round(before.mana)} -> ${Math.round(me.mana)} mana, ${before.money} -> ${me.money} kr`,
    );
  else
    console.log(
      `  mana 20%: +${Math.round(me.mana - before.mana)} mana for ${before.money - me.money} kr, no E`,
    );
}
// above the line: leaves you alone
{
  const { me, before } = atMachine('mana', 0.75, 1, 300);
  if (me.money !== before.money) faults.push(`mana at 75% still bought (${before.money} -> ${me.money} kr)`);
}
// low health: the health machine too
{
  const { me, before } = atMachine('health', 1, 0.3, 300);
  if (!(me.health > before.hp && me.money < before.money))
    faults.push(
      `health at 30% beside the machine bought nothing (${Math.round(before.hp)} -> ${Math.round(me.health)})`,
    );
  else
    console.log(`  health 30%: +${Math.round(me.health - before.hp)} HP for ${before.money - me.money} kr`);
}
// a short wallet is not emptied in one pass: at most one pack a rest
{
  const { me, before } = atMachine('mana', 0.05, 1, 200, 60);
  const packs = Math.round((me.mana - before.mana) / 42);
  if (packs > 2) faults.push(`one second at the machine bought ${packs} packs`);
}
// a death keeps what was carried
{
  const { sim, me } = atMachine('mana', 1, 1, 500, 1);
  sim.die(me, 'probe');
  const s = finalScore(sim, sim.gameNow);
  if (s <= 0) faults.push(`a death with 500 kr in hand scored ${s}`);
  else console.log(`  died with 500 kr in hand, nothing banked: scored ${s}`);
}

console.log(
  `autobuy: machines top up below 60% without E, a death keeps what was carried / ${faults.length ? 'FAIL' : 'PASS'}`,
);
for (const f of faults) console.log('  ' + f);
if (faults.length) process.exitCode = 1;

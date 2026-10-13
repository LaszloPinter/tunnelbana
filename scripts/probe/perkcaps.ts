// A PERK THAT CAPS, CAPS.
//
// The mana-orb and extra-coin perks stop after three picks (core/perks.ts):
// the fourth is dealt as a MAX card and refused by the sim whatever the
// screen showed. This picks each until it stops, asks that the ceiling is
// where it was set, that the offer marks it, and that choosing it anyway
// leaves the offer standing; then it kills a few hundred with the orb perk
// full and reads the drop rate off the floor.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges, CHOICE } from '../../src/sim/tick.ts';
import { asStation } from '../../src/sim/place.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import { hurtEnemy } from '../../src/combat/enemyDeath.ts';
import { PERKS, applyPerk, perkMaxed, ORB_BASE } from '../../src/core/perks.ts';
import { defaultMods } from '../../src/core/mods.ts';

const faults: string[] = [];

// the ceilings themselves
for (const [id, key, cap] of [
  ['mana-orbs', 'orbChance', 0.15],
  ['coin-luck', 'coinLuck', 0.3],
] as const) {
  const pk = PERKS.find((p) => p.id === id);
  if (!pk) {
    faults.push(`${id}: not in the pool`);
    continue;
  }
  const m = defaultMods();
  let picks = 0;
  while (!perkMaxed(pk, m) && picks < 10) {
    applyPerk(id, m);
    picks += 1;
  }
  if (picks !== 3) faults.push(`${id}: capped after ${picks} picks, wanted 3`);
  if (Math.abs(m[key] - cap) > 1e-9) faults.push(`${id}: ceiling ${m[key]}, wanted ${cap}`);
  applyPerk(id, m);
  if (Math.abs(m[key] - cap) > 1e-9) faults.push(`${id}: a pick past the ceiling moved it to ${m[key]}`);
}

// a capped card in the offer is refused by the sim
{
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 3;
  sim.station = 'T-Centralen';
  sim.startRun();
  sim.beginRun();
  const me = sim.me;
  const edges = new InputEdges();
  for (let i = 0; i < 3; i++) applyPerk('mana-orbs', me.mods);
  me.offer = { kind: 'perk', items: ['mana-orbs', 'sprint'], openedAt: sim.gameNow, canReroll: false };
  sim.runTick(edges.sample(0, 0, 0, me.x, me.y, CHOICE.card(0)));
  if (!me.offer) faults.push('choosing a MAX card closed the offer');
  else {
    sim.runTick(edges.sample(0, 0, 0, me.x, me.y, CHOICE.card(1)));
    if (me.offer) faults.push('choosing the live card beside it did not close the offer');
  }
}

// the orb rate with the perk full: 22.5% of kills, read off a few hundred
let orbs = 0;
let kills = 0;
{
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 5;
  sim.station = 'Slussen';
  sim.startRun();
  sim.beginRun();
  const me = sim.me;
  const st = asStation(sim.here);
  if (!st) faults.push('no station to kill in');
  else {
    for (let i = 0; i < 3; i++) applyPerk('mana-orbs', me.mods);
    const host = sim.hostFor(st);
    for (let k = 0; k < 400; k++) {
      st.enemies.length = 0;
      st.pickups.length = 0;
      const e = spawnEnemy(host, 'runner', { kind: 'world' }, me.x + 200, me.y, false);
      hurtEnemy(host, e, 1e6, sim.gameNow, me);
      kills += 1;
      if (st.pickups.length > 0) orbs += 1;
    }
    const rate = orbs / kills;
    const want = ORB_BASE + 0.15;
    if (Math.abs(rate - want) > 0.08)
      faults.push(`orb rate ${rate.toFixed(3)} over ${kills} kills, wanted about ${want}`);
  }
}

const ok = faults.length === 0;
console.log(
  `perkcaps: mana orbs and coin luck stop at three picks, a MAX card is refused, ${orbs}/${kills} kills dropped an orb at the ceiling / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);

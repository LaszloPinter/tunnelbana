// LANGAREN (DESIGN §20): the dealer's bag. E beside him opens it (cleared
// station or not); what is bought is paid for and does what it says; a
// ticket from under the counter needs a free slot and is never on a kiosk's
// shelf; the black card brings out what he offers nobody else; walking away,
// or his death, closes it; he turns up now and then on his own; and all
// of it the same twice.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { BTN, CHOICE, InputEdges } from '../../src/sim/tick.ts';
import { asStation } from '../../src/sim/place.ts';
import { spawnDealer } from '../../src/sim/paxSpawn.ts';
import { hurtPassenger } from '../../src/sim/passenger.ts';
import { rollShelf, TICKETS } from '../../src/core/cards.ts';
import { fingerprint } from '../../src/sim/fingerprint.ts';
import { answerPicks } from '../lib/drive.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];

function scene() {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 5;
  sim.startRun();
  sim.beginRun();
  const st = asStation(sim.here)!;
  const me = sim.me;
  sim.pax.length = 0;
  const d = spawnDealer(sim, st, { x: me.x + C.M(1.2), y: me.y }, () => 0.37, sim.gameNow);
  d.plan = 'post';
  d.homeX = d.x;
  d.homeY = d.y;
  const edges = new InputEdges();
  const tick = (held = 0, choice = 0) => {
    st.enemies.length = 0;
    me.iframesUntil = sim.gameNow + 10_000;
    sim.runTick(edges.sample(held, 0, 0, me.x + 50, me.y, choice || answerPicks(sim)));
  };
  return { sim, st, me, d, tick };
}

// ---- the bag opens, a boost is bought ----
{
  const { sim, me, tick } = scene();
  me.money = 1000;
  tick(BTN.use);
  tick();
  const o = me.offer;
  if (!o || o.kind !== 'bag') faults.push(`E beside the dealer opened ${o ? o.kind : 'nothing'}`);
  else {
    const items = o.items.join(',');
    if (
      !o.items.includes('mana') ||
      !o.items.some((i) => i.startsWith('ticket:')) ||
      o.items.filter((i) => i.startsWith('boost:')).length !== 2
    )
      faults.push(`the bag holds ${items}`);
    const boost = o.items.findIndex((i) => i.startsWith('boost:'));
    const kind = o.items[boost].slice(6);
    tick(0, CHOICE.card(boost));
    tick();
    if (!(me.boosts[kind] > sim.gameNow)) faults.push(`bought ${kind} and no boost is running`);
    if (me.money !== 1000 - (kind === 'dash' ? 80 : 90)) faults.push(`a boost cost ${1000 - me.money} kr`);
    console.log(`  langaren: the bag (${items}); ${kind} bought for ${1000 - me.money} kr, running`);
  }
}

// ---- a ticket from under the counter: a free slot, and only from him ----
{
  const { me, tick } = scene();
  me.money = 2000;
  me.cardTier = 'green';
  tick(BTN.use);
  tick();
  const i = me.offer?.items.findIndex((x) => x.startsWith('ticket:')) ?? -1;
  const id = i >= 0 ? me.offer!.items[i].slice(7) : '';
  tick(0, CHOICE.card(i));
  tick();
  if (!me.cards.includes(id)) faults.push(`bought ${id} and it is not on the card (${me.cards})`);
  let shelved = 0;
  let r = 0.11;
  for (let k = 0; k < 400; k++)
    for (const t of rollShelf(() => (r = (r * 9301 + 0.4927) % 1), [], 3))
      if (TICKETS.find((x) => x.id === t)?.black) shelved++;
  if (shelved > 0) faults.push(`a kiosk shelf offered a black-market ticket ${shelved} times`);
}

// ---- the black card brings out more ----
{
  const { me, tick } = scene();
  me.cardTier = 'black';
  tick(BTN.use);
  tick();
  if (!me.offer?.items.includes('special'))
    faults.push(`holding the black card, the bag holds ${me.offer?.items}`);
}

// ---- walking away closes it; so does his death ----
{
  const { me, tick } = scene();
  tick(BTN.use);
  tick();
  me.x += C.M(10);
  tick();
  if (me.offer) faults.push('walked ten metres away and the bag stayed open');
  const b = scene();
  b.tick(BTN.use);
  b.tick();
  hurtPassenger(b.sim, b.d, 999, b.sim.gameNow);
  b.tick();
  if (b.me.offer) faults.push('the dealer died and his bag stayed open');
}

// ---- he turns up on his own, now and then ----
{
  let met = 0;
  for (let seed = 1; seed <= 16; seed++) {
    const sim = new Run(NULL_HOST);
    sim.seedPinned = true;
    sim.runSeed = seed;
    sim.startRun();
    sim.beginRun();
    const edges = new InputEdges();
    let seen = false;
    for (let k = 0; k < 3 * 3600 && !seen; k++) {
      sim.me.iframesUntil = sim.gameNow + 5000;
      sim.me.health = sim.me.maxHealth;
      sim.runTick(edges.sample(0, 0, 0, sim.me.x + 50, sim.me.y, answerPicks(sim)));
      if (sim.pax.some((q) => q.kind === 'langare')) seen = true;
    }
    if (seen) met += 1;
  }
  if (met === 0) faults.push('sixteen seeds, three minutes each, and the dealer never turned up');
  else console.log(`  langaren: turned up in ${met} of 16 seeds' first three minutes`);
}

// ---- the same twice ----
{
  const run = () => {
    const { sim, me, tick } = scene();
    me.money = 500;
    tick(BTN.use);
    for (let k = 0; k < 60; k++) tick(0, k === 5 ? CHOICE.card(0) : 0);
    return fingerprint(sim.simState());
  };
  if (run() !== run()) faults.push('the same scene twice parts ways');
}

console.log(
  `langaren: the bag opens, sells, closes, and is never the kiosk's / ${faults.length ? 'FAIL' : 'PASS'}`,
);
for (const f of faults) console.log('  ' + f);
if (faults.length) process.exitCode = 1;

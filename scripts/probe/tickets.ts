// The card and its tickets: every mutation keeps Mods exactly in step.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import * as C from '../../src/config.ts';
import { InputEdges, CHOICE } from '../../src/sim/tick.ts';
import {
  effectiveTickets,
  applyTickets,
  ticketCount,
  kioskMul,
  machineMul,
  TICKETS,
  stacks,
  rollShelf,
} from '../../src/core/cards.ts';
const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 7;
sim.startRun();
sim.beginRun();
const me = sim.me;
const edges = new InputEdges();
const tick = (choice = 0) => {
  me.iframesUntil = sim.gameNow + 5000;
  sim.runTick(edges.sample(0, 0, 0, me.x + 100, me.y, choice));
};
const expectMods = (label: string) => {
  // withdraw and re-apply: must be a no-op if bookkeeping is exact
  // multiplicative mods round-trip to within float noise (×1.6 then ÷1.6); that is fine
  const before = { ...me.mods } as Record<string, number>;
  applyTickets(me, -1);
  applyTickets(me, 1);
  const ok = Object.entries(before).every(
    ([k, v]) => typeof v !== 'number' || Math.abs((me.mods as any)[k] - v) < 1e-9,
  );
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: cards=[${me.cards.join(',')}] effective=[${effectiveTickets(me.cards).join(',')}] speed×${me.mods.ticketMove.toFixed(2)} dash×${me.mods.dashLen} hp+${me.mods.maxHealthBonus} money=${me.money}`,
  );
  return ok;
};
let fails = 0;
const check = (l: string) => {
  if (!expectMods(l)) fails++;
};
me.money = 5000;
// open the kiosk: fake a shop offer with a chosen shelf
me.shelf = ['akstrafe', 'dubbel', 'nattbuss'];
me.offer = { kind: 'shop', items: [...me.shelf], openedAt: sim.gameNow, canReroll: false };
tick(CHOICE.card(0));
check('buy Åkstrafe (blue, 1 slot)');
if (me.cards.length !== 1) {
  console.log('FAIL: should hold 1');
  fails++;
}
tick(CHOICE.card(0));
check('buy Dubbel with a full blue card (refused)');
if (me.cards.length !== 1) {
  console.log('FAIL: blue card must refuse a 2nd ticket');
  fails++;
}
tick(CHOICE.upgrade);
check('upgrade to green');
if (me.cardTier !== 'green') {
  console.log('FAIL: not green');
  fails++;
}
tick(CHOICE.card(0));
check('buy Dubbel → [dubbel, akstrafe]: it goes above the last ticket and copies it');
if (me.cards[0] !== 'dubbel' || Math.abs(me.mods.ticketMove - 2.56) > 1e-9) {
  console.log(
    `FAIL: a bought Dubbel must copy at once. Cards [${me.cards}], speed ${me.mods.ticketMove} (want 1.6² = 2.56)`,
  );
  fails++;
}
tick(CHOICE.swap(0, 1));
check('swap → [akstrafe, dubbel]: nothing below, copies nothing');
if (Math.abs(me.mods.ticketMove - 1.6) > 1e-9) {
  console.log(`FAIL: speed should be 1.6, is ${me.mods.ticketMove}`);
  fails++;
}
tick(CHOICE.swap(0, 1));
tick(CHOICE.upgrade);
check('upgrade to yellow');
tick(CHOICE.card(0));
check('buy Nattbuss → [dubbel, akstrafe, nattbuss]');
if (me.mods.dashLen !== 2) {
  console.log('FAIL: dashLen');
  fails++;
}
tick(CHOICE.swap(1, 2));
check('swap → [dubbel, nattbuss, akstrafe]: dubbel now copies Nattbuss');
if (me.mods.dashLen !== 4 || Math.abs(me.mods.ticketMove - 1.6) > 1e-9) {
  console.log(`FAIL: dashLen ${me.mods.dashLen} speed ${me.mods.ticketMove}`);
  fails++;
}
me.offer = { kind: 'shop', items: [], openedAt: sim.gameNow, canReroll: false };
tick(CHOICE.sell(0));
check('sell slot 0 (dubbel)');
tick(CHOICE.sell(0));
check('sell slot 0 (nattbuss)');
tick(CHOICE.sell(0));
check('sell slot 0 (akstrafe): back to defaults?');
// reorder outside the kiosk: no offer open
me.offer = null;
me.money = 5000;
me.shelf = ['reservkraft', 'magnet'];
me.offer = { kind: 'shop', items: [...me.shelf], openedAt: sim.gameNow, canReroll: false };
tick(CHOICE.card(0));
tick(CHOICE.card(0));
me.offer = null;
tick(CHOICE.swap(0, 1));
check('swap with no kiosk open');
if (me.cards[0] !== 'magnet') {
  console.log('FAIL: swap outside kiosk did not apply');
  fails++;
}
// Reservkraft: go down once, get up, ticket spent
me.health = 1;
me.iframesUntil = 0;
(sim as any).die(me, 'probe');
const up = me.alive && !me.downed && me.health > 1 && !me.cards.includes('reservkraft');
console.log(
  `${up ? 'ok  ' : 'FAIL'} Reservkraft: alive=${me.alive} downed=${me.downed} hp=${me.health} cards=[${me.cards.join(',')}]`,
);
if (!up) fails++;
check('after Reservkraft was spent');

// EVERY ticket a Dubbelbiljett copies does something: the rules read off the
// card count copies (core/cards.ts COUNTED), and Reservkraft copied is two lives
for (const t of TICKETS) {
  if (t.id === 'dubbel') continue;
  if (!stacks(t)) {
    console.log(`FAIL: ${t.title} does nothing twice: a Dubbelbiljett copying it is wasted`);
    fails++;
  }
}
// ...and the kiosk sells one of each: never a ticket you already hold
{
  const held = ['akstrafe', 'magnet', 'dubbel'];
  let r = 0.013;
  for (let k = 0; k < 500; k++) {
    const shelf = rollShelf(() => (r = (r * 9301 + 0.4927) % 1), held, 3);
    const dup = shelf.find((id) => held.includes(id));
    if (dup) {
      console.log(`FAIL: the kiosk offered ${dup}, which is already on the card`);
      fails++;
      break;
    }
  }
}
// TICKETS STAND OUTSIDE THE CAPS: a flash build is allowed to break the game
{
  // what src/sim/walk.ts moves by: the perks capped, the tickets on top
  const walkSpeedOf = (m: typeof me.mods) => Math.min(C.MOVE_SPEED_CAP, m.moveSpeed) * m.ticketMove;
  me.cardTier = 'yellow';
  me.offer = null;
  applyTickets(me, -1);
  me.cards.length = 0;
  me.cards.push('dubbel', 'akstrafe', 'snabbtag');
  applyTickets(me, 1);
  const v = walkSpeedOf(me.mods);
  const want = 1.6 * 1.6 * 1.4;
  console.log(
    `${Math.abs(v - want) < 1e-9 ? 'ok  ' : 'FAIL'} flash build [dubbel, akstrafe, snabbtag]: ×${v.toFixed(2)} (want ×${want.toFixed(2)}, past the 1.9 cap)`,
  );
  if (Math.abs(v - want) > 1e-9) fails++;
  // and the cast tickets make casting FASTER: the interval shrinks
  if (!(me.mods.ticketCast < 1)) {
    console.log(`FAIL: Snabbtåg made the time between casts ×${me.mods.ticketCast} (must be < 1)`);
    fails++;
  }
  applyTickets(me, -1);
  me.cards.length = 0;
  applyTickets(me, 1);
}
const holder = { cards: ['dubbel', 'rabattkort'] };
if (ticketCount(holder, 'rabattkort') !== 2 || kioskMul(holder) !== 0.5625 || machineMul(holder) !== 0.25) {
  console.log(
    `FAIL: Rabattkort copied: count ${ticketCount(holder, 'rabattkort')} kiosk ${kioskMul(holder)} machines ${machineMul(holder)}`,
  );
  fails++;
}
me.cardTier = 'yellow';
me.cards.length = 0;
me.cards.push('dubbel', 'reservkraft');
let lives = 0;
for (let k = 0; k < 3; k++) {
  me.health = 1;
  me.iframesUntil = 0;
  (sim as any).die(me, 'probe');
  if (me.alive && !me.downed) lives += 1;
}
console.log(
  `${lives === 2 ? 'ok  ' : 'FAIL'} Reservkraft under a Dubbelbiljett: ${lives} lives (want 2), cards=[${me.cards}]`,
);
if (lives !== 2) fails++;
console.log(fails === 0 ? 'PASS' : `${fails} FAILED`);

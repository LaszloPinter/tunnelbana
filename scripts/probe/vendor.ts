// THE SECRET VENDOR: is somebody actually trading in the first recess at
// either end of the Slussen–Medborgarplatsen corridor, and nowhere else?
//
//   node --experimental-strip-types scripts/probe/vendor.ts

import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { putInLegAt } from '../lib/legs.ts';
import { BTN, CHOICE, InputEdges } from '../../src/sim/tick.ts';
import {
  BORE_WALL,
  RECESS_DEPTH,
  RECESS_EVERY,
  RECESS_FIRST,
  corridorOf,
  recessCentres,
} from '../../src/core/corridor.ts';
import * as C from '../../src/config.ts';
import { atVendor } from '../../src/sim/legWalk.ts';

let failed = 0;
const fail = (s: string) => {
  failed += 1;
  console.log('  FAIL ' + s);
};

const c = corridorOf('Slussen', 'Medborgarplatsen')!;
for (const stName of ['Slussen', 'Medborgarplatsen']) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 1;
  sim.startRun();
  sim.beginRun();
  const me = sim.me;
  const centres = recessCentres(c);
  const vendorS = stName === c.a ? centres[0] : centres[centres.length - 1];
  me.frame = { kind: 'world' };
  putInLegAt(sim, me, c, vendorS, BORE_WALL + RECESS_DEPTH - me.r - 2);
  me.noTrainHitUntil = 1e12;
  me.iframesUntil = 1e12;
  if (!atVendor(sim, me)) {
    fail(`${stName}: standing in the vendor recess but atVendor says no`);
    continue;
  }
  const edges = new InputEdges();
  sim.runTick(edges.sample(BTN.use, 0, 0, 0, 0, CHOICE.none));
  if (me.offer?.kind === 'shop')
    console.log(`ok   ${stName}: E in the recess 45 m into the tunnel opens the shop. No clearing required`);
  else fail(`${stName}: E at the vendor's window opened ${me.offer?.kind ?? 'nothing'}`);
  // the next recess along is just a recess, where there is one that is
  // not the other end's vendor (the leg has two recesses at some scales)
  me.offer = null;
  if (centres.length >= 3) {
    putInLegAt(sim, me, c, vendorS + (stName === c.a ? RECESS_EVERY : -RECESS_EVERY), me.y);
    if (atVendor(sim, me)) fail(`${stName}: the neighbouring recess is a vendor too. It should not be`);
  }
  // and any other corridor is not a vendor at all
  const other = corridorOf('Gamla stan', 'Slussen')!;
  putInLegAt(sim, me, other, other.s0 + RECESS_FIRST, me.y);
  if (atVendor(sim, me)) fail('a vendor turned up on the Gamla stan leg');
}
console.log('ok   the vendor trades on that one leg only');
void C;

console.log(failed ? `\n${failed} FAILED` : '\nPASS');
process.exit(failed ? 1 : 0);

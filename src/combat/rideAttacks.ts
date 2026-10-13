import * as C from '../config.ts';
import { rollEnemyType } from './enemies.ts';
import { pushFx } from './fx.ts';
import { randRange } from '../sim/det.ts';
import { ENEMY_R, type CombatHost } from './types.ts';
import type { Player } from '../sim/player.ts';

/**
 * THE RIDE'S ATTACKS: rides are not a lounge. Things crawl in through the
 * gangways mid-tunnel, in numbers that grow with the run, and tunnel light
 * blazes through the windows in telegraphed zones, dash to shadow.
 */
export function stepRideAttacks(ctx: CombatHost, riders: Player[], t: number, now: number) {
  const riding = riders.length > 0;
  // rides are not a lounge: things crawl in through the gangways mid-tunnel,
  // in numbers that grow with the run
  if (!riding) {
    ctx.run.nextRideAttackAt = now + 7000;
    ctx.run.nextStrikeAt = now + 5000;
  } else if (now > ctx.run.nextRideAttackAt) {
    ctx.run.nextRideAttackAt = now + 8000 + ctx.run.rng() * 5000;
    // the crawl-ins come for the car the first rider is in; everyone aboard
    // counts for where they are allowed to appear
    const lead = riders[0];
    const pf2 = lead.frame;
    if (pf2.kind === 'world') return;
    const rt = ctx.st.rails[pf2.ti].train;
    const body = rt.bodyAtRel(pf2.rx);
    const wallY = C.CAR_WIDTH / 2 - ENEMY_R - 2;
    const riderRx = riders.map((q) => (q.frame.kind === 'world' ? pf2.rx : q.frame.rx));
    const nearestRider = (rx: number) => Math.min(...riderRx.map((r) => Math.abs(r - rx)));
    const count = Math.min(2 + Math.floor(t / 70) + Math.floor(ctx.run.rideStreak * 1.5), 10);
    // Where they come in: anywhere along the car's two walls, not just its two
    // ends, the ends are the only places worth holding, and things appearing
    // on top of you there is not a fight, it is a tax. Everything within a few
    // metres of you is struck off the list, and what is left is preferred by
    // distance, so the far end of the car fills up first.
    const spots: { rx: number; ry: number }[] = [];
    for (let x = body.x0 + C.M(1.5); x <= body.x1 - C.M(1.5); x += C.M(2.5)) {
      spots.push({ rx: x, ry: -wallY }, { rx: x, ry: wallY });
    }
    // Far enough to be fair, near enough to SEE: a C30 is one body 140m long,
    // and sorting purely by distance put every crawl-in at the far end, a
    // hundred metres away and off the side of the screen, warned about
    // something you cannot see is the same as not warned.
    const band = spots.filter((sp) => {
      const d = nearestRider(sp.rx);
      return d > C.M(7) && d < C.M(34);
    });
    const pool = band.length >= 2 ? band : spots.filter((sp) => nearestRider(sp.rx) > C.M(7));
    if (pool.length === 0) pool.push(...spots);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.run.rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 0; i < count && ctx.st.enemies.length + ctx.st.boardings.length < 55; i++) {
      const sp = pool[i % pool.length];
      const wallSide = sp.ry > 0 ? 1 : -1;
      ctx.st.boardings.push({
        id: ctx.run.nextLootId++,
        ti: pf2.ti,
        jid: pf2.jid ?? ctx.st.rails[pf2.ti]?.journey ?? undefined,
        rx: sp.rx,
        // it comes through the wall, so it arrives just inside it
        ry: sp.ry - wallSide * C.M(0.2),
        at: now + 1100,
        type: rollEnemyType(ctx, t, 0.35),
      });
    }
    ctx.showMsg('Something is working at the windows…', now);
  }

  // TUNNEL STRIKES: mid-ride, light blazes through the windows, telegraphed
  // zones that hit everything inside. Dash to shadow. Crawl-ins caught in
  // the light are obliterated (the old world is not careful with its own).
  if (riding && now > ctx.run.nextStrikeAt) {
    const pf = riders[0].frame;
    const rt2 = pf.kind !== 'world' ? ctx.st.rails[pf.ti].train : null;
    if (rt2 && pf.kind !== 'world' && rt2.phase === 'transit') {
      ctx.run.nextStrikeAt = now + Math.max(2400, 5200 - ctx.run.rideStreak * 700) + ctx.run.rng() * 2600;
      const body2 = rt2.bodyAtRel(pf.rx);
      const zones =
        2 +
        Math.min(2, Math.floor(ctx.run.stopsTraveled / 3)) +
        Math.min(2, Math.floor(ctx.run.rideStreak / 2));
      for (let z = 0; z < zones; z++) {
        const w = C.M(3);
        const x0 = randRange(ctx.run.rng, body2.x0 + 6, body2.x1 - 6 - w);
        ctx.st.strikes.push({
          id: ctx.run.nextLootId++,
          ti: pf.ti,
          jid: pf.jid ?? ctx.st.rails[pf.ti]?.journey ?? undefined,
          x0,
          x1: x0 + w,
          at: now + 1600,
        });
      }
      pushFx(ctx.run.fx, { kind: 'shake', ms: 160, power: 0.003 });
      ctx.showMsg('⚠ TUNNEL LIGHT INCOMING: dash out of the marked zones!', now);
    }
  }
}

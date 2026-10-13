import * as C from '../config.ts';
import { randInt } from '../sim/det.ts';
import { asStation } from '../sim/place.ts';
import { spawnEnemy } from './enemies.ts';
import { ENEMY_R, type CombatHost } from './types.ts';

/**
 * The crawl-in: what a train carries INTO the station the party stands in.
 *
 * Rolled from the JOURNEY's own stream, so a given train on a given seed
 * always arrives carrying the same passengers; and only for a place with a
 * player in it. Every live place used to stock every train that called
 * there, so a neighbour you never boarded accumulated a horde in its cars
 * (measured 42 aboard at Stora mossen, 2026-09-04).
 */
export function spawnAboardEnemies(ctx: CombatHost, ti: number, now: number, jid: string) {
  const rail = ctx.st.rails[ti];
  const t = rail.train;
  // NEVER into a car somebody is riding. What comes at you on a train you
  // are on comes through a window, telegraphed (hazards.ts stepBoardings),
  // it used to simply appear in the seat beside you (from play 2026-09-04)
  if (ctx.run.players.some((q) => q.alive && q.frame.kind !== 'world' && q.frame.ti === ti)) return;
  const secs = (now - ctx.run.runStart) / 1000;
  // deeper into the run the arriving trains are already infested
  let count = Math.min(
    1 + Math.floor(secs / 70) + Math.floor(Math.max(0, ctx.run.stopsTraveled - 2) * 1.2),
    9,
  );
  // a cleared station that has let two trains go: the third arrives carrying
  // creeps, and they get off (§16), awake, and more of them
  const infested = ctx.st.cleared && (asStation(ctx.st)?.missedTrains ?? 0) >= 2;
  if (infested) count = Math.min(count + 4 + (asStation(ctx.st)?.missedTrains ?? 0), 12);
  // ...and never more than a carful, whatever is already riding this rail
  const riding = ctx.st.enemies.filter((e) => e.frame.kind === 'aboard' && e.frame.ti === ti).length;
  count = Math.min(count, Math.max(0, ABOARD_PER_RAIL - riding));
  const rng = ctx.run.contentRng(`aboard:${jid}`);
  const wallY = C.CAR_WIDTH / 2 - ENEMY_R - 2;
  for (let i = 0; i < count && ctx.st.enemies.length < 55; i++) {
    const body = t.bodies[Math.floor(rng() * t.bodies.length)];
    const rx = randInt(rng, body.x0 + 20, body.x1 - 20);
    const ry = randInt(rng, -wallY, wallY);
    spawnEnemy(
      ctx,
      'runner',
      { kind: 'aboard', ti, rx, ry },
      t.x + rx,
      t.centerY + ry,
      infested,
      0,
      1,
      1,
      rng,
    );
  }
}

/** how many the horde will ride in one train's cars at once */
const ABOARD_PER_RAIL = 9;

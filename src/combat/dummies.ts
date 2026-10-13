import * as C from '../config.ts';
import { clamp } from '../sim/det.ts';
import { onPlatform } from '../world/floor.ts';
import { spawnEnemy } from './enemies.ts';
import type { CombatHost } from './types.ts';
import { asStation } from '../sim/place.ts';

/**
 * THE TUTORIAL'S DUMMIES: three vättar on the platform that never turn
 * aggressive and never bite, something for the bolt, the torrent and
 * STÖT to land on, and another whenever one is put down.
 */
export function keepDummies(ctx: CombatHost, now: number) {
  const st = asStation(ctx.st);
  if (!st || st.platforms.length === 0) return;
  let alive = 0;
  for (const e of ctx.st.enemies) {
    if (e.hp <= 0) continue;
    alive += 1;
    e.aggro = false;
    e.hitCdUntil = now + 1000;
  }
  if (alive >= 3 || now < st.nextWaveAt) return;
  const me = ctx.players[0];
  // ...beside a body standing on this platform: at the start of a run the
  // body is not on the map yet, and a dummy made then stood 3.5 km away
  if (!me || me.frame.kind !== 'world' || ctx.run.map.at(me.x, me.y)?.kind !== 'platform') return;
  const local = onPlatform(st, me.x, me.y);
  if (!local) return;
  // six to nine metres along the platform, either way, on your island
  const side = ctx.run.rng() < 0.5 ? -1 : 1;
  // ...and inside Tutorialstorg's pen, where they can be reached
  const pen = ctx.run.tutorialPen;
  const inPen = !!pen && pen.station === st.name;
  const lx = clamp(
    local.x + side * C.M(6 + ctx.run.rng() * 3),
    inPen ? pen.x0 + C.M(2) : st.platformX0 + C.M(2),
    inPen ? pen.x1 - C.M(2) : st.platformX1 - C.M(2),
  );
  // spawnEnemy takes the station's own along-and-across and puts the body
  // on the map itself (enemies.ts): handing it a map point put the dummies
  // 3.5 km away, converted twice
  spawnEnemy(ctx, 'runner', { kind: 'world' }, lx, local.y, false);
  st.nextWaveAt = now + 2500;
}

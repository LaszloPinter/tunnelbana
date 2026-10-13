import * as C from '../config.ts';
import { drawY } from './drawAt.ts';
import { applyKnock, applyOnHit, sameFrame } from './enemies.ts';
import { hurtEnemy } from './enemyDeath.ts';
import { pushFx, ring } from './fx.ts';
import { dist } from '../sim/det.ts';
import { stepEnemy } from './enemyAI.ts';
import { stepAcidPools, stepStains, stepStrikes, stepBoardings } from './hazards.ts';
import { stepLoot } from './loot.ts';
import { stepProjectiles } from './projectiles.ts';
import { stepWaves, keepDummies } from './waves.ts';
import { stepRideAttacks } from './rideAttacks.ts';
import { stepPlayerCombat } from './casting.ts';
import type { CombatHost } from './types.ts';
import { activePlayers, alivePlayers, type Player } from '../sim/player.ts';

/**
 * The combat step: every player's casting, the ride's attacks, the station's
 * waves, and the per-frame update of everything the other modules own.
 * Called once per fixed sim step, after the players have moved.
 */

/** `waves`: the station's wave clock runs only while somebody stands ON its
 * platform, a walker out in a leg fights, but the tunnel stays quiet */
export function stepCombat(ctx: CombatHost, dt: number, now: number, waves = true) {
  for (const p of activePlayers(ctx.players)) stepPlayerCombat(ctx, p, dt, now);
  stepStains(ctx, now);
  stepAcidPools(ctx, now);

  // what is riding: a player aboard a train that is between stations. Under
  // one station there is one party, so if anyone is riding the party is,
  // and the platform spawner rests while the ride's own attacks run.
  const riders = alivePlayers(ctx.players).filter(
    (p) => p.frame.kind !== 'world' && ctx.st.rails[p.frame.ti].train.phase === 'transit',
  );
  const riding = riders.length > 0;
  const t = (now - ctx.run.runStart) / 1000;

  // THE TUTORIAL IS PEACEFUL: nothing crawls in, nothing strikes, no wave
  // and no dark. Everything else, the trains, the machines, your own
  // casts, runs exactly as in a run (sim/run.ts tutorial).
  const peaceful = ctx.run.tutorial;
  if (peaceful) keepDummies(ctx, now);
  if (!peaceful) {
    stepRideAttacks(ctx, riders, t, now);
    stepBoardings(ctx, now);
    stepStrikes(ctx, now);
  }

  // the station's waves, the clearing, and the dark that follows it
  if (!riding && waves && !peaceful) stepWaves(ctx, dt, now);

  for (const e of [...ctx.st.enemies]) stepEnemy(ctx, e, dt, now);
  stepProjectiles(ctx, dt, now);
  stepLoot(ctx, now);
  ctx.st.enemies = ctx.st.enemies.filter((e) => e.hp > 0);
}

/**
 * A place within reach but with nobody in it LIVES without escalating: the
 * horde wanders, shots fly out, loot lies where it fell, no waves, no
 * dark, no ride attacks. What you will find there is what is there now.
 */
export function stepAmbient(ctx: CombatHost, dt: number, now: number) {
  stepStains(ctx, now);
  stepAcidPools(ctx, now);
  // OVER A COPY: a body that walks into the next room mid-step is spliced
  // out of this list (world/metal.ts reroom), and the one shifted into its
  // slot was skipped for the tick. The stamp in stepEnemy keeps the mover
  // from being stepped again when its new room's turn comes.
  for (const e of [...ctx.st.enemies]) stepEnemy(ctx, e, dt, now);
  stepProjectiles(ctx, dt, now);
  stepLoot(ctx, now);
  ctx.st.enemies = ctx.st.enemies.filter((e) => e.hp > 0);
}

/** dashing through enemies hurts and shoves them; each once per dash */
export function dashContacts(ctx: CombatHost, p: Player, now: number) {
  for (const e of ctx.st.enemies) {
    if (e.hp <= 0 || p.dashHit.has(e.id) || !sameFrame(p, e)) continue;
    if (dist(e.x - p.x, e.y - p.y) < p.r + e.r + 4) {
      p.dashHit.add(e.id);
      hurtEnemy(ctx, e, 1 + p.mods.dashDamage, now, p);
      applyOnHit(ctx, p, e, now);
      applyKnock(ctx, e, { x: p.dashDirX, y: p.dashDirY }, C.M(14));
    }
  }
  pushFx(ctx.run.fx, ring(p.x, drawY(ctx, p), p.r, 0x9fd8ff, 1, 200, 0.3, 5.9));
}

/**
 * Casting animations. 'arc' sweeps the magic-circle anim once; 'bolt'
 * throws once; 'torrent' CHANNELS, the pose freezes on the arm-extended
 * frame while shots stream out, released ~a quarter second after the last.
 */
/** rig-based casting: torrent holds the arm out, everything else jabs.
 * The rig's torso is independent of the legs, so this works mid-run. */

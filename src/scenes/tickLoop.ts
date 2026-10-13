import { EMPTY_INPUT, STEP_MS } from '../sim/tick.ts';
import { fingerprint } from '../sim/fingerprint.ts';
import type { DemoScene } from './DemoScene.ts';
import type { Run } from '../sim/run.ts';
import { railTrainOf } from '../world/metal.ts';
import { dist } from '../sim/det.ts';
import { enemyJid } from '../combat/enemyTarget.ts';
import * as C from '../config.ts';

/** how much faster a dull ride runs */
export const RIDE_WARP = 4;
/** how long a ride must stay clear before it fast-forwards again */
export const WARP_SETTLE_MS = 1500;

/**
 * THE RIDE BETWEEN STATIONS IS FAST-FORWARDED: watching a tunnel go by for
 * a minute was the dullest part of a run (from play 2026-10-01 / 10-10).
 * While the local seat rides a train that is MOVING (not braking into a
 * platform, not standing at one) and nothing of the horde is aboard it, the
 * clock runs RIDE_WARP ticks for every one, more ticks a frame, the same
 * ticks: nothing about the world changes, so it is as deterministic as any
 * other frame. Solo only: a room keeps one clock for everyone.
 */
export function rideWarp(sim: Run): number {
  const me = sim.me;
  if (!me.alive || me.frame.kind !== 'aboard') return 1;
  const jid = me.frame.jid;
  if (!jid) return 1;
  const t = railTrainOf(sim, jid);
  if (t && (t.phase === 'dwell' || t.phase === 'arriving')) return 1;
  // ...not while anything of the horde is CLOSE in the train: fast-forwarded,
  // a fight would give you a quarter of your reaction time. Something at the
  // far end of the train is not a fight yet (a train usually carries a few:
  // "nothing aboard" never held, measured 19–43 on a ride)
  for (const id of sim.live) {
    const pl = sim.places.get(id);
    if (
      pl?.enemies.some(
        (e) =>
          e.hp > 0 &&
          // (a crawl-in is filed by its rail and may carry no jid of its own)
          enemyJid(pl, e) === jid &&
          dist(e.x - me.x, e.y - me.y) < C.M(12),
      )
    )
      return 1;
  }
  return RIDE_WARP;
}

/**
 * THIS FRAME'S TICKS. The clock is a COUNT: wall time decides how many ticks
 * may run, never what a tick is worth (§11c), one path whatever the mode,
 * solo or a room. A held world (pause, the briefing, the run-over, the
 * opening shot, the wait between rides) still lets ONE tick through to
 * carry a pick: a reorder on the pause screen is a choice input (§16), and
 * a held run that pulled no ticks threw it away (from play 2026-09-06).
 * Returns how many ran, and whether the world was frozen.
 */
export function runFrameTicks(
  scene: DemoScene,
  deltaMs: number,
  held: boolean,
): { ran: number; frozen: boolean } {
  const session = scene.session;
  const sim = scene.sim;
  const inputs = scene.inputs;
  const frozen = held && !inputs.hasChoice;
  // THE RIDE, FAST-FORWARDED (solo): see rideWarp
  // ...dropping at once when it must, coming back only after a beat of clear
  // riding: something pacing at the edge of twelve metres flickered it on
  // and off (from play 2026-10-11)
  const want = !held && session.local ? rideWarp(sim) : 1;
  if (want > 1) {
    if (scene.warpClearSince === 0) scene.warpClearSince = performance.now();
    scene.warp = performance.now() - scene.warpClearSince > WARP_SETTLE_MS ? want : 1;
  } else {
    scene.warpClearSince = 0;
    scene.warp = 1;
  }
  const dtms = Math.min(deltaMs * scene.warp, held ? STEP_MS : 250);
  const clock = sim.clock;
  let ran = 0;
  // how far the pointer moved this frame, for the tutorial's "aim" stage
  const ptr = scene.input.activePointer;
  const pointerMoved = Math.hypot(ptr.x - scene.lastPointer.x, ptr.y - scene.lastPointer.y);
  scene.lastPointer = { x: ptr.x, y: ptr.y };
  for (const { tick, inputs: row } of session.ticks.pull(dtms, frozen)) {
    if (tick !== clock.tick) continue; // late duplicate after a restart
    ran += 1;
    session.inputLog.push(row);
    sim.runTickWith(row);
    session.tutorial?.observe({
      input: row[0],
      keyDown: (k) => inputs.isDown(k),
      pointerMoved: ran === 1 ? pointerMoved : 0,
      device: inputs.device,
      pad: inputs.pad,
      sim,
    });
    session.ticks.afterTick(clock.tick, () => fingerprint(sim.simState()));
  }
  // solo, a frozen world must not look like the player is still leaning on
  // a key; a room never freezes for one seat
  if (frozen && session.local) sim.me.input = EMPTY_INPUT;
  return { ran, frozen };
}

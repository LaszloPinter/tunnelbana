import { fingerprint } from '../sim/fingerprint.ts';
import { CHOICE, InputEdges, type TickInput } from '../sim/tick.ts';
import type { DemoScene } from '../scenes/DemoScene.ts';
import { sameFrameAs } from '../sim/player.ts';
import { gainXp } from '../combat/enemyDeath.ts';

/**
 * The replay check: is the simulation a function of (seed, inputs)?
 *
 * Drive a run from a seed with a scripted bot, recording every tick's input
 * and a fingerprint of the state once a second. Start the same seed again and
 * feed the RECORDED inputs back. If the fingerprints match to the last tick,
 * the simulation is deterministic on this engine for everything the bot
 * exercised; if they diverge, the tick they diverged on is where to look.
 *
 * This is not a proof across engines, that is what det.ts and the
 * check-det script are for, but it is the test that catches the class of
 * bug that has bitten this project four times already: state that depends on
 * something other than the tick stream (a frame-rate-dependent RNG draw, a
 * live pointer read, a counter that survives a restart). Run it from the
 * console: `tb.replayCheck()`, or `tb.replayCheck({ seed: 7, ticks: 3600 })`.
 *
 * It drives `scene.runTick` directly, so the tab may be in the background and
 * the clock's freeze for the perk screen does not apply, the bot answers
 * every offer with the first card, which is a pick like any other.
 */

export interface ReplayOptions {
  seed?: number;
  ticks?: number;
  /** fingerprint every this many ticks */
  every?: number;
  /** bring the party one kill short of this level at tick 0 (in both passes), so a
   * short run still reaches the class moments at 5 and 12 */
  startLevel?: number;
  /** the scripted player; the default one runs about, shoots what it sees and dashes now and then */
  bot?: (scene: DemoScene, t: number) => { held: number; mx: number; my: number; aimX: number; aimY: number };
}

export interface ReplayResult {
  seed: number;
  ticks: number;
  /** the first tick whose fingerprint differed, or -1 if none did */
  divergedAt: number;
  /** what the first run looked like, so a "pass" can be seen to have done something */
  first: { station: string; stops: number; kills: number; level: number; alive: boolean; enemies: number };
  fingerprints: number;
  /** on divergence: the first few paths whose values differed, so the hunt starts somewhere */
  diff: string[];
}

/** a plain copy of the state, for diffing, Maps and Sets become arrays */
const plain = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Map ? [...x] : x instanceof Set ? [...x] : x)));

function diffPaths(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (out.length >= 12) return out;
  if (typeof a !== typeof b) {
    out.push(`${path}: ${typeof a} vs ${typeof b}`);
    return out;
  }
  if (a && b && typeof a === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)]))
      diffPaths(ao[k], bo[k], `${path}.${k}`, out);
  } else if (!Object.is(a, b)) out.push(`${path}: ${String(a)} vs ${String(b)}`);
  return out;
}

/**
 * The default commuter: patrols the platform shooting what it sees, and when
 * a train is standing with its doors open, walks to the nearest door and
 * boards, so a run of a couple of minutes rides, arrives, and rebuilds
 * stations, which is where determinism is most likely to break. It never
 * moves vertically except to board, because a dash off the platform edge
 * ends the run under a train in seven seconds, as the first version found.
 */
const defaultBot: NonNullable<ReplayOptions['bot']> = (scene, t) => {
  const me = scene.me;
  const target = scene.sim.here.enemies.find((x) => x.hp > 0 && sameFrameAs(me, x));
  const aimX = target ? target.x : me.x + 100;
  const aimY = target ? scene.worldY(target.x, target.y) : scene.worldY(me.x, me.y);
  let held = target ? 1 : 0;
  if (t % 400 > 300) held |= 2;
  let mx = 0;
  let my = 0;
  if (me.frame.kind === 'world') {
    const open = scene.sim.here.rails.find((r) => r.train.phase === 'dwell' && r.train.doorsOpen);
    if (open) {
      // to the nearest door, then in
      const tr = open.train;
      let best = Infinity;
      let doorX = me.x;
      for (const d of tr.doors) {
        const cx = tr.x + (d.x0 + d.x1) / 2;
        if (Math.abs(cx - me.x) < best) {
          best = Math.abs(cx - me.x);
          doorX = cx;
        }
      }
      if (best > 6) mx = doorX > me.x ? 1 : -1;
      else my = tr.centerY > me.y ? 1 : -1;
    } else {
      mx = Math.sin(t / 90) > 0 ? 1 : -1;
      if (t % 240 < 6) held |= 4;
    }
  }
  return { held, mx, my, aimX, aimY };
};

function startFrom(scene: DemoScene, seed: number, startLevel: number) {
  const sim = scene.sim;
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  // one xp short of `startLevel`, so the first kill brings the moment
  while (sim.party.level < startLevel - 1) gainXp(sim.hereHost, sim.party.xpNext - sim.party.xp);
  if (startLevel > 1) gainXp(sim.hereHost, sim.party.xpNext - sim.party.xp - 1);
}

export function replayCheck(scene: DemoScene, opts: ReplayOptions = {}): ReplayResult {
  const seed = opts.seed ?? 1;
  const ticks = opts.ticks ?? 60 * 60;
  const every = opts.every ?? 60;
  const bot = opts.bot ?? defaultBot;
  const startLevel = opts.startLevel ?? 1;
  const pinned = { seedPinned: scene.sim.seedPinned, runSeed: scene.sim.runSeed };

  // ---- pass 1: play, recording
  startFrom(scene, seed, startLevel);
  const log: TickInput[] = [];
  const prints: number[] = [];
  const states: unknown[] = [];
  const edges = new InputEdges();
  for (let t = 0; t < ticks; t++) {
    const b = bot(scene, t);
    // answer every offer with a card, which one varies with the tick, so
    // over a few seeds every class and track gets played
    const offer = scene.me.offer;
    const choice = offer ? CHOICE.card(t % Math.max(1, offer.items.length)) : CHOICE.none;
    const input = edges.sample(b.held, b.mx, b.my, b.aimX, b.aimY, choice);
    log.push(input);
    scene.sim.runTick(input);
    if (t % every === every - 1) {
      prints.push(fingerprint(scene.sim.simState()));
      states.push(plain(scene.sim.simState()));
    }
    if (scene.sim.over) break;
  }
  const first = {
    station: scene.station,
    stops: scene.sim.stopsTraveled,
    kills: scene.me.kills,
    level: scene.party.level,
    alive: scene.me.alive,
    enemies: scene.sim.here.enemies.length,
  };

  // ---- pass 2: the same seed, the recorded inputs
  startFrom(scene, seed, startLevel);
  let divergedAt = -1;
  let diff: string[] = [];
  for (let t = 0; t < log.length; t++) {
    scene.sim.runTick(log[t]);
    if (t % every === every - 1) {
      const fp = fingerprint(scene.sim.simState());
      const i = Math.floor(t / every);
      if (fp !== prints[i]) {
        divergedAt = t;
        diff = diffPaths(states[i], plain(scene.sim.simState()));
        break;
      }
    }
    if (scene.sim.over) break;
  }

  scene.sim.seedPinned = pinned.seedPinned;
  scene.sim.runSeed = pinned.runSeed;
  return { seed, ticks: log.length, divergedAt, first, fingerprints: prints.length, diff };
}

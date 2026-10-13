/**
 * The simulation's clock, and the one thing that drives it: input.
 *
 * ---- why a tick counter and not elapsed time ----
 *
 * The sim has always run on a fixed timestep, but the NUMBER of steps a frame
 * took came from the wall clock, and the timestamp handed to each step was the
 * accumulated real elapsed time. Two machines at different frame rates
 * therefore advanced the world by different amounts and stamped every timer,
 * dash cooldowns, spawn schedules, door timings, with different numbers. That
 * is invisible in single player and fatal in lockstep.
 *
 * So the clock is now a COUNT. Tick n is always at exactly `n * STEP_MS`,
 * whatever the frame rate, and the wall clock only decides how many ticks a
 * frame is allowed to run, never what they are worth.
 *
 * ---- and why input has to be a snapshot ----
 *
 * A tick is defined by the input that went into it, and input is the only
 * thing that will ever cross the wire. Reading the keyboard live inside the
 * step made that impossible to capture, and was already subtly wrong:
 * `JustDown` is a per-FRAME edge, so on a slow frame running four ticks, a
 * dash fired on the first and was silently absent from the other three.
 * Sampling once per tick fixes that and makes a tick something you can send.
 */

/** the fixed simulation step, in milliseconds */
export const STEP_MS = 1000 / 60;

/** the most real time one frame may hand the simulation; a backgrounded tab
 * drops the rest rather than trying to catch up on a minute of it. Lives
 * here, not in config: this file is imported by the relay server, and the
 * clock's own constants are the clock's own business. */
export const MAX_FRAME_MS = 250;

/**
 * A frame's real time is never quite a step. On a 60 Hz screen the browser
 * hands us 16.5, 16.8, 16.7..., a whole step, plus noise, and an accumulator
 * fed that raw sits near a tick boundary and flips: one frame runs no tick,
 * the next runs two, and the world stutters while the frame counter says a
 * steady sixty (from play 2026-09-24: "things move jittery even though the
 * panel says 60 fps"). So a delta within a millisecond of a whole or half
 * step is taken AS that step, which is what the screen meant: one tick a
 * frame at 60 Hz, one every other frame at 120 Hz, exactly. Anything
 * further off (144 Hz, a real hitch) is left alone and accumulated honestly.
 * The tolerance is tight on purpose: at 144 Hz a frame is 6.9 ms, and a
 * looser snap to the half step would run the world a fifth slow.
 */
const SNAP_MS = 1;
const SNAP_STEPS = [0.5, 1, 2, 3, 4];
export function snapToStep(deltaMs: number): number {
  for (const k of SNAP_STEPS) {
    const at = STEP_MS * k;
    if (deltaMs > at - SNAP_MS && deltaMs < at + SNAP_MS) return at;
  }
  return deltaMs;
}

/** the buttons, as a bitfield, this is what a network packet would carry */
export const BTN = {
  fire: 1 << 0,
  shield: 1 << 1,
  dash: 1 << 2,
  use: 1 << 3,
  weapon1: 1 << 4,
  weapon2: 1 << 5,
  weapon3: 1 << 6,
  /** Q: the class's ultimate, where it has one */
  ult: 1 << 7,
  // the pings (§16): canned calls, sent as input like everything else, so
  // every client shows the same call at the same tick. They ride the held
  // bitfield, so the edge detector gives their one-shot for free.
  pingHere: 1 << 8,
  pingTrain: 1 << 9,
  pingHelp: 1 << 10,
  pingWait: 1 << 11,
} as const;

export const PINGS: { bit: number; text: string }[] = [
  { bit: BTN.pingHere, text: 'Over here!' },
  { bit: BTN.pingTrain, text: 'Get on the train!' },
  { bit: BTN.pingHelp, text: 'Pick me up!' },
  { bit: BTN.pingWait, text: 'Wait!' },
];

/**
 * Everything one player does in one tick. Deliberately small and plain: about
 * six bytes once quantised, which is what makes a four-player room cost a few
 * kilobytes a second.
 */
export interface TickInput {
  /** movement: a push no longer than one, turned into the place's frame
   * (scenes/input.ts); logged in hundredths (sim/inputLog.ts) */
  mx: number;
  my: number;
  /** where the cursor is, in world coordinates */
  aimX: number;
  aimY: number;
  /** held this tick */
  held: number;
  /** went down THIS tick, an edge, computed per tick rather than per frame */
  pressed: number;
  /**
   * A pick from whatever the simulation is offering this player, a perk
   * card, an element, the reroll, the skip. 0 is no pick. It is an INPUT
   * because it changes the simulation, and nothing may change the
   * simulation except through a tick: a click handler writing `mods`
   * directly is a desync four clients cannot recover from.
   */
  choice: number;
}

/** the choice codes: cards are 1..4 in offer order, then the two buttons */
export const CHOICE = {
  none: 0,
  card: (i: number) => i + 1,
  reroll: 5,
  skip: 6,
  /** at the kiosk: sell the ticket in slot i (0..2) */
  sell: (i: number) => 7 + i,
  /** at the kiosk: buy the next card tier */
  upgrade: 10,
  /** any time: swap the tickets in slots i and j (0..2), order matters */
  swap: (i: number, j: number) => 11 + i * 3 + j,
  /** between rides: this seat is ready, start the next one (sim/chain.ts) */
  go: 20,
} as const;
export const isSwapChoice = (c: number): boolean => c >= 11 && c < 20;
export const swapOf = (c: number): [number, number] => [Math.floor((c - 11) / 3), (c - 11) % 3];

export const EMPTY_INPUT: TickInput = { mx: 0, my: 0, aimX: 0, aimY: 0, held: 0, pressed: 0, choice: 0 };

/** the edge detector: turns a stream of held-bitfields into held + pressed */
/** a push component as the log stores it: hundredths, clamped to a unit */
export const hundredths = (v: number): number => Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100;

export class InputEdges {
  private last = 0;
  sample(held: number, mx: number, my: number, aimX: number, aimY: number, choice = 0): TickInput {
    const pressed = held & ~this.last;
    this.last = held;
    // THE SIM RUNS ON WHAT THE LOG HOLDS. A push arrives as an exact float
    // (a key turned with the view, a stick) and the log keeps hundredths;
    // fed the float, the live run walked a hair differently from its own
    // replay every tick, and a resumed run drifted until a vätte that had
    // missed you in the run met you in the replay (from play 2026-09-25:
    // "I come back, try continue, I die immediately"). Quantised HERE, once,
    // for every seat and every bot, the log is exact.
    return { mx: hundredths(mx), my: hundredths(my), aimX, aimY, held, pressed, choice };
  }
  /**
   * A tick the player did not supply input for.
   *
   * Repeating what they were already doing is the whole of the "don't wait for
   * the slowest player" rule: they keep running and keep firing rather than
   * freezing, which is both the least surprising thing to look at and the
   * least punishing thing to be. Held state carries; edges do not, because a
   * repeated dash is a dash they never pressed.
   */
  repeat(prev: TickInput): TickInput {
    this.last = prev.held;
    // and a repeated pick is a pick nobody made
    return { ...prev, pressed: 0, choice: 0 };
  }
}

/**
 * How many ticks a frame may advance.
 *
 * Local play converts elapsed milliseconds; a networked room will instead ask
 * how many ticks the server has confirmed input for. Both answer the same
 * question, which is the point of putting it behind one call.
 */
export class TickClock {
  /** ticks since the run began; the simulation's only notion of time */
  tick = 0;
  /**
   * Ticks during which sim TIME stood still, a party pick (§16). Ticks
   * keep flowing (they carry the picks), but `now` does not move, so trains,
   * timers and the horde wait. Simulation state, and part of the snapshot.
   */
  held = 0;
  private acc = 0;

  /**
   * Start counting from `tick0`, which for a networked room is an ABSOLUTE
   * tick off the shared epoch (§19) and for a solo run or a replay is 0. It
   * arrives as data, the simulation never reads a clock of its own, or a
   * run would stop being a function of its seed and inputs.
   */
  reset(tick0 = 0) {
    this.tick = tick0;
    this.held = 0;
    this.acc = 0;
  }

  /** the timestamp of the current tick, derived, never accumulated */
  get now(): number {
    return (this.tick - this.held) * STEP_MS;
  }

  /**
   * Ticks to run for `deltaMs` of real time. Capped, because a tab that was
   * backgrounded for a minute must not try to simulate a minute: it drops the
   * time instead, exactly as the old accumulator's 250ms clamp did.
   */
  advance(deltaMs: number, maxTicks = 8): number {
    this.acc += snapToStep(Math.min(deltaMs, MAX_FRAME_MS));
    let n = 0;
    // the epsilon: a snapped delta is STEP_MS to the bit, but `acc += x;
    // acc -= x` need not leave acc exactly where it was, and a residual a
    // hair under the step would otherwise flip a frame to zero ticks
    while (this.acc >= STEP_MS - 1e-6 && n < maxTicks) {
      this.acc -= STEP_MS;
      n += 1;
    }
    // whatever could not be run this frame is dropped rather than owed, so a
    // stall does not turn into a burst of catch-up ticks afterwards
    if (this.acc > STEP_MS * maxTicks) this.acc = 0;
    return n;
  }
}

import { STEP_MS, TickClock, type TickInput } from './tick.ts';

/**
 * WHERE A FRAME'S TICKS COME FROM.
 *
 * The scene used to ASK, `if (this.room)`, and that one question was the
 * whole bug. `room` was a mutable field meaning two things at once ("am I
 * networked" and "here is my live connection"), it was set the moment a lobby
 * opened, and nothing on any path out of a lobby ever cleared it. Back out of
 * a lobby and the scene still took the networked branch: it waited for
 * confirmed ticks from a room that had never started, so the world stood
 * still forever while the picture kept drawing at sixty frames a second.
 *
 * So the mode stops being a field to remember to clear and becomes the OBJECT
 * the scene holds. Solo, it is a clock that converts elapsed milliseconds.
 * In a room, it is a queue of ticks the room has confirmed. The scene asks
 * the same question of both and never learns which it has; swapping modes is
 * one assignment, and `dispose()` is the single place a socket, a channel or
 * a timer can be given up. There is nothing left to forget.
 *
 * Which answers the other half of it: **there is no room in a single-player
 * game.** Solo holds a `LocalTicks` and the word never comes up.
 */
export interface ConfirmedTick {
  /** the tick number this input set belongs to */
  tick: number;
  /** every seat's input, in seat order */
  inputs: TickInput[];
}

export interface TickSource {
  /**
   * Is this seat its own master? True solo, false in a room, and the few
   * things that genuinely ARE mode-dependent ask this rather than sniffing
   * at a connection. Pausing and restarting are done TO a run by one person;
   * in a room they would be decisions four people have to make at the same
   * tick, so they are simply refused.
   */
  readonly local: boolean;
  /** the ticks this frame may run, in order; empty is normal and fine */
  pull(deltaMs: number, frozen: boolean): ConfirmedTick[];
  /**
   * Called after each tick has run. The fingerprint is a thunk because
   * hashing the whole state is not free and only a room ever wants it.
   */
  afterTick(tick: number, fingerprint: () => number): void;
  /** give up whatever this holds. Safe to call on anything, at any time. */
  dispose(): void;
}

/**
 * Solo: the wall clock decides how many ticks may run, never what one is
 * worth (§11c). Frozen, paused, the briefing, the run-over screen, simply
 * yields no ticks.
 */
export class LocalTicks implements TickSource {
  readonly local = true;
  private clock: TickClock;
  /** the local seat's input for one tick, edges already derived */
  private sample: () => TickInput;

  // (plain assignments, not parameter properties: everything under src/sim
  // has to run in Node's strip-only TS, which is how the replay check and the
  // relay both load it)
  constructor(clock: TickClock, sample: () => TickInput) {
    this.clock = clock;
    this.sample = sample;
  }

  pull(deltaMs: number, frozen: boolean): ConfirmedTick[] {
    if (frozen) return [];
    const n = this.clock.advance(deltaMs);
    const out: ConfirmedTick[] = [];
    // `advance` moves only the accumulator; the tick counter moves when the
    // simulation actually runs one, so the numbers are known ahead of time
    for (let i = 0; i < n; i++) out.push({ tick: this.clock.tick + i, inputs: [this.sample()] });
    return out;
  }

  afterTick() {}
  dispose() {}
}

/**
 * Most confirmed ticks one frame may run while catching up. Twelve is a fifth
 * of a second of simulation per frame, fast enough to close a long gap in a
 * couple of seconds, slow enough that no single frame ever stalls.
 */
const MAX_CATCHUP_TICKS = 12;

/** what one seat is physically doing this frame, before edges are derived */
export interface Controls {
  held: number;
  mx: number;
  my: number;
  aimX: number;
  aimY: number;
}

/** the half of a room this file is allowed to know about */
export interface TickRoom {
  started: boolean;
  offer(raw: Controls, choice: number): void;
  pump(stepMs: number): void;
  report(tick: number, fp: number): void;
  close(): void;
}

/**
 * In a room the wall clock proposes nothing. This seat offers its raw input
 * every frame, the room derives the edges, so `pressed` is computed once per
 * tick whatever the frame rate on either side, and only ticks the room has
 * confirmed ever run. Nobody simulates a guess, so nobody has to un-simulate
 * one, which is why there is no rollback machinery anywhere in this game.
 */
export class RoomTicks implements TickSource {
  readonly local = false;
  private queue: ConfirmedTick[] = [];

  private room: TickRoom;
  private readControls: () => Controls;
  /** the local seat's pending pick, cleared by the reading */
  private takeChoice: () => number;

  /**
   * `queue` is passed IN rather than made here, and that is deliberate. A
   * room can deliver a tick while it is still being constructed, local mode
   * dispatches its own messages synchronously, so the caller creates the
   * array first, hands the room a callback that pushes into it, and only then
   * builds this. Owning the array here instead would mean the room's callback
   * had to close over a variable that did not exist yet.
   */
  constructor(
    room: TickRoom,
    readControls: () => Controls,
    takeChoice: () => number,
    queue: ConfirmedTick[] = [],
  ) {
    this.room = room;
    this.readControls = readControls;
    this.takeChoice = takeChoice;
    this.queue = queue;
  }

  /** the room hands confirmed ticks in here as they arrive */
  accept(t: ConfirmedTick) {
    this.queue.push(t);
  }

  pull(): ConfirmedTick[] {
    if (!this.room.started) return [];
    this.room.offer(this.readControls(), this.takeChoice());
    // local mode only: with a relay nobody here stamps ticks
    this.room.pump(STEP_MS);
    // CATCH UP, BUT NOT ALL AT ONCE. A backgrounded tab keeps receiving ticks
    // while its own loop is throttled to nothing, so coming back after five
    // minutes means eighteen thousand of them are waiting. Running the lot in
    // one frame locks the tab for seconds; running a bounded number per frame
    // catches up over the next second or two instead, which is what a client
    // falling behind is supposed to do (§11c: it catches up by running several
    // ticks in a frame, and if it cannot keep up it drops out).
    return this.queue.splice(0, Math.min(this.queue.length, MAX_CATCHUP_TICKS));
  }

  /** how far behind the room this seat is, in ticks */
  get behind(): number {
    return this.queue.length;
  }

  /** four bytes a second; agreement between seats is the whole verification */
  afterTick(tick: number, fingerprint: () => number) {
    if (tick % 60 === 0) this.room.report(tick, fingerprint());
  }

  dispose() {
    this.room.close();
  }
}

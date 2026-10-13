import { EMPTY_INPUT, InputEdges, type TickInput } from '../sim/tick.ts';

/**
 * A room over BroadcastChannel: two or more tabs on one machine, in lockstep,
 * with no server (§11c 2e). It proves the whole loop, seats, the input log,
 * the not-waiting rule, desync detection, before a byte crosses a socket;
 * the relay server is then a transport swap.
 *
 * The HOST tab plays the server's part and nothing more: it receives every
 * seat's input, stamps it to a tick, and fans the tick out. It does not
 * simulate for anyone; every tab (the host included) advances only on ticks
 * it has received, so nobody simulates a guess and nobody un-simulates one.
 *
 * What crosses the wire per seat is the raw snapshot, held bits, movement,
 * aim, a pending choice, sent every frame; the host derives the per-tick
 * edges with one InputEdges per seat, so `pressed` is computed exactly once
 * per tick whatever the frame rate on either side. A seat whose input has
 * not arrived by the deadline gets its previous input repeated, edges and
 * choices stripped (InputEdges.repeat): the laggy tab pays, nobody else.
 *
 * Once a second every tab posts the fingerprint of its state; the host
 * compares and shouts if they differ. Join-in-progress is not supported:
 * the room starts when the last expected seat says hello.
 */

export interface RoomConfig {
  name: string;
  /** this tab's seat, 0..3; seat 0 is the host in local mode */
  seat: number;
  /** how many seats the room waits for before it starts */
  seats: number;
  /**
   * A relay server's address (ws://host:port). With it, the room runs in
   * SERVER mode: the server stamps the ticks and compares the fingerprints,
   * no tab is special, and this class is only the wire. Without it, LOCAL
   * mode: BroadcastChannel between tabs on this machine, seat 0 stamping.
   * The messages are the same either way, that was the point of building
   * the two-tab room first.
   */
  ws?: string;
}

/** the raw snapshot a seat sends: everything but the edges */
interface Raw {
  held: number;
  mx: number;
  my: number;
  aimX: number;
  aimY: number;
  choice: number;
  /** a choice's sequence number: the host applies each one exactly once,
   * however many frames re-deliver it before the tick comes back */
  choiceSeq: number;
}

type Msg =
  | { t: 'hello'; seat: number }
  | { t: 'start'; seed: number; seats: number; tick0?: number }
  | { t: 'seated'; seat: number; seats: number }
  | { t: 'raw'; seat: number; raw: Raw }
  | { t: 'tick'; tick: number; inputs: TickInput[] }
  | { t: 'hash'; seat: number; tick: number; fp: number }
  | { t: 'desync'; tick: number; detail: string }
  | { t: 'refused'; reason: string };

export interface RoomHost {
  /** the scene starts a run on this seed with this many seats */
  onStart(seed: number, seats: number, tick0: number): void;
  /** a confirmed tick: every seat's input, in seat order */
  onTick(tick: number, inputs: TickInput[]): void;
  /** a line for the HUD */
  say(text: string): void;
}

/** how long the host waits for a slow seat before repeating its last input, in ms */
const DEADLINE_MS = 120;

export class Room {
  private ch: BroadcastChannel | null = null;
  private sock: WebSocket | null = null;
  private present = new Set<number>();
  started = false;
  /** the host's tick counter, the room's clock */
  private nextTick = 0;
  private acc = 0;
  /** newest raw snapshot per seat, and when it came */
  private raws: (Raw | null)[] = [];
  private rawAt: number[] = [];
  private edges: InputEdges[] = [];
  private last: TickInput[] = [];
  /** this tab's outgoing snapshot, refreshed every frame */
  private mine: Raw = { held: 0, mx: 0, my: 0, aimX: 0, aimY: 0, choice: 0, choiceSeq: 0 };
  /** a choice is sent until a tick carries it, then cleared */
  private myChoice = 0;
  private myChoiceSeq = 0;
  /** host: the last choice sequence already stamped, per seat */
  private choiceSeqSeen: number[] = [];
  private hashes = new Map<number, Map<number, number>>();
  desyncs = 0;
  private lastPump = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private stepMs = 1000 / 60;

  constructor(
    readonly cfg: RoomConfig,
    private host: RoomHost,
    private seed: number,
  ) {
    for (let s = 0; s < cfg.seats; s++) {
      this.raws.push(null);
      this.rawAt.push(0);
      this.edges.push(new InputEdges());
      this.last.push(EMPTY_INPUT);
      this.choiceSeqSeen.push(0);
    }
    if (cfg.ws) {
      // SERVER mode: joining IS the connection; the server does the rest
      // no seat in the URL unless one was asked for: the relay hands them out
      const want = cfg.seat >= 0 ? `seat=${cfg.seat}&` : '';
      const url = `${cfg.ws.replace(/\/$/, '')}/${encodeURIComponent(cfg.name)}?${want}seats=${cfg.seats}&seed=${seed}`;
      this.sock = new WebSocket(url);
      this.sock.onmessage = (ev: MessageEvent<string>) => {
        try {
          this.onMsg(JSON.parse(ev.data) as Msg);
        } catch {
          /* not ours */
        }
      };
      this.sock.onclose = () => host.say(`ROOM ${cfg.name}: connection closed`);
      host.say(`ROOM ${cfg.name} @ ${cfg.ws} · seat ${cfg.seat} of ${cfg.seats} · waiting…`);
    } else {
      this.ch = new BroadcastChannel(`tunnelbana-room-${cfg.name}`);
      this.ch.onmessage = (ev: MessageEvent<Msg>) => this.onMsg(ev.data);
      this.present.add(cfg.seat);
      this.post({ t: 'hello', seat: cfg.seat });
      host.say(`ROOM ${cfg.name} · seat ${cfg.seat} of ${cfg.seats} · waiting…`);
    }
  }

  /** local mode's tick-stamper; in server mode nobody here is */
  get isHost() {
    return !this.sock && this.cfg.seat === 0;
  }

  private post(m: Msg) {
    this.ch?.postMessage(m);
    // BroadcastChannel does not deliver to the sender: the host hears itself here
    if (this.isHost && (m.t === 'tick' || m.t === 'start')) this.onMsg(m);
  }

  /** the seat the relay gave us (or the one we asked for, offline) */
  get seatNumber(): number {
    return this.cfg.seat < 0 ? 0 : this.cfg.seat;
  }

  private send(m: Msg) {
    if (this.sock && this.sock.readyState === this.sock.OPEN) this.sock.send(JSON.stringify(m));
  }

  private onMsg(m: Msg) {
    switch (m.t) {
      case 'hello':
        this.present.add(m.seat);
        // a newcomer says hello; everyone already here answers so it learns who is present
        if (!this.started && m.seat !== this.cfg.seat)
          this.ch?.postMessage({ t: 'hello', seat: this.cfg.seat });
        if (this.isHost && !this.started && this.present.size >= this.cfg.seats) {
          this.post({ t: 'start', seed: this.seed, seats: this.cfg.seats, tick0: 0 });
        }
        break;
      case 'seated':
        // the seat the relay gave us; everything local keys off it
        this.cfg.seat = m.seat;
        this.host.say(`ROOM ${this.cfg.name} · you are seat ${m.seat} of ${m.seats} · waiting…`);
        return;
      case 'start':
        if (this.started) break;
        this.started = true;
        this.nextTick = 0;
        this.host.onStart(m.seed, m.seats, m.tick0 ?? 0);
        this.host.say(`ROOM ${this.cfg.name} · ${m.seats} seats · seed ${m.seed}`);
        // the throttled-timer fallback: even with every tab hidden the room
        // creeps forward (Chrome grants a backgrounded timer about once a second)
        if (this.isHost && !this.interval) this.interval = setInterval(() => this.pump(this.stepMs), 250);
        break;
      case 'raw':
        this.raws[m.seat] = m.raw;
        this.rawAt[m.seat] = performance.now();
        // A hidden tab's game loop stands still, but its messages still
        // arrive, so a visible CLIENT, offering input at 60 Hz, is a
        // perfectly good clock for a backgrounded host. Without this, the
        // host tab had to stay in front for the room to move at all.
        this.pump(this.stepMs);
        break;
      case 'tick':
        // the tick this seat's pending choice rode in clears it
        if (m.inputs[this.cfg.seat]?.choice === this.myChoice) this.myChoice = 0;
        this.host.onTick(m.tick, m.inputs);
        break;
      case 'hash':
        if (this.isHost) this.compare(m.seat, m.tick, m.fp);
        break;
      case 'desync':
        this.desyncs += 1;
        this.host.say(`DESYNC at tick ${m.tick}: ${m.detail}`);
        console.error('desync', m.tick, m.detail);
        break;
      case 'refused':
        this.host.say(`ROOM ${this.cfg.name} refused: ${m.reason}`);
        break;
    }
  }

  /** the local seat's snapshot this frame; sent to the host (or kept, if we are it) */
  offer(raw: Omit<Raw, 'choice' | 'choiceSeq'>, choice: number) {
    if (choice) {
      this.myChoice = choice;
      this.myChoiceSeq += 1;
    }
    this.mine = { ...raw, choice: this.myChoice, choiceSeq: this.myChoiceSeq };
    if (this.sock) {
      this.send({ t: 'raw', seat: this.cfg.seat, raw: this.mine });
    } else if (this.isHost) {
      this.raws[this.cfg.seat] = this.mine;
      this.rawAt[this.cfg.seat] = performance.now();
    } else {
      this.ch?.postMessage({ t: 'raw', seat: this.cfg.seat, raw: this.mine });
    }
  }

  /**
   * The host's frame: stamp as many ticks as the wall clock allows, each from
   * the newest snapshot per seat. Called with the real elapsed ms.
   */
  pump(stepMs: number, maxTicks = 8) {
    if (!this.isHost || !this.started) return;
    this.stepMs = stepMs;
    const wall = performance.now();
    if (this.lastPump === 0) this.lastPump = wall;
    this.acc += Math.min(wall - this.lastPump, 250);
    this.lastPump = wall;
    let n = 0;
    const now = performance.now();
    while (this.acc >= stepMs && n < maxTicks) {
      this.acc -= stepMs;
      n += 1;
      const inputs: TickInput[] = [];
      for (let s = 0; s < this.cfg.seats; s++) {
        const raw = this.raws[s];
        const fresh = raw && now - this.rawAt[s] < DEADLINE_MS;
        if (raw && fresh) {
          // a choice rides exactly one tick, however often the frames repeat it
          const newChoice = raw.choiceSeq > this.choiceSeqSeen[s] ? raw.choice : 0;
          if (newChoice) this.choiceSeqSeen[s] = raw.choiceSeq;
          inputs.push(this.edges[s].sample(raw.held, raw.mx, raw.my, raw.aimX, raw.aimY, newChoice));
        } else {
          inputs.push(this.edges[s].repeat(this.last[s]));
        }
        this.last[s] = inputs[s];
      }
      this.post({ t: 'tick', tick: this.nextTick, inputs });
      this.nextTick += 1;
    }
    if (this.acc > stepMs * maxTicks) this.acc = 0;
  }

  /** every tab: my fingerprint at this tick */
  report(tick: number, fp: number) {
    if (this.sock) this.send({ t: 'hash', seat: this.cfg.seat, tick, fp });
    else if (this.isHost) this.compare(this.cfg.seat, tick, fp);
    else this.ch?.postMessage({ t: 'hash', seat: this.cfg.seat, tick, fp });
  }

  private compare(seat: number, tick: number, fp: number) {
    let row = this.hashes.get(tick);
    if (!row) {
      row = new Map();
      this.hashes.set(tick, row);
    }
    row.set(seat, fp);
    if (row.size < this.cfg.seats) return;
    const fps = [...row.values()];
    if (fps.some((f) => f !== fps[0])) {
      this.desyncs += 1;
      this.host.say(
        `DESYNC at tick ${tick}: ${[...row.entries()].map(([s, f]) => `seat ${s}=${f.toString(16)}`).join(' ')}`,
      );
      console.error('desync', tick, [...row.entries()]);
    }
    this.hashes.delete(tick);
    // forget anything older
    for (const k of this.hashes.keys()) if (k < tick - 600) this.hashes.delete(k);
  }

  close() {
    if (this.interval) clearInterval(this.interval);
    this.ch?.close();
    this.sock?.close();
  }
}

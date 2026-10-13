// The relay server (§11c stage 3): one Node process, in-memory rooms, and
// NOTHING simulated. Its whole job in a room is the job the host tab played
// in the two-tab version: receive every seat's raw input, stamp it to a tick
// on the room's own 60 Hz clock, substituting a stale seat's previous input
// past the deadline, edges and choices stripped, and fan the tick out. All
// the simulating happens in the browsers; the server forwards bytes and
// compares the four-byte fingerprints they post, shouting when they differ.
//
// It shares the tick vocabulary with the client by importing it straight
// from src/sim (Node strips the types), so the two cannot drift apart.
//
//   npm run relay          → ws://localhost:8787
//   then open, in two windows:
//   http://localhost:5173/?room=demo&seat=0&seats=2&seed=7&ws=ws://localhost:8787
//   http://localhost:5173/?room=demo&seat=1&seats=2&seed=7&ws=ws://localhost:8787
//
// Rooms never interact, so this holds as many as anyone asks for; a room is
// forgotten when its last seat leaves. The log is memory and a server restart
// ends every room (§11c: persisting it is a later decision).

import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { EMPTY_INPUT, InputEdges, STEP_MS, type TickInput } from '../src/sim/tick.ts';
import { TICK_EPOCH_MS } from '../src/config.ts';

const PORT = Number(process.env.PORT ?? 8787);
/** how long a silent seat keeps its held input before it repeats, in ms */
const DEADLINE_MS = 120;
/** a backgrounded tab stops offering input; past this it stands still */
const AFK_EMPTY_MS = 3000;
/** most ticks stamped in one timer fire, a hiccup catches up, a stall does not burst */
const MAX_TICKS_PER_PUMP = 8;
/** the co-op cap (§11c): four players, side by side, against the same horde */
const MAX_SEATS = 4;
/** a room name is a five-letter code; this is slack, not a target */
const MAX_ROOM_NAME = 64;
/** nothing here is authenticated, so the room map needs a ceiling of its own */
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 5000);

interface Raw {
  held: number;
  mx: number;
  my: number;
  aimX: number;
  aimY: number;
  choice: number;
  choiceSeq: number;
}

interface Seat {
  ws: WebSocket;
  raw: Raw | null;
  rawAt: number;
  edges: InputEdges;
  last: TickInput;
  choiceSeqSeen: number;
}

interface RoomCfg {
  seats: number;
  seed: number;
}

class Room {
  seats = new Map<number, Seat>();
  started = false;
  tick = 0;
  private acc = 0;
  private lastPump = 0;
  private hashes = new Map<number, Map<number, number>>();
  desyncs = 0;
  readonly name: string;
  readonly cfg: RoomCfg;

  // (plain assignments: Node's strip-only TS has no parameter properties)
  constructor(name: string, cfg: RoomCfg) {
    this.name = name;
    this.cfg = cfg;
  }

  join(seat: number, ws: WebSocket) {
    this.seats.set(seat, {
      ws,
      raw: null,
      rawAt: 0,
      edges: new InputEdges(),
      last: EMPTY_INPUT,
      choiceSeqSeen: 0,
    });
    log(this.name, `seat ${seat} joined (${this.seats.size}/${this.cfg.seats})`);
    if (!this.started && this.seats.size >= this.cfg.seats) this.start();
  }

  private start() {
    this.started = true;
    // ABSOLUTE ticks off the shared epoch (§19): two rooms that have never
    // heard of each other are then on the same clock, which is what makes the
    // whole network's traffic line up and what a handover between groups will
    // need. The wall is read HERE, once, and handed to the simulation as data.
    this.tick = Math.floor((Date.now() - TICK_EPOCH_MS) / STEP_MS);
    this.lastPump = performance.now();
    this.broadcast({ t: 'start', seed: this.cfg.seed, seats: this.cfg.seats, tick0: this.tick });
    log(this.name, `started · ${this.cfg.seats} seats · seed ${this.cfg.seed}`);
  }

  /** driven by the one process-wide clock (see below), not a timer of its own */
  step() {
    if (this.started) this.pump();
  }

  /** the room's clock: stamp as many ticks as the wall allows, from the newest raw per seat */
  private pump() {
    const wall = performance.now();
    this.acc += Math.min(wall - this.lastPump, 250);
    this.lastPump = wall;
    let n = 0;
    while (this.acc >= STEP_MS && n < MAX_TICKS_PER_PUMP) {
      this.acc -= STEP_MS;
      n += 1;
      const inputs: TickInput[] = [];
      for (let s = 0; s < this.cfg.seats; s++) {
        const seat = this.seats.get(s);
        if (!seat) {
          inputs.push(EMPTY_INPUT);
          continue;
        }
        const age = wall - seat.rawAt;
        if (seat.raw && age < DEADLINE_MS) {
          // a choice rides exactly one tick, however many frames re-sent it
          const newChoice = seat.raw.choiceSeq > seat.choiceSeqSeen ? seat.raw.choice : 0;
          if (newChoice) seat.choiceSeqSeen = seat.raw.choiceSeq;
          inputs.push(
            seat.edges.sample(
              seat.raw.held,
              seat.raw.mx,
              seat.raw.my,
              seat.raw.aimX,
              seat.raw.aimY,
              newChoice,
            ),
          );
        } else if (age < AFK_EMPTY_MS) {
          // late, not gone: they keep doing what they were doing (§11c),
          // held state carries, edges and choices do not
          inputs.push(seat.edges.repeat(seat.last));
        } else {
          // away: repeating their last input would walk them under a train,
          // so past the window they simply stand still (§11c)
          inputs.push(seat.edges.repeat(EMPTY_INPUT));
        }
        seat.last = inputs[s];
      }
      this.broadcast({ t: 'tick', tick: this.tick, inputs });
      this.tick += 1;
    }
    if (this.acc > STEP_MS * MAX_TICKS_PER_PUMP) this.acc = 0;
  }

  raw(seat: number, raw: Raw) {
    const s = this.seats.get(seat);
    if (!s) return;
    s.raw = raw;
    s.rawAt = performance.now();
  }

  /** four numbers a second; agreement is the whole verification (§11c) */
  hash(seat: number, tick: number, fp: number) {
    let row = this.hashes.get(tick);
    if (!row) {
      row = new Map();
      this.hashes.set(tick, row);
    }
    row.set(seat, fp);
    if (row.size < this.seats.size) return;
    const fps = [...row.values()];
    if (fps.some((f) => f !== fps[0])) {
      this.desyncs += 1;
      const detail = [...row.entries()].map(([s, f]) => `seat ${s}=${f.toString(16)}`).join(' ');
      log(this.name, `DESYNC at tick ${tick}: ${detail}`);
      this.broadcast({ t: 'desync', tick, detail });
    }
    this.hashes.delete(tick);
    for (const k of this.hashes.keys()) if (k < tick - 600) this.hashes.delete(k);
  }

  leave(seat: number) {
    this.seats.delete(seat);
    log(this.name, `seat ${seat} left (${this.seats.size} remain)`);
    // §11c: dropping a player is a DECISION every client must make at the
    // same tick, so it goes through the stream, the seat's input simply
    // becomes EMPTY via the AFK rule above. The room ends only when empty.
    if (this.seats.size === 0) this.close();
  }

  private broadcast(m: unknown) {
    const text = JSON.stringify(m);
    for (const s of this.seats.values()) if (s.ws.readyState === s.ws.OPEN) s.ws.send(text);
  }

  close() {
    this.started = false;
    rooms.delete(this.name);
    log(this.name, 'room closed');
  }
}

const rooms = new Map<string, Room>();
const log = (room: string, msg: string) => console.log(`[${new Date().toISOString()}] ${room}: ${msg}`);

/**
 * ONE CLOCK for every room. A `setInterval` per room means a thousand timers
 * at a thousand players, and Node's scheduler jitter grows with them, the
 * rooms are independent but the CLOCK does not have to be.
 */
setInterval(() => {
  for (const room of rooms.values()) room.step();
}, 8);

/**
 * A plain HTTP server underneath, so there is something to health-check and
 * something for a reverse proxy to talk to. Caddy upgrades /ws to the socket
 * and leaves the rest alone.
 */
const http = createServer((req, res) => {
  if (req.url === '/health') {
    const seats = [...rooms.values()].reduce((n, r) => n + r.seats.size, 0);
    const desyncs = [...rooms.values()].reduce((n, r) => n + r.desyncs, 0);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ ok: true, rooms: rooms.size, seats, desyncs, uptime: Math.round(process.uptime()) }),
    );
    return;
  }
  res.writeHead(404).end();
});
const wss = new WebSocketServer({ server: http });
http.listen(PORT, () => console.log(`tunnelbana relay listening on :${PORT} (ws + /health)`));

wss.on('connection', (ws, req) => {
  // the room, seat and size ride the URL: /room-name?seat=0&seats=2&seed=7
  const url = new URL(req.url ?? '/', 'http://x');
  const name = url.pathname.replace(/^\//, '') || 'demo';
  const asked = url.searchParams.get('seat');
  const seats = Number(url.searchParams.get('seats') ?? '2');
  const seed = Number(url.searchParams.get('seed') ?? '1');

  // VALIDATE BEFORE CONSTRUCTING. A room used to be created and registered
  // first and the seat checked afterwards, so any connection whose seat could
  // never be satisfied, `?seats=0`, `?seats=-3`, `?seats=abc`, all of which a
  // stranger can send, left a room in the map that no one could join and
  // nothing would ever collect. Three such requests, three permanent rooms;
  // unbounded, anonymous and trivially scripted.
  if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) {
    ws.send(JSON.stringify({ t: 'refused', reason: `seats must be 1..${MAX_SEATS}` }));
    ws.close();
    return;
  }
  if (!Number.isFinite(seed)) {
    ws.send(JSON.stringify({ t: 'refused', reason: 'seed must be a number' }));
    ws.close();
    return;
  }
  if (name.length > MAX_ROOM_NAME) {
    ws.send(JSON.stringify({ t: 'refused', reason: 'room name too long' }));
    ws.close();
    return;
  }
  if (!rooms.has(name) && rooms.size >= MAX_ROOMS) {
    ws.send(JSON.stringify({ t: 'refused', reason: 'server full' }));
    ws.close();
    return;
  }

  let room = rooms.get(name);
  if (!room) {
    room = new Room(name, { seats, seed: seed >>> 0 });
    rooms.set(name, room);
  }
  if (room.started) {
    // join-in-progress needs the snapshot story (§11c); until then the door is shut
    ws.send(JSON.stringify({ t: 'refused', reason: 'room already running' }));
    ws.close();
    return;
  }
  // THE RELAY ASSIGNS THE SEAT. Asking every player to put a different
  // ?seat= in their URL is a foot-gun with no upside: two people pick 0 and
  // the room never fills, or fills wrong. A seat may still be asked for (the
  // two-tab harness does), and is honoured when it is free.
  const want = asked === null ? -1 : Number(asked);
  let seat =
    Number.isInteger(want) && want >= 0 && want < room.cfg.seats && !room.seats.has(want) ? want : -1;
  if (seat < 0) {
    for (let s = 0; s < room.cfg.seats; s++)
      if (!room.seats.has(s)) {
        seat = s;
        break;
      }
  }
  if (seat < 0) {
    ws.send(JSON.stringify({ t: 'refused', reason: `room full (${room.cfg.seats} seats)` }));
    ws.close();
    return;
  }
  ws.send(JSON.stringify({ t: 'seated', seat, seats: room.cfg.seats }));
  room.join(seat, ws);

  ws.on('message', (data) => {
    let m: { t?: string; seat?: number; raw?: Raw; tick?: number; fp?: number };
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    if (m.t === 'raw' && m.raw) room!.raw(seat, m.raw);
    else if (m.t === 'hash' && typeof m.tick === 'number' && typeof m.fp === 'number')
      room!.hash(seat, m.tick, m.fp);
  });
  ws.on('close', () => room!.leave(seat));
});

import * as C from '../config.ts';
import type { Frame } from '../core/world.ts';
import { PAX_LINES, type LineKind } from '../core/paxLines.ts';

/**
 * PASSENGERS (DESIGN §20): the people who are not the horde. Real riders of
 * the real network, who fight it in their own ways, can be killed by it for
 * good, and are never hit by anything the player casts, they are not in a
 * place's `enemies`, which is the only list a cast ever looks at.
 *
 * They are SIMULATION STATE, run-level like the players (`run.pax`): they
 * fight, so every client must agree on every one of them, and they hash
 * into the fingerprint. Plain data, like everything else that does.
 *
 * Every passenger has a PURPOSE (a plan) and travels in a GROUP of one to
 * four, who wait, board, get off and keep together as one.
 */
export type PassengerKind = 'vaktare' | 'pendlare' | 'tonaring' | 'sjukskoterska' | 'langare';

/** on foot at a station, or seated on a train */
export type PaxMode = 'foot' | 'aboard';

/**
 * WHAT THEY ARE HERE FOR:
 *   post   a guard at his post: he stays, and holds it
 *   catch  waiting for a train on one track (`waitTi`), beside it; boards
 *          when it opens, and rides away
 *   exit   just got off: walks to the nearest escalator, and is gone
 */
export type PaxPlan = 'post' | 'catch' | 'exit';

/** what they do in a fight */
export type PaxRole = 'melee' | 'ranged' | 'healer' | 'civilian';

export interface Passenger {
  id: number;
  kind: PassengerKind;
  /** the place they stand in (sim/place.ts), re-read from the map as they move */
  placeId: string;
  frame: Frame;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** where they mean to stand: a guard's post, a waiting spot by the edge */
  homeX: number;
  homeY: number;
  /** the next moment they may act (strike, throw, heal), and when they last did */
  cdUntil: number;
  swingAt: number;
  /** which way they went round something last step (world/body2d.ts) */
  slide: 1 | -1 | 0;
  mode: PaxMode;
  plan: PaxPlan;
  /** the track they are waiting for, at this station */
  waitTi: number;
  /** ...and the LINE: a group waiting for the 19 lets the 17 go by ('' takes any) */
  want: string;
  /** when they began waiting, patience runs out, and they leave */
  since: number;
  /** their group (the id of its first member) and their place in it */
  group: number;
  slot: number;
  /** steps in to a fight (rather than backing away from one) */
  brave: boolean;
  /** WHAT THEY LAST SAID, and when (combat/paxTalk.ts): the bubble is a picture of this */
  say: string;
  sayAt: number;
  /** how many lines they have said: the next line's stream is keyed by it */
  lines: number;
  greeted: boolean;
  nextChatAt: number;
  /** wants a tenner, and whether they got one */
  asks: boolean;
  given: boolean;
  askedAt: number;
  /** last bitten: a kill near them soon after is a rescue */
  hurtAt: number;
  /** the journey they are riding */
  jid: string | null;
  /** aboard: the seat they are making for, in the train's own along/across */
  seatRx: number;
  seatRy: number;
  /** aboard: stations still to pass before they get off, and the last one the doors opened at */
  stopsToGo: number;
  lastStop: string;
  /** aboard, getting off: walking down the car to a door and out through it */
  alighting: boolean;
  /** Langaren: what is left in his bag (core/bag.ts items), rolled when first opened */
  stock: string[] | null;
  /** where they are travelling to (a station's name), once they ride */
  dest: string;
  /** SWEDES ARE RESERVED: most say nothing to a stranger; the chatty few do */
  chatty: boolean;
  /** since when a seat has been standing right up against them */
  closeSince: number;
  /** since when they have been trying to walk and getting nowhere */
  stuckSince: number;
  /** WAITING: the spot their group waits about (map), home wanders around it */
  anchorX: number;
  anchorY: number;
  /** when they next shift about while waiting (combat/paxIdle.ts) */
  idleAt: number;
  /** the seed their look is rolled from (render/look.ts), kept so every client draws the same stranger */
  lookSeed: number;
}

export interface PaxKind {
  role: PaxRole;
  hp: number;
  /** × the player's walking pace */
  pace: number;
  /** how far past touching a melee blow reaches; a throw's range; a heal's radius */
  reach: number;
  /** a blow's or a throw's damage; a heal's hp */
  dmg: number;
  cdMs: number;
  /** how hard a blow throws what it hits */
  knock: number;
  /** most of the horde within five metres they will take on at once */
  odds: number;
}

/** what each kind of passenger is made of */
export const PAX_KINDS: Record<PassengerKind, PaxKind> = {
  // VÄKTAREN, the guard: slow, hits hard, takes on a crowd
  vaktare: { role: 'melee', hp: 300, pace: 0.75, reach: C.M(0.9), dmg: 9, cdMs: 1000, knock: 260, odds: 4 },
  // TONÅRINGEN, the teenager: smällare from a safe distance
  tonaring: { role: 'ranged', hp: 70, pace: 1.1, reach: C.M(8), dmg: 4, cdMs: 900, knock: 0, odds: 3 },
  // SJUKSKÖTERSKAN, off shift: a pulse that patches up everyone near
  sjukskoterska: {
    role: 'healer',
    hp: 90,
    pace: 0.95,
    reach: C.M(4.5),
    dmg: 30,
    cdMs: 7000,
    knock: 0,
    odds: 0,
  },
  // LANGAREN, the dealer: no fighter, his bag is worth more than his pride
  langare: { role: 'civilian', hp: 80, pace: 0.9, reach: C.M(0.5), dmg: 2, cdMs: 1400, knock: 60, odds: 0 },
  // PENDLAREN, the commuter: about their own business, and out of the way
  pendlare: { role: 'civilian', hp: 60, pace: 1, reach: C.M(0.5), dmg: 3, cdMs: 1200, knock: 90, odds: 0 },
};

export interface PaxHolder {
  pax: Passenger[];
  nextPaxId: number;
  /** a stream of its own for a named thing, the same on every client */
  contentRng(key: string): () => number;
}

/** say a line of a kind, chosen from the passenger's own stream */
export function sayLine(run: PaxHolder, ps: Passenger, kind: LineKind, now: number) {
  const pool = PAX_LINES[ps.kind][kind];
  const rng = run.contentRng(`say:${ps.id}:${ps.lines++}`);
  ps.say = pool[Math.floor(rng() * pool.length)].replace('{dest}', ps.dest || 'hem');
  ps.sayAt = now;
}

export function spawnPassenger(
  run: PaxHolder,
  kind: PassengerKind,
  placeId: string,
  x: number,
  y: number,
  lookSeed: number,
): Passenger {
  const k = PAX_KINDS[kind];
  const id = run.nextPaxId++;
  const ps: Passenger = {
    id,
    kind,
    placeId,
    frame: { kind: 'world' },
    x,
    y,
    r: C.M(0.55),
    hp: k.hp,
    maxHp: k.hp,
    alive: true,
    homeX: x,
    homeY: y,
    cdUntil: 0,
    swingAt: -1e9,
    slide: 0,
    mode: 'foot',
    plan: 'post',
    waitTi: -1,
    want: '',
    since: 0,
    group: id,
    slot: 0,
    brave: k.role === 'melee' || k.role === 'ranged',
    say: '',
    sayAt: -1e9,
    lines: 0,
    greeted: false,
    nextChatAt: 0,
    asks: false,
    given: false,
    askedAt: -1e9,
    hurtAt: -1e9,
    jid: null,
    seatRx: 0,
    seatRy: 0,
    stopsToGo: 0,
    lastStop: '',
    alighting: false,
    stock: null,
    dest: '',
    chatty: false,
    closeSince: 0,
    stuckSince: 0,
    anchorX: x,
    anchorY: y,
    idleAt: 0,
    lookSeed,
  };
  run.pax.push(ps);
  return ps;
}

/** the horde got one: no downing, no revive, gone for good (§20) */
export function hurtPassenger(run: PaxHolder, ps: Passenger, n: number, now: number) {
  if (!ps.alive) return;
  ps.hp -= n;
  // a cry for help, now and then, not every bite
  if (ps.hp > 0 && now - ps.hurtAt > 4000) sayLine(run, ps, 'help', now);
  ps.hurtAt = now;
  if (ps.hp > 0) return;
  ps.hp = 0;
  ps.alive = false;
  const i = run.pax.indexOf(ps);
  if (i >= 0) run.pax.splice(i, 1);
}

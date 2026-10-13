import * as C from '../config.ts';
import { asStation } from '../sim/place.ts';
import { corridorOf } from '../core/corridor.ts';
import { legIdOf } from '../sim/leg.ts';
import { stepOk } from './body2d.ts';
import type { Chunks } from './chunks.ts';
import type { Place } from '../sim/place.ts';
import type { RunFacts } from '../combat/types.ts';
import { dcos, dist, dsin } from '../sim/det.ts';

/**
 * A WAY THROUGH THE MAP.
 *
 * Flood the walkable world outward from a point until it reaches the place
 * asked for, then read the way back. It is the same question the world
 * answers for a body, is there floor, is anything in the way, may I go from
 * this ground to that (src/world/body2d.ts), asked ahead of time instead of
 * one step at a time.
 *
 * Nothing about it knows what a room is. A platform, a tunnel and the next
 * platform are one surface, so a route across all three is a route.
 *
 * It asks THE SAME RULE the walker asks (body2d.ts stepOk), so a route is a
 * walk that will succeed: a copy of the rule here knew the platform's edge
 * but not the open door that lets you over it, nor the train's flank.
 */
const STEP = C.M(0.4);

export function routeTo(
  run: RunFacts,
  from: { x: number; y: number },
  to: Place,
  r: number,
): { x: number; y: number }[] | null {
  // the bore that leads there, where two leave the start together (chunks.ts at)
  const start = run.map.at(from.x, from.y);
  const a = start ? asStation(start.place) : null;
  const b = asStation(to);
  const c = a && b && a !== b ? corridorOf(a.name, b.name, a.levelIndex, b.levelIndex) : null;
  return route(run, from, r, (here) => here.place === to && here.kind !== 'bore', c ? legIdOf(c) : undefined);
}

/** ...and to a POINT on the map, which is how you walk to a door */
export function routeToPoint(
  run: RunFacts,
  from: { x: number; y: number },
  goal: { x: number; y: number },
  r: number,
): { x: number; y: number }[] | null {
  return route(run, from, r, (_here, x, y) => dist(x - goal.x, y - goal.y) < C.M(1.2));
}

function route(
  run: RunFacts,
  from: { x: number; y: number },
  r: number,
  done: (here: NonNullable<ReturnType<Chunks['at']>>, x: number, y: number) => boolean,
  /** the bore meant, where several share the ground */
  want?: string,
): { x: number; y: number }[] | null {
  const map = run.map;
  const key = (x: number, y: number) => `${Math.round(x / STEP)}|${Math.round(y / STEP)}`;
  // each point remembers the place it was reached in, as a walker would be
  const came = new Map<string, { x: number; y: number; from: string | null; place?: string }>();
  const start = key(from.x, from.y);
  came.set(start, { x: from.x, y: from.y, from: null });
  const queue = [start];
  let hit: string | null = null;
  for (let head = 0; head < queue.length && !hit; head++) {
    const at = came.get(queue[head])!;
    const here = map.at(at.x, at.y, at.place, want);
    if (!here) continue;
    if (done(here, at.x, at.y)) {
      hit = queue[head];
      break;
    }
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const nx = at.x + dcos(a) * STEP;
      const ny = at.y + dsin(a) * STEP;
      const k = key(nx, ny);
      if (came.has(k)) continue;
      // ...without the metal: a train standing in a tube when the route is
      // planned is gone by the time the walker gets there, and with one on
      // each track there was "no way across the map at all"
      const on = stepOk(run, map, here, nx, ny, r, { solidMetal: false, wantPlace: want });
      if (!on) continue;
      came.set(k, { x: nx, y: ny, from: queue[head], place: on.place.id });
      queue.push(k);
    }
  }
  if (!hit) return null;
  const back: { x: number; y: number }[] = [];
  for (let k: string | null = hit; k; k = came.get(k)!.from) {
    const n = came.get(k)!;
    back.push({ x: n.x, y: n.y });
  }
  return back.reverse();
}

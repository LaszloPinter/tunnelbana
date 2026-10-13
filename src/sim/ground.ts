import * as C from '../config.ts';
import type { Player } from './player.ts';
import type { Run } from './run.ts';
import { inPlanTerms, nearFixture } from '../world/fixtures.ts';
import { fromPlatform } from '../world/floor.ts';
import { spawnAt } from '../world/walk2d.ts';
import type { Place } from './place.ts';
import { asStation } from './place.ts';
import { stationPlan } from '../data/platformPlan.ts';
import { rebuildHere } from './stationBuild.ts';

/**
 * What a commuter can do with the station's fixtures, the shafts between
 * storeys, the exits, and the one furniture test a run's opening still
 * needs. Walking itself is the map's (src/world/walk2d.ts).
 */

export function clearOfFurniture(st: Place, p: Player) {
  if (!benchAt(st, p, p.x, p.y) && !st.pillarAt(p.x, p.y, p.r)) return;
  for (let step = C.M(1); step <= C.M(14); step += C.M(1)) {
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as const) {
      const nx = p.x + dx * step;
      const ny = p.y + dy * step;
      if (st.platformAt(ny) < 0) continue;
      if (!benchAt(st, p, nx, ny) && !st.pillarAt(nx, ny, p.r)) {
        p.x = nx;
        p.y = ny;
        return;
      }
    }
  }
}

/** the shaft you are standing on, if any */
export function shaftAt(st: Place, p: Player, x: number, y: number) {
  const at = inPlanTerms(st, x, y);
  return st.shafts.find(
    (sh) => Math.abs(sh.x - at.x) < sh.w / 2 + p.r && Math.abs(sh.y - at.y) < sh.h / 2 + p.r,
  );
}

/**
 * Ride a shaft to the storey it leads to. The station is rebuilt as that
 * level, different islands, different tracks, different trains, and you
 * come out at the matching shaft there. Whatever was chasing you stays on
 * the floor you left. The PARTY takes the shaft: under one station there is
 * one storey, so whoever pressed E brings everyone up or down with them.
 */
export function takeShaft(run: Run, by: Player, shaft: { x: number; y: number; delta: -1 | 1 }, now: number) {
  const st = run.here;
  const plan = stationPlan(st.name);
  const to = st.levelIndex - shaft.delta;
  if (to < 0 || to >= plan.levels.length) return;
  // WHICH shaft: the n-th of its kind on this storey comes out at the n-th of
  // the opposite kind on the other, one per island, in island order. The
  // first one back was always taken, so down and up from the far island put
  // you on the near one (from play 2026-09-16)
  const kind = st.shafts.filter((sh) => sh.delta === shaft.delta);
  const nth = Math.max(
    0,
    kind.findIndex((sh) => sh.x === shaft.x && sh.y === shaft.y),
  );
  const station = asStation(st);
  station?.stashFloor();
  st.levelIndex = to;
  const beforeX = by.x;
  rebuildHere(run);
  station?.restoreFloor();
  // out at the shaft that leads back the way you came
  const backs = st.shafts.filter((sh) => sh.delta === -shaft.delta);
  const back = backs[Math.min(nth, backs.length - 1)];
  const lx = back?.x ?? beforeX;
  const ly = back?.y ?? (st.platforms[0].top + st.platforms[0].bottom) / 2;
  run.players.forEach((p, i) => {
    /**
     * A STOREY IS A DIFFERENT ROOM AT THE SAME PLACE, and it stands at its
     * own bearing. Where the shaft comes out is said in that room's plan,
     * so far along the platform, so far across, and on the map that has to
     * be turned into a point in Stockholm before anyone is put there.
     * Written straight in, it puts the whole party at a coordinate belonging
     * to nothing: you take the stairs and arrive in the void, with the world
     * black around you (from play 2026-09-12: "I took NER to nowhere").
     */
    if (!station) return;
    const at = fromPlatform(station, lx + i * C.M(1.2), ly);
    spawnAt(run, p, at.x, at.y);
    p.frame = { kind: 'world' };
  });
  run.host.stationChanged('shaft');
  if (station) {
    station.stationEnteredAt = now;
    run.showMsg(`Level ${station.storey}: ${st.rails.length ? 'trains here' : 'no service'}`, now);
  }
}

export function nearExit(st: Place, p: Player): boolean {
  return p.frame.kind === 'world' && nearFixture(st, st.escalators, p.x, p.y, C.M(2));
}

export function benchAt(st: Place, p: Player, x: number, y: number): boolean {
  const r = p.r;
  return st.benches.some((b) => x > b.x0 - r && x < b.x1 + r && y > b.y0 - r && y < b.y1 + r);
}

import { asStation } from '../sim/place.ts';
import { fromPlatform } from './floor.ts';
import { spawnAt } from './walk2d.ts';
import type { Run } from '../sim/run.ts';

/**
 * PUT THE PARTY ON THE MAP.
 *
 * A run is set up in the old world's terms, a station, and everyone standing
 * on its deck in that platform's own along-and-across. On the map those are
 * the same two numbers said differently, so this is the one place that has to
 * translate: after it, nobody does.
 */
/**
 * PUT THE PARTY ON THE MAP.
 *
 * Only the party. Everything else that gets put into the world says where it
 * is at the moment it is made (combat/enemies.ts spawnEnemy), so there is
 * nothing to sweep up afterwards, and sweeping anyway said it twice, which
 * put the first wave of every station forty thousand pixels into the dark
 * (from play 2026-09-10: "maybe there are enemies just somewhere out of
 * nowhere").
 */
export function goFlat(run: Run) {
  // TWO DIFFERENT JOBS, and they do not happen equally often. Turning the
  // map on is once in a session; PUTTING THE PARTY DOWN is once a run. They
  // were one function behind one "already done" guard, so a second run,
  // which is a new world, a new station and a new place to stand, left
  // every seat at the coordinates the old world had handed it: a platform's
  // own along-and-across, read as a point in Stockholm. That is the void.
  // Nothing is drawn there and nothing is underfoot, so the screen goes
  // black and the horde spawns into nowhere (from play 2026-09-11:
  // "Restarting at a new station = black screen").
  if (!run.onMap) {
    run.onMap = true;
    // THE BOW WAS A STAND-IN FOR CURVATURE. An unrolled platform is straight,
    // so its art was bent along a path to suggest a station that bends, and
    // every body drawn on it was bent to match. On the map the bend is real,
    // the platform lies at its own bearing and the tunnel genuinely curves,
    // so the stand-in is a second curve fighting the first.
    run.setCurve(0);
  }
  placeOnMap(run);
  // ...and tell the picture the world moved. The camera is held inside the
  // bounds of what there is to look at, and those were the old world's, a
  // few hundred metres round its origin, which is nowhere near the Stockholm
  // the body is now standing in.
  run.host.railsChanged();
  run.host.dressStation();
  // NOT a walk: a walk holds the body where it was on screen and scrolls the
  // world under it, which needs an anchor taken before the move. Nothing was
  // anywhere before this, so the camera is simply put on the body.
  run.host.stationChanged('shaft');
}

/** THE SPAWN POINT: the party in a row across the middle of the first
 * island, where every ride starts, the first and every one after */
export function placeOnMap(run: Run) {
  const st = asStation(run.here);
  if (!st || st.platforms.length === 0) return;
  const isl = st.platforms[0];
  const mid = (st.platformX0 + st.platformX1) / 2;
  const y = (isl.top + isl.bottom) / 2;
  run.players.forEach((p, i) => {
    const at = fromPlatform(st, mid + i * 24, y);
    spawnAt(run, p, at.x, at.y);
    p.frame = { kind: 'world' };
  });
}

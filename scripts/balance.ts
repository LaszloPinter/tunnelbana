// WHAT A LANE PICK IS WORTH at tier 1. A fixed pack, a fixed firing
// pattern, a fixed number of seconds; total damage dealt, against the same
// run with no lane at all. Not a verdict, a lane is worth what its
// SITUATION is worth, so three situations are measured, and the spread
// between them is the point.
import { NULL_HOST, Run } from '../src/sim/run.ts';
import { asStation } from '../src/sim/place.ts';
import { EMPTY_INPUT, BTN } from '../src/sim/tick.ts';
import { laneMods, LANE_INFO, type LaneId } from '../src/core/lanes.ts';
import * as C from '../src/config.ts';
import type { Station } from '../src/sim/station.ts';
import { fromPlatform } from '../src/world/floor.ts';
import { spawnEnemy } from '../src/combat/enemies.ts';
import type { Enemy } from '../src/combat/types.ts';

/** `balance.ts smg` measures the torrent instead of the bolt */
const WEAPON: 'pistol' | 'smg' = process.argv[2] === 'smg' ? 'smg' : 'pistol';
const SECONDS = 20;
const TICKS = SECONDS * 60;
const PACK = 8;
/** how many bodies the scene puts on the floor */
const packOf = (scene: Scene) => (scene === 'single' ? 1 : PACK);

type Scene = 'cluster' | 'single' | 'cover' | 'sloppy' | 'platform';

/** total damage dealt to a fixed pack in twenty seconds of held fire */
function damageAt(lane: LaneId | null, scene: Scene, tier: number, spot: number): number {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 4;
  sim.startRun();
  // ON THE MAP: the run is said in Stockholm's own coordinates from here on
  sim.beginRun();
  const me = sim.me;
  // a station with columns, for the cover scene
  const st: Station =
    scene === 'cover'
      ? ([...sim.places.values()]
          .map((q) => asStation(q))
          .find((q): q is Station => !!q && q.pillars.length > 0) ?? sim.hereStation!)
      : sim.hereStation!;
  sim.hereId = st.id;
  me.placeId = st.id;
  me.frame = { kind: 'world' };
  me.weapon = WEAPON;
  if (lane) for (let t = 1; t <= tier; t++) laneMods(me.mods, lane, t);

  // A LANE TO FIRE DOWN, in the platform's own along-and-across. Columns
  // stand in rows along a platform, so a shot aimed down the spine meets
  // one at once, a fine test of cover and a useless one of everything
  // else. Pick a line that is clear, or (for the cover scene) one that
  // crosses exactly one column. THE PLATFORM scene is the honest one: five
  // ordinary places to stand down a real platform, no search for a lane.
  const wantCover = scene === 'cover';
  const crossings = (x0: number, y: number) => {
    let n = 0;
    for (let x = x0; x < x0 + C.M(12); x += C.M(0.4)) if (st.pillarAt(x, y, 2)) n += 1;
    return n;
  };
  const top = st.platforms[0].top;
  const bottom = st.platforms[0].bottom;
  let bestY = (top + bottom) / 2;
  let bestX = st.platformX0 + C.M(14);
  let found = false;
  for (let x = st.platformX0 + C.M(10); x < st.platformX1 - C.M(20) && !found; x += C.M(2)) {
    for (let y = top + C.M(1.2); y < bottom - C.M(1.2); y += C.M(0.4)) {
      const n = crossings(x, y);
      if (wantCover ? n > 0 : n === 0) {
        bestX = x;
        bestY = y;
        found = true;
        break;
      }
    }
  }
  if (scene === 'platform') {
    const span = st.platformX1 - st.platformX0 - C.M(30);
    bestX = st.platformX0 + C.M(8) + (span * spot) / 4;
    bestY = top + C.M(1.5) + ((bottom - top - C.M(3)) * ((spot * 2) % 5)) / 4;
  }
  const stand = fromPlatform(st, bestX, bestY);
  me.x = stand.x;
  me.y = stand.y;
  // aim: dead on, or eight degrees out for the sloppy scene
  const err = scene === 'sloppy' ? 0.14 : 0;
  const aim = fromPlatform(st, bestX + Math.cos(err) * C.M(12), bestY + Math.sin(err) * C.M(12));
  const host = sim.hostFor(st);
  const pack: Enemy[] = [];
  for (let i = 0; i < packOf(scene); i++) {
    const e = spawnEnemy(
      host,
      'runner',
      { kind: 'world' },
      bestX + C.M(12) + (i % 4) * C.M(0.9),
      bestY + Math.floor(i / 4) * C.M(0.9) - C.M(0.45),
      false,
      0,
      1,
      1,
      () => 0.5,
      'plain',
    );
    e.hp = 1e7;
    e.maxHp = 1e7;
    e.stunUntil = 1e12; // they stand still and do not fight back
    e.speedMul = 0;
    pack.push(e);
  }
  const before = pack.reduce((n, e) => n + e.hp, 0);
  for (let t = 0; t < TICKS; t++) {
    me.mana = 1e6; // mana is not what is being measured
    me.health = 1e9;
    // the pack is the only thing on the floor: the station's own horde would
    // stand in the way and eat the shots
    for (const pl of sim.places.values()) pl.enemies.length = 0;
    st.enemies.push(...pack);
    sim.runTick({
      ...EMPTY_INPUT,
      held: BTN.fire,
      pressed: t === 0 ? BTN.fire : 0,
      aimX: aim.x,
      aimY: aim.y,
      choice: me.offer ? 1 : 0,
    });
  }
  return before - pack.reduce((n, e) => n + Math.max(0, e.hp), 0);
}

/** the platform scene is the mean of five ordinary places to stand */
const damage = (lane: LaneId | null, scene: Scene, tier: number): number => {
  if (scene !== 'platform') return damageAt(lane, scene, tier, 0);
  let sum = 0;
  for (let spot = 0; spot < 5; spot++) sum += damageAt(lane, scene, tier, spot);
  return sum / 5;
};

const LANES: (LaneId | null)[] = [null, 'lightning', 'dark', 'laddning', 'ram'];
const SCENES: Scene[] = ['cluster', 'single', 'cover', 'sloppy', 'platform'];
const label = (l: LaneId | null) => (l ? LANE_INFO[l].title : 'no lane');

console.log(
  `${WEAPON === 'smg' ? 'TORRENT' : 'BOLT'}: damage dealt in ${SECONDS}s of held fire, mana free (${PACK} bodies, or one)`,
);
for (const tier of [1, 2]) {
  console.log(`\n---- tier ${tier}${tier === 2 ? ' (the same lane twice)' : ''} ----`);
  console.log(['lane'.padEnd(10), ...SCENES.map((s) => s.padStart(18))].join(''));
  const base: Record<string, number> = {};
  for (const lane of LANES) {
    const cells: string[] = [];
    for (const scene of SCENES) {
      const d = damage(lane, scene, tier);
      if (lane === null) base[scene] = d;
      const pct = base[scene] ? ((d / base[scene]) * 100).toFixed(0) + '%' : '-';
      cells.push(`${Math.round(d)} (${pct})`.padStart(18));
    }
    console.log(label(lane).padEnd(10) + cells.join(''));
  }
}
console.log(
  '\ncluster: eight packed, clear line · single: one body · cover: a column in the way · sloppy: aim 8° out · platform: five ordinary spots on a real platform, averaged',
);

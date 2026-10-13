import { bakeFloor } from './bake.ts';
import { Chunks } from './chunks.ts';
import type { Place } from '../sim/place.ts';
import type { Run } from '../sim/run.ts';

/**
 * THE MAP THE RUN IS STANDING ON, kept up to date.
 *
 * The walkable world is baked flat (src/world/bake.ts) and gridded
 * (src/world/chunks.ts), but only for the rooms in play, a corner of
 * Stockholm rather than the whole of it. This rebakes that corner when it
 * changes: when the live set changes, or when a platform is re-laid under a
 * different storey and its floor is a different floor.
 *
 * Nothing here decides what anything MEANS. It decides what is in memory.
 */
export class LiveMap {
  private stamp = '';
  private chunks = new Chunks([]);
  /**
   * WHAT THE LAST ANSWER WAS FOR, checked before anything is built. The
   * stamp below is the honest test of "is this the same map", but it costs a
   * sort and a string over every live room, and `run.map` is asked once
   * per candidate step per body, seventeen times a body a tick. Profiled
   * (2026-09-15, 4000 ticks, 127 bodies): building that stamp was 35% of
   * the whole simulation, more than the horde's own thinking. Nothing about
   * the answer can change unless the live set is a new set, a room was
   * rebuilt, or somebody is somewhere new, so those three are checked
   * first, and they are two identities and a handful of ids.
   */
  private key: { live: Set<string>; gen: number; here: string; where: string[] } | null = null;

  /** is everyone where they were when the map was last asked? compared id
   * by id, building a string of them per ask was itself a per-ask cost */
  private same(run: Run): boolean {
    const k = this.key;
    if (!k || k.live !== run.live || k.gen !== run.buildCount || k.here !== run.hereId) return false;
    let i = 0;
    for (const q of run.players) {
      if (!q.alive) continue;
      if (k.where[i++] !== q.placeId) return false;
    }
    return i === k.where.length;
  }

  /** the baked map of everything live, rebaked only when it has changed */
  of(run: Run): Chunks {
    if (this.same(run)) return this.chunks;
    const where: string[] = [];
    for (const q of run.players) if (q.alive) where.push(q.placeId);
    this.key = { live: run.live, gen: run.buildCount, here: run.hereId, where };
    // WHEREVER ANYONE IS, plus everything the run counts as live. The live
    // set is worked out during a tick (sim/places.ts), so before the first
    // one it is empty, and a body has to be able to stand somewhere before
    // the world has taken a step.
    const ids = new Set<string>(run.live);
    ids.add(run.hereId);
    for (const q of run.players) if (q.alive) ids.add(q.placeId);
    const rooms: Place[] = [];
    for (const id of ids) {
      const pl = run.places.get(id);
      if (pl) rooms.push(pl);
    }
    rooms.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // a platform re-laid on another storey is a different floor, so its
    // build counts towards what "the same map" means
    const stamp = rooms.map((p) => `${p.id}:${p.buildGen}`).join(',');
    if (stamp !== this.stamp) {
      this.stamp = stamp;
      this.chunks = new Chunks(bakeFloor(rooms));
    }
    return this.chunks;
  }
}

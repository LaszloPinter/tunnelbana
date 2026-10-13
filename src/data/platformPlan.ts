import raw from '../../data/platform-plan.json' with { type: 'json' };
import { colorsAt, departuresFrom, SERVICES, type LineColor } from '../core/network.ts';

/**
 * How a station is actually arranged: its platforms, grouped by the STOREY
 * they stand on, and what stops at each.
 *
 * Distilled from OpenStreetMap route relations and platform tags
 * (data/routes.json + data/platforms.json → scripts/build-platform-plan.mjs →
 * data/platform-plan.json, © OpenStreetMap contributors, ODbL).
 *
 * The game used to assume one island per LINE, both directions along it. That
 * is right at most stations and wrong at the three busiest:
 *
 *   Gamla stan and Slussen pair their islands by DIRECTION, every service
 *   heading one way stands at one island, everything heading the other way at
 *   the second, red and green together.
 *
 *   T-Centralen keeps that pairing and takes it VERTICAL: one direction at
 *   level -2, the other at -3, with the blue line deeper still at -4. Those
 *   are separate rooms; you get between them by shaft, not by walking.
 *
 * A track is a distinct (colour, direction) among a platform's callers, which
 * is what makes both arrangements fall out of the same rule: at an ordinary
 * station a platform's two tracks differ by direction, at Gamla stan they
 * differ by colour, and a side platform has just the one.
 */

/** one running line alongside a platform: everything that uses it goes the same way */
export interface PlanTrack {
  color: LineColor;
  dir: 1 | -1;
  /** service ids that use this track here */
  services: string[];
}

/** one platform: a walkable island with a track along one or both edges */
export interface PlanIsland {
  tracks: PlanTrack[];
  widthM: number;
  lengthM: number;
}

export interface PlanLevel {
  /** the storey, as OSM tags it: 0 is the street, -3 is three floors down */
  level: number;
  islands: PlanIsland[];
}

export interface StationPlan {
  /** shallowest first */
  levels: PlanLevel[];
  /** false = nothing mapped, the one-island-per-line default applied */
  found: boolean;
}

interface RawServe {
  service: string;
  dir: number;
  to: string;
}
interface RawPlatform {
  level: number;
  lengthM: number;
  widthM: number;
  serves: RawServe[];
}
interface RawLevel {
  level: number;
  platforms: RawPlatform[];
}

const data = raw as { stations: Record<string, { levels: RawLevel[] }> };

const colorOf = new Map(SERVICES.map((s) => [s.id, s.color]));

const trackKey = (color: LineColor, dir: number) => `${color}/${dir}`;

const islandOf = (p: RawPlatform): PlanIsland => {
  const tracks = new Map<string, PlanTrack>();
  for (const s of p.serves) {
    const color = colorOf.get(s.service);
    if (!color) continue;
    const dir = s.dir >= 0 ? 1 : -1;
    const key = trackKey(color, dir);
    const at = tracks.get(key) ?? { color, dir, services: [] };
    if (!at.services.includes(s.service)) at.services.push(s.service);
    tracks.set(key, at);
  }
  return {
    // a platform with more than two is mismapped; the two busiest are the
    // ones a train actually pulls up at
    tracks: [...tracks.values()].sort((a, b) => b.services.length - a.services.length).slice(0, 2),
    widthM: p.widthM,
    lengthM: p.lengthM,
  };
};

/** the one-island-per-line arrangement, for the 15 stations nothing is mapped for */
const fallbackPlan = (name: string): StationPlan => {
  const deps = departuresFrom(name);
  const islands: PlanIsland[] = [];
  for (const color of colorsAt(name)) {
    const tracks: PlanTrack[] = [];
    for (const dir of [1, -1] as const) {
      const services = [
        ...new Set(
          deps.filter((d) => d.service.color === color && d.dir === dir).map((d) => d.service.id),
        ),
      ];
      if (services.length > 0) tracks.push({ color, dir, services });
    }
    if (tracks.length > 0) islands.push({ tracks, widthM: 0, lengthM: 0 });
  }
  return { levels: [{ level: 0, islands }], found: false };
};

/**
 * Put back whatever the mapping left out.
 *
 * The plan is only as complete as OSM's route relations, and 20 of the 240
 * calls could not be placed against a platform we hold. Where that dropped a
 * direction, the station came out with a track down one side and a wall down
 * the other, 25 ordinary through-stations laid out as side platforms, which
 * is worse than the guess it replaced. So every service the network says
 * departs from here has to appear somewhere: on the track that already runs
 * its colour and heading, else beside the platform that already serves it,
 * else on the shallowest level.
 */
const complete = (name: string, levels: PlanLevel[]): PlanLevel[] => {
  const all = levels.flatMap((l) => l.islands);
  const has = (service: string, dir: 1 | -1) =>
    all.some((i) => i.tracks.some((t) => t.dir === dir && t.services.includes(service)));
  for (const dep of departuresFrom(name)) {
    const dir = dep.dir;
    const id = dep.service.id;
    const color = dep.service.color;
    if (has(id, dir)) continue;
    const sameTrack = all
      .flatMap((i) => i.tracks)
      .find((t) => t.color === color && t.dir === dir);
    if (sameTrack) {
      sameTrack.services.push(id);
      continue;
    }
    const serving = all.find(
      (i) => i.tracks.length < 2 && i.tracks.some((t) => t.services.includes(id)),
    );
    const island = serving ?? all.find((i) => i.tracks.length < 2) ?? levels[0].islands[0];
    if (!island) continue;
    island.tracks.push({ color, dir, services: [id] });
  }
  // an ordinary island puts the +1 track on the upper edge, as the game always
  // has; a direction-paired one has no such distinction and keeps its order
  for (const i of all) {
    if (i.tracks.length === 2 && i.tracks[0].dir !== i.tracks[1].dir) {
      i.tracks.sort((a, b) => b.dir - a.dir);
    }
  }
  return levels;
};

const cache = new Map<string, StationPlan>();

export const stationPlan = (name: string): StationPlan => {
  const hit = cache.get(name);
  if (hit) return hit;
  const st = data.stations[name];
  let plan: StationPlan;
  if (!st || st.levels.length === 0) plan = fallbackPlan(name);
  else {
    const levels = st.levels
      .map((l) => ({ level: l.level, islands: l.platforms.map(islandOf).filter((i) => i.tracks.length > 0) }))
      .filter((l) => l.islands.length > 0);
    // shallowest first, so level 0 is the one nearest the street
    levels.sort((a, b) => b.level - a.level);
    plan = levels.length > 0 ? { levels: complete(name, levels), found: true } : fallbackPlan(name);
  }
  cache.set(name, plan);
  return plan;
};

/** which storey a given service runs from here, or null if it does not call */
export const levelOfService = (
  name: string,
  service: string,
  dir: 1 | -1,
): number | null => {
  const plan = stationPlan(name);
  for (const level of plan.levels) {
    for (const island of level.islands) {
      for (const t of island.tracks) {
        if (t.dir === dir && t.services.includes(service)) return level.level;
      }
    }
  }
  return null;
};

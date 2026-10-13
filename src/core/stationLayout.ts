import * as C from '../config.ts';
import { departuresFrom, lineDirOf, SERVICES, type Departure, type LineColor } from './network.ts';
import { stationGeo } from '../data/stationGeometry.ts';
import { stationPlan, type PlanLevel } from '../data/platformPlan.ts';

/**
 * ONE STOREY OF A STATION AS PURE GEOMETRY: its islands, and the track bands
 * either side of them, a function of (station, levelIndex) and nothing else.
 *
 * Extracted from Run.layoutInto so that the WORLD can ask where a track runs
 * without building a station: the service paths (src/core/worldNet.ts) thread
 * every line through every station at the lateral its band actually sits at,
 * and the only way both the arena and the track can agree forever is if they
 * are the same arithmetic.
 *
 * The layout convention is unchanged: the first island's spine is anchored to
 * GAME_HEIGHT/2 at every station, so the bore leaves and arrives at the same
 * local height everywhere and a leg can be one tunnel.
 */

export interface BandTrack {
  color: LineColor;
  /** +1 = toward the end of the service's station list, resolved the way the
   * arena resolves it (a terminus falls back to the service, §layoutInto) */
  dir: 1 | -1;
  /** the departures this track serves, and where each one goes next */
  options: Departure[];
  /** the services the PLAN lists on this track (options is empty at a level
   * that only receives; the plan still knows who runs here) */
  services: string[];
  edgeY: number;
  inward: 1 | -1;
  bandTop: number;
  bandBottom: number;
}

export interface BandIsland {
  top: number;
  bottom: number;
  color: LineColor;
  /** index into tracks[] serving the top / bottom edge, or -1 */
  railTop: number;
  railBottom: number;
}

export interface StationBands {
  platforms: BandIsland[];
  tracks: BandTrack[];
  worldTopY: number;
  worldBottomY: number;
  /** the first island's spine, the local y every bore converges on */
  spineY: number;
  levelCount: number;
  storey: number;
}

const cache = new Map<string, StationBands>();

export function stationBands(station: string, levelIndex: number): StationBands {
  const key = `${station}|${levelIndex}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const deps = departuresFrom(station);
  const bedH = C.M(4);
  const platH = C.M(stationGeo(station).widthM);
  const plan = stationPlan(station);
  const li = Math.max(0, Math.min(levelIndex, plan.levels.length - 1));
  const here = plan.levels[li];
  const natural = layoutStorey(station, here.islands, deps, bedH, platH);
  // THE TOP TRACK RUNS THE LINE FORWARD (left-hand running with +x along
  // the line) at every station, so no station faces the other way from its
  // neighbour: a storey whose plan lists the tracks the other way up is laid
  // out mirrored. A terminus is the exception, all its tracks are
  // departures back down the line and no mirror changes that.
  const top = natural.tracks[0];
  const topSvc = top ? SERVICES.find((q) => q.id === top.services[0]) : undefined;
  const backward =
    !!top && !!topSvc && lineDirOf(topSvc, top.dir) === -1 && !storeyIsTerminus(station, natural.tracks);
  const out: StationBands = backward
    ? layoutStorey(
        station,
        [...here.islands].reverse().map((isl) => ({ ...isl, tracks: [...isl.tracks].reverse() })),
        deps,
        bedH,
        platH,
      )
    : natural;
  out.levelCount = plan.levels.length;
  out.storey = here.level;
  cache.set(key, out);
  return out;
}

/** every track on the storey is a departure back down its line: the line ends here */
export function storeyIsTerminus(station: string, tracks: BandTrack[]): boolean {
  return tracks.every((t) =>
    t.services.every((id) => {
      const sv = SERVICES.find((q) => q.id === id);
      return !sv || sv.stations[sv.stations.indexOf(station) - t.dir] === undefined;
    }),
  );
}

function layoutStorey(
  station: string,
  islands: PlanLevel['islands'],
  deps: Departure[],
  bedH: number,
  platH: number,
): StationBands {
  void station;

  // anchor the first island's spine to the same y everywhere (see layoutInto)
  const lone0 = islands.length > 0 && islands[0].tracks.length === 1;
  const spine0Rel = (lone0 ? 0 : bedH) + platH / 2;
  const startY = C.GAME_HEIGHT / 2 - spine0Rel;
  let y = startY;

  const tracks: BandTrack[] = [];
  const platforms: BandIsland[] = [];
  islands.forEach((island, islandIndex) => {
    const lone = island.tracks.length === 1;
    const loneBelow = lone && islandIndex < islands.length / 2;
    const topTrack = lone ? (loneBelow ? undefined : island.tracks[0]) : island.tracks[0];
    const bottomTrack = lone ? (loneBelow ? island.tracks[0] : undefined) : island.tracks[1];
    const topBand = y;
    const platTop = y + (topTrack ? bedH : 0);
    const platBottom = platTop + platH;
    const botBand = platBottom + (bottomTrack ? bedH : 0);
    let railTop = -1;
    let railBottom = -1;
    for (const [track, isTop] of [
      [topTrack, true],
      [bottomTrack, false],
    ] as const) {
      if (!track) continue;
      const byService = deps.filter((d) => track.services.includes(d.service.id));
      const heading = byService.filter((d) => d.dir === track.dir);
      const options = heading.length > 0 ? heading : byService;
      const dir = options[0]?.dir ?? track.dir;
      if (options.length > 0) {
        if (isTop) railTop = tracks.length;
        else railBottom = tracks.length;
      }
      tracks.push({
        color: track.color,
        dir,
        options,
        services: track.services,
        edgeY: isTop ? platTop : platBottom,
        inward: isTop ? 1 : -1,
        bandTop: isTop ? topBand : platBottom,
        bandBottom: isTop ? platTop : botBand,
      });
    }
    const colors = island.tracks.map((t) => t.color);
    const color: LineColor = colors.every((c) => c === 'blue')
      ? 'blue'
      : (colors.find((c) => c !== 'blue') ?? 'green');
    platforms.push({ top: platTop, bottom: platBottom, color, railTop, railBottom });
    y = botBand;
  });

  // AN EDGE KNOWS THE TRACK BEHIND IT whichever island the plan listed the
  // track under: two islands with one track between them share it, and
  // the plan lists it once. The other island's edge used to have no rail
  // (-1), which the horde reads as a WALL, so at Västra skogen a horde on
  // the second island stood jerking at its top edge, unable to cross a
  // bed the picture plainly drew there (from play 2026-09-04).
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  platforms.forEach((pf) => {
    if (pf.railTop < 0) pf.railTop = tracks.findIndex((t) => near(t.bandBottom, pf.top));
    if (pf.railBottom < 0) pf.railBottom = tracks.findIndex((t) => near(t.bandTop, pf.bottom));
  });
  return {
    platforms,
    tracks,
    worldTopY: startY,
    worldBottomY: y,
    spineY: platforms.length > 0 ? (platforms[0].top + platforms[0].bottom) / 2 : C.GAME_HEIGHT / 2,
    levelCount: 1,
    storey: 0,
  };
}

/** the storey index and band a service runs on through this station, in its
 * given direction, where the WORLD's track for that service actually lies */
const bandCache = new Map<string, { levelIndex: number; track: BandTrack } | null>();

export function bandOfService(
  station: string,
  service: string,
  dir: 1 | -1,
): { levelIndex: number; track: BandTrack } | null {
  // pure in its arguments, and asked for every rail every tick and for every
  // tube a train might be in: remembered rather than re-searched
  const key = `${station}|${service}|${dir}`;
  const hit = bandCache.get(key);
  if (hit !== undefined) return hit;
  const found = findBandOfService(station, service, dir);
  bandCache.set(key, found);
  return found;
}

function findBandOfService(
  station: string,
  service: string,
  dir: 1 | -1,
): { levelIndex: number; track: BandTrack } | null {
  const plan = stationPlan(station);
  // the exact direction on whichever storey runs it FIRST; a stacked station
  // runs each direction on its own storey, and taking the first storey that
  // merely lists the service put T-Centralen's corridors on the wrong one
  for (let li = 0; li < plan.levels.length; li++) {
    const exact = stationBands(station, li).tracks.find((t) => t.services.includes(service) && t.dir === dir);
    if (exact) return { levelIndex: li, track: exact };
  }
  // a terminus reverses, so fall back to the service alone (same rule the arena uses)
  for (let li = 0; li < plan.levels.length; li++) {
    const any = stationBands(station, li).tracks.find((t) => t.services.includes(service));
    if (any) return { levelIndex: li, track: any };
  }
  return null;
}

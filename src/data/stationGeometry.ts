import raw from '../../data/centrelines.json' with { type: 'json' };

/**
 * Per-station platform geometry, distilled from OpenStreetMap
 * (data/platforms.json → scripts/build-centrelines.mjs → data/centrelines.json,
 * © OpenStreetMap contributors, ODbL).
 *
 * Every station in the network has an entry: 87 measured from a mapped
 * platform polygon, 10 from the subway track running through the station, and
 * 3 that nothing usable is mapped for and fall back to a straight default.
 *
 * `offsets` is the platform's CENTRELINE: across-platform displacement in
 * metres, sampled evenly from one end to the other, measured from the chord
 * between the ends, so a straight platform is all zeros and the curved-platform
 * work has straight as its trivial case rather than as a special case. Gamla
 * stan bows 3.7m, Slussen 5.7m, Fridhemsplan 7.3m; 58 of 100 are flat.
 *
 * `offsets` is read by `PlatformPath`, which turns it into the curve the whole
 * station is swept along, deck, edges, beds, furniture and every train car.
 */
export interface StationGeo {
  lengthM: number;
  widthM: number;
  /** across-platform metres, end to end, chord-relative; all zeros = straight */
  offsets: number[];
  /** the largest of those offsets, how far the platform bows */
  bowM: number;
  /** false = nothing mapped, straight defaults applied */
  found: boolean;
  /** does this station stand in the open? From OSM tunnel tags on the tracks
   * alongside the platform, not from a hand-kept list */
  outdoor: boolean;
}

interface RawStation {
  lengthM: number;
  widthM: number;
  bowM: number;
  source: string;
  offsets: number[];
  widths?: number[];
  outdoor?: boolean;
}

const data = raw as { samples: number; stations: Record<string, RawStation> };

const DEFAULT: StationGeo = {
  lengthM: 145,
  widthM: 10,
  offsets: new Array(data.samples).fill(0),
  bowM: 0,
  found: false,
  outdoor: false,
};

const geo = new Map<string, StationGeo>();
for (const [name, st] of Object.entries(data.stations)) {
  geo.set(name, {
    lengthM: st.lengthM,
    widthM: st.widthM,
    offsets: st.offsets,
    bowM: st.bowM,
    found: st.source !== 'default',
    outdoor: st.outdoor === true,
  });
}

export const stationGeo = (name: string): StationGeo => geo.get(name) ?? DEFAULT;

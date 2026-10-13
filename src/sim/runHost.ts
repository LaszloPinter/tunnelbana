import type { RideSummary } from './chain.ts';
/**
 * What the simulation asks of whoever is showing it, and it only ever ASKS:
 * a line on the HUD, a station to dress, a camera to nudge. Every callback is
 * about the picture or the feel; none of them may write simulation state.
 * In the browser the host is DemoScene; in a Node validator it is a stub,
 * and that is the point of the seam (§11c, decision A).
 */
export interface RunHost {
  /** a HUD line (already seat-filtered by the sim) */
  msg(text: string): void;
  /** a transient HUD line that refreshes every tick while it applies */
  hint(text: string): void;
  /** the big station name across the screen */
  banner(name: string): void;
  /** a camera feeling for ONE seat; the host ignores other seats' feelings */
  feel(seat: number, kind: 'hit' | 'death' | 'jolt' | 'arrive' | 'tumble' | 'warn'): void;
  /** the player's place is about to change: capture what must not appear to move */
  stationChanging(): void;
  /** it has: dress is done or pending, reframe, replace rigs, settle */
  stationChanged(kind: 'ride' | 'walk' | 'shaft'): void;
  /** the layout changed which rail slots exist */
  railsChanged(): void;
  /** the sim's station structure is final for this station: paint it */
  dressStation(): void;
  /** the run is over; this.over says how */
  runOver(): void;
  /** a ride of the chain was made (sim/chain.ts): the victory screen, while the world holds */
  arrived(summary: RideSummary): void;
}

/** a host that shows nothing: what a Node validator passes (§11b) */
export const NULL_HOST: RunHost = {
  msg: () => {},
  hint: () => {},
  banner: () => {},
  feel: () => {},
  stationChanging: () => {},
  stationChanged: () => {},
  railsChanged: () => {},
  dressStation: () => {},
  runOver: () => {},
  arrived: () => {},
};

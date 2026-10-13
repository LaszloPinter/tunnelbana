import type { Place } from './place.ts';
import type { Run } from './run.ts';
import type { Player } from './player.ts';
import type { CombatHost } from '../combat/types.ts';

/**
 * ONE PLACE, as the combat system sees it (§17): the place, the run, and the
 * seats standing in it, refreshed by Run before each step, not per lookup.
 * A place-local message reaches only the seats in it.
 *
 * A leg is a place like a station is (sim/place.ts), so this is the same
 * object for a tunnel. It used to lend a station's host to whoever had
 * walked off one of its ends, because a leg was not a place and its walker
 * had to belong somewhere; there is nothing to lend now.
 */
export class PlaceHost implements CombatHost {
  readonly run: Run;
  readonly st: Place;
  players: Player[] = [];

  constructor(run: Run, st: Place) {
    this.run = run;
    this.st = st;
  }

  /** who is standing in this room right now */
  refresh() {
    const id = this.st.id;
    this.players = this.run.players.filter((p) => p.placeId === id);
  }

  showMsg = (text: string, now: number, p?: Player): void => {
    if (p) return this.run.showMsg(text, now, p);
    if (!this.players.some((q) => q.id === this.run.localId)) return;
    this.run.showMsg(text, now);
  };
}

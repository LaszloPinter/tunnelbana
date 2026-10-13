/** a coin, a mana drop, or a stain: a circle lying in some frame */
export interface Loot {
  id: number;
  frame: 'world' | 'train';
  ti: number;
  x: number;
  y: number;
  /**
   * ON A TRAIN, WHICH TRAIN, and that makes x and y a SEAT: so far along the
   * car from its tail, so far across it. The old world could say "the car's
   * own x plus the train's left edge" because a train lived inside one room's
   * chart; on the map it is laid along its line, so a drop aboard has to be
   * named the same way a rider is (world/trainSeat.ts). Without it a coin
   * dropped on a train was put down at a coordinate belonging to nothing, and
   * nothing was ever there to pick up (from play 2026-09-11).
   */
  jid?: string;
  /** lying under the metal (dropped on the bed): drawn below the train */
  under?: boolean;
  expireAt: number;
  /** what it looks like, a fact about the thing, not about the renderer */
  color: number;
  r: number;
  /** what picking it up does; plain mana if absent. 'card': the king's drop,
   * a rolled SL card to whoever gets there first (100 kr shared if their slots are full) */
  kind?: 'card';
  /** a coin's worth; 5 if absent. Litter consolidates: past ~40 coins a new
   * drop tops up the nearest pile instead of adding an object (§12d: the
   * display list is the frame cost, and a good fight drops a carpet) */
  value?: number;
}

export interface AcidPool {
  id: number;
  frame: 'world' | 'train';
  ti: number;
  x: number;
  y: number;
  expireAt: number;
  color: number;
  r: number;
}

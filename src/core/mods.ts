/**
 * Stackable player modifiers. Perks mutate this; combat code reads it.
 * Casts: bat = Arc (short-range AOE cone), pistol = Bolt (semi-auto),
 * smg = Torrent (channelled). All available from the start; all cost mana.
 *
 * Elements are NOT in the perk pool: at level 5 you choose an element
 * (tier 1), and at level 12 you either deepen it (tier 2) or take a second
 * element's tier 1, never both.
 */
export interface Mods {
  pistolRate: number;
  smgRate: number;
  /** the mana-orb perk: chance a kill drops an orb, on top of the base rate
   * (combat/enemyDeath.ts); capped in core/perks.ts */
  orbChance: number;
  /** the coin perk's share of the extra-coin chance, the tickets' share is
   * `coinChance`; the drop reads the sum. Capped in core/perks.ts */
  coinLuck: number;
  /** Långskott: bolt damage ×(1+N) once it has flown LONG_SHOT_M */
  longShot: number;
  /** chance the bolt casts twice */
  doubleTap: number;
  /** ...and a THIRD, once twin is certain */
  tripleTap: number;
  /** extra damage per bolt */
  bulletDamage: number;
  /** extra enemies a bolt passes through */
  pierce: number;
  /** ms of slow applied on hit (ice element) */
  slowMs: number;
  /** chain lightning targets (lightning element) */
  chain: number;
  /** stun ms applied by chain zaps (lightning II) */
  zapStun: number;
  /** homing turn rate rad/s (dark element) */
  homing: number;
  /** bolts split into seekers on hit (dark II) */
  split: number;
  /** an extra coin, this often */
  coinChance: number;
  moveSpeed: number;
  /**
   * THE TICKETS' OWN SPEED, OUTSIDE THE CAPS (the user's call, 2026-09-29:
   * "none of the tickets should apply to the caps"). Perks are frequent and
   * capped; a ticket costs a slot and kronor, and three of them spent on one
   * thing is a build, Balatro-style, it may break the game. `moveSpeed` and
   * the cast rates are the perks' (capped); these multiply on top, uncapped.
   */
  ticketMove: number;
  /** the time between casts, ×; below 1 is faster */
  ticketCast: number;
  /** STÖT: its reach, ×1; its cooldown, ×1; what it does, ×1 */
  novaRadius: number;
  novaCd: number;
  novaPower: number;
  retaliate: number;
  dashDamage: number;
  dashCd: number;
  /** nattbuss: how far a dash goes, ×1 */
  dashLen: number;

  // ---- the classes (core/classes.ts) ----
  /** the dart's bolt: slow, heavy, fast-flying */
  heavyBolt: number;
  critChance: number;
  critMul: number;
  /** hp per second, for yourself */
  hpRegen: number;
  /** hp per second, for teammates standing near you (shelter) */
  regenAura: number;

  // ---- the lanes (core/lanes.ts) ----
  /** how fast this player revives the downed, ×1 base */
  reviveSpeed: number;
  /** dashes in hand before the cooldown */
  dashCharges: number;
  /** dark II: shots curve home to the caster, hitting again on the way */
  boomerang: number;
  /** laddning lane: its tier, and what a detonation's blast is multiplied by */
  laddning: number;
  blastMul: number;
  /** ram lane: every Nth cast is a ram (0 = never) */
  ramEvery: number;
  /** ...and how far its blast and its shove carry */
  ramThrough: number;

  // ---- the cards (core/cards.ts) ----
  manaMaxBonus: number;
  /** mana trickle speed, ×1 base */
  manaRegen: number;
  maxHealthBonus: number;
  /** max hp, ×1 base (the hp tickets) */
  hpMul: number;
  /** chance a hit misses you (the nimble perk), capped in sim/harm.ts */
  dodge: number;
  /** bolt damage, ×1 base */
  boltMul: number;
}

export const defaultMods = (): Mods => ({
  pistolRate: 1,
  smgRate: 1,
  orbChance: 0,
  coinLuck: 0,
  longShot: 0,
  doubleTap: 0,
  tripleTap: 0,
  bulletDamage: 0,
  pierce: 0,
  slowMs: 0,
  chain: 0,
  zapStun: 0,
  homing: 0,
  split: 0,
  moveSpeed: 1,
  ticketMove: 1,
  ticketCast: 1,
  novaRadius: 1,
  novaCd: 1,
  novaPower: 1,
  coinChance: 0,
  retaliate: 0,
  dashDamage: 0,
  dashCd: 1,
  dashLen: 1,
  heavyBolt: 0,
  reviveSpeed: 1,
  dashCharges: 1,
  boomerang: 0,
  laddning: 0,
  blastMul: 1,
  ramEvery: 0,
  ramThrough: 0,
  critChance: 0,
  critMul: 1,
  hpRegen: 0,
  regenAura: 0,
  manaMaxBonus: 0,
  manaRegen: 1,
  maxHealthBonus: 0,
  hpMul: 1,
  dodge: 0,
  boltMul: 1,
});

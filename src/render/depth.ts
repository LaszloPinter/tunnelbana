/**
 * THE DEPTH ORDER, in one place, because it is a CONTRACT and it was being
 * kept as forty scattered magic numbers.
 *
 * The world had a perfectly good order, place art low, actors in the middle,
 * light and foreground on top, and nothing said so anywhere, so nothing
 * stopped a layer being added outside it. One was: the neighbouring station
 * was a single container at 8.6, which put a whole station's floors, walls and
 * near-black cover bands ABOVE the player, the horde and the shots.
 *
 * That one number produced three separate bug reports. Walking toward the next
 * station, its layer blanketed the screen, so the tunnel went black; the player
 * vanished into it at the seam; and the tunnel lights "only showed up behind
 * me", because the lights ahead were the ones the approaching station covered
 * and the ones behind were not covered yet. The comment sitting directly above
 * that line already described the symptom from an earlier session.
 *
 * ---- the invariant ----
 *
 * 1. Everything belonging to a PLACE, floor, track, wall, decor, recesses,
 *    lights, is below `GLOOM`, whichever place it is: every station is drawn
 *    the same way, by its own PlaceView, and there is no neighbour layer.
 * 2. `GLOOM` is the tunnel roof's darkness. It dims the place and nothing else.
 * 3. Anything that MOVES, players, enemies, projectiles, loot, is above it.
 *    The dark belongs to the tunnel, never to the people walking through it.
 * 4. Only genuine foreground (an escalator climbing away over your head) and
 *    additive LIGHT go above the actors, because both are things you should
 *    see in front of a person.
 *
 * scripts/check-depth.mjs asserts 1 and 3 rather than trusting anyone to
 * remember them.
 */

/**
 * THE MAP'S GROUND, and the ROOMS STANDING ON IT. The baked floor
 * (render/mapView.ts) is one picture of everything walkable; a station's own
 * picture, its paving, walls and decor, one container posed where the
 * station stands (render/placeView.ts), goes over it. Both sat at 0 and
 * which won was whichever had been made later, which is not a contract.
 */
export const GROUND = 0;
export const ROOM = 0.25;

/** the place: floors, beds, walls, decor, recesses, lamps */
export const PLACE_MIN = 1;
export const PLACE_MAX = 4.4;

/** the tunnel's roof. Dims everything below it; never touches an actor. */
export const GLOOM = 5.6;
/** the portal mark where a bore's roof begins */
export const PORTAL = 5.65;

/** nothing that moves may be drawn below this */
export const ACTOR_MIN = 5.7;
export const ACTOR_MAX = 6.6;

/** genuinely in front of a person: a flight of stairs climbing away overhead */
export const OVERHEAD = 7.5;
/** additive light, which reads as light precisely because it is on top */
export const LIGHT = 8.55;

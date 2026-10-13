// World scale: pixels per meter. All gameplay dimensions derive from real-world ones
// so station/train proportions stay honest when assets replace placeholders.
export const PX_PER_M = 18;
export const M = (meters: number) => meters * PX_PER_M;

// The LAYOUT contract: every position in the game, world and HUD alike, is
// expressed in these units. The canvas underneath is the window in real device
// pixels; the cameras zoom this box up to fill it, so the picture is drawn at
// the screen's own resolution without any of this arithmetic changing.
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/** how far above 1 device pixel per CSS pixel we are willing to render.
 * Lowering it costs sharpness and buys fill rate, the in-game overlay cycles
 * it so a frame-rate problem can be pinned on the GPU or ruled out. */
// Render at one and a half device pixels, not three. A Retina canvas is
// 2940x1666, five megapixels a frame, and this is a game of flat colour
// where the difference is hard to see and the frame time is not (from play
// 2026-09-05: 27 fps). G in the perf overlay puts it back.
let ratioCap = 1.5;
export const setRatioCap = (v: number) => {
  ratioCap = v;
};
export const getRatioCap = () => ratioCap;

/** device pixels per CSS pixel, clamped to something a GPU can live with */
export const deviceRatio = () =>
  Math.min(ratioCap, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));

// Rolling stock, C20-ish demo values (walk-through units, external joints between units)
export const CAR_LENGTH = M(15.3);
// real C20s are 2.9m; widened for gameplay so the interior reads as a room
export const CAR_WIDTH = M(3.4);
export const CARS_PER_UNIT = 3;
/** A C20 unit is three articulated sections (~46.5m); a full train is three of
 * them, ~140m, which is what the platforms are built for. Two units is a
 * "kort tåg", a short train, which is what every train in this game used to
 * be without meaning to. */
export const UNITS_PER_TRAIN = 3;
export const UNIT_GAP = M(1.2);
export const DOOR_WIDTH = M(1.4);

// Train motion (px/s, px/s²)
export const TRAIN_CRUISE = M(30); // a walker is 8 m/s: outrunning a train is no longer a plan
export const TRAIN_ACCEL = M(1.1);
export const DWELL_MS = 15_000;
export const DOOR_OPEN_DELAY_MS = 900;
export const DOOR_CLOSE_LEAD_MS = 2_600;
export const DOOR_OPENING_MS = 600;
export const DOOR_CLOSING_MS = 1_000;
/**
 * A FLOOR, not what trains run at. A service runs at this headway unless the
 * services sharing its trunk would then run closer than a track can carry
 * (src/core/timetable.ts `headwayOf`, `MIN_TRACK_GAP_MS`): three green
 * services at 60 s would be a train every 20 s through T-Centralen, so green
 * runs at 108 s and red and blue at 72 s. Read `headwayOf(service)` for the
 * real number; this is the knob it starts from.
 */
export const HEADWAY_MS = 60_000;

// ---- §17: how many places are alive at once ----
/** how many hops out from an occupied place stay built (1 = its neighbours) */
/**
 * §19: the instant tick 0 happened, for everybody, everywhere. With ticks
 * counted from a shared epoch rather than from whenever a room started, two
 * groups that have never exchanged a word are on the same clock, which is
 * what lets them see the same trains and, later, hand players between each
 * other. Never read inside the simulation: the relay reads the wall once and
 * tells the room where to start, so a run stays a function of its inputs.
 */
export const TICK_EPOCH_MS = Date.UTC(2026, 0, 1);

export const LIVE_RADIUS = 2;
/**
 * How much of a leg's real distance the game actually lays out. The real
 * network is 800-1300 m between stations, which at a walk is two and a half
 * minutes of tunnel, true, and far too long to play (from play 2026-08-29).
 * Scaling keeps every leg's length RELATIVE to every other, so Åkeshov to
 * Brommaplan is still longer than Rådhuset to Fridhemsplan; it just fits.
 * Applied in one place, `legMetres()`, so the walk, the ride and the drawing
 * can never disagree about how far apart two stations are.
 */
export const LEG_SCALE = 0.7; // tunnels long enough that a walk down one is a commitment
/** the ceiling. T-Centralen has six connections, so standing there is seven
 * stations before anyone moves, this is a budget, not a rule: it yields
 * rather than evict a place holding a player or a train in transit */
export const MAX_LIVE = 16;
/** an undemanded place is kept this long before it is taken down */
export const EVICT_AFTER_MS = 20_000;
/** build ahead: a foot in a tunnel or doors beginning to close pulls in
 * what is on the other side, even if the player turns back */
export const SPECULATE = true;
/**
 * THE WHOLE NETWORK IN ONE GO (decided in chat 2026-09-02): every station is
 * built at run start and nothing is ever evicted, so the world simply exists,
 * each place at its position on the map (src/core/networkMap.ts), the legs
 * between them the map's own spans. A build is pure in (runSeed, name), so
 * this changes cost, not behaviour; cutting the live set back down to a few
 * places is a later optimisation, and MAX_LIVE/EVICT_AFTER_MS above are how.
 */
export const WHOLE_NETWORK = true;

// Player
export const PLAYER_SPEED = M(8);
export const JUMP_SCALE = 1.18;

// Sorcery
export const MANA_START = 60;
/** cut from 150 (2026-08-24): the waveclear lanes carry +30 max mana per
 * tier, so a two-pick caster lands where the old base did at level 12,
 * mana is part of what you COMMIT to now, not a given */
export const MANA_MAX = 90;
export const MANA_REGEN_MS = 3400; // 1 mana per this many ms, a trickle, not an income
export const DASH_MS = 190;
export const DASH_CD_MS = 1400;
export const DASH_SPEED_MUL = 3.2;

// Casts (mechanical names kept: pistol = Bolt, smg = Torrent)
export const PISTOL_RATE_MS = 320;
export const PISTOL_SPEED = M(40);
export const PISTOL_TTL_MS = 1400;
export const SMG_SPEED = M(36);
export const SMG_TTL_MS = 1100;
/** Långskott: a bolt that has flown this far of its own accord hits harder.
 * Just past a spitter's reach (14 m), so it pays for fighting the line from
 * outside it rather than for every shot at a biter on your toes */
export const LONG_SHOT_M = M(8);

// STÖT (RMB / Q): the shockwave, a press, a cost, a cooldown
/** how fast a commuter can ever run, ×PLAYER_SPEED: perks and tickets stack
 * past it on paper but the feet stop here (from play 2026-09-24: "speed of
 * sound running from station to station") */
export const MOVE_SPEED_CAP = 1.9;

export const NOVA_RADIUS = M(6);
export const NOVA_CD_MS = 18_000;
export const NOVA_COST = 12;
export const NOVA_KNOCK = M(30);
export const NOVA_STUN_MS = 700;

// The horde's ward: an elite holds a barrier toward you, and what stands
// behind it cannot be hit until it is broken. A pierce stops on it; a bore
// goes through.
export const WARD_HP = 40;
/** cos of the half-angle: 0.3 ≈ 145° of cover */
export const SHIELD_DOT = 0.3;

// Interaction thresholds (px/s)
export const TRAIN_CRUSH_MIN = M(0.5); // on the track bed, a train moving faster than this kills

// MAX_FRAME_MS moved to src/sim/tick.ts: the clock's own constant, and the
// relay server imports that file without the rest of the game's config.

/** untouchable for this long when a run begins: the horde is already on the
 * platform, and a new player lost a third of their HP in eight seconds
 * without knowing what bit them (alpha UX pass, 2026-09-30) */
export const RUN_START_GRACE_MS = 5000;

/**
 * A name to be going on with.
 *
 * Everyone is signed in from the first frame, anonymously, but signed in,
 * so everyone is on the board straight away and nobody has to decide who they
 * are before they can play. That means everyone needs a name immediately, and
 * "Player 4812" is a worse first impression than the game deserves.
 *
 * So: a commuter and a complaint about commuting, in Swedish. The pairing is
 * the joke, half of these are the sort of thing you mutter on a platform at
 * half eleven, and the other half are what might be living under it.
 *
 * Cosmetic only. This never draws from the run's stream: a name is not part of
 * the simulation and must not move it by a single roll (§11c stage 0).
 */

const ADJECTIVES = [
  'Vilsen', // lost
  'Sen', // late
  'Trött', // tired
  'Envis', // stubborn
  'Tyst', // silent
  'Blek', // pale
  'Rastlös', // restless
  'Blöt', // soaked
  'Snabb', // quick
  'Kall', // cold
  'Modig', // brave
  'Glömsk', // forgetful
  'Hungrig', // hungry
  'Ilsken', // cross
  'Sömnig', // sleepy
  'Vaksam', // watchful
];

const NOUNS = [
  'Vätte', // the little folk under the ground
  'Pendlare', // commuter
  'Spärrvakt', // ticket inspector
  'Troll',
  'Nattvandrare', // night walker
  'Perrongvakt', // platform guard
  'Rulltrappa', // escalator
  'Skymning', // dusk
  'Spårsökare', // track finder
  'Kortläsare', // card reader
  'Tunnelmask', // tunnel worm
  'Bergakung', // mountain king
  'Nattbuss', // the night bus, a fate rather than a service
  'Ersättningsbuss', // replacement bus, the worst words in Stockholm
];

export function randomPlayerName(rand: () => number = Math.random): string {
  const a = ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(rand() * NOUNS.length)];
  return `${a} ${n}`;
}

/** how many distinct names this can produce, worth knowing before it ships */
export const NAME_SPACE = ADJECTIVES.length * NOUNS.length;

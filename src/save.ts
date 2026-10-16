import { myLook, saneLook, type PlayerLook } from './render/look.ts';
/**
 * WHAT THE BROWSER REMEMBERS.
 *
 * This is the LOCAL half. Scores themselves belong to the account, everyone
 * is signed in anonymously from the first frame, so every run is on the board,
 * and what stays here is what has to survive before the network answers:
 * the preferences, the name to play under, and a copy of the day's result so
 * the landing can say what you did today without waiting on a round trip.
 *
 * Every read and write is wrapped, because `localStorage` is not merely
 * *empty* in a private window or with site data blocked: the accessor itself
 * throws. A save file that cannot be read is not an error condition, it is a
 * player who has not played before, and the game must open exactly the same
 * way for them.
 */

const KEY = 'tunnelbana-save-v1';

export interface DailyResult {
  /** the UTC date this was played, `YYYY-MM-DD` */
  date: string;
  /** stops travelled toward the destination */
  stops: number;
  kills: number;
  /** seconds of run time */
  seconds: number;
  /** did they actually arrive */
  won: boolean;
}

export interface Prefs {
  /** device pixels per CSS pixel the player is willing to pay for */
  ratioCap: number;
  /** the frame-time overlay, for someone chasing a slow machine */
  perfHud: boolean;
  /**
   * What the board calls you. Kept here as well as in the account because a
   * player has a name from the first frame, before any sign-in, and before
   * the network has been asked anything.
   */
  playerName: string;
  /** the tutorial has been played or skipped in this browser. A save that
   * predates the field is a player who has played: they are done. */
  tutorialDone: boolean;
  /** a real run has been started from the landing: the Play button stops pulsing */
  playedOnce: boolean;
  /** what your commuter looks like (render/look.ts), chosen on the landing;
   * null until the first visit rolls one */
  look: PlayerLook | null;
  /** the live guide's arrows and tips (scenes/guide.ts), G to toggle */
  guide: boolean;
}

export interface Save {
  /** the best random run ever finished, by stops then kills */
  best: { stops: number; kills: number; seconds: number } | null;
  /** the day's results, newest first; trimmed so this cannot grow forever */
  daily: DailyResult[];
  prefs: Prefs;
}

export const DEFAULT_PREFS: Prefs = {
  ratioCap: 3,
  perfHud: false,
  playerName: '',
  tutorialDone: false,
  playedOnce: false,
  look: null,
  guide: true,
};

const EMPTY: Save = { best: null, daily: [], prefs: { ...DEFAULT_PREFS } };

/** how many days of results are kept; a streak never needs to look further */
const KEEP_DAYS = 400;

function read(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY, prefs: { ...DEFAULT_PREFS }, daily: [] };
    const parsed = JSON.parse(raw) as Partial<Save>;
    // written by an older build, or by hand: take what is usable, default the rest
    const prefs = { ...DEFAULT_PREFS, ...(parsed.prefs ?? {}) };
    // A SAVE FROM BEFORE THE TUTORIAL EXISTED belongs to someone who has
    // played: nobody returning is put through it, and their Play button
    // does not pulse at them either
    const old = parsed.prefs ?? {};
    if (!('tutorialDone' in old)) prefs.tutorialDone = true;
    if (!('playedOnce' in old)) prefs.playedOnce = true;
    prefs.look = saneLook(prefs.look);
    return {
      best: parsed.best ?? null,
      daily: Array.isArray(parsed.daily) ? parsed.daily : [],
      prefs,
    };
  } catch {
    return { ...EMPTY, prefs: { ...DEFAULT_PREFS }, daily: [] };
  }
}

function write(save: Save): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* private mode, or the quota is full. The run still happened. */
  }
}

export const load = (): Save => read();

/**
 * A RUN IN PROGRESS. The sim is a function of its seed and its inputs, so a
 * save is the seed and the input log, replayed on resume, plus what the
 * landing shows about it. Kept apart from the rest of the save so the book
 * stays small, and gone the moment the run ends (death deletes it).
 */
export interface SavedRun {
  seed: number;
  /** the day's date when the run is the daily, else null */
  daily: string | null;
  ticks: number;
  /** the packed input log, gzipped and base64'd */
  log: string;
  ride: number;
  station: string;
  dest: string;
  seconds: number;
  build: string;
  savedAt: number;
}

const RUN_KEY = 'tunnelbana-save-run-v1';

export function saveRunLocal(s: SavedRun): void {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(s));
  } catch {
    // no storage: the run is not saved here, and the cloud copy may still be
  }
}

export function loadRunLocal(): SavedRun | null {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedRun;
    return typeof s.seed === 'number' && typeof s.log === 'string' && typeof s.ticks === 'number' ? s : null;
  } catch {
    return null;
  }
}

export function clearRunLocal(): void {
  try {
    localStorage.removeItem(RUN_KEY);
  } catch {
    // nothing to clear
  }
}

export function savePrefs(prefs: Partial<Prefs>): void {
  const s = read();
  s.prefs = { ...s.prefs, ...prefs };
  write(s);
}

/** yesterday's date string, for the streak */
function dayBefore(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) - 86_400_000;
  const p = new Date(t);
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}-${String(p.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Consecutive days ending at `today` on which a daily was finished. Counting
 * backwards from today rather than forwards from the first entry is what makes
 * a missed day break it: the walk simply stops.
 */
export function streak(save: Save, today: string): number {
  const played = new Set(save.daily.map((d) => d.date));
  let n = 0;
  let day = today;
  // today not being played yet does not break a streak that ran to yesterday
  if (!played.has(day)) day = dayBefore(day);
  while (played.has(day)) {
    n += 1;
    day = dayBefore(day);
  }
  return n;
}

export const dailyFor = (save: Save, date: string): DailyResult | undefined =>
  save.daily.find((d) => d.date === date);

/** better is further, and on a tie, bloodier */
const beats = (a: { stops: number; kills: number }, b: { stops: number; kills: number }) =>
  a.stops !== b.stops ? a.stops > b.stops : a.kills > b.kills;

/**
 * Record a finished run. A daily is kept once, the FIRST attempt of the day
 * is the one that counts, or the challenge is just a re-roll, while a random
 * run only displaces the best if it beat it.
 */
export function recordRun(result: {
  daily: string | null;
  stops: number;
  kills: number;
  seconds: number;
  won: boolean;
}): Save {
  const s = read();
  if (result.daily) {
    if (!s.daily.some((d) => d.date === result.daily)) {
      s.daily.unshift({
        date: result.daily,
        stops: result.stops,
        kills: result.kills,
        seconds: result.seconds,
        won: result.won,
      });
      s.daily.sort((a, b) => (a.date < b.date ? 1 : -1));
      if (s.daily.length > KEEP_DAYS) s.daily.length = KEEP_DAYS;
    }
  } else if (!s.best || beats(result, s.best)) {
    s.best = { stops: result.stops, kills: result.kills, seconds: result.seconds };
  }
  write(s);
  return s;
}

/** YOUR commuter's look: the saved one, or one rolled and saved now */
export const savedLook = (): PlayerLook =>
  myLook(
    () => load().prefs.look,
    (look) => savePrefs({ look }),
  );

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { FIREBASE_CONFIG } from './firebaseConfig.ts';
import type { CrashReport } from './crash.ts';

/**
 * WHO IS PLAYING, AND WHAT THEY DID.
 *
 * Everybody is signed in from the first frame, anonymously, but signed in,
 * so every run reaches the board without anyone deciding who they are first.
 * There is no local-only mode and no "sign in to compete": the sign-in button
 * does not create an identity, it LINKS the one you already have to a Google
 * account so it survives losing this browser. Same uid before and after, same
 * scores, nothing to migrate.
 *
 * Everything here fails soft. A blocked domain, an offline aeroplane, a
 * browser with third-party storage disabled, none of that should stop
 * somebody playing the game, so every call resolves to null or an empty list
 * rather than throwing into the middle of a run.
 */

export interface Account {
  uid: string;
  /** linked to a real credential, rather than only anonymous */
  linked: boolean;
  name: string;
}

export interface ScoreRow {
  uid: string;
  name: string;
  score: number;
  kr: number;
  stops: number;
  kills: number;
  bosses: number;
  seconds: number;
  won: boolean;
  date: string;
  attempts: number;
  /** the journeys made, "from|to" each (rows before 2026-10-14 have none) */
  rides?: string[];
}

export interface SubmitRun {
  mode: 'daily' | 'quick';
  /** UTC date of the run, `YYYY-MM-DD` */
  date: string;
  seed: number;
  /** what the run was worth (src/sim/score.ts) */
  score: number;
  kr: number;
  stops: number;
  kills: number;
  bosses: number;
  seconds: number;
  won: boolean;
  rides?: string[];
  /** the packed input log, gzipped and base64'd, the evidence for the score */
  log?: { ticks: number; base64: string };
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let current: Account | null = null;
const listeners = new Set<(a: Account | null) => void>();

const announce = () => listeners.forEach((f) => f(current));

/** told whenever the account appears, is renamed, or is linked */
export function onAccount(f: (a: Account | null) => void): () => void {
  listeners.add(f);
  if (current) f(current);
  return () => listeners.delete(f);
}

export const account = (): Account | null => current;

/** Bring the account up, once at boot. Offline, there is simply no account
 * and the game carries on without a board. */
export async function start(name: string): Promise<Account | null> {
  try {
    app = initializeApp(FIREBASE_CONFIG);
    auth = getAuth(app);
    db = getFirestore(app);
    onAuthStateChanged(auth, (user) => {
      current = user ? toAccount(user, current?.name ?? name) : null;
      announce();
    });
    const cred = await signInAnonymously(auth);
    current = toAccount(cred.user, name);
    await saveName(name);
    announce();
    return current;
  } catch (err) {
    console.warn('[tunnelbana] playing without an account:', err);
    return null;
  }
}

function toAccount(user: User, name: string): Account {
  return {
    uid: user.uid,
    // an anonymous user has no providers; linking a Google account adds one
    linked: user.providerData.length > 0,
    name,
  };
}

/** the name shown on the board; kept on the player document */
export async function saveName(name: string): Promise<void> {
  if (!db || !current) return;
  const clean = name.trim().slice(0, 24);
  if (!clean) return;
  current = { ...current, name: clean };
  try {
    await setDoc(
      doc(db, 'players', current.uid),
      { name: clean, updatedAt: serverTimestamp(), createdAt: serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    console.warn('[tunnelbana] could not save the name:', err);
  }
  announce();
}

/**
 * Attach a Google account to the anonymous one already playing. `linkWithPopup`
 * rather than `signInWithPopup` on purpose: signing in would start a DIFFERENT
 * user and silently orphan every score posted so far.
 */
export async function linkGoogle(): Promise<Account | null> {
  if (!auth || !auth.currentUser) return null;
  try {
    const res = await linkWithPopup(auth.currentUser, new GoogleAuthProvider());
    current = toAccount(res.user, current?.name ?? '');
    announce();
    return current;
  } catch (err) {
    // already-linked and popup-closed are ordinary, not faults
    console.warn('[tunnelbana] sign-in did not complete:', err);
    return current;
  }
}

export async function leave(): Promise<void> {
  if (!auth) return;
  try {
    await signOut(auth);
  } catch {
    /* nothing useful to do */
  }
}

/**
 * Post a finished run.
 *
 * A daily always goes to the same document, `daily_<date>_<uid>`, so you
 * hold exactly one score per day and can keep playing to improve it. The
 * update is a RATCHET, enforced by the rules rather than checked here: a run
 * worth less than the one already posted is simply refused, so retrying can
 * never cost you the score you had. `submit` returning false for a daily
 * usually means "you did not beat yourself", which is not an error.
 */
export async function submit(run: SubmitRun): Promise<boolean> {
  if (!db || !current) return false;
  const id =
    run.mode === 'daily'
      ? `daily_${run.date}_${current.uid}`
      : `quick_${current.uid}_${run.seed >>> 0}_${Date.now()}`;
  const attempts = run.mode === 'daily' ? await attemptsSoFar(id) : 0;
  try {
    await setDoc(doc(db, 'scores', id), {
      uid: current.uid,
      name: current.name,
      mode: run.mode,
      date: run.date,
      seed: run.seed >>> 0,
      score: run.score,
      kr: run.kr,
      stops: run.stops,
      kills: run.kills,
      bosses: run.bosses,
      seconds: run.seconds,
      won: run.won,
      ...(run.rides ? { rides: run.rides.slice(0, 100) } : {}),
      attempts: attempts + 1,
      build: __BUILD_SHA__,
      updatedAt: serverTimestamp(),
    });
    // the evidence goes beside it, not in it: a leaderboard query should never
    // drag sixty kilobytes of inputs per row across the wire
    if (run.log) {
      await setDoc(doc(db, 'runs', id), {
        uid: current.uid,
        seed: run.seed >>> 0,
        ticks: run.log.ticks,
        log: run.log.base64,
        build: __BUILD_SHA__,
        updatedAt: serverTimestamp(),
      });
    }
    return true;
  } catch (err) {
    // A daily that did not beat the one already posted lands here, refused by
    // the ratchet. That is the rule working, not a failure.
    console.warn('[tunnelbana] score not posted:', err);
    return false;
  }
}

/** an uncaught error, for the `errors` collection (src/net/crash.ts); false
 * when there is no account to send it with */
export async function putError(e: CrashReport): Promise<boolean> {
  if (!db || !current) return false;
  try {
    await setDoc(doc(collection(db, 'errors')), {
      uid: current.uid,
      build: __BUILD_SHA__,
      ...e,
      at: serverTimestamp(),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * THE RUN IN PROGRESS, on the account, so it follows the player to another
 * device (src/save.ts SavedRun). One per account; the log is the bulk of it.
 */
export interface CloudSave {
  seed: number;
  daily: string | null;
  ticks: number;
  log: string;
  ride: number;
  station: string;
  dest: string;
  seconds: number;
  build: string;
  savedAt: number;
}

/** under Firestore's document limit with room: past this the save stays local */
export const CLOUD_SAVE_MAX_LOG = 900_000;

export async function putSave(s: CloudSave): Promise<boolean> {
  if (!db || !current || s.log.length > CLOUD_SAVE_MAX_LOG) return false;
  try {
    await setDoc(doc(db, 'saves', current.uid), { uid: current.uid, ...s, updatedAt: serverTimestamp() });
    return true;
  } catch (err) {
    console.warn('[tunnelbana] save not stored:', err);
    return false;
  }
}

export async function getSave(): Promise<CloudSave | null> {
  if (!db || !current) return null;
  try {
    const snap = await getDoc(doc(db, 'saves', current.uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      seed: d.seed as number,
      daily: (d.daily as string | null) ?? null,
      ticks: d.ticks as number,
      log: d.log as string,
      ride: (d.ride as number) ?? 0,
      station: (d.station as string) ?? '',
      dest: (d.dest as string) ?? '',
      seconds: (d.seconds as number) ?? 0,
      build: (d.build as string) ?? '',
      savedAt: (d.savedAt as number) ?? 0,
    };
  } catch {
    return null;
  }
}

export async function clearSave(): Promise<void> {
  if (!db || !current) return;
  try {
    await deleteDoc(doc(db, 'saves', current.uid));
  } catch {
    // an absent save is the state wanted
  }
}

/** how many times this player has already run today's daily */
async function attemptsSoFar(id: string): Promise<number> {
  if (!db) return 0;
  try {
    const snap = await getDoc(doc(db, 'scores', id));
    return snap.exists() ? ((snap.data().attempts as number) ?? 0) : 0;
  } catch {
    return 0;
  }
}

/** the day's board: best score first, then the quicker run */
/** the day's board, best first; null when it could not be read (offline,
 * no Firebase), which is not the same as a board with nobody on it */
export async function dailyBoard(date: string, top = 20): Promise<ScoreRow[] | null> {
  if (!db) return null;
  try {
    const q = query(
      collection(db, 'scores'),
      where('date', '==', date),
      where('mode', '==', 'daily'),
      orderBy('score', 'desc'),
      orderBy('seconds', 'asc'),
      limit(top),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ScoreRow);
  } catch (err) {
    console.warn('[tunnelbana] could not read the board:', err);
    return null;
  }
}

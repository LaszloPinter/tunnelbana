import { InputLog, fromBase64, gunzip, gzip, toBase64 } from '../sim/inputLog.ts';
import * as account from '../net/account.ts';
import * as save from '../save.ts';
import type { Session } from './session.ts';
import { hideResumeBar, setResumeProgress, showResumeBar } from '../ui/dom/resumeBar.ts';
import { postBanked } from './runOver.ts';

/**
 * THE RUN, SAVED AND PICKED BACK UP. A run is a function of its seed and its
 * inputs (§11c), so a save is the seed and the input log so far, gzipped,
 * kept in this browser and on the account (src/save.ts, net/account.ts),
 * and a resume is the same seed run again with those inputs replayed to the
 * tick they stopped at, a chunk a frame so the page stays alive, then the
 * player's own from there. Written at every ride card, on pause, on leaving
 * to the landing and every half minute of play; gone when the run ends.
 * Solo only.
 */

export function saveRun(session: Session): void {
  const sim = session.scene.sim;
  if (
    !session.ticks.local ||
    session.devRun ||
    session.tutorialRun ||
    sim.over ||
    sim.briefing ||
    session.resuming ||
    session.saving
  )
    return;
  session.saving = true;
  const bytes = session.inputLog.toBytes();
  const ticks = session.inputLog.ticks;
  void (async () => {
    try {
      const packed = await gzip(bytes);
      const s: save.SavedRun = {
        seed: sim.runSeed,
        daily: session.dailyDate,
        ticks,
        log: toBase64(packed),
        ride: sim.ride,
        station: sim.station,
        dest: sim.destStation,
        seconds: Math.round((sim.gameNow - sim.runWallStart) / 1000),
        build: __BUILD_SHA__,
        savedAt: Date.now(),
      };
      save.saveRunLocal(s);
      await account.putSave(s);
    } catch (err) {
      console.warn('[tunnelbana] could not save the run:', err);
    } finally {
      session.saving = false;
    }
  })();
}

/** the run ended, or another began: nothing to come back to */
export function clearSavedRun(session: Session): void {
  save.clearRunLocal();
  void account.clearSave();
  session.menu?.setState({ saved: null });
}

/** the saved run, this browser's first and the account's after */
export async function findSavedRun(): Promise<save.SavedRun | null> {
  return save.loadRunLocal() ?? (await account.getSave());
}

/** pick the saved run back up: the same seed, the inputs replayed, or a
 * run file from the debug panel (dev/runFile.ts), which is never saved over
 * the player's own */
export async function resumeSaved(session: Session, given?: save.SavedRun): Promise<void> {
  const s = given ?? (await findSavedRun());
  if (!s) {
    session.menu?.setState({ saved: null });
    return;
  }
  // A SAVE IS A SEED AND A LOG, replayed. Replayed by another build of the
  // sim it is another run, every rule that changed between the two builds
  // changes where you end up, so it is not offered (the landing says so)
  if (!given && s.build !== __BUILD_SHA__) {
    session.scene.hostMsg('That run was saved by an older build and cannot be continued.');
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = await gunzip(fromBase64(s.log));
  } catch (err) {
    console.warn('[tunnelbana] the saved run could not be read:', err);
    if (!given) clearSavedRun(session);
    return;
  }
  const scene = session.scene;
  session.menu?.hide();
  scene.input.keyboard!.enabled = true;
  scene.sim.seedPinned = true;
  scene.sim.runSeed = s.seed >>> 0;
  session.dailyDate = s.daily;
  session.devRun = !!given;
  session.newRun();
  session.beginRun();
  session.inputLog.load(bytes);
  session.resume = { queue: InputLog.decode(bytes, 1).map((row) => row[0]), at: 0 };
  showResumeBar(s.station, s.dest);
  resumeStartedAt = performance.now();
}
let resumeStartedAt = 0;

/**
 * A chunk of the replay each frame, as much as fits in `budgetMs` of wall
 * time; true while there is more to replay. Time-boxed rather than a fixed
 * count so the bar moves several times a second whatever a tick costs.
 */
export function resumeFrame(session: Session, budgetMs = 110): boolean {
  const r = session.resume;
  if (!r) return false;
  const sim = session.scene.sim;
  const t0 = performance.now();
  const from = r.at;
  while (r.at < r.queue.length && !sim.over) {
    sim.runTickWith([r.queue[r.at]]);
    r.at += 1;
    if ((r.at - from) % 50 === 0 && performance.now() - t0 > budgetMs) break;
  }
  // the replay's effects are nobody's to see: they would pile up unread
  sim.fx.length = 0;
  const elapsed = (performance.now() - resumeStartedAt) / 1000;
  const rate = r.at > 0 ? elapsed / r.at : 0;
  setResumeProgress(r.at / r.queue.length, r.at > 600 ? rate * (r.queue.length - r.at) : null);
  if (r.at >= r.queue.length || sim.over) {
    session.resume = null;
    hideResumeBar();
    // the local clock counts on from where the replay left the sim
    session.useLocalTicks();
    session.lastAutosave = performance.now();
    session.scene.hostMsg(`Back on the line: ride ${sim.ride + 1}, get to ${sim.destStation}!`);
    // what this run had banked goes on the daily's board (runOver.ts postBanked)
    postBanked(session);
    return false;
  }
  return true;
}

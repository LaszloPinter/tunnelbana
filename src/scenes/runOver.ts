import { gzip, toBase64 } from '../sim/inputLog.ts';
import { punctuality, lateness, GRACE, type RunResult } from '../sim/score.ts';
import { finalScore } from '../sim/chain.ts';
import { clock } from '../core/schedule.ts';
import * as account from '../net/account.ts';
import * as save from '../save.ts';
import type { Session } from './session.ts';
import { showRunOverScreen } from '../ui/dom/runOverScreen.ts';
import { myLook } from '../render/look.ts';
import { track } from '../net/track.ts';

/** the end of a run: the verdict on screen, the score to the board, the
 * result into this browser's book */
/**
 * Send the run to the board, with the inputs that produced it. Fire and
 * forget: the run-over screen must not wait on a network. ONLY THE DAILY
 * IS RANKED, quick play deals a different journey every time, so its
 * scores are not comparable and a board of them would rank luck.
 */
function postScore(session: Session, result: RunResult, score: number) {
  if (!session.ticks.local || !session.dailyDate || session.devRun) return;
  const date = session.dailyDate;
  const sim = session.scene.sim;
  void (async () => {
    let log: { ticks: number; base64: string } | undefined;
    try {
      const packed = await gzip(session.inputLog.toBytes());
      log = { ticks: session.inputLog.ticks, base64: toBase64(packed) };
    } catch {
      // no log is better than no score
    }
    const posted = await account.submit({
      mode: 'daily',
      date,
      seed: sim.runSeed,
      score,
      kr: Math.max(0, Math.round(sim.me.money)),
      stops: sim.stopsTotal,
      kills: result.kills,
      bosses: sim.bossKills,
      seconds: result.seconds,
      won: sim.ride > 0,
      log,
    });
    if (posted) track('daily-submitted');
    if (posted && session.dailyDate) session.menu?.setState({ dailyDone: session.dailyDoneToday() });
  })();
}

/**
 * A RIDE BANKED IS ON THE BOARD AT ONCE. What is banked can never be taken
 * from you, so it goes up the moment it is banked, not only when the run
 * ends: a daily died in once and then ridden well showed its 0 all day,
 * because the good run was still going (from play 2026-10-13). The board's
 * ratchet takes only an improvement, so posting more often costs nothing.
 */
export function postBanked(session: Session) {
  const sim = session.scene.sim;
  if (sim.over || sim.banked <= 0) return;
  const result: RunResult = {
    outcome: 'extract',
    kr: sim.me.money,
    stops: sim.stopsTraveled,
    kills: sim.players.reduce((a, p) => a + p.kills, 0),
    bosses: sim.bossKills,
    seconds: Math.round((sim.gameNow - sim.runWallStart) / 1000),
  };
  postScore(session, result, finalScore(sim, sim.gameNow));
}

/** the run-over overlay, from the sim's verdict */
export function showRunOver(session: Session) {
  const scene = session.scene;
  const sim = scene.sim;
  const over = sim.over;
  if (!over || scene.runOver) return;
  // nothing to come back to: a run that ended is not a run in progress
  session.clearSavedRun();
  const secs = Math.round((sim.gameNow - sim.runWallStart) / 1000);
  const kills = sim.players.reduce((a, p) => a + p.kills, 0);
  const result: RunResult = {
    outcome: over.kind,
    kr: sim.me.money,
    stops: sim.stopsTraveled,
    kills,
    bosses: sim.bossKills,
    seconds: secs,
    scheduledS: sim.rideScheduleS || undefined,
  };
  const score = finalScore(sim, sim.gameNow);
  const rideSecs = Math.round((sim.gameNow - sim.rideStart) / 1000);
  const schedS = sim.rideScheduleS;
  const fare = schedS > 0 ? punctuality(schedS, rideSecs) : 1;
  // the timetable line for the ride in progress: what the trains would have
  // taken, and what you did
  const clockLine =
    schedS > 0
      ? `this ride: timetable ${clock(schedS)} · you ${clock(rideSecs)}` +
        (rideSecs > schedS * GRACE
          ? ` · ${lateness(schedS, rideSecs)} · fare ×${fare.toFixed(2)}`
          : ' · on time')
      : `${secs}s`;
  postScore(session, result, score);
  // Solo only: a room's result is four people's and belongs to a
  // leaderboard, not to one browser.
  if (session.ticks.local) {
    session.saved = save.recordRun({
      daily: session.dailyDate,
      stops: sim.stopsTotal,
      kills,
      seconds: secs,
      won: sim.ride > 0,
    });
  }
  // THE END, AS A PAGE (ui/dom/runOverScreen.ts): who you are, what it was
  // worth and what now, it used to be three lines of monospace and "click
  // to start a new run" (from the alpha UX pass, 2026-09-30). The scene
  // still holds one invisible object for it, so everything that asks "is
  // the run-over up?" and every restart that clears it works as before.
  const name = session.saved.prefs.playerName || 'You';
  const ranked = !!session.dailyDate && session.ticks.local && !session.devRun;
  const dom = showRunOverScreen({
    kind: over.kind,
    reason: over.reason,
    name,
    look: myLook(
      () => save.load().prefs.look,
      (look) => save.savePrefs({ look }),
    ),
    score,
    banked: sim.banked,
    rides: sim.rides.map((r) => ({ from: r.from, to: r.to, worth: r.worth })),
    ride: sim.ride,
    stops: sim.stopsTotal,
    kills,
    kr: Math.round(sim.me.money),
    level: sim.party.level,
    seconds: secs,
    crowns: sim.bossKills,
    // "on time" means nothing to someone who did not arrive
    clockLine: schedS > 0 && over.kind !== 'died' ? clockLine : '',
    ranked,
    daily: session.dailyDate,
    onAgain: () => {
      if (session.ticks.local) session.newRun();
    },
    onLanding: () => {
      if (!session.ticks.local) return;
      session.newRun();
      session.showLanding();
    },
  });
  scene.uiMode = true;
  const holder = scene.add.rectangle(0, 0, 1, 1, 0, 0).setScrollFactor(0);
  holder.once('destroy', () => dom.remove());
  scene.runOver = [holder];
  scene.uiMode = false;
}

import { asStation } from '../sim/place.ts';
import type { Run } from '../sim/run.ts';
import * as save from '../save.ts';

/**
 * WHAT THE GUIDE KNOWS ABOUT YOU: whether it is on, and what you have
 * already done once. "The player is new to this game but not mentally
 * challenged" (from play 2026-10-16): once you have picked up kronor, a
 * machine has topped you up, you have boarded a train and banked a ride,
 * the guide stops pointing at that, in this browser, for good.
 */
export type Lesson = 'move' | 'coin' | 'machine' | 'board' | 'exit';

const prefs = save.load().prefs;
export const guideState = {
  on: prefs.guide,
  learned: new Set<string>(prefs.guideLearned ?? []),
};

/** the HUD's GUIDE button and G both land here */
export function setGuide(on: boolean) {
  guideState.on = on;
  save.savePrefs({ guide: on });
  for (const f of listeners) f(on);
}
const listeners: ((on: boolean) => void)[] = [];
export function onGuideChange(f: (on: boolean) => void) {
  listeners.push(f);
}

export function knows(k: Lesson): boolean {
  return guideState.learned.has(k);
}

function learn(k: Lesson) {
  if (guideState.learned.has(k)) return;
  guideState.learned.add(k);
  save.savePrefs({ guideLearned: [...guideState.learned] });
}

let lastMoney: number | null = null;
/** when the player last pushed to move (wall time: this is presentation) */
let lastMoveAt = performance.now();
/** this long standing still, and the guide shows the controls again */
const IDLE_MS = 6000;

/**
 * THE CONTROLS, SHOWN when they are wanted: a player who has not moved yet,
 * or has stood still a while on foot. Keys and a mouse on a desk, the two
 * thumb zones on a phone (ui/dom/controlsHint.ts). This replaces the
 * tutorial (from play 2026-10-16: "remove the tutorial altogether and merge
 * it with the guide").
 */
export function wantsControls(sim: Run): boolean {
  const me = sim.me;
  if (!guideState.on || sim.over || sim.briefing || sim.pause || me.offer || !me.alive) return false;
  if (me.frame.kind !== 'world') return false;
  return !knows('move') || performance.now() - lastMoveAt > IDLE_MS;
}

/** once a frame: has the player just done one of the lessons? */
export function observeLessons(sim: Run) {
  const me = sim.me;
  if (sim.tutorial || !me.alive) {
    lastMoney = null;
    return;
  }
  if (me.input.mx !== 0 || me.input.my !== 0) {
    learn('move');
    lastMoveAt = performance.now();
  }
  // a held world (a pick, the pause) is not standing still
  if (sim.pause || me.offer || sim.briefing) lastMoveAt = performance.now();
  if (me.frame.kind === 'aboard') learn('board');
  if (sim.ride > 0) learn('exit');
  // a pack bought anywhere live: the machine counts its sales
  for (const id of sim.live) {
    const st = asStation(sim.places.get(id));
    if (st && st.manaBuysHere > 0) learn('machine');
  }
  // money that went UP while walking about is kronor picked up
  if (lastMoney !== null && me.money > lastMoney && me.frame.kind === 'world') learn('coin');
  lastMoney = me.money;
}

import type Phaser from 'phaser';
import * as C from '../config.ts';
import { fromPlatform, onPlatform } from '../world/floor.ts';
import { aboardPoint } from '../world/trainSeat.ts';
import { journeyById } from '../core/fleet.ts';
import { asStation } from '../sim/place.ts';
import { manaMax, maxHp } from '../sim/player.ts';
import type { Run } from '../sim/run.ts';
import type { Station } from '../sim/station.ts';
import { shortName } from '../core/network.ts';

/**
 * THE GUIDE: what to do next, pointed at in the world, all game long, not
 * once in a tutorial (from play 2026-10-15: casual players did not know what
 * to do, where to go, or that the machine was the answer to an empty bar).
 * One goal at a time, in the order a commuter would want it: get off where
 * you change, an EXIT at your stop, a machine when a bar runs low, the doors
 * of your train when it stands open, and otherwise the edge of your track.
 * A ring on the goal, an arrow from you toward it, and one short line.
 * G turns it off and on, and the choice is kept (save.ts prefs.guide).
 *
 * Presentation only: it reads the run and never writes to it.
 */
export interface GuideGoal {
  /** where to go, on the map; null for a tip with nowhere to point */
  at: { x: number; y: number } | null;
  tip: string;
}

/** a bar under this share points at its machine */
const LOW = 0.3;

export function guideGoal(sim: Run): GuideGoal | null {
  const me = sim.me;
  if (!me.alive || me.downed || sim.over || sim.briefing || sim.tutorial || me.offer || sim.pause)
    return null;
  const st = asStation(sim.places.get(me.placeId));
  const leg = sim.route[0];
  const atGoal = st?.name === sim.destStation;
  // ABOARD: stay on, or get off
  if (me.frame.kind === 'aboard') {
    const rail = st?.rails[me.frame.ti];
    const standing = rail?.train.phase === 'dwell' && rail.train.doorsOpen;
    if (atGoal)
      return {
        at: null,
        tip: standing ? 'Your stop! Get off and find an EXIT' : `Next: ${sim.destStation}, your stop`,
      };
    const j = me.frame.jid ? journeyById(me.frame.jid) : undefined;
    const rightTrain = !!j && !!leg && j.service.id === leg.service.id && j.dir === leg.dir;
    if (standing && !rightTrain && leg)
      return { at: null, tip: `Get off here: change to the ${leg.service.id} → ${shortName(leg.to)}` };
    return { at: null, tip: leg ? `Ride on toward ${leg.to}` : `Ride on toward ${sim.destStation}` };
  }
  if (!st) return { at: null, tip: `Follow the tunnel to ${leg?.to ?? sim.destStation}` };
  const l = onPlatform(st, me.x, me.y);
  const island = l ? st.platformAt(l.y) : -1;
  const nearestOn = (list: { x: number; y: number }[]) => {
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (const f of list) {
      // on your own island first: nobody crosses the tracks for a machine
      const other = island >= 0 && st.platformAt(f.y) !== island ? C.M(200) : 0;
      const d = (l ? Math.abs(f.x - l.x) + Math.abs(f.y - l.y) : 0) + other;
      if (d < bd) {
        bd = d;
        best = fromPlatform(st, f.x, f.y);
      }
    }
    return best;
  };
  // YOUR STOP: an EXIT banks the ride
  if (atGoal) {
    const exit = nearestOn(st.escalators);
    return { at: exit, tip: 'Your stop: go to an EXIT and press E to bank the ride' };
  }
  // A BAR RUNNING LOW, and money to fix it
  if (me.health < maxHp(me) * LOW && me.money >= 30 && st.healthMachines.length > 0)
    return { at: nearestOn(st.healthMachines), tip: 'Low health: run past the HEALTH machine' };
  if (me.mana < manaMax(sim.party, me) * LOW && me.money >= 20 && st.manaMachines.length > 0)
    return { at: nearestOn(st.manaMachines), tip: 'Low mana: run past the MANA machine' };
  // KRONOR ON THE FLOOR, on the first ride while the pocket is light: "is
  // the yellow dot money?" (from play 2026-10-15)
  if (sim.ride === 0 && me.money < 40) {
    let coin: { x: number; y: number } | null = null;
    let cd = C.M(10);
    for (const c of st.coins) {
      if (c.frame !== 'world') continue;
      const d = Math.hypot(c.x - me.x, c.y - me.y);
      if (d < cd) {
        cd = d;
        coin = { x: c.x, y: c.y };
      }
    }
    if (coin) return { at: coin, tip: 'Yellow dots are kronor: walk over them to pick them up' };
  }
  if (!leg) return null;
  const ti = st.rails.findIndex((r) =>
    r.options.some((o) => o.service.id === leg.service.id && o.dir === leg.dir),
  );
  if (ti < 0) return null;
  const rail = st.rails[ti];
  const jid = rail.journey;
  const ours = jid ? journeyById(jid) : undefined;
  // YOUR TRAIN, STANDING OPEN: its nearest doorway
  if (
    jid &&
    ours &&
    ours.service.id === leg.service.id &&
    rail.train.phase === 'dwell' &&
    rail.train.doorsOpen
  ) {
    const door = nearestDoor(st, ti, jid, me.x, me.y, sim.gameNow);
    if (door) return { at: door, tip: `Board! The ${leg.service.id} takes you toward ${leg.to}` };
  }
  // otherwise the edge of your track, beside you
  const pf = st.platforms.findIndex((p) => p.railTop === ti || p.railBottom === ti);
  const plat = st.platforms[pf];
  if (!plat || !l) return null;
  const edgeY = plat.railTop === ti ? plat.top + C.M(1.5) : plat.bottom - C.M(1.5);
  const x = Math.max(st.platformX0 + C.M(6), Math.min(st.platformX1 - C.M(6), l.x));
  const fight = st.enemies.some((e) => e.hp > 0);
  return {
    at: fromPlatform(st, x, edgeY),
    tip: `Your train stops here: the ${leg.service.id} → ${shortName(rail.options.find((o) => o.service.id === leg.service.id)?.terminus ?? leg.to)}${fight ? '. Fight while you wait' : ''}`,
  };
}

/** the doorway of the train on track `ti` nearest a point, a step out on the platform */
function nearestDoor(st: Station, ti: number, jid: string, x: number, y: number, now: number) {
  const t = st.rails[ti].train;
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (const d of t.doors) {
    const p = aboardPoint(jid, (d.x0 + d.x1) / 2, 0, now);
    if (!p) continue;
    const dd = Math.abs(p.x - x) + Math.abs(p.y - y);
    if (dd < bd) {
      bd = dd;
      best = p;
    }
  }
  return best;
}

/** the guide's pictures: a ring on the goal, an arrow at your feet, a line of text */
export class GuideView {
  private readonly ring: Phaser.GameObjects.Arc;
  private readonly arrow: Phaser.GameObjects.Triangle;
  private readonly tip: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene & { uiMode: boolean }, tipY: number, width: number) {
    this.ring = scene.add
      .circle(0, 0, C.M(1.3), 0x8ef0a8, 0.001)
      .setStrokeStyle(3, 0x8ef0a8, 0.85)
      .setDepth(6.4)
      .setVisible(false);
    this.arrow = scene.add
      .triangle(0, 0, 0, -C.M(0.45), C.M(0.9), 0, 0, C.M(0.45), 0x8ef0a8, 0.85)
      .setDepth(6.4)
      .setVisible(false);
    scene.uiMode = true;
    this.tip = scene.add
      .text(width / 2, tipY, '', {
        fontFamily: 'Barlow, Helvetica, Arial, sans-serif',
        fontSize: '19px',
        color: '#d9ffe4',
        backgroundColor: 'rgba(8, 14, 12, 0.72)',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(1000)
      .setVisible(false);
    scene.uiMode = false;
  }

  draw(goal: GuideGoal | null, from: { x: number; y: number }, wallNow: number) {
    const at = goal?.at ?? null;
    this.ring.setVisible(!!at);
    this.tip.setVisible(!!goal);
    if (goal && this.tip.text !== goal.tip) this.tip.setText(goal.tip);
    if (at) this.ring.setPosition(at.x, at.y).setScale(1 + 0.12 * Math.sin(wallNow / 170));
    // the arrow at your feet, pointing the way, while the goal is a few steps off
    const dx = at ? at.x - from.x : 0;
    const dy = at ? at.y - from.y : 0;
    const d = Math.sqrt(dx * dx + dy * dy);
    const show = !!at && d > C.M(4);
    this.arrow.setVisible(show);
    if (show) {
      const k = C.M(2.2) / d;
      this.arrow
        .setPosition(from.x + dx * k, from.y + dy * k)
        .setRotation(Math.atan2(dy, dx))
        .setAlpha(0.65 + 0.3 * Math.sin(wallNow / 200));
    }
  }

  hide() {
    this.ring.setVisible(false);
    this.arrow.setVisible(false);
    this.tip.setVisible(false);
  }
}

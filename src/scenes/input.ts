import Phaser from 'phaser';
import * as C from '../config.ts';
import { BTN, CHOICE, InputEdges, isSwapChoice, type TickInput } from '../sim/tick.ts';
import type { Controls } from '../sim/ticks.ts';
import type { Player } from '../sim/player.ts';
import { isTouchDevice, takeTap, touch } from '../ui/dom/touch.ts';
import { autoAimTarget } from './autoAim.ts';
import type { Device } from '../ui/dom/tutorialStages.ts';
import type { Run } from '../sim/run.ts';

// single source of truth for keys: the type AND the addKeys() call derive from
// this list, so they can never drift apart again
const KEY_NAMES = [
  'W',
  'A',
  'S',
  'D',
  'SPACE',
  'ESC',
  'ONE',
  'TWO',
  'THREE',
  'E',
  'Q',
  'Z',
  'X',
  'V',
  'B',
  'TAB',
  'P',
  'R',
  'F',
  'G',
  'C',
  'J',
  'L',
  'ENTER',
] as const;
export type KeyName = (typeof KEY_NAMES)[number];

/** what the sampler needs of the scene: its keyboard, and the pointer in world space */
export interface InputScene extends Phaser.Scene {
  pointerWorld(): Phaser.Math.Vector2;
  /** how far the view is turned, so a push can be turned the same way */
  viewAngle(): number;
  /** where the local body stands: a stick aims from there */
  playerWorld(): { x: number; y: number };
  /** the run, for a phone's automatic aim (scenes/autoAim.ts) */
  readonly sim: Run;
}

/** the pad's buttons that mean something here, by the standard mapping's index */
const PAD_BUTTON = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  L1: 4,
  R1: 5,
  back: 8,
  start: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;
export type PadName = keyof typeof PAD_BUTTON;

/** what a pad is doing this frame, deadzoned */
interface PadState {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  /** the triggers, past a third of their travel */
  fire: boolean;
  stot: boolean;
  down: Record<PadName, boolean>;
}
const DEADZONE = 0.2;
/** how far from the body the right stick puts the aim */
const STICK_AIM = C.M(7);

/**
 * THE ONE PLACE THE KEYBOARD AND MOUSE ARE READ. Solo derives the per-tick
 * edges from it locally, a room sends the raw controls and lets the room
 * derive them. It used to be written out twice, once per branch of the
 * update loop, and the two had already drifted.
 */
export class InputSampler {
  private readonly keys: Record<KeyName, Phaser.Input.Keyboard.Key>;
  edges = new InputEdges();
  /** the local seat's pick, waiting for the next tick to carry it */
  private pendingChoice = 0;

  constructor(private readonly scene: InputScene) {
    this.keys = scene.input.keyboard!.addKeys(KEY_NAMES.join(',')) as Record<
      KeyName,
      Phaser.Input.Keyboard.Key
    >;
  }

  isDown(name: KeyName): boolean {
    return this.keys[name].isDown;
  }

  // ---- the pad ----
  private padNow: PadState | null = null;
  private padWas: PadState | null = null;
  private lastDevice: Device = isTouchDevice() ? 'touch' : 'keys';
  /** the weapon the touch swap button last chose: the bolt (1) or the torrent (2) */
  private touchWeapon = 1;
  private touchSwapWas = false;
  /** where the right stick last pointed, in the world; kept while it rests */
  private padAim: { x: number; y: number } | null = null;
  private lastPtr = { x: 0, y: 0 };

  /**
   * ONCE A FRAME, before the ticks: what the pad is doing, and whether it
   * was the last thing touched. Edges (padJustDown) are per frame like the
   * keyboard's JustDown; the held state goes into every tick's bits.
   */
  pollPad() {
    this.padWas = this.padNow;
    const gp = this.scene.input.gamepad;
    const pad = gp && gp.total > 0 ? gp.getPad(0) : undefined;
    if (!pad || !pad.connected) {
      this.padNow = null;
      return;
    }
    const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : v);
    const btn = (i: number) => pad.buttons[i];
    const down = {} as Record<PadName, boolean>;
    for (const name of Object.keys(PAD_BUTTON) as PadName[]) down[name] = !!btn(PAD_BUTTON[name])?.pressed;
    const trigger = (i: number) => (btn(i)?.value ?? 0) > 0.3 || !!btn(i)?.pressed;
    this.padNow = {
      lx: dz(pad.leftStick.x),
      ly: dz(pad.leftStick.y),
      rx: dz(pad.rightStick.x),
      ry: dz(pad.rightStick.y),
      fire: trigger(7),
      stot: trigger(6),
      down,
    };
    const p = this.padNow;
    const touched =
      p.lx !== 0 ||
      p.ly !== 0 ||
      p.rx !== 0 ||
      p.ry !== 0 ||
      p.fire ||
      p.stot ||
      Object.values(down).some(Boolean);
    if (touched) this.lastDevice = 'pad';
  }

  padJustDown(name: PadName): boolean {
    // the touch pause button is a pad's start (ui/dom/touch.ts)
    if (name === 'start' && takeTap('pause')) return true;
    // ...and its MENU a pad's back: to the landing, the run saved
    if (name === 'back' && takeTap('menu')) return true;
    return !!this.padNow?.down[name] && !this.padWas?.down[name];
  }
  padHeld(name: PadName): boolean {
    // ...and the touch CARD button a pad's Y
    if (name === 'Y' && touch.card) return true;
    return !!this.padNow?.down[name];
  }

  /** which device was touched last: keys and mouse, or a pad */
  get device(): Device {
    return this.lastDevice;
  }
  /** the pad's sticks, when one is in hand */
  get pad(): { lx: number; ly: number; rx: number; ry: number } | undefined {
    const p = this.padNow;
    return p ? { lx: p.lx, ly: p.ly, rx: p.rx, ry: p.ry } : undefined;
  }

  justDown(name: KeyName): boolean {
    return Phaser.Input.Keyboard.JustDown(this.keys[name]);
  }

  /**
   * What this seat is physically doing, right now, SAID IN THE FRAME OF THE
   * PLACE THEY ARE IN.
   *
   * Keys and the cursor are facts about a screen, and the screen shows one
   * chart of a chain of places whose axes need not agree (scenes/worldChart.ts
   * `chart`). The simulation has no screen and must not learn of one, so the
   * turn happens here, once, before the input becomes a tick: screen-right
   * becomes +x or −x of the room the seat is standing in. This is what used
   * to be a control mapping buried in the corridor walker.
   *
   * Aim is ROUNDED: the input log stores it as int32 (§11c wire format), so a
   * replay of a run's own log must see what the live run saw.
   */
  readControls(): Controls {
    const k = this.keys;
    const pointer = this.scene.input.activePointer;
    let held = 0;
    if (pointer.leftButtonDown()) held |= BTN.fire;
    if (pointer.rightButtonDown()) held |= BTN.shield;
    if (k.SPACE.isDown) held |= BTN.dash;
    if (k.E.isDown) held |= BTN.use;
    if (k.Q.isDown) held |= BTN.ult;
    if (k.Z.isDown) held |= BTN.pingHere;
    if (k.X.isDown) held |= BTN.pingTrain;
    if (k.V.isDown) held |= BTN.pingHelp;
    if (k.B.isDown) held |= BTN.pingWait;
    // 2 is the bolt and 3 the torrent, nearer the hand on WASD than 1 was
    // (the user's call, 2026-09-25, reversing the morning's 1/2); 1 stays a
    // bolt so an old habit is not a dead key
    if (k.ONE.isDown || k.TWO.isDown) held |= BTN.weapon1;
    if (k.THREE.isDown) held |= BTN.weapon2;
    let mx = (k.D.isDown ? 1 : 0) - (k.A.isDown ? 1 : 0);
    let my = (k.S.isDown ? 1 : 0) - (k.W.isDown ? 1 : 0);
    // the keys and the mouse, when touched, take the picture back from the pad
    const ptrMoved = pointer.x !== this.lastPtr.x || pointer.y !== this.lastPtr.y;
    this.lastPtr = { x: pointer.x, y: pointer.y };
    // (a finger on a phone moves the pointer too: that is not the keyboard)
    if (held !== 0 || mx !== 0 || my !== 0 || (ptrMoved && !touch.active)) this.lastDevice = 'keys';
    // THE PAD, on top: a trigger casts, the left stick walks at the pace it
    // is pushed, the right stick aims from the body. Its bits are the same
    // bits, so the sim, the log and the tutorial never learn which it was.
    const pad = this.padNow;
    if (pad) {
      if (pad.fire) held |= BTN.fire;
      if (pad.stot) held |= BTN.ult;
      if (pad.down.A) held |= BTN.dash;
      if (pad.down.X) held |= BTN.use;
      if (pad.down.L1) held |= BTN.weapon1;
      if (pad.down.R1) held |= BTN.weapon2;
      if (mx === 0 && my === 0) {
        mx = pad.lx;
        my = pad.ly;
      }
    }
    // TOUCH (ui/dom/touch.ts): the same bits again. The swap button flips
    // between the bolt and the torrent; casting is automatic (autoAim.ts)
    let auto: { x: number; y: number } | null = null;
    if (touch.active) {
      if (touch.dash) held |= BTN.dash;
      if (touch.stot) held |= BTN.ult;
      if (touch.use) held |= BTN.use;
      if (touch.swap && !this.touchSwapWas) this.touchWeapon = this.touchWeapon === 1 ? 2 : 1;
      this.touchSwapWas = touch.swap;
      if (touch.swap) held |= this.touchWeapon === 1 ? BTN.weapon1 : BTN.weapon2;
      if (mx === 0 && my === 0 && (touch.mx !== 0 || touch.my !== 0)) {
        mx = touch.mx;
        my = touch.my;
        this.lastDevice = 'touch';
      }
      auto = autoAimTarget(this.scene.sim);
      if (auto) held |= BTN.fire;
      if (touch.dash || touch.stot || touch.use || touch.swap) this.lastDevice = 'touch';
    }
    // THE KEYS MEAN WHAT THEY LOOK LIKE. The camera turns with the world so
    // the platform you are on lies across the screen, and W is toward the
    // top of the screen whatever bearing that is in Stockholm, so a push
    // is turned by exactly the angle the view is turned.
    const a = this.scene.viewAngle();
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    if (pad && (pad.rx !== 0 || pad.ry !== 0)) {
      const me = this.scene.playerWorld();
      this.padAim = {
        x: me.x + (pad.rx * cos - pad.ry * sin) * STICK_AIM,
        y: me.y + (pad.rx * sin + pad.ry * cos) * STICK_AIM,
      };
    }
    const w = auto ?? (this.lastDevice === 'pad' && this.padAim ? this.padAim : this.scene.pointerWorld());
    return {
      held,
      mx: mx * cos - my * sin,
      my: mx * sin + my * cos,
      aimX: Math.round(w.x),
      aimY: Math.round(w.y),
    };
  }

  /** is a pick waiting to be carried? A paused run still lets one through */
  get hasChoice(): boolean {
    return this.pendingChoice !== 0;
  }

  /** the local seat's pick, if one is waiting; reading it clears it */
  takeChoice(): number {
    const choice = this.pendingChoice;
    this.pendingChoice = 0;
    return choice;
  }

  sampleInput(): TickInput {
    const c = this.readControls();
    return this.edges.sample(c.held, c.mx, c.my, c.aimX, c.aimY, this.takeChoice());
  }

  /** the local seat's pick: queued, and carried by the next tick */
  choose(me: Player, code: number) {
    // a reorder and a go between rides need no offer; everything else does
    if (!me.offer && !isSwapChoice(code) && code !== CHOICE.go) return;
    this.pendingChoice = code;
  }

  /** a fresh run: no edge and no pick may carry over */
  reset() {
    this.edges = new InputEdges();
    this.pendingChoice = 0;
  }
}

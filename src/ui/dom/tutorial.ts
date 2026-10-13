import './tutorial.css';
import { BTN, type TickInput } from '../../sim/tick.ts';
import type { Run } from '../../sim/run.ts';
import { TUTORIAL_TO } from '../../core/network.ts';
import { asStation } from '../../sim/place.ts';
import { fromPlatform } from '../../world/floor.ts';
import { STAGES, type Device } from './tutorialStages.ts';

/**
 * THE TUTORIAL: eight things to do, each finished by DOING it. The overlay
 * never reads the keyboard for itself, the scene hands it every tick's
 * input, the same bits the simulation runs on, so a stage is done exactly
 * when the game saw the key, on whatever device sent it. The pictures
 * (keycaps, a nudging mouse, a stick) are for whichever device was touched
 * last. It lives in DOM over the canvas, like the landing, so the caps and
 * the mouse can be styled and animated without touching the renderer.
 *
 * The run underneath is the tutorial run (sim/run.ts `tutorial`): no horde,
 * no dark, one stop to ride. Skipping and finishing both mark the tutorial
 * done for this browser (save.ts prefs) and return to the landing.
 */

export type { Device } from './tutorialStages.ts';

/** what the scene reports each tick */
export interface TutorialTick {
  input: TickInput;
  keyDown: (k: 'W' | 'A' | 'S' | 'D') => boolean;
  /** how far the pointer travelled since the last tick, in screen px */
  pointerMoved: number;
  device: Device;
  /** the sticks, if a pad is in hand: left and right, each -1..1 */
  pad?: { lx: number; ly: number; rx: number; ry: number };
  sim: Run;
}

interface Cap {
  el: HTMLDivElement;
  done: boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const MOUSE_SVG = `<svg viewBox="0 0 110 170" width="110" height="170" xmlns="http://www.w3.org/2000/svg">
  <rect x="6" y="6" width="98" height="158" rx="46" fill="rgba(7,10,17,0.8)" stroke="#edf1f7" stroke-width="3"/>
  <path class="btn" d="M6 52 A46 46 0 0 1 55 6 L55 66 L6 66 Z" stroke="#edf1f7" stroke-width="3"/>
  <line x1="55" y1="6" x2="55" y2="66" stroke="#edf1f7" stroke-width="3"/>
  <line x1="6" y1="66" x2="104" y2="66" stroke="#edf1f7" stroke-width="3"/>
  <rect x="50" y="24" width="10" height="24" rx="5" fill="#edf1f7"/>
</svg>`;

const STICK_SVG = `<svg viewBox="0 0 120 120" width="120" height="120" xmlns="http://www.w3.org/2000/svg">
  <circle cx="60" cy="60" r="54" fill="rgba(7,10,17,0.8)" stroke="#edf1f7" stroke-width="3"/>
  <circle class="btn" cx="60" cy="60" r="26" stroke="#edf1f7" stroke-width="3"/>
</svg>`;

export class Tutorial {
  /** a point in the world to ring, the mana machine, while that is the lesson */
  marker: { x: number; y: number } | null = null;
  private readonly root: HTMLDivElement;
  private readonly stageNo: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly keys: HTMLDivElement;
  private readonly side: HTMLDivElement;
  private readonly doneFlash: HTMLDivElement;
  private caps: Cap[] = [];
  private stage = 0;
  private device: Device = 'keys';
  /** a stage just finished: shown ticked for a beat before the next */
  private flashUntil = 0;
  private finished = false;
  // per-stage progress
  private pointerTravel = 0;
  private aimed = false;
  private fired = false;
  private cast1 = false;
  private cast2 = false;
  private rideNote = '';

  constructor(private readonly on: { onSkip(): void; onDone(): void; onReady(): void }) {
    this.root = el('div');
    this.root.id = 'tb-tutorial';
    const top = el('div', 'tb-tut-top');
    this.stageNo = el('div', 'tb-tut-stage');
    this.title = el('div', 'tb-tut-title');
    this.hint = el('div', 'tb-tut-hint');
    top.append(this.stageNo, this.title, this.hint);
    const skip = el('button', 'tb-tut-skip', 'Skip tutorial');
    skip.addEventListener('click', () => this.on.onSkip());
    // the keys and the mouse together, in the middle of the screen: they
    // were bottom-left and far right and had to be looked for (from play)
    const body = el('div', 'tb-tut-body');
    this.keys = el('div', 'tb-tut-keys');
    this.side = el('div', 'tb-tut-side');
    body.append(this.keys, this.side);
    this.doneFlash = el('div', 'tb-tut-done', '✓');
    this.root.append(top, skip, body, this.doneFlash);
    document.body.appendChild(this.root);
    this.layout();
  }

  /** the pictures for the current stage and device */
  private layout() {
    const st = STAGES[this.stage];
    this.stageNo.textContent = `TUTORIAL · ${this.stage + 1} / ${STAGES.length}`;
    this.title.textContent = st.title;
    this.hint.innerHTML = st.hint[this.device] + (this.rideNote ? `<br>${this.rideNote}` : '');
    this.keys.innerHTML = '';
    this.caps = [];
    const labels = st.caps[this.device];
    const grid = st.id === 'move' && this.device === 'keys';
    this.keys.classList.toggle('is-wide', !grid);
    for (const label of labels) {
      const cap = el(
        'div',
        'tb-keycap' + (label === '' ? ' is-empty' : label.length > 1 ? ' is-small' : ''),
        label,
      );
      this.keys.appendChild(cap);
      this.caps.push({ el: cap, done: false });
    }
    this.side.innerHTML = '';
    if (st.id === 'aim') {
      const pic = el('div', this.device === 'keys' ? 'tb-tut-mouse' : 'tb-tut-pad');
      pic.innerHTML = this.device === 'keys' ? MOUSE_SVG : STICK_SVG;
      this.side.appendChild(pic);
    }
  }

  private capByLabel(label: string): Cap | undefined {
    return this.caps.find((c) => c.el.textContent === label);
  }

  private light(label: string, down: boolean) {
    const c = this.capByLabel(label);
    if (!c) return;
    c.el.classList.toggle('is-lit', down);
    if (down && !c.done) {
      c.done = true;
      c.el.classList.add('is-done');
    }
  }

  private allCapsDone(): boolean {
    return this.caps.filter((c) => c.el.textContent !== '').every((c) => c.done);
  }

  /** one tick of the run, as the scene saw it */
  observe(t: TutorialTick) {
    if (this.finished) return;
    if (t.device !== this.device) {
      this.device = t.device;
      this.layout();
    }
    const now = performance.now();
    if (this.flashUntil > 0) {
      if (now < this.flashUntil) return;
      this.flashUntil = 0;
      this.doneFlash.classList.remove('is-on');
      this.stage += 1;
      this.layout();
      // the last stage: the train is called for now, so it arrives on cue
      if (STAGES[this.stage].id === 'ride') this.on.onReady();
    }
    const st = STAGES[this.stage];
    const pressed = t.input.pressed;
    let done = false;
    switch (st.id) {
      case 'move': {
        if (this.device === 'keys') {
          this.light('W', t.keyDown('W'));
          this.light('A', t.keyDown('A'));
          this.light('S', t.keyDown('S'));
          this.light('D', t.keyDown('D'));
        } else if (t.pad) {
          this.light('↑', t.pad.ly < -0.5);
          this.light('↓', t.pad.ly > 0.5);
          this.light('←', t.pad.lx < -0.5);
          this.light('→', t.pad.lx > 0.5);
        }
        done = this.allCapsDone();
        break;
      }
      case 'aim': {
        if (this.device === 'keys') {
          this.pointerTravel += t.pointerMoved;
          if (this.pointerTravel > 120) this.aimed = true;
        } else if (t.pad && Math.hypot(t.pad.rx, t.pad.ry) > 0.5) this.aimed = true;
        if (pressed & BTN.fire) this.fired = true;
        this.light('RT', (t.input.held & BTN.fire) !== 0);
        const pic = this.side.firstElementChild;
        if (pic && this.aimed && this.fired) pic.classList.add('is-done');
        done = this.aimed && this.fired;
        break;
      }
      case 'dash': {
        this.light(this.device === 'keys' ? 'SPACE' : 'A', (t.input.held & BTN.dash) !== 0);
        done = (pressed & BTN.dash) !== 0 || this.allCapsDone();
        break;
      }
      case 'casts': {
        if (pressed & BTN.weapon1) this.cast1 = true;
        if (pressed & (BTN.weapon2 | BTN.weapon3)) this.cast2 = true;
        this.light(this.device === 'keys' ? '2' : 'LB', (t.input.held & BTN.weapon1) !== 0);
        this.light(this.device === 'keys' ? '3' : 'RB', (t.input.held & (BTN.weapon2 | BTN.weapon3)) !== 0);
        done = this.cast1 && this.cast2;
        break;
      }
      case 'mana': {
        this.light(this.device === 'keys' ? 'E' : 'X', (t.input.held & BTN.use) !== 0);
        const here = asStation(t.sim.placeOf(t.sim.me));
        // ring the nearest machine, so "walk to it" points somewhere
        if (here && here.manaMachines.length > 0) {
          const me = t.sim.me;
          let best: { x: number; y: number } | null = null;
          let bd = Infinity;
          for (const m of here.manaMachines) {
            const at = fromPlatform(here, m.x, m.y);
            const d = Math.hypot(at.x - me.x, at.y - me.y);
            if (d < bd) {
              bd = d;
              best = at;
            }
          }
          this.marker = best;
        }
        done = !!here && here.manaBuysHere > 0;
        if (done) this.marker = null;
        break;
      }
      case 'stot': {
        this.light(this.device === 'keys' ? 'Q' : 'LT', (t.input.held & (BTN.ult | BTN.shield)) !== 0);
        done = (pressed & (BTN.ult | BTN.shield)) !== 0;
        break;
      }
      case 'ride': {
        const me = t.sim.me;
        const here = t.sim.here;
        let note = '';
        if (me.frame.kind === 'aboard') note = `Riding: next stop <b>${TUTORIAL_TO}</b>`;
        else {
          const st2 = asStation(here);
          const standing = st2?.rails.some(
            (r) => r.journey && r.train.phase === 'dwell' && r.train.doorsOpen,
          );
          if (standing) note = 'It is waiting for you: <b>walk in through the open doors</b>';
        }
        if (note !== this.rideNote) {
          this.rideNote = note;
          this.hint.innerHTML = st.hint[this.device] + (note ? `<br>${note}` : '');
        }
        // the lesson ends at the next station: getting off is the last one
        done = here.name === TUTORIAL_TO;
        break;
      }
      case 'exit': {
        this.light(this.device === 'keys' ? 'E' : 'X', (t.input.held & BTN.use) !== 0);
        // ring the way out, so "walk to the EXIT" points somewhere
        const st2 = asStation(t.sim.here);
        const me = t.sim.me;
        let best: { x: number; y: number } | null = null;
        let bd = Infinity;
        for (const e of st2?.escalators ?? []) {
          const at = fromPlatform(st2!, e.x, e.y);
          const d = Math.hypot(at.x - me.x, at.y - me.y);
          if (d < bd) {
            bd = d;
            best = at;
          }
        }
        this.marker = me.frame.kind === 'world' ? best : null;
        done = t.sim.over?.kind === 'win';
        if (done) this.marker = null;
        break;
      }
    }
    if (!done) return;
    if (this.stage === STAGES.length - 1) {
      this.finished = true;
      this.endCard();
      return;
    }
    this.doneFlash.classList.add('is-on');
    this.flashUntil = now + 700;
  }

  /** the run was won, pressed E at the exit, whatever stage the overlay thought it was on */
  finish() {
    if (this.finished) return;
    this.finished = true;
    this.marker = null;
    this.endCard();
  }

  /** the last thing: a title over the platform, then the landing */
  private endCard() {
    const card = el('div', 'tb-tut-end');
    const box = el('div', 'tb-tut-end-box');
    box.append(
      el('div', 'tb-tut-stage', 'TUTORIAL · DONE'),
      el('div', 'tb-tut-end-title', 'You know the way.'),
      el(
        'div',
        'tb-tut-hint',
        'That is the whole game: get where you are going. On a real platform the Tunnelfolk bite. Cast, dash, and never miss the last train.',
      ),
    );
    const go = el('button', 'tb-tut-skip tb-tut-go', 'To the departures ▸');
    go.addEventListener('click', () => this.on.onDone());
    box.appendChild(go);
    card.appendChild(box);
    this.root.replaceChildren(card);
    requestAnimationFrame(() => card.classList.add('is-on'));
    window.setTimeout(() => this.on.onDone(), 6000);
  }

  destroy() {
    this.root.remove();
  }
}

import './touch.css';

/**
 * TOUCH: the game on a phone (from play 2026-10-15: "This must be mobile. I
 * would play this during my commute."). A thumbstick that appears where the
 * left thumb lands, and a cluster of buttons under the right thumb. Casting
 * is automatic on a phone (scenes/input.ts autoAim): aiming a stream of
 * bolts with a thumb on glass is the hard part of a twin-stick, and it is
 * the part a commuter does not need.
 *
 * DOM over the canvas, like every other screen: a touch control is a solved
 * problem in HTML and a hand-rolled one in a canvas. It writes only to
 * `touch`, which the input sampler reads like a pad: the same bits, so the
 * simulation, the log and the replays never learn which it was.
 */
export interface TouchState {
  /** a thumb is on the glass, or was this session: the controls are up */
  active: boolean;
  /** the stick, in SCREEN axes, -1..1 */
  mx: number;
  my: number;
  /** the right thumb aiming: a direction in SCREEN axes, and whether it is down */
  aiming: boolean;
  ax: number;
  ay: number;
  dash: boolean;
  stot: boolean;
  use: boolean;
  swap: boolean;
  card: boolean;
  /** taps waiting to be read once: pause, and back to the landing */
  pause: boolean;
  menu: boolean;
}

export const touch: TouchState = {
  active: false,
  mx: 0,
  my: 0,
  aiming: false,
  ax: 0,
  ay: 0,
  dash: false,
  stot: false,
  use: false,
  swap: false,
  card: false,
  pause: false,
  menu: false,
};

/** a phone or a tablet: a coarse pointer and no hover */
export const isTouchDevice = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true || 'ontouchstart' in window);

const STICK_R = 56;

let root: HTMLDivElement | null = null;

/** put the controls on the page; they show only while a run is on screen */
export function installTouch() {
  if (root || !isTouchDevice()) return;
  touch.active = true;
  // pages can drop what only a keyboard or a pad can do (Enter, Esc)
  document.documentElement.classList.add('tb-touchdev');
  root = document.createElement('div');
  root.id = 'tb-touch';
  root.innerHTML = `
    <div class="tb-touch-stick-zone"><div class="tb-touch-base"><div class="tb-touch-knob"></div></div></div>
    <div class="tb-touch-aim-zone"><div class="tb-touch-base tb-aim-base"><div class="tb-touch-knob"></div></div></div>
    <div class="tb-touch-pad">
      <button class="tb-tb tb-tb-dash" data-k="dash">DASH</button>
      <button class="tb-tb tb-tb-stot" data-k="stot">STÖT</button>
      <button class="tb-tb tb-tb-use" data-k="use">E</button>
      <button class="tb-tb tb-tb-swap" data-k="swap">⇄</button>
    </div>
    <div class="tb-touch-top">
      <button class="tb-tb tb-tb-small" data-k="card">CARD</button>
      <button class="tb-tb tb-tb-small tb-tb-menu" data-tap="menu">MENU</button>
      <button class="tb-tb tb-tb-small" data-tap="pause">II</button>
    </div>
`;
  document.body.appendChild(root);

  // TWO THUMBS (from play 2026-10-16): the left half walks, the right half
  // aims and casts that way while held; let go, and casting is automatic again
  stick(root.querySelector('.tb-touch-stick-zone')!, (x, y) => {
    touch.mx = x;
    touch.my = y;
  });
  // (a tap is a tap: the aim thumb's dead zone is wide enough to land in)
  stick(
    root.querySelector('.tb-touch-aim-zone')!,
    (x, y, down) => {
      touch.aiming = down;
      touch.ax = x;
      touch.ay = y;
    },
    14,
  );

  // THE BUTTONS: held while a finger is on them
  for (const b of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-k]'))) {
    const k = b.dataset.k as 'dash' | 'stot' | 'use' | 'swap' | 'card';
    const on = (v: boolean) => {
      touch[k] = v;
      b.classList.toggle('is-down', v);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      on(true);
    });
    b.addEventListener('pointerup', () => on(false));
    b.addEventListener('pointercancel', () => on(false));
  }
  // PAUSED, a phone needs a way back to the landing (a keyboard's ESC):
  // MENU shows beside the pause button while the game is held by it
  let paused = false;
  for (const b of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tap]'))) {
    const k = b.dataset.tap as 'pause' | 'menu';
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      touch[k] = true;
      paused = k === 'pause' ? !paused : false;
      root!.classList.toggle('is-paused', paused);
    });
  }
  // no long-press menus or text selection on a phone held in both hands
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // ONLY OVER A RUN: the landing and the end screens are pages, with their own buttons
  const sync = () => {
    const menu = document.getElementById('tb-menu');
    const overPage = !!menu && !menu.hidden;
    root!.classList.toggle('is-hidden', overPage);
    if (overPage) {
      paused = false;
      root!.classList.remove('is-paused');
    }
    // the tutorial's SKIP sits where CARD and pause are
    root!.classList.toggle('is-tutorial', !!document.getElementById('tb-tutorial'));
  };
  sync();
  setInterval(sync, 250);
}

/** a finger's point in the turned stage's own axes (render/display.ts sideways) */
function stageOf(e: PointerEvent): { x: number; y: number } {
  return document.documentElement.classList.contains('tb-sideways')
    ? { x: e.clientY, y: window.innerWidth - e.clientX }
    : { x: e.clientX, y: e.clientY };
}

/** a thumbstick in `zone`, centred wherever the thumb lands */
function stick(zone: HTMLDivElement, out: (x: number, y: number, down: boolean) => void, dead = 6) {
  const base = zone.querySelector<HTMLDivElement>('.tb-touch-base')!;
  const knob = zone.querySelector<HTMLDivElement>('.tb-touch-knob')!;
  let id: number | null = null;
  let ox = 0;
  let oy = 0;
  const move = (e: PointerEvent) => {
    const p = stageOf(e);
    let dx = p.x - ox;
    let dy = p.y - oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      dx = (dx / d) * STICK_R;
      dy = (dy / d) * STICK_R;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // a small dead centre, and full speed well before the rim
    const k = Math.min(1, d / (STICK_R * 0.8));
    const m = d > dead ? k / (d || 1) : 0;
    out((p.x - ox) * m, (p.y - oy) * m, true);
  };
  zone.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    id = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    const p = stageOf(e);
    ox = p.x;
    oy = p.y;
    // (the base sits in the zone; the point is the stage's)
    base.style.left = `${ox - zone.offsetLeft}px`;
    base.style.top = `${oy - zone.offsetTop}px`;
    base.classList.add('is-on');
    move(e);
    goFullscreen();
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId === id) move(e);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    out(0, 0, false);
    knob.style.transform = '';
    base.classList.remove('is-on');
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}

/** read a tap once: true the first time after it happened */
export function takeTap(k: 'pause' | 'menu'): boolean {
  const v = touch[k];
  touch[k] = false;
  return v;
}

let triedFullscreen = false;
/** a phone's browser chrome eats a third of a landscape screen: ask it to go, once */
function goFullscreen() {
  if (triedFullscreen) return;
  triedFullscreen = true;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    const p = el.requestFullscreen?.({ navigationUI: 'hide' });
    void p
      ?.then(() =>
        (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })
          .lock?.('portrait-primary')
          .catch(() => {}),
      )
      .catch(() => {});
  } catch {
    // not offered here (iOS Safari): the home-screen app is the fullscreen one
  }
}

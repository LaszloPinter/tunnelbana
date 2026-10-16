import { guideState, onGuideChange, setGuide } from '../../scenes/guideState.ts';

/**
 * THE GUIDE'S SWITCH, on the screen (from play 2026-10-16: "there should be
 * something on the HUD to toggle the guidance"). G does the same on a
 * keyboard. Top right over a run; on a phone it joins CARD and pause.
 * Hidden over the landing and the end screens, and during the tutorial,
 * which is a guide of its own.
 */
export function installGuideButton() {
  if (document.getElementById('tb-guide-btn')) return;
  const b = document.createElement('button');
  b.id = 'tb-guide-btn';
  b.type = 'button';
  const paint = (on: boolean) => {
    b.textContent = on ? 'GUIDE ON' : 'GUIDE OFF';
    b.classList.toggle('is-off', !on);
  };
  paint(guideState.on);
  onGuideChange(paint);
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setGuide(!guideState.on);
  });
  // a phone: with the touch buttons, where the thumb already goes
  const placeIt = () => {
    const top = document.querySelector('#tb-touch .tb-touch-top');
    if (top && b.parentElement !== top) {
      top.prepend(b);
      b.classList.add('tb-tb', 'tb-tb-small', 'tb-tb-guide');
    } else if (!top && !b.parentElement) document.body.appendChild(b);
  };
  const sync = () => {
    placeIt();
    const menu = document.getElementById('tb-menu');
    const hide = (!!menu && !menu.hidden) || !!document.getElementById('tb-tutorial');
    b.style.display = hide ? 'none' : '';
  };
  sync();
  setInterval(sync, 250);
}

import { isTouchDevice } from './touch.ts';

/**
 * WHAT THE CONTROLS ARE, shown by the guide when a player seems not to know
 * (scenes/guideState.ts wantsControls): W A S D and the mouse on a desk, the
 * two thumb zones on a phone, labelled where they are.
 */
let keys: HTMLDivElement | null = null;

export function setControlsHint(on: boolean) {
  // only over a run: the landing and the end cards are pages of their own
  const menu = document.getElementById('tb-menu');
  if (menu && !menu.hidden) on = false;
  if (isTouchDevice()) {
    document.getElementById('tb-touch')?.classList.toggle('is-hinting', on);
    return;
  }
  if (!keys) {
    keys = document.createElement('div');
    keys.id = 'tb-keys-hint';
    keys.innerHTML =
      '<div class="tb-kh-keys"><span></span><kbd>W</kbd><span></span><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div>' +
      '<div class="tb-kh-text">walk with <b>W A S D</b><br>aim with the <b>mouse</b>, <b>click</b> to cast<br><b>SPACE</b> dashes</div>';
    document.body.appendChild(keys);
  }
  keys.classList.toggle('is-on', on);
}

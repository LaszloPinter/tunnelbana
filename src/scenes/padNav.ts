import type { DemoScene } from './DemoScene.ts';

/**
 * A PAD ON A PICK SCREEN: the D-pad (or the bumpers) walks a highlight
 * along the cards, A takes the one under it, B skips and Y rerolls where
 * the screen has those. The same beat as a click: nothing counts in the
 * first moments after the cards appear (ui/overlays.ts armedClick).
 */
export function padChoice(scene: DemoScene) {
  const ch = scene.choosing;
  const k = scene.inputs;
  if (!ch || ch.slots.length === 0 || k.device !== 'pad') return;
  const n = ch.slots.length;
  if (k.padJustDown('right') || k.padJustDown('R1')) ch.cursor = (ch.cursor + 1) % n;
  if (k.padJustDown('left') || k.padJustDown('L1')) ch.cursor = (ch.cursor + n - 1) % n;
  const s = ch.slots[ch.cursor];
  if (!ch.frame) {
    // a HUD object: made in ui mode so the turning world camera leaves it
    // alone and only the HUD camera draws it (see `add` in DemoScene.create)
    scene.uiMode = true;
    ch.frame = scene.add
      .rectangle(s.x, s.y, s.w + 12, s.h + 12, 0xffffff, 0.001)
      .setStrokeStyle(3, 0xffd23f)
      .setScrollFactor(0)
      .setDepth(204);
    scene.uiMode = false;
    ch.gfx.push(ch.frame);
  }
  ch.frame.setPosition(s.x, s.y).setSize(s.w + 12, s.h + 12);
  const beat = Date.now() > ch.openedWall + 400;
  if (!beat) return;
  if (k.padJustDown('A')) scene.choose(s.code);
  else if (ch.skip !== undefined && k.padJustDown('B')) scene.choose(ch.skip);
  else if (ch.reroll !== undefined && k.padJustDown('Y')) scene.choose(ch.reroll);
}

/** ...and the landing, while it is up: the D-pad walks its buttons, A presses, B closes */
export function padMenu(scene: DemoScene) {
  const m = scene.session.menu;
  if (!scene.session.menuVisible || !m) return;
  const k = scene.inputs;
  if (k.padJustDown('down') || k.padJustDown('right')) m.padStep(1);
  if (k.padJustDown('up') || k.padJustDown('left')) m.padStep(-1);
  if (k.padJustDown('A')) m.padActivate();
  if (k.padJustDown('B')) m.padBack();
}

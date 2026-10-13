import Phaser from 'phaser';

/**
 * Text.setColor re-rasterises the whole text canvas and re-uploads it to the
 * GPU, unconditionally, even when the colour has not changed. Text.setText
 * guards itself; this is the missing guard for the colour, and it matters
 * because the HUD recolours its route hint and its boards every frame.
 */
export function setTextColor(t: Phaser.GameObjects.Text, color: string) {
  if (t.style.color !== color) t.setColor(color);
}

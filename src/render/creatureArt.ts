import Phaser from 'phaser';

/**
 * Bauer-meets-kawaii creature sprites, baked at runtime. Drawn at 3x and
 * scaled down in-scene (supersampling smooths the edges), with dark outlines
 * and a soft top highlight so they read as illustrations, not programmer art.
 *
 * Any PNG dropped into public/assets/ with the matching name (vatte-runner,
 * vatte-spitter, troll, wizard) replaces these automatically, see the
 * override loader in DemoScene.
 */

export function buildFxTextures(scene: Phaser.Scene) {
  // a plain white disc, for the effects pool (render/fxView.ts): every
  // burst is this one texture tinted and scaled, so a screenful of them is
  // one batch and no new objects
  if (!scene.textures.exists('fx-disc')) {
    const g = scene.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(32, 32, 32);
    g.generateTexture('fx-disc', 64, 64);
    g.destroy();
  }
  if (!scene.textures.exists('bolt-glow')) {
    const g = scene.add.graphics();
    g.fillStyle(0xffffff, 0.1);
    g.fillCircle(9, 9, 9);
    g.fillStyle(0xffffff, 0.22);
    g.fillCircle(9, 9, 6.5);
    g.fillStyle(0xffffff, 0.5);
    g.fillCircle(9, 9, 4.2);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(9, 9, 2.4);
    g.generateTexture('bolt-glow', 18, 18);
    g.destroy();
  }
  if (!scene.textures.exists('slug-glow')) {
    const g = scene.add.graphics();
    g.fillStyle(0xffffff, 0.12);
    g.fillRoundedRect(0, 0, 22, 10, 5);
    g.fillStyle(0xffffff, 0.3);
    g.fillRoundedRect(3, 2, 16, 6, 3);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(5, 3.5, 12, 3, 1.5);
    g.generateTexture('slug-glow', 22, 10);
    g.destroy();
  }
}

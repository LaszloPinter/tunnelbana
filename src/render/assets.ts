import type Phaser from 'phaser';
import { allAnimSpecs } from './spriteSpecs.ts';

/** every image and sheet the run draws from, queued on the loader */
export function preloadAssets(scene: Phaser.Scene) {
  scene.load.on('loaderror', () => {});
  scene.load.image('fauna-runner', 'assets/vatte-runner.png');
  scene.load.image('fauna-spitter', 'assets/vatte-spitter.png');
  scene.load.image('fauna-troll', 'assets/troll.png');
  scene.load.image('fauna-spider-body', 'assets/fauna/spider-body.png');
  for (const k of ['l1', 'l2', 'l3', 'l4', 'r1', 'r2', 'r3', 'r4'])
    // ?v: the crops were re-cut 2026-09-21 (each one leg now); a browser holding the old ones must not keep them
    scene.load.image(`fauna-spider-leg-${k}`, `assets/fauna/spider-leg-${k}.png?v=2`);
  // the horde's frame animation, whatever of it is on disk (spriteSpecs.ts)
  for (const a of allAnimSpecs())
    scene.load.spritesheet(a.key, a.url, { frameWidth: a.frameW, frameHeight: a.frameH });
}

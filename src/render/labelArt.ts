import Phaser from 'phaser';
import { AD_TEXTS, PANEL_WORDS, WIDE_ADS } from '../core/lineData.ts';
import { SERVICES, shortName } from '../core/network.ts';

/**
 * Every piece of lettering that is drawn as part of the WORLD, platform ads,
 * EXIT and vending machine labels, and the trains' LED destination signs, is
 * baked once into its own texture and then only ever placed as an image.
 *
 * Why bake instead of using Text objects: constructing a Phaser Text costs
 * about a millisecond (its own canvas, font metrics, a texture upload) against
 * about five microseconds for a Rectangle, and a station rebuilds its whole
 * furniture on arrival, 26 of them was a 30ms hitch every time a train pulled
 * in. Recolouring a Text costs the same again, every frame, which is what the
 * destination signs were doing.
 *
 * Why bake at runtime instead of shipping PNGs: the copy still changes as the
 * game does, and the bake matches whatever resolution the screen actually
 * renders at, which a checked-in PNG cannot. The seam for real artwork is
 * already here though, bake() skips any key that already exists, so a file
 * dropped into public/assets and loaded in preload wins, exactly like the
 * creature art. When the real ad scans land they replace these keys and no
 * other code changes.
 */

/** device pixels per layout unit the labels were baked at */
let bakedRes = 1;
/** display scale per key: 1/res for what we baked, the PNG convention for art */
const scales = new Map<string, number>();
/** replacement artwork is authored at twice its layout size */
const ART_RES = 2;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const adWideKey = (text: string) => `label-ad-wide-${slug(text)}`;
export const adPanelKey = (word: string) => `label-ad-panel-${slug(word)}`;
export const adBoardKey = (l1: string, l2: string) => `label-ad-board-${slug(`${l1} ${l2}`)}`;
export const uiLabelKey = (text: string) => `label-ui-${slug(text)}`;
/** one per service and terminus: "19 Hagsätra", in its own line's colour */
export const signKey = (serviceId: string, terminus: string) =>
  `label-sign-${serviceId}-${slug(shortName(terminus))}`;

const MONO = 'monospace';
const SIGN_COLORS: Record<string, string> = {
  green: '#9ae08a',
  red: '#ff8a7a',
  blue: '#8ac8ff',
};

function bake(
  scene: Phaser.Scene,
  key: string,
  text: string,
  style: Phaser.Types.GameObjects.Text.TextStyle,
) {
  if (scene.textures.exists(key)) {
    // real artwork was loaded for this key, leave it alone
    if (!scales.has(key)) scales.set(key, 1 / ART_RES);
    return;
  }
  const t = scene.make.text({ text, style: { ...style, resolution: bakedRes } }, false);
  const src = t.canvas;
  const tex = scene.textures.createCanvas(key, src.width, src.height);
  tex?.draw(0, 0, src);
  scales.set(key, 1 / bakedRes);
  t.destroy();
}

/**
 * Bake the world's lettering. Idempotent, and cheap enough to sit in create():
 * ~44 strings, once, before the first station is built.
 */
export function bakeLabels(scene: Phaser.Scene, res: number) {
  bakedRes = res;
  const adWide = { fontFamily: MONO, fontSize: '17px', color: '#f0e8c8', fontStyle: 'bold' };
  const adPanel = { fontFamily: MONO, fontSize: '12px', color: '#f4f0e4', fontStyle: 'bold' };
  const adBoard = {
    fontFamily: MONO,
    fontSize: '17px',
    color: '#f4f0e4',
    align: 'center',
    fontStyle: 'bold',
  };
  for (const t of WIDE_ADS) bake(scene, adWideKey(t), t, adWide);
  for (const w of PANEL_WORDS) bake(scene, adPanelKey(w), w, adPanel);
  for (const [l1, l2] of AD_TEXTS) bake(scene, adBoardKey(l1, l2), `${l1}\n${l2}`, adBoard);

  bake(scene, uiLabelKey('EXIT'), 'EXIT', { fontFamily: MONO, fontSize: '9px', color: '#a0d0aa' });
  bake(scene, uiLabelKey('BYTE'), 'BYTE', { fontFamily: MONO, fontSize: '9px', color: '#c8c8a0' });
  // the shafts between a station's levels
  bake(scene, uiLabelKey('UPP'), 'UPP', { fontFamily: MONO, fontSize: '9px', color: '#c8c8a0' });
  bake(scene, uiLabelKey('NER'), 'NER', { fontFamily: MONO, fontSize: '9px', color: '#c8c8a0' });
  bake(scene, uiLabelKey('MANA'), 'MANA', {
    fontFamily: MONO,
    fontSize: '10px',
    color: '#c9b3f0',
    fontStyle: 'bold',
  });
  bake(scene, uiLabelKey('KIOSK'), 'KIOSK', {
    fontFamily: MONO,
    fontSize: '10px',
    color: '#ffd987',
    fontStyle: 'bold',
  });
  bake(scene, uiLabelKey('HEALTH'), 'HEALTH', {
    fontFamily: MONO,
    fontSize: '10px',
    color: '#9fe0b5',
    fontStyle: 'bold',
  });

  // every destination a train can ever show: each service, both ways
  for (const svc of SERVICES) {
    for (const terminus of [svc.stations[0], svc.stations[svc.stations.length - 1]]) {
      bake(scene, signKey(svc.id, terminus), `${svc.id} ${shortName(terminus)}`, {
        fontFamily: MONO,
        fontSize: '10px',
        color: SIGN_COLORS[svc.color] ?? '#ffcf3c',
        fontStyle: 'bold',
        backgroundColor: '#14171b',
        padding: { x: 3, y: 1 },
      });
    }
  }
}

/**
 * Place a baked label in the world, sized in layout units.
 *
 * Tagged UPRIGHT: a chart placed half a turn about its origin turns the
 * picture with it, which is right for a platform and its furniture and wrong
 * for anything that is READ. Phaser Text was already exempt; a baked label is
 * an Image, so it was not, and a station drawn the other way up had its EXIT
 * and its ads upside down (from play 2026-09-07).
 */
export function addLabel(scene: Phaser.Scene, x: number, y: number, key: string) {
  return scene.add
    .image(x, y, key)
    .setScale(scales.get(key) ?? 1 / bakedRes)
    .setData('upright', true);
}

/**
 * Shrink a baked label until it fits inside a box, keeping its proportions.
 *
 * A baked string is whatever width the font made it, and the boards it hangs
 * on are fixed sizes in metres, so the longest ad copy ran off both ends of
 * its own board. Sized DOWN only: a short word on a big board stays the size
 * it was drawn at rather than being stretched to fill it.
 */
export function fitLabel(img: Phaser.GameObjects.Image, maxW: number, maxH: number) {
  const k = Math.min(1, maxW / img.displayWidth, maxH / img.displayHeight);
  if (k < 1) img.setScale(img.scaleX * k, img.scaleY * k);
  return img;
}

import Phaser from 'phaser';

/**
 * A FIXED PIECE OF A PLACE, remembered where it stands in that place's own
 * along-and-across so the whole interior can be stood where the place
 * stands in Stockholm (render/placeView.ts poseAt).
 */
export interface Fixed {
  obj: Phaser.GameObjects.GameObject &
    Phaser.GameObjects.Components.Transform &
    Phaser.GameObjects.Components.Visible;
  x: number;
  y: number;
  rot: number;
}

export function remember(obj: Phaser.GameObjects.GameObject): Fixed {
  const o = obj as Fixed['obj'];
  return { obj: o, x: o.x, y: o.y, rot: o.rotation };
}

/** is this thing READ rather than looked at? Text, and the baked labels that
 * stand in for it (render/labelArt.ts), those stay the right way up */
export function reads(obj: Fixed['obj']): boolean {
  if (obj instanceof Phaser.GameObjects.Text) return true;
  const d = obj as Fixed['obj'] & { getData?: (k: string) => unknown };
  return d.getData?.('upright') === true;
}

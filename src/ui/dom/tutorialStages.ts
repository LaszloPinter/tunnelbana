/**
 * THE TUTORIAL'S LESSONS, in order (ui/dom/tutorial.ts runs them): what each
 * is called, what it says per device, and the keycaps it shows.
 */
export type Device = 'keys' | 'pad' | 'touch';

type StageId = 'move' | 'aim' | 'dash' | 'casts' | 'mana' | 'stot' | 'ride' | 'exit';

export interface Stage {
  id: StageId;
  title: string;
  /** the hint, per device; <b> marks the thing to press */
  hint: Record<Device, string>;
  /** the caps to show, per device: label, and how the cap is proven */
  caps: Record<Device, string[]>;
}

export const STAGES: Stage[] = [
  {
    id: 'move',
    title: 'Move',
    hint: {
      keys: 'Walk the platform with <b>W A S D</b>',
      pad: 'Walk the platform with the <b>left stick</b>',
      touch: 'Put your <b>left thumb</b> down anywhere on the left and drag to walk',
    },
    caps: { keys: ['', 'W', '', 'A', 'S', 'D'], pad: ['↑', '←', '↓', '→'], touch: [] },
  },
  {
    id: 'aim',
    title: 'Aim and cast',
    hint: {
      keys: 'Move the <b>mouse</b> to aim · the <b>left button</b> casts a bolt',
      pad: 'Aim with the <b>right stick</b> · <b>RT</b> casts a bolt',
      touch: 'Casting is <b>automatic</b> on a phone: walk toward the dummies and your bolts fly at them',
    },
    caps: { keys: [], pad: ['RT'], touch: [] },
  },
  {
    id: 'dash',
    title: 'Dash',
    hint: {
      keys: '<b>SPACE</b>: a dash, briefly untouchable',
      pad: '<b>A</b>: a dash, briefly untouchable',
      touch: 'Tap <b>DASH</b>: a dash, briefly untouchable',
    },
    caps: { keys: ['SPACE'], pad: ['A'], touch: ['DASH'] },
  },
  {
    id: 'casts',
    title: 'Two casts',
    hint: {
      keys: '<b>2</b> the bolt · <b>3</b> the torrent: try both',
      pad: '<b>LB</b> the bolt · <b>RB</b> the torrent: try both',
      touch: 'Tap <b>⇄</b> twice: the bolt, then the torrent, and back',
    },
    caps: { keys: ['2', '3'], pad: ['LB', 'RB'], touch: ['⇄'] },
  },
  {
    id: 'mana',
    title: 'Mana',
    hint: {
      keys: 'Casts cost mana. Run past the <b>MANA</b> machine: below 60% it tops you up for kronor (or press <b>E</b>)',
      pad: 'Casts cost mana. Run past the <b>MANA</b> machine: below 60% it tops you up for kronor (or press <b>X</b>)',
      touch: 'Casts cost mana. Run past the <b>MANA</b> machine: below 60% it tops you up for kronor',
    },
    caps: { keys: ['E'], pad: ['X'], touch: [] },
  },
  {
    id: 'stot',
    title: 'STÖT',
    hint: {
      keys: '<b>Q</b> (or the right button): a shockwave that throws the horde back · 12 mana',
      pad: '<b>LT</b>: a shockwave that throws the horde back · 12 mana',
      touch: 'Tap <b>STÖT</b>: a shockwave that throws the horde back · 12 mana',
    },
    caps: { keys: ['Q'], pad: ['LT'], touch: ['STÖT'] },
  },
  {
    id: 'ride',
    title: 'Get where you are going',
    hint: {
      keys: 'Your <b>11 toward Kungsträdgården</b> is coming in. Walk through its doors when they open',
      pad: 'Your <b>11 toward Kungsträdgården</b> is coming in. Walk through its doors when they open',
      touch: 'Your <b>11 toward Kungsträdgården</b> is coming in. Walk through its doors when they open',
    },
    caps: { keys: [], pad: [], touch: [] },
  },
  {
    id: 'exit',
    title: 'Get off at your stop',
    hint: {
      keys: 'This is <b>Solna centrum</b>. Step off, walk to the <b>EXIT</b> and press <b>E</b>: every ride ends like this',
      pad: 'This is <b>Solna centrum</b>. Step off, walk to the <b>EXIT</b> and press <b>X</b>: every ride ends like this',
      touch:
        'This is <b>Solna centrum</b>. Step off, walk to the <b>EXIT</b> and tap <b>E</b>: every ride ends like this',
    },
    caps: { keys: ['E'], pad: ['X'], touch: ['E'] },
  },
];

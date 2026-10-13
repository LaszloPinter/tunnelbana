import { el } from './menuBuild.ts';

/** the two dialogs off the board: the controls, and what this is */

function panel(id: string, heading: string, body: HTMLElement): HTMLDialogElement {
  const dlg = el('dialog');
  dlg.id = id;
  const head = el('div', 'tb-panel-head');
  const h = el('h2', undefined, heading);
  const close = el('button', 'tb-btn', 'Close');
  close.addEventListener('click', () => dlg.close());
  head.append(h, close);
  const wrap = el('div', 'tb-panel-body');
  wrap.appendChild(body);
  dlg.append(head, wrap);
  return dlg;
}

export function controlsPanel(onTutorial?: () => void): HTMLDialogElement {
  const keys = el('div', 'tb-keys');
  const rows: [string, string][] = [
    ['W A S D', 'Move along the platform and across the tracks'],
    ['Mouse', 'Aim; the left button casts where you point'],
    ['Space', 'Dash: briefly untouchable'],
    ['2 / 3', 'Bolt · Torrent'],
    ['Q / Right click', 'STÖT: the shockwave; costs mana, then a cooldown'],
    ['E', 'Buy at a machine, open the kiosk, take the stairs, or leave through an exit'],
    ['Tab', 'Your travelcard and the perks on it'],
    ['P', 'Pause'],
    ['R', 'Restart the run'],
  ];
  for (const [k, what] of rows) {
    keys.append(el('kbd', undefined, k), el('span', undefined, what));
  }
  const body = el('div');
  body.appendChild(keys);
  // a pad, plugged in: the same game, these buttons
  const padHead = el('h3', undefined, 'Pad');
  padHead.style.margin = '18px 0 6px';
  const pad = el('div', 'tb-keys');
  const padRows: [string, string][] = [
    ['Left stick', 'Move: at the pace it is pushed'],
    ['Right stick', 'Aim'],
    ['RT', 'Cast'],
    ['LT', 'STÖT'],
    ['A', 'Dash'],
    ['X', 'Buy, kiosk, stairs, exit'],
    ['LB / RB', 'Bolt · Torrent'],
    ['Y (hold)', 'Your travelcard'],
    ['D-pad · A', 'Choose a card, and take it · B skips · Y rerolls'],
    ['Start', 'Pause'],
  ];
  for (const [k, what] of padRows) pad.append(el('kbd', undefined, k), el('span', undefined, what));
  body.append(padHead, pad);
  if (onTutorial) {
    // the tutorial again, for whoever wants it: here, where the keys are
    const again = el('button', 'tb-btn', 'Play the tutorial ▸');
    again.style.marginTop = '18px';
    body.appendChild(again);
    const dlg = panel('tb-controls', 'Controls', body);
    again.addEventListener('click', () => {
      dlg.close();
      onTutorial();
    });
    return dlg;
  }
  return panel('tb-controls', 'Controls', body);
}

export function aboutPanel(): HTMLDialogElement {
  const body = el('div');
  body.innerHTML =
    '<p style="margin:0 0 14px;color:var(--tb-dim);font-size:14px;line-height:1.6">' +
    'New tunnels are being dug under Stockholm, and something older than the network ' +
    'has been woken by them. You have a journey to finish.</p>' +
    '<p style="margin:0;color:var(--tb-dimmer);font-size:13px;line-height:1.6">' +
    'Open source. The network, the platforms and the track geometry are real, from ' +
    'OpenStreetMap. A fuller about page is still to be written.</p>' +
    '<p style="margin:14px 0 0;color:var(--tb-dimmer);font-size:12px;line-height:1.6">' +
    'Visits are counted anonymously with GoatCounter: no cookies, nothing about who you are.</p>';
  return panel('tb-about', 'About', body);
}

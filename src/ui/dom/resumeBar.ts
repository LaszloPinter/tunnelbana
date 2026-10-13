import './resumeBar.css';

/**
 * THE RUN, BEING PICKED BACK UP: a save is a seed and an input log, and
 * loading it is replaying every tick of it, which for ten minutes of play
 * is half a minute of simulation. While that runs nothing else should be
 * on screen, the replay would otherwise flash every message, jolt, pick
 * and shop of the whole run past you (from play 2026-09-25: "all sorts of
 * messages, very confusing"), so a bar, and a line saying what it is.
 */
let root: HTMLDivElement | null = null;
let fill: HTMLDivElement | null = null;
let label: HTMLDivElement | null = null;

export function showResumeBar(station: string, dest: string) {
  hideResumeBar();
  root = document.createElement('div');
  root.id = 'tb-resume';
  const box = document.createElement('div');
  box.className = 'tb-resume-box';
  const kicker = document.createElement('div');
  kicker.className = 'tb-resume-kicker';
  kicker.textContent = 'PICKING THE RUN BACK UP';
  const title = document.createElement('div');
  title.className = 'tb-resume-title';
  title.textContent = `${station} → ${dest}`;
  const track = document.createElement('div');
  track.className = 'tb-resume-track';
  fill = document.createElement('div');
  fill.className = 'tb-resume-fill';
  track.appendChild(fill);
  label = document.createElement('div');
  label.className = 'tb-resume-label';
  label.textContent = 'Replaying every step you took…';
  box.append(kicker, title, track, label);
  root.appendChild(box);
  document.body.appendChild(root);
}

export function setResumeProgress(fraction: number, secondsLeft: number | null) {
  if (!fill || !label) return;
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  fill.style.width = `${pct}%`;
  label.textContent =
    secondsLeft === null
      ? `Replaying every step you took… ${pct}%`
      : `Replaying every step you took… ${pct}% · about ${Math.max(1, Math.ceil(secondsLeft))} s`;
}

export function hideResumeBar() {
  root?.remove();
  root = null;
  fill = null;
  label = null;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/**
 * DAGENS TEA: the message line along the bottom of the departure board, as
 * on a real SL sign, the day's gossip, flipping every few seconds. The
 * headlines are the papers' own entertainment pages, fetched at build time
 * (scripts/tea.mjs → tea.json); each is credited and links to its article.
 * Without the file (dev, or every feed down) the board gossips about itself.
 */
interface TeaItem {
  title: string;
  link?: string;
  source?: string;
}

/** the board's own gossip, Swenglish, for when there is no tea.json */
const HOUSE_TEA = [
  'Spotted: Langaren at Slussen with a suspiciously heavy bag. Says it is "bara tvätt".',
  'Väktaren at Fridhemsplan insists he had it "helt under kontroll". Witnesses disagree.',
  'Silverpilen sighted again past Kymlinge. SL: "ingen kommentar".',
  'Commuter at T-Centralen apologised to a monster for bumping into it. Very Swedish.',
  'Rumour: the semla shortage at Odenplan was the horde all along.',
  'Local teen films an entire horde attack. 12 views. Mamma not impressed.',
  'Nurse at Gullmarsplan has handed out 400 plåster tonight. Still no fika break.',
  'SL promises "mindre förseningar". The horde promises nothing.',
  'Someone stood on the LEFT in the rulltrappa at Slussen. Police are looking into it.',
  'Breaking: a commuter said "hej" to a stranger. Investigation ongoing.',
  'Bergakungen seen buying a monthly pass. Nobody dared ask.',
  'A lagom amount of monsters reported on the green line tonight.',
  'Insider: the 4× ride is just SL finally running on time.',
  'Langaren denies everything. Also: kaffe, 90 kr.',
];

const FLIP_MS = 7000;

export function buildTea(): HTMLElement {
  const row = el('div', 'tb-tea');
  const label = el('span', 'tb-tea-tag', '☕ DAGENS TEA');
  const line = el('span', 'tb-tea-line');
  row.append(label, line);

  // the house's own lines, starting from today's (UTC, like the daily)
  const day = Math.floor(Date.now() / 86_400_000);
  let items: TeaItem[] = HOUSE_TEA.map((title) => ({ title }));
  let i = day % items.length;

  const show = () => {
    const it = items[i % items.length];
    line.replaceChildren();
    if (it.link) {
      const a = el('a', 'tb-tea-text');
      a.href = it.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = it.title;
      line.append(a, el('span', 'tb-tea-src', `via ${it.source ?? 'the papers'} ↗`));
    } else line.append(el('span', 'tb-tea-text', it.title));
    line.classList.remove('tb-flip');
    void line.offsetWidth;
    line.classList.add('tb-flip');
  };
  show();
  // not while the pointer rests on it: a headline being read stays put
  let held = false;
  row.addEventListener('pointerenter', () => (held = true));
  row.addEventListener('pointerleave', () => (held = false));
  setInterval(() => {
    if (held || document.hidden || !row.isConnected || row.closest('[hidden]')) return;
    i += 1;
    show();
  }, FLIP_MS);

  // the real tea, if this build has it
  fetch('tea.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { items?: TeaItem[] } | null) => {
      const real = (j?.items ?? []).filter((t) => typeof t.title === 'string' && t.title.length > 0);
      if (real.length === 0) return;
      items = real.map((t) => ({
        title: t.title,
        link: typeof t.link === 'string' && t.link.startsWith('https://') ? t.link : undefined,
        source: t.source,
      }));
      i = 0;
      show();
    })
    .catch(() => {});
  return row;
}

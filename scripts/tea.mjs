// DAGENS TEA, the gossip on the landing page, fetched at BUILD time.
//
// The papers' feeds send no CORS header, so the page cannot read them itself;
// the Pages workflow (.github/workflows/pages.yml) runs this every couple of
// hours and ships the result as a static `tea.json` beside the game. No
// server, no key. The page falls back to its own lines when the file is
// missing (dev, or every feed down): src/ui/dom/tea.ts.
//
//   node scripts/tea.mjs dist/tea.json
//
// Only the ENTERTAINMENT sections, real tea, not the news, and never a
// headline about a death or a crime: "☕" beside a death notice, in a game about
// a horde, would be grim. Each item keeps its source and its link: the paper
// is credited and gets the click.
import { writeFileSync } from 'node:fs';

const FEEDS = [
  { source: 'Aftonbladet', url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/nojesbladet/' },
  { source: 'Expressen', url: 'https://feeds.expressen.se/noje/' },
];

/** word starts that keep a headline off the page */
const DARK =
  /(^|[\s"”'(«–-])(död|döda|dödad|dödsfall|dödsbud|dog |dör |avled|avliden|gått bort|somnat in|begrav|minnesstund|sörj|sorg|mord|mörd|dräpt|skjut|skott|knivhug|knivattack|våldt|sexbrott|övergrepp|misshand|självmord|cancer|tumör|olycka|omkom|tragedi|terror|krig|bomb|gisslan|gripen|häktad|åtal|dömd|fängelse|polisen)/i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m)
    .replace(/<[^>]+>/g, '')
    .trim();

async function read({ source, url }) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'user-agent': 'teacentralen.com build' },
  });
  if (!res.ok) throw new Error(`${source}: HTTP ${res.status}`);
  const xml = await res.text();
  const items = [];
  for (const [, body] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const title = decode(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const link = decode(body.match(/<link\b[^>]*>([\s\S]*?)<\/link>/)?.[1] ?? '');
    if (!title || !/^https:\/\//.test(link) || DARK.test(title)) continue;
    items.push({ title, link, source });
  }
  return items;
}

const out = process.argv[2] ?? 'dist/tea.json';
const lists = await Promise.all(
  FEEDS.map((f) =>
    read(f).catch((e) => {
      console.warn(`tea: ${e.message}`);
      return [];
    }),
  ),
);
// the top few from each paper, taking turns
const items = [];
for (let i = 0; items.length < 8 && lists.some((l) => l[i]); i++)
  for (const l of lists) if (l[i]) items.push(l[i]);
if (items.length === 0) {
  console.warn('tea: nothing fit to print; the page uses its own lines');
  process.exit(0);
}
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), items }, null, 1));
console.log(`tea: ${items.length} items → ${out}`);
for (const it of items) console.log(`  [${it.source}] ${it.title}`);

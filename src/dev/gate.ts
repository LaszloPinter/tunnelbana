/**
 * WHO GETS THE DEBUG PANEL (L). A dev build: always. A public build: only a
 * browser that has been given the passphrase once, as `?debug=<passphrase>`.
 *
 * The build knows only the passphrase's SHA-256, from VITE_DEBUG_KEY_SHA256
 * in `.env.local` (never committed), so the public repo and the public bundle
 * say nothing that unlocks it; a build made without the variable cannot be
 * unlocked at all. The passphrase is kept in this browser and checked again
 * on every load, so writing a flag into localStorage by hand does nothing.
 *
 * Nothing here is security, it is a single-player game, it keeps the lab
 * out of players' way. What keeps the board honest is that a run the lab
 * touched is a dev run: never saved, never posted (scenes/runOver.ts).
 */
const KEY = 'tunnelbana-debug-key';

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function debugAllowed(q: URLSearchParams): Promise<boolean> {
  if (import.meta.env.DEV) return true;
  const want = (import.meta.env.VITE_DEBUG_KEY_SHA256 as string | undefined)?.trim().toLowerCase();
  if (!want || !crypto?.subtle) return false;
  let given = q.get('debug');
  try {
    given ??= localStorage.getItem(KEY);
  } catch {
    // no storage: only the query can unlock this page
  }
  if (!given || (await sha256(given)) !== want) return false;
  try {
    localStorage.setItem(KEY, given);
  } catch {
    // unlocked for this page only
  }
  // the passphrase does not stay in the address bar to be shared by accident
  if (q.has('debug')) {
    const u = new URL(location.href);
    u.searchParams.delete('debug');
    history.replaceState(null, '', u);
  }
  return true;
}

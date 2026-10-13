import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/**
 * What the BUILD knows that the source cannot.
 *
 * Three things are stamped in here rather than written down anywhere: the
 * version, the commit, and whether this build has multiplayer in it. All three
 * have to be decided when the bundle is made, a version written into a source
 * file goes stale the moment someone forgets to bump it, and a multiplayer
 * switch read at runtime would still ship the lobby to everybody.
 */

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** the commit, if this is a git checkout; a tarball build just says so */
function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'nogit';
  }
}

export default defineConfig(() => {
  // Multiplayer is BUILT but not offered (see DESIGN.md §11c): the alpha is
  // single player, and dropping the two cards is all it takes, which also
  // puts the lobby's remaining rough edges out of a player's reach. Note the
  // code still ships; the flow is unreachable, not removed. On by default in
  // dev so the room harness keeps working; a production build opts in with
  // VITE_MULTIPLAYER=1.
  // OFF by default everywhere, dev included. It was on in dev so the room
  // harness kept working, but that meant `npm run dev` showed the old
  // four-card menu and looked as though nothing had changed. Develop what
  // ships; opt in with VITE_MULTIPLAYER=1 when working on the lobby.
  const multiplayer = process.env.VITE_MULTIPLAYER === '1';

  return {
    // RELATIVE, and that is the whole point. An absolute '/assets/…', Vite's
    // default, only works when the page is served from a domain root: open
    // dist/index.html as a file and the browser looks for file:///assets/…,
    // finds nothing, and paints a blank page with no error to explain it.
    // Serving from <user>.github.io/<repo>/ breaks the same way.
    //
    // './' works in all three: a file, a domain root, and any subpath. It
    // costs nothing and removes a whole class of "why is it blank". Override
    // with BASE_PATH only if something genuinely needs an absolute base.
    base: process.env.BASE_PATH ?? './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_SHA__: JSON.stringify(gitSha()),
      __MULTIPLAYER__: JSON.stringify(multiplayer),
    },
  };
});

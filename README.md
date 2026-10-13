# Tunnelbana

**Play it at [teacentralen.com](https://teacentralen.com)**

A top-down action roguelite in the real Stockholm metro. Ride the trains, hold
off the horde on every platform, get off at your stop, then ride on, deeper and
darker. Every station, track and line comes from the real network
(OpenStreetMap). Every run is a seed: the same seed and the same inputs always
play out exactly the same, which is what the daily challenge and its
leaderboard stand on.

This is an **alpha**: single player, no sound yet, keyboard and mouse or a
gamepad, desktop only.

## Built with Claude Code

This whole game was built with [Claude Code](https://claude.com/claude-code),
Anthropic's AI coding agent, working with one human who played it, judged it
and steered it. We say so up front because it shapes how the project works:

- **AI-assisted contributions are welcome.** Write your change with Claude,
  another assistant or by hand. What matters is that you have played it, you
  understand it and you stand behind it.
- **Every pull request to `main` is reviewed with Claude before it is
  merged.** The maintainer goes through each PR with Claude Code, and
  nothing lands without that review. The automatic checks (types, lint,
  format, determinism) have to pass too.

## A community game

Bug reports, ideas, balance, art and code are all welcome. For anything
bigger than a fix, open an issue first so we can talk it through.

```sh
npm install
npm run dev        # the game, at http://localhost:5173
npm run check      # what CI runs: types, lint, format, determinism, world probes
```

`npm run check` takes a few minutes. While you work, the faster parts are
`npm run typecheck`, `npm run lint` and `npm run check:sim`.

### The one rule that matters

The simulation must stay **deterministic**. No `Math.random`, no wall clock,
no `Math.hypot` in simulation code: randomness comes from the run's seeded
streams, and distances from `dist` in `src/sim/det.ts`. The checks replay
seeds and compare state fingerprints, so a change that breaks this fails in
CI instead of in somebody's daily run. If you change the simulation on
purpose, re-record the baseline with
`node --experimental-strip-types scripts/check-golden.ts --update` and say
so in the PR.

### Where things are

| Path              | What                                                         |
| ----------------- | ------------------------------------------------------------ |
| `src/sim`         | the deterministic simulation: runs, places, trains, passengers |
| `src/combat`      | enemies, casting, passengers' behaviour, the dealer          |
| `src/render`      | everything drawn, mostly generated from code                 |
| `src/ui`, `src/scenes` | the landing page, HUD and screens                       |
| `data`            | the metro network, distilled from OpenStreetMap               |
| `scripts/probe`   | headless probes that play the game and check behaviour       |

## Credits and licences

The code is [MIT](LICENSE). Map data © OpenStreetMap contributors (ODbL).
Details, and what a fork has to check, are in [CREDITS.md](CREDITS.md).

Tunnelbana is a fan project. It is not affiliated with SL or Region
Stockholm.

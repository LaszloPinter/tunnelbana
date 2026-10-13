import js from '@eslint/js';
import ts from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * The lint rules, and one of them is load-bearing.
 *
 * `npm run check` already fails the build if a simulation file reaches for
 * `Math.random` or `Math.sin`, that check greps, so it catches the letter of
 * the rule. What it cannot do is explain itself at the moment someone writes
 * the line. The `no-restricted-globals`/`no-restricted-properties` block below
 * says why, in the editor, before the commit: IEEE 754 pins down `+ - * /` and
 * `sqrt` exactly, and leaves `sin`, `cos`, `atan2`, `pow` and `hypot` for each
 * engine to approximate however it likes. A run has to be a pure function of
 * its seed and inputs, that is what the daily challenge, the replay check and
 * lockstep all stand on, so those are errors in `src/sim`, `src/combat` and
 * `src/core`, and perfectly fine everywhere else. A pulsing alpha in the
 * renderer can call `Math.sin` all day; nothing downstream of it decides what
 * happened.
 */
const DETERMINISM_MESSAGE =
  'Not bit-identical across JS engines. Use the polynomial equivalents in src/sim/det.ts ' +
  "(dsin, dcos, datan2, dacos, dist) and the run's own seeded stream instead of Math.random. " +
  'See DESIGN.md §11c stage 0.';

/**
 * Every file whose output decides WHAT HAPPENED rather than what it looks like.
 * `server/` is deliberately NOT here: the relay simulates nothing, and reading
 * the wall clock once at `start` to stamp tick0 is its documented job (§19).
 */
const SIMULATION = ['src/sim/**/*.ts', 'src/combat/**/*.ts', 'src/core/**/*.ts', 'src/world/**/*.ts'];

export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', 'data/**', 'reference/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    rules: {
      // the codebase leans on inference and on `unknown` at the edges; an
      // explicit `any` should be a decision, not an accident
      '@typescript-eslint/no-explicit-any': 'warn',
      // `_unused` is the signal that a parameter is kept for a signature
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: SIMULATION,
    rules: {
      // the simulation never sees the picture: no Phaser, no render, no
      // scene, no UI. Anything it needs from those is data, and belongs in
      // core/ or data/ (the platform centreline moved there for this)
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['phaser'],
              message: 'The simulation runs in plain Node (§11c). No engine in the room.',
            },
            {
              group: ['**/render/*', '**/scenes/*', '**/ui/*'],
              message: 'The simulation may not read the picture. Move what it needs into core/ or data/.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        ...[
          'random',
          'sin',
          'cos',
          'tan',
          'atan',
          'atan2',
          'asin',
          'acos',
          'pow',
          'exp',
          'log',
          'hypot',
          'cbrt',
        ].map((property) => ({ object: 'Math', property, message: DETERMINISM_MESSAGE })),
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'Date',
          message: 'The simulation never reads a clock. Ticks arrive as data: see src/sim/tick.ts.',
        },
      ],
    },
  },
  {
    // the browser half
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    // the Node half: the relay, the data builders, the checks and the probes
    files: ['server/**/*.ts', 'scripts/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // The probes are scratch instruments: they print, they poke at internals,
    // and they are written to answer one question and then left alone. Holding
    // them to the same bar would only stop people writing them, which would
    // cost far more than the tidiness is worth, since half the measurements in
    // DESIGN.md came out of this directory.
    files: ['scripts/**/*.ts', 'scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      // a declared-then-overwritten counter is how these are written
      'no-useless-assignment': 'off',
    },
  },
  prettier,
);

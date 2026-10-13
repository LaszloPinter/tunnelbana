/**
 * The three constants vite.config.ts stamps into the bundle. They are
 * `define`d, so they are literals by the time the code runs, which is what
 * lets a false `__MULTIPLAYER__` take the lobby out of the build entirely
 * rather than merely hiding it.
 */
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __MULTIPLAYER__: boolean;

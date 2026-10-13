import { putError } from './account.ts';

/**
 * WHAT BROKE, IN SOMEBODY ELSE'S BROWSER. An alpha is played by strangers,
 * and without this a crash on their machine is simply a player who never
 * comes back. Every uncaught error and unhandled rejection is sent to the
 * `errors` collection (firestore.rules) with the build, the page and where
 * in the run it happened, enough to find it, and with the run's seed and
 * tick, often enough to replay it (scripts/replay-file.ts).
 *
 * Quiet by design: never in a dev build, the same message once, at most five
 * a session, and a failure to report is swallowed, reporting must never be
 * the thing that breaks.
 */
/** one uncaught error, as the `errors` collection keeps it (firestore.rules) */
export interface CrashReport {
  message: string;
  stack: string;
  version: string;
  where: string;
  agent: string;
}

const MAX = 5;
const sent = new Set<string>();

/** where in the run we are, when something breaks: set once by main.ts */
let whereNow: () => string = () => '';
export function setCrashContext(f: () => string) {
  whereNow = f;
}

function report(message: string, stack: string) {
  if (import.meta.env.DEV) return;
  const key = message.slice(0, 200);
  if (sent.has(key) || sent.size >= MAX) return;
  sent.add(key);
  let where = '';
  try {
    where = whereNow();
  } catch {
    // the context itself may be what is broken
  }
  void putError({
    message: message.slice(0, 500),
    stack: stack.slice(0, 4000),
    version: __APP_VERSION__.slice(0, 40),
    where: `${location.pathname}${location.search} · ${where}`.slice(0, 500),
    agent: navigator.userAgent.slice(0, 300),
  }).catch(() => {});
}

export function installCrashReporter() {
  window.addEventListener('error', (e) => {
    const err = e.error as Error | undefined;
    report(err?.message ?? e.message ?? 'error', err?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as Error | string | undefined;
    report(
      typeof r === 'string' ? r : (r?.message ?? 'unhandled rejection'),
      typeof r === 'string' ? '' : (r?.stack ?? ''),
    );
  });
}

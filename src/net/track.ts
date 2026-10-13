/**
 * VISITS, COUNTED ANONYMOUSLY: GoatCounter (index.html loads it), no cookies,
 * no personal data, so no consent banner. Beyond the page view, a handful of
 * named moments show whether people who load the page actually play, and how
 * far they get: the funnel, nothing about who they are.
 *
 * Presentation only. Never called from the simulation: it reads the wall
 * clock and the network, and a run must stay a function of its inputs. If
 * the script is blocked or not loaded yet, nothing happens.
 */
type GoatCounter = { count?: (o: { path: string; title?: string; event?: boolean }) => void };

export function track(name: string) {
  try {
    const gc = (window as unknown as { goatcounter?: GoatCounter }).goatcounter;
    gc?.count?.({ path: name, title: name, event: true });
  } catch {
    // counting is never worth an error
  }
}

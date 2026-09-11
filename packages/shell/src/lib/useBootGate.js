/* The hook every surface calls to say how far along it is.
 *
 * Deliberately one line at each call site, and deliberately the SURFACE's
 * judgement rather than a generic "all fetches settled": what makes a screen
 * usable differs per surface. Competitors is usable when the focal company's
 * row has landed, even though fourteen peers are still in flight. Learn has
 * nothing to wait for at all. A gate that waited for every request would hold
 * the cover up long past the point the reader could start reading.
 *
 * `ready` should mean "showing this now would not look broken", not "finished".
 */
import { useEffect } from 'react';
import { bootDismissed, reportBoot, SURFACE_LABEL } from './boot.js';

/**
 * @param {string}  view   the surface reporting, for the cover's caption
 * @param {boolean} ready  is the surface usable yet
 * @param {object} [work]  { done, total, what } for a determinate bar
 */
export function useBootGate(view, ready, work = null) {
  const { done = 0, total = 0, what = '' } = work || {};
  useEffect(() => {
    // Cheap guard: after the first surface settles this is a dead branch for
    // the rest of the session, and every view calls it on every render.
    if (bootDismissed()) return;
    const label = total > 0
      ? `${SURFACE_LABEL[view] || view} · ${what || 'loading'} ${done} of ${total}`
      : `${SURFACE_LABEL[view] || view} · ${what || 'loading'}`;
    reportBoot({ ready, label, done, total });
  }, [view, ready, done, total, what]);
}

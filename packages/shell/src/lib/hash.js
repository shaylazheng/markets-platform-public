/* The hash tail — everything after the view segment.
 *
 * `#competitors&focus=NVDA&peers=AMD,INTC`
 *   ^segment 0    ^the tail, which belongs to the surface
 *
 * Segment 0 is store.jsx's, and it rewrites the hash on every view change,
 * keeping the tail only when the view segment is UNCHANGED (store.jsx:55-60).
 * That is why `go()` below writes the hash BEFORE calling setView: switching
 * first drops the tail on the floor, and the target surface then reads nothing.
 * This ordering is load-bearing; it was a real bug on the Competitors surface
 * before it was understood.
 *
 * Competitors, Insider and the graph each still parse the tail themselves.
 * They are verified and their parsing is entangled with surface-specific state,
 * so they were left alone rather than migrated on spec; this file is what every
 * surface built after them uses. Migrating them is a tidy-up, not a fix.
 */

/** The tail as URLSearchParams. Empty when there is no tail. */
export function hashParams() {
  const parts = (location.hash || '').slice(1).split('&');
  return new URLSearchParams(parts.slice(1).join('&'));
}

export const hashParam = (key) => hashParams().get(key);

/** The view segment, for a surface guarding its own hash writes. */
export const hashView = () => (location.hash || '').slice(1).split('&')[0];

/** Where each surface expects to find a company in its tail. They genuinely
 *  differ — the graph and Competitors say `focus`, Insider says `ticker` — and
 *  a single map is better than every caller remembering which. */
export const TICKER_PARAM = {
  competitors: 'focus',
  graph: 'focus',
  insider: 'ticker',
  valuation: 'ticker',
  thesis: 'ticker',
  book: 'ticker',
  risk: 'ticker',
  review: 'ticker',
  report: 'ticker',
};

/** Build the hash a surface should be entered at for a given company. */
export function hashFor(view, ticker) {
  const key = TICKER_PARAM[view];
  return `#${view}${key && ticker ? `&${key}=${encodeURIComponent(ticker)}` : ''}`;
}

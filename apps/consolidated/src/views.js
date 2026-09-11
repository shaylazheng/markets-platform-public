/* The view registry — the ONE place that knows what surfaces exist and how
 * they are grouped.
 *
 * Before this file the list lived in four: store.jsx's VIEWS array (hash
 * routing), App.jsx's VIEWS map (components), TopBar.jsx's label pairs (the
 * nav) and boot.js's SURFACE_LABEL (the cover caption). Four lists that had to
 * agree, and adding a surface meant remembering all four. App.jsx still owns
 * the component map, because only it can import the components — but it now
 * asserts against this registry rather than restating it.
 *
 * Grouping exists because a flat strip stops working somewhere around ten
 * tabs, and the plan for this platform is fifteen. The groups are by QUESTION
 * ASKED, not by data source:
 *
 *   Market   what is the market doing
 *   Signals  what is the machine watching, and what has it sent
 *   Company  what is this company worth
 *   Insider  who is buying and selling their own stock, across the market
 *   Learn    teach me
 *
 * Surfaces are listed here only once they are built. A nav that advertises a
 * view with no component behind it is worse than a short nav.
 */

export const GROUPS = [
  { id: 'market', label: 'Market', views: [
    ['markets', 'Markets'],
    ['credit', 'Credit & Rates'],
    ['calendar', 'Calendar'],
    ['news', 'Newswire'],
  ]},
  /* Signals is its own group, not a fifth Market tab and not a Company tab: it
   * is the one place here that acts while you are NOT looking at it. The
   * sources run in the gateway and text the phone; these surfaces are the
   * window onto what they are watching and what they have sent.
   *
   * Two surfaces, and the split is by TIME HORIZON rather than by source:
   *
   *   Monitor   right now — is each source alive, what is it about to fire on,
   *             and what has it sent today. Refreshes every two seconds.
   *   Evidence  the record — every message every source has sent, merged onto
   *             one timeline, with the feed telemetry that explains a gap in
   *             it. This is where you go to ask "did it actually fire?" or
   *             "was the feed even up?", which the Monitor cannot answer
   *             because it shows one source at a time and only the recent tail.
   *
   * The view ids stay `alerts` and `evidence`: `alerts` is the package name,
   * the API namespace (/api/alerts) and the existing bookmark, and none of
   * those are worth breaking to make an id match a nav label. */
  { id: 'signals', label: 'Signals', views: [
    ['alerts', 'Monitor'],
    ['evidence', 'Evidence'],
  ]},
  { id: 'company', label: 'Company', views: [
    /* Summary leads the group. It is the only tab here that answers "what IS
       this company" rather than computing something about it, and the other six
       all read better once you have. */
    ['summary', 'Summary'],
    ['management', 'Management'],
    /* Industry sits between the people inside one company and the hand-picked
       peer table: the wide shot — everyone SEC registers under the company's
       own filed industry code — before Competitors narrows to a chosen few. */
    ['industry', 'Industry'],
    ['competitors', 'Competitors'],
    ['valuation', 'Valuation'],
    ['graph', 'Graph'],
    ['outlook', 'Risks & Catalysts'],
  ]},
  /* Insider is its own group rather than a fifth Company tab.
   *
   * It is the one surface here whose default state is not about a company at
   * all: it opens on a market-wide screen of every Form 4 filed, and narrowing
   * it to one issuer is a drill-in rather than its purpose. Sitting inside
   * Company it read as "the fifth thing to know about NVDA", which is the wrong
   * frame for a screener — the other four all fail without a ticker and this
   * one is at its most useful without one. */
  { id: 'insider', label: 'Insider', views: [
    ['insider', 'Insider'],
  ]},
  { id: 'learn', label: 'Learn', views: [
    ['learn', 'Learn'],
  ]},
];

/** Every view id, in nav order. store.jsx validates the hash against this. */
export const VIEW_IDS = GROUPS.flatMap((g) => g.views.map(([id]) => id));

export const VIEW_LABEL = Object.fromEntries(GROUPS.flatMap((g) => g.views));

export const DEFAULT_VIEW = 'markets';

/** Which group a view belongs to; falls back to the first so the nav always
 *  has something highlighted rather than rendering an empty second row. */
export const groupOf = (view) =>
  GROUPS.find((g) => g.views.some(([id]) => id === view))?.id || GROUPS[0].id;

export const groupById = (id) => GROUPS.find((g) => g.id === id) || GROUPS[0];

/* The company summary, fetched once per ticker and shared by every surface.
 *
 * WHY A HOOK IN THE SHELL AND NOT A FETCH IN THE RAIL. CompanyRail's own header
 * states the rule it exists to protect: it renders, it does not fetch, because
 * the shell cannot resolve a ticker — that route belongs to Competitors, and the
 * shell importing a section is the one dependency this layout forbids. A hook is
 * a different thing from the component: a surface calls it and passes the result
 * down, so the rail stays pure and the shell still imports nothing from any
 * section.
 *
 * THE CACHE IS MODULE-LEVEL, NOT PER-COMPONENT. Five surfaces show this rail and
 * you move between them with the ticker held in shared state, so a per-component
 * cache would refetch the same 10-K-derived payload on every tab change. Keyed
 * by ticker and never evicted: the payload is a few kilobytes and a session
 * looks at a handful of companies.
 */
import { useEffect, useState } from 'react';

const cache = new Map();        // ticker -> promise of the payload
const MAX = 40;

/* ---- which sections a surface wants ------------------------------------- *
 *
 * A surface that covers one of these subjects in depth should not also show the
 * rail's version of it — the Risks & Catalysts surface owns risk factors and
 * dated catalysts, so on that surface the rail's copies are duplication rather
 * than orientation. `omit` names the sections to drop.
 *
 * An ARRAY OF KEYS rather than a boolean per section, because the set of things
 * a future surface might overlap with is not knowable from here, and a component
 * accumulating `hideRisks` / `hideCatalysts` / `hideOutlook` props ends up
 * expressing the same idea four ways.
 *
 * The keys are finer-grained than the rendered headings in one place: `guidance`
 * and `catalysts` are separate even though both live under "Outlook", because
 * next quarter's guidance is worth keeping in a rail even on a surface that owns
 * the catalyst calendar. `outlook` drops both.
 */
export const SUMMARY_SECTIONS = [
  'description',      // the quoted Item 1 lede
  'figures',          // the six headline figures
  'financials',       // margins, returns, leverage, and the basis line
  'business',         // industry, segments, headcount, founded
  'counterparties',   // customers, suppliers, competitors, partners
  'concentration',    // share-of-revenue disclosures
  'guidance',         // management's stated guidance
  'catalysts',        // dated forthcoming events
  'risks',            // the filing's own risk-factor groupings
  'view',             // the hand-written thesis, moat, falsifiers
  'sources',          // provenance
  'absences',         // "what this does not say"
];

/** Group keys, expanded to the sections they cover. */
const SECTION_GROUPS = { outlook: ['guidance', 'catalysts'] };

/* Which `absent` reasons belong to which section. An omitted section takes its
   absences with it: if Risks & Catalysts owns risk factors, the rail should not
   still be explaining in "what this does not say" why IT could not group them —
   that absence is now that surface's to report, and leaving it here reads as a
   gap in a section the reader cannot see. */
const ABSENCE_OWNER = {
  description: ['description', 'business'],
  figures: ['figures'],
  financials: ['figures'],
  business: ['segments', 'employees', 'foundedYear', 'segmentRevenue'],
  counterparties: ['relationships', 'counterparties'],
  concentration: ['concentration'],
  guidance: ['guidance'],
  risks: ['riskGroups'],
  view: ['view', 'viewSample'],
};

/**
 * Normalise an `omit` prop into a Set of section keys.
 *
 * Unknown keys are dropped and, in dev, named in the console. A typo would
 * otherwise fail silently in the direction that hides nothing, which is the
 * hard one to notice — the same reason App.jsx asserts its view map against the
 * registry rather than trusting them to agree.
 */
export function normaliseOmit(omit) {
  const out = new Set();
  if (!omit) return out;
  const keys = Array.isArray(omit) ? omit : [omit];
  const unknown = [];
  for (const raw of keys) {
    const k = String(raw || '').trim().toLowerCase();
    if (!k) continue;
    if (SECTION_GROUPS[k]) { for (const s of SECTION_GROUPS[k]) out.add(s); continue; }
    if (SUMMARY_SECTIONS.includes(k)) { out.add(k); continue; }
    unknown.push(raw);
  }
  if (unknown.length && import.meta.env?.DEV) {
    console.error(`[CompanySummary] omit: unknown section${unknown.length > 1 ? 's' : ''} `
      + `${unknown.map((u) => JSON.stringify(u)).join(', ')}. `
      + `Known: ${[...SUMMARY_SECTIONS, ...Object.keys(SECTION_GROUPS)].join(', ')}`);
  }
  return out;
}

/**
 * The `absent` entries still worth printing, given what has been omitted.
 * @returns {Array<[string, string]>}
 */
export function visibleAbsences(absent, omitted = new Set()) {
  const hidden = new Set();
  for (const section of omitted) for (const k of ABSENCE_OWNER[section] || []) hidden.add(k);
  return Object.entries(absent || {})
    .filter(([k, v]) => !hidden.has(k) && String(v ?? '').trim());
}

export function fetchCompanySummary(ticker) {
  const t = String(ticker || '').trim().toUpperCase();
  if (!t) return Promise.resolve(null);
  if (!cache.has(t)) {
    const p = fetch(`/api/peers/summary?ticker=${encodeURIComponent(t)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code });
        return j;
      })
      // A failure must not be cached, or one flaky request poisons the ticker
      // for the rest of the session.
      .catch((e) => { cache.delete(t); throw e; });
    if (cache.size >= MAX) cache.delete(cache.keys().next().value);
    cache.set(t, p);
  }
  return cache.get(t);
}

export const clearCompanySummaryCache = () => cache.clear();

/**
 * @param {string} ticker
 * @returns {{data: object|null, loading: boolean, error: string|null}}
 */
export function useCompanySummary(ticker, rev = 0) {
  const [state, setState] = useState({ data: null, loading: !!ticker, error: null });

  useEffect(() => {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) { setState({ data: null, loading: false, error: null }); return undefined; }

    /* Discard a late response for a ticker we have since moved off. Without
       this, typing NVDA then MU shows Micron's rail with NVIDIA's summary under
       it for as long as the slower request takes — and the summary is the slow
       one on a cold cache, because it may be pulling a 10-K. */
    let live = true;
    setState((s) => ({ data: s.data, loading: true, error: null }));
    fetchCompanySummary(t)
      .then((data) => { if (live) setState({ data, loading: false, error: null }); })
      .catch((e) => { if (live) setState({ data: null, loading: false, error: e.message }); });
    return () => { live = false; };
  /* rev: a caller-driven refetch — bumped when background research lands. */
  }, [ticker, rev]);

  return state;
}

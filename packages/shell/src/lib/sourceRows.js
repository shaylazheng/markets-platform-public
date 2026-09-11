/* The source-row vocabulary, shared by every surface's source inspector.
 *
 * Competitors built the idiom (packages/competitors/src/peerSources.js) and the
 * graph's sidebar built it first; this file is the part of it that is not about
 * peers at all — what a source row IS, how a date or frame prints, and which
 * documents back any claim about a company — promoted to the shell so Summary,
 * Management, Industry, Valuation, Outlook and Report can make the same
 * distinctions in the same words. Competitors imports these back rather than
 * keeping its own copy.
 *
 * A source row is { type, label, url, truth, detail? }. `truth` means a PRIMARY
 * document — the filing the number was actually tagged in, not a search that
 * would find one. Inspectors render truth rows above the rest under their own
 * heading, so every surface makes the same claim in the same place.
 *
 * Pure. Everything here takes data and returns data.
 */

/* The full type vocabulary, in the order rows rank. The first five are the
   graph/competitors vocabulary; the last four map the surface-source registry
   (apps/consolidated/src/sources.js) into the same row idiom, so a registry
   entry and a traced filing can sit in one list without inventing a second
   visual language. */
export const TYPE_ORDER = ['SEC filing', 'XBRL fact', 'Market data', 'Investor page',
                           'Recorded', 'Live feed', 'News search',
                           'On this machine', 'Computed here', 'Platform'];
export const typeRank = (t) => { const i = TYPE_ORDER.indexOf(t); return i < 0 ? 99 : i; };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (s) => {
  const m = String(s || '').match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  return m ? (m[3] ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : `${MONTHS[+m[2] - 1]} ${m[1]}`) : (s || '—');
};

export const fmtFrame = (f) => {
  const q = /^CY(\d{4})Q(\d)I?$/.exec(String(f || ''));
  if (q) return `Q${q[2]} ${q[1]}`;
  const y = /^CY(\d{4})$/.exec(String(f || ''));
  return y ? y[1] : (f || '—');
};

/* Date-scoped news search when the claim carries a date: an unscoped search
   for a two-year-old move returns this week's coverage. */
const shiftDate = (iso, days) => {
  const m = String(iso || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(new Date(+m[1], +m[2] - 1, +m[3]).getTime() + days * 864e5)
    .toISOString().slice(0, 10);
};
export function newsSource(ticker, query, aroundDate) {
  const range = aroundDate
    ? ` after:${shiftDate(aroundDate, -1)} before:${shiftDate(aroundDate, 4)}` : '';
  return {
    type: 'News search',
    label: aroundDate ? 'News coverage around that date' : 'News coverage of this claim',
    url: `https://www.google.com/search?q=${encodeURIComponent(`${ticker} ${String(query).slice(0, 80)}${range}`)}&tbm=nws`,
  };
}

/** The EDGAR index page for one filing, from parts every payload already
 *  carries. Client-side twin of core/lib/provenance.js `filingUrl` — the index
 *  page rather than a guessed primary document, because an index always
 *  resolves. */
export const filingIndexUrl = (cik, accn) => {
  if (!accn) return null;
  const n = String(cik ?? '').replace(/\D/g, '').replace(/^0+/, '') || '0';
  const bare = String(accn).replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${n}/${bare}/${accn}-index.htm`;
};

/** The filings and endpoints that back any claim about this company, from a
 *  provenance payload's `filings` block. */
export function companySources(prov) {
  const f = prov?.filings || {};
  const out = [];
  if (f.tenK?.url) {
    out.push({ type: 'SEC filing', truth: true,
      label: `Latest annual report · ${f.tenK.form}, ${fmtDate(f.tenK.filed)}`, url: f.tenK.url });
  }
  if (f.tenQ?.url) {
    out.push({ type: 'SEC filing',
      label: `Latest quarterly report · ${f.tenQ.form}, ${fmtDate(f.tenQ.filed)}`, url: f.tenQ.url });
  }
  if (f.companyFacts) {
    out.push({ type: 'XBRL fact', label: 'Every XBRL fact SEC holds for this company', url: f.companyFacts });
  }
  if (f.ir) out.push({ type: 'Investor page', label: 'Investor relations — calls & materials', url: f.ir });
  if (f.edgarAll) out.push({ type: 'SEC filing', label: 'All company filings on EDGAR', url: f.edgarAll });
  return out;
}

/**
 * Sources for one metric on one company: the actual facts first, then the
 * company's filings as context. Works for any surface whose figures come off
 * the shared provenance payload (/api/peers/provenance) — Competitors' cells,
 * Summary's figure strip, Valuation's DCF inputs.
 *
 * A DERIVED quarter is not `truth`. It was never filed as a discrete number —
 * it was differenced out of year-to-date rows — so the filing it links to
 * supports the arithmetic, not the figure, and the green "official source"
 * heading would overclaim.
 */
export function metricSources(prov, metricId, ticker) {
  if (!prov) return [];
  const spec = prov.metricInputs?.[metricId] || {};
  const out = [];
  const seen = new Set();

  const fromConcept = (trace, when) => {
    if (!trace) return;
    for (const p of trace.parts || []) {
      if (!p.url || seen.has(p.url)) continue;
      seen.add(p.url);
      out.push({ type: 'SEC filing', truth: !p.derived,
        label: `${trace.label}${when ? ` (${when})` : ''} · ${p.form}, ${fmtDate(p.filed)}`,
        url: p.url });
    }
    const first = (trace.parts || [])[0];
    if (first?.conceptUrl && !seen.has(first.conceptUrl)) {
      seen.add(first.conceptUrl);
      out.push({ type: 'XBRL fact',
        label: `${first.taxonomy}:${first.tag} — every period SEC holds`, url: first.conceptUrl });
    }
  };

  for (const id of spec.flows || []) fromConcept(prov.concepts?.[id]);
  for (const id of spec.instants || []) fromConcept(prov.concepts?.[id]);
  for (const id of spec.priors || []) fromConcept(prov.priors?.[id], fmtFrame(prov.priorFrame));

  if (spec.market && prov.market) {
    out.push({ type: 'Market data',
      label: `Close $${Number(prov.market.close).toFixed(2)} on ${fmtDate(prov.market.date)} — ${prov.market.source || 'local price history'}`,
      url: `https://finance.yahoo.com/quote/${ticker}/history/` });
  }
  for (const s of companySources(prov)) if (!seen.has(s.url)) { seen.add(s.url); out.push(s); }
  return out.sort((a, b) => typeRank(a.type) - typeRank(b.type));
}

/** The concept traces to decompose under a metric, in the order it reads them. */
export function metricTraces(prov, metricId) {
  if (!prov) return [];
  const spec = prov.metricInputs?.[metricId] || {};
  return [...(spec.flows || []), ...(spec.instants || [])]
    .map((id) => prov.concepts?.[id])
    .filter(Boolean);
}

/* How a registry kind prints as a row type. The registry's four kinds exist
   because sources age and fail differently; the mapping keeps that reading. */
const KIND_TYPE = {
  feed: 'Live feed',
  filing: 'SEC filing',
  local: 'On this machine',
  derived: 'Computed here',
};

/**
 * The surface-source registry rows (apps/consolidated/src/sources.js), as
 * inspector rows — the default view of every inspector: what this whole
 * surface relies on, before any single figure is asked about.
 */
export function registryRows(entries = []) {
  return entries.map((s) => ({
    type: KIND_TYPE[s.kind] || s.kind,
    truth: s.kind === 'filing',
    label: s.label,
    detail: s.detail || null,
    url: s.href || null,
  }));
}

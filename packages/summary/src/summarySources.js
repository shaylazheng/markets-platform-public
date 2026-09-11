/* Source composition for the Summary surface — the pure half of its inspector,
 * in the mould of competitors/src/peerSources.js.
 *
 * The payload already names its documents (`sources[]`, each with an id the
 * per-line `refs` map points into) and the concentration entries carry their
 * own recorded primary sources. This module turns a selected line into the
 * inspector's three answers — what is claimed, how it was arrived at, which
 * documents back it — and maps the payload's document list into the shared row
 * vocabulary for the default view. Takes data, returns data.
 */
import {
  fmtFrame, metricSources, newsSource,
} from '@markets/shell/lib/sourceRows.js';

/* The payload's document kinds, in the shared row vocabulary. 'Hand-written'
   has no shared type on purpose — it passes through and renders with the
   neutral badge, which is the right amount of authority for an opinion. */
const TYPE_BY_KIND = {
  'SEC filing': 'SEC filing',
  'Market data': 'Market data',
  Derived: 'Computed here',
  'Local research': 'On this machine',
};

const docRow = (s, { truth = false } = {}) => s && ({
  type: TYPE_BY_KIND[s.kind] || s.kind,
  truth: truth && !!s.url,
  label: s.label,
  detail: s.detail || null,
  url: s.url || null,
});

const byId = (data, id) => (data?.sources || []).find((s) => s.id === id) || null;

/** The default view: every document this company's page actually drew on.
 *  The annual report is the one primary document — everything else is a feed,
 *  a computation, research, or opinion, and the split should say so. */
export function defaultRows(data) {
  return (data?.sources || []).map((s) => docRow(s, { truth: s.id === 'annual' }))
    .filter(Boolean);
}

/* How each document kind earns its content — the method sentence the claim
   alone cannot carry. */
const KIND_METHOD = {
  annual: 'Read from the filing itself and quoted verbatim where a sentence is shown — a wrong paraphrase reads exactly as confidently as a right one, so nothing here is paraphrased.',
  submissions: 'From SEC\'s submissions feed for this registrant — the registrant\'s own statement, not an inference.',
  xbrl: 'Computed from SEC XBRL companyfacts on the same TTM-or-annual frame Competitors and Valuation use, so a figure here cannot disagree with the identical figure there.',
  intel: 'From the researched earnings intel (data/earnings/<TICKER>.json) — researched by headless Claude at real cost, read and never regenerated; as current as its own asOf date.',
  peersuggest: 'Suggested by the peer layer — the company\'s own 10-K first, then filings that name it, then shared industry code. Breadth only at the SIC end: a shared code is not a claim that two companies compete.',
  concentration: 'Share-of-revenue sentences read from filing text by a deliberately conservative parser that declines rather than guesses — SEC\'s flattened XBRL drops the dimensional axes these are tagged on.',
  segments: 'Read from the filing\'s extracted XBRL instance document, the one SEC artifact where the business-segments axis survives (companyfacts flattens it away). Members, figures and the prior year are the filing\'s own tags; a split that cannot be read is declined with its reason, never reconstructed from prose.',
  market: 'From the local price table — CRSP via synthetic sample through 2025-12-31, yfinance after. Not a live quote.',
  prices: 'Arithmetic over the local daily-close series (CRSP via synthetic sample through 2025-12-31, yfinance after): range, returns, drawdown and realised volatility are properties of the series itself, no model. A window the series does not fully cover is a dash, never a shortened window wearing the full label.',
  geo: 'Read from the filing\'s extracted XBRL instance on the geographical axis — the same document and the same standard as the segment split: tagged figures only, tie-out enforced, an overlapping tagging declined rather than double-counted, and a partial country breakout reported with its undisclosed remainder.',
  note: 'The hand-written note, reproduced verbatim. Opinion by design; it has no external source because it is not a claim about the world.',
};

/** {claim, method, note} for one selected line. The claim states the datum;
 *  the refs entry's section string says where in the document it lives; the
 *  quotes ride along as the note, because the filing's own sentence outranks
 *  anything this platform could say about it. */
export function describe(sel, data, refs) {
  if (!sel) return null;
  if (sel.kind === 'metric') {
    return {
      claim: `${sel.label} for ${data?.identity?.ticker || ''} is ${sel.display} in ${fmtFrame(sel.frame)}.`,
      method: KIND_METHOD.xbrl,
    };
  }
  if (sel.kind === 'market') {
    return {
      claim: `${sel.label} at the last close${data?.scale?.priceDate ? ` on ${data.scale.priceDate}` : ''} — pinned to today rather than to the selected fiscal year, because pricing an old balance sheet with today's close manufactures a figure no one ever traded at.`,
      method: KIND_METHOD.market,
    };
  }
  const r = refs?.[sel.key];
  if (!r) return { claim: '', method: '' };
  const quotes = [].concat(r.quote || []).filter(Boolean);
  return {
    claim: r.section,
    method: KIND_METHOD[r.src] || '',
    note: quotes.length ? quotes.map((q) => `“${q}”`).join('  ') : null,
  };
}

/** Rows for one selected line: the primary document first, then what backs it. */
export function sourcesFor(sel, data, refs, prov) {
  if (!sel || !data) return [];
  const t = data.identity?.ticker || '';

  if (sel.kind === 'metric') return metricSources(prov, sel.metricId, t);
  if (sel.kind === 'market') {
    return [
      docRow(byId(data, 'market')),
      { type: 'Market data', label: `${t} price history`,
        url: `https://finance.yahoo.com/quote/${t}/history/` },
      docRow(byId(data, 'xbrl')),
    ].filter(Boolean);
  }

  const r = refs?.[sel.key];
  if (!r) return [];
  const out = [];

  if (sel.key === 'concentration') {
    /* Each concentration entry recorded its primary source at research time —
       re-emit them, exactly as the graph's inspector does for the same rows. */
    for (const c of (data.concentration || []).slice(0, 4)) {
      for (const s of c.sources || []) {
        out.push({ type: s.kind === 'Recorded' ? 'Recorded' : (TYPE_BY_KIND[s.kind] || s.kind),
                   truth: !!s.truth && !!s.url, label: `${c.counterparty} — ${s.label}`,
                   url: s.url || null });
      }
    }
  }

  if (sel.key === 'competitorsRow' && r.src === 'peersuggest') {
    for (const c of (data.competitors || []).slice(0, 5)) {
      if (String(c.source).includes('10-K')) {
        out.push({ type: 'SEC filing', truth: true,
          label: `10-K filings naming both ${t} and ${c.ticker} (how this link was found)`,
          url: `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(`"${t}" "${c.ticker}"`)}&forms=10-K` });
      }
    }
  }

  const primary = byId(data, r.src);
  if (primary) out.push(docRow(primary, { truth: r.src === 'annual' }));

  /* Context: the annual report backs nearly every line on the page, and the
     submissions feed backs the identity block — both are one click a reader
     should never have to hunt for. */
  for (const id of ['annual', 'submissions']) {
    if (id !== r.src && !out.some((s) => s.url && s.url === byId(data, id)?.url)) {
      const s = byId(data, id);
      if (s) out.push(docRow(s, { truth: id === 'annual' }));
    }
  }

  if (['guidance', 'catalysts'].includes(sel.key)) {
    out.push(newsSource(t, sel.key === 'guidance' ? 'guidance' : 'catalyst', data.outlook?.asOf));
  }
  return out.filter(Boolean);
}

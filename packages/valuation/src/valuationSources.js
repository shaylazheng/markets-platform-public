/* Source composition for the Valuation surface — the pure half of its
 * inspector, in the mould of competitors/src/peerSources.js.
 *
 * Everything here reads `data.trace`, which the route ships with the payload:
 * the same buildProvenance() traces the Competitors inspector fetches, but
 * resolved server-side on the exact frame the model ran on, so the inspector
 * cannot trace a number the surface is not showing. Takes data, returns data.
 */
import {
  companySources, fmtDate, fmtFrame, registryRows, typeRank,
} from '@markets/shell/lib/sourceRows.js';

/* Which traced concepts each selectable figure is built from. Debt is listed
   both ways it can be tagged; tracesFor() keeps whichever the filer used. */
const INPUTS = {
  revenue: { label: 'Revenue', concepts: ['revenue'] },
  fcf: { label: 'Free cash flow', concepts: ['cfo', 'capex'] },
  margin: { label: 'FCF margin', concepts: ['cfo', 'capex', 'revenue'] },
  ev: { label: 'Enterprise value',
        concepts: ['cash', 'longTermDebtTotal', 'debtCurrent', 'ltDebtNoncurrent',
                   'ltDebtCurrent', 'sharesOutstanding', 'dilutedShares'],
        market: true },
  evToFcf: { label: 'EV / FCF',
             concepts: ['cfo', 'capex', 'cash', 'longTermDebtTotal', 'debtCurrent',
                        'ltDebtNoncurrent', 'ltDebtCurrent', 'sharesOutstanding',
                        'dilutedShares'],
             market: true },
  model: { label: 'The model',
           concepts: ['revenue', 'cfo', 'capex', 'cash', 'longTermDebtTotal',
                      'debtCurrent', 'ltDebtNoncurrent', 'ltDebtCurrent',
                      'sharesOutstanding', 'dilutedShares'],
           traces: ['revenue', 'cfo', 'capex'],
           market: true, derived: true },
  trailing: { label: 'Trailing growth', concepts: ['revenue'], prior: true },
  price: { label: 'Price', concepts: [], market: true },
  peers: { label: 'Comparable multiples' },
};

/** The concept traces behind one selection, for the decomposition tables.
 *  `traces` caps a wide selection at the concepts worth decomposing — ten
 *  tables under "the model" would bury the rows they exist to support. */
export function tracesFor(sel, data) {
  const spec = INPUTS[sel?.input];
  const c = data?.trace?.concepts || {};
  if (!spec) return [];
  const out = (spec.traces || spec.concepts || []).map((id) => c[id]).filter(Boolean);
  if (spec.prior && data?.trace?.priorRevenue) out.push(data.trace.priorRevenue);
  return out;
}

/** Rows for one selection: the actual facts first, then the company's filings
 *  as context — the same order and truth rules as the Competitors inspector.
 *  A DERIVED quarter is not `truth`: the filing it links to supports the
 *  arithmetic, not the figure. */
export function sourcesFor(sel, data) {
  const spec = INPUTS[sel?.input];
  if (!spec || !data) return [];
  if (sel.input === 'peers') {
    return [
      ...(sel.tickers || []).map((tk) => ({
        type: 'SEC filing',
        label: `All ${tk} filings on EDGAR`,
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${encodeURIComponent(tk)}&type=10-K`,
      })),
      { type: 'Computed here',
        label: 'Each multiple is built from that peer’s own XBRL on the same basis as the focal company — same provenance path, same refusal rules (banks, insurers, ADRs excluded)',
        url: null },
    ];
  }
  const t = data.trace || {};
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

  for (const id of spec.concepts || []) fromConcept(t.concepts?.[id]);
  if (spec.prior) fromConcept(t.priorRevenue, fmtFrame(t.priorFrame));

  if (spec.market && t.market) {
    out.push({ type: 'Market data',
      label: `Close $${Number(t.market.close).toFixed(2)} on ${fmtDate(t.market.date)} — local price history (CRSP via synthetic sample, then yfinance)`,
      url: `https://finance.yahoo.com/quote/${data.ticker}/history/` });
  }
  if (spec.derived) {
    out.push({ type: 'Computed here',
      label: 'server/dcf.js — two-stage reverse DCF, margin pinned, solved by bisection',
      url: null });
  }
  for (const s of companySources({ filings: data.filings })) {
    if (!seen.has(s.url)) { seen.add(s.url); out.push(s); }
  }
  return out.sort((a, b) => typeRank(a.type) - typeRank(b.type));
}

/** What is claimed and how it was arrived at, per selection. */
export function describe(sel, data) {
  if (!sel || !data) return { claim: '', method: '' };
  const i = data.inputs || {};
  const a = data.assumptions || {};
  const pc = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
  const frame = fmtFrame(data.frame);
  const basis = /Q\d/.test(String(data.frame)) ? 'trailing-twelve-month' : 'annual';
  const xbrl = 'Read from SEC XBRL — company filings only, nothing researched or estimated.';
  switch (sel.input) {
    case 'revenue':
      return { claim: `Revenue for ${data.ticker} on the ${frame} ${basis} basis.`, method: xbrl };
    case 'fcf':
      return {
        claim: `Free cash flow for ${data.ticker} is cash from operations less capital expenditure, on the ${frame} ${basis} basis.`,
        method: xbrl,
      };
    case 'margin':
      return {
        claim: `The ${pc(i.margin)} FCF margin is free cash flow over revenue, both ${frame} ${basis}.`,
        method: `${xbrl} The model holds this margin flat — it is the pinned input, because letting growth and margin both vary makes the answer unidentifiable.`,
      };
    case 'ev':
      return {
        claim: `Enterprise value is market cap ${i.netDebt < 0 ? 'less net cash' : 'plus net debt'} — shares × the last close, adjusted for cash and debt as filed.`,
        method: 'Share count and balance-sheet levels from SEC XBRL; the close from this platform’s own price history. The debt total is assembled the way ratios.js does it, so leverage here and on Competitors is the same number.',
      };
    case 'evToFcf':
      return {
        claim: `${data.ticker} trades at ${data.evToFcf == null ? '—' : `${data.evToFcf.toFixed(1)}×`} enterprise value per dollar of trailing free cash flow.`,
        method: 'Both sides from the documents below: EV from filings plus a share price, FCF from filings only.',
      };
    case 'trailing':
      return {
        claim: `Trailing growth is ${frame} revenue against the same period a year earlier — a single YoY rate, not a trend.`,
        method: `${xbrl} One prior year is all the trace carries, so it is labelled as one year rather than dressed up as a history.`,
      };
    case 'price':
      return {
        claim: `$${data.price?.price ?? '—'} is the last close on ${fmtDate(data.price?.date)} from the local price table.`,
        method: 'CRSP via synthetic sample through 2025-12-31, yfinance after. Not a live quote.',
      };
    case 'model':
      return {
        claim: sel.claim
          || `The implied figure is the growth rate that makes a two-stage DCF equal today's enterprise value — ${pc(data.implied?.growth)} over ${a.years} years at a ${pc(a.wacc)} discount rate.`,
        method: 'Computed in server/dcf.js from the filed inputs below; the assumptions are the rail\'s sliders, not data. Read it as a statement about the PRICE, not as a valuation.',
      };
    case 'peers':
      return {
        claim: `EV / FCF for ${data.ticker} against ${sel.n ?? 'its'} comparables, discovered the way Competitors suggests peers — the company's own 10-K first.`,
        method: 'Each peer\'s multiple is computed from its own SEC XBRL and the local price table, on the same frame rules as the focal company. Median, not mean: one peer on a depressed cash-flow year makes a 200× multiple that drags an average somewhere meaningless.',
      };
    default:
      return { claim: sel.claim || '', method: '' };
  }
}

/** The default view: everything this surface relies on, this company's own
 *  filings first. */
export function defaultRows(data, registryEntries = []) {
  const seen = new Set();
  const rows = [
    ...companySources({ filings: data?.filings }),
    ...(data?.trace?.market ? [{
      type: 'Market data',
      label: `Close $${Number(data.trace.market.close).toFixed(2)} on ${fmtDate(data.trace.market.date)} — local price history`,
      url: `https://finance.yahoo.com/quote/${data.ticker}/history/`,
    }] : []),
    ...registryRows(registryEntries),
  ];
  return rows.filter((s) => {
    if (s.url && seen.has(s.url)) return false;
    if (s.url) seen.add(s.url);
    return true;
  });
}

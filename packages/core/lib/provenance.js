/* Where a number on the Competitors surface came from.
 *
 * The graph surface has a source inspector, but its provenance is looked up:
 * scripts/graph/sources.mjs matches an earnings date to the 8-K filed near it
 * and writes the pairing to disk. Here the provenance is not looked up, it is
 * CARRIED -- xbrl.js already records the tag, taxonomy, form, filing date and
 * accession number of every fact it selects, so a cell traces to the exact
 * document the number was tagged in without a single extra network call.
 *
 * The part that earns this file is TTM. A trailing-twelve-month figure is a sum
 * of four discrete quarters, each from its own filing, and some of those
 * quarters were never filed as such -- they were recovered by differencing
 * year-to-date rows or by subtracting three quarters from the fiscal year. An
 * inspector that showed one filing per number would be quietly claiming a
 * precision the number does not have. So a trace returns EVERY part, each with
 * how it was obtained, and the caller shows all of them.
 *
 * Pure. Takes a series from xbrl.js plus an optional submissions index and
 * returns plain data.
 */
import { CONCEPTS } from './xbrl.js';
import { METRICS, METRIC_INPUTS } from './ratios.js';

/** Human labels for the concept ids, so the inspector never shows a camelCase
 *  identifier to a reader. */
export const CONCEPT_LABELS = {
  revenue: 'Revenue', cogs: 'Cost of revenue', grossProfit: 'Gross profit',
  operatingIncome: 'Operating income', netIncome: 'Net income',
  rnd: 'R&D expense', sgna: 'SG&A expense', dna: 'Depreciation & amortisation',
  interestExpense: 'Interest expense', taxExpense: 'Income tax expense',
  pretaxIncome: 'Pre-tax income', cfo: 'Cash from operations',
  capex: 'Capital expenditure', epsDiluted: 'Diluted EPS',
  dilutedShares: 'Diluted share count', assets: 'Total assets',
  equity: 'Shareholders equity', cash: 'Cash & equivalents',
  shortTermInvestments: 'Short-term investments', assetsCurrent: 'Current assets',
  liabilitiesCurrent: 'Current liabilities',
  ltDebtNoncurrent: 'Long-term debt (non-current)',
  ltDebtCurrent: 'Long-term debt (current maturities)',
  shortTermBorrowings: 'Short-term borrowings',
  longTermDebtTotal: 'Long-term debt (total, incl. current)',
  debtCurrent: 'Debt, current', sharesOutstanding: 'Shares outstanding (cover page)',
};

/** How a value was obtained, in words a reader can check. */
export const METHOD_LABELS = {
  'YTD-diff': 'derived: this quarter’s year-to-date total minus the previous quarter’s',
  'FY-Q1Q2Q3': 'derived: the fiscal year minus its first three quarters',
  'NII+noninterest': 'composed: net interest income plus noninterest income, the two halves '
    + 'of a bank’s top line, because this filer tags no single revenue total',
};

const cikNum = (cik) => String(cik ?? '').replace(/\D/g, '').replace(/^0+/, '') || '0';
export const cik10 = (cik) => String(cik ?? '').replace(/\D/g, '').padStart(10, '0');

/** The EDGAR page for one filing. `primaryDocument` gives the document itself;
 *  without it the filing index always resolves, which is worth more than a
 *  guessed filename that 404s. */
export function filingUrl(cik, accn, primaryDocument = null) {
  if (!accn) return null;
  const bare = String(accn).replace(/-/g, '');
  const base = `https://www.sec.gov/Archives/edgar/data/${cikNum(cik)}/${bare}`;
  return primaryDocument ? `${base}/${primaryDocument}` : `${base}/${accn}-index.htm`;
}

/** The machine-readable series behind one concept: every period SEC holds for
 *  this tag, which is what makes a disputed number checkable rather than
 *  merely attributed. */
export function conceptUrl(cik, taxonomy, tag) {
  if (!taxonomy || !tag) return null;
  return `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik10(cik)}/${taxonomy}/${tag}.json`;
}

/** accession -> { form, filed, primaryDocument } from a submissions payload.
 *  `recent` covers roughly the last thousand filings, which is every filing any
 *  current frame can cite; anything older degrades to the index URL. */
export function filingIndex(submissions) {
  const r = submissions?.filings?.recent;
  const out = new Map();
  if (!r?.accessionNumber) return out;
  for (let i = 0; i < r.accessionNumber.length; i++) {
    out.set(r.accessionNumber[i], {
      form: r.form?.[i] || null,
      filed: r.filingDate?.[i] || null,
      primaryDocument: r.primaryDocument?.[i] || null,
      items: r.items?.[i] || '',
    });
  }
  return out;
}

/** The most recent filing of any of `forms`, best-first. */
export function latestFiling(submissions, forms) {
  const r = submissions?.filings?.recent;
  if (!r?.form) return null;
  for (const want of forms) {
    const i = r.form.findIndex((f) => f === want);
    if (i >= 0) {
      return { form: r.form[i], filed: r.filingDate[i], accn: r.accessionNumber[i],
               primaryDocument: r.primaryDocument?.[i] || null };
    }
  }
  return null;
}

const instantFrameFor = (flowFrame, series) => {
  if (/Q\d$/.test(String(flowFrame))) return `${flowFrame}I`;
  // An annual frame carries no quarter, so the balance-sheet date comes from
  // the annual fact's own period end -- the same rule computeRatios() applies.
  const end = series?.annual?.[flowFrame]?.revenue?.end;
  if (!end) return null;
  const d = new Date(end);
  return `CY${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}I`;
};

const priorFlowFrame = (frame) => {
  const q = /^CY(\d{4})Q(\d)$/.exec(String(frame));
  if (q) {
    const y = Number(q[1]) - 1;
    return `CY${y}Q${q[2]}`;
  }
  const a = /^CY(\d{4})$/.exec(String(frame));
  return a ? `CY${Number(a[1]) - 1}` : null;
};

/**
 * Trace one concept on one frame back to the facts that produced it.
 * @returns {{id, label, basis, val, derived, parts: Array}|null}
 */
export function traceConcept(series, id, frame, { cik, index } = {}) {
  const concept = CONCEPTS[id];
  if (!concept || !frame) return null;

  const part = (point, note = null) => point && ({
    frame: point.frame || null,
    val: point.val,
    tag: point.tag || null,
    taxonomy: point.taxonomy || null,
    form: point.form || null,
    filed: point.filed || null,
    accn: point.accn || null,
    start: point.start || null,
    end: point.end || null,
    restated: !!point.restated,
    derived: !!point.derived,
    method: point.method || null,
    methodLabel: point.method ? METHOD_LABELS[point.method] || point.method : null,
    // A derived quarter was never filed on its own, so it has no primary
    // document of its own either -- the link goes to the filing whose
    // cumulative rows it was differenced out of, which is the honest target.
    url: filingUrl(cik, point.accn, index?.get(point.accn)?.primaryDocument),
    conceptUrl: conceptUrl(cik, point.taxonomy, point.tag),
    note,
  });

  /* The unit rides along because the inspector prints these values, and
     xbrl.js extracts three of them: USD, `shares`, and `USD/shares`. Formatting
     everything as money renders a 25.9bn share count as "$25.93B" and a $3.42
     EPS as "$3". */
  const base = { id, label: CONCEPT_LABELS[id] || id, unit: concept.unit };

  if (concept.kind === 'instant') {
    const p = series?.instants?.[frame]?.[id];
    if (!p) return null;
    return { ...base, basis: 'instant', val: p.val, derived: false, parts: [part(p)] };
  }

  // Annual frames are filed as one fact; nothing to decompose.
  if (!/Q\d$/.test(String(frame))) {
    const p = series?.annual?.[frame]?.[id];
    if (!p) return null;
    return { ...base, basis: 'annual', val: p.val, derived: !!p.derived, parts: [part(p)] };
  }

  // TTM: four discrete quarters, each with its own filing and its own story.
  const roll = series?.ttm?.[frame]?.[id];
  if (!roll) {
    const q = series?.quarterly?.[frame]?.[id];
    return q ? { ...base, basis: 'quarter', val: q.val, derived: !!q.derived, parts: [part(q)] } : null;
  }
  const parts = (roll.inputs || [])
    .map((f) => part(series?.quarterly?.[f]?.[id]))
    .filter(Boolean);
  return { ...base, basis: 'ttm', val: roll.val, derived: !!roll.derived, parts };
}

/**
 * Everything the source inspector needs for one company on one frame.
 *
 * @param series      output of xbrl.buildSeries
 * @param frame       the evaluated flow frame, e.g. 'CY2026Q1' or 'CY2024'
 * @param opts.cik    for building URLs
 * @param opts.submissions  a SEC submissions payload, or null
 * @param opts.market       { close, date } the valuation metrics were priced on
 */
export function buildProvenance(series, frame, { cik, submissions = null, market = null } = {}) {
  const index = filingIndex(submissions);
  const iFrame = instantFrameFor(frame, series);
  const pFrame = priorFlowFrame(frame);

  // Only concepts some metric actually consumes: the inspector exists to
  // explain the table, and a fact nothing reads explains nothing.
  const wanted = new Set();
  for (const spec of Object.values(METRIC_INPUTS)) {
    for (const id of spec.flows || []) wanted.add(id);
    for (const id of spec.instants || []) wanted.add(id);
  }

  const concepts = {};
  const priors = {};
  for (const id of wanted) {
    const kind = CONCEPTS[id]?.kind;
    const t = traceConcept(series, id, kind === 'instant' ? iFrame : frame, { cik, index });
    if (t) concepts[id] = t;
  }
  for (const spec of Object.values(METRIC_INPUTS)) {
    for (const id of spec.priors || []) {
      if (priors[id] || !pFrame) continue;
      const t = traceConcept(series, id, pFrame, { cik, index });
      if (t) priors[id] = t;
    }
  }

  const tenK = latestFiling(submissions, ['10-K', '20-F', '40-F']);
  const tenQ = latestFiling(submissions, ['10-Q', '6-K']);
  const withUrl = (f) => f && { ...f, url: filingUrl(cik, f.accn, f.primaryDocument) };

  return {
    cik: cik10(cik),
    frame,
    instantFrame: iFrame,
    priorFrame: pFrame,
    concepts,
    priors,
    metricInputs: METRIC_INPUTS,
    metricLabels: Object.fromEntries(METRICS.map((m) => [m.id, m.label])),
    conceptLabels: CONCEPT_LABELS,
    market,
    filings: {
      companyFacts: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10(cik)}.json`,
      edgarAll: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik10(cik)}&type=&dateb=&owner=include&count=40`,
      fullText: 'https://www.sec.gov/edgar/search/#/',
      ir: submissions?.investorWebsite || submissions?.website || null,
      tenK: withUrl(tenK),
      tenQ: withUrl(tenQ),
    },
  };
}

/* The 12 comparison metrics, plus the descriptor table that lets the frontend
 * render any of them without knowing their names.
 *
 * Pure. Takes a series from xbrl.js (+ optional market data) and returns
 * numbers. Everything about "is this good or bad" lives in METRICS, not in the
 * renderer -- that is what keeps the surface generic across companies and makes
 * adding a 13th metric a one-line change here.
 *
 * The guards are the substance of this file. A comparison table is read at a
 * glance and ranked, so a metric that is merely WRONG is worse than one that is
 * missing: it sorts, it shades green, and nobody looks twice.
 */

/* One divide, used everywhere. Returns null rather than NaN/Infinity, because
   JSON.stringify flattens both to null anyway -- at which point "not reported"
   and "divided by zero" become indistinguishable downstream. Never coerce a
   missing input to 0; that is the same class of bug as CLAUDE.md's "missing
   price is None, not 0.0". */
export const div = (a, b) =>
  (a == null || b == null || b === 0 || !Number.isFinite(a / b)) ? null : a / b;

export const val = (bag, frame, id) => bag?.[frame]?.[id]?.val ?? null;
export const sum = (...xs) => {
  const present = xs.filter((x) => x != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
};

/* Balance-sheet items are point-in-time. Anything dividing a period FLOW by a
   stock averages the opening and closing balance -- a full year of income over
   a year-end equity base overstates returns for every growing company.
 *
 * Takes the INSTANT frame, already resolved. It used to take the flow frame and
 * derive the instant itself, which worked for `CY2026Q1` and silently failed
 * for `CY2024`: an annual frame carries no quarter, `CY2024I` is not a key any
 * balance sheet lives under, and every annual-basis filer -- which is to say
 * every foreign private issuer on the surface -- reported a null ROE with the
 * note "equity not reported" while its equity sat right there in the series. */
export const avgStock = (instants, iFrame, id) => {
  const cur = val(instants, iFrame, id);
  if (cur == null) return null;
  const m = /^(CY\d{4}Q\d)I$/.exec(String(iFrame || ''));
  const prior = m ? val(instants, instantFrame(shiftFrame(m[1], -4)), id) : null;
  return prior == null ? cur : (cur + prior) / 2;
};

export const instantFrame = (f) => (f ? `${f}I` : null);
export function shiftFrame(frame, deltaQuarters) {
  const m = /^CY(\d{4})Q(\d)$/.exec(frame || '');
  if (!m) return null;
  let y = Number(m[1]), q = Number(m[2]) + deltaQuarters;
  y += Math.floor((q - 1) / 4);
  q = ((q - 1) % 4 + 4) % 4 + 1;
  return `CY${y}Q${q}`;
}

/* SIC -> a profile, so metrics that are structurally undefined for a sector are
   marked n/a rather than ranked. A bank does not file AssetsCurrent at all --
   its balance sheet is unclassified -- so a current ratio for JPM is not
   "unusual", it does not exist. */
/* The band is DELIBERATELY NARROW -- deposit-taking banks and thrifts only
   (6020-6036 commercial banks, 6099 deposit-banking functions, 6120-6129
   savings institutions). It used to run to 6199, which swept in the whole
   consumer-credit and "finance services" tail: SIC 6199 is a catch-all that
   holds Strategy Inc (MSTR), a software company with a bitcoin treasury, whose
   gross margin, ROIC, current ratio and EV/EBITDA were all being stamped "not
   applicable for a bank".

   Narrowing is the safe direction. Getting it wrong the other way costs
   nothing: a genuine lender outside the band that files no AssetsCurrent gets a
   null current ratio noted "not reported", which is true. Getting it wrong this
   way asserts something false about the company. */
export function sectorProfile(sic) {
  const n = Number(sic);
  if (!Number.isFinite(n)) return 'general';
  if ((n >= 6020 && n <= 6036) || n === 6099 || (n >= 6120 && n <= 6129)) return 'bank';
  if (n >= 6311 && n <= 6411) return 'insurance';
  if (n === 6500 || n === 6798) return 'reit';
  return 'general';
}

/**
 * The descriptor table. Shipped WITH the data so the frontend can render a
 * metric it has never heard of.
 *
 *  higherIsBetter: true | false | null
 *    null is not a cop-out -- it is correct for market cap. Painting a number
 *    green requires knowing that more of it is better, and for scale metrics
 *    nobody does.
 *  naFor: sectors where the metric is undefined, not merely unusual. These
 *    cells are excluded from ranking so a bank cannot top a current-ratio
 *    column by reporting nothing.
 *  format: a string key, not a function -- functions do not survive JSON, and
 *    sending pre-formatted strings would break sorting.
 */
export const METRICS = [
  { id: 'revenueGrowth', label: 'Revenue growth (YoY)', category: 'growth',
    format: 'pct1', higherIsBetter: true, basis: 'ttm', naFor: [] },
  { id: 'revenueCagr3y', label: 'Revenue CAGR (3y)', category: 'growth',
    format: 'pct1', higherIsBetter: true, basis: 'annual', naFor: [] },

  { id: 'grossMargin', label: 'Gross margin', category: 'margin',
    format: 'pct1', higherIsBetter: true, basis: 'ttm', naFor: ['bank', 'insurance', 'reit'] },
  /* Banks report no OperatingIncomeLoss — their income statement has no
     operating/non-operating split — and their CFO is dominated by deposit and
     loan flows, so both margins are undefined for them, not merely missing. */
  { id: 'operatingMargin', label: 'Operating margin', category: 'margin',
    format: 'pct1', higherIsBetter: true, basis: 'ttm', naFor: ['bank'] },
  { id: 'fcfMargin', label: 'FCF margin', category: 'margin',
    format: 'pct1', higherIsBetter: true, basis: 'ttm', naFor: ['bank'] },

  { id: 'roe', label: 'Return on equity', category: 'returns',
    format: 'pct1', higherIsBetter: true, basis: 'ttm / avg equity', naFor: [] },
  { id: 'roic', label: 'Return on invested capital', category: 'returns',
    format: 'pct1', higherIsBetter: true, basis: 'ttm / avg invested capital',
    naFor: ['bank', 'insurance'] },

  { id: 'netDebtToEbitda', label: 'Net debt / EBITDA', category: 'leverage',
    format: 'x1', higherIsBetter: false, basis: 'point-in-time / ttm',
    naFor: ['bank', 'insurance'] },
  // REITs file unclassified balance sheets too — no AssetsCurrent exists.
  { id: 'currentRatio', label: 'Current ratio', category: 'leverage',
    format: 'x2', higherIsBetter: true, basis: 'point-in-time',
    naFor: ['bank', 'insurance', 'reit'] },

  { id: 'marketCap', label: 'Market cap', category: 'valuation',
    format: 'money', higherIsBetter: null, basis: 'spot', naFor: [], needsMarket: true },
  { id: 'pe', label: 'P / E', category: 'valuation',
    format: 'x1', higherIsBetter: false, basis: 'spot / ttm', naFor: [], needsMarket: true },
  { id: 'evToEbitda', label: 'EV / EBITDA', category: 'valuation',
    format: 'x1', higherIsBetter: false, basis: 'spot / ttm',
    naFor: ['bank', 'insurance'], needsMarket: true },
];

export const METRIC_BY_ID = Object.fromEntries(METRICS.map((m) => [m.id, m]));
export const CATEGORIES = [...new Set(METRICS.map((m) => m.category))];

/* Which XBRL concepts each metric is built from -- the table the source
 * inspector traces a cell back through, so "gross margin 74.1%" resolves to the
 * actual GrossProfit and Revenue facts, in the actual filings they were tagged
 * in.
 *
 * Declared rather than instrumented. computeRatios() below reads its inputs
 * into local consts and the dependencies are legible there, so threading a
 * recorder through every branch would buy nothing but a second way for the two
 * to disagree. The cost is that this table must be edited alongside the
 * arithmetic; ratios.test.js asserts every id here exists in CONCEPTS and that
 * every metric has an entry, which catches the drift that matters.
 *
 *  flows    concepts read on the evaluated flow frame (TTM or annual)
 *  priors   concepts also read on the PRIOR frame, for a change or a CAGR
 *  instants concepts read on the balance-sheet date
 *  market   the metric additionally needs a share price
 */
const DEBT_CONCEPTS = ['ltDebtNoncurrent', 'ltDebtCurrent', 'shortTermBorrowings',
                       'longTermDebtTotal', 'debtCurrent'];
const NET_DEBT_CONCEPTS = [...DEBT_CONCEPTS, 'cash', 'shortTermInvestments'];

export const METRIC_INPUTS = {
  revenueGrowth:   { flows: ['revenue'], priors: ['revenue'] },
  revenueCagr3y:   { flows: ['revenue'], priors: ['revenue'] },
  grossMargin:     { flows: ['grossProfit', 'cogs', 'revenue'] },
  operatingMargin: { flows: ['operatingIncome', 'revenue', 'costsAndExpenses',
                             'grossProfit', 'cogs', 'operatingExpenses',
                             'pretaxIncome', 'interestExpense', 'netIncome', 'taxExpense'] },
  fcfMargin:       { flows: ['cfo', 'capex', 'revenue'] },
  roe:             { flows: ['netIncome'], instants: ['equity'] },
  roic:            { flows: ['operatingIncome', 'taxExpense', 'pretaxIncome'],
                     instants: ['equity', ...NET_DEBT_CONCEPTS] },
  netDebtToEbitda: { flows: ['operatingIncome', 'dna'], instants: NET_DEBT_CONCEPTS },
  currentRatio:    { instants: ['assetsCurrent', 'liabilitiesCurrent'] },
  marketCap:       { instants: ['sharesOutstanding'], market: true },
  pe:              { flows: ['epsDiluted', 'netIncome', 'dilutedShares'], market: true },
  evToEbitda:      { flows: ['operatingIncome', 'dna'],
                     instants: ['sharesOutstanding', ...NET_DEBT_CONCEPTS], market: true },
};

/**
 * @param series   output of xbrl.buildSeries
 * @param frame    the calendar frame to evaluate, e.g. 'CY2026Q1'
 * @param market   { close, sharesOutstanding } or null
 * @param sic      SIC code string, for naFor
 * @returns { values: {metricId: number|null|'na'}, notes: {metricId: string} }
 */
export function computeRatios(series, { frame, market = null, sic = null } = {}) {
  const profile = sectorProfile(sic);
  const notes = {};
  const t = series?.ttm || {};
  const a = series?.annual || {};
  const q = series?.quarterly || {};
  const inst = series?.instants || {};

  /* Flow basis. Normally TTM, but a foreign private issuer files 20-F annually
     and is not required to file 10-Qs at all -- TSM has zero quarterly XBRL
     facts. Keying strictly on TTM would render every foreign peer as an empty
     row rather than a comparable one, so an annual frame is a first-class
     basis, not a degraded one. */
  const isAnnual = !/Q\d$/.test(String(frame));
  const flows = isAnnual ? a : t;
  if (isAnnual) notes._basis = 'annual (issuer files no quarterly XBRL)';

  const tv = (id) => val(flows, frame, id);
  const prior = isAnnual ? `CY${Number(String(frame).slice(2)) - 1}` : shiftFrame(frame, -4);

  /* A SHARE COUNT read at the frame, never through `tv`.
   *
   * `tv` reads the TTM bag, and TTM is a SUM of four quarters -- correct for
   * revenue and for EPS, and nonsense for a count of shares, which would come
   * out four times too large and take market cap and P/E with it. In practice
   * it came out null instead: TTM needs all four quarters and the Q4 diluted
   * count is routinely discarded by the negative-derivation guard, so both the
   * P/E fallback and the market-cap fallback below were silently dead code.
   * The discrete quarter is what a share count actually wants. */
  const shareCountAt = (id) => (isAnnual ? val(a, frame, id) : val(q, frame, id));

  /* The ƒ ledger: metricId -> the formula a derived input was computed by.
     Second preference only — a filed value always wins — and every entry
     surfaces in the UI as the ƒ marker, so a derived figure can never pass
     as a filed one. */
  const derived = {};
  const mark = (id, formula) => {
    derived[id] = derived[id] ? `${derived[id]}; ${formula}` : formula;
  };

  /* Operating income, filed or by identity — the chain each step of which is
     exact arithmetic over other filed facts, in strictly weakening order:
       1. revenue − total costs and expenses  (the filer's own opex-block total)
       2. gross profit − operating expenses   (the standard presentation)
       3. pretax income + interest expense    (EBIT approximation — other
          non-operating items remain inside it, which the mark says)
     Applied per BAG so the annual fallback below can reuse it. */
  const opIncFrom = (get) => {
    const direct = get('operatingIncome');
    if (direct != null) return { v: direct, drv: null };
    const rev = get('revenue');
    const cae = get('costsAndExpenses');
    if (rev != null && cae != null) {
      return { v: rev - cae, drv: 'revenue − total costs and expenses (as filed)' };
    }
    const gp = get('grossProfit')
      ?? (rev != null && get('cogs') != null ? rev - get('cogs') : null);
    const opex = get('operatingExpenses');
    if (gp != null && opex != null) {
      return { v: gp - opex, drv: 'gross profit − operating expenses (as filed)' };
    }
    const pt = get('pretaxIncome')
      ?? (get('netIncome') != null && get('taxExpense') != null
        ? get('netIncome') + get('taxExpense') : null);
    const ie = get('interestExpense');
    if (pt != null && ie != null) {
      return { v: pt + ie, drv: 'pretax income + interest expense — EBIT approximation; non-interest non-operating items remain' };
    }
    return { v: null, drv: null };
  };

  // --- income statement, TTM ---
  const revenue = tv('revenue');
  const revenuePrior = val(flows, prior, 'revenue');
  const grossProfitFiled = tv('grossProfit');
  const grossProfit = grossProfitFiled ?? (
    tv('revenue') != null && tv('cogs') != null ? tv('revenue') - tv('cogs') : null);
  if (grossProfitFiled == null && grossProfit != null) {
    mark('grossMargin', 'gross profit = revenue − cost of revenue (as filed)');
  }
  const opIncPick = opIncFrom(tv);
  const opInc = opIncPick.v;
  if (opIncPick.drv) {
    mark('operatingMargin', opIncPick.drv);
    // Everything EBITDA- or NOPAT-shaped inherits the derivation.
    for (const id of ['roic', 'netDebtToEbitda', 'evToEbitda']) mark(id, `operating income: ${opIncPick.drv}`);
  }
  const netIncome = tv('netIncome');
  const dna = tv('dna');
  const cfo = tv('cfo');
  const capex = tv('capex');
  const taxExpense = tv('taxExpense');
  // Pretax by identity where unfiled: net income + tax expense. Feeds only the
  // effective-tax-rate clamp, so it sharpens NOPAT without inventing a metric.
  const pretax = tv('pretaxIncome')
    ?? (netIncome != null && taxExpense != null ? netIncome + taxExpense : null);

  // EBITDA from OPERATING income + D&A. Building it from net income back up
  // double-counts non-operating items, which flatters conglomerates.
  const ebitda = (opInc != null && dna != null) ? opInc + dna
    : (opInc != null ? opInc : null);
  if (opInc != null && dna == null) notes.evToEbitda = 'D&A not reported; EBITDA approximated by operating income';

  const fcf = (cfo != null && capex != null) ? cfo - capex : null;

  // --- balance sheet ---
  // Instants are keyed CY..QnI. An annual frame has no quarter, so resolve the
  // balance-sheet date from the annual fact's own period end.
  const annualEnd = isAnnual ? a?.[frame]?.revenue?.end : null;
  const iF = isAnnual && annualEnd
    ? `CY${new Date(annualEnd).getUTCFullYear()}Q${Math.floor(new Date(annualEnd).getUTCMonth() / 3) + 1}I`
    : instantFrame(frame);
  const equityNow = val(inst, iF, 'equity');
  const assetsCur = val(inst, iF, 'assetsCurrent');
  const liabCur = val(inst, iF, 'liabilitiesCurrent');
  const cash = val(inst, iF, 'cash');
  const stInv = val(inst, iF, 'shortTermInvestments');

  /* Total debt, by whichever route the filer's tags support. The orders matter:
     `LongTermDebt` already INCLUDES current maturities, so it is an alternative
     to the split pair, never an addition to it -- summing both counts the
     current portion twice. Absent components stay absent rather than becoming
     zero, so "no debt reported" never masquerades as "no debt". */
  const stBorrow = val(inst, iF, 'shortTermBorrowings');
  const ltNon = val(inst, iF, 'ltDebtNoncurrent');
  const ltCur = val(inst, iF, 'ltDebtCurrent');
  const ltTotal = val(inst, iF, 'longTermDebtTotal');
  const debtCur = val(inst, iF, 'debtCurrent');

  let totalDebt = null, debtSource = null;
  if (ltNon != null) {
    totalDebt = sum(ltNon, ltCur, stBorrow); debtSource = 'split';
  } else if (ltTotal != null) {
    totalDebt = sum(ltTotal, stBorrow); debtSource = 'LongTermDebt';
  } else if (debtCur != null || stBorrow != null) {
    totalDebt = sum(debtCur, stBorrow); debtSource = 'current-only';
  }
  if (debtSource) notes._debtSource = debtSource;

  /* A COMPONENT tag winning the family (convertible notes, senior notes) is a
     floor, not a total — the filer may carry other debt it tagged elsewhere.
     Marked on every metric the figure feeds, never silently presented. */
  const debtTag = inst?.[iF]?.ltDebtNoncurrent?.tag || inst?.[iF]?.ltDebtCurrent?.tag || '';
  if (totalDebt != null && /^(ConvertibleDebt|SeniorNotes)/.test(debtTag)) {
    for (const id of ['roic', 'netDebtToEbitda', 'evToEbitda']) {
      mark(id, `debt read from ${debtTag} — a component tag; untagged debt components are not in it (a floor)`);
    }
  }

  /* The ADR check, needed here and at valuation: a 20-F cover-page share count
     is of ordinary shares while the priced line is a depositary receipt. */
  const sharesPoint = inst?.[iF]?.sharesOutstanding;
  const isAdr = /^20-F/.test(String(sharesPoint?.form || ''));

  /* THE ZERO-DEBT RULE. A repaid debt line is simply not tagged again — SEC
     facts rarely carry explicit zeros — so a debt-free filer is
     indistinguishable from an unread one by tag presence alone. The
     deterministic test: THREE consecutive balance sheets (this one and the two
     preceding quarters), each proven filed by its equity fact, each with no
     debt value in USD; no debt fact hiding in a non-USD unit; and a domestic
     filing form. Nine clean months of quarterly, DQC-validated balance sheets
     is a filer carrying no debt — treated as zero, marked ƒ. Foreign private
     issuers are excluded outright: their unit and coverage gaps are exactly
     where this inference goes wrong. */
  if (totalDebt == null && !isAdr && equityNow != null) {
    const base = /^CY\d{4}Q\dI$/.test(String(iF || '')) ? iF.slice(0, -1) : null;
    const cleanAt = (qi) => qi != null
      && val(inst, qi, 'equity') != null
      && !DEBT_CONCEPTS.some((id) => val(inst, qi, id) != null);
    const priorClean = base
      && cleanAt(instantFrame(shiftFrame(base, -1)))
      && cleanAt(instantFrame(shiftFrame(base, -2)));
    const unitHidden = (series?.warnings || []).some((w) => w.code === 'UNIT_MISMATCH'
      && DEBT_CONCEPTS.includes(w.conceptId));
    if (priorClean && !unitHidden) {
      totalDebt = 0;
      notes._debtSource = 'zero-debt (none tagged, three consecutive balance sheets)';
      for (const id of ['roic', 'netDebtToEbitda', 'evToEbitda']) {
        mark(id, 'no debt tagged on three consecutive balance sheets — treated as zero, since a repaid line is never tagged again');
      }
    }
  }
  const netDebt = totalDebt == null ? null : totalDebt - (cash ?? 0) - (stInv ?? 0);

  const values = {};
  const na = (id) => { values[id] = 'na'; notes[id] = `not applicable for a ${profile}`; };

  for (const m of METRICS) if (m.naFor.includes(profile)) na(m.id);

  const set = (id, v, note) => {
    if (values[id] === 'na') return;
    values[id] = v;
    if (note && v == null) notes[id] = note;
  };

  /* Name the input that was actually absent. A blank cell with no note reads as
     a glitch; "operating income not reported" is a fact about the filer, and it
     is the specific fact the source inspector needs in order to explain the
     dash. JPM tags no OperatingIncomeLoss and PLD no capex, so before this both
     showed an em dash with nothing behind it. */
  const missing = (...pairs) => {
    const absent = pairs.filter(([, v]) => v == null).map(([label]) => label);
    return absent.length ? `${absent.join(' and ')} not reported for ${frame}` : null;
  };

  // --- growth ---
  // abs() on the denominator: without it, a company crossing from negative to
  // positive revenue would show growth with an inverted sign.
  set('revenueGrowth', (revenue != null && revenuePrior != null && revenuePrior !== 0)
    ? (revenue - revenuePrior) / Math.abs(revenuePrior) : null,
    missing(['revenue', revenue], [`revenue for ${prior}`, revenuePrior])
      || 'no comparable prior period');

  const annualFrames = Object.keys(a).filter((f) => a[f].revenue).sort();
  const latestA = annualFrames[annualFrames.length - 1];
  const backA = annualFrames[annualFrames.length - 4];
  const r0 = val(a, backA, 'revenue'), r1 = val(a, latestA, 'revenue');
  set('revenueCagr3y', (r0 != null && r1 != null && r0 > 0 && r1 > 0)
    ? (r1 / r0) ** (1 / 3) - 1 : null,
    'fewer than four annual periods on file');

  // --- margin ---
  set('grossMargin', div(grossProfit, revenue),
    missing(['gross profit (and no revenue/COGS pair to derive it from)', grossProfit],
            ['revenue', revenue]));
  set('operatingMargin', div(opInc, revenue),
    missing(['operating income', opInc], ['revenue', revenue]));
  set('fcfMargin', div(fcf, revenue),
    missing(['cash from operations', cfo], ['capital expenditure', capex],
            ['revenue', revenue]));

  /* THE ANNUAL FALLBACK. A TTM window needs all four quarters of every input,
     and one missing quarter of a cost line blanks a margin whose annual inputs
     sit complete in the same series. When the TTM read is null and the latest
     annual frame carries both sides of the SAME ratio, compute there — a
     period substitution, so it is marked ƒ, never passed off as TTM. */
  if (!isAnnual) {
    const af = annualFrames[annualFrames.length - 1];
    const av = (id) => val(a, af, id);
    const fyFallback = (id, calc) => {
      if (!af || values[id] !== null) return;
      const r = calc();
      if (r?.v == null) return;
      values[id] = r.v;
      delete notes[id];
      mark(id, `computed on the ${af} annual frame — the TTM window is missing an input quarter`
        + (r.drv ? `; ${r.drv}` : ''));
    };
    fyFallback('grossMargin', () => {
      const gp = av('grossProfit')
        ?? (av('revenue') != null && av('cogs') != null ? av('revenue') - av('cogs') : null);
      return { v: div(gp, av('revenue')),
        drv: av('grossProfit') == null && gp != null ? 'gross profit = revenue − cost of revenue' : null };
    });
    fyFallback('operatingMargin', () => {
      const pick = opIncFrom(av);
      return { v: div(pick.v, av('revenue')), drv: pick.drv };
    });
    fyFallback('fcfMargin', () => ({
      v: (av('cfo') != null && av('capex') != null)
        ? div(av('cfo') - av('capex'), av('revenue')) : null,
      drv: null,
    }));
  }

  // --- returns ---
  // Negative equity makes ROE meaningless, NOT excellent. With negative equity
  // and negative income the naive quotient is a large POSITIVE number, which
  // then sorts to the top of the column and shades green. MSTR qualifies.
  const avgEquity = avgStock(inst, iF, 'equity');
  if (equityNow != null && equityNow <= 0) {
    set('roe', null); notes.roe = 'negative or zero shareholders equity';
  } else {
    set('roe', div(netIncome, avgEquity), 'equity not reported');
  }

  // Clamp the effective tax rate: a loss year yields a negative or >100% rate,
  // and unclamped NOPAT is then nonsense.
  const rawRate = div(taxExpense, pretax);
  const taxRate = rawRate == null ? 0.21 : Math.min(0.5, Math.max(0, rawRate));
  const nopat = opInc == null ? null : opInc * (1 - taxRate);
  const investedCapital = (totalDebt != null && equityNow != null)
    ? totalDebt + equityNow - (cash ?? 0) - (stInv ?? 0) : null;
  set('roic', (investedCapital != null && investedCapital > 0)
    ? div(nopat, investedCapital) : null,
    investedCapital != null && investedCapital <= 0
      ? 'invested capital is not positive (cash or negative equity exceeds debt + equity)'
      : 'invested capital not derivable');

  // --- leverage ---
  // Negative net debt means net cash. That is normal and good; flooring it at
  // zero would erase the distinction between a cash-rich and a debt-free firm.
  if (ebitda != null && ebitda <= 0) {
    set('netDebtToEbitda', null); notes.netDebtToEbitda = 'EBITDA is zero or negative';
  } else {
    set('netDebtToEbitda', div(netDebt, ebitda), 'debt or EBITDA not reported');
  }
  set('currentRatio', div(assetsCur, liabCur), 'current assets/liabilities not reported');

  // --- valuation ---
  /* An ADR is not a share. A foreign private issuer files its cover-page share
     count on a 20-F, and that count is of ORDINARY shares -- but the US line
     the price comes from is a depositary receipt standing for some ratio of
     them, and that ratio appears nowhere in XBRL. TSM was the case that showed
     it: 25.93bn ordinary shares (20-F, 2026-04-16) times the ADR close gives a
     $10.5T market cap for a company worth about a fifth of that, because one
     TSM ADR is five ordinary shares. The number then propagated into EV/EBITDA.
     Every price-times-share-count metric is suppressed for these issuers --
     they are unrecoverably wrong, not merely uncertain. */
  const adrNote = 'ADR — SEC reports ordinary shares and the depositary ratio is not in XBRL';

  /* Share count, best-first. The last resort is the WEIGHTED-AVERAGE DILUTED
     count from the income statement, which is not the same thing as shares
     outstanding -- it is a period average and it counts dilution -- but it is
     the only count some filers publish at all. SEC's companyfacts holds only
     what was tagged, and CME has two cover-page facts in total, both from 2010,
     while MSTR has none; both were showing a blank market cap, which then took
     EV/EBITDA down with it. Using it also makes market cap and P/E consistent,
     since P/E already prices against exactly this number. Noted either way, so
     the reader knows which they are looking at. */
  const sharesInstant = val(inst, iF, 'sharesOutstanding');
  const sharesDiluted = shareCountAt('dilutedShares');
  /* Last resort of the last resort: the most recent diluted count within the
     trailing year. A multi-class filer (Visa) tags its cover-page count per
     class — which companyfacts flattens into uselessness — and its diluted
     count can miss the exact evaluated quarter while sitting one quarter back.
     A share count moves slowly; a one-to-three-quarter-old count beats a blank
     market cap, and it is marked ƒ with its vintage. */
  let sharesStale = null, sharesStaleFrame = null;
  if (!isAnnual && sharesInstant == null && sharesDiluted == null) {
    for (let back = 1; back <= 3 && sharesStale == null; back++) {
      const f = shiftFrame(frame, -back);
      const v = val(q, f, 'dilutedShares');
      if (v != null) { sharesStale = v; sharesStaleFrame = f; }
    }
  }
  const shares = market?.sharesOutstanding ?? sharesInstant ?? sharesDiluted ?? sharesStale;
  const sharesBasis = market?.sharesOutstanding != null ? 'market'
    : sharesInstant != null ? 'reported shares outstanding'
      : sharesDiluted != null ? 'weighted-average diluted shares (no cover-page count filed)'
        : sharesStale != null ? `diluted shares as of ${sharesStaleFrame} — the latest reported count`
          : null;
  if (sharesBasis) notes._sharesBasis = sharesBasis;
  if (sharesStale != null) {
    for (const id of ['marketCap', 'pe', 'evToEbitda']) {
      mark(id, `share count from ${sharesStaleFrame}, the latest the filer reported — no count exists for ${frame}`);
    }
  }

  const mktCap = (!isAdr && market?.close != null && shares != null)
    ? market.close * shares : null;
  set('marketCap', mktCap,
    isAdr ? adrNote : market ? 'no share count of any kind filed' : 'no price data');

  // TTM earnings over the current diluted share count. `epsDiluted` is a TTM
  // sum of four quarterly EPS figures, which is right; the share count is not
  // summable, hence shareCountAt.
  const epsTtm = tv('epsDiluted');
  const eps = epsTtm ?? div(netIncome, sharesDiluted ?? sharesStale);
  // A negative P/E is not a cheap P/E. Leaving it numeric would sort a
  // loss-making company to the top of a "cheapest" ranking.
  if (isAdr) {
    // Per-ordinary-share EPS over an ADR price is wrong by the same ratio.
    set('pe', null); notes.pe = adrNote;
  } else if (eps != null && eps <= 0) {
    set('pe', null); notes.pe = 'negative or zero trailing EPS';
  } else {
    // Two different absences, two different notes. Saying "no price data" when
    // the price is present and the EPS is missing sends the reader looking in
    // the wrong place.
    set('pe', (market?.close != null && eps) ? div(market.close, eps) : null,
      market?.close == null ? 'no price data' : 'diluted EPS not reported');
  }

  const ev = mktCap == null ? null : mktCap + (totalDebt ?? 0) - (cash ?? 0) - (stInv ?? 0);
  if (ebitda != null && ebitda <= 0) {
    set('evToEbitda', null); notes.evToEbitda = 'EBITDA is zero or negative';
  } else {
    // Name the input that failed. EV/EBITDA was reporting "no price data" when
    // the price was fine and it was the market cap upstream that was missing.
    set('evToEbitda', div(ev, ebitda),
      isAdr ? adrNote
        : mktCap == null ? 'needs a market cap, which is unavailable — see that column'
          : missing(['EBITDA', ebitda]));
  }

  for (const m of METRICS) if (!(m.id in values)) values[m.id] = null;
  /* A ƒ entry only matters where a number actually shows — a derivation whose
     metric still came out null or n/a is dropped, so the marker can never
     appear beside a dash. */
  for (const id of Object.keys(derived)) {
    if (typeof values[id] !== 'number') delete derived[id];
  }
  return { frame, values, notes, derived, sectorProfile: profile };
}

/**
 * Rank rows for one metric. Nulls and 'na' are excluded entirely rather than
 * sorted to an end -- a company that reports nothing must not occupy a rank.
 * Returns { ticker: rank } with rank 1 = best per higherIsBetter.
 */
export function rankPeers(rows, metricId) {
  const d = METRIC_BY_ID[metricId];
  if (!d || d.higherIsBetter == null) return {};    // scale metrics have no "best"
  const live = rows.filter((r) => typeof r.values?.[metricId] === 'number');
  live.sort((a, b) => d.higherIsBetter
    ? b.values[metricId] - a.values[metricId]
    : a.values[metricId] - b.values[metricId]);
  return Object.fromEntries(live.map((r, i) => [r.ticker, i + 1]));
}

/** Percentile of v within arr (0..1). Used for the matrix's diverging shading. */
export function percentileRank(v, arr) {
  const live = arr.filter((x) => typeof x === 'number');
  if (live.length < 2) return null;
  const below = live.filter((x) => x < v).length;
  const equal = live.filter((x) => x === v).length;
  return (below + equal / 2) / live.length;
}

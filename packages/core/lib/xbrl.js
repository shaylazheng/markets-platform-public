/* SEC companyfacts -> a canonical, cross-company-comparable series.
 *
 * Pure: takes an already-fetched companyfacts object and returns data. No HTTP,
 * so it is unit-testable offline against pruned fixtures.
 *
 * Four things here are load-bearing, and each is a bug that would otherwise
 * ship silently and look plausible:
 *
 * 1. TAG MIGRATION. Companies move between XBRL tags mid-history. NVDA's
 *    `Revenues` runs 2008->2026 while `RevenueFromContractWithCustomer...`
 *    died in 2022; AAPL is the exact mirror (and has THREE eras). So we union
 *    every alias tag into one timeline and let tag order break ties WITHIN a
 *    period. "First tag that returns anything" truncates one company and not
 *    the other, and the comparison is then silently garbage. scan10k.mjs has
 *    this bug today: draft/NVDA.json holds a 2022 revenue beside a 2026 income.
 *
 * 2. FRAMES ARE SPARSE. Only ~40% of facts carry SEC's `frame`. Keying on it
 *    alone discards most of the history, so we derive a frame for the rest and
 *    use SEC's as the authority where present.
 *
 * 3. `fp` DOES NOT MEAN "QUARTER". SWKS files a nine-month YTD row and the
 *    actual quarter both stamped fy=2026 fp=Q3. Bucketing on `fp` picks
 *    whichever sorts first -- a 3x error. Bucket on duration in days.
 *
 * 4. THE MISSING QUARTER IS NOT AT Q4. Fiscal Q4 never appears standalone (it
 *    lives inside the 10-K), but which CALENDAR quarter it lands in depends on
 *    the fiscal year end: AAPL misses CY*Q3, NVDA misses CY*Q4. Hardcoding Q4
 *    leaves AAPL's hole open forever.
 */

/* Duration buckets, in days. Deliberately generous -- filers' quarters run
   13 weeks and drift, and 52/53-week fiscal years are common. */
const QUARTER = [80, 100];
const HALF = [170, 200];
const NINE_MONTH = [260, 290];
const ANNUAL = [340, 390];

const DAY = 86400e3;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const inRange = (n, [lo, hi]) => n >= lo && n <= hi;

/* Concepts we extract, with their alias families in precedence order.
 *
 * `kind` is what makes it structurally impossible to difference a balance
 * sheet: instants are indexed under a separate `CY..QnI` keyspace, and the
 * derivation code only ever reads `quarterly`.
 *
 * `unit` is matched STRICTLY. GLW files CNY and `segment` alongside USD, and
 * pull.mjs/scan10k.mjs both do Object.values(units)[0], which can hand you
 * yuan and compare it to dollars. */
export const CONCEPTS = {
  revenue: { kind: 'flow', unit: 'USD', tags: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues', 'SalesRevenueNet', 'SalesRevenueGoodsNet', 'SalesRevenueServicesNet',
    'RevenuesNetOfInterestExpense'],
    ifrs: ['Revenue', 'RevenueFromContractsWithCustomers'] },
  cogs: { kind: 'flow', unit: 'USD', tags: [
    'CostOfGoodsAndServicesSold', 'CostOfRevenue', 'CostOfServices', 'CostOfGoodsSold'],
    ifrs: ['CostOfSales'] },
  grossProfit: { kind: 'flow', unit: 'USD', tags: ['GrossProfit'],
    ifrs: ['GrossProfit'] },
  operatingIncome: { kind: 'flow', unit: 'USD', tags: ['OperatingIncomeLoss'],
    ifrs: ['ProfitLossFromOperatingActivities'] },
  netIncome: { kind: 'flow', unit: 'USD', tags: [
    'NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
    ifrs: ['ProfitLoss'] },
  rnd: { kind: 'flow', unit: 'USD', tags: [
    'ResearchAndDevelopmentExpense',
    'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost'],
    ifrs: ['ResearchAndDevelopmentExpense'] },
  sgna: { kind: 'flow', unit: 'USD', tags: [
    'SellingGeneralAndAdministrativeExpense', 'GeneralAndAdministrativeExpense'] },
  dna: { kind: 'flow', unit: 'USD', tags: [
    'DepreciationDepletionAndAmortization', 'DepreciationAmortizationAndAccretionNet',
    'DepreciationAndAmortization', 'Depreciation'] },
  interestExpense: { kind: 'flow', unit: 'USD', tags: [
    'InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt'] },
  taxExpense: { kind: 'flow', unit: 'USD', tags: ['IncomeTaxExpenseBenefit'] },
  pretaxIncome: { kind: 'flow', unit: 'USD', tags: [
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'] },
  cfo: { kind: 'flow', unit: 'USD', tags: [
    'NetCashProvidedByUsedInOperatingActivities',
    'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
    ifrs: ['CashFlowsFromUsedInOperatingActivities'] },
  capex: { kind: 'flow', unit: 'USD', tags: [
    'PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets',
    // GLW files capex as PaymentsForCapitalImprovements; without it the family
    // resolves to a 5-fact legacy tag and FCF margin is null for the company.
    'PaymentsForCapitalImprovements', 'PaymentsToAcquireMachineryAndEquipment',
    // BABA's only PP&E purchase line; without it FCF margin is null for it.
    'PaymentsToAcquireOtherPropertyPlantAndEquipment',
    // A REIT's capex is real estate. The combined tag first; a filer tagging
    // only one half reads as a floor, and the source inspector names the tag.
    'PaymentsToAcquireAndDevelopRealEstate', 'PaymentsToAcquireRealEstate',
    'PaymentsToDevelopRealEstateAssets'],
    ifrs: ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'] },
  /* The two opex-block totals, read ONLY by the operating-income identities in
     ratios.js (revenue − CostsAndExpenses, gross profit − OperatingExpenses).
     Neither is a metric itself. */
  costsAndExpenses: { kind: 'flow', unit: 'USD', tags: [
    'CostsAndExpenses', 'OperatingCostsAndExpenses', 'BenefitsLossesAndExpenses'] },
  operatingExpenses: { kind: 'flow', unit: 'USD', tags: ['OperatingExpenses'] },
  /* A bank's revenue is net interest income PLUS noninterest income, and many
     banks tag only those two halves and never the total. See composeBankRevenue
     below -- these two exist to be summed, and are not metrics themselves. */
  netInterestIncome: { kind: 'flow', unit: 'USD', tags: [
    'InterestIncomeExpenseNet',
    'InterestIncomeExpenseAfterProvisionForLoanLoss'] },
  noninterestIncome: { kind: 'flow', unit: 'USD', tags: [
    'NoninterestIncome', 'NoninterestIncomeOtherOperatingIncome'] },

  epsDiluted: { kind: 'flow', unit: 'USD/shares', tags: ['EarningsPerShareDiluted'] },
  dilutedShares: { kind: 'flow', unit: 'shares', tags: [
    'WeightedAverageNumberOfDilutedSharesOutstanding'] },

  // --- instants (stock). NEVER differenced. ---
  assets: { kind: 'instant', unit: 'USD', tags: ['Assets'],
    ifrs: ['Assets'] },
  equity: { kind: 'instant', unit: 'USD', tags: [
    'StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    ifrs: ['Equity', 'EquityAttributableToOwnersOfParent'] },
  cash: { kind: 'instant', unit: 'USD', tags: [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
    ifrs: ['CashAndCashEquivalents'] },
  shortTermInvestments: { kind: 'instant', unit: 'USD', tags: [
    'ShortTermInvestments', 'MarketableSecuritiesCurrent',
    'AvailableForSaleSecuritiesDebtSecuritiesCurrent'] },
  assetsCurrent: { kind: 'instant', unit: 'USD', tags: ['AssetsCurrent'],
    ifrs: ['CurrentAssets'] },
  liabilitiesCurrent: { kind: 'instant', unit: 'USD', tags: ['LiabilitiesCurrent'],
    ifrs: ['CurrentLiabilities'] },
  ltDebtNoncurrent: { kind: 'instant', unit: 'USD', tags: [
    'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations',
    // BABA carries its borrowings as convertible notes and senior notes and
    // files none of the generic tags; without these its debt reads as absent.
    'ConvertibleDebtNoncurrent', 'SeniorNotesNoncurrent'],
    ifrs: ['NoncurrentPortionOfNoncurrentBorrowings', 'LongtermBorrowings'] },
  ltDebtCurrent: { kind: 'instant', unit: 'USD', tags: [
    'LongTermDebtCurrent', 'LongTermDebtCurrentMaturities',
    'LongTermDebtAndCapitalLeaseObligationsCurrent',
    'ConvertibleDebtCurrent', 'SeniorNotesCurrent'],
    ifrs: ['CurrentPortionOfLongtermBorrowings'] },
  shortTermBorrowings: { kind: 'instant', unit: 'USD', tags: [
    'ShortTermBorrowings', 'CommercialPaper'],
    ifrs: ['ShorttermBorrowings'] },
  // `LongTermDebt` is the TOTAL carrying amount INCLUDING current maturities,
  // so it is a fallback for the split pair above and must never be added to
  // them -- that would count the current portion twice. QRVO, SWKS and GLW all
  // file it, and without this every leverage metric is null for them.
  longTermDebtTotal: { kind: 'instant', unit: 'USD', tags: [
    'LongTermDebt', 'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities',
    // CME carries its whole $3.42bn book under UnsecuredLongTermDebt and files
    // none of the tags above; without it totalDebt is null, which takes out
    // ROIC, net debt / EBITDA and EV/EBITDA in one go. A total including
    // current maturities, so it belongs here and never beside the split pair.
    'UnsecuredLongTermDebt'] },
  debtCurrent: { kind: 'instant', unit: 'USD', tags: ['DebtCurrent'] },
  /* The cover-page count first, then the balance-sheet ones. Outstanding
     before issued: issued includes treasury stock, which for a company with a
     long buyback history overstates the count badly. */
  sharesOutstanding: { kind: 'instant', unit: 'shares', taxonomy: 'dei', tags: [
    'EntityCommonStockSharesOutstanding'],
    also: [['us-gaap', ['CommonStockSharesOutstanding']]] },
};

/* Concepts that cannot legitimately be negative. A derived value that comes out
   negative for one of these is evidence the fiscal grouping went wrong, so we
   discard it rather than publish a plausible-looking wrong number. */
const NEVER_NEGATIVE = new Set(['revenue', 'cogs', 'capex', 'dilutedShares',
                                'sharesOutstanding', 'assets']);

const FORM_RANK = { '10-K': 5, '10-K/A': 4, '10-Q': 3, '10-Q/A': 2, '8-K': 1 };

/* ---- frames ------------------------------------------------------------- */

/** Snap an instant date to its calendar quarter. Suffixed `I` so an instant can
 *  never collide with — or be differenced against — a duration frame. */
export function frameForInstant(end) {
  const d = new Date(end);
  return `CY${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}I`;
}

/** Classify a duration and label it with the calendar period it best matches.
 *  Returns { frame, bucket } or null when the span is not a reporting period.
 *
 *  Labelled by MIDPOINT, not by end date. A 13-week quarter routinely ends a
 *  few weeks into the next calendar quarter -- NVDA's quarter running
 *  2025-10-27 to 2026-01-25 is mostly Nov/Dec and is CY2025Q4, not CY2026Q1.
 *  Snapping on `end` mislabels it, collides with the real CY2026Q1, and the
 *  collision then silently suppresses the derived quarter. The midpoint is
 *  what makes a Jan-FY and a Sep-FY filer land on comparable frames. */
export function frameForDuration(start, end) {
  const n = days(start, end);
  const mid = new Date((Date.parse(start) + Date.parse(end)) / 2);
  const y = mid.getUTCFullYear();

  if (inRange(n, ANNUAL)) return { frame: `CY${y}`, bucket: 'annual' };
  if (inRange(n, QUARTER)) {
    return { frame: `CY${y}Q${Math.floor(mid.getUTCMonth() / 3) + 1}`, bucket: 'quarterly' };
  }
  if (inRange(n, NINE_MONTH)) return { frame: `CY${y}M9`, bucket: 'cumulative9' };
  if (inRange(n, HALF)) return { frame: `CY${y}M6`, bucket: 'cumulative6' };
  return null;
}

/* ---- extraction --------------------------------------------------------- */

/** Union every alias tag's facts into one row set.
 *  `tagRank` breaks ties WITHIN a period; it must never filter globally, or a
 *  dead tag's coverage window silently becomes the series' extent. */
function familyFacts(cf, id, concept, warnings) {
  const out = [];
  // Foreign private issuers file 20-F under `ifrs-full`, not `us-gaap` -- TSM
  // has 334 IFRS tags and zero us-gaap ones. Without this the surface is simply
  // blank for every non-US peer, which for a semiconductor comparison means
  // losing the foundry.
  const families = [
    [concept.taxonomy || 'us-gaap', concept.tags],
    ...(concept.ifrs ? [['ifrs-full', concept.ifrs]] : []),
    // `also` is a fallback in a DIFFERENT taxonomy, ranked below the primary.
    // The cover-page share count needs it: it lives in `dei`, but SEC's
    // companyfacts holds only what the filer tagged, and coverage is wildly
    // uneven -- CME has two dei facts in total, both from 2010.
    ...(concept.also || []),
  ];
  for (const [taxonomy, tags] of families) {
    // us-gaap wins where a filer somehow has both; rank continues across
    // families so the tiebreak stays total.
    const base = out.length ? 1000 : 0;
    for (const tag of tags) {
      const node = cf?.facts?.[taxonomy]?.[tag];
      if (!node?.units) continue;
      const rows = node.units[concept.unit];
      if (!rows) {
        // Present, but in a unit we cannot compare. TSM files everything in
        // both TWD and USD; taking whichever came first would compare New
        // Taiwan dollars to US dollars.
        for (const u of Object.keys(node.units)) {
          warnings.push({ code: 'UNIT_MISMATCH', conceptId: id, detail: `${tag} in ${u}` });
        }
        continue;
      }
      for (const f of rows) {
        if (f.val == null) continue;
        // `taxonomy` rides along so provenance can name the exact concept: a
        // `GrossProfit` under ifrs-full and one under us-gaap are different
        // facts from different statements, and the source inspector links to
        // companyconcept, which is keyed by taxonomy.
        out.push({ ...f, tag, taxonomy, tagRank: base + tags.indexOf(tag) });
      }
    }
  }
  return out;
}

/** Choose one fact per (start,end). Frame and value are resolved SEPARATELY:
 *  the frame comes from whichever row SEC labelled, the value from the most
 *  recently filed row. On real data these never disagree, but that is an
 *  observed regularity rather than a documented guarantee, and decoupling means
 *  a future disagreement cannot resurrect a superseded number. */
function resolveGroup(group) {
  const framed = group.find((r) => r.frame);
  const sorted = [...group].sort((a, b) => {
    const f = String(b.filed || '').localeCompare(String(a.filed || ''));
    if (f) return f;
    const r = (FORM_RANK[b.form] || 0) - (FORM_RANK[a.form] || 0);
    if (r) return r;
    const t = a.tagRank - b.tagRank;
    if (t) return t;
    return String(b.accn || '').localeCompare(String(a.accn || ''));
  });
  const chosen = sorted[0];
  const values = new Set(group.map((r) => r.val));
  return {
    val: chosen.val, tag: chosen.tag, taxonomy: chosen.taxonomy,
    form: chosen.form, filed: chosen.filed,
    accn: chosen.accn, start: chosen.start, end: chosen.end,
    secFrame: framed?.frame || null,
    // Two rows for one period with different numbers means the filing was
    // restated. Surfaced so the UI can mark it rather than quietly showing the
    // newer figure as if it were what was originally reported.
    restated: values.size > 1,
    derived: false,
  };
}

/* ---- build -------------------------------------------------------------- */

/**
 * @param {object} companyfacts raw SEC companyfacts JSON
 * @returns {{cik, entityName, fiscalYearEnd, isCalendarFY,
 *            quarterly, annual, instants, ttm, coverage, warnings}}
 */
export function buildSeries(companyfacts, { concepts = CONCEPTS } = {}) {
  const warnings = [];
  const quarterly = {}, annual = {}, instants = {}, cumulative = {};
  const coverage = {};

  for (const [id, concept] of Object.entries(concepts)) {
    const facts = familyFacts(companyfacts, id, concept, warnings);
    if (!facts.length) continue;

    // Group by period identity. NOT by frame -- 60% of rows have none.
    const groups = new Map();
    for (const f of facts) {
      const key = concept.kind === 'instant' ? `@${f.end}` : `${f.start}|${f.end}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }

    const tagsUsed = new Set();
    const durations = [];
    for (const group of groups.values()) {
      const point = resolveGroup(group);
      tagsUsed.add(point.tag);

      if (concept.kind === 'instant') {
        put(instants, point.secFrame || frameForInstant(point.end), id, point);
        continue;
      }
      const cls = frameForDuration(point.start, point.end);
      if (!cls) continue;
      durations.push({ point, cls });
      // SEC's own label wins when it exists; ours fills the ~60% gap.
      const frame = point.secFrame || cls.frame;
      if (cls.bucket === 'quarterly') put(quarterly, frame, id, point);
      else if (cls.bucket === 'annual') put(annual, frame, id, point);
    }

    // Cash-flow and some income items are filed CUMULATIVELY: a 10-Q reports
    // year-to-date, so only fiscal Q1 is ever a discrete 90-day period. Without
    // differencing, TTM never finds four quarters and every cash-flow-derived
    // metric (FCF margin above all) is silently null for every company.
    deriveFromCumulatives(durations, quarterly, id, concept, warnings);

    coverage[id] = { tagsUsed: [...tagsUsed], periods: groups.size };
  }

  const fiscalYearEnd = inferFiscalYearEnd(annual);
  // Before the TTM rollup, so a composed quarter can complete a window.
  composeBankRevenue(quarterly, coverage, warnings);
  composeBankRevenue(annual, coverage, warnings);
  deriveMissingQuarters(quarterly, annual, concepts, warnings);
  const ttm = rollupTtm(quarterly, concepts);

  return {
    cik: companyfacts?.cik ?? null,
    entityName: companyfacts?.entityName ?? null,
    fiscalYearEnd,
    isCalendarFY: fiscalYearEnd ? fiscalYearEnd.slice(0, 2) === '12' : null,
    quarterly, annual, instants, ttm, coverage, warnings,
  };
}

const put = (bag, frame, id, point) => {
  if (!bag[frame]) bag[frame] = {};
  bag[frame][id] = { ...point, frame };
};

/* A bank's top line, composed when it is not filed as one number.
 *
 * "Revenue" for a bank is net interest income plus noninterest income, and the
 * big ones tag exactly that as `RevenuesNetOfInterestExpense` -- JPM does, which
 * is the only reason it worked. Most banks do not. Fifth Third files the two
 * halves and no total, and it also stopped tagging the fee-revenue slice this
 * resolver was falling back on: its series died at 2024-09-30 and the surface
 * showed a two-year-old row that looked current, which is worse than a blank.
 *
 * Composed rather than aliased because no single tag means this. The resolver
 * picks ONE tag per period by design -- taking whichever of the two halves
 * ranked higher would report half a bank's revenue as all of it.
 *
 * Never overwrites a filed total, and requires BOTH halves for the period: a
 * bank with only one is left blank rather than under-reported.
 */
function composeBankRevenue(bag, coverage, warnings) {
  let made = 0;
  for (const [frame, row] of Object.entries(bag)) {
    const nii = row.netInterestIncome;
    const fee = row.noninterestIncome;
    if (!nii || !fee) continue;
    if (nii.start !== fee.start || nii.end !== fee.end) continue;   // same period only

    /* A filed total wins -- EXCEPT the ASC 606 contract-revenue tag, which for
       a bank is not a total at all. It is the fee-income disclosure, a SUBSET,
       and taking it as the top line understates a bank several-fold: Zions came
       out at $0.53bn against a real $3.2bn, KeyCorp at $1.82bn against ~$7bn.
       That is far worse than the blank it replaces, because every margin
       divides by it and the number looks perfectly plausible.

       Only overridden when the composition is LARGER, so this can only ever
       correct an understatement. If a filer reports net interest income and
       noninterest income at all, their sum is its revenue and its contract
       revenue is by definition part of it. */
    const filed = row.revenue;
    if (filed) {
      const isContractSlice = /^RevenueFromContractWithCustomer/.test(String(filed.tag || ''));
      if (!isContractSlice) continue;
      if (!(nii.val + fee.val > filed.val)) continue;
      warnings.push({ code: 'CONTRACT_REVENUE_SUPERSEDED', conceptId: 'revenue', frame,
        detail: `${filed.tag} (${filed.val}) is a fee-income subset for this filer; `
          + `using net interest income + noninterest income (${nii.val + fee.val})` });
    }
    put(bag, frame, 'revenue', {
      val: nii.val + fee.val,
      tag: `${nii.tag}+${fee.tag}`, taxonomy: nii.taxonomy,
      form: nii.form, filed: nii.filed, accn: nii.accn,
      start: nii.start, end: nii.end, secFrame: null,
      restated: !!(nii.restated || fee.restated),
      derived: true, method: 'NII+noninterest',
      inputs: [nii.tag, fee.tag],
    });
    made++;
  }
  if (made) {
    coverage.revenue ??= { tagsUsed: [], periods: 0 };
    if (!coverage.revenue.tagsUsed.includes('(NII + noninterest income)')) {
      coverage.revenue.tagsUsed.push('(NII + noninterest income)');
    }
    coverage.revenue.periods += made;
    warnings.push({ code: 'COMPOSED_REVENUE', conceptId: 'revenue',
                    detail: `${made} periods composed from net interest income + noninterest income` });
  }
}

function inferFiscalYearEnd(annual) {
  const ends = Object.values(annual).map((f) => Object.values(f)[0]?.end).filter(Boolean).sort();
  if (!ends.length) return null;
  const d = new Date(ends[ends.length - 1]);
  return String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
}

/* Recover discrete quarters from year-to-date filings.
 *
 * Cumulative rows within one fiscal year all share the SAME `start` (the fiscal
 * year start) and differ only in `end`: 3mo, 6mo, 9mo, 12mo. So grouping by
 * `start` and differencing consecutive ends gives the discrete quarters --
 * discrete Q2 = YTD6 - YTD3, and so on. This is more robust than the
 * FY-minus-three-quarters route because it works mid-year, so it runs first. */
function deriveFromCumulatives(durations, quarterly, id, concept, warnings) {
  if (concept.kind !== 'flow') return;

  const byStart = new Map();
  for (const d of durations) {
    if (!byStart.has(d.point.start)) byStart.set(d.point.start, []);
    byStart.get(d.point.start).push(d);
  }

  for (const list of byStart.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => Date.parse(a.point.end) - Date.parse(b.point.end));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1].point, cur = list[i].point;
      const start = new Date(Date.parse(prev.end) + DAY).toISOString().slice(0, 10);
      const cls = frameForDuration(start, cur.end);
      if (!cls || cls.bucket !== 'quarterly') continue;
      if (quarterly[cls.frame]?.[id]) continue;      // a filed discrete value always wins

      const v = cur.val - prev.val;
      if (!Number.isFinite(v)) continue;
      if (v < 0 && NEVER_NEGATIVE.has(id)) {
        warnings.push({ code: 'DERIVED_NEGATIVE', conceptId: id, frame: cls.frame,
                        detail: 'YTD differencing produced a negative; discarded' });
        continue;
      }
      put(quarterly, cls.frame, id, {
        val: v, tag: cur.tag, taxonomy: cur.taxonomy,
        form: cur.form, filed: cur.filed, accn: cur.accn,
        start, end: cur.end, secFrame: null, restated: false,
        derived: true, method: 'YTD-diff', inputs: [prev.end, cur.end],
      });
    }
  }
}

/* Fiscal Q4 never appears as its own 10-Q -- it only exists inside the annual
   figure. Reconstruct it as FY minus the three quarters that fall inside the
   same FISCAL year, then label it with whatever CALENDAR frame the resulting
   period lands in. Grouping by calendar year instead subtracts the wrong three
   quarters and yields a plausible, wrong number. */
function deriveMissingQuarters(quarterly, annual, concepts, warnings) {
  for (const [aFrame, aFacts] of Object.entries(annual)) {
    for (const [id, aPoint] of Object.entries(aFacts)) {
      if (concepts[id]?.kind !== 'flow') continue;

      // Quarters strictly inside the annual period's own [start, end].
      const inside = [];
      for (const [qFrame, qFacts] of Object.entries(quarterly)) {
        const p = qFacts[id];
        if (!p || p.derived) continue;
        if (Date.parse(p.start) >= Date.parse(aPoint.start) - 5 * DAY &&
            Date.parse(p.end) <= Date.parse(aPoint.end) + 5 * DAY) {
          inside.push({ qFrame, ...p });
        }
      }
      if (inside.length !== 3) continue;

      const sum = inside.reduce((s, p) => s + p.val, 0);
      const val = aPoint.val - sum;
      if (!Number.isFinite(val)) continue;
      if (val < 0 && NEVER_NEGATIVE.has(id)) {
        warnings.push({ code: 'DERIVED_NEGATIVE', conceptId: id, frame: aFrame,
                        detail: 'fiscal grouping suspect; discarded' });
        continue;
      }

      // Find the hole: the stretch of the fiscal year no quarter covers. Walk
      // the gaps BETWEEN covered intervals (and the two ends) -- comparing a
      // flat sorted list of every boundary would treat each quarter's own
      // 90-day span as a gap.
      inside.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      const gaps = [];
      let cursor = Date.parse(aPoint.start);
      for (const p of inside) {
        gaps.push([cursor, Date.parse(p.start)]);
        cursor = Date.parse(p.end);
      }
      gaps.push([cursor, Date.parse(aPoint.end)]);
      const hole = gaps.find(([s, e]) => e - s > 60 * DAY);
      if (!hole) continue;
      // The gap opens the day AFTER the previous quarter's end date, except
      // where it opens at the fiscal year's own start.
      const [rawStart, gapEnd] = hole;
      const gapStart = rawStart === Date.parse(aPoint.start) ? rawStart : rawStart + DAY;
      const iso = (t) => new Date(t).toISOString().slice(0, 10);
      const cls = frameForDuration(iso(gapStart), iso(gapEnd));
      if (!cls || cls.bucket !== 'quarterly') continue;
      if (quarterly[cls.frame]?.[id]) continue;      // already have it; never overwrite

      put(quarterly, cls.frame, id, {
        val, tag: aPoint.tag, taxonomy: aPoint.taxonomy,
        form: aPoint.form, filed: aPoint.filed, accn: aPoint.accn,
        start: iso(gapStart), end: iso(gapEnd), secFrame: null, restated: false,
        derived: true, method: 'FY-Q1Q2Q3', inputs: inside.map((p) => p.qFrame),
      });
    }
  }
}

/** Trailing twelve months. All four quarters required -- annualising from two
 *  or three manufactures data. Flows only; instants have no meaningful sum. */
function rollupTtm(quarterly, concepts) {
  const frames = Object.keys(quarterly).sort(compareFrames);
  const ttm = {};
  for (let i = 3; i < frames.length; i++) {
    const window = frames.slice(i - 3, i + 1);
    const out = {};
    for (const [id, concept] of Object.entries(concepts)) {
      if (concept.kind !== 'flow') continue;
      const pts = window.map((f) => quarterly[f]?.[id]).filter(Boolean);
      if (pts.length !== 4) continue;
      out[id] = {
        val: pts.reduce((s, p) => s + p.val, 0),
        derived: pts.some((p) => p.derived),
        inputs: window,
      };
    }
    if (Object.keys(out).length) ttm[frames[i]] = out;
  }
  return ttm;
}

export function compareFrames(a, b) {
  const pa = parseFrame(a), pb = parseFrame(b);
  return pa.y - pb.y || pa.q - pb.q;
}
const parseFrame = (f) => {
  const m = /^CY(\d{4})(?:Q(\d))?/.exec(f) || [];
  return { y: Number(m[1] || 0), q: Number(m[2] || 4) };
};

/** Latest frame for which `id` has a value, or null. */
export function latestFrame(bag, id) {
  const frames = Object.keys(bag).filter((f) => bag[f][id] != null).sort(compareFrames);
  return frames.length ? frames[frames.length - 1] : null;
}

/** The most recent frame present in every series — what a comparison must key
 *  on, so peers on different fiscal calendars are lined up rather than mixed. */
export function commonFrame(seriesList, id = 'revenue', bag = 'ttm') {
  const sets = seriesList.map((s) => new Set(Object.keys(s?.[bag] || {})
    .filter((f) => s[bag][f]?.[id] != null)));
  if (!sets.length) return null;
  const shared = [...sets[0]].filter((f) => sets.every((s) => s.has(f)));
  return shared.sort(compareFrames).pop() || null;
}

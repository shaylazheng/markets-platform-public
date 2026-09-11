/* The wide metric catalogue — everything the twelve comparison metrics in
 * ratios.js deliberately leave out.
 *
 * WHY THIS IS A SEPARATE FILE AND NOT AN EDIT TO ratios.js.
 *
 * `METRICS` there is the COMPARISON table: twelve columns chosen to fit on one
 * screen and to be meaningful for almost any filer. Competitors and Valuation
 * iterate it, rank on it, and warn about coverage against it. Adding forty more
 * ids to that array would put forty columns on those surfaces and change every
 * coverage warning they print — the same reasoning the graph's `WORKING_CAPITAL`
 * block already gives for not widening `CONCEPTS`.
 *
 * So the wide catalogue lives here, and a surface opts in. The graph opts in
 * because it asks a different question: not "how do these five compare on the
 * standard measures" but "show me the one measure I care about, across every
 * company on the canvas".
 *
 * THE SECTOR PROBLEM, which is most of the difficulty.
 *
 * A bank has no gross margin, no inventory and no current ratio — its balance
 * sheet is not split into current and non-current at all. An insurer's costs
 * are claims, not cost of goods. A REIT's earnings are depressed by
 * depreciation on buildings that are appreciating, which is the entire reason
 * FFO exists. Rendering `—` for those is honest but useless; rendering a number
 * computed from mismatched inputs is worse.
 *
 * Two mechanisms, and both matter:
 *   naFor      the metric is UNDEFINED for that sector. The cell reads "n/a",
 *              and rankPeers already excludes it, so a bank cannot win a
 *              current-ratio ranking by reporting nothing.
 *   onlyFor    the metric exists ONLY for that sector — a loss ratio means
 *              nothing for a software company. Outside its sector it is not
 *              shown at all, rather than shown empty.
 *
 * WHAT IS NOT HERE. Anything needing a number that is not in companyfacts:
 * same-store sales, backlog, bookings, headcount, ARR. They are in the filings
 * as prose and this file will not guess at them.
 */
import {
  avgStock, div, instantFrame, sectorProfile, shiftFrame, sum, val,
} from './ratios.js';

/* ---- concepts ------------------------------------------------------------ */

/* Merged over CONCEPTS by the caller, never into it — see the header. Every
 * family here was checked against a real filer that files it; the comment names
 * which, because a tag list that has never met a filing is a guess with good
 * posture.
 */
export const EXTENDED_CONCEPTS = {
  // --- general ---
  inventory: { kind: 'instant', unit: 'USD', tags: ['InventoryNet', 'InventoryGross'],
    ifrs: ['Inventories'] },
  receivables: { kind: 'instant', unit: 'USD', tags: [
    'AccountsReceivableNetCurrent', 'ReceivablesNetCurrent',
    'AccountsAndOtherReceivablesNetCurrent'],
    ifrs: ['TradeAndOtherCurrentReceivables', 'CurrentTradeReceivables'] },
  liabilities: { kind: 'instant', unit: 'USD', tags: ['Liabilities'], ifrs: ['Liabilities'] },

  /* Cash returned to holders. Both are cash-flow-statement outflows and are
     filed POSITIVE (a payment), so they are not negated anywhere below. */
  dividendsPaid: { kind: 'flow', unit: 'USD', tags: [
    'PaymentsOfDividendsCommonStock', 'PaymentsOfDividends',
    'PaymentsOfDistributionsToAffiliates'],
    ifrs: ['DividendsPaidClassifiedAsFinancingActivities'] },
  buybacks: { kind: 'flow', unit: 'USD', tags: [
    'PaymentsForRepurchaseOfCommonStock', 'PaymentsForRepurchaseOfEquity'] },

  // --- banks (checked against JPM, BAC, WFC) ---
  interestIncomeTotal: { kind: 'flow', unit: 'USD', tags: [
    'InterestAndDividendIncomeOperating', 'InterestIncomeOperating'] },
  noninterestExpense: { kind: 'flow', unit: 'USD', tags: [
    'NoninterestExpense', 'OtherNoninterestExpense'] },
  provisionForCreditLosses: { kind: 'flow', unit: 'USD', tags: [
    'ProvisionForLoanLeaseAndOtherLosses', 'ProvisionForLoanAndLeaseLosses',
    'ProvisionForCreditLossesExpenseReversal'] },
  loans: { kind: 'instant', unit: 'USD', tags: [
    'LoansAndLeasesReceivableNetReportedAmount',
    'FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss',
    'NotesReceivableNet'] },
  deposits: { kind: 'instant', unit: 'USD', tags: ['Deposits', 'InterestBearingDepositLiabilities'] },

  // --- insurers (checked against PGR, ALL, TRV) ---
  premiumsEarned: { kind: 'flow', unit: 'USD', tags: [
    'PremiumsEarnedNet', 'PremiumsEarnedNetPropertyAndCasualty',
    'PremiumsEarnedNetLifeAndHealth'] },
  lossesIncurred: { kind: 'flow', unit: 'USD', tags: [
    'PolicyholderBenefitsAndClaimsIncurredNet',
    'IncurredClaimsPropertyCasualtyAndLiability',
    'PolicyholderBenefitsAndClaimsIncurredHealthCare'] },
  /* The expense half of a combined ratio. Only the explicit underwriting tags:
     substituting total SG&A here would produce a combined ratio that looks
     right, sorts, and is not a combined ratio. Where a filer tags neither, the
     ratio is null with a note — see `combinedRatio` below. */
  underwritingExpense: { kind: 'flow', unit: 'USD', tags: [
    'DeferredPolicyAcquisitionCostAmortizationExpense',
    'OtherUnderwritingExpense', 'UnderwritingCostsAndExpenses'] },

  // --- REITs (checked against PLD, SPG, O) ---
  gainOnSaleOfRealEstate: { kind: 'flow', unit: 'USD', tags: [
    'GainLossOnSaleOfProperties', 'GainLossOnSalesOfInvestmentRealEstate',
    'GainLossOnDispositionOfAssets1'] },
};

/* ---- the catalogue ------------------------------------------------------- */

const GENERAL_ONLY = ['bank', 'insurance'];

/**
 * Same descriptor shape as ratios.METRICS, plus `onlyFor`, so a renderer that
 * can draw one can draw the other without knowing which list it came from.
 */
export const EXTENDED_METRICS = [
  // --- scale. higherIsBetter is null on purpose: more revenue is not better
  //     than less revenue, it is just more, and painting it green would rank
  //     companies by size while pretending to rank them by quality. ---
  { id: 'revenueAbs', label: 'Revenue', category: 'scale', format: 'money', higherIsBetter: null, basis: 'ttm', naFor: [] },
  { id: 'grossProfitAbs', label: 'Gross profit', category: 'scale', format: 'money', higherIsBetter: null, basis: 'ttm', naFor: ['bank', 'insurance', 'reit'] },
  { id: 'ebitdaAbs', label: 'EBITDA', category: 'scale', format: 'money', higherIsBetter: null, basis: 'ttm', naFor: ['bank', 'insurance'] },
  { id: 'netIncomeAbs', label: 'Net income', category: 'scale', format: 'money', higherIsBetter: null, basis: 'ttm', naFor: [] },
  { id: 'cfoAbs', label: 'Cash from operations', category: 'scale', format: 'money', higherIsBetter: null, basis: 'ttm', naFor: [] },
  { id: 'capexAbs', label: 'Capital expenditure', category: 'scale', format: 'money', higherIsBetter: null, basis: 'ttm', naFor: [] },
  { id: 'fcfAbs', label: 'Free cash flow', category: 'scale', format: 'money', higherIsBetter: null, basis: 'ttm', naFor: [] },
  { id: 'assetsAbs', label: 'Total assets', category: 'scale', format: 'money', higherIsBetter: null, basis: 'point-in-time', naFor: [] },
  { id: 'equityAbs', label: 'Shareholders’ equity', category: 'scale', format: 'money', higherIsBetter: null, basis: 'point-in-time', naFor: [] },
  { id: 'cashAbs', label: 'Cash & short-term investments', category: 'scale', format: 'money', higherIsBetter: null, basis: 'point-in-time', naFor: [] },
  { id: 'totalDebtAbs', label: 'Total debt', category: 'scale', format: 'money', higherIsBetter: null, basis: 'point-in-time', naFor: [] },
  { id: 'netDebtAbs', label: 'Net debt', category: 'scale', format: 'money', higherIsBetter: false, basis: 'point-in-time', naFor: ['bank', 'insurance'] },

  // --- growth ---
  { id: 'netIncomeGrowth', label: 'Net income growth (YoY)', category: 'growth', format: 'pct1', higherIsBetter: true, basis: 'ttm', naFor: [] },
  { id: 'fcfGrowth', label: 'FCF growth (YoY)', category: 'growth', format: 'pct1', higherIsBetter: true, basis: 'ttm', naFor: [] },
  { id: 'epsGrowth', label: 'Diluted EPS growth (YoY)', category: 'growth', format: 'pct1', higherIsBetter: true, basis: 'ttm', naFor: [] },

  // --- margin ---
  { id: 'netMargin', label: 'Net margin', category: 'margin', format: 'pct1', higherIsBetter: true, basis: 'ttm', naFor: [] },
  { id: 'ebitdaMargin', label: 'EBITDA margin', category: 'margin', format: 'pct1', higherIsBetter: true, basis: 'ttm', naFor: GENERAL_ONLY },
  { id: 'cfoMargin', label: 'Cash conversion margin', category: 'margin', format: 'pct1', higherIsBetter: true, basis: 'ttm', naFor: [] },
  { id: 'rndIntensity', label: 'R&D / revenue', category: 'margin', format: 'pct1', higherIsBetter: null, basis: 'ttm', naFor: ['bank', 'insurance', 'reit'] },
  { id: 'sgnaIntensity', label: 'SG&A / revenue', category: 'margin', format: 'pct1', higherIsBetter: false, basis: 'ttm', naFor: ['bank', 'insurance'] },

  // --- returns ---
  { id: 'roa', label: 'Return on assets', category: 'returns', format: 'pct1', higherIsBetter: true, basis: 'ttm / avg assets', naFor: [] },
  { id: 'assetTurnover', label: 'Asset turnover', category: 'returns', format: 'x2', higherIsBetter: true, basis: 'ttm / avg assets', naFor: GENERAL_ONLY },
  { id: 'fcfConversion', label: 'FCF / net income', category: 'returns', format: 'pct1', higherIsBetter: true, basis: 'ttm', naFor: [] },

  // --- leverage ---
  { id: 'debtToEquity', label: 'Debt / equity', category: 'leverage', format: 'x2', higherIsBetter: false, basis: 'point-in-time', naFor: [] },
  { id: 'debtToAssets', label: 'Debt / assets', category: 'leverage', format: 'pct1', higherIsBetter: false, basis: 'point-in-time', naFor: [] },
  { id: 'interestCoverage', label: 'Interest coverage', category: 'leverage', format: 'x1', higherIsBetter: true, basis: 'ttm', naFor: GENERAL_ONLY },
  { id: 'quickRatio', label: 'Quick ratio', category: 'leverage', format: 'x2', higherIsBetter: true, basis: 'point-in-time', naFor: ['bank', 'insurance', 'reit'] },

  // --- valuation ---
  { id: 'ps', label: 'P / S', category: 'valuation', format: 'x1', higherIsBetter: false, basis: 'spot / ttm', naFor: [], needsMarket: true },
  { id: 'pb', label: 'P / B', category: 'valuation', format: 'x1', higherIsBetter: false, basis: 'spot / point-in-time', naFor: [], needsMarket: true },
  { id: 'evToSales', label: 'EV / Sales', category: 'valuation', format: 'x1', higherIsBetter: false, basis: 'spot / ttm', naFor: GENERAL_ONLY, needsMarket: true },
  { id: 'earningsYield', label: 'Earnings yield', category: 'valuation', format: 'pct1', higherIsBetter: true, basis: 'ttm / spot', naFor: [], needsMarket: true },
  { id: 'fcfYield', label: 'FCF yield', category: 'valuation', format: 'pct1', higherIsBetter: true, basis: 'ttm / spot', naFor: [], needsMarket: true },
  { id: 'dividendYield', label: 'Dividend yield', category: 'valuation', format: 'pct1', higherIsBetter: null, basis: 'ttm / spot', naFor: [], needsMarket: true },
  { id: 'buybackYield', label: 'Buyback yield', category: 'valuation', format: 'pct1', higherIsBetter: null, basis: 'ttm / spot', naFor: [], needsMarket: true },
  { id: 'shareholderYield', label: 'Shareholder yield', category: 'valuation', format: 'pct1', higherIsBetter: true, basis: 'ttm / spot', naFor: [], needsMarket: true },

  // --- banks only ---
  { id: 'netInterestMargin', label: 'Net interest margin', category: 'bank', format: 'pct2', higherIsBetter: true, basis: 'ttm / avg assets', naFor: [], onlyFor: ['bank'] },
  { id: 'efficiencyRatio', label: 'Efficiency ratio', category: 'bank', format: 'pct1', higherIsBetter: false, basis: 'ttm', naFor: [], onlyFor: ['bank'] },
  { id: 'loanToDeposit', label: 'Loans / deposits', category: 'bank', format: 'pct1', higherIsBetter: null, basis: 'point-in-time', naFor: [], onlyFor: ['bank'] },
  { id: 'provisionRate', label: 'Provisions / loans', category: 'bank', format: 'pct2', higherIsBetter: false, basis: 'ttm / point-in-time', naFor: [], onlyFor: ['bank'] },

  // --- insurers only ---
  { id: 'lossRatio', label: 'Loss ratio', category: 'insurance', format: 'pct1', higherIsBetter: false, basis: 'ttm', naFor: [], onlyFor: ['insurance'] },
  { id: 'expenseRatio', label: 'Underwriting expense ratio', category: 'insurance', format: 'pct1', higherIsBetter: false, basis: 'ttm', naFor: [], onlyFor: ['insurance'] },
  { id: 'combinedRatio', label: 'Combined ratio', category: 'insurance', format: 'pct1', higherIsBetter: false, basis: 'ttm', naFor: [], onlyFor: ['insurance'] },

  // --- REITs only ---
  { id: 'ffo', label: 'Funds from operations', category: 'reit', format: 'money', higherIsBetter: null, basis: 'ttm', naFor: [], onlyFor: ['reit'] },
  { id: 'pToFfo', label: 'Price / FFO', category: 'reit', format: 'x1', higherIsBetter: false, basis: 'spot / ttm', naFor: [], onlyFor: ['reit'], needsMarket: true },
  { id: 'ffoPayout', label: 'Dividend / FFO', category: 'reit', format: 'pct1', higherIsBetter: null, basis: 'ttm', naFor: [], onlyFor: ['reit'] },
];

export const EXTENDED_BY_ID = Object.fromEntries(EXTENDED_METRICS.map((m) => [m.id, m]));

/** Which XBRL concepts each metric is built from — same contract as METRIC_INPUTS. */
export const EXTENDED_INPUTS = {
  revenueAbs: { flows: ['revenue'] },
  grossProfitAbs: { flows: ['grossProfit', 'revenue', 'cogs'] },
  ebitdaAbs: { flows: ['operatingIncome', 'dna'] },
  netIncomeAbs: { flows: ['netIncome'] },
  cfoAbs: { flows: ['cfo'] },
  capexAbs: { flows: ['capex'] },
  fcfAbs: { flows: ['cfo', 'capex'] },
  assetsAbs: { instants: ['assets'] },
  equityAbs: { instants: ['equity'] },
  cashAbs: { instants: ['cash', 'shortTermInvestments'] },
  totalDebtAbs: { instants: ['ltDebtNoncurrent', 'ltDebtCurrent', 'shortTermBorrowings', 'longTermDebtTotal', 'debtCurrent'] },
  netDebtAbs: { instants: ['ltDebtNoncurrent', 'ltDebtCurrent', 'shortTermBorrowings', 'longTermDebtTotal', 'debtCurrent', 'cash', 'shortTermInvestments'] },

  netIncomeGrowth: { flows: ['netIncome'], priors: ['netIncome'] },
  fcfGrowth: { flows: ['cfo', 'capex'], priors: ['cfo', 'capex'] },
  epsGrowth: { flows: ['epsDiluted'], priors: ['epsDiluted'] },

  netMargin: { flows: ['netIncome', 'revenue'] },
  ebitdaMargin: { flows: ['operatingIncome', 'dna', 'revenue'] },
  cfoMargin: { flows: ['cfo', 'revenue'] },
  rndIntensity: { flows: ['rnd', 'revenue'] },
  sgnaIntensity: { flows: ['sgna', 'revenue'] },

  roa: { flows: ['netIncome'], instants: ['assets'] },
  assetTurnover: { flows: ['revenue'], instants: ['assets'] },
  fcfConversion: { flows: ['cfo', 'capex', 'netIncome'] },

  debtToEquity: { instants: ['ltDebtNoncurrent', 'ltDebtCurrent', 'shortTermBorrowings', 'longTermDebtTotal', 'debtCurrent', 'equity'] },
  debtToAssets: { instants: ['ltDebtNoncurrent', 'ltDebtCurrent', 'shortTermBorrowings', 'longTermDebtTotal', 'debtCurrent', 'assets'] },
  interestCoverage: { flows: ['operatingIncome', 'interestExpense'] },
  quickRatio: { instants: ['assetsCurrent', 'inventory', 'liabilitiesCurrent'] },

  ps: { flows: ['revenue'], instants: ['sharesOutstanding'], market: true },
  pb: { instants: ['equity', 'sharesOutstanding'], market: true },
  evToSales: { flows: ['revenue'], instants: ['sharesOutstanding', 'cash', 'shortTermInvestments'], market: true },
  earningsYield: { flows: ['epsDiluted', 'netIncome', 'dilutedShares'], market: true },
  fcfYield: { flows: ['cfo', 'capex'], instants: ['sharesOutstanding'], market: true },
  dividendYield: { flows: ['dividendsPaid'], instants: ['sharesOutstanding'], market: true },
  buybackYield: { flows: ['buybacks'], instants: ['sharesOutstanding'], market: true },
  shareholderYield: { flows: ['dividendsPaid', 'buybacks'], instants: ['sharesOutstanding'], market: true },

  netInterestMargin: { flows: ['netInterestIncome'], instants: ['assets'] },
  efficiencyRatio: { flows: ['noninterestExpense', 'netInterestIncome', 'noninterestIncome'] },
  loanToDeposit: { instants: ['loans', 'deposits'] },
  provisionRate: { flows: ['provisionForCreditLosses'], instants: ['loans'] },

  lossRatio: { flows: ['lossesIncurred', 'premiumsEarned'] },
  expenseRatio: { flows: ['underwritingExpense', 'premiumsEarned'] },
  combinedRatio: { flows: ['lossesIncurred', 'underwritingExpense', 'premiumsEarned'] },

  ffo: { flows: ['netIncome', 'dna', 'gainOnSaleOfRealEstate'] },
  pToFfo: { flows: ['netIncome', 'dna', 'gainOnSaleOfRealEstate'], instants: ['sharesOutstanding'], market: true },
  ffoPayout: { flows: ['netIncome', 'dna', 'gainOnSaleOfRealEstate', 'dividendsPaid'] },
};

/** Metrics that apply to a company in this sector — the `onlyFor` filter. */
export const metricsForSector = (profile, list = EXTENDED_METRICS) =>
  list.filter((m) => !m.onlyFor || m.onlyFor.includes(profile));

/**
 * Compute the wide catalogue. Mirrors computeRatios' contract exactly:
 * same arguments, same `{ values, notes }` shape, `'na'` for inapplicable.
 *
 * @param series  output of xbrl.buildSeries built over { ...CONCEPTS, ...EXTENDED_CONCEPTS }
 * @param frame   the calendar frame, e.g. 'CY2026Q1'
 */
export function computeExtended(series, { frame, market = null, sic = null } = {}) {
  const profile = sectorProfile(sic);
  const notes = {};
  const values = {};

  const a = series?.annual || {};
  const q = series?.quarterly || {};
  const inst = series?.instants || {};

  const isAnnual = !/Q\d$/.test(String(frame));
  const flows = isAnnual ? a : (series?.ttm || {});
  const tv = (id) => val(flows, frame, id);
  const prior = isAnnual ? `CY${Number(String(frame).slice(2)) - 1}` : shiftFrame(frame, -4);
  const pv = (id) => val(flows, prior, id);
  // A share count is a stock: it is never read off the TTM bag, which SUMS four
  // quarters. Same rule and same reason as computeRatios.
  const shareCountAt = (id) => (isAnnual ? val(a, frame, id) : val(q, frame, id));

  const annualEnd = isAnnual ? a?.[frame]?.revenue?.end : null;
  const iF = isAnnual && annualEnd
    ? `CY${new Date(annualEnd).getUTCFullYear()}Q${Math.floor(new Date(annualEnd).getUTCMonth() / 3) + 1}I`
    : instantFrame(frame);
  const iv = (id) => val(inst, iF, id);

  // --- shared intermediates ---
  const revenue = tv('revenue');
  const netIncome = tv('netIncome');
  const opInc = tv('operatingIncome');
  const dna = tv('dna');
  const cfo = tv('cfo');
  const capex = tv('capex');
  const fcf = (cfo != null && capex != null) ? cfo - capex : null;
  const ebitda = (opInc != null && dna != null) ? opInc + dna : null;
  const grossProfit = tv('grossProfit')
    ?? (revenue != null && tv('cogs') != null ? revenue - tv('cogs') : null);

  const assets = iv('assets');
  const equity = iv('equity');
  const cash = iv('cash');
  const stInv = iv('shortTermInvestments');
  const cashTotal = sum(cash, stInv);

  /* Total debt by the same precedence computeRatios uses — `LongTermDebt`
     INCLUDES current maturities and is an alternative to the split pair, never
     an addition to it. Duplicated deliberately rather than imported: the two
     files would have to agree anyway, and ratios.js keeps it inline. */
  const stBorrow = iv('shortTermBorrowings');
  const ltNon = iv('ltDebtNoncurrent');
  const ltCur = iv('ltDebtCurrent');
  const ltTotal = iv('longTermDebtTotal');
  const debtCur = iv('debtCurrent');
  let totalDebt = null;
  if (ltNon != null) totalDebt = sum(ltNon, ltCur, stBorrow);
  else if (ltTotal != null) totalDebt = sum(ltTotal, stBorrow);
  else if (debtCur != null || stBorrow != null) totalDebt = sum(debtCur, stBorrow);
  const netDebt = totalDebt == null ? null : totalDebt - (cashTotal ?? 0);

  const avgAssets = avgStock(inst, iF, 'assets');

  /* Market cap, on exactly the terms computeRatios sets: an ADR share count is
     of ORDINARY shares and the depositary ratio is not in XBRL, so every
     price-times-count metric is suppressed rather than published wrong. */
  const sharesPoint = inst?.[iF]?.sharesOutstanding;
  const isAdr = /^20-F/.test(String(sharesPoint?.form || ''));
  const adrNote = 'ADR — SEC reports ordinary shares and the depositary ratio is not in XBRL';
  const shares = market?.sharesOutstanding ?? iv('sharesOutstanding') ?? shareCountAt('dilutedShares');
  const mktCap = (!isAdr && market?.close != null && shares != null) ? market.close * shares : null;
  const ev = mktCap == null ? null : mktCap + (totalDebt ?? 0) - (cashTotal ?? 0);

  // --- the setter, with the same n/a discipline as computeRatios ---
  const applicable = metricsForSector(profile);
  const inScope = new Set(applicable.map((m) => m.id));
  for (const m of applicable) {
    if (m.naFor.includes(profile)) {
      values[m.id] = 'na';
      notes[m.id] = `not applicable for a ${profile}`;
    }
  }
  const set = (id, v, note) => {
    if (!inScope.has(id) || values[id] === 'na') return;
    values[id] = v;
    if (note && v == null) notes[id] = note;
  };
  const missing = (...pairs) => {
    const absent = pairs.filter(([, v]) => v == null).map(([label]) => label);
    return absent.length ? `${absent.join(' and ')} not reported for ${frame}` : null;
  };
  // Growth over a base that can be negative or zero. abs() on the denominator
  // keeps the sign meaningful when a company crosses zero; a zero or absent
  // base has no growth rate at all.
  const growth = (now, before) =>
    (now != null && before != null && before !== 0) ? (now - before) / Math.abs(before) : null;

  // --- scale ---
  set('revenueAbs', revenue, missing(['revenue', revenue]));
  set('grossProfitAbs', grossProfit, missing(['gross profit', grossProfit]));
  set('ebitdaAbs', ebitda, missing(['operating income', opInc], ['D&A', dna]));
  set('netIncomeAbs', netIncome, missing(['net income', netIncome]));
  set('cfoAbs', cfo, missing(['cash from operations', cfo]));
  set('capexAbs', capex, missing(['capital expenditure', capex]));
  set('fcfAbs', fcf, missing(['cash from operations', cfo], ['capital expenditure', capex]));
  set('assetsAbs', assets, missing(['total assets', assets]));
  set('equityAbs', equity, missing(['shareholders equity', equity]));
  set('cashAbs', cashTotal, missing(['cash', cash]));
  set('totalDebtAbs', totalDebt, 'no debt tags filed');
  set('netDebtAbs', netDebt, 'no debt tags filed');

  // --- growth ---
  set('netIncomeGrowth', growth(netIncome, pv('netIncome')), 'no comparable prior period');
  const cfoP = pv('cfo'); const capexP = pv('capex');
  const fcfPrior = (cfoP != null && capexP != null) ? cfoP - capexP : null;
  set('fcfGrowth', growth(fcf, fcfPrior), 'no comparable prior period');
  set('epsGrowth', growth(tv('epsDiluted'), pv('epsDiluted')), 'no comparable prior period');

  // --- margin ---
  set('netMargin', div(netIncome, revenue), missing(['net income', netIncome], ['revenue', revenue]));
  set('ebitdaMargin', div(ebitda, revenue), missing(['EBITDA', ebitda], ['revenue', revenue]));
  set('cfoMargin', div(cfo, revenue), missing(['cash from operations', cfo], ['revenue', revenue]));
  set('rndIntensity', div(tv('rnd'), revenue), 'no R&D expense filed');
  set('sgnaIntensity', div(tv('sgna'), revenue), 'no SG&A expense filed');

  // --- returns ---
  set('roa', div(netIncome, avgAssets), missing(['net income', netIncome], ['total assets', assets]));
  set('assetTurnover', div(revenue, avgAssets), missing(['revenue', revenue], ['total assets', assets]));
  /* FCF conversion against a LOSS is not a conversion rate. Dividing positive
     free cash flow by negative earnings yields a large negative number that
     sorts to the bottom of a column where the company in question is in fact
     the one generating cash. */
  if (netIncome != null && netIncome <= 0) {
    set('fcfConversion', null);
    notes.fcfConversion = 'net income is zero or negative, so there is no conversion rate';
  } else {
    set('fcfConversion', div(fcf, netIncome), missing(['free cash flow', fcf], ['net income', netIncome]));
  }

  // --- leverage ---
  // Negative equity makes D/E meaningless rather than excellent — the same trap
  // ROE has in computeRatios, and MSTR is again the case.
  if (equity != null && equity <= 0) {
    set('debtToEquity', null);
    notes.debtToEquity = 'negative or zero shareholders equity';
  } else {
    set('debtToEquity', div(totalDebt, equity), missing(['total debt', totalDebt], ['equity', equity]));
  }
  set('debtToAssets', div(totalDebt, assets), missing(['total debt', totalDebt], ['total assets', assets]));
  const interest = tv('interestExpense');
  /* A company with no interest expense is not infinitely covered — it is
     unlevered, and the ratio is undefined. div() already returns null on a zero
     denominator; the note is what stops that reading as a data gap. */
  set('interestCoverage', div(opInc, interest),
    interest === 0 ? 'no interest expense — the ratio is undefined, not infinite'
      : missing(['operating income', opInc], ['interest expense', interest]));
  const assetsCur = iv('assetsCurrent');
  const invty = iv('inventory');
  /* Quick ratio excludes inventory. A filer with current assets and NO
     inventory tag is usually a services company that genuinely holds none, so
     treating absent inventory as zero is right here — and is stated. */
  const quickAssets = assetsCur == null ? null : assetsCur - (invty ?? 0);
  if (assetsCur != null && invty == null) notes._quickInventory = 'no inventory tag filed; treated as nil';
  set('quickRatio', div(quickAssets, iv('liabilitiesCurrent')),
    missing(['current assets', assetsCur], ['current liabilities', iv('liabilitiesCurrent')]));

  // --- valuation ---
  const priceNote = isAdr ? adrNote : (market?.close == null ? 'no price data' : null);
  set('ps', div(mktCap, revenue), priceNote || missing(['revenue', revenue]));
  if (equity != null && equity <= 0) {
    set('pb', null); notes.pb = 'negative or zero book value';
  } else {
    set('pb', div(mktCap, equity), priceNote || missing(['equity', equity]));
  }
  set('evToSales', div(ev, revenue), priceNote || missing(['revenue', revenue]));

  // Earnings yield is the reciprocal of P/E and inherits its trap in mirror
  // image: a loss gives a NEGATIVE yield, which is not a cheap one.
  const eps = tv('epsDiluted') ?? div(netIncome, shareCountAt('dilutedShares'));
  if (isAdr) { set('earningsYield', null); notes.earningsYield = adrNote; }
  else if (eps != null && eps <= 0) {
    set('earningsYield', null); notes.earningsYield = 'negative or zero trailing EPS';
  } else {
    set('earningsYield', market?.close ? div(eps, market.close) : null, priceNote || 'diluted EPS not reported');
  }

  set('fcfYield', div(fcf, mktCap), priceNote || missing(['free cash flow', fcf]));
  /* Dividends and buybacks are cash-flow OUTFLOWS filed as positive payments,
     so a positive yield means cash returned. A company that files neither tag
     has returned nothing, which is a real answer — but "not filed" and "paid
     nothing" are not distinguishable in companyfacts, so this stays null rather
     than claiming a 0% yield. */
  const divs = tv('dividendsPaid');
  const buys = tv('buybacks');
  set('dividendYield', div(divs, mktCap), priceNote || 'no dividend payment tagged');
  set('buybackYield', div(buys, mktCap), priceNote || 'no share repurchase tagged');
  set('shareholderYield', (divs == null && buys == null) ? null : div(sum(divs, buys), mktCap),
    priceNote || 'neither dividends nor buybacks tagged');

  // --- banks ---
  const nii = tv('netInterestIncome');
  set('netInterestMargin', div(nii, avgAssets), missing(['net interest income', nii], ['total assets', assets]));
  /* Efficiency ratio is noninterest expense over REVENUE, and a bank's revenue
     is net interest income PLUS noninterest income — many banks tag only those
     two halves and never a total, which is why CONCEPTS carries them
     separately. Falling back to `revenue` when both halves are present would
     silently change the denominator between filers. */
  const bankRevenue = sum(nii, tv('noninterestIncome')) ?? revenue;
  set('efficiencyRatio', div(tv('noninterestExpense'), bankRevenue),
    missing(['noninterest expense', tv('noninterestExpense')], ['bank revenue', bankRevenue]));
  set('loanToDeposit', div(iv('loans'), iv('deposits')),
    missing(['loans', iv('loans')], ['deposits', iv('deposits')]));
  set('provisionRate', div(tv('provisionForCreditLosses'), iv('loans')),
    missing(['provision for credit losses', tv('provisionForCreditLosses')], ['loans', iv('loans')]));

  // --- insurers ---
  const premiums = tv('premiumsEarned');
  const losses = tv('lossesIncurred');
  const uwExpense = tv('underwritingExpense');
  set('lossRatio', div(losses, premiums), missing(['claims incurred', losses], ['premiums earned', premiums]));
  set('expenseRatio', div(uwExpense, premiums),
    missing(['underwriting expense', uwExpense], ['premiums earned', premiums]));
  /* Both halves or nothing. Substituting total SG&A for the underwriting
     expense produces a combined ratio that looks right and is not one — and a
     combined ratio is read as the single number that says whether an insurer
     makes money underwriting. */
  set('combinedRatio',
    (losses != null && uwExpense != null) ? div(losses + uwExpense, premiums) : null,
    missing(['claims incurred', losses], ['underwriting expense', uwExpense],
            ['premiums earned', premiums]));

  // --- REITs ---
  /* FFO = net income + real-estate depreciation − gains on property sales.
     It exists because GAAP depreciates buildings that are in fact appreciating,
     so a REIT's net income understates its cash earnings by design.
     `dna` is TOTAL depreciation rather than the real-estate-only figure NAREIT
     specifies; for a REIT those are nearly the same, and the difference is
     named here rather than hidden. Gains are subtracted only when tagged. */
  const ffoVal = (netIncome != null && dna != null)
    ? netIncome + dna - (tv('gainOnSaleOfRealEstate') ?? 0) : null;
  if (ffoVal != null && tv('gainOnSaleOfRealEstate') == null) {
    notes._ffo = 'no property-sale gain tagged; FFO is net income plus total depreciation';
  }
  set('ffo', ffoVal, missing(['net income', netIncome], ['depreciation', dna]));
  set('pToFfo', div(mktCap, ffoVal), priceNote || missing(['FFO', ffoVal]));
  set('ffoPayout', div(divs, ffoVal), missing(['dividends paid', divs], ['FFO', ffoVal]));

  for (const m of applicable) if (!(m.id in values)) values[m.id] = null;
  return { frame, values, notes, sectorProfile: profile };
}

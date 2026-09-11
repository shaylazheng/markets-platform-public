/* ratios.js against the same real fixtures. No network.
 * Run: node --test server/lib/ratios.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeries, compareFrames, CONCEPTS } from './xbrl.js';
import {
  computeRatios, rankPeers, percentileRank, sectorProfile, shiftFrame, div,
  METRICS, METRIC_BY_ID, METRIC_INPUTS,
} from './ratios.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const series = (t) =>
  buildSeries(JSON.parse(readFileSync(join(HERE, 'fixtures', 'companyfacts', `${t}.json`), 'utf8')));

const latestTtm = (s) => Object.keys(s.ttm).sort(compareFrames).pop();
const ratios = (t, opts = {}) => {
  const s = series(t);
  return computeRatios(s, { frame: latestTtm(s), ...opts });
};

/* ---- the guard that matters most ---------------------------------------- */

test('negative equity yields null ROE, not a large positive that ranks best', () => {
  const s = series('MSTR');
  const frame = latestTtm(s);
  const equity = s.instants[`${frame}I`]?.equity?.val;

  const r = computeRatios(s, { frame });
  if (equity != null && equity <= 0) {
    assert.equal(r.values.roe, null);
    assert.match(r.notes.roe, /negative or zero/);
  }
  // Whatever MSTR's equity is in this fixture, ROE must never be a number
  // produced by dividing by a non-positive denominator.
  assert.ok(r.values.roe === null || r.values.roe === 'na' || Number.isFinite(r.values.roe));
});

test('a synthetic negative-equity company cannot rank first on ROE', () => {
  // The failure mode in full: negative income over negative equity is a large
  // POSITIVE quotient, so an unguarded implementation sorts the most distressed
  // company to the top of the column and shades it green.
  const fake = {
    ttm: { CY2026Q1: { netIncome: { val: -500e6 }, revenue: { val: 1e9 } } },
    quarterly: {}, annual: {}, instants: { CY2026Q1I: { equity: { val: -200e6 } } },
  };
  const r = computeRatios(fake, { frame: 'CY2026Q1' });
  assert.equal(r.values.roe, null, 'unguarded this would be +2.5 (i.e. 250%)');

  const rows = [
    { ticker: 'BAD', values: r.values },
    { ticker: 'GOOD', values: { roe: 0.31 } },
  ];
  assert.equal(rankPeers(rows, 'roe').GOOD, 1);
  assert.equal(rankPeers(rows, 'roe').BAD, undefined, 'a null must not occupy a rank');
});

/* ---- no NaN, no Infinity, anywhere -------------------------------------- */

test('no metric returns NaN or Infinity across every fixture', () => {
  for (const t of ['NVDA', 'AAPL', 'SWKS', 'QRVO', 'GLW', 'MSTR', 'JPM']) {
    const s = series(t);
    for (const frame of Object.keys(s.ttm).sort(compareFrames).slice(-8)) {
      const r = computeRatios(s, { frame, market: { close: 100, sharesOutstanding: 1e9 } });
      for (const m of METRICS) {
        const v = r.values[m.id];
        assert.ok(v === null || v === 'na' || Number.isFinite(v),
          `${t} ${frame} ${m.id} = ${v}`);
      }
    }
  }
});

test('div never emits NaN or Infinity', () => {
  for (const [a, b] of [[1, 0], [0, 0], [null, 5], [5, null], [Infinity, 2], [NaN, 1]]) {
    const out = div(a, b);
    assert.ok(out === null || Number.isFinite(out), `div(${a},${b}) = ${out}`);
  }
  assert.equal(div(10, 4), 2.5);
});

/* ---- sector applicability ----------------------------------------------- */

test('a bank marks structurally undefined metrics n/a and is excluded from ranking', () => {
  const s = series('JPM');
  const r = computeRatios(s, { frame: latestTtm(s), sic: '6021' });
  assert.equal(r.sectorProfile, 'bank');
  // Banks file no AssetsCurrent -- the balance sheet is unclassified, so a
  // current ratio does not exist rather than being merely unusual.
  assert.equal(r.values.currentRatio, 'na');
  assert.equal(r.values.grossMargin, 'na');

  const rows = [{ ticker: 'JPM', values: r.values }, { ticker: 'AAPL', values: { currentRatio: 0.9 } }];
  const ranks = rankPeers(rows, 'currentRatio');
  assert.equal(ranks.JPM, undefined, "an 'na' cell must not be ranked");
  assert.equal(ranks.AAPL, 1);
});

test('sectorProfile maps the ranges it claims to', () => {
  assert.equal(sectorProfile('6021'), 'bank');
  assert.equal(sectorProfile('6035'), 'bank', 'savings institution, federally chartered');
  assert.equal(sectorProfile('6099'), 'bank', 'functions related to deposit banking');
  assert.equal(sectorProfile('6798'), 'reit');
  assert.equal(sectorProfile('6311'), 'insurance');
  assert.equal(sectorProfile('3571'), 'general');
  assert.equal(sectorProfile(null), 'general');
});

test('SIC 6199 is not a bank — the finance-services catch-all holds MSTR', () => {
  // The band used to run 6020-6199, which swept in "Finance Services": Strategy
  // Inc files under 6199 and had its gross margin, ROIC, current ratio and
  // EV/EBITDA all stamped "not applicable for a bank".
  assert.equal(sectorProfile('6199'), 'general');
  const s = series('MSTR');
  const r = computeRatios(s, { frame: latestTtm(s), sic: '6199' });
  assert.equal(r.sectorProfile, 'general');
  for (const id of ['grossMargin', 'roic', 'currentRatio']) {
    assert.notEqual(r.values[id], 'na', `${id} must be computed, not blanked as a bank metric`);
  }
  assert.ok(typeof r.values.grossMargin === 'number' && r.values.grossMargin > 0,
    `MSTR gross margin ${r.values.grossMargin}`);
});

test('an ADR gets no market cap: ordinary shares times an ADR price is not a valuation', () => {
  // TSM files its cover-page count on a 20-F -- 25.9bn ORDINARY shares -- while
  // the US line is a depositary receipt standing for five of them. Multiplying
  // gave a $10.5T market cap, which then propagated into EV/EBITDA.
  const s = series('TSM');
  const frame = Object.keys(s.annual).filter((f) => s.annual[f].revenue).sort(compareFrames).pop();
  const r = computeRatios(s, { frame, market: { close: 404.25 } });

  for (const id of ['marketCap', 'pe', 'evToEbitda']) {
    assert.equal(r.values[id], null, `${id} must be suppressed for an ADR, not published wrong`);
    assert.match(r.notes[id], /ADR/, `${id} must say why`);
  }
  // The operating figures are unaffected -- they are in USD and correct.
  assert.ok(r.values.grossMargin > 0.4 && r.values.grossMargin < 0.7,
    `TSM gross margin ${r.values.grossMargin}`);
});

test('a US filer with the same inputs still gets a market cap', () => {
  const s = series('NVDA');
  const r = computeRatios(s, { frame: latestTtm(s), market: { close: 200 } });
  assert.ok(typeof r.values.marketCap === 'number' && r.values.marketCap > 0,
    'the ADR guard must key on the 20-F, not on foreignness in general');
});

test('every blank cell says why it is blank', () => {
  /* The source inspector's whole job on an empty cell is to answer "why is
     this an em dash?". A null with no note leaves it saying "not reported for
     CY2026Q1" generically, when the real answer is that JPM tags no
     OperatingIncomeLoss and PLD no capex. Checked across every fixture,
     including the sector profiles, because that is where the gaps live. */
  const FIXTURES = ['AAPL', 'NVDA', 'JPM', 'MSTR', 'TSM', 'GLW', 'QRVO', 'SWKS'];
  const gaps = [];
  for (const t of FIXTURES) {
    const s = series(t);
    const frame = latestTtm(s) || Object.keys(s.annual).sort(compareFrames).pop();
    for (const market of [null, { close: 100 }]) {
      const r = computeRatios(s, { frame, market });
      for (const m of METRICS) {
        if (r.values[m.id] == null && !r.notes[m.id]) gaps.push(`${t}${market ? '+px' : ''}/${m.id}`);
      }
    }
  }
  assert.deepEqual(gaps, [], `blank with no reason: ${gaps.join(', ')}`);
});

test('METRIC_INPUTS covers every metric and names only real concepts', () => {
  for (const m of METRICS) {
    assert.ok(METRIC_INPUTS[m.id], `${m.id} has no input declaration to trace sources through`);
  }
  for (const [id, spec] of Object.entries(METRIC_INPUTS)) {
    assert.ok(METRIC_BY_ID[id], `METRIC_INPUTS declares ${id}, which is not a metric`);
    for (const key of ['flows', 'priors', 'instants']) {
      for (const c of spec[key] || []) {
        assert.ok(CONCEPTS[c], `${id}.${key} names ${c}, which xbrl.js does not extract`);
        const want = key === 'instants' ? 'instant' : 'flow';
        assert.equal(CONCEPTS[c].kind, want, `${id}.${key} lists ${c}, a ${CONCEPTS[c].kind}`);
      }
    }
  }
});

/* ---- descriptor contract ------------------------------------------------ */

test('scale metrics are never ranked', () => {
  assert.equal(METRIC_BY_ID.marketCap.higherIsBetter, null);
  const rows = [{ ticker: 'A', values: { marketCap: 1e12 } },
                { ticker: 'B', values: { marketCap: 5e11 } }];
  assert.deepEqual(rankPeers(rows, 'marketCap'), {},
    'market cap has no "better"; ranking it would paint scale as quality');
});

test('lower-is-better metrics rank ascending', () => {
  assert.equal(METRIC_BY_ID.netDebtToEbitda.higherIsBetter, false);
  const rows = [{ ticker: 'LEV', values: { netDebtToEbitda: 4.2 } },
                { ticker: 'CLEAN', values: { netDebtToEbitda: 0.3 } }];
  assert.equal(rankPeers(rows, 'netDebtToEbitda').CLEAN, 1, 'least levered should be #1');
});

test('every descriptor is renderable and self-consistent', () => {
  for (const m of METRICS) {
    assert.ok(m.id && m.label && m.category && m.format, `${m.id} is under-specified`);
    assert.ok([true, false, null].includes(m.higherIsBetter), `${m.id} higherIsBetter`);
    assert.ok(Array.isArray(m.naFor));
  }
  assert.equal(new Set(METRICS.map((m) => m.id)).size, METRICS.length, 'duplicate metric id');
});

/* ---- arithmetic sanity against known figures ---------------------------- */

test('AAPL margins land in their real-world band', () => {
  const r = ratios('AAPL');
  assert.ok(r.values.grossMargin > 0.4 && r.values.grossMargin < 0.55,
    `gross margin ${r.values.grossMargin}`);
  assert.ok(r.values.operatingMargin > 0.25 && r.values.operatingMargin < 0.45,
    `operating margin ${r.values.operatingMargin}`);
});

test('NVDA shows very high margins and strong growth', () => {
  const r = ratios('NVDA');
  assert.ok(r.values.grossMargin > 0.6, `gross margin ${r.values.grossMargin}`);
  assert.ok(r.values.revenueGrowth > 0.2, `growth ${r.values.revenueGrowth}`);
});

test('shiftFrame walks quarters across year boundaries', () => {
  assert.equal(shiftFrame('CY2026Q1', -4), 'CY2025Q1');
  assert.equal(shiftFrame('CY2026Q1', -1), 'CY2025Q4');
  assert.equal(shiftFrame('CY2025Q4', 1), 'CY2026Q1');
  assert.equal(shiftFrame('CY2025', -4), null, 'annual frames are not quarters');
});

test('percentileRank needs a population and is order-independent', () => {
  assert.equal(percentileRank(5, [5]), null, 'one value has no percentile');
  assert.equal(percentileRank(10, [0, 10]), 0.75);
  assert.ok(percentileRank(1, [1, 2, 3]) < percentileRank(3, [1, 2, 3]));
});

/* ---- the ƒ derivations --------------------------------------------------- */

const flowsAt = (frame, obj) => ({ [frame]: Object.fromEntries(
  Object.entries(obj).map(([k, v]) => [k, { val: v }])) });

test('operating income by identity: revenue − CostsAndExpenses, marked ƒ', () => {
  const fake = {
    ttm: flowsAt('CY2026Q2', { revenue: 1000, costsAndExpenses: 700 }),
    quarterly: {}, annual: {}, instants: {},
  };
  const r = computeRatios(fake, { frame: 'CY2026Q2' });
  assert.equal(r.values.operatingMargin, 0.3);
  assert.match(r.derived.operatingMargin, /total costs and expenses/);
});

test('operating income by EBIT approximation needs BOTH pretax and interest', () => {
  const both = {
    ttm: flowsAt('CY2026Q2', { revenue: 1000, pretaxIncome: 80, interestExpense: 20 }),
    quarterly: {}, annual: {}, instants: {},
  };
  const r = computeRatios(both, { frame: 'CY2026Q2' });
  assert.equal(r.values.operatingMargin, 0.1);
  assert.match(r.derived.operatingMargin, /EBIT approximation/);

  // Interest absent for a levered filer: approximating with zero interest
  // would flip the sign of a distressed company's operating income. Declined.
  const noInterest = {
    ttm: flowsAt('CY2026Q2', { revenue: 1000, pretaxIncome: -13 }),
    quarterly: {}, annual: {}, instants: {},
  };
  assert.equal(computeRatios(noInterest, { frame: 'CY2026Q2' }).values.operatingMargin, null);
});

test('pretax by identity (net income + tax) reaches the EBIT chain', () => {
  const fake = {
    ttm: flowsAt('CY2026Q2', { revenue: 1000, netIncome: 60, taxExpense: 20, interestExpense: 20 }),
    quarterly: {}, annual: {}, instants: {},
  };
  const r = computeRatios(fake, { frame: 'CY2026Q2' });
  assert.equal(r.values.operatingMargin, 0.1);           // (60+20)+20 over 1000
});

test('zero-debt: fires only with three consecutive debt-free balance sheets', () => {
  const inst = (equity, debtNow, debtPrior) => ({
    CY2026Q2I: { equity: { val: equity }, cash: { val: 50 },
      ...(debtNow != null ? { ltDebtNoncurrent: { val: debtNow } } : {}) },
    CY2026Q1I: { equity: { val: equity },
      ...(debtPrior != null ? { ltDebtNoncurrent: { val: debtPrior } } : {}) },
    CY2025Q4I: { equity: { val: equity } },
  });
  const flows = flowsAt('CY2026Q2', {
    revenue: 1000, operatingIncome: 200, netIncome: 150, dna: 30,
  });
  const mk = (instants, warnings = []) => computeRatios(
    { ttm: flows, quarterly: {}, annual: {}, instants, warnings },
    { frame: 'CY2026Q2' });

  const clean = mk(inst(400, null, null));
  assert.equal(clean.values.netDebtToEbitda, -50 / 230);   // net cash, ƒ
  assert.match(clean.derived.netDebtToEbitda, /treated as zero/);
  assert.ok(Number.isFinite(clean.values.roic));

  // Debt on a preceding balance sheet vetoes the inference.
  const hadDebt = mk(inst(400, null, 120));
  assert.equal(hadDebt.values.netDebtToEbitda, null);

  // A preceding balance sheet that is simply MISSING (no equity fact either)
  // vetoes too — "not filed here" is not evidence of "no debt".
  const gappy = mk({
    CY2026Q2I: { equity: { val: 400 }, cash: { val: 50 } },
    CY2026Q1I: { equity: { val: 400 } },
  });
  assert.equal(gappy.values.netDebtToEbitda, null);

  // A non-USD debt fact vetoes it too — hidden, not absent.
  const hidden = mk(inst(400, null, null),
    [{ code: 'UNIT_MISMATCH', conceptId: 'ltDebtNoncurrent', detail: 'CNY' }]);
  assert.equal(hidden.values.netDebtToEbitda, null);
});

test('zero-debt never fires for a 20-F filer', () => {
  const fake = {
    ttm: flowsAt('CY2026Q2', { revenue: 1000, operatingIncome: 200, dna: 30 }),
    quarterly: {}, annual: {},
    instants: {
      CY2026Q2I: { equity: { val: 400 }, cash: { val: 50 },
        sharesOutstanding: { val: 100, form: '20-F' } },
      CY2026Q1I: { equity: { val: 400 } },
      CY2025Q4I: { equity: { val: 400 } },
    },
    warnings: [],
  };
  const r = computeRatios(fake, { frame: 'CY2026Q2' });
  assert.equal(r.values.netDebtToEbitda, null);
});

test('annual fallback: a margin blanked by one missing TTM quarter fills from the FY frame, ƒ', () => {
  const fake = {
    ttm: flowsAt('CY2026Q2', { revenue: 1000 }),      // no cost inputs on TTM
    quarterly: {},
    annual: flowsAt('CY2025', { revenue: 900, grossProfit: 450, cfo: 200, capex: 80 }),
    instants: {},
  };
  const r = computeRatios(fake, { frame: 'CY2026Q2' });
  assert.equal(r.values.grossMargin, 0.5);
  assert.match(r.derived.grossMargin, /CY2025 annual frame/);
  assert.ok(Math.abs(r.values.fcfMargin - 120 / 900) < 1e-12);
  assert.match(r.derived.fcfMargin, /CY2025 annual frame/);
});

test('a derivation whose metric still came out null never appears in the ƒ ledger', () => {
  const fake = {
    ttm: flowsAt('CY2026Q2', { revenue: 1000, costsAndExpenses: 700 }),  // opInc ƒ
    quarterly: {}, annual: {}, instants: {},
  };
  const r = computeRatios(fake, { frame: 'CY2026Q2' });
  // netDebtToEbitda was marked via the opInc derivation but stayed null (no
  // debt figures at all, no instants) — the mark must have been dropped.
  assert.equal(r.values.netDebtToEbitda, null);
  assert.equal(r.derived.netDebtToEbitda, undefined);
});

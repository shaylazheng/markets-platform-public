/* Risk arithmetic against hand-computed answers. Every series here is short
 * enough to check on paper, which is the point — a correlation routine that is
 * only ever tested on real data can be wrong in a way that still looks like a
 * correlation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  returnsOn, commonDates, mean, stdev, covariance, correlation, annualVol,
  beta, maxDrawdown, indexPath, herfindahl, portfolioReturns,
  correlationMatrix, averagePairwise, TRADING_DAYS,
} from './riskmath.js';

const close = (pairs) => new Map(pairs);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

/* ---- alignment ---------------------------------------------------------- */

test('commonDates keeps only days every series traded', () => {
  const a = close([['2026-01-02', 1], ['2026-01-03', 2], ['2026-01-05', 3]]);
  const b = close([['2026-01-02', 9], ['2026-01-05', 9], ['2026-01-06', 9]]);
  assert.deepEqual(commonDates([a, b]), ['2026-01-02', '2026-01-05']);
});

test('commonDates treats a null close as not traded', () => {
  const a = close([['2026-01-02', 1], ['2026-01-03', null]]);
  const b = close([['2026-01-02', 1], ['2026-01-03', 5]]);
  assert.deepEqual(commonDates([a, b]), ['2026-01-02']);
});

test('returnsOn walks the spine, not the map', () => {
  // The spine skips 01-03, so the step is 01-02 -> 01-06: 110/100 - 1.
  const spine = ['2026-01-02', '2026-01-06'];
  const m = close([['2026-01-02', 100], ['2026-01-03', 500], ['2026-01-06', 110]]);
  const r = returnsOn(spine, m);
  assert.equal(r.length, 1);
  near(r[0], 0.1);
});

test('returnsOn yields null rather than a fake zero across a gap', () => {
  const spine = ['2026-01-02', '2026-01-03'];
  const m = close([['2026-01-02', 100]]);
  assert.deepEqual(returnsOn(spine, m), [null]);
});

/* ---- moments ------------------------------------------------------------ */

test('stdev is the sample form, dividing by n-1', () => {
  // [2,4,4,4,5,5,7,9]: population sd 2, sample sd = sqrt(32/7).
  const xs = [2, 4, 4, 4, 5, 5, 7, 9];
  near(mean(xs), 5);
  near(stdev(xs), Math.sqrt(32 / 7), 1e-12);
});

test('stdev and covariance need two points', () => {
  assert.equal(stdev([1]), null);
  assert.equal(covariance([1], [1]), null);
  assert.equal(covariance([1, 2], [1]), null);
});

test('correlation is exactly 1 and -1 on perfectly linear series', () => {
  near(correlation([1, 2, 3, 4], [2, 4, 6, 8]), 1, 1e-12);
  near(correlation([1, 2, 3, 4], [8, 6, 4, 2]), -1, 1e-12);
});

test('correlation of a flat series is null, not zero', () => {
  // Zero would claim independence, which is a much stronger statement than
  // "this series never moved, so nothing can be said".
  assert.equal(correlation([1, 1, 1, 1], [1, 2, 3, 4]), null);
});

test('annualVol scales the daily figure by sqrt(252)', () => {
  const rets = [0.01, -0.01, 0.02, -0.02, 0.005];
  near(annualVol(rets), stdev(rets) * Math.sqrt(TRADING_DAYS), 1e-12);
});

/* ---- beta --------------------------------------------------------------- */

test('an asset that doubles every market move has beta 2', () => {
  const m = [0.01, -0.02, 0.015, -0.005, 0.02];
  near(beta(m.map((x) => x * 2), m), 2, 1e-12);
});

test('beta is 1 against the market itself and null against a flat market', () => {
  const m = [0.01, -0.02, 0.015, -0.005];
  near(beta(m, m), 1, 1e-12);
  assert.equal(beta(m, [0, 0, 0, 0]), null);
});

/* ---- drawdown ----------------------------------------------------------- */

test('maxDrawdown finds the deepest peak-to-trough and dates it', () => {
  const vals = [100, 120, 90, 110, 60, 80];
  const dates = ['a', 'b', 'c', 'd', 'e', 'f'];
  const dd = maxDrawdown(vals, dates);
  near(dd.depth, 60 / 120 - 1, 1e-12);      // -50%, from the 120 peak
  assert.equal(dd.peakAt, 'b');
  assert.equal(dd.troughAt, 'e');
});

test('a monotonically rising path has no drawdown', () => {
  assert.equal(maxDrawdown([1, 2, 3, 4]).depth, 0);
});

test('indexPath compounds rather than sums', () => {
  const p = indexPath([0.1, 0.1]);
  near(p[2], 121, 1e-12);                    // 100 -> 110 -> 121, not 120
});

/* ---- concentration ------------------------------------------------------ */

test('herfindahl reports effective N for an equal-weighted book', () => {
  const { hhi, effectiveN } = herfindahl([0.25, 0.25, 0.25, 0.25]);
  near(hhi, 0.25, 1e-12);
  near(effectiveN, 4, 1e-12);
});

test('herfindahl is 1 for a single position', () => {
  const { hhi, effectiveN } = herfindahl([1]);
  near(hhi, 1, 1e-12);
  near(effectiveN, 1, 1e-12);
});

test('herfindahl normalises weights that do not sum to one', () => {
  // Same book, expressed as raw dollars rather than fractions.
  near(herfindahl([50, 50]).effectiveN, 2, 1e-12);
});

/* ---- portfolio ---------------------------------------------------------- */

test('portfolio returns are the weighted average of the legs', () => {
  const w = { A: 0.75, B: 0.25 };
  const r = { A: [0.04], B: [0.00] };
  near(portfolioReturns(w, r, 1)[0], 0.03, 1e-12);
});

test('a leg missing a day is renormalised away, not treated as a zero return', () => {
  const w = { A: 0.5, B: 0.5 };
  const r = { A: [0.10], B: [null] };
  // Treating B as 0 would give 5%. The book that day is entirely A.
  near(portfolioReturns(w, r, 1)[0], 0.10, 1e-12);
});

/* ---- the matrix --------------------------------------------------------- */

test('the correlation matrix has a unit diagonal and is symmetric', () => {
  const rets = {};
  for (const t of ['A', 'B', 'C']) {
    rets[t] = Array.from({ length: 40 }, (_, i) => Math.sin(i + t.charCodeAt(0)) / 100);
  }
  const m = correlationMatrix(['A', 'B', 'C'], rets);
  for (const t of ['A', 'B', 'C']) assert.equal(m[t][t], 1);
  near(m.A.B, m.B.A, 1e-12);
  near(m.A.C, m.C.A, 1e-12);
});

test('a pair with fewer than 20 overlapping days is null, not a noisy number', () => {
  const rets = { A: Array(10).fill(0.01), B: Array(10).fill(0.02) };
  assert.equal(correlationMatrix(['A', 'B'], rets).A.B, null);
});

test('overlap is computed pairwise, so one gappy name does not poison the rest', () => {
  const n = 40;
  const base = Array.from({ length: n }, (_, i) => Math.sin(i) / 100);
  const rets = {
    A: base,
    B: base.map((x) => x * 2),
    C: base.map((x, i) => (i % 3 ? null : x)),   // trades every third day
  };
  const m = correlationMatrix(['A', 'B', 'C'], rets);
  near(m.A.B, 1, 1e-9);                 // untouched by C's gaps
  assert.equal(m.A.C, null);            // 14 overlapping days, under the floor
});

test('averagePairwise reads the off-diagonal only', () => {
  const m = { A: { A: 1, B: 0.5 }, B: { A: 0.5, B: 1 } };
  near(averagePairwise(['A', 'B'], m), 0.5, 1e-12);
});

/* ---- end to end --------------------------------------------------------- */

test('a two-name book: correlation, beta and drawdown all agree with hand math', () => {
  const dates = ['d1', 'd2', 'd3', 'd4', 'd5'];
  const mkt = close([['d1', 100], ['d2', 110], ['d3', 99], ['d4', 108.9], ['d5', 98.01]]);
  const twice = close([['d1', 100], ['d2', 120], ['d3', 96], ['d4', 115.2], ['d5', 92.16]]);

  const spine = commonDates([mkt, twice]);
  assert.deepEqual(spine, dates);

  const rm = returnsOn(spine, mkt);
  const ra = returnsOn(spine, twice);

  // The market alternates +10% / -10%; the asset +20% / -20%.
  near(rm[0], 0.1, 1e-12);
  near(ra[0], 0.2, 1e-12);

  near(correlation(ra, rm), 1, 1e-9);   // perfectly linear
  near(beta(ra, rm), 2, 1e-9);

  // Path: 100 -> 120 -> 96 -> 115.2 -> 92.16. The peak is 120 and the path
  // never regains it, so the trough is the LAST point, not the first dip:
  // 92.16/120 - 1 = -23.2%. Stopping at the -20% step is the easy mistake.
  // indexPath returns n+1 values for n returns, which is exactly the length of
  // the spine — path[i] is the value ON spine[i]. Padding the dates is the
  // off-by-one that silently misreports WHEN a drawdown happened.
  const path = indexPath(ra);
  assert.equal(path.length, spine.length);
  const dd = maxDrawdown(path, spine);
  near(dd.depth, 92.16 / 120 - 1, 1e-9);
  assert.equal(dd.peakAt, 'd2');
  assert.equal(dd.troughAt, 'd5');
});

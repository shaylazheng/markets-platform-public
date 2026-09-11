/* xbrl.js against pruned REAL companyfacts fixtures. No network.
 *
 * Every assertion here pins a bug that would otherwise ship silently and look
 * plausible on screen. Regenerate the fixtures with:
 *   node packages/core/lib/fixtures/build-fixtures.mjs
 *
 * Run: node --test server/lib/xbrl.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeries, frameForDuration, frameForInstant, compareFrames, CONCEPTS } from './xbrl.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (t) => JSON.parse(readFileSync(join(HERE, 'fixtures', 'companyfacts', `${t}.json`), 'utf8'));
const series = (t) => buildSeries(load(t));
const revFrames = (s) => Object.keys(s.quarterly).filter((f) => s.quarterly[f].revenue).sort(compareFrames);

/* ---- 1. tag migration: merge, never truncate ---------------------------- */

test('NVDA revenue reaches 2026 — a first-alias-wins resolver dies at 2022', () => {
  const s = series('NVDA');
  const f = revFrames(s);
  assert.equal(f[f.length - 1], 'CY2026Q1');
  // Both eras present: RevenueFromContract... died 2022-01-30, Revenues carries on.
  assert.ok(s.coverage.revenue.tagsUsed.includes('Revenues'));
  assert.ok(s.coverage.revenue.tagsUsed.includes('RevenueFromContractWithCustomerExcludingAssessedTax'));
});

test('AAPL spans all three tag eras as one continuous series', () => {
  const s = series('AAPL');
  const used = s.coverage.revenue.tagsUsed;
  for (const tag of ['SalesRevenueNet', 'Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax']) {
    assert.ok(used.includes(tag), `expected ${tag} in the merged series`);
  }
  const f = revFrames(s);
  assert.ok(compareFrames(f[0], 'CY2010Q1') < 0, 'should reach back before 2010');
  assert.equal(f[f.length - 1], 'CY2026Q2');
});

test('QRVO has no RevenueFromContract tag at all, yet still yields a series', () => {
  const s = series('QRVO');
  assert.ok(!s.coverage.revenue.tagsUsed.includes('RevenueFromContractWithCustomerExcludingAssessedTax'));
  assert.ok(revFrames(s).length > 20, 'a first-hit resolver would return nothing here');
});

/* ---- 2. cross-validation against an independent pipeline ---------------- */

test('NVDA CY2026Q1 revenue is 81.615B — matches earnings/NVDA.json', () => {
  // earnings/NVDA.json, researched by a separate headless-Claude pipeline, says
  // "Q1 FY2027 ... Revenue $81.6B". Two independent paths agreeing is what makes
  // this assertion worth more than the sum of its parts: it fails if the tag
  // merge breaks (series dies in 2022) OR if frame alignment breaks.
  assert.equal(series('NVDA').quarterly['CY2026Q1'].revenue.val, 81_615_000_000);
});

test('AAPL and NVDA line up on CY2025Q1 despite different fiscal calendars', () => {
  // AAPL's fiscal Q2 (ends 2025-03-29) and NVDA's fiscal Q1 (ends 2025-04-27).
  assert.equal(series('AAPL').quarterly['CY2025Q1'].revenue.val, 95_359_000_000);
  assert.equal(series('NVDA').quarterly['CY2025Q1'].revenue.val, 44_062_000_000);
});

/* ---- 3. the missing fiscal quarter -------------------------------------- */

test('AAPL fiscal Q4 is derived, and it lands at Q3 — not Q4', () => {
  const p = series('AAPL').quarterly['CY2025Q3'].revenue;
  // 416,161 - 124,300 - 95,359 - 94,036 ($M) = 102,466. Apple reported $102.47B.
  // Both derivation routes must agree on this number; YTD-diff wins because it
  // runs first and also works mid-year.
  assert.equal(p.val, 102_466_000_000);
  assert.equal(p.derived, true);
  assert.ok(['YTD-diff', 'FY-Q1Q2Q3'].includes(p.method), `unexpected method ${p.method}`);
});

test('cash-flow items are recovered from YTD filings', () => {
  // 10-Qs report cash flow cumulatively, so only fiscal Q1 is ever a discrete
  // 90-day period. Without differencing, TTM never finds four quarters and FCF
  // margin is silently null for every company on the surface.
  for (const t of ['AAPL', 'NVDA']) {
    const s = series(t);
    const frames = Object.keys(s.quarterly).filter((f) => s.quarterly[f].cfo).sort(compareFrames);
    assert.ok(frames.length > 12, `${t} has only ${frames.length} quarters of CFO`);
    const last = Object.keys(s.ttm).sort(compareFrames).pop();
    assert.ok(s.ttm[last]?.cfo?.val > 0, `${t} has no TTM operating cash flow`);
  }
});

test('NVDA fiscal Q4 is derived, and it lands at Q4 — the gap moves per issuer', () => {
  const p = series('NVDA').quarterly['CY2025Q4'].revenue;
  assert.equal(p.val, 68_127_000_000);
  assert.equal(p.derived, true);
  // The point of the pair: hardcoding CY{y}Q4 silently leaves AAPL's hole open,
  // and hardcoding Q3 leaves NVDA's. The gap is found, not assumed.
  assert.equal(series('AAPL').quarterly['CY2025Q4'].revenue.derived, false);
  assert.equal(series('NVDA').quarterly['CY2025Q3'].revenue.derived, false);
});

test('derived quarters never chain off other derived quarters', () => {
  for (const t of ['AAPL', 'NVDA', 'SWKS']) {
    for (const f of Object.keys(series(t).quarterly)) {
      const p = series(t).quarterly[f].revenue;
      if (p?.derived) assert.ok(!p.inputs?.some((i) => /derived/i.test(i)));
    }
  }
});

/* ---- 4. duration, not `fp` ---------------------------------------------- */

test('SWKS picks the discrete quarter, not the nine-month YTD row', () => {
  // Both rows are stamped fy=2026 fp=Q3. An fp-based filter takes whichever
  // sorts first, which is a 3x error.
  const s = series('SWKS');
  const f = revFrames(s);
  for (const frame of f) {
    const p = s.quarterly[frame].revenue;
    const span = (Date.parse(p.end) - Date.parse(p.start)) / 86400e3;
    assert.ok(span <= 100, `${frame} is ${Math.round(span)}d — a cumulative leaked into quarterly`);
  }
});

test('frameForDuration labels by midpoint, so a late-January quarter is Q4', () => {
  // NVDA 2025-10-27 -> 2026-01-25 is mostly Nov/Dec. Snapping on `end` would
  // call it CY2026Q1, collide with the real CY2026Q1, and suppress the derived
  // quarter entirely.
  assert.equal(frameForDuration('2025-10-27', '2026-01-25').frame, 'CY2025Q4');
  assert.equal(frameForDuration('2026-03-29', '2026-06-27').frame, 'CY2026Q2');
  assert.equal(frameForDuration('2025-01-27', '2026-01-25').bucket, 'annual');
  assert.equal(frameForDuration('2025-01-01', '2025-02-01'), null, 'a month is not a period');
});

/* ---- 5. units ------------------------------------------------------------ */

test('GLW builds from Revenues despite a short-lived decoy tag', () => {
  // GLW's RevenueFromContract... has only a handful of 10-Q-only facts while
  // Revenues carries the real history. Preferring the alias that appears first
  // in the family would yield a stub series.
  const s = series('GLW');
  const f = revFrames(s);
  assert.ok(f.length > 20, `only ${f.length} quarters — the decoy won`);
  assert.ok(s.coverage.revenue.tagsUsed.includes('Revenues'));
  for (const frame of f) {
    assert.ok(s.quarterly[frame].revenue.val > 1e8, `${frame} is out of band for USD billions`);
  }
});

test('a non-USD unit is rejected and warned, never silently compared', () => {
  // GLW files CNY on credit-facility tags, which are outside CONCEPTS. Rather
  // than depend on a filer happening to put yuan on a tag we read, exercise the
  // mechanism directly: strict unit-key matching is what stops
  // Object.values(units)[0] handing us yuan and comparing it to dollars — the
  // bug that is live in pull.mjs:149 and scan10k.mjs:126 today.
  const cnyOnly = {
    cik: 1, entityName: 'Test',
    facts: { 'us-gaap': { Revenues: { units: {
      CNY: [{ start: '2025-01-01', end: '2025-03-31', val: 999, form: '10-Q', filed: '2025-05-01' }],
    } } } },
  };
  const s = buildSeries(cnyOnly);
  assert.equal(Object.keys(s.quarterly).length, 0, 'a CNY fact must not become a data point');
  assert.ok(s.warnings.some((w) => w.code === 'UNIT_MISMATCH' && /CNY/.test(w.detail)),
    'expected a UNIT_MISMATCH warning naming the unit found');
});

/* ---- 6. structural guarantees ------------------------------------------- */

test('instants live in their own keyspace and are never differenced', () => {
  const s = series('AAPL');
  for (const f of Object.keys(s.quarterly)) {
    assert.ok(!f.endsWith('I'), `instant frame ${f} leaked into quarterly`);
  }
  const instantIds = Object.entries(CONCEPTS).filter(([, c]) => c.kind === 'instant').map(([id]) => id);
  for (const f of Object.keys(s.quarterly)) {
    for (const id of instantIds) {
      assert.equal(s.quarterly[f][id], undefined, `${id} is a stock and must not appear as a flow`);
    }
  }
  assert.equal(frameForInstant('2026-06-27'), 'CY2026Q2I');
});

test('TTM requires all four quarters', () => {
  const s = series('AAPL');
  for (const [frame, facts] of Object.entries(s.ttm)) {
    if (!facts.revenue) continue;
    assert.equal(facts.revenue.inputs.length, 4, `${frame} rolled up from a short window`);
  }
  // Sanity: AAPL TTM revenue is somewhere in the high hundreds of billions.
  const last = Object.keys(s.ttm).sort(compareFrames).pop();
  assert.ok(s.ttm[last].revenue.val > 3e11 && s.ttm[last].revenue.val < 1e12);
});

test('a foreign 20-F filer resolves through ifrs-full, in USD not TWD', () => {
  // TSM has 334 ifrs-full tags and zero us-gaap ones. Reading only us-gaap
  // leaves the surface blank for every non-US peer -- which, for a
  // semiconductor comparison, means losing the foundry.
  const s = series('TSM');
  assert.ok(s.coverage.revenue.tagsUsed.some((t) => t === 'Revenue' || t === 'RevenueFromContractsWithCustomers'));

  // A 20-F filer files ANNUALLY and is not required to file 10-Qs, so there are
  // no quarterly XBRL facts at all. Anything keyed on TTM must therefore fall
  // back to an annual basis or foreign peers come back empty.
  const annual = Object.keys(s.annual).filter((k) => s.annual[k].revenue).sort(compareFrames);
  assert.ok(annual.length > 4, `only ${annual.length} annual periods — the IFRS family did not resolve`);

  // TSM files everything in BOTH TWD and USD. A TWD figure is ~32x the USD one,
  // so taking whichever unit came first would silently inflate the company.
  const latest = s.annual[annual[annual.length - 1]].revenue.val;
  assert.ok(latest > 5e10 && latest < 2e11, `annual revenue ${latest} is not USD-scaled`);
});

test('every fixture builds without throwing and reports a fiscal year end', () => {
  for (const t of ['NVDA', 'AAPL', 'SWKS', 'QRVO', 'GLW', 'MSTR', 'JPM', 'TSM']) {
    const s = series(t);
    assert.ok(s.fiscalYearEnd, `${t} has no inferable fiscal year end`);
    assert.equal(typeof s.isCalendarFY, 'boolean');
  }
});

/* ---- bank revenue ------------------------------------------------------- */

test('a bank filing only the ASC 606 fee slice does not report it as revenue', () => {
  /* Zions tags RevenueFromContractWithCustomerExcludingAssessedTax and no
     revenue total. Taken literally that is $0.53bn against a real $3.4bn --
     a sixfold understatement that every margin then divides by, and which
     looks entirely plausible on the screen. */
  const s = series('ZION');
  const frame = Object.keys(s.ttm).filter((f) => s.ttm[f].revenue).sort(compareFrames).pop();
  const rev = s.ttm[frame].revenue.val;
  assert.ok(rev > 3e9 && rev < 5e9,
    `Zions TTM revenue ${(rev / 1e9).toFixed(2)}B should be ~3.4B, not the fee slice`);

  const q = s.quarterly[frame].revenue;
  assert.equal(q.derived, true);
  assert.equal(q.method, 'NII+noninterest');
  assert.match(q.tag, /InterestIncomeExpenseNet\+/);
  assert.ok(s.warnings.some((w) => w.code === 'CONTRACT_REVENUE_SUPERSEDED'),
    'superseding a filed tag must be warned about, never silent');
});

test('a bank that files a real revenue total keeps it', () => {
  const s = series('JPM');
  const frame = Object.keys(s.ttm).filter((f) => s.ttm[f].revenue).sort(compareFrames).pop();
  const q = s.quarterly[frame].revenue;
  assert.equal(q.derived, false, 'JPM tags RevenuesNetOfInterestExpense; nothing to compose');
  assert.match(q.tag, /RevenuesNetOfInterestExpense|Revenues/);
});

test('composition never fires for a non-bank', () => {
  for (const t of ['NVDA', 'AAPL', 'GLW']) {
    const s = series(t);
    const frame = Object.keys(s.ttm).filter((f) => s.ttm[f].revenue).sort(compareFrames).pop();
    assert.notEqual(s.quarterly[frame].revenue.method, 'NII+noninterest', `${t} composed a bank top line`);
  }
});

test('CME: a share count exists even with no usable cover-page fact', () => {
  /* SEC holds two dei share facts for CME, both from 2010. The us-gaap
     fallback and then the diluted count are what keep market cap from being
     blank -- and the diluted count must come from ONE quarter, never from the
     TTM bag, which sums four and would be four times too large. */
  const s = series('CME');
  const frame = Object.keys(s.ttm).filter((f) => s.ttm[f].revenue).sort(compareFrames).pop();
  const q = s.quarterly[frame]?.dilutedShares;
  assert.ok(q?.val > 3e8 && q.val < 4.5e8, `CME diluted shares ${q?.val} should be ~360M`);
  assert.equal(s.ttm[frame]?.dilutedShares, undefined,
    'a share count must never survive the TTM sum as if it were a flow');
});

test('CME: UnsecuredLongTermDebt is picked up as a debt total', () => {
  const s = series('CME');
  const frame = Object.keys(s.ttm).filter((f) => s.ttm[f].revenue).sort(compareFrames).pop();
  const d = s.instants[`${frame}I`]?.longTermDebtTotal;
  assert.ok(d?.val > 3e9 && d.val < 4e9, `CME long-term debt ${d?.val} should be ~3.42B`);
  assert.equal(d.tag, 'UnsecuredLongTermDebt');
});

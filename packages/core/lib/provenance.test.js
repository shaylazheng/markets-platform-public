/* provenance.js against the same real fixtures. No network.
 * Run: node --test server/lib/provenance.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeries, compareFrames } from './xbrl.js';
import { METRIC_INPUTS } from './ratios.js';
import { buildProvenance, traceConcept, filingUrl, conceptUrl, filingIndex } from './provenance.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const series = (t) =>
  buildSeries(JSON.parse(readFileSync(join(HERE, 'fixtures', 'companyfacts', `${t}.json`), 'utf8')));
const latestTtm = (s) => Object.keys(s.ttm).sort(compareFrames).pop();
const latestAnnual = (s) =>
  Object.keys(s.annual).filter((f) => s.annual[f].revenue).sort(compareFrames).pop();

const CIK = '0001045810';   // NVDA

/* ---- the claim this file exists to make --------------------------------- */

test('a TTM figure decomposes into the four quarters it is the sum of', () => {
  const s = series('NVDA');
  const frame = latestTtm(s);
  const t = traceConcept(s, 'revenue', frame, { cik: CIK });

  assert.equal(t.basis, 'ttm');
  assert.equal(t.parts.length, 4, 'TTM is four quarters; showing one filing would overclaim');
  // The parts must actually add to the published figure, or the inspector is
  // citing documents for a number they do not support.
  const summed = t.parts.reduce((a, p) => a + p.val, 0);
  assert.equal(summed, t.val);
  assert.equal(t.val, s.ttm[frame].revenue.val);

  for (const p of t.parts) {
    assert.ok(p.tag, 'every part names the XBRL tag it came from');
    assert.ok(p.form && p.filed, 'every part names the filing it came from');
    assert.match(p.url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//);
    assert.match(p.conceptUrl, /companyconcept/);
  }
});

test('a quarter SEC never published as a discrete number says so', () => {
  const s = series('NVDA');
  const t = traceConcept(s, 'revenue', latestTtm(s), { cik: CIK });
  const derived = t.parts.filter((p) => p.derived);
  assert.ok(derived.length >= 1,
    'NVDA files Q4 only inside the 10-K; at least one quarter is recovered, not filed');
  for (const p of derived) {
    assert.ok(p.methodLabel, 'a derived quarter must explain how it was obtained');
    assert.match(p.methodLabel, /derived/);
  }
  // A filed quarter must never be labelled derived -- that would understate
  // provenance in the other direction.
  for (const p of t.parts.filter((x) => !x.derived)) assert.equal(p.methodLabel, null);
});

test('a trace carries its unit, so a share count is not printed as dollars', () => {
  const s = series('NVDA');
  const frame = latestTtm(s);
  assert.equal(traceConcept(s, 'revenue', frame, { cik: CIK }).unit, 'USD');
  assert.equal(traceConcept(s, 'dilutedShares', frame, { cik: CIK }).unit, 'shares');
  assert.equal(traceConcept(s, 'epsDiluted', frame, { cik: CIK }).unit, 'USD/shares');
  assert.equal(traceConcept(s, 'sharesOutstanding', `${frame}I`, { cik: CIK }).unit, 'shares');
});

test('an instant traces to one balance-sheet date, never to a sum', () => {
  const s = series('NVDA');
  const frame = latestTtm(s);
  const t = traceConcept(s, 'equity', `${frame}I`, { cik: CIK });
  assert.equal(t.basis, 'instant');
  assert.equal(t.parts.length, 1);
  assert.equal(t.val, s.instants[`${frame}I`].equity.val);
});

test('an annual-only filer traces to its 20-F', () => {
  const s = series('TSM');
  const t = traceConcept(s, 'revenue', latestAnnual(s), { cik: '0001046179' });
  assert.equal(t.basis, 'annual');
  assert.equal(t.parts.length, 1);
  assert.equal(t.parts[0].form, '20-F');
  assert.equal(t.parts[0].taxonomy, 'ifrs-full',
    'the taxonomy must survive into provenance, or companyconcept links 404');
});

test('a concept the filer does not report traces to nothing, not to a guess', () => {
  const s = series('TSM');
  // TSM files no us-gaap AssetsCurrent and no diluted-share count in USD.
  assert.equal(traceConcept(s, 'dilutedShares', latestAnnual(s), { cik: '0001046179' }), null);
  assert.equal(traceConcept(s, 'revenue', 'CY1999', { cik: '0001046179' }), null);
  assert.equal(traceConcept(s, 'revenue', null, { cik: '0001046179' }), null);
  assert.equal(traceConcept(s, 'notAConcept', latestAnnual(s), { cik: '0001046179' }), null);
});

test('an annual filer that reports equity gets an ROE — the instant frame is resolved', () => {
  // Regression: avgStock() derived the balance-sheet key from the FLOW frame,
  // so an annual frame looked for `CY2024I` and found nothing. Every foreign
  // private issuer read "equity not reported" with its equity in the series.
  const s = series('TSM');
  const frame = latestAnnual(s);
  const p = buildProvenance(s, frame, { cik: '0001046179' });
  assert.ok(p.concepts.equity, 'TSM does report equity on its 20-F balance sheet');
  assert.equal(p.concepts.equity.parts[0].form, '20-F');
});

/* ---- the assembled payload ---------------------------------------------- */

test('buildProvenance covers every concept the metrics actually read', () => {
  const s = series('NVDA');
  const frame = latestTtm(s);
  const p = buildProvenance(s, frame, { cik: CIK });

  assert.equal(p.frame, frame);
  assert.equal(p.instantFrame, `${frame}I`);
  assert.equal(p.priorFrame, `CY${Number(frame.slice(2, 6)) - 1}${frame.slice(6)}`);

  // Every metric's declared inputs must be resolvable to a trace or explicitly
  // absent -- an id that silently resolves to undefined is the failure mode.
  for (const [metric, spec] of Object.entries(METRIC_INPUTS)) {
    for (const id of spec.flows || []) {
      assert.ok(!(id in p.concepts) || p.concepts[id].parts.length,
        `${metric} input ${id} traced to an empty part list`);
    }
  }
  assert.ok(p.concepts.revenue && p.concepts.equity && p.concepts.cfo,
    'the load-bearing concepts must all trace');
  assert.ok(p.priors.revenue, 'revenue growth needs the prior-year frame traced too');
  assert.equal(p.priors.revenue.parts.length, 4);
});

test('an annual frame resolves its balance-sheet date from the fact, not the frame', () => {
  const s = series('TSM');
  const frame = latestAnnual(s);
  const p = buildProvenance(s, frame, { cik: '0001046179' });
  assert.match(p.instantFrame, /^CY\d{4}Q\dI$/);
  assert.equal(p.priorFrame, `CY${Number(frame.slice(2)) - 1}`);
});

/* ---- URL construction ---------------------------------------------------- */

test('a filing without a known primary document still resolves to its index', () => {
  const withDoc = filingUrl(CIK, '0001045810-26-000021', 'nvda-20260125.htm');
  assert.equal(withDoc,
    'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm');
  const without = filingUrl(CIK, '0001045810-26-000021');
  assert.equal(without,
    'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/0001045810-26-000021-index.htm');
  assert.equal(filingUrl(CIK, null), null, 'no accession, no link — never a guessed URL');
});

test('conceptUrl is keyed by taxonomy, so an IFRS tag does not 404 under us-gaap', () => {
  assert.equal(conceptUrl(CIK, 'ifrs-full', 'Revenue'),
    'https://data.sec.gov/api/xbrl/companyconcept/CIK0001045810/ifrs-full/Revenue.json');
  assert.equal(conceptUrl(CIK, null, 'Revenue'), null);
});

test('filingIndex tolerates a missing or empty submissions payload', () => {
  assert.equal(filingIndex(null).size, 0);
  assert.equal(filingIndex({ filings: {} }).size, 0);
  const idx = filingIndex({ filings: { recent: {
    accessionNumber: ['0001-26-000001'], form: ['10-Q'],
    filingDate: ['2026-05-20'], primaryDocument: ['x.htm'] } } });
  assert.equal(idx.get('0001-26-000001').primaryDocument, 'x.htm');
});

test('provenance builds without submissions — links degrade, nothing throws', () => {
  const s = series('NVDA');
  const p = buildProvenance(s, latestTtm(s), { cik: CIK, submissions: null });
  assert.equal(p.filings.tenK, null);
  assert.ok(p.filings.companyFacts.includes(CIK));
  for (const part of p.concepts.revenue.parts) assert.match(part.url, /-index\.htm$/);
});

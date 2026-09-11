/* The wide metric catalogue, against the same real companyfacts fixtures.
 * No network.
 *
 * The fixtures carry a bank (JPM, ZION), an ADR (TSM), a negative-equity
 * company (MSTR) and four ordinary filers. There is no insurer or REIT fixture,
 * so those two families are tested against synthetic series — which is honest
 * about what is and is not covered here, and is why the sector guards that CAN
 * be tested against a real filer are.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeries, compareFrames, CONCEPTS } from './xbrl.js';
import { METRICS } from './ratios.js';
import {
  computeExtended, metricsForSector,
  EXTENDED_CONCEPTS, EXTENDED_INPUTS, EXTENDED_METRICS,
} from './metrics.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ALL_CONCEPTS = { ...CONCEPTS, ...EXTENDED_CONCEPTS };

const series = (t) => buildSeries(
  JSON.parse(readFileSync(join(HERE, 'fixtures', 'companyfacts', `${t}.json`), 'utf8')),
  { concepts: ALL_CONCEPTS });

const latestTtm = (s) => Object.keys(s.ttm).sort(compareFrames).pop();

/* The sector comes from the SIC code, which lives in SEC's submissions index
   and NOT in companyfacts — so a fixture cannot carry it and every caller has
   to supply it. These are the real codes: JPM and ZION are national commercial
   banks, the rest are ordinary operating companies. */
const SIC = { JPM: '6021', ZION: '6022' };
const ext = (t, opts = {}) => {
  const s = series(t);
  return computeExtended(s, { frame: latestTtm(s), sic: SIC[t] || '7372', ...opts });
};

/* ---- the table must not drift from the arithmetic ------------------------ */

test('every metric declares its inputs', () => {
  for (const m of EXTENDED_METRICS) {
    assert.ok(EXTENDED_INPUTS[m.id], `${m.id} has no EXTENDED_INPUTS entry`);
  }
});

test('every declared input is a concept that actually exists', () => {
  for (const [id, spec] of Object.entries(EXTENDED_INPUTS)) {
    for (const key of [...(spec.flows || []), ...(spec.priors || []), ...(spec.instants || [])]) {
      assert.ok(ALL_CONCEPTS[key], `${id} claims concept "${key}", which is in neither map`);
    }
  }
});

test('no extended id shadows one of the twelve comparison metrics', () => {
  // A duplicate id would make a merged picker show two entries that compute
  // differently under the same label.
  const base = new Set(METRICS.map((m) => m.id));
  for (const m of EXTENDED_METRICS) assert.ok(!base.has(m.id), `${m.id} collides with ratios.METRICS`);
});

test('ids are unique within the catalogue', () => {
  const seen = new Set();
  for (const m of EXTENDED_METRICS) {
    assert.ok(!seen.has(m.id), `duplicate id ${m.id}`);
    seen.add(m.id);
  }
});

/* ---- sector scoping ------------------------------------------------------ */

test('a software company is never offered a loss ratio', () => {
  // onlyFor, not naFor: for a non-insurer the metric does not exist, so it must
  // not appear as an empty cell inviting the reader to wonder what is missing.
  const general = metricsForSector('general').map((m) => m.id);
  for (const id of ['lossRatio', 'combinedRatio', 'netInterestMargin', 'ffo', 'pToFfo']) {
    assert.ok(!general.includes(id), `${id} offered to a general company`);
  }
  const r = ext('NVDA');
  assert.ok(!('lossRatio' in r.values));
  assert.ok(!('netInterestMargin' in r.values));
});

test('a bank is offered the bank family and refused the ones that do not apply', () => {
  const bank = metricsForSector('bank').map((m) => m.id);
  assert.ok(bank.includes('netInterestMargin'));
  assert.ok(bank.includes('efficiencyRatio'));
  assert.ok(!bank.includes('lossRatio'));

  const r = ext('JPM');
  // A bank has no current/non-current split, so a quick ratio is undefined
  // rather than merely unreported — and 'na' is excluded from ranking.
  assert.equal(r.values.quickRatio, 'na');
  assert.equal(r.values.ebitdaMargin, 'na');
  assert.equal(r.sectorProfile, 'bank');
});

test('the bank family actually computes on a real bank', () => {
  for (const t of ['JPM', 'ZION']) {
    const r = ext(t);
    assert.equal(r.sectorProfile, 'bank', `${t} should classify as a bank`);
    const nim = r.values.netInterestMargin;
    assert.ok(nim === null || Number.isFinite(nim), `${t} NIM must be a number or null`);
    // A plausible NIM is single-digit percent. This catches a units error --
    // dividing by a share count, or by a quarterly rather than average asset
    // base -- which would otherwise render as a confident 400%.
    if (Number.isFinite(nim)) assert.ok(nim > 0 && nim < 0.15, `${t} NIM out of range: ${nim}`);
  }
});

/* ---- arithmetic ---------------------------------------------------------- */

test('free cash flow is cash from operations minus capital expenditure', () => {
  const s = series('AAPL');
  const frame = latestTtm(s);
  const r = computeExtended(s, { frame });
  const cfo = s.ttm[frame]?.cfo?.val;
  const capex = s.ttm[frame]?.capex?.val;
  if (cfo != null && capex != null) {
    assert.equal(r.values.fcfAbs, cfo - capex);
    assert.ok(r.values.fcfAbs > 0, 'AAPL should generate free cash flow');
  }
});

test('absolute scale metrics carry no better/worse direction', () => {
  // Painting revenue green would rank companies by size while claiming to rank
  // them by quality.
  for (const id of ['revenueAbs', 'assetsAbs', 'netIncomeAbs', 'cfoAbs']) {
    assert.equal(EXTENDED_METRICS.find((m) => m.id === id).higherIsBetter, null);
  }
});

/* ---- the guards ---------------------------------------------------------- */

test('negative book value yields null P/B, not a large positive that ranks cheapest', () => {
  const s = series('MSTR');
  const frame = latestTtm(s);
  const equity = s.instants[`${frame}I`]?.equity?.val;
  const r = computeExtended(s, { frame, market: { close: 100, sharesOutstanding: 1e6 } });

  if (equity != null && equity <= 0) {
    assert.equal(r.values.pb, null);
    assert.match(r.notes.pb, /negative or zero book/);
    assert.equal(r.values.debtToEquity, null);
  }
  assert.ok(r.values.pb === null || r.values.pb === 'na' || Number.isFinite(r.values.pb));
});

test('an ADR gets no price-times-share-count metric at all', () => {
  // TSM files 25.93bn ORDINARY shares on a 20-F; one ADR is five of them, and
  // that ratio is nowhere in XBRL. The resulting numbers are unrecoverably
  // wrong rather than uncertain, so they are suppressed.
  const s = series('TSM');
  const frame = latestTtm(s) || Object.keys(s.annual).sort(compareFrames).pop();
  const r = computeExtended(s, { frame, market: { close: 200 } });
  for (const id of ['ps', 'pb', 'evToSales', 'earningsYield']) {
    assert.ok(r.values[id] == null || r.values[id] === 'na',
      `${id} must be suppressed for an ADR, got ${r.values[id]}`);
  }
});

const synth = ({ flows = {}, instants = {}, frame = 'CY2025Q4' } = {}) => ({
  ttm: { [frame]: Object.fromEntries(Object.entries(flows).map(([k, v]) => [k, { val: v }])) },
  quarterly: {}, annual: {},
  instants: { [`${frame}I`]: Object.fromEntries(Object.entries(instants).map(([k, v]) => [k, { val: v }])) },
});

test('FCF conversion against a loss is null, not a large negative', () => {
  const r = computeExtended(synth({ flows: { cfo: 500, capex: 100, netIncome: -200 } }),
    { frame: 'CY2025Q4' });
  assert.equal(r.values.fcfConversion, null);
  assert.match(r.notes.fcfConversion, /negative/);
});

test('no interest expense means undefined coverage, not infinite coverage', () => {
  const r = computeExtended(synth({ flows: { operatingIncome: 1000, interestExpense: 0 } }),
    { frame: 'CY2025Q4' });
  assert.equal(r.values.interestCoverage, null);
  assert.match(r.notes.interestCoverage, /undefined, not infinite/);
});

test('a combined ratio needs both halves or it is not published', () => {
  const opts = { frame: 'CY2025Q4', sic: '6331' };
  const half = computeExtended(synth({ flows: { premiumsEarned: 1000, lossesIncurred: 600 } }), opts);
  assert.equal(half.sectorProfile, 'insurance');
  assert.equal(half.values.lossRatio, 0.6);
  // The expense half is missing. Substituting SG&A would produce a number that
  // looks like a combined ratio and is not one.
  assert.equal(half.values.combinedRatio, null);

  const both = computeExtended(
    synth({ flows: { premiumsEarned: 1000, lossesIncurred: 600, underwritingExpense: 300 } }), opts);
  assert.equal(both.values.combinedRatio, 0.9);
});

test('FFO adds depreciation back and subtracts property gains', () => {
  const opts = { frame: 'CY2025Q4', sic: '6798' };
  const r = computeExtended(synth({
    flows: { netIncome: 100, dna: 400, gainOnSaleOfRealEstate: 50, dividendsPaid: 300 },
  }), opts);
  assert.equal(r.sectorProfile, 'reit');
  assert.equal(r.values.ffo, 450);
  assert.equal(r.values.ffoPayout, 300 / 450);
});

test('FFO says so when it had no gains figure to subtract', () => {
  const r = computeExtended(synth({ flows: { netIncome: 100, dna: 400 } }),
    { frame: 'CY2025Q4', sic: '6798' });
  assert.equal(r.values.ffo, 500);
  assert.match(r.notes._ffo, /no property-sale gain tagged/);
});

test('a missing input is named rather than left as a bare dash', () => {
  const r = computeExtended(synth({ flows: { revenue: 1000 } }), { frame: 'CY2025Q4' });
  assert.equal(r.values.netMargin, null);
  assert.match(r.notes.netMargin, /net income not reported/);
});

test('shareholder yield stays null when neither dividends nor buybacks are tagged', () => {
  // "Not filed" and "returned nothing" are not distinguishable in companyfacts,
  // so claiming a 0% yield would be an assertion the data does not support.
  const r = computeExtended(synth({ flows: { revenue: 1000 }, instants: { sharesOutstanding: 100 } }),
    { frame: 'CY2025Q4', market: { close: 10 } });
  assert.equal(r.values.shareholderYield, null);
  assert.match(r.notes.shareholderYield, /neither dividends nor buybacks/);
});

test('every fixture computes without throwing, on every sector path', () => {
  for (const t of ['AAPL', 'CME', 'GLW', 'JPM', 'MSTR', 'NVDA', 'QRVO', 'SWKS', 'TSM', 'ZION']) {
    const s = series(t);
    const frame = latestTtm(s) || Object.keys(s.annual).sort(compareFrames).pop();
    if (!frame) continue;
    const r = computeExtended(s, { frame, market: { close: 50 }, sic: SIC[t] || '7372' });
    for (const [id, v] of Object.entries(r.values)) {
      assert.ok(v === null || v === 'na' || Number.isFinite(v),
        `${t}.${id} is neither null, na nor finite: ${v}`);
    }
  }
});

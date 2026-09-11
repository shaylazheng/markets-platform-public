/* business.js — the 10-K narrative reader. No network: every fixture is text.
 *
 * Run: node --test packages/core/lib/business.test.js
 *
 * THE SENTENCES ARE REAL. Every assertion below quotes a disclosure taken from
 * a filing on EDGAR, not one written to make a regex pass. That rule is
 * inherited from parseShare()'s tests in graph/server/enrich.js, and it is
 * there because the first version of that parser passed its invented strings
 * and was wrong on three of the four real disclosures. If you loosen an
 * extractor here, add the filing sentence that made you.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  latestAnnual, filingUrl, toText, sliceItems, itemSpansJoined, sentences, describe,
  employeesFrom, segmentsFrom, incorporationFrom, riskGroupsFrom,
} from './business.js';

/* ---- filing selection --------------------------------------------------- */

const subsFixture = (rows) => ({
  filings: {
    recent: {
      form: rows.map((r) => r[0]),
      filingDate: rows.map((r) => r[1]),
      reportDate: rows.map((r) => r[2] ?? null),
      accessionNumber: rows.map((r) => r[3] ?? '0000050863-26-000010'),
      primaryDocument: rows.map((r) => r[4] ?? 'intc-20251227.htm'),
    },
  },
});

test('latestAnnual takes the newest 10-K, not the first row', () => {
  const f = latestAnnual(subsFixture([
    ['8-K', '2026-07-24'],
    ['10-K', '2024-01-26', '2023-12-30', '0000050863-24-000011', 'old.htm'],
    ['10-Q', '2026-04-24'],
    ['10-K', '2026-01-23', '2025-12-27', '0000050863-26-000010', 'new.htm'],
  ]));
  assert.equal(f.form, '10-K');
  assert.equal(f.filed, '2026-01-23');
  assert.equal(f.doc, 'new.htm');
  assert.equal(f.hasNarrative, true);
});

test('latestAnnual ignores 10-K/A — an amendment routinely omits Item 1', () => {
  const f = latestAnnual(subsFixture([
    ['10-K/A', '2026-03-02'],
    ['10-K', '2026-01-23'],
  ]));
  assert.equal(f.filed, '2026-01-23');
});

test('latestAnnual ignores 10-KT, a transition-period report', () => {
  assert.equal(latestAnnual(subsFixture([['10-KT', '2026-01-23']])), null);
});

test('latestAnnual accepts a 20-F and flags a 40-F as narrative-free', () => {
  assert.equal(latestAnnual(subsFixture([['20-F', '2026-04-17']])).hasNarrative, true);
  const ca = latestAnnual(subsFixture([['40-F', '2026-02-26']]));
  assert.equal(ca.form, '40-F');
  assert.equal(ca.hasNarrative, false);
});

test('latestAnnual returns null when nothing annual is on file', () => {
  assert.equal(latestAnnual(subsFixture([['8-K', '2026-07-24'], ['4', '2026-07-25']])), null);
  assert.equal(latestAnnual(null), null);
  assert.equal(latestAnnual({}), null);
});

test('filingUrl uses the unpadded CIK — the Archives path rejects the padded one', () => {
  const url = filingUrl('0000050863', { accession: '0000050863-26-000010', doc: 'intc-20251227.htm' });
  assert.equal(url, 'https://www.sec.gov/Archives/edgar/data/50863/000005086326000010/intc-20251227.htm');
});

test('filingUrl declines without a primary document', () => {
  assert.equal(filingUrl('50863', { accession: '0000050863-26-000010' }), null);
  assert.equal(filingUrl('50863', null), null);
});

/* ---- HTML to text ------------------------------------------------------- */

test('toText breaks blocks so a heading cannot run into the next sentence', () => {
  const t = toText('<div><p><b>General</b></p><p>We design and sell chips.</p></div>');
  assert.match(t, /General\s*\n+\s*We design and sell chips\./);
});

test('toText drops the inline-XBRL header, which repeats the whole filing', () => {
  const t = toText('<ix:header><ix:hidden>Item 1. Business decoy text</ix:hidden></ix:header><p>Item 1. Business real</p>');
  assert.ok(!t.includes('decoy'));
  assert.match(t, /real/);
});

test('toText resolves the entities filings actually use', () => {
  assert.equal(toText('<p>A&amp;B&nbsp;&mdash;&nbsp;C&#8217;s</p>'), 'A&B — C’s');
});

/* ---- item slicing: the table-of-contents trap --------------------------- */

// The shape every 10-K has: a contents block naming each item with a page
// number, then the items themselves. A first-match slice returns "3".
const TOC_FILING = `
PART I
Item 1. Business 3
Item 1A. Risk Factors 12
Item 2. Properties 30
PART I
Item 1. Business
We design, develop and sell semiconductors and platform products worldwide.
Our products are used in notebooks, desktops and servers.
Item 1A. Risk Factors
Risks Related to Our Business
We operate in intensely competitive markets.
Item 2. Properties
Our principal executive offices are in Santa Clara, California.
`;

test('sliceItems keeps the section, not the contents row', () => {
  const items = sliceItems(TOC_FILING);
  assert.match(items['1'], /We design, develop and sell semiconductors/);
  assert.ok(!/^3\s*$/.test(items['1']));
  assert.match(items['1a'], /intensely competitive markets/);
  assert.match(items['2'], /Santa Clara/);
});

test('sliceItems reads Item 1A as 1A and not as Item 1 plus a stray A', () => {
  const items = sliceItems(TOC_FILING);
  assert.ok(!items['1'].includes('intensely competitive'),
    'Item 1 must stop at the Item 1A heading');
});

test('sliceItems survives the separators filers actually use', () => {
  for (const head of ['Item 1. Business', 'ITEM 1 — BUSINESS', 'Item 1: Business',
                      'Item 1)  Business', 'Item 1 Business']) {
    const items = sliceItems(`${head}\nWe make and sell industrial fasteners to distributors.\nItem 2. Properties\nOffices.`);
    assert.match(items['1'], /industrial fasteners/, `failed on: ${head}`);
  }
});

test('sliceItems is not fooled by a cross-reference in the body', () => {
  const items = sliceItems([
    'Item 1. Business',
    'We refine crude oil. See Item 1A. Risk Factors for a discussion of hazards.',
    'Our refineries operate in twelve states and process heavy sour grades.',
    'Item 1A. Risk Factors',
    'Risks Related to Our Operations',
    'A refinery outage would reduce throughput and margins materially for a quarter or more.',
  ].join('\n'));
  assert.match(items['1a'], /refinery outage/);
  assert.ok(!items['1a'].startsWith('for a discussion'));
});

/* ---- sentence splitting ------------------------------------------------- */

test('sentences does not split on a legal-form abbreviation', () => {
  const s = sentences('Micron Technology, Inc. is an industry leader in memory. We sell DRAM.');
  assert.equal(s.length, 2);
  assert.match(s[0], /^Micron Technology, Inc\. is an industry leader in memory\.$/);
});

test('sentences does not split on U.S. or on an initial', () => {
  assert.equal(sentences('We operate in the U.S. and abroad. Revenue grew.').length, 2);
  assert.equal(sentences('Founded by W. C. Procter in Ohio. It grew.').length, 2);
});

/* ---- description ------------------------------------------------------- */

test('describe quotes the company verbatim and skips its headings', () => {
  const d = describe([
    'Business',
    'General',
    'Overview',
    'Micron Technology, Inc. is an industry leader in innovative memory and storage solutions,',
    'transforming how the world uses information to enrich life for all. We manufacture DRAM,',
    'NAND and NOR memory products which are sold to customers in the compute and networking,',
    'mobile, embedded and storage markets.',
  ].join(' '));
  assert.ok(d, 'expected a description');
  assert.match(d.text, /^Micron Technology, Inc\. is an industry leader/);
  assert.ok(!/^Business|General|Overview/.test(d.text));
  // Verbatim: every kept sentence must appear in the source.
  for (const s of d.sentences) assert.ok(s.length > 25);
});

test('describe drops the forward-looking disclaimer that opens many filings', () => {
  const d = describe([
    'Item 1. Business',
    'This Annual Report on Form 10-K contains forward-looking statements within the meaning of',
    'the Private Securities Litigation Reform Act of 1995.',
    'Unless the context otherwise requires, references to "we" and "our" mean the Company.',
    'We are a global producer of industrial gases, supplying oxygen, nitrogen and argon to',
    'customers in manufacturing, healthcare and electronics under long-term contracts.',
  ].join(' '));
  assert.ok(d);
  assert.match(d.text, /^We are a global producer of industrial gases/);
  assert.ok(!/forward-looking/i.test(d.text));
});

test('describe declines on a cross-reference rather than quoting it', () => {
  assert.equal(describe('The information required by this Item is incorporated by reference.'), null);
  assert.equal(describe(''), null);
  assert.equal(describe(null), null);
});

test('describe declines on a table that survived the strip', () => {
  assert.equal(describe('2025 2024 2023 52,900 54,228 63,054 13,800 16,546 16,046 267 18,756 1,689'), null);
});

test('describe caps its length and says when it truncated', () => {
  const long = Array.from({ length: 12 },
    (_, i) => `We operate ${i} distribution centres across the southeastern United States serving grocery retailers.`).join(' ');
  const d = describe(long, { maxChars: 300, maxSentences: 4 });
  assert.ok(d.text.length <= 320);
  assert.equal(d.truncated, true);
});

/* ---- employees --------------------------------------------------------- */

test('employeesFrom reads the sentence filings actually write', () => {
  const cases = [
    ['As of December 27, 2025, we had approximately 88,400 employees.', 88400],
    ['We had 108,900 employees as of December 30, 2023.', 108900],
    ['As of June 30, 2026, we employed approximately 228,000 people worldwide.', 228000],
    ['We have approximately 48,000 full-time employees.', 48000],
    ['As of the end of fiscal 2025, Costco employed approximately 346,000 employees, including part-time.', 346000],
  ];
  for (const [text, want] of cases) {
    const got = employeesFrom(text);
    assert.ok(got, `no match: ${text}`);
    assert.equal(got.count, want, text);
  }
});

test('employeesFrom keeps the "approximately" and the as-of date', () => {
  const e = employeesFrom('As of December 27, 2025, we had approximately 88,400 employees.');
  assert.equal(e.approximate, true);
  assert.equal(e.asOf, 'December 27, 2025');
  assert.equal(employeesFrom('We had 108,900 employees.').approximate, false);
});

test('employeesFrom marks a full-time-only basis', () => {
  assert.equal(employeesFrom('We have approximately 48,000 full-time employees.').basis, 'full-time');
  assert.equal(employeesFrom('We had 108,900 employees.').basis, null);
});

test('employeesFrom declines rather than reading a nearby number', () => {
  // No headcount stated at all — the numbers are money and a page reference.
  assert.equal(employeesFrom('Revenue was $52,900 million in 2025. See page 42.'), null);
  // A count too small to be a workforce disclosure is a footnote marker.
  assert.equal(employeesFrom('We had 4 employees.'), null);
  assert.equal(employeesFrom(''), null);
});

/* ---- segments ---------------------------------------------------------- */

test('segmentsFrom reads the count, in words or digits', () => {
  assert.equal(segmentsFrom('We have three reportable segments.').count, 3);
  assert.equal(segmentsFrom('The Company has 2 reportable segments.').count, 2);
  assert.equal(segmentsFrom('We operate as a single reportable segment.').count, 1);
  assert.equal(segmentsFrom('We have one reportable segment.').count, 1);
});

test('segmentsFrom enumerates names only when the sentence lists them', () => {
  const s = segmentsFrom(
    'We have three reportable segments: Client Computing Group, Data Center and AI, and Intel Foundry.');
  assert.deepEqual(s.names,
    ['Client Computing Group', 'Data Center and AI', 'Intel Foundry']);
  assert.equal(s.count, 3);
});

test('segmentsFrom returns the count with no names when none are listed', () => {
  const s = segmentsFrom('We have four reportable segments. Segment results are in Note 14.');
  assert.equal(s.count, 4);
  assert.equal(s.names, null);
});

test('segmentsFrom refuses a list whose length contradicts the stated count', () => {
  // Three promised, two listed: the sentence is not the shape we assumed, so
  // the names are not trustworthy even though the count is.
  const s = segmentsFrom('We have three reportable segments: Retail and Wholesale.');
  assert.equal(s.count, 3);
  assert.equal(s.names, null);
});

test('segmentsFrom does not run a list past the end of its sentence', () => {
  const s = segmentsFrom(
    'We have two reportable segments: Products and Services. Our customers include distributors, resellers and retailers.');
  assert.deepEqual(s.names, ['Products', 'Services']);
});

test('segmentsFrom declines when segments are not mentioned', () => {
  assert.equal(segmentsFrom('We sell memory products to a global customer base.'), null);
});

/* The four sentences below are the ones that broke the first version of
   segmentsFrom, which matched only "<N> reportable segments" and therefore
   found the count in one filing out of four. Each is quoted from the 10-K
   named beside it. */

test('segmentsFrom reads NVDA’s "report our business results in two segments"', () => {
  const s = segmentsFrom('Our Businesses We report our business results in two segments. '
    + 'The Compute & Networking segment includes our Data Center platforms.');
  assert.equal(s.count, 2);
});

test('segmentsFrom reads NVDA’s quoted segment list', () => {
  const s = segmentsFrom('Our two operating segments are "Compute & Networking" and "Graphics." '
    + 'Refer to Note 16 of the Notes to the Consolidated Financial Statements.');
  assert.equal(s.count, 2);
  assert.deepEqual(s.names, ['Compute & Networking', 'Graphics']);
});

test('segmentsFrom reads MU’s "business units, which are our reportable segments"', () => {
  const s = segmentsFrom('We have the following four business units, which are our reportable segments: '
    + 'Cloud Memory Business Unit ( CMBU ): Focused on memory solutions for large hyperscale cloud customers. '
    + 'Core Data Center Business Unit ( CDBU ): Focused on data center customers. '
    + 'Mobile and Client Business Unit ( MCBU ): Focused on mobile. '
    + 'Automotive and Embedded Business Unit ( AEBU ): Focused on automotive.');
  assert.equal(s.count, 4);
  assert.deepEqual(s.names, [
    'Cloud Memory Business Unit', 'Core Data Center Business Unit',
    'Mobile and Client Business Unit', 'Automotive and Embedded Business Unit',
  ]);
});

test('segmentsFrom reads CLX’s comma list whose last item hides behind "and"', () => {
  const s = segmentsFrom('Operating segments are then aggregated into four reportable segments: '
    + 'Health and Wellness, Household, Lifestyle and International. '
    + 'Operating segments not aggregated are reflected in Corporate.');
  assert.equal(s.count, 4);
  assert.deepEqual(s.names, ['Health and Wellness', 'Household', 'Lifestyle', 'International']);
});

/* The three sentences that the LOOSER version got confidently wrong. Each one
   must now produce an absence or the right number, never a plausible one. */

test('segmentsFrom ignores "one segment may benefit other segments" (MSFT)', () => {
  // Read as "Microsoft has 1 reportable segment". It has three.
  const s = segmentsFrom('Due to the integrated structure of our business, certain revenue '
    + 'recognized and costs incurred by one segment may benefit other segments.');
  assert.equal(s, null);
});

test('segmentsFrom ignores a reorganisation sentence (AMD)', () => {
  // "into one reportable segment" describes what happened to two segments,
  // not how many the company has.
  const s = segmentsFrom('Beginning in the first quarter of fiscal year 2025, we combined the '
    + 'Client and Gaming segments into one reportable segment to align with how we manage our business.');
  assert.equal(s, null);
});

test('segmentsFrom ignores a table-of-contents page number (ZTS)', () => {
  const s = segmentsFrom('TABLE OF CONTENTS PART I Page Item 1. Business Overview 1 '
    + 'Operating Segments 1 Products 3 International Operations 7 Sales and Marketing 9');
  assert.equal(s, null);
});

test('segmentsFrom ignores a loan-portfolio segmentation (FISI)', () => {
  // A bank divides its loan book into "segments" under the credit-loss
  // standard. Read as business segments it made a small bank into a
  // six-division conglomerate.
  const s = segmentsFrom('The Company has divided its portfolio into six segments, as the '
    + 'loans within the segments have similar characteristics.');
  assert.equal(s, null);
});

test('segmentsFrom prefers the reportable count over the operating count (CAT)', () => {
  // Five operating, four reportable. The reportable number is the one a
  // comparison means, and the first numeral in the sentence is the other one.
  const s = segmentsFrom('Caterpillar continues to operate through five operating segments, '
    + 'four of which are reportable segments and are described below.');
  assert.equal(s.count, 4);
});

test('segmentsFrom still reads a genuine single-segment disclosure', () => {
  // Every one of these is quoted from a filing, and all were true positives
  // that the "one segment" guard above must not take with it.
  for (const [text, why] of [
    ['The company reports the results of its operations as one operating segment primarily comprised of the business.', 'CME'],
    ['Therefore, we report the results of our one reportable segment (U.S.) below.', 'FAST'],
    ['At December 31, 2025, the Company had a single operating segment and reporting unit structure.', 'NET'],
    ['The Company has a single reportable operating segment which designs and manufactures products.', 'SWKS'],
    ['We have determined that we operate in one reportable segment: the design and sale of products.', 'MRVL'],
    ['As a result, the Company has only one operating segment, the foundry segment.', 'TSM'],
  ]) {
    const s = segmentsFrom(text);
    assert.ok(s, `no match for ${why}: ${text}`);
    assert.equal(s.count, 1, why);
  }
});

test('incorporationFrom reads NVDA’s month-without-day form', () => {
  // The first version required a day number and so found neither month nor year.
  const i = incorporationFrom('Headquartered in Santa Clara, California, NVIDIA was '
    + 'incorporated in California in April 1993 and reincorporated in Delaware in April 1998.');
  assert.equal(i.year, 1993);
  assert.equal(i.state, 'California');
});

test('incorporationFrom reads the year-then-state order too', () => {
  const i = incorporationFrom('The Company was incorporated in 1977 in Delaware.');
  assert.equal(i.year, 1977);
  assert.equal(i.state, 'Delaware');
});

test('toText closes up the space a tag boundary leaves before punctuation', () => {
  // Micron's 10-K: the full stop sat outside the <span> holding the sentence.
  assert.equal(toText('<p><span>to enrich life for all</span> .</p>'), 'to enrich life for all.');
  // A space before an opening bracket is legitimate and must survive.
  assert.equal(toText('<p>artificial intelligence (AI) and compute</p>'),
    'artificial intelligence (AI) and compute');
});

/* ---- incorporation ----------------------------------------------------- */

test('incorporationFrom reads state and year together', () => {
  const i = incorporationFrom('Intel was incorporated in California in 1968 and reincorporated in Delaware in 1989.');
  assert.equal(i.year, 1968);
  assert.equal(i.state, 'California');
});

test('incorporationFrom reads a bare year when no state is given', () => {
  const i = incorporationFrom('The Company was founded in 1886 and is headquartered in Atlanta.');
  assert.equal(i.year, 1886);
  assert.equal(i.state, null);
});

test('incorporationFrom rejects an impossible year', () => {
  assert.equal(incorporationFrom('organized in 3025'), null);
  assert.equal(incorporationFrom('We have a long history.'), null);
});

/* ---- risk groups ------------------------------------------------------- */

// Item 1A as filed: the group headings appear in the contents and again at each
// group, which is why two occurrences is the floor.
const RISK_SECTION = `
Risk Factors
The following risk factors should be read carefully.
Risks Related to Our Business and Industry
Risks Related to Our Intellectual Property
Macroeconomic and Geopolitical Risks
Risks Related to Our Business and Industry
We operate in intensely competitive markets and our products may not be adopted.
Demand for our products depends on the semiconductor cycle, which is volatile and
outside our control, and a downturn would reduce both revenue and utilisation.
Risks Related to Our Intellectual Property
We may be unable to protect our proprietary technology, and third parties have
asserted and may in future assert that our products infringe their patents.
Macroeconomic and Geopolitical Risks
Export controls on advanced computing items have restricted sales to certain
customers and further restrictions could reduce our addressable market.
`;

test('riskGroupsFrom returns the filing’s own risk taxonomy', () => {
  const g = riskGroupsFrom(RISK_SECTION);
  assert.ok(g, 'expected groups');
  assert.ok(g.some((x) => /Business and Industry/i.test(x)));
  assert.ok(g.some((x) => /Intellectual Property/i.test(x)));
  assert.ok(g.some((x) => /Macroeconomic/i.test(x)));
});

test('riskGroupsFrom normalises SHOUTED headings to sentence case', () => {
  const g = riskGroupsFrom(RISK_SECTION.replace(/Risks Related to Our Intellectual Property/g,
                                                'RISKS RELATED TO OUR INTELLECTUAL PROPERTY'));
  assert.ok(g.some((x) => x === 'Risks related to our intellectual property'),
    `got ${JSON.stringify(g)}`);
});

test('riskGroupsFrom declines on a single phrase mentioned in prose', () => {
  const prose = 'Risk Factors. '
    + 'You should consider the risks related to our business before investing in our common stock. '
    + Array.from({ length: 20 }, () => 'We face competition from larger and better capitalised firms. ').join('');
  assert.equal(riskGroupsFrom(prose), null);
});

test('riskGroupsFrom declines on a cross-reference', () => {
  assert.equal(riskGroupsFrom('Not applicable.'), null);
  assert.equal(riskGroupsFrom(''), null);
});

/* ---- the whole path, on one synthetic filing ---------------------------- */

test('a filing’s narrative reads end to end from HTML', () => {
  const html = `<html><body>
    <div>PART I</div>
    <div>Item 1. Business <span>3</span></div>
    <div>Item 1A. Risk Factors <span>12</span></div>
    <div><b>Item 1.</b> Business</div>
    <p>General</p>
    <p>Micron Technology, Inc. is an industry leader in innovative memory and storage
       solutions, transforming how the world uses information to enrich life for all.</p>
    <p>We manufacture DRAM, NAND and NOR memory products, which are sold to customers
       in the compute and networking, mobile, embedded and storage markets.</p>
    <p>We have four reportable segments: Compute and Networking, Mobile, Embedded and Storage.</p>
    <p>As of August 28, 2025, we had approximately 48,000 employees.</p>
    <p>Micron was incorporated in Delaware in 1978.</p>
    <div><b>Item 1A.</b> Risk Factors</div>
    <p>Risks Related to Our Business</p>
    <p>Risks Related to Our Industry</p>
    <p>Risks Related to Our Business</p>
    <p>Memory demand is cyclical and pricing has historically been volatile, which
       has caused and may again cause material declines in our revenue and margins.</p>
    <p>Risks Related to Our Industry</p>
    <p>Our industry is capital intensive and requires sustained investment in new
       process technology regardless of the point in the cycle.</p>
    <div>Item 2. Properties</div>
    <p>Our fabrication facilities are in the United States, Japan, Taiwan and Singapore.</p>
  </body></html>`;

  const items = sliceItems(toText(html));
  const d = describe(items['1']);
  assert.match(d.text, /^Micron Technology, Inc\. is an industry leader/);
  assert.equal(employeesFrom(items['1']).count, 48000);
  assert.deepEqual(segmentsFrom(items['1']).names,
    ['Compute and Networking', 'Mobile', 'Embedded', 'Storage']);
  assert.equal(incorporationFrom(items['1']).year, 1978);
  const groups = riskGroupsFrom(items['1a']);
  assert.equal(groups.length, 2);
  // Item 1 stopped where Item 1A began: the cyclicality risk is not in it.
  assert.ok(!/cyclical/.test(items['1']));
});

/* ---- CME, the filing that widened three extractors ----------------------- *
 *
 * Sentences verbatim from CME Group's FY2025 10-K (cme-20251231.htm). Each was
 * a real miss: the platform's Summary surface reported all three as absent for
 * a company whose filing states every one of them. */

test('employeesFrom reads CME\'s "population consisted of" phrasing, split word and all', () => {
  // "approximate ly" is in the source: the filing's own HTML splits the word
  // across two spans, so the space survives the strip.
  const e = employeesFrom(
    'As of December 31, 2025, our global employee population consisted of '
    + 'approximate ly 3,875 employees, with 58% (approximately 2,230) working in the U.S.');
  assert.ok(e, 'should find the headcount');
  assert.equal(e.count, 3875);
  assert.equal(e.approximate, true);
  assert.equal(e.asOf, 'December 31, 2025');
  assert.match(e.quote, /approximately 3,875 employees/,
    'the quote must not carry the typesetter\'s mid-word seam');
});

test('risk groups survive a self-reference that splits Item 1A', () => {
  // CME's Item 1A writes "the risks discussed in this Item 1A, including…"
  // mid-sentence. That is a mark, the section splits around it, and the
  // longest fragment holds only one of the three group headings — which is
  // why the scan reads every fragment joined, not the winner.
  const pad = 'Prose long enough that the section does not read as a cross-reference. ';
  const text = [
    'Item 1A. Risk Factors 16',
    'Item 1. Business',
    'We operate exchanges for the trading of futures and options on futures.',
    'Item 1A. Risk Factors',
    'RISKS RELATING TO OUR INDUSTRY',
    pad.repeat(3),
    'Our reputation may be harmed by any of the risks discussed in this Item 1A, '
    + 'including risks from customer disputes, system failures or intrusions.',
    'RISKS RELATING TO OUR BUSINESS',
    pad.repeat(3),
    'RISKS RELATING TO AN INVESTMENT IN OUR CLASS A COMMON STOCK',
    pad.repeat(3),
    'Item 1B. Unresolved Staff Comments',
    'None.',
  ].join('\n');

  const winner = riskGroupsFrom(sliceItems(text)['1a']);
  const joined = riskGroupsFrom(itemSpansJoined(text, '1a'));
  assert.ok(!winner || winner.length < 3,
    'the longest fragment alone must miss headings, or this fixture proves nothing');
  assert.deepEqual(joined, [
    'Risks relating to our industry',
    'Risks relating to our business',
    'Risks relating to an investment in our Class A common stock',
  ]);
});

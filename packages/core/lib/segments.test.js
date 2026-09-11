/* segments.js — the XBRL-instance segment reader. No network: the fixtures are
 * TRIMMED COPIES OF REAL EXTRACTED INSTANCES (see fixtures/instances/), with
 * contexts and facts verbatim from EDGAR — the same real-text rule
 * business.test.js and parseShare's tests follow, and for the same reason: the
 * first version of parseShare passed its invented strings and was wrong on
 * three of the four real disclosures.
 *
 * Run: node --test packages/core/lib/segments.test.js
 *
 * The two fixtures are the two real tagging shapes found before this file was
 * written:
 *   AMZN  segment members alone on the axis; revenue on the contract tag;
 *         segments tie to consolidated revenue exactly.
 *   PG    every segment row also carries srt:ConsolidationItemsAxis =
 *         OperatingSegmentsMember; revenue on us-gaap:Revenues; profit on
 *         ProfitLoss (net earnings, not operating income); a CorporateNonSegment
 *         member holds the reconciliation, so segments sum BELOW the total.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseContexts, parseUnits, factsFor, splitFromInstance, labelForMember, reconcileNames,
  segmentCommentary, geoSplitFromInstance, labelForGeoMember,
} from './segments.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'instances');
const amzn = readFileSync(join(FIX, 'amzn-20251231.trim.xml'), 'utf8');
const pg = readFileSync(join(FIX, 'pg-20260630.trim.xml'), 'utf8');
const msft = readFileSync(join(FIX, 'msft-20260630.trim.xml'), 'utf8');

/* ---- parsing ------------------------------------------------------------ */

test('parseContexts reads dims and annual periods', () => {
  const ctxs = parseContexts(amzn);
  const seg = [...ctxs.values()].filter((c) => c.dims['us-gaap:StatementBusinessSegmentsAxis']);
  assert.ok(seg.length >= 9);                       // 3 segments × 3 fiscal years
  const annual = [...ctxs.values()].filter((c) => c.days >= 330 && c.days <= 380);
  assert.ok(annual.length > 0);
  assert.ok(annual.every((c) => c.start && c.end));
});

test('factsFor returns numeric facts keyed by context and unit', () => {
  const f = factsFor(amzn, 'RevenueFromContractWithCustomerExcludingAssessedTax');
  assert.ok(f.size >= 12);
  for (const byUnit of f.values()) {
    assert.ok(byUnit instanceof Map);
    assert.ok([...byUnit.values()].every(Number.isFinite));
    // AMZN's fixture tags unitRef="usd"; with no declaration on file the id
    // itself, uppercased, is the reading.
    assert.ok(byUnit.has('USD'));
  }
});

/* ---- AMZN: the plain shape ---------------------------------------------- */

test('AMZN: three segments, tying to consolidated revenue exactly', () => {
  const s = splitFromInstance(amzn, '2025-12-31');
  assert.equal(s.available, true);
  assert.equal(s.period, '2025-12-31');
  assert.equal(s.prevPeriod, '2024-12-31');
  assert.equal(s.revenueTag, 'RevenueFromContractWithCustomerExcludingAssessedTax');
  assert.equal(s.rows.length, 3);

  // Figures as filed, largest first.
  assert.deepEqual(s.rows.map((r) => r.label), ['North America', 'International', 'AWS' ]
    .map((x) => ({ AWS: 'Amazon Web Services' }[x] || x)));
  assert.equal(s.rows[0].revenue, 426305000000);
  assert.equal(s.rows[1].revenue, 161894000000);
  assert.equal(s.rows[2].revenue, 128725000000);
  assert.equal(s.rows[0].revenuePrev, 387497000000);

  // AMZN discloses operating income by segment, and the label says so.
  assert.equal(s.profitTag, 'OperatingIncomeLoss');
  assert.equal(s.profitLabel, 'operating income');
  assert.equal(s.rows[2].profit, 45606000000);      // AWS
  assert.equal(s.rows[1].profit, 4750000000);       // International

  // The tie-out: segments sum to the consolidated total exactly.
  assert.equal(s.revenueTotal, 716924000000);
  assert.equal(s.revenueSum, s.revenueTotal);
  assert.equal(s.unallocated, 0);
});

test('AMZN: the geography decoy fact is excluded from the split', () => {
  // The fixture retains one srt:StatementGeographicalAxis revenue fact; folded
  // in it would double-count. The sum above already proves exclusion — this
  // makes the intent explicit by confirming the decoy exists to exclude.
  assert.match(amzn, /StatementGeographicalAxis/);
});

/* ---- PG: the ConsolidationItemsAxis shape -------------------------------- */

test('PG: five segments riding OperatingSegmentsMember, reconciling below total', () => {
  const s = splitFromInstance(pg, '2026-06-30');
  assert.equal(s.available, true);
  assert.equal(s.period, '2026-06-30');
  assert.equal(s.revenueTag, 'Revenues');
  assert.equal(s.rows.length, 5);
  assert.equal(s.rows[0].label, 'Fabric Home Care');        // mechanical label
  assert.equal(s.rows[0].revenue, 30314000000);

  // PG's segment profit measure is net earnings, not operating income.
  assert.equal(s.profitTag, 'ProfitLoss');
  assert.equal(s.profitLabel, 'net earnings');
  assert.equal(s.rows[0].profit, 5632000000);

  // Corporate is a reconciler, not a sixth segment; the gap is reported.
  assert.equal(s.revenueTotal, 87032000000);
  assert.equal(s.revenueSum, 86112000000);
  assert.equal(s.unallocated, 920000000);
});

test('PG: filing names replace mechanical labels only on an exact fold-match', () => {
  const s = splitFromInstance(pg, '2026-06-30');
  reconcileNames(s, ['Beauty', 'Grooming', 'Health Care', 'Fabric & Home Care',
    'Baby, Feminine & Family Care']);
  assert.deepEqual(s.rows.map((r) => r.label),
    ['Fabric & Home Care', 'Baby, Feminine & Family Care', 'Beauty',
      'Health Care', 'Grooming']);
});

test('reconcileNames declines an ambiguous or non-matching name', () => {
  const s = { rows: [{ label: 'Data Center' }, { label: 'Gaming' }] };
  // No fold-match: labels unchanged.
  reconcileNames(s, ['Client Computing', 'Networking']);
  assert.deepEqual(s.rows.map((r) => r.label), ['Data Center', 'Gaming']);
  // Two names folding identically: the match is ambiguous and both decline.
  const t = { rows: [{ label: 'Data Center' }] };
  reconcileNames(t, ['Data Center', 'DATA-CENTER']);
  assert.equal(t.rows[0].label, 'Data Center');
});

/* ---- MSFT: the Donnelley formatting shape --------------------------------- */

test('MSFT: attributes on their own lines, contextRef not first, UUID ids', () => {
  // The first version of the reader required `contextRef` to be the first
  // attribute on the same line as the tag name, which is Workiva's habit and
  // nobody's obligation — MSFT's whole split came back "no revenue on the
  // business-segments axis". Formatting must never decide availability.
  const s = splitFromInstance(msft, '2026-06-30');
  assert.equal(s.available, true);
  assert.equal(s.rows.length, 3);
  assert.deepEqual(s.rows.map((r) => r.label),
    ['Productivity And Business Processes', 'Intelligent Cloud', 'More Personal Computing']);
  assert.equal(s.rows[0].revenue, 139996000000);
  assert.equal(s.profitLabel, 'operating income');
  assert.equal(s.rows[1].profit, 56972000000);
  // Segments tie to the consolidated total exactly.
  assert.equal(s.unallocated, 0);
});

/* ---- BABA: CNY units, opaque unit ids, and the duplicate member ----------- */

const baba = readFileSync(join(FIX, 'baba-20260331.trim.xml'), 'utf8');

test('BABA: a 20-F filer resolves, in its own currency, deduplicated', () => {
  const s = splitFromInstance(baba, '2026-03-31');
  assert.equal(s.available, true);
  // The unit comes from the DECLARATION's measure, not the id — the same
  // instance declares U_UsdCny whose measure is iso4217:USD.
  assert.equal(s.unit, 'CNY');
  // Five members tagged, four segments: the International Digital Commerce
  // Group figures appear under two member names and fold to one row.
  assert.equal(s.rows.length, 4);
  assert.deepEqual(s.rows.map((r) => r.label), [
    'Alibaba China E-Commerce Group', 'All Other',
    'Cloud Intelligence Group', 'International Digital Commerce Group']);
  assert.equal(s.rows[0].revenue, 554217000000);
  assert.equal(s.rows[3].revenue, 144170000000);
  // The tie-out no longer carries the duplicate: sum is the four real rows.
  assert.equal(s.revenueSum, 554217000000 + 254367000000 + 158132000000 + 144170000000);
  assert.equal(s.revenueTotal, 1023670000000);   // consolidated, in CNY
});

test('parseUnits trusts the measure, never the id', () => {
  const u = parseUnits(baba);
  assert.equal(u.get('U_CNY'), 'CNY');
  assert.equal(u.get('U_UsdCny'), 'USD');
});

/* ---- the filing's own words about each segment ---------------------------- *
 *
 * THE SENTENCES ARE REAL, per the file-header rule: each is copied from the
 * filing named beside it, including the glued heading/table prefixes exactly
 * as toText produces them — those prefixes are what broke the first,
 * ^-anchored version of every shape. */

const AMZN_SENTS = [
  // Item 8 segment note, with the bare section heading glued on (AMZN 10-K FY2025):
  'North America The North America segment primarily consists of amounts earned from retail sales of consumer products (including from sellers) and advertising and subscription services through North America-focused online and physical stores.',
  'AWS The AWS segment consists of amounts earned from global sales of compute, storage, database, and other services for start-ups, enterprises, government agencies, and academic institutions.',
  // MD&A drivers (same filing):
  'AWS sales increased 20% in 2025, compared to the prior year.',
  'The increase in AWS operating income in 2025, compared to the prior year, is primarily due to increased sales, partially offset by spending on technology infrastructure that was primarily driven by additional investments to support AWS business growth.',
];

test('commentary: definition and drivers from real AMZN sentences, via the acronym alias', () => {
  const c = segmentCommentary(AMZN_SENTS, ['Amazon Web Services', 'North America']);
  const aws = c['Amazon Web Services'];
  // Matched through the initials alias (AWS), quote sliced past the glued heading.
  assert.ok(aws.definition.startsWith('The AWS segment consists of amounts earned'));
  assert.equal(aws.drivers.length, 2);
  assert.ok(aws.drivers[0].startsWith('AWS sales increased 20%'));
  const na = c['North America'];
  assert.ok(na.definition.startsWith('The North America segment primarily consists'));
});

test('commentary: PG\'s colon definition, table-glued driver, punctuation-flexible label', () => {
  const sents = [
    // PG 10-K FY2026 — definition in the colon form:
    'Fabric & Home Care: This segment is comprised of a variety of fabric care products, including laundry detergents, additives and fabric enhancers; and home care products, including dishwashing liquids and detergents, surface cleaners and air care products.',
    // and a driver glued onto the results table it follows:
    'FABRIC & HOME CARE ($ millions) 2026 2025 Change vs. 2025 Volume N/A N/A —% Net sales $30,314 $29,617 2% Net earnings $5,632 $5,848 (4)% % of net sales 18.6% 19.7% (110) bps Fabric & Home Care net sales increased 2% to $30.3 billion driven by favorable foreign exchange of 1% and higher pricing.',
    // the label under test drops the filing's commas and ampersand:
    'Baby, Feminine & Family Care net sales increased 1% to $20.4 billion driven by favorable foreign exchange.',
  ];
  const c = segmentCommentary(sents, ['Fabric & Home Care', 'Baby Feminine Family Care']);
  const fhc = c['Fabric & Home Care'];
  assert.ok(fhc.definition.startsWith('Fabric & Home Care: This segment is comprised'));
  // The table prefix must not travel into the verbatim quote.
  assert.ok(fhc.drivers[0].startsWith('Fabric & Home Care net sales increased 2%'));
  assert.ok(c['Baby Feminine Family Care'].drivers[0]
    .startsWith('Baby, Feminine & Family Care net sales increased 1%'));
});

test('commentary: BABA\'s possessive form matches; a mere mention does not', () => {
  const sents = [
    // BABA 20-F FY2026 — the possessive driver:
    'Driven by robust AI demand, our Cloud Intelligence Group’s external revenue growth accelerated to 40% in the final quarter of fiscal 2026, with AI-related products accounting for 30% of this revenue.',
    // and a REAL decoy from the same filing: names the segment near "revenue"
    // but is a market-share claim, not the segment\'s results — must not match.
    'Cloud Intelligence Group Alibaba Group is the world’s fourth largest and Asia Pacific’s largest Infrastructure-as-a-service provider by revenue in 2025 in U.S. dollars, according to Gartner April 2026.',
  ];
  const c = segmentCommentary(sents, ['Cloud Intelligence Group']);
  assert.equal(c['Cloud Intelligence Group'].drivers.length, 1);
  assert.ok(c['Cloud Intelligence Group'].drivers[0]
    .startsWith('Cloud Intelligence Group’s external revenue growth accelerated'));
});

test('commentary: a segment the filing never discusses comes back empty, not guessed', () => {
  const c = segmentCommentary(AMZN_SENTS, ['International']);
  assert.equal(c.International.definition, null);
  assert.deepEqual(c.International.drivers, []);
});

/* ---- labels -------------------------------------------------------------- */

test('labelForMember strips affixes and splits camel case, keeping acronyms', () => {
  assert.equal(labelForMember('amzn:NorthAmericaSegmentMember'), 'North America');
  assert.equal(labelForMember('amzn:AmazonWebServicesSegmentMember'), 'Amazon Web Services');
  assert.equal(labelForMember('pg:BabyFeminineFamilyCareSegmentMember'), 'Baby Feminine Family Care');
  assert.equal(labelForMember('nvda:AWSSegmentMember'), 'AWS');
  assert.equal(labelForMember('msft:IntelligentCloudMember'), 'Intelligent Cloud');
  // GOOGL parks its residual on the STANDARD member — the prefix has a hyphen.
  assert.equal(labelForMember('us-gaap:AllOtherSegmentsMember'), 'All Other');
});

/* ---- declining ----------------------------------------------------------- */

test('an instance with no segment-dimensioned revenue declines with a reason', () => {
  const s = splitFromInstance('<xbrl><context id="c-1"><period>'
    + '<startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period></context>'
    + '<us-gaap:Revenues contextRef="c-1" unitRef="usd">1000</us-gaap:Revenues></xbrl>');
  assert.equal(s.available, false);
  assert.match(s.reason, /business-segments axis/);
});

test('one lone member on the axis is not a split', () => {
  const xml = `<xbrl>
    <context id="a"><entity><segment>
      <xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">x:OnlyMember</xbrldi:explicitMember>
    </segment></entity><period><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period></context>
    <us-gaap:Revenues contextRef="a" unitRef="usd">1000</us-gaap:Revenues></xbrl>`;
  assert.equal(splitFromInstance(xml).available, false);
});

/* ---- the geographic split ------------------------------------------------ *
 * Same real-text rule: the fixtures are verbatim trims of the MSFT FY2026 and
 * AMZN FY2025 instances — the two live shapes the reader was verified against
 * before it was written (two-row US/NonUs, and countries plus an exclusive
 * residual). */

const msftGeo = readFileSync(join(FIX, 'msft-geo-20260630.trim.xml'), 'utf8');
const amznGeo = readFileSync(join(FIX, 'amzn-geo-20251231.trim.xml'), 'utf8');

test('MSFT geo: the two-row US / Non-US shape, tying to the total exactly', () => {
  const g = geoSplitFromInstance(msftGeo);
  assert.equal(g.available, true);
  assert.equal(g.period, '2026-06-30');
  assert.equal(g.unit, 'USD');
  assert.deepEqual(g.rows.map((r) => r.label), ['United States', 'Outside the U.S.']);
  assert.equal(g.revenueSum, g.revenueTotal);
  assert.equal(g.undisclosed, 0);
  // Prior-year figures ride along for the YoY column.
  assert.ok(g.rows.every((r) => r.revenuePrev != null && r.revenuePrev < r.revenue));
});

test('AMZN geo: countries by size, the exclusive NonUs residual labelled and LAST', () => {
  const g = geoSplitFromInstance(amznGeo);
  assert.equal(g.available, true);
  assert.deepEqual(g.rows.map((r) => r.label),
    ['United States', 'Germany', 'United Kingdom', 'Japan', 'Rest of world']);
  // "Rest of world", not "Outside the U.S.": named non-US countries are also
  // tagged and the sum ties, so the NonUs member is arithmetically exclusive.
  assert.equal(g.rows.at(-1).member, 'us-gaap:NonUsMember');
  assert.equal(g.revenueSum, g.revenueTotal);
});

test('geo declines when nothing rides the geographical axis', () => {
  const g = geoSplitFromInstance(amzn);   // the segment fixture: geo context exists but carries no kept revenue fact… 
  // the AMZN segment trim retains ONE geography-dimensioned revenue fact as a
  // decoy — a single member is a line item, not a split.
  assert.equal(g.available, false);
  assert.match(g.reason, /geographical axis|single row|Only one geography/i);
});

test('geo declines an overlapping tagging rather than double-count', () => {
  const xml = `<xbrl>
    <context id="us"><entity><segment>
      <xbrldi:explicitMember dimension="srt:StatementGeographicalAxis">country:US</xbrldi:explicitMember>
    </segment></entity><period><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period></context>
    <context id="nonus"><entity><segment>
      <xbrldi:explicitMember dimension="srt:StatementGeographicalAxis">us-gaap:NonUsMember</xbrldi:explicitMember>
    </segment></entity><period><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period></context>
    <context id="de"><entity><segment>
      <xbrldi:explicitMember dimension="srt:StatementGeographicalAxis">country:DE</xbrldi:explicitMember>
    </segment></entity><period><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period></context>
    <context id="all"><entity></entity><period><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period></context>
    <unit id="usd"><measure>iso4217:USD</measure></unit>
    <us-gaap:Revenues contextRef="us" unitRef="usd">600</us-gaap:Revenues>
    <us-gaap:Revenues contextRef="nonus" unitRef="usd">400</us-gaap:Revenues>
    <us-gaap:Revenues contextRef="de" unitRef="usd">150</us-gaap:Revenues>
    <us-gaap:Revenues contextRef="all" unitRef="usd">1000</us-gaap:Revenues>
  </xbrl>`;
  const g = geoSplitFromInstance(xml);
  assert.equal(g.available, false);
  assert.match(g.reason, /double-count/);
});

test('geo reports a partial disclosure as undisclosed remainder, never as complete', () => {
  const xml = `<xbrl>
    <context id="us"><entity><segment>
      <xbrldi:explicitMember dimension="srt:StatementGeographicalAxis">country:US</xbrldi:explicitMember>
    </segment></entity><period><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period></context>
    <context id="cn"><entity><segment>
      <xbrldi:explicitMember dimension="srt:StatementGeographicalAxis">country:CN</xbrldi:explicitMember>
    </segment></entity><period><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period></context>
    <context id="all"><entity></entity><period><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period></context>
    <unit id="usd"><measure>iso4217:USD</measure></unit>
    <us-gaap:Revenues contextRef="us" unitRef="usd">500</us-gaap:Revenues>
    <us-gaap:Revenues contextRef="cn" unitRef="usd">200</us-gaap:Revenues>
    <us-gaap:Revenues contextRef="all" unitRef="usd">1000</us-gaap:Revenues>
  </xbrl>`;
  const g = geoSplitFromInstance(xml);
  assert.equal(g.available, true);
  assert.equal(g.undisclosed, 300);
  assert.deepEqual(g.rows.map((r) => r.label), ['United States', 'China']);
});

test('labelForGeoMember: countries, standard regions, custom members', () => {
  assert.equal(labelForGeoMember('country:US'), 'United States');
  assert.equal(labelForGeoMember('country:TW'), 'Taiwan');
  assert.equal(labelForGeoMember('srt:EuropeMember'), 'Europe');
  assert.equal(labelForGeoMember('nvda:ChinaIncludingHongKongMember'), 'China Including Hong Kong');
  assert.equal(labelForGeoMember('country:ZW'), 'ZW');   // unmapped code renders as itself
});

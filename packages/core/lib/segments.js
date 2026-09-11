/* Segment revenue, read from the filing's own XBRL INSTANCE — the one SEC
 * artifact where the segment split survives.
 *
 * WHY THIS FILE EXISTS AT ALL. Segment figures are tagged on dimensional axes
 * (us-gaap:StatementBusinessSegmentsAxis), and SEC's flattened companyfacts
 * API drops every dimension — which is why this platform refused to show a
 * segment split for years (see CLAUDE.md and the header business.js used to
 * carry). But the flattening is companyfacts' doing, not the filing's: every
 * iXBRL 10-K comes with an EXTRACTED INSTANCE DOCUMENT in the same archive
 * folder ({primary-doc}_htm.xml) where the contexts keep their axes. Reading
 * that document is what this file does. Verified against the real thing
 * before it was written: AMZN's FY2025 instance yields North America /
 * International / AWS revenue that ties to consolidated revenue exactly, and
 * PG's FY2026 instance yields the five segments riding an extra
 * srt:ConsolidationItemsAxis=OperatingSegmentsMember dimension, plus a
 * CorporateNonSegment reconciler — both shapes are handled below and both are
 * in the test fixtures.
 *
 * WHY EVERY STEP DECLINES. Same posture as business.js and parseShare(): a
 * missing split renders with its reason, an invented one reads exactly as
 * confidently as a real one. So: a context with any dimension this file does
 * not understand is skipped, not folded in (a Products-axis or geography
 * context folded into a segment sum double-counts revenue); a filing whose
 * instance cannot be found, or that tags fewer than two segment members, or
 * whose segment sum lands nowhere near consolidated revenue, reports why
 * instead of a table.
 *
 * WHAT A "SEGMENT" FACT IS, PRECISELY. A duration fact whose context carries
 * the business-segments axis and NOTHING ELSE — with one exception seen in
 * real filings: srt:ConsolidationItemsAxis = us-gaap:OperatingSegmentsMember,
 * which is how a filer says "this row is the segment note's operating-segment
 * column" and changes nothing about the figure. Any other extra axis
 * (Subsegments, geography, product, IntersegmentElimination) means the fact is
 * a slice of a segment, not the segment, and is excluded.
 */
import { getText, getJSON, companySubmissions, cik10 } from './edgar.js';
import { latestAnnual, filingUrl, toText, sentences } from './business.js';
import { CONCEPTS } from './xbrl.js';

/* Revenue tags in precedence order — the same family, and the same order,
   xbrl.js uses for consolidated revenue, so the segment split cannot be read
   off a different notion of revenue than the headline figure. */
const REVENUE_TAGS = CONCEPTS.revenue.tags;

/* The profit measure the segment note discloses varies by filer and the label
   must say which one it is: AMZN tags operating income by segment, PG tags
   net earnings (ProfitLoss). Tried in this order; the first tag with at least
   two segment members wins and its honest name travels with the figures. */
const PROFIT_TAGS = [
  ['OperatingIncomeLoss', 'operating income'],
  ['ProfitLoss', 'net earnings'],
  ['NetIncomeLoss', 'net earnings'],
  ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'pre-tax income'],
];

const SEG_AXIS = 'us-gaap:StatementBusinessSegmentsAxis';
const CONSOL_AXIS = 'srt:ConsolidationItemsAxis';
const OPERATING_MEMBER = 'us-gaap:OperatingSegmentsMember';

/* The geographic axis, which survives in the instance exactly as the segment
   axis does. srt: is the modern home; the us-gaap: form appears in older
   filings and both are accepted, first found wins. Verified against the real
   thing before this was written: MSFT FY2026 tags US + NonUs on srt:, AMZN
   FY2025 tags US / DE / GB / JP + NonUs ("Rest of world" in the note's own
   caption) — both trimmed into the test fixtures. */
const GEO_AXES = ['srt:StatementGeographicalAxis', 'us-gaap:StatementGeographicalAxis'];

/* An annual period. 330–380 days covers 52/53-week filers and transition
   stubs stay out. */
const isAnnual = (days) => days >= 330 && days <= 380;

/* ---- instance parsing (pure) -------------------------------------------- */

/**
 * Contexts out of an instance document: id -> { dims, start, end, days }.
 * Instant contexts come back with start/end null and are never annual.
 * Extracted instances write `<context>` unprefixed; the prefixed form is
 * accepted because the standalone (pre-iXBRL) instances used it.
 */
export function parseContexts(xml) {
  const out = new Map();
  const src = String(xml || '');
  /* Attribute order and line breaks are the FILING AGENT'S choice, not the
     spec's: Workiva-produced instances (AMZN, PG) write `<context id=...` on
     one line, Donnelley's (MSFT) put every attribute on its own line and
     `id` is not necessarily first. `[^>]*` spans newlines — a negated class
     matches \n — so one pattern covers both, but nothing here may assume an
     attribute's position. MSFT's whole split was invisible until this did. */
  for (const m of src.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const body = m[2];
    const dims = {};
    for (const d of body.matchAll(/<(?:[a-z0-9]+:)?explicitMember\b[^>]*\bdimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*<\//g)) {
      dims[d[1]] = d[2];
    }
    const start = /<(?:xbrli:)?startDate>\s*(\d{4}-\d{2}-\d{2})/.exec(body)?.[1] || null;
    const end = /<(?:xbrli:)?endDate>\s*(\d{4}-\d{2}-\d{2})/.exec(body)?.[1] || null;
    const days = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 86400e3) : null;
    out.set(m[1], { dims, start, end, days });
  }
  return out;
}

/**
 * Unit declarations: unit id -> ISO-ish measure ('USD', 'CNY', …). The ids
 * are the FILING AGENT'S naming and mean nothing by themselves — BABA's
 * instance declares `U_UsdCny` whose measure is iso4217:USD — so only the
 * <measure> inside the declaration is trusted. Filers reporting in RMB, TWD
 * or EUR tag their segment note in that currency; reading the value without
 * the unit rendered BABA's RMB554B as $554B, wrong by a factor of seven.
 */
export function parseUnits(xml) {
  const out = new Map();
  for (const m of String(xml || '').matchAll(/<(?:xbrli:)?unit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?unit>/g)) {
    const measure = /<(?:xbrli:)?measure>\s*([^<\s]+)/.exec(m[2])?.[1] || '';
    out.set(m[1], measure.replace(/^iso4217:/i, '').toUpperCase());
  }
  return out;
}

/**
 * Every numeric fact for one us-gaap tag: contextRef -> Map(unit -> value).
 * Keyed by unit as well as context because a filer can state the same fact
 * in its reporting currency AND a convenience translation. First occurrence
 * per (context, unit) wins — a repeat is the same figure stated twice.
 */
export function factsFor(xml, tag, units = null) {
  const out = new Map();
  const src = String(xml || '');
  // Order-agnostic on attributes, tolerant of whitespace around the value —
  // see the formatting note in parseContexts.
  for (const m of src.matchAll(new RegExp(`<us-gaap:${tag}\\b[^>]*\\bcontextRef="([^"]+)"[^>]*>([^<]+)</us-gaap:${tag}>`, 'g'))) {
    const v = Number(m[2].trim());
    if (!Number.isFinite(v)) continue;
    const uref = /\bunitRef="([^"]+)"/.exec(m[0])?.[1] || '';
    // Unknown id (a trimmed fixture, an agent that skips declarations): the
    // id itself, uppercased, is the least-wrong reading — 'usd' means USD.
    const unit = units?.get(uref) || uref.toUpperCase() || 'USD';
    if (!out.has(m[1])) out.set(m[1], new Map());
    const byUnit = out.get(m[1]);
    if (!byUnit.has(unit)) byUnit.set(unit, v);
  }
  return out;
}

/* Is this context a clean per-member row on the given axis? (See the header
   for what "clean" excludes and why — the rule is the same for geography:
   a context carrying the geo axis PLUS a segment or product axis is a slice
   of a region, not the region.) */
function memberOn(ctx, axis) {
  const member = ctx.dims[axis];
  if (!member) return null;
  for (const [a, m] of Object.entries(ctx.dims)) {
    if (a === axis) continue;
    if (a === CONSOL_AXIS && m === OPERATING_MEMBER) continue;
    return null;
  }
  return member;
}

/* Per-member annual values of one tag, grouped by period end and unit:
   end -> Map(member -> Map(unit -> value)). Axis defaults to the business
   segments the file was written for. */
function segmentRows(xml, tag, contexts, units, axis = SEG_AXIS) {
  const byEnd = new Map();
  for (const [ref, byUnit] of factsFor(xml, tag, units)) {
    const ctx = contexts.get(ref);
    if (!ctx || !isAnnual(ctx.days ?? -1)) continue;
    const member = memberOn(ctx, axis);
    if (!member) continue;
    if (!byEnd.has(ctx.end)) byEnd.set(ctx.end, new Map());
    const period = byEnd.get(ctx.end);
    if (!period.has(member)) period.set(member, new Map());
    const cell = period.get(member);
    for (const [unit, val] of byUnit) if (!cell.has(unit)) cell.set(unit, val);
  }
  return byEnd;
}

/* The unit the split is stated in: the one most members carry for the chosen
   period, USD breaking a tie. Everything downstream filters to it, so a
   convenience translation can never mix into the reporting-currency rows. */
function dominantUnit(period) {
  const tally = new Map();
  for (const cell of period.values()) for (const unit of cell.keys()) {
    tally.set(unit, (tally.get(unit) || 0) + 1);
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] === 'USD' ? -1 : 1) - (b[0] === 'USD' ? -1 : 1))[0]?.[0]
    || null;
}

/* The undimensioned (consolidated) annual value of one tag for a period end,
   in the split's own unit — a USD convenience total against CNY segments
   would make every share and the tie-out nonsense. */
function totalFor(xml, tags, contexts, end, unit, units) {
  for (const tag of tags) {
    for (const [ref, byUnit] of factsFor(xml, tag, units)) {
      const ctx = contexts.get(ref);
      if (ctx && ctx.end === end && isAnnual(ctx.days ?? -1)
          && Object.keys(ctx.dims).length === 0 && byUnit.has(unit)) return byUnit.get(unit);
    }
  }
  return null;
}

/* ---- member labels ------------------------------------------------------ */

/* "amzn:NorthAmericaSegmentMember" -> "North America". Purely mechanical:
   strip the prefix and the Member/Segment suffixes, then break the camel case
   without splitting an acronym run ("AWSSegmentMember" -> "AWS"). */
export function labelForMember(member) {
  return String(member || '')
    // The prefix class needs the hyphen: GOOGL parks its residual on the
    // STANDARD member us-gaap:AllOtherSegmentsMember, and without it the
    // label came out "us-gaap:All Other".
    .replace(/^[a-z0-9-]+:/i, '')
    .replace(/(?:Reportable|Operating|Business)?Segments?Member$/, '')
    .replace(/Member$/, '')
    .replace(/Segments?$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

/* Geographic member labels. Country members arrive as `country:XX` (ISO
   3166-1 alpha-2 — the `country:` taxonomy is exactly that list), standard
   regions as srt:/us-gaap: members, and a filer's own residual as a custom
   member that falls through to the mechanical labeller. The map covers the
   codes real filers disclose revenue under; an unmapped code renders as the
   code itself, which is honest and rare. */
const COUNTRY_NAMES = {
  US: 'United States', CN: 'China', JP: 'Japan', DE: 'Germany', GB: 'United Kingdom',
  FR: 'France', IT: 'Italy', ES: 'Spain', NL: 'Netherlands', IE: 'Ireland',
  CH: 'Switzerland', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland',
  BE: 'Belgium', AT: 'Austria', PL: 'Poland', RU: 'Russia', TR: 'Türkiye',
  CA: 'Canada', MX: 'Mexico', BR: 'Brazil', AR: 'Argentina', CL: 'Chile',
  IN: 'India', KR: 'South Korea', TW: 'Taiwan', HK: 'Hong Kong', SG: 'Singapore',
  MY: 'Malaysia', TH: 'Thailand', ID: 'Indonesia', PH: 'Philippines', VN: 'Vietnam',
  AU: 'Australia', NZ: 'New Zealand', IL: 'Israel', AE: 'United Arab Emirates',
  SA: 'Saudi Arabia', ZA: 'South Africa', EG: 'Egypt', NG: 'Nigeria',
  CZ: 'Czechia', HU: 'Hungary', PT: 'Portugal', GR: 'Greece', RO: 'Romania',
  LU: 'Luxembourg', KY: 'Cayman Islands', BM: 'Bermuda', PR: 'Puerto Rico',
  CR: 'Costa Rica', CO: 'Colombia', PE: 'Peru', UA: 'Ukraine', PK: 'Pakistan',
  BD: 'Bangladesh', MO: 'Macau', KZ: 'Kazakhstan',
};
const GEO_MEMBER_NAMES = {
  'us-gaap:NonUsMember': 'Outside the U.S.',
  'srt:NorthAmericaMember': 'North America',
  'srt:SouthAmericaMember': 'South America',
  'srt:LatinAmericaMember': 'Latin America',
  'srt:EuropeMember': 'Europe',
  'srt:AsiaMember': 'Asia',
  'srt:AsiaPacificMember': 'Asia Pacific',
  'srt:AfricaMember': 'Africa',
  'us-gaap:EMEAMember': 'EMEA',
  'srt:AmericasMember': 'Americas',
};

export function labelForGeoMember(member) {
  const m = String(member || '');
  const cc = /^country:([A-Z]{2})$/.exec(m);
  if (cc) return COUNTRY_NAMES[cc[1]] || cc[1];
  if (GEO_MEMBER_NAMES[m]) return GEO_MEMBER_NAMES[m];
  return labelForMember(m);
}

const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Swap mechanical labels for the filing's own segment names where they
 * unambiguously match — "Baby Feminine Family Care" becomes the Item 1
 * sentence's "Baby, Feminine & Family Care". Exact match after folding case
 * and punctuation, nothing looser: a fuzzy match here would caption one
 * segment's revenue with another segment's name, which is worse than a
 * mechanical label. Mutates and returns the segmentation payload.
 */
export function reconcileNames(segmentation, names) {
  if (!segmentation?.rows || !Array.isArray(names) || !names.length) return segmentation;
  const byFold = new Map();
  for (const n of names) {
    const k = fold(n);
    // Two narrative names folding identically would make the match ambiguous.
    if (k) byFold.set(k, byFold.has(k) ? null : n);
  }
  for (const row of segmentation.rows) {
    const hit = byFold.get(fold(row.label));
    if (hit) row.label = hit;
  }
  return segmentation;
}

/* ---- extraction over one instance (pure) -------------------------------- */

/**
 * The segment split out of one instance document.
 *
 * @param {string} xml  the extracted XBRL instance
 * @param {string} [period]  the filing's stated period end; latest tagged
 *   period is used when absent or not found in the instance
 * @returns {object} { available, rows, ... } or { available: false, reason }
 */
export function splitFromInstance(xml, period = null) {
  const contexts = parseContexts(xml);
  const units = parseUnits(xml);

  let revenueTag = null;
  let byEnd = null;
  for (const tag of REVENUE_TAGS) {
    const b = segmentRows(xml, tag, contexts, units);
    // At least one period with two members: one member on the axis is not a
    // split, and a tag the filer used for a lone line item must not shadow
    // the tag the segment note is actually filed under.
    if ([...b.values()].some((m) => m.size >= 2)) { revenueTag = tag; byEnd = b; break; }
  }
  if (!revenueTag) {
    return {
      available: false,
      reason: 'The filing\'s XBRL instance tags no revenue on the business-segments '
        + 'axis — either the registrant reports one segment, or its segment note '
        + 'is tagged in a shape this reader does not recognise.',
    };
  }

  const ends = [...byEnd.keys()].filter((e) => byEnd.get(e).size >= 2).sort();
  const end = period && ends.includes(period) ? period : ends[ends.length - 1];
  const prevEnd = ends.filter((e) => e < end).pop() || null;
  const cur = byEnd.get(end);
  const prev = prevEnd ? byEnd.get(prevEnd) : null;

  /* The unit the note is stated in — CNY for BABA, TWD for a TSM, USD for a
     domestic filer — carried on the payload so the caller renders the right
     currency instead of implying dollars. */
  const unit = dominantUnit(cur);
  const inUnit = (cell) => (cell?.has(unit) ? cell.get(unit) : null);

  let profitTag = null;
  let profitLabel = null;
  let profitByEnd = null;
  for (const [tag, label] of PROFIT_TAGS) {
    const b = segmentRows(xml, tag, contexts, units);
    const p = b.get(end);
    if (p && [...p.values()].filter((cell) => cell.has(unit)).length >= 2) {
      profitTag = tag; profitLabel = label; profitByEnd = b; break;
    }
  }

  let rows = [...cur.entries()]
    .filter(([, cell]) => cell.has(unit))
    .map(([member, cell]) => ({
      member,
      label: labelForMember(member),
      revenue: cell.get(unit),
      revenuePrev: inUnit(prev?.get(member)),
      profit: inUnit(profitByEnd?.get(end)?.get(member)),
      profitPrev: prevEnd ? inUnit(profitByEnd?.get(prevEnd)?.get(member)) : null,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  /* One segment tagged under TWO member names — BABA's FY2026 20-F carries
     the identical figures under both InternationalDigitalCommerceGroupMember
     and AlibabaInternationalDigitalCommerceGroupMember (a rename mid-year) —
     double-counts the segment in every share and in the tie-out. Folded only
     under the strictest reading of "same segment": identical current AND
     prior revenue, and one folded label containing the other. The shorter
     label survives; two genuinely different segments cannot trip this. */
  const dup = (r, o) => o !== r
    && o.revenue === r.revenue && o.revenuePrev === r.revenuePrev
    && (fold(o.label).includes(fold(r.label)) || fold(r.label).includes(fold(o.label)));
  rows = rows.filter((r) => !rows.some((o) => dup(r, o)
    && (fold(o.label).length < fold(r.label).length
        || (fold(o.label).length === fold(r.label).length && o.member < r.member))));

  if (rows.length < 2) {
    return {
      available: false,
      reason: 'The filing\'s XBRL instance tags no revenue on the business-segments '
        + 'axis — either the registrant reports one segment, or its segment note '
        + 'is tagged in a shape this reader does not recognise.',
    };
  }

  const revenueSum = rows.reduce((a, r) => a + r.revenue, 0);
  const revenueTotal = totalFor(xml, REVENUE_TAGS, contexts, end, unit, units);

  /* The tie-out. Segments within a few percent of the consolidated total is
     the normal case (the gap is corporate/other or intersegment eliminations
     and is REPORTED, not hidden). A sum wildly off the total means the axis
     was used for something other than the segment note — decline. */
  if (revenueTotal && (revenueSum < revenueTotal * 0.5 || revenueSum > revenueTotal * 1.5)) {
    return {
      available: false,
      reason: `Revenue tagged on the business-segments axis sums to a figure `
        + 'unrecognisable against consolidated revenue, so it is not the '
        + 'segment note\'s split and is not shown.',
    };
  }

  return {
    available: true,
    period: end,
    prevPeriod: prevEnd,
    unit,
    revenueTag,
    profitTag,
    profitLabel,
    rows,
    revenueSum,
    revenueTotal,
    unallocated: revenueTotal != null ? revenueTotal - revenueSum : null,
  };
}

/* ---- the geographic split (pure) ---------------------------------------- */

/**
 * Revenue by geography out of one instance document — the segment reader's
 * sibling, on the geographic axis. Differences from the segment split, each
 * deliberate:
 *
 *   NO PROFIT COLUMN. ASC 280 requires revenue and long-lived assets by
 *   geography, not profit; a profit-by-country table would be tagged by
 *   almost nobody and reading assets as "profit" would be the bug.
 *
 *   A TIGHTER OVERCOUNT RULE. The segment note may legitimately sum below
 *   its total (corporate/other reconciles it) but a geography note that sums
 *   ABOVE consolidated revenue means overlapping members — a filer tagging
 *   "Non-US" AND the countries inside it — and folding that in would count
 *   Germany twice. Above 105% of the total the split is declined; below the
 *   total it renders, and the remainder is reported as undisclosed, because
 *   partial country disclosure ("US and China, rest not broken out") is a
 *   normal and honest shape.
 *
 *   ONE MEMBER IS STILL DECLINED. "US only" tagging with no second row is a
 *   line item, not a split.
 */
export function geoSplitFromInstance(xml, period = null) {
  const contexts = parseContexts(xml);
  const units = parseUnits(xml);

  let axis = null;
  let revenueTag = null;
  let byEnd = null;
  for (const a of GEO_AXES) {
    for (const tag of REVENUE_TAGS) {
      const b = segmentRows(xml, tag, contexts, units, a);
      if ([...b.values()].some((m) => m.size >= 2)) { axis = a; revenueTag = tag; byEnd = b; break; }
    }
    if (axis) break;
  }
  if (!axis) {
    return {
      available: false,
      reason: 'The filing\'s XBRL instance tags no revenue on the geographical '
        + 'axis — the registrant either discloses no country split or tags it in '
        + 'a shape this reader does not recognise.',
    };
  }

  const ends = [...byEnd.keys()].filter((e) => byEnd.get(e).size >= 2).sort();
  const end = period && ends.includes(period) ? period : ends[ends.length - 1];
  const prevEnd = ends.filter((e) => e < end).pop() || null;
  const cur = byEnd.get(end);
  const prev = prevEnd ? byEnd.get(prevEnd) : null;
  const unit = dominantUnit(cur);
  const inUnit = (cell) => (cell?.has(unit) ? cell.get(unit) : null);

  /* Named geographies by size, residuals last: AAPL's "Other Countries" is
     its largest row by revenue, and leading the table with the bucket that
     names nothing buries the geography the table exists to show. */
  const residual = (r) => (r.member === 'us-gaap:NonUsMember'
    || /^(?:other|rest of|outside)/i.test(r.label) ? 1 : 0);
  const rows = [...cur.entries()]
    .filter(([, cell]) => cell.has(unit))
    .map(([member, cell]) => ({
      member,
      label: labelForGeoMember(member),
      revenue: cell.get(unit),
      revenuePrev: inUnit(prev?.get(member)),
    }))
    .sort((a, b) => residual(a) - residual(b) || b.revenue - a.revenue);
  if (rows.length < 2) {
    return {
      available: false,
      reason: 'Only one geography carries tagged revenue in this filing\'s '
        + 'instance — a single row is a line item, not a split.',
    };
  }

  const revenueSum = rows.reduce((a, r) => a + r.revenue, 0);
  const revenueTotal = totalFor(xml, REVENUE_TAGS, contexts, end, unit, units);
  if (revenueTotal && revenueSum > revenueTotal * 1.05) {
    return {
      available: false,
      reason: 'Revenue tagged on the geographical axis sums ABOVE consolidated '
        + 'revenue, which means the tagged regions overlap (a "Non-US" row plus '
        + 'the countries inside it). Folding that in would double-count, so the '
        + 'split is declined.',
    };
  }

  /* A NonUs row next to named non-US countries that still sums to the total
     is arithmetically EXCLUSIVE of those countries — AMZN's note captions it
     "Rest of world", and "Outside the U.S." would read as containing Germany
     when it does not. The relabel happens only when the arithmetic proves the
     exclusivity; a lone US/Non-US pair keeps the plain label. */
  const namedForeign = rows.some((r) => /^country:(?!US$)/.test(r.member));
  for (const r of rows) {
    if (r.member === 'us-gaap:NonUsMember' && namedForeign) r.label = 'Rest of world';
  }

  return {
    available: true,
    axis, period: end, prevPeriod: prevEnd, unit, revenueTag,
    rows, revenueSum, revenueTotal,
    undisclosed: revenueTotal != null ? Math.max(0, revenueTotal - revenueSum) : null,
  };
}

/* ---- the filing's own words about each segment --------------------------- *
 *
 * Two kinds of sentence exist for a segment in an annual report, and both are
 * quotable verbatim (same rule as business.js: no paraphrase, because a wrong
 * paraphrase reads exactly as confidently as a right one):
 *
 *   DEFINITION  "The North America segment primarily consists of amounts
 *               earned from retail sales …" — what the segment IS.
 *   DRIVERS     "The increase in AWS operating income in 2025 … is primarily
 *               due to increased sales, partially offset by spending on
 *               technology infrastructure …" — why its numbers moved, from
 *               the MD&A.
 *
 * Both are found by ANCHORED sentence shapes, the lesson ANCHOR in
 * business.js encodes: a sentence merely containing the segment's name is
 * about anything at all, but one that STARTS "The <segment> segment…" or
 * "The increase in <segment> sales…" is the filing talking about that
 * segment and nothing else. Shapes that miss return null and the caller
 * renders nothing — never a sentence from elsewhere in the document.
 *
 * The one looseness: an ACRONYM alias. Amazon tags the member
 * AmazonWebServicesSegmentMember but writes its MD&A about "AWS", so each
 * label is also tried as its initials. That mapping is mechanical
 * (first letters), never fuzzy.
 */
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const initialsOf = (label) => String(label).split(/\s+/)
  .filter((w) => /^[A-Za-z]/.test(w) && !/^(?:and|of|the)$/i.test(w))
  .map((w) => w[0].toUpperCase()).join('');

/* A label as a flexible pattern: the tagged member loses the filing's
   punctuation (BabyFeminineFamilyCareSegmentMember vs the prose's "Baby,
   Feminine & Family Care"), so between words any run of spaces, commas,
   ampersands, hyphens or "and" is accepted. The WORDS themselves stay
   exact. */
const flexPattern = (label) => String(label).split(/[\s,&/-]+/).filter(Boolean)
  .map(escRe).join('(?:[\\s,&/-]|and\\b)+');

function shapesFor(alias) {
  const A = flexPattern(alias);
  return {
    /* Not ^-anchored like the drivers: the definition sits right under a bare
       section heading, and toText's heading line glues onto it ("North
       America The North America segment consists…"), so position cannot
       anchor it. The DEFINITIONAL VERB anchors it instead — "The X segment
       consists/includes/comprises…" is only ever the filing defining X. */
    /* None of these anchor at ^ — a bare heading or a results table glues
       onto the sentence in toText's flattening, so position proves nothing.
       What anchors each shape is ADJACENCY: the segment's name immediately
       against the definitional or movement verb phrase is the filing talking
       about that segment and nothing else. Quotes are sliced at the match so
       the glued prefix never travels into a verbatim quote. */
    definition: [
      new RegExp(`\\b(?:The|Our)\\s+${A}\\s+segment\\s+(?:primarily\\s+)?`
        + '(?:consists|includes|comprises|is\\s+comprised|earns|derives|focuses|provides|sells|offers)\\b', 'i'),
      // PG's form: "Fabric & Home Care: This segment is comprised of …"
      new RegExp(`\\b${A}\\s*:\\s*This segment (?:is\\s+comprised|consists|includes|comprises|provides|offers)\\b`, 'i'),
    ],
    drivers: [
      new RegExp(`\\b${A}\\s+(?:segment\\s+)?(?:net\\s+)?(?:sales|revenues?)\\s+(?:increas|decreas|grew|declin|growth|were\\s+flat)`, 'i'),
      new RegExp(`\\bThe\\s+(?:increase|decrease)\\s+in\\s+${A}\\s+(?:segment\\s+)?(?:net\\s+)?(?:sales|revenues?|operating\\s+(?:income|loss))`, 'i'),
      new RegExp(`\\b${A}\\s+(?:segment\\s+)?(?:operating\\s+(?:income|loss)|net\\s+earnings)\\s+(?:increas|decreas|was|grew|declin)`, 'i'),
      // BABA's 20-F form: "our Cloud Intelligence Group's external revenue
      // growth accelerated to 40% …" — possessive, with a qualifier word.
      new RegExp(`\\b${A}(?:['’]s)?\\s+(?:external\\s+|total\\s+|overall\\s+)?revenue\\s+(?:growth\\s+)?`
        + '(?:accelerat|increas|decreas|grew|declin|slowed)', 'i'),
    ],
  };
}

const clip = (s, cap = 420) => (s.length <= cap ? s : `${s.slice(0, cap).replace(/\s+\S*$/, '')}…`);

/**
 * The filing's own sentences about each segment, verbatim.
 * @param {string[]} sents  the document as sentences (business.js sentences())
 * @param {string[]} labels
 * @returns {Object<string, {definition: string|null, drivers: string[]}>}
 */
export function segmentCommentary(sents, labels) {
  const out = {};
  for (const label of labels) {
    const aliases = [label];
    const ini = initialsOf(label);
    if (ini.length >= 2 && ini !== label) aliases.push(ini);
    let definition = null;
    const drivers = [];
    for (const alias of aliases) {
      const shape = shapesFor(alias);
      for (const s of sents) {
        if (!definition) {
          for (const re of shape.definition) {
            const d = re.exec(s);
            if (d) { definition = clip(s.slice(d.index)); break; }
          }
        }
        if (drivers.length < 2) {
          for (const re of shape.drivers) {
            const d = re.exec(s);
            if (d) {
              const q = clip(s.slice(d.index));
              if (!drivers.includes(q) && q !== definition) drivers.push(q);
              break;
            }
          }
        }
        if (definition && drivers.length >= 2) break;
      }
      if (definition || drivers.length) break;   // the label form the filing uses wins outright
    }
    out[label] = { definition, drivers };
  }
  return out;
}

/* The document's sentences, memoised per accession — toText over an 8-12MB
   iXBRL primary document costs about a second of CPU and cannot change. */
const sentMemo = new Map();
const MAX_SENT_MEMO = 16;

async function sentencesFor(cik, filing) {
  const hit = sentMemo.get(filing.accession);
  if (hit) return hit;
  const url = filingUrl(cik, filing);
  if (!url) return null;
  const html = await getText(url, { ttlMs: 365 * 24 * 3600e3, revalidate: false });
  if (!html) return null;
  const sents = sentences(toText(html));
  if (sentMemo.size >= MAX_SENT_MEMO) sentMemo.delete(sentMemo.keys().next().value);
  sentMemo.set(filing.accession, sents);
  return sents;
}

/**
 * Verbatim per-segment commentary from a company's latest annual filing.
 * Returns {} rather than failing — commentary is garnish on the split, and
 * its absence must never cost the caller the figures.
 */
export async function filingCommentaryFor(cik, labels, subs = null) {
  if (!labels?.length) return {};
  try {
    const submissions = subs || await companySubmissions(cik);
    const filing = latestAnnual(submissions);
    if (!filing?.hasNarrative) return {};
    const sents = await sentencesFor(cik10(cik), filing);
    return sents ? segmentCommentary(sents, labels) : {};
  } catch { return {}; }
}

/* ---- assembly ----------------------------------------------------------- */

/* Memoised by accession, like business.js's narrative — the instance is a
   couple of MB and an accession is immutable once filed. */
const memo = new Map();
const MAX_MEMO = 64;

/* The extracted instance sits beside the primary document as
   {basename}_htm.xml. Older, pre-iXBRL filings shipped a standalone instance
   instead; the archive's index.json names it when the guess misses. */
async function instanceUrlFor(cik, filing) {
  const primary = filingUrl(cik, filing);
  if (!primary) return null;
  const guess = primary.replace(/\.html?$/i, '_htm.xml');
  if (guess !== primary) {
    const body = await getText(guess, { ttlMs: 365 * 24 * 3600e3, revalidate: false });
    if (body) return { url: guess, body };
  }
  const dir = primary.slice(0, primary.lastIndexOf('/'));
  const idx = await getJSON(`${dir}/index.json`, { ttlMs: 365 * 24 * 3600e3 }).catch(() => null);
  const item = (idx?.directory?.item || []).find((f) => /_htm\.xml$/i.test(f.name || ''));
  if (!item) return null;
  const url = `${dir}/${item.name}`;
  const body = await getText(url, { ttlMs: 365 * 24 * 3600e3, revalidate: false });
  return body ? { url, body } : null;
}

/**
 * The latest annual filing's segment split for a company.
 *
 * @param {string|number} cik
 * @param {object} [subs]  a submissions payload, if the caller already has one
 * @returns {Promise<object>} always an object; `available: false` carries the
 *   reason, so the caller renders it rather than a blank.
 */
export async function segmentsFor(cik, subs = null) {
  const submissions = subs || await companySubmissions(cik).catch(() => null);
  const filing = latestAnnual(submissions);
  if (!filing) {
    return { available: false, reason: 'No 10-K or 20-F on file for this registrant.' };
  }
  const hit = memo.get(filing.accession);
  if (hit) return hit;

  let out;
  const inst = await instanceUrlFor(cik10(cik), filing).catch(() => null);
  if (!inst) {
    out = {
      available: false, filing,
      reason: `No extracted XBRL instance in the ${filing.form}'s archive folder — `
        + 'segment figures only survive in that document, so no split can be read.',
    };
  } else {
    out = splitFromInstance(inst.body, filing.period);
    out.filing = filing;
    out.filingUrl = filingUrl(cik10(cik), filing);
    out.instanceUrl = inst.url;
  }

  if (memo.size >= MAX_MEMO) memo.delete(memo.keys().next().value);
  memo.set(filing.accession, out);
  return out;
}

/* The geographic split, memoised separately: same filing, same instance
   (getText's disk cache makes the second read free), different axis. */
const geoMemo = new Map();

/**
 * The latest annual filing's revenue-by-geography split for a company.
 * Same contract as segmentsFor: always an object, `available: false` carries
 * its reason.
 */
export async function geographyFor(cik, subs = null) {
  const submissions = subs || await companySubmissions(cik).catch(() => null);
  const filing = latestAnnual(submissions);
  if (!filing) {
    return { available: false, reason: 'No 10-K or 20-F on file for this registrant.' };
  }
  const hit = geoMemo.get(filing.accession);
  if (hit) return hit;

  let out;
  const inst = await instanceUrlFor(cik10(cik), filing).catch(() => null);
  if (!inst) {
    out = {
      available: false, filing,
      reason: `No extracted XBRL instance in the ${filing.form}'s archive folder — `
        + 'geographic figures only survive in that document, so no split can be read.',
    };
  } else {
    out = geoSplitFromInstance(inst.body, filing.period);
    out.filing = filing;
    out.filingUrl = filingUrl(cik10(cik), filing);
    out.instanceUrl = inst.url;
  }

  if (geoMemo.size >= MAX_MEMO) geoMemo.delete(geoMemo.keys().next().value);
  geoMemo.set(filing.accession, out);
  return out;
}

export function _resetSegmentsCache() { memo.clear(); geoMemo.clear(); }

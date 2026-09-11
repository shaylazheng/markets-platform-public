/* The annual report's NARRATIVE, as opposed to its numbers.
 *
 * Everything else in this platform reads XBRL: companyfacts gives us revenue,
 * margins, debt and a share count, and `ratios.js` turns those into a
 * comparison. None of it can answer "what does this company actually do" —
 * that sentence is prose in Item 1 of the 10-K and is not tagged anywhere.
 * `scan10k.mjs` already fetches that document, but only to count which other
 * listed companies it names; it throws the prose away. This reads the prose.
 *
 * WHY THE COMPANY'S OWN WORDS, QUOTED. A business description is the one part
 * of a summary where a paraphrase is indistinguishable from an invention, and
 * a wrong one reads exactly as confidently as a right one. So `describe()`
 * returns a verbatim slice of Item 1 and the caller labels it as a quote. No
 * model is asked to compress it, and nothing here writes a sentence the filing
 * does not contain.
 *
 * WHY EVERY EXTRACTOR DECLINES. Same posture as `parseShare()` in
 * graph/server/enrich.js, and for the same reason it was written that way: the
 * first draft of that parser passed its invented test strings and was wrong on
 * three of the four real disclosures. Each function here returns null rather
 * than a guess, the tests use sentences taken out of real filings, and a
 * summary built on this renders "not stated" rather than a plausible number.
 *
 * THE TABLE OF CONTENTS IS THE TRAP. Every 10-K names "Item 1. Business"
 * twice — once in the contents, once at the section itself — and a first-match
 * slice returns the contents entry, which is a page number. `sliceItems()`
 * keeps the LONGEST body per heading, which is the section every time.
 */
import { getText, companySubmissions, cik10, TTL } from './edgar.js';

/* Forms that carry a business section. 10-K405 is the pre-2003 spelling and
   still the newest annual filing on file for companies that deregistered
   around then. 40-F is listed so `latestAnnual` can NAME it and decline —
   Canadian filers attach the narrative as an exhibit (the AIF), so the primary
   document holds no Item 1 to read. */
export const ANNUAL_FORMS = ['10-K', '10-K405', '20-F', '40-F'];
const NO_NARRATIVE = new Set(['40-F']);

/* Where the business section and the risk section live, per form. A 20-F is
   numbered against a different schedule than a 10-K and shares none of it:
   its business description is Item 4 and its risk factors are inside Item 3.
   Reading a 20-F on the 10-K map returns Item 1 ("Identity of Directors"),
   which is a page of names. */
const ITEM_MAP = {
  '10-K': { business: '1', risks: '1a' },
  '10-K405': { business: '1', risks: '1a' },
  '20-F': { business: '4', risks: '3' },
};

/** The newest annual filing in a submissions payload, or null. */
export function latestAnnual(subs) {
  const r = subs?.filings?.recent;
  if (!r?.form) return null;
  let best = null;
  for (let i = 0; i < r.form.length; i++) {
    const form = String(r.form[i]);
    // Exact match only. "10-K/A" is an amendment that routinely restates one
    // exhibit and omits Item 1 entirely, and "10-KT" is a transition period.
    if (!ANNUAL_FORMS.includes(form)) continue;
    const filed = r.filingDate[i];
    if (best && best.filed >= filed) continue;
    best = {
      form,
      filed,
      period: r.reportDate?.[i] || null,
      accession: r.accessionNumber[i],
      doc: r.primaryDocument?.[i] || null,
      hasNarrative: !NO_NARRATIVE.has(form),
    };
  }
  return best;
}

/** The primary document's URL. Needs the CIK unpadded — the Archives path uses
 *  the integer form, unlike every data.sec.gov endpoint. */
export function filingUrl(cik, filing) {
  if (!filing?.accession || !filing?.doc) return null;
  const bare = String(Number(cik10(cik)));
  return `https://www.sec.gov/Archives/edgar/data/${bare}/`
    + `${filing.accession.replace(/-/g, '')}/${filing.doc}`;
}

/* HTML -> text. Same shape as scan10k.mjs's stripper, with one addition that
   matters here and not there: block-level tags become a newline rather than a
   space. scan10k only ever asked "do these two names appear near each other",
   which survives losing the line structure; a description that has lost it
   runs a heading into the sentence after it ("General We design and sell…"). */
export function toText(html) {
  return String(html || '')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    // XBRL viewers hide the machine-readable copy of the whole filing in here.
    // Left in, every figure appears twice and Item 1 can be found inside it.
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<\/(p|div|tr|td|th|li|h[1-6]|table|section|br)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;|&#8217;/gi, '’')
    .replace(/&mdash;|&#8212;/gi, '—').replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&[a-z#0-9]{2,8};/gi, ' ')
    .replace(/[ \t ]+/g, ' ')
    /* A tag boundary inside a sentence leaves a space before the punctuation
       that closed it — "…to enrich life for all ." in Micron's 10-K, where the
       full stop sat outside the <span> holding the sentence. Cosmetic, but the
       description is quoted to the reader verbatim, so the quote should not
       carry our stripper's fingerprints. Only punctuation that cannot open a
       token is closed up; a space before "(" is left alone. */
    .replace(/ +([.,;:!?%)\]}’”])/g, '$1')
    .replace(/([(\[{“]) +/g, '$1')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .replace(/^ +| +$/gm, '')
    .trim();
}

/* Item headings.
 *
 * The letter suffix is the whole difficulty, and getting it wrong silently
 * merges two sections. Clorox's 10-K writes "Item 1.A. Risk Factors" — a period
 * BETWEEN the number and the letter. An earlier version of this matched a fixed
 * list of keys ("1a", "1b", …), so "Item 1.A." matched as plain "Item 1" with
 * the separator consuming the period; every 1A heading in the document was
 * keyed as 1, Item 1's longest span therefore ran from the business heading all
 * the way through the risk factors, and Clorox's business description came out
 * as "Additional risks and uncertainties that are not currently known…".
 *
 * So the number and the letter are matched separately, and a letter counts only
 * in the two forms filers actually write:
 *
 *   Item 1A.    letter joined to the number
 *   Item 1.A.   letter separated, and then closed by its own period
 *
 * Requiring that closing period is what keeps "Item 1. A summary of our
 * business…" from being read as Item 1A: the letter class is case-insensitive,
 * so a bare [a-c] test matches the "B" of "Business" and the "A" of "A summary"
 * just as readily as a real suffix. */
const ITEM_RE = new RegExp([
  String.raw`(?:^|[\s>|])item\s*`,
  String.raw`(\d{1,2})`,                       // 1: the item number
  String.raw`(?:`,
  String.raw`\s*[.:)—–-]\s*([a-c])\s*\.`,      // 2: "Item 1.A."
  String.raw`|([a-c])(?![a-z])`,               // 3: "Item 1A"
  String.raw`)?`,
  String.raw`\s*[.:)—–-]?\s*`,
].join(''), 'gi');

/**
 * Split a filing's text into its numbered items.
 *
 * Returns `{ [key]: body }`, keeping the LONGEST body found for each key. That
 * one rule is what defeats the table of contents: a contents row is a heading
 * followed by a page number and then the next heading, so its body is tens of
 * characters where the real section's is tens of thousands. It also survives
 * the two other places a heading is repeated — a page footer that restates the
 * current item, and a cross-reference in the body ("see Item 1A") — for
 * exactly the same reason.
 */
export function sliceItems(text) {
  const src = String(text || '');
  const marks = [];
  for (const m of src.matchAll(ITEM_RE)) {
    const num = Number(m[1]);
    // A 10-K stops at Item 16. Anything past it is a figure in prose that
    // happened to follow the word "item", and letting it through would split a
    // real section in two at that point.
    if (!Number.isInteger(num) || num < 1 || num > 16) continue;
    const letter = (m[2] || m[3] || '').toLowerCase();
    marks.push({ key: `${num}${letter}`, start: m.index + m[0].length });
  }
  const out = {};
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : src.length;
    const body = src.slice(marks[i].start, end).trim();
    const k = marks[i].key;
    if (!out[k] || body.length > out[k].length) out[k] = body;
  }
  return out;
}

/**
 * Every span found for one item key, in document order, joined on newlines.
 *
 * `sliceItems` keeps the LONGEST span per key, which is the right answer for
 * prose — the winner is the section, the losers are contents rows and
 * cross-references. It is the wrong answer for a scan that wants the whole
 * section even in pieces: CME's Item 1A writes "any of the risks discussed in
 * this Item 1A, including…" mid-sentence, that self-reference is a mark, and
 * the section splits around it. The longest fragment held one of the filing's
 * three risk-group headings and riskGroupsFrom declined a taxonomy that was
 * really there. Joining every fragment recovers all three. The extra material
 * a join drags in — a contents row, the tail of a section a cross-reference
 * cut — is harmless to a LINE-ANCHORED scan, which is the only kind that
 * should use this.
 */
export function itemSpansJoined(text, key) {
  const src = String(text || '');
  const marks = [];
  for (const m of src.matchAll(ITEM_RE)) {
    const num = Number(m[1]);
    if (!Number.isInteger(num) || num < 1 || num > 16) continue;
    const letter = (m[2] || m[3] || '').toLowerCase();
    marks.push({ key: `${num}${letter}`, start: m.index + m[0].length });
  }
  const bodies = [];
  for (let i = 0; i < marks.length; i++) {
    if (marks[i].key !== key) continue;
    const end = i + 1 < marks.length ? marks[i + 1].start : src.length;
    const body = src.slice(marks[i].start, end).trim();
    if (body) bodies.push(body);
  }
  return bodies.join('\n');
}

/* Headings and boilerplate that open Item 1 without saying anything about the
   business. Dropped from the front of a description one at a time, because
   filings stack them ("Business General Overview Our Company We design…"). */
const LEAD_NOISE = /^(?:business|general|overview(?: of(?: our)? business)?|introduction|our company|the company|company overview|business overview|part\s+i+|forward[- ]looking statements?|cautionary (?:note|statement)[^.]*\.)\s*/i;

/* A sentence that is about the document rather than the company. Filings open
   with these often enough that taking "the first two sentences" without a
   filter returns a legal disclaimer as the business description. */
const ABOUT_THE_DOCUMENT =
  /forward[- ]looking|this (?:annual )?report|this form 10-?k|unless (?:the context|otherwise)|incorporated (?:herein )?by reference|refer(?:s|red)? to (?:as )?["“]?(?:we|us|our|the company)|as used (?:herein|in this)|see ["“]?item|table of contents|risk factors/i;

/* A CROSS-REFERENCE TABLE, which is a whole Item 1 in some filings and not a
 * description of anything.
 *
 * Intel's 10-K is the case that added this. Its Item 1 is 157 characters long
 * and consists of "General development of business Pages 3 - 5, 18 /
 * Description of business Pages 3 - 24, 33, 52, 72 - 75 / Available
 * information Page 2" — the business section points at page ranges elsewhere
 * in the document rather than containing prose. It cleared the digit-ratio
 * filter (14% digits) and was returned as Intel's business description. */
const PAGE_REFERENCE = /\bpages?\s+\d|\bpage\s+\d|\bsee\s+(?:note|page|part)\b/i;

const isSentenceEnd = (s, i) => {
  // "Inc." / "Corp." / "U.S." / "No. 3" end no sentence, and mis-splitting on
  // them is how a description ends after four words.
  const tail = s.slice(Math.max(0, i - 6), i + 1).toLowerCase();
  if (/(?:^|[\s(])(?:inc|corp|co|ltd|llc|plc|no|ca|jr|sr|dr|mr|ms|vs|etc|e\.g|i\.e|u\.s|u\.k)\.$/.test(tail)) return false;
  if (/\b[a-z]\.$/.test(tail)) return false;           // a single initial
  return /\s/.test(s[i + 1] || ' ');
};

/** Split prose into sentences, conservatively. */
export function sentences(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const out = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (!/[.!?]/.test(s[i])) continue;
    if (!isSentenceEnd(s, i)) continue;
    const piece = s.slice(start, i + 1).trim();
    if (piece) out.push(piece);
    start = i + 1;
  }
  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * The company's description of itself, VERBATIM, from the front of Item 1.
 *
 * Sentences are quoted in order and nothing is rewritten. Returns null rather
 * than something short and useless: a business section that yields under 120
 * characters of usable prose is a cross-reference ("The information required
 * by this Item is incorporated by reference"), not a description.
 *
 * @param {string} item1
 * @param {{maxChars?: number, maxSentences?: number}} [opts]
 * @returns {{ text: string, sentences: string[], truncated: boolean } | null}
 */
export function describe(item1, { maxChars = 720, maxSentences = 4 } = {}) {
  let body = String(item1 || '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 6; i++) {
    const next = body.replace(LEAD_NOISE, '');
    if (next === body) break;
    body = next;
  }
  const kept = [];
  let chars = 0;
  let truncated = false;
  for (const s of sentences(body)) {
    if (kept.length >= maxSentences) { truncated = true; break; }
    // Page furniture and table debris: a "sentence" with no verb-length words,
    // or one that is mostly digits, is a column of numbers we failed to drop.
    if (s.length < 25) continue;
    if (ABOUT_THE_DOCUMENT.test(s)) continue;
    if (PAGE_REFERENCE.test(s)) continue;
    if ((s.replace(/[^0-9]/g, '').length / s.length) > 0.25) continue;
    if (chars + s.length > maxChars && kept.length) { truncated = true; break; }
    kept.push(s);
    chars += s.length + 1;
  }
  if (!kept.length || chars < 120) return null;
  return { text: kept.join(' '), sentences: kept, truncated };
}

/* ---- facets ------------------------------------------------------------- *
 *
 * Each of these answers one question a reader of an investment report asks in
 * the first thirty seconds, and each is stated in Item 1 in a form regular
 * enough to read without a model — but only in SOME filings. Every one returns
 * null when the sentence is not there, and the caller reports the absence.
 */

/** Headcount, as the filing states it. `asOf` only when the filing dates it.
 *
 * "approximate ly", with a space, is CME's 10-K after the strip — the filing's
 * own HTML splits the word across two spans mid-token, so the space is in the
 * source and `toText` cannot know two fragments were one word. The pattern
 * tolerates the split and the quote closes it back up, because the quote is
 * shown verbatim and should not carry the typesetter's seam.
 *
 * "consisted of" is also CME's: "our global employee population consisted of
 * approximately 3,875 employees" has no verb the earlier list knew. */
export function employeesFrom(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const re = /(?:had|have|employ(?:ed|s)?|employed a total of|consist(?:s|ed)? of|with)\s+(?:approximate\s?ly|about|roughly|nearly|over|more than|some)?\s*([\d][\d,.]{2,})\s*(?:thousand\s+)?(?:full-?time\s+|regular\s+|permanent\s+)?(?:equivalent\s+)?(employees|people|persons|team members|associates|colleagues|staff)\b/gi;
  for (const m of s.matchAll(re)) {
    const raw = m[1];
    // "1.5" is a thousands figure only if "thousand" follows; otherwise a
    // decimal here is a page number or a footnote marker, not a headcount.
    const isThousands = /thousand/i.test(m[0]);
    const n = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const count = isThousands ? Math.round(n * 1000) : n;
    if (!Number.isInteger(count) || count < 10 || count > 5e6) continue;
    /* The date sits on EITHER side of the count, and which side is the filer's
       house style: "As of December 27, 2025, we had approximately 88,400
       employees" puts it first, "We had 108,900 employees as of December 30,
       2023" puts it last. Looking only forward found the second and missed the
       first, which is the commoner of the two. */
    const window = s.slice(Math.max(0, m.index - 60), m.index + m[0].length + 90);
    // Case-insensitive: the date-first house style capitalises it ("As of
    // December 27, 2025, we had…"), the date-last style does not.
    const asOf = (window.match(/as of (?:the end of [^,]{3,30}|([A-Z][a-z]+ \d{1,2},? \d{4}))/i) || [])[1] || null;
    return {
      count,
      approximate: /approximate\s?ly|about|roughly|nearly|over|more than|some/i.test(m[0]),
      basis: /full-?time/i.test(m[0]) ? 'full-time' : null,
      asOf,
      quote: m[0].trim().replace(/approximate ly/i, 'approximately'),
    };
  }
  return null;
}

/* Segment disclosure comes in two strengths and they are worth different
   things. A COUNT ("we have three reportable segments") is in almost every
   10-K. The NAMES are what a reader wants, and they are only extractable when
   the filing enumerates them in the same breath — a colon or dash list. When
   the count is stated and the names are not, we return the count and say so,
   because "3 segments, names not enumerated here" is a true statement and
   three invented segment names are not.

   Note what this deliberately does NOT do: segment REVENUE. Those figures are
   tagged on dimensional axes that SEC's flattened companyfacts API drops
   entirely (see CLAUDE.md). They DO survive in the filing's extracted XBRL
   instance, and reading them out of it is segments.js's job, not this
   file's — this file reads prose, that one reads tagged facts. */
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

const NUM = '(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d{1,2})';

/* THE PHRASINGS, TAKEN FROM FILINGS RATHER THAN IMAGINED.
 *
 * Two earlier versions of this were wrong in the two opposite directions, and
 * both failures are worth keeping written down because they are the two ways
 * this whole file can go bad.
 *
 * TOO NARROW. The first matched only "<N> reportable segments" and found the
 * count in one filing out of four. Filings say it every other way:
 *
 *   MSFT  "report our financial performance using three segments: …"
 *   AMZN  "We have organized our operations into three segments: …"
 *   ZTS   "we organize and operate our business in two segments: …"
 *   WMT   "Our operations comprise three reportable segments: …"
 *   GLW   "operates in five reportable segments: …"
 *   NVDA  "We report our business results in two segments."
 *
 * TOO LOOSE, which is worse — it produced numbers that were confidently wrong
 * rather than absent:
 *
 *   MSFT  "costs incurred by one segment may benefit other segments" was read
 *         as "Microsoft has 1 reportable segment". Microsoft has three.
 *   AMD   "we combined the Client and Gaming segments into one reportable
 *         segment" was read as a company-wide total of 1. AMD has several.
 *   ZTS   a table-of-contents row, "Business Overview 1 Operating Segments 1
 *         Products 3", was read as "1 operating segment". Zoetis has two.
 *
 * The rule that separates the two: a segment count is only a count when a verb
 * or determiner in front of it makes it a claim about the WHOLE COMPANY. Bare
 * proximity of a numeral to the word "segments" is not evidence — in a
 * contents block it is a page number, and in an accounting note it is one
 * segment among others. Hence ANCHOR below, and hence the exclusion of "into"
 * and "combined", which mark a sentence about a reorganisation.
 */

/* Words that, appearing just before the count, make it a statement about the
   whole registrant. Everything real seen so far is in here; anything not in
   here is declined rather than guessed at. */
const ANCHOR = String.raw`(?:have|has|had|our|its|is|are|comprise[sd]?|conducted|organiz(?:e|ed|es)|operate[sd]?|manage[sd]?|report(?:s|ed)?|through|into|following|using|based\s+on|include[sd]?|aggregated|consists?\s+of|which\s+are)`;

/* A sentence about a reorganisation, not about the total. "Combined X and Y
   into one reportable segment" states what happened to two segments, not how
   many the company has. */
const REORG = /\b(?:combin|merg|consolidat|realign|reorganiz|integrat|renam|moved|transferr)/i;

/* "Segment" is not only a business unit. Under the credit-loss standard a bank
 * divides its LOAN BOOK into segments, and that sentence has the same shape as
 * a reportable-segment disclosure:
 *
 *   FISI  "has divided its portfolio into six segments, as the loans within the
 *          segments have similar characteristics"
 *
 * Read as a business-segment count that made a small bank into a
 * six-division conglomerate. Applied only when the filing did NOT say
 * "reportable" or "operating" — with either qualifier present the noun is
 * unambiguous and this guard would only create false absences. */
const OTHER_KIND_OF_SEGMENT =
  /\b(?:portfolio|loan|receivabl|credit\s+quality|allowance|impair|financing\s+class|vintage|risk\s+rating|market\s+segment|customer\s+segment|revenue\s+stream)/i;

const SEG_NOUN = String.raw`(?:reportable\s+|operating\s+|business\s+){0,2}segments`;

/* Ordered by precedence, most trustworthy first. Each captures the count in
   group 1 and is matched against the whole flattened text. */
const SEGMENT_SHAPES = [
  // MU: "four business units, which are our reportable segments: …"
  { rank: 0, re: new RegExp(`\\b${NUM}\\s+business\\s+units?,?\\s+which\\s+are\\s+(?:our\\s+)?reportable\\s+segments?`, 'gi') },
  /* CAT: "operate through five operating segments, four of which are reportable
     segments". The reportable count is FOUR; reading the sentence's first
     numeral gives five, which is the operating-segment count and a different
     measure. Ranked above the plural shape so it wins on this sentence. */
  { rank: 1, re: new RegExp(`\\b${NUM}\\s+of\\s+which\\s+are\\s+reportable\\s+segments?`, 'gi') },
  // The general plural form, with an anchor in front and N >= 2.
  { rank: 2, re: new RegExp(`${ANCHOR}[^.]{0,45}?\\b${NUM}\\s+${SEG_NOUN}\\b`, 'gi'), plural: true },
];

/* The singular form, which carries no numeral in most filings and so cannot be
   found by a numeral pattern at all. Every true positive seen states the kind
   of segment ("one OPERATING segment", "a single REPORTABLE segment"); the one
   false positive did not ("by one segment may benefit"), so the qualifier is
   required rather than optional. */
const SINGLE_SEGMENT_RE =
  /\b(?:only\s+)?(?:one|a\s+single|single)\s+(?:reportable\s+|operating\s+){1,2}segment\b/gi;

export function segmentsFrom(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  let best = null;                        // the highest-ranked count so far

  for (const shape of SEGMENT_SHAPES) {
    shape.re.lastIndex = 0;
    for (const m of s.matchAll(shape.re)) {
      const raw = String(m[1] || '').toLowerCase();
      const n = WORD_NUM[raw] ?? Number(raw);
      if (!Number.isFinite(n) || n < 1 || n > 40) continue;
      // The plural shape claims nothing about a lone segment: with N = 1 it is
      // matching either a contents row or a reorganisation sentence.
      if (shape.plural && n < 2) continue;
      const before = s.slice(Math.max(0, m.index - 60), m.index);
      if (REORG.test(before) || REORG.test(m[0])) continue;

      /* Only when the filing left the noun unqualified. "Reportable segments"
         and "operating segments" are terms of art and need no disambiguating. */
      if (!/\b(?:reportable|operating)\s+segments/i.test(m[0])) {
        const around = before + m[0] + s.slice(m.index + m[0].length, m.index + m[0].length + 80);
        if (OTHER_KIND_OF_SEGMENT.test(around)) continue;
      }

      const quote = m[0].trim();
      if (!best || shape.rank < best.rank) best = { rank: shape.rank, count: n, names: null, quote };

      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 900);
      const names = namesAfter(after, n);
      // Names are the prize. A sentence that both states the count and
      // enumerates it is the best answer available, so stop there.
      if (names) return { count: n, names, quote };
    }
    if (best && best.rank <= shape.rank) break;   // a better-ranked shape already won
  }
  if (best) return { count: best.count, names: best.names, quote: best.quote };

  SINGLE_SEGMENT_RE.lastIndex = 0;
  for (const m of s.matchAll(SINGLE_SEGMENT_RE)) {
    const before = s.slice(Math.max(0, m.index - 60), m.index);
    if (REORG.test(before)) continue;
    if (!new RegExp(ANCHOR, 'i').test(before)) continue;
    return { count: 1, names: null, quote: m[0].trim() };
  }
  return null;
}

/* The three list shapes that appear after a segment count, in the order they
   are unambiguous. Anything else returns null and the caller reports the count
   alone — "4 segments, names not enumerated here" is true; four invented
   segment names are not. */
function namesAfter(after, want) {
  // 1. A colon or dash list: "…segments: Health and Wellness, Household, …"
  const listed = after.match(/^\s*(?:which are|as follows|namely|comprising|consisting of)?\s*[:—–-]\s*([^.]{4,320})[.]/)
    || after.match(/^\s*(?:which are|namely|comprising|consisting of|are)\s+([^.]{4,320})[.]/);
  if (listed) {
    const names = splitSegmentList(listed[1], want);
    if (names) return names;
  }

  /* 2. A QUOTED list, which is NVDA's form: `are "Compute & Networking" and
        "Graphics."` Quoted names need no splitting heuristic at all — the
        filing has already delimited them, so this is the most reliable shape
        here and the only one where "and" inside a name cannot mislead. */
  const quoted = [...after.slice(0, 320).matchAll(/[“"]\s*([^”"]{2,60}?)\s*[.,]?\s*[”"]/g)]
    .map((m) => m[1].trim()).filter(Boolean);
  if (quoted.length === want) return quoted;

  /* 3. An ABBREVIATION-DEFINITION list, which is MU's form: `Cloud Memory
        Business Unit ( CMBU ): Focused on…` repeated once per segment. The
        parenthesised initialism followed by a colon is the delimiter, so this
        needs no comma logic either. */
  /* No "." in the name class, deliberately. With it allowed, the lazy match
     started at the "Focused" of the PREVIOUS segment's description and ran
     through the full stop, so Micron's fourth segment came out as "Focused on
     mobile. Automotive and Embedded Business Unit". A sentence boundary is the
     one thing a segment name never crosses. */
  const defined = [...after.matchAll(/([A-Z][A-Za-z&'\- ]{3,60}?)\s*\(\s*([A-Z]{2,7})\s*\)\s*:/g)]
    .map((m) => m[1].replace(/^(?:and|our|the)\s+/i, '').trim())
    .filter((x) => x.length >= 3);
  if (defined.length === want) return defined;

  return null;
}

/* Splitting a segment list is the one genuinely ambiguous step in this file,
 * because "and" is both the list conjunction and part of segment names:
 *
 *   Client Computing Group, Data Center and AI, and Intel Foundry   -> 3
 *   Compute and Networking, Mobile, Embedded and Storage            -> 4
 *
 * The same token separates differently in the two, and no amount of grammar
 * settles it — only the count stated in the same sentence does. So this splits
 * on commas first (which is right for the first), and only if that misses the
 * promised count does it also break the final element on "and" (which is right
 * for the second). If neither lands on the count, it returns null and the
 * caller reports the count with no names.
 */
function splitSegmentList(raw, want) {
  const tidy = (x) => x
    .replace(/^\s*(?:and|our|the)\s+/i, '')
    .replace(/\s+(?:segments?|business units?|reportable segments?)$/i, '')
    .replace(/["“”()]/g, '').trim();
  const ok = (xs) => xs.length === want
    && xs.every((x) => x.length >= 2 && x.length <= 60 && /[A-Za-z]/.test(x)
                       && !/^(?:etc|other|others)$/i.test(x));

  const byComma = raw.split(/;|,/).map(tidy).filter(Boolean);
  if (ok(byComma)) return byComma;

  // Break only the LAST element on "and" — an earlier one is part of a name.
  if (byComma.length >= 1) {
    const head = byComma.slice(0, -1);
    const tail = byComma[byComma.length - 1].split(/\s+and\s+/).map(tidy).filter(Boolean);
    const escalated = [...head, ...tail];
    if (ok(escalated)) return escalated;
  }
  return null;
}

/** State and year of incorporation, as stated. Free of the text where SEC's
 *  submissions payload already carries the state — but the YEAR is nowhere in
 *  structured SEC data and is the only place a founding date comes from. */
export function incorporationFrom(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const thisYear = new Date().getFullYear();
  /* An optional month, with or without a day. NVIDIA's sentence is "incorporated
     in California in April 1993", and a pattern that required a day number
     ("April 12, 1993") matched neither the month nor the year and reported the
     founding date as unstated. */
  const MONTH = String.raw`(?:[A-Z][a-z]{2,8}\s+)?(?:\d{1,2},?\s+)?`;
  const shapes = [
    // "incorporated in California in April 1993"  — state, then year
    new RegExp(String.raw`incorporated\s+(?:in|under the laws of(?: the)?(?: state of)?)\s+([A-Z][A-Za-z ]{2,24}?)\s+(?:in|on)\s+${MONTH}(\d{4})`),
    // "incorporated in 1993 in California"        — year, then state
    new RegExp(String.raw`incorporated\s+(?:in|on)\s+${MONTH}(\d{4})\s+in\s+([A-Z][A-Za-z ]{2,24}?)\b`, ''),
    // a bare year, from any of the verbs filings use
    new RegExp(String.raw`(?:was\s+)?(?:originally\s+)?(?:incorporated|reincorporated|organized|organised|founded|established)\s+(?:in|on)\s+${MONTH}(\d{4})`),
  ];
  for (let i = 0; i < shapes.length; i++) {
    const m = s.match(shapes[i]);
    if (!m) continue;
    // Which capture is the year depends on the shape; shape 1 reverses them.
    const year = Number(i === 1 ? m[1] : (m[2] ?? m[1]));
    const state = i === 0 ? m[1].trim() : i === 1 ? m[2].trim() : null;
    if (!Number.isFinite(year) || year < 1600 || year > thisYear) continue;
    return { state, year, quote: m[0].trim() };
  }
  return null;
}

/* The filing's OWN risk taxonomy.
 *
 * Item 1A runs twenty pages and nobody reads it in a rail, but its GROUPING
 * headings are a one-line map of what management thinks can go wrong, in
 * management's own order of priority — and this platform reads none of it
 * today. What is deliberately not attempted: enumerating individual risk
 * factors. Those are bold sub-headings whose boldness does not survive the
 * strip to text, so recovering them would mean guessing where a heading ends,
 * and a half-sentence risk is worse than no risk.
 *
 * The group headings are recoverable because filers phrase them to a formula.
 * Only that formula is matched; anything else is declined. */
/* MATCHED PER LINE, ANCHORED AT BOTH ENDS — and that is the whole trick.
 *
 * The first version of this collapsed the whitespace and then scanned for the
 * phrase, which cannot work: with the newlines gone there is nothing between
 * one heading and the next, so a bounded-but-greedy match ran straight through
 * "Risks Related to Our Business and Industry" into the heading after it, and
 * every occurrence came out a different string. Two occurrences of a heading
 * never agreed, so the >= 2 rule discarded everything and the function always
 * declined.
 *
 * A heading is a SHORT LINE ON ITS OWN — that is what `toText` preserves the
 * newlines for. Anchoring at both ends is also what keeps prose out: "the
 * risks related to our business" inside a paragraph is never a whole line. */
const RISK_GROUP_LINE = new RegExp('^(?:' + [
  String.raw`risks?\s+(?:related|relating|pertaining)\s+to\s+[^.;:]{3,70}`,
  String.raw`risks?\s+associated\s+with\s+[^.;:]{3,70}`,
  String.raw`(?:other\s+)?(?:operational|financial|strategic|legal|regulatory|compliance|competitive|technological|technology|cybersecurity|information security|macroeconomic|economic|market|industry|business|liquidity|credit|tax|environmental|climate|human capital|reputational|geopolitical|international|manufacturing|supply chain|intellectual property)(?:\s*(?:,|and)\s*\w[\w ]{0,30})?\s+risks?`,
].join('|') + ')$', 'i');

export function riskGroupsFrom(item1a) {
  const src = String(item1a || '');
  if (src.replace(/\s+/g, ' ').length < 400) return null;   // a cross-reference, not a section
  const seen = new Map();
  for (const line of src.split('\n')) {
    // A contents row is the heading plus its page number; the heading at the
    // section itself has no trailing digits. Both must reduce to one key.
    const l = line.trim().replace(/[\s.·—–-]*\d{1,3}$/, '').replace(/[\s,;:.]+$/, '');
    if (l.length < 8 || l.length > 90) continue;
    if (!RISK_GROUP_LINE.test(l)) continue;
    const key = l.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!key) continue;
    const prev = seen.get(key);
    // Keep the first spelling seen, normalised. Filers SHOUT the heading in the
    // contents and title-case it at the section (or the reverse), and a list
    // mixing "RISKS RELATED TO OUR BUSINESS" with "Financial risks" reads as
    // two different kinds of thing rather than one taxonomy.
    seen.set(key, { label: prev?.label || sentenceCase(l), count: (prev?.count || 0) + 1 });
  }
  /* ONE occurrence is enough, and an earlier version of this requiring two was
     wrong on the first real filing it met.

     The reasoning for "two" was that a heading is named in the contents and
     again at the group, so a single hit meant a stray phrase. Micron's 10-K
     disproves it: its Risk Factor Summary lists four groups, the detail
     headings below are not all phrased identically, and only one of the four
     matched itself. The rule discarded three real groups to guard against a
     false positive that the whole-line anchoring above had already made
     impossible — prose does not sit alone on a 40-character line. Two distinct
     GROUPS is still the floor for calling something a taxonomy. */
  const groups = [...seen.values()].map((g) => g.label);
  return groups.length >= 2 ? groups.slice(0, 12) : null;
}

const MINOR = /^(?:to|of|and|or|our|the|with|in|a|an|for|on|from|as|at|by)$/;
function sentenceCase(s) {
  const out = s === s.toUpperCase()
    ? s.toLowerCase().split(' ').map((w) => (MINOR.test(w) ? w : w)).join(' ')
    : s;
  return (out.charAt(0).toUpperCase() + out.slice(1))
    /* A share class is a proper noun even after a SHOUTED heading is folded:
       "RISKS RELATING TO … OUR CLASS A COMMON STOCK" must not come back as
       "class a". */
    .replace(/\bclass ([a-c])\b/gi, (_, l) => `Class ${l.toUpperCase()}`);
}

/* ---- assembly ----------------------------------------------------------- */

/* The parsed narrative, memoised by accession number.
 *
 * edgar.js caches the DOCUMENT on disk, which is what keeps us inside SEC's
 * rate limit, but a 10-K primary document is 8-12MB of inline-XBRL HTML and
 * re-running the strip and the slice on every request costs about a second of
 * CPU for a result that cannot have changed — an accession number is immutable
 * once filed. Keyed on it rather than on the ticker so a company that files
 * its next 10-K invalidates itself. */
const parsed = new Map();
const MAX_PARSED = 64;

/**
 * Read the latest annual report's narrative for a company.
 *
 * @param {string|number} cik
 * @param {object} [subs]  a submissions payload, if the caller already has one
 * @returns {Promise<object>} always an object; `available: false` explains why
 *   when there is nothing to read, so a caller can say so rather than showing
 *   an empty panel.
 */
export async function narrativeFor(cik, subs = null) {
  const submissions = subs || await companySubmissions(cik).catch(() => null);
  const filing = latestAnnual(submissions);
  if (!filing) {
    return { available: false, reason: 'No 10-K or 20-F on file for this registrant.' };
  }
  if (!filing.hasNarrative) {
    return {
      available: false, filing,
      reason: `The newest annual filing is a ${filing.form}, which carries the `
        + 'business description in an exhibit (the Annual Information Form) '
        + 'rather than in the filing itself.',
    };
  }
  const url = filingUrl(cik, filing);
  if (!url) return { available: false, filing, reason: 'The filing has no primary document.' };

  const memo = parsed.get(filing.accession);
  if (memo) return memo;

  // A filed document never changes, so revalidation would spend a request to
  // be told so. The TTL is long for the same reason; `filings.recent` is what
  // notices a NEW 10-K, and that is fetched fresh by the caller's resolve.
  const html = await getText(url, { ttlMs: 365 * 24 * 3600e3, revalidate: false });
  if (!html) {
    return { available: false, filing, url,
             reason: 'SEC returned no body for the filing document.' };
  }

  const text = toText(html);
  const items = sliceItems(text);
  const map = ITEM_MAP[filing.form] || ITEM_MAP['10-K'];
  const item1 = items[map.business] || '';
  const item1a = items[map.risks] || '';

  /* An Item 1 THIS short does not contain a business description — it points at
     one. Intel's is 157 characters of page references into the rest of the
     document (see PAGE_REFERENCE). Saying so beats both a blank panel and a
     quotation of the page numbers, and the number is generous: the shortest
     real Item 1 in a spot check of the platform's 33 covered tickers is several
     thousand characters. */
  const THIN = 500;
  const absent = {};
  const thinBusiness = item1.length < THIN;
  if (thinBusiness) {
    absent.description = item1.length
      ? `This ${filing.form}'s Item 1 is ${item1.length} characters and incorporates the `
        + 'business description by reference to other parts of the filing, so there is '
        + 'no passage here to quote.'
      : `Item 1 could not be located in this ${filing.form}.`;
  }

  /* The whole-document fallback for headcount and segments, but NOT for the
     description. A number stated anywhere in a 10-K is that number; a sentence
     pulled from an unknown section is not reliably about the business. */
  const employees = (!thinBusiness && employeesFrom(item1)) || employeesFrom(text);
  const segments = (!thinBusiness && segmentsFrom(item1)) || segmentsFrom(text);
  const description = thinBusiness ? null : describe(item1);
  /* Every fragment of the risk section, not the longest one: a self-reference
     ("the risks discussed in this Item 1A") splits the section and the group
     headings land in different fragments. Line-anchored scan, so the join is
     safe — see itemSpansJoined. */
  const risksJoined = itemSpansJoined(text, map.risks) || item1a;
  const riskGroups = riskGroupsFrom(risksJoined);
  /* The risk section's full quotable prose — same describe() strip as the
     description, so tables and bare headings drop out. For long-form callers
     (the report's comprehensive length); the headings surfaces keep reading
     the outlook route as before. */
  const risksFull = risksJoined.length >= 400
    ? describe(risksJoined, { maxChars: Infinity, maxSentences: Infinity }) : null;

  if (!description && !thinBusiness) {
    absent.description = 'Item 1 was located but yielded no quotable prose — it is '
      + 'tables and headings after the strip.';
  }
  if (!employees) absent.employees = 'No headcount sentence in this filing.';
  if (!segments) absent.segments = 'The filing does not state a reportable-segment count.';
  if (!riskGroups) {
    absent.riskGroups = item1a.length < 400
      ? `Item ${map.risks.toUpperCase()} is ${item1a.length} characters — a cross-reference, not a section.`
      : 'The risk factors are not grouped under headings this can read.';
  }
  /* Segment REVENUE is deliberately NOT this file's absence to declare.
     segments.js reads it from the filing's extracted XBRL instance — where the
     dimensional axes companyfacts drops survive — and the caller composing
     both (peers.js /summary) states the absence with that attempt's actual
     reason when it declines. */

  const out = {
    available: true,
    filing,
    url,
    chars: text.length,
    /* Reported so a caller can distinguish "the filing does not say" from "we
       could not find the section" — different absences, different fixes. */
    sections: { business: item1.length, risks: item1a.length },
    description,
    /* The same quotable prose, uncapped — every sentence the strip keeps, for
       callers printing a long-form document (the report's comprehensive
       length). Same describe() filter, so it is still prose, never tables or
       headings; memoised with the rest, computed once per filing. */
    descriptionFull: thinBusiness ? null : describe(item1, { maxChars: Infinity, maxSentences: Infinity }),
    risksFull,
    employees,
    segments,
    incorporation: incorporationFrom(item1) || incorporationFrom(text.slice(0, 200000)),
    riskGroups,
    absent,
  };

  if (parsed.size >= MAX_PARSED) parsed.delete(parsed.keys().next().value);
  parsed.set(filing.accession, out);
  return out;
}

export function _resetNarrativeCache() { parsed.clear(); }

/** Exported for the test and for callers that want the raw sections. */
export const _internals = { ITEM_MAP, ITEM_RE, RISK_GROUP_LINE, TTL };

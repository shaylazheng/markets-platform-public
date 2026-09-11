/* Source composition for the Risks & Catalysts surface — the pure half of the
 * source inspector, on the model of competitors/src/peerSources.js.
 *
 * Everything here takes the /api/outlook payload and returns data; nothing
 * fetches and nothing renders. `truth` marks a PRIMARY document — the filing
 * the claim actually sits in, never a search that would find one — which for
 * this surface means the 10-K a heading was copied from, the 10-Q that
 * affirmed it, or the 8-K the guidance was given with. A press headline is
 * never truth: the story url opens the publisher's argument, not a filing.
 */
import { fmtDate, newsSource, registryRows } from '@markets/shell/lib/sourceRows.js';

const day = (d) => (d ? String(d).slice(0, 10) : null);

/* The payload-wide rows most selections share: which filings exist, and the
   registrant's full EDGAR listing. Degraded payloads omit either url. */
const indexRows = (d) => [
  ...(d?.sources?.submissions ? [{ type: 'Live feed',
    label: 'Submissions index — which filings exist (raw JSON)', url: d.sources.submissions }] : []),
  ...(d?.sources?.edgarAll ? [{ type: 'SEC filing',
    label: 'All company filings on EDGAR', url: d.sources.edgarAll }] : []),
];

const filingRow = (f, suffix, truth = true) => (f?.url ? [{
  type: 'SEC filing', truth,
  label: `${f.form}, ${fmtDate(f.filed)}${suffix ? ` — ${suffix}` : ''}`, url: f.url,
}] : []);

/* The rows behind a catalyst or the guidance: the researched intel's own
   citations, the matched results 8-K first. */
const intelRows = (d) => {
  const c = d?.company?.catalysts;
  const s = c?.sources || {};
  return [
    ...(s.resultsEightK?.url ? [{ type: 'SEC filing', truth: true,
      label: `8-K, ${fmtDate(s.resultsEightK.filed)} — the ${c.quarter || 'quarterly'} results this intel is anchored to`,
      url: s.resultsEightK.url }] : []),
    ...filingRow(s.tenQ, 'the quarterly report behind the intel', false),
    ...filingRow(s.tenK, 'the annual report behind the intel', false),
    ...(s.ir ? [{ type: 'Investor page',
      label: 'Investor relations — the company\'s own calendar and releases', url: s.ir }] : []),
  ];
};

const INTEL_METHOD = (asOf, ticker) =>
  `Read from the researched earnings intel — data/earnings/${ticker}.json, produced by headless `
  + `Claude over the company's calls and filings, read here and never regenerated on load. `
  + `As of ${asOf || 'the last research run'}; anything since is not in the file.`;

/* The rows behind the web-consensus section: one per aggregator, its human
   page first, then the endpoints the numbers were actually read from. Not
   `truth` — these are aggregators of sell-side opinion, not documents. */
const webSourceRows = (s) => [
  ...(s?.url ? [{ type: 'Live feed', label: `${s.name} — the page as a reader sees it`, url: s.url }] : []),
  ...(s?.api || []).map((u) => ({ type: 'Live feed', label: `${s.name} — the endpoint read`, url: u })),
];

/** What is claimed and how it was arrived at, for one selection. */
export function describe(sel, d, web) {
  if (!sel || !d) return { claim: '', method: '' };
  const risks = d.company?.risks;
  const update = d.company?.update;
  const c = d.company?.catalysts;
  switch (sel.kind) {
    case 'risk':
      return {
        claim: `“${sel.text}”${sel.group ? ` — one of the company's own risk-factor headings, filed under its “${sel.group}” group.` : ' — one of the company\'s own risk-factor headings.'}`,
        method: 'Copied character for character from Item 1A of the linked 10-K. Headings are found '
          + 'by FORMATTING — the bold, italic or heading colour the filer set them off with — never '
          + 'by a model, and nothing is paraphrased.'
          + (risks?.strategy === 'title'
            ? ' This issuer files a redesigned 10-K with no “Item 1A” heading in the body, so the section was located by its chapter title instead.' : ''),
      };
    case 'update':
      return sel.affirm
        ? {
            claim: `The latest 10-Q affirms the annual risk factors rather than adding to them — the quarterly re-statement that the 10-K risks stand.`,
            method: 'The affirmation sentence is the company\'s own, in Part II Item 1A of the linked '
              + '10-Q, recognised against the standard affirmation dialects and linked rather than paraphrased.',
          }
        : {
            claim: `“${sel.text}”${sel.group ? ` — a new or restated risk heading in the latest 10-Q, under its “${sel.group}” group.` : ' — a new or restated risk heading in the latest 10-Q.'}`,
            method: 'Copied character for character from Part II Item 1A of the linked 10-Q — found by '
              + 'formatting, never by a model, and never paraphrased. A quarter in which the company '
              + 'chose to change its own risk statement is itself information.',
          };
    case 'catalyst':
      return {
        claim: `${sel.event} — dated ${sel.date} by the company itself.`,
        method: INTEL_METHOD(c?.asOf, d.ticker) + ' Dates are kept as soft as the company gave them: '
          + 'a range like “H2 2026” is guidance-grade language, not a calendar entry.',
      };
    case 'guidance':
      return {
        claim: `The company's own guidance, given with the ${c?.quarter || 'latest'} results${c?.reportDate ? ` on ${c.reportDate}` : ''}.`,
        method: INTEL_METHOD(c?.asOf, d.ticker),
      };
    case 'consensus': {
      const ib = d.street?.consensus;
      if (!ib?.covered) {
        return {
          claim: 'Street consensus for this ticker — currently absent.',
          method: ib?.available
            ? 'IBES is loaded on this machine but carries no rows for this ticker — the pull covers named tickers, so this is absence of a pull, not of analyst coverage.'
            : `Consensus is unavailable: ${ib?.why || 'the insider service did not answer'}.`,
        };
      }
      const pending = (ib.rows || []).filter((r) => r.actual == null);
      return {
        claim: `${ib.totalRows} periods of street estimates, ${pending.length} still pending`
          + (pending.length ? ` — the next period ends ${day(pending[0]?.periodEnd)}.` : '.'),
        method: 'IBES street estimates via Princeton\'s synthetic sample subscription, stored locally in '
          + 'insider.duckdb (estimates table). Point-in-time: each row carries the last consensus '
          + 'before the announcement, so a surprise compares IBES to IBES, never a street number to '
          + 'a GAAP one. These are estimates, as current as the last pull — not refreshed on load.',
      };
    }
    case 'story':
      return {
        claim: sel.item?.title || '',
        method: 'A Google News headline search filtered to stories naming the company in the headline '
          + 'itself. The words are the publisher\'s, not this platform\'s — leads, not facts, each '
          + 'linked so the argument can be read where it was made.',
      };
    case 'foreign':
      return {
        claim: `This registrant files a ${d.company?.foreignAnnual?.form || '20-F'}; its risk factors sit in Item 3.D of that annual report.`,
        method: 'The Item 3.D section is sliced by its heading ("D. Risk Factors", or the bare '
          + 'chapter title when the filer drops the letter) and the set-off headings inside are '
          + 'kept verbatim — the same formatting-driven read as the 10-K path, but against a '
          + 'structure it has covered for far less time, which is what the red warning marks. '
          + 'The whole filing stays linked so coverage can be checked against it.',
      };
    case 'webagg': {
      const a = web?.aggregate;
      return {
        claim: a
          ? `The web's analyst consensus: ${a.label} — ${a.score5.toFixed(2)} on the 1–5 scale, the mean of ${a.of} aggregators.`
          : 'The web\'s analyst consensus — too few aggregators scored for one just now.',
        method: 'Seven public aggregators are read live per ticker (cached '
          + `${web?.ttlMinutes ?? 15} minutes). Each source's rating is normalised onto the 1–5 `
          + 'scale by the rule its own row states, then averaged UNWEIGHTED: the aggregators '
          + 'largely count the same sell-side analysts, so weighting by analyst count would '
          + 'double-count the big houses. A source that does not answer is excluded and says so — '
          + 'it is never scored as neutral.',
      };
    }
    case 'webrating': {
      const s = web?.sources?.find((x) => x.id === sel.id);
      return {
        claim: s?.ok
          ? `${s.name} says ${s.sourceLabel || '—'}${Number.isFinite(s.score5) ? ` — ${s.score5.toFixed(2)} on 1–5` : ''}${s.analysts ? `, from ${s.analysts} analysts` : ''}.`
          : `${s?.name || sel.id} did not answer${s?.why ? ` — ${s.why}` : ''}.`,
        method: s?.ok
          ? `Read live from ${s.name} at ${String(s.fetchedAt || '').slice(0, 16).replace('T', ' ')} UTC. `
            + `Normalisation: ${s.basis}. An aggregator of sell-side opinion, not a primary document.`
          : 'The fetch failed, and a failed fetch is reported, never substituted.',
      };
    }
    default:
      return { claim: sel.claim || '', method: '' };
  }
}

/** The traced rows for one selection — primary document first. */
export function sourcesFor(sel, d, web) {
  if (!sel || !d) return [];
  switch (sel.kind) {
    case 'webagg':
      return (web?.sources || []).flatMap(webSourceRows);
    case 'webrating':
      return webSourceRows(web?.sources?.find((x) => x.id === sel.id));
    case 'risk':
      return [
        ...filingRow(d.company?.risks?.filing, 'Item 1A'),
        ...indexRows(d),
        newsSource(d.ticker, sel.text),
      ];
    case 'update':
      return [
        ...filingRow(d.company?.update?.filing, 'Part II Item 1A'),
        ...indexRows(d),
        ...(sel.affirm ? [] : [newsSource(d.ticker, sel.text)]),
      ];
    case 'catalyst':
      return [...intelRows(d), newsSource(d.ticker, sel.event, sel.date)];
    case 'guidance': {
      const c = d.company?.catalysts;
      return [...intelRows(d),
        newsSource(d.ticker, `${c?.quarter || ''} guidance`.trim(), c?.reportDate)];
    }
    case 'consensus':
      return [
        { type: 'On this machine', label: 'insider.duckdb — estimates',
          detail: 'IBES via Princeton\'s synthetic sample, point-in-time per announcement. As current as the last pull.',
          url: null },
        ...indexRows(d).filter((r) => r.type === 'Live feed'),
      ];
    case 'story': {
      const q = d.street?.queries?.[sel.which];
      return [
        ...(sel.item?.url ? [{ type: 'News search',
          label: `Open the story — ${sel.item.source || 'publisher'}`, url: sel.item.url }] : []),
        ...(q ? [{ type: 'News search', label: 'The search that surfaced it', url: q }] : []),
        newsSource(d.ticker, sel.item?.title || '', sel.item?.date),
      ];
    }
    case 'foreign':
      return [
        ...filingRow(d.company?.foreignAnnual, 'annual report — risk factors in Item 3.D'),
        ...indexRows(d),
      ];
    default:
      return [];
  }
}

/** The no-selection view: every source this surface relies on, de-duped by
 *  url, the surface's filings first and the registry's derived/local rows
 *  after. */
export function defaultRows(d, registryEntries = [], web = null) {
  const c = d?.company?.catalysts;
  const rows = [
    // one row per web aggregator that answered — the reader's page, not the endpoint
    ...(web?.sources || []).filter((s) => s.ok && s.url).map((s) => ({
      type: 'Live feed', label: `${s.name} — analyst consensus, read live`, url: s.url })),
    ...filingRow(d?.company?.risks?.filing,
      d?.company?.risks?.filing?.form === '20-F' ? 'Item 3.D risk factors' : 'Item 1A risk factors'),
    ...filingRow(d?.company?.update?.filing, 'Part II Item 1A, the quarterly risk statement'),
    ...filingRow(d?.company?.foreignAnnual, 'annual report — risk factors in Item 3.D'),
    ...filingRow(c?.sources?.tenQ, 'behind the earnings intel', false),
    ...filingRow(c?.sources?.tenK, 'behind the earnings intel', false),
    ...(c?.sources?.ir ? [{ type: 'Investor page',
      label: 'Investor relations — the company\'s own calendar and releases', url: c.sources.ir }] : []),
    ...indexRows(d),
    ...registryRows(registryEntries),
  ];
  const seen = new Set();
  return rows.filter((r) => {
    if (!r.url) return true;
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

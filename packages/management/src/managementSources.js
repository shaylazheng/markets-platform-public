/* Source composition for the Management surface — the pure half of the source
 * inspector.
 *
 * Kept out of the component for the same reason peerSources.js is: deciding
 * which documents back a claim is logic, and logic inside a render body can
 * only be checked by looking at pixels. Everything here takes data and returns
 * data.
 *
 * The claims this surface makes are unusual in one way: the roster is a
 * BY-PRODUCT. There is no SEC endpoint for "who are the officers" — the list
 * is folded out of Forms 3/4/5 reportingOwner blocks, so every person-level
 * claim traces to the ownership filings that happened to name them, and the
 * honesty flags (lower-bound tenure, censored starts) are part of the claim,
 * not a footnote to it.
 */
import { fmtDate, filingIndexUrl, registryRows } from '@markets/shell/lib/sourceRows.js';
import { moneyShort } from '@markets/shell/lib/format.js';

const shares = (n) => (n == null ? '—' : Number(n).toLocaleString());
const signedMoney = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${moneyShort(Math.abs(v))}`;

/* The tenure sentence, in the same words as the roster's tooltips — the
   inspector must not soften a claim the cell already hedges. */
function tenureClaim(p) {
  if (p.since && p.tenureYears == null) {
    return `Only one ownership filing of theirs was read (${p.since}), so there is no span to `
      + 'measure — an unmeasured tenure, not a short one.';
  }
  if (p.since) {
    return p.tenureIsLowerBound
      ? `At least ${p.tenureYears.toFixed(1)} years: Form 3 filed ${p.since}, last ownership `
        + `filing read ${p.until} — a LOWER BOUND, since they may have stayed longer without trading.`
      : `${p.tenureYears.toFixed(1)} years since the Form 3 filed ${p.since} — the filing made `
        + 'on becoming an insider, so it is the appointment.';
  }
  return `On the roster since at least ${p.seenSince}: no Form 3 within the filings read, so the `
    + 'appointment date is earlier than that and unknown.';
}

const ROSTER_METHOD = 'The roster is folded from Forms 3/4/5 reportingOwner blocks by CIK. There '
  + 'is no SEC endpoint for "who are the officers" — this is the only machine-readable statement '
  + 'of the fact, and it is a by-product of insider-trading disclosure, not a purpose-built feed.';

const screenerRow = (data, name) => ({
  type: 'Platform',
  label: "Open this person's filings in the screener",
  url: `#insider&ticker=${encodeURIComponent(data.ticker)}&insider_name=${encodeURIComponent(name)}`,
});

const ownershipFormsRow = (data) => (data.sources?.ownershipForms ? [{
  type: 'SEC filing',
  label: `Forms 3, 4 and 5 on EDGAR — ${data.ticker}`,
  detail: data.coverage
    ? `${data.coverage.ownershipFilingsRead} of ${data.coverage.ownershipFilingsTotal} read`
    : null,
  url: data.sources.ownershipForms,
}] : []);

/* Each filing that named this person, as a truth row. The payload carries
   accession numbers, not urls — the index page is built client-side. */
const evidenceRows = (data, p) => {
  const seen = new Set();
  const out = [];
  for (const e of p.evidence || []) {
    if (!e.accn || seen.has(e.accn)) continue;
    seen.add(e.accn);
    out.push({ type: 'SEC filing', truth: true,
      label: `${e.form}, ${fmtDate(e.filed)}`, detail: e.accn,
      url: filingIndexUrl(data.cik, e.accn) });
  }
  return out;
};

/* Recent-trade filings as truth rows — these already carry their own urls. */
const tradeRows = (p, since) => {
  const seen = new Set();
  const out = [];
  for (const x of p.trades?.recent || []) {
    if (!x.url || seen.has(x.url)) continue;
    if (since && (x.date || x.filed || '') < since) continue;
    seen.add(x.url);
    out.push({ type: 'SEC filing', truth: true,
      label: `${x.form || '4'}, ${fmtDate(x.filed || x.date)} — ${x.label || 'Table I transaction'}`,
      url: x.url });
  }
  return out;
};

/**
 * Every selectable thing on the surface reduces to the graph inspector's three
 * questions: what is claimed, how was it arrived at, and — via the rows —
 * which documents back it.
 */
export function describe(sel, data) {
  if (!sel || !data) return null;
  switch (sel.kind) {
    case 'person': {
      const p = sel.p;
      return {
        claim: `${p.name} — ${p.title || 'title not stated in the filings read'}, per their own `
          + `ownership filings for ${data.name}. ${tenureClaim(p)}`,
        method: ROSTER_METHOD,
      };
    }
    case 'window': {
      const p = sel.p;
      const w = p.window;
      const days = data.window?.days ?? 60;
      if (!w || !w.trades) {
        return {
          claim: `No ownership filing from ${p.name} in the last ${days} days.`,
          method: 'A dash, not a zero: "did nothing" and "we have no record" look identical as 0 '
            + 'and are not the same claim, so the cell declines rather than counts.',
        };
      }
      const dollars = w.openMarketTrades
        ? `net ${signedMoney(w.netValue)} across ${w.openMarketTrades} open-market trade${w.openMarketTrades === 1 ? '' : 's'}`
        : 'no open-market trade — the filings in the window are grants, withholdings or exercises, which carry no decision';
      const pct = w.ownPct == null
        ? 'no directly-held share change stated'
        : `directly-held shares ${w.sharesStart.toLocaleString()} → ${w.sharesEnd.toLocaleString()} (${w.ownPct > 0 ? '+' : ''}${w.ownPct.toFixed(1)}%)`;
      return {
        claim: `${p.name}, last ${days} days: ${dollars}; ${pct}.`,
        method: 'Two measures on purpose. Dollars are open-market ONLY — a grant is not a decision '
          + 'and a tax withholding is not a sale, so folding either in would report someone who '
          + 'bought and sold nothing as having moved six figures. The percentage is the change in '
          + 'directly-held shares, grants included, because a grant genuinely changes what they own.',
        note: data.window?.covered === false
          ? 'More ownership filings were made in this window than the pipeline reads, so these figures are a floor, not a total.'
          : null,
      };
    }
    case 'movement': {
      const p = sel.p;
      const t = p.trades;
      if (!t?.hasAny) {
        return {
          claim: `No Table I share movement in the filings read for ${p.name}.`,
          method: ROSTER_METHOD,
        };
      }
      const om = t.openMarket;
      return {
        claim: `${p.name}: ${om.trades
          ? `${om.boughtShares ? `${shares(om.boughtShares)} shares bought` : 'nothing bought'} and `
            + `${om.soldShares ? `${shares(om.soldShares)} sold` : 'nothing sold'} on the open market, `
            + `net ${signedMoney(t.netOpenMarket)}`
          : 'no open-market trade in the filings read'}; `
          + `${t.comp.received ? `${shares(t.comp.received)} shares received as compensation` : 'no compensation shares recorded'}.`,
        method: 'Split by what the transaction MEANS: open-market trades are decisions made with '
          + 'the person\'s own money, grants and withholdings are payroll paid in stock, and the '
          + 'two are never netted.'
          + (t.jointFilings > 0
            ? ` ${t.jointFilings} joint filing${t.jointFilings === 1 ? ' is' : 's are'} counted but `
              + 'their shares are kept out of every total — a Form 4 naming several related parties '
              + 'reports trades made collectively, and the honest attribution is unknown.'
            : ''),
      };
    }
    case 'turnover': {
      const t = sel.t;
      return {
        claim: `8-K Item 5.02 filed ${fmtDate(t.filed)}`
          + (t.alsoFinancial ? ', reported alongside results.' : '.'),
        method: 'From the submissions index\'s own 8-K `items` field, filtered to Item 5.02. The '
          + 'sub-item — arrival or departure — is not in the index, so it is not inferred; the '
          + 'filing is linked rather than guessed at.',
      };
    }
    case 'bio': {
      const p = sel.person;
      const bio = sel.bio;
      return {
        claim: `${p.name}${p.title ? `, ${p.title}` : ''} — where they were before this role.`,
        method: bio?.kind === 'proxy'
          ? 'Quoted verbatim from the proxy. The passage is checked to be a word-for-word substring '
            + 'of the filing before it is shown, and an answer that fails that check is discarded '
            + 'whole rather than displayed with a caveat.'
          : 'From Wikipedia, used only because the proxy carried no career history for them — and '
            + 'only because the article names this company independently, the check that stops a '
            + 'namesake being presented as this person.',
      };
    }
    case 'doc': {
      const doc = sel.doc;
      return {
        claim: `${doc.form} filed ${fmtDate(doc.filed)}.`,
        method: sel.which === 'proxy'
          ? 'Compensation, board independence and committee seats live here — as prose and as '
            + '`ecd:` inline XBRL that SEC\'s companyfacts API does not aggregate, so the document '
            + 'is linked rather than parsed.'
          : 'The latest annual report on the registrant\'s own filing index.',
      };
    }
    default:
      return { claim: sel.claim || '', method: '' };
  }
}

/** All source rows for a selection. */
export function sourcesFor(sel, data) {
  if (!sel || !data) return [];
  switch (sel.kind) {
    case 'person':
      return [
        ...evidenceRows(data, sel.p),
        ...ownershipFormsRow(data),
        screenerRow(data, sel.p.name),
      ];
    case 'window': {
      const traded = tradeRows(sel.p, data.window?.since);
      return [
        ...(traded.length ? traded : evidenceRows(data, sel.p)),
        screenerRow(data, sel.p.name),
      ];
    }
    case 'movement':
      return [
        ...tradeRows(sel.p),
        ...ownershipFormsRow(data),
        screenerRow(data, sel.p.name),
      ];
    case 'turnover':
      return [
        { type: 'SEC filing', truth: true, label: `8-K, ${fmtDate(sel.t.filed)}`,
          detail: sel.t.accn, url: sel.t.url },
        ...(data.sources?.edgarAll ? [{ type: 'SEC filing',
          label: `All ${data.ticker} filings on EDGAR`, url: data.sources.edgarAll }] : []),
      ];
    case 'bio':
      return sel.bio?.source?.url ? [{
        type: sel.bio.kind === 'proxy' ? 'SEC filing' : 'Recorded',
        truth: sel.bio.kind === 'proxy',
        label: sel.bio.source.label,
        url: sel.bio.source.url,
      }] : [];
    case 'doc':
      return [{ type: 'SEC filing', truth: true,
        label: `${sel.doc.form}, ${fmtDate(sel.doc.filed)}`,
        detail: sel.doc.accn || null, url: sel.doc.url }];
    default:
      return [];
  }
}

/**
 * The no-selection view: every source this surface relies on, truth-first —
 * the payload's own documents and feeds, then the registry's derived/method
 * rows so the two lists cannot drift apart.
 */
export function defaultRows(data, registryEntries = []) {
  if (!data) return [];
  const out = [];
  if (data.documents?.proxy) {
    out.push({ type: 'SEC filing', truth: true,
      label: `${data.documents.proxy.form} filed ${fmtDate(data.documents.proxy.filed)}`,
      detail: data.documents.proxy.accn || null, url: data.documents.proxy.url });
  }
  if (data.documents?.annual) {
    out.push({ type: 'SEC filing', truth: true,
      label: `${data.documents.annual.form} filed ${fmtDate(data.documents.annual.filed)}`,
      detail: data.documents.annual.accn || null, url: data.documents.annual.url });
  }
  out.push(...ownershipFormsRow(data));
  if (data.sources?.submissions) {
    out.push({ type: 'Live feed',
      label: 'SEC submissions index — filing list and 8-K item codes',
      detail: 'SEC submissions JSON', url: data.sources.submissions });
  }
  out.push(...registryRows(registryEntries));
  return out;
}

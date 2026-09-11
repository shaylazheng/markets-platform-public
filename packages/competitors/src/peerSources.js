/* Source composition for the Competitors surface — the pure half of the source
 * inspector.
 *
 * Kept out of the component for the same reason web/src/graph/sidebar.jsx keeps
 * `srcsFor` as a standalone function: deciding which documents back a claim is
 * logic, and logic that lives inside a render body can only be checked by
 * looking at pixels. Everything here takes data and returns data.
 *
 * A source row is { type, label, url, truth }. `truth` means a PRIMARY
 * document — the filing the number was actually tagged in, not a search that
 * would find one. The inspector renders truth rows above the rest under their
 * own heading, exactly as the graph's does, so the two surfaces make the same
 * distinction in the same place.
 */

/* The generic half — the row vocabulary, date/frame formatters, and the
   provenance-payload readers — moved to the shell when every Company surface
   adopted the inspector (shell/lib/sourceRows.js). Re-exported here so this
   module stays the one import a competitors component needs. */
import {
  companySources, fmtDate, fmtFrame, metricSources, metricTraces, newsSource,
  TYPE_ORDER,
} from '@markets/shell/lib/sourceRows.js';

export {
  companySources, fmtDate, fmtFrame, metricSources, metricTraces, newsSource,
  TYPE_ORDER,
};

const SUGGEST_METHOD = {
  '10-K co-mention': 'Named as a competitor in this company’s own 10-K, found by a machine scan of the filing text. The strongest of the peer signals.',
  'named by their 10-K': 'The OTHER company’s 10-K names this one as a competitor. Competition is symmetric but disclosure is not — NVDA’s 10-K names suppliers and customers, while AMD’s names NVDA seven times.',
  'earnings call': 'The company called it a competitor or rival on an earnings call, per the researched earnings intel.',
};

/**
 * Every selectable thing on the surface reduces to the three questions the
 * graph's inspector asks: what is claimed, how was it arrived at, and — via
 * the source rows — which documents back it.
 */
export function describe(sel, prov) {
  const t = sel.ticker;
  switch (sel.kind) {
    case 'metric':
      return {
        claim: `${sel.metric.label} for ${t} is ${sel.display} on the ${fmtFrame(sel.frame)} ${sel.basis === 'annual' ? 'annual' : 'trailing-twelve-month'} basis.`,
        method: sel.value == null
          ? 'Not computed. The inputs below are what it would have been built from.'
          : `Computed from SEC XBRL facts — ${prov?.metricInputs?.[sel.metric.id]?.market ? 'company filings plus a share price' : 'company filings only'}. Nothing here is researched or estimated.`,
      };
    case 'company':
      return {
        claim: `${sel.row?.meta?.name || t} — every figure in this row is drawn from ${t}'s own SEC filings on the ${fmtFrame(sel.frame)} basis.`,
        method: 'Pulled automatically from SEC XBRL. No LLM, no third-party data vendor.',
      };
    case 'peer':
      return {
        claim: `${sel.suggestion.ticker}${sel.suggestion.name ? ` (${sel.suggestion.name})` : ''} was suggested as a peer of ${sel.focal} — ${sel.suggestion.source}${sel.suggestion.count ? `, seen ${sel.suggestion.count}×` : ''}.`,
        method: SUGGEST_METHOD[sel.suggestion.source]
          || (String(sel.suggestion.source).startsWith('SIC')
            ? 'Same SEC industry classification. Breadth only — a shared SIC code is not a claim that the two compete.'
            : 'Suggested by the peer layer.'),
      };
    case 'insider': {
      const f = sel.flow;
      const caveats = [];
      if (f.plannedSells) {
        caveats.push(`${f.plannedSells} of the ${f.sells} sales were filed under a 10b5-1 plan — scheduled months ahead, so they express no view. That flag only enters the schema around 2023, so an older window undercounts it.`);
      }
      if (f.ceoCfoBuys) {
        caveats.push(`${f.ceoCfoBuys} of the purchases were by a CEO or CFO, the strongest form of the signal.`);
      } else if (f.tenPctBuys && f.tenPctBuys === f.buys) {
        caveats.push('Every purchase was by a 10% holder, which is closer to a position adjustment than to an insider view.');
      }
      if (f.medianBuyDeltaOwn != null) {
        caveats.push(`The median purchase raised that insider's own holding by ${f.medianBuyDeltaOwn.toFixed(1)}% — conviction relative to what they already owned, which a dollar figure alone does not show.`);
      }
      if (f.truncated) caveats.push('This company hit the row cap: its totals are a floor, not a count.');
      return {
        claim: `${t}: ${f.buys} open-market purchase${f.buys === 1 ? '' : 's'} and ${f.sells} sale${f.sells === 1 ? '' : 's'} over ${sel.days} days, net ${f.netValue < 0 ? '−' : '+'}$${Math.abs(Math.round(f.netValue || 0)).toLocaleString()}.`,
        method: `From this platform's own Form 4 database. Counts DISTINCT FILINGS, so one joint filing by several affiliates is one decision, not several — independence is the whole content of a cluster. A filing counts as a purchase if ANY of its lines is one. The other ${f.other ?? 0} filing${f.other === 1 ? '' : 's'} in the window are option exercises, tax withholding, gifts and awards: real filings, but not directed trades, so they are excluded from the net.`
          + (caveats.length ? ` ${caveats.join(' ')}` : ''),
      };
    }
    case 'record':
      return {
        claim: `${t}: mean return after each of ${sel.record.purchases} insider purchase${sel.record.purchases === 1 ? '' : 's'} between ${fmtDate(sel.record.first)} and ${fmtDate(sel.record.last)}.`,
        method: 'Forward returns are stored per transaction by prices.materialise_returns(), off this platform’s own price history — CRSP via synthetic sample through 2025-12-31, yfinance after. They are RAW: not market-relative and not sector-relative, so a positive figure in a rising year is not outperformance. Each observation is one filing, never one owner.',
      };
    case 'news':
      return {
        claim: sel.item.title,
        method: `Picked up by the platform's signal poller from ${sel.item.channel}. Headline text is the publisher's, not this platform's.`,
      };
    case 'price':
      return {
        claim: `Relative price for ${sel.tickers.join(', ')}, rebased to 100 at ${fmtDate(sel.anchor)}.`,
        method: 'Daily closes from this platform’s price history — CRSP via synthetic sample through 2025-12-31, yfinance after. Rebased at the first date every peer trades, so a later-listed peer cannot start the series.',
      };
    default:
      return { claim: sel.claim || '', method: '' };
  }
}

/** Source rows for the selections that need no provenance fetch. */
export function localSources(sel) {
  switch (sel.kind) {
    case 'peer': {
      const s = sel.suggestion;
      const out = [];
      if (String(s.source).includes('10-K')) {
        out.push({ type: 'SEC filing', truth: true,
          label: '10-K filings naming both companies (how this link was found)',
          url: `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(`"${sel.focal}" "${s.ticker}"`)}&forms=10-K` });
      }
      out.push({ type: 'SEC filing', label: `All ${s.ticker} filings on EDGAR`,
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${encodeURIComponent(s.ticker)}&type=10-K` });
      out.push(newsSource(sel.focal, `${s.ticker} competitor`));
      return out;
    }
    case 'insider':
    case 'record':
      return [
        { type: 'SEC filing', truth: true, label: `Every ${sel.ticker} Form 4 on EDGAR`,
          url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${encodeURIComponent(sel.ticker)}&type=4&dateb=&owner=include&count=40` },
        { type: 'Platform', label: 'Open these filings in the insider screener',
          url: `#insider&ticker=${sel.ticker}` },
        ...(sel.kind === 'record' ? [{ type: 'Platform',
          label: 'Purchases only, in the screener',
          url: `#insider&ticker=${sel.ticker}&trade_type=P` }] : []),
      ];
    case 'news':
      return [
        { type: sel.item.channel === 'filing' ? 'SEC filing' : 'News search',
          truth: sel.item.channel === 'filing',
          label: `Open the original — ${sel.item.channel}`, url: sel.item.url },
        newsSource(sel.item.ticker, sel.item.title, sel.item.ts),
      ];
    case 'price':
      return [
        { type: 'Market data', truth: true,
          label: 'Price history behind this chart — CRSP via synthetic sample, then yfinance',
          url: `https://finance.yahoo.com/quote/${sel.tickers[0]}/history/` },
      ];
    default:
      return [];
  }
}

/** All source rows for a selection, provenance-backed or not. */
export function sourcesFor(sel, prov) {
  if (!sel) return [];
  if (sel.kind === 'metric') return metricSources(prov, sel.metric.id, sel.ticker);
  if (sel.kind === 'company') return companySources(prov);
  return localSources(sel);
}

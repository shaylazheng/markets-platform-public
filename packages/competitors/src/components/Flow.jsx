/* Insider pulse and peer newswire — the two panels that exist because this
 * platform already holds data nothing else does.
 */
import { money, pct } from '@markets/insider/insider.js';

/* The statistics the insider-feed project actually reads a company by, rather
 * than the headline dollar figure alone. Each is here because it changes the
 * reading of the same net number:
 *
 *   role       A CEO or CFO buying is the strongest form of the signal; a
 *              10%-holder adding to a position is close to the weakest.
 *   planned    A 10b5-1 sale was scheduled months earlier and carries no view
 *              at all. At a large issuer most selling is planned, which is why
 *              "insiders sold $1.4bn" on its own is close to meaningless.
 *   Δ own      How much the insider's OWN stake moved. A director adding 40%
 *              to their holding is a different claim from one spending $200k.
 *   delay      Trade date to filing date. Two days is the statutory norm; a
 *              long delay is worth noticing.
 */
const StatLine = ({ v }) => {
  const bits = [];
  if (v.buys) {
    const who = [];
    if (v.ceoCfoBuys) who.push(`${v.ceoCfoBuys} CEO/CFO`);
    else if (v.officerBuys) who.push(`${v.officerBuys} officer`);
    if (v.tenPctBuys) who.push(`${v.tenPctBuys} 10%-holder`);
    bits.push(
      <span key="b" className="cmp-stat is-buy" title="Open-market purchases, counted per filing">
        {v.buys} buy{v.buys === 1 ? '' : 's'}{who.length ? ` · ${who.join(', ')}` : ''}
      </span>);
    if (v.medianBuyDeltaOwn != null) {
      bits.push(
        <span key="d" className="cmp-stat"
              title="Median increase in the buying insider's own holding — conviction, not dollars">
          median +{v.medianBuyDeltaOwn.toFixed(1)}% to their stake
        </span>);
    }
  }
  if (v.sells) {
    bits.push(
      <span key="s" className="cmp-stat"
            title="Open-market sales, counted per filing">
        {v.sells} sell{v.sells === 1 ? '' : 's'}
        {v.ceoCfoSells ? ` · ${v.ceoCfoSells} CEO/CFO` : ''}
      </span>);
    if (v.plannedSells) {
      bits.push(
        <span key="p" className="cmp-stat is-muted"
              title="Filed under a 10b5-1 plan: scheduled in advance, so it expresses no view. Only tagged from ~2023, so older windows undercount.">
          {v.plannedSells} of {v.sells} pre-scheduled
        </span>);
    }
  }
  if (v.medianFilingDelayDays != null && v.medianFilingDelayDays > 2) {
    bits.push(
      <span key="l" className="cmp-stat is-muted" title="Median days from trade to filing; two is the statutory norm">
        filed +{v.medianFilingDelayDays}d
      </span>);
  }
  if (!bits.length) return null;
  return <div className="cmp-statline">{bits}</div>;
};

/* Net Form 4 flow per peer. Buys sit above the baseline and sells below, so
 * POSITION is the primary channel and --up/--down is redundant reinforcement:
 * the two hues measure dE 7.6-7.9 deutan, inside the floor band where colour
 * alone is not legal. The signed value is printed on every row as the second
 * secondary channel.
 */
export function InsiderPulse({ data, focal, days, setView, onSelect, selected }) {
  if (!data) return <div className="cmp-empty"><span className="loading">Loading Form 4 flow…</span></div>;
  const entries = Object.entries(data);
  if (!entries.length) {
    return <div className="cmp-empty">No Form 4 filings for this peer set in the last {days} days.</div>;
  }
  /* A genuinely quiet window is the common case once the date filter actually
     works -- insiders at most companies do nothing for months at a time. Rows
     of zero-width bars reading "+$0" look like a broken panel rather than the
     real answer, so say it in words. */
  const directed = entries.reduce((n, [, v]) => n + v.buys + v.sells, 0);
  if (!directed) {
    return (
      <div className="cmp-empty">
        No open-market buying or selling by insiders at any of these companies in
        the last {days} days.
        {entries.some(([, v]) => v.other > 0) && (
          <> There were {entries.reduce((n, [, v]) => n + v.other, 0)} other Form 4
          filings — option exercises, tax withholding, grants and gifts — which are
          not directed trades.</>
        )}
      </div>
    );
  }
  const max = Math.max(...entries.map(([, v]) => Math.abs(v.netValue || 0)), 1);

  return (
    <div className="cmp-pulse">
      {entries.sort((a, b) => (b[1].netValue || 0) - (a[1].netValue || 0)).map(([t, v]) => {
        const net = v.netValue || 0;
        const pct = Math.min(100, (Math.abs(net) / max) * 100);
        const isSel = selected?.kind === 'insider' && selected.ticker === t;
        return (
          <div key={t} className={'cmp-pulse-row' + (t === focal ? ' is-focal' : '')
                                  + (isSel ? ' is-sel' : '')}>
            <button type="button" className="cmp-tk"
                    title={`${t} — open the insider screener`}
                    onClick={() => {
                      history.replaceState(null, '', `#insider&ticker=${t}`);
                      setView('insider');
                    }}>{t}</button>
            <div className="cmp-pulse-track">
              <span className={'cmp-pulse-bar ' + (net >= 0 ? 'up' : 'down')}
                    style={{ width: `${pct}%` }} />
            </div>
            <span className={'cmp-pulse-val ' + (net >= 0 ? 'up' : 'down')}>
              {net >= 0 ? '+' : '−'}{money(Math.abs(net))}
            </span>
            {/* Directed decisions only. `distinctFilings` counts every Form 4 in
                the window, most of which are awards and tax withholding — quoting
                it alone made a routine quarter look like 175 trades. */}
            <span className="cmp-pulse-n"
                  title={`${v.buys + v.sells} directed trade${v.buys + v.sells === 1 ? '' : 's'} of ${v.distinctFilings} distinct filings; the other ${v.other ?? 0} are exercises, withholding, gifts and awards`}>
              {v.buys + v.sells}/{v.distinctFilings}
            </span>
            <button type="button" className="si-srcbtn" aria-pressed={isSel}
                    title={`Where this ${t} flow comes from`}
                    onClick={() => onSelect?.({ kind: 'insider', ticker: t, flow: v, days })}>src</button>
            <StatLine v={v} />
          </div>
        );
      })}
      <div className="cmp-asof">
        net insider buying minus selling over {days} days · counts distinct filings,
        so one joint filing by several affiliates is one decision · the ratio is
        directed trades (P/S) out of all Form 4 filings in the window
        {entries.some(([, v]) => v.truncated) && (
          <> · <b>some companies hit the row cap; their totals are a floor, not a count</b></>
        )}
      </div>
    </div>
  );
}

/* What happened AFTER insiders bought, at this company.
 *
 * The payoff question the flow panel cannot answer, and the reason
 * prices.materialise_returns() stores r1d/r1w/r1m/r6m on every transaction.
 *
 * Three honesty constraints shape how it renders, all of them about not letting
 * a small sample read as a finding:
 *
 *  - `n` sits beside every figure. Micron has ONE purchase in five years and it
 *    is +191% at six months; as a statistic that is nothing at all, and the
 *    layout must not let it look like Intel's 35.
 *  - Below four observations the mean is greyed and the hit rate is what leads,
 *    because a mean over three trades is one outlier from anything.
 *  - Returns are RAW. Not market-relative, not sector-relative. A +8% six-month
 *    mean in a year the index rose 10% is underperformance, and the footer says
 *    so rather than letting the green fill imply otherwise.
 */
const HORIZONS = [['r1w', '1 week'], ['r1m', '1 month'], ['r6m', '6 months']];
const MIN_N = 4;

export function InsiderRecord({ state, focal, years, open, onToggle, onSelect, selected }) {
  const rows = Object.entries(state.data?.tickers || {})
    .filter(([, v]) => v.purchases > 0)
    .sort((a, b) => b[1].purchases - a[1].purchases);

  return (
    <div className="cmp-record">
      <button type="button" className="cmp-record-head" aria-expanded={open} onClick={onToggle}>
        <span>After insider buys — forward returns, {years}y</span>
        <span className="cmp-record-caret">{open ? '▾' : '▸'}</span>
      </button>
      {!open && (
        <div className="cmp-record-hint">
          Whether buying by insiders at these companies has been followed by anything.
        </div>
      )}
      {open && state.loading && (
        <div className="cmp-empty"><span className="loading">Scanning {years} years of purchases…</span></div>
      )}
      {open && !state.loading && !rows.length && (
        <div className="cmp-empty">
          No open-market purchases by insiders at any of these companies in {years} years.
          At large issuers that is normal — selling is routine, buying is rare.
        </div>
      )}
      {open && !state.loading && rows.length > 0 && (
        <>
          <table className="cmp-rec-tbl">
            <thead>
              <tr>
                <th scope="col">·</th>
                <th scope="col" title="Distinct purchase filings in the window">buys</th>
                {HORIZONS.map(([, label]) => <th key={label} scope="col">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(([t, v]) => (
                <tr key={t} className={t === focal ? 'is-focal' : ''}>
                  <th scope="row">
                    <button type="button" className="cmp-tk"
                            aria-pressed={selected?.kind === 'record' && selected.ticker === t}
                            title={`How this is measured for ${t}`}
                            onClick={() => onSelect?.({ kind: 'record', ticker: t, record: v, years })}>
                      {t}
                    </button>
                  </th>
                  <td className="cmp-rec-n" title={`${v.first} → ${v.last}`}>{v.purchases}</td>
                  {HORIZONS.map(([h]) => {
                    const x = v.horizons?.[h];
                    if (!x?.n) return <td key={h} className="cmp-rec-cell is-none">—</td>;
                    const thin = x.n < MIN_N;
                    return (
                      <td key={h} className={'cmp-rec-cell' + (thin ? ' is-thin' : '')}
                          title={`n=${x.n} · median ${x.median.toFixed(1)}% · positive ${Math.round(x.hit * 100)}% of the time`
                            + (thin ? ` · only ${x.n} observation${x.n === 1 ? '' : 's'} — read the hit rate, not the mean` : '')}>
                        <span className={'cmp-rec-val ' + (x.mean >= 0 ? 'up' : 'down')}>
                          {pct(x.mean, 1)}
                        </span>
                        <span className="cmp-rec-hit">{Math.round(x.hit * 100)}% up</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="cmp-asof">
            mean return after each purchase filing, and how often it was positive ·
            <b> raw, not market-relative</b> — a positive figure in a rising year is not
            outperformance · greyed cells have fewer than {MIN_N} observations, where the
            hit rate says more than the mean
          </div>
        </>
      )}
    </div>
  );
}

/* Per-ticker news from signals.json, which the gateway already polls. This
 * panel never fetches anything of its own: a peer with no signals shows
 * nothing rather than triggering work. */
export function PeerWire({ items, focal, onPickTicker, onSelect, selected }) {
  if (items === null) return <div className="cmp-empty"><span className="loading">Loading the wire…</span></div>;
  if (!items.length) {
    return <div className="cmp-empty">No filings or headlines for this peer set in the last 14 days.</div>;
  }
  return (
    <div className="cmp-wire">
      {items.slice(0, 60).map((s) => (
        <div key={s.id} className={'cmp-wire-row' + (s.hot ? ' is-hot' : '')
                                   + (selected?.kind === 'news' && selected.item?.id === s.id ? ' is-sel' : '')}>
          <button type="button" className={'cmp-tk' + (s.ticker === focal ? ' is-focal' : '')}
                  onClick={() => onPickTicker?.(s.ticker)}>{s.ticker}</button>
          <span className="cmp-wire-ch">{s.channel}</span>
          <a className="cmp-wire-title" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
          <span className="cmp-wire-ts">{s.ts}</span>
          <button type="button" className="si-srcbtn" title="Where this item came from"
                  aria-pressed={selected?.kind === 'news' && selected.item?.id === s.id}
                  onClick={() => onSelect?.({ kind: 'news', ticker: s.ticker, item: s })}>src</button>
        </div>
      ))}
    </div>
  );
}

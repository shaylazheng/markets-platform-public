import { Watchlist } from './components/Watchlist.jsx';
import { FocusChart } from './components/FocusChart.jsx';
import { FeaturedPanel } from './components/FeaturedPanel.jsx';
import { Glance } from './components/Glance.jsx';
import { InsightPanel } from '@markets/shell/components/InsightPanel.jsx';
import { Group } from './components/Group.jsx';
import { WATCHLIST, fmtNum, sliceByTf, windowChange } from '@markets/shell/lib/series.js';
import { useSeries } from '@markets/shell/lib/useSeries.js';
import { useApp } from '@markets/shell/lib/store.jsx';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';

/* What the strip shows once the workspace is collapsed: the symbol you were
   looking at, still live. */
function MarketsSummary() {
  const { symbol, tf, nonce } = useApp();
  const s = WATCHLIST.find((w) => w.id === symbol) || WATCHLIST[0];
  const { data } = useSeries(s.curve ? null : s.id, nonce);
  if (s.curve) return <span className="grp-sym">Treasury yield curve</span>;
  const ch = data ? windowChange(s, sliceByTf(data, tf)) : null;
  return <>
    <span className="grp-sym">{s.id}</span>
    <span className="grp-val">
      {data ? fmtNum(data.values[data.values.length - 1], s.dec ?? 2, s.prefix || '', s.suffix || '') : '—'}
    </span>
    {ch && <span className={'grp-chg ' + ch.dir}>{ch.netStr} ({ch.pctStr}) {tf}</span>}
  </>;
}

/* The look stylesheet places these five panels by grid-area, so the markup
   order here is source order only. */
export function Markets() {
  const { symbol, nonce } = useApp();
  const s = WATCHLIST.find((w) => w.id === symbol) || WATCHLIST[0];
  /* The focal series is what makes this surface look alive, so it is the gate.
     Free to ask for: fetchSeries memoises by id, so this is the same promise
     FocusChart is already awaiting, not a second request. A curve symbol has
     no single series — nothing to wait for. */
  const { data, error } = useSeries(s.curve ? null : s.id, nonce);
  useBootGate('markets', s.curve || !!data || !!error, { what: `${s.id} series` });

  return (
    <section className="view is-active ws ws-markets">
      <Group title="Markets workspace" storageKey="markets" summary={<MarketsSummary />}>
        <div className="col col-left"><FeaturedPanel /><Watchlist /></div>
        <div className="col col-center"><FocusChart /></div>
        <div className="col col-right"><Glance /><InsightPanel /></div>
      </Group>
    </section>
  );
}

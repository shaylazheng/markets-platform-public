/* One panel, seven charts, a switcher.
 *
 * They used to be three charts in three panels spread down a scrolling column,
 * which meant no two were ever comparable — you scrolled past the ranked bars
 * to reach the scatter, and the price chart was a screen below both. Stacking
 * them in one frame costs nothing (only one is ever being read) and buys the
 * room to draw the four that would not have justified a panel of their own.
 *
 * Each chart declares what it needs. `needs: 'prices'` marks the two that read
 * the price series, which comes from the insider service — so when that service
 * is down they say so themselves instead of the deck rendering an empty box.
 *
 * The chosen chart persists per browser, not per company: it is a preference
 * about how you read, not a fact about NVDA.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  DrawdownChart, MetricBars, PeerLegend, ProfileChart,
  QuadrantChart, RelativePrice, RiskReturnChart, SpreadChart,
} from './Charts.jsx';

const CHARTS = [
  { id: 'ranked',   label: 'Ranked',    needs: 'rows',   axes: false,
    title: (m) => `Ranked — ${m?.label || ''}` },
  { id: 'spread',   label: 'Spread',    needs: 'rows',   axes: false,
    title: (m) => `Against the median — ${m?.label || ''}` },
  { id: 'profile',  label: 'Profile',   needs: 'rows',   axes: false,
    title: (m, f) => `Profile — ${f} across every metric` },
  { id: 'position', label: 'Position',  needs: 'rows',   axes: true,
    title: () => 'Position — any two metrics' },
  { id: 'price',    label: 'Price',     needs: 'prices', axes: false,
    title: () => 'Relative price, rebased to 100' },
  { id: 'drawdown', label: 'Drawdown',  needs: 'prices', axes: false,
    title: () => 'Drawdown from running peak' },
  { id: 'risk',     label: 'Risk',      needs: 'prices', axes: true,
    title: () => 'Risk against return' },
];

const KEY = 'cmp:chart';
const AXES_KEY = 'cmp:chartAxes';

function stored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

/* A hook, not a component, and named like one: it calls useState/useEffect and
   hands back four pieces the surface places in three different slots of the
   panel — header switcher, header axis pickers, title, body. A component
   cannot return into three slots. */
export function useChartDeck({
  rows, metrics, metric, focal, spotlight, palette, prices, onSelect,
}) {
  const [id, setId] = useState(() => {
    /* `?chart=profile` wins over stored state, for the same reason `?look=`
       does: a headless screenshot runs on a fresh profile with no localStorage,
       so without it every shot of the deck is the Ranked chart. */
    try {
      const q = new URLSearchParams(location.search).get('chart');
      if (CHARTS.some((c) => c.id === q)) return q;
    } catch { /* no location under SSR */ }
    const v = stored(KEY, 'ranked');
    return CHARTS.some((c) => c.id === v) ? v : 'ranked';
  });
  const [axes, setAxes] = useState(() => stored(AXES_KEY,
    { x: 'revenueGrowth', y: 'operatingMargin' }));

  const pick = useCallback((next) => {
    setId(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const setAxis = useCallback((which, value) => setAxes((a) => {
    const next = { ...a, [which]: value };
    try { localStorage.setItem(AXES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  }), []);

  /* ←/→ walk the deck. Seven charts behind a switcher is only better than seven
     panels if flipping between two of them is cheap; reaching for the mouse
     each time is what made the old three-panel layout tiring. Suppressed in
     inputs — the rail has a ticker box. */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const i = CHARTS.findIndex((c) => c.id === id);
      pick(CHARTS[(i + (e.key === 'ArrowRight' ? 1 : CHARTS.length - 1)) % CHARTS.length].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, pick]);

  const spec = CHARTS.find((c) => c.id === id) || CHARTS[0];
  const priceTickers = prices?.data?.series ? Object.keys(prices.data.series) : [];

  /* Two switchers, one shown at a time by a container query on the panel.
     Seven tab labels need ~430px; the Workspace look gives this panel a 340px
     column, where the strip silently clipped "Drawdown" and "Risk" off the
     right edge — the two charts nobody would ever have found. A native select
     is the honest fallback: same seven options, no width. */
  const switcher = (
    <span className="cmp-deck-switch">
      <select className="cmp-deck-select" value={id} aria-label="Chart"
              onChange={(e) => pick(e.target.value)}>
        {CHARTS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      {/* The price panel used to carry its own `src` button; folding three
          panels into one would have quietly dropped the only affordance that
          says where the price history comes from. */}
      {spec.needs === 'prices' && prices?.data && (
        <button type="button" className="si-srcbtn"
                title="Where this price history comes from"
                onClick={() => onSelect?.({ kind: 'price', ticker: focal,
                                            tickers: priceTickers,
                                            anchor: prices.data.rebaseAnchor })}>src</button>
      )}
      <span className="seg">
        {CHARTS.map((c) => (
          <button key={c.id} type="button"
                  className={c.id === id ? 'is-active' : ''}
                  aria-pressed={c.id === id}
                  onClick={() => pick(c.id)}>{c.label}</button>
        ))}
      </span>
    </span>
  );

  /* Axis pickers only where they mean something. Position takes any two of the
     twelve; Risk's axes are computed from prices and are not a choice. */
  const axisPickers = spec.id === 'position' && metrics?.length ? (
    <span className="cmp-deck-axes">
      {['x', 'y'].map((w) => (
        <label key={w} className="cmp-deck-axis">
          <span>{w}</span>
          <select value={axes[w]} onChange={(e) => setAxis(w, e.target.value)}>
            {metrics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      ))}
    </span>
  ) : null;

  let body;
  if (spec.needs === 'prices' && prices?.error) {
    body = (
      <div className="cmp-empty">
        Price history needs the insider service. Start it with <code>npm run insider</code>.
      </div>
    );
  } else if (spec.needs === 'prices' && !prices?.data) {
    body = <div className="cmp-empty"><span className="loading">Loading prices…</span></div>;
  } else if (spec.needs === 'rows' && !rows.length) {
    body = <div className="cmp-empty">Waiting for data…</div>;
  } else {
    body = (
      <>
        {(spec.needs === 'prices' || spec.id === 'position' || spec.id === 'risk') && (
          <PeerLegend tickers={spec.needs === 'prices' ? priceTickers : rows.map((r) => r.ticker)}
                      focal={focal} spotlight={spotlight} palette={palette} />
        )}
        {spec.id === 'ranked' && (
          <MetricBars rows={rows} metric={metric} focal={focal} palette={palette}
                      onSelect={onSelect} />)}
        {spec.id === 'spread' && (
          <SpreadChart rows={rows} metric={metric} focal={focal} palette={palette} />)}
        {spec.id === 'profile' && (
          <ProfileChart rows={rows} metrics={metrics} focal={focal} palette={palette} />)}
        {spec.id === 'position' && (
          <QuadrantChart rows={rows} metrics={metrics} focal={focal} spotlight={spotlight}
                         palette={palette} xId={axes.x} yId={axes.y} />)}
        {spec.id === 'price' && (
          <RelativePrice prices={prices.data} focal={focal} spotlight={spotlight}
                         palette={palette} />)}
        {spec.id === 'drawdown' && (
          <DrawdownChart prices={prices.data} focal={focal} spotlight={spotlight}
                         palette={palette} />)}
        {spec.id === 'risk' && (
          <RiskReturnChart prices={prices.data} focal={focal} spotlight={spotlight}
                           palette={palette} />)}
      </>
    );
  }

  return { switcher, axisPickers, body, title: spec.title(metric, focal), spec };
}

/* The deck's shape is data, and the surface needs it to decide what to put in
   the panel header, so it is exported rather than re-derived there. */
export { CHARTS };

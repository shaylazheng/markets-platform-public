import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { CURVE_POINTS, WATCHLIST, compute, fmtDate, sliceByTf, windowChange } from '@markets/shell/lib/series.js';
import { fetchSeries } from '@markets/shell/lib/api.js';
import { useSeries } from '@markets/shell/lib/useSeries.js';
import { useApp } from '@markets/shell/lib/store.jsx';
import { useLineChart, chartColors } from '../useChart.js';
import { Panel } from '@markets/shell/components/Panel.jsx';
import { InsightButton } from '@markets/shell/components/InsightButton.jsx';
import { TimeframeRow } from './TimeframeRow.jsx';
import { SymbolPicker } from './SymbolPicker.jsx';

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
/* The readout used to be one dot-joined string in the panel footer:
   "1D +0.02 · 1W -0.01 · 1M +0.08 · YTD -0.26 · 85% of 2023 range · as of
   Aug 7, 2026". Six unrelated facts in one sentence, below the chart, in muted
   ink — so nothing could be found without reading all of it.

   They are stat tiles, not prose: each gets its own labelled cell above the
   chart. Direction is carried by the SIGN as well as the colour, so it survives
   a colourblind reader and a greyscale print. */
function StatCell({ label, value, dir, title }) {
  return (
    <div className="cs-cell" title={title}>
      <div className="cs-label">{label}</div>
      <div className={'cs-value' + (dir ? ' ' + dir : '')}>{value}</div>
    </div>
  );
}

/* The yield curve is a cross-section, not a time series, so it gets its own
   render path rather than being forced through the line-chart hook. */
function CurveChart({ onMeta }) {
  const ref = useRef(null);
  useEffect(() => {
    let chart, alive = true;
    Promise.all(CURVE_POINTS.map((p) => fetchSeries(p.id).then((d) => ({ p, d })).catch(() => null)))
      .then((res) => {
        if (!alive) return;
        const pts = res.filter(Boolean).map(({ p, d }) => ({
          label: p.label, value: d.values[d.values.length - 1], date: d.dates[d.dates.length - 1],
        }));
        if (!pts.length) throw new Error('no data');
        const shape = pts[pts.length - 1].value - pts[0].value;
        onMeta({ inverted: shape < 0, shape, asOf: pts[pts.length - 1].date, pts });
        const c = chartColors();
        chart = new Chart(ref.current, {
          type: 'line',
          data: { labels: pts.map((p) => p.label), datasets: [{
            data: pts.map((p) => p.value), borderColor: c.line, borderWidth: 2,
            pointRadius: 4, pointBackgroundColor: c.line, pointHoverRadius: 6, tension: 0.2, fill: false,
          }] },
          options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: { legend: { display: false },
              tooltip: { backgroundColor: c.tipBg, titleColor: c.ink, bodyColor: c.ink,
                borderColor: c.tipBorder, borderWidth: 1, padding: 10, displayColors: false,
                callbacks: { title: (i) => `${i[0].label} maturity`, label: (i) => `${Number(i.raw).toFixed(2)}%` } } },
            scales: {
              x: { grid: { display: false }, border: { display: false }, ticks: { color: c.tick } },
              y: { position: 'right', grid: { color: c.grid }, border: { display: false },
                ticks: { color: c.tick, callback: (v) => Number(v).toFixed(1) + '%' } },
            },
          },
        });
      })
      .catch(() => alive && onMeta({ error: true }));
    return () => { alive = false; try { chart?.destroy(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <canvas ref={ref} />;
}

function TimeSeriesChart({ s, data, tf }) {
  const ref = useRef(null);
  const sliced = sliceByTf(data, tf);
  const ch = windowChange(s, sliced);
  useLineChart(ref, {
    dates: sliced.dates, values: sliced.values, variant: 'full',
    color: ch && ch.dir === 'down' ? cssVar('--down') : cssVar('--up'),
    yFmt: s.kind === 'pct' ? (v) => Number(v).toFixed(2) + (s.suffix === '%' ? '%' : '') : undefined,
    tipFmt: (v) => String(v),
    deps: [tf],
  });
  return <canvas ref={ref} />;
}

export function FocusChart() {
  const { symbol, tf, setTf, nonce } = useApp();
  const s = WATCHLIST.find((w) => w.id === symbol) || WATCHLIST[0];
  const { data, error } = useSeries(s.curve ? null : s.id, nonce);
  const [curve, setCurve] = useState(null);

  useEffect(() => { setCurve(null); }, [symbol]);

  const c = data ? compute(s, data) : null;
  const ch = data ? windowChange(s, sliceByTf(data, tf)) : null;


  return (
    <Panel id="pnl-chart" swatch="b" flush
      /* The header carried a second copy of the change — "−0.26 pp (−36.11%)"
         for a series, "Inverted / Upward sloping" for the curve — directly
         above the same figures in .chart-meta. Two identical readings a line
         apart invite the reader to check whether they disagree. The one below
         is kept: it sits with the value it belongs to and names its timeframe. */
      headExtra={<SymbolPicker />}
>
      <div className="chart-stage">
        <div className="chart-meta">
          {s.curve ? (
            curve?.error ? <span className="err">Couldn’t load the yield curve.</span>
              : curve ? <>
                  <span className="cm-val">{curve.shape >= 0 ? '+' : '−'}{Math.abs(curve.shape).toFixed(2)} pp</span>
                  <span className={'cm-chg ' + (curve.inverted ? 'down' : 'up')}>{curve.inverted ? 'Inverted' : 'Upward sloping'}</span>
                  <span className="cm-name">U.S. Treasury yield curve · 30Y minus 3M</span>
                </> : <span className="loading">Loading curve…</span>
          ) : error ? <span className="err">Couldn’t load {s.id}: {error.message}</span>
            : c ? <>
                <span className="cm-val">{c.valueStr}</span>
                {ch && <span className={'cm-chg ' + ch.dir}>{ch.netStr} ({ch.pctStr}) {tf}</span>}
                <span className="cm-name">{s.name}</span>
                {s.units && <span className="cm-units">{s.units}</span>}
              </> : <span className="loading">Loading {s.id}…</span>}
        </div>

        {/* The readout, above the plot rather than under it. */}
        <div className="chart-stats">
          {s.curve
            ? (curve && !curve.error ? <>
                {curve.pts.map((pt) => (
                  <StatCell key={pt.label} label={pt.label} value={`${pt.value.toFixed(2)}%`} />
                ))}
                <StatCell label="As of" value={fmtDate(curve.asOf)} />
              </> : null)
            : (c ? <>
                {c.changes.map(([label, x]) => (
                  <StatCell key={label} label={label} value={x.text} dir={x.dir} />
                ))}
                {c.range != null && (
                  <StatCell label="Range" value={`${c.range}%`}
                    title="Where the latest value sits in its 2023-to-now range" />
                )}
                <StatCell label="As of" value={fmtDate(c.latestDate)} />
              </> : null)}
        </div>

        <div className="chart-main">
          {s.curve ? <CurveChart key="curve" onMeta={setCurve} />
            : data ? <TimeSeriesChart key={s.id} s={s} data={data} tf={tf} /> : null}
        </div>

        <InsightButton
          id={'chart:' + s.id}
          title={s.curve ? 'U.S. Treasury yield curve' : s.name}
          meta={s.curve ? 'Yield curve · 3M to 30Y' : `${s.section} · ${s.id}`}
          payload={() => (s.curve
            ? { kind: 'chart', chart: { id: 'yield-curve', name: 'U.S. Treasury yield curve (3M to 30Y)', section: 'Yield curve' } }
            : { kind: 'chart', chart: {
                id: s.id, name: s.name, section: s.section,
                latest: c?.valueStr, date: c ? fmtDate(c.latestDate) : undefined, trend: c?.trend.text,
              } })} />

        {/* Controls only — the numbers moved above the plot. */}
        <div className="chart-foot">
          {!s.curve && <TimeframeRow value={tf} onChange={setTf} />}
        </div>
      </div>
    </Panel>
  );
}

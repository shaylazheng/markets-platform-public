/* The three charts. Each follows FocusChart.jsx's CurveChart pattern rather
 * than useLineChart, which is single-dataset and hardcoded to --up/--down:
 * build inside useEffect, keep a local chart var and an `alive` flag, destroy
 * in cleanup. StrictMode double-fires every effect, so a missed destroy leaks a
 * canvas on every mount.
 *
 * Every colour comes from lib/peerColors.js, which reads CSS custom properties,
 * so all three retint with the theme toggle and no hex literal appears here.
 */
import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { seriesStyleFor } from '../peerColors.js';
import { fmtMetric, medianOf, percentileRank } from '../peers.js';

const FONT = '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

const baseOpts = (P) => ({
  responsive: true, maintainAspectRatio: false, animation: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: P.tipBg, titleColor: P.ink, bodyColor: P.ink,
      borderColor: P.tipBorder, borderWidth: 1, padding: 9, displayColors: true,
      titleFont: { family: FONT, size: 11 }, bodyFont: { family: FONT, size: 12 },
    },
  },
});

const tickFont = { family: FONT, size: 10 };

/* The scatter used to multiply both axes by 100 and suffix a % sign, which was
   right for the two metrics it was hardcoded to and wrong for the other ten:
   market cap became 9.6e12 "percent" and net-debt/EBITDA 30 "percent". A
   fraction-formatted metric is the only kind that gets scaled. */
const isPct = (m) => m?.format === 'pct1';
const scale = (m) => (isPct(m) ? 100 : 1);
const axisFmt = (m, v) => (isPct(m) ? `${Number(v).toFixed(1)}%` : fmtMetric(m, v));

/* ---- ranked bars -------------------------------------------------------- */

/* One hue for every bar with the focal in ink. The bar LENGTH already encodes
   the value, so tinting each bar by its own value would be encoding the same
   thing twice — and colouring by rank would break the rule that colour follows
   the entity. */
export function MetricBars({ rows, metric, focal, palette, onSelect }) {
  const ref = useRef(null);
  /* Held in a ref, not read from the closure: onSelect is a fresh identity on
     every parent render, and putting it in the dep array below would tear down
     and rebuild the chart on each one. */
  const pick = useRef(onSelect);
  pick.current = onSelect;
  useEffect(() => {
    if (!ref.current || !metric || !rows.length) return;
    const live = rows
      .filter((r) => typeof r.values?.[metric.id] === 'number')
      .sort((a, b) => (metric.higherIsBetter === false
        ? a.values[metric.id] - b.values[metric.id]
        : b.values[metric.id] - a.values[metric.id]));
    if (!live.length) return;

    let alive = true;
    const chart = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: live.map((r) => r.ticker),
        datasets: [{
          data: live.map((r) => r.values[metric.id]),
          backgroundColor: live.map((r) => (r.ticker === focal ? palette.focal : palette.slots[0])),
          borderColor: palette.panel,
          borderWidth: { top: 1, bottom: 1 },   // the 2px surface gap between bars
          borderRadius: 3,
          borderSkipped: 'start',
          barThickness: 'flex',
          maxBarThickness: 18,
        }],
      },
      options: {
        ...baseOpts(palette),
        indexAxis: 'y',
        // A bar and its matrix cell are the same claim, so clicking either puts
        // the same thing in the inspector.
        onClick: (_e, els) => {
          const r = live[els?.[0]?.index];
          if (!r) return;
          pick.current?.({ kind: 'metric', ticker: r.ticker, metric, frame: r.frame,
                           basis: r.basis, value: r.values[metric.id],
                           display: fmtMetric(metric, r.values[metric.id]), row: r });
        },
        layout: { padding: { right: 46 } },   // reserved so the value can never clip
        plugins: {
          ...baseOpts(palette).plugins,
          tooltip: { ...baseOpts(palette).plugins.tooltip,
            callbacks: { label: (c) => fmtMetric(metric, c.raw) } },
        },
        scales: {
          x: { grid: { color: palette.grid }, border: { display: false },
               ticks: { color: palette.tick, font: tickFont, maxTicksLimit: 5,
                        callback: (v) => fmtMetric(metric, v) } },
          y: { grid: { display: false }, border: { display: false },
               ticks: { color: palette.ink, font: { ...tickFont, size: 11 } } },
        },
      },
      plugins: [{
        id: 'tipLabels',
        afterDatasetsDraw(c) {
          const { ctx } = c;
          ctx.save();
          ctx.font = `600 10px ${FONT}`;
          ctx.fillStyle = palette.tick;
          ctx.textBaseline = 'middle';
          for (const el of c.getDatasetMeta(0).data) {
            const v = c.data.datasets[0].data[el.$context?.dataIndex ?? 0];
            ctx.fillText(fmtMetric(metric, v), el.x + 6, el.y);
          }
          ctx.restore();
        },
      }],
    });
    return () => { alive = false; try { chart.destroy(); } catch { /* already gone */ } };
  }, [rows, metric, focal, palette]);

  return <div className="cmp-plot"><canvas ref={ref} aria-label={metric?.label} /></div>;
}

/* ---- growth vs margin --------------------------------------------------- */

/* Axes are parameters now, defaulting to the growth/margin pair this started
   as. Any two of the twelve metrics is a legitimate question — leverage against
   returns, valuation against growth — and hardcoding one pair answered exactly
   one of them. */
export function QuadrantChart({ rows, metrics, focal, spotlight, palette,
                                xId = 'revenueGrowth', yId = 'operatingMargin' }) {
  const ref = useRef(null);
  const x = metrics.find((m) => m.id === xId) || metrics.find((m) => m.id === 'revenueGrowth');
  const y = metrics.find((m) => m.id === yId) || metrics.find((m) => m.id === 'operatingMargin');

  useEffect(() => {
    if (!ref.current || !x || !y) return;
    const pts = rows
      .filter((r) => typeof r.values?.[x.id] === 'number' && typeof r.values?.[y.id] === 'number')
      .map((r) => {
        const st = seriesStyleFor(r.ticker, { focal, spotlight, palette });
        const cap = r.values.marketCap;
        return {
          ticker: r.ticker, x: r.values[x.id], y: r.values[y.id],
          // Area, not radius, tracks market cap — so the sqrt.
          r: Number.isFinite(cap) ? Math.max(6, Math.min(26, Math.sqrt(cap / 1e9) * 0.9)) : 8,
          st,
        };
      });
    if (!pts.length) return;

    // Below five companies a median is theatre, not a reference line.
    const showMedian = pts.length >= 5;
    const mx = showMedian ? medianOf(pts.map((p) => p.x)) : null;
    const my = showMedian ? medianOf(pts.map((p) => p.y)) : null;

    const chart = new Chart(ref.current, {
      type: 'bubble',
      data: {
        datasets: pts.map((p) => ({
          label: p.ticker,
          data: [{ x: scale(x) * p.x, y: scale(y) * p.y, r: p.r }],
          backgroundColor: p.st.color,
          borderColor: palette.panel,
          borderWidth: 2,                       // the 2px surface ring
          pointStyle: p.st.pointStyle,
        })),
      },
      options: {
        ...baseOpts(palette),
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          ...baseOpts(palette).plugins,
          tooltip: { ...baseOpts(palette).plugins.tooltip,
            callbacks: {
              title: (c) => c[0].dataset.label,
              label: (c) => `${x.label} ${axisFmt(x, c.raw.x)} · ${y.label} ${axisFmt(y, c.raw.y)}`,
            } },
        },
        scales: {
          x: { grid: { color: palette.grid }, border: { display: false },
               title: { display: true, text: x.label, color: palette.tick, font: tickFont },
               ticks: { color: palette.tick, font: tickFont, callback: (v) => axisFmt(x, v) } },
          y: { grid: { color: palette.grid }, border: { display: false },
               title: { display: true, text: y.label, color: palette.tick, font: tickFont },
               ticks: { color: palette.tick, font: tickFont, callback: (v) => axisFmt(y, v) } },
        },
      },
      plugins: [{
        id: 'quadrant',
        beforeDatasetsDraw(c) {
          if (!showMedian) return;
          const { ctx, chartArea: a, scales } = c;
          ctx.save();
          ctx.strokeStyle = palette.grid;
          ctx.lineWidth = 1;                    // solid: a dashed axis reads as a threshold
          ctx.beginPath();
          const px = scales.x.getPixelForValue(mx * scale(x));
          const py = scales.y.getPixelForValue(my * scale(y));
          ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom);
          ctx.moveTo(a.left, py); ctx.lineTo(a.right, py);
          ctx.stroke();
          ctx.restore();
        },
        afterDatasetsDraw(c) {
          // Direct labels: position + label carry identity, hue is secondary.
          const { ctx } = c;
          ctx.save();
          ctx.font = `600 10px ${FONT}`;
          ctx.fillStyle = palette.ink;
          ctx.textAlign = 'center';
          c.data.datasets.forEach((ds, i) => {
            const el = c.getDatasetMeta(i).data[0];
            if (el) ctx.fillText(ds.label, el.x, el.y - el.options.radius - 5);
          });
          ctx.restore();
        },
      }],
    });
    return () => { try { chart.destroy(); } catch { /* already gone */ } };
  }, [rows, x, y, focal, spotlight, palette]);


  if (!x || !y) return null;
  return (
    <>
      <div className="cmp-plot cmp-plot-tall"><canvas ref={ref} aria-label="Growth versus margin" /></div>
      <div className="cmp-asof">
        bubble area ∝ market cap{rows.length < 5 ? ' · median hidden, needs 5+ companies' : ' · crosshair at the peer median'}
      </div>
    </>
  );
}

/* ---- relative price ----------------------------------------------------- */

/* Rebased to 100 at the first date every peer trades. That shared base is the
   whole point: it is what lets several price levels share ONE axis, and it is
   why there is no second y-axis anywhere on this surface. */
export function RelativePrice({ prices, focal, spotlight, palette }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !prices?.series) return;
    const tickers = Object.keys(prices.series);
    if (!tickers.length) return;

    // One shared x-axis: the union of dates, so series with gaps still align.
    const all = [...new Set(tickers.flatMap((t) => prices.series[t].dates))].sort();
    const datasets = tickers.map((t) => {
      const s = prices.series[t];
      const byDate = new Map(s.dates.map((d, i) => [d, s.rebased?.[i] ?? null]));
      const st = seriesStyleFor(t, { focal, spotlight, palette });
      return {
        label: t,
        data: all.map((d) => (byDate.has(d) ? byDate.get(d) : null)),
        borderColor: st.color, borderWidth: st.borderWidth, borderDash: st.borderDash,
        pointRadius: 0, pointHoverRadius: 3, tension: 0.15, fill: false,
        spanGaps: false,                        // a gap is a gap, not a straight line
        order: 10 - st.z,
      };
    });

    const chart = new Chart(ref.current, {
      type: 'line',
      data: { labels: all, datasets },
      options: {
        ...baseOpts(palette),
        interaction: { mode: 'index', intersect: false },
        plugins: {
          ...baseOpts(palette).plugins,
          tooltip: { ...baseOpts(palette).plugins.tooltip,
            callbacks: { label: (c) => `${c.dataset.label} ${c.raw == null ? '—' : c.raw.toFixed(1)}` } },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false },
               ticks: { color: palette.tick, font: tickFont, maxTicksLimit: 6,
                        maxRotation: 0, autoSkip: true,
                        callback(v) { const l = this.getLabelForValue(v); return l ? l.slice(0, 7) : l; } } },
          y: { position: 'right', grid: { color: palette.grid }, border: { display: false },
               ticks: { color: palette.tick, font: tickFont, maxTicksLimit: 5 } },
        },
      },
      plugins: [{
        id: 'baseline',
        beforeDatasetsDraw(c) {
          const { ctx, chartArea: a, scales } = c;
          const y = scales.y.getPixelForValue(100);
          if (!Number.isFinite(y)) return;
          ctx.save();
          ctx.strokeStyle = palette.grid; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke();
          ctx.restore();
        },
      }],
    });
    return () => { try { chart.destroy(); } catch { /* already gone */ } };
  }, [prices, focal, spotlight, palette]);

  return (
    <>
      <div className="cmp-plot"><canvas ref={ref} aria-label="Relative price performance" /></div>
      {prices?.rebaseAnchor && (
        <div className="cmp-asof">
          indexed to 100 at {prices.rebaseAnchor} — the first date every peer trades
          {prices.missing?.length ? ` · no price data for ${prices.missing.join(', ')}` : ''}
        </div>
      )}
    </>
  );
}

/* ---- shared legend ------------------------------------------------------ */

/* Always present for two or more series (a legend is not optional), and it
   carries the dash pattern as well as the hue, because dark mode's worst
   adjacent pair sits in the CVD floor band where colour alone is not legal. */
export function PeerLegend({ tickers, focal, spotlight, palette }) {
  if (!tickers.length) return null;
  return (
    <div className="cmp-legend">
      {tickers.map((t) => {
        const st = seriesStyleFor(t, { focal, spotlight, palette });
        return (
          <span key={t} className="cmp-legend-item">
            <svg width="18" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="18" y2="4"
                    stroke={st.color} strokeWidth={st.borderWidth}
                    strokeDasharray={st.borderDash.join(',') || undefined} />
            </svg>
            {t}
          </span>
        );
      })}
    </div>
  );
}

/* ==========================================================================
   The four charts added when the three panels became one switchable deck.

   All four are derived from data the surface already holds — `rows` for the
   first two, the rebased price series for the last two. None of them fetches
   anything, which is deliberate: a chart you can only see after a second round
   trip is a chart nobody switches to.
   ========================================================================== */

/* ---- deviation from the peer median ------------------------------------- */

/* Ranked bars answer "who is highest". This answers "by how much, against the
   middle of the set" — which is the question the matrix's diverging shading
   already poses and no chart on the surface answered. Bars run both ways from
   a centre line, signed against the metric's OWN direction so a low
   net-debt/EBITDA is a bar to the good side.
 *
 * This is the one chart here that uses the reserved up/down pair, and it earns
 * it: the claim being made is literally "better or worse than the median".
 */
export function SpreadChart({ rows, metric, focal, palette }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !metric || !rows.length) return;
    const vals = rows.map((r) => r.values?.[metric.id]).filter((v) => typeof v === 'number');
    const med = medianOf(vals);
    if (med == null || vals.length < 2) return;

    const live = rows
      .filter((r) => typeof r.values?.[metric.id] === 'number')
      .map((r) => ({ ticker: r.ticker, d: r.values[metric.id] - med, isFocal: r.ticker === focal }))
      .sort((a, b) => (metric.higherIsBetter === false ? a.d - b.d : b.d - a.d));

    // null means the descriptor declines to say which way is better, so no bar
    // gets a polarity colour — same rule the matrix shading follows.
    const good = (d) => (metric.higherIsBetter == null ? null
      : metric.higherIsBetter ? d > 0 : d < 0);

    const chart = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: live.map((r) => r.ticker),
        datasets: [{
          data: live.map((r) => r.d),
          backgroundColor: live.map((r) => {
            const g = good(r.d);
            return g == null ? palette.slots[0] : g ? palette.up : palette.down;
          }),
          borderColor: palette.panel, borderWidth: { top: 1, bottom: 1 },
          borderRadius: 3, maxBarThickness: 18,
        }],
      },
      options: {
        ...baseOpts(palette), indexAxis: 'y',
        layout: { padding: { right: 34, left: 34 } },
        plugins: {
          ...baseOpts(palette).plugins,
          tooltip: { ...baseOpts(palette).plugins.tooltip,
            callbacks: { label: (c) => `${c.raw > 0 ? '+' : ''}${fmtMetric(metric, c.raw)} vs median` } },
        },
        scales: {
          x: { grid: { color: palette.grid }, border: { display: false },
               ticks: { color: palette.tick, font: tickFont, maxTicksLimit: 5,
                        callback: (v) => fmtMetric(metric, v) } },
          y: { grid: { display: false }, border: { display: false },
               ticks: { color: (c) => (live[c.index]?.isFocal ? palette.ink : palette.tick),
                        font: { ...tickFont, size: 11 } } },
        },
      },
      plugins: [{
        id: 'zeroRule',
        beforeDatasetsDraw(c) {
          const { ctx, chartArea: a, scales } = c;
          const x = scales.x.getPixelForValue(0);
          if (!Number.isFinite(x)) return;
          ctx.save();
          ctx.strokeStyle = palette.tick; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
          ctx.restore();
        },
      }],
    });
    return () => { try { chart.destroy(); } catch { /* already gone */ } };
  }, [rows, metric, focal, palette]);

  return (
    <>
      <div className="cmp-plot cmp-plot-tall"><canvas ref={ref} aria-label={`${metric?.label} against the peer median`} /></div>
      <div className="cmp-asof">
        Distance from the peer median, signed so the good side of {metric?.label || 'the metric'} is
        always to the right. Needs two reporting companies.
      </div>
    </>
  );
}

/* ---- the focal company's percentile on every metric at once -------------- */

/* The matrix shows twelve numbers; this shows the same twelve as one shape. It
   is the only view on the surface that answers "what KIND of company is this
   against its peers" in a single glance — strong margins and weak growth reads
   as a profile, not as twelve separate comparisons.
 *
 * Percentile, not value, because twelve metrics in four different units cannot
 * share an axis any other way. Below three reporting companies a percentile is
 * noise, so those rows are dropped rather than drawn at a made-up 50.
 */
export function ProfileChart({ rows, metrics, focal, palette }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !metrics?.length || !rows.length) return;
    const focalRow = rows.find((r) => r.ticker === focal);
    if (!focalRow) return;

    const pts = [];
    for (const m of metrics) {
      const v = focalRow.values?.[m.id];
      if (typeof v !== 'number') continue;
      const vals = rows.map((r) => r.values?.[m.id]).filter((x) => typeof x === 'number');
      const p = percentileRank(v, vals);
      if (p == null) continue;
      // Flip so 100 always means "the good end", whichever way the metric runs.
      const pct = m.higherIsBetter === false ? (1 - p) * 100 : p * 100;
      pts.push({ label: m.label, pct, raw: fmtMetric(m, v), directional: m.higherIsBetter != null });
    }
    if (!pts.length) return;

    const chart = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: pts.map((p) => p.label),
        datasets: [{
          data: pts.map((p) => p.pct),
          backgroundColor: pts.map((p) => (p.directional ? palette.focal : palette.context)),
          borderColor: palette.panel, borderWidth: { top: 1, bottom: 1 },
          borderRadius: 3, maxBarThickness: 15,
        }],
      },
      options: {
        ...baseOpts(palette), indexAxis: 'y',
        plugins: {
          ...baseOpts(palette).plugins,
          tooltip: { ...baseOpts(palette).plugins.tooltip,
            callbacks: {
              label: (c) => `${Math.round(c.raw)}th percentile · ${pts[c.dataIndex].raw}`,
            } },
        },
        scales: {
          x: { min: 0, max: 100, grid: { color: palette.grid }, border: { display: false },
               ticks: { color: palette.tick, font: tickFont, stepSize: 25,
                        callback: (v) => `${v}` } },
          y: { grid: { display: false }, border: { display: false },
               ticks: { color: palette.tick, font: { ...tickFont, size: 10 } } },
        },
      },
      plugins: [{
        id: 'midRule',
        beforeDatasetsDraw(c) {
          const { ctx, chartArea: a, scales } = c;
          const x = scales.x.getPixelForValue(50);
          if (!Number.isFinite(x)) return;
          ctx.save();
          ctx.strokeStyle = palette.tick; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
          ctx.restore();
        },
      }],
    });
    return () => { try { chart.destroy(); } catch { /* already gone */ } };
  }, [rows, metrics, focal, palette]);

  return (
    <>
      <div className="cmp-plot cmp-plot-tall"><canvas ref={ref} aria-label={`${focal} percentile profile`} /></div>
      <div className="cmp-asof">
        {focal}'s percentile within this peer set on every metric, flipped so 100 is always the
        good end. Dashed line is the median. Grey rows are scale metrics, where the descriptor
        declines to say which direction is better. Metrics with fewer than three reporting
        companies are omitted rather than drawn at a made-up 50.
      </div>
    </>
  );
}

/* ---- price series derivations ------------------------------------------- */

/* Both charts below read the REBASED series, not raw closes. Rebasing is a
   constant multiple per ticker, and neither a drawdown nor a return is changed
   by one, so this needs no extra field from the API. */
const seriesOf = (prices) => Object.entries(prices?.series || {})
  .map(([t, s]) => [t, (s.rebased || []).map(Number).filter(Number.isFinite)])
  .filter(([, v]) => v.length > 2);

/* ---- drawdown ------------------------------------------------------------ */

/* Rebased price says who ended up ahead. This says what you had to sit through
   to get there, which is the half of "performance" a rising line hides — two
   peers can finish level with completely different worst days.
 */
export function DrawdownChart({ prices, focal, spotlight, palette }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !prices?.series) return;
    const tickers = Object.keys(prices.series);
    if (!tickers.length) return;
    const all = [...new Set(tickers.flatMap((t) => prices.series[t].dates))].sort();

    const datasets = tickers.map((t) => {
      const s = prices.series[t];
      let peak = -Infinity;
      const dd = (s.rebased || []).map((v) => {
        if (!Number.isFinite(v)) return null;
        if (v > peak) peak = v;
        return peak > 0 ? (v / peak - 1) * 100 : null;
      });
      const byDate = new Map(s.dates.map((d, i) => [d, dd[i] ?? null]));
      const st = seriesStyleFor(t, { focal, spotlight, palette });
      return {
        label: t,
        data: all.map((d) => (byDate.has(d) ? byDate.get(d) : null)),
        borderColor: st.color, borderWidth: st.borderWidth, borderDash: st.borderDash,
        pointRadius: 0, pointHoverRadius: 3, tension: 0.15, fill: false,
        spanGaps: false, order: 10 - st.z,
      };
    });

    const chart = new Chart(ref.current, {
      type: 'line',
      data: { labels: all, datasets },
      options: {
        ...baseOpts(palette),
        interaction: { mode: 'index', intersect: false },
        plugins: {
          ...baseOpts(palette).plugins,
          tooltip: { ...baseOpts(palette).plugins.tooltip,
            callbacks: { label: (c) => `${c.dataset.label} ${c.raw == null ? '—' : `${c.raw.toFixed(1)}%`}` } },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false },
               ticks: { color: palette.tick, font: tickFont, maxTicksLimit: 6, maxRotation: 0,
                        callback(v) { const l = this.getLabelForValue(v); return l ? l.slice(0, 7) : l; } } },
          // Always anchored at 0: a drawdown axis that starts at the worst value
          // makes every company look equally battered.
          y: { max: 0, position: 'right', grid: { color: palette.grid }, border: { display: false },
               ticks: { color: palette.tick, font: tickFont, maxTicksLimit: 5,
                        callback: (v) => `${v}%` } },
        },
      },
    });
    return () => { try { chart.destroy(); } catch { /* already gone */ } };
  }, [prices, focal, spotlight, palette]);

  return (
    <>
      <div className="cmp-plot"><canvas ref={ref} aria-label="Drawdown from running peak" /></div>
      <div className="cmp-asof">
        Percent below each company's own running peak over the window, so every line starts and
        repeatedly returns to zero. The depth and the time spent down are the two things a rebased
        price line cannot show.
      </div>
    </>
  );
}

/* ---- risk against return ------------------------------------------------- */

/* The classic two-axis view, and the one place on this surface where the price
   series says something the filings cannot. Annualised from daily rebased
   values: 252 trading days, log returns for the volatility so compounding does
   not inflate it.
 */
export function RiskReturnChart({ prices, focal, spotlight, palette }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const pts = seriesOf(prices).map(([t, v]) => {
      const rets = [];
      for (let i = 1; i < v.length; i++) if (v[i - 1] > 0 && v[i] > 0) rets.push(Math.log(v[i] / v[i - 1]));
      if (rets.length < 20) return null;
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const varc = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
      const vol = Math.sqrt(varc * 252) * 100;
      const ann = (Math.exp(mean * 252) - 1) * 100;
      return { t, vol, ann, st: seriesStyleFor(t, { focal, spotlight, palette }) };
    }).filter(Boolean);
    if (!pts.length) return;

    const chart = new Chart(ref.current, {
      type: 'scatter',
      data: {
        datasets: pts.map((p) => ({
          label: p.t, data: [{ x: p.vol, y: p.ann }],
          backgroundColor: p.st.color, borderColor: palette.panel, borderWidth: 2,
          pointStyle: p.st.pointStyle, pointRadius: p.t === focal ? 9 : 7, pointHoverRadius: 11,
        })),
      },
      options: {
        ...baseOpts(palette),
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          ...baseOpts(palette).plugins,
          tooltip: { ...baseOpts(palette).plugins.tooltip,
            callbacks: {
              title: (c) => c[0].dataset.label,
              label: (c) => `${c.raw.y.toFixed(1)}% a year at ${c.raw.x.toFixed(1)}% volatility`,
            } },
        },
        scales: {
          x: { grid: { color: palette.grid }, border: { display: false },
               title: { display: true, text: 'Annualised volatility', color: palette.tick, font: tickFont },
               ticks: { color: palette.tick, font: tickFont, callback: (v) => `${v}%` } },
          y: { grid: { color: palette.grid }, border: { display: false },
               title: { display: true, text: 'Annualised return', color: palette.tick, font: tickFont },
               ticks: { color: palette.tick, font: tickFont, callback: (v) => `${v}%` } },
        },
      },
      plugins: [{
        id: 'zeroAndLabels',
        beforeDatasetsDraw(c) {
          const { ctx, chartArea: a, scales } = c;
          const y = scales.y.getPixelForValue(0);
          if (!Number.isFinite(y) || y < a.top || y > a.bottom) return;
          ctx.save();
          ctx.strokeStyle = palette.tick; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke();
          ctx.restore();
        },
        afterDatasetsDraw(c) {
          const { ctx } = c;
          ctx.save();
          ctx.font = `600 10px ${FONT}`;
          ctx.fillStyle = palette.ink;
          ctx.textAlign = 'center';
          c.data.datasets.forEach((ds, i) => {
            const el = c.getDatasetMeta(i).data[0];
            if (el) ctx.fillText(ds.label, el.x, el.y - (el.options.radius || 7) - 5);
          });
          ctx.restore();
        },
      }],
    });
    return () => { try { chart.destroy(); } catch { /* already gone */ } };
  }, [prices, focal, spotlight, palette]);

  return (
    <>
      <div className="cmp-plot cmp-plot-tall"><canvas ref={ref} aria-label="Risk against return" /></div>
      <div className="cmp-asof">
        Annualised from daily moves over the same window as the price chart — 252 trading days, log
        returns for the volatility. Up and to the left is the good corner. A company needs 20 usable
        days to appear.
      </div>
    </>
  );
}

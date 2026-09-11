import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

const FONT = '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const cssVar = (n, f) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f;

/* Chart colours are read from the stylesheet, so every look retints its own
   charts with no second source of truth for the palette. */
export function chartColors() {
  return {
    line: cssVar('--up', '#0e8a52'),
    grid: cssVar('--chart-grid', 'rgba(0,0,0,.06)'),
    tick: cssVar('--ink-faint', 'rgba(0,0,0,.45)'),
    ink: cssVar('--ink', '#111'),
    tipBg: cssVar('--panel-2', '#fff'),
    tipBorder: cssVar('--hairline', 'rgba(0,0,0,.12)'),
  };
}

const hexToRgba = (hex, a) => {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

/* One line-chart builder. variant: 'spark' | 'full'. Rebuilds on data change and
   always destroys the previous instance — no leaked canvases across re-renders. */
export function useLineChart(canvasRef, { dates, values, variant = 'full', color, yFmt, tipFmt, deps = [] }) {
  const chartRef = useRef(null);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !dates?.length) return;
    const c = chartColors();
    const stroke = color || c.line;
    const spark = variant === 'spark';

    const chart = new Chart(el, {
      type: 'line',
      data: { labels: dates, datasets: [{
        data: values,
        borderColor: stroke,
        borderWidth: spark ? 1.4 : 1.9,
        pointRadius: 0,
        pointHoverRadius: spark ? 0 : 4,
        pointBackgroundColor: stroke,
        tension: 0.25,
        fill: true,
        backgroundColor: (ctx) => {
          const { chart: ch } = ctx; const { ctx: cc, chartArea } = ch;
          if (!chartArea) return 'transparent';
          const g = cc.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, hexToRgba(stroke, spark ? 0.16 : 0.15));
          g.addColorStop(1, hexToRgba(stroke, 0));
          return g;
        },
      }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: !spark,
            backgroundColor: c.tipBg, titleColor: c.ink, bodyColor: c.ink,
            borderColor: c.tipBorder, borderWidth: 1, padding: 10, displayColors: false,
            titleFont: { family: FONT, size: 11 },
            bodyFont: { family: FONT, size: 13, weight: '600' },
            callbacks: {
              title: (i) => (i[0] ? i[0].label : ''),
              label: (i) => (tipFmt ? tipFmt(i.raw) : String(i.raw)),
            },
          },
        },
        scales: spark
          ? { x: { display: false }, y: { display: false, grace: '8%' } }
          : {
              x: { grid: { display: false }, border: { display: false },
                ticks: { color: c.tick, maxTicksLimit: 6, maxRotation: 0, autoSkip: true,
                  font: { family: FONT, size: 10 },
                  callback(v) { const l = this.getLabelForValue(v); return l ? l.slice(0, 7) : l; } } },
              y: { position: 'right', grid: { color: c.grid }, border: { display: false },
                ticks: { color: c.tick, maxTicksLimit: 5, font: { family: FONT, size: 10 },
                  callback: yFmt || ((v) => v) } },
            },
      },
    });
    chartRef.current = chart;
    return () => { try { chart.destroy(); } catch {} chartRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, values, variant, color, ...deps]);
  return chartRef;
}

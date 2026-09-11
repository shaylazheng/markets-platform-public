/* The readout strip above the matrix.
 *
 * Fetches nothing — a pure function of `rows`, which the surface already has.
 */
import { fmtMetric, medianOf, percentileRank, rankRows } from '../peers.js';

/* 1st, 2nd, 3rd, 4th — and 11th/12th/13th, which is the case a naive
   last-digit lookup gets wrong. */
function ordinal(n) {
  const r100 = n % 100;
  if (r100 >= 11 && r100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

/* A signed difference, without signing it twice. Several of the formatters —
   `pct1` among them — already emit a leading + or −, so prepending one blindly
   produced "++19.0%". Ask the formatted string whether it has a sign already
   rather than keeping a list of which formats do. */
function signed(metric, v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = fmtMetric(metric, v);
  return /^[+−-]/.test(s) ? s : (v > 0 ? '+' : '') + s;
}

/* Where the focal company stands on the selected metric, in the chart-stats
   idiom the rest of the dashboard uses: micro-caps label over a tabular figure,
   cells separated by rules rather than by punctuation.
 *
 * This is the sentence the matrix makes you assemble yourself. The value is in
 * one cell, the peers' values are in eleven others, and "is 38.6% good?" needs
 * all twelve read at once. Rank and percentile answer it directly.
 *
 * `higherIsBetter: null` metrics — market cap, share count — get no rank and no
 * gap, only the level and the median. Ranking a scale metric would assert that
 * bigger is better, which is exactly the claim the descriptor declines to make.
 */
export function MetricReadout({ rows, metric, focal }) {
  if (!metric || !rows.length) return null;

  const vals = rows.map((r) => r.values?.[metric.id]).filter((v) => typeof v === 'number');
  const focalRow = rows.find((r) => r.ticker === focal);
  const v = focalRow?.values?.[metric.id];
  const has = typeof v === 'number';

  const median = medianOf(vals);
  const ranked = metric.higherIsBetter != null;
  const rank = ranked ? rankRows(rows, metric)[focal] : null;
  const p = has ? percentileRank(v, vals) : null;

  /* Signed against the metric's own direction, so a LOW net-debt/EBITDA reads
     as an advantage. Same inversion the matrix shading uses. */
  const gap = has && median != null ? v - median : null;
  const good = gap == null || !ranked ? null
    : metric.higherIsBetter ? gap > 0 : gap < 0;

  const cell = (label, value, cls = '') => (
    <div className="cs-cell">
      <div className="cs-label">{label}</div>
      <div className={'cs-value ' + cls}>{value}</div>
    </div>
  );

  return (
    <div className="chart-stats cmp-readout">
      {cell(focal, has ? fmtMetric(metric, v) : v === 'na' ? 'n/a' : '—')}
      {ranked && cell('Rank', rank ? `${rank} of ${vals.length}` : '—')}
      {cell('Peer median', median == null ? '—' : fmtMetric(metric, median))}
      {/* The gap is the number people actually quote at each other, and it is
          the one the matrix never shows. Signed with an explicit + so the
          direction survives greyscale and a colourblind reader. */}
      {ranked && cell('vs median', signed(metric, gap),
        good == null ? '' : good ? 'up' : 'down')}
      {cell('Percentile', p == null ? '—' : ordinal(Math.round(p * 100)))}
      {cell('Basis', metric.basis || '—', 'cmp-readout-basis')}
    </div>
  );
}

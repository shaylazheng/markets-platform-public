/* How a metric value is written, in one place.
 *
 * Two things render these numbers — the inspector's metric rows (sidebar.jsx)
 * and the company panel's figures — and for a while each had its own copy.
 * That is a bug waiting to happen rather than a style problem: two readouts of
 * the SAME value that disagree ("2.7%" here, "2.68%" there) make a reader
 * distrust both. One formatter, one answer.
 */
export const DASH = '—';

export function fmtMetric(v, fmt) {
  // 'na' is not missing data — it is a measure that does not exist for this
  // company's sector, and the two must not render the same way.
  if (v === 'na') return 'n/a';
  if (v == null || !Number.isFinite(v)) return DASH;
  switch (fmt) {
    case 'pct1': return `${(v * 100).toFixed(1)}%`;
    case 'pct2': return `${(v * 100).toFixed(2)}%`;
    case 'x1': return `${v.toFixed(1)}×`;
    case 'x2': return `${v.toFixed(2)}×`;
    case 'money': return fmtMoney(v);
    default: return String(Math.round(v * 100) / 100);
  }
}

/** Short money, sign preserved. A negative FCF is the point, not a rounding artefact. */
export function fmtMoney(v) {
  if (v == null || !Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${Math.round(a)}`;
}

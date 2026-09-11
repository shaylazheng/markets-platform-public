/* Portfolio risk arithmetic. Pure — no HTTP, no files, no dates from the
 * clock. Everything here takes aligned series in and returns numbers out, so
 * it can be tested against hand-computed answers.
 *
 * The one idea the whole file rests on: two price series are only comparable
 * on the dates they BOTH traded. Every function here therefore aligns first
 * and computes second. Aligning by index instead of by date is the classic way
 * to get a correlation that looks plausible and means nothing — a single
 * missing day silently shifts one series against the other for the rest of
 * the window.
 */

const TRADING_DAYS = 252;

/** Simple daily returns from a date→close map, on the given date spine.
 *  Returns nulls where either end of a step is missing, so callers can drop
 *  pairs rather than inventing a zero-return day. */
export function returnsOn(spine, closeByDate) {
  const out = [];
  for (let i = 1; i < spine.length; i++) {
    const a = closeByDate.get(spine[i - 1]);
    const b = closeByDate.get(spine[i]);
    out.push(a != null && b != null && a !== 0 ? b / a - 1 : null);
  }
  return out;
}

/** The dates on which EVERY series traded, ascending. */
export function commonDates(maps) {
  if (!maps.length) return [];
  const [first, ...rest] = maps;
  const dates = [...first.keys()].filter((d) => first.get(d) != null);
  return dates
    .filter((d) => rest.every((m) => m.get(d) != null))
    .sort();
}

export const mean = (xs) => xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null;

/** Sample standard deviation (n−1). Population would understate risk on the
 *  short windows this surface uses. */
export function stdev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function covariance(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const mx = mean(xs), my = mean(ys);
  return xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / (xs.length - 1);
}

/** Pearson correlation. Null rather than NaN when either series is flat —
 *  a constant series has no correlation with anything, and 0 would read as
 *  "independent", which is a different and much stronger claim. */
export function correlation(xs, ys) {
  const sx = stdev(xs), sy = stdev(ys);
  if (!sx || !sy) return null;
  const cov = covariance(xs, ys);
  return cov == null ? null : cov / (sx * sy);
}

/** Annualised volatility from daily returns. */
export function annualVol(rets) {
  const s = stdev(rets);
  return s == null ? null : s * Math.sqrt(TRADING_DAYS);
}

/** Beta against a market series. Null when the market has no variance. */
export function beta(assetRets, marketRets) {
  const varM = stdev(marketRets);
  if (!varM) return null;
  const cov = covariance(assetRets, marketRets);
  return cov == null ? null : cov / (varM * varM);
}

/** Peak-to-trough on a cumulative value path. Returns the worst drawdown as a
 *  NEGATIVE fraction, plus where it happened. */
export function maxDrawdown(values, dates = []) {
  if (!values.length) return { depth: null, peakAt: null, troughAt: null };
  let peak = values[0], peakIdx = 0;
  let depth = 0, peakAt = dates[0] ?? null, troughAt = dates[0] ?? null;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > peak) { peak = values[i]; peakIdx = i; }
    const dd = peak ? values[i] / peak - 1 : 0;
    if (dd < depth) { depth = dd; peakAt = dates[peakIdx] ?? null; troughAt = dates[i] ?? null; }
  }
  return { depth, peakAt, troughAt };
}

/** Compound a return series into a path indexed to 100. */
export function indexPath(rets, base = 100) {
  const out = [base];
  for (const r of rets) out.push(out[out.length - 1] * (1 + (r || 0)));
  return out;
}

/** Herfindahl index of weights: 1/n when perfectly equal-weighted, 1 when a
 *  single name is the whole book. Reported alongside its effective-N inverse,
 *  which is the number people can actually reason about. */
export function herfindahl(weights) {
  const ws = weights.filter((w) => Number.isFinite(w));
  if (!ws.length) return { hhi: null, effectiveN: null };
  const total = ws.reduce((a, w) => a + w, 0);
  if (!total) return { hhi: null, effectiveN: null };
  const hhi = ws.reduce((a, w) => a + (w / total) ** 2, 0);
  return { hhi, effectiveN: hhi ? 1 / hhi : null };
}

/** Weighted portfolio return series from per-asset returns held at fixed
 *  weights. This is TODAY'S book replayed over history, not the book as it
 *  actually was — the caller must label it that way. */
export function portfolioReturns(weightByTicker, retsByTicker, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let acc = 0, wsum = 0;
    for (const [t, w] of Object.entries(weightByTicker)) {
      const r = retsByTicker[t]?.[i];
      if (r == null || !Number.isFinite(w)) continue;
      acc += w * r; wsum += w;
    }
    // Renormalise by the weight actually present, so a name missing a day does
    // not drag the book toward zero as though it had returned nothing.
    out.push(wsum ? acc / wsum : null);
  }
  return out;
}

/** The whole correlation matrix, upper triangle included, diagonal 1. */
export function correlationMatrix(tickers, retsByTicker) {
  const m = {};
  for (const a of tickers) {
    m[a] = {};
    for (const b of tickers) {
      if (a === b) { m[a][b] = 1; continue; }
      // Drop index-wise pairs where either leg is missing, so the pair is
      // computed on the days both names actually traded.
      const xs = [], ys = [];
      const ra = retsByTicker[a] || [], rb = retsByTicker[b] || [];
      for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
        if (ra[i] == null || rb[i] == null) continue;
        xs.push(ra[i]); ys.push(rb[i]);
      }
      m[a][b] = xs.length >= 20 ? correlation(xs, ys) : null;
    }
  }
  return m;
}

/** Mean of the off-diagonal entries — the single number that says how much
 *  diversification the book actually has. */
export function averagePairwise(tickers, matrix) {
  const vals = [];
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const v = matrix[tickers[i]]?.[tickers[j]];
      if (v != null) vals.push(v);
    }
  }
  return vals.length ? mean(vals) : null;
}

export { TRADING_DAYS };

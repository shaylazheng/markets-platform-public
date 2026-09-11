/* API client + formatting for the Competitors surface.
 *
 * Formatters are keyed by the `format` string the server ships in each metric
 * descriptor, so a metric added server-side renders here with no frontend
 * change. An unknown key falls back to a plain number rather than throwing --
 * a new metric must never white-screen the surface.
 */
import { DASH, money, num, pct } from '@markets/insider/insider.js';

export const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;
export const PEER_CAP = 15;      // the table scrolls fine; this is a sanity bound
export const SPOT_CAP = 3;       // validated: 4 categorical hues FAIL in dark mode

export const cleanList = (csv, cap = PEER_CAP) =>
  [...new Set(String(csv || '').split(',').map((s) => s.trim().toUpperCase())
    .filter((t) => TICKER_RE.test(t)))].slice(0, cap);

const getJSON = async (url, opts) => {
  const r = await fetch(url, opts);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};

export const fetchMetrics = () => getJSON('/api/peers/metrics');
export const fetchResolve = (t) => getJSON(`/api/peers/resolve?ticker=${encodeURIComponent(t)}`);
export const fetchSuggest = (t) => getJSON(`/api/peers/suggest?ticker=${encodeURIComponent(t)}`);
export const fetchNotes = (t) => getJSON(`/api/peers/notes?ticker=${encodeURIComponent(t)}`);
export const fetchPeerNews = (ts) => getJSON(`/api/peers/news?tickers=${ts.join(',')}`);
export const fetchPeerInsider = (ts, days = 90) =>
  getJSON(`/api/peers/insider?tickers=${ts.join(',')}&days=${days}`);

/* The forward-return track record. A separate call on a separate window: the
   pulse asks what insiders are doing now, this asks whether it has ever meant
   anything here, and that needs years rather than a quarter. Fetched only when
   the section is opened. */
export const fetchPeerInsiderRecord = (ts, years = 5) =>
  getJSON(`/api/peers/insider/record?tickers=${ts.join(',')}&years=${years}`);
export const fetchFundamentals = (t, opts) =>
  getJSON(`/api/peers/fundamentals?ticker=${encodeURIComponent(t)}`, opts);

/* Provenance is a SEPARATE call from fundamentals, made only when something is
   selected: the filing trace for a fifteen-peer set is a few hundred kilobytes
   nobody has asked to see. Memoised per (ticker, frame) for the session —
   filings do not change while a comparison is open. */
const provCache = new Map();
export function fetchProvenance(t, frame) {
  const k = `${t}:${frame || ''}`;
  if (!provCache.has(k)) {
    provCache.set(k, getJSON(
      `/api/peers/provenance?ticker=${encodeURIComponent(t)}`
      + (frame ? `&frame=${encodeURIComponent(frame)}` : ''),
    ).catch((e) => { provCache.delete(k); throw e; }));
  }
  return provCache.get(k);
}
export const fetchPrices = (ts, from) =>
  getJSON(`/api/insider/prices?tickers=${ts.join(',')}&rebase=true`
    + (from ? `&start=${from}` : ''));

/* ---- formatting --------------------------------------------------------- */

export const FORMATTERS = {
  pct1: (v) => pct(v * 100, 1),
  // Net interest margin and provision rates live in the second decimal — a
  // bank's NIM moving from 2.61% to 2.68% is the whole story, and pct1 renders
  // both as 2.7%.
  pct2: (v) => pct(v * 100, 2),
  money,
  count: num,
  ratio: (v) => v.toFixed(2),
  x1: (v) => `${v.toFixed(1)}×`,
  x2: (v) => `${v.toFixed(2)}×`,
  days: (v) => `${Math.round(v)}d`,
};

export const NA = 'na';

/** null -> em dash, 'na' -> n/a, number -> the descriptor's format. */
export function fmtMetric(d, v) {
  if (v === NA) return 'n/a';
  if (v == null || !Number.isFinite(v)) return DASH;
  const f = FORMATTERS[d?.format];
  return f ? f(v) : num(v);
}

/** Percentile of v within arr (0..1), or null below a usable population. */
export function percentileRank(v, arr) {
  const live = arr.filter((x) => typeof x === 'number');
  // Below three reporting companies a percentile is noise, not information.
  if (live.length < 3) return null;
  const below = live.filter((x) => x < v).length;
  const equal = live.filter((x) => x === v).length;
  return (below + equal / 2) / live.length;
}

export const medianOf = (arr) => {
  const live = arr.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!live.length) return null;
  const m = Math.floor(live.length / 2);
  return live.length % 2 ? live[m] : (live[m - 1] + live[m]) / 2;
};

/** Rank rows for a metric; nulls and n/a never occupy a rank. */
export function rankRows(rows, metric) {
  if (!metric || metric.higherIsBetter == null) return {};
  const live = rows.filter((r) => typeof r.values?.[metric.id] === 'number');
  live.sort((a, b) => (metric.higherIsBetter
    ? b.values[metric.id] - a.values[metric.id]
    : a.values[metric.id] - b.values[metric.id]));
  return Object.fromEntries(live.map((r, i) => [r.ticker, i + 1]));
}

/* Domain layer, ported from the vanilla build: series config plus the pure
   helpers that derive display values from a FRED series. No DOM, no globals. */

const SECTIONS = [
  { title: 'Equities', series: [
    { id: 'SP500',     name: 'S&P 500',                 units: '', kind: 'level', dec: 0 },
    { id: 'NASDAQCOM', name: 'Nasdaq Composite',        units: '', kind: 'level', dec: 0 },
    { id: 'DJIA',      name: 'Dow Jones Industrial Avg', units: '', kind: 'level', dec: 0 },
  ]},
  { title: 'Rates', series: [
    { id: 'DGS10',  name: '10-Year Treasury', units: '', kind: 'pct', dec: 2, suffix: '%' },
    { id: 'DGS2',   name: '2-Year Treasury',  units: '', kind: 'pct', dec: 2, suffix: '%' },
    { id: 'DGS1',   name: '1-Year Treasury',  units: '', kind: 'pct', dec: 2, suffix: '%' },
    { id: 'DGS7',   name: '7-Year Treasury',  units: '', kind: 'pct', dec: 2, suffix: '%' },
    { id: 'DGS3MO', name: '3-Month Treasury', units: '', kind: 'pct', dec: 2, suffix: '%' },
    { id: 'DGS5',   name: '5-Year Treasury',  units: '', kind: 'pct', dec: 2, suffix: '%' },
    { id: 'DGS30',  name: '30-Year Treasury', units: '', kind: 'pct', dec: 2, suffix: '%' },
  ]},
  { title: 'Yield curve', curve: true, series: [
    { id: 'T10Y2Y', name: '10Y minus 2Y spread', units: '', kind: 'pct', dec: 2, suffix: ' pp' },
    { id: 'T10Y3M', name: '10Y minus 3M spread', units: '', kind: 'pct', dec: 2, suffix: ' pp' },
  ]},
  { title: 'Volatility', series: [
    { id: 'VIXCLS', name: 'CBOE Volatility Index (VIX)', units: '', kind: 'level', dec: 2 },
  ]},
  { title: 'Credit spreads', series: [
    { id: 'BAMLH0A0HYM2', name: 'High Yield (HY)',       units: 'Option adjusted spread', kind: 'pct', dec: 2, suffix: '%' },
    { id: 'BAMLC0A0CM',   name: 'Investment Grade (IG)', units: 'Option adjusted spread', kind: 'pct', dec: 2, suffix: '%' },
  ]},
  { title: 'Macro', series: [
    { id: 'DFF',      name: 'Effective Fed Funds Rate', units: '', kind: 'pct', dec: 2, suffix: '%' },
    { id: 'MORTGAGE30US', name: '30-Year Fixed Mortgage', units: 'Weekly average', kind: 'pct', dec: 2, suffix: '%' },
    { id: 'CPIAUCSL', name: 'CPI (all items)',          units: 'Index 1982-84=100', kind: 'level', dec: 1 },
    { id: 'UNRATE',   name: 'Unemployment Rate',        units: '', kind: 'pct', dec: 1, suffix: '%' },
  ]},
  { title: 'Real rates & inflation expectations', series: [
    { id: 'DFII10',  name: '10-Year Real Yield (TIPS)',   units: '', kind: 'pct', dec: 2, suffix: '%' },
    { id: 'T10YIE',  name: '10-Year Breakeven Inflation', units: '', kind: 'pct', dec: 2, suffix: '%' },
  ]},
  { title: 'FX & the dollar', series: [
    { id: 'DTWEXBGS', name: 'Broad Dollar Index', units: '', kind: 'level', dec: 2 },
    { id: 'DEXUSEU',  name: 'US$ per Euro',       units: 'USD per EUR', kind: 'level', dec: 4 },
  ]},
  { title: 'Commodities', series: [
    { id: 'DCOILWTICO',   name: 'Crude Oil — WTI',   units: 'USD / barrel', kind: 'level', dec: 2, prefix: '$' },
    { id: 'DCOILBRENTEU', name: 'Crude Oil — Brent', units: 'USD / barrel', kind: 'level', dec: 2, prefix: '$' },
    // FRED discontinued its daily London gold-fixing series (GOLDAMGBD228NLBM); Henry Hub
    // natural gas is the closest live daily commodity price still published.
    { id: 'DHHNGSP',      name: 'Natural Gas — Henry Hub', units: 'USD / million BTU', kind: 'level', dec: 2, prefix: '$' },
  ]},
  { title: 'Labor & financial conditions', series: [
    { id: 'ICSA',    name: 'Initial Jobless Claims',      units: 'Weekly, persons', kind: 'level', dec: 0 },
    { id: 'NFCI',    name: 'Financial Conditions (NFCI)', units: 'Index, 0 = average; + is tighter', kind: 'level', dec: 2 },
    { id: 'UMCSENT', name: 'Consumer Sentiment (UMich)',  units: 'Index', kind: 'level', dec: 1 },
  ]},
  { title: 'Money', series: [
    { id: 'M2SL',    name: 'M2 Money Supply', units: 'Billions of USD', kind: 'level', dec: 0 },
  ]},
];

const CURVE_POINTS = [
  { id: 'DGS3MO', label: '3M', years: 0.25 },
  { id: 'DGS1', label: '1Y', years: 1 },
  { id: 'DGS2', label: '2Y', years: 2 },
  { id: 'DGS7', label: '7Y', years: 7 },
  { id: 'DGS5', label: '5Y', years: 5 },
  { id: 'DGS10', label: '10Y', years: 10 },
  { id: 'DGS30', label: '30Y', years: 30 },
];

const SERIES_META = {};
for (const sec of SECTIONS) for (const s of sec.series) SERIES_META[s.id] = s;

function fmtNum(v, dec, prefix = '', suffix = '') {
  return `${prefix}${Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${suffix}`;
}
function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function trendInfo(s, data) {
  const first = data.values[0], last = data.values[data.values.length - 1];
  const delta = last - first;
  const dir = Math.abs(delta) < 1e-9 ? 'flat' : delta > 0 ? 'up' : 'down';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
  let text;
  if (s.kind === 'pct') text = `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} pp since 2023`;
  else { const pct = first !== 0 ? (delta / first) * 100 : 0; text = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% since 2023`; }
  return { dir, arrow, text };
}
// One period change, formatted in the series' own units (pp for rates, % for levels).
function periodChange(s, data, obsAgo, ytd) {
  const v = data.values, dts = data.dates, L = v.length - 1;
  let iThen;
  if (ytd) {
    const yr = dts[L].slice(0, 4);
    iThen = dts.findIndex((d) => d >= yr + '-01-01');
    if (iThen < 0 || iThen === L) return null;
  } else {
    iThen = L - obsAgo;
    if (iThen < 0) return null;
  }
  const now = v[L], then = v[iThen];
  if (s.kind === 'pct') { const d = now - then; return { dir: d > 1e-9 ? 'up' : d < -1e-9 ? 'down' : 'flat', text: `${d >= 0 ? '+' : ''}${d.toFixed(2)}` }; }
  const pct = then !== 0 ? (now / then - 1) * 100 : 0;
  return { dir: pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat', text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` };
}

// Where the latest value sits within its 2023-to-now range (0 = low, 100 = high).
function rangePosition(data) {
  const v = data.values, lo = Math.min(...v), hi = Math.max(...v), last = v[v.length - 1];
  if (hi === lo) return null;
  return Math.round(((last - lo) / (hi - lo)) * 100);
}

function compute(s, data) {
  const latest = data.values[data.values.length - 1];
  const latestDate = data.dates[data.dates.length - 1];
  // Daily series: ~1 obs = day, 5 = week, 21 = month. Monthly series: 1 = month, YTD still works.
  const monthly = data.dates.length > 1 && (Date.parse(data.dates[data.dates.length - 1]) - Date.parse(data.dates[data.dates.length - 2])) > 20 * 864e5;
  const changes = monthly
    ? [['1M', periodChange(s, data, 1)], ['3M', periodChange(s, data, 3)], ['YTD', periodChange(s, data, 0, true)]]
    : [['1D', periodChange(s, data, 1)], ['1W', periodChange(s, data, 5)], ['1M', periodChange(s, data, 21)], ['YTD', periodChange(s, data, 0, true)]];
  return {
    latest, latestDate, valueStr: fmtNum(latest, s.dec, s.prefix || '', s.suffix || ''),
    trend: trendInfo(s, data),
    changes: changes.filter(([, c]) => c),
    range: rangePosition(data),
  };
}

/* ============================================================ *
 *  THEME + CHART COLORS
 * ============================================================ */

const CURVE_SYM = '__CURVE__';

// One flat, ordered symbol list, tagged with its section for the group headers.
const WATCHLIST = [];
for (const sec of SECTIONS) {
  if (sec.curve) WATCHLIST.push({ id: CURVE_SYM, name: 'Treasury Yield Curve', section: sec.title, curve: true, dec: 2 });
  for (const s of sec.series) WATCHLIST.push({ ...s, section: sec.title });
}

// Legend's interval strip. `days` is a lookback window; null means "everything".
const TIMEFRAMES = [
  { k: '1M', days: 31 }, { k: '3M', days: 92 }, { k: '6M', days: 183 },
  { k: 'YTD', ytd: true }, { k: '1Y', days: 366 }, { k: '5Y', days: 1827 }, { k: 'ALL', days: null },
];

function sliceByTf(data, tfKey) {
  const tf = TIMEFRAMES.find((t) => t.k === tfKey) || TIMEFRAMES[TIMEFRAMES.length - 1];
  if (!tf.days && !tf.ytd) return data;
  const lastIso = data.dates[data.dates.length - 1];
  const last = new Date(lastIso);
  const cutoff = tf.ytd ? new Date(Date.UTC(last.getUTCFullYear(), 0, 1)) : new Date(last.getTime() - tf.days * 86400000);
  const cutIso = cutoff.toISOString().slice(0, 10);
  let i = 0;
  while (i < data.dates.length && data.dates[i] < cutIso) i++;
  // Keep at least two points so a chart still has a line to draw.
  if (data.dates.length - i < 2) i = Math.max(0, data.dates.length - 2);
  return { dates: data.dates.slice(i), values: data.values.slice(i) };
}

// Change over the visible window — what Legend's header quote reports.
function windowChange(s, sliced) {
  const v = sliced.values;
  if (v.length < 2) return null;
  const first = v[0], last = v[v.length - 1];
  const net = last - first;
  const pct = first !== 0 ? (net / Math.abs(first)) * 100 : null;
  const dir = net > 0 ? 'up' : net < 0 ? 'down' : 'flat';
  const sign = net > 0 ? '+' : net < 0 ? '−' : '';
  const unit = s.kind === 'pct' ? ' pp' : '';
  return {
    dir, net,
    netStr: sign + fmtNum(Math.abs(net), s.dec ?? 2, s.prefix || '', unit),
    pctStr: pct == null ? '' : sign + Math.abs(pct).toFixed(2) + '%',
  };
}

// Most recent observation vs the one before it — the watchlist's Net chg / Chg %.
function lastChange(s, data) {
  const v = data.values, L = v.length - 1;
  if (L < 1) return null;
  const net = v[L] - v[L - 1];
  const pct = v[L - 1] !== 0 ? (net / Math.abs(v[L - 1])) * 100 : null;
  const dir = net > 0 ? 'up' : net < 0 ? 'down' : 'flat';
  const sign = net > 0 ? '+' : net < 0 ? '−' : '';
  const unit = s.kind === 'pct' ? '' : '';
  return {
    dir,
    netStr: sign + fmtNum(Math.abs(net), s.dec ?? 2, s.prefix || '', unit),
    pctStr: pct == null ? '—' : sign + Math.abs(pct).toFixed(2) + '%',
  };
}

/* ---------- timeframe strips ---------- */

export {
  SECTIONS, CURVE_POINTS, SERIES_META, CURVE_SYM, WATCHLIST, TIMEFRAMES,
  fmtNum, fmtDate, trendInfo, periodChange, rangePosition, compute,
  sliceByTf, windowChange, lastChange,
};

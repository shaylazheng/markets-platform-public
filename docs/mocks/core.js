/* Market Dashboard mock core — shared by all ten style mocks.
   Example data only (deterministic pseudo-random walks); every number on
   screen is illustrative and marked as such in the footer. */
(function () {
  'use strict';

  /* ---------- deterministic randomness ---------- */
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /* ---------- dates: business days 2023-01-03 .. 2026-09-08 ---------- */
  const TODAY = new Date(Date.UTC(2026, 8, 9));
  const LAST = new Date(Date.UTC(2026, 8, 8));
  const DATES = [];
  for (let d = new Date(Date.UTC(2023, 0, 3)); d <= LAST; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay(); if (wd === 0 || wd === 6) continue;
    DATES.push(d.toISOString().slice(0, 10));
  }
  const N = DATES.length;

  /* ---------- the watchlist (mirrors shell/lib/series.js sections) ---------- */
  const SECTIONS = [
    { title: 'Equities', series: [
      { id: 'SP500', name: 'S&P 500', level: 6412.18, start: 3850, vol: 0.009, dec: 2 },
      { id: 'NASDAQCOM', name: 'Nasdaq Composite', level: 21540.7, start: 10400, vol: 0.012, dec: 1 },
      { id: 'DJIA', name: 'Dow Jones Industrial Avg', level: 44210.3, start: 33100, vol: 0.008, dec: 1 },
    ] },
    { title: 'Rates', series: [
      { id: 'DGS10', name: '10-Year Treasury', level: 4.30, start: 3.79, vol: 0.05, dec: 2, suffix: '%', kind: 'pct', units: 'percent, daily' },
      { id: 'DGS2', name: '2-Year Treasury', level: 3.78, start: 4.40, vol: 0.06, dec: 2, suffix: '%', kind: 'pct' },
      { id: 'DGS1', name: '1-Year Treasury', level: 4.02, start: 4.72, vol: 0.05, dec: 2, suffix: '%', kind: 'pct' },
      { id: 'DGS7', name: '7-Year Treasury', level: 4.05, start: 3.85, vol: 0.05, dec: 2, suffix: '%', kind: 'pct' },
      { id: 'DGS3MO', name: '3-Month Treasury', level: 4.09, start: 4.53, vol: 0.02, dec: 2, suffix: '%', kind: 'pct' },
      { id: 'DGS5', name: '5-Year Treasury', level: 3.86, start: 3.94, vol: 0.05, dec: 2, suffix: '%', kind: 'pct' },
      { id: 'DGS30', name: '30-Year Treasury', level: 4.92, start: 3.88, vol: 0.04, dec: 2, suffix: '%', kind: 'pct' },
    ] },
    { title: 'Yield curve', curve: true, series: [
      { id: 'T10Y2Y', name: '10Y minus 2Y spread', level: 0.52, start: -0.61, vol: 0.03, dec: 2, suffix: '%', kind: 'pct' },
      { id: 'T10Y3M', name: '10Y minus 3M spread', level: 0.21, start: -0.74, vol: 0.03, dec: 2, suffix: '%', kind: 'pct' },
    ] },
    { title: 'Volatility', series: [
      { id: 'VIXCLS', name: 'CBOE Volatility Index (VIX)', level: 15.8, start: 22.9, vol: 0.06, dec: 1 },
    ] },
    { title: 'Credit spreads', series: [
      { id: 'BAMLC0A0CM', name: 'IG corporate OAS', level: 0.94, start: 1.38, vol: 0.02, dec: 2, suffix: '%', kind: 'pct' },
      { id: 'BAMLH0A0HYM2', name: 'High-yield OAS', level: 3.12, start: 4.81, vol: 0.03, dec: 2, suffix: '%', kind: 'pct' },
    ] },
    { title: 'FX', series: [
      { id: 'DTWEXBGS', name: 'Broad dollar index', level: 121.4, start: 122.1, vol: 0.004, dec: 1 },
      { id: 'DEXUSEU', name: 'USD per EUR', level: 1.092, start: 1.066, vol: 0.005, dec: 3 },
    ] },
    { title: 'Commodities', series: [
      { id: 'DCOILWTICO', name: 'WTI crude', level: 68.4, start: 76.9, vol: 0.02, dec: 2, prefix: '$' },
      { id: 'GOLDAMGBD228NLBM', name: 'Gold, London AM fix', level: 3420, start: 1840, vol: 0.009, dec: 0, prefix: '$' },
    ] },
    { title: 'Macro', series: [
      { id: 'DFF', name: 'Effective fed funds rate', level: 4.33, start: 4.33, vol: 0.004, dec: 2, suffix: '%', kind: 'pct', step: true },
      { id: 'CPIAUCSL', name: 'CPI, all urban (index)', level: 325.1, start: 300.5, vol: 0.001, dec: 1 },
      { id: 'UNRATE', name: 'Unemployment rate', level: 4.3, start: 3.5, vol: 0.006, dec: 1, suffix: '%', kind: 'pct', step: true },
    ] },
  ];
  const HIDDEN = [ /* used by Credit / Glance, not in the watchlist */
    { id: 'DFII10', name: '10Y real yield (TIPS)', level: 1.88, start: 1.45, vol: 0.04, dec: 2, suffix: '%', kind: 'pct' },
    { id: 'T10YIE', name: '10Y breakeven inflation', level: 2.42, start: 2.29, vol: 0.02, dec: 2, suffix: '%', kind: 'pct' },
    { id: 'MORTGAGE30US', name: '30-year mortgage', level: 6.35, start: 6.48, vol: 0.02, dec: 2, suffix: '%', kind: 'pct' },
    { id: 'ICSA', name: 'Initial jobless claims', level: 231000, start: 205000, vol: 0.03, dec: 0 },
    { id: 'NFCI', name: 'Chicago Fed NFCI', level: -0.41, start: -0.28, vol: 0.05, dec: 2, add: true },
  ];
  const WATCHLIST = [];
  const META = {};
  SECTIONS.forEach((sec) => {
    if (sec.curve) WATCHLIST.push({ id: 'CURVE', name: 'Treasury yield curve', section: sec.title, curve: true });
    sec.series.forEach((s) => { const m = Object.assign({ section: sec.title }, s); WATCHLIST.push(m); META[s.id] = m; });
  });
  HIDDEN.forEach((s) => { META[s.id] = Object.assign({ section: 'Macro' }, s); });

  /* A random walk that ends at `level` — the last print is the fact, the path is illustration. */
  const CACHE = {};
  function series(id) {
    if (CACHE[id]) return CACHE[id];
    const m = META[id]; const r = mulberry32(hash(id));
    const raw = [m.start]; let v = m.start;
    for (let i = 1; i < N; i++) {
      const shock = (r() - 0.5) * 2 * (m.add ? m.vol : m.vol * Math.abs(v || 1));
      if (m.step) { if (r() < 0.02) v += (r() < 0.5 ? -0.25 : 0.1); } else v += shock;
      raw.push(v);
    }
    /* Bridge so the walk lands on the target level */
    const drift = m.level - raw[N - 1];
    const values = raw.map((x, i) => {
      const w = i / (N - 1); let y = x + drift * w;
      if (m.kind === 'pct' && !m.add && y < 0.05) y = 0.05;
      return m.dec === 0 ? Math.round(y) : y;
    });
    values[N - 1] = m.level;
    return (CACHE[id] = { dates: DATES, values });
  }

  const TIMEFRAMES = [
    { k: '1M', days: 31 }, { k: '3M', days: 92 }, { k: '6M', days: 183 }, { k: 'YTD', ytd: true },
    { k: '1Y', days: 366 }, { k: '5Y', days: 1827 }, { k: 'ALL', days: null },
  ];
  function slice(data, tfKey) {
    const tf = TIMEFRAMES.find((t) => t.k === tfKey) || TIMEFRAMES[6];
    if (!tf.days && !tf.ytd) return data;
    const last = new Date(data.dates[data.dates.length - 1]);
    const cut = tf.ytd ? new Date(Date.UTC(last.getUTCFullYear(), 0, 1)) : new Date(last.getTime() - tf.days * 864e5);
    const iso = cut.toISOString().slice(0, 10);
    let i = 0; while (i < data.dates.length && data.dates[i] < iso) i++;
    if (data.dates.length - i < 2) i = Math.max(0, data.dates.length - 2);
    return { dates: data.dates.slice(i), values: data.values.slice(i) };
  }

  /* ---------- formatting ---------- */
  const fmtNum = (v, dec, pre, suf) => (v == null ? '—' : (pre || '') + Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + (suf || ''));
  const fmtVal = (m, v) => fmtNum(v, m.dec == null ? 2 : m.dec, m.prefix, m.suffix);
  function change(m, sl) {
    const v = sl.values; if (v.length < 2) return null;
    const net = v[v.length - 1] - v[0]; const pct = v[0] !== 0 ? net / Math.abs(v[0]) * 100 : null;
    const dir = net > 0.0001 ? 'up' : net < -0.0001 ? 'down' : 'flat'; const sign = dir === 'up' ? '+' : dir === 'down' ? '−' : '';
    const unit = m.kind === 'pct' ? ' pp' : '';
    return { dir, net, netStr: sign + fmtNum(Math.abs(net), m.dec == null ? 2 : m.dec, m.prefix, unit), pctStr: pct == null ? '' : sign + Math.abs(pct).toFixed(2) + '%' };
  }
  const fmtDate = (iso) => { const [y, mo, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
  const fmtLong = (iso) => { const [y, mo, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- SVG helpers ---------- */
  /* Path-only SVG scaled with preserveAspectRatio=none; labels are HTML so
     they never distort. vector-effect keeps strokes at 1 CSS px. */
  function linePath(values, W, H, lo, hi, pad) {
    pad = pad || 0; const n = values.length; const rng = hi - lo || 1;
    const x = (i) => (i / (n - 1)) * W; const y = (v) => pad + (1 - (v - lo) / rng) * (H - pad * 2);
    return values.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(2) + ',' + y(v).toFixed(2)).join('');
  }
  function spark(values, cls) {
    const W = 100, H = 30; const lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    const p = linePath(values, W, H, lo, hi, 2);
    const last = values[values.length - 1]; const ly = 2 + (1 - (last - lo) / ((hi - lo) || 1)) * (H - 4);
    return '<svg class="spark ' + (cls || '') + '" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">'
      + '<path class="spark-area" d="' + p + 'L100,30L0,30Z"/>'
      + '<path class="spark-line" d="' + p + '" vector-effect="non-scaling-stroke"/>'
      + '<circle class="spark-end" cx="100" cy="' + ly.toFixed(2) + '" r="1.6" vector-effect="non-scaling-stroke"/></svg>';
  }
  function niceTicks(lo, hi, n) {
    const span = hi - lo || 1; const raw = span / (n - 1); const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag; const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6)); return out;
  }
  function bigChart(m, sl, dir) {
    const v = sl.values; const lo0 = Math.min.apply(null, v), hi0 = Math.max.apply(null, v);
    const padv = (hi0 - lo0 || Math.abs(hi0) * 0.02 || 1) * 0.08; const lo = lo0 - padv, hi = hi0 + padv;
    const ticks = niceTicks(lo, hi, 5);
    const W = 1000, H = 300;
    const p = linePath(v, W, H, lo, hi, 0);
    const yPct = (t) => ((1 - (t - lo) / (hi - lo)) * 100).toFixed(2);
    const fmtY = (t) => m.kind === 'pct' ? t.toFixed(2) + '%' : (m.prefix || '') + (Math.abs(t) >= 1000 ? Math.round(t).toLocaleString('en-US') : +t.toFixed(m.dec == null ? 2 : Math.min(m.dec, 2)));
    const xi = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (v.length - 1)));
    const xl = xi.map((i, k) => '<span style="left:' + (k * 25) + '%">' + sl.dates[i].slice(0, 7) + '</span>').join('');
    const grid = ticks.map((t) => '<line x1="0" x2="' + W + '" y1="' + ((1 - (t - lo) / (hi - lo)) * H).toFixed(2) + '" y2="' + ((1 - (t - lo) / (hi - lo)) * H).toFixed(2) + '" vector-effect="non-scaling-stroke"/>').join('');
    const yl = ticks.map((t) => '<span style="top:' + yPct(t) + '%">' + fmtY(t) + '</span>').join('');
    const last = v[v.length - 1]; const ly = ((1 - (last - lo) / (hi - lo)) * H).toFixed(2);
    return '<div class="plot ' + dir + '"><svg viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">'
      + '<g class="plot-grid">' + grid + '</g>'
      + '<path class="plot-area" d="' + p + 'L1000,300L0,300Z"/>'
      + '<path class="plot-line" d="' + p + '" vector-effect="non-scaling-stroke"/>'
      + '<circle class="plot-end" cx="1000" cy="' + ly + '" r="3" vector-effect="non-scaling-stroke"/></svg>'
      + '<div class="plot-y">' + yl + '</div><div class="plot-x">' + xl + '</div></div>';
  }

  /* ---------- static example content ---------- */
  const NEWS = [
    { source: 'Reuters', themes: ['Markets'], when: '12m', title: 'Stocks drift ahead of CPI as Treasury yields hold near 4.3%', summary: 'Index futures were flat in early trade with the S&P 500 near a record; the 10-year sat at 4.30% ahead of Thursday’s inflation print.' },
    { source: 'Bloomberg', themes: ['Rates', 'Macro'], when: '28m', title: 'Fed funds futures price a quarter-point cut at next week’s meeting', summary: 'Markets assign roughly 80% odds to a September cut after August payrolls came in below forecast.' },
    { source: 'FT', themes: ['Equities'], holdings: ['NVDA'], when: '41m', title: 'Nvidia supplier warns of tighter HBM capacity through 2027', summary: 'Memory makers say next-generation high-bandwidth memory is sold out through next year, lifting prices across the supply chain.' },
    { source: 'WSJ', themes: ['Commodities'], when: '1h', title: 'Oil slips below $70 as OPEC+ signals larger October output rise', summary: 'WTI fell 1.4% after delegates said the group would add 550,000 barrels a day next month.' },
    { source: 'CNBC', themes: ['Equities'], holdings: ['ORCL'], when: '1h', title: 'Oracle, Adobe and Copart set to report earnings Thursday', summary: 'Oracle’s cloud backlog and Adobe’s AI pricing will be the two numbers analysts watch.' },
    { source: 'Investing.com', themes: ['Markets'], when: '2h', title: 'Apple debuts foldable phone as services growth slows', summary: '' },
    { source: 'Reuters', themes: ['Macro'], when: '2h', title: 'PPI, jobless claims and oil inventories due Thursday: what to watch', summary: 'A busy calendar before the FOMC blackout lifts.' },
    { source: 'Bloomberg', themes: ['FX'], when: '3h', title: 'Dollar steadies after two-day slide; euro tests $1.09', summary: '' },
    { source: 'MarketWatch', themes: ['Rates'], when: '3h', title: '30-year mortgage rate falls to 6.35%, the lowest since April', summary: 'Refinance applications rose 9% on the week.' },
    { source: 'FT', themes: ['Commodities', 'Macro'], when: '4h', title: 'Gold holds above $3,400 as central banks keep buying', summary: '' },
    { source: 'Reuters', themes: ['Equities'], when: '5h', title: 'AMD and Meta lead megacap movers on Wednesday', summary: '' },
    { source: 'WSJ', themes: ['Markets'], when: '6h', title: 'Treasury buyback update disappoints; long bonds sag', summary: 'The 30-year yield rose four basis points after the auction schedule showed smaller-than-expected buybacks.' },
  ];

  const CATS = { econ: 'Economic data', fed: 'Federal Reserve', earnings: 'Earnings', energy: 'Energy data', market: 'Market hours & expiry' };
  const EVENTS = [
    ['2026-09-07', 'market', 'All day', 'Markets closed · Labor Day', ''],
    ['2026-09-08', 'econ', '6:00 AM', 'NFIB small business optimism', 'August. Consensus 100.4.'],
    ['2026-09-09', 'earnings', 'Before open', '', '13 companies'],
    ['2026-09-09', 'energy', '10:30 AM', 'EIA petroleum inventories', 'Crude and gasoline stockpiles; the weekly supply number that moves oil.'],
    ['2026-09-09', 'earnings', 'Time TBD', '', '16 companies'],
    ['2026-09-09', 'earnings', 'After close', '', '12 companies'],
    ['2026-09-10', 'econ', '8:30 AM', 'CPI, August', 'Headline consensus +0.3% m/m, 2.8% y/y. Core 3.1%.'],
    ['2026-09-10', 'econ', '8:30 AM', 'Initial jobless claims', 'Prior 231,000.'],
    ['2026-09-10', 'energy', '10:30 AM', 'EIA natural gas storage', ''],
    ['2026-09-10', 'earnings', 'After close', '', 'Oracle, Adobe, Copart'],
    ['2026-09-11', 'econ', '8:30 AM', 'PPI, August', ''],
    ['2026-09-11', 'econ', '10:00 AM', 'UMich consumer sentiment', 'Preliminary September.'],
    ['2026-09-11', 'earnings', 'Before open', '', 'Kroger, Hooker Furnishings'],
    ['2026-09-15', 'econ', '8:30 AM', 'Retail sales, August', ''],
    ['2026-09-15', 'earnings', 'Time TBD', '', 'Forgent Power, CoinShares'],
    ['2026-09-16', 'fed', '2:00 PM', 'FOMC rate decision', 'Markets price a 25 bp cut to 4.00–4.25%.'],
    ['2026-09-16', 'fed', '2:30 PM', 'Powell press conference', ''],
    ['2026-09-16', 'energy', '10:30 AM', 'EIA petroleum inventories', ''],
    ['2026-09-17', 'econ', '8:30 AM', 'Initial jobless claims', ''],
    ['2026-09-17', 'econ', '8:30 AM', 'Philadelphia Fed survey', ''],
    ['2026-09-17', 'earnings', 'After close', '', 'FedEx, Lennar'],
    ['2026-09-18', 'market', 'At the close', 'Triple witching — options and futures expire', ''],
    ['2026-09-22', 'earnings', 'Before open', '', 'AutoZone, MillerKnoll'],
    ['2026-09-23', 'energy', '10:30 AM', 'EIA petroleum inventories', ''],
    ['2026-09-23', 'earnings', 'After close', '', 'Micron, Cintas'],
    ['2026-09-24', 'econ', '8:30 AM', 'GDP, Q2 third estimate', ''],
    ['2026-09-24', 'econ', '8:30 AM', 'Durable goods orders', ''],
    ['2026-09-24', 'earnings', 'After close', '', 'Costco, Accenture'],
    ['2026-09-25', 'econ', '8:30 AM', 'PCE inflation, August', 'The Fed’s preferred gauge.'],
    ['2026-09-29', 'econ', '10:00 AM', 'Consumer confidence', ''],
    ['2026-09-29', 'econ', '10:00 AM', 'JOLTS job openings', ''],
    ['2026-09-30', 'econ', '8:15 AM', 'ADP employment', ''],
    ['2026-09-30', 'earnings', 'After close', '', 'Nike, Paychex'],
    ['2026-10-01', 'econ', '10:00 AM', 'ISM manufacturing', ''],
    ['2026-10-01', 'energy', '10:30 AM', 'EIA natural gas storage', ''],
    ['2026-10-02', 'econ', '8:30 AM', 'Jobs report, September', 'Consensus +95,000; unemployment 4.3%.'],
  ].map((e) => ({ date: e[0], cat: e[1], time: e[2], name: e[3], note: e[4] }));
  const SESSION = { 'Before open': ['☀', 'before the open', 'pre-open'], 'After close': ['☾', 'after the close', 'post-close'] };

  const EARN = {
    'Before open': [
      ['SAIL', 'SailPoint', 10e9, 'Technology', '$0.08', true, true], ['CHWY', 'Chewy', 10e9, 'Consumer Discretionary', '$0.18'],
      ['CNM', 'Core & Main', 9e9, 'Industrials', '$0.91'], ['KFY', 'Korn Ferry', 4e9, 'Industrials', '$1.35'],
      ['SIG', 'Signet Jewelers', 3e9, 'Consumer Discretionary', '$1.69'], ['ASO', 'Academy Sports', 3e9, 'Consumer Discretionary', '$2.04'],
      ['PLAY', 'Dave & Buster’s', 1e9, 'Consumer Discretionary', '$0.92'], ['CAL', 'Caleres', 0.6e9, 'Consumer Discretionary', '$0.71'],
      ['LOVE', 'Lovesac', 0.4e9, 'Consumer Discretionary', '−$0.34'], ['HOFT', 'Hooker Furnishings', 0.1e9, 'Consumer Discretionary', '$0.12'],
      ['UNFI', 'United Natural Foods', 1.5e9, 'Consumer Staples', '$0.28'], ['FCEL', 'FuelCell Energy', 0.2e9, 'Industrials', '−$1.44'],
      ['MAMA', 'Mama’s Creations', 0.3e9, 'Consumer Staples', '$0.03'],
    ],
    'Time TBD': [
      ['SBSW', 'Seabridge Gold', 2e9, 'Basic Materials', '—'], ['ANAB', 'AnaptysBio', 0.9e9, 'Health Care', '−$1.02'],
      ['GRFS', 'Grifols', 7e9, 'Health Care', '$0.19'], ['KRYS', 'Krystal Biotech', 5e9, 'Health Care', '$1.31'],
      ['NCNO', 'nCino', 3e9, 'Technology', '$0.20', true, true], ['DOMO', 'Domo', 0.5e9, 'Technology', '$0.04', true, true],
      ['CPRT', 'Copart', 45e9, 'Industrials', '$0.42'], ['AVAV', 'AeroVironment', 6e9, 'Industrials', '$0.60'],
    ],
    'After close': [
      ['ORCL', 'Oracle', 650e9, 'Technology', '$1.48', true, true], ['ADBE', 'Adobe', 170e9, 'Technology', '$5.18', true, true],
      ['AI', 'C3.ai', 3e9, 'Technology', '−$0.37', true, true], ['SMTC', 'Semtech', 4e9, 'Technology', '$0.40', true],
      ['OXM', 'Oxford Industries', 0.8e9, 'Consumer Discretionary', '$1.22'], ['RH', 'RH', 4e9, 'Consumer Discretionary', '$2.10'],
      ['MTN', 'Vail Resorts', 6e9, 'Consumer Discretionary', '−$4.70'], ['GEF', 'Greif', 3e9, 'Industrials', '$1.05'],
      ['SFIX', 'Stitch Fix', 0.5e9, 'Consumer Discretionary', '−$0.05'], ['MIND', 'MIND Technology', 0.1e9, 'Technology', '$0.15', true],
      ['PATH', 'UiPath', 7e9, 'Technology', '$0.11', true, true], ['CASY', 'Casey’s', 15e9, 'Consumer Staples', '$4.62'],
    ],
  };
  const fmtCap = (n) => n >= 1e12 ? '$' + (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? '$' + Math.round(n / 1e9) + 'B' : '$' + Math.round(n / 1e6) + 'M';
  const SHORT = { 'Consumer Discretionary': 'Consumer Disc.', 'Basic Materials': 'Materials', 'Telecommunications': 'Telecom' };
  const shortSec = (s) => SHORT[s] || s;

  const ALERT_SOURCES = [
    { id: 'drops', title: 'Drop alerts', running: true, active: true, pollMs: 2000, idleMs: 60000,
      summary: 'SPY −0.36% · nothing fired today', rule: 'Texts when SPY falls 1%, 2% or 3% from the prior close',
      facts: [['Pinned', 'SPY'], ['Context', 'SSO · SPXL · SPYU']], src: { polls: 11842, lastOk: '2s', latencyMs: 84, errors: 0 },
      actions: [['test', 'Send a test text'], ['rearm', 'Re-arm today']],
      symbols: [
        { symbol: 'SPY', label: 'SPY', kind: 'index', last: 639.42, pct: -0.0036, thresholds: [1, 2, 3], fired: {}, next: 1, toNext: 4.09 },
        { symbol: 'SSO', name: 'ProShares Ultra S&P 500', last: 108.15, pct: -0.0071, context: true },
        { symbol: 'SPXL', name: 'Direxion Daily S&P 500 Bull 3x', last: 196.02, pct: -0.0108, context: true },
        { symbol: 'SPYU', name: 'MAX S&P 500 4x Leveraged', last: 61.7, pct: -0.0144, context: true },
      ],
      log: [
        { at: 'Sep 4 · 2:41:07 PM', tag: 'sent', ms: 1180, text: 'SPY −1.02% · 632.15\nprior close 638.66\nSSO −2.1% · SPXL −3.0% · SPYU −4.1%' },
        { at: 'Sep 2 · 9:31:12 AM', tag: 'test', ms: 940, text: 'Test from the drop tracker. Delivery OK.' },
      ] },
    { id: 'fda', title: 'FDA approvals', running: true, active: true, pollMs: 1000, idleMs: 10000,
      summary: 'no approvals today · watching', rule: 'Texts within a second of the FDA announcing an approval, with the ticker when it resolves',
      facts: [['Feed', 'FDA press releases'], ['Resolves via', 'ClinicalTrials.gov → openFDA → SEC']], src: { polls: 28031, lastOk: '1s', latencyMs: 56, errors: 0 },
      actions: [['test', 'Replay last approval']],
      log: [
        { at: 'Sep 3 · 10:02:44 AM', tag: 'sent', ms: 1044, text: 'FDA approves TREGZI (tegoprubart)\nsponsor Eledon → ELDN' },
        { at: 'Sep 3 · 10:02:45 AM', tag: 'follow-up', ms: 92, text: 'ELDN — ticker resolved in 92ms' },
      ] },
    { id: 'crash', title: 'Insider crash buys', running: true, active: true, pollMs: 60000, idleMs: 600000,
      summary: 'armed — no qualifying cluster yet', rule: 'Texts when a stock down ≥60% over 21 sessions has two or more insiders buying within 7 days',
      facts: [['Backtest', '+9.8% vs market next month · n 192 · 2006–25']], src: { polls: 412, lastOk: '38s', latencyMs: 210, errors: 0 },
      actions: [['tick', 'Poll now']], log: [] },
  ];

  const GLOSSARY = [
    ['Yield curve', 'Treasury yields across maturities (3M to 30Y). Its slope hints at growth and Fed expectations.'],
    ['Basis point (bp)', 'One hundredth of a percentage point. 0.25% equals 25 basis points.'],
    ['Inverted curve', 'Short-term yields above long-term yields. Historically a recession warning.'],
    ['2s10s spread', 'The 10-year yield minus the 2-year yield. Negative means inverted.'],
    ['Credit spread', 'The extra yield corporate bonds pay over Treasuries. Wider means more perceived risk.'],
    ['IG vs high yield', 'IG is higher-rated and safer; HY (junk) is lower-rated, riskier, higher-yielding.'],
    ['VIX', 'Expected 30-day volatility for the S&P 500. Low is calm, high is fear.'],
    ['Real yield', 'A Treasury yield after subtracting expected inflation, read from TIPS.'],
    ['Breakeven inflation', 'The bond market’s expected average inflation: nominal yield minus real yield.'],
    ['Fed funds rate', 'The overnight rate the Fed sets; the anchor for short-term rates.'],
  ];

  const INSIGHTS = {
    default: 'The 10-year has drifted 15 bp higher over the year while the 2-year fell 60 bp, so the curve un-inverted from the front end rather than from the long end. That is the pattern of a market pricing cuts, not one pricing a slowdown. High-yield spreads at 3.12% are inside their 20-year median; nothing in credit is arguing with equities yet.',
    SP500: 'The S&P 500 is up 66% since the start of 2023 and 1.9% on the month, with the VIX at 15.8. Breadth has narrowed: the equal-weight index lags by 4 points year to date. The next catalyst is Thursday’s CPI, then the FOMC on the 16th.',
    credit: 'Curve upward-sloping, HY spreads unremarkable, financial conditions loose. Of the three, conditions are the one to watch: an NFCI of −0.41 is looser than 80% of history, which is where late-cycle complacency tends to live.',
  };

  /* ---------- state ---------- */
  const VIEWS = [
    { id: 'markets', label: 'Markets', group: 'market' }, { id: 'credit', label: 'Credit & Rates', group: 'market' },
    { id: 'calendar', label: 'Calendar', group: 'market' }, { id: 'news', label: 'Newswire', group: 'market' },
    { id: 'learn', label: 'Learn', group: 'market' }, { id: 'alerts', label: 'Alerts', group: 'alerts' },
  ];
  const GROUPS = [{ id: 'market', label: 'Market' }, { id: 'alerts', label: 'Alerts' }];
  const S = {
    view: (location.hash || '').slice(1) || 'markets', symbol: 'SP500', tf: '1Y', featuredTf: '1Y',
    wlFilter: '', pickerOpen: false, pickerQ: '', calSel: '2026-09-09', calHidden: {}, earnPicked: {}, earningsMax: false,
    newsTheme: 'All', bookOnly: false, alertsOpen: {}, learnMode: 'quiz', learnSession: null,
    insight: null, insightDone: false, glanceOpen: true, chat: [],
  };
  if (!VIEWS.some((v) => v.id === S.view)) S.view = 'markets';

  /* ---------- renderers ---------- */
  function navHTML() {
    const cur = VIEWS.find((v) => v.id === S.view);
    return '<div class="brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v5h-5"/></svg></span><span class="brand-name">Markets</span></div>'
      + '<nav class="groups" aria-label="Sections">' + GROUPS.map((g) => '<div class="group' + (g.id === cur.group ? ' is-active' : '') + (VIEWS.filter((v) => v.group === g.id).length === 1 ? ' is-single' : '') + '" data-group="' + g.id + '"><div class="group-label">' + g.label + '</div><div class="group-links">'
        + VIEWS.filter((v) => v.group === g.id).map((v) => '<button type="button" class="navlink' + (v.id === S.view ? ' is-active' : '') + '" data-action="view" data-view="' + v.id + '" ' + (v.id === S.view ? 'aria-current="page"' : '') + '><span class="navlink-dot" aria-hidden="true"></span>' + v.label + '</button>').join('')
        + '</div></div>').join('') + '</nav>'
      + '<div class="nav-tools"><span class="session is-open"><i class="session-dot" aria-hidden="true"></i><span class="session-text">Market hours · <b>1h 18m</b> to close</span></span>'
      + '<button type="button" class="ibtn" data-action="refresh" title="Refresh everything" aria-label="Refresh all data"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg></button>'
      + '<button type="button" class="ibtn" data-action="theme" title="Toggle light / dark" aria-label="Toggle theme"><span class="theme-glyph" aria-hidden="true"></span></button>'
      + '<span class="acct">FRED<span class="acct-caret" aria-hidden="true">▾</span></span></div>';
  }

  function tfRow(value, action) {
    return '<div class="tf" role="group" aria-label="Time range">' + TIMEFRAMES.map((t) => '<button type="button" class="tf-btn' + (t.k === value ? ' is-active' : '') + '" data-action="' + action + '" data-tf="' + t.k + '" aria-pressed="' + (t.k === value) + '">' + t.k + '</button>').join('') + '</div>';
  }

  function glanceHTML() {
    const L = (id) => META[id].level;
    const sp = series('SP500').values; const spPct = (sp[sp.length - 1] / sp[0] - 1) * 100; const spm = (sp[sp.length - 1] / sp[sp.length - 22] - 1) * 100;
    const cpi = 2.7; const tenM = series('DGS10').values; const bp = Math.round((tenM[tenM.length - 1] - tenM[tenM.length - 22]) * 100);
    const J = (id, t) => '<a class="jump" href="#" data-action="pick" data-symbol="' + id + '">' + t + '</a>';
    const read = 'With fed funds at ' + J('DFF', '4.33%') + ', the Treasury curve is <strong>upward sloping</strong> (2s10s ' + J('T10Y2Y', '+0.52 pp') + ') and the 10Y sits at ' + J('DGS10', '4.30%') + (bp ? ', ' + (bp > 0 ? 'up' : 'down') + ' ' + Math.abs(bp) + ' bp over the past month' : '') + '. Equities are ' + J('SP500', 'up ' + spPct.toFixed(0) + '% since 2023') + ' (' + J('SP500', (spm >= 0 ? '+' : '') + spm.toFixed(1) + '% on the month') + ') against a VIX of ' + J('VIXCLS', '15.8') + '. Inflation is ' + J('CPIAUCSL', cpi.toFixed(1) + '%') + ' YoY while unemployment holds at ' + J('UNRATE', '4.3%') + '. Credit spreads sit at ' + J('BAMLC0A0CM', 'IG 0.94%') + ' and ' + J('BAMLH0A0HYM2', 'HY 3.12%') + ', with WTI near ' + J('DCOILWTICO', '$68') + '.';
    const tiles = [
      ['Fed funds', 'DFF', '4.33%', '', 'flat', 64], ['10-yr Treasury', 'DGS10', '4.30%', '+15 bp 1y', 'up', 71],
      ['2s10s curve', 'T10Y2Y', '+0.52 pp', 'normal', 'up', 92], ['S&P 500', 'SP500', Math.round(L('SP500')).toLocaleString('en-US'), '+' + spPct.toFixed(0) + '% since ’23', 'up', 99],
      ['VIX', 'VIXCLS', '15.8', 'calm', 'flat', 18], ['CPI YoY', 'CPIAUCSL', '2.7%', '−0.2 pp 1y', 'down', 30],
      ['Unemployment', 'UNRATE', '4.3%', '+0.1 pp 1y', 'down', 88], ['Broad dollar', 'DTWEXBGS', '121.4', '−3.1% 1y', 'down', 22],
    ];
    const head = (NEWS.filter((n) => n.themes.some((t) => t !== 'Markets')).slice(0, 4));
    return '<div class="glance card" id="glance"><div class="card-h"><span class="card-t">At a glance</span><span class="card-sub">' + fmtDate('2026-09-08') + ' · illustrative data</span></div>'
      + '<div class="card-b"><p class="read">' + read + '</p>'
      + '<div class="tiles">' + tiles.map((t) => '<a class="tile' + (t[1] === S.symbol ? ' is-sel' : '') + '" href="#" data-action="pick" data-symbol="' + t[1] + '"><span class="tile-l">' + t[0] + '</span><span class="tile-n">' + t[2] + '</span><span class="tile-d ' + t[4] + '">' + (t[3] || '&nbsp;') + '</span><span class="tile-bar" title="' + t[5] + '% of its 2023-to-now range"><i style="width:' + t[5] + '%"></i></span></a>').join('') + '</div>'
      + '<div class="news-mini"><span class="kicker">In the news</span>' + head.map((n) => '<a class="news-mini-item" href="#"><span class="src">' + n.source + '</span><span class="tag">' + n.themes[0] + '</span><span class="news-mini-t">' + esc(n.title) + '</span></a>').join('') + '</div></div></div>';
  }

  function watchlistHTML() {
    const q = S.wlFilter.trim().toLowerCase(); let idx = 0; const groups = [];
    WATCHLIST.forEach((s) => { idx++; if (q && !(s.id + ' ' + s.name).toLowerCase().includes(q)) return; const g = groups[groups.length - 1]; if (!g || g.section !== s.section) groups.push({ section: s.section, rows: [] }); groups[groups.length - 1].rows.push({ s, idx }); });
    const rows = groups.map((g) => '<div class="wl-group">' + g.section + '</div>' + g.rows.map(({ s, idx }) => {
      if (s.curve) return '<div class="wl-row' + (S.symbol === 'CURVE' ? ' is-sel' : '') + '" role="option" tabindex="0" data-action="pick" data-symbol="CURVE" aria-selected="' + (S.symbol === 'CURVE') + '"><span class="wl-idx">' + idx + '</span><span class="wl-name"><span class="wl-sym">CURVE</span><span class="wl-desc">Treasury yield curve</span></span><span class="wl-val">3M–30Y</span><span class="wl-chg flat"></span><span class="wl-spark"></span></div>';
      const d = series(s.id); const sl = slice(d, '1Y'); const ch = change(s, { values: d.values.slice(-2) });
      return '<div class="wl-row' + (S.symbol === s.id ? ' is-sel' : '') + '" role="option" tabindex="0" data-action="pick" data-symbol="' + s.id + '" aria-selected="' + (S.symbol === s.id) + '"><span class="wl-idx">' + idx + '</span><span class="wl-name"><span class="wl-sym">' + s.id + '</span><span class="wl-desc">' + s.name + '</span></span><span class="wl-val">' + fmtVal(s, s.level) + '</span><span class="wl-chg ' + ch.dir + '">' + (ch.pctStr || '0.00%') + '</span><span class="wl-spark ' + ch.dir + '">' + spark(sl.values.filter((_, i) => i % 4 === 0)) + '</span></div>';
    }).join('')).join('');
    return '<div class="card wl" id="watchlist"><div class="card-h"><span class="card-t">Watchlist</span><input class="filter" type="text" value="' + esc(S.wlFilter) + '" placeholder="Filter" aria-label="Filter watchlist" data-action="wlfilter"></div>'
      + '<div class="card-b flush"><div class="wl-head"><span>#</span><span>Symbol</span><span>Last</span><span>Chg</span><span>1Y</span></div><div role="listbox" aria-label="Symbols">' + (rows || '<div class="empty">No match.</div>') + '</div></div></div>';
  }

  function featuredHTML() {
    const m = META.SP500; const sl = slice(series('SP500'), S.featuredTf); const ch = change(m, sl);
    return '<div class="card featured" id="featured"><div class="card-h"><span class="card-t">S&P 500</span><span class="card-id">SP500</span></div><div class="card-b">'
      + '<div class="big"><span class="big-val">' + fmtVal(m, m.level) + '</span><span class="big-chg ' + ch.dir + '">' + ch.netStr + ' (' + ch.pctStr + ') ' + S.featuredTf + '</span></div>'
      + '<div class="featured-spark ' + ch.dir + '">' + spark(sl.values.filter((_, i, a) => a.length < 140 || i % Math.ceil(a.length / 140) === 0)) + '</div>' + tfRow(S.featuredTf, 'ftf') + '</div></div>';
  }

  function pickerHTML() {
    const cur = WATCHLIST.find((w) => w.id === S.symbol);
    const q = S.pickerQ.trim().toLowerCase();
    const list = WATCHLIST.filter((w) => !q || (w.id + ' ' + w.name + ' ' + w.section).toLowerCase().includes(q));
    return '<div class="picker"><button type="button" class="picker-btn" data-action="picker" aria-haspopup="listbox" aria-expanded="' + S.pickerOpen + '"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg><span class="picker-sym">' + cur.id + '</span><span class="picker-caret" aria-hidden="true">▾</span></button>'
      + (S.pickerOpen ? '<div class="picker-menu"><input class="picker-search" type="text" value="' + esc(S.pickerQ) + '" placeholder="Search symbol or name…" aria-label="Search symbol" data-action="pickerq" autofocus><div class="picker-list" role="listbox">' + (list.length ? list.map((w) => '<div class="picker-opt' + (w.id === S.symbol ? ' is-cur' : '') + '" role="option" aria-selected="' + (w.id === S.symbol) + '" data-action="pick" data-symbol="' + w.id + '"><span class="picker-id">' + w.id + '</span><span class="picker-name">' + w.name + '</span><span class="picker-sec">' + w.section + '</span></div>').join('') : '<div class="empty">No match.</div>') + '</div></div>' : '') + '</div>'
      + '<button type="button" class="ibtn sm" data-action="step" data-dir="-1" aria-label="Previous symbol">‹</button><button type="button" class="ibtn sm" data-action="step" data-dir="1" aria-label="Next symbol">›</button>';
  }

  function curvePts(offsetDays) {
    const ids = ['DGS3MO', 'DGS1', 'DGS2', 'DGS5', 'DGS7', 'DGS10', 'DGS30']; const labels = ['3M', '1Y', '2Y', '5Y', '7Y', '10Y', '30Y'];
    return ids.map((id, i) => { const d = series(id); const k = Math.max(0, d.values.length - 1 - Math.round(offsetDays / 7 * 5)); return { label: labels[i], v: d.values[k] }; });
  }
  function curveChartHTML(snaps) {
    const W = 1000, H = 300; const all = snaps.flatMap((s) => s.pts.map((p) => p.v)); const lo = Math.min.apply(null, all) - 0.15, hi = Math.max.apply(null, all) + 0.15;
    const x = (i) => (i / 6) * W; const y = (v) => (1 - (v - lo) / (hi - lo)) * H;
    const ticks = niceTicks(lo, hi, 4);
    const paths = snaps.slice().reverse().map((s) => '<path class="curve-line ' + s.cls + '" d="' + s.pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p.v).toFixed(1)).join('') + '" vector-effect="non-scaling-stroke"/>').join('');
    const dots = snaps[0].pts.map((p, i) => '<circle class="curve-dot" cx="' + x(i).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="3" vector-effect="non-scaling-stroke"/>').join('');
    return '<div class="curve-legend">' + snaps.map((s) => '<span class="lg"><i class="lg-sw ' + s.cls + '"></i>' + s.label + '</span>').join('') + '</div>'
      + '<div class="plot curve"><svg viewBox="0 0 1000 300" preserveAspectRatio="none" aria-label="Treasury yield curve, today against its own history" role="img"><g class="plot-grid">' + ticks.map((t) => '<line x1="0" x2="1000" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" vector-effect="non-scaling-stroke"/>').join('') + '</g>' + paths + dots + '</svg>'
      + '<div class="plot-y">' + ticks.map((t) => '<span style="top:' + ((1 - (t - lo) / (hi - lo)) * 100).toFixed(2) + '%">' + t.toFixed(1) + '%</span>').join('') + '</div>'
      + '<div class="plot-x">' + snaps[0].pts.map((p, i) => '<span style="left:' + (i / 6 * 100).toFixed(2) + '%">' + p.label + '</span>').join('') + '</div></div>';
  }

  function chartHTML() {
    const s = WATCHLIST.find((w) => w.id === S.symbol);
    let meta, stats, plot, insightId, insightTitle, insightMeta;
    if (s.curve) {
      const snaps = [{ label: 'today', cls: 'c-now', pts: curvePts(0) }];
      const shape = snaps[0].pts[6].v - snaps[0].pts[0].v;
      meta = '<span class="cm-val">' + (shape >= 0 ? '+' : '−') + Math.abs(shape).toFixed(2) + ' pp</span><span class="cm-chg ' + (shape < 0 ? 'down' : 'up') + '">' + (shape < 0 ? 'Inverted' : 'Upward sloping') + '</span><span class="cm-name">U.S. Treasury yield curve · 30Y minus 3M</span>';
      stats = snaps[0].pts.map((p) => cell(p.label, p.v.toFixed(2) + '%')).join('') + cell('As of', fmtDate('2026-09-08'));
      plot = curveChartHTML(snaps); insightId = 'curve'; insightTitle = 'U.S. Treasury yield curve'; insightMeta = 'Yield curve · 3M to 30Y';
    } else {
      const d = series(s.id); const sl = slice(d, S.tf); const ch = change(s, sl);
      meta = '<span class="cm-val">' + fmtVal(s, s.level) + '</span><span class="cm-chg ' + ch.dir + '">' + ch.netStr + ' (' + ch.pctStr + ') ' + S.tf + '</span><span class="cm-name">' + s.name + '</span>' + (s.units ? '<span class="cm-units">' + s.units + '</span>' : '');
      const per = [['1D', 1], ['1W', 5], ['1M', 21], ['YTD', null]];
      stats = per.map(([l, n]) => { const sub = n ? { values: d.values.slice(-(n + 1)) } : slice(d, 'YTD'); const c = change(s, sub); return cell(l, c ? (c.netStr + (c.pctStr ? ' · ' + c.pctStr : '')) : '—', c && c.dir); }).join('');
      const lo = Math.min.apply(null, d.values), hi = Math.max.apply(null, d.values); const rng = Math.round((s.level - lo) / ((hi - lo) || 1) * 100);
      stats += cell('Range', rng + '%', null, 'Where the latest value sits in its 2023-to-now range') + cell('As of', fmtDate('2026-09-08'));
      plot = bigChart(s, sl, ch.dir); insightId = s.id; insightTitle = s.name; insightMeta = s.section + ' · ' + s.id;
    }
    return '<div class="card chart" id="chart"><div class="card-h">' + pickerHTML() + '</div><div class="card-b flush"><div class="chart-stage">'
      + '<div class="chart-meta">' + meta + '</div><div class="chart-stats">' + stats + '</div><div class="chart-main">' + plot + '</div>'
      + '<div class="chart-foot">' + (s.curve ? '<span class="muted small">Cross-section · no time range</span>' : tfRow(S.tf, 'tf')) + '<button type="button" class="insight-btn' + (S.insight === insightId ? ' is-on' : '') + '" data-action="insight" data-id="' + insightId + '" data-title="' + esc(insightTitle) + '" data-meta="' + esc(insightMeta) + '" aria-pressed="' + (S.insight === insightId) + '">✦ Insights</button></div></div></div></div>';
  }
  const cell = (l, v, dir, title) => '<div class="cs-cell"' + (title ? ' title="' + esc(title) + '"' : '') + '><span class="cs-l">' + l + '</span><span class="cs-v' + (dir ? ' ' + dir : '') + '">' + v + '</span></div>';

  function insightHTML(hideIdle) {
    if (!S.insight) return hideIdle ? '' : '<div class="card insight" id="insight"><div class="card-h"><span class="card-t">Insight</span></div><div class="card-b"><p class="muted">Press <strong>✦ Insights</strong> anywhere it appears and Claude’s briefing lands here.</p></div></div>';
    const text = INSIGHTS[S.insight] || INSIGHTS.default;
    return '<div class="card insight is-live" id="insight"><div class="card-h"><span class="card-t">Insight</span><button type="button" class="ibtn sm" data-action="insight-clear" aria-label="Clear insight">×</button></div><div class="card-b">'
      + '<div class="kicker">' + esc(S.insightMeta || '') + '</div><div class="insight-head">' + esc(S.insightTitle || '') + '</div>'
      + (S.insightDone ? '<div class="insight-body">' + text + '</div>' : '<div class="thinking">Claude is thinking<span class="dots"><span></span><span></span><span></span></span></div>')
      + '<div class="insight-recent"><button type="button" class="recent-toggle" aria-expanded="false"><span class="caret" aria-hidden="true">›</span>Recent insights<span class="count">2</span></button></div></div></div>';
  }

  function marketsHTML() {
    return '<section class="view view-markets" aria-label="Markets">' + glanceHTML() + '<div class="mk-grid">' + watchlistHTML() + featuredHTML() + chartHTML() + insightHTML(false) + '</div></section>';
  }

  /* ---------- Credit & Rates ---------- */
  function sparkSVG(id, months, zero) {
    const d = series(id); const n = Math.round(months * 21.7); const v = d.values.slice(-n).filter((_, i) => i % 3 === 0);
    const lo = zero ? Math.min(0, Math.min.apply(null, v)) : Math.min.apply(null, v); const hi = Math.max.apply(null, v);
    const p = linePath(v, 100, 30, lo, hi, 2);
    const z = zero && lo < 0 ? '<line class="spark-zero" x1="0" x2="100" y1="' + (2 + (1 - (0 - lo) / (hi - lo)) * 26).toFixed(2) + '" y2="' + (2 + (1 - (0 - lo) / (hi - lo)) * 26).toFixed(2) + '" vector-effect="non-scaling-stroke"/>' : '';
    return '<svg class="spark big" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="History, ' + months + ' months">' + z + '<path class="spark-area" d="' + p + 'L100,30L0,30Z"/><path class="spark-line" d="' + p + '" vector-effect="non-scaling-stroke"/></svg>';
  }
  function creditHTML() {
    const snaps = [
      { label: 'today', cls: 'c-now', pts: curvePts(0) }, { label: '3 months ago', cls: 'c-h1', pts: curvePts(91) },
      { label: '1 year ago', cls: 'c-h2', pts: curvePts(365) }, { label: '2 years ago', cls: 'c-h3', pts: curvePts(730) },
    ];
    const tile = (l, v, sub, tone) => '<div class="rtile"><span class="rtile-l">' + l + '</span><span class="rtile-v' + (tone ? ' ' + tone : '') + '">' + v + '</span>' + (sub ? '<span class="rtile-s">' + sub + '</span>' : '') + '</div>';
    const row = (a, b, c, d) => '<tr><td class="l">' + a + '</td><td>' + b + '</td><td>' + c + '</td><td>' + d + '</td></tr>';
    return '<section class="view view-credit" aria-label="Credit & Rates">'
      + '<div class="flag"><strong>The read.</strong> The curve is <b>upward-sloping</b> (10Y−2Y +0.52 pp), high-yield spreads look <b>unremarkable</b> at 3.12%, and financial conditions are <b>loose</b> (NFCI −0.41). Those are descriptions of today’s data, not a forecast.</div>'
      + '<div class="insight-row"><button type="button" class="insight-btn' + (S.insight === 'credit' ? ' is-on' : '') + '" data-action="insight" data-id="credit" data-title="The regime" data-meta="as of Sep 8, 2026" aria-pressed="' + (S.insight === 'credit') + '">✦ Insights</button>' + (S.insight === 'credit' ? insightHTML(true) : '') + '</div>'
      + '<div class="rstrip">' + tile('10Y − 2Y', '+0.52 pp', 'upward-sloping') + tile('10Y − 3M', '+0.21 pp', 'the recession-signal version') + tile('HY spread', '3.12%', 'IG 0.94%') + tile('HY − IG', '+2.18 pp', 'a year ago +3.43 pp') + tile('HY / IG ratio', '3.32×', 'stress widens the ratio, not just the gap') + tile('Fed funds', '4.33%', '30y mortgage 6.35%') + '</div>'
      + '<div class="band band-2"><div class="card"><div class="card-h"><span class="card-t">Treasury curve — today vs its own history</span></div><div class="card-b flush">' + curveChartHTML(snaps) + '<p class="foot">Tenors are spaced by rank, not by years: on a linear year axis the 3M through 2Y points — where the information is — collapse into the left margin. As of Sep 8, 2026.</p></div></div>'
      + '<div class="card"><div class="card-h"><span class="card-t">The 10-year, decomposed</span></div><div class="card-b flush"><table class="tbl"><thead><tr><th class="l">Component</th><th>Now</th><th>1y ago</th><th>Change</th></tr></thead><tbody>' + row('Nominal 10Y', '4.30%', '4.15%', '<span class="up">+0.15 pp</span>') + row('Real yield (TIPS)', '1.88%', '1.74%', '<span class="up">+0.14 pp</span>') + row('Breakeven inflation', '2.42%', '2.41%', '+0.01 pp') + '</tbody></table><p class="foot">Real + breakeven ≈ nominal, so the two rows below the first say why the 10-year moved: a real-yield move is the market repricing growth or Fed policy, a breakeven move is it repricing inflation. Over the last year the split is +0.14 pp real against +0.01 pp breakeven.</p></div></div></div>'
      + '<div class="band band-3">'
      + '<div class="card"><div class="card-h"><span class="card-t">High yield OAS</span></div><div class="card-b flush"><div class="spark-pad">' + sparkSVG('BAMLH0A0HYM2', 24) + '</div><p class="foot">24 months. Now 3.12%, a year ago 3.61%.</p></div></div>'
      + '<div class="card"><div class="card-h"><span class="card-t">Financial conditions (NFCI)</span></div><div class="card-b flush"><div class="spark-pad">' + sparkSVG('NFCI', 24, true) + '</div><p class="foot">Zero is the historical average; positive is tighter than normal. Now −0.41 — loose.</p></div></div>'
      + '<div class="card"><div class="card-h"><span class="card-t">Initial jobless claims</span></div><div class="card-b flush"><div class="spark-pad">' + sparkSVG('ICSA', 24) + '</div><p class="foot">Now 231,000, a year ago 219,000. The fastest-moving labour reading there is, and the one credit turns on.</p></div></div></div>'
      + '<details class="sources"><summary>Sources <span class="count">8</span></summary><ul><li><span class="src-kind">Live feed</span>FRED — DGS3MO, DGS1, DGS2, DGS5, DGS7, DGS10, DGS30</li><li><span class="src-kind">Live feed</span>FRED — BAMLH0A0HYM2, BAMLC0A0CM, DFII10, T10YIE</li><li><span class="src-kind">Live feed</span>FRED — NFCI, ICSA, DFF, MORTGAGE30US</li><li><span class="src-kind">Computed here</span>10Y−2Y, 10Y−3M, HY−IG, HY/IG</li></ul></details>'
      + '<p class="note">Every series here is FRED, through the gateway’s existing proxy. Per-issuer credit — a debt maturity wall, interest coverage by year — needs XBRL debt schedules the platform does not extract yet. This surface is the macro half only.</p></section>';
  }

  /* ---------- Calendar ---------- */
  function calendarHTML() {
    const start = new Date(Date.UTC(2026, 8, 7)); const days = [];
    for (let i = 0; i < 28; i++) { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); days.push(d.toISOString().slice(0, 10)); }
    const visible = (e) => !S.calHidden[e.cat]; const evsFor = (day) => EVENTS.filter((e) => e.date === day && visible(e));
    const sel = S.calSel; const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const legend = Object.keys(CATS).map((c) => '<button type="button" class="leg cat-' + c + (S.calHidden[c] ? ' is-off' : '') + '" data-action="cat" data-cat="' + c + '" aria-pressed="' + !S.calHidden[c] + '"><i class="cdot" aria-hidden="true"></i>' + CATS[c] + '</button>').join('');
    const grid = WD.map((w) => '<div class="cv-wd">' + w + '</div>').join('') + days.map((day) => {
      const evs = evsFor(day); const today = day === '2026-09-09';
      return '<div class="cv-day' + (today ? ' is-today' : '') + (day === sel ? ' is-sel' : '') + '" data-action="day" data-day="' + day + '" role="button" tabindex="0"><div class="cv-num">' + Number(day.slice(-2)) + (today ? '<span class="cv-today">Today</span>' : '') + '</div>'
        + evs.slice(0, 3).map((ev) => '<div class="cv-chip cat-' + ev.cat + '"><span class="cv-t">' + (SESSION[ev.time] ? SESSION[ev.time][0] : ev.time.replace(' AM', '').replace(' PM', 'p')) + '</span><i class="cdot" aria-hidden="true"></i><span class="cv-n">' + esc(ev.cat === 'earnings' ? ev.note : ev.name) + '</span></div>').join('')
        + (evs.length > 3 ? '<div class="cv-more">+' + (evs.length - 3) + ' more</div>' : '') + '</div>';
    }).join('');
    const detail = evsFor(sel);
    const det = detail.length ? detail.map((ev) => '<div class="det cat-' + ev.cat + '"><div class="det-time"><span class="det-big">' + (SESSION[ev.time] ? SESSION[ev.time][0] : ev.time.split(' ')[0]) + '</span><span class="det-sub">' + (SESSION[ev.time] ? SESSION[ev.time][2] : ev.time.includes('M') ? 'ET' : '') + '</span></div><div class="det-main"><div class="det-head"><span class="det-name">' + esc(ev.cat === 'earnings' ? 'Earnings' : ev.name) + '</span><span class="badge">' + ev.cat + '</span></div>' + (ev.cat === 'earnings' ? '<div class="det-note">' + esc(ev.note) + ' — see the Earnings panel.</div>' : ev.note ? '<div class="det-note">' + esc(ev.note) + '</div>' : '') + '</div></div>').join('') : '<div class="empty">Nothing scheduled.</div>';
    return '<section class="view view-calendar' + (S.earningsMax ? ' is-earnings-max' : '') + '" aria-label="Calendar"><div class="cal-main">'
      + '<div class="card calgrid" id="calgrid"><div class="card-h"><span class="card-t">Release calendar</span><div class="legend">' + legend + '</div><button type="button" class="ibtn sm" data-action="earnmax" title="' + (S.earningsMax ? 'Restore the calendar' : 'Minimise the calendar') + '" aria-expanded="' + !S.earningsMax + '">' + (S.earningsMax ? '▸' : '▾') + '</button></div>'
      + '<div class="card-b flush"><div class="cv-wrap"><div class="cv-grid">' + grid + '</div></div><div class="asof">Exact dates from agency schedules via FRED, the FOMC calendar, and Nasdaq · all times Eastern.</div></div></div>'
      + earningsHTML(sel) + '</div>'
      + '<aside class="cal-side"><div class="card" id="daydetail"><div class="card-h"><span class="card-t">Day detail</span></div><div class="card-b"><div class="det-date">' + fmtLong(sel) + '</div>' + det + '</div></div></aside></section>';
  }
  function earningsHTML(sel) {
    const evs = EVENTS.filter((e) => e.date === sel && e.cat === 'earnings');
    const label = fmtLong(sel);
    if (!evs.length) return '<div class="card earnings" id="earnings"><div class="card-h"><span class="card-t">Earnings</span></div><div class="card-b"><p class="muted">No earnings listed for ' + label + '.</p></div></div>';
    const sessions = sel === '2026-09-09' ? Object.keys(EARN).map((k) => ({ time: k, rows: EARN[k] })) : evs.map((e) => ({ time: e.time, rows: EARN['After close'].slice(0, 4) }));
    const all = sessions.flatMap((s) => s.rows); const counts = {}; all.forEach((r) => { counts[r[3]] = (counts[r[3]] || 0) + 1; });
    const chips = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map((sec) => ({ v: sec, l: shortSec(sec), n: counts[sec] }));
    const sw = all.filter((r) => r[6]).length; if (sw) chips.push({ v: '__software__', l: 'Software', n: sw, sw: true });
    const picked = Object.keys(S.earnPicked).filter((k) => S.earnPicked[k]);
    const match = (r) => !picked.length || picked.includes(r[3]) || (picked.includes('__software__') && r[6]);
    const fin = all.filter((r) => r[3] === 'Finance').length, tech = all.filter((r) => r[3] === 'Technology').length;
    return '<div class="card earnings" id="earnings"><div class="card-h"><span class="card-t">Earnings</span>' + (picked.length ? '<button type="button" class="link-btn" data-action="earnclear">Clear ' + picked.length + '</button>' : '') + '<button type="button" class="ibtn sm" data-action="earnmax" title="Expand earnings">' + (S.earningsMax ? '⤡' : '⤢') + '</button></div><div class="card-b">'
      + '<div class="earn-summary"><span class="earn-day">' + label + '</span><span class="earn-counts"><strong>' + all.length + '</strong> reporting · <span class="key">' + fin + ' finance</span> · <span class="key">' + tech + ' tech</span> <span class="sw">(' + sw + ' software)</span></span></div>'
      + '<div class="chips" role="group" aria-label="Filter by sector">' + chips.map((c) => '<button type="button" class="chip' + (S.earnPicked[c.v] ? ' is-on' : '') + (c.sw ? ' is-sw' : '') + '" data-action="earnpick" data-sec="' + esc(c.v) + '" aria-pressed="' + !!S.earnPicked[c.v] + '">' + c.l + '<span class="chip-n">' + c.n + '</span></button>').join('') + '</div>'
      + sessions.map((s) => { const rows = s.rows.map((r, i) => Object.assign({ rank: i + 1 }, { r })).filter((x) => match(x.r));
        return '<div class="earn-session"><div class="earn-session-h"><span class="earn-when">' + (SESSION[s.time] ? SESSION[s.time][1] : s.time) + '</span><span class="earn-n">' + rows.length + (picked.length ? ' of ' + s.rows.length : '') + ' companies</span></div>'
          + (rows.length ? '<div class="tbl-wrap"><table class="tbl earn"><thead><tr><th class="rank">#</th><th class="tick">Ticker</th><th class="l">Company</th><th class="cap">Market cap</th><th class="l sec">Sector</th><th class="eps">EPS est.</th></tr></thead><tbody>'
            + rows.map(({ rank, r }) => '<tr' + (r[5] ? ' class="is-flagged"' : '') + '><td class="rank">' + rank + '</td><td class="tick">' + r[0] + '</td><td class="l co">' + esc(r[1]) + '</td><td class="cap">' + fmtCap(r[2]) + '</td><td class="l sec">' + (r[6] ? '<span class="secb is-sw">Software</span>' : r[5] ? '<span class="secb">' + shortSec(r[3]) + '</span>' : '<span class="sec-plain">' + shortSec(r[3]) + '</span>') + '</td><td class="eps">' + r[4] + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty">No matching names in this session.</div>') + '</div>'; }).join('')
      + '</div></div>';
  }

  /* ---------- Newswire ---------- */
  function newsHTML() {
    const themes = ['All'].concat(Array.from(new Set(NEWS.flatMap((n) => n.themes))));
    const bookCount = NEWS.filter((n) => n.holdings && n.holdings.length).length;
    const shown = NEWS.filter((n) => S.newsTheme === 'All' || n.themes.includes(S.newsTheme)).filter((n) => !S.bookOnly || (n.holdings && n.holdings.length));
    return '<section class="view view-news" aria-label="Newswire"><aside class="news-side"><div class="card" id="filters"><div class="card-h"><span class="card-t">Filters</span></div><div class="card-b">'
      + '<div class="chips">' + themes.map((t) => '<button type="button" class="chip' + (t === S.newsTheme ? ' is-on' : '') + '" data-action="theme-chip" data-theme="' + t + '" aria-pressed="' + (t === S.newsTheme) + '">' + t + '</button>').join('') + '</div>'
      + '<button type="button" class="book-toggle' + (S.bookOnly ? ' is-on' : '') + '" data-action="book" aria-pressed="' + S.bookOnly + '"><i class="book-dot" aria-hidden="true"></i>In my book<span class="count">' + bookCount + '</span></button>'
      + '<div class="asof">' + shown.length + ' of ' + NEWS.length + ' headlines.</div></div></div>' + insightHTML(false) + '</aside>'
      + '<div class="card newslist" id="newswire"><div class="card-h"><span class="card-t">Newswire</span><span class="card-sub">9 public feeds · deduped · 15m cache</span></div><div class="card-b flush">'
      + shown.map((it) => '<article class="news-item' + (it.holdings ? ' is-book' : '') + '"><div class="news-meta"><span class="src">' + it.source + '</span>' + (it.holdings || []).map((h) => '<span class="hold" title="' + h + ' is an open position in your book"><i class="book-dot" aria-hidden="true"></i>' + h + '</span>').join('') + it.themes.map((t) => '<span class="tag">' + t + '</span>').join('') + '<span class="when">' + it.when + '</span></div>'
        + '<a class="news-title" href="#">' + esc(it.title) + '</a>' + (it.summary ? '<p class="news-summary">' + esc(it.summary) + '</p>' : '')
        + '<button type="button" class="insight-btn' + (S.insight === 'article:' + it.title ? ' is-on' : '') + '" data-action="insight" data-id="article:' + esc(it.title) + '" data-title="' + esc(it.title) + '" data-meta="' + it.source + ' · ' + it.themes[0] + '">✦ Insights</button></article>').join('')
      + '</div></div></section>';
  }

  /* ---------- Alerts ---------- */
  const fmtPct = (p) => (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p * 100).toFixed(2) + '%';
  function alertsHTML() {
    const boxes = ALERT_SOURCES.map((src) => {
      const open = !!S.alertsOpen[src.id]; const cadence = src.active ? src.pollMs : src.idleMs; const sent = src.log.filter((l) => l.tag !== 'test').length;
      let body = '';
      if (open) {
        const meta = '<div class="al-meta"><span class="al-rule">' + src.rule + '</span>' + src.facts.map((f) => '<span><i>' + f[0] + '</i> ' + f[1] + '</span>').join('') + '<span><i>every</i> ' + (cadence >= 1000 ? cadence / 1000 + 's' : cadence + 'ms') + '</span><span><i>poll</i> ' + src.src.lastOk + ' ago · ' + src.src.latencyMs + 'ms</span><span><i>n</i> ' + src.src.polls.toLocaleString('en-US') + '</span></div>';
        const table = src.symbols ? '<div class="al-body"><form class="al-add" onsubmit="return false"><input class="filter" type="text" placeholder="Add ticker" aria-label="Add a ticker to watch"><label class="al-ctx"><input type="checkbox"> context</label><button type="button" class="btn sm">Watch</button></form>'
          + '<div class="al-head"><span>Symbol</span><span>Last</span><span>Today</span><span>Thresholds</span><span>Next</span><span></span></div>'
          + src.symbols.map((s) => '<div class="al-row' + (s.kind === 'index' ? ' is-index' : '') + '"><span class="al-name"><span class="al-sym">' + s.symbol + '</span><span class="al-desc">' + (s.name || '') + '</span></span><span class="al-last">' + s.last.toFixed(2) + '</span><span class="al-chg ' + (s.pct < 0 ? 'down' : 'up') + '">' + fmtPct(s.pct) + '</span><span class="al-pills">' + (s.context ? '<span class="al-own">context</span>' : s.thresholds.map((t) => '<span class="pill" title="Armed — texts at −' + t + '%">−' + t + '%</span>').join('')) + '</span><span class="al-next">' + (s.context ? '<span class="muted">rides on the alert’s text</span>' : s.toNext.toFixed(2) + ' pts to −' + s.next + '%') + '</span><button type="button" class="al-x" ' + (s.kind === 'index' ? 'disabled title="The pinned symbol stays"' : 'title="Stop watching ' + s.symbol + '"') + ' aria-label="Remove ' + s.symbol + '">×</button></div>').join('') + '</div>' : '';
        const log = src.log.length ? src.log.map((l) => '<div class="al-line' + (l.tag === 'test' ? ' is-test' : '') + '"><button type="button" class="al-line-hit"><span class="al-line-t">' + l.at + '</span><span class="al-line-tag ' + (l.tag === 'failed' ? 'down' : 'up') + '">' + l.tag + '</span><span class="al-line-ms">' + l.ms + 'ms</span><span class="al-line-txt">' + esc(l.text.split('\n').join(' · ')) + '</span></button></div>').join('') : '<div class="al-empty">nothing sent yet</div>';
        body = '<div class="al-more"><div class="al-more-main">' + meta + table + log + '</div><aside class="al-more-side">' + src.actions.map((a) => '<button type="button" class="btn sm">' + a[1] + '</button>').join('') + '</aside></div>';
      }
      return '<div class="card al-box' + (open ? ' is-open' : '') + '" id="al-' + src.id + '"><div class="card-h"><span class="card-t">' + src.title + '</span><button type="button" class="al-peek" data-action="al-toggle" data-id="' + src.id + '" aria-expanded="' + open + '"><i class="al-dot is-live" aria-hidden="true"></i><span class="al-peek-text">' + src.summary + '</span><span class="al-peek-side">' + (cadence >= 1000 ? cadence / 1000 + 's' : cadence + 'ms') + (sent ? ' · ' + sent : '') + '</span></button><button type="button" class="ibtn sm" data-action="al-toggle" data-id="' + src.id + '" aria-label="' + (open ? 'Collapse' : 'Expand') + '">' + (open ? '−' : '+') + '</button></div>' + (open ? '<div class="card-b">' + body + '</div>' : '') + '</div>';
    }).join('');
    return '<section class="view view-alerts" aria-label="Alerts"><aside class="al-side"><div class="card" id="delivery"><div class="card-h"><span class="card-t">Delivery</span></div><div class="card-b"><div class="al-channel is-ready"><i class="al-dot" aria-hidden="true"></i><strong>iMessage</strong> → +1 ••• ••• 4821</div><p class="muted small">Texts go from this Mac. The loops run in the gateway whether or not this tab is open.</p></div></div></aside><div class="al-stack">' + boxes + '</div></section>';
  }

  /* ---------- Learn ---------- */
  function learnHTML() {
    const prog = '<div class="tiles small"><div class="tile"><span class="tile-l">Streak</span><span class="tile-n">4</span><span class="tile-d flat">days</span></div><div class="tile"><span class="tile-l">Last score</span><span class="tile-n">7/10</span><span class="tile-d flat">Sep 8</span></div><div class="tile"><span class="tile-l">Taken</span><span class="tile-n">12</span><span class="tile-d flat">quizzes</span></div><div class="tile"><span class="tile-l">Best</span><span class="tile-n">90%</span><span class="tile-d flat">accuracy</span></div></div>'
      + '<div class="kicker mt">Reviewing</div><div class="chips"><span class="chip is-static">Breakeven inflation</span><span class="chip is-static">2s10s spread</span></div><p class="muted small">These get woven into your next quiz automatically.</p>';
    let centre;
    if (S.learnMode === 'tutor') centre = '<label class="field-label" for="article">Paste an article or newsletter</label><textarea id="article" rows="10" placeholder="Paste the full text here and Claude will work through it with you…"></textarea><div class="actions"><button type="button" class="btn" disabled>Start walkthrough</button></div>';
    else if (S.learnSession) centre = '<div class="thread">' + S.chat.map((m) => '<div class="bubble ' + (m.role === 'user' ? 'me' : 'tutor') + '"><span class="who">' + (m.role === 'user' ? 'You' : 'Claude') + '</span>' + esc(m.text) + '</div>').join('') + '</div><form class="chat-form" onsubmit="return false"><textarea rows="2" placeholder="Type your answer…" aria-label="Your answer"></textarea><button type="button" class="btn">Send</button></form><button type="button" class="btn ghost sm" data-action="learn-reset">End session</button>';
    else centre = '<p class="muted">Both modes are built live from the data on screen — the same levels, weekly changes and headlines the rest of the dashboard is showing.</p><div class="actions"><button type="button" class="btn" data-action="learn-start" data-kind="quiz">Start today’s quiz</button><button type="button" class="btn ghost" data-action="learn-start" data-kind="ask">Ask a question</button></div>';
    return '<section class="view view-learn" aria-label="Learn"><aside class="learn-left"><div class="card" id="progress"><div class="card-h"><span class="card-t">Progress</span></div><div class="card-b">' + prog + '</div></div>'
      + '<div class="card"><div class="card-h"><span class="card-t">What the session sees</span></div><div class="card-b"><p class="muted small">A market snapshot is assembled and sent as context each time you start: rates and the curve, credit spreads, equities and volatility, FX, commodities and macro — each with its one-week change — plus today’s top headlines.</p><p class="muted small note">Runs on the Claude Agent SDK using your Claude Max plan.</p></div></div></aside>'
      + '<div class="card learn-main" id="quiz"><div class="card-h"><span class="card-t">' + (S.learnMode === 'quiz' ? 'Daily quiz' : 'Article tutor') + '</span><div class="seg"><button type="button" class="' + (S.learnMode === 'quiz' ? 'is-active' : '') + '" data-action="learn-mode" data-mode="quiz">Quiz</button><button type="button" class="' + (S.learnMode === 'tutor' ? 'is-active' : '') + '" data-action="learn-mode" data-mode="tutor">Tutor</button></div></div><div class="card-b">' + centre + '</div></div>'
      + '<aside class="learn-right"><div class="card" id="glossary"><div class="card-h"><span class="card-t">Key terms</span></div><div class="card-b">' + GLOSSARY.map((g) => '<div class="gloss"><span class="gloss-t">' + g[0] + '</span><span class="gloss-d">' + g[1] + '</span></div>').join('') + '</div></div></aside></section>';
  }

  /* ---------- app ---------- */
  const RENDER = { markets: marketsHTML, credit: creditHTML, calendar: calendarHTML, news: newsHTML, alerts: alertsHTML, learn: learnHTML };
  function render() {
    const app = document.getElementById('app'); const cur = VIEWS.find((v) => v.id === S.view);
    app.setAttribute('data-view', S.view); app.setAttribute('data-group', cur.group);
    document.getElementById('nav').innerHTML = navHTML();
    document.getElementById('stage').innerHTML = RENDER[S.view]();
    const t = document.querySelector('.theme-glyph'); if (t) t.textContent = isDark() ? '☀' : '☾';
    const f = document.querySelector('.picker-search'); if (f && S.pickerOpen) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
    const w = document.querySelector('.filter[data-action="wlfilter"]'); if (w && document.activeElement !== w && S.wlFocus) { w.focus(); w.setSelectionRange(w.value.length, w.value.length); }
  }
  function isDark() {
    const r = document.documentElement; const t = r.getAttribute('data-theme');
    if (t === 'dark') return true; if (t === 'light') return false;
    return window.__DARK_FIRST ? !window.matchMedia('(prefers-color-scheme: light)').matches : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function setView(id) { S.view = id; S.pickerOpen = false; history.replaceState(null, '', '#' + id); render(); window.scrollTo(0, 0); }
  function pick(id) { S.symbol = id; S.pickerOpen = false; S.pickerQ = ''; if (S.view !== 'markets') setView('markets'); else render(); }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) { if (S.pickerOpen && !e.target.closest('.picker')) { S.pickerOpen = false; render(); } return; }
    const a = el.getAttribute('data-action');
    if (a === 'view') setView(el.getAttribute('data-view'));
    else if (a === 'pick') { e.preventDefault(); pick(el.getAttribute('data-symbol')); }
    else if (a === 'tf') { S.tf = el.getAttribute('data-tf'); render(); }
    else if (a === 'ftf') { S.featuredTf = el.getAttribute('data-tf'); render(); }
    else if (a === 'picker') { S.pickerOpen = !S.pickerOpen; S.pickerQ = ''; render(); }
    else if (a === 'step') { const i = WATCHLIST.findIndex((w) => w.id === S.symbol); const n = (i + Number(el.getAttribute('data-dir')) + WATCHLIST.length) % WATCHLIST.length; pick(WATCHLIST[n].id); }
    else if (a === 'theme') { const dark = isDark(); document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark'); try { localStorage.setItem('mock-theme', dark ? 'light' : 'dark'); } catch (_) {} render(); }
    else if (a === 'refresh') { el.classList.add('is-spinning'); setTimeout(() => render(), 900); }
    else if (a === 'insight') { const id = el.getAttribute('data-id'); if (S.insight === id) { S.insight = null; } else { S.insight = id; S.insightTitle = el.getAttribute('data-title'); S.insightMeta = el.getAttribute('data-meta'); S.insightDone = false; setTimeout(() => { S.insightDone = true; render(); }, 1100); } render(); }
    else if (a === 'insight-clear') { S.insight = null; render(); }
    else if (a === 'cat') { const c = el.getAttribute('data-cat'); S.calHidden[c] = !S.calHidden[c]; render(); }
    else if (a === 'day') { S.calSel = el.getAttribute('data-day'); S.earnPicked = {}; render(); }
    else if (a === 'earnmax') { S.earningsMax = !S.earningsMax; render(); }
    else if (a === 'earnpick') { const s = el.getAttribute('data-sec'); S.earnPicked[s] = !S.earnPicked[s]; render(); }
    else if (a === 'earnclear') { S.earnPicked = {}; render(); }
    else if (a === 'theme-chip') { S.newsTheme = el.getAttribute('data-theme'); render(); }
    else if (a === 'book') { S.bookOnly = !S.bookOnly; render(); }
    else if (a === 'al-toggle') { const id = el.getAttribute('data-id'); S.alertsOpen[id] = !S.alertsOpen[id]; render(); }
    else if (a === 'learn-mode') { S.learnMode = el.getAttribute('data-mode'); S.learnSession = null; S.chat = []; render(); }
    else if (a === 'learn-start') { const k = el.getAttribute('data-kind'); S.learnSession = k; S.chat = k === 'quiz'
      ? [{ role: 'assistant', text: 'Question 1 of 10. The 10-year yield is 4.30% and the 2-year is 3.78%. Is the 2s10s curve inverted, flat, or upward sloping — and by how many basis points?' }]
      : [{ role: 'assistant', text: 'Ask me anything about today’s markets, the indicators, or the headlines. What would you like to know?' }]; render(); }
    else if (a === 'learn-reset') { S.learnSession = null; S.chat = []; render(); }
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-action]'); if (!el) return; const a = el.getAttribute('data-action');
    if (a === 'wlfilter') { S.wlFilter = el.value; S.wlFocus = true; render(); }
    if (a === 'pickerq') { S.pickerQ = el.value; render(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName) && S.view === 'markets') { e.preventDefault(); S.pickerOpen = true; render(); }
    if (e.key === 'Escape' && S.pickerOpen) { S.pickerOpen = false; render(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.wl-row, .cv-day')) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener('focusout', (e) => { if (e.target && e.target.matches && e.target.matches('.filter[data-action="wlfilter"]')) S.wlFocus = false; });
  window.addEventListener('hashchange', () => { const id = (location.hash || '').slice(1); if (VIEWS.some((v) => v.id === id) && id !== S.view) { S.view = id; render(); } });

  /* clock */
  function tick() { const el = document.getElementById('clock'); if (el) el.textContent = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' }) + ' ET'; }
  setInterval(tick, 1000);

  try { const t = localStorage.getItem('mock-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (_) {}
  render(); tick();
})();

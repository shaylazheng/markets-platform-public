/* Client for the Form 4 screener, proxied through the gateway to the Python
   service. Formatting lives here rather than in the view because the same
   value rules (missing price is not zero, a below-market price can be a
   legitimate option exercise) apply wherever a row is rendered. */

const getJSON = async (url) => {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error || `HTTP ${r.status}`);
    e.detail = j.detail;
    throw e;
  }
  return j;
};

export const fetchVocab = () => getJSON('/api/insider/vocab');
export const fetchStats = () => getJSON('/api/insider/stats');
export const fetchNamedScreen = (slug) => getJSON(`/api/insider/screen/${encodeURIComponent(slug)}`);

// Booleans whose default on the service is TRUE. Dropping these when false --
// as we do for ordinary on/off flags -- would send nothing and let the service
// re-apply its default, so switching them off would appear to do nothing.
const DEFAULT_TRUE_FLAGS = new Set(['exclude_derivative', 'descending', 'role_match_any']);

export function fetchScreener(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === '' || v == null) continue;
    if (v === false && !DEFAULT_TRUE_FLAGS.has(k)) continue;
    qs.set(k, v === true ? 'true' : v === false ? 'false' : String(v));
  }
  return getJSON(`/api/insider/screener?${qs}`);
}

/* ---------- formatting ---------- */

// A missing price is genuinely unknown (some transaction codes carry none).
// It must never render as 0, which would read as a free grant.
export const DASH = '—';

export const money = (v) => {
  if (v == null) return DASH;
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
};

export const num = (v) => (v == null ? DASH : Math.round(v).toLocaleString('en-US'));

export const price = (v) => (v == null ? DASH : `$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`);

export const pct = (v, digits = 1) => (v == null ? DASH : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`);

export const stake = (v) => {
  if (v == null) return DASH;
  if (v >= 1) return `${v.toFixed(1)}%`;
  if (v >= 0.01) return `${v.toFixed(2)}%`;
  return '<0.01%';
};

export const signClass = (v) => (v == null ? '' : v > 0 ? 'is-up' : v < 0 ? 'is-down' : '');

const TRADE_LABELS = {
  P: 'Buy',
  S: 'Sell',
  A: 'Grant',
  M: 'Exercise',
  F: 'Tax',
  G: 'Gift',
  D: 'Disposed',
  C: 'Conversion',
  X: 'Exercise',
};
export const tradeLabel = (code) => TRADE_LABELS[code] || code || DASH;

export const fmtDate = (iso) => (iso ? String(iso).slice(0, 10) : DASH);

export function fmtAge(iso) {
  if (!iso) return DASH;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return DASH;
  const h = ms / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(ms / 6e4))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

// Role badge from the per-filing flags. Officer title wins when present because
// "CEO" says more than "Officer"; the 10% flag is kept separate since a holder
// can be both.
export function roleOf(row) {
  const out = [];
  if (row.officer_title) out.push(row.officer_title);
  else if (row.is_officer) out.push('Officer');
  if (row.is_director) out.push('Dir');
  if (row.is_ten_percent) out.push('10%');
  return out.length ? out.join(' · ') : DASH;
}

export const secUrl = (accession, cik) => {
  if (!accession || !cik) return null;
  const bare = String(accession).replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${bare}/${accession}-index.htm`;
};

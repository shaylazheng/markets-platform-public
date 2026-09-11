import { useCallback, useEffect, useMemo, useState } from 'react';
import { CompanyRail } from '@markets/shell/components/CompanyRail.jsx';
import { useApp } from '@markets/shell/lib/store.jsx';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';
import {
  fetchVocab, fetchScreener, fetchNamedScreen, fetchStats,
  money, num, price, pct, stake, signClass,
  tradeLabel, fmtDate, fmtAge, roleOf, secUrl, DASH,
} from './insider.js';

// The SEC Form 4 surface. Everything here is public disclosure: Section 16
// insiders must report their trades, and this reads those filings from EDGAR.
//
// This view restores the predecessor app's screens as states of one surface:
// the per-ticker / per-insider / per-industry pages (drill-in filters with a
// context heading and their own hash), and the full ~40-field screener
// workbench, grouped into collapsible categories in the rail.
//
// NAMED SCREENS ARE HASH-ONLY. The board of ~20 named screens that used to sit
// under the company box has been removed, but the mechanism has not: a named
// screen is a server-side Query with its own endpoint, `#insider&screen=<slug>`
// still restores it, `activeScreen` still labels it in the context heading, and
// `GET /api/screener/named` still serves it. What went is the entry point, not
// the capability — so a bookmark or a link into a named screen keeps working.
// `vocab.screens` is still read for those labels; `vocab.screen_groups` was the
// board's layout alone and is no longer consumed.
//
// The rows come from the Python service (services/insider), which owns the
// DuckDB connection. See server/routes/insider.js for why it stays a separate
// process. _query_from_params() there accepts every field this form sends.

const LIMIT = 100;

const EMPTY = {
  search: '', ticker: '', insider_name: '',
  trade_type: 'P',
  value_low: '', value_high: '',
  price_low: '', price_high: '',
  qty_low: '', qty_high: '',
  owned_change_low: '', owned_change_high: '',
  pct_owned_min: '', pct_owned_max: '',
  filed_within_days: '', traded_within_days: '',
  filed_after: '', filed_before: '', traded_after: '', traded_before: '',
  filing_delay_min: '', filing_delay_max: '',
  age_preset: '',
  sic_sector: '',
  num_filings_min: '', num_filings_max: '',
  num_insiders_min: '', num_insiders_max: '',
  num_officers_min: '', num_officers_max: '',
  group_value_min: '', group_value_max: '',
  issuer_name: '',
  sic_low: '', sic_high: '',
  age_max_hours: '', age_min_hours: '',
  min_insiders: '', cluster_window_days: '',
  group_by: 'filing', sort: 'filing_datetime', descending: true,
  limit: '',
  cluster: false, include_implausible: false, exclude_derivative: true,
  role_match_any: true,
  is_officer: false, is_director: false, is_ten_percent: false, is_other: false,
  is_ceo: false, is_cfo: false, is_coo: false, is_pres: false, is_cob: false,
  is_gc: false, is_vp: false,
};

// Not shown as "active filter" chips: presentation, not selection.
const NON_FILTERS = new Set(['sort', 'group_by', 'descending', 'limit']);

// Every Form 4 transaction code, not just the common five. Narrowing this list
// silently makes gifts, tax withholding and dispositions unreachable, and
// those are exactly what you want when asking how an insider ACQUIRED stock.
const TRADE_TYPES = [
  ['', 'All types'],
  ['P', 'P — Open-market buy'],
  ['S', 'S — Open-market sell'],
  ['A', 'A — Grant / award'],
  ['M', 'M — Option exercise'],
  ['F', 'F — Tax withholding'],
  ['G', 'G — Gift'],
  ['D', 'D — Disposition to issuer'],
  ['C', 'C — Conversion'],
  ['X', 'X — Option exercise (in/out of money)'],
  ['J', 'J — Other'],
];

const PAGE_SIZES = ['', '50', '100', '250', '500', '1000'];

const SORTS = [
  ['filing_datetime', 'Newest filing'],
  ['trans_date', 'Newest trade'],
  ['value', 'Largest value'],
  ['delta_own', 'Biggest position change'],
  ['pct_owned', 'Largest stake'],
  ['r1m', '1-month return'],
];

const ROLE_LABELS = {
  is_ceo: 'CEO', is_cfo: 'CFO', is_coo: 'COO', is_pres: 'President',
  is_cob: 'Chair', is_gc: 'General counsel', is_vp: 'VP',
  is_officer: 'Any officer', is_director: 'Director',
  is_ten_percent: '10% owner', is_other: 'Other insider',
};
const ALL_ROLES = ['is_ceo', 'is_cfo', 'is_coo', 'is_pres', 'is_cob', 'is_gc',
  'is_vp', 'is_officer', 'is_director', 'is_ten_percent', 'is_other'];
const PRIMARY_ROLES = ['is_ceo', 'is_cfo', 'is_director', 'is_ten_percent'];
const ADVANCED_ROLES = ['is_officer', 'is_coo', 'is_pres', 'is_cob', 'is_gc', 'is_vp', 'is_other'];

// The drill-in "pages": mirror the predecessor's /ticker, /insider, /industry
// routes as filter states carried in the hash (#insider&ticker=NVDA).
const HASH_KEYS = ['ticker', 'insider_name', 'sic_sector'];
function readHash() {
  const parts = (location.hash || '').slice(1).split('&');
  return new URLSearchParams(parts.slice(1).join('&'));
}

function Stat({ label, value }) {
  return (
    <div className="ins-stat">
      <span className="ins-stat-k">{label}</span>
      <span className="ins-stat-v">{value}</span>
    </div>
  );
}

export function Insider() {
  const { nonce, company, setCompany } = useApp();
  const [vocab, setVocab] = useState(null);
  const [filters, setFilters] = useState(() => {
    // Arriving via a bookmarked drill-in or named screen restores that "page".
    const p = readHash();
    if (p.get('screen')) return { ...EMPTY, __screen: p.get('screen') };
    const patch = {};
    for (const k of HASH_KEYS) if (p.get(k)) patch[k] = p.get(k);
    if (Object.keys(patch).length) return { ...EMPTY, trade_type: '', ...patch };
    return EMPTY;
  });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const set = useCallback((patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }, []);

  useEffect(() => {
    fetchVocab().then(setVocab).catch(() => setVocab(null));
  }, []);

  // Keep the drill-in state bookmarkable, the way the old app's URLs were.
  useEffect(() => {
    if (!(location.hash || '').startsWith('#insider')) return;
    const qs = new URLSearchParams();
    if (filters.__screen) qs.set('screen', filters.__screen);
    for (const k of HASH_KEYS) if (filters[k]) qs.set(k, filters[k]);
    const tail = qs.toString();
    history.replaceState(null, '', `#insider${tail ? '&' + tail : ''}`);
  }, [filters.__screen, filters.ticker, filters.insider_name, filters.sic_sector]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // A named screen is a Query defined server-side, so it has its own endpoint;
    // the form filters are not sent with it.
    const { __screen, ...form } = filters;
    const req = __screen
      ? fetchNamedScreen(__screen).then((d) => ({ ...d, has_more: false }))
      // A chosen page size overrides the default; `form.limit` is '' unless set.
      : fetchScreener({ ...form, limit: Number(form.limit) || LIMIT, page });
    req
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filters, page, nonce]);

  const [globalStats, setGlobalStats] = useState(null);
  useEffect(() => {
    fetchStats().then(setGlobalStats).catch(() => setGlobalStats(null));
  }, [nonce]);

  /* The filter vocabulary AND the first page of rows: this surface is a form
     over a table, and a form whose selects are empty is not usable even though
     it has rendered. */
  useBootGate('insider', (!!vocab && !loading) || !!error, { what: 'screener' });

  const rows = data?.rows || [];
  const stats = data?.stats || globalStats;

  /* `screens` stays: a screen reached by hash still has to name itself in the
     header (see `activeScreen`). `screen_groups` was purely the removed
     board's layout and has no other reader. */
  const screens = vocab?.screens || [];

  // How the one panel organises its categories. Every layout holds the whole
  // vocabulary in the same interface; only the arrangement differs.
  // Panes and tabs show one category at a time; the others allow several open.
  // The grouped form allows several categories open at once; nothing else
  // uses this now that the geometric layouts are gone.
  const singleOpen = false;

  // Which filter categories are expanded. Identity opens by default because it
  // is the most common starting point; the rest stay folded so the panel is a
  // short menu of categories rather than a wall of forty controls.
  const [openGroups, setOpenGroups] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('insGroups') || 'null');
      if (saved && typeof saved === 'object') return saved;
    } catch {}
    return { identity: true };
  });

  const screenLabel = useMemo(() => {
    const bySlug = new Map(screens.map((s) => [s.slug, s.label]));
    return (slug) => bySlug.get(slug) || slug;
  }, [screens]);
  const activeScreen = filters.__screen ? screenLabel(filters.__screen) : null;

  const sectorLabel = useMemo(() => {
    const m = new Map((vocab?.sic_sectors || []).map((s) => [String(s.code), s.label]));
    return (code) => m.get(String(code)) || `SIC ${code}`;
  }, [vocab]);

  // Drill-ins mirror the predecessor's dedicated pages: all activity for one
  // issuer / one person, so the trade-type default is cleared.
  /* Drilling into an issuer sets the GROUP's company, so leaving for Valuation
     or Management arrives on the same one. The screener is the odd member of
     the group — its default state is market-wide and has no company at all —
     so it follows the shared company but does not force one. */
  const openTicker = (t) => {
    if (!t) return;
    setCompany(t);
    setFilters({ ...EMPTY, trade_type: '', ticker: t });
  };
  const openInsider = (n) => n && setFilters({ ...EMPTY, trade_type: '', insider_name: n });

  /* Following the shared company, but ONLY when this surface is already showing
     one. Arriving from Valuation onto a market-wide screen and having it
     silently narrow to one issuer would destroy a screen you had built. */
  useEffect(() => {
    setFilters((f) => (f.ticker && company && f.ticker.toUpperCase() !== company
      ? { ...f, ticker: company } : f));
  }, [company]);

  // The context heading: which "page" this state corresponds to.
  const context = activeScreen
    ? { label: activeScreen, kind: 'Named screen' }
    : filters.ticker
    ? { label: `${filters.ticker.toUpperCase()} — all insider activity`, kind: 'Company' }
    : filters.insider_name
    ? { label: `${filters.insider_name} — insider history`, kind: 'Insider' }
    : filters.sic_sector
    ? { label: `${sectorLabel(filters.sic_sector)} — insider activity`, kind: 'Industry' }
    : null;

  // Every non-default filter as a removable chip (the old workbench's chips).
  const activeChips = Object.entries(filters).filter(([k, v]) =>
    k !== '__screen' && !NON_FILTERS.has(k) && EMPTY[k] !== undefined && v !== EMPTY[k]);
  const chipLabel = (k, v) => {
    const name = vocab?.filter_labels?.[k] || ROLE_LABELS[k] || k.replaceAll('_', ' ');
    return v === true ? name : `${name}: ${v}`;
  };

  // A named, independently collapsible filter category.
  //
  // The count matters more than it looks: a collapsed group must never hide a
  // filter that is narrowing your results, or an empty table becomes
  // unexplainable. Open/closed persists per group.
  const fgroup = (label, key, fields, body) => {
    const active = fields.filter((f) => {
      const v = filters[f];
      return EMPTY[f] !== undefined && v !== EMPTY[f] && v !== '' && v != null;
    }).length;
    return (
      <details
        className="ins-fgroup"
        key={key}
        // "sections" never collapses, so force the element open rather than
        // fighting the browser's own hiding of a closed <details>.
        open={openGroups[key] ?? false}
        onToggle={(e) => {
          // Panes and tabs show one category at a time: opening a category
          // closes the rest, so the fields always occupy one predictable slot.
          const next = singleOpen
            ? (e.currentTarget.open ? { [key]: true } : {})
            : { ...openGroups, [key]: e.currentTarget.open };
          setOpenGroups(next);
          try { localStorage.setItem('insGroups', JSON.stringify(next)); } catch {}
        }}
      >
        <summary>
          {label}
          {active > 0 && <span className="ins-fgroup-count">{active}</span>}
        </summary>
        {body}
      </details>
    );
  };

  const textField = (label, key, ph) => (
    <div className="ins-field">
      <label htmlFor={`ins-f-${key}`}>{label}</label>
      <input id={`ins-f-${key}`} type="text" placeholder={ph} value={filters[key]}
             onChange={(e) => set({ [key]: e.target.value, __screen: undefined })} />
    </div>
  );

  const boundPair = (label, loKey, hiKey, opts = {}) => (
    <div className="ins-field">
      <label>{label}</label>
      <div className="ins-pair">
        <input type={opts.type || 'number'} placeholder={opts.ph?.[0] ?? 'min'} value={filters[loKey]}
               onChange={(e) => set({ [loKey]: e.target.value, __screen: undefined })} />
        <input type={opts.type || 'number'} placeholder={opts.ph?.[1] ?? 'max'} value={filters[hiKey]}
               onChange={(e) => set({ [hiKey]: e.target.value, __screen: undefined })} />
      </div>
    </div>
  );

  return (
    <div className="insider-surface">
      {/* Filters live in a rail, not across the top.

          Forty controls stacked above the results pushed the table off
          the fold, so every filter change was: adjust, scroll down,
          read, scroll back up. Beside the table instead, the control
          and its consequence are on screen together — the same argument
          that made Valuation's Console the chosen look there. */}
      <aside className="ins-rail">
        <CompanyRail
          view="insider"
          ticker={filters.ticker ? filters.ticker.toUpperCase() : ''}
          name={null}
          sub={filters.ticker ? 'filtered to this issuer' : null}
          placeholder="ticker, or leave blank for all"
          onSubmit={openTicker}
          facts={filters.ticker ? [
            { label: 'Filings', value: data?.total ?? null, sub: 'in this screen' },
            { label: 'Shown', value: rows.length, sub: `page ${page}` },
          ] : []}
          note={!filters.ticker
            ? 'No company set — this is the market-wide screen, which is what this surface is for. '
            + 'Type a ticker to drill into one issuer; the Company tabs follow it.'
            : null}
        />
      {/* Forty controls in one undifferentiated grid is a wall: nothing tells
          you where to look for a date versus a dollar amount. Grouped into
          named, independently collapsible categories — as the predecessor had
          them — you can open the one you want and leave the rest folded.
          Each group shows a count when it holds an active filter, so a
          collapsed group can never hide something that is changing results. */}
      {/* ONE filter panel.
          Previously this was three disconnected zones: a top row of controls,
          a row of chips, and a separate grouped panel. The categories only
          organised part of the vocabulary while type, sort, order, grain and
          sector floated above them, so the same kind of decision lived in two
          places. Everything now sits in the category it belongs to; only
          search and reset, which you need regardless of what you are filtering
          on, stay outside. */}
      <div className="ins-panel">
        <div className="ins-panel-top">
          <input
            id="ins-search"
            className="ins-searchbox"
            type="search"
            placeholder="Search ticker, company, or insider…"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value, __screen: undefined })}
          />
          <button type="button" className="ins-chip ins-reset"
                  onClick={() => { setFilters(EMPTY); setPage(1); }}>
            Reset
          </button>
        </div>

        <div className="ins-cats">
          {fgroup('Trade', 'trade',
            ['trade_type', 'cluster', 'exclude_derivative', 'include_implausible'], (
            <div className="ins-advgrid">
              <div className="ins-field">
                <label htmlFor="ins-type">Transaction type</label>
                <select id="ins-type" value={filters.trade_type}
                        onChange={(e) => set({ trade_type: e.target.value, __screen: undefined })}>
                  {TRADE_TYPES.map(([v, l]) => <option key={v || 'all'} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="ins-field ins-field-wide">
                <label>Include</label>
                <div className="ins-adv-roles">
                  <button type="button" className={'ins-chip' + (filters.cluster ? ' is-on' : '')}
                          aria-pressed={filters.cluster}
                          title="Two or more separate filings on the same issuer inside the window"
                          onClick={() => set({ cluster: !filters.cluster, __screen: undefined })}>
                    Cluster buys only
                  </button>
                  {/* Derivative legs pair with a common leg on option exercises,
                      so counting both double-counts the position change. But
                      warrants and convertibles appear ONLY as derivative rows. */}
                  <button type="button" className={'ins-chip' + (filters.exclude_derivative ? '' : ' is-on')}
                          aria-pressed={!filters.exclude_derivative}
                          title="Include derivative legs (options, warrants, convertibles)"
                          onClick={() => set({ exclude_derivative: !filters.exclude_derivative })}>
                    Derivatives
                  </button>
                  <button type="button" className={'ins-chip' + (filters.include_implausible ? ' is-on' : '')}
                          aria-pressed={filters.include_implausible}
                          title="Filer price-keying errors are hidden by default (one real filing reports $24,035,774/share for a $0.24 stock)"
                          onClick={() => set({ include_implausible: !filters.include_implausible })}>
                    Suspect prices
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Just the person.
              The Ticker and Company-name fields that used to sit here are gone:
              the company is asked for TWICE above them already — once in the
              rail's shared company box, which every Company tab now uses, and
              again in this panel's own free-text search, which matches ticker
              OR company OR insider. Three boxes for one question, stacked
              vertically, and the one that actually drives the other four tabs
              was the one furthest from the results.

              The name field stays because it is a different question: it
              separates "the person Wynn" from "the company Wynn", which is the
              distinction the free-text search deliberately does not make. */}
          {fgroup('Insider', 'identity', ['insider_name'], (
            <div className="ins-advgrid">
              {textField('Insider name', 'insider_name', 'Smith')}
            </div>
          ))}

          {fgroup('When', 'when', [
            'filed_within_days', 'age_preset', 'age_max_hours', 'age_min_hours',
            'traded_within_days', 'filed_after', 'filed_before',
            'traded_after', 'traded_before', 'filing_delay_min', 'filing_delay_max',
          ], (
            <div className="ins-advgrid">
              <div className="ins-field">
                <label htmlFor="ins-days">Filed within</label>
                <select id="ins-days" value={filters.filed_within_days}
                        onChange={(e) => set({ filed_within_days: e.target.value, __screen: undefined })}>
                  {(vocab?.date_presets || [{ value: '', label: 'Any time' }]).map((d) => (
                    <option key={d.value} value={d.value || ''}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div className="ins-field">
                <label htmlFor="ins-age">Filing age</label>
                <select id="ins-age" value={filters.age_preset}
                        onChange={(e) => set({ age_preset: e.target.value, __screen: undefined })}>
                  {(vocab?.age_presets || [{ value: '', label: 'Any age' }]).map((a) => (
                    <option key={a.value || 'any'} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>
              {boundPair('Filing age, hours', 'age_max_hours', 'age_min_hours',
                         { ph: ['newer than', 'older than'] })}
              <div className="ins-field">
                <label htmlFor="ins-traded-days">Traded within, days</label>
                <input id="ins-traded-days" type="number" min="0" placeholder="e.g. 30"
                       value={filters.traded_within_days}
                       onChange={(e) => set({ traded_within_days: e.target.value, __screen: undefined })} />
              </div>
              {boundPair('Filed between', 'filed_after', 'filed_before', { type: 'date', ph: ['', ''] })}
              {boundPair('Traded between', 'traded_after', 'traded_before', { type: 'date', ph: ['', ''] })}
              {boundPair('Disclosure lag, days', 'filing_delay_min', 'filing_delay_max')}
            </div>
          ))}

          {fgroup('Who', 'who', [...PRIMARY_ROLES, ...ADVANCED_ROLES, 'role_match_any'], (
            <>
              <div className="ins-adv-roles">
                {[...PRIMARY_ROLES, ...ADVANCED_ROLES].map((k) => (
                  <button key={k} type="button"
                          className={'ins-chip' + (filters[k] ? ' is-on' : '')}
                          aria-pressed={filters[k]}
                          onClick={() => set({ [k]: !filters[k], __screen: undefined })}>
                    {ROLE_LABELS[k]}
                  </button>
                ))}
              </div>
              <div className="ins-advgrid">
                <div className="ins-field">
                  <label htmlFor="ins-rolemode">Role match</label>
                  <select id="ins-rolemode" value={filters.role_match_any ? 'any' : 'all'}
                          onChange={(e) => set({ role_match_any: e.target.value === 'any' })}>
                    <option value="any">Any selected role</option>
                    <option value="all">All selected roles</option>
                  </select>
                </div>
              </div>
            </>
          ))}

          {fgroup('How much', 'amount', [
            'value_low', 'value_high', 'price_low', 'price_high',
            'qty_low', 'qty_high', 'owned_change_low', 'owned_change_high',
            'pct_owned_min', 'pct_owned_max',
          ], (
            <div className="ins-advgrid">
              {boundPair('Value $', 'value_low', 'value_high')}
              {boundPair('Price $/share', 'price_low', 'price_high')}
              {boundPair('Shares', 'qty_low', 'qty_high')}
              {boundPair('Position change %', 'owned_change_low', 'owned_change_high')}
              {boundPair('Stake %', 'pct_owned_min', 'pct_owned_max')}
            </div>
          ))}

          {fgroup('Industry', 'industry', ['sic_sector', 'sic_low', 'sic_high'], (
            <div className="ins-advgrid">
              <div className="ins-field ins-field-wide">
                <label htmlFor="ins-sector">Sector</label>
                <select id="ins-sector" value={filters.sic_sector}
                        onChange={(e) => set({ sic_sector: e.target.value, __screen: undefined })}>
                  {(vocab?.sic_sectors || [{ code: '', label: 'All sectors' }]).map((s) => (
                    <option key={s.code || 'all'} value={s.code}>{s.label}</option>
                  ))}
                </select>
              </div>
              {boundPair('SIC code', 'sic_low', 'sic_high')}
            </div>
          ))}

          {fgroup('Issuer activity', 'issuer', [
            'num_filings_min', 'num_filings_max', 'num_insiders_min', 'num_insiders_max',
            'num_officers_min', 'num_officers_max', 'group_value_min', 'group_value_max',
            'min_insiders', 'cluster_window_days',
          ], (
            <div className="ins-advgrid">
              {boundPair('# filings on issuer', 'num_filings_min', 'num_filings_max')}
              {boundPair('# insiders on issuer', 'num_insiders_min', 'num_insiders_max')}
              {boundPair('# officers on issuer', 'num_officers_min', 'num_officers_max')}
              {boundPair('Issuer total value $', 'group_value_min', 'group_value_max')}
              {/* Distinct FILINGS, not names -- a joint filing by four related
                  parties is one decision, not four insiders. */}
              <div className="ins-field">
                <label htmlFor="ins-mininsiders">Cluster: min insiders</label>
                <input id="ins-mininsiders" type="number" min="2" placeholder="2"
                       value={filters.min_insiders}
                       onChange={(e) => set({ min_insiders: e.target.value, __screen: undefined })} />
              </div>
              <div className="ins-field">
                <label htmlFor="ins-clwin">Cluster: window, days</label>
                <input id="ins-clwin" type="number" min="1" placeholder="30"
                       value={filters.cluster_window_days}
                       onChange={(e) => set({ cluster_window_days: e.target.value, __screen: undefined })} />
              </div>
            </div>
          ))}

          {fgroup('Results', 'output', ['sort', 'descending', 'group_by', 'limit'], (
            <div className="ins-advgrid">
              <div className="ins-field">
                <label htmlFor="ins-sort">Sort by</label>
                <select id="ins-sort" value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
                  {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="ins-field">
                <label htmlFor="ins-dir">Order</label>
                <select id="ins-dir" value={filters.descending ? 'desc' : 'asc'}
                        onChange={(e) => set({ descending: e.target.value === 'desc' })}>
                  <option value="desc">Highest / newest first</option>
                  <option value="asc">Lowest / oldest first</option>
                </select>
              </div>
              <div className="ins-field">
                <label htmlFor="ins-grain">Row grain</label>
                <select id="ins-grain" value={filters.group_by} onChange={(e) => set({ group_by: e.target.value })}>
                  <option value="filing">Per filing</option>
                  <option value="transaction">Per transaction</option>
                  <option value="company">Per company</option>
                </select>
              </div>
              <div className="ins-field">
                <label htmlFor="ins-rows">Rows per page</label>
                <select id="ins-rows" value={filters.limit}
                        onChange={(e) => { set({ limit: e.target.value }); setPage(1); }}>
                  {PAGE_SIZES.map((n) => (
                    <option key={n || 'default'} value={n}>{n || `${LIMIT} (default)`}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      </div>
      </aside>

      <div className="ins-main">
      {context && (
        <div className="ins-context">
          <span className="ins-context-kind">{context.kind}</span>
          <b>{context.label}</b>
          <button type="button" title="Back to the default screen"
                  onClick={() => { setFilters(EMPTY); setPage(1); }}>✕</button>
        </div>
      )}


      {activeChips.length > 0 && !filters.__screen && (
        <div className="ins-active">
          {activeChips.map(([k, v]) => (
            <button key={k} type="button" className="ins-chip ins-chip-active"
                    title="Remove this filter"
                    onClick={() => set({ [k]: EMPTY[k] })}>
              {chipLabel(k, v)} ✕
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="ins-error">
          <b>{error.message}</b>
          {error.detail && <p>{error.detail}</p>}
        </div>
      )}

      <div className="ins-tablewrap">
        <table className="ins-table">
          <thead>
            <tr>
              <th>Filed</th>
              <th>Ticker</th>
              <th>Company</th>
              <th>Insider</th>
              <th>Role</th>
              <th>Type</th>
              <th className="ins-r">Shares</th>
              <th className="ins-r">Price</th>
              <th className="ins-r">Value</th>
              <th className="ins-r" title="Change in the insider's position caused by this trade">ΔOwn</th>
              <th className="ins-r" title="Share of the company held after the trade">Stake</th>
              <th className="ins-r" title="Return measured from the trade date, not the filing date">1w</th>
              <th className="ins-r">1m</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const url = secUrl(r.accession_number, r.issuer_cik);
              return (
                <tr key={`${r.accession_number}-${r.trans_code}-${r.trans_date}-${r.shares}`}>
                  <td className="ins-age" title={r.filing_datetime || ''}>{fmtAge(r.filing_datetime)}</td>
                  <td className="ins-tk">
                    {r.ticker
                      ? <button type="button" className="ins-drill" title={`All insider activity in ${r.ticker}`}
                                onClick={() => openTicker(r.ticker)}>{r.ticker}</button>
                      : DASH}
                  </td>
                  <td className="ins-co" title={r.issuer_name || ''}>{r.issuer_name || DASH}</td>
                  <td className="ins-who" title={r.owner_name || ''}>
                    {r.owner_name
                      ? <button type="button" className="ins-drill" title={`${r.owner_name} — insider history across all issuers`}
                                onClick={() => openInsider(r.owner_name)}>{r.owner_name}</button>
                      : DASH}
                    {r.n_owners > 1 && <span className="ins-joint" title="Joint filing by several related parties">+{r.n_owners - 1}</span>}
                  </td>
                  <td className="ins-role">{roleOf(r)}</td>
                  <td>
                    <span className={'ins-code ins-code-' + (r.trans_code || '').toLowerCase()}>
                      {tradeLabel(r.trans_code)}
                    </span>
                  </td>
                  <td className="ins-r">{num(r.shares)}</td>
                  <td className="ins-r">{price(r.price_per_share)}</td>
                  <td className="ins-r ins-val">{money(r.value)}</td>
                  <td className={'ins-r ' + signClass(r.delta_own)}>{pct(r.delta_own)}</td>
                  <td className="ins-r">{stake(r.pct_owned)}</td>
                  <td className={'ins-r ' + signClass(r.r1w)}>{pct(r.r1w)}</td>
                  <td className={'ins-r ' + signClass(r.r1m)}>{pct(r.r1m)}</td>
                  <td className="ins-r">
                    {url && (
                      <a href={url} target="_blank" rel="noopener noreferrer" title="The filing on EDGAR">↗</a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {loading && <div className="ins-note">Loading…</div>}
        {!loading && !rows.length && !error && (
          <div className="ins-note">No filings match this screen.</div>
        )}
      </div>

      <div className="ins-foot">
        <div className="ins-stats">
          {stats && (
            <>
              <Stat label="Filings" value={num(stats.filings)} />
              <Stat label="Transactions" value={num(stats.transactions)} />
              {stats.latest && <Stat label="Latest filing" value={fmtDate(stats.latest)} />}
            </>
          )}
        </div>

        <div className="ins-page">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ‹ Prev
          </button>
          <span>Page {page}</span>
          <button type="button" disabled={!data?.has_more || loading} onClick={() => setPage((p) => p + 1)}>
            Next ›
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

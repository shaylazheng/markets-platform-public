/* The Competitors surface.
 *
 * A bespoke full-bleed surface rather than the three-column workspace: that
 * grid gives each panel roughly a quarter of a column's height, which is
 * unusable for a twelve-column matrix. This surface scrolls internally, which
 * is a deliberate departure -- the shell still never scrolls; .cmp-surface
 * takes over the role .pnl-body plays elsewhere.
 *
 * Cost: nothing on this surface triggers refresh.mjs or sweep.mjs, so no click
 * here can start a headless-Claude run. The one LLM affordance is the briefing
 * button, which is opt-in and cached.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@markets/shell/lib/store.jsx';
import { Panel } from '@markets/shell/components/Panel.jsx';
import { InsightButton } from '@markets/shell/components/InsightButton.jsx';
import { InsightPanel } from '@markets/shell/components/InsightPanel.jsx';
import { PeerPicker } from './components/PeerPicker.jsx';
import { RatioMatrix } from './components/RatioMatrix.jsx';
import { DeepDive } from './components/DeepDive.jsx';
import { useChartDeck } from './components/ChartDeck.jsx';
import { InsiderPulse, InsiderRecord, PeerWire } from './components/Flow.jsx';
import { PeerSources } from './components/Sources.jsx';
import { SegmentCompetitors } from './components/SegmentCompetitors.jsx';
import { MetricReadout } from './components/Readout.jsx';
import { usePeerPalette } from './peerColors.js';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';
import { useRegistry } from '@markets/shell/lib/registry.jsx';
import { registryRows } from '@markets/shell/lib/sourceRows.js';
import { PEER_CAP, SPOT_CAP, TICKER_RE, cleanList } from './peers.js';
import {
  useDeepDive, useMetricDescriptors, usePeerFailures, usePeerInsider,
  usePeerInsiderRecord, usePeerNews, usePeerPanel, usePeerPrices, usePeerRows,
  useResolve, useSuggest,
} from './usePeerData.js';

/* Segment 0 of the hash is the view and belongs to store.jsx; everything after
   is ours, exactly as Insider.jsx does it. */
function readHash() {
  const parts = (location.hash || '').slice(1).split('&');
  return new URLSearchParams(parts.slice(1).join('&'));
}

/* The focal company is seeded by the shell store now (it reads `focus=` and
   `ticker=` from the hash for the whole group), so this only seeds what belongs
   to this surface. `focal` is still returned because the peer-set lookup below
   is keyed on it. */
function initialState() {
  const p = readHash();
  const raw = (p.get('focus') || '').toUpperCase().trim();
  const focal = TICKER_RE.test(raw) ? raw : '';
  let peersCsv = cleanList(p.get('peers')).join(',');
  // A bookmarked link wins; otherwise fall back to the set last built for this
  // company, so returning to it doesn't mean re-adding four chips.
  if (!peersCsv && focal) {
    try { peersCsv = (JSON.parse(localStorage.getItem('cmp:sets') || '{}')[focal] || []).join(','); }
    catch { peersCsv = ''; }
  }
  return {
    focal,
    peersCsv,
    spotCsv: cleanList(p.get('spot'), SPOT_CAP).join(','),
    metric: (p.get('metric') || 'grossMargin').replace(/[^A-Za-z0-9_]/g, ''),
  };
}

const RECORD_YEARS = 5;

export function Competitors() {
  const { nonce, setView, showInsight, company, setCompany } = useApp();
  const [q, setQ] = useState(initialState);
  /* The focal company is the GROUP's, held in the shell store; the peer set,
     spotlight and selected metric are this surface's alone. Splitting them that
     way is what lets Valuation and Management follow the company without
     inheriting a peer list that means nothing to them. */
  const { peersCsv, spotCsv, metric } = q;
  const focal = company;
  const palette = usePeerPalette();

  // Arrays are DERIVED, never stored: a fresh identity each render would
  // re-fire every effect that depends on them.
  const peers = useMemo(() => (peersCsv ? peersCsv.split(',') : []), [peersCsv]);
  const spotlight = useMemo(() => (spotCsv ? spotCsv.split(',') : []), [spotCsv]);
  const all = useMemo(() => (focal ? [focal, ...peers] : []), [focal, peers]);

  const [visibleCategories, setVisibleCategories] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cmp:cols')) || null; } catch { return null; }
  });

  /* Keep the comparison bookmarkable. The guard is load-bearing: without it,
     navigating to Graph and back would stomp #graph&focus=... on the way out. */
  useEffect(() => {
    if (!(location.hash || '').startsWith('#competitors')) return;
    const p = new URLSearchParams();
    if (focal) p.set('focus', focal);
    if (peersCsv) p.set('peers', peersCsv);
    if (spotCsv) p.set('spot', spotCsv);
    if (metric) p.set('metric', metric);
    const tail = p.toString();
    history.replaceState(null, '', `#competitors${tail ? '&' + tail : ''}`);
  }, [focal, peersCsv, spotCsv, metric]);

  useEffect(() => {
    if (!focal) return;
    try {
      const sets = JSON.parse(localStorage.getItem('cmp:sets') || '{}');
      sets[focal] = peers;
      localStorage.setItem('cmp:sets', JSON.stringify(sets));
    } catch { /* storage may be unavailable */ }
  }, [focal, peersCsv, peers]);

  /* The company can now change from OUTSIDE this surface — set it on Valuation,
     come back here, and `q.focal` is stale. Re-seed the peer set from whatever
     was last built for the new company, rather than showing NVDA's peers under
     CME's name. */
  useEffect(() => {
    setQ((s) => {
      if (s.focal === company) return s;
      let remembered = '';
      try { remembered = (JSON.parse(localStorage.getItem('cmp:sets') || '{}')[company] || []).join(','); }
      catch { /* storage may be unavailable */ }
      return { ...s, focal: company, peersCsv: remembered, spotCsv: '' };
    });
  }, [company]);

  /* One selection for the whole surface, exactly as the graph's sidebar keeps
     one `sel` for its whole card: a cell, a bar, a suggestion chip and a wire
     headline all drive the same inspector, so a reader never has to work out
     which panel is currently "the" one being explained. Cleared when the focal
     company changes, because a selection naming the old company would otherwise
     sit there looking current. */
  const [sel, setSel] = useState(null);
  useEffect(() => { setSel(null); }, [focal]);

  const { sources: SURFACE_SOURCES } = useRegistry();
  /* The default view of the inspector: everything the surface as a whole
     relies on, before any single figure is asked about. The focal company's
     own filings are added by PeerSources from the provenance call. */
  const surfaceRows = useMemo(
    () => registryRows(SURFACE_SOURCES.competitors || []), [SURFACE_SOURCES]);

  const { metrics, categories } = useMetricDescriptors();
  const resolved = useResolve(focal);
  const suggest = useSuggest(focal);
  const panel = usePeerPanel(all, nonce);
  const rows = usePeerRows(panel.byTicker, focal, peers);
  const failures = usePeerFailures(panel.byTicker, focal, peers);
  const news = usePeerNews(all, nonce);
  const insiderFlow = usePeerInsider(all, nonce);
  /* The forward-return record is opt-in: it scans five years of purchases per
     peer, which is far more work than the 90-day pulse and answers a question
     nobody has asked until they open it. */
  const [recordOpen, setRecordOpen] = useState(false);
  const record = usePeerInsiderRecord(all, nonce, recordOpen, RECORD_YEARS);
  const prices = usePeerPrices(all, nonce);
  const notes = useDeepDive(focal, nonce);
  const [notesIndex, setNotesIndex] = useState([]);

  useEffect(() => {
    let alive = true;
    fetch('/api/peers/notes/index').then((r) => r.json())
      .then((j) => alive && setNotesIndex(j.tickers || []))
      .catch(() => {});
    return () => { alive = false; };
  }, [nonce]);

  const cats = categories.length ? categories : [];
  const visible = visibleCategories ?? cats;

  /* Changing the company clears the peer set: a comparison built around NVDA
     is not a comparison of CME, and carrying it over silently would put six
     semiconductor firms beside an exchange. */
  const setFocal = useCallback((t) => {
    setCompany(t);
    setQ((s) => (s.focal === t ? s : { ...s, focal: t, peersCsv: '', spotCsv: '' }));
  }, [setCompany]);

  const togglePeer = useCallback((t) => setQ((s) => {
    const cur = s.peersCsv ? s.peersCsv.split(',') : [];
    const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t].slice(0, PEER_CAP);
    const spot = (s.spotCsv ? s.spotCsv.split(',') : []).filter((x) => next.includes(x));
    // A newly added peer takes a free spotlight slot if one is going.
    if (!cur.includes(t) && spot.length < SPOT_CAP) spot.push(t);
    return { ...s, peersCsv: next.join(','), spotCsv: spot.join(',') };
  }), []);

  const toggleSpot = useCallback((t) => setQ((s) => {
    const cur = s.spotCsv ? s.spotCsv.split(',') : [];
    // Oldest evicted: never more than three hues, because a fourth fails the
    // colour-separation floor in dark mode.
    const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t].slice(-SPOT_CAP);
    return { ...s, spotCsv: next.join(',') };
  }), []);

  const addAll = useCallback((ts) => setQ((s) => {
    const cur = s.peersCsv ? s.peersCsv.split(',') : [];
    const next = [...new Set([...cur, ...ts])].slice(0, PEER_CAP);
    const spot = (s.spotCsv ? s.spotCsv.split(',') : [])
      .concat(next.filter((x) => !cur.includes(x)))
      .slice(0, SPOT_CAP);
    return { ...s, peersCsv: next.join(','), spotCsv: [...new Set(spot)].join(',') };
  }), []);

  const selMetric = metrics?.find((m) => m.id === metric) || metrics?.[0];
  const loadedCount = rows.length;
  const totalCount = all.length;

  // How many columns are structurally undefined for the FOCAL company — the
  // number the rail's notice quotes, so "n/a" is explained once instead of
  // twelve times in twelve tooltips.
  const focalRow = rows.find((r) => r.isFocal);
  const naCount = focalRow
    ? Object.values(focalRow.values || {}).filter((v) => v === 'na').length : 0;

  /* Usable as soon as the FOCAL row has landed — not when all fifteen peers
     have. The whole design of this surface is one fetch per ticker filling the
     table row by row; holding the boot cover up for the slowest peer would
     undo that on the one load where it matters most. With no focal company
     there is nothing to wait for: the splash is the screen. */
  useBootGate('competitors', !focal || !!focalRow || failures.some((f) => f.isFocal),
    { done: loadedCount, total: totalCount, what: 'fundamentals' });

  /* Called unconditionally and before any branch — it holds state, and the
     surface renders a splash instead of the bands when there is no focal
     company, which would otherwise change the hook order between renders. */
  const deck = useChartDeck({
    rows, metrics: metrics || [], metric: selMetric, focal, spotlight, palette,
    prices, onSelect: setSel,
  });

  const toggleCategory = (c) => setVisibleCategories((v) => {
    const cur = v ?? cats;
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
    const safe = next.length ? next : cur;
    try { localStorage.setItem('cmp:cols', JSON.stringify(safe)); } catch { /* ignore */ }
    return safe;
  });

  return (
    <section className="view is-active cmp-surface">
      {/* The rail column: the company, this surface's own controls, and the
          provenance for whatever is selected. Sources sat under the matrix —
          spatially close to the cell it explains, which was the argument for
          putting it there — but it is the same block Valuation and Management
          carry in their rails, and one inspector that is always in the same
          place beats three that are each near something. */}
      <div className="cmp-railcol">
      <PeerPicker
        focal={focal} peers={peers} spotlight={spotlight}
        suggestions={suggest.data?.suggestions} suggestLoading={suggest.loading}
        resolved={resolved.data} notesIndex={notesIndex}
        onSetFocal={setFocal} onTogglePeer={togglePeer} onToggleSpot={toggleSpot}
        onAddAll={addAll} onSelect={setSel} selected={sel}
        naCount={naCount}
      />

      {focal && metrics && (
        <Panel swatch="c" title="Sources" flush
               headExtra={sel && <span className="cmp-head-meta">{sel.ticker || ''}</span>}>
          <PeerSources sel={sel} onClose={() => setSel(null)} focal={focal}
                       defaults={surfaceRows} />
        </Panel>
      )}
      </div>

      {/* Everything that is not the input rail. The wrapper exists so the rail
          can be a sticky sibling column rather than the first row of a stack. */}
      <div className="cmp-main">
      {!focal && (
        <div className="cmp-splash">
          <h2>Compare a company with the people it competes with.</h2>
          <p>
            Type a ticker in the rail. Peers are suggested from the company’s own 10-K
            and from filings that name it as a competitor, then filled out by
            industry — all editable.
          </p>
          <p className="muted small">
            Works for any US SEC filer, and for foreign issuers that file 20-F.
          </p>
        </div>
      )}

      {focal && metrics && (
        <>
          <div className="cmp-band">
            <Panel swatch="a" flush
                   title={`Comparison — ${selMetric ? selMetric.label : ''}`}
                   headExtra={
                     <span className="cmp-head-meta">
                       {loadedCount} of {totalCount} loaded
                     </span>
                   }
                   tools={
                     <span className="cmp-cats">
                       {cats.map((c) => (
                         <button key={c} type="button"
                                 className={'cmp-cat' + (visible.includes(c) ? ' is-on' : '')}
                                 aria-pressed={visible.includes(c)}
                                 onClick={() => toggleCategory(c)}>{c}</button>
                       ))}
                     </span>
                   }>
              <MetricReadout rows={rows} metric={selMetric} focal={focal} />

              <RatioMatrix
                rows={rows} metrics={metrics} categories={cats}
                pending={panel.pending} errors={panel.errors} failures={failures} focal={focal}
                visibleCategories={visible}
                selectedMetric={metric}
                onPickTicker={setFocal}
                onPickMetric={(id) => setQ((s) => ({ ...s, metric: id }))}
                onSelect={setSel} selected={sel}
              />
            </Panel>
          </div>

          {/* One peer set is the right altitude for a focused company and the
              wrong one for a conglomerate — AWS competes with Azure while the
              retail arm competes with Walmart. The by-segment groups sit
              directly under the matrix so a chip press lands its company in
              the table the reader is already looking at. */}
          <div className="cmp-band">
            <Panel swatch="c" title="Competitors by segment"
                   headExtra={<span className="cmp-head-meta">per business, from the researched intel</span>}>
              <SegmentCompetitors focal={focal} peers={peers}
                                  onTogglePeer={togglePeer} onAddAll={addAll} />
            </Panel>
          </div>

          {/* Seven charts in one frame. They were three panels down a scrolling
              column, so no two were ever on screen together; only one is ever
              being read, so the other six cost nothing but a click. */}
          <div className="cmp-band">
            <Panel swatch="b" title={deck.title}
                   tools={<>{deck.axisPickers}{deck.switcher}</>}>
              {deck.body}
            </Panel>
          </div>

          <div className="cmp-band cmp-band-2">
            <Panel swatch="b" title="Insider pulse — net Form 4, 90 days">
              <InsiderPulse data={insiderFlow.data} focal={focal} days={90} setView={setView}
                            onSelect={setSel} selected={sel} />
              <InsiderRecord state={record} focal={focal} years={RECORD_YEARS}
                             open={recordOpen} onToggle={() => setRecordOpen((v) => !v)}
                             onSelect={setSel} selected={sel} />
            </Panel>
            <Panel swatch="c" title="Peer wire — filings and headlines" flush>
              <PeerWire items={news.items} focal={focal} onPickTicker={setFocal}
                        onSelect={setSel} selected={sel} />
            </Panel>
          </div>

          <div className="cmp-band cmp-band-2">
            <Panel swatch="a" title="Read the comparison"
                   tools={
                     <InsightButton
                       id={`competitors:${focal}:${[...peers].sort().join(',')}`}
                       title={`${focal} vs ${peers.join(', ') || 'its peers'}`}
                       meta={selMetric?.label}
                       payload={() => ({
                         kind: 'competitors',
                         competitors: {
                           focal,
                           frame: rows[0]?.frame,
                           metrics: metrics.map((m) => ({ id: m.id, label: m.label })),
                           rows: rows.map((r) => ({ ticker: r.ticker, name: r.meta?.name,
                                                    values: r.values })),
                         },
                       })} />
                   }>
              <InsightPanel />
            </Panel>
            <Panel swatch="b" title={`Deep dive — ${focal}`}>
              <DeepDive ticker={focal} state={notes} onPickTicker={setFocal} />
            </Panel>
          </div>
        </>
      )}
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { mountGraph } from './main.js';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';
import { useApp } from '@markets/shell/lib/store.jsx';
import { CompanyRail } from '@markets/shell/components/CompanyRail.jsx';

// The company graph surface. The d3 canvas is imperative and owns its own DOM,
// so this view renders the skeleton it expects (the same ids the standalone
// company-supply-graph page used) and hands the container to mountGraph().
//
// The graph's own top strip lives here rather than in the shared TopBar: search,
// focus, and the refresh log are surface-specific and would be dead weight on
// Markets or Learn.
export function Graph() {
  const hostRef = useRef(null);
  const apiRef = useRef(null);
  const [error, setError] = useState(null);
  const [mounted, setMounted] = useState(false);
  const { company, setCompany } = useApp();

  // The d3 canvas owns its own DOM and paints nothing until mountGraph
  // resolves, so its promise is exactly the right gate.
  useBootGate('graph', mounted || !!error, { what: 'company graph' });

  /* What the CANVAS is centred on, which is not necessarily the company the
     rest of the Company group is on. Entering a company in the graph's own
     search changes this and nothing else — see onRoot in main.js. */
  const [root, setRoot] = useState({ id: null, name: '' });
  const [busy, setBusy] = useState(false);

  /* Two layout toggles, persisted the way the zone collapses are — a plain
     localStorage flag. ⊟ collapses the canvas to a strip so the rail sections
     take the full width; Expand widens the rail while the canvas stays. Both
     change the canvas's box, and main.js only recenters on the window resize
     event, so each flip re-fires that path explicitly. */
  /* `?canvasmin=1` / `?railwide=1` win over stored state for the same reason
     useVariant honors `?look=`: a headless screenshot runs on a fresh profile
     with no localStorage, and these states are otherwise unreachable from a
     URL. Query, not hash — the hash tail belongs to the surface. */
  const readFlag = (k, q) => {
    try {
      const v = new URLSearchParams(location.search).get(q);
      if (v != null) return v === '1';
    } catch { /* no location under SSR */ }
    try { return localStorage.getItem(k) === '1'; } catch { return false; }
  };
  const [canvasMin, setCanvasMin] = useState(() => readFlag('graph-canvas-min', 'canvasmin'));
  const [railWide, setRailWide] = useState(() => readFlag('graph-rail-wide', 'railwide'));
  const [sideMin, setSideMin] = useState(() => readFlag('graph-sidebar-min', 'sidebarmin'));
  useEffect(() => {
    try {
      localStorage.setItem('graph-canvas-min', canvasMin ? '1' : '');
      localStorage.setItem('graph-rail-wide', railWide ? '1' : '');
      localStorage.setItem('graph-sidebar-min', sideMin ? '1' : '');
    } catch { /* storage can be unavailable */ }
    window.dispatchEvent(new Event('resize'));
  }, [canvasMin, railWide, sideMin]);
  const graphRoot = root.id;
  const rootName = root.name;
  const stats = root;

  useEffect(() => {
    let teardown = null;
    let cancelled = false;
    setError(null);
    mountGraph(hostRef.current, {
      onRoot: (info) => !cancelled && setRoot(info),
      onBusy: (b) => !cancelled && setBusy(b),
    })
      .then((api) => {
        if (cancelled) { api?.destroy?.(); return; }
        apiRef.current = api;
        teardown = api?.destroy;
        setMounted(true);
        /* Deliberately does NOT focus the shared company. Arriving here from
           Valuation used to draw whatever company that tab held, so the canvas
           was never actually empty and you were looking at a graph you had not
           asked for. Nothing lands on it now but what you enter. */
      })
      .catch((e) => !cancelled && setError(e.message || String(e)));
    return () => {
      cancelled = true;
      apiRef.current = null;
      teardown?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="graph-surface" ref={hostRef}
         data-canvas-min={canvasMin ? '1' : undefined}
         data-rail-wide={railWide ? '1' : undefined}
         data-sidebar-min={sideMin ? '1' : undefined}>
      {/* No surface-level top strip. Once the search moved to the rail and the
          metric picker went, all this 54px band held was a stat line — and the
          rail's facts tiles already say the same three numbers. A band of
          chrome that repeats what is directly beneath it is worse than no
          band. */}

      {error && (
        <div className="graph-error">
          <b>The graph could not load its data.</b>
          <p>{error}</p>
          <p className="hint">
            The dataset comes from <code>GET /api/graph/data</code>, so the gateway has to be running:
            <code>npm run dev:api</code> (or <code>npm start</code>).
          </p>
        </div>
      )}

      <div id="app">
        <aside id="sidebar">
          <div className="gr-sidebar-bar">
            <button type="button" className="mini"
                    title={sideMin ? 'Restore the company panel' : 'Minimize the company panel — the canvas takes the width'}
                    onClick={() => setSideMin((v) => !v)}>
              {sideMin ? '⊞ Company' : '⊟'}
            </button>
          </div>
          {/* The ONE company box on this surface. There used to be a second in
              the top strip; this is the survivor, so it submits into the
              graph's full entry path (api.enter) rather than the shell's
              setCompany. That is the difference that matters: `enter` will
              research and ADD a company the graph has never seen, which the
              rail's usual "renders, it does not fetch" contract does not allow,
              and it deliberately does NOT write the shared company — the
              Company tabs stay where they are until you press the button in the
              marker below. `ticker` is therefore the canvas root, not the
              shared company. */}
          <CompanyRail
            view="graph"
            ticker={graphRoot || ''}
            name={rootName || ''}
            placeholder="ticker or name — loads it here"
            busy={busy}
            onSubmit={(t) => apiRef.current?.enter?.(t)}
            facts={graphRoot ? [
              { label: 'Connections', value: stats.connections ?? '—' },
              { label: 'On canvas', value: stats.companies ?? '—', sub: `${stats.graphs || 0} graph${stats.graphs === 1 ? '' : 's'}` },
              { label: 'Links drawn', value: stats.links ?? '—' },
            ] : []}
          >
            <div id="focus-bar" hidden>
              <span id="focus-name" />
              <button id="refresh-btn" title="Re-research this company's earnings intel via headless Claude">⟳ Refresh</button>
              <button id="clear-btn" title="Clear the canvas">✕</button>
            </div>
            <div id="refresh-log" hidden />
          </CompanyRail>

          {/* The graph's own search deliberately does not write the shared
              company, so the canvas and the other Company surfaces can sit on
              different names. Silent divergence is the confusing kind, so it is
              stated — and syncing stays an explicit press, either direction. */}
          {graphRoot && company && graphRoot !== company && (
            <div className="gr-diverged" role="status">
              <div className="gd-row">
                <span className="gd-dot" aria-hidden="true" />
                <span className="gd-text">
                  Canvas is on <b>{graphRoot}</b>; the Company tabs are on <b>{company}</b>.
                </span>
              </div>
              <div className="gd-actions">
                <button type="button" className="mini" onClick={() => setCompany(graphRoot)}>
                  Move the tabs to {graphRoot}
                </button>
                <button type="button" className="mini"
                        onClick={() => apiRef.current?.focus?.(company)}>
                  Show {company} here
                </button>
              </div>
            </div>
          )}
          {graphRoot && company && graphRoot === company && (
            <p className="gr-synced" role="status">
              <span className="gs-tick" aria-hidden="true">✓</span> Same company as the other Company tabs.
            </p>
          )}

          {/* Progress lives here rather than over the canvas: the research leg
              runs for minutes after the draft is already drawn, and an overlay
              covering the graph for that whole time hides the thing it is
              reporting on. */}
          <div id="graph-loading" hidden>
            <div className="gl-card">
              <div className="gl-head">
                <span className="gl-spinner" aria-hidden="true" />
                <span className="gl-title" id="gl-title" />
                <span className="gl-elapsed" id="gl-elapsed" />
              </div>
              <ol className="gl-steps" id="gl-steps" />
              <pre className="gl-log" id="gl-log" hidden />
              <div className="gl-foot" id="gl-foot" />
            </div>
          </div>
          <div className="zone" id="zone-company">
            <button className="zone-head" id="company-zone-toggle">
              <span className="zone-title company">Company</span>
              <span className="zone-sub" id="company-zone-sub" />
              <span className="zone-caret" id="company-zone-caret">▾</span>
            </button>
            <div id="detail" />
          </div>
        </aside>

        <main id="graph">
          <button type="button" className="mini gr-canvas-toggle"
                  title={canvasMin ? 'Restore the canvas' : 'Minimize the canvas — the rail sections take the width'}
                  onClick={() => setCanvasMin((v) => !v)}>
            {canvasMin ? '⊞ Show graph' : '⊟'}
          </button>

          <div id="empty-hint">
            <p>
              <b>Nothing loaded yet.</b>
              <br />
              Enter a company in the Company box on the left — ticker or name. It becomes the centre of the canvas and
              its counterparties are drawn around it, coloured by what they are to it.
              Entering another company replaces it; press <b>☆ Save graph</b> in its panel to keep one, and
              saved graphs become toggles in the rail. Graphs sharing a company merge through it;
              graphs sharing nothing stay separate.
            </p>
          </div>
          <div id="graph-key">
            <div className="gk-head">
              <span>Key</span>
              <button id="gk-toggle" title="Collapse / expand">–</button>
            </div>
            <div className="gk-body" />
          </div>

          <div id="corr-overlay" hidden>
            <div className="co-head">
              <span className="co-title">Correlation grid</span>
              <span className="co-sub" id="co-sub" />
              <button className="mini" id="co-close" title="Close">✕</button>
            </div>
            <div className="co-scroll" id="co-grid" />
            <div className="co-foot" id="co-foot" />
          </div>
        </main>

        <aside id="rail">
          {/* Hidden while the canvas is minimized — the rail is already full
              width there, so the toggle would be a dead control. */}
          <div className="gr-railbar">
            <button type="button" className="mini"
                    title={railWide ? 'Back to the narrow rail' : 'Widen the rail — sections lay out side by side'}
                    onClick={() => setRailWide((v) => !v)}>
              {railWide ? 'Narrow rail ⇥' : '⇤ Expand rail'}
            </button>
          </div>
          <div className="zone" id="zone-graph">
            <button className="zone-head" id="graph-zone-toggle">
              <span className="zone-title graph">Graph</span>
              <span className="zone-caret" id="zone-caret">▾</span>
            </button>
            <div className="zone-body" id="graph-zone-body">
              <details className="secc" id="formation" hidden open>
                <summary>
                  <span className="ws-title">Formation</span>
                  <span id="fm-pct" />
                </summary>
                <div className="fm-bar"><div id="fm-fill" /></div>
                <div id="fm-detail" className="fm-detail" />
              </details>

              <details className="secc" id="saved-graphs" open>
                <summary><span className="ws-title">Saved graphs</span></summary>
                <div id="saved-list" />
              </details>

              {/* NOT id="companies" — that is the search field's datalist, and
                  main.js fills it by id. */}
              <details className="secc" id="companies-sec" open>
                <summary>
                  <span className="ws-title">Companies</span>
                  <span className="ws-sub" id="companies-sub" />
                </summary>
                <div id="companies-list" />
              </details>

              <details className="secc" id="connections" open>
                <summary><span className="ws-title">Connections</span></summary>
                <div id="conn-list" />
              </details>

              <details className="secc" id="dataset-sec">
                <summary><span className="ws-title">Dataset</span></summary>
                <div id="meta" />
              </details>

              <details className="secc" id="corr-sec">
                <summary><span className="ws-title">Correlation grid</span></summary>
                <div id="corr-body">
                  <button className="mini" id="corr-btn"
                          title="Pairwise correlation of daily returns for every company in the graph">
                    ▦ Open grid
                  </button>
                  <div id="corr-hint" className="fm-detail" />
                </div>
              </details>

              <details className="secc" id="signals-sec" hidden>
                <summary><span className="ws-title" id="signals-title">⚡ Signals</span></summary>
                <div id="signals-body">
                  <button className="mini" id="signals-btn"
                          title="Poll EDGAR 8-Ks, Google News, and Finnhub now (the gateway also polls every 20 min)">
                    Poll now
                  </button>
                  <div id="signals-list" />
                </div>
              </details>

              <div className="zone-actions">
                <button className="mini" id="sweep-btn"
                        title="Audit every company's data and re-research anything stale (runs headless Claude per stale ticker — can take a while)">
                  ⟳ Sweep stale data
                </button>
              </div>

              <details className="secc" id="about-sec">
                <summary><span className="ws-title">About the data</span></summary>
                <footer>
                  <p>Node size ∝ revenue · arrows point supplier → customer · <span className="v">✓</span> = confirmed in a 10-K.</p>
                  <p className="src" />
                </footer>
              </details>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

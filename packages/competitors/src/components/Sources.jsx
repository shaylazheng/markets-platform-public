/* The Competitors surface's source inspector — now an adapter over the shell's
 * SourceInspector, which every Company surface renders. What stays here is
 * what only this surface knows: which selection kinds need the filing trace,
 * the trace fetch itself, the TTM decomposition tables, and the note that the
 * graph has researched the same company.
 *
 * Which documents back a claim is decided in peerSources.js, which is pure and
 * tested. This file only fetches and composes. Provenance is one call per
 * (ticker, frame), made when something is actually selected, and memoised for
 * the session.
 */
import { useEffect, useMemo, useState } from 'react';
import { SourceInspector, TraceParts } from '@markets/shell/components/SourceInspector.jsx';
import { pinFigure } from '@markets/shell/lib/pins.js';
import { fetchProvenance } from '../peers.js';
import { companySources, describe, metricTraces, sourcesFor } from '../peerSources.js';
import { money, num } from '@markets/insider/insider.js';

/* Formatted by the concept's own XBRL unit. `money()` prefixes a dollar sign,
   which is right for revenue and wrong for a share count; and it rounds to the
   nearest dollar, which turns a $3.42 EPS into "$3". */
function fmtVal(v, unit) {
  if (v == null) return '—';
  if (unit === 'shares') return num(v);
  if (unit === 'USD/shares') return `$${v.toFixed(2)}`;
  return (v < 0 ? '−' : '') + money(Math.abs(v));
}

export function PeerSources({ sel, onClose, focal = '', defaults = [] }) {
  const [prov, setProv] = useState(null);
  const [state, setState] = useState('idle');

  /* A metric or whole-company selection needs the filing trace; a wire
     headline or an insider row already carries its own source. With NOTHING
     selected the trace is fetched for the focal company instead, so the
     default view lists its actual latest 10-K and 10-Q rather than a generic
     "EDGAR" row — same memoised call the first cell click would make. */
  const needsProv = sel && (sel.kind === 'metric' || sel.kind === 'company');
  const provTicker = needsProv ? sel.ticker : (!sel && focal ? focal : null);
  const provFrame = needsProv ? sel.frame : undefined;
  const key = provTicker ? `${provTicker}:${provFrame || ''}` : null;

  useEffect(() => {
    if (!key) { setProv(null); setState('idle'); return; }
    let alive = true;
    setState('loading');
    fetchProvenance(provTicker, provFrame)
      .then((j) => { if (alive) { setProv(j.error ? null : j); setState(j.error ? 'error' : 'ok'); } })
      .catch(() => { if (alive) { setProv(null); setState('error'); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const srcs = useMemo(() => sourcesFor(sel, prov), [sel, prov]);
  const traces = useMemo(
    () => (sel?.kind === 'metric' ? metricTraces(prov, sel.metric.id) : []), [sel, prov]);

  /* A pinned peer cell files under the FOCAL company's report — the report is
     a document about the focal name, and a peer's figure in it is a comparison.
     The peer's ticker travels in the label so the table stays attributable. */
  const onPin = focal
    ? (s, opts) => pinFigure(focal, {
        label: s.ticker === focal ? s.metric.label : `${s.ticker} — ${s.metric.label}`,
        value: s.display, sub: s.frame || '', surface: 'competitors',
      }, opts)
    : undefined;

  const defaultRows = useMemo(() => {
    const seen = new Set();
    return [...(sel ? [] : companySources(prov)), ...defaults].filter((s) => {
      if (s.url && seen.has(s.url)) return false;
      if (s.url) seen.add(s.url);
      return true;
    });
  }, [sel, prov, defaults]);

  return (
    <SourceInspector
      sel={sel} onClose={onClose}
      d={sel ? describe(sel, prov) : null}
      sources={srcs}
      state={needsProv ? state : 'ok'}
      defaults={defaultRows}
      defaultsIntro={'Everything this surface draws on. Click any cell, ticker, suggestion, '
        + 'wire headline or insider row — or press a src button — to trace one figure '
        + 'to the documents behind it.'}
      onPin={onPin}
    >
      {traces.map((tr) => <TraceParts key={tr.id} trace={tr} fmtVal={fmtVal} />)}

      {sel && prov?.filings?.fromGraph && (
        <div className="cmp-src-graphnote">
          The company graph has researched {sel.ticker} — its inspector cites the
          same filings, plus {Object.keys(prov.filings.fromGraph.quarters).length} earnings
          announcements matched to their 8-Ks.
        </div>
      )}
    </SourceInspector>
  );
}

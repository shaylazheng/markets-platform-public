/* The Alerts surface: every alert source, rendered the same way.
 *
 * The surface is a WINDOW onto the sources, not the sources — the loops run in
 * the gateway whether or not this tab exists, so closing the dashboard does not
 * stop the texts. Everything here is read from GET /api/alerts every two
 * seconds while the surface is mounted.
 *
 * ADDING A SOURCE CHANGES NOTHING IN THIS FILE. The server's registry decides
 * what exists; SourcePanel renders whatever comes back. The only per-source
 * code here is BODIES — a source that returns a custom `detail` body registers
 * its component under `detail.kind`, and a source without one just renders the
 * uniform frame.
 */
import { useCallback, useEffect, useState } from 'react';
import { Panel } from '@markets/shell/components/Panel.jsx';
import { useApp } from '@markets/shell/lib/store.jsx';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';
import { SourcePanel, fmtTime } from './SourcePanel.jsx';
import { HeatBody, HeatHeader } from './HeatBoard.jsx';

const REFRESH_MS = 2000;

const getJSON = async (url) => { const r = await fetch(url); const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const send = async (method, url, body) => {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.delivery?.error || `HTTP ${r.status}`);
  return j;
};

const fmtPct = (p) => p == null ? '—' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p * 100).toFixed(2)}%`;
const fmtNum = (v) => v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dirOf = (p) => p == null ? 'flat' : p < 0 ? 'down' : p > 0 ? 'up' : 'flat';

/* ---- delivery, which is shared by every source -------------------------- */

function Delivery({ channel }) {
  return (
    <Panel id="pnl-al-delivery" swatch="a" title="Delivery">
      <div className={'al-channel' + (channel.ready ? ' is-ready' : ' is-off')}>
        <span className="al-dot" aria-hidden="true" />
        {channel.ready ? <><strong>{channel.channel}</strong> → {channel.to}</> : <>{channel.why}</>}
      </div>
      {!channel.ready && (
        <p className="read small">
          Set <code>ALERT_TO=+1…</code> in <code>.env</code> and restart the gateway. iMessage from this Mac
          is the default; <code>ALERT_CHANNEL=sms</code> or <code>twilio</code> are the alternatives.
        </p>
      )}
    </Panel>
  );
}

/* ---- the drop tracker's own body ---------------------------------------- */
/* Registered under detail.kind === 'symbols'. This is the ONLY source-specific
   view code on the surface, and it exists because the drop tracker is the only
   source with a per-symbol watch list to edit. */

function Pill({ t, firedAt }) {
  return (
    <span className={'al-pill' + (firedAt ? ' is-fired' : '')}
          title={firedAt ? `Crossed ${t}% at ${fmtTime(firedAt)} ET` : `Armed — texts at −${t}%`}>
      −{t}%{firedAt && <span className="al-pill-t">{fmtTime(firedAt)}</span>}
    </span>
  );
}

function Row({ s, onChange }) {
  const q = s.quote;
  const stale = q && !q.ok;
  const remove = async () => { try { await send('DELETE', `/api/alerts/watch/${encodeURIComponent(s.symbol)}`); onChange(); } catch { /* the index refuses; fine */ } };
  return (
    <div className={'al-row' + (stale ? ' is-err' : '') + (s.kind === 'index' ? ' is-index' : '')}
         title={q?.ok && q.time ? `last print ${fmtTime(q.time)} ET` : stale ? q.error : ''}>
      <span className="al-name">
        <span className="al-sym">{s.kind === 'index' ? s.label : s.symbol}</span>
        <span className="al-desc">{stale ? q.error : (q?.name && q.name !== s.symbol ? q.name : s.label !== s.symbol ? s.label : '')}</span>
      </span>
      <span className="al-last">{q?.ok ? fmtNum(q.last) : '…'}</span>
      <span className={'al-chg ' + dirOf(q?.pct)}>{q?.ok ? fmtPct(q.pct) : ''}</span>
      <span className="al-pills">
        {s.context
          ? <span className="al-own" title="Watched and printed in the alert, but never fires one">context</span>
          : <>{s.thresholds.map((t) => <Pill key={t} t={t} firedAt={s.fired[t]} />)}{s.own && <span className="al-own" title="This symbol has its own threshold list">own</span>}</>}
      </span>
      <span className="al-next">
        {s.context ? <span className="muted">rides on the alert’s text</span>
          : s.next == null ? <span className="muted">all fired</span>
          : s.toNext == null ? '' : s.toNext === 0 ? <span className="down">at −{s.next}%</span>
          : <>{s.toNext.toFixed(2)} pts to −{s.next}%</>}
      </span>
      <button type="button" className="al-x" title={s.kind === 'index' ? 'The pinned symbol stays' : `Stop watching ${s.symbol}`}
              disabled={s.kind === 'index'} onClick={remove} aria-label={`Remove ${s.symbol}`}>×</button>
    </div>
  );
}

function SymbolsBody({ detail, onChange }) {
  const [sym, setSym] = useState('');
  const [ctx, setCtx] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const add = async (e) => {
    e.preventDefault();
    const s = sym.trim().toUpperCase();
    if (!s) return;
    setBusy(true); setErr(null);
    try { await send('POST', '/api/alerts/watch', { symbol: s, context: ctx }); setSym(''); onChange(); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="al-body">
      <form className="al-add" onSubmit={add}>
        <input className="pnl-search" value={sym} placeholder="Add ticker" aria-label="Add a ticker to watch"
               onChange={(e) => setSym(e.target.value)} />
        <label className="al-ctx" title="Watch and print it, but never fire an alert on it">
          <input type="checkbox" checked={ctx} onChange={(e) => setCtx(e.target.checked)} /> context
        </label>
        <button type="submit" className="btn sm" disabled={busy || !sym.trim()}>{busy ? '…' : 'Watch'}</button>
      </form>
      {err && <div className="err al-add-err">{err}</div>}
      <div className="al-head">
        <span>Symbol</span><span>Last</span><span>Today</span><span>Thresholds</span><span>Next</span><span />
      </div>
      {detail.symbols.map((s) => <Row key={s.symbol} s={s} onChange={onChange} />)}
      {!detail.symbols.length && <div className="tbl-empty">Nothing watched.</div>}
    </div>
  );
}

/** detail.kind -> the component that renders it. A source whose kind is not
 *  here still renders the uniform frame; it is not an error. */
const BODIES = { symbols: SymbolsBody, heat: HeatBody };

/* ---- the surface -------------------------------------------------------- */

const SWATCHES = ['b', 'c', 'd', 'a'];

export function Alerts() {
  const { nonce } = useApp();
  const [state, setState] = useState({ data: null, error: null });
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => getJSON('/api/alerts')
    .then((j) => { setState({ data: j, error: null }); setNow(Date.now()); })
    .catch((e) => setState((s) => ({ data: s.data, error: e.message }))), []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, nonce]);

  useBootGate('alerts', !!state.data || !!state.error, { what: 'the alert sources' });

  const { data, error } = state;
  if (!data) {
    return (
      <section className="view is-active ws ws-alerts">
        <Panel swatch="a" title="Alerts">
          {error ? <div className="err">Couldn’t reach the sources: {error}</div> : <div className="loading">Loading…</div>}
        </Panel>
      </section>
    );
  }

  /* Every source is a small box, stacked in registry order, and each expands
     in place. They share one column rather than being spread across three: a
     collapsed source is one line, so a column each would be mostly whitespace,
     and the widest thing any of them opens into (the watch table) wants the
     room. Nothing here names a source. */
  const sources = data.sources || [];
  /* The board across the top is the one exception to "one box per source":
     whichever source returns a `heat` detail gets its rows shown up here as
     well as in its box, because a list of what the press is converging on
     is the thing to see first. Keyed on the detail kind, not a source id. */
  const board = sources.find((s) => s.detail?.kind === 'heat') || null;
  return (
    <section className="view is-active ws ws-alerts">
      {board && <HeatHeader source={board} now={now} />}
      <div className="al-cols">
        <div className="col col-left">
          <Delivery channel={data.channel} />
        </div>
        <div className="col col-center">
          {error && <div className="err al-banner">Sources unreachable — showing the last answer: {error}</div>}
          <div className="al-stack">
            {sources.map((s, i) => (
              <SourcePanel key={s.id} data={s} now={now} onChange={load} bodies={BODIES}
                           swatch={SWATCHES[i % SWATCHES.length]} />
            ))}
          </div>
          {!sources.length && <Panel swatch="c" title="Sources"><div className="tbl-empty">No alert sources are running.</div></Panel>}
        </div>
      </div>
    </section>
  );
}

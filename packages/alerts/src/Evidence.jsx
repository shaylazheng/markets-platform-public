/* The Evidence surface: the record behind the signals.
 *
 * The Monitor answers "is it running, and what has it sent recently" — one box
 * per source, the recent tail of each. This answers the two questions that
 * shape will not:
 *
 *   Did it fire?      Every message every source has sent, on ONE timeline, in
 *                     full retention rather than the last fifty. A signal you
 *                     half-remember from Tuesday is findable here and nowhere
 *                     else, because on the Monitor it is behind a collapsed
 *                     box, three sources along, already scrolled off.
 *   Was the feed up?  The telemetry beside it. An empty morning means one of
 *                     two completely different things — nothing happened, or
 *                     nothing was WATCHED — and a record that cannot tell them
 *                     apart is worse than no record, because it reads as the
 *                     reassuring one.
 *
 * Everything comes from GET /api/alerts/evidence, which merges and flattens
 * server-side; this file sorts nothing and derives no outcomes. It is read-only
 * on purpose: acting on a source belongs on the Monitor, next to that source's
 * own state.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel } from '@markets/shell/components/Panel.jsx';
import { useApp } from '@markets/shell/lib/store.jsx';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';
import { fmtTime, ago } from './SourcePanel.jsx';

/* Fifteen seconds, not the Monitor's two. Nothing here is a countdown to a
   threshold — it is a record, and re-fetching a mostly-unchanged history at
   the Monitor's cadence would spend the request on nothing. New entries still
   arrive within a glance, and ⟳ in the top bar is immediate. */
const REFRESH_MS = 15_000;

const ET_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
});
const dayOf = (iso) => { try { return ET_DAY.format(new Date(iso)); } catch { return '—'; } };
const secs = (ms) => ms == null ? '—' : ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`;
const flatten = (t) => String(t || '').split('\n').map((l) => l.trim()).filter(Boolean).join(' · ');

const getJSON = async (url) => {
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};

/* The four outcomes the route emits, in the order they matter when something
   has gone wrong: failures first among the ones you would go looking for. */
const OUTCOMES = ['sent', 'follow-up', 'failed', 'test'];

/* ---- the feed rail ------------------------------------------------------ */
/* This and EvidenceTimeline below are exported because they are the surface's
   two presentational units, and `npm run test:render:alerts` renders them
   directly against constructed payloads — the surface itself cannot be, since
   it reads the store and fetches. Nothing else imports them. */

/** One line per source: alive, how often, how healthy, how much it has said.
 *  This is the same telemetry the Monitor shows inside each expanded box, and
 *  it is repeated here rather than linked to because it is the half of the
 *  answer — an empty timeline is only good news if the feeds were up. */
export function EvidenceFeed({ f, count, now, selected, onSelect }) {
  const h = f.source || {};
  return (
    <div className={'ev-feed' + (selected ? ' is-sel' : '') + (h.errors ? ' is-err' : '')}>
      <button type="button" className="ev-feed-hit"
              aria-pressed={selected}
              title={selected ? 'Show every source again' : `Show only ${f.title}`}
              onClick={() => onSelect(selected ? null : f.id)}>
        <span className={'al-dot' + (f.running ? ' is-live' : '')} aria-hidden="true" />
        <span className="ev-feed-name">{f.title}</span>
        <span className="ev-feed-n">{count}</span>
      </button>
      <div className="ev-feed-meta">
        <span><i>every</i> {secs(f.cadenceMs)}</span>
        <span><i>poll</i> {ago(h.lastOk, now)} ago{h.latencyMs != null ? ` · ${h.latencyMs}ms` : ''}</span>
        <span><i>n</i> {h.polls ?? 0}</span>
        {/* Per source, because they differ — the drop tracker keeps 500 and the
            base class 300, and one number for both would be wrong for one. */}
        {f.logCap != null && <span><i>keeps</i> {f.logCap}</span>}
        {h.errors ? <span className="down">{h.errors} err</span> : null}
      </div>
      {h.lastError && <div className="err ev-feed-err">{h.lastError}</div>}
    </div>
  );
}

/* ---- the timeline ------------------------------------------------------- */

/** One line per message, the text as sent a click away — the Monitor's log
 *  line plus the source it came from, which is the column that only means
 *  something once the sources are merged. */
function Entry({ it, showSource }) {
  const [open, setOpen] = useState(false);
  const failed = it.outcome === 'failed';
  return (
    <div className={'al-line ev-line' + (failed ? ' is-failed' : '') + (it.outcome === 'test' ? ' is-test' : '')}>
      <button type="button" className="al-line-hit" onClick={() => setOpen((v) => !v)}
              title={failed ? it.error || 'not sent' : it.channel ? `Sent via ${it.channel}` : ''}>
        <span className="al-line-t">{fmtTime(it.at)}</span>
        {showSource && <span className="ev-line-src">{it.sourceTitle}</span>}
        <span className={'al-line-tag ' + (failed ? 'down' : 'up')}>{it.outcome}</span>
        {it.latencyMs != null && <span className="al-line-ms">{it.latencyMs}ms</span>}
        <span className="al-line-txt">{flatten(it.text) || (failed ? it.error : '—')}</span>
      </button>
      {open && (
        <div className="ev-open">
          <pre className="al-log-text">{it.text || '(no text)'}</pre>
          {failed && it.error && <div className="err ev-feed-err">{it.error}</div>}
        </div>
      )}
    </div>
  );
}

/** The timeline, cut into ET days. The divider is what makes a gap legible:
 *  four entries in a row read as continuous until you see two dates between
 *  them. */
export function EvidenceTimeline({ entries, showSource }) {
  if (!entries.length) return <div className="al-empty ev-pad">Nothing matches.</div>;
  const out = [];
  const seen = new Map();
  let day = null;
  for (const it of entries) {
    const d = dayOf(it.at);
    if (d !== day) { day = d; out.push(<div key={`d-${d}`} className="ev-day">{d}</div>); }
    /* Keyed by source and timestamp, NOT by position: a new entry arrives at
       the top every refresh, and a positional key would slide an expanded row's
       open state onto whichever entry inherited its index. The counter only
       exists to keep two same-second entries from one source distinct. */
    const base = `${it.sourceId}-${it.at}`;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.push(<Entry key={n ? `${base}-${n}` : base} it={it} showSource={showSource} />);
  }
  return <>{out}</>;
}

/* ---- the surface -------------------------------------------------------- */

export function Evidence() {
  const { nonce } = useApp();
  const [state, setState] = useState({ data: null, error: null });
  const [now, setNow] = useState(() => Date.now());
  const [source, setSource] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [q, setQ] = useState('');

  const load = useCallback(() => getJSON('/api/alerts/evidence')
    .then((j) => { setState({ data: j, error: null }); setNow(Date.now()); })
    .catch((e) => setState((s) => ({ data: s.data, error: e.message }))), []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, nonce]);

  useBootGate('evidence', !!state.data || !!state.error, { what: 'the record' });

  const { data, error } = state;
  const entries = data?.entries || [];
  const feeds = data?.feeds || [];

  /* Counts are of the WHOLE record, not the filtered view: a chip that reads
     "failed 3" and then shows three is right; one that reads "failed 0"
     because a source filter is already on is a lie about the record. */
  const counts = useMemo(() => {
    const c = { total: entries.length };
    for (const it of entries) c[it.outcome] = (c[it.outcome] || 0) + 1;
    return c;
  }, [entries]);

  const perSource = useMemo(() => {
    const c = {};
    for (const it of entries) c[it.sourceId] = (c[it.sourceId] || 0) + 1;
    return c;
  }, [entries]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((it) => (
      (!source || it.sourceId === source)
      && (!outcome || it.outcome === outcome)
      && (!needle || it.text.toLowerCase().includes(needle) || it.sourceTitle.toLowerCase().includes(needle))
    ));
  }, [entries, source, outcome, q]);

  if (!data) {
    return (
      <section className="view is-active ws ws-evidence">
        <Panel swatch="a" title="Evidence">
          {error ? <div className="err">Couldn’t reach the sources: {error}</div> : <div className="loading">Loading…</div>}
        </Panel>
      </section>
    );
  }

  const filtered = !!source || !!outcome || !!q.trim();
  return (
    <section className="view is-active ws ws-evidence">
      <div className="col col-left">
        <Panel id="pnl-ev-feeds" swatch="a" title="Feeds"
               tools={<span className="al-count">{feeds.length}</span>}>
          {feeds.map((f) => (
            <EvidenceFeed key={f.id} f={f} now={now} count={perSource[f.id] || 0}
                  selected={source === f.id} onSelect={setSource} />
          ))}
          {!feeds.length && <div className="al-empty">No alert sources are running.</div>}
          <p className="read small ev-note">
            The record is what each source still holds in memory, and a gateway restart clears it —
            an empty timeline after a deploy means the history went, not that nothing fired.
          </p>
        </Panel>
      </div>

      <div className="col col-center">
        {error && <div className="err al-banner">Sources unreachable — showing the last answer: {error}</div>}
        <Panel id="pnl-ev-record" swatch="b" title="Record" flush
               headExtra={
                 <div className="ev-chips">
                   <button type="button" className={'ev-chip' + (!outcome ? ' is-on' : '')}
                           onClick={() => setOutcome(null)}>all <b>{counts.total}</b></button>
                   {OUTCOMES.filter((o) => counts[o]).map((o) => (
                     <button key={o} type="button" className={'ev-chip' + (outcome === o ? ' is-on' : '')}
                             onClick={() => setOutcome(outcome === o ? null : o)}>{o} <b>{counts[o]}</b></button>
                   ))}
                 </div>
               }
               tools={
                 <input className="pnl-search" value={q} placeholder="Find in messages"
                        aria-label="Search the record" onChange={(e) => setQ(e.target.value)} />
               }>
          {filtered && (
            <div className="ev-filtered">
              {shown.length} of {counts.total}
              {source && <> · {feeds.find((f) => f.id === source)?.title || source}</>}
              <button type="button" className="ev-clear"
                      onClick={() => { setSource(null); setOutcome(null); setQ(''); }}>clear</button>
            </div>
          )}
          <EvidenceTimeline entries={shown} showSource={!source} />
          {!entries.length && <div className="al-empty ev-pad">Nothing has been sent yet.</div>}
        </Panel>
      </div>
    </section>
  );
}

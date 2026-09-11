/* One panel, every alert source.
 *
 * This component knows NOTHING about drops or the FDA. It renders the uniform
 * envelope AlertSource.status() returns, so a new source appears on the surface
 * correctly the moment it is added to the server registry.
 *
 * DENSITY IS THE DESIGN. A source is one line until opened, and opening it adds
 * a single meta line, its actions, its body and a one-line-per-entry log — not a
 * table of label/value rows and a stack of six-line message blocks. Three rules
 * follow, and each of them took something off the screen:
 *
 *   - Nothing is stated twice. The rule appears once, in the meta line. The drop
 *     tracker's symbols and thresholds are in its table, so they are not facts
 *     as well.
 *   - Health is one line, not five rows: cadence, last poll, poll count, errors.
 *   - A log entry is ONE line — time, outcome, and the message flattened onto
 *     it. Click it for the text as sent. The full text matters when you go
 *     looking for it, not while scanning for whether anything fired.
 *
 * The extension point is `detail`: a source may return a body of its own, and
 * BODIES in Alerts.jsx maps `detail.kind` to a component. An unregistered kind
 * renders the uniform frame — less information, never a crash.
 */
import { useState } from 'react';
import { Panel, IconBtn } from '@markets/shell/components/Panel.jsx';

const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' });
export const fmtTime = (iso) => iso ? ET.format(new Date(iso)) : '—';
export const ago = (iso, now) => {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};
const secs = (ms) => ms == null ? '—' : ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`;

const post = async (url) => {
  const r = await fetch(url, { method: 'POST' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.delivery?.error || `HTTP ${r.status}`);
  return j;
};

/* What an action returned, in one line. Sources report different things from a
   self-test — the FDA replay names the drug it resolved — so this reads
   whichever known keys are present rather than branching per source. */
function resultLine(j) {
  if (j.replayed) return `${j.brand || 'drug'} → ${j.ticker || j.sponsor || 'unresolved'}${j.resolveMs != null ? ` ${j.resolveMs}ms` : ''}`;
  if (j.delivery?.to) return `sent · ${j.delivery.channel}`;
  return 'done';
}

function Actions({ id, actions, onChange }) {
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  if (!actions?.length) return null;
  const run = async (a) => {
    setBusy(a.id); setResult(null);
    try { setResult({ ok: true, text: resultLine(await post(`/api/alerts/s/${id}/${a.id}`)) }); }
    catch (e) { setResult({ ok: false, text: e.message }); }
    finally { setBusy(null); onChange(); }
  };
  return (
    <div className="al-actions">
      {actions.map((a) => (
        <button key={a.id} type="button" className="btn sm" title={a.hint || ''}
                disabled={busy !== null} onClick={() => run(a)}>
          {busy === a.id ? '…' : a.label}
        </button>
      ))}
      {result && <span className={'al-result ' + (result.ok ? 'up' : 'down')}>{result.text}</span>}
    </div>
  );
}

/* One line per sent message. The text goes out over several lines because a
   phone reads it that way; on screen those same lines are a wall, so they are
   flattened onto one and the original is a click away. */
function LogEntry({ it }) {
  const [open, setOpen] = useState(false);
  const ok = it.delivery?.ok;
  const latency = it.events?.[0]?.latencyMs;
  const flat = String(it.text || '').split('\n').map((l) => l.trim()).filter(Boolean).join(' · ');
  const tag = it.test ? 'test' : it.followUp ? 'follow-up' : ok ? 'sent' : 'failed';
  return (
    <div className={'al-line' + (ok ? '' : ' is-failed') + (it.test ? ' is-test' : '')}>
      <button type="button" className="al-line-hit" onClick={() => setOpen((v) => !v)}
              title={ok ? `Sent via ${it.delivery.channel}` : it.delivery?.error || 'not sent'}>
        <span className="al-line-t">{fmtTime(it.at)}</span>
        <span className={'al-line-tag ' + (ok ? 'up' : 'down')}>{tag}</span>
        {latency != null && <span className="al-line-ms">{latency}ms</span>}
        <span className="al-line-txt">{flat}</span>
      </button>
      {open && <pre className="al-log-text">{it.text}</pre>}
    </div>
  );
}

/**
 * @param {object} p
 * @param {object} p.data     one entry from GET /api/alerts `sources`
 * @param {object} p.bodies   {detailKind: Component} — see BODIES in Alerts.jsx
 *
 * Collapsed by default: the box is then one line, because that is what is true
 * almost all of the time. Open state is per-source, survives the two-second
 * refresh (React keeps the instance, keyed by source id), and is deliberately
 * not persisted — the useful default on returning to the tab is the compact
 * list, not whatever was left open yesterday.
 */
export function SourcePanel({ data, now, onChange, bodies = {}, swatch = 'a', defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const src = data.source || {};
  const Body = data.detail?.kind ? bodies[data.detail.kind] : null;
  const log = data.log || [];
  const sent = log.filter((l) => !l.test).length;
  const cadence = data.active ? data.pollMs : data.idleMs;

  return (
    <Panel id={`pnl-al-${data.id}`} swatch={swatch} title={data.title} compact={!open}
      headExtra={
        <button type="button" className="al-peek" onClick={() => setOpen((v) => !v)}
                aria-expanded={open} aria-controls={`al-more-${data.id}`}
                title={open ? 'Collapse' : 'Expand'}>
          <span className={'al-dot' + (data.running ? ' is-live' : '')} aria-hidden="true" />
          <span className="al-peek-text">{data.summary || data.rule}</span>
          <span className="al-peek-side">
            {src.errors ? <span className="down">{src.errors} err</span> : secs(cadence)}
            {sent > 0 && <> · {sent}</>}
          </span>
        </button>
      }
      tools={
        <IconBtn small on={open} aria-label={open ? `Collapse ${data.title}` : `Expand ${data.title}`}
                 onClick={() => setOpen((v) => !v)}>{open ? '−' : '+'}</IconBtn>
      }>

      {!open ? null : (
        /* Two columns, so the panel opens WIDE rather than tall: the content
           that has width — the meta line, the body, the log — keeps it, and the
           actions go into a narrow rail instead of spending a full row on two
           buttons. They wrap under the content below 640px. */
        <div id={`al-more-${data.id}`} className="al-more">
        <div className="al-more-main">
          {/* What used to be five rows of a label/value table. */}
          <div className="al-meta">
            <span className="al-meta-rule">{data.running ? data.rule : 'not running'}</span>
            {data.facts?.map((f) => (
              <span key={f.label}><i>{f.label}</i> {f.value}</span>
            ))}
            <span><i>every</i> {secs(cadence)}</span>
            <span><i>poll</i> {ago(src.lastOk, now)} ago{src.latencyMs != null ? ` · ${src.latencyMs}ms` : ''}</span>
            <span><i>n</i> {src.polls ?? 0}</span>
          </div>
          {src.lastError && <div className="err al-err">{src.errors} consecutive · {src.lastError}</div>}

          {Body && <Body detail={data.detail} onChange={onChange} />}

          {log.map((it, i) => <LogEntry key={it.at + i} it={it} />)}
          {!log.length && <div className="al-empty">nothing sent yet</div>}
        </div>
        {!!data.actions?.length && (
          <aside className="al-more-side">
            <Actions id={data.id} actions={data.actions} onChange={onChange} />
          </aside>
        )}
        </div>
      )}
    </Panel>
  );
}

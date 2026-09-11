/* The bespoke per-company section.
 *
 * Hand-written and NEVER generated. Nothing here writes a file: the empty state
 * names the path and offers the skeleton on the clipboard, and that is the
 * whole authoring flow. It is the one place on this surface for judgement the
 * ratios cannot express.
 *
 * Three states, deliberately distinct:
 *   no file    -> one block, an invitation, with the exact path
 *   blank slot -> the full panel row, with "— not written yet" in the holes,
 *                 so a half-finished analysis reads as in progress
 *   written    -> prose
 */
import { useState } from 'react';
import { Panel } from '@markets/shell/components/Panel.jsx';

export function DeepDive({ ticker, state, onPickTicker }) {
  if (!ticker) return null;

  if (state.status === 'loading') {
    return <div className="cmp-empty"><span className="loading">Loading the deep dive…</span></div>;
  }

  // A missing file is not an error. A corrupt one is — and it is the only red
  // thing in this section.
  if (state.status === 'error') {
    return (
      <div className="cmp-error">
        <b>{ticker}’s deep dive could not be read.</b>
        <p>{state.error?.message}. The file exists but is not valid JSON.</p>
      </div>
    );
  }

  if (state.status === 'missing') return <MissingNote ticker={ticker} state={state} />;

  const d = state.data || {};
  const peers = Array.isArray(d.vsPeers) ? d.vsPeers.filter((p) => p && p.peer) : [];

  return (
    <div className="cmp-dd">
      <div className="cmp-dd-head">
        <span className="cmp-dd-kicker">hand-written, never generated</span>
        {d.asOf && <span className="cmp-asof">as of {d.asOf}</span>}
      </div>
      <div className="cmp-dd-grid">
        <Slot title="Thesis" value={d.thesis} />
        <Slot title="Moat" value={d.moat} />
        <div className="cmp-dd-slot">
          <h4>Versus peers</h4>
          {peers.length ? (
            <table className="cmp-dd-peers">
              <tbody>
                {peers.map((p, i) => (
                  <tr key={p.peer + i}>
                    <td>
                      <button type="button" className="cmp-tk"
                              onClick={() => onPickTicker?.(p.peer.toUpperCase())}
                              title={`Compare from ${p.peer}’s side`}>{p.peer}</button>
                    </td>
                    <td className="cmp-dd-verdict">{p.verdict || <Unwritten />}</td>
                    <td className="cmp-dd-note">{p.note || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Unwritten />}
        </div>
        <div className="cmp-dd-slot">
          <h4>Risks</h4>
          {Array.isArray(d.risks) && d.risks.length
            ? <ol className="cmp-dd-risks">{d.risks.map((r, i) => <li key={i}>{r}</li>)}</ol>
            : <Unwritten />}
        </div>
        <Slot title="Verdict" value={d.verdict} />
      </div>
    </div>
  );
}

const Unwritten = () => <span className="cmp-unwritten">— not written yet</span>;

function Slot({ title, value }) {
  return (
    <div className="cmp-dd-slot">
      <h4>{title}</h4>
      {value ? <p>{value}</p> : <Unwritten />}
    </div>
  );
}

function MissingNote({ ticker, state }) {
  const [copied, setCopied] = useState('');
  const skeleton = JSON.stringify(state.template ?? {
    ticker, asOf: '', thesis: '', moat: '',
    vsPeers: [{ peer: '', verdict: '', note: '' }], risks: [], verdict: '',
  }, null, 2);

  const copy = (text, what) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(''), 1600);
    }).catch(() => {});
  };

  return (
    <div className="cmp-empty">
      <p className="cmp-empty-lead">No deep dive written for <b>{ticker}</b>.</p>
      <p>
        This section is hand-written and never generated — it is where the
        judgement the ratios can’t express goes. Create{' '}
        <code>{state.path}</code>{' '}
        <button type="button" className="cmp-copy" onClick={() => copy(state.path, 'path')}>
          {copied === 'path' ? 'copied' : 'copy path'}
        </button>
      </p>
      <pre className="cmp-empty-json">{skeleton}</pre>
      <button type="button" className="cmp-copy" onClick={() => copy(skeleton, 'json')}>
        {copied === 'json' ? 'copied' : 'copy skeleton'}
      </button>
      <p className="cmp-empty-foot">It appears here on the next refresh.</p>
    </div>
  );
}

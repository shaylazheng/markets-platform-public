/* The source inspector — ONE component for every surface in the Company group.
 *
 * The graph's sidebar invented the idiom and Competitors rebuilt it for a
 * table: a claim in plain language, then how it was arrived at, then OFFICIAL
 * SOURCES separated from everything else, each row badged by source type. This
 * is that block promoted to the shell, so Summary, Management, Industry,
 * Valuation, Outlook and Report answer "where did this number come from?" with
 * the same panel in the same place — the rail — instead of six local dialects.
 *
 * Deciding WHICH documents back a claim stays in each surface's own pure
 * module (competitors/src/peerSources.js is the model); this file only
 * renders. It holds no fetch: a surface that needs a provenance call makes it
 * itself and passes `state` down, so the inspector cannot silently couple the
 * shell to a section's API.
 *
 * Two views:
 *  - nothing selected: the DEFAULT view — every source this surface relies
 *    on, as linked rows, truth-first. Not a prompt to click; the full answer
 *    at surface grain, with the src buttons offering the per-figure trace.
 *  - a selection: claim / method / note, any decomposition the surface
 *    passes as children, then the traced rows for that one figure.
 */
import { useState } from 'react';
import { fmtDate, fmtFrame } from '../lib/sourceRows.js';
import { moneyShort } from '../lib/format.js';

/** The `src` affordance, repeated beside every data point. Deliberately quiet:
 *  it is the second question a reader asks, never the first, so it sits at
 *  --ink-fainter until hovered or pressed. Selections are compared by `key`,
 *  which every sel object carries, so pressed-state needs no per-surface
 *  equality logic. */
export function SrcButton({ sel, current, onSelect, title = 'Where this came from' }) {
  const pressed = !!current && !!sel && current.key === sel.key;
  return (
    <button type="button" className="si-srcbtn" title={title}
            aria-pressed={pressed}
            onClick={() => onSelect?.(pressed ? null : sel)}>src</button>
  );
}

/** One source row: { type, label, url, truth, detail? }. A row with no url is
 *  a fact about origin, not a link, and renders without the anchor affordance
 *  rather than as a link that goes nowhere. */
export const SrcRow = ({ s }) => {
  const cls = 'si-src' + (s.truth ? ' is-truth' : '') + (s.url ? '' : ' is-static');
  const type = <span className={'si-src-type t-' + s.type.replace(/\W+/g, '-').toLowerCase()}>{s.type}</span>;
  const body = (
    <>
      {type}
      <span className="si-src-label">
        {s.label}
        {s.detail && <span className="si-src-detail">{s.detail}</span>}
      </span>
    </>
  );
  return s.url
    ? <a className={cls} href={s.url} target="_blank" rel="noopener noreferrer">{body}</a>
    : <div className={cls}>{body}</div>;
};

/* Formatted by the concept's own XBRL unit. `moneyShort` prefixes a dollar
   sign, which is right for revenue and wrong for a share count; and a $3.42
   EPS must not round to "$3". */
const defaultFmtVal = (v, unit) => {
  if (v == null) return '—';
  if (unit === 'shares') return Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v.toLocaleString('en-US');
  if (unit === 'USD/shares') return `$${v.toFixed(2)}`;
  return moneyShort(v);
};

/** The decomposition table for an XBRL concept trace — which filings a
 *  trailing-twelve-month figure is actually the sum of, hatched where a
 *  quarter was never filed as a discrete number. */
export function TraceParts({ trace, fmtVal = defaultFmtVal }) {
  if (!trace?.parts?.length) return null;
  const multi = trace.parts.length > 1;
  const methods = [...new Set(trace.parts.filter((p) => p.methodLabel).map((p) => p.methodLabel))];
  return (
    <div className="si-parts">
      <div className="si-parts-head">
        {trace.label} · {multi
          ? `${fmtFrame(trace.frame)} is the sum of ${trace.parts.length} quarters`
          : 'as filed'}
      </div>
      <table>
        <tbody>
          {trace.parts.map((p) => (
            <tr key={`${p.frame}-${p.accn}`} className={p.derived ? 'is-derived' : ''}>
              <td className="si-parts-fr">{fmtFrame(p.frame)}</td>
              <td className="si-parts-val">{fmtVal(p.val, trace.unit)}</td>
              <td className="si-parts-src">
                {p.url
                  ? <a href={p.url} target="_blank" rel="noopener noreferrer">{p.form}, {fmtDate(p.filed)}</a>
                  : <span>{p.form}, {fmtDate(p.filed)}</span>}
                {p.restated && (
                  <span className="si-parts-flag"
                        title="SEC holds more than one value for this period — the filing was restated">
                    restated
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {methods.length > 0 && (
        <div className="si-parts-note">
          Hatched rows were never filed as discrete quarters. {methods.join('; ')}.
        </div>
      )}
    </div>
  );
}

const Rows = ({ rows }) => {
  const truth = rows.filter((s) => s.truth);
  const rest = rows.filter((s) => !s.truth);
  return (
    <>
      {truth.length > 0 && (
        <>
          <div className="si-kicker is-truth">Official source</div>
          {truth.map((s, i) => <SrcRow key={s.url || i} s={s} />)}
        </>
      )}
      {rest.length > 0 && (
        <>
          <div className="si-kicker">Also from</div>
          {rest.map((s, i) => <SrcRow key={s.url || i} s={s} />)}
        </>
      )}
    </>
  );
};

/**
 * @param {object|null} sel      current selection (carries `key`), or null
 * @param {()=>void}   [onClose] clears the selection
 * @param {object}     [d]       { claim, method, note } for the selection
 * @param {Array}       sources  traced rows for the selection
 * @param {string}     [state]   'ok' | 'loading' | 'error' — a provenance
 *                               fetch's progress, owned by the surface
 * @param {Array}       defaults rows for the no-selection view
 * @param {string}     [defaultsIntro] one-liner above the default list
 * @param {(sel, opts)=>Promise} [onPin] bank the selected datum into the
 *   report's evidence store. Offered when the selection carries a displayed
 *   value (`sel.display` plus a label → a figure) or an excerpt (`sel.quote`
 *   → a quote), so surfaces whose selections are neither keep a pinless
 *   inspector. Resolving to {ok:false, duplicate} marks the near-duplicate
 *   two-press flow; opts.force is the second press. The fetch stays with the
 *   surface — this file renders.
 * @param {ReactNode}  [children] decomposition blocks, rendered before the rows
 */
export function SourceInspector({
  sel, onClose, d, sources = [], state = 'ok',
  defaults = [], defaultsIntro, onPin, children,
}) {
  const [open, setOpen] = useState(true);
  const [pinState, setPinState] = useState({});   // sel.key -> 'done' | 'dupe'
  const rows = sel ? sources : defaults;

  const pinLabel = sel ? (sel.label || sel.metric?.label) : null;
  const asQuote = !!(sel && typeof sel.quote === 'string' && sel.quote.trim());
  const canPin = false && !!(onPin && sel && sel.pinnable !== false
    && (asQuote || (pinLabel && sel.display != null && sel.display !== '—')));

  return (
    <div className="si-panel">
      <div className="si-head">
        <button type="button" className="si-toggle" onClick={() => setOpen((v) => !v)}
                aria-expanded={open}>
          Sources <span className="si-count">{rows.length}</span>
          <span className="si-caret">{open ? '▾' : '▸'}</span>
        </button>
        {sel && onClose && (
          <button type="button" className="si-close" onClick={onClose}
                  title="Clear the selection">×</button>
        )}
      </div>

      {open && !sel && (
        <div className="si-body">
          <p className="si-method">
            {defaultsIntro
              || 'Everything this surface draws on. Press any src button to trace one figure to the document it came from.'}
          </p>
          <Rows rows={defaults} />
        </div>
      )}

      {open && sel && (
        <div className="si-body">
          {d?.claim && <p className="si-claim">{d.claim}</p>}
          {d?.method && <p className="si-method">{d.method}</p>}
          {/* The server's own note on why a figure is blank — the answer to
              the most common question an inspector gets asked. */}
          {(sel.note || d?.note) && <p className="si-note">{sel.note || d?.note}</p>}

          {canPin && (
            <button type="button" className="si-pin" disabled={pinState[sel.key] === 'done'}
                    title={pinState[sel.key] === 'dupe'
                      ? 'A near-duplicate is already banked — press again to keep both'
                      : 'Freeze this, exactly as displayed, into the local selection'}
                    onClick={() => Promise.resolve(onPin(sel, { force: pinState[sel.key] === 'dupe' }))
                      .then((r) => setPinState((s) => ({ ...s, [sel.key]: r?.ok === false ? 'dupe' : 'done' })))
                      .catch(() => setPinState((s) => ({ ...s, [sel.key]: undefined })))}>
              {pinState[sel.key] === 'done'
                ? 'Banked for the report ✓'
                : pinState[sel.key] === 'dupe'
                ? 'Already banked — press again to keep both'
                : asQuote
                ? <>Bank this quote — <b>“{sel.quote.length > 70 ? `${sel.quote.slice(0, 70).trimEnd()}…` : sel.quote}”</b></>
                : <>Bank for the report — {pinLabel}: <b>{sel.display}</b></>}
            </button>
          )}

          {state === 'loading' && (
            <p className="si-method"><span className="loading">tracing the filings…</span></p>
          )}
          {state === 'error' && (
            <p className="si-method">
              Couldn’t reach SEC for the filing trace — the links below still resolve.
            </p>
          )}

          {children}

          <Rows rows={sources} />
          {!sources.length && state !== 'loading' && (
            <p className="si-method">No documents resolved for this selection.</p>
          )}
        </div>
      )}
    </div>
  );
}

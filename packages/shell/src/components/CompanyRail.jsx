/* The company rail — shared chrome for every surface in the Company group.
 *
 * Five surfaces ask the same first question ("which company?") and each had
 * grown its own way of asking it: Competitors a band of chips across the top,
 * Valuation a ticker box in a control bar, Management a bespoke rail, Graph a
 * search field in its own strip, Insider a filter field buried in a form. Same
 * question, five affordances, in different places on the screen — so moving
 * between them meant re-finding the box every time.
 *
 * This is that box, once. Identity block, cross-surface links, and then a
 * `facts` strip that each surface fills with ITS core numbers, because the
 * company is the constant and what is worth knowing about it is not.
 *
 * NOT THE COMPANY SUMMARY. That lived here briefly and is now its own surface
 * (`packages/summary`, the first Company subtab). It outgrew a rail: a business
 * description, segment names and a risk taxonomy are paragraphs, and a 320px
 * column made every one of them a two-word column of wrapped text. The rail's
 * job is asking "which company?", not answering "what is it".
 *
 * DEPENDENCY DIRECTION. This lives in the shell, so it cannot resolve a ticker
 * — that route belongs to Competitors, and the shell importing a section is the
 * one rule this layout exists to protect. Every surface already holds the
 * identity in its own payload; it passes it in. The rail renders, it does not
 * fetch — with one write-only exception: each fact carries a `pin` button that
 * POSTs the displayed value into the report's pin store (lib/pins.js). Fire
 * and forget on a press, never a read the rail renders from, so the rule the
 * comment above protects still holds.
 */
import { useEffect, useState } from 'react';
import { pinFigure } from '../lib/pins.js';

/**
 * @param {string} view      the current surface id — so the links never point at it
 * @param {string} ticker    the resolved company, or '' before one is chosen
 * @param {string} [name]    company name
 * @param {string} [sub]     industry / sector / whatever the surface knows
 * @param {(t:string)=>void} onSubmit
 * @param {string} [placeholder]
 * @param {Array<{label:string,value:any,sub?:string,title?:string}>} [facts]
 *   this surface's core readout. Rendered in the shell's stat-tile idiom, so a
 *   number here looks like a number anywhere else on the dashboard.
 * @param {boolean} [busy]   show the input as working
 * @param {boolean} [pinnable]  pin buttons on the facts (default on; the Report
 *   surface turns it off — pinning "Blocks 5/30" into the report is circular)
 * @param {React.ReactNode} [children]  surface-specific controls, below the facts
 */
export function CompanyRail({
  view, ticker, name, sub, onSubmit, placeholder = 'ticker, e.g. NVDA',
  facts = [], busy = false, note = null, pinnable = false, children,
}) {
  const [draft, setDraft] = useState(ticker || '');
  const [pinState, setPinState] = useState({});   // fact label -> 'done' | 'dupe'

  /* Arriving from another surface changes the ticker underneath us — the links
     above write the hash and the target surface reads it — so the box has to
     follow. Only when the committed ticker actually changes, or it would fight
     the person typing. */
  useEffect(() => { setDraft(ticker || ''); setPinState({}); }, [ticker]);

  /* A fact is pinnable when its value is a real displayed figure — a string or
     number, not a React node, and not the em dash a missing value renders as. */
  const canPin = (f) => false && pinnable && !!ticker
    && (typeof f.value === 'string' || typeof f.value === 'number')
    && f.value !== '' && f.value !== '—';
  /* Near-duplicate answers are a two-press flow: the first press learns the
     bank already holds this label, the second says keep both anyway. */
  const pin = (f) =>
    pinFigure(ticker, { label: f.label, value: String(f.value), sub: f.sub || '', surface: view },
              { force: pinState[f.label] === 'dupe' })
      .then((r) => setPinState((s) => ({ ...s, [f.label]: r.ok === false ? 'dupe' : 'done' })))
      .catch(() => setPinState((s) => ({ ...s, [f.label]: undefined })));

  const submit = (e) => {
    e.preventDefault();
    const t = draft.trim().toUpperCase();
    if (t) onSubmit?.(t);
  };

  return (
    <aside className="co-rail" aria-label="Company">
      <form className="co-form" onSubmit={submit}>
        <label htmlFor={`co-t-${view}`}>Company</label>
        <div className="co-form-row">
          <input id={`co-t-${view}`} value={draft} spellCheck={false} autoComplete="off"
                 placeholder={placeholder}
                 onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="co-go" disabled={busy}>
            {busy ? '…' : 'go'}
          </button>
        </div>
      </form>

      {ticker && (
        <div className="co-ident">
          <b className="co-tick">{ticker}</b>
          {name && <span className="co-name">{name}</span>}
          {sub && <span className="co-sub">{sub}</span>}
          {/* There were icon links here to the same company on the other four
              surfaces. They are gone: the company is now shared state, so the
              nav tabs already carry it and the icons duplicated the tab row
              with worse labels. */}
        </div>
      )}

      {facts.length > 0 && (
        <dl className="co-facts">
          {facts.map((f) => (
            <div key={f.label} className="co-fact" title={f.title || undefined}>
              {canPin(f) && (
                <button type="button"
                        className={'co-fact-pin'
                          + (pinState[f.label] === 'done' ? ' is-done' : '')
                          + (pinState[f.label] === 'dupe' ? ' is-dupe' : '')}
                        title={pinState[f.label] === 'dupe'
                          ? `Already banked under this label — press again to keep both`
                          : `Freeze ${f.label} = ${f.value} into the ${ticker} report's evidence bank`}
                        onClick={() => pin(f)}>
                  {pinState[f.label] === 'done' ? '✓' : pinState[f.label] === 'dupe' ? 'dup' : 'pin'}
                </button>
              )}
              <dt>{f.label}</dt>
              <dd className={'co-fact-v' + (f.tone ? ` is-${f.tone}` : '')}>
                {f.value == null || f.value === '' ? '—' : f.value}
              </dd>
              {f.sub && <dd className="co-fact-sub">{f.sub}</dd>}
            </div>
          ))}
        </dl>
      )}

      {note && <p className="co-note">{note}</p>}

      {children}
    </aside>
  );
}

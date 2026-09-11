import { useEffect, useRef, useState } from 'react';
import { WATCHLIST } from '@markets/shell/lib/series.js';
import { useApp } from '@markets/shell/lib/store.jsx';

const label = (w) => (w.curve ? 'CURVE' : w.id);

/* Searchable symbol picker: the fast way to change the main chart. Opens on
   click or "/", filters on ticker/name/section, full keyboard nav. */
export function SymbolPicker() {
  const { symbol, selectSymbol, stepSymbol } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const matches = q.trim()
    ? WATCHLIST.filter((w) => `${w.id} ${w.name} ${w.section}`.toLowerCase().includes(q.trim().toLowerCase()))
    : WATCHLIST;

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(Math.max(0, WATCHLIST.findIndex((w) => w.id === symbol)));
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, symbol]);

  useEffect(() => {
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key !== '/' || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
      e.preventDefault(); setOpen(true);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, []);

  const pick = (id) => { selectSymbol(id); setOpen(false); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!matches.length) return;
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
    } else if (e.key === 'Enter') {
      e.preventDefault(); if (matches[active]) pick(matches[active].id);
    } else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  const cur = WATCHLIST.find((w) => w.id === symbol);
  return (
    <>
      <div className="sym-picker" ref={wrapRef}>
        <button type="button" className="sym-btn" aria-haspopup="listbox" aria-expanded={open}
                title={cur?.name} onClick={() => setOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></svg>
          <span className="pnl-sym">{cur ? label(cur) : symbol}</span>
          <span className="sym-caret">▾</span>
        </button>
        {open && (
          <div className="sym-menu">
            <input ref={inputRef} className="sym-search" value={q} onKeyDown={onKeyDown}
                   onChange={(e) => { setQ(e.target.value); setActive(0); }}
                   placeholder="Search symbol or name…" aria-label="Search symbol" autoComplete="off" />
            <div className="sym-list" role="listbox">
              {matches.length === 0 && <div className="sym-empty">No match.</div>}
              {matches.map((w, i) => (
                <div key={w.id} role="option" aria-selected={w.id === symbol}
                     className={'sym-opt' + (i === active ? ' is-active' : '') + (w.id === symbol ? ' is-cur' : '')}
                     onMouseDown={(e) => { e.preventDefault(); pick(w.id); }}>
                  <span className="sym-opt-id">{label(w)}</span>
                  <span className="sym-opt-name">{w.name}</span>
                  <span className="sym-opt-sec">{w.section}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <button type="button" className="icon-btn sm sym-step" title="Previous symbol"
              aria-label="Previous symbol" onClick={() => stepSymbol(-1)}>‹</button>
      <button type="button" className="icon-btn sm sym-step" title="Next symbol"
              aria-label="Next symbol" onClick={() => stepSymbol(1)}>›</button>
    </>
  );
}

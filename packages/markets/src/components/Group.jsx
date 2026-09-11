import { useCallback, useEffect, useState } from 'react';

/* A container around a whole workspace of panels, with one collapse control.
   Minimising hides the panels but keeps the strip — and whatever summary the
   caller passes — so the row stays informative rather than becoming a dead bar. */
export function Group({ title, storageKey = 'group', summary, children }) {
  const [min, setMin] = useState(() => localStorage.getItem(`min:${storageKey}`) === '1');
  useEffect(() => { localStorage.setItem(`min:${storageKey}`, min ? '1' : '0'); }, [min, storageKey]);

  const toggle = useCallback(() => setMin((m) => !m), []);

  return (
    <section className={'grp' + (min ? ' is-min' : '')}>
      <div className="grp-head">
        <button
          type="button"
          className="grp-toggle"
          aria-expanded={!min}
          aria-controls={`grp-body-${storageKey}`}
          title={min ? 'Expand' : 'Minimise'}
          onClick={toggle}
        >
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor"
               strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span className="grp-title">{title}</span>
        </button>
        {min && summary && <div className="grp-summary">{summary}</div>}
      </div>
      <div className="grp-body" id={`grp-body-${storageKey}`} hidden={min}>
        {children}
      </div>
    </section>
  );
}

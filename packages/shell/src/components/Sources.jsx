/* The source inspector, at surface granularity.
 *
 * Collapsed by default: this answers a question you ask occasionally and
 * urgently rather than continuously, and a permanently open panel of
 * provenance would push the actual content down the page on every surface.
 *
 * Competitors keeps its own per-CELL inspector, which is stronger and stays.
 * This is for the surfaces where no such trace exists, and it is honest about
 * being coarser: it names the feed, not the fact.
 */
import { useState } from 'react';
import { useRegistry } from '../lib/registry.jsx';

export function Sources({ view, extra = [], count }) {
  const [open, setOpen] = useState(false);
  const { sources: SURFACE_SOURCES, kindLabel: KIND_LABEL } = useRegistry();
  const items = [...(SURFACE_SOURCES[view] || []), ...extra];
  if (!items.length) return null;

  const n = count ?? items.length;

  return (
    <div className="src-panel">
      <button type="button" className="src-toggle" onClick={() => setOpen((o) => !o)}
              aria-expanded={open}>
        <span className="src-caret">{open ? '▾' : '▸'}</span>
        Sources
        <span className="src-count">{n}</span>
      </button>

      {open && (
        <div className="src-body">
          <ul className="src-list">
            {items.map((s, i) => (
              <li key={i} className={'src-item is-' + s.kind}>
                <span className="src-kind">{KIND_LABEL[s.kind] || s.kind}</span>
                <span className="src-main">
                  {s.href
                    ? <a href={s.href} target="_blank" rel="noopener noreferrer">{s.label}</a>
                    : <span className="src-label">{s.label}</span>}
                  {s.detail && <span className="src-detail">{s.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="src-foot">
            A <strong>live feed</strong> can be stale or down; an <strong>SEC
            filing</strong> is immutable once filed; something <strong>on this
            machine</strong> is only as current as its last regeneration; and
            something <strong>computed here</strong> has a formula as its source,
            named above. On Competitors the src buttons trace individual cells to
            the filing they came from — this names the feed, not the fact.
          </p>
        </div>
      )}
    </div>
  );
}

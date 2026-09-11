import { useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { Panel, IconBtn } from './Panel.jsx';

/* Where every ✦ Insights request lands. Idle until something is asked for.
 *
 * `hideIdle` is for the surfaces that sit the button directly above the panel:
 * there the button IS the affordance, so a placeholder explaining where to find
 * it is both redundant and permanently occupying space. Markets and Competitors
 * keep the placeholder, because on those the panel lives in a fixed column far
 * from any of the several triggers that can fill it. */
export function InsightPanel({ hideIdle = false }) {
  const { insight, clearInsight, insightHistory, restoreInsight } = useApp();
  const { title, meta, text, loading, error, key } = insight;

  /* Collapsed by default: the current insight is what the panel is for, and the
     history is a way back to something you have already read. */
  const [recentOpen, setRecentOpen] = useState(false);

  // Whatever is on screen above does not need a link to itself.
  const recent = insightHistory.filter((e) => e.key !== key).slice(0, 3);

  if (hideIdle && !key && !recent.length) return null;

  return (
    <Panel id="pnl-insight" swatch="c" title="Insight"
      tools={key && (
        <IconBtn small title="Clear" aria-label="Clear insight" onClick={clearInsight}>×</IconBtn>
      )}>
      {!key && (
        <p className="muted small">
          Press <strong>✦ Insights</strong> anywhere it appears and Claude’s briefing
          lands here.
        </p>
      )}

      {key && <>
        <div className="kicker">{meta}</div>
        <div className="insight-head">{title}</div>
        {loading && <span className="insight-loading">Claude is thinking
          <span className="dots"><span /><span /><span /></span></span>}
        {error && <span className="insight-err">Couldn’t generate insight: {error}</span>}
        {!loading && !error && <div className="insight-body">{text}</div>}
      </>}

      {recent.length > 0 && (
        <div className={'insight-recent' + (recentOpen ? ' is-open' : '')}>
          <button type="button" className="insight-recent-toggle"
                  aria-expanded={recentOpen} onClick={() => setRecentOpen((o) => !o)}>
            <span className="insight-recent-caret" aria-hidden="true">›</span>
            Recent insights
            <span className="insight-recent-count">{recent.length}</span>
          </button>
          {recentOpen && (
            <ul className="insight-recent-list">
              {recent.map((e) => (
                <li key={e.key}>
                  <button type="button" className="insight-recent-item"
                          onClick={() => restoreInsight(e)}>
                    <span className="insight-recent-title">{e.title}</span>
                    <span className="insight-recent-meta">{e.meta}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

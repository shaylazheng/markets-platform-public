import { useApp } from '../lib/store.jsx';

/* A trigger, not a container. Clicking sends the request to the shared insight
   panel; the button only reflects whether it is the one currently shown. */
export function InsightButton({ id, title, meta, payload, label = '✦ Insights' }) {
  const { insight, showInsight, clearInsight } = useApp();
  const active = insight.key === id;
  return (
    <button
      type="button"
      className={'insight-btn' + (active ? ' open' : '')}
      title="Explain this with Claude"
      aria-pressed={active}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); active ? clearInsight() : showInsight(id, title, meta, payload); }}
    >{label}</button>
  );
}

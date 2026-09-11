import { TIMEFRAMES } from '@markets/shell/lib/series.js';

export function TimeframeRow({ value, onChange }) {
  return (
    <div className="tf-row" role="group" aria-label="Time range">
      {TIMEFRAMES.map((t) => (
        <button
          key={t.k}
          type="button"
          className={'tf-btn' + (t.k === value ? ' is-active' : '')}
          aria-pressed={t.k === value}
          onClick={() => onChange(t.k)}
        >{t.k}</button>
      ))}
    </div>
  );
}

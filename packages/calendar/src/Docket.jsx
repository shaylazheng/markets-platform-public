import { useCalendar, SESSION } from '../lib/useCalendar.js';

const nextDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1, d + 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

export function DocketBody() {
  const { data, error, loading } = useCalendar();
  if (loading) return <span className="muted small">Loading…</span>;
  if (error) return <span className="muted small">Couldn’t load: {error.message}</span>;

  const day = (label, key) => {
    const evs = data.events.filter((e) => e.date === key);
    return (
      <div key={label}>
        <div className="docket-h">{label}</div>
        {evs.length === 0 && <div className="docket-none">Nothing scheduled.</div>}
        {evs.map((ev, i) => {
          const what = ev.cat === 'earnings' ? `Earnings: ${ev.note}` : ev.name;
          const t = SESSION[ev.time] ? `${SESSION[ev.time][0]} ${SESSION[ev.time][2]}` : `${ev.approx ? '~' : ''}${ev.time}`;
          return (
            <div key={i} className={`docket-row cat-${ev.cat || 'econ'}`}>
              <span className="docket-time">{t}</span>
              <span className="cv-dot" />
              <span className="docket-what">{what}</span>
            </div>
          );
        })}
      </div>
    );
  };
  return <>{day('Today', data.start)}{day('Tomorrow', nextDay(data.start))}</>;
}

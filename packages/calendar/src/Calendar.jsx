import { useMemo, useState } from 'react';
import { Panel, IconBtn } from '@markets/shell/components/Panel.jsx';
import { useCalendar, SESSION } from './useCalendar.js';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';

const CATS = [
  ['econ', 'Economic data'], ['fed', 'Federal Reserve'], ['earnings', 'Earnings'],
  ['energy', 'Energy data'], ['market', 'Market hours & expiry'],
];
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const fmtCap = (n) => (n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${Math.round(n / 1e9)}B`
  : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : n ? `$${n.toLocaleString('en-US')}` : '—');

/* Long sector names get a short label so nothing truncates. */
const SECTOR_LABEL = {
  'Consumer Discretionary': 'Consumer Disc.',
  'Consumer Staples': 'Consumer Staples',
  'Telecommunications': 'Telecom',
  'Basic Materials': 'Materials',
};
const shortSector = (s) => SECTOR_LABEL[s] || s || '—';

/* Every reporter Nasdaq lists for the selected day, ordered by market cap.
   Finance and Technology are badged; other sectors stay plain so the two the
   user cares about are the only colour in the column.

   The filter is a multi-select over whatever sectors actually report that day,
   rather than a fixed set of presets — the interesting combination varies by
   day, and pre-naming them ruled out every pairing nobody thought of. Software
   stays as its own chip because it is an industry inside Technology, not a
   sector, and it is the one sub-slice worth singling out. */
const SOFTWARE = '__software__';

// OR across the selection; an empty selection means everything. Selecting
// Finance and Technology therefore shows both, not their (empty) intersection.
const matches = (c, picked) =>
  picked.size === 0 || picked.has(c.sector || '—') || (picked.has(SOFTWARE) && c.software);

/* Sectors present on the day, most-reported first, so the chips are ordered by
   how much of the day each one accounts for. */
function sectorChips(companies) {
  const counts = new Map();
  for (const c of companies) {
    const s = c.sector || '—';
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const chips = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([sector, n]) => ({ value: sector, label: shortSector(sector), n }));
  const software = companies.filter((c) => c.software).length;
  if (software) chips.push({ value: SOFTWARE, label: 'Software', n: software });
  return chips;
}

function EarningsPanel({ events, dateLabel, expanded, onToggleExpand }) {
  const [picked, setPicked] = useState(() => new Set());
  const toggle = (v) => setPicked((p) => {
    const n = new Set(p);
    n.has(v) ? n.delete(v) : n.add(v);
    return n;
  });

  const expandBtn = (
    <IconBtn small on={expanded} onClick={onToggleExpand}
             title={expanded ? 'Restore the release calendar' : 'Expand earnings to fill the column'}
             aria-label={expanded ? 'Restore the release calendar' : 'Expand earnings'}
             aria-pressed={expanded}>{expanded ? '⤡' : '⤢'}</IconBtn>
  );

  if (!events.length) {
    return (
      <Panel swatch="a" title="Earnings" tools={expandBtn}>
        <p className="muted small">No earnings listed for {dateLabel}.</p>
      </Panel>
    );
  }

  const allCompanies = events.flatMap((ev) => ev.companies);
  const chips = sectorChips(allCompanies);

  const totals = events.reduce((a, ev) => ({
    total: a.total + ev.companies.length,
    finance: a.finance + (ev.counts?.finance || 0),
    technology: a.technology + (ev.counts?.technology || 0),
    software: a.software + (ev.counts?.software || 0),
  }), { total: 0, finance: 0, technology: 0, software: 0 });

  return (
    <Panel swatch="a" title="Earnings" tools={<>
      {picked.size > 0 && (
        <button type="button" className="earn-clear" onClick={() => setPicked(new Set())}>
          Clear {picked.size}
        </button>
      )}
      {expandBtn}
    </>}>
      <div className="earn-summary">
        <span className="earn-day">{dateLabel}</span>
        <span className="earn-counts">
          <strong>{totals.total}</strong> reporting ·
          <span className="earn-key"> {totals.finance} finance</span> ·
          <span className="earn-key"> {totals.technology} tech</span>
          <span className="earn-sw"> ({totals.software} software)</span>
        </span>
      </div>

      <div className="earn-filters" role="group" aria-label="Filter by sector">
        {chips.map((chip) => {
          const on = picked.has(chip.value);
          return (
            <button key={chip.value} type="button" aria-pressed={on}
                    className={'earn-chip' + (on ? ' is-on' : '') + (chip.value === SOFTWARE ? ' is-sw' : '')}
                    onClick={() => toggle(chip.value)}>
              {chip.label}<span className="earn-chip-n">{chip.n}</span>
            </button>
          );
        })}
      </div>

      {events.map((ev, k) => {
        const ranked = ev.companies.map((c, i) => ({ ...c, rank: i + 1 }));
        const rows = ranked.filter((c) => matches(c, picked));
        return (
          <div className="earn-session" key={k}>
            <div className="earn-session-head">
              <span className="earn-when">{SESSION[ev.time] ? SESSION[ev.time][1] : ev.time}</span>
              <span className="earn-session-count">
                {rows.length}{picked.size > 0 ? ` of ${ev.companies.length}` : ''} companies
              </span>
            </div>
            {rows.length === 0
              ? <div className="docket-none">
                  No matching names in this session.
                </div>
              : (
                <div className="earn-tbl-wrap">
                  <table className="earn-tbl">
                    <thead>
                      <tr>
                        <th className="e-rank">#</th>
                        <th className="e-tick">Ticker</th>
                        <th>Company</th>
                        <th className="e-cap">Market cap</th>
                        <th className="e-sec">Sector</th>
                        <th className="e-eps">EPS est.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c) => (
                        <tr key={c.symbol + c.rank} className={c.flagged ? 'is-flagged' : undefined}>
                          <td className="e-rank">{c.rank}</td>
                          <td className="e-tick">{c.symbol || '—'}</td>
                          <td className="e-co">{c.name}</td>
                          <td className="e-cap">{fmtCap(c.cap)}</td>
                          <td className="e-sec">
                            {c.software
                              ? <span className="sec-badge is-software" title={c.industry}>Software</span>
                              : c.flagged
                                ? <span className="sec-badge is-key">{shortSector(c.sector)}</span>
                                : <span className="sec-plain">{shortSector(c.sector)}</span>}
                          </td>
                          <td className="e-eps">{c.eps || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        );
      })}
    </Panel>
  );
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function CalendarView() {
  const { data, error, loading } = useCalendar();
  const [hidden, setHidden] = useState(() => new Set());
  const [sel, setSel] = useState(null);
  /* The 28-day grid is the tall thing in this column, so on a day with a long
     docket the earnings table is reading through a slot a few rows high. This
     collapses the grid to its header and gives the column to earnings; the
     grid's header stays clickable so there is a way back without scrolling. */
  const [earningsMax, setEarningsMax] = useState(false);
  const toggleEarningsMax = () => setEarningsMax((v) => !v);

  /* Re-applied after taking this view from markets-learning-dashboard: the
     boot gate is a platform concept the origin repo does not have, so it is
     not in the copied file. Everything else here is origin's. */
  useBootGate('calendar', !loading || !!error, { what: 'release calendar' });

  const grid = useMemo(() => {
    if (!data) return [];
    const [y, m, d] = data.start.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));   // back to Monday
    return Array.from({ length: 28 }, (_, i) => {
      const day = new Date(start); day.setDate(start.getDate() + i);
      return iso(day);
    });
  }, [data]);

  if (loading) return <section className="view is-active ws ws-calendar"><div className="col col-center">
    <Panel swatch="b" title="Release calendar"><span className="muted small">Loading…</span></Panel></div></section>;
  if (error) return <section className="view is-active ws ws-calendar"><div className="col col-center">
    <Panel swatch="b" title="Release calendar"><span className="err">Couldn’t load: {error.message}</span></Panel></div></section>;

  const visible = (e) => !hidden.has(e.cat || 'econ');
  const evsFor = (day) => data.events.filter((e) => e.date === day && visible(e));
  const selected = sel || data.start;
  const toggle = (c) => setHidden((h) => { const n = new Set(h); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const dLong = (s) => { const [y, m, d] = s.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(y, m - 1, d)); };

  return (
    <section className={'view is-active ws ws-calendar' + (earningsMax ? ' is-earnings-max' : '')}>
      <div className="col col-center">
        <Panel swatch="b" title="Release calendar" tools={<>
          {!earningsMax && (
            <div className="calview-legend">
              {CATS.map(([c, label]) => (
                <button key={c} type="button" className={`cv-leg cat-${c}` + (hidden.has(c) ? ' is-off' : '')}
                        aria-pressed={!hidden.has(c)} onClick={() => toggle(c)}>
                  <span className="cv-dot" />{label}
                </button>
              ))}
            </div>
          )}
          {earningsMax && <span className="cv-min-note">Minimised for earnings</span>}
          <IconBtn small on={earningsMax} onClick={toggleEarningsMax}
                   title={earningsMax ? 'Restore the release calendar' : 'Minimise the release calendar'}
                   aria-label={earningsMax ? 'Restore the release calendar' : 'Minimise the release calendar'}
                   aria-expanded={!earningsMax}>{earningsMax ? '▸' : '▾'}</IconBtn>
        </>}>
          <div className="calview-grid-wrap">
            <div className="calview-grid">
              {WD.map((w) => <div className="cv-wd" key={w}>{w}</div>)}
              {grid.map((day) => {
                const evs = evsFor(day);
                const isToday = day === data.start;
                return (
                  <div key={day} className={'cv-day' + (isToday ? ' today' : '') + (day === selected ? ' sel' : '')}
                       onClick={() => setSel(day)}>
                    <div className="cv-num">{Number(day.slice(-2))}{isToday && <span className="cv-today-tag">Today</span>}</div>
                    {evs.slice(0, 3).map((ev, i) => (
                      <div key={i} className={`cv-chip cat-${ev.cat || 'econ'}`}>
                        <span className="cv-chip-t">{SESSION[ev.time] ? SESSION[ev.time][0] : ev.time}</span>
                        <span className="cv-dot" />
                        {ev.cat === 'earnings' ? ev.note : ev.name}
                      </div>
                    ))}
                    {evs.length > 3 && <div className="cv-more">+{evs.length - 3} more</div>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="asof">Exact dates from agency schedules via FRED, the FOMC calendar, and Nasdaq · all times Eastern.</div>
        </Panel>
        <EarningsPanel
          events={evsFor(selected).filter((e) => e.cat === 'earnings' && e.companies?.length)}
          dateLabel={dLong(selected)}
          expanded={earningsMax}
          onToggleExpand={toggleEarningsMax} />
      </div>

      <div className="col col-right">
        <Panel swatch="c" title="Day detail">
          <div className="cv-det-date">{dLong(selected)}</div>
          {evsFor(selected).length === 0 && <div className="docket-none">Nothing scheduled.</div>}
          {evsFor(selected).map((ev, i) => (
            <div key={i} className={`cv-det cat-${ev.cat || 'econ'}`}>
              <div className="cv-det-timecol">
                <span className="cv-time-big">{SESSION[ev.time] ? SESSION[ev.time][0] : ev.time.split(' ')[0]}</span>
                <span className="cv-time-sub">{SESSION[ev.time] ? SESSION[ev.time][2] : 'ET'}</span>
              </div>
              <div className="cv-det-main">
                <div className="cv-det-head">
                  <span className="cv-det-name">{ev.cat === 'earnings' ? 'Earnings' : ev.name}</span>
                  <span className="cal-badge">{ev.cat}</span>
                </div>
                {ev.cat === 'earnings'
                  ? <div className="cv-note">{ev.companies?.length || 0} companies — see the Earnings panel.</div>
                  : ev.note && <div className="cv-note">{ev.note}</div>}
              </div>
            </div>
          ))}
        </Panel>
      </div>
    </section>
  );
}

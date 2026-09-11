import { useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { useCalendar, etParts } from '@markets/calendar/useCalendar.js';
import { IconBtn } from './Panel.jsx';
import { useRegistry } from '../lib/registry.jsx';

/* The Refresh button, made real: POST /api/refresh flushes every registered
   server cache, starts the price-tail update inside the insider service, and
   starts the graph fundamentals pull; this button then polls until both
   background pieces settle and only THEN bumps the client nonce — so the
   refetch that follows lands on fresh data, not on the caches it just missed.
   Earnings intel is deliberately not included (it spends Claude budget); the
   Graph surface keeps that as an explicit per-ticker action. */
function RefreshAll({ refetch }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);   // transient result, shown in the title
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  /* Load-time refresh: every dashboard load kicks the same pipeline the
     button runs, so what renders is at worst the PREVIOUS load's data and
     upgrades to this load's fetch when it settles. auto=1 lets the server
     collapse reload bursts and extra tabs into one refresh (5-minute
     cooldown) — within it, the data already is "as of this load". */
  const kickedRef = useRef(false);
  useEffect(() => {
    if (kickedRef.current) return;
    kickedRef.current = true;
    go(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const poll = () => {
    fetch('/api/refresh/status').then((r) => r.json()).then((s) => {
      const pricesDone = s.prices.state !== 'running';
      const pullDone = s.pull.state !== 'running';
      if (pricesDone && pullDone) {
        setBusy(false);
        setNote([
          s.prices.state === 'done' ? `prices +${s.prices.rows ?? 0} rows` : `prices ${s.prices.state}`,
          `fundamentals ${s.pull.state}`,
        ].join(' · '));
        refetch();   // every surface refetches, now onto cold caches and fresh stores
      } else {
        timer.current = setTimeout(poll, 2500);
      }
    }).catch(() => { setBusy(false); refetch(); });
  };

  const go = (auto) => {
    const isAuto = auto === true;   // onClick passes the event object — that is a manual press
    if (busy) return;
    setBusy(true);
    setNote(null);
    fetch(`/api/refresh${isAuto ? '?auto=1' : ''}`, { method: 'POST' })
      .then((r) => r.json())
      .then((j) => {
        if (j.skipped) { setBusy(false); return; }   // refreshed moments ago — already current
        if (!isAuto) refetch();
        timer.current = setTimeout(poll, 2500);
      })
      .catch(() => { setBusy(false); if (!isAuto) refetch(); });
  };

  return (
    <IconBtn title={busy ? 'Refreshing — caches flushed; prices and fundamentals updating…'
                         : note ? `Refresh everything (last: ${note})` : 'Refresh everything — flush caches, update prices and fundamentals'}
             aria-label="Refresh all data" onClick={go}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"
           strokeLinecap="round" strokeLinejoin="round"
           className={busy ? 'tb-spin' : undefined}><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></svg>
    </IconBtn>
  );
}

function useSession() {
  const { data } = useCalendar();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);
  const todays = data ? data.events.filter((e) => e.date === data.start && e.cat === 'market') : [];
  const holiday = todays.find((e) => e.name.startsWith('Markets closed'));
  const early = todays.find((e) => e.name.startsWith('Early close'));
  const { dow, mins } = etParts();
  const weekend = dow === 'Sat' || dow === 'Sun';
  const close = early ? 13 * 60 : 16 * 60;
  if (holiday) return ['is-closed', holiday.name];
  if (weekend) return ['is-closed', 'Markets closed · weekend'];
  if (mins < 9 * 60 + 30) return ['is-pre', 'Pre-market · opens 9:30 AM ET'];
  if (mins < close) { const l = close - mins; return ['is-open', `Market hours · ${Math.floor(l / 60)}h ${l % 60}m to close`]; }
  return ['is-post', `After hours · closed ${early ? '1:00' : '4:00'} PM ET`];
}

/* Is the tab running an older build than the server is holding?
 *
 * A single-page app never refetches its bundle on in-app navigation, so a tab
 * left open across a rebuild shows yesterday's UI with today's data — and a
 * person told "the feature is deployed" is right not to believe it. The first
 * /api/version answer is the baseline (the stamp the page was served under is
 * close enough to the stamp at first poll); when a later poll differs, the
 * pill appears. Null stamps (Vite dev, no build) never trigger — the dev
 * server serves live source and has no staleness to announce. */
function useBuildStale() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let alive = true;
    let baseline = null;
    const check = () => fetch('/api/version')
      .then((r) => r.json())
      .then(({ version }) => {
        if (!alive || !version) return;
        if (baseline == null) baseline = version;
        else if (version !== baseline) setStale(true);
      })
      .catch(() => {});
    check();
    const t = setInterval(check, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return stale;
}

/* Two rows, because a flat strip stops working around ten tabs and this
 * platform is heading for fifteen. The group row is always the same four
 * chips; the second row is the active group's surfaces.
 *
 * The second row renders even when a group holds one surface. It looks sparse,
 * but a row that appears and disappears shifts the entire workspace up and down
 * as you navigate, which is worse than a little empty space.
 *
 * Clicking a group returns you to the surface you last used inside it, not to
 * its first — a group is a place you were, not a menu you re-enter at the top.
 */
export function TopBar() {
  const { view, setView, theme, toggleTheme, refresh } = useApp();
  const { groups: GROUPS, groupOf } = useRegistry();
  const [cls, label] = useSession();
  const stale = useBuildStale();
  const active = groupOf(view);

  // Remembered per group for the session. A ref, not state: nothing renders
  // off it, and writing it must never cause a re-render mid-navigation.
  const lastInGroup = useRef({});
  useEffect(() => { lastInGroup.current[groupOf(view)] = view; }, [view]);

  const openGroup = (g) => {
    if (g.id === active) return;
    const remembered = lastInGroup.current[g.id];
    const known = g.views.some(([id]) => id === remembered);
    setView(known ? remembered : g.views[0][0]);
  };

  return (
    <header className="topbar">
      <div className="tb-left">
        <span className="brand" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M21 7v5h-5" /></svg>
        </span>
        <nav className="tabs" aria-label="Sections">
          {GROUPS.map((g) => (
            <button key={g.id} type="button" className={'tab' + (g.id === active ? ' is-active' : '')}
                    aria-current={g.id === active ? 'true' : undefined}
                    onClick={() => openGroup(g)}>{g.label}</button>
          ))}
        </nav>
      </div>

      <div className="tb-center">
        <span className={'mkt-pill ' + cls}><span className="mkt-dot" />{label}</span>
      </div>

      <div className="tb-right">
        {stale && (
          <button type="button" className="tb-stale"
                  title="The dashboard was rebuilt since this tab loaded — press to reload onto the new build"
                  onClick={() => location.reload()}>
            new build — reload
          </button>
        )}
        <RefreshAll refetch={refresh} />
        <IconBtn title="Toggle theme" aria-label="Toggle light / dark theme" onClick={toggleTheme}>
          {theme === 'dark' ? '☀' : '☾'}
        </IconBtn>
        <div className="acct-pill"><span>SYNTHETIC DEMO</span><span className="acct-caret">▾</span></div>
      </div>
    </header>
  );
}

/** The second row: the surfaces inside the active group. */
export function SubNav() {
  const { view, setView } = useApp();
  const { groupOf, groupById } = useRegistry();
  const group = groupById(groupOf(view));
  return (
    <nav className="subnav" aria-label={`${group.label} surfaces`}>
      {group.views.map(([id, text]) => (
        <button key={id} type="button" className={'subtab' + (view === id ? ' is-active' : '')}
                aria-current={view === id ? 'page' : undefined}
                onClick={() => setView(id)}>{text}</button>
      ))}
    </nav>
  );
}

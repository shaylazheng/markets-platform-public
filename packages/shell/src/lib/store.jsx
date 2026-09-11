import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WATCHLIST } from './series.js';
import { useRegistry } from './registry.jsx';
import { postJSON } from './api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const stamp = (attr, v, key) => {
  document.documentElement.setAttribute(attr, v);
  localStorage.setItem(key, v);
};

export function AppProvider({ children }) {
  const { viewIds, defaultView } = useRegistry();
  const root = document.documentElement;
  const [symbol, setSymbol] = useState(() => localStorage.getItem('symbol') || 'SP500');
  const [tf, setTf] = useState(() => localStorage.getItem('tf') || '1Y');
  const [featuredTf, setFeaturedTf] = useState('1Y');
  // The hash is `#view` plus optional surface-owned params, e.g. `#graph&focus=NVDA`.
  // The graph writes that second segment so a post-research reload lands back on
  // the graph with the same company focused, instead of bouncing to Markets.
  const [view, setView] = useState(() => {
    const h = (location.hash || '').slice(1).split('&')[0];
    return viewIds.includes(h) ? h : defaultView;
  });
  /* THE COMPANY, shared by every surface that has one.
   *
   * The four Company tabs, plus Insider — which is its own group now, because
   * its default state is a market-wide screen rather than a view of one
   * company, but which still follows the shared ticker once you drill in.
   *
   * Competitors, Valuation, Graph, Management and Insider each used to hold
   * their own ticker, so they behaved as five unrelated tools: you looked
   * up NVDA on Valuation, moved to Management, and were shown whatever that
   * surface last had — usually CME, because that was its default. Little icon
   * links existed on each surface purely to carry the ticker across, which is a
   * workaround for exactly this and is now deleted.
   *
   * Seeded from the hash so a bookmark still wins, then from the last company
   * looked at, so the group opens where you left it. Uppercased on the way in:
   * every consumer compares against uppercase, and a lowercase ticker typed
   * into one surface used to silently mismatch the next one. */
  const [company, setCompanyRaw] = useState(() => {
    const tail = new URLSearchParams((location.hash || '').slice(1).split('&').slice(1).join('&'));
    const fromHash = (tail.get('ticker') || tail.get('focus') || '').toUpperCase().trim();
    return fromHash || (localStorage.getItem('company') || 'NVDA').toUpperCase();
  });
  const setCompany = useCallback((t) => {
    const up = String(t || '').toUpperCase().trim();
    if (up) setCompanyRaw(up);
  }, []);

  const [theme, setTheme] = useState(() => root.getAttribute('data-theme') || 'dark');
  const [nonce, setNonce] = useState(0);           // bumped to force a refetch

  // Insights render into their own panel rather than inline, so any trigger —
  // a chart, a headline — targets one shared destination. Results are cached by
  // key, so re-opening something already explained costs nothing.
  const [insight, setInsight] = useState({ key: null, title: '', meta: '', text: '', loading: false, error: null });
  const insightCache = useRef(new Map());

  // The last few insights generated this session, newest first, so the panel can
  // offer them back after you have moved on to another one. Four are kept but
  // only three are ever shown: the panel drops whichever is currently open, and
  // holding one spare means the list is still three long when that happens.
  const [insightHistory, setInsightHistory] = useState([]);

  const showInsight = useCallback(async (key, title, meta, payload) => {
    if (insightCache.current.has(key)) {
      setInsight({ key, title, meta, text: insightCache.current.get(key), loading: false, error: null });
      return;
    }
    setInsight({ key, title, meta, text: '', loading: true, error: null });
    try {
      const j = await postJSON('/api/insight', typeof payload === 'function' ? payload() : payload);
      insightCache.current.set(key, j.content);
      setInsight({ key, title, meta, text: j.content, loading: false, error: null });
      // Recorded on generation, not on viewing — re-opening from the list must
      // not reshuffle the list under the cursor that is clicking it.
      setInsightHistory((h) => [{ key, title, meta, text: j.content }, ...h.filter((e) => e.key !== key)].slice(0, 4));
    } catch (e) {
      setInsight({ key, title, meta, text: '', loading: false, error: e.message });
    }
  }, []);
  const clearInsight = useCallback(() => setInsight(
    { key: null, title: '', meta: '', text: '', loading: false, error: null }), []);
  // Restores from the entry's own copy of the text rather than the cache, so a
  // listed insight can never open empty.
  const restoreInsight = useCallback((entry) => setInsight(
    { ...entry, loading: false, error: null }), []);

  useEffect(() => { localStorage.setItem('symbol', symbol); }, [symbol]);
  useEffect(() => { localStorage.setItem('company', company); }, [company]);
  useEffect(() => { localStorage.setItem('tf', tf); }, [tf]);
  useEffect(() => { stamp('data-theme', theme, 'theme'); }, [theme]);
  useEffect(() => {
    // Replace only the view segment; a surface's own params survive a re-render,
    // but are dropped when the user deliberately navigates elsewhere.
    const [prev, ...rest] = (location.hash || '').slice(1).split('&');
    history.replaceState(null, '', '#' + (prev === view ? [view, ...rest].join('&') : view));
  }, [view]);

  const selectSymbol = useCallback((id) => {
    if (WATCHLIST.some((w) => w.id === id)) setSymbol(id);
  }, []);
  const stepSymbol = useCallback((delta) => {
    setSymbol((cur) => {
      const i = WATCHLIST.findIndex((w) => w.id === cur);
      return WATCHLIST[(Math.max(0, i) + delta + WATCHLIST.length) % WATCHLIST.length].id;
    });
  }, []);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo(() => ({
    symbol, selectSymbol, stepSymbol,
    tf, setTf, featuredTf, setFeaturedTf,
    view, setView,
    company, setCompany,
    theme, toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    insight, showInsight, clearInsight, insightHistory, restoreInsight,
    nonce, refresh,
  }), [symbol, selectSymbol, stepSymbol, tf, featuredTf, view, company, setCompany, theme,
       insight, showInsight, clearInsight, insightHistory, restoreInsight, nonce, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

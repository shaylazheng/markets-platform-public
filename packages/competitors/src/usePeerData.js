/* Data hooks for the Competitors surface.
 *
 * The load story is the whole design here. A batched "give me six companies"
 * call returns only after the slowest one -- on a cold cache that is tens of
 * seconds staring at nothing, because each company is a ~3.8MB companyfacts
 * download behind a 5 req/s SEC limit. So we fan out ONE REQUEST PER TICKER at
 * a small concurrency and let the table fill row by row. A slow or broken peer
 * then degrades a single row instead of the surface.
 *
 * StrictMode double-fires every effect, so every fetch carries an
 * AbortController and every hook an `alive` flag.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchFundamentals, fetchMetrics, fetchNotes, fetchPeerInsider,
  fetchPeerInsiderRecord, fetchPeerNews, fetchPrices, fetchResolve, fetchSuggest,
} from './peers.js';

const CONCURRENCY = 3;   // the gateway is pinned to 5 req/s at SEC; more just queues

/* The descriptor table is static for the session: one module-level promise. */
let metricsPromise = null;
export function useMetricDescriptors() {
  const [state, setState] = useState({ metrics: null, categories: [], error: null });
  useEffect(() => {
    let alive = true;
    metricsPromise ??= fetchMetrics();
    metricsPromise
      .then((j) => alive && setState({ metrics: j.metrics, categories: j.categories, error: null }))
      .catch((e) => { metricsPromise = null; if (alive) setState((s) => ({ ...s, error: e })); });
    return () => { alive = false; };
  }, []);
  return state;
}

const resolveCache = new Map();
export function useResolve(ticker) {
  const [state, setState] = useState({ data: null, error: null, loading: !!ticker });
  useEffect(() => {
    if (!ticker) { setState({ data: null, error: null, loading: false }); return; }
    let alive = true;
    if (resolveCache.has(ticker)) {
      setState({ data: resolveCache.get(ticker), error: null, loading: false });
      return;
    }
    setState({ data: null, error: null, loading: true });
    fetchResolve(ticker)
      .then((d) => { resolveCache.set(ticker, d); if (alive) setState({ data: d, error: null, loading: false }); })
      .catch((e) => alive && setState({ data: null, error: e, loading: false }));
    return () => { alive = false; };
  }, [ticker]);
  return state;
}

export function useSuggest(ticker) {
  const [state, setState] = useState({ data: null, loading: false });
  useEffect(() => {
    if (!ticker) { setState({ data: null, loading: false }); return; }
    let alive = true;
    setState({ data: null, loading: true });
    fetchSuggest(ticker)
      .then((d) => alive && setState({ data: d, loading: false }))
      .catch(() => alive && setState({ data: null, loading: false }));
    return () => { alive = false; };
  }, [ticker]);
  return state;
}

/**
 * The centrepiece fetch. Returns a Map that GROWS as rows land, so the matrix
 * can render each company the moment its data arrives.
 */
export function usePeerPanel(tickers, nonce) {
  const [byTicker, setByTicker] = useState(() => new Map());
  const [pending, setPending] = useState(() => new Set());
  const [errors, setErrors] = useState(() => new Map());
  const cache = useRef(new Map());

  // A string dep, not the array: a fresh array identity every render would
  // re-fire this effect forever.
  const key = tickers.join(',');

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();   // actually cancels an in-flight body

    const seed = new Map();
    for (const t of tickers) {
      const hit = cache.current.get(`${t}:${nonce}`);
      if (hit) seed.set(t, hit);
    }
    setByTicker(seed);
    setErrors(new Map());

    const want = tickers.filter((t) => !cache.current.has(`${t}:${nonce}`));
    setPending(new Set(want));
    if (!want.length) return () => { alive = false; ac.abort(); };

    let i = 0;
    const worker = async () => {
      while (alive && i < want.length) {
        const t = want[i++];
        try {
          const d = await fetchFundamentals(t, { signal: ac.signal });
          if (!alive) return;
          cache.current.set(`${t}:${nonce}`, d);
          setByTicker((m) => new Map(m).set(t, d));   // row appears as it lands
        } catch (e) {
          if (!alive || e.name === 'AbortError') return;
          setErrors((m) => new Map(m).set(t, e));
        } finally {
          if (alive) setPending((s) => { const n = new Set(s); n.delete(t); return n; });
        }
      }
    };
    Promise.all(Array.from({ length: Math.min(CONCURRENCY, want.length) }, worker));

    return () => { alive = false; ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  return { byTicker, pending, errors, loading: pending.size > 0 };
}

export function usePeerNews(tickers, nonce) {
  const [state, setState] = useState({ items: null });
  const key = tickers.join(',');
  useEffect(() => {
    if (!tickers.length) { setState({ items: [] }); return; }
    let alive = true;
    setState({ items: null });
    fetchPeerNews(tickers)
      .then((j) => alive && setState({ items: j.items || [] }))
      .catch(() => alive && setState({ items: [] }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);
  return state;
}

export function usePeerInsider(tickers, nonce, days = 90) {
  const [state, setState] = useState({ data: null });
  const key = tickers.join(',');
  useEffect(() => {
    if (!tickers.length) { setState({ data: {} }); return; }
    let alive = true;
    setState({ data: null });
    fetchPeerInsider(tickers, days)
      .then((j) => alive && setState({ data: j.tickers || {} }))
      .catch(() => alive && setState({ data: {} }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, days]);
  return state;
}

/** The forward-return record. Lazy: `on` stays false until the section opens,
 *  because this is a multi-year scan per peer and nobody has asked to see it. */
export function usePeerInsiderRecord(tickers, nonce, on, years = 5) {
  const [state, setState] = useState({ data: null, loading: false });
  const key = tickers.join(',');
  useEffect(() => {
    if (!on || !tickers.length) return;
    let alive = true;
    setState({ data: null, loading: true });
    fetchPeerInsiderRecord(tickers, years)
      .then((j) => alive && setState({ data: j, loading: false }))
      .catch(() => alive && setState({ data: null, loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, on, years]);
  return state;
}

export function usePeerPrices(tickers, nonce, from) {
  const [state, setState] = useState({ data: null, error: null });
  const key = tickers.join(',');
  useEffect(() => {
    if (tickers.length < 1) { setState({ data: null, error: null }); return; }
    let alive = true;
    setState({ data: null, error: null });
    fetchPrices(tickers, from)
      .then((j) => alive && setState({ data: j, error: null }))
      .catch((e) => alive && setState({ data: null, error: e }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, from]);
  return state;
}

export function useDeepDive(ticker, nonce) {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    if (!ticker) { setState({ status: 'missing' }); return; }
    let alive = true;
    setState({ status: 'loading' });
    fetchNotes(ticker)
      .then((j) => alive && setState(
        j.exists ? { status: 'ok', data: j.data, path: j.path, updatedAt: j.updatedAt }
                 : { status: 'missing', path: j.path, template: j.template }))
      .catch((e) => alive && setState({ status: 'error', error: e }));
    return () => { alive = false; };
  }, [ticker, nonce]);
  return state;
}

/** Rows in a stable order: focal pinned first, then peers alphabetically.
 *  Rows that came back with a per-ticker error are excluded here because every
 *  consumer (matrix, bars, quadrant) reads `.values` — see usePeerFailures. */
export function usePeerRows(byTicker, focal, peers) {
  return useMemo(() => {
    const order = [focal, ...peers.filter((p) => p !== focal)];
    return order
      .map((t) => byTicker.get(t))
      .filter(Boolean)
      .filter((d) => !d.error)
      .map((d) => ({ ...d, isFocal: d.ticker === focal }));
  }, [byTicker, focal, peers]);
}

/* The rows usePeerRows drops.
 *
 * /fundamentals answers 200 with `{ ticker, error }` on purpose -- one bad peer
 * must degrade one row, not the whole comparison -- which means a failure never
 * reaches usePeerPanel's `errors` map, since nothing threw. The row was then
 * filtered out here and vanished without trace: type a ticker that cannot
 * resolve and the surface shows an empty grid and five "Waiting for data…"
 * panels, with nothing anywhere saying which company failed or why. Silence is
 * the wrong answer to a question the server answered clearly. */
export function usePeerFailures(byTicker, focal, peers) {
  return useMemo(() => {
    const order = [focal, ...peers.filter((p) => p !== focal)];
    return order
      .map((t) => byTicker.get(t))
      .filter((d) => d && d.error)
      .map((d) => ({ ticker: d.ticker, code: d.error, detail: d.detail,
                     isFocal: d.ticker === focal }));
  }, [byTicker, focal, peers]);
}

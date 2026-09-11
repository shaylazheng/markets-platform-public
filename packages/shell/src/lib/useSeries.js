import { useEffect, useState } from 'react';
import { fetchSeries } from './api.js';

/* One series, with loading and error states. Shared cache means many components
   can ask for the same id and only one request goes out. */
export function useSeries(id, nonce = 0) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    if (!id) { setState({ data: null, error: null, loading: false }); return; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchSeries(id)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => { alive = false; };
  }, [id, nonce]);
  return state;
}

/* Several series at once, keyed by id; missing ones resolve to null. */
export function useSeriesSet(ids, nonce = 0) {
  const key = ids.join(',');
  const [state, setState] = useState({ got: {}, loading: true });
  useEffect(() => {
    let alive = true;
    setState({ got: {}, loading: true });
    Promise.all(ids.map((id) =>
      fetchSeries(id).then((d) => [id, d]).catch(() => [id, null]),
    )).then((pairs) => alive && setState({ got: Object.fromEntries(pairs), loading: false }));
    return () => { alive = false; };
  }, [key, nonce]);
  return state;
}

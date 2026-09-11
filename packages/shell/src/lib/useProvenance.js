/* The filing trace for one company on one frame, memoised for the session.
 *
 * Served by the peers router (/api/peers/provenance — core/lib/provenance.js
 * does the work), which the gateway always mounts. The shell holds no import
 * of the competitors package — this is a URL, reached the same way a
 * standalone section reaches any /api route — but it IS a runtime dependency
 * on that route existing, stated here rather than discovered in a 404.
 *
 * Fetched only when asked: the trace is tens of kilobytes nobody has asked to
 * see until a src button is pressed, except on surfaces whose default source
 * list wants the company's own filings — they pass `enabled` up front.
 * Memoised per (ticker, frame): filings do not change while a page is open.
 */
import { useEffect, useState } from 'react';

const cache = new Map();
export function fetchProvenanceShared(ticker, frame) {
  const k = `${ticker}:${frame || ''}`;
  if (!cache.has(k)) {
    cache.set(k, fetch(
      `/api/peers/provenance?ticker=${encodeURIComponent(ticker)}`
      + (frame ? `&frame=${encodeURIComponent(frame)}` : ''),
    ).then(async (r) => {
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    }).catch((e) => { cache.delete(k); throw e; }));
  }
  return cache.get(k);
}

/** @returns {{ prov: object|null, state: 'idle'|'loading'|'ok'|'error' }} */
export function useProvenance(ticker, frame, enabled = true) {
  const [out, setOut] = useState({ prov: null, state: 'idle' });
  const key = enabled && ticker ? `${ticker}:${frame || ''}` : null;

  useEffect(() => {
    if (!key) { setOut({ prov: null, state: 'idle' }); return undefined; }
    let alive = true;
    setOut((o) => (o.state === 'ok' ? o : { ...o, state: 'loading' }));
    fetchProvenanceShared(ticker, frame)
      .then((j) => { if (alive) setOut({ prov: j, state: 'ok' }); })
      .catch(() => { if (alive) setOut({ prov: null, state: 'error' }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return out;
}

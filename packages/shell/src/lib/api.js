/* Same-origin calls to the Express API. In dev, Vite proxies /api to :3000. */
const seriesCache = new Map();

export function fetchSeries(id, { fresh = false } = {}) {
  if (fresh) seriesCache.delete(id);
  if (!seriesCache.has(id)) {
    const url = `/api/fred?series=${encodeURIComponent(id)}${fresh ? '&nocache=1' : ''}`;
    seriesCache.set(id, fetch(url).then(async (r) => {
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
      const dates = [], values = [];
      for (const o of json.observations || []) {
        if (o.value === '.' || o.value === '' || o.value == null) continue;
        const v = Number(o.value);
        if (!Number.isFinite(v)) continue;
        dates.push(o.date); values.push(v);
      }
      if (!values.length) throw new Error('No observations returned.');
      return { dates, values };
    }).catch((e) => { seriesCache.delete(id); throw e; }));
  }
  return seriesCache.get(id);
}
export const clearSeriesCache = () => seriesCache.clear();

const getJSON = async (url) => {
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};
export const fetchNews = () => getJSON('/api/news');
export const fetchCalendar = () => getJSON('/api/calendar');

export async function postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

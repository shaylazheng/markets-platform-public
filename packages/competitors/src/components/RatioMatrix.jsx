/* The comparison matrix — the centrepiece of the surface.
 *
 * Renders entirely off the server's metric-descriptor table and knows NO metric
 * names. That is what lets a metric added server-side appear here with no
 * frontend change, and what keeps the surface generic across every company.
 *
 * Shading is diverging with a neutral midpoint (the midpoint being no fill at
 * all), never a rainbow, and `higherIsBetter` inverts the scale so a LOW
 * net-debt/EBITDA reads as good. Where the descriptor says `higherIsBetter:
 * null` -- market cap, say -- nothing is shaded, because painting a number
 * green requires knowing that more of it is better and for scale metrics nobody
 * does.
 */
import { useMemo, useState } from 'react';
import { fmtMetric, percentileRank, rankRows } from '../peers.js';

/* Selection is the surface's, not the matrix's: clicking a cell here and a bar
   in the Ranked panel must drive the SAME inspector, so `onSelect`/`selected`
   are passed down rather than held locally. */

/* Why a per-ticker failure happened, in the reader's terms. The server ships a
   code; a code on its own ("NO_XBRL") explains nothing to the person who typed
   the ticker. */
const FAILURE = {
  NOT_FOUND: 'not a current SEC registrant, and no Form 4 in this platform’s history used that ticker',
  NO_XBRL: 'files with SEC but has no XBRL financial data — common for shells, trusts and some funds',
  NO_PERIODS: 'has XBRL facts but no complete reporting period yet',
  SEC_UNAVAILABLE: 'SEC did not answer — rate limit or an outage; try again shortly',
};

export function RatioMatrix({ rows, metrics, categories, pending, errors, failures = [], focal,
                             visibleCategories, onPickTicker, onPickMetric, selectedMetric,
                             onSelect, selected }) {
  const [sort, setSort] = useState({ id: null, dir: 1 });
  const [showRanks, setShowRanks] = useState(false);

  const shown = useMemo(
    () => metrics.filter((m) => visibleCategories.includes(m.category)),
    [metrics, visibleCategories]);

  // Column populations, computed once: shading and ranking both need them.
  const columns = useMemo(() => {
    const out = {};
    for (const m of metrics) {
      const vals = rows.map((r) => r.values?.[m.id]).filter((v) => typeof v === 'number');
      out[m.id] = { vals, ranks: rankRows(rows, m) };
    }
    return out;
  }, [rows, metrics]);

  const sorted = useMemo(() => {
    if (!sort.id) return rows;
    const m = metrics.find((x) => x.id === sort.id);
    const peers = rows.filter((r) => !r.isFocal);
    peers.sort((a, b) => {
      const av = a.values?.[sort.id], bv = b.values?.[sort.id];
      const an = typeof av === 'number', bn = typeof bv === 'number';
      // Nulls and n/a always sort last, in both directions: a company that
      // reports nothing must not win a column by default.
      if (!an && !bn) return 0;
      if (!an) return 1;
      if (!bn) return -1;
      return (av - bv) * sort.dir * (m?.higherIsBetter === false ? 1 : -1);
    });
    // The focal row never moves — it is the reference the rest are read against.
    return [...rows.filter((r) => r.isFocal), ...peers];
  }, [rows, sort, metrics]);

  const toggleSort = (m) => setSort((s) => (
    s.id !== m.id
      // Default direction comes from the descriptor, so clicking "Net debt /
      // EBITDA" puts the LEAST levered on top — the non-obvious right answer.
      ? { id: m.id, dir: 1 }
      : s.dir === 1 ? { id: m.id, dir: -1 } : { id: null, dir: 1 }));

  const groups = categories
    .filter((c) => visibleCategories.includes(c))
    .map((c) => ({ c, n: shown.filter((m) => m.category === c).length }))
    .filter((g) => g.n);

  return (
    <div className="cmp-matrix-wrap">
      <table className="cmp-matrix">
        <thead>
          <tr className="cmp-groups">
            <th scope="col" />
            {groups.map((g) => <th key={g.c} colSpan={g.n} scope="colgroup">{g.c}</th>)}
          </tr>
          <tr className="cmp-metrics">
            <th scope="col">
              <button type="button" className="cmp-ranktoggle"
                      aria-pressed={showRanks}
                      title="Swap every shaded value for its rank — the colour-independent view"
                      onClick={() => setShowRanks((v) => !v)}>
                {showRanks ? '#' : '↕'}
              </button>
            </th>
            {shown.map((m) => (
              <th key={m.id} scope="col"
                  className={(selectedMetric === m.id ? 'is-sel ' : '')
                    + (columns[m.id].vals.length < 3 ? 'is-unshaded' : '')}
                  aria-sort={sort.id === m.id ? (sort.dir === 1 ? 'descending' : 'ascending') : 'none'}
                  title={`${m.label} · basis ${m.basis}`
                    + (columns[m.id].vals.length < 3 ? ' · not shaded, needs 3+ reporting companies' : '')}
                  onClick={() => { toggleSort(m); onPickMetric?.(m.id); }}>
                {m.label}
                {sort.id === m.id && <span className="cmp-sortmark">{sort.dir === 1 ? '▾' : '▴'}</span>}
                {columns[m.id].vals.length < 3 && <span className="cmp-degree">°</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.ticker} className={r.isFocal ? 'is-focal' : ''}>
              <th scope="row">
                <button type="button" className="cmp-tk" onClick={() => onPickTicker?.(r.ticker)}
                        title={`${r.meta?.name || r.ticker} — make focal`}>{r.ticker}</button>
                {r.basis === 'annual' && <span className="cmp-basis" title="Issuer files no quarterly XBRL; annual basis">A</span>}
                <StaleMark row={r} rows={rows} />
                <button type="button" className="si-srcbtn"
                        title={`Sources behind every ${r.ticker} figure`}
                        aria-pressed={selected?.kind === 'company' && selected.ticker === r.ticker}
                        onClick={() => onSelect?.({ kind: 'company', ticker: r.ticker,
                                                    frame: r.frame, row: r })}>src</button>
              </th>
              {shown.map((m) => (
                <Cell key={m.id} metric={m} row={r} col={columns[m.id]} showRanks={showRanks}
                      onSelect={onSelect} selected={selected} />
              ))}
            </tr>
          ))}
          {[...pending].map((t) => (
            <tr key={`p-${t}`} className="cmp-row-pending">
              <th scope="row">{t}</th>
              <td colSpan={shown.length}><span className="cmp-shimmer" />loading…</td>
            </tr>
          ))}
          {[...errors.entries()].map(([t, e]) => (
            <tr key={`e-${t}`} className="cmp-row-err">
              <th scope="row">{t}</th>
              <td colSpan={shown.length}>Couldn’t load {t} — {e.message}</td>
            </tr>
          ))}
          {/* A row the server declined to build. It keeps its place in the
              table rather than disappearing, because a company that silently
              is not there looks identical to one you forgot to add. */}
          {failures.map((f) => (
            <tr key={`f-${f.ticker}`} className="cmp-row-err">
              <th scope="row">{f.ticker}</th>
              <td colSpan={shown.length}>
                <b>{f.ticker}</b> {FAILURE[f.code] || f.detail || 'could not be loaded'}
                {f.code === 'NOT_FOUND' && <> — check the spelling; class shares take a dot or dash, as in BRK.B</>}
              </td>
            </tr>
          ))}
          {!sorted.length && !pending.size && !errors.size && !failures.length && (
            <tr><td colSpan={shown.length + 1} className="tbl-empty">
              Pick a company above to start a comparison.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* A row whose numbers are materially older than the rest of the table. TSM is
   the live case: SEC's companyfacts holds no FY2025 financials for it, so its
   row is CY2024 sitting beside CY2026Q1 peers. The `A` badge says the basis is
   annual, which is true and not the point — the point is the vintage. */
function StaleMark({ row, rows }) {
  const year = (f) => Number(String(f || '').slice(2, 6)) || null;
  const mine = year(row.frame);
  const newest = Math.max(...rows.map((r) => year(r.frame) || 0));
  if (!mine || !newest || newest - mine < 1) return null;
  return (
    <span className="cmp-stale"
          title={`These figures are from ${mine}; the newest in this table are from ${newest}. SEC's XBRL holds nothing more recent for this issuer.`}>
      {mine}
    </span>
  );
}

function Cell({ metric, row, col, showRanks, onSelect, selected }) {
  const v = row.values?.[metric.id];
  const isSel = selected?.kind === 'metric'
    && selected.ticker === row.ticker && selected.metric?.id === metric.id;

  /* Every cell is selectable, INCLUDING the empty ones. "Why is Intel's P/E
     blank?" is the question the inspector most needs to answer, and a cell that
     only responds when it has a number cannot answer it. */
  /* ƒ: the value was COMPUTED here by a stated deterministic formula because
     the standard filed read was empty — an identity, a tag substitution, a
     zero-debt inference or an annual-frame fallback. The formula travels in
     `derived` and shows in the title and the inspector. */
  const drv = row.derived?.[metric.id] || null;

  const pick = () => onSelect?.({
    kind: 'metric', ticker: row.ticker, metric, frame: row.frame,
    basis: row.basis, value: typeof v === 'number' ? v : null,
    display: v === 'na' ? 'not applicable' : (v == null || !Number.isFinite(v)) ? 'not reported' : fmtMetric(metric, v),
    /* "not reported" is an answer for the inspector, not a figure — the pin
       affordance must not offer to freeze it into the report. */
    pinnable: typeof v === 'number' && Number.isFinite(v),
    note: row.notes?.[metric.id] || null, derived: drv, row,
  });
  const sel = (cls) => (cls + (isSel ? ' is-sel' : ''));

  // Three states, distinguished by glyph and weight rather than colour alone —
  // the same reasoning as base.css:714-729, where five calendar categories each
  // carry a shape because five hues cannot clear the separation floor in dark.
  if (v === 'na') {
    return <td className={sel('cmp-cell is-na')} onClick={pick}
               title={row.notes?.[metric.id] || `Not applicable for this issuer type`}>n/a</td>;
  }
  if (v == null || !Number.isFinite(v)) {
    return <td className={sel('cmp-cell is-missing')} onClick={pick}
               title={(row.notes?.[metric.id] || `Not reported for ${row.frame}`) + ' · click for sources'}>—</td>;
  }

  const p = percentileRank(v, col.vals);
  // null means "no opinion": scale metrics get no shading at all.
  const signed = metric.higherIsBetter === true ? (p == null ? 0 : p - 0.5)
    : metric.higherIsBetter === false ? (p == null ? 0 : 0.5 - p)
      : 0;
  // Capped at 0.22 — the generalisation of insider.css:163's 18% tint. Above
  // that the number starts fighting its own cell.
  const alpha = Math.min(0.22, Math.abs(signed) * 0.44);
  const rank = col.ranks[row.ticker];

  return (
    <td className={sel('cmp-cell ' + (signed > 0 ? 'is-better' : signed < 0 ? 'is-worse' : 'is-mid')
          + (drv ? ' is-drv' : ''))}
        style={{ '--a': alpha }}
        onClick={pick}
        title={`${metric.label} · ${row.ticker} · ${row.frame}`
          + (rank ? ` · rank ${rank} of ${col.vals.length}` : '')
          + ` · ${metric.basis}`
          + (drv ? ` · ƒ computed here: ${drv}` : '')
          + ` · click for sources`}>
      {showRanks ? (rank ?? '—') : fmtMetric(metric, v)}
      {drv && !showRanks ? <sup className="cmp-drv" aria-label="computed here by formula">ƒ</sup> : null}
    </td>
  );
}

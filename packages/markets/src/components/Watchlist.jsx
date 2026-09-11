import { useMemo, useState } from 'react';
import { WATCHLIST, fmtNum, lastChange, sliceByTf } from '@markets/shell/lib/series.js';
import { useSeries } from '@markets/shell/lib/useSeries.js';
import { useApp } from '@markets/shell/lib/store.jsx';
import { Panel } from '@markets/shell/components/Panel.jsx';
import { Sparkline } from './Sparkline.jsx';

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function Row({ s, idx, selected, onPick, nonce }) {
  const { data, error } = useSeries(s.curve ? null : s.id, nonce);
  const ch = data ? lastChange(s, data) : null;
  const spark = data ? sliceByTf(data, '1Y') : null;

  return (
    <div className={'wl-row' + (selected ? ' is-sel' : '') + (error ? ' is-err' : '')}
         role="option" aria-selected={selected} tabIndex={0}
         onClick={() => onPick(s.id)}
         onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(s.id); } }}>
      <span className="wl-idx">{idx}</span>
      <span className="wl-name">
        <span className="wl-sym">{s.curve ? 'CURVE' : s.id}</span>
        <span className="wl-desc">{s.name}</span>
      </span>
      <span className="wl-val">
        {s.curve ? '3M–30Y' : error ? 'no data' : data
          ? fmtNum(data.values[data.values.length - 1], s.dec ?? 2, s.prefix || '', s.suffix || '')
          : '…'}
      </span>
      <span className={'wl-chg ' + (ch ? ch.dir : 'flat')}>{s.curve ? '' : ch ? ch.pctStr : ''}</span>
      {spark
        ? <Sparkline dates={spark.dates} values={spark.values}
                     color={ch && ch.dir === 'down' ? cssVar('--down') : cssVar('--up')} />
        : <span className="wl-spark" />}
    </div>
  );
}

export function Watchlist() {
  const { symbol, selectSymbol, nonce } = useApp();
  const [q, setQ] = useState('');

  // Group headers are derived, so a filter that empties a group hides it too.
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = [];
    WATCHLIST.forEach((s, i) => {
      if (needle && !`${s.id} ${s.name}`.toLowerCase().includes(needle)) return;
      const last = out[out.length - 1];
      if (!last || last.section !== s.section) out.push({ section: s.section, rows: [] });
      out[out.length - 1].rows.push({ s, idx: i + 1 });
    });
    return out;
  }, [q]);

  return (
    <Panel id="pnl-watchlist" swatch="a" title="Watchlist" flush
      tools={<input className="pnl-search" type="text" value={q} placeholder="Filter"
                    aria-label="Filter watchlist" onChange={(e) => setQ(e.target.value)} />}>
      <div className="wl-head">
        <span>#</span><span>Symbol</span><span>Last</span><span>Chg %</span><span />
      </div>
      <div role="listbox" aria-label="Symbols">
        {groups.length === 0 && <div className="tbl-empty">No match.</div>}
        {groups.map((g) => (
          <div key={g.section}>
            <div className="wl-group">{g.section}</div>
            {g.rows.map(({ s, idx }) => (
              <Row key={s.id} s={s} idx={idx} nonce={nonce}
                   selected={s.id === symbol} onPick={selectSymbol} />
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}

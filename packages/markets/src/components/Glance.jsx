import { useEffect, useState } from 'react';
import { rangePosition } from '@markets/shell/lib/series.js';
import { useSeriesSet } from '@markets/shell/lib/useSeries.js';
import { fetchNews } from '@markets/shell/lib/api.js';
import { useApp } from '@markets/shell/lib/store.jsx';
import { Panel } from '@markets/shell/components/Panel.jsx';

const NEED = ['DFF','DGS3MO','DGS2','DGS10','DGS30','T10Y2Y','SP500','VIXCLS','CPIAUCSL',
              'UNRATE','DTWEXBGS','BAMLC0A0CM','BAMLH0A0HYM2','DCOILWTICO'];

/* Narrative + eight metrics. Every figure is a live link that loads that series
   into the main chart, so the panel is a control surface, not just a readout. */
export function Glance() {
  const { symbol, selectSymbol, nonce } = useApp();
  const { got, loading } = useSeriesSet(NEED, nonce);
  const [news, setNews] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchNews().then((j) => alive && setNews(j.items || [])).catch(() => alive && setNews([]));
    return () => { alive = false; };
  }, [nonce]);

  const last = (id) => (got[id] ? got[id].values[got[id].values.length - 1] : null);
  const ago = (id, n) => { const v = got[id]?.values; return v && v.length > n ? v[v.length - 1 - n] : null; };
  const rng = (id) => { try { return got[id] ? rangePosition(got[id]) : null; } catch { return null; } };

  let cpiYoY = null;
  if (got.CPIAUCSL) { const v = got.CPIAUCSL.values, L = v.length - 1; if (L >= 12) cpiYoY = (v[L] / v[L - 12] - 1) * 100; }
  const d = {
    fed: last('DFF'), dgs10: last('DGS10'), curve: last('T10Y2Y'), sp: last('SP500'),
    vix: last('VIXCLS'), unrate: last('UNRATE'), dollar: last('DTWEXBGS'),
    ig: last('BAMLC0A0CM'), hy: last('BAMLH0A0HYM2'), wti: last('DCOILWTICO'), cpiYoY,
    spPct: got.SP500 ? (got.SP500.values[got.SP500.values.length - 1] / got.SP500.values[0] - 1) * 100 : null,
    dgs10_1m: ago('DGS10', 21), sp_1m: ago('SP500', 21),
  };
  const S = (x, dec, suf = '') => (x == null ? '—' : x.toFixed(dec) + suf);
  const J = ({ id, children }) => (
    <a className="jump" role="link" tabIndex={0}
       onClick={(e) => { e.preventDefault(); selectSymbol(id); }}
       onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSymbol(id); } }}
    >{children}</a>
  );

  const tiles = [
    { label: 'Fed Funds', target: 'DFF', num: S(d.fed, 2, '%') },
    { label: '10-Yr Treasury', target: 'DGS10', num: S(d.dgs10, 2, '%') },
    { label: '2s10s Curve', target: 'T10Y2Y', num: d.curve == null ? '—' : (d.curve >= 0 ? '+' : '') + S(d.curve, 2) + ' pp',
      delta: d.curve == null ? '' : d.curve < 0 ? 'inverted' : 'normal', dir: d.curve < 0 ? 'down' : 'up' },
    { label: 'S&P 500', target: 'SP500', num: d.sp == null ? '—' : Math.round(d.sp).toLocaleString('en-US'),
      delta: d.spPct == null ? '' : (d.spPct >= 0 ? '+' : '') + d.spPct.toFixed(0) + '% since ’23', dir: d.spPct >= 0 ? 'up' : 'down' },
    { label: 'VIX', target: 'VIXCLS', num: S(d.vix, 1) },
    { label: 'CPI YoY', target: 'CPIAUCSL', num: S(d.cpiYoY, 1, '%') },
    { label: 'Unemployment', target: 'UNRATE', num: S(d.unrate, 1, '%') },
    { label: 'Broad Dollar', target: 'DTWEXBGS', num: S(d.dollar, 1) },
  ];

  const bp = d.dgs10_1m != null && d.dgs10 != null ? Math.round((d.dgs10 - d.dgs10_1m) * 100) : null;
  const spm = d.sp_1m != null && d.sp != null ? (d.sp / d.sp_1m - 1) * 100 : null;
  const headlines = (news || []).filter((i) => i.themes?.some((t) => t !== 'Markets')).slice(0, 4);

  return (
    <Panel id="pnl-glance" swatch="c" title="At a glance" compact>
      {loading ? <p className="read muted">Reading the tape…</p> : (
        <p className="read">
          {d.curve != null && d.dgs10 != null && <>
            With fed funds at <J id="DFF">{S(d.fed, 2, '%')}</J>, the Treasury curve is{' '}
            <strong>{d.curve < 0 ? 'inverted' : 'upward sloping'}</strong> (2s10s{' '}
            <J id="T10Y2Y">{(d.curve >= 0 ? '+' : '') + S(d.curve, 2)} pp</J>) and the 10Y sits at{' '}
            <J id="DGS10">{S(d.dgs10, 2, '%')}</J>
            {bp != null && bp !== 0 && <>, {bp > 0 ? 'up' : 'down'} <J id="DGS10">{Math.abs(bp)}bp</J> over the past month</>}.{' '}
          </>}
          {d.sp != null && d.vix != null && <>
            Equities are <J id="SP500">{d.spPct >= 0 ? `up ${d.spPct.toFixed(0)}%` : `down ${Math.abs(d.spPct).toFixed(0)}%`} since 2023</J>
            {spm != null && <> (<J id="SP500">{(spm >= 0 ? '+' : '') + spm.toFixed(1)}% on the month</J>)</>} against a VIX of{' '}
            <J id="VIXCLS">{S(d.vix, 1)}</J>.{' '}
          </>}
          {d.cpiYoY != null && d.unrate != null && <>
            Inflation is <J id="CPIAUCSL">{S(d.cpiYoY, 1, '%')}</J> YoY while unemployment holds at{' '}
            <J id="UNRATE">{S(d.unrate, 1, '%')}</J>.{' '}
          </>}
          {d.ig != null && d.hy != null && <>
            Credit spreads sit at <J id="BAMLC0A0CM">IG {S(d.ig, 2, '%')}</J> and{' '}
            <J id="BAMLH0A0HYM2">HY {S(d.hy, 2, '%')}</J>
            {d.wti != null && <>, with WTI near <J id="DCOILWTICO">${S(d.wti, 0)}</J></>}.
          </>}
        </p>
      )}

      <div className="tiles">
        {tiles.map((t) => {
          const r = rng(t.target);
          return (
            <a key={t.label} className={'stat jump' + (t.target === symbol ? ' is-sel' : '')}
               role="link" tabIndex={0}
               onClick={(e) => { e.preventDefault(); selectSymbol(t.target); }}
               onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSymbol(t.target); } }}>
              <span className="label">{t.label}</span>
              <span className="num">{t.num}</span>
              <span className={'delta ' + (t.dir || 'flat')}>{t.delta || ''}</span>
              <span className="stat-bar" title={r == null ? undefined : `${r}% of its 2023-to-now range`}>
                {r != null && <i style={{ width: r + '%' }} />}
              </span>
            </a>
          );
        })}
      </div>

      <div className="kicker sum-news-kicker">In the news</div>
      <div className="sum-news">
        {news === null && <span className="muted small">Loading headlines…</span>}
        {headlines.map((it) => (
          <a key={it.link} className="sum-news-item" href={/^https?:\/\//.test(it.link) ? it.link : '#'}
             target="_blank" rel="noopener noreferrer">
            <span className="src">{it.source}</span>
            <span className="ntag">{it.themes?.[0]}</span>
            <span className="sum-news-title">{it.title}</span>
          </a>
        ))}
      </div>
    </Panel>
  );
}

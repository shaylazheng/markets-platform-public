import { useRef } from 'react';
import { SERIES_META, fmtNum, sliceByTf, windowChange } from '@markets/shell/lib/series.js';
import { useSeries } from '@markets/shell/lib/useSeries.js';
import { useApp } from '@markets/shell/lib/store.jsx';
import { useLineChart } from '../useChart.js';
import { Panel } from '@markets/shell/components/Panel.jsx';
import { TimeframeRow } from './TimeframeRow.jsx';

const FEATURED_ID = 'SP500';
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* The standing index readout — axis-free by design; the main chart is where
   values get read. */
export function FeaturedPanel() {
  const { featuredTf, setFeaturedTf, nonce } = useApp();
  const s = SERIES_META[FEATURED_ID];
  const { data, error } = useSeries(FEATURED_ID, nonce);
  const ref = useRef(null);

  const sliced = data ? sliceByTf(data, featuredTf) : null;
  const ch = sliced ? windowChange(s, sliced) : null;
  useLineChart(ref, {
    dates: sliced?.dates, values: sliced?.values, variant: 'spark',
    color: ch && ch.dir === 'down' ? cssVar('--down') : cssVar('--up'),
    deps: [featuredTf],
  });

  return (
    <Panel id="pnl-featured" swatch="a" title={s.name}
           tools={<span className="pnl-id">{s.id}</span>}>
      <div id="featured-body" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="big-read">
          <div className="big-val">
            {error ? '—' : data ? fmtNum(data.values[data.values.length - 1], s.dec ?? 2, s.prefix || '', s.suffix || '') : '—'}
          </div>
          <div className={'big-chg ' + (ch ? ch.dir : 'flat')}>
            {error ? `Couldn’t load: ${error.message}` : ch ? `${ch.netStr} (${ch.pctStr}) ${featuredTf}` : ''}
          </div>
        </div>
        <div className="spark-wrap"><canvas ref={ref} /></div>
        <TimeframeRow value={featuredTf} onChange={setFeaturedTf} />
      </div>
    </Panel>
  );
}

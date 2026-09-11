/* The volatility-news board: which stocks the small press is converging on.
 *
 * Rendered twice from the same `detail` — as the strip across the top of the
 * Monitor (HeatHeader) and as the source's own body when its box is opened
 * (HeatBody, registered under detail.kind === 'heat'). The header is the one
 * place the Monitor shows a source's material outside that source's box, and
 * it is keyed on the detail KIND, never on a source id: any source returning
 * kind 'heat' would land here, and a source that stops returning it simply
 * takes the strip with it.
 *
 * Thin payloads render. `rows` missing is "quiet"; `feeds` or `names`
 * missing is a shorter status line. Nothing here throws on an absent field —
 * the render check feeds it exactly those shapes.
 */
import { Panel } from '@markets/shell/components/Panel.jsx';
import { fmtTime, ago } from './SourcePanel.jsx';

const MKT = { KR: 'KRX', TW: 'TWSE', US: 'US' };
const HARD = new Set(['limit-up', 'limit-down', 'halt', 'inquiry', 'short-report', 'delist', 'bankrupt']);
const fmtMove = (p) => (p == null ? '' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p * 100).toFixed(1)}%`);
const dirOf = (p) => (p == null ? 'flat' : p < 0 ? 'down' : p > 0 ? 'up' : 'flat');

function Head() {
  return (
    <div className="vn-head">
      <span>Stock</span><span>Heat</span><span>Outlets</span><span>Move</span><span>Why</span><span>Age</span><span>Latest</span>
    </div>
  );
}

function Row({ r, now, max }) {
  const w = max ? Math.max(4, Math.round((r.heat / max) * 100)) : 0;
  const h = r.headline || {};
  const tags = r.tags || [];
  return (
    <div className={'vn-row' + (r.fires ? ' is-hot' : '')}>
      <span className="vn-name">
        <span className="vn-sym" title={r.key}>{r.name || r.code}</span>
        <span className="vn-code">{r.code} · {MKT[r.market] || r.market}</span>
      </span>
      <span className="vn-heat" title={`heat ${r.heat} — ${r.fires ? 'qualifies to fire' : 'below the firing rule'}`}>
        <span className="vn-bar" style={{ width: `${w}%` }} aria-hidden="true" />
        <span style={{ position: 'relative' }}>{Number(r.heat || 0).toFixed(1)}</span>
      </span>
      <span className="vn-x" title={`${r.stories ?? 0} distinct stories from ${r.outlets ?? 0} outlets, ${r.small ?? 0} of them small`}>
        {r.outlets ?? 0}<i>/{r.small ?? 0} small</i>
      </span>
      <span className={'vn-move ' + dirOf(r.pct)} title={r.pctAsOf ? `as of ${r.pctAsOf}` : 'no free print for this market'}>{fmtMove(r.pct)}</span>
      <span className="vn-tags">
        {tags.slice(0, 3).map((t) => <span key={t} className={'vn-tag' + (HARD.has(t) ? ' is-hard' : '')}>{t}</span>)}
      </span>
      <span className="vn-when" title={r.firstAt ? `first seen ${fmtTime(r.firstAt)} ET` : ''}>{ago(r.lastAt, now)}</span>
      <a className="vn-head-link" href={h.link || '#'} target="_blank" rel="noreferrer" title={h.title || ''}>
        {h.outlet && <b className={h.small ? 'is-small' : ''}>{h.outlet}</b>}{h.title || ''}
      </a>
    </div>
  );
}

/** The status line: feeds up, the size of the name index, how long the
 *  analysis took. Short, because it sits in a panel head. */
export function heatStatus(detail = {}) {
  const f = detail.feeds || {};
  const n = detail.names || {};
  const parts = [];
  if (f.up != null) parts.push(`${f.up}/${(f.up || 0) + (f.down || 0)} feeds`);
  if (n.kr || n.tw) parts.push(`names KR ${(n.kr || 0).toLocaleString('en-US')} · TW ${(n.tw || 0).toLocaleString('en-US')}`);
  if (detail.analysisMs != null) parts.push(`analysis ${detail.analysisMs}ms`);
  return parts.join(' · ');
}

function Rows({ detail, now, limit }) {
  const rows = (detail.rows || []).slice(0, limit);
  if (!rows.length) {
    return <div className="vn-empty">quiet — nothing corroborated in the last {detail.windowMin || 90} min</div>;
  }
  const max = Math.max(...rows.map((r) => r.heat || 0));
  return (
    <>
      <Head />
      {rows.map((r) => <Row key={r.key || r.code} r={r} now={now} max={max} />)}
    </>
  );
}

/** The source's own body, under its box. Everything the header shows plus
 *  the feeds that failed, because that is where you go to ask why a name is
 *  missing. */
const LANE_LABEL = { direct: 'small outlets, read directly', wire: 'wires', discovery: 'Google News discovery' };

/** Every feed the source reads, by lane, with what the last poll got from it. */
function Roster({ list }) {
  if (!list?.length) return null;
  const lanes = ['direct', 'wire', 'discovery'].filter((l) => list.some((f) => f.lane === l));
  return (
    <div className="vn-roster">
      {lanes.map((lane) => (
        <div key={lane} className="vn-lane">
          <i>{LANE_LABEL[lane] || lane}</i>
          {list.filter((f) => f.lane === lane).map((f) => (
            <span key={f.name} className={'vn-feed' + (f.ok ? '' : ' is-down')}
                  title={f.ok ? `${f.n} items · ${f.ms}ms` : f.error}>
              {f.name}{f.ok ? <b>{f.n}</b> : <b>✕</b>}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function HeatBody({ detail = {} }) {
  const now = Date.now();
  const f = detail.feeds || {};
  return (
    <div className="al-body">
      <Rows detail={detail} now={now} limit={12} />
      <Roster list={f.list} />
      <div className="vn-foot">
        <span><i>window</i> {detail.windowMin || 90} min</span>
        {detail.minHeat != null && <span><i>fires at</i> heat ≥ {detail.minHeat}</span>}
        {detail.itemsRead != null && <span><i>read</i> {Number(detail.itemsRead).toLocaleString('en-US')} items</span>}
        {f.ms != null && <span><i>fetch</i> {(f.ms / 1000).toFixed(1)}s</span>}
        {detail.names?.loadedAt && <span><i>names</i> {detail.names.loadedAt.slice(0, 16).replace('T', ' ')}</span>}
        {(f.failed || []).map((x) => <span key={x} className="down">{x}</span>)}
        {Object.entries(detail.names?.errors || {}).map(([k, v]) => <span key={k} className="down">names {k}: {v}</span>)}
      </div>
    </div>
  );
}

/** The strip across the top of the Monitor. `source` is the envelope of
 *  whichever source returned kind 'heat'. */
export function HeatHeader({ source, now = Date.now() }) {
  if (!source) return null;
  const detail = source.detail || {};
  const src = source.source || {};
  const status = heatStatus(detail);
  return (
    <Panel id="pnl-al-board" swatch="d" title={source.title || 'Volatility news'} flush
      headExtra={
        <span className="vn-status" title={source.rule || ''}>
          {src.errors ? <span className="down">{src.errors} err · </span> : null}
          {status}{status && src.lastOk ? ' · ' : ''}{src.lastOk ? `polled ${ago(src.lastOk, now)} ago` : ''}
        </span>
      }>
      <Rows detail={detail} now={now} limit={6} />
    </Panel>
  );
}

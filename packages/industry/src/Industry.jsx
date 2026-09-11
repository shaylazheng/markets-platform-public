/* Industry — the Company subtab between Management and Competitors.
 *
 * WHAT IT ANSWERS. "What industry is this company in, who else is in it, and
 * how does its measured revenue sit among them" — the zoom level between
 * Management (the people inside one company) and Competitors (a hand-picked
 * peer table compared ratio by ratio). This surface is the WIDE shot: the
 * whole SEC-registered population under the company's own filed industry
 * code, not a curated peer set.
 *
 * EVERY LINE IS A PUBLIC DOCUMENT. The code and its description come from the
 * registrant's submissions record, the membership from browse-edgar's listing
 * under the code, the measures from the XBRL calendar frames — and the private
 * side from the other free federal sources: BLS's QCEW and Census's Economic
 * Census for the whole population (bridged over the committed SIC→NAICS
 * concordance chain), SEC's Form D data sets for private capital raising. No
 * vendor classification, no model prose — which is what lets every line carry
 * a src button that opens the actual document, the same affordance Summary
 * uses.
 *
 * WHAT IT REFUSES TO DO mirrors the route (industry.js): no market shares, no
 * rank for a company the frame did not measure, no renaming SEC's own
 * industry description. The absences panel states each refusal with the
 * reason, in the house style — an em dash would not distinguish "not
 * disclosed" from "not comparable".
 */
import { useEffect, useState } from 'react';
import { Panel } from '@markets/shell/components/Panel.jsx';
import { CompanyRail } from '@markets/shell/components/CompanyRail.jsx';
import { SourceInspector, SrcButton } from '@markets/shell/components/SourceInspector.jsx';
import { useApp } from '@markets/shell/lib/store.jsx';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';
import { hashView } from '@markets/shell/lib/hash.js';
import { defaultRows, describe, fmtMoney, fmtPct, sourcesFor } from './industrySources.js';

/* ---- fetch, cached per ticker like companySummary.js -------------------- */

const cache = new Map();                // ticker -> promise of the payload
const MAX = 40;

export function fetchIndustry(ticker) {
  const t = String(ticker || '').trim().toUpperCase();
  if (!t) return Promise.resolve(null);
  if (!cache.has(t)) {
    const p = fetch(`/api/industry?ticker=${encodeURIComponent(t)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return j;
      })
      .catch((e) => { cache.delete(t); throw e; });
    if (cache.size >= MAX) cache.delete(cache.keys().next().value);
    cache.set(t, p);
  }
  return cache.get(t);
}

function useIndustry(ticker) {
  const [state, setState] = useState({ data: null, loading: !!ticker, error: null });
  useEffect(() => {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) { setState({ data: null, loading: false, error: null }); return undefined; }
    let live = true;
    setState((s) => ({ data: s.data, loading: true, error: null }));
    fetchIndustry(t)
      .then((data) => { if (live) setState({ data, loading: false, error: null }); })
      .catch((e) => { if (live) setState({ data: null, loading: false, error: e.message }); });
    return () => { live = false; };
  }, [ticker]);
  return state;
}

/* Which documents back each selection is decided in industrySources.js, which
   is pure; the rail hosts the shell's SourceInspector, the same panel in the
   same place as the rest of the Company group. */

/* ---- charts --------------------------------------------------------------- *
 *
 * Hand-rolled from the theme's own tokens, not a chart library: every fill is
 * a var(), so the charts follow the theme the way the tables do. The
 * categorical order is bloom's fixed five (validated for CVD separation and
 * contrast on both surfaces; the light-mode green's low contrast is relieved
 * by the direct labels every segment carries, and the dark-mode CVD floor
 * band by the 2px surface gaps between fills).
 */
const CAT = ['var(--cat-econ)', 'var(--cat-fed)', 'var(--cat-market)',
  'var(--cat-earnings)', 'var(--cat-energy)'];

/** The ƒ marker — a value COMPUTED here by a stated deterministic formula
 *  because the standard filed read was empty. Never an estimate: an accounting
 *  identity, a tag substitution, or the company's own filing aligned to the
 *  frame year. The title carries the formula; the src button beside the row
 *  opens the full derivation. */
function Drv({ children, note }) {
  return (
    <span className="ind-drv" title={note ? `ƒ computed here: ${note}` : 'ƒ computed here'}>
      {children}<sup aria-label="computed here by formula">ƒ</sup>
    </span>
  );
}

/** A net-margin cell, ƒ-marked when the income figure came from a
 *  substituted tag rather than the parent-only NetIncomeLoss. */
function MarginCell({ m }) {
  if (m.netMargin == null) return '—';
  const v = fmtPct(m.netMargin);
  return m.niTag && m.niTag !== 'NetIncomeLoss'
    ? <Drv note={`net income read from ${m.niTag} (incl. noncontrolling interests)`}>{v}</Drv>
    : v;
}

/** Who holds the measured revenue: one stacked share bar, top five named,
 *  the rest folded into a neutral "other" — never a sixth hue. */
function ShareBar({ top, measures }) {
  const five = top.filter((m) => m.rank <= 5).slice(0, 5);
  if (!five.length || !measures?.totalRevenue) return null;
  const rest = Math.max(0, 1 - five.reduce((s, m) => s + (m.share || 0), 0));
  const segs = [
    ...five.map((m, i) => ({ key: m.ticker, label: m.ticker, share: m.share || 0,
      color: CAT[i], isSelf: m.isSelf,
      tip: `${m.name || m.ticker} — ${fmtPct(m.share)} of measured revenue` })),
    { key: '__rest', label: `other ${Math.max(0, (measures.measuredCount || 0) - five.length)}`,
      share: rest, color: 'var(--ink-fainter)',
      tip: `The remaining measured members together — ${fmtPct(rest)}` },
  ].filter((s) => s.share > 0.001);
  return (
    <div className="ind-sharebar" role="img"
         aria-label="Share of measured revenue, largest five members and the rest">
      <div className="ind-sharebar-track">
        {segs.map((s) => (
          <span key={s.key} className="ind-sharebar-seg" title={s.tip}
                style={{ flexGrow: s.share, background: s.color }} />
        ))}
      </div>
      <div className="ind-sharebar-legend">
        {segs.map((s) => (
          <span key={s.key} className="ind-sharebar-key" title={s.tip}>
            <i style={{ background: s.color }} />
            {s.isSelf ? <b>{s.label}</b> : s.label} {fmtPct(s.share, 0)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A metric row's distribution as a range-dot: P25–P75 band, median tick,
 *  the company as an accent dot. Scaled to ITS OWN row — position reads as
 *  "where in the band", never across rows. */
function RangeDot({ row }) {
  const vals = [row.p25, row.p75, row.median, row.self].filter(Number.isFinite);
  if (vals.length < 3) return null;
  const lo = Math.min(...vals); const hi = Math.max(...vals);
  const span = (hi - lo) || 1;
  const pad = span * 0.08;
  const x = (v) => `${(((v - (lo - pad)) / (span + pad * 2)) * 100).toFixed(1)}%`;
  const w = (a, b) => `${(((b - a) / (span + pad * 2)) * 100).toFixed(1)}%`;
  return (
    <span className="ind-range" aria-hidden="true">
      <span className="ind-range-band" style={{ left: x(row.p25), width: w(row.p25, row.p75) }} />
      <span className="ind-range-med" style={{ left: x(row.median) }} />
      {Number.isFinite(row.self) && (
        <span className="ind-range-dot" style={{ left: x(row.self) }} />
      )}
    </span>
  );
}

/* SVG geometry shared by the two history charts. */
const HC = { W: 320, H: 150, L: 8, R: 8, TOP: 18, BOT: 20 };

/** Measured revenue per frame as stacked columns — the company's slice at the
 *  baseline in accent, the rest of the membership in neutral above it. */
function HistoryColumns({ hist, ticker }) {
  const { W, H, L, R, TOP, BOT } = HC;
  const max = Math.max(...hist.map((h) => h.totalRevenue || 0), 1);
  const plotH = H - TOP - BOT;
  const slot = (W - L - R) / hist.length;
  const bw = Math.min(36, slot * 0.62);
  return (
    <svg className="ind-chart" viewBox={`0 0 ${W} ${H}`}
         role="img" aria-label={`Measured revenue per frame, ${ticker} against the rest`}>
      {hist.map((h, i) => {
        const cx = L + slot * i + slot / 2;
        const total = h.totalRevenue || 0;
        const selfV = h.selfRevenue || 0;
        const th = (total / max) * plotH;
        const sh = (selfV / max) * plotH;
        const base = H - BOT;
        const gap = sh > 0 && th - sh > 3 ? 2 : 0;    // 2px surface gap between fills
        const year = h.period.replace(/^CY/, '');
        const label = i === 0 || i === hist.length - 1;
        return (
          <g key={h.period}>
            <title>
              {`${h.period} — ${fmtMoney(total)} measured over ${h.measuredCount} members`
                + (h.selfRevenue != null
                  ? `; ${ticker} ${fmtMoney(h.selfRevenue)} (${fmtPct(h.selfShare)})`
                  : `; ${ticker} not measured this frame`)}
            </title>
            {th - sh - gap > 0 && (
              <rect x={cx - bw / 2} y={base - th} width={bw} height={th - sh - gap}
                    rx="2" fill="var(--ink-fainter)" />
            )}
            {sh > 0 && (
              <rect x={cx - bw / 2} y={base - sh} width={bw} height={sh}
                    rx={sh > 4 ? 2 : 0} fill="var(--accent)" />
            )}
            <text x={cx} y={H - 6} textAnchor="middle" className="ind-chart-t">{year}</text>
            {label && (
              <text x={cx} y={base - th - 5} textAnchor="middle" className="ind-chart-t">
                {fmtMoney(total)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Median net margin per frame — one line, its own axis, its own chart:
 *  a margin shares no scale with a dollar total, and a second y-axis is how
 *  charts lie. */
function HistoryMarginLine({ hist }) {
  const { W, H, L, R, TOP, BOT } = HC;
  const pts = hist.filter((h) => Number.isFinite(h.medianNetMargin));
  if (pts.length < 2) return null;
  const vals = pts.map((h) => h.medianNetMargin);
  const lo = Math.min(...vals, 0); const hi = Math.max(...vals, 0);
  const span = (hi - lo) || 1;
  const plotH = H - TOP - BOT;
  const slot = (W - L - R) / hist.length;
  const xOf = (i) => L + slot * i + slot / 2;
  const yOf = (v) => TOP + (1 - (v - lo) / span) * plotH;
  const line = pts.map((h) => `${xOf(hist.indexOf(h)).toFixed(1)},${yOf(h.medianNetMargin).toFixed(1)}`).join(' ');
  return (
    <svg className="ind-chart" viewBox={`0 0 ${W} ${H}`}
         role="img" aria-label="Median net margin per frame">
      {lo < 0 && hi > 0 && (
        <>
          <line x1={L} x2={W - R} y1={yOf(0)} y2={yOf(0)} className="ind-chart-zero" />
          <text x={W - R} y={yOf(0) - 4} textAnchor="end" className="ind-chart-t">0</text>
        </>
      )}
      <polyline points={line} fill="none" stroke="var(--cat-market)" strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((h, i) => (
        <g key={h.period}>
          <title>{`${h.period} — median net margin ${fmtPct(h.medianNetMargin)}`}</title>
          <circle cx={xOf(hist.indexOf(h))} cy={yOf(h.medianNetMargin)} r="4"
                  fill="var(--cat-market)" stroke="var(--panel)" strokeWidth="2" />
          {(i === 0 || i === pts.length - 1) && (
            <text x={xOf(hist.indexOf(h))} y={yOf(h.medianNetMargin) - 9}
                  textAnchor="middle" className="ind-chart-t">
              {fmtPct(h.medianNetMargin)}
            </text>
          )}
        </g>
      ))}
      {hist.map((h, i) => (
        <text key={h.period} x={xOf(i)} y={H - 6} textAnchor="middle" className="ind-chart-t">
          {h.period.replace(/^CY/, '')}
        </text>
      ))}
    </svg>
  );
}

/** Buys against sells on one shared dollar scale — the polarity pair, not
 *  categorical hues. */
function PulseBars({ buys, sells }) {
  const max = Math.max(buys.total, sells.total, 1);
  const rows = [
    { label: 'Bought', v: buys.total, n: buys.companies, tone: 'var(--up)' },
    { label: 'Sold', v: sells.total, n: sells.companies, tone: 'var(--down)' },
  ];
  return (
    <ul className="ind-buckets ind-pulsebars">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label} ${fmtMoney(r.v)} across ${r.n} compan${r.n === 1 ? 'y' : 'ies'}`}>
          <span className="ind-bucket-k">{r.label}</span>
          <span className="ind-bucket-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(1, Math.round((r.v / max) * 100))}%`, background: r.tone }} />
          </span>
          <span className="ind-bucket-n ind-pulse-n">{fmtMoney(r.v)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * @param {object} [injected]  a payload, for the render checks — the same
 *   escape hatch Summary / Book / Valuation use.
 */
export function Industry({ injected = null }) {
  const { company: ticker, setCompany: setTicker } = useApp();
  const live = useIndustry(injected ? '' : ticker);
  const { data, loading, error } = injected
    ? { data: injected, loading: false, error: null }
    : live;

  useBootGate('industry', !!data || !!error || !ticker, { what: 'the industry summary' });

  useEffect(() => {
    if (injected || hashView() !== 'industry') return;
    history.replaceState(null, '', `#industry&ticker=${encodeURIComponent(ticker || '')}`);
  }, [ticker, injected]);

  const d = data || {};
  const identity = d.identity || {};
  const cls = d.classification || null;
  const membership = d.membership || null;
  const measures = d.measures || null;
  const agg = d.aggregates || null;
  const self = d.self || null;
  const sd = d.selfDerived || null;
  const top = d.top || [];
  const conc = d.concentration || null;
  const metrics = d.metrics || [];
  const sizes = d.sizes || [];
  /* NOT `history` — that name shadows window.history, and the hash-writing
     effect below calls history.replaceState. Shadowing it with a payload
     field turned the whole surface into a black page. */
  const hist = d.history || null;
  const insider = d.insider || null;
  const unlisted = d.unlisted || null;
  const priv = d.privateSide || null;
  const hier = cls?.hierarchy || null;
  const absences = Object.entries(d.absent || {}).filter(([, v]) => String(v ?? '').trim());

  /* One selection for the whole surface, cleared when the company — or its
     freshly-arrived payload — changes: a selection describing the old
     company's row would otherwise sit there looking current. */
  const [sel, setSel] = useState(null);
  useEffect(() => { setSel(null); }, [ticker, data]);

  const btn = (s) => <SrcButton sel={s} current={sel} onSelect={setSel} />;

  /* The rail is structural and outlives every error state, like every other
     Company surface — a bad ticker must still leave a box to fix it in. */
  /* Exactly three facts — .co-facts is a three-column grid that paints its
     seams on the container, so a count that leaves an empty track renders a
     blank tile (the documented hazard). The SIC code is not a fourth: it is
     already the rail's sub line and the classification panel's headline. */
  const railFacts = [];
  if (membership) {
    railFacts.push({ label: 'Members', value: membership.listedCount,
      sub: `${membership.registrants}${membership.truncated ? '+' : ''} registrants`,
      title: 'Registrants under the code that are in SEC\'s ticker map, i.e. currently listed' });
  }
  if (measures) {
    railFacts.push({ label: 'Rank', value: self ? `#${self.rank}` : sd ? `≈#${sd.rank}ƒ` : '—',
      sub: sd && !self ? 'computed here' : `of ${measures.measuredCount} measured`,
      title: self ? 'Rank by revenue on the calendar frame'
        : sd ? `ƒ computed here — not frame-measured: ${sd.drv}`
          : 'Not measured on this frame — see the caveats panel' });
    railFacts.push({
      label: 'Share',
      value: self ? fmtPct(self.share) : sd?.share != null ? `≈${fmtPct(sd.share)}ƒ` : '—',
      sub: measures.period,
      title: (sd && !self
        ? 'ƒ computed here: aligned revenue ÷ (measured total + aligned revenue). '
        : '') + 'Share of measured revenue among listed US-GAAP filers on the frame — not a market share' });
  }

  const rail = (
    <CompanyRail
      view="industry"
      ticker={identity.ticker || ticker || ''}
      name={identity.name}
      sub={identity.sicDescription}
      busy={loading}
      facts={railFacts}
      onSubmit={setTicker}
      note={!ticker
        ? 'No company set. Type a ticker — this surface maps the whole industry its '
          + 'SEC filings place it in.'
        : null}
    />
  );

  const shell = (body) => (
    <section className="view is-active ind-surface">
      <div className="ind-railcol">
        {rail}
        {data && !error && (
          <Panel swatch="c" title="Sources" flush>
            <SourceInspector
              sel={sel} onClose={() => setSel(null)}
              d={describe(sel, d)} sources={sourcesFor(sel, d)}
              defaults={defaultRows(d)} />
          </Panel>
        )}
      </div>
      <div className="ind-main">{body}</div>
    </section>
  );

  if (!ticker && !injected) {
    return shell(
      <Panel title="Industry" swatch="a">
        <div className="ind-empty">
          <p><b>Nothing loaded yet.</b></p>
          <p>
            Enter a company in the box on the left. This surface reads the industry code
            SEC stamps on its filings, lists every listed company filing under the same
            code, and places the company in that population by measured revenue — every
            line traced to the SEC document it came from.
          </p>
        </div>
      </Panel>,
    );
  }
  if (error) {
    return shell(
      <Panel title="Industry" swatch="a">
        <div className="ind-empty"><p>{error}</p></div>
      </Panel>,
    );
  }
  if (loading && !data) {
    return shell(
      <Panel title="Industry" swatch="a">
        <div className="ind-empty"><p className="loading">Reading the SEC's industry listing…</p></div>
      </Panel>,
    );
  }
  if (!data) return shell(null);

  return shell(
    <>
      {/* 1 — the classification, from broad to narrow. Four rungs when the
          code list is readable, two (division + code) when it is not — the
          missing rungs are then named in the absences panel, not faked. */}
      {cls && (
        <Panel title="The industry, from broad to narrow" swatch="a"
               headExtra={(
                 <a className="ind-filings" href={cls.filingsHref}
                    target="_blank" rel="noopener noreferrer"
                    title="Every registrant filing under this code, on EDGAR itself">
                   all SIC {cls.sic} registrants on EDGAR
                 </a>
               )}>
          <ol className="ind-ladder">
            {cls.division && (
              <li>
                <span className="ind-rung-k">Division {cls.division.letter}</span>
                <span className="ind-rung-v">
                  {cls.division.label} {btn({ kind: 'division', key: 'division' })}
                </span>
              </li>
            )}
            {hier?.majorGroup && (
              <li>
                <span className="ind-rung-k">Major group {hier.majorGroup.code}</span>
                <span className="ind-rung-v">
                  {hier.majorGroup.title} {btn({ kind: 'majorGroup', key: 'majorGroup' })}
                </span>
              </li>
            )}
            {hier?.industryGroup && (
              <li>
                <span className="ind-rung-k">Industry group {hier.industryGroup.code}</span>
                <span className="ind-rung-v">
                  {hier.industryGroup.codeCount} four-digit code
                  {hier.industryGroup.codeCount === 1 ? '' : 's'} share the prefix
                  {' '}{btn({ kind: 'industryGroup', key: 'industryGroup' })}
                </span>
              </li>
            )}
            <li className="is-code">
              <span className="ind-rung-k">SIC {cls.sic}</span>
              <span className="ind-rung-v">
                <b className="ind-desc">{cls.description || `code ${cls.sic}`}</b>
                {' '}{btn({ kind: 'classification', key: 'classification' })}
                {hier?.office && (
                  <span className="ind-office">
                    filings read by the {hier.office} {btn({ kind: 'office', key: 'office' })}
                  </span>
                )}
              </span>
            </li>
          </ol>
          <p className="ind-foot">
            The Standard Industrial Classification is the code SEC's own staff assign to
            every registrant and print on its filings — the registrant's filed industry,
            not a vendor's opinion of it. Coarse by design: one four-digit code, last
            revised 1987.
          </p>
        </Panel>
      )}

      <div className="ind-band">
        {/* 2 — the population */}
        {membership && (
          <Panel title="Who else files under it" swatch="c"
                 headExtra={(
                   <>
                     <span className="ind-headnote">
                       {membership.listedCount} listed of {membership.registrants}
                       {membership.truncated ? '+' : ''} registrants
                     </span>
                     {btn({ kind: 'membership', key: 'membership' })}
                   </>
                 )}>
            {top.length ? (
              <table className="ind-table">
                <thead>
                  <tr>
                    <th className="ind-num">#</th><th>Company</th>
                    <th className="ind-num">Revenue</th>
                    <th className="ind-num">Net margin</th>
                    <th className="ind-num">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((m) => (
                    <tr key={m.cik} className={m.isSelf ? 'is-self' : undefined}>
                      <td className="ind-num">{m.rank}</td>
                      <td>
                        {m.isSelf ? (
                          <b>{m.ticker}</b>
                        ) : (
                          <button type="button" className="ind-tk"
                                  title={`Look at ${m.ticker}`}
                                  onClick={() => setTicker(m.ticker)}>{m.ticker}</button>
                        )}
                        <span className="ind-name">{m.name}</span>
                        {btn({ kind: 'member', key: `member:${m.cik}`, m })}
                      </td>
                      <td className="ind-num">{fmtMoney(m.revenue)}</td>
                      <td className="ind-num"><MarginCell m={m} /></td>
                      <td className="ind-num">{fmtPct(m.share)}</td>
                    </tr>
                  ))}
                  {!self && sd && (
                    <tr className="is-self">
                      <td className="ind-num">≈{sd.rank}</td>
                      <td>
                        <b>{identity.ticker}</b>
                        <span className="ind-name">{identity.name}</span>
                        {btn({ kind: 'selfDerived', key: 'selfDerived' })}
                      </td>
                      <td className="ind-num"><Drv note={sd.drv}>{fmtMoney(sd.revenue)}</Drv></td>
                      <td className="ind-num">
                        {sd.netMargin == null ? '—' : <Drv note={sd.drv}>{fmtPct(sd.netMargin)}</Drv>}
                      </td>
                      <td className="ind-num">
                        {sd.share == null ? '—'
                          : <Drv note="aligned revenue ÷ (measured total + aligned revenue)">{fmtPct(sd.share)}</Drv>}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <p className="ind-none">
                Members are listed but none could be measured on a calendar frame —
                see the absences above.
              </p>
            )}
            {measures && (
              <p className="ind-foot">
                Largest {Math.min(top.filter((m) => !m.isSelf || m.rank <= 15).length, 15)} by{' '}
                {measures.period} frame revenue
                {self && self.rank > 15 ? `, plus ${identity.ticker} at its actual rank` : ''}
                {!self && sd ? `, plus ${identity.ticker}'s ƒ line where it would slot` : ''}.
                Shares are of measured revenue among the {measures.measuredCount} members the
                frame can see — not market shares. A value marked{' '}
                <span className="ind-drv" title="computed here by a stated formula">ƒ</span> was
                computed here by a stated formula because the standard filed read was empty —
                hover it for the formula, press src for the derivation.
              </p>
            )}
            {unlisted && (
              <>
                <h4 className="ind-sh">
                  Filing but not listed {btn({ kind: 'unlistedGroup', key: 'unlistedGroup' })}
                  <span className="ind-sh-note">
                    same frame, no ticker — {unlisted.count} filer{unlisted.count === 1 ? '' : 's'},{' '}
                    {fmtMoney(unlisted.totalRevenue)} outside every rank above
                  </span>
                </h4>
                <table className="ind-table">
                  <tbody>
                    {unlisted.top.map((u) => (
                      <tr key={u.cik}>
                        <td>
                          {u.name || `CIK ${u.cik}`}
                          {' '}{btn({ kind: 'unlisted', key: `unlisted:${u.cik}`, m: u })}
                        </td>
                        <td className="ind-num">{fmtMoney(u.revenue)}</td>
                        <td className="ind-num"><MarginCell m={u} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="ind-foot">
                  Registrants under the code with no listed ticker whose revenue the same
                  frame still measures — genuinely private companies reporting on registered
                  bonds, mixed with financing and operating subsidiaries of listed parents,
                  and SEC's data does not say which is which. They are outside every rank,
                  share and median above, which measure listed members only.
                </p>
              </>
            )}
          </Panel>
        )}

        {/* 3 — the shape of the population */}
        {measures && (
          <Panel title="How its measured revenue is distributed" swatch="b"
                 headExtra={<span className="ind-headnote">{measures.period} calendar frame</span>}>
            <dl className="ind-stats">
              <div className="ind-stat" title="Sum of frame revenue over every measured member">
                <dt>Measured revenue {btn({ kind: 'medians', key: 'medians' })}</dt>
                <dd>{fmtMoney(measures.totalRevenue) || '—'}</dd>
              </div>
              <div className="ind-stat">
                <dt>Median member</dt>
                <dd>{fmtMoney(measures.medianRevenue) || '—'}</dd>
              </div>
              <div className="ind-stat"
                   title="The 25th-to-75th percentile span of member revenue — where the middle half of the industry lives">
                <dt>Middle half</dt>
                <dd className="ind-stat-sm">
                  {measures.p25Revenue != null && measures.p75Revenue != null
                    ? `${fmtMoney(measures.p25Revenue)} – ${fmtMoney(measures.p75Revenue)}` : '—'}
                </dd>
              </div>
              <div className="ind-stat"
                   title="Median of net income over revenue, members reporting both">
                <dt>Median net margin</dt>
                <dd>{fmtPct(measures.medianNetMargin) ?? '—'}</dd>
              </div>
              {agg?.aggregateNetMargin != null && (
                <div className="ind-stat"
                     title={`Total net income over total revenue, the ${agg.profitReporters} members reporting both — dollar-weighted where the median is member-weighted, so the gap between the two is the giants earning differently from the typical member`}>
                  <dt>Aggregate margin {btn({ kind: 'aggregates', key: 'aggregates' })}</dt>
                  <dd>{fmtPct(agg.aggregateNetMargin)}</dd>
                </div>
              )}
              {agg?.profitableShare != null && (
                <div className="ind-stat"
                     title={`${agg.profitableCount} of the ${agg.profitReporters} members reporting NetIncomeLoss earned a profit on the frame — breadth the median margin cannot show`}>
                  <dt>Profitable members</dt>
                  <dd className="ind-stat-sm">
                    {fmtPct(agg.profitableShare, 0)} · {agg.profitableCount} of {agg.profitReporters}
                  </dd>
                </div>
              )}
              {agg?.aggregateGrowth != null && (
                <div className="ind-stat"
                     title={`This frame's total over last frame's, only the ${agg.growthMatched} members measured in BOTH years — the industry's own growth, free of composition effects. ${fmtPct(agg.grewShare, 0)} of matched members grew.`}>
                  <dt>Revenue growth, YoY</dt>
                  <dd className="ind-stat-sm">
                    {fmtPct(agg.aggregateGrowth)} · {fmtPct(agg.grewShare, 0)} grew
                  </dd>
                </div>
              )}
              {conc && (
                <>
                  <div className="ind-stat"
                       title="Share of measured revenue held by the single largest member">
                    <dt>Top firm {btn({ kind: 'concentration', key: 'concentration' })}</dt>
                    <dd>{fmtPct(conc.cr1, 0)}</dd>
                  </div>
                  <div className="ind-stat"
                       title="Share of measured revenue held by the four largest members">
                    <dt>CR4</dt>
                    <dd>{fmtPct(conc.cr4, 0)}</dd>
                  </div>
                  <div className="ind-stat" title="…and by the eight largest">
                    <dt>CR8</dt>
                    <dd>{fmtPct(conc.cr8, 0)}</dd>
                  </div>
                  <div className="ind-stat"
                       title="Herfindahl–Hirschman index on the 0–10,000 DOJ scale; above 2,500 reads as highly concentrated">
                    <dt>HHI</dt>
                    <dd>{conc.hhi.toLocaleString()}</dd>
                  </div>
                  {conc.equivalent != null && (
                    <div className="ind-stat"
                         title="10,000 over HHI — the number of EQUAL-sized firms that would produce this concentration">
                      <dt>Reads like</dt>
                      <dd className="ind-stat-sm">{conc.equivalent.toFixed(1)} equal firms</dd>
                    </div>
                  )}
                  {conc.gini != null && (
                    <div className="ind-stat"
                         title="Gini coefficient of measured revenue: 0 is every member the same size, 1 is one firm holding everything — dispersion among the small members, which HHI ignores">
                      <dt>Gini</dt>
                      <dd>{conc.gini.toFixed(2)}</dd>
                    </div>
                  )}
                </>
              )}
            </dl>
            {top.length > 0 && (
              <>
                <h4 className="ind-sh">
                  Who holds the revenue {btn({ kind: 'concentration', key: 'sharebar' })}
                  <span className="ind-sh-note">shares of measured revenue — not the market's</span>
                </h4>
                <ShareBar top={top} measures={measures} />
              </>
            )}
            {sizes.length > 0 && (
              <>
                <h4 className="ind-sh">
                  Members by size {btn({ kind: 'sizes', key: 'sizes' })}
                  <span className="ind-sh-note">
                    {identity.ticker}'s bracket marked
                  </span>
                </h4>
                <ul className="ind-buckets">
                  {sizes.map((b) => (
                    <li key={b.label} className={b.hasSelf ? 'is-self' : undefined}>
                      <span className="ind-bucket-k">
                        {b.label}{b.hasSelf ? ` · ${identity.ticker}` : ''}
                      </span>
                      <span className="ind-bucket-bar" aria-hidden="true">
                        <i style={{ width: `${Math.round((b.share || 0) * 100)}%` }} />
                      </span>
                      <span className="ind-bucket-n">{b.count}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="ind-foot">
              Concentration here is of what SEC's frame measures — listed, US-GAAP,
              calendar-aligned filers — and says nothing about private companies or
              foreign listings. An industry can be fragmented in reality and read
              concentrated here.
            </p>
          </Panel>
        )}
      </div>

      <div className="ind-band">
        {/* 4 — how the industry earns, and where the company sits in it */}
        {metrics.length > 0 && (
          <Panel title="How the industry earns" swatch="a"
                 headExtra={(
                   <span className="ind-headnote">
                     medians over reporting members · {identity.ticker} placed by percentile
                   </span>
                 )}>
            <table className="ind-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th className="ind-num">P25</th>
                  <th className="ind-num">Median</th>
                  <th className="ind-num">P75</th>
                  <th className="ind-range-h" aria-label="Distribution, company marked" />
                  <th className="ind-num">{identity.ticker}</th>
                  <th className="ind-num">Pctile</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((r) => {
                  const fv = (v) => (v == null ? '—'
                    : r.kind === 'mult' ? `${v.toFixed(2)}×` : fmtPct(v));
                  return (
                    <tr key={r.id}>
                      <td>
                        {r.label}
                        <span className="ind-name">
                          {r.reporters} report{r.derivedCount > 0 ? ` · ${r.derivedCount} ƒ` : ''}
                        </span>
                        {btn({ kind: 'metric', key: `metric:${r.id}`, row: r })}
                      </td>
                      <td className="ind-num">{fv(r.p25)}</td>
                      <td className="ind-num"><b>{fv(r.median)}</b></td>
                      <td className="ind-num">{fv(r.p75)}</td>
                      <td className="ind-range-cell"
                          title={`P25–P75 band with the median ticked; the dot is ${identity.ticker}`}>
                        <RangeDot row={r} />
                      </td>
                      <td className="ind-num">
                        {r.self == null ? '—'
                          : r.selfDrv ? <Drv note={r.selfDrv}><b>{fv(r.self)}</b></Drv>
                            : <b>{fv(r.self)}</b>}
                      </td>
                      <td className="ind-num">
                        {r.selfPct == null ? '—' : `P${Math.round(r.selfPct * 100)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="ind-foot">
              Each row is computed only over the members whose inputs the {measures?.period}{' '}
              frames actually carry — the "report" count is that denominator, and it differs
              row to row. A "· N ƒ" count says how many of those inputs were computed here by
              formula (gross profit from revenue − cost; equity from assets − liabilities)
              rather than read from the standard tag. An R&D line nobody filed is still left
              out, never read as zero — no identity recovers it.
              {self == null && !sd && ` ${identity.ticker} is not measured on this frame, so its
              column is empty rather than borrowed from a different period.`}
              {self == null && sd && ` ${identity.ticker}'s ƒ values come from its own filing
              aligned to the frame year; no percentile is given because its period is not
              everyone else's.`}
            </p>
          </Panel>
        )}

        {/* 5 — the industry across five frames, drawn */}
        {hist && (
          <Panel title="The industry across five frames" swatch="b"
                 headExtra={(
                   <>
                     <span className="ind-headnote">today's members, measured back in time</span>
                     {btn({ kind: 'history', key: 'history' })}
                   </>
                 )}>
            <div className="ind-charts">
              <figure className="ind-fig">
                <figcaption className="ind-fig-cap">
                  Measured revenue
                  <span className="ind-sharebar-key"><i style={{ background: 'var(--accent)' }} />{identity.ticker}</span>
                  <span className="ind-sharebar-key"><i style={{ background: 'var(--ink-fainter)' }} />rest of members</span>
                </figcaption>
                <HistoryColumns hist={hist} ticker={identity.ticker} />
              </figure>
              <figure className="ind-fig">
                <figcaption className="ind-fig-cap">Median net margin</figcaption>
                <HistoryMarginLine hist={hist} />
              </figure>
            </div>
            <p className="ind-foot">
              Survivors' history: each year measures the CURRENT membership in that
              year's frame, so companies that have since left the code are missing from
              the early totals — the growth of the total overstates the industry's. A
              column with no accent slice is a year the frame did not measure{' '}
              {identity.ticker}.
            </p>
          </Panel>
        )}
      </div>


      {/* 6/7 — the private side: what the whole population looks like, and who
          is raising private capital under the code. Every claim above this band
          measures LISTED filers; this band is the corrective. */}
      {priv && (
        <div className="ind-band">
          {priv.naics && (
            <Panel title="The whole industry, private firms included" swatch="c"
                   headExtra={(
                     <>
                       <span className="ind-headnote">
                         every employer, not every registrant
                       </span>
                       {btn({ kind: 'naicsMap', key: 'naicsMap' })}
                     </>
                   )}>
              <p className="ind-foot" style={{ marginTop: 0 }}>
                SIC {cls?.sic} corresponds to{' '}
                {priv.naics.industries.map((n, i) => (
                  <span key={n.code}>
                    {i > 0 && ', '}
                    <b>{n.title || n.code}</b> ({n.code})
                  </span>
                ))}
                {' '}under NAICS, the classification the federal statistical
                agencies count EVERY firm by — public, private, and never-SEC-registered
                alike.{priv.naics.partial && ' The e-commerce/direct-selling slice of the '
                  + 'code could not be followed, so these totals are floors.'}
              </p>
              {priv.qcew && (
                <dl className="ind-stats">
                  <div className="ind-stat"
                       title="Private-ownership establishments, all covered employers">
                    <dt>Establishments {btn({ kind: 'privateScale', key: 'privateScale' })}</dt>
                    <dd>{priv.qcew.estabs.toLocaleString()}</dd>
                  </div>
                  <div className="ind-stat" title="Employment in the quarter's third month">
                    <dt>Jobs</dt>
                    <dd>{priv.qcew.emp.toLocaleString()}</dd>
                  </div>
                  <div className="ind-stat"
                       title="Employment-weighted average weekly wage across the mapped NAICS industries">
                    <dt>Avg weekly wage</dt>
                    <dd>{priv.qcew.avgWeeklyWage != null
                      ? `$${Math.round(priv.qcew.avgWeeklyWage).toLocaleString()}` : '—'}</dd>
                  </div>
                  <div className="ind-stat" title="Total wages paid in the quarter">
                    <dt>Wages, {priv.qcew.period}</dt>
                    <dd>{fmtMoney(priv.qcew.wages)}</dd>
                  </div>
                </dl>
              )}
              {priv.census && (
                <>
                  <h4 className="ind-sh">
                    Every firm's revenue, {priv.census.year}{' '}
                    {btn({ kind: 'censusScale', key: 'censusScale' })}
                    <span className="ind-sh-note">the Economic Census — public and private alike</span>
                  </h4>
                  <dl className="ind-stats">
                    <div className="ind-stat" title="Firms, not establishments — a company is one firm">
                      <dt>Firms</dt>
                      <dd>{priv.census.firms != null ? priv.census.firms.toLocaleString() : '—'}</dd>
                    </div>
                    <div className="ind-stat"
                         title={priv.census.receiptsSuppressed
                           ? 'A floor — Census withheld some cells under disclosure rules'
                           : 'Sales, value of shipments, or revenue'}>
                      <dt>Receipts</dt>
                      <dd>
                        {fmtMoney(priv.census.receipts) || '—'}
                        {priv.census.receiptsSuppressed ? '+' : ''}
                      </dd>
                    </div>
                    {measures?.totalRevenue && priv.census.receipts ? (
                      <div className="ind-stat"
                           title={`${measures.period} frame revenue over ${priv.census.year} census receipts — different years, so a reading, not a ratio`}>
                        <dt>Listed filers ≈</dt>
                        <dd>{fmtPct(measures.totalRevenue / priv.census.receipts, 0)}</dd>
                      </div>
                    ) : null}
                  </dl>
                </>
              )}
              <p className="ind-foot">
                BLS's QCEW counts every employer covered by unemployment insurance
                (~95% of jobs), private ownership only
                {priv.census ? '; Census\'s Economic Census measures every firm\'s receipts '
                  + 'once five years' : ''}. Set against the handful of listed filers above,
                this is how much of the industry the ranks and shares cannot see.
                {priv.naics.split && ' The NAICS mapping is one-to-many, so the totals span '
                  + 'every listed industry above.'}
              </p>
            </Panel>
          )}

          {priv.formd && (
            <Panel title="Private capital raised under the code" swatch="a"
                   headExtra={(
                     <>
                       <span className="ind-headnote">
                         Form D exempt offerings · {priv.formd.quarters.length} published quarters
                       </span>
                       {btn({ kind: 'formd', key: 'formd' })}
                     </>
                   )}>
              {priv.formd.companies.offerings > 0 ? (
                <>
                  <dl className="ind-stats">
                    <div className="ind-stat"
                         title="Distinct offerings by operating companies; amendments fold into their offering">
                      <dt>Offerings</dt>
                      <dd>{priv.formd.companies.offerings}</dd>
                    </div>
                    <div className="ind-stat" title="Distinct issuers behind them">
                      <dt>Companies</dt>
                      <dd>{priv.formd.companies.companies}</dd>
                    </div>
                    <div className="ind-stat"
                         title="Sum of each offering's amount sold as last reported — an amendment restates, never adds">
                      <dt>Raised</dt>
                      <dd>{fmtMoney(priv.formd.companies.sold) || '$0'}</dd>
                    </div>
                    {priv.formd.funds.offerings > 0 && (
                      <div className="ind-stat"
                           title="Pooled investment funds filing under the industry's code — capital ABOUT the industry, not companies in it">
                        <dt>Fund offerings</dt>
                        <dd>{priv.formd.funds.offerings}</dd>
                      </div>
                    )}
                  </dl>
                  <table className="ind-table">
                    <thead>
                      <tr>
                        <th>Issuer</th>
                        <th className="ind-num">Filed</th>
                        <th className="ind-num">Raised</th>
                        <th>Stated revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {priv.formd.companies.recent.map((r) => (
                        <tr key={r.accn}>
                          <td>
                            {r.ticker ? (
                              <>
                                <button type="button" className="ind-tk"
                                        title={`A LISTED issuer raising privately — look at ${r.ticker}`}
                                        onClick={() => setTicker(r.ticker)}>{r.ticker}</button>
                                {' '}
                              </>
                            ) : null}
                            {r.name || `CIK ${r.cik}`}
                            {' '}{btn({ kind: 'formdFiling', key: `formd:${r.accn}`, r })}
                            <span className="ind-name">
                              {[r.state, r.yearInc ? `inc. ${r.yearInc}` : null]
                                .filter(Boolean).join(' · ')}
                            </span>
                          </td>
                          <td className="ind-num">{r.date}</td>
                          <td className="ind-num">
                            {fmtMoney(r.sold) || '—'}
                            {r.offering && r.sold !== r.offering
                              ? <span className="ind-name">of {fmtMoney(r.offering)}</span>
                              : null}
                          </td>
                          <td>{r.revenueRange || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="ind-none">
                  No operating company filed a Form D under this code in the last{' '}
                  {priv.formd.quarters.length} published quarters
                  {priv.formd.funds.offerings > 0
                    ? ` (${priv.formd.funds.offerings} pooled-fund offering${priv.formd.funds.offerings === 1 ? '' : 's'} did)`
                    : ''}.
                </p>
              )}
              <p className="ind-foot">
                Form D is where PRIVATE companies surface: nearly every US venture or
                private-placement raise files one, with the issuer's identity, revenue
                range and dollars sold. The capital is private either way, but the
                issuer need not be — a listed company placing notes privately files the
                same form, and those rows carry their ticker. Quarters{' '}
                {priv.formd.quarters[priv.formd.quarters.length - 1]}
                –{priv.formd.quarters[0]}, from SEC's structured data sets. Most issuers
                decline to state revenue, and amounts are as filed — a raise the company
                never amends in reads at its first figure.
              </p>
            </Panel>
          )}
        </div>
      )}

      {/* 10 — the Form 4 pulse */}
      {insider && (
        <Panel title={`Insider pulse — last ${insider.windowDays} days`} swatch="b"
               headExtra={(
                 <>
                   <span className="ind-headnote">
                     open-market trades only, across every member with a Form 4
                   </span>
                   {btn({ kind: 'insider', key: 'insider' })}
                 </>
               )}>
          <PulseBars buys={insider.buys} sells={insider.sells} />
          <div className="ind-two">
            {[['Open-market buying', insider.buys, 'is-up'],
              ['Open-market selling', insider.sells, 'is-down']].map(([label, s, tone]) => (
              <div key={label}>
                <h4 className="ind-sh">
                  {label}
                  <span className="ind-sh-note">
                    {fmtMoney(s.total) || '$0'} · {s.companies} compan{s.companies === 1 ? 'y' : 'ies'}
                    {' '}· {s.filings} filing{s.filings === 1 ? '' : 's'}{s.capped ? '+' : ''}
                  </span>
                </h4>
                {s.top.length ? (
                  <ul className="ind-movers">
                    {s.top.map((r) => (
                      <li key={r.ticker + label}>
                        <button type="button" className="ind-tk" title={`Look at ${r.ticker}`}
                                onClick={() => setTicker(r.ticker)}>{r.ticker}</button>
                        <span className={`ind-mover-g ${tone}`}>{fmtMoney(r.total)}</span>
                        <span className="ind-name">
                          {r.names} insider{r.names === 1 ? '' : 's'} · {r.filings} filing{r.filings === 1 ? '' : 's'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ind-none">None filed in the window.</p>
                )}
              </div>
            ))}
          </div>
          <p className="ind-foot">
            From the platform's own Form 4 database, filtered to this SIC code.
            Transaction codes P and S only — decisions made with the insider's own
            money; grants and tax withholding never enter these totals. Dollar values
            as stated on the filings.
          </p>
        </Panel>
      )}

      {/* last — the boundary of what is known, folded. Collapsed it still
          names every caveat, so nothing is hidden, only compressed. */}
      {absences.length > 0 && (
        <Panel title="What this page cannot say" swatch="c"
               headExtra={(
                 <span className="ind-headnote">
                   {absences.length} caveat{absences.length === 1 ? '' : 's'} — and why
                 </span>
               )}>
          <details className="ind-absentfold">
            <summary>
              {absences.map(([k]) => k.replace(/([A-Z])/g, ' $1').toLowerCase()).join(' · ')}
            </summary>
            <dl className="ind-absent">
              {absences.map(([k, v]) => (
                <div key={k} className="ind-row">
                  <dt>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </details>
        </Panel>
      )}
    </>,
  );
}

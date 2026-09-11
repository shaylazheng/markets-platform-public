/* Summary — the first Company subtab, and the one that answers "what is this".
 *
 * WHY IT IS A SURFACE AND NOT A RAIL BLOCK. This began inside CompanyRail, as
 * the first subsection of the shared company header, on the reasoning that you
 * should read what a company does before reading any ratio computed from it.
 * That reasoning still holds; the placement did not. A 320px rail column turns
 * a business description into a narrow ribbon of wrapped text, puts four
 * segment names on four lines, and buries the filing's risk taxonomy behind a
 * disclosure toggle nobody opens. The content is a report, so it gets a page.
 *
 * As a surface it can also be honest about ORDER. A report opens with what the
 * company is, then how big it is, then how it earns, then who it depends on,
 * then what is coming, then what management fears, then what a person
 * concluded, then where every line came from. In a rail that sequence had to be
 * collapsed. Here each part gets a panel and the sequence is the layout.
 *
 * WHAT IT REFUSES TO DO, unchanged from the rail version and the reason the
 * route returns an `absent` map at all:
 *
 *   - The business description is a VERBATIM QUOTE of Item 1, labelled as one
 *     and linked to the filing. No model paraphrases it, because a wrong
 *     paraphrase of a business reads exactly as confidently as a right one.
 *   - No GEOGRAPHIC revenue split, still. The BUSINESS-SEGMENT split renders
 *     now — but only because segments.js reads it from the filing's extracted
 *     XBRL instance, where the dimensional axes survive (companyfacts drops
 *     them, which is why this bullet used to refuse the split outright). A
 *     company whose split cannot be read from the instance gets the reason,
 *     and a single-segment filer gets the honest sentence, not an empty table.
 *   - An ABSENCE IS RENDERED WITH ITS REASON. "Not disclosed" and "we did not
 *     look" both come out as an em dash if you let them, and they are different
 *     facts about a company. "What this does not say" sits directly under the
 *     business description — read together with it, not discovered at the
 *     bottom — and is the most load-bearing panel here: it is what stops the
 *     page implying a completeness it does not have. Each reason links to
 *     where a reader can check the claim: the filing itself where the claim is
 *     about the filing, the SEC rule or feed where the gap is structural.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Panel } from '@markets/shell/components/Panel.jsx';
import { CompanyRail } from '@markets/shell/components/CompanyRail.jsx';
import { SourceInspector, SrcButton, TraceParts } from '@markets/shell/components/SourceInspector.jsx';
import { pinFigure } from '@markets/shell/lib/pins.js';
import { useApp } from '@markets/shell/lib/store.jsx';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';
import { hashView } from '@markets/shell/lib/hash.js';
import { metricTraces } from '@markets/shell/lib/sourceRows.js';
import { useProvenance } from '@markets/shell/lib/useProvenance.js';
import {
  useCompanySummary, normaliseOmit,
} from '@markets/shell/lib/companySummary.js';
import { defaultRows, describe, sourcesFor } from './summarySources.js';

const clean = (s) => String(s ?? '').trim();

/* SEC states a fiscal year end as MMDD ("0903"), which reads as a broken field
   rather than as September 3. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
function fiscalYearEnd(mmdd) {
  const m = /^(\d{2})(\d{2})$/.exec(clean(mmdd));
  if (!m) return clean(mmdd) || null;
  const month = MONTHS[Number(m[1]) - 1];
  const day = Number(m[2]);
  if (!month || !day || day > 31) return clean(mmdd);
  return `${month} ${day}`;
}

/* ---- the rail's metric block -------------------------------------------- *
 *
 * The figure deck lived in the main column as "Scale, returns and what it
 * costs". It is the rail's job now, below the company name, with a fiscal-year
 * selector — which is why it grew a second dimension the panel never had: pick
 * a year and each metric shows that year's value, the average across the years
 * on file, and the change against the prior year.
 *
 * Only filing-derived metrics live here. Market cap, P/E and EV/EBITDA need a
 * share price, and a "Market, today" strip carried them for a while — removed
 * by request; Valuation is the surface that prices things.
 */
/* `hib` — higher is better — decides the colour of a change: an efficiency
 * ratio FALLING is the good news, so green/red follow the metric's own
 * polarity, not the sign. `null` means the direction has no universal reading
 * (more leverage, a fatter current ratio) and the change stays uncoloured. */
const YEAR_METRICS = [
  { id: 'revenue', label: 'Revenue', kind: 'money', hib: true },
  { id: 'revenueGrowth', label: 'Revenue growth', kind: 'pct', hib: true },
  { id: 'grossMargin', label: 'Gross margin', kind: 'pct', hib: true },
  { id: 'operatingMargin', label: 'Operating margin', kind: 'pct', hib: true },
  { id: 'fcfMargin', label: 'FCF margin', kind: 'pct', hib: true },
  { id: 'roic', label: 'ROIC', kind: 'pct', hib: true },
  { id: 'roe', label: 'ROE', kind: 'pct', hib: true },
  { id: 'netDebtToEbitda', label: 'Net debt / EBITDA', kind: 'mult', hib: null },
  { id: 'currentRatio', label: 'Current ratio', kind: 'mult', hib: null },
];

/* The family extras arrive from the route with metrics.js format strings. */
const KIND_BY_FORMAT = { money: 'money', pct1: 'pct', pct2: 'pct2', x1: 'mult', x2: 'mult' };

const fmtMoney = (n) => {
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
  return `${s}$${Math.round(a).toLocaleString()}`;
};
const fmtVal = (kind, v) => (kind === 'money' ? fmtMoney(v)
  : kind === 'pct' ? `${(v * 100).toFixed(1)}%`
  : kind === 'pct2' ? `${(v * 100).toFixed(2)}%`
  : `${v.toFixed(1)}×`);

/* The change is stated in the metric's own units: a dollar figure moves by a
   percentage, a percentage moves by points ("pp"), a multiple by ×. Calling a
   margin's move from 20% to 22% "+10%" would be arithmetically defensible and
   read wrong by everyone. */
function fmtDelta(kind, v, p) {
  if (!Number.isFinite(v) || !Number.isFinite(p)) return null;
  const d = kind === 'money' ? (p === 0 ? null : (v - p) / Math.abs(p)) : v - p;
  if (d == null) return null;
  const sign = d > 0 ? '+' : '';
  const text = kind === 'money' ? `${sign}${(d * 100).toFixed(1)}%`
    : kind === 'pct' ? `${sign}${(d * 100).toFixed(1)} pp`
    : kind === 'pct2' ? `${sign}${(d * 100).toFixed(2)} pp`
    : `${sign}${d.toFixed(1)}×`;
  return { text, d };
}

const fyLabel = (y) => {
  const yr = /^\d{4}/.exec(String(y.end || ''))?.[0]
    || String(y.frame || '').replace(/^CY/, '');
  return `FY ${yr}`;
};

function RailMetrics({ years = [], scale = {}, current = null, onSelect, srcFigures = null }) {
  /* The selection is a frame string, not an index, and it is allowed to dangle:
     switching companies replaces `years`, and a frame the new company does not
     have simply falls back to its latest year — no effect needed. */
  const [selFrame, setSelFrame] = useState(null);
  const foundIdx = years.findIndex((y) => y.frame === selFrame);
  const curIdx = foundIdx >= 0 ? foundIdx : years.length - 1;
  const cur = years[curIdx];
  const prev = curIdx > 0 ? years[curIdx - 1] : null;

  /* The standard list plus the accounting family's own measures — a bank's
     NIM and efficiency ratio, an insurer's combined ratio, R&D intensity for a
     general filer that reports R&D. The route decides which apply; rows whose
     value the company never filed render nothing, so the list also varies
     company to company within a family. */
  const rows = [
    ...YEAR_METRICS,
    ...(scale.extraMetrics || []).map((m) => ({
      id: m.id, label: m.label,
      kind: KIND_BY_FORMAT[m.format] || 'mult', hib: m.higherIsBetter ?? null,
    })),
  ];

  if (!cur) return null;

  return (
    <div className="sm-ym" aria-label="Major metrics">
      <div className="sm-ym-head">
        <span className="sm-ym-title">Major metrics</span>
        {/* The deck-wide src button rides with the year selector: it traces the
            frame every figure below is computed on, so it belongs to the head,
            not to any one row. */}
        <span className="sm-ym-ctl">
          <select className="sm-ym-year" value={cur.frame} aria-label="Fiscal year"
                  onChange={(e) => setSelFrame(e.target.value)}>
            {[...years].reverse().map((y) => (
              <option key={y.frame} value={y.frame}>{fyLabel(y)}</option>
            ))}
          </select>
          {srcFigures}
        </span>
      </div>
      <dl className="sm-ym-rows">
        {rows.map((m) => {
          const v = cur.metrics?.[m.id];
          if (!Number.isFinite(v)) return null;
          const vals = years.map((y) => y.metrics?.[m.id]).filter(Number.isFinite);
          const avg = vals.length > 1
            ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
          const delta = prev ? fmtDelta(m.kind, v, prev.metrics?.[m.id]) : null;
          const good = delta && m.hib != null && delta.d !== 0
            ? (delta.d > 0) === m.hib : null;
          return (
            <div key={m.id} className="sm-ym-row">
              <dt>{m.label}{onSelect && (
                <SrcButton current={current} onSelect={onSelect}
                           sel={{ kind: 'metric', key: `m:${m.id}:${cur.frame}`,
                                  metricId: m.id, frame: cur.frame, label: m.label,
                                  display: fmtVal(m.kind, v) }} />
              )}</dt>
              <dd className="sm-ym-v">{fmtVal(m.kind, v)}</dd>
              {(avg != null || delta) && (
                <dd className="sm-ym-sub">
                  {avg != null && <span title={`Average across the ${vals.length} fiscal years on file`}>
                    avg {fmtVal(m.kind, avg)}
                  </span>}
                  {avg != null && delta && <span className="sm-sep">·</span>}
                  {delta && (
                    <span className={good == null ? undefined : good ? 'is-up' : 'is-down'}
                          title={`Change from ${fyLabel(prev)}`}>
                      {delta.text} YoY
                    </span>
                  )}
                </dd>
              )}
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/* A definition row that disappears when there is nothing to say.
 *
 * `when` is separate from `children` deliberately. Testing `!children` does NOT
 * work — a React element is truthy even when it renders to null, so a row given
 * `<Names items={[]} />` drew its label above an empty cell. That is the
 * labelled em dash this page exists to avoid, arrived at from the other side. */
function Row({ label, when, src, wide, children }) {
  const show = when === undefined ? !!children : !!when;
  if (!show) return null;
  return (
    <div className={'sm-row' + (wide ? ' sm-row-wide' : '')}>
      <dt>{label}{src}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Counterparties as clickable tickers where we know one. */
function Names({ items, onPick }) {
  if (!items?.length) return null;
  /* The sector tag after a competitor's name, two precisions apart: `areas`
     is which segment of THIS company the research names them against;
     `industry` is the competitor's own filed line of business, offered when
     no segment names them — and the tooltip words each for what it claims. */
  const sector = (x) => {
    if (x.areas?.length) {
      return { text: x.areas.join(', '),
               title: `Named as a competitor in ${x.areas.join(' and ')} by the researched segment intel` };
    }
    if (x.industry) {
      return { text: x.industry.toLowerCase(),
               title: `${x.industry} — the competitor's own filed industry (SEC SIC), not a claim about where the overlap is` };
    }
    return null;
  };
  return items.map((x, i) => {
    const sec = sector(x);
    return (
      <span key={(x.ticker || x.name) + i} className="sm-nm">
        {i > 0 && <span className="sm-sep">·</span>}
        {x.ticker && onPick ? (
          <button type="button" className="sm-tk" title={x.note || `Look at ${x.ticker}`}
                  onClick={() => onPick(x.ticker)}>{x.ticker}</button>
        ) : (
          <span title={x.note || undefined}>{x.name || x.ticker}</span>
        )}
        {sec && <span className="sm-nm-sec" title={sec.title}> {sec.text}</span>}
      </span>
    );
  });
}

/* ---- the rail's segment block -------------------------------------------- *
 *
 * The at-a-glance copy of the split, as a SUBSECTION OF THE COMPANY HEADER:
 * directly under the ticker and name, above the metric deck, because "what
 * are this company's businesses and how big is each" is part of knowing which
 * company you are looking at, not a computation about it. Rail scale means
 * three figures per segment — revenue, share, growth — drawn in the .sm-ym
 * idiom so the header reads as one column. The profit side of the analysis
 * (measure, margin, tie-out) stays in the main column's panel: five columns
 * of numbers in a 320px rail is how the summary ended up a surface in the
 * first place. */
function RailSegments({ seg, srcFigures = null }) {
  if (!seg?.rows?.length) return null;
  const max = Math.max(...seg.rows.map((r) => r.revenue), 1);
  const shown = seg.rows.slice(0, 7);
  return (
    <div className="sm-rs" aria-label="Business segments">
      <div className="sm-ym-head">
        <span className="sm-ym-title">Business segments</span>
        <span className="sm-ym-ctl">
          <span className="sm-rs-period" title={`Fiscal year to ${seg.period}, as tagged in the segment note`}>
            FY {String(seg.period).slice(0, 4)}
          </span>
          {srcFigures}
        </span>
      </div>
      <dl className="sm-rs-rows">
        {shown.map((r) => {
          const g = yoy(r.revenue, r.revenuePrev);
          return (
            <div key={r.member} className="sm-rs-row">
              <dt>{r.label}</dt>
              <dd className="sm-rs-v">{fmtAmt(r.revenue, seg.unit)}</dd>
              <dd className="sm-rs-sub">
                <span className="sm-rs-track" aria-hidden="true">
                  <span style={{ width: `${(r.revenue / max) * 100}%` }} />
                </span>
                <span title="Share of segment revenue">
                  {`${(r.revenue / seg.revenueSum * 100).toFixed(0)}%`}
                </span>
                {g != null && (
                  <span className={g > 0 ? 'is-up' : g < 0 ? 'is-down' : undefined}
                        title={`Change from the prior fiscal year${seg.prevPeriod ? ` (to ${seg.prevPeriod})` : ''}`}>
                    {pctSigned(g)}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {seg.rows.length > shown.length && (
        <p className="sm-rs-more">
          {seg.rows.length - shown.length} further in the panel on the right
        </p>
      )}
    </div>
  );
}

/* ---- the segment split --------------------------------------------------- *
 *
 * The table renders exactly what the filing tagged: revenue per reportable
 * segment, the change against the restated prior year the same note carries,
 * and whichever profit measure THIS filer discloses by segment — Amazon tags
 * operating income, P&G tags net earnings, and the column is titled with the
 * measure's own name rather than pretending they are the same thing. Shares
 * are of the segment sum; the tie-out against consolidated revenue is stated
 * in the footer rather than silently absorbed, because "segments sum below
 * the total" (corporate/other) and "above it" (intersegment revenue) are
 * facts about how the company reports, not noise. */
const yoy = (v, p) => (Number.isFinite(v) && Number.isFinite(p) && p !== 0
  ? (v - p) / Math.abs(p) : null);
const pctSigned = (x) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

/* An amount in the segment note's OWN currency. A foreign private issuer tags
   its segment note in its reporting currency — BABA's is RMB — and fmtMoney's
   dollar sign turned RMB554B into $554B, wrong by a factor of seven. Non-USD
   figures carry the ISO code instead of borrowing a symbol. */
const fmtAmt = (v, unit) => (!unit || unit === 'USD'
  ? fmtMoney(v) : `${fmtMoney(v).replace('$', '')} ${unit}`);

function tieOut(seg) {
  const { rows, revenueSum, revenueTotal, unallocated } = seg;
  if (revenueTotal == null) {
    return 'No undimensioned consolidated revenue is tagged for the same period, '
      + 'so shares are of the segment sum.';
  }
  if (unallocated === 0) {
    return `The ${rows.length} segments sum to consolidated revenue exactly.`;
  }
  const gap = fmtAmt(Math.abs(unallocated), seg.unit);
  return `Segments sum to ${fmtAmt(revenueSum, seg.unit)} against ${fmtAmt(revenueTotal, seg.unit)} `
    + `consolidated — the ${gap} ${unallocated > 0
      ? 'remainder is corporate, other and reconciling items'
      : 'excess is intersegment revenue eliminated in consolidation'}, as filed.`;
}

/* One segment's commentary, opened by a press on its row. Three voices, each
   labelled for what it is: the FILING (verbatim, anchored sentences from the
   annual report — what the segment is and why its numbers moved), MANAGEMENT
   (a verbatim call quote from the researched intel), and THE STREET (the
   researched summary of analyst and press views — the one part of this page
   that is synthesis rather than quotation, and it says so). Competitor chips
   jump the whole page to that company, same affordance as the fact sheet. */
function SegmentDetail({ r, seg, onPick }) {
  const research = r.research || {};
  const comps = research.competitors || [];

  /* The segment's own trajectory, spelled out: where each figure came from
     and where it went, not just the delta the table row shows. Margin change
     is stated in points; share-of-profit renders only when every segment's
     profit is a positive number — a share of a mix with losses in it is not
     a share of anything. */
  const nums = [];
  if (r.revenuePrev != null) {
    nums.push(['Revenue', `${fmtAmt(r.revenuePrev, seg.unit)} → ${fmtAmt(r.revenue, seg.unit)}`,
      yoy(r.revenue, r.revenuePrev) != null ? pctSigned(yoy(r.revenue, r.revenuePrev)) : null]);
  }
  const mNow = Number.isFinite(r.profit) && r.revenue > 0 ? r.profit / r.revenue : null;
  const mPrev = Number.isFinite(r.profitPrev) && r.revenuePrev > 0 ? r.profitPrev / r.revenuePrev : null;
  if (Number.isFinite(r.profit) && seg.profitLabel) {
    const cap = seg.profitLabel.charAt(0).toUpperCase() + seg.profitLabel.slice(1);
    nums.push([cap,
      Number.isFinite(r.profitPrev)
        ? `${fmtAmt(r.profitPrev, seg.unit)} → ${fmtAmt(r.profit, seg.unit)}`
        : fmtAmt(r.profit, seg.unit),
      Number.isFinite(r.profitPrev) && r.profitPrev !== 0 && r.profitPrev > 0 === r.profit > 0
        ? pctSigned(r.profit / r.profitPrev - 1) : null]);
    if (mNow != null) {
      nums.push(['Margin',
        mPrev != null ? `${(mPrev * 100).toFixed(1)}% → ${(mNow * 100).toFixed(1)}%` : `${(mNow * 100).toFixed(1)}%`,
        mPrev != null ? `${mNow - mPrev > 0 ? '+' : '−'}${Math.abs((mNow - mPrev) * 100).toFixed(1)} pp` : null]);
    }
    const profits = seg.rows.map((x) => x.profit);
    if (profits.every((p) => Number.isFinite(p) && p > 0)) {
      const share = r.profit / profits.reduce((a, b) => a + b, 0);
      nums.push([`Share of segment ${seg.profitLabel}`, `${(share * 100).toFixed(0)}%`, null]);
    }
  }

  return (
    <div className="sm-seg-detail">
      {nums.length > 0 && (
        <p className="sm-seg-nums">
          {nums.map(([k, v, delta], i) => (
            <span key={k}>
              {i > 0 && <span className="sm-sep">·</span>}
              <span className="sm-k">{k}</span> {v}{delta ? <span className="sm-seg-nd"> ({delta})</span> : ''}
            </span>
          ))}
          <span className="sm-q"> — year to {seg.prevPeriod || 'prior'} against year to {seg.period}</span>
        </p>
      )}
      {r.filing && (
        <div className="sm-seg-voice">
          <span className="sm-k">The filing</span>
          {r.filing.definition && <p className="sm-seg-q">“{r.filing.definition}”</p>}
          {(r.filing.drivers || []).map((d, i) => <p className="sm-seg-q" key={i}>“{d}”</p>)}
          <p className="sm-seg-cite">
            Quoted verbatim from the {seg.form || 'annual report'}
            {seg.filed ? `, filed ${seg.filed}` : ''}. Not a company disclosure.
          </p>
        </div>
      )}
      {research.management?.quote && (
        <div className="sm-seg-voice">
          <span className="sm-k">Management</span>
          <p className="sm-seg-q">“{research.management.quote}”</p>
          <p className="sm-seg-cite">
            Verbatim from the latest call or letter, via the researched intel
            {seg.researchAsOf ? ` (as of ${seg.researchAsOf})` : ''}
            {research.management.src ? <> · <a href={research.management.src} target="_blank" rel="noopener noreferrer">source</a></> : null}.
          </p>
        </div>
      )}
      {research.street?.view && (
        <div className="sm-seg-voice">
          <span className="sm-k">The street</span>
          <p className="sm-seg-p">{research.street.view}</p>
          <p className="sm-seg-cite">
            Researched summary of analyst and press views — synthesis, not a quote
            {research.street.src ? <> · <a href={research.street.src} target="_blank" rel="noopener noreferrer">source</a></> : null}.
          </p>
        </div>
      )}
      {comps.length > 0 && (
        <div className="sm-seg-voice">
          <span className="sm-k">Competes with</span>
          <p className="sm-seg-p">
            {comps.map((c, i) => (
              <span key={(c.ticker || c.name) + i}>
                {i > 0 && <span className="sm-sep">·</span>}
                {c.ticker && onPick ? (
                  <button type="button" className="sm-tk" title={c.note || `Look at ${c.ticker}`}
                          onClick={() => onPick(c.ticker)}>{c.ticker}</button>
                ) : (
                  <span title={c.note || undefined}>{c.name}</span>
                )}
              </span>
            ))}
            <span className="sm-q"> — full comparison on the Competitors tab</span>
          </p>
        </div>
      )}
    </div>
  );
}

function SegmentTable({ seg, onPick }) {
  /* Which rows are open, by member id. Every row with a story now STARTS
     open — the section's job is the full read on each business, and hiding
     the trajectory, the filing's own definition and the competitor list
     behind a click made the panel look thinner than it is (it originally
     started collapsed, also by request; this is the newer one). A row still
     collapses, because comparing two segments' TABLES side by side sometimes
     wants the prose out of the way. */
  const withDetail = () => new Set(seg.rows.filter((r) => r.filing || r.research
    || r.revenuePrev != null || Number.isFinite(r.profit)).map((r) => r.member));
  const [open, setOpen] = useState(withDetail);
  useEffect(() => { setOpen(withDetail()); }, [seg.period, seg.rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (m) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(m)) next.delete(m); else next.add(m);
    return next;
  });

  const max = Math.max(...seg.rows.map((r) => r.revenue), 1);
  const profitHead = seg.profitLabel
    ? seg.profitLabel.charAt(0).toUpperCase() + seg.profitLabel.slice(1) : null;
  const cols = 5 + (profitHead ? 2 : 0);
  return (
    <>
      <table className="sm-seg">
        <thead>
          <tr>
            <th className="sm-seg-name">Segment</th>
            <th className="sm-seg-bar" aria-label="Share of segment revenue" />
            <th>Revenue</th>
            <th>Share</th>
            <th>YoY</th>
            {profitHead && <th>{profitHead}</th>}
            {profitHead && <th>Margin</th>}
          </tr>
        </thead>
        <tbody>
          {seg.rows.map((r) => {
            const g = yoy(r.revenue, r.revenuePrev);
            const margin = Number.isFinite(r.profit) && r.revenue > 0
              ? r.profit / r.revenue : null;
            const hasDetail = !!(r.filing || r.research
              || r.revenuePrev != null || Number.isFinite(r.profit));
            const isOpen = open.has(r.member);
            return (
              <React.Fragment key={r.member}>
              <tr className={hasDetail ? 'sm-seg-row-x' : undefined}
                  onClick={hasDetail ? () => toggle(r.member) : undefined}
                  aria-expanded={hasDetail ? isOpen : undefined}>
                <td className="sm-seg-name">
                  {hasDetail && <span className="sm-seg-chev">{isOpen ? '▾' : '▸'}</span>}
                  {r.label}
                </td>
                <td className="sm-seg-bar">
                  <span style={{ width: `${(r.revenue / max) * 100}%` }} />
                </td>
                <td>{fmtAmt(r.revenue, seg.unit)}</td>
                <td>{`${(r.revenue / seg.revenueSum * 100).toFixed(0)}%`}</td>
                <td className={g == null ? undefined : g > 0 ? 'is-up' : g < 0 ? 'is-down' : undefined}
                    title={r.revenuePrev != null
                      ? `${fmtAmt(r.revenuePrev, seg.unit)} in the year to ${seg.prevPeriod}` : undefined}>
                  {g == null ? '—' : pctSigned(g)}
                </td>
                {profitHead && (
                  <td className={Number.isFinite(r.profit) && r.profit < 0 ? 'is-down' : undefined}>
                    {Number.isFinite(r.profit) ? fmtAmt(r.profit, seg.unit) : '—'}
                  </td>
                )}
                {profitHead && <td>{margin == null ? '—' : `${(margin * 100).toFixed(1)}%`}</td>}
              </tr>
              {isOpen && (
                <tr className="sm-seg-xrow">
                  <td colSpan={cols}><SegmentDetail r={r} seg={seg} onPick={onPick} /></td>
                </tr>
              )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="sm-foot">
        {tieOut(seg)}
        {seg.rows.some((r) => r.filing || r.research)
          ? ' Each segment opens with its trajectory and what the filing, management and the street say about it; press a row to fold its story away.' : ''}
        {seg.researchNote ? ` ${seg.researchNote}` : ''}
      </p>
    </>
  );
}

/* ---- the sidebar source inspector --------------------------------------- *
 *
 * The shared SourceInspector (shell), fed by summarySources.js. Default view:
 * the DOCUMENT LIST — every source the payload cites, the annual report as
 * the one primary document. Selected view: the PER-LINE TRACE — every line in
 * the main column carries a `src` button (the same affordance as Competitors'
 * cells); pressing it states the claim, how it was read, the filing's own
 * sentence where the extractor kept one, and the documents behind it. A rail
 * metric additionally decomposes to the XBRL facts via the provenance route.
 */
function SummaryInspector({ data, refs, sel, onSelect, prov, provState, ticker }) {
  const box = useRef(null);

  /* Metric selections carry their displayed value (`display`), so the
     inspector can offer to freeze the figure into the report's evidence bank.
     opts carries the duplicate-override; the inspector owns that flow. */
  const onPin = ticker
    ? (s, opts) => pinFigure(ticker,
        { label: s.label, value: s.display, sub: s.frame || '', surface: 'summary' }, opts)
    : undefined;

  /* The rail scrolls independently of the main column, so a press on a `src`
     button far down the page must bring the trace into view or it lands on a
     panel the reader cannot see. */
  useEffect(() => {
    if (sel && box.current) box.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={box}>
      {/* A bare panel surface, no head: the intro line inside already says
          what this is, and the rail is narrow enough that a second title
          above it read as noise. Panel always paints its head strip, so this
          reuses its surface classes directly instead. */}
      <div className="pnl">
        <div className="pnl-body pnl-body-flush">
          <SourceInspector
            sel={sel} onClose={() => onSelect(null)}
            d={describe(sel, data, refs)}
            sources={sourcesFor(sel, data, refs, prov)}
            state={sel?.kind === 'metric' ? provState : 'ok'}
            defaults={defaultRows(data)}
            defaultsIntro={'Every document this page drew on, the filing first. '
              + 'Press any src button on the right to trace that line here.'}
            onPin={onPin}
          >
            {sel?.kind === 'metric'
              && metricTraces(prov, sel.metricId).map((tr) => <TraceParts key={tr.id} trace={tr} />)}
          </SourceInspector>
        </div>
      </div>
    </div>
  );
}

/**
 * @param {object} [injected]  a payload, for the render checks. Same escape
 *   hatch Book / Risk / Valuation use, so the degraded and empty states can be
 *   asserted without a network.
 * @param {string[]} [omit]  sections another surface covers in depth. Kept from
 *   the rail version because the mapping is tested and a future surface may
 *   want it; nothing omits anything by default now that this is a page of its
 *   own rather than a block competing for rail height.
 */
/* ---- the stock, as traded ------------------------------------------------ *
 * Arithmetic facts of the price series: the 52-week range drawn as a bar with
 * the last close marked on it, returns over standard windows, realised
 * volatility, and the deepest drawdown of the covered window. Every value is
 * server-computed; this component only draws. A window the series does not
 * cover arrived null and renders as a dash with the coverage note underneath
 * — never silently shortened. */
const pctSigned2 = (x, d = 1) => (x == null ? null
  : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%`);

/* The price series itself, as candlesticks — six months of daily OHLC from
   the local store via /api/insider/prices. ohlc=1 makes the route guarantee
   coverage: a ticker never seen before is backfilled from yfinance on the
   spot, and rows stored before the OHLC columns existed are re-fetched once
   and filled in place — which is what makes ANY ticker typed into the search
   bar chart correctly. Wick = high/low, body = open/close; a rare close-only
   day (CRSP-era or a yfinance gap) draws as a close tick rather than a
   fabricated candle. */
/* Auto-research: a viewed company with no researched earnings intel gets
   the refresh job started for it — headless Claude via the Agent SDK on the
   MAX SUBSCRIPTION, which is the platform's standing plan: no demo configuration, no
   marginal dollar (claude.js deletes ANTHROPIC_demo configuration on import so a stray
   key cannot bill). Once per ticker per session here, one job per ticker at
   a time server-side, and the result persists in data/earnings/<T>.json —
   so this runs once per company, ever, unless deliberately re-researched.
   Quarter, reactions, catalysts and counterparties fill when it lands. */
const researchKicked = new Set();
function ResearchIntel({ ticker, onDone }) {
  const [st, setSt] = useState(null);   // null | running | done | error
  const timer = useRef(null);
  useEffect(() => {
    if (!ticker) return;
    let live = true;
    setSt(null);
    clearTimeout(timer.current);
    const poll = () => {
      fetch(`/api/graph/refresh?ticker=${encodeURIComponent(ticker)}`)
        .then((r) => r.json())
        .then((j) => {
          if (!live) return;
          if (j.state === 'running') { setSt('running'); timer.current = setTimeout(poll, 6000); }
          else if (j.state === 'done') { setSt('done'); setTimeout(() => live && onDone?.(), 4000); }
          else if (j.state === 'error') setSt('error');
          else if (!researchKicked.has(ticker)) {
            researchKicked.add(ticker);
            fetch('/api/graph/refresh', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ticker }),
            }).then(() => { if (live) { setSt('running'); timer.current = setTimeout(poll, 6000); } });
          }
        }).catch(() => {});
    };
    fetch(`/api/peers/resolve?ticker=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((r) => { if (live && r && !r.error && r.hasEarnings === false) poll(); })
      .catch(() => {});
    return () => { live = false; clearTimeout(timer.current); };
  }, [ticker]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return null;
  return (
    <p className={'sm-research' + (st === 'error' ? ' is-bad' : '')}>
      {st === 'running' && <>Researching {ticker}’s earnings record — headless Claude on the Max plan, a few minutes; quarter, reactions, catalysts and counterparties fill when it lands.</>}
      {st === 'done' && <>Research landed — refreshing the page’s intel…</>}
      {st === 'error' && <>The research job failed — see the Graph surface’s job log, or run npm run refresh -- {ticker}.</>}
    </p>
  );
}

/* Time horizons for the candle chart: presets plus a free entry — "42" or
   "42d" is days, "10w" weeks, "6m" months, "2y" years. A horizon reaching
   past the listing's history simply shows everything the store holds since
   the IPO, and the caption says where the record actually begins. */
const HORIZONS = [['1M', 31], ['3M', 92], ['6M', 183], ['1Y', 366], ['3Y', 1097], ['5Y', 1828], ['All', null]];
const parseHorizon = (raw) => {
  const m = String(raw).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z]*)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!n) return null;
  const u = (m[2] || 'd')[0];
  const days = u === 'y' ? n * 365.25 : u === 'm' ? n * 30.44 : u === 'w' ? n * 7 : n;
  return Math.max(2, Math.round(days));
};

function CandleChart({ ticker }) {
  const [days, setDays] = useState(183);      // null = everything since listing
  const [entry, setEntry] = useState('');
  const [badEntry, setBadEntry] = useState(false);
  const [st, setSt] = useState({ state: 'loading' });
  useEffect(() => {
    if (!ticker) return;
    let live = true;
    setSt({ state: 'loading' });
    const start = new Date();
    start.setDate(start.getDate() - (days ?? 365.25 * 14));   // All = the route's ~15y ceiling; the store starts 2006
    const iso = start.toISOString().slice(0, 10);
    fetch(`/api/insider/prices?tickers=${encodeURIComponent(ticker)}&start=${iso}&ohlc=1`)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        const s = j.series?.[ticker];
        if (!s?.dates?.length) setSt({ state: 'missing' });
        else setSt({ state: 'ok', s, requestedStart: iso });
      })
      .catch(() => live && setSt({ state: 'missing' }));
    return () => { live = false; };
  }, [ticker, days]);

  const applyEntry = () => {
    const d = parseHorizon(entry);
    if (d == null) { setBadEntry(true); return; }
    setBadEntry(false);
    setDays(d);
  };

  const controls = (
    <div className="sm-cd-controls">
      {HORIZONS.map(([label, d]) => (
        <button key={label} type="button"
                className={'sm-cd-chip' + (days === d ? ' is-on' : '')}
                onClick={() => { setDays(d); setEntry(''); setBadEntry(false); }}>{label}</button>
      ))}
      <input className={'sm-cd-entry' + (badEntry ? ' is-bad' : '')} value={entry}
             placeholder="e.g. 42d, 18m, 2y" size={9}
             title="Any horizon: a number is days; suffix w/m/y for weeks, months, years. Enter applies. Beyond the listing's history shows everything since the IPO."
             onChange={(e) => { setEntry(e.target.value); setBadEntry(false); }}
             onKeyDown={(e) => { if (e.key === 'Enter') applyEntry(); }} />
    </div>
  );

  if (st.state === 'loading') return <>{controls}<p className="sm-foot">Loading price series…</p></>;
  if (st.state === 'missing') {
    return <>{controls}<p className="sm-none">No price series for {ticker} — the local store has no rows and the live fetch returned none (unlisted, delisted, or a ticker the price feed does not know).</p></>;
  }
  const { s, requestedStart } = st;
  const daily = s.dates.map((d, i) => ({
    d, c: s.close[i], o: s.open?.[i], h: s.high?.[i], l: s.low?.[i],
  })).filter((x) => x.c != null);
  if (daily.length < 2) return <>{controls}<p className="sm-none">Too few closes to chart.</p></>;

  /* Wide windows aggregate to weekly candles — at 5 years, daily bodies are
     sub-pixel. Weekly open/close are the week's first and last; high/low use
     the daily highs and lows where the source carries them and closes where
     it does not, and the caption says the candles are aggregates. */
  const weekly = daily.length > 240;
  let pts = daily;
  if (weekly) {
    const wk = new Map();
    for (const x of daily) {
      const dt0 = new Date(`${x.d}T12:00:00Z`);
      const monday = new Date(dt0);
      monday.setUTCDate(dt0.getUTCDate() - ((dt0.getUTCDay() + 6) % 7));
      const k = monday.toISOString().slice(0, 10);
      const b = wk.get(k);
      if (!b) wk.set(k, { d: x.d, o: x.o ?? x.c, c: x.c, h: x.h ?? x.c, l: x.l ?? x.c });
      else {
        b.d = x.d;
        b.c = x.c;
        b.h = Math.max(b.h, x.h ?? x.c);
        b.l = Math.min(b.l, x.l ?? x.c);
      }
    }
    pts = [...wk.values()];
  }

  const W = 720, H = 150, ML = 6, MR = 44, MT = 6, MB = 16;
  const iw = W - ML - MR, ih = H - MT - MB;
  const lo = Math.min(...pts.map((x) => x.l ?? x.c));
  const hi = Math.max(...pts.map((x) => x.h ?? x.c));
  const Y = (v) => MT + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const step = iw / pts.length;
  const bw = Math.max(1, Math.min(5, step * 0.62));
  const X = (i) => ML + i * step + step / 2;
  const span = (Date.parse(daily.at(-1).d) - Date.parse(daily[0].d)) / 86400e3;
  const byYear = span > 550;
  const marks = [];
  for (let i = 1; i < pts.length; i++) {
    const cur = byYear ? pts[i].d.slice(0, 4) : pts[i].d.slice(0, 7);
    const prev = byYear ? pts[i - 1].d.slice(0, 4) : pts[i - 1].d.slice(0, 7);
    if (cur !== prev) marks.push(i);
  }
  const shown = marks.filter((_, k) => k % Math.max(1, Math.ceil(marks.length / 8)) === 0);
  const fmtM = (iso) => (byYear ? iso.slice(0, 4)
    : new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short' }));
  const last = daily.at(-1);
  const ticks = 4;
  /* A horizon reaching past the record: the store's first date is well after
     the requested start — say so instead of letting the shorter axis pass
     for the requested one. */
  const clipped = days != null && (Date.parse(daily[0].d) - Date.parse(requestedStart)) > 14 * 86400e3;
  return (
    <figure className="sm-candles">
      {controls}
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`${weekly ? 'Weekly' : 'Daily'} candlesticks, ${daily[0].d} to ${last.d}`}>
        {Array.from({ length: ticks + 1 }, (_, k) => lo + (k / ticks) * (hi - lo)).map((v) => (
          <g key={v}>
            <line className="sm-cd-grid" x1={ML} x2={W - MR} y1={Y(v)} y2={Y(v)} />
            <text className="sm-cd-tick" x={W - MR + 4} y={Y(v) + 3}>{v >= 100 ? v.toFixed(0) : v.toFixed(1)}</text>
          </g>
        ))}
        {shown.map((i) => (
          <text key={i} className="sm-cd-tick" x={X(i)} y={H - 4} textAnchor="middle">{fmtM(pts[i].d)}</text>
        ))}
        {pts.map((x, i) => {
          if (x.o == null || x.h == null || x.l == null) {
            return <line key={x.d} className="sm-cd-tickmark" x1={X(i) - bw / 2} x2={X(i) + bw / 2} y1={Y(x.c)} y2={Y(x.c)} />;
          }
          const up = x.c >= x.o;
          const top = Y(Math.max(x.o, x.c));
          const bot = Y(Math.min(x.o, x.c));
          return (
            <g key={x.d} className={up ? 'sm-cd-up' : 'sm-cd-down'}>
              <line x1={X(i)} x2={X(i)} y1={Y(x.h)} y2={Y(x.l)} />
              <rect x={X(i) - bw / 2} y={top} width={bw} height={Math.max(0.8, bot - top)} />
            </g>
          );
        })}
      </svg>
      <figcaption className="sm-foot">
        {weekly ? `Weekly candles aggregated from ${daily.length} daily rows` : 'Daily candlesticks'}, {daily[0].d} to {last.d} · last {last.c.toFixed(2)}
        {clipped ? ` · the listed record begins ${daily[0].d} — showing everything since` : ''}
        {daily.some((x) => x.o == null) ? ' · close-only days (no OHLC in the source) draw flat' : ''}
      </figcaption>
    </figure>
  );
}

function StockPanel({ ticker, stock, scale, absent, src, srcCap }) {
  const noPrice = scale.price == null && clean(absent?.marketFigures);
  if (!stock) {
    return (
      <>
        <CandleChart ticker={ticker} />
        <p className="sm-none">{clean(absent?.stock)
          || 'Extended stock statistics are not included in this synthetic demo.'}</p>
        {noPrice && <p className="sm-none">{noPrice}</p>}
      </>
    );
  }
  const { wk52High: hi, wk52Low: lo, returns: r } = stock;
  const pos = stock.rangePosition;
  const RET = [['1 month', r.m1], ['6 months', r.m6], ['Year to date', r.ytd],
               ['1 year', r.y1], ['3 years', r.y3]];
  const capRows = [
    scale.dividendsPaid && ['Dividends paid', scale.dividendsPaid, scale.dividendYield && `${scale.dividendYield} yield`],
    scale.buybacks && ['Buybacks', scale.buybacks, scale.buybackYield && `${scale.buybackYield} yield`],
    scale.shareholderYield && ['Shareholder yield', scale.shareholderYield, 'dividends + buybacks, over market cap'],
  ].filter(Boolean);
  const capNotes = Object.values(scale.capitalReturnNotes || {}).filter(Boolean);
  return (
    <>
      <CandleChart ticker={ticker} />
      <div className="sm-stk-range" role="img"
           aria-label={`52-week range ${lo.value.toFixed(2)} to ${hi.value.toFixed(2)}, last ${stock.price.toFixed(2)}`}>
        <span className="sm-stk-lo">{lo.value.toFixed(2)}<i>low · {lo.date}</i></span>
        <span className="sm-stk-bar">
          <span className="sm-stk-track" />
          {pos != null && (
            <span className="sm-stk-mark" style={{ left: `${(pos * 100).toFixed(1)}%` }}>
              <b>{stock.price.toFixed(2)}</b>
            </span>
          )}
        </span>
        <span className="sm-stk-hi">{hi.value.toFixed(2)}<i>high · {hi.date}</i></span>
      </div>
      <div className="sm-stk-tiles">
        {RET.map(([label, v]) => (
          <span key={label} className="sm-stk-tile">
            <i>{label}</i>
            <b className={v == null ? undefined : v > 0 ? 'is-up' : v < 0 ? 'is-down' : undefined}>
              {pctSigned2(v, 1) ?? '—'}
            </b>
          </span>
        ))}
        <span className="sm-stk-tile">
          <i>Off 52w high</i>
          <b className={stock.offHigh < 0 ? 'is-down' : undefined}>{pctSigned2(stock.offHigh) ?? '—'}</b>
        </span>
        <span className="sm-stk-tile" title="Annualised standard deviation of one year of daily returns">
          <i>Realised vol, 1y</i><b>{stock.volatility1y != null ? `${(stock.volatility1y * 100).toFixed(0)}%` : '—'}</b>
        </span>
        {stock.maxDrawdown && (
          <span className="sm-stk-tile"
                title={`Peak ${stock.maxDrawdown.peakDate} to trough ${stock.maxDrawdown.troughDate}, within the covered window`}>
            <i>Max drawdown</i><b className="is-down">{pctSigned2(stock.maxDrawdown.depth, 0)}</b>
          </span>
        )}
      </div>
      {capRows.length > 0 && (
        <p className="sm-p sm-stk-cap">
          <span className="sm-k">Capital returns</span> {srcCap}
          {capRows.map(([k, v, sub], i) => (
            <span key={k}>{i > 0 && <span className="sm-sep">·</span>} {k} <b>{v}</b>{sub ? ` (${sub})` : ''}</span>
          ))}
          <span className="sm-q"> — cash actually paid over {scale.frame}, not a declared rate</span>
        </p>
      )}
      {capRows.length === 0 && capNotes.length > 0 && (
        <p className="sm-foot">Capital returns: {capNotes.join('; ')} — for dividends that usually means none were paid, but only the filer gets to state zero.</p>
      )}
      <p className="sm-foot">
        {src} closes {stock.coverage.first} to {stock.coverage.last}
        {stock.sourceSeam ? ` · CRSP through ${stock.sourceSeam}, yfinance after — a series crossing the seam can step` : ''}
        {' '}· no average volume and no beta: the price store carries closes only
      </p>
      {noPrice && <p className="sm-none">{noPrice}</p>}
    </>
  );
}

/* ---- revenue by geography ------------------------------------------------ *
 * The geographic split as tagged, shares against the note's own sum, YoY where
 * the prior year is tagged. `undisclosed` renders as its own unshaded row —
 * partial country disclosure is a normal filing shape and must read as
 * "the filer stops here", never as a complete split. */
function GeoTable({ geo }) {
  const total = geo.revenueSum + (geo.undisclosed || 0);
  const showUndisclosed = geo.undisclosed != null && geo.revenueTotal != null
    && geo.undisclosed > geo.revenueTotal * 0.005;
  return (
    <table className="sm-geo">
      <thead>
        <tr><th>Geography</th><th>Revenue</th><th>Share</th><th>YoY</th><th aria-label="share bar" /></tr>
      </thead>
      <tbody>
        {geo.rows.map((r) => {
          const share = total ? r.revenue / total : null;
          const yoyV = r.revenuePrev ? r.revenue / r.revenuePrev - 1 : null;
          return (
            <tr key={r.member}>
              <td>{r.label}</td>
              <td className="sm-geo-n">{fmtAmt(r.revenue, geo.unit)}</td>
              <td className="sm-geo-n">{share != null ? `${(share * 100).toFixed(0)}%` : '—'}</td>
              <td className={'sm-geo-n ' + (yoyV > 0 ? 'is-up' : yoyV < 0 ? 'is-down' : '')}>
                {yoyV != null ? pctSigned2(yoyV) : '—'}
              </td>
              <td className="sm-geo-barcell">
                {share != null && <span className="sm-geo-bar" style={{ width: `${(share * 100).toFixed(1)}%` }} />}
              </td>
            </tr>
          );
        })}
        {showUndisclosed && (
          <tr className="sm-geo-und">
            <td>Not broken out by the filer</td>
            <td className="sm-geo-n">{fmtAmt(geo.undisclosed, geo.unit)}</td>
            <td className="sm-geo-n">{`${((geo.undisclosed / total) * 100).toFixed(0)}%`}</td>
            <td className="sm-geo-n">—</td>
            <td className="sm-geo-barcell" />
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function Summary({ injected = null, omit }) {
  const { company: ticker, setCompany: setTicker } = useApp();
  const [intelRev, setIntelRev] = useState(0);   // bumped when auto-research lands
  const live = useCompanySummary(injected ? '' : ticker, intelRev);
  const { data, loading, error } = injected
    ? { data: injected, loading: false, error: null }
    : live;

  useBootGate('summary', !!data || !!error || !ticker, { what: 'the company summary' });

  /* Keep the hash current, but only while this surface is showing: store.jsx
     rewrites segment 0 on every view change, and writing during someone else's
     turn would stomp their tail on the way out. */
  useEffect(() => {
    if (injected || hashView() !== 'summary') return;
    history.replaceState(null, '', `#summary&ticker=${encodeURIComponent(ticker || '')}`);
  }, [ticker, injected]);

  const hidden = normaliseOmit(omit);
  const drop = (k) => hidden.has(k);

  const d = data || {};
  const identity = d.identity || {};
  const business = d.business || {};
  const segmentation = d.segmentation || null;
  const geography = d.geography || null;
  const stock = d.stock || null;
  const scale = d.scale || {};
  const rel = d.relationships || {};
  const concentration = d.concentration || [];
  const competitors = d.competitors || [];
  const outlook = d.outlook || {};
  const view = d.view;
  const sources = d.sources || [];

  const showGuidance = !!outlook.guidance && !drop('guidance');
  const showCatalysts = outlook.catalysts?.length > 0 && !drop('catalysts');
  const anyDeals = !drop('counterparties')
    && (['customer', 'supplier', 'competitor', 'partner'].some((k) => rel[k]?.length)
        || competitors.length > 0);
  const anyConc = !drop('concentration') && concentration.length > 0;

  /* ---- per-line provenance ----------------------------------------------- *
   * One entry per line the main column renders: which document it was read
   * from (`src` matches a payload source id), which section of it, and the
   * filing's own sentence where the extractor kept one. Entries only exist
   * where BOTH the line and its document do, so a fixture without source ids
   * simply grows no buttons rather than pointing at nothing. */
  const [sel, setSel] = useState(null);
  useEffect(() => { setSel(null); }, [ticker, data]);

  const srcIds = new Set(sources.map((s) => s.id).filter(Boolean));
  const mk = (src, section, quote) => (srcIds.has(src) ? { src, section, quote } : null);
  const refs = Object.fromEntries(Object.entries({
    description: business.description
      && mk('annual', 'Item 1 — the opening of the business description, quoted verbatim'),
    industry: clean(identity.industry)
      && mk('submissions', 'sicDescription — the industry named by the SEC-assigned SIC code'),
    listed: identity.exchanges?.length
      && mk('submissions', 'exchanges — where the registrant states its listings'),
    segments: business.segments
      && mk('annual', 'Item 1 — the segment statement', business.segments.quote),
    segmentation: segmentation
      && mk('segments', 'The segment note\'s own XBRL tags, read from the filing\'s '
        + 'extracted instance document — the one SEC artifact where the segment axis survives'),
    employees: business.employees
      && mk('annual', 'Item 1 — the headcount sentence', business.employees.quote),
    revPerEmployee: (scale.revenueRaw && business.employees?.count)
      && mk('xbrl', 'Computed here — XBRL revenue over the filing\'s stated headcount'),
    founded: identity.foundedYear
      && mk('annual', 'The incorporation statement, read from Item 1 or the cover'),
    hq: identity.hq
      && mk('submissions', 'addresses.business — the business address the registrant states'),
    incorporation: identity.stateOfIncorporation
      && mk('submissions', 'stateOfIncorporation — SEC\'s own structured field, not read from prose'),
    filer: identity.filerCategory
      && mk('submissions', 'category — the filer tier SEC assigns (its closest structured size class)'),
    fye: identity.fiscalYearEnd
      && mk('submissions', 'fiscalYearEnd — the nominal MMDD the registrant states'),
    stock: stock
      && mk('prices', 'Arithmetic over the daily closes — range, returns, drawdown and realised volatility; no model'),
    capret: (scale.dividendYield || scale.buybackYield || scale.dividendsPaid || scale.buybacks)
      && mk('xbrl', 'Dividends and buybacks are cash-flow tags over the same frame as every other figure; the yields divide them by market cap'),
    geography: geography
      && mk('geo', 'The geographical axis of the same extracted XBRL instance the segment split is read from — held to the same tie-out'),
    figures: scale.frame
      && mk('xbrl', `XBRL companyfacts on ${scale.frame} — the frame every headline figure is computed on`),
    customers: rel.customer?.length
      && mk('intel', 'Customers named on earnings calls and in filings, from the researched intel'),
    suppliers: rel.supplier?.length
      && mk('intel', 'Suppliers named on earnings calls and in filings, from the researched intel'),
    competitorsRow: rel.competitor?.length
      ? mk('intel', 'Competitors named on earnings calls, from the researched intel. The tag after a '
        + 'name is the segment the research names them against; where no segment does, it is the '
        + 'competitor\'s own filed industry (SEC SIC) — what business they are in, not where the overlap is')
      : (competitors.length ? mk('peersuggest', 'The suggester\'s ranked peers — no researched competitor '
        + 'list exists. The tag after a name is the competitor\'s own filed industry (SEC SIC)') : null),
    partners: rel.partner?.length
      && mk('intel', 'Partners named on earnings calls and in filings, from the researched intel'),
    concentration: concentration.length
      && mk('concentration', 'The share-of-revenue disclosure sentences, read from filing text',
            concentration.slice(0, 3).map((c) => c.disclosure).filter(Boolean)),
    guidance: showGuidance
      && mk('intel', `Guidance as given${outlook.lastQuarter ? ` on the ${outlook.lastQuarter} call` : ''}`),
    catalysts: showCatalysts
      && mk('intel', 'Dated events ahead, from the researched intel'),
    riskGroups: business.riskGroups?.length
      && mk('annual', 'Item 1A — the filing\'s own risk-factor grouping, in its order'),
    view: view
      && mk('note', 'The hand-written note, reproduced verbatim'),
  }).filter(([, v]) => v));

  const srcBtn = (k) => (refs[k] ? (
    <SrcButton current={sel} onSelect={setSel}
               sel={{ kind: 'line', key: k }}
               title={`Where this came from: ${refs[k].section}`} />
  ) : null);

  /* The filing trace, only when a rail metric is selected: those figures are
     arithmetic over XBRL facts, and the same provenance call the Competitors
     inspector makes can name the exact filing each fact was tagged in. Every
     other line's documents are already in the payload. */
  const { prov, state: provState } = useProvenance(
    identity.ticker || ticker, sel?.frame, sel?.kind === 'metric' && !injected);

  /* The rail is STRUCTURAL, not part of the report. It outlives every error
     state on purpose: a bad ticker must still leave a box to type a better one
     into, or the only way out is the URL. */
  const rail = (
    <CompanyRail
      view="summary"
      ticker={identity.ticker || ticker || ''}
      name={identity.name}
      sub={identity.industry}
      busy={loading}
      onSubmit={setTicker}
      note={!ticker
        ? 'No company set. Type a ticker — this surface is the orientation for the '
          + 'other Company tabs, so it is the one to read first.'
        : null}
    >
      {/* The header's own subsections, in reading order: what the businesses
          are and how big each is, then the whole company's figures. */}
      {data && !error && !drop('business') && (
        <RailSegments seg={segmentation} srcFigures={srcBtn('segmentation')} />
      )}
      {data && !error && !drop('figures') && (
        <RailMetrics years={scale.years || []} scale={scale}
                     current={sel} onSelect={setSel}
                     srcFigures={srcBtn('figures')} />
      )}
    </CompanyRail>
  );

  const shell = (body) => (
    <section className="view is-active sm-surface">
      <div className="sm-railcol">
        {!injected && <ResearchIntel ticker={ticker} onDone={() => setIntelRev((v) => v + 1)} />}
        {rail}
        {/* The source inspector lives HERE, not at the foot of the main
            column: provenance is a question asked about a line mid-read, and
            the answer has to appear without leaving the line. It needs a
            payload to exist — it names what this company's page actually drew
            on, not the surface's feeds in the abstract. */}
        {data && !error && !drop('sources') && (
          <SummaryInspector data={d} refs={refs} sel={sel} onSelect={setSel}
                            prov={prov} provState={provState}
                            ticker={injected ? '' : ticker} />
        )}
      </div>
      <div className="sm-main">{body}</div>
    </section>
  );

  if (!ticker && !injected) {
    return shell(
      <Panel title="Summary" swatch="a">
        <div className="sm-empty">
          <p><b>Nothing loaded yet.</b></p>
          <p>
            Enter a company in the box on the left. This surface reads its latest
            annual report and its XBRL history and lays out what the company does,
            how big it is, who it depends on, what it has guided to, and what its
            own filing says can go wrong — with every figure sourced, and every
            gap named rather than left as a dash.
          </p>
        </div>
      </Panel>,
    );
  }
  if (error) {
    return shell(
      <Panel title="Summary" swatch="a">
        <div className="sm-empty"><p>{error}</p></div>
      </Panel>,
    );
  }
  if (loading && !data) {
    return shell(
      <Panel title="Summary" swatch="a">
        <div className="sm-empty"><p className="loading">Reading the annual report…</p></div>
      </Panel>,
    );
  }
  if (!data) return shell(null);

  return shell(
    <>
      {/* 1 — what it does, in the filer's own words */}
      {!drop('description') && (
        <Panel title="Illustrative company profile" swatch="a"
               headExtra={(
                 <>
                   {business.filing && (
                     <a className="sm-filing" href={business.filingUrl}
                        target="_blank" rel="noopener noreferrer"
                        title="The annual report this description and these facets are read from">
                       {business.filing.form} · filed {business.filing.filed}
                     </a>
                   )}
                   {srcBtn('description')}
                 </>
               )}>
          {business.description ? (
            <blockquote className="sm-lede">
              {business.description}
              {business.truncated && <span className="sm-more">…</span>}
              <cite>
                Synthetic description for this demonstration
                {business.filing?.filed ? `, filed ${business.filing.filed}` : ''}. Not a company disclosure.
              </cite>
            </blockquote>
          ) : (
            <p className="sm-none">
              {clean(d.absent?.description) || clean(d.absent?.business)
                || 'No business description could be read from this company’s filings.'}
            </p>
          )}
          {/* The company's whole fact sheet, directly under the description it
              belongs to, as ONE quiet card: registrant identity and how it is
              built on the first grid, who it deals with on the second, split
              by a hairline. The card's tinted surface is what anchors twelve
              small facts as a unit — floated loose under the quote they read
              as clutter. "How it is built" and "Who it deals with" were their
              own panels further down the page; the facts moved up to travel
              with the summary, and the panels are gone. */}
          <div className="sm-facts">
            <dl className="sm-rows sm-fgrid sm-fgrid-a">
              <Row label="Industry" src={srcBtn('industry')}>{clean(identity.industry) || null}</Row>
              <Row label="Listed" src={srcBtn('listed')}>
                {identity.exchanges?.length ? identity.exchanges.join(', ') : null}
              </Row>
              <Row label="Segments" when={!!business.segments} src={srcBtn('segments')}>
                {business.segments && (
                  <span title={business.segments.quote
                    ? `The filing’s words: “${business.segments.quote}”` : undefined}>
                    {business.segments.names?.length
                      ? business.segments.names.join(' · ')
                      : `${business.segments.count} reportable — the filing states the count but does not enumerate them here`}
                  </span>
                )}
              </Row>
              {/* The registrant's STATED fiscal year end, which for a 52/53-week
                  filer is not the date its latest year actually closed — Micron
                  states September 3 and closed FY2025 on August 28. The actual
                  close travels with the figures' own source note, so the two are
                  each labelled for the question they answer. */}
              <Row label="Fiscal year ends" when={!!identity.fiscalYearEnd} src={srcBtn('fye')}>
                <span title="As stated in SEC's submissions record. A 52/53-week filer's actual year-end drifts around this date.">
                  {fiscalYearEnd(identity.fiscalYearEnd)} <span className="sm-q">as stated</span>
                </span>
              </Row>
              {!drop('business') && (
                <>
                  <Row label="Employees" when={!!business.employees} src={srcBtn('employees')}>
                    {business.employees && (
                      <span title={`The filing’s words: “${business.employees.quote}”`}>
                        {business.employees.approximate ? '≈' : ''}
                        {business.employees.count.toLocaleString()}
                        {business.employees.basis ? ` ${business.employees.basis}` : ''}
                        {business.employees.asOf ? `, as of ${business.employees.asOf}` : ''}
                      </span>
                    )}
                  </Row>
                  <Row label="Revenue per employee" src={srcBtn('revPerEmployee')}>
                    {scale.revenueRaw && business.employees?.count
                      ? `$${Math.round(scale.revenueRaw / business.employees.count / 1000).toLocaleString()}k`
                      : null}
                  </Row>
                  <Row label="Founded" src={srcBtn('founded')}>
                    {identity.foundedYear
                      ? `${identity.foundedYear}${identity.incorporatedIn ? ` in ${identity.incorporatedIn}` : ''}`
                      : null}
                  </Row>
                </>
              )}
              <Row label="Headquarters" when={!!identity.hq} src={srcBtn('hq')}>
                {identity.hq && [identity.hq.city, identity.hq.state].filter(Boolean).join(', ')}
              </Row>
              {/* SEC's structured field, shown when the narrative read found
                  no incorporation statement — two provenances, one fact, and
                  the row credits whichever actually answered. */}
              <Row label="Incorporated in"
                   when={!identity.foundedYear && !!identity.stateOfIncorporation}
                   src={srcBtn('incorporation')}>
                {identity.stateOfIncorporation}
              </Row>
              <Row label="Filer tier" when={!!identity.filerCategory} src={srcBtn('filer')}>
                {identity.filerCategory}
              </Row>
              <Row label="Website" when={!!identity.website}>
                {identity.website && (
                  <a href={/^https?:/.test(identity.website) ? identity.website : `https://${identity.website}`}
                     target="_blank" rel="noopener noreferrer">
                    {identity.website.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </Row>
            </dl>
            {/* The counterparty strip distributes across the card's full width
                whatever its count — a company naming three relationships gets
                three even columns, not four with a hole. */}
            {(anyDeals || anyConc) && (
              <dl className="sm-rows sm-fgrid sm-fgrid-b">
                {!drop('counterparties') && (
                  <>
                    <Row label="Customers" when={rel.customer?.length} src={srcBtn('customers')}>
                      <Names items={rel.customer} onPick={setTicker} />
                    </Row>
                    <Row label="Suppliers" when={rel.supplier?.length} src={srcBtn('suppliers')}>
                      <Names items={rel.supplier} onPick={setTicker} />
                    </Row>
                    <Row label="Competitors" when={rel.competitor?.length || competitors.length}
                         src={srcBtn('competitorsRow')}>
                      <Names
                        items={rel.competitor?.length ? rel.competitor
                          : competitors.map((c) => ({ ticker: c.ticker, name: c.name,
                              areas: c.areas, industry: c.industry, note: `Source: ${c.source}` }))}
                        onPick={setTicker} />
                    </Row>
                    <Row label="Partners" when={rel.partner?.length} src={srcBtn('partners')}>
                      <Names items={rel.partner} onPick={setTicker} />
                    </Row>
                  </>
                )}
                {/* Concentration: each disclosed share with its counterparty
                    and the filing's own sentence on hover. Share is a 0–1
                    fraction (parseShare's pct) — rendered raw it read
                    "0.16%". shareBase names the revenue LINE the share is of,
                    when it is not total revenue: CME's 12% is of clearing and
                    transaction fees, and "12%" alone would overstate it. */}
                <Row label="Concentration" when={anyConc} src={srcBtn('concentration')}>
                  {concentration.slice(0, 6).map((c, i) => (
                    <span key={(c.ticker || c.counterparty) + i} title={c.disclosure || undefined}>
                      {i > 0 && <span className="sm-sep">·</span>}
                      <b>
                        {c.approximate ? '≈' : ''}{Math.round(c.share * 100)}
                        {c.shareHigh ? `–${Math.round(c.shareHigh * 100)}` : ''}%
                      </b>
                      {' '}{c.counterparty}
                      {c.shareBase ? ` — of ${c.shareBase} revenue` : ''}
                    </span>
                  ))}
                </Row>
              </dl>
            )}
          </div>
        </Panel>
      )}

      {/* 1a — the stock, as traded: the tearsheet strip between what the
          company IS and how its revenue divides. Every figure is arithmetic
          the server did over the daily closes; a missing series renders its
          reason, and the market-cap absence renders HERE because this is the
          panel a reader would scan for a quote-dependent figure. */}
      {!drop('figures') && (
        <Panel title="The stock, as traded" swatch="a"
               headExtra={(
                 <>
                   {stock && (
                     <span className="sm-headnote">
                       last close ${stock.price.toFixed(2)} · {stock.date}
                     </span>
                   )}
                   {srcBtn('stock')}
                 </>
               )}>
          <StockPanel ticker={ticker} stock={stock} scale={scale} absent={d.absent}
                      src={null} srcCap={srcBtn('capret')} />
        </Panel>
      )}

      {/* 1b — the segment split, analysed. The AT-A-GLANCE copy lives in the
          rail as a subsection of the company header (RailSegments); this panel
          is its deep half — the profit measure by segment, margins, and the
          tie-out against consolidated revenue, which need table width the rail
          does not have. The three states are deliberate: a real split renders
          as a table; a filer that states ONE segment gets that sentence (an
          empty table would read as a failure, and "Amazon has three
          businesses, Costco has one" is itself the finding); a split that
          could not be read renders its reason. A company where none of that is
          known — no split, no narrative count, no recorded absence — draws no
          panel. */}
      {!drop('business')
        && (segmentation || business.segments || clean(d.absent?.segmentRevenue)) && (
        <Panel title="Segment revenue and profit" swatch="a"
               headExtra={(
                 <>
                   {segmentation && (
                     <span className="sm-headnote">
                       fiscal year to {segmentation.period}, as tagged in the segment note
                       {segmentation.unit && segmentation.unit !== 'USD'
                         ? ` · figures in ${segmentation.unit}, the filer's reporting currency` : ''}
                     </span>
                   )}
                   {srcBtn(segmentation ? 'segmentation' : 'segments')}
                 </>
               )}>
          {segmentation ? (
            <SegmentTable seg={segmentation} onPick={setTicker} />
          ) : business.segments?.count === 1 ? (
            <p className="sm-none"
               title={business.segments.quote
                 ? `The filing’s words: “${business.segments.quote}”` : undefined}>
              The filing states a single reportable segment — one line of business,
              so there is no revenue split to draw.
            </p>
          ) : (
            <p className="sm-none">{clean(d.absent?.segmentRevenue)
              || 'The segment split could not be read from this filing.'}</p>
          )}
        </Panel>
      )}

      {/* 1c — where revenue is earned. Same instance, same tie-out, the
          geographical axis. A filer that breaks out only some countries gets
          an explicit "not broken out" row rather than a table that quietly
          claims completeness; a split that could not be read renders its
          reason, exactly as the segment panel does. */}
      {!drop('business') && (geography || clean(d.absent?.geography)) && (
        <Panel title="Revenue by geography" swatch="a"
               headExtra={(
                 <>
                   {geography && (
                     <span className="sm-headnote">
                       fiscal year to {geography.period}, as tagged on the geographical axis
                       {geography.unit && geography.unit !== 'USD'
                         ? ` · figures in ${geography.unit}, the filer's reporting currency` : ''}
                     </span>
                   )}
                   {srcBtn('geography')}
                 </>
               )}>
          {geography ? (
            <GeoTable geo={geography} />
          ) : (
            <p className="sm-none">{clean(d.absent?.geography)}</p>
          )}
        </Panel>
      )}

      {/* 2 & 3 — scale, profitability, balance sheet, price: MOVED TO THE RAIL.
          The figure deck lives under the company name now (RailMetrics); the
          src button beside its year selector traces the frame the figures are
          computed on. What remains here is the failure case: when the figures
          could not be computed at all, the reason renders in the main column,
          because an empty rail block with no explanation reads as a glitch. */}
      {!drop('figures') && !scale.frame && clean(d.absent?.figures) && (
        <p className="sm-none">{clean(d.absent.figures)}</p>
      )}

      {/* 4 & 5 — "How it is built" and "Who it deals with": FOLDED INTO THE
          TOP PANEL. Their rows render under the business description now, as
          one fact sheet with the registrant identity, so the panels are gone.
          (The absences panel is gone too, by request — a fact the route could
          not establish simply renders no row.) */}

      <div className="sm-band">
        {/* 6 — what happens next */}
        {(showGuidance || showCatalysts) && (
          <Panel swatch="b"
                 title={showGuidance && showCatalysts ? 'What happens next'
                   : showGuidance ? 'Guidance' : 'Catalysts'}>
            {showGuidance && (
              <p className="sm-p">
                <span className="sm-k">Guidance</span> {srcBtn('guidance')} {outlook.guidance}
                {outlook.lastQuarter && <span className="sm-q"> — {outlook.lastQuarter}</span>}
              </p>
            )}
            {showCatalysts && (
              <>
                <ul className="sm-cats">
                  {outlook.catalysts.map((c, i) => (
                    <li key={c.date + i}><time>{c.date}</time><span>{c.event}</span></li>
                  ))}
                </ul>
                <p className="sm-foot">{srcBtn('catalysts')} dated events from the researched intel</p>
              </>
            )}
          </Panel>
        )}

        {/* 7 — what management says can go wrong, in management's own grouping */}
        {!drop('risks') && business.riskGroups?.length > 0 && (
          <Panel title="What the filing says can go wrong" swatch="b"
                 headExtra={(
                   <>
                     <span className="sm-headnote">its own grouping, in its order</span>
                     {srcBtn('riskGroups')}
                   </>
                 )}>
            <ul className="sm-risks">
              {business.riskGroups.map((g, i) => <li key={g + i}>{g}</li>)}
            </ul>
          </Panel>
        )}
      </div>

      {/* 8 — the one part no model wrote */}
      {!drop('view') && view && (
        <Panel title="Our view" swatch="a"
               headExtra={(
                 <>
                   <span className="sm-headnote">
                     hand-written, never generated
                     {view.asOf ? ` · as of ${view.asOf}` : ''}
                     {view.sample ? ' · flagged sample' : ''}
                   </span>
                   {srcBtn('view')}
                 </>
               )}>
          {/* The claim on the left, the tests of the claim on the right. Prose is
              measure-limited, so one column in a full-width panel left half the
              panel empty; this is also the more useful reading — a thesis and
              the things that would kill it belong side by side. */}
          <div className="sm-two">
            <div>
              {view.thesis && <p className="sm-p"><span className="sm-k">Thesis</span> {view.thesis}</p>}
              {view.moat && <p className="sm-p"><span className="sm-k">Moat</span> {view.moat}</p>}
              {view.target && (
                <p className="sm-p">
                  <span className="sm-k">Targets</span>
                  bear {view.target.bear} · base {view.target.base} · bull {view.target.bull}
                  {view.conviction != null && <> · conviction {view.conviction} of 5</>}
                </p>
              )}
              {view.verdict && <p className="sm-p"><span className="sm-k">Verdict</span> {view.verdict}</p>}
            </div>
            <div>
              {view.falsify?.length > 0 && (
                <>
                  <h4 className="sm-sh">What would make this wrong</h4>
                  <ul className="sm-risks">{view.falsify.map((f, i) => <li key={i}>{f}</li>)}</ul>
                </>
              )}
              {view.risks?.length > 0 && (
                <>
                  <h4 className="sm-sh">Risks we wrote down</h4>
                  <ul className="sm-risks">{view.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </>
              )}
            </div>
          </div>
        </Panel>
      )}

      {/* Provenance closed the page here once. It is the sidebar's job now —
          "Where every line came from" sits under the rail, counts how many
          lines each document supplied, and opens the exact section on any
          line's `src` press — so the main column ends on the analysis. */}
    </>,
  );
}

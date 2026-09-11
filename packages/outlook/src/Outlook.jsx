/* Risks & Catalysts — what could move this company, in two voices kept apart.
 *
 * The company's voice is filings, verbatim: its 10-K risk-factor headings, its
 * quarterly affirmation or update of them, and the guidance and dated events
 * from the researched earnings intel. The street's voice is IBES consensus
 * (numbers, licensed, point-in-time) and headline searches (leads, linked,
 * never presented as facts). Every claim on this surface carries the thing it
 * came from — a filing URL, the intel file and its 8-K, an article link — and
 * a half that failed says so rather than rendering as empty.
 *
 * THE SECTION MODEL. Each block is a Section: a voice chip saying WHOSE claim
 * it is, a one-line summary that stays visible when the body is collapsed,
 * and a caret to collapse it. Clicking a section header FOCUSES it, and the
 * rail's "Section sources" panel answers for the focused section — the same
 * question the shell's Sources panel answers for the surface, but per block
 * and per fetch, with the exact filing each block was built from. The focused
 * section rides the hash (`&sec=risks`) so a reader can link "look at the
 * street's side of NVDA" and the headless screenshotter can photograph it.
 *
 * Layout is the Company group's Console: sticky rail with the input and the
 * provenance, results to the right.
 */
import { useEffect, useState } from 'react';
import { useApp } from '@markets/shell/lib/store.jsx';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';
import { hashParam, hashView } from '@markets/shell/lib/hash.js';
import { useRegistry } from '@markets/shell/lib/registry.jsx';
import { Panel } from '@markets/shell/components/Panel.jsx';
import { SourceInspector, SrcButton } from '@markets/shell/components/SourceInspector.jsx';
import { CompanyRail } from '@markets/shell/components/CompanyRail.jsx';
import { pinEntry } from '@markets/shell/lib/pins.js';
import { describe, sourcesFor, defaultRows } from './outlookSources.js';

/* The web aggregators' consensus is its own fetch: seven third-party sites
   answer on their own clocks, and the filings payload must not wait for them.
   Render checks inject the outlook payload only, so `injected` short-circuits
   this hook to its honest-empty state instead of fetching. */
function useAnalysts(ticker, nonce, injected) {
  const [s, setS] = useState({ data: null, loading: !injected && !!ticker, error: null });
  useEffect(() => {
    if (injected || !ticker) return;
    let live = true;
    setS({ data: null, loading: true, error: null });
    fetch(`/api/outlook/analysts?ticker=${encodeURIComponent(ticker)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then((d) => live && setS({ data: d, loading: false, error: null }))
      .catch((e) => live && setS({ data: null, loading: false, error: e.message }));
    return () => { live = false; };
  }, [ticker, nonce, injected]);
  return s;
}

function useOutlook(ticker, nonce, injected) {
  const [s, setS] = useState({ data: injected || null, loading: !injected, error: null });
  useEffect(() => {
    if (injected || !ticker) return;
    let live = true;
    setS((p) => ({ ...p, loading: true }));
    fetch(`/api/outlook?ticker=${encodeURIComponent(ticker)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then((d) => live && setS({ data: d, loading: false, error: null }))
      .catch((e) => live && setS({ data: null, loading: false, error: e.message }));
    return () => { live = false; };
  }, [ticker, nonce, injected]);
  return s;
}

const day = (d) => (d ? String(d).slice(0, 10) : null);

const VOICE = {
  company: { chip: 'company', word: 'the company, verbatim' },
  street: { chip: 'street', word: 'the street' },
};

function FilingLink({ f, children }) {
  if (!f?.url) return children || null;
  return (
    <a href={f.url} target="_blank" rel="noreferrer"
       title={f.accn ? `Accession ${f.accn}` : undefined}>
      {children || `${f.form} filed ${f.filed}`}
    </a>
  );
}

/* ---- section bodies ------------------------------------------------------ */
/* Bodies only — the Section wrapper below owns every header, summary line and
   collapse. A body renders its own honest-empty states, because "we could not
   read it" and "there is nothing" are different sentences. */

/* Collapsed rows show the model-written gist; expanding shows the verbatim
   heading. Clip is the fallback while gists write (or if they fail): the
   opening words of the real heading, never an invented line. */
const clip = (t) => (t.length > 96 ? `${t.slice(0, 96).replace(/\s+\S*$/, '')}…` : t);

function RiskBody({ risks, foreignAnnual, ticker, pick }) {
  /* Hooks before the early returns — the render path must not change hook
     order between a refused payload and a full one. */
  const accn = risks?.filing?.accn;
  const haveHeadings = !!risks?.headings;
  const [gists, setGists] = useState(null);            // { index: gist }
  const [gistState, setGistState] = useState('loading'); // loading | ready | failed
  const [open, setOpen] = useState(() => new Set());
  useEffect(() => {
    if (!ticker || !haveHeadings) return;
    let live = true;
    setGists(null);
    setGistState('loading');
    setOpen(new Set());
    fetch(`/api/outlook/risk-gists?ticker=${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (live) { setGists(d.gists || {}); setGistState('ready'); } })
      .catch(() => { if (live) setGistState('failed'); });
    return () => { live = false; };
  }, [ticker, accn, haveHeadings]);

  if (foreignAnnual && !risks?.headings) {
    return (
      <p className="rc-foot">
        This registrant files a {foreignAnnual.form}, which keeps its risk factors in
        Item 3.D — and that section could not be located in this filing's markup.
        Rather than half-extract it: <FilingLink f={foreignAnnual} />{' '}
        <SrcButton sel={{ kind: 'foreign', key: 'foreign' }}
                   current={pick.sel} onSelect={pick.onSelect} />.
      </p>
    );
  }
  if (!risks) return <div className="rc-empty">No 10-K in the submissions index read.</div>;
  if (!risks.headings) {
    return (
      <p className="rc-foot">
        The Item 1A section could not be located in this filing's markup — which is a
        statement about this extractor, not about the company's risks. They are in{' '}
        <FilingLink f={risks.filing} />, unread here.
      </p>
    );
  }
  // The nearest group heading above each risk, threaded into its sel so the
  // inspector can state which group the company filed it under.
  let group = null;
  const riskIdx = risks.headings.map((h, i) => (h.group ? null : i)).filter((i) => i != null);
  const allOpen = riskIdx.every((i) => open.has(i));
  const toggle = (i) => setOpen((p) => {
    const n = new Set(p);
    if (n.has(i)) n.delete(i); else n.add(i);
    return n;
  });
  return (
    <>
      {foreignAnnual && (
        <p className="rc-warn" role="alert">
          <b>⚠ Foreign-filer extraction.</b> This registrant files a {foreignAnnual.form},
          not a 10-K: these headings were sliced from Item 3.D (“Key Information — Risk
          Factors”), a structure this extractor reads more recently and with less mileage
          than the 10-K's Item 1A. Every line is still verbatim, but verify coverage
          against the filing itself: <FilingLink f={foreignAnnual} />{' '}
          <SrcButton sel={{ kind: 'foreign', key: 'foreign' }}
                     current={pick.sel} onSelect={pick.onSelect} />
        </p>
      )}
      <div className="rc-riskbar">
        <button type="button" className="rc-riskbar-btn"
                onClick={() => setOpen(allOpen ? new Set() : new Set(riskIdx))}>
          {allOpen ? '▸ Collapse all' : '▾ Expand all'}
        </button>
        <span className="rc-riskbar-note">
          {gistState === 'loading' ? '✦ writing one-line gists…'
            : gistState === 'failed' ? 'gists unavailable — rows show the headings’ opening words'
            : '✦ gists are model-written; expand any row for the verbatim heading'}
        </span>
      </div>
      <ul className="rc-risks">
        {risks.headings.map((h, i) => {
          if (h.group) { group = h.text; return <li key={i} className="rc-group">{h.text}</li>; }
          const isOpen = open.has(i);
          const gist = gists?.[i];
          return (
            <li key={i} className="rc-risk">
              <button type="button" className="rc-risk-toggle" aria-expanded={isOpen}
                      title={isOpen ? 'Collapse to the one-line gist' : 'Expand to the verbatim heading'}
                      onClick={() => toggle(i)}>
                <span className="rc-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                {!isOpen && (
                  <span className="rc-gist">
                    {gist ? <><span className="rc-gist-m" aria-hidden="true">✦</span>{gist}</> : clip(h.text)}
                  </span>
                )}
                {isOpen && <span className="rc-risk-t">{h.text}</span>}
              </button>
              <SrcButton sel={{ kind: 'risk', key: `risk:${i}`, text: h.text, quote: h.text, group }}
                         current={pick.sel} onSelect={pick.onSelect} />
              <FilingLink f={risks.filing}>
                <span className="rc-cite">{risks.filing.form}</span>
              </FilingLink>
            </li>
          );
        })}
      </ul>
      <p className="rc-foot">
        Each expanded row is the company's own heading for one risk factor, copied{' '}
        <b>character for character</b> from <FilingLink f={risks.filing} /> — found by
        formatting (the headings a filer sets off in bold, italic or a heading colour),
        not by a model. The collapsed ✦ gists are the one exception: model-written
        compressions for scanning, never a substitute for the heading beneath them.
        The prose under each heading is in the filing, deliberately not reproduced here.
        {risks.strategy === 'title' && risks.filing.form === '10-K' && (
          <> This issuer files a redesigned 10-K with no “Item 1A” heading in the body,
          so the section was located by its chapter title instead.</>
        )}
        {risks.strategy === 'title' && risks.filing.form !== '10-K' && (
          <> This filing heads the section bare “Risk Factors” with no “D.” letter,
          so it was located by its chapter title instead.</>
        )}
        {risks.truncated && <> The list was capped; the filing carries more.</>}
      </p>
    </>
  );
}

function UpdateBody({ update, pick }) {
  if (update.affirmsAnnual) {
    return (
      <p className="rc-foot">
        In <FilingLink f={update.filing} />, Part II Item 1A <b>affirms the annual
        risk factors rather than adding to them</b> — the quarterly re-statement that
        the 10-K risks stand. That sentence is the disclosure; it is linked rather
        than paraphrased.{' '}
        <SrcButton sel={{ kind: 'update', key: 'update:affirm', affirm: true }}
                   current={pick.sel} onSelect={pick.onSelect} />
      </p>
    );
  }
  if (update.headings?.length) {
    let group = null;
    return (
      <>
        <ul className="rc-risks rc-risks-q">
          {update.headings.map((h, i) => {
            if (h.group) { group = h.text; return <li key={i} className="rc-group">{h.text}</li>; }
            return (
              <li key={i} className="rc-risk">
                <span className="rc-risk-t">{h.text}</span>
                <SrcButton sel={{ kind: 'update', key: `update:${i}`, text: h.text, quote: h.text, group }}
                           current={pick.sel} onSelect={pick.onSelect} />
                <FilingLink f={update.filing}><span className="rc-cite">10-Q</span></FilingLink>
              </li>
            );
          })}
        </ul>
        <p className="rc-foot">
          New or restated risk headings in <FilingLink f={update.filing} />, Part II
          Item 1A — a quarter in which the company chose to change its own risk
          statement, which is itself information.
        </p>
      </>
    );
  }
  return (
    <p className="rc-foot">
      <FilingLink f={update.filing} /> was read but its Part II Item 1A neither
      matched the affirmation dialects nor yielded headings — open the filing;
      this surface declines to guess which it is.
    </p>
  );
}

function CatalystsBody({ c, ticker, pick }) {
  if (!c) {
    return (
      <p className="rc-foot">
        No researched earnings intel on this machine for {ticker} — this half comes
        from <code>data/earnings/{ticker}.json</code>, which is produced by{' '}
        <code>npm run refresh -- {ticker}</code> (headless Claude over the
        transcripts and filings, at real cost) and read here, never regenerated.
      </p>
    );
  }
  const eightK = c.sources?.resultsEightK;
  return (
    <>
      {c.guidance && (
        <div className="rc-guidance">
          <span className="rc-guidance-k">
            Guidance · {c.quarter}{' '}
            <SrcButton sel={{ kind: 'guidance', key: 'guidance', quote: c.guidance, quarter: c.quarter }}
                       current={pick.sel} onSelect={pick.onSelect} />
          </span>
          <p>{c.guidance}</p>
          <span className="rc-guidance-src">
            Given with the {c.quarter} results
            {eightK
              ? <> — <a href={eightK.url} target="_blank" rel="noreferrer">8-K filed {eightK.filed}</a>
                  {eightK.items ? ` (items ${eightK.items})` : ''}</>
              : c.reportDate ? <> on {c.reportDate}</> : null}.
          </span>
        </div>
      )}
      {c.items.length > 0 && (
        <table className="rc-table">
          <thead><tr><th className="rc-l">When</th><th className="rc-l">What the company has put on the calendar</th></tr></thead>
          <tbody>
            {c.items.map((x, i) => (
              <tr key={i}>
                <td className="rc-l rc-when">{x.date}</td>
                <td className="rc-l">
                  {x.event}{' '}
                  <SrcButton sel={{ kind: 'catalyst', key: `cat:${i}`, date: x.date, event: x.event,
                                     quote: `${x.date} — ${x.event}` }}
                             current={pick.sel} onSelect={pick.onSelect} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="rc-foot">
        From the researched earnings intel of <b>{c.asOf}</b> —{' '}
        <code>data/earnings/{ticker}.json</code>, drawn from the company's own calls and
        filings
        {eightK && <>, primarily <a href={eightK.url} target="_blank" rel="noreferrer">the results 8-K</a></>}
        {c.sources?.tenQ?.url && <> and <a href={c.sources.tenQ.url} target="_blank" rel="noreferrer">the 10-Q filed {c.sources.tenQ.filed}</a></>}.
        Dates the company itself named, <b>kept as soft as the company gave them</b> —
        a range like “H2 2026” is guidance-grade language, not a calendar entry, so it
        is shown here as a range. Anything since {c.asOf} is not in this file, and the
        file is read rather than re-researched on load.
        {c.sources?.ir && <> Investor relations: <a href={c.sources.ir} target="_blank" rel="noreferrer">{c.sources.ir.replace(/^https?:\/\/|\/$/g, '')}</a>.</>}
      </p>
    </>
  );
}

const est = (v) => (v == null ? '—' : Number(v).toFixed(2));

function ConsensusBody({ c }) {
  if (!c?.available) {
    return (
      <p className="rc-foot">
        Consensus is unavailable right now: {c?.why || 'unknown'}. The numbers live in
        the insider service's DuckDB (<code>estimates</code> table), loaded by{' '}
        <code>python -m insider.synthetic sample_ibes</code> on the Princeton network.
      </p>
    );
  }
  if (!c.covered) {
    return (
      <p className="rc-foot">
        IBES is loaded on this machine but carries no rows for this ticker — the pull
        covers named tickers, so this means "not pulled", not "not covered by
        analysts". <code>python -m insider.synthetic sample_ibes --tickers &lt;T&gt;</code> adds it
        (Princeton VPN off campus).
      </p>
    );
  }
  const pending = c.rows.filter((r) => r.actual == null);
  const reported = c.rows.filter((r) => r.actual != null);
  const Row = (r, i) => (
    <tr key={i} className={r.actual == null ? 'is-pending' : ''}>
      <td className="rc-l rc-num">{day(r.periodEnd)}</td>
      <td className="rc-l">{r.measure}{r.fpi ? <span className="rc-dim"> · {r.fpi}</span> : null}</td>
      <td className="rc-num">{est(r.meanEst)}</td>
      <td className="rc-num" title={r.thin ? 'Fewer than 4 estimates — two analysts disagreeing is not a consensus' : undefined}>
        {r.numEst ?? '—'}{r.thin && <span className="rc-thin">thin</span>}
      </td>
      <td className="rc-num">{est(r.actual)}</td>
      <td className={'rc-num ' + (r.surprisePct > 0 ? 'is-up' : r.surprisePct < 0 ? 'is-down' : '')}>
        {r.surprisePct == null ? '—' : `${(r.surprisePct * 100).toFixed(1)}%`}
      </td>
    </tr>
  );
  return (
    <>
      <table className="rc-table">
        <thead>
          <tr><th className="rc-l">Period end</th><th className="rc-l">Measure</th>
              <th>Mean est.</th><th>#</th><th>Actual</th><th>Surprise</th></tr>
        </thead>
        <tbody>{[...pending, ...reported].map(Row)}</tbody>
      </table>
      <p className="rc-foot">
        What analysts collectively expect, as numbers: IBES street estimates via
        Princeton's synthetic sample subscription, from the insider service's database. Rows are
        point-in-time — each carries the last consensus snapshot <b>before</b> the
        announcement beside what was then reported, so the surprise compares IBES to
        IBES, never a street number to a GAAP one. Rows without an actual are the
        street's current expectation. As current as the last pull; not refreshed on load.
      </p>
    </>
  );
}

function PressBody({ items, ok, searchUrl, searchedAs, what, which, pick }) {
  return (
    <>
      {items.length ? (
        <ul className="rc-stories">
          {items.map((n, i) => (
            <li key={i}>
              <a href={n.url} target="_blank" rel="noreferrer">{n.title}</a>
              <span className="rc-story-m">
                {n.source}{n.date ? ` · ${day(n.date)}` : ''}{' '}
                <SrcButton sel={{ kind: 'story', key: `story:${which}:${i}`, item: n, which, quote: n.title }}
                           current={pick.sel} onSelect={pick.onSelect} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rc-empty">
          {ok ? `No ${what} headlines naming “${searchedAs}” found.`
              : 'The headline search did not answer, so this half is unknown rather than empty.'}
        </div>
      )}
      <p className="rc-foot">
        Google News headline search for {what}, filtered to stories that name{' '}
        “{searchedAs}” in the headline itself — the same rule as Management's press
        panel, and the same caveat: these are third parties writing about the company,
        surfaced by a search engine. <b>Leads, not facts</b> — each is linked so the
        argument can be read where it was made.{' '}
        <a href={searchUrl} target="_blank" rel="noreferrer">Run the search yourself →</a>
      </p>
    </>
  );
}

/* ---- ratings across the web ---------------------------------------------- */

/* The five count buckets in scale order, sharing the validated --rate-N ramp.
   Green and red steps are never adjacent — Hold sits between them — and every
   sub-3:1 step carries its count as a direct label, which is the relief the
   palette's validator run requires. */
const BUCKETS = [
  ['strongBuy', 'Strong Buy', 1], ['buy', 'Buy', 2], ['hold', 'Hold', 3],
  ['sell', 'Sell', 4], ['strongSell', 'Strong Sell', 5],
];
const BANDS = ['Strong Buy', 'Buy', 'Hold', 'Underperform', 'Sell'];
const bandOf = (s) => Math.min(5, Math.max(1, Math.round(s)));
const fmt$ = (v) => (v == null ? '—' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);

/**
 * The aggregate on the scale it lives on: a five-band 1–5 meter, the mean as
 * a pin above it, and one dot per source at its own score — so "they broadly
 * agree" and "one aggregator dissents" are both visible without a number
 * being read. Bands are position-labelled below; identity is never
 * colour-alone.
 */
function RatingMeter({ agg, sources }) {
  const pos = (s) => `${((Math.min(5, Math.max(1, s)) - 1) / 4) * 100}%`;
  const scored = sources.filter((s) => s.ok && Number.isFinite(s.score5));
  return (
    <div className="rc-meter">
      <div className="rc-meter-hero">
        <span className="rc-meter-score">{agg.score5.toFixed(1)}</span>
        <span className={`rc-meter-word is-r${bandOf(agg.score5)}`}>{agg.label}</span>
        <span className="rc-meter-sub">mean of {agg.of} sources</span>
      </div>
      <div className="rc-meter-plot">
        <div className="rc-meter-dots">
          {scored.map((s) => (
            <span key={s.id} className="rc-meter-dot" style={{ left: pos(s.score5) }}
                  title={`${s.name}: ${s.score5.toFixed(2)}`} />
          ))}
        </div>
        <div className="rc-meter-track">
          {[1, 2, 3, 4, 5].map((i) => <i key={i} className={`rc-meter-seg is-r${i}`} />)}
          <span className="rc-meter-pin" style={{ left: pos(agg.score5) }}
                title={`Aggregate ${agg.score5.toFixed(2)} of 5`} />
        </div>
        <div className="rc-meter-scale">
          {BANDS.map((b) => <span key={b}>{b}</span>)}
        </div>
      </div>
    </div>
  );
}

/**
 * The recommendation trend, Yahoo's chart redrawn honestly: one stacked bar
 * per month, Strong Buy at the baseline, a 2px surface seam between
 * segments, the month's analyst total on top, and counts written into any
 * segment tall enough to hold one. A three-bucket source (Nasdaq's history)
 * is drawn with its folded buckets and SAYS so, rather than drawing false
 * strong-conviction segments.
 */
function TrendChart({ trend }) {
  const W = 560, H = 210, PLOT = 168, PAD = 26;
  const months = trend.months;
  const max = Math.max(1, ...months.map((m) => BUCKETS.reduce((s, [k]) => s + (m[k] || 0), 0)));
  const slot = (W - PAD) / months.length;
  const bar = Math.min(34, slot - 8);
  const buckets = trend.buckets === 3 ? BUCKETS.filter(([k]) => ['buy', 'hold', 'sell'].includes(k)) : BUCKETS;
  const everyNth = months.length > 8 ? 2 : 1;
  return (
    <figure className="rc-trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`Analyst recommendation counts by month, via ${trend.source}`}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PAD} x2={W} y1={12 + PLOT * (1 - f)} y2={12 + PLOT * (1 - f)}
                style={{ stroke: 'var(--chart-grid)' }} />
        ))}
        <text x={PAD - 5} y={16} textAnchor="end" className="rc-trend-axis">{max}</text>
        <text x={PAD - 5} y={12 + PLOT} textAnchor="end" className="rc-trend-axis">0</text>
        {months.map((m, i) => {
          const x = PAD + i * slot + (slot - bar) / 2;
          const total = BUCKETS.reduce((s, [k]) => s + (m[k] || 0), 0);
          let y = 12 + PLOT;
          const segs = buckets.map(([k, name, n]) => {
            const h = ((m[k] || 0) / max) * PLOT;
            y -= h;
            return { k, name, n, count: m[k] || 0, x, y, h };
          });
          return (
            <g key={m.label + i}>
              {segs.filter((s) => s.h > 0).map((s) => (
                <rect key={s.k} x={s.x} y={s.y + 1} width={bar} height={Math.max(1, s.h - 2)}
                      rx="1.5" className={`rc-trend-seg is-r${s.n}`}>
                  <title>{`${m.label} — ${s.name}: ${s.count} of ${total}`}</title>
                </rect>
              ))}
              {segs.filter((s) => s.h >= 14).map((s) => (
                <text key={`t${s.k}`} x={s.x + bar / 2} y={s.y + s.h / 2 + 3.5}
                      textAnchor="middle" className={`rc-trend-count is-r${s.n}`}>{s.count}</text>
              ))}
              <text x={x + bar / 2} y={Math.min(12 + PLOT, 12 + PLOT - (total / max) * PLOT) - 4}
                    textAnchor="middle" className="rc-trend-total">{total}</text>
              {i % everyNth === 0 && (
                <text x={x + bar / 2} y={H - 6} textAnchor="middle" className="rc-trend-axis">{m.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="rc-trend-legend">
        {buckets.map(([k, name, n]) => (
          <span key={k} className="rc-trend-chip"><i className={`rc-rate-dot is-r${n}`} />{name}</span>
        ))}
        {trend.buckets === 3 && (
          <span className="rc-trend-chip rc-dim">strong ratings folded in by the source</span>
        )}
      </figcaption>
    </figure>
  );
}

function WebRatingsBody({ web, pick }) {
  if (web.loading) return <div className="rc-empty">Asking seven aggregators, live…</div>;
  if (web.error) return <div className="rc-empty">The aggregators could not be asked: {web.error}</div>;
  const a = web.data;
  if (!a) return <div className="rc-empty">Not fetched in this render.</div>;
  const answered = a.sources.filter((s) => s.ok);
  const zacks = a.sources.find((s) => s.id === 'zacks');
  return (
    <>
      {a.aggregate
        ? <RatingMeter agg={a.aggregate} sources={a.sources} />
        : <p className="rc-foot">Fewer than two aggregators produced a score just now — the rows
            below stand on their own, and one aggregator is a quote, not an aggregate.</p>}
      <table className="rc-table rc-web-table">
        <thead>
          <tr><th className="rc-l">Source</th><th className="rc-l">Rating</th>
              <th>1–5</th><th>#</th><th>Target</th><th aria-label="trace" /></tr>
        </thead>
        <tbody>
          {a.sources.map((s) => (s.ok ? (
            <tr key={s.id}>
              <td className="rc-l">
                <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>
              </td>
              <td className="rc-l">
                {Number.isFinite(s.score5) && <i className={`rc-rate-dot is-r${bandOf(s.score5)}`} />}
                {s.sourceLabel || '—'}
              </td>
              <td className="rc-num" title={s.basis}>{Number.isFinite(s.score5) ? s.score5.toFixed(2) : '—'}</td>
              <td className="rc-num">{s.analysts ?? '—'}</td>
              <td className="rc-num">{fmt$(s.priceTarget)}</td>
              <td className="rc-num">
                <SrcButton sel={{ kind: 'webrating', key: `web:${s.id}`, id: s.id,
                                  quote: `${s.name} on ${a.ticker}: ${s.sourceLabel || '—'}${Number.isFinite(s.score5) ? ` (${s.score5.toFixed(2)} on 1–5)` : ''}${s.analysts ? `, ${s.analysts} analysts` : ''}` }}
                           current={pick.sel} onSelect={pick.onSelect} />
              </td>
            </tr>
          ) : (
            <tr key={s.id} className="rc-web-dead">
              <td className="rc-l"><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a></td>
              <td className="rc-l rc-dim" colSpan={5}>did not answer — {s.why}</td>
            </tr>
          )))}
        </tbody>
      </table>
      {a.changes.length > 0 && (
        <ul className="rc-web-changes">
          {a.changes.map((c, i) => (
            <li key={i}>
              <span className="rc-when">{c.date}</span> {c.firm}
              {c.action ? ` — ${c.action}` : ''}{c.from ? ` ${c.from} →` : ''}{c.to ? ` ${c.to}` : ''}
              <span className="rc-dim"> · {c.source}</span>
            </li>
          ))}
        </ul>
      )}
      {zacks?.ok && zacks.monthAgo && (
        <p className="rc-foot">
          Movement, where a source states it: Zacks' ABR was {zacks.monthAgo.score5.toFixed(2)} a
          month ago on {zacks.monthAgo.analysts} recommendations, {zacks.score5.toFixed(2)} now
          on {zacks.analysts} — {zacks.monthAgo.score5 > zacks.score5 ? 'the street has firmed'
            : zacks.monthAgo.score5 < zacks.score5 ? 'the street has softened' : 'unchanged'}.
        </p>
      )}
      {a.trend && <TrendChart trend={a.trend} />}
      <p className="rc-foot">
        {answered.length} of {a.sources.length} public aggregators answered when this page loaded
        (cached {a.ttlMinutes} min; as of {String(a.asOf).slice(0, 16).replace('T', ' ')} UTC).
        Every score is normalised onto the 1–5 scale — 1 Strong Buy, 5 Strong Sell — by the rule
        each row's <i>src</i> button states, and the aggregate is the <b>unweighted mean</b> of the
        sources' scores: these aggregators largely count the same sell-side analysts, so weighting
        by analyst count would double-count the big houses. The trend is {a.trend
          ? <> {a.trend.source === 'stockanalysis' ? 'StockAnalysis' : a.trend.source === 'yahoo' ? 'Yahoo Finance' : 'Nasdaq'}'s
              own month-by-month counts, <a href={a.trend.url} target="_blank" rel="noreferrer">readable where it was published</a></>
          : 'unavailable from every source that answered'}.
        Aggregator pages, not primary documents — the licensed point-in-time numbers are the IBES
        section above.
      </p>
    </>
  );
}

/* ---- the section registry ------------------------------------------------ */

/**
 * One entry per block: whose claim it is, what to say about it in one line
 * while it is collapsed, and its body. Built from the payload so the summaries
 * state facts ("22 risks, 10-K filed 2026-01-23"), not descriptions ("the risk
 * factors section"). Per-claim provenance lives on the src buttons inside each
 * body (outlookSources.js answers for them in the rail); the consensus table
 * is one claim, so its button sits on the section head as `srcSel`.
 */
function buildSections(d, pick, web) {
  const out = [];
  const risks = d.company.risks;
  const nRisks = risks?.headings ? risks.headings.filter((h) => !h.group).length : null;

  const foreign = d.company.foreignAnnual;
  out.push({
    id: 'risks', voice: 'company', swatch: 'a',
    title: foreign ? `Risk factors — ${foreign.form} Item 3.D` : 'Risk factors — 10-K Item 1A',
    count: nRisks,
    blurb: foreign
      ? (risks?.headings
          ? `⚠ ${nRisks} risks verbatim from the ${foreign.form} filed ${risks.filing.filed} — foreign-filer extraction, read the warning`
          : `foreign filer — the ${foreign.form}'s Item 3.D resisted extraction; the filing is linked instead`)
      : !risks ? 'no 10-K read'
      : !risks.headings ? 'section not located in the filing markup — the filing is linked instead'
      : `${nRisks} risks in the company's own words, verbatim from the 10-K filed ${risks.filing.filed}`,
    body: <RiskBody risks={risks} foreignAnnual={foreign} ticker={d.ticker} pick={pick} />,
  });

  const update = d.company.update;
  if (update) {
    out.push({
      id: 'update', voice: 'company', swatch: 'b',
      title: 'Since the 10-K — the latest 10-Q on its own risks',
      count: update.headings?.length || null,
      blurb: update.affirmsAnnual
        ? `10-Q filed ${update.filing.filed}: the annual risks stand, affirmed rather than amended`
        : update.headings?.length
          ? `${update.headings.filter((h) => !h.group).length} new or restated headings in the 10-Q filed ${update.filing.filed}`
          : `10-Q filed ${update.filing.filed} read, but its Item 1A resisted classification — linked`,
      body: <UpdateBody update={update} pick={pick} />,
    });
  }

  const c = d.company.catalysts;
  out.push({
    id: 'catalysts', voice: 'company', swatch: 'c',
    title: 'Catalysts and guidance',
    count: c?.items?.length ?? null,
    blurb: c
      ? `${c.guidance ? 'guidance plus ' : ''}${c.items.length} dated events the company itself named — intel of ${c.asOf}`
      : 'no researched earnings intel for this ticker on this machine',
    body: <CatalystsBody c={c} ticker={d.ticker} pick={pick} />,
  });

  const ib = d.street.consensus;
  out.push({
    id: 'consensus', voice: 'street', swatch: 'a',
    title: 'Consensus — IBES via synthetic sample',
    count: ib?.covered ? ib.totalRows : null,
    srcSel: { kind: 'consensus', key: 'consensus' },
    blurb: !ib?.available
      ? 'unavailable — the insider service did not answer'
      : !ib.covered
        ? 'IBES is loaded here, but this ticker is not in the pull — absence of data, not of coverage'
        : `${ib.totalRows} periods of street estimates, ${ib.rows.filter((r) => r.actual == null).length} still pending — the licensed numbers`,
    body: <ConsensusBody c={ib} />,
  });

  const wa = web?.data;
  const agg = wa?.aggregate;
  const okN = wa ? wa.sources.filter((s) => s.ok).length : null;
  out.push({
    id: 'web', voice: 'street', swatch: 'a',
    title: 'Ratings across the web',
    count: okN,
    srcSel: wa ? {
      kind: 'webagg', key: 'webagg',
      quote: agg
        ? `The web's analyst consensus on ${wa.ticker}: ${agg.label} — ${agg.score5.toFixed(2)} on 1–5, the mean of ${agg.of} aggregators`
        : `${okN} of ${wa.sources.length} aggregators answered for ${wa.ticker}; too few scored for an aggregate`,
    } : undefined,
    blurb: web?.loading ? 'asking seven public aggregators, live'
      : web?.error ? `the aggregators could not be asked — ${web.error}`
      : !wa ? 'not fetched'
      : agg ? `${agg.score5.toFixed(1)} on 1–5 — ${agg.label}, the mean of ${agg.of} of ${wa.sources.length} aggregators, each traced`
      : `${okN} of ${wa.sources.length} aggregators answered — too few scored for an aggregate`,
    body: <WebRatingsBody web={web || { loading: false, error: null, data: null }} pick={pick} />,
  });

  out.push({
    id: 'actions', voice: 'street', swatch: 'b',
    title: 'Rating actions in the press',
    count: d.street.actions.length,
    blurb: d.street.actionsOk
      ? d.street.actions.length
        ? `${d.street.actions.length} headlines — upgrades, downgrades and price targets, newest ${day(d.street.actions[0]?.date) || '—'}`
        : 'the search answered and found nothing naming the company'
      : 'the headline search did not answer — unknown, not empty',
    body: <PressBody items={d.street.actions} ok={d.street.actionsOk}
                     searchUrl={d.street.queries.actions} searchedAs={d.street.searchedAs}
                     what="upgrades, downgrades and price-target moves"
                     which="actions" pick={pick} />,
  });

  out.push({
    id: 'debate', voice: 'street', swatch: 'c',
    title: 'The debate',
    count: d.street.debate.length,
    blurb: d.street.debateOk
      ? d.street.debate.length
        ? `${d.street.debate.length} headlines arguing the bull and bear cases, newest ${day(d.street.debate[0]?.date) || '—'}`
        : 'the search answered and found nothing naming the company'
      : 'the headline search did not answer — unknown, not empty',
    body: <PressBody items={d.street.debate} ok={d.street.debateOk}
                     searchUrl={d.street.queries.debate} searchedAs={d.street.searchedAs}
                     what="the bull and bear arguments"
                     which="debate" pick={pick} />,
  });

  return out;
}

/* ---- section chrome -------------------------------------------------------- */

function Section({ s, open, focused, onToggle, onFocus, pick }) {
  return (
    <div className={`rc-sec is-${s.voice}${open ? '' : ' is-closed'}${focused ? ' is-focused' : ''}`}
         id={`sec-${s.id}`}>
      {/* The header is one button (focus + open); the caret is another
          (collapse). Two targets, because "put a spotlight on it" and "get it
          out of my way" are different requests. */}
      <div className="rc-sec-head">
        <button type="button" className="rc-sec-main" onClick={() => onFocus(s.id)}
                title="Focus this section">
          <span className={`rc-chip is-${s.voice}`}>{VOICE[s.voice].chip}</span>
          <span className="rc-sec-titles">
            <span className="rc-sec-title">
              {s.title}
              {s.count != null && <span className="rc-sec-count">{s.count}</span>}
            </span>
            <span className="rc-sec-blurb">{s.blurb}</span>
          </span>
        </button>
        {/* A section that is ONE claim (the consensus table) carries its src
            button on the head — there is no single row to hang it on. */}
        {s.srcSel && pick && (
          <SrcButton sel={s.srcSel} current={pick.sel} onSelect={pick.onSelect} />
        )}
        <button type="button" className="rc-sec-caret" aria-expanded={open}
                title={open ? 'Collapse' : 'Expand'}
                onClick={(e) => { e.stopPropagation(); onToggle(s.id); }}>
          {open ? '▾' : '▸'}
        </button>
      </div>
      {open && <div className="rc-sec-body">{s.body}</div>}
    </div>
  );
}

/* ---- the surface ---------------------------------------------------------- */

const DEFAULT_CLOSED = new Set();

export function Outlook({ injected }) {
  const { nonce, company: ticker, setCompany: setTicker } = useApp();
  const { data, loading, error } = useOutlook(ticker, nonce, injected);
  const web = useAnalysts(ticker, nonce, injected);
  const registry = useRegistry();
  useBootGate('outlook', !!data || !!error, { what: 'risk factors' });

  const [closed, setClosed] = useState(() => new Set(DEFAULT_CLOSED));
  /* Focus rides the hash so a focused section is linkable and the headless
     screenshotter — which cannot click — can photograph it. */
  const [focused, setFocused] = useState(() => hashParam('sec'));
  /* The inspector's selection — one per surface, keyed. Another company's
     claims are different claims, so a ticker change clears it. */
  const [sel, setSel] = useState(null);

  // Another company's payload keeps the layout but not the focus or selection.
  useEffect(() => {
    setFocused(hashView() === 'outlook' ? hashParam('sec') : null);
    setSel(null);
  }, [ticker]);

  useEffect(() => {
    if (hashView() !== 'outlook') return;
    const sec = focused ? `&sec=${encodeURIComponent(focused)}` : '';
    history.replaceState(null, '', `#outlook&ticker=${encodeURIComponent(ticker)}${sec}`);
  }, [ticker, focused]);

  const toggle = (id) => setClosed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const focus = (id) => {
    setFocused((f) => (f === id ? null : id));
    // Focusing a collapsed section reopens it — its sources answer for a body
    // the reader can see.
    setClosed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const pick = { sel, onSelect: setSel };

  /* Qualitative banking: every selection here that carries `quote` — a risk
     heading, a risk update, a catalyst, the guidance line, a headline — can be
     frozen into the report's evidence bank. The label is derived from the
     content so entries stay distinct from one another (the bank warns on
     colliding labels, and a label is also the {{token}} that references it). */
  const first = (t, n) => (String(t).length > n ? `${String(t).slice(0, n).trimEnd()}…` : String(t));
  const onPin = ticker && !injected ? (s, opts) => {
    const e = s.kind === 'risk' ? { label: `Risk: ${first(s.text, 50)}`, sub: s.group || '' }
      : s.kind === 'update' ? { label: `Risk update: ${first(s.text, 44)}`, sub: s.group || '' }
      : s.kind === 'catalyst' ? { label: `Catalyst: ${s.date}`, sub: '' }
      : s.kind === 'guidance' ? { label: `Guidance ${s.quarter || ''}`.trim(), sub: '' }
      : s.kind === 'story' ? { label: `Headline: ${first(s.item?.title, 44)}`, sub: s.item?.source || '' }
      : s.kind === 'webagg' ? { label: 'Web consensus', sub: `${web.data?.aggregate?.of || 0} sources` }
      : s.kind === 'webrating' ? { label: `Rating: ${first(s.quote, 46)}`, sub: s.id }
      : null;
    if (!e) return Promise.resolve({ ok: false });
    return pinEntry(ticker, { kind: 'quote', quote: s.quote, note: '', surface: 'outlook', ...e }, opts);
  } : undefined;

  const sections = data ? buildSections(data, pick, web) : [];
  const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
  /* Three lanes, three questions: what the company says could go wrong, what
     it says could go right, and what the street thinks — side by side, not
     one scroll. A lane is a TOPIC; the voice chips inside it still say whose
     claim each block is, which is why "Analyst views" can hold licensed
     numbers and press leads without blurring them. */
  const lanes = [
    { id: 'risks', label: 'Risks', tone: 'risk',
      sub: 'what the company says could go wrong',
      sections: [byId.risks, byId.update].filter(Boolean) },
    { id: 'catalysts', label: 'Catalysts', tone: 'cat',
      sub: 'what the company says could go right',
      sections: [byId.catalysts].filter(Boolean) },
    { id: 'street', label: 'Analyst views', tone: 'street',
      sub: 'licensed numbers, the live web consensus, linked headlines',
      sections: [byId.consensus, byId.web, byId.actions, byId.debate].filter(Boolean) },
  ];
  const riskCount = byId.risks?.count ?? null;

  const rail = (
    <div className="rc-rail">
      <CompanyRail
        view="outlook"
        ticker={data?.ticker || ''}
        name={data?.name}
        sub={data?.sic}
        busy={loading}
        onSubmit={setTicker}
        facts={data ? [
          { label: 'Risk factors', value: riskCount,
            sub: data.company?.risks?.filing
              ? `${data.company.risks.filing.form} ${data.company.risks.filing.filed}` : null,
            title: data.company?.foreignAnnual
              ? 'Item 3.D headings, extracted verbatim — foreign-filer extraction, see the warning'
              : 'Item 1A headings, extracted verbatim' },
          { label: 'Catalysts', value: data.company?.catalysts?.items?.length ?? '—',
            sub: data.company?.catalysts ? `intel of ${data.company.catalysts.asOf}` : 'no intel' },
          { label: 'Street', value: (data.street?.actions?.length || 0) + (data.street?.debate?.length || 0),
            sub: 'headlines, linked' },
        ] : []}
        note={data && (
          <>Two voices, never blended: what the company itself states in its filings,
          and what the street writes about it. Every line carries its source.</>
        )}
      />
      {data && (
        <Panel swatch="c" title="Sources" flush>
          <SourceInspector
            sel={sel} onClose={() => setSel(null)}
            d={sel ? describe(sel, data, web.data) : null}
            sources={sel ? sourcesFor(sel, data, web.data) : []}
            defaults={defaultRows(data, registry.sources.outlook, web.data)}
            defaultsIntro="Everything this surface draws on — filings verbatim, researched intel, licensed estimates, headline searches. Press any src button to trace one claim to the document it came from."
            onPin={onPin}
          />
        </Panel>
      )}
    </div>
  );

  const shell = (b) => (
    <section className="view is-active rc-surface">
      {rail}
      <div className="rc-main">{b}</div>
    </section>
  );

  if (error) return shell(<div className="rc-sec is-house"><div className="rc-sec-body"><div className="rc-empty"><p>{error}</p></div></div></div>);
  if (loading && !data) return shell(<div className="rc-sec is-house"><div className="rc-sec-body"><div className="rc-empty"><p>Reading the 10-K…</p></div></div></div>);
  if (!data) return shell(null);

  const renderGroup = (list) => list.map((s) => (
    <Section key={s.id} s={s}
             open={!closed.has(s.id)}
             focused={focused === s.id}
             onToggle={toggle} onFocus={focus} pick={pick} />
  ));

  return shell(
    <>
      <div className="rc-flag">
        <strong>The company's account of its own risks and catalysts, beside the
        street's — kept apart on purpose.</strong> Item 1A is the one place a company
        must state, in its own words, what could go wrong; guidance and the events it
        puts on its own calendar are its statement of what could go right. Analysts'
        views are a different grade of evidence — numbers where licensed (IBES),
        linked headlines where not — and are never blended into the company's.
        Press any <i>src</i> button and the rail's Sources panel traces that claim
        to the document it came from.
      </div>

      <div className="rc-lanes">
        {lanes.map((lane) => (
          <div key={lane.id} className={`rc-lane is-${lane.tone}`}>
            <div className="rc-lane-h">
              <span>{lane.label}</span>
              <em>{lane.sub}</em>
            </div>
            {renderGroup(lane.sections)}
          </div>
        ))}
      </div>
    </>
  );
}

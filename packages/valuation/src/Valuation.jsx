/* Valuation — a reverse DCF. What growth is the price already paying for?
 *
 * The surface asks the question backwards on purpose. A fair-value estimate
 * invites you to defend a target price; an implied growth rate invites you to
 * say "I don't believe 35% a year for a decade", which is a claim you can
 * actually check against the company's own history. The trailing figure sits
 * next to the implied one for exactly that comparison.
 *
 * Colour: the sensitivity grid is SEQUENTIAL — one measure, low to high — so
 * it is a single hue at varying strength, never a two-ended ramp. Implied
 * growth has no natural midpoint the way a correlation does; treating it as
 * diverging would invent a "neutral" growth rate that does not exist.
 */
import { useEffect, useState } from 'react';
import { Panel } from '@markets/shell/components/Panel.jsx';
import { useApp } from '@markets/shell/lib/store.jsx';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';
import { moneyShort, pct } from '@markets/shell/lib/format.js';
import { hashView } from '@markets/shell/lib/hash.js';
import { InsightButton } from '@markets/shell/components/InsightButton.jsx';
import { InsightPanel } from '@markets/shell/components/InsightPanel.jsx';
import { SourceInspector, SrcButton, TraceParts } from '@markets/shell/components/SourceInspector.jsx';
import { CompanyRail } from '@markets/shell/components/CompanyRail.jsx';
import { useRegistry } from '@markets/shell/lib/registry.jsx';
import { describe, defaultRows, sourcesFor, tracesFor } from './valuationSources.js';
import { useVariant } from '@markets/shell/lib/useVariant.js';
import { VariantChips } from '@markets/shell/components/VariantChips.jsx';
import { GrowthBars, ScenarioLadder } from './Looks.jsx';

const DEFAULTS = { wacc: 0.09, terminal: 0.025, years: 10, fade: true, dilution: 0.01 };

/* Five candidate designs, switched from the ticker bar:
 *
 *   1 Verdict   the answer at size — implied against trailing as two bars on
 *               one scale, six tiles collapsed to a rule-separated strip
 *   2 Console   assumptions pinned as a sticky rail, so a slider and the number
 *               it moves are on screen together  ← CHOSEN, and the default
 *   3 Ladder    the scenarios promoted and drawn: value per share against
 *               today's price, implied growth read off the picture
 *   4 Compare   two columns — what the price says, what the company has done
 *   5 Report    prose-led and print-like, the way the written reports read
 *
 * Looks 1 and 3 draw something new; 2, 4 and 5 are the same tree re-laid out.
 */
const LOOKS = ['Verdict', 'Console', 'Ladder', 'Compare', 'Report'];

function useValuation(ticker, a, nonce) {
  const [s, setS] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!ticker) return;
    let live = true;
    setS((p) => ({ ...p, loading: true }));
    const q = `ticker=${encodeURIComponent(ticker)}&wacc=${a.wacc}&terminal=${a.terminal}`
      + `&years=${a.years}&fade=${a.fade ? 1 : 0}&dilution=${a.dilution}`;
    fetch(`/api/valuation?${q}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then((d) => live && setS({ data: d, loading: false, error: null }))
      .catch((e) => live && setS({ data: null, loading: false, error: e.message }));
    return () => { live = false; };
  }, [ticker, a.wacc, a.terminal, a.years, a.fade, a.dilution, nonce]);
  return s;
}

const g = (v, d = 1) => v == null ? '—' : `${(v * 100).toFixed(d)}%`;

/* The cross-check is its own request: it fans out over SEC and would otherwise
   hold the whole surface behind its slowest peer. */
function usePeerCheck(ticker, refused) {
  const [s, setS] = useState({ data: null, loading: false });
  useEffect(() => {
    if (!ticker || refused) { setS({ data: null, loading: false }); return; }
    let live = true;
    setS({ data: null, loading: true });
    fetch(`/api/valuation/peers?ticker=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((d) => live && setS({ data: d, loading: false }))
      .catch(() => live && setS({ data: null, loading: false }));
    return () => { live = false; };
  }, [ticker, refused]);
  return s;
}

function Slider({ label, value, min, max, step, fmt, onChange, hint }) {
  return (
    <label className="vl-slider">
      <span className="vl-slider-head">
        <span className="vl-slider-label">{label}</span>
        <span className="vl-slider-value">{fmt(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
             onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="vl-slider-hint">{hint}</span>}
    </label>
  );
}

/* The assumptions panel has three sizes, not two.
 *
 * Open is five sliders and their hints — a lot of rail for something you set
 * once and then want out of the way. Closed is a header, which hides the fact
 * that the whole model downstream is computed on those five numbers. Neither is
 * right for the state you are in most of the time: not adjusting them, but
 * needing to know what they are.
 *
 * So the middle state is the useful one — the category and its value, one line
 * each, no controls. It is what you would write down if someone asked what the
 * model assumed.
 */
const DETAIL = ['open', 'summary', 'closed'];
const DETAIL_LABEL = { open: 'Full', summary: 'Summary', closed: 'Hidden' };

function useDetail(key, fallback = 'open') {
  const [d, setD] = useState(() => {
    /* `?assumptions=summary` wins over stored state, for the same reason
       `?look=` and `?chart=` do: a headless screenshot runs on a fresh profile
       with no localStorage, so without it every shot is the default state and
       the other two are unverifiable. */
    try {
      const q = new URLSearchParams(location.search).get('assumptions');
      if (DETAIL.includes(q)) return q;
    } catch { /* no location under SSR */ }
    try {
      const v = localStorage.getItem(key);
      return DETAIL.includes(v) ? v : fallback;
    } catch { return fallback; }
  });
  const set = (v) => {
    const safe = DETAIL.includes(v) ? v : fallback;
    setD(safe);
    try { localStorage.setItem(key, safe); } catch { /* ignore */ }
  };
  return [d, set];
}

/* The summary state.
 *
 * It reuses the FULL state's own classes — `.vl-slider`, `.vl-slider-head`,
 * `.vl-slider-label`, `.vl-slider-value` — rather than styling a second list of
 * label/value pairs. That is the whole trick: the two states then cannot drift,
 * because the typography, the baseline alignment and the label case are one
 * declaration serving both. The only thing summary leaves out is the range
 * input, which is what makes it a summary.
 *
 * An earlier version was a <dl> with its own dense row styling, and it read as
 * a different object sitting in the same panel — smaller labels, a rule under
 * every line, nothing lining up with the sliders it replaced.
 *
 * No hints. The full state's hints explain a control you are about to move;
 * with the control gone they were just the label said twice, and six of them
 * cost the rail more height than the sliders they replaced. */
function AssumptionSummary({ rows }) {
  return (
    <div className="vl-sliders vl-static">
      {rows.map((r) => (
        <div key={r.label} className="vl-slider">
          <span className="vl-slider-head">
            <span className="vl-slider-label">{r.label}</span>
            <span className="vl-slider-value">{r.value}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* `injected` is the render-check seam. Server-side rendering does not run
   effects, so a view that fetches in useEffect can only ever render its
   loading state under renderToStaticMarkup — stubbing fetch stubs a call that
   never happens. Passing the payload directly is what lets the EMPTY, ERROR and
   DEGRADED branches be exercised, and those are where every bug this phase
   found actually lived. Unused in the app. */
export function Valuation({ injected }) {
  /* The company is the group's, not this surface's. Arriving from Competitors
     or Management lands on the same company rather than on whatever this
     surface last had — which is what the icon links used to paper over. */
  const { nonce, company: ticker, setCompany: setTicker } = useApp();
  const [a, setA] = useState(DEFAULTS);
  const live = useValuation(ticker, a, nonce);
  const { data, loading, error } = injected
    ? { data: injected, loading: false, error: null }
    : live;
  const peerCheck = usePeerCheck(ticker, data?.refused);
  /* Console is the chosen design for this surface. The switch stays up while
     Competitors and Graph are still being decided, but 2 is what a reader with
     no stored preference lands on. */
  const [look, setLook] = useVariant('valuation', LOOKS.length, 2);
  const [detail, setDetail] = useDetail('vl:assumptions');
  const { sources: SURFACE_SOURCES } = useRegistry();
  /* One selection for the whole surface, driving the rail inspector — the same
     shape Competitors keeps. Cleared when the company changes, because a
     selection naming the old company would otherwise sit there looking
     current. */
  const [sel, setSel] = useState(null);
  useEffect(() => { setSel(null); }, [ticker]);
  useBootGate('valuation', !!data || !!error, { what: 'filings' });
  /* Keep the hash current, but only while this surface is the one showing:
     store.jsx rewrites segment 0 on every view change, and writing here during
     someone else's turn would stomp their tail on the way out. */
  useEffect(() => {
    if (hashView() !== 'valuation') return;
    history.replaceState(null, '', `#valuation&ticker=${encodeURIComponent(ticker)}`);
  }, [ticker]);

  /* The company box moved to the rail; this strip keeps only what is about the
     SURFACE rather than the company — the look switch, and the reporting frame
     the whole model is computed on. */
  const bar = (
    <div className="rk-controls vl-bar">
      {data && <span className="rk-controls-note">
        {data.frame}
        {data.price && <> · ${data.price.price} on {data.price.date}{' '}
          <SrcButton current={sel} onSelect={setSel}
                     sel={{ input: 'price', key: 'vl:price' }}
                     title="Where this price comes from" /></>}
      </span>}
      <VariantChips v={look} setV={setLook} labels={LOOKS} />
    </div>
  );

  /* The rail is STRUCTURAL, not part of any one look.
   *
   * It was briefly inside the assumptions band, which meant it only existed
   * once a payload had arrived — so a bad ticker rendered an error with no box
   * to type a better ticker into, and the only way out was the URL. Anything
   * that can recover from an error has to outlive the error.
   *
   * `data?.` throughout: on a failed or in-flight fetch the rail still shows
   * the ticker being asked about, and the facts collapse to em dashes rather
   * than disappearing. */
  const railHead = (
    <CompanyRail
      view="valuation"
      ticker={data?.ticker || ticker}
      name={data?.name}
      sub={data?.sector}
      busy={loading}
      onSubmit={setTicker}
      facts={data && !data.refused ? [
        { label: 'Implied', value: g(data.implied?.growth), sub: `for ${a.years}y`,
          title: 'The revenue growth the current price is paying for' },
        { label: 'Trailing', value: g(data.trailingGrowth), sub: 'last year',
          title: 'What the company actually grew, last reported year' },
        { label: 'EV / FCF',
          value: data.evToFcf == null ? null : `${data.evToFcf.toFixed(1)}×`,
          sub: `margin ${g(data.inputs?.margin)}` },
      ] : []}
    />
  );

  /* `vl-surface` is this surface's own hook. `bk-surface` is shared with Book,
     Risk and Thesis, so hanging the variant attribute off it alone would let a
     look written here restyle three surfaces that never asked. */
  const shell = (rail, b) => (
    <section className="view is-active bk-surface vl-surface" data-vl-v={look}>
      <div className="vl-railcol">{railHead}{rail}</div>
      <div className="vl-main">{bar}{b}</div>
    </section>
  );

  if (error) return shell(null, <Panel title="Valuation" swatch="a"><div className="bk-empty"><p>{error}</p></div></Panel>);
  if (loading && !data) return shell(null, <Panel title="Valuation" swatch="a"><div className="bk-empty"><p>Reading filings…</p></div></Panel>);
  if (!data) return shell(null, null);

  /* Defaults on every collection the render indexes into. The render check
     found this the hard way: an absent `waccAxis` threw inside a .map and took
     the whole surface to blank — a crash, not a degrade, on a payload that was
     otherwise perfectly renderable. */
  const { inputs: i = {}, implied = {}, trailingGrowth, evToFcf } = data;
  const grid = data.grid || [];
  const waccAxis = data.waccAxis || [];
  const scenarios = data.scenarios || [];
  const maxGrid = Math.max(...grid.flatMap((r) => r.cells.map((c) => c.growth ?? 0)), 0.0001);

  /* The rail's body: the model's inputs, and the filings they were applied to.
     Both live beside the company block rather than in the flow, because both
     answer "where did this number come from" and neither is a result. */
  const railBody = (
    <>
      <Panel title="Assumptions" swatch="a" flush={detail === 'closed'}
             tools={
               <span className="seg vl-detail" role="group" aria-label="Assumptions detail">
                 {DETAIL.map((d) => (
                   <button key={d} type="button"
                           className={d === detail ? 'is-active' : ''}
                           aria-pressed={d === detail}
                           title={`${DETAIL_LABEL[d]} — ${
                             d === 'open' ? 'sliders and their hints'
                               : d === 'summary' ? 'each setting and its value, no controls'
                                 : 'header only'}`}
                           onClick={() => setDetail(d)}>{DETAIL_LABEL[d]}</button>
                 ))}
               </span>
             }>
        {detail === 'summary' && (
          <AssumptionSummary rows={[
            { label: 'Discount rate (WACC)', value: g(a.wacc, 1) },
            { label: 'Terminal growth', value: g(a.terminal, 2) },
            { label: 'Horizon', value: `${a.years} years` },
            { label: 'Net dilution a year', value: g(a.dilution, 2) },
            { label: 'Growth path', value: a.fade ? `fades to ${g(a.terminal, 2)}` : 'held flat' },
            /* The margin is not a slider and so appears nowhere in the full
               state's controls — only in its footnote. Summary is the one place
               it can be read as a setting, which is what it is. */
            { label: 'FCF margin', value: g(i.margin) },
          ]} />
        )}

        {detail === 'open' && <>
        <div className="vl-sliders">
          <Slider label="Discount rate (WACC)" value={a.wacc} min={0.04} max={0.20} step={0.005}
                  fmt={(v) => g(v, 1)} onChange={(v) => setA({ ...a, wacc: v })}
                  hint="what you require for the risk" />
          <Slider label="Terminal growth" value={a.terminal} min={0} max={0.05} step={0.0025}
                  fmt={(v) => g(v, 2)} onChange={(v) => setA({ ...a, terminal: v })}
                  hint="forever after the horizon; above long-run GDP is a claim the firm outgrows the economy indefinitely" />
          <Slider label="Horizon" value={a.years} min={3} max={20} step={1}
                  fmt={(v) => `${v} years`} onChange={(v) => setA({ ...a, years: v })}
                  hint="how long the growth stage runs" />
          <Slider label="Net dilution a year" value={a.dilution} min={-0.05} max={0.06} step={0.0025}
                  fmt={(v) => g(v, 2)} onChange={(v) => setA({ ...a, dilution: v })}
                  hint="share count drift from stock comp, net of buybacks; negative shrinks it" />
          <label className="vl-toggle">
            <input type="checkbox" checked={a.fade}
                   onChange={(e) => setA({ ...a, fade: e.target.checked })} />
            <span>
              <b>Fade growth to terminal</b>
              <span className="vl-slider-hint">
                Straight-line from the implied first-year rate down to {g(a.terminal, 2)} by
                year {a.years}. Off means the same rate for {a.years} years and then a cliff,
                which nothing does.
              </span>
            </span>
          </label>
        </div>
        <p className="bk-foot">
          The margin is deliberately NOT a slider. Letting growth and margin both
          vary makes the answer unidentifiable — infinitely many pairs hit the same
          value — so one has to be pinned, and the margin is the one you can observe
          today.
        </p>
        </>}
      </Panel>
      <Panel title="Sources" swatch="c" flush>
        <SourceInspector sel={sel} onClose={() => setSel(null)}
                         d={sel ? describe(sel, data) : null}
                         sources={sel ? sourcesFor(sel, data) : []}
                         defaults={defaultRows(data, SURFACE_SOURCES.valuation || [])}
                         defaultsIntro={'Everything the model reads, this company\'s own filings first. '
                           + 'Press any src button to trace one figure to the document it came from.'}>
          {sel && tracesFor(sel, data).map((tr) => <TraceParts key={tr.id} trace={tr} />)}
        </SourceInspector>
      </Panel>
    </>
  );

  return shell(railBody, <>
    {data.refused ? (
      <div className="bk-flag is-bad">
        <strong>Not modelled this way, on purpose.</strong> {implied.reason}
        {' '}The model would still produce a number; it would just be wrong, and
        a wrong number with a decimal point is worse than a blank.
      </div>
    ) : implied.growth == null ? (
      <div className="bk-flag is-bad">
        <strong>Cannot invert.</strong> {implied.reason}. A reverse DCF needs
        revenue, operating cash flow, capex, a share count and a price; anything
        missing is a filer tagging difference, not an opinion about the company.
      </div>
    ) : (
      <div className="bk-flag">
        <strong>At ${i.price}, the market is paying for {g(implied.growth)} revenue
        growth a year for {a.years} years</strong> — holding the free-cash-flow margin
        flat at {g(i.margin)} and discounting at {g(a.wacc, 1)}.
        {trailingGrowth != null && <> {data.ticker} actually grew {g(trailingGrowth)} last year.</>}
        {implied.bounded && <> This is the model's {implied.bounded === 'high' ? 'ceiling' : 'floor'}, not a solved value.</>}
      </div>
    )}

    {!data.refused && <>
    {/* Rendered under every look and shown by CSS only where it belongs. In the
        tree unconditionally so that switching looks never remounts the panels
        below it, which would drop the sliders back to their defaults mid-
        comparison — the sliders are the state you are holding. */}
    <div className="vl-verdict">
      <GrowthBars implied={implied.growth} trailing={trailingGrowth} years={a.years} />
    </div>

    <div className="bk-insight">
      <InsightButton id={`valuation:${data.ticker}:${a.years}:${a.wacc}:${a.fade}`}
        title={`Is ${data.ticker} at ${g(implied.growth)} plausible?`}
        meta={`${data.frame} · ${data.name || ''}`}
        payload={() => ({ kind: 'valuation', valuation: {
          ticker: data.ticker, name: data.name, sector: data.sector, frame: data.frame,
          price: i.price, ev: i.ev, evToFcf, fcf: i.fcf, revenue: i.revenue, margin: i.margin,
          impliedGrowth: implied.growth, trailingGrowth,
          years: a.years, wacc: a.wacc, terminal: a.terminal, fade: a.fade, dilution: a.dilution,
          grid, peerMedian: peerCheck.data?.median ?? null, peerN: peerCheck.data?.n ?? null,
        } })} />
      <InsightPanel hideIdle />
    </div>

    <div className="bk-strip">
      {[
        { key: 'vl:implied', input: 'model', label: 'Implied growth',
          value: g(implied.growth), sub: `for ${a.years} years` },
        { key: 'vl:trailing', input: 'trailing', label: 'Trailing growth',
          value: g(trailingGrowth), sub: 'last reported year' },
        { key: 'vl:margin', input: 'margin', label: 'FCF margin',
          value: g(i.margin), sub: 'held flat in the model' },
        { key: 'vl:evfcf', input: 'evToFcf', label: 'EV / FCF',
          value: evToFcf == null ? '—' : `${evToFcf.toFixed(1)}×`,
          sub: 'what you pay per dollar of cash' },
        { key: 'vl:ev', input: 'ev', label: 'Enterprise value',
          value: moneyShort(i.ev),
          sub: `cap ${moneyShort(i.marketCap)} ${i.netDebt < 0 ? 'less net cash' : 'plus net debt'} ${moneyShort(Math.abs(i.netDebt))}` },
        { key: 'vl:fcf', input: 'fcf', label: 'Free cash flow',
          value: moneyShort(i.fcf), sub: 'CFO less capex, trailing' },
      ].map((t) => (
        <div key={t.key} className="bk-tile">
          <span className="bk-tile-label">{t.label}{' '}
            <SrcButton current={sel} onSelect={setSel}
                       sel={{ input: t.input, key: t.key }} /></span>
          <span className="bk-tile-value">{t.value}</span>
          <span className="bk-tile-sub">{t.sub}</span>
        </div>
      ))}
    </div>

    <div className="bk-band">
      <Panel title="How much the answer depends on the assumptions" swatch="b" flush
             tools={<SrcButton current={sel} onSelect={setSel}
                               sel={{ input: 'model', key: 'vl:grid',
                                      claim: 'Each cell is the implied growth rate re-solved at that discount rate and horizon, at the current price — the assumptions vary, the filed inputs below do not.' }} />}>
        <table className="bk-table vl-grid">
          <thead>
            <tr><th className="bk-l">Horizon</th>
              {waccAxis.map((w) => <th key={w}>{g(w, 1)}</th>)}</tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row.years}>
                <td className="bk-l">{row.years}y</td>
                {row.cells.map((c) => (
                  <td key={c.wacc} className="vl-cell"
                      style={c.growth == null ? {} : {
                        background: `color-mix(in srgb, var(--accent) ${Math.round((c.growth / maxGrid) * 62)}%, transparent)`,
                      }}>{g(c.growth)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="bk-foot">
          Implied growth across discount rate (columns) and horizon (rows), at the
          current price. One hue, light to dark — implied growth has no natural
          midpoint, so a two-ended scale would invent a "neutral" rate that does not
          exist. A grid that swings wildly means the price is telling you less than
          the model's settings are.
        </p>
      </Panel>
    </div>

    <div className="bk-band bk-band-2">
      <Panel title="Against comparable multiples" swatch="a" flush
             tools={<SrcButton current={sel} onSelect={setSel}
                               sel={{ input: 'peers', key: 'vl:peers',
                                      tickers: (peerCheck.data?.rows || []).map((r) => r.ticker),
                                      n: peerCheck.data?.n }} />}>
        {peerCheck.loading ? <div className="bk-empty"><p>Reading peer filings…</p></div>
          : peerCheck.data?.rows?.length ? <>
          <table className="bk-table">
            <thead><tr><th className="bk-l">Ticker</th><th>EV / FCF</th><th>FCF margin</th></tr></thead>
            <tbody>
              {peerCheck.data.rows.map((r) => (
                <tr key={r.ticker} className={r.ticker === data.ticker ? '' : 'is-closed'}>
                  <td className="bk-l bk-tick">{r.ticker}</td>
                  <td>{r.evToFcf.toFixed(1)}×</td>
                  <td className="bk-dim">{g(r.fcfMargin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="bk-foot">
            {peerCheck.data.premium != null ? <>
              {data.ticker} trades at {peerCheck.data.self.toFixed(1)}× against a peer
              median of {peerCheck.data.median.toFixed(1)}× —{' '}
              <strong className={peerCheck.data.premium > 0 ? 'down' : 'up'}>
                {g(peerCheck.data.premium, 0)}
              </strong>{' '}
              {peerCheck.data.premium > 0 ? 'premium' : 'discount'} on {peerCheck.data.n} comparables.
            </> : peerCheck.data.self == null ? <>
              {/* The gap is the FOCAL company, not the peer set — saying
                  "not enough comparables" here would blame the wrong side. */}
              The peers below have a multiple but {data.ticker} does not, so there is
              nothing to compare: it needs an EV and positive trailing free cash flow,
              and it is missing one of them.
            </> : <>Fewer than one comparable with positive free cash flow.</>}
            {' '}A DCF that disagrees violently with every comparable is usually the DCF
            being wrong: a multiple is the market's own answer to the same question and
            needs no discount rate to produce it. Median, not mean — one peer on a
            depressed cash-flow year makes a 200× multiple that drags an average
            somewhere meaningless. Banks, insurers and ADRs are excluded for the same
            reasons they are not modelled here.
          </p>
        </> : <div className="bk-empty"><p>No comparable multiples available.</p></div>}
      </Panel>

      <Panel title="The other direction — what it is worth at a given growth rate" swatch="c" flush
             tools={<SrcButton current={sel} onSelect={setSel}
                               sel={{ input: 'model', key: 'vl:scenarios',
                                      claim: `Each row runs the same model forwards — value per share if revenue grows at that rate for ${a.years} years, on the filed inputs below.` }} />}>
        {look === 3 ? (
          <ScenarioLadder scenarios={scenarios} price={i.price} years={a.years} />
        ) : (
        <>
        <table className="bk-table">
          <thead><tr><th className="bk-l">If revenue grows…</th><th>Value per share</th><th>vs ${i.price}</th><th className="bk-l" /></tr></thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.growth}>
                <td className="bk-l">{g(s.growth, 0)} a year for {a.years} years</td>
                <td>{s.perShare == null ? '—' : `$${s.perShare.toFixed(2)}`}</td>
                <td className={s.upside == null ? '' : s.upside > 0 ? 'up' : 'down'}>{pct(s.upside)}</td>
                <td className="bk-l bk-dim bk-tiny">
                  {s.upside == null ? '' : s.upside > 0 ? 'cheap on this assumption' : 'expensive on this assumption'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="bk-foot">
          Same model, run forwards. Every row uses the same {g(i.margin)} FCF margin,
          {' '}{g(a.wacc, 1)} discount rate and {g(a.terminal, 2)} terminal growth as above,
          {a.fade ? ' fading to terminal' : ' held flat'}, with the share count growing
          {' '}{g(a.dilution, 2)} a year.
        </p>
        </>
        )}
      </Panel>
    </div>

    </>}

    {/* For a refused company the rail's inspector still lists the filings that
        were read before the model declined to run — the case where a reader
        most wants to see them. */}

    <p className="cr-note">
      A two-stage model on trailing cash flow — the simplest thing that is honest,
      and wrong in the ways every DCF is wrong: it assumes a constant margin, a
      single growth rate, and that the terminal value (usually most of the number)
      means something. Read it as a statement about the PRICE, not as a valuation.
      Levels come from the same filings the Competitors source inspector cites.
    </p>
  </>);
}

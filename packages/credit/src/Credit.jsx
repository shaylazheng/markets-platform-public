/* Credit & Rates — where we are in the cycle.
 *
 * The Markets surface already TILES most of these series. This one reads them
 * against each other, which is the part a watchlist cannot do: a 10-year yield
 * on its own says nothing, but the same move split into a real yield and a
 * breakeven says whether the market repriced growth or inflation.
 *
 * Everything comes through the existing FRED proxy. No new backend, no spend.
 *
 * Charts here are all ONE measure over time, so they are single-hue lines with
 * no categorical palette. The one place two series share a frame — real yield
 * versus breakeven — they are in the same unit (percentage points) on one
 * axis, which is what makes a second axis unnecessary rather than merely
 * avoidable.
 */
import { useMemo } from 'react';
import { Panel } from '@markets/shell/components/Panel.jsx';
import { useApp } from '@markets/shell/lib/store.jsx';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';
import { useSeriesSet } from '@markets/shell/lib/useSeries.js';
import { InsightButton } from '@markets/shell/components/InsightButton.jsx';
import { InsightPanel } from '@markets/shell/components/InsightPanel.jsx';
import { Sources } from '@markets/shell/components/Sources.jsx';

const CURVE = [
  ['DGS3MO', '3M', 0.25], ['DGS1', '1Y', 1], ['DGS2', '2Y', 2],
  ['DGS5', '5Y', 5], ['DGS7', '7Y', 7], ['DGS10', '10Y', 10], ['DGS30', '30Y', 30],
];
const IDS = [
  ...CURVE.map(([id]) => id),
  'BAMLH0A0HYM2', 'BAMLC0A0CM', 'DFII10', 'T10YIE', 'DGS10',
  'NFCI', 'ICSA', 'DFF', 'MORTGAGE30US', 'VIXCLS',
];

/* ---- small helpers ------------------------------------------------------ */

const lastOf = (s) => s && s.values.length ? s.values[s.values.length - 1] : null;
const lastDate = (s) => s && s.dates.length ? s.dates[s.dates.length - 1] : null;

/** The observation on or immediately before a target date — the honest way to
 *  say "where was this a year ago" when the series has holidays in it. */
function asOf(s, iso) {
  if (!s) return null;
  let v = null;
  for (let i = 0; i < s.dates.length; i++) {
    if (s.dates[i] > iso) break;
    v = s.values[i];
  }
  return v;
}
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

const pp = (v, d = 2) => v == null ? '—' : `${v.toFixed(d)}%`;
const ppDelta = (v, d = 2) => v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)} pp`;

/* ---- the curve ---------------------------------------------------------- */

/* Today's curve against its own history. A curve chart is the one place a
   "line" is not a time series — x is TENOR, and the lines are dates. Four
   dates is the ceiling before it turns into spaghetti. */
function CurveChart({ got }) {
  const snaps = [
    { label: 'today', iso: null, cls: 'cr-now' },
    { label: '3 months ago', iso: daysAgo(91), cls: 'cr-h1' },
    { label: '1 year ago', iso: daysAgo(365), cls: 'cr-h2' },
    { label: '2 years ago', iso: daysAgo(730), cls: 'cr-h3' },
  ].map((s) => ({
    ...s,
    pts: CURVE.map(([id, label, yrs]) => ({
      label, yrs, v: s.iso ? asOf(got[id], s.iso) : lastOf(got[id]),
    })).filter((p) => p.v != null),
  })).filter((s) => s.pts.length >= 3);

  if (!snaps.length) return <p className="bk-foot">Curve data unavailable.</p>;

  const W = 620, H = 220, PAD = { t: 12, r: 14, b: 26, l: 34 };
  const all = snaps.flatMap((s) => s.pts.map((p) => p.v));
  const lo = Math.min(...all) - 0.15, hi = Math.max(...all) + 0.15;
  // Tenor is spaced by RANK, not by years. A linear year axis crushes 3M
  // through 2Y into the left margin, which is exactly where the information is.
  const x = (i) => PAD.l + (i / (CURVE.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
  const idxOf = (label) => CURVE.findIndex(([, l]) => l === label);

  return (
    <div className="cr-chart">
      <div className="rk-chart-legend">
        {snaps.map((s) => (
          <span key={s.label} className="rk-lg">
            <i className={'rk-swatch ' + s.cls} />{s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="rk-svg" role="img" aria-label="Treasury yield curve, today against its own history">
        {[lo, (lo + hi) / 2, hi].map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="rk-base" />
            <text x={4} y={y(v) + 3} className="cr-axis">{v.toFixed(1)}</text>
          </g>
        ))}
        {CURVE.map(([, label], i) => (
          <text key={label} x={x(i)} y={H - 8} className="cr-axis cr-axis-x">{label}</text>
        ))}
        {snaps.slice().reverse().map((s) => (
          <path key={s.label} className={'cr-line ' + s.cls}
                d={s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(idxOf(p.label))},${y(p.v)}`).join('')} />
        ))}
        {snaps[0].pts.map((p) => (
          <circle key={p.label} cx={x(idxOf(p.label))} cy={y(p.v)} r="3" className="cr-dot" />
        ))}
      </svg>
    </div>
  );
}

/* ---- a plain single-measure history ------------------------------------- */

function Spark({ series, months = 24, suffix = '%', zero = false }) {
  const cut = daysAgo(months * 30.44);
  const pts = useMemo(() => {
    if (!series) return [];
    const out = [];
    for (let i = 0; i < series.dates.length; i++) {
      if (series.dates[i] >= cut) out.push([series.dates[i], series.values[i]]);
    }
    return out;
  }, [series, cut]);
  if (pts.length < 3) return null;

  const W = 300, H = 54;
  const vs = pts.map((p) => p[1]);
  const lo = zero ? Math.min(0, ...vs) : Math.min(...vs);
  const hi = Math.max(...vs);
  const x = (i) => (i / (pts.length - 1)) * W;
  const y = (v) => 4 + (1 - (v - lo) / (hi - lo || 1)) * (H - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cr-spark" preserveAspectRatio="none" role="img"
         aria-label={`History, ${pts[0][0]} to ${pts[pts.length - 1][0]}`}>
      {zero && lo < 0 && <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="rk-base" />}
      <path className="cr-line cr-now" d={pts.map(([, v], i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')} />
    </svg>
  );
}

function Read({ label, value, sub, tone = '' }) {
  return (
    <div className="bk-tile">
      <span className="bk-tile-label">{label}</span>
      <span className={'bk-tile-value ' + tone}>{value}</span>
      {sub && <span className="bk-tile-sub">{sub}</span>}
    </div>
  );
}

export function Credit() {
  const { nonce } = useApp();
  const { got, loading } = useSeriesSet(IDS, nonce);
  useBootGate('credit', !loading, { what: 'FRED series' });

  if (loading) {
    return <section className="view is-active bk-surface">
      <Panel title="Credit & Rates" swatch="a"><div className="bk-empty"><p>Loading…</p></div></Panel>
    </section>;
  }

  const hy = lastOf(got.BAMLH0A0HYM2), ig = lastOf(got.BAMLC0A0CM);
  const hyIg = hy != null && ig != null ? hy - ig : null;
  const hyIgRatio = hy != null && ig ? hy / ig : null;
  const hyIgYr = (() => {
    const a = asOf(got.BAMLH0A0HYM2, daysAgo(365)), b = asOf(got.BAMLC0A0CM, daysAgo(365));
    return a != null && b != null ? a - b : null;
  })();

  const real = lastOf(got.DFII10), be = lastOf(got.T10YIE), nom = lastOf(got.DGS10);
  const realYr = asOf(got.DFII10, daysAgo(365)), beYr = asOf(got.T10YIE, daysAgo(365));
  const nomYr = asOf(got.DGS10, daysAgo(365));

  const c2s10 = (() => {
    const a = lastOf(got.DGS10), b = lastOf(got.DGS2);
    return a != null && b != null ? a - b : null;
  })();
  const c3m10 = (() => {
    const a = lastOf(got.DGS10), b = lastOf(got.DGS3MO);
    return a != null && b != null ? a - b : null;
  })();

  const nfci = lastOf(got.NFCI);
  const claims = lastOf(got.ICSA);
  const claimsYr = asOf(got.ICSA, daysAgo(365));

  // A one-line regime read, assembled from the four things that actually
  // disagree with each other. Deliberately hedged: these are descriptions of
  // the data, not a forecast.
  const shape = c2s10 == null ? 'unknown'
    : c2s10 < -0.1 ? 'inverted' : c2s10 < 0.25 ? 'flat' : 'upward-sloping';
  const creditRead = hy == null ? 'unknown'
    : hy < 3.5 ? 'complacent' : hy < 5 ? 'unremarkable' : hy < 7 ? 'stressed' : 'distressed';
  const condRead = nfci == null ? 'unknown' : nfci < -0.2 ? 'loose' : nfci > 0.2 ? 'tight' : 'about average';

  return (
    <section className="view is-active bk-surface">
      <div className="bk-flag">
        <strong>The read.</strong> The curve is <b>{shape}</b> (10Y−2Y {ppDelta(c2s10)}),
        high-yield spreads look <b>{creditRead}</b> at {pp(hy)}, and financial conditions are{' '}
        <b>{condRead}</b> (NFCI {nfci == null ? '—' : nfci.toFixed(2)}).
        Those are descriptions of today's data, not a forecast.
      </div>

      <div className="bk-insight">
        <InsightButton id={`credit:${lastDate(got.DGS10) || ''}`}
          title="The regime" meta={`as of ${lastDate(got.DGS10) || '—'}`}
          payload={() => ({ kind: 'credit', credit: {
            curve: CURVE.map(([id, label]) => ({ label, v: lastOf(got[id]) })).filter((x) => x.v != null),
            curveYearAgo: CURVE.map(([id, label]) => ({ label, v: asOf(got[id], daysAgo(365)) })).filter((x) => x.v != null),
            c2s10, c3m10, hy, ig, hyIg, hyIgRatio, hyIgYr,
            nom, real, be, nomYr, realYr, beYr,
            dff: lastOf(got.DFF), nfci, claims, claimsYr,
          } })} />
        <InsightPanel hideIdle />
      </div>

      <div className="bk-strip">
        <Read label="10Y − 2Y" value={ppDelta(c2s10)} sub={shape} />
        <Read label="10Y − 3M" value={ppDelta(c3m10)} sub="the recession-signal version" />
        <Read label="HY spread" value={pp(hy)} sub={`IG ${pp(ig)}`} />
        <Read label="HY − IG" value={ppDelta(hyIg)} sub={`a year ago ${ppDelta(hyIgYr)}`} />
        <Read label="HY / IG ratio" value={hyIgRatio == null ? '—' : `${hyIgRatio.toFixed(2)}×`}
              sub="stress widens the ratio, not just the gap" />
        <Read label="Fed funds" value={pp(lastOf(got.DFF))}
              sub={`30y mortgage ${pp(lastOf(got.MORTGAGE30US))}`} />
      </div>

      <div className="bk-band bk-band-2">
        <Panel title="Treasury curve — today vs its own history" swatch="a" flush>
          <CurveChart got={got} />
          <p className="bk-foot">
            Tenors are spaced by rank, not by years: on a linear year axis the 3M
            through 2Y points — where the information is — collapse into the left
            margin. As of {lastDate(got.DGS10) || '—'}.
          </p>
        </Panel>

        <Panel title="The 10-year, decomposed" swatch="b" flush>
          <table className="bk-table">
            <thead><tr><th className="bk-l">Component</th><th>Now</th><th>1y ago</th><th>Change</th></tr></thead>
            <tbody>
              <tr><td className="bk-l">Nominal 10Y</td><td>{pp(nom)}</td><td>{pp(nomYr)}</td>
                  <td>{ppDelta(nom != null && nomYr != null ? nom - nomYr : null)}</td></tr>
              <tr><td className="bk-l">Real yield (TIPS)</td><td>{pp(real)}</td><td>{pp(realYr)}</td>
                  <td>{ppDelta(real != null && realYr != null ? real - realYr : null)}</td></tr>
              <tr><td className="bk-l">Breakeven inflation</td><td>{pp(be)}</td><td>{pp(beYr)}</td>
                  <td>{ppDelta(be != null && beYr != null ? be - beYr : null)}</td></tr>
            </tbody>
          </table>
          <p className="bk-foot">
            Real + breakeven ≈ nominal, so the two rows below the first say WHY the
            10-year moved: a real-yield move is the market repricing growth or Fed
            policy, a breakeven move is it repricing inflation. Over the last year
            the split is {ppDelta(real != null && realYr != null ? real - realYr : null)} real
            against {ppDelta(be != null && beYr != null ? be - beYr : null)} breakeven.
          </p>
        </Panel>
      </div>

      <div className="bk-band bk-band-3">
        <Panel title="High yield OAS" swatch="c" flush>
          <div className="cr-pad"><Spark series={got.BAMLH0A0HYM2} /></div>
          <p className="bk-foot">24 months. Now {pp(hy)}, a year ago {pp(asOf(got.BAMLH0A0HYM2, daysAgo(365)))}.</p>
        </Panel>
        <Panel title="Financial conditions (NFCI)" swatch="c" flush>
          <div className="cr-pad"><Spark series={got.NFCI} suffix="" zero /></div>
          <p className="bk-foot">
            Zero is the historical average; positive is tighter than normal.
            Now {nfci == null ? '—' : nfci.toFixed(2)} — {condRead}.
          </p>
        </Panel>
        <Panel title="Initial jobless claims" swatch="c" flush>
          <div className="cr-pad"><Spark series={got.ICSA} suffix="" /></div>
          <p className="bk-foot">
            Now {claims == null ? '—' : Math.round(claims).toLocaleString('en-US')},
            a year ago {claimsYr == null ? '—' : Math.round(claimsYr).toLocaleString('en-US')}.
            The fastest-moving labour reading there is, and the one credit turns on.
          </p>
        </Panel>
      </div>

      <Sources view="credit" />

      <p className="cr-note">
        Every series here is FRED, through the gateway's existing proxy. Per-issuer
        credit — a debt maturity wall, interest coverage by year — needs XBRL debt
        schedules that <code>xbrl.js</code> does not extract yet, and CDS would need
        Markit through synthetic sample. Neither is wired; this surface is the macro half only.
      </p>
    </section>
  );
}

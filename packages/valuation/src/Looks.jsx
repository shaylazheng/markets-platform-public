/* Pieces that exist only for particular looks of the Valuation surface.
 *
 * Both are pure functions of the payload the surface already holds — no extra
 * request, so no look is quietly slower than another and the comparison is
 * about design rather than about which one finished loading.
 */

const g = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);

/* ---- implied against trailing (look 1) -----------------------------------
 *
 * The whole surface exists to put these two numbers beside each other, and
 * today they are the first and second of six equal tiles, thirty pixels apart
 * with four unrelated figures between them. Two bars on ONE scale make the
 * comparison structural: the gap is a length, not a subtraction the reader
 * performs.
 *
 * The bars are the same hue on purpose. This is one measure — revenue growth —
 * at two readings, so colouring them differently would imply a categorical
 * split that is not there. Which bar is which is carried by the label, and the
 * one that matters is marked by weight.
 */
export function GrowthBars({ implied, trailing, years }) {
  const rows = [
    { key: 'implied', label: 'Implied by the price', v: implied, sub: `for ${years} years`, lead: true },
    { key: 'trailing', label: 'Actually achieved', v: trailing, sub: 'last reported year' },
  ];
  /* Anchored at zero and scaled to the larger magnitude, so a company that
     shrank reads as a bar on the other side of the axis rather than as a
     missing one. */
  const span = Math.max(...rows.map((r) => Math.abs(r.v ?? 0)), 0.01);

  return (
    <div className="vl-bars">
      {rows.map((r) => {
        const has = r.v != null;
        const w = has ? Math.min(100, (Math.abs(r.v) / span) * 100) : 0;
        return (
          <div key={r.key} className={'vl-bars-row' + (r.lead ? ' is-lead' : '')}>
            <div className="vl-bars-label">{r.label}</div>
            <div className="vl-bars-track">
              <i className={'vl-bars-fill' + (has && r.v < 0 ? ' is-neg' : '')}
                 style={{ width: `${w}%` }} />
            </div>
            <div className="vl-bars-val">{g(r.v)}</div>
            <div className="vl-bars-sub">{r.sub}</div>
          </div>
        );
      })}
      <Verdict implied={implied} trailing={trailing} />
    </div>
  );
}

/* The one line the two bars are drawn to support. A multiple is only meaningful
   against a positive base — a company that shrank last year has no "×" against
   which the implied rate is a multiple, and reporting one would turn a division
   by a small negative into a headline. Those cases get the comparison stated
   the only honest way, in words. */
function Verdict({ implied, trailing }) {
  if (implied == null || trailing == null) return null;

  if (trailing <= 0) {
    return (
      <p className="vl-bars-read">
        Revenue <b>fell</b> last year, so there is no multiple to quote: the price
        is paying for a turn from {g(trailing)} to {g(implied)} and then a decade
        of holding it.
      </p>
    );
  }

  const x = implied / trailing;
  const near = x >= 0.87 && x <= 1.15;
  return (
    <p className="vl-bars-read">
      The price is asking for{' '}
      {near ? <b>about what the company last delivered</b>
        : <><b>{x.toFixed(1)}×</b> what the company last delivered</>}
      , every year for the whole horizon. Whether that is cheap or dear is a
      judgement about the business; the model only says what has to be true.
    </p>
  );
}

/* ---- the value ladder (look 3) -------------------------------------------
 *
 * The scenario table runs the model forwards: pick a growth rate, get a value
 * per share. Read as a table it is three columns of figures you compare in your
 * head against a price sitting in a different panel. Drawn as a ladder, the
 * price is a line and every scenario is either left of it or right of it — the
 * comparison the table asks you to perform is done by position.
 *
 * Length is value per share; the rule is today's price. Bars are the neutral
 * accent, and only the CROSSING is coloured, because "cheap on this assumption"
 * is the claim being made and it is the crossing that makes it.
 */
export function ScenarioLadder({ scenarios, price, years }) {
  const live = (scenarios || []).filter((s) => s.perShare != null);
  if (!live.length || !price) {
    return <div className="bk-empty"><p>No scenarios to lay out — the model needs a solved value per share and a price.</p></div>;
  }

  // Headroom above the larger of the two so the longest bar never touches the
  // edge and the price rule is never flush against it either.
  const max = Math.max(...live.map((s) => s.perShare), price) * 1.06;
  const frac = (v) => Math.max(0, Math.min(1, v / max));
  const at = (v) => `${frac(v) * 100}%`;

  return (
    <div className="vl-ladder">
      <div className="vl-ladder-rows">
        {/* One rule across every row rather than a tick per row: the price is a
            single fact about the company, not a property of each scenario.

            The fraction goes out as a NUMBER, not a percentage. The rule is
            absolutely positioned against the whole row — which spans the key
            and the two figure columns as well — while the bars are measured
            inside the track. Handing CSS a percentage here put the rule at 91%
            of the row instead of 91% of the track, i.e. out among the numbers.
            The stylesheet reconstructs the track's box from the grid template. */}
        <div className="vl-ladder-rule" style={{ '--p': frac(price) }} aria-hidden="true">
          <span className="vl-ladder-rule-lbl">${price}</span>
        </div>

        {live.map((s) => {
          const cheap = s.perShare > price;
          return (
            <div key={s.growth} className="vl-ladder-row">
              <div className="vl-ladder-key">{g(s.growth, 0)}<span> a year</span></div>
              <div className="vl-ladder-track">
                <i className={'vl-ladder-fill' + (cheap ? ' is-cheap' : ' is-dear')}
                   style={{ width: at(s.perShare) }} />
              </div>
              <div className="vl-ladder-val">${s.perShare.toFixed(2)}</div>
              <div className={'vl-ladder-up ' + (s.upside == null ? '' : s.upside > 0 ? 'up' : 'down')}>
                {s.upside == null ? '—' : `${s.upside > 0 ? '+' : ''}${(s.upside * 100).toFixed(0)}%`}
              </div>
            </div>
          );
        })}
      </div>
      <p className="bk-foot">
        Value per share at each growth rate, held for {years} years on the same
        margin, discount rate and terminal growth as the panel above. The rule is
        today's price: bars that reach past it are the assumptions under which the
        share is cheap. Where the rule falls between two rows is the implied growth
        rate, read off the picture instead of solved for.
      </p>
    </div>
  );
}

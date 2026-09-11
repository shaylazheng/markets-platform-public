/* Competitors BY SEGMENT — who each business actually competes with.
 *
 * The matrix above answers "how does this company compare with its peers",
 * with one peer set for the whole company. For a conglomerate that framing is
 * the wrong altitude: AWS competes with Azure and Google Cloud while the
 * retail business competes with Walmart, and averaging those two contests
 * into one peer list describes neither. This panel is the finer grain — one
 * group per reportable segment, its competitors researched per segment (the
 * ⟳ research on the Graph surface writes them into data/earnings), each
 * public one a chip that joins the comparison above with a press.
 *
 * Data comes from the same /summary payload the Summary surface renders, via
 * the shared module-level cache — no new route, no second fetch when the
 * reader has already looked at Summary. The three degraded states all render
 * with their reason: no split readable from the filing, a split with intel
 * that predates per-segment research, and a split with no intel at all.
 */
import { useCompanySummary } from '@markets/shell/lib/companySummary.js';

const fmtAmt = (v, unit) => {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  const n = a >= 1e12 ? `${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(1)}B`
    : a >= 1e6 ? `${(a / 1e6).toFixed(0)}M` : String(Math.round(a));
  return !unit || unit === 'USD' ? `${s}$${n}` : `${s}${n} ${unit}`;
};

export function SegmentCompetitors({ focal, peers, onTogglePeer, onAddAll }) {
  const { data, loading } = useCompanySummary(focal);
  const seg = data?.segmentation;

  if (loading && !data) return <p className="cmp-segc-note">Reading the segment split…</p>;
  if (!seg) {
    return (
      <p className="cmp-segc-note">
        {data?.absent?.segmentRevenue
          || 'No segment split could be read for this company, so there is nothing to group by.'}
      </p>
    );
  }

  const withComps = seg.rows.filter((r) => r.research?.competitors?.length);
  if (!withComps.length) {
    return (
      <p className="cmp-segc-note">
        {seg.researchNote
          || `The split is on file (${seg.rows.length} segments) but no per-segment `
            + 'competitors have been researched yet — refresh this company on the '
            + 'Graph surface (⟳) to add them.'}
      </p>
    );
  }

  return (
    <div className="cmp-segc">
      {withComps.map((r) => {
        const share = seg.revenueSum ? Math.round((r.revenue / seg.revenueSum) * 100) : null;
        const publics = r.research.competitors.filter((c) => c.ticker);
        const privates = r.research.competitors.filter((c) => !c.ticker && c.name);
        const absent = publics.filter((c) => !peers.includes(c.ticker) && c.ticker !== focal);
        return (
          <div className="cmp-segc-row" key={r.member}>
            <div className="cmp-segc-head">
              <b>{r.label}</b>
              <span className="cmp-segc-meta">
                {fmtAmt(r.revenue, seg.unit)}{share != null ? ` · ${share}% of segment revenue` : ''}
              </span>
              {absent.length > 1 && onAddAll && (
                <button type="button" className="cmp-segc-all"
                        title={`Add ${absent.map((c) => c.ticker).join(', ')} to the comparison`}
                        onClick={() => onAddAll(absent.map((c) => c.ticker))}>
                  compare all
                </button>
              )}
            </div>
            <div className="cmp-segc-chips">
              {publics.map((c) => {
                const inSet = peers.includes(c.ticker) || c.ticker === focal;
                return (
                  <button key={c.ticker} type="button"
                          className={'cmp-segc-chip' + (inSet ? ' is-on' : '')}
                          title={(c.note ? `${c.note}. ` : '')
                            + (c.ticker === focal ? 'This is the focal company'
                              : inSet ? 'In the comparison — press to remove'
                                : 'Press to add to the comparison above')}
                          disabled={c.ticker === focal}
                          onClick={() => onTogglePeer?.(c.ticker)}>
                    {c.ticker}{c.name && c.name !== c.ticker ? <span className="cmp-segc-nm"> {c.name}</span> : null}
                  </button>
                );
              })}
              {/* A private competitor is real competition with no row to add —
                  named rather than dropped, so the group doesn't overstate how
                  much of the contest is investable. */}
              {privates.map((c, i) => (
                <span key={c.name + i} className="cmp-segc-priv" title={c.note || 'Private — no listing to compare'}>
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      <p className="cmp-segc-foot">
        Competitors per segment from the researched intel
        {seg.researchAsOf ? `, as of ${seg.researchAsOf}` : ''} — researched by the ⟳
        run, read here, never fetched live. Greyed names are private. Pressing a chip
        adds that company to the comparison above.
      </p>
    </div>
  );
}

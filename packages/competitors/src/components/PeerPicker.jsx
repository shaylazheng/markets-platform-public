/* Focal ticker + editable peer chips + suggestions badged by where they came
 * from. Provenance matters here: "named by their 10-K ×7" is a far stronger
 * claim than "shares a SIC code", and the user should be able to see which they
 * are looking at.
 */
import { PEER_CAP, SPOT_CAP } from '../peers.js';
import { CompanyRail } from '@markets/shell/components/CompanyRail.jsx';

const SOURCE_MARK = {
  '10-K co-mention': '⌗',
  'named by their 10-K': '⌗',
  'earnings call': '☏',
};
const mark = (s) => SOURCE_MARK[s] || (s?.startsWith('SIC') ? '▤' : '·');

/* Two things routinely make a row look broken when it is simply correct, and
   both are properties of the COMPANY rather than of the fetch. Neither is an
   error, so neither belongs in the error styling -- but leaving them unsaid
   means the reader concludes the surface is broken. */
const PROFILE_WHY = {
  bank: 'a bank — its balance sheet is unclassified, so a gross margin, current '
      + 'ratio and EV/EBITDA do not exist for it rather than being unreported',
  insurance: 'an insurer — the same structural reasons as a bank',
  reit: 'a REIT — it reports no cost of revenue, so a gross margin is undefined',
};

function FocalNotice({ focal, resolved, naCount }) {
  if (!focal || !resolved) return null;
  const dereg = resolved.registration?.deregistered;
  const why = PROFILE_WHY[resolved.sectorProfile];
  if (!dereg && !why) return null;
  return (
    <div className="cmp-rail-row cmp-notice">
      {dereg && (
        <span className="cmp-notice-item">
          <b>{focal} no longer files.</b> It terminated its SEC registration
          ({dereg.form}, {dereg.filed}) — usually an acquisition or a going-private
          deal. Everything below is its last reported period, and nothing about it
          will update again. Resolved from this platform’s Form 4 history, since
          SEC’s current ticker map drops deregistered companies.
        </span>
      )}
      {why && (
        <span className="cmp-notice-item">
          {naCount > 0 && <b>{naCount} of the columns read “n/a” because </b>}
          {naCount === 0 && <b>Note: </b>}
          {focal} is {why}.
        </span>
      )}
    </div>
  );
}

export function PeerPicker({
  focal, peers, spotlight, suggestions, suggestLoading, resolved,
  onSetFocal, onTogglePeer, onToggleSpot, onAddAll, notesIndex,
  onSelect, selected, naCount = 0, railExtra = null,
}) {
  const fresh = (suggestions || []).filter((s) => !peers.includes(s.ticker) && s.ticker !== focal);
  return (
    <div className="cmp-rail">
      <CompanyRail
        view="competitors"
        ticker={focal}
        name={resolved?.name}
        sub={resolved?.sicDescription}
        onSubmit={(t) => (focal ? onTogglePeer(t) : onSetFocal(t))}
        placeholder={focal ? 'add a peer…' : 'ticker, e.g. NVDA'}
        facts={focal ? [
          { label: 'Peers', value: peers.length, sub: `of ${PEER_CAP} max` },
          { label: 'Spotlit', value: spotlight.length, sub: `of ${SPOT_CAP} hues`,
            title: 'Peers given a colour in the charts. Three is the validated ceiling.' },
          { label: 'Blank', value: naCount || 0, sub: 'n/a columns',
            tone: 'dim',
            title: 'Metrics structurally undefined for this issuer type' },
        ] : []}
      />

      {/* The design-variant switch. It lives inside the rail because the rail
          is sticky and anything outside it scrolls away — and a look you cannot
          change while looking at the bottom of the surface is not a look you
          can compare. */}
      {railExtra}

      {/* Standing conditions about the focal company, stated once at the top
          rather than left to be inferred from a screenful of blank cells. */}
      <FocalNotice focal={focal} resolved={resolved} naCount={naCount} />

      {focal && (
        <div className="cmp-rail-row">
          <span className="cmp-raillabel">Peers</span>
          {peers.map((p) => (
            <span key={p} className={'cmp-chip' + (spotlight.includes(p) ? ' is-spot' : '')}>
              <button type="button" className="cmp-chip-spot"
                      aria-pressed={spotlight.includes(p)}
                      title={spotlight.includes(p)
                        ? 'Remove from the coloured spotlight'
                        : `Give ${p} a colour in the charts (max ${SPOT_CAP})`}
                      onClick={() => onToggleSpot(p)}>{p}</button>
              <button type="button" className="cmp-chip-x" title={`Remove ${p}`}
                      onClick={() => onTogglePeer(p)}>×</button>
            </span>
          ))}
          {!peers.length && <span className="muted small">none yet — add from the suggestions below</span>}
          {peers.length >= PEER_CAP && <span className="muted small">at the {PEER_CAP}-peer cap</span>}
        </div>
      )}

      {focal && (
        <div className="cmp-rail-row cmp-suggest">
          <span className="cmp-raillabel">Suggested</span>
          {suggestLoading && <span className="loading">looking…</span>}
          {/* Two affordances per suggestion, because they answer different
              questions: the ticker adds the peer, the provenance mark asks WHY
              this company was suggested at all. "Named by their 10-K ×7" and
              "shares a SIC code" are not the same claim, and the second is the
              one worth being sceptical of. */}
          {fresh.slice(0, 10).map((s) => (
            <span key={s.ticker}
                  className={'cmp-sugg' + (selected?.kind === 'peer' && selected.suggestion?.ticker === s.ticker ? ' is-sel' : '')}>
              <button type="button" className="cmp-sugg-mark"
                      aria-pressed={selected?.kind === 'peer' && selected.suggestion?.ticker === s.ticker}
                      title={`Why ${s.ticker} was suggested — ${s.source}${s.count ? `, seen ${s.count}×` : ''}`}
                      onClick={() => onSelect?.({ kind: 'peer', ticker: s.ticker, focal, suggestion: s })}>
                {mark(s.source)}
              </button>
              <button type="button" className="cmp-sugg-tk"
                      title={`${s.name || s.ticker} — add as a peer`}
                      onClick={() => onTogglePeer(s.ticker)}>
                {s.ticker}
                {notesIndex?.includes(s.ticker) && <span className="cmp-hasnote" title="has a hand-written deep dive">●</span>}
              </button>
            </span>
          ))}
          {!suggestLoading && !fresh.length && <span className="muted small">nothing new to suggest</span>}
          {fresh.length > 0 && (
            <button type="button" className="cmp-sugg cmp-sugg-all"
                    onClick={() => onAddAll(fresh.slice(0, 5).map((s) => s.ticker))}>
              + top 5
            </button>
          )}
        </div>
      )}
    </div>
  );
}

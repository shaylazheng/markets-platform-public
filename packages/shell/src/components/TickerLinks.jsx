/* Jump from a company on one surface to the same company on another.
 *
 * Before this existed only Competitors linked anywhere, so every other surface
 * was a dead end: you read that MU is 28% of the book and down 9%, and then
 * retyped "MU" into Valuation. Six pages rather than one machine.
 *
 * Generalised from a PeerLinks that lived in Competitors' picker; that copy is
 * gone now that CompanyRail gives every surface in the group the same identity
 * block, and this is the only implementation left. The ordering below is the
 * part that matters: write the target hash FIRST, then setView. store.jsx drops
 * the tail when the view segment changes (store.jsx:55-60), so switching first
 * loses the ticker.
 */
import { useApp } from '../lib/store.jsx';
import { hashFor } from '../lib/hash.js';

const ALL = [
  ['valuation', '◷', 'What growth the price implies'],
  ['competitors', '▦', 'Against its peers'],
  ['graph', '⇄', 'In the company graph'],
  ['insider', '◈', 'Insider activity'],
];

/**
 * @param {string} ticker
 * @param {string} [omit]  the current surface — never links to itself
 * @param {string[]} [only]  restrict to these views, in this order
 */
export function TickerLinks({ ticker, omit, only }) {
  const { setView } = useApp();
  if (!ticker) return null;

  const links = (only ? ALL.filter(([v]) => only.includes(v)).sort(
    (a, b) => only.indexOf(a[0]) - only.indexOf(b[0])) : ALL)
    .filter(([v]) => v !== omit);

  const go = (view) => {
    history.replaceState(null, '', hashFor(view, ticker));
    setView(view);
  };

  return (
    <span className="tk-links">
      {links.map(([view, glyph, title]) => (
        <button key={view} type="button" className="tk-link"
                title={`${ticker} — ${title.toLowerCase()}`}
                aria-label={`${ticker}: ${title}`}
                onClick={() => go(view)}>{glyph}</button>
      ))}
    </span>
  );
}

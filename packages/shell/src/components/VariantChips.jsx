/* The switcher itself. Reuses `.seg` from base.css so it reads as the same
   segmented control the rest of the dashboard uses, rather than introducing a
   sixth kind of button for a temporary affordance.

   The name of the current variant sits beside the numbers: five unlabelled
   digits is a thing you click at random, and the whole exercise is choosing
   between named ideas. */
export function VariantChips({ v, setV, labels }) {
  return (
    <span className="lk-switch">
      <span className="lk-kicker">Look</span>
      <span className="seg seg-variant">
        {labels.map((label, i) => (
          <button key={label} type="button"
                  className={v === i + 1 ? 'is-active' : ''}
                  aria-pressed={v === i + 1}
                  title={`${i + 1} — ${label}`}
                  onClick={() => setV(i + 1)}>{i + 1}</button>
        ))}
      </span>
      <span className="lk-name">{labels[v - 1]}</span>
    </span>
  );
}

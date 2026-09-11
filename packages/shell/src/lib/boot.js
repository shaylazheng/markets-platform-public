/* The boot cover: the screen that stands in front of the app from the first
 * byte until the surface you asked for is actually usable.
 *
 * WHY IT IS NOT A REACT COMPONENT. The gap it exists to fill starts before
 * React exists. The bundle is ~620 KB and `#root` is empty until it parses, so
 * anything rendered by React arrives strictly after the blank period it is
 * meant to cover. The cover is therefore markup in index.html, painted with the
 * first frame, and this module is the handle React drives it through. One
 * element, one owner, no second mount and no crossfade between two versions of
 * the same screen.
 *
 * The rules that keep a loading screen from being worse than no loading screen:
 *
 *   - It NEVER reappears. It is a boot cover, not a route transition. Switching
 *     to Competitors twenty minutes in must not black out the workspace; every
 *     call here is a no-op once dismissed.
 *   - It ALWAYS lifts. A hard ceiling fires whatever happens, because a surface
 *     that never reports ready (dead endpoint, no network) must degrade to the
 *     panel-level error states underneath, not trap the reader behind a spinner.
 *   - It is ESCAPABLE. A skip button appears shortly after it does.
 *   - It does not FLASH. On a warm cache the app is ready in under a tenth of a
 *     second; fading out over 260 ms from there reads as a glitch, so a cover
 *     that was barely up is removed instantly instead.
 *
 * Progress is reported by whichever surface is mounted, through useBootGate.
 */

const HARD_CEILING_MS = 9000;   // lift regardless — see rule 2
const SKIP_AFTER_MS = 2200;     // when the escape hatch appears
const FADE_MS = 260;
const NO_FADE_UNDER_MS = 250;   // below this the cover barely existed; cut it

const startedAt = Date.now();
let dismissed = false;
let ceiling = null;
let skipTimer = null;

const el = (id) => document.getElementById(id);
const root = () => el('boot');

/** Human names for the surfaces, so the cover can say what it is waiting for. */
export const SURFACE_LABEL = {
  markets: 'Markets', calendar: 'Calendar', news: 'Newswire', learn: 'Learn',
  graph: 'Company graph', insider: 'Insider screener', competitors: 'Competitors',
  book: 'Book', risk: 'Risk', thesis: 'Thesis', credit: 'Credit & rates', valuation: 'Valuation', review: 'Review',
  management: 'Management', alerts: 'Signal monitor', evidence: 'Signal record',
};

/* index.html renders the cover with the surface name already filled in from the
   hash, so this only has to run when something changes. */
function paint({ label, done, total }) {
  const bar = el('boot-bar');
  const note = el('boot-note');
  if (note && label) note.textContent = label;
  if (!bar) return;
  if (total > 0) {
    const pct = Math.max(4, Math.min(100, Math.round((done / total) * 100)));
    bar.style.setProperty('--p', `${pct}%`);
    bar.dataset.mode = 'determinate';
    const pctEl = el('boot-pct');
    if (pctEl) pctEl.textContent = `${pct}%`;
  } else {
    // No countable work: an indeterminate sweep rather than a fake percentage.
    bar.dataset.mode = 'indeterminate';
    const pctEl = el('boot-pct');
    if (pctEl) pctEl.textContent = '';
  }
}

/** Take the cover down. Idempotent; safe to call before the DOM exists. */
export function dismissBoot(reason = 'ready') {
  if (dismissed) return;
  dismissed = true;
  clearTimeout(ceiling);
  clearTimeout(skipTimer);
  const node = root();
  if (!node) return;
  node.dataset.reason = reason;
  document.documentElement.removeAttribute('data-booting');
  if (Date.now() - startedAt < NO_FADE_UNDER_MS) {
    node.remove();
    return;
  }
  node.classList.add('is-going');
  // Removed rather than hidden: it is a full-viewport layer, and one left in
  // the tree keeps swallowing clicks if a transition never fires.
  setTimeout(() => node.remove(), FADE_MS + 40);
}

export const bootDismissed = () => dismissed;

/**
 * Report the active surface's progress.
 * @param {{ready:boolean, label?:string, done?:number, total?:number}} p
 */
export function reportBoot(p) {
  if (dismissed) return;
  paint(p);
  if (p.ready) dismissBoot('ready');
}

/** Wire up the escape hatch and the ceiling. Called once, from main.jsx. */
export function armBoot() {
  if (dismissed || !root()) return;
  ceiling = setTimeout(() => dismissBoot('timeout'), HARD_CEILING_MS);
  skipTimer = setTimeout(() => {
    const skip = el('boot-skip');
    if (skip) {
      skip.hidden = false;
      skip.addEventListener('click', () => dismissBoot('skipped'), { once: true });
    }
  }, SKIP_AFTER_MS);
}

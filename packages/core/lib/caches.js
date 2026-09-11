/* The dashboard-wide cache registry behind the top bar's Refresh button.
 *
 * Every server module holding an in-memory cache registers a named clear
 * function here at import time; POST /api/refresh calls clearAllCaches() and
 * reports exactly which caches it flushed. A registry rather than a
 * convention, because the alternative — the gateway importing each module's
 * cache internals — would couple it to every section's private state.
 *
 * Deliberately NOT registered: the EDGAR document caches. A filed document
 * never changes, so re-fetching filings on a refresh would spend SEC's
 * fair-access budget to be told what we already know.
 */
const registry = new Map(); // name -> () => void

export function registerCache(name, clear) {
  registry.set(name, clear);
}

/** Clears every registered cache; returns the names cleared. */
export function clearAllCaches() {
  const cleared = [];
  for (const [name, clear] of registry) {
    try { clear(); cleared.push(name); } catch { /* one bad cache must not stop the rest */ }
  }
  return cleared;
}

/* Design-variant switch, per surface.
 *
 * A surface that is being iterated on stamps `data-<key>-v="1..n"` on its own
 * root and renders <VariantChips> in its control bar. Every variant is real
 * code against real data — the point is to compare five designs on the same
 * NVDA, not on five sets of mock numbers — and the losing four delete by
 * removing their CSS block and their branch.
 *
 * State lives in localStorage, NOT in the hash. Competitors and Valuation each
 * own their hash tail and rewrite it wholesale on every change; threading a
 * sixth parameter through both writers would buy a shareable link at the price
 * of two more chances to stomp `#graph&focus=`. The chosen variant is a
 * workbench setting, not part of what a bookmark means.
 */
import { useCallback, useEffect, useState } from 'react';

const KEY = (k) => `look:${k}`;

const ok = (n, count) => (Number.isInteger(n) && n >= 1 && n <= count ? n : null);

function read(key, count, fallback) {
  /* `?look=3` wins over stored state, and it is not decoration: a headless
     screenshot runs on a fresh Chrome profile with no localStorage at all, so
     without it every shot of every look is look 1. It sits in the QUERY rather
     than the hash because the hash after `#` belongs to the surface, and
     index.html already reads ?theme= the same way. */
  try {
    const q = ok(Number(new URLSearchParams(location.search).get('look')), count);
    if (q) return q;
  } catch { /* no location under SSR */ }
  try {
    return ok(Number(localStorage.getItem(KEY(key))), count) ?? fallback;
  } catch { return fallback; }   // storage can be unavailable; SSR has none
}

/**
 * @param {number} [fallback] which look to show when nothing is stored — i.e.
 *   the surface's chosen design, once one has been chosen. A surface still
 *   under review leaves it at 1.
 * @returns {[number, (n:number)=>void]} the active variant and a setter.
 */
export function useVariant(key, count, fallback = 1) {
  // Lazily initialised so the render checks — which run under
  // renderToStaticMarkup with no localStorage — get the fallback without
  // throwing.
  const [v, setV] = useState(() => read(key, count, fallback));

  const set = useCallback((n) => {
    const safe = Number.isInteger(n) && n >= 1 && n <= count ? n : fallback;
    setV(safe);
    try { localStorage.setItem(KEY(key), String(safe)); } catch { /* ignore */ }
  }, [key, count, fallback]);

  /* Number keys switch variants while the surface is up — comparing five
     designs means flipping between them quickly, and reaching for a chip each
     time loses the comparison. Ignored while typing: every one of these
     surfaces has a ticker box. */
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= count) set(n);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, set]);

  return [v, set];
}

/* The one place any chart colour on the Competitors surface is decided.
 *
 * Validated with the dataviz palette validator against the real bloom.css
 * tokens, both themes:
 *
 *   3 categorical slots, all-pairs : PASS (worst dE 9.4 deutan / 20.9 normal)
 *   4 categorical slots, all-pairs : HARD FAIL in dark (#8b5cd6 vs #3987e5,
 *                                    dE 3.6 deutan / 13.3 normal)
 *
 * So colour is a THREE-SLOT SPOTLIGHT over an unbounded peer set, not a palette
 * that grows with it. A sixth peer never gets a generated hue; it becomes
 * context ink. The full population always lives in the ratio matrix, which is a
 * table and has no colour ceiling.
 *
 * Two further rules the validator implies:
 *   - light mode WARNs on contrast for two of the hues, which obligates visible
 *     labels or a table view; every chart here ships direct labels and the
 *     matrix is the table.
 *   - dark mode's worst adjacent pair sits in the 6-8 dE floor band, legal only
 *     with secondary encoding -- hence the dash patterns and point styles
 *     below, mirroring base.css:714-729 where the five calendar categories each
 *     carry a distinct SHAPE for exactly this reason.
 */
import { useEffect, useState } from 'react';
import { useApp } from '@markets/shell/lib/store.jsx';

const cssVar = (n, f = '') =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f;

/* Slot order is fixed. Colour follows the ENTITY (its position in the sorted
   spotlight list), never its rank in whatever chart is on screen -- removing a
   peer must not repaint the survivors. */
const SLOT_VARS = ['--cat-econ', '--cat-fed', '--cat-earnings'];
const SLOT_DASH = [[], [6, 3], [2, 3]];
const SLOT_POINT = ['circle', 'rect', 'triangle'];

export function usePeerPalette() {
  const { theme } = useApp();
  const [p, setP] = useState(read);
  // Re-read on theme change so the surface retints with the toggle rather than
  // baking hexes at first render.
  useEffect(() => { setP(read()); }, [theme]);
  return p;
}

function read() {
  return {
    focal: cssVar('--ink', '#111'),
    accent: cssVar('--accent', '#8a3a6b'),
    slots: SLOT_VARS.map((v) => cssVar(v)),
    context: cssVar('--ink-fainter', 'rgba(0,0,0,.3)'),
    up: cssVar('--up', '#0e8a52'),
    down: cssVar('--down', '#d1442b'),
    grid: cssVar('--chart-grid', 'rgba(0,0,0,.06)'),
    tick: cssVar('--ink-faint', 'rgba(0,0,0,.45)'),
    ink: cssVar('--ink', '#111'),
    panel: cssVar('--panel', '#fff'),
    tipBg: cssVar('--panel-2', '#fff'),
    tipBorder: cssVar('--hairline', 'rgba(0,0,0,.12)'),
  };
}

/**
 * Style for one series.
 * @param ticker   the series' entity
 * @param focal    the focal ticker (always ink, always end-labelled)
 * @param spotlight up to SPOT_CAP tickers that get a hue
 */
export function seriesStyleFor(ticker, { focal, spotlight = [], palette }) {
  if (ticker === focal) {
    return { color: palette.focal, borderWidth: 2.4, borderDash: [],
             pointStyle: 'circle', label: true, z: 3 };
  }
  const i = spotlight.indexOf(ticker);
  if (i >= 0 && i < SLOT_VARS.length) {
    return { color: palette.slots[i], borderWidth: 1.8, borderDash: SLOT_DASH[i],
             pointStyle: SLOT_POINT[i], label: true, z: 2 };
  }
  // Context: present and readable, but not competing for identity.
  return { color: palette.context, borderWidth: 1.2, borderDash: [],
           pointStyle: 'circle', label: false, z: 1 };
}

export { SLOT_VARS, SLOT_DASH, SLOT_POINT };

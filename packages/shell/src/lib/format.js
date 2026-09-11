/* Display formatters, shared by every surface that shows money.
 *
 * These lived in useBook.js, which made Risk, Valuation, Thesis and Review all
 * import the book's data hook to get a percent sign. They are pure functions
 * with no dependency on the book, so they sit in the shell instead and the
 * hook keeps only the fetch.
 */

export const money = (v, dec = 2) => v == null ? '—'
  : (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US',
      { minimumFractionDigits: dec, maximumFractionDigits: dec });

/** Compact, for the header strip: $91.1K, $1.24M. */
export const moneyShort = (v) => {
  if (v == null) return '—';
  const a = Math.abs(v), sign = v < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(2)}`;
};

export const pct = (v, dec = 1) => v == null ? '—'
  : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(dec)}%`;

export const signed = (v, dec = 2) => v == null ? '—'
  : (v >= 0 ? '+' : '−') + '$' + Math.abs(v).toLocaleString('en-US',
      { minimumFractionDigits: dec, maximumFractionDigits: dec });

/** Null is not a direction. A zero P&L is neither up nor down, and colouring
 *  it green would overstate a position that has done nothing. */
export const dir = (v) => v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '';

export const fmtDays = (d) => d == null ? '—'
  : d < 90 ? `${d}d`
  : d < 730 ? `${Math.round(d / 30.44)}mo`
  : `${(d / 365.25).toFixed(1)}y`;

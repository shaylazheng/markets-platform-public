/* Is this string one identifiable company?
 *
 * The canvas read "245 companies indexed" against 39 real ones. The other 206
 * were synthesised from whatever an earnings call or a 10-K scan happened to
 * name, and among them were 17 strings that are not companies at all but were
 * still drawn as cards you could click, focus and save:
 *
 *   placeholders   "Undisclosed largest customer", "Three largest customers
 *                  (unnamed)", "The unnamed CCBX partner", "Hidden" — the
 *                  ABSENCE of a name. A node asserts a company exists exactly
 *                  where the filing declined to identify one.
 *   aggregates     "Customer concentration", "Partner concentration" — a
 *                  disclosure topic that got read as a counterparty.
 *   enumerations   "LendingPoint, Prosper, Bluevine, Pliant", "The Bancorp /
 *                  Cross River Bank / Columbia Banking System / …" — several
 *                  companies in one string, so the node is none of them.
 *   descriptions   "Cat dealer network" — a channel, not a counterparty.
 *
 * Dropping them costs nothing: not one can be researched, priced, correlated or
 * looked up in EDGAR, which is everything this surface does with a node. The
 * relationship still reads in the panel's own mention text.
 *
 * CONSERVATIVE ON PURPOSE. A genuine private or foreign company — Anthropic,
 * OpenAI, SK hynix, GOJO Industries, Centerbridge Partners — is a company and
 * must survive. The first version of this ended `\b(partners?|clients?)$` and
 * killed Centerbridge Partners, Joule Capital Partners and OMNIA Partners,
 * which are three real firms. The test is whether the string names ONE
 * identifiable entity, never whether it carries a ticker. If you loosen or
 * tighten these rules, add the string that made you to entity.test.js.
 */

const PLACEHOLDER = /\b(undisclosed|unnamed|unidentified|not disclosed|not named|hidden|anonymou)/i;
const AGGREGATE = /\bconcentration\b/i;
/* A leading quantifier means the string is counting counterparties rather than
   naming one. `\b` after the word keeps "Topstep" and "Twoness" out of it. */
const QUANTIFIED = /^(the\s+)?(largest|top|three|two|several|other|certain|various|multiple)\b/i;
/* Only "network" — the other channel nouns (partners, clients, distributors)
   end too many real company names to be safe as a trailing test. */
const CHANNEL = /\bnetwork$/i;

/** Several companies in one string: a slash-separated list, or three-plus
 *  comma-separated parts. Two commas is the floor because "Coastal Financial
 *  Corp, Inc." and "Smith, Jones and Co." are single names with one comma. */
export const isEnumeration = (s) => /\s\/\s/.test(s) || (String(s).match(/,/g) || []).length >= 2;

export function isCompanyName(raw) {
  const s = String(raw || '').trim();
  if (s.length < 2 || s.length > 60) return false;
  if (isEnumeration(s)) return false;
  return !(PLACEHOLDER.test(s) || AGGREGATE.test(s) || QUANTIFIED.test(s) || CHANNEL.test(s));
}

/* "Samsung" and "Samsung Electronics" arrived as two nodes for one company.
   Fold on a normalised key so the second mention lands on the first's card.
   Legal-form and generic descriptor words are stripped; anything distinctive
   is kept, so "Coastal Financial" and "Coastal Community" stay apart. */
export const NAME_KEY = (s) => String(s).toLowerCase()
  .replace(/\s*\([^)]*\)\s*/g, ' ')
  .replace(/\b(inc|corp|corporation|co|ltd|limited|plc|llc|lp|sa|se|nv|ag|group|holdings?|technologies|technology|electronics|systems|industries)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

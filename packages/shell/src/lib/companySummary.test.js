/* companySummary.js — the `omit` vocabulary and the absence remapping.
 *
 * Run: node --test packages/shell/src/lib/companySummary.test.js
 *
 * The hook and the fetch cache are not covered here: they need a DOM and a
 * `fetch`, and what actually carries risk in this module is the section
 * bookkeeping. The rule worth protecting is the one in the component's header —
 * an absence must never be silently swallowed. A section that a surface omits
 * takes its absence reasons with it (that surface reports them now); a section
 * still on screen keeps them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUMMARY_SECTIONS, normaliseOmit, visibleAbsences } from './companySummary.js';

test('no omit means nothing is hidden', () => {
  for (const empty of [undefined, null, [], '']) {
    assert.equal(normaliseOmit(empty).size, 0, String(empty));
  }
});

test('normaliseOmit accepts the section keys it advertises', () => {
  for (const k of SUMMARY_SECTIONS) {
    assert.ok(normaliseOmit([k]).has(k), k);
  }
});

test('normaliseOmit is case- and whitespace-forgiving', () => {
  const s = normaliseOmit([' Risks ', 'CATALYSTS']);
  assert.ok(s.has('risks'));
  assert.ok(s.has('catalysts'));
});

test('a bare string is treated as a one-element list', () => {
  assert.ok(normaliseOmit('risks').has('risks'));
});

test('the outlook group expands to guidance and catalysts', () => {
  const s = normaliseOmit(['outlook']);
  assert.ok(s.has('guidance'));
  assert.ok(s.has('catalysts'));
  // ...and is not itself a section, so nothing tests `has('outlook')`.
  assert.ok(!SUMMARY_SECTIONS.includes('outlook'));
});

test('guidance and catalysts gate independently', () => {
  // The case that motivated splitting them: a surface owning the catalyst
  // calendar does not thereby own next quarter's guidance.
  const s = normaliseOmit(['catalysts']);
  assert.ok(s.has('catalysts'));
  assert.ok(!s.has('guidance'));
});

test('an unknown key is dropped rather than trusted', () => {
  const s = normaliseOmit(['risks', 'riskz', 'what happens next']);
  assert.deepEqual([...s], ['risks']);
});

/* ---- absences ----------------------------------------------------------- */

const ABSENT = {
  foundedYear: 'No incorporation year stated in the annual report.',
  segmentRevenue: 'Segment revenue is tagged on dimensional axes SEC does not expose.',
  concentration: 'No share-of-revenue disclosure found.',
  riskGroups: 'The risk factors are not grouped under headings this can read.',
  guidance: 'The last quarter’s intel records no guidance.',
  view: 'No hand-written analysis on file.',
};

test('with nothing omitted, every absence with a reason is shown', () => {
  const got = visibleAbsences(ABSENT);
  assert.equal(got.length, Object.keys(ABSENT).length);
});

test('an absence with a blank reason is never shown', () => {
  const got = visibleAbsences({ ...ABSENT, employees: '', segments: '   ', figures: null });
  assert.ok(!got.some(([k]) => ['employees', 'segments', 'figures'].includes(k)));
});

test('omitting risks takes the risk-grouping absence with it', () => {
  const got = visibleAbsences(ABSENT, normaliseOmit(['risks']));
  assert.ok(!got.some(([k]) => k === 'riskGroups'));
  // Everything else survives — omission is scoped, not a blanket silence.
  assert.ok(got.some(([k]) => k === 'concentration'));
  assert.ok(got.some(([k]) => k === 'view'));
});

test('omitting catalysts does NOT hide the guidance absence', () => {
  // They are different sections; the guidance line is still on screen, so its
  // absence still has to explain itself.
  const got = visibleAbsences(ABSENT, normaliseOmit(['catalysts']));
  assert.ok(got.some(([k]) => k === 'guidance'));
});

test('omitting the whole outlook group hides the guidance absence', () => {
  const got = visibleAbsences(ABSENT, normaliseOmit(['outlook']));
  assert.ok(!got.some(([k]) => k === 'guidance'));
});

test('omitting the business block hides the facets it owns', () => {
  const got = visibleAbsences(ABSENT, normaliseOmit(['business']));
  for (const k of ['foundedYear', 'segmentRevenue']) {
    assert.ok(!got.some(([kk]) => kk === k), k);
  }
});

test('omitting a section does not hide another section’s absence', () => {
  // The failure this guards against: a mapping that over-reaches and quietly
  // drops reasons for fields still rendered. Only concentration goes.
  const got = visibleAbsences(ABSENT, normaliseOmit(['concentration']));
  assert.deepEqual(
    got.map(([k]) => k).sort(),
    ['foundedYear', 'guidance', 'riskGroups', 'segmentRevenue', 'view'],
  );
});

test('the Risks & Catalysts case: two sections out, the rest intact', () => {
  const got = visibleAbsences(ABSENT, normaliseOmit(['risks', 'catalysts']));
  assert.deepEqual(
    got.map(([k]) => k).sort(),
    ['concentration', 'foundedYear', 'guidance', 'segmentRevenue', 'view'],
  );
});

test('visibleAbsences tolerates a missing absent map', () => {
  assert.deepEqual(visibleAbsences(undefined), []);
  assert.deepEqual(visibleAbsences(null, normaliseOmit(['risks'])), []);
});

/* Every string here is REAL — taken from data/earnings/*.json mentions and
   data/draft/*.json related lists as they stood when the canvas claimed "245
   companies indexed". That matters: the first version of isCompanyName passed
   on invented examples and then killed three real firms whose names end in
   "Partners". Add the string that made you change the rules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCompanyName, isEnumeration, NAME_KEY } from './entity.js';

const NOT_COMPANIES = [
  'Undisclosed largest customer',
  'Undisclosed concentrated customers',
  'Undisclosed semiconductor-solutions distributor',
  'Three largest customers (unnamed)',
  'Largest clearing firm (unnamed)',
  'U.S. veterinary distributor (unnamed)',
  'The unnamed CCBX partner',
  'Customer concentration',
  'Partner concentration',
  'Hidden',
  'Cat dealer network',
  'LendingPoint, Prosper, Bluevine, Pliant',
  'The Bancorp / Cross River Bank / Columbia Banking System / Heritage Financial',
  'GreenFi / Mission Financial Partners / Albert',
];

/* The ones the over-eager first draft destroyed, plus the private and foreign
   companies the mention layer exists to carry. */
const COMPANIES = [
  'Centerbridge Partners', 'Joule Capital Partners', 'OMNIA Partners',
  'Anthropic', 'OpenAI', 'xAI', 'SpaceX', 'ByteDance', 'Cerebras Systems',
  'SK hynix', 'Samsung Electronics', 'GOJO Industries', 'Evolve Bank & Trust',
  'Fidelity Digital Assets', 'Hemlock Semiconductor', 'Boehringer Ingelheim Animal Health',
  'Topstep', 'Big Geyser', "L'Oréal", 'Crédit Agricole', 'Deutsche Börse (Eurex)',
  'Hong Kong Exchanges and Clearing', 'U.S. Department of Veterans Affairs',
  'Coastal Financial Corp, Inc.',            // one comma is a legal form, not a list
];

test('placeholders, aggregates, enumerations and channels are not companies', () => {
  for (const s of NOT_COMPANIES) {
    assert.equal(isCompanyName(s), false, `should have been rejected: ${s}`);
  }
});

test('real companies survive, including the three that end in Partners', () => {
  for (const s of COMPANIES) {
    assert.equal(isCompanyName(s), true, `should have been kept: ${s}`);
  }
});

test('enumeration needs a slash or three-plus parts', () => {
  assert.equal(isEnumeration('A / B'), true);
  assert.equal(isEnumeration('A, B, C'), true);
  assert.equal(isEnumeration('Coastal Financial Corp, Inc.'), false);
});

test('empty and absurd inputs are rejected rather than thrown on', () => {
  for (const s of ['', ' ', null, undefined, 'X', 'a'.repeat(61)]) {
    assert.equal(isCompanyName(s), false);
  }
});

test('name keys fold legal forms and descriptors, not distinctive words', () => {
  assert.equal(NAME_KEY('Samsung'), NAME_KEY('Samsung Electronics'));
  assert.equal(NAME_KEY('GOJO Industries'), NAME_KEY('GOJO'));
  assert.notEqual(NAME_KEY('Coastal Financial'), NAME_KEY('Coastal Community'));
  assert.notEqual(NAME_KEY('Evolve Bank & Trust'), NAME_KEY('Cross River Bank'));
});

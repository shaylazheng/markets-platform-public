/* The refresh button's cache registry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerCache, clearAllCaches } from './caches.js';

test('clearAllCaches clears every registered cache, survives a throwing one, and names what it cleared', () => {
  let a = 0, b = 0;
  registerCache('t:a', () => { a += 1; });
  registerCache('t:boom', () => { throw new Error('nope'); });
  registerCache('t:b', () => { b += 1; });
  const cleared = clearAllCaches();
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.ok(cleared.includes('t:a') && cleared.includes('t:b'), 'names reported');
  assert.ok(!cleared.includes('t:boom'), 'the thrower is not claimed as cleared');
  /* Re-registering under the same name replaces, not duplicates. */
  registerCache('t:a', () => { a += 10; });
  clearAllCaches();
  assert.equal(a, 11, 'replacement ran once');
});

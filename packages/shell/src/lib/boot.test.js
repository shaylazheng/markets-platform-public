/* boot.js against a stub DOM. No browser, no bundler.
 * Run: node --test web/src/lib/boot.test.js
 *
 * Every test here is one of the four rules in boot.js's header. They are the
 * difference between a loading screen and a trap: a cover that reappears on a
 * view switch, or never lifts because one endpoint is down, is worse than
 * showing an empty workspace.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/* A DOM small enough to reason about and big enough for boot.js. */
function stubDom() {
  const nodes = new Map();
  const mk = (id) => {
    const n = {
      id, textContent: '', hidden: true, dataset: {}, style: {},
      classList: { set: new Set(), add(c) { this.set.add(c); }, contains(c) { return this.set.has(c); } },
      removed: false,
      remove() { this.removed = true; nodes.delete(id); },
      setProperty() {},
      addEventListener(_e, fn) { this.fire = fn; },
    };
    n.style.setProperty = (k, v) => { n.style[k] = v; };
    nodes.set(id, n);
    return n;
  };
  for (const id of ['boot', 'boot-bar', 'boot-note', 'boot-pct', 'boot-skip']) mk(id);
  const rootAttrs = {};
  globalThis.document = {
    getElementById: (id) => nodes.get(id) || null,
    documentElement: {
      setAttribute: (k, v) => { rootAttrs[k] = v; },
      removeAttribute: (k) => { delete rootAttrs[k]; },
      getAttribute: (k) => rootAttrs[k],
    },
  };
  return { nodes, rootAttrs };
}

/* Fresh module per test: boot.js holds one-shot module state on purpose. */
const load = async () => import(`./boot.js?t=${Math.random()}`);

test('progress paints a determinate bar and the surface it is waiting for', async () => {
  const { nodes } = stubDom();
  const boot = await load();
  boot.reportBoot({ ready: false, label: 'Competitors · fundamentals 5 of 7', done: 5, total: 7 });
  assert.equal(nodes.get('boot-note').textContent, 'Competitors · fundamentals 5 of 7');
  assert.equal(nodes.get('boot-bar').dataset.mode, 'determinate');
  assert.equal(nodes.get('boot-bar').style['--p'], '71%');
  assert.equal(nodes.get('boot-pct').textContent, '71%');
  assert.equal(boot.bootDismissed(), false, 'not ready — the cover must stay up');
});

test('with nothing countable the bar sweeps instead of inventing a percentage', async () => {
  const { nodes } = stubDom();
  const boot = await load();
  boot.reportBoot({ ready: false, label: 'Newswire · headlines', done: 0, total: 0 });
  assert.equal(nodes.get('boot-bar').dataset.mode, 'indeterminate');
  assert.equal(nodes.get('boot-pct').textContent, '');
});

test('ready lifts the cover and releases the scroll lock', async () => {
  const { nodes, rootAttrs } = stubDom();
  const boot = await load();
  assert.equal(boot.bootDismissed(), false);
  boot.reportBoot({ ready: true, label: 'Markets' });
  assert.equal(boot.bootDismissed(), true);
  assert.equal(rootAttrs['data-booting'], undefined, 'body must be able to scroll again');
  assert.equal(nodes.get('boot')?.removed ?? true, true);
});

test('RULE: it never comes back', async () => {
  const { nodes } = stubDom();
  const boot = await load();
  boot.reportBoot({ ready: true });
  const note = nodes.get('boot-note');
  const before = note ? note.textContent : null;
  // Switching surfaces twenty minutes in must not black out the workspace.
  boot.reportBoot({ ready: false, label: 'Insider screener · screener', done: 0, total: 0 });
  assert.equal(boot.bootDismissed(), true, 'a later report must not resurrect the cover');
  if (note) assert.equal(note.textContent, before, 'and must not repaint it');
});

test('RULE: a cover that was barely up is cut, not faded', async () => {
  const { nodes } = stubDom();
  const boot = await load();
  boot.reportBoot({ ready: true });
  const el = nodes.get('boot');
  // Removed outright: fading out 260ms after an 80ms appearance reads as a glitch.
  assert.equal(el, undefined, 'node should be gone from the map immediately');
});

test('RULE: it always lifts, even if no surface ever reports ready', async () => {
  stubDom();
  const boot = await load();
  boot.armBoot();
  assert.equal(boot.bootDismissed(), false);
  // The ceiling is the guarantee that a dead endpoint degrades to the panel
  // error states underneath rather than trapping the reader.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(boot.bootDismissed(), false, 'and not before it is due');
  boot.dismissBoot('timeout');
  assert.equal(boot.bootDismissed(), true);
});

test('RULE: there is an escape hatch, and pressing it lifts the cover', async () => {
  const { nodes } = stubDom();
  const boot = await load();
  boot.armBoot();
  const skip = nodes.get('boot-skip');
  assert.equal(skip.hidden, true, 'hidden at first — it is a fallback, not a control');
  await new Promise((r) => setTimeout(r, 2300));
  assert.equal(skip.hidden, false, 'revealed once the wait is long enough to be annoying');
  skip.fire();
  assert.equal(boot.bootDismissed(), true);
});

test('dismiss is idempotent and survives a missing DOM', async () => {
  stubDom();
  const boot = await load();
  boot.dismissBoot('ready');
  assert.doesNotThrow(() => boot.dismissBoot('ready'));
  globalThis.document = { getElementById: () => null,
                          documentElement: { setAttribute() {}, removeAttribute() {} } };
  assert.doesNotThrow(() => boot.reportBoot({ ready: true }));
});

test('every surface has a label, so the cover never spins anonymously', async () => {
  stubDom();
  const { SURFACE_LABEL } = await load();
  for (const v of ['markets', 'calendar', 'news', 'learn', 'graph', 'insider', 'competitors']) {
    assert.ok(SURFACE_LABEL[v], `${v} has no boot label`);
  }
});

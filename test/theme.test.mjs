import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../src/theme.js', import.meta.url), 'utf8');
function boot(saved, blocked = false) {
  const root = { dataset: {} }, listeners = {}, handlers = {}, writes = [], changes = [];
  const select = { value: '', addEventListener: (type, cb) => { handlers[type] = cb; } };
  let ready;
  vm.runInNewContext(script, {
    Event,
    document: {
      documentElement: root, getElementById: () => ready ? select : null,
      addEventListener: (_type, cb) => { ready = cb; },
    },
    window: { addEventListener: (type, cb) => { listeners[type] = cb; }, dispatchEvent: event => changes.push(event.type) },
    localStorage: {
      getItem: () => { if (blocked) throw new Error('Storage unavailable'); return saved; },
      setItem: (key, value) => { if (blocked) throw new Error('Storage unavailable'); writes.push([key, value]); },
    },
  });
  const initial = root.dataset.theme;
  ready();
  return { root, select, writes, initial, changes, change: value => { select.value = value; handlers.change(); }, storage: listeners.storage };
}
test('restores a valid theme before the controls are rendered, otherwise keeps the light default', () => {
  for (const [saved, expected] of [['dark', 'dark'], ['light', 'light'], [null, 'light'], ['invalid', 'light']]) {
    const app = boot(saved);
    assert.equal(app.initial, expected);
    assert.equal(app.select.value, expected);
    assert.equal(app.writes.length, 0);
  }
});
test('changing the selector persists the choice and notifies the drawing views', () => {
  const app = boot('light');
  app.change('dark');
  assert.equal(app.root.dataset.theme, 'dark');
  assert.deepEqual(app.writes, [['relieve3d.theme', 'dark']]);
  assert.equal(app.changes.length, 2);
  app.change('light');
  assert.equal(app.root.dataset.theme, 'light');
  assert.deepEqual(app.writes.at(-1), ['relieve3d.theme', 'light']);
});
test('unavailable storage does not prevent opening the app or changing the theme', () => {
  const app = boot(null, true);
  assert.equal(app.initial, 'light');
  app.change('dark');
  assert.equal(app.root.dataset.theme, 'dark');
});
test('other windows stay synchronized without re-saving or reacting to unrelated preferences', () => {
  const app = boot('light');
  app.storage({ key: 'relieve3d.theme', newValue: 'dark' });
  assert.equal(app.select.value, 'dark');
  app.storage({ key: 'another-setting', newValue: 'light' });
  assert.equal(app.select.value, 'dark');
  app.storage({ key: null, newValue: null });
  assert.equal(app.select.value, 'light');
  assert.equal(app.writes.length, 0);
});

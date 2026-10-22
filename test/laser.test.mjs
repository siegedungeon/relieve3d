import test from 'node:test';
import assert from 'node:assert/strict';
import { geometry, distance, validateLayout, validateConfig, assertSimple, coveredPolyline, LASER_DEFAULTS } from '../src/core/laser_geometry.js';
import { optimizeLaser } from '../src/core/laser_nest.js';

const rectangle = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const template = (id, w = 15, h = 12, extra = {}) => ({ id, name: id, loops: [rectangle(w, h)], padding: 0.05, enabled: true, role: 'figure', quantity: 2, ratio: 1, complementId: '', ...extra });
const position = (id, templateId, x, y, angle = 0) => ({ id, templateId, x, y, angle });

test('true outlines can interlock although their rectangles overlap', () => {
  const l = geometry([[[0, 0], [30, 0], [30, 5], [5, 5], [5, 30], [0, 30]]]);
  const small = geometry([rectangle(10, 10).map(([x, y]) => [x + 7, y + 7])]);
  assert.equal(distance(l, small), 2);
  assert.equal(distance(l, geometry([rectangle(2, 2).map(([x, y]) => [x + 1, y + 1])])), 0);
});
test('contact, containment and stroke clearance block a cut-ready result', () => {
  const templates = [template('a')], config = { ...LASER_DEFAULTS, width: 80, height: 80 };
  assert.equal(validateLayout(templates, [position('1', 'a', 2, 2), position('2', 'a', 17, 2)], config).valid, false);
  assert.equal(validateLayout(templates, [position('1', 'a', 2, 2), position('2', 'a', 18, 2)], config).valid, false);
  const good = validateLayout(templates, [position('1', 'a', 2, 2), position('2', 'a', 19, 2)], config);
  assert.equal(good.valid, true); assert.ok(good.minGap > 1.8);
  assert.equal(validateLayout(templates, [position('1', 'a', 0.99, 2)], config).valid, false);
});
test('complements are counted as logical groups and exact ratios are required', () => {
  const templates = [template('a', 15, 12, { complementId: 'ring', ratio: 2 }), template('ring', 5, 5, { role: 'complement' })];
  const placements = [position('1', 'a', 2, 2), position('2', 'ring', 22, 2), position('3', 'ring', 30, 2)];
  assert.equal(validateLayout(templates, placements, LASER_DEFAULTS).valid, true);
  assert.equal(validateLayout(templates, placements.slice(0, 2), LASER_DEFAULTS).valid, false);
  assert.equal(validateLayout(templates, [...placements, position('4', 'ring', 38, 2)], LASER_DEFAULTS).valid, false);
  assert.throws(() => validateLayout(templates, [...placements, position('1', 'ring', 45, 2)], LASER_DEFAULTS), /identificador/);
});
test('invalid configuration and self-crossing geometry are explicit errors', () => {
  assert.throws(() => validateConfig({ gap: 0 }), /Separacion/);
  assert.throws(() => validateConfig({ width: NaN }), /invalido/);
  assert.throws(() => validateConfig({ width: 10, margin: 6 }), /Separacion/);
  assert.throws(() => assertSimple([[0, 0], [10, 10], [0, 10], [10, 0]]), /superficie|cruza/);
  assert.throws(() => validateLayout([template('a', 10, 10, { complementId: 'missing' })], [], LASER_DEFAULTS), /complemento/);
});
test('an open detail cannot jump across a concavity even with both endpoints inside', () => {
  const outline = [[0, 0], [30, 0], [30, 5], [5, 5], [5, 30], [0, 30]];
  assert.equal(coveredPolyline([[3, 25], [25, 3]], [outline]), false);
  assert.equal(coveredPolyline([[3, 25], [3, 3], [25, 3]], [outline]), true);
});
test('worker-domain optimizer completes a whole paired job without modifying the originals', async () => {
  const templates = [template('a', 20, 12, { complementId: 'ring' }), template('b', 12, 18, { complementId: 'ring' }), template('ring', 6, 6, { role: 'complement' })];
  const before = structuredClone(templates);
  const config = { ...LASER_DEFAULTS, width: 100, height: 80, mode: 'exact', seconds: 10, angleStep: 90 };
  const result = await optimizeLaser(templates, config, { maxTrials: 2 });
  assert.equal(result.figures, 4);
  assert.equal(result.placements.length, 8);
  assert.equal(validateLayout(templates, result.placements, config).valid, true);
  assert.deepEqual(templates, before);
  const aborted = await optimizeLaser(templates, config, { cancelled: () => true });
  assert.equal(aborted.cancelled, true);
});
test('a figure that fits without its oversized complement is never a completed game', async () => {
  const templates = [template('a', 5, 5, { complementId: 'ring' }), template('ring', 100, 100, { role: 'complement' })];
  const result = await optimizeLaser(templates, { ...LASER_DEFAULTS, width: 30, height: 30, angleStep: 90, seconds: 2 }, { maxTrials: 1 });
  assert.equal(result.figures, 0); assert.equal(result.placements.length, 0);
});

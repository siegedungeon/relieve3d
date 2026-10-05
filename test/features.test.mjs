import fs from 'fs';
import assert from 'assert';
import { PNG } from 'pngjs';
import { processImage } from '../src/core/processing.js';
import { shapesToGeometry, toWorld } from '../src/core/geometry.js';
import { mergeToIndexed } from '../src/core/exporters.js';
import { buildFeatures, DEFAULT_SETTINGS, pencilAcross } from '../src/core/features.js';
import { edt, dilate, fillSmallHoles, connectIslands, components, fillCircle, countOn } from '../src/core/raster.js';

// ---- raster primitives
{
  const W = 50, H = 40, m = new Uint8Array(W * H);
  m[20 * W + 25] = 1;
  const d = edt(m, W, H);
  assert(Math.abs(d[20 * W + 35] - 10) < 1e-6, 'edt horizontal');
  assert(Math.abs(d[23 * W + 29] - 5) < 1e-6, 'edt diagonal 3-4-5');
  const { index } = edt(m, W, H, true);
  assert.strictEqual(index[0], 20 * W + 25, 'edt nearest index');
  const disk = dilate(m, W, H, 5);
  assert(countOn(disk) > 70 && countOn(disk) < 90, 'dilate area ~ pi r^2');
  // hole filling by area
  const ring = new Uint8Array(W * H);
  fillCircle(ring, W, H, 25, 20, 15); fillCircle(ring, W, H, 25, 20, 10, 0);
  assert(countOn(fillSmallHoles(ring, W, H, 50)) === countOn(ring), 'big hole kept');
  assert(countOn(fillSmallHoles(ring, W, H, 1000)) > countOn(ring), 'hole filled');
  // islands
  const isl = new Uint8Array(W * H);
  fillCircle(isl, W, H, 10, 10, 5); fillCircle(isl, W, H, 40, 30, 4); fillCircle(isl, W, H, 40, 8, 3);
  const c = connectIslands(isl, W, H, 2);
  assert.strictEqual(components(c.mask, W, H).comps.length, 1, 'islands joined');
  assert.strictEqual(c.bridges, 2);
}

// ---- features on a real logo
function badEdges(g) {
  const m = mergeToIndexed([g]); const idx = m.index.array; const e = new Map();
  for (let i = 0; i < idx.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = idx[i + k], b = idx[i + (k + 1) % 3]; const key = a < b ? a + '_' + b : b + '_' + a; e.set(key, (e.get(key) || 0) + 1);
  }
  let bad = 0; for (const v of e.values()) if (v !== 2) bad++; return bad;
}
const png = PNG.sync.read(fs.readFileSync(new URL('./logo.png', import.meta.url)));
const r = processImage({ data: new Uint8ClampedArray(png.data), width: png.width, height: png.height }, {});
const fb = r.fgBBox, center = [(fb[0] + fb[2]) / 2, (fb[1] + fb[3]) / 2];
const scale = 50 / (fb[2] - fb[0]);
const S = (patch) => {
  const s = DEFAULT_SETTINGS();
  for (const [k, v] of Object.entries(patch)) s[k] = typeof v === 'object' ? { ...s[k], ...v } : v;
  return s;
};
const cases = {
  keychain: S({ base: { enabled: true, margin: 2, thickness: 2 }, ring: { enabled: true, pos: 'left' } }),
  ringNoBase: S({ ring: { enabled: true, pos: 'top' } }),
  ringManual: S({ base: { enabled: true }, ring: { enabled: true, pos: 'manual', x: fb[2] + 40, y: fb[1] } }),
  micStar: S({ base: { enabled: true, shape: 'star', plateW: 70, plateH: 70, thickness: 3 }, magnets: { enabled: true, count: 1 }, tongue: { enabled: true } }),
  heart: S({ base: { enabled: true, shape: 'heart', plateW: 70, plateH: 65 }, magnets: { enabled: true, count: 2, spacing: 25 } }),
  sign: S({ base: { enabled: true, shape: 'rect', plateW: 80, plateH: 50 }, holes: { enabled: true, count: 2 } }),
  shapes: S({ base: { enabled: true, shape: 'shield', plateW: 70, plateH: 70 } }),
  badge: S({ base: { enabled: true, shape: 'badge', plateW: 70, plateH: 70 } }),
  cloud: S({ base: { enabled: true, shape: 'cloud', plateW: 80, plateH: 60 } }),
  speech: S({ base: { enabled: true, shape: 'speech', plateW: 80, plateH: 70 } }),
  cake: S({ base: { enabled: true, margin: 3, thickness: 3 }, sticks: { enabled: true, count: 2, bar: true } }),
  cakeNoBase: S({ sticks: { enabled: true, count: 1 } }),
  pencilSide: S({ base: { enabled: true, thickness: 3 }, pencil: { enabled: true, type: 'hex' } }),
  pencilRound: S({ base: { enabled: true }, pencil: { enabled: true, type: 'round', measure: 'circumference', value: 23.5, ends: 'open' } }),
  pencilTip: S({ base: { enabled: true }, pencil: { enabled: true, type: 'triangle', mount: 'tip', value: 8 } }),
  cutter: S({ cutter: { enabled: true } }),
};
for (const [name, set] of Object.entries(cases)) {
  const t0 = Date.now();
  const f = buildFeatures(r, set, { scale, center, detail: 0.8, smooth: 1 });
  let bad = 0, n = 0;
  for (const L of f.layers) {
    assert(L.shapes.length, `${name}: layer ${L.key} has shapes`);
    bad += badEdges(toWorld(shapesToGeometry(L.shapes, ...center), scale, L.height, L.z)); n++;
  }
  for (const so of f.solids) { bad += badEdges(toWorld(so.geometry, scale, 1, 0)); n++; }
  console.log(`${name.padEnd(12)} layers=${f.layers.map((l) => l.key).join(',')} solids=${f.solids.length} bad=${bad} ${Date.now() - t0}ms ${f.warnings.join(' | ')}`);
  assert.strictEqual(bad, 0, `${name}: watertight`);
  assert(n > 0, `${name}: produced geometry`);
}
// ring hole must be a hole in the base
{
  const f = buildFeatures(r, cases.keychain, { scale, center });
  const base = f.layers.find((l) => l.key === 'base');
  assert(base.shapes.some((s) => s.holes.length), 'keychain base has a hole');
  assert(f.ring && f.ring.x < fb[0], 'ring on the left');
}
assert(Math.abs(pencilAcross({ type: 'round', measure: 'circumference', value: Math.PI * 7 }) - 7) < 1e-9);
console.log('features OK');

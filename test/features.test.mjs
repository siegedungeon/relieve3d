import fs from 'fs';
import assert from 'assert';
import { PNG } from 'pngjs';
import { processImage } from '../src/core/processing.js';
import { shapesToGeometry, toWorld } from '../src/core/geometry.js';
import { mergeToIndexed } from '../src/core/exporters.js';
import { buildFeatures, DEFAULT_SETTINGS, pencilAcross } from '../src/core/features.js';
import { BODY_PRESETS } from '../src/core/micbody.js';
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
  micBody: S({ base: { enabled: true, thickness: 2 }, micBody: { enabled: true } }),
  micStar3D: S({ base: { enabled: true }, micBody: { enabled: true, ...BODY_PRESETS.star, ox: 3, oy: -4, rot: 15 } }),
  micHeart3D: S({ micBody: { enabled: true, ...BODY_PRESETS.heart }, magnets: { enabled: true }, tongue: { enabled: true } }),
  rimAccent: S({ base: { enabled: true, margin: 4, thickness: 2.4 }, rim: { enabled: true }, accent: { enabled: true }, ring: { enabled: true } }),
  bevel: S({ base: { enabled: true, shape: 'rect', plateW: 70, plateH: 50, thickness: 3.2 }, bevel: { enabled: true, size: 0.8 } }),
  nfc: S({ base: { enabled: true, shape: 'circle', plateW: 45, plateH: 45, thickness: 2 }, nfc: { enabled: true, diameter: 25.5 }, bevel: { enabled: true } }),
  slotRing: S({ base: { enabled: true, margin: 3 }, ring: { enabled: true, style: 'slot', pos: 'top', slotW: 14, inner: 4, outer: 9 } }),
  nfcMagnet: S({ base: { enabled: true, shape: 'rect', plateW: 60, plateH: 45, thickness: 2 }, nfc: { enabled: true, diameter: 20 }, magnets: { enabled: true, count: 2, spacing: 40, diameter: 6, depth: 1 } }),
};
// synthetic back-text mask: a block "T"
const bw = 40, bh = 20, bdata = new Uint8Array(bw * bh);
for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (y < 6 || (x > 15 && x < 25)) bdata[y * bw + x] = 1;
const backMask = { data: bdata, w: bw, h: bh, mmW: 20, mmH: 10 };
cases.back = S({ base: { enabled: true, shape: 'rect', plateW: 60, plateH: 40, thickness: 2.4 }, back: { enabled: true, depth: 0.6 } });
const caseOpts = { back: { backMask } };
for (const [name, set] of Object.entries(cases)) {
  const t0 = Date.now();
  const f = buildFeatures(r, set, { scale, center, detail: 0.8, smooth: 1, ...(caseOpts[name] || {}) });
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
// mic body: logo plate sits on the body top, magnets/tongue ignored
{
  const f = buildFeatures(r, cases.micBody, { scale, center });
  assert.strictEqual(f.solids[0].key, 'micbody');
  assert(Math.abs(f.pieceZ - 42) < 1e-6, 'pieces on top of body + base');
  assert(f.layers.every((l) => l.z >= 40), 'layers on the body');
  assert(f.body && f.body.outline.length > 4);
  const h = buildFeatures(r, cases.micHeart3D, { scale, center });
  assert(!h.layers.some((l) => l.key === 'tongue' || l.key === 'baseLow'), 'no magnets/tongue with body');
}
// cookie cutter: stamp printed beside the cutter, not taller than the blade
{
  const f = buildFeatures(r, cases.cutter, { scale, center });
  const wall = f.layers.find((l) => l.key === 'cutterWall'), sb = f.layers.find((l) => l.key === 'stampBase');
  assert(wall && sb, 'cutter wall + stamp base');
  const xs = (L) => L.shapes.flatMap((s) => s.outer.map((p) => p[0]));
  assert(Math.min(...xs(sb)) > Math.max(...xs(wall)), 'stamp beside the cutter');
  const off = buildFeatures(r, S({ cutter: { enabled: true, stamp: false } }), { scale, center });
  assert(!off.layers.some((l) => l.key.startsWith('stamp')), 'stamp can be disabled');
}
assert(Math.abs(pencilAcross({ type: 'round', measure: 'circumference', value: Math.PI * 7 }) - 7) < 1e-9);
// keychain extras
{
  const f = buildFeatures(r, cases.rimAccent, { scale, center });
  assert(f.layers.some((l) => l.key === 'rim' && l.fil === 'rim'), 'rim layer');
  assert(f.layers.some((l) => l.key === 'accent'), 'accent layer');
  assert(Math.abs(f.pieceZ - 3.0) < 1e-6, 'pieces sit on accent');
  assert(f.ringRef && f.ringRef.length, 'ring snap reference');
  const n = buildFeatures(r, cases.nfc, { scale, center });
  assert.strictEqual(n.pauses.length, 1, 'nfc pause');
  const pz = n.pauses[0].z, base = n.layers.filter((l) => l.fil === 'base');
  assert(base.some((l) => l.key === 'baseNfc' && Math.abs(l.z + l.height - pz) < 1e-6), 'pause at pocket top');
  assert(n.pieceZ >= pz + 0.8 - 1e-6, 'pocket covered');
  assert(base.some((l) => l.key === 'baseTop'), 'bevel band');
  const tops = base.reduce((a, l) => Math.max(a, l.z + l.height), 0);
  assert(Math.abs(tops - n.pieceZ) < 1e-6, 'base stack continuous');
  const s = buildFeatures(r, cases.slotRing, { scale, center });
  assert(s.ring.slot && s.ring.half > 0, 'slot ring');
  const b = buildFeatures(r, cases.back, { scale, center, backMask });
  assert(b.layers.some((l) => l.key === 'baseBack'), 'back engraving band');
  // enabled subset: only the biggest piece shapes the base
  const en = r.pieces.map((p) => (p.bbox[0] + p.bbox[2]) / 2 < center[0]);
  const e = buildFeatures(r, cases.keychain, { scale, center, enabled: en });
  const full = buildFeatures(r, cases.keychain, { scale, center });
  const area = (F) => F.layers.find((l) => l.key === 'base').shapes.reduce((a, sh) => a + Math.abs(sh.outer.reduce((s2, p, i, A) => s2 + p[0] * A[(i + 1) % A.length][1] - A[(i + 1) % A.length][0] * p[1], 0)) / 2, 0);
  assert(area(e) < area(full), 'excluded pieces shrink the base');
}
console.log('features OK');

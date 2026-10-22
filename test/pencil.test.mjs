import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { processImage } from '../src/core/processing.js';
import { buildFeatures, DEFAULT_SETTINGS, pencilProfile, pencilAcross } from '../src/core/features.js';
import { preparePencil } from '../src/core/pencil.js';
import { toWorld } from '../src/core/geometry.js';
import { mergeToIndexed } from '../src/core/exporters.js';
import { MODULES, mergeDeep } from '../src/modules.js';

const w = await Module(); w.setup();
const W = 320, H = 100, data = new Uint8ClampedArray(W * H * 4);
const rect = (xa, ya, xb, yb) => {
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) data.set([220, 57, 123, 255], 4 * (y * W + x));
};
// Separated stems, a dot and uneven outlines force the base to bridge real gaps around the bore.
for (const x of [12, 72, 132, 192, 252]) { rect(x, 20, x + 18, 80); rect(x, 65, x + 45, 80); }
rect(72, 4, 90, 14);
const result = processImage({ data, width: W, height: H }, { removeBg: 'no', colors: 1, minArea: 0 });
const b = result.fgBBox, center = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const preset = MODULES.find(m => m.id === 'pencil');
assert.equal(DEFAULT_SETTINGS().pencil.mount, 'side', 'old projects retain the external sleeve');
assert.equal(preset.patch.pencil.mount, 'integrated', 'new pencil models use the reference construction');
assert.equal(preset.text.decoration, 'none');
const settings = patch => mergeDeep(mergeDeep(DEFAULT_SETTINGS(), structuredClone(preset.patch)), patch);

for (const type of ['round', 'hex', 'triangle']) for (const width of [35, 63, 90]) {
  const set = settings({ widthMM: width, base: { thickness: 16 }, pencil: { type, value: width === 90 ? 10 : 7.8, tolerance: 0.2 } });
  await preparePencil(set);
  const scale = width / (b[2] - b[0]);
  const f = buildFeatures(result, set, { scale, center, detail: 0.6, smooth: 1 });
  assert.equal(f.layers.length, 0, 'no undrilled layer fills the hole');
  assert.equal(f.solids.length, 1, 'one integrated base, not an attached sleeve');
  assert.equal(f.pieceZ, 16);
  assert.equal(f.zTop, 16);
  const g = mergeToIndexed([toWorld(f.solids[0].geometry, scale, 1, 0)]);
  const man = new w.Manifold(new w.Mesh({ numProp: 3, vertProperties: g.attributes.position.array, triVerts: g.index.array }));
  try {
    assert.equal(man.status(), 'NoError');
    const components = man.decompose();
    assert.equal(components.length, 1, 'solid connected base');
    components.forEach(m => m.delete());
    assert.equal(man.genus(), 1, 'exactly one through channel, no side holes');
    const box = man.boundingBox(), [_, y, z] = f.pencilChannel.center;
    assert.equal(man.rayCast([box.min[0] - 1, y, z], [box.max[0] + 1, y, z]).length, 0, 'channel open from end to end');
    const profile = pencilProfile(type, pencilAcross(set.pencil) + set.pencil.tolerance, 192);
    for (const x of [-width * 0.3, 0, width * 0.3]) {
      for (let j = 0; j < profile.pts.length; j += Math.max(1, Math.floor(profile.pts.length / 12))) {
        const a = profile.pts[j], next = profile.pts[(j + 1) % profile.pts.length];
        const u = (a[0] + next[0]) / 2, v = (a[1] + next[1]) / 2;
        const hit = man.rayCast([x, y, z], [x, y + u * 1.2, z + v * 1.2]);
        assert(hit.length > 0, 'solid surrounds the bore between letters');
        assert(Math.abs(hit[0].distance * 1.2 - 1) < 0.002, 'bore matches requested profile and clearance');
      }
    }
    console.log(`pencil ${type} ${width}mm: connected base, through channel, exact calibre`);
  } finally { man.delete(); g.dispose(); f.solids[0].geometry.dispose(); }
}
for (const [patch, expected] of [
  [{ base: { thickness: 8 } }, /al menos/],
  [{ base: { enabled: false } }, /Activa la base/],
  [{ pencil: { wall: 0.2 } }, /0.8 mm/],
  [{ pencil: { offset: 100 } }, /fuera del nombre/],
  ...['ring', 'holes', 'magnets', 'nfc', 'back', 'bevel', 'rim', 'accent', 'tongue', 'sticks', 'micBody', 'cutter']
    .map(key => [{ [key]: { enabled: true } }, /Desactiva/]),
]) {
  const set = settings(patch); await preparePencil(set);
  assert.throws(() => buildFeatures(result, set, { scale: 63 / (b[2] - b[0]), center }), expected, JSON.stringify(patch));
}
console.log('pencil OK');

import assert from 'node:assert/strict';
import { coloringOptions, coloringShapes, coloringSVG, coloringPDF, applyColoringEdits } from '../src/core/coloring.js';
import { fillPolygon, fillCapsule, fillCircle, components } from '../src/core/raster.js';

const W = 320, H = 320, cx = 160, cy = 160;
const options = { pageWidth: 60, pageHeight: 60, margin: 10, lineWidth: 0.75, curveSmooth: 0.6 };
const mask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dx = x + 0.5 - cx, dy = y + 0.5 - cy, angle = Math.atan2(dy, dx);
  mask[y * W + x] = Math.abs(Math.hypot(dx, dy) - (100 + 0.9 * Math.sin(angle * 90))) <= 3 ? 1 : 0;
}
const original = mask.slice();
const legacy = coloringShapes(mask, W, H);
const shapes = coloringShapes(mask, W, H, options), svg = coloringSVG(shapes, W, H, options);
assert(/\bC[-\d]/.test(svg), 'smooth artwork is exported as actual cubic curves, not thousands of straight pixel edges');
assert.deepEqual(mask, original, 'curve finishing does not destructively change the editing mask');
assert.equal(shapes.length, 1, 'the ring remains a single connected contour');
assert.equal(shapes[0].curves.length, 2, 'the white counter survives the curve fit');
const loops = shapes[0].curves;
const sample = ([a, b, c, d], t) => {
  const s = 1 - t;
  return [0, 1].map(k => s ** 3 * a[k] + 3 * s * s * t * b[k] + 3 * s * t * t * c[k] + t ** 3 * d[k]);
};
function rasterCurves(shapes) {
  const out = new Uint8Array(W * H), part = new Uint8Array(W * H);
  for (const loop of shapes.flatMap(s => s.curves)) {
    const points = loop.flatMap(c => Array.from({ length: 64 }, (_, i) => sample(c, i / 64)));
    part.fill(0); fillPolygon(part, W, H, points);
    for (let i = 0; i < out.length; i++) out[i] ^= part[i];
  }
  return out;
}
for (const [index, radius] of [103, 97].entries()) {
  const curves = loops[index], radii = [];
  assert(curves.length < 30, 'a smooth circular outline uses fewer than 30 curve segments');
  assert(curves.length < [legacy[0].outer, legacy[0].holes[0]][index].length / 8, 'fitting removes at least seven eighths of the stair-step vertices');
  for (let j = 0; j < curves.length; j++) {
    const c = curves[j], next = curves[(j + 1) % curves.length];
    assert.deepEqual(c[3], next[0], 'neighboring curves have no positional gaps');
    const a = [c[3][0] - c[2][0], c[3][1] - c[2][1]], b = [next[1][0] - next[0][0], next[1][1] - next[0][1]];
    const turn = Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
    assert(turn < 0.01, 'fitted curved joins are tangent-continuous rather than visibly angular');
    for (let n = 0; n < 100; n++) {
      const p = sample(c, n / 100);
      radii.push(Math.hypot(p[0] - cx, p[1] - cy));
    }
  }
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const roughness = Math.sqrt(radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length);
  assert(Math.max(...radii.map(r => Math.abs(r - radius))) < 1.8, 'finishing stays within 0.225 mm of the intended contour');
  assert(roughness < 0.45, `radial stair-step roughness is under 0.45 pixel, got ${roughness}`);
}
assert.equal((svg.match(/<path /g) || []).length, 1, 'all smooth loops use one even-odd compound path');
const pdf = new TextDecoder().decode(coloringPDF(shapes, W, H, options));
assert(/\sc\n/.test(pdf), 'PDF contains real cubic curve operators');
assert.equal((pdf.match(/f\*/g) || []).length, 1, 'PDF fills nested curved contours together');
assert.equal(coloringOptions({ mode: 'illustration' }).curveSmooth, 0, 'old projects do not silently switch to different geometry');
assert.deepEqual(coloringShapes(mask, W, H, { ...options, curveSmooth: 0 }), legacy, 'zero finishing reproduces legacy outlines exactly');
assert.throws(() => coloringOptions({ curveSmooth: -1 }), /curvas/);
assert.throws(() => coloringOptions({ curveSmooth: NaN }), /curvas/);
assert.throws(() => coloringOptions({ curveSmooth: 1.21 }), /curvas/);

const dot = new Uint8Array(W * H);
dot[160 * W + 160] = 1;
const small = coloringShapes(dot, W, H, options);
assert(small.length && small[0].curves[0].length, 'finishing does not discard a user-drawn dot');
assert(rasterCurves(small)[160 * W + 160], 'the tiny dot is still visible, not merely present as degenerate geometry');

for (const curveSmooth of [0.3, 0.6, 1.2]) {
  const settings = { ...options, curveSmooth }, thin = new Uint8Array(W * H);
  for (const offset of [0, 6]) for (let x = 30; x < 290; x++) {
    fillCapsule(thin, W, H, x, 80 + offset + 12 * Math.sin(x / 30), x + 1, 80 + offset + 12 * Math.sin((x + 1) / 30), 1.5);
  }
  fillCapsule(thin, W, H, 120, 180, 128, 184, 1.5);
  const finished = rasterCurves(coloringShapes(thin, W, H, settings)), parts = components(finished, W, H).comps;
  assert.equal(parts.length, 3, 'parallel thin curved lines stay separate and a short pen stroke survives');
  for (const c of parts.filter(c => c.minY < 100)) {
    assert(c.minX < 35 && c.maxX > 285, 'thin curves remain connected from end to end');
  }
  for (let x = 40; x < 280; x++) {
    const y = Math.floor(83 + 12 * Math.sin(x / 30));
    assert.equal(finished[y * W + x], 0, 'the narrow white gap between curved lines stays open');
  }
  const nested = mask.slice();
  fillCircle(nested, W, H, cx, cy, 40);
  fillCircle(nested, W, H, cx, cy, 35, 0);
  const rings = rasterCurves(coloringShapes(nested, W, H, settings));
  assert.equal(components(rings, W, H).comps.length, 2, 'separate concentric outlines are not joined or broken');
  assert.equal(rings[cy * W + cx], 0, 'the inner counter stays white');
  assert.equal(rings[cy * W + cx + 70], 0, 'the space between nested outlines stays white');
  assert(rings[cy * W + cx + 38] && rings[cy * W + cx + 100], 'neither of the nested outlines disappears');
  const erased = applyColoringEdits({ mask: nested, width: W, height: H }, [
    { kind: 'rect', points: [[0.4, 0.1], [0.6, 0.3]] },
    { kind: 'erase', width: 0.05, points: [[0.75, 0.5], [0.9, 0.5]] },
  ]);
  const finishedEdit = rasterCurves(coloringShapes(erased, W, H, settings));
  for (let y = 34; y < 94; y++) for (let x = 130; x < 190; x++) assert.equal(finishedEdit[y * W + x], 0, 'rectangle-erased lines do not reappear after finishing');
  for (let y = 154; y < 166; y++) for (let x = 242; x < 286; x++) assert.equal(finishedEdit[y * W + x], 0, 'brush-erased gaps do not reappear after finishing');
}
console.log('coloring curves OK: smooth tangent joins, bounded shape error, thin lines, dots, nested holes, erasing, vector output and legacy compatibility');

import assert from 'node:assert/strict';
import { createColoring, coloringOptions } from '../src/core/coloring.js';

const W = 256, H = 192;
const data = new Uint8ClampedArray(W * H * 4).fill(255);
const rect = (x0, y0, x1, y1, rgb) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([...rgb, 255], (y * W + x) * 4);
};
rect(135, 165, 256, 192, [211, 211, 211]);
rect(20, 20, 130, 145, [10, 8, 6]);
rect(23, 23, 127, 142, [255, 211, 175]);
rect(23, 23, 34, 142, [237, 179, 146]);
rect(55, 50, 80, 62, [5, 5, 5]);
rect(35, 92, 105, 128, [10, 8, 6]);
rect(38, 95, 102, 125, [103, 65, 51]);
rect(105, 70, 118, 83, [253, 160, 148]);
rect(40, 70, 52, 83, [241, 174, 150]);
rect(150, 35, 246, 160, [129, 195, 195]);
rect(156, 41, 240, 154, [177, 251, 249]);
const image = { data, width: W, height: H };
const options = { mode: 'illustration', colors: 16, pageWidth: 276, pageHeight: 212, margin: 10,
  lineWidth: 2, minDetail: 0, minArea: 0, contrast: 0, smooth: 0, shadowTolerance: 70 };
const runs = values => values.reduce((n, v, i) => n + (v && !values[i - 1] ? 1 : 0), 0);
const count = (mask, x0, y0, x1, y1) => {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += mask[y * W + x];
  return n;
};
const original = data.slice(), result = createColoring(image, options);
assert.equal(runs([...result.mask.slice(100 * W + 145, 100 * W + 163)]), 1, 'a colored frame becomes one black line, not the two edges of its band');
assert.equal(count(result.mask, 132, 163, W, H), 0, 'neutral drop shadows connected to the page disappear');
assert.equal(count(result.mask, 30, 65, 38, 88), 0, 'skin shading does not become an extra contour');
assert(count(result.mask, 103, 68, 121, 86) > 10, 'a different-hue cheek detail is still outlined');
assert.equal(result.mask[110 * W + 70], 0, 'large brown fills stay white inside');
assert.equal(runs(Array.from({ length: 20 }, (_, y) => result.mask[(46 + y) * W + 65])), 1, 'a small solid eye stroke stays a single line instead of a hollow loop');
assert.deepEqual(data, original, 'conversion never edits source pixels');
const shaded = createColoring(image, { ...options, shadowTolerance: 0 });
assert(count(shaded.mask, 30, 65, 38, 88) > 10, 'shadow suppression is adjustable, including off');
const regions = createColoring(image, { ...options, mode: 'regions' });
assert.equal(runs([...regions.mask.slice(100 * W + 145, 100 * W + 163)]), 2, 'legacy color-region mode retains the original behavior');
assert.equal(coloringOptions({ colors: 10 }).mode, 'regions', 'projects without the new mode keep legacy conversion');
assert.throws(() => coloringOptions({ mode: 'unknown' }), /Modo/);
assert.throws(() => coloringOptions({ shadowTolerance: -1 }), /Sombras/);
const woolData = new Uint8ClampedArray(W * H * 4).fill(255);
for (let y = 20; y < 160; y++) for (let x = 20; x < 130; x++) {
  const edge = x < 24 || x >= 126 || y < 24 || y >= 156;
  woolData.set(edge ? [10, 8, 6, 255] : y > 130 ? [236, 225, 202, 255] : [253, 249, 238, 255], (y * W + x) * 4);
}
for (let y = 50; y < 100; y++) for (let x = 170; x < 230; x++) woolData.set([247, 230, 152, 255], (y * W + x) * 4);
const wool = createColoring({ data: woolData, width: W, height: H }, options);
assert.equal(count(wool.mask, 30, 126, 120, 138), 0, 'a beige shadow of white wool disappears instead of joining an unrelated yellow object');
assert(count(wool.mask, 164, 45, 237, 105) > 100, 'the yellow object keeps its own outline');
console.log('coloring illustration OK: single colored strokes, neutral and skin shadow removal, eye strokes and legacy compatibility');

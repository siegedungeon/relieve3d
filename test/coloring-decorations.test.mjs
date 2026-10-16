import assert from 'node:assert/strict';
import { createColoring, coloringOptions, coloringLayout, coloringShapes, coloringSVG, coloringPDF } from '../src/core/coloring.js';
import { fillCircle, fillCapsule } from '../src/core/raster.js';

assert.equal(coloringOptions().decorate, false, 'decorations require explicit opt-in, including old projects');
const { DECORATION_ASSETS, DECORATION_THEMES, validateDecorations, createDecorations, decorationScene, decorationBounds, fitDecoration } =
  await import('../src/core/coloring_decorations.js');
const W = 400, H = 360, mask = new Uint8Array(W * H), result = { width: W, height: H, mask };
fillCircle(mask, W, H, 175, 75, 57);
fillCircle(mask, W, H, 175, 75, 53, 0);
for (const [a, b] of [
  [[120, 123], [90, 225]], [[225, 123], [265, 225]],
  [[35, 220], [365, 220]], [[365, 220], [365, 325]],
  [[365, 325], [35, 325]], [[35, 325], [35, 220]],
]) fillCapsule(mask, W, H, ...a, ...b, 2);
const rgba = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < mask.length; i++) rgba.set(mask[i] ? [20, 20, 20, 255] : [255, 255, 255, 255], i * 4);
for (let y = 35; y < 40; y++) for (let x = 45; x < 50; x++) rgba.set([20, 20, 20, 255], (y * W + x) * 4);
const conversion = { mode: 'illustration', colors: 4, minDetail: 0, minArea: 5, smooth: 0 };
const unframed = createColoring({ width: W, height: H, data: rgba }, conversion);
const framed = createColoring({ width: W, height: H, data: rgba }, { ...conversion, decorate: true });
assert(unframed.mask.some((v, i) => v && i % W < 60 && Math.floor(i / W) < 50), 'the regression fixture contains an intentional small source detail');
assert(unframed.mask.every((v, i) => !v || framed.mask[i]), 'reserving room for ornaments must not remove or reclassify original drawing details');
const off = coloringOptions({ curveSmooth: 0.6 }), o = coloringOptions({ ...off, decorate: true });
const plain = coloringLayout(W, H, off), layout = coloringLayout(W, H, o);
assert.equal(plain.scale, Math.min(190 / W, 277 / H), 'opting out preserves the previous layout exactly');
assert(layout.width < plain.width * 0.8 && layout.width / layout.height === W / H, 'optional composition makes space without stretching the illustration');
assert.deepEqual(createDecorations(result, plain, off, 7).items, [], 'disabled decoration cannot add resources');
const first = createDecorations(result, layout, o, 1743);
assert.equal(first.items.length, o.decorCount, 'normal paper has enough room for the requested composition');
assert.deepEqual(first, createDecorations(result, layout, o, 1743), 'saved seeds reproduce the exact same surprise');
const second = createDecorations(result, layout, o, 1744).items;
assert.notDeepEqual(first.items, second, 'a new surprise changes the composition');
assert(first.items.filter((p, i) => second[i] && Math.hypot(p.x - second[i].x, p.y - second[i].y) > 0.02).length >= first.items.length / 2,
  'a surprise visibly moves many ornaments, not just a seed or hidden identifier');
assert(first.items.some(p => p.kind === 'bouquet') && first.items.some(p => p.kind === 'star'), 'the default style combines plants, flowers and stars like the reference');
const original = mask.slice(), fingerprints = new Set();
for (const theme of Object.keys(DECORATION_THEMES)) for (const seed of [0, 1, 4, 42, 735, 4294967295]) {
  const options = { ...o, decorTheme: theme }, generated = createDecorations(result, layout, options, seed);
  assert(generated.items.length >= 6, 'every theme produces a useful, non-empty composition');
  if (generated.items.length < options.decorCount) assert(generated.warnings.length, 'limited space is reported, never silently ignored');
  validateDecorations({ seed, items: generated.items });
  fingerprints.add(JSON.stringify(generated.items.map(({ kind, x, y, size, angle }) => ({ kind, x, y, size, angle }))));
  const scene = decorationScene({ seed, items: generated.items }, options);
  for (const item of scene) {
    const b = item.bounds;
    assert(b.x0 >= o.margin - 1e-6 && b.y0 >= o.margin - 1e-6 && b.x1 <= o.pageWidth - o.margin + 1e-6 && b.y1 <= o.pageHeight - o.margin + 1e-6, 'ornaments stay inside print margins');
    for (const p of item.paths) for (const c of p.curves) for (const point of c) assert(point.every(Number.isFinite), 'all resource curves are finite');
    // A point well inside the blank sign is reserved for coloring or writing, not decoration.
    const x = layout.x + 200 * layout.scale, y = layout.y + 270 * layout.scale;
    assert(!(x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1), 'the empty center of the sign remains protected');
  }
}
assert.equal(fingerprints.size, Object.keys(DECORATION_THEMES).length * 6, 'themes and seeds do not all reuse one arrangement');
assert.deepEqual(mask, original, 'the resource engine never modifies the source artwork');
const model = { seed: 1743, items: first.items }, scene = decorationScene(model, o), shapes = coloringShapes(mask, W, H, o);
assert.deepEqual(decorationScene(JSON.parse(JSON.stringify(model)), o), scene, 'resource geometry survives project serialization exactly');
assert.deepEqual(decorationScene(model, off), [], 'turning off decorations hides a previously saved composition');
const svg = coloringSVG(shapes, W, H, o, scene), pdf = new TextDecoder().decode(coloringPDF(shapes, W, H, o, scene));
assert.equal((svg.match(/data-decoration=/g) || []).length, first.items.length, 'SVG contains every placed vector ornament');
assert(svg.includes('stroke="#000000"') && svg.includes('fill="#FFFFFF"'), 'decorations use black outlines and white interiors');
assert(pdf.includes('1 J 1 j') && pdf.includes(' B\n'), 'PDF preserves rounded strokes and opaque white interiors');
assert(!coloringSVG(shapes, W, H, off, scene).includes('data-decoration='), 'export also enforces opt-in even if cached decoration geometry exists');
assert(!svg.includes('<image'), 'resources are vector artwork, not raster clip art');
assert(Object.keys(DECORATION_ASSETS).length >= 8, 'the catalog has distinct reusable resources');
const moved = fitDecoration({ ...first.items[0], x: 0, y: 1, angle: 85 }, o), b = decorationBounds(moved, o);
assert(b.x0 >= o.margin - 1e-6 && b.y1 <= o.pageHeight - o.margin + 1e-6, 'manual movement and rotation respect print margins');
for (const patch of [{ decorate: 1 }, { decorTheme: 'unknown' }, { decorCount: 3 }, { decorCount: 25 }, { decorCount: 8.5 }]) assert.throws(() => coloringOptions(patch));
assert.deepEqual(validateDecorations(undefined), { seed: 0, items: null }, 'old projects acquire only an empty, disabled decoration model');
for (const invalid of [null, { seed: NaN, items: [] }, { seed: 1, items: [{ ...first.items[0], x: NaN }] }, { ...model, items: [first.items[0], first.items[0]] }]) assert.throws(() => validateDecorations(invalid));
console.log('coloring decorations OK: opt-in, varied deterministic themes, protected center, print bounds, vector outputs and project compatibility');

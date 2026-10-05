import fs from 'fs';
import { PNG } from 'pngjs';
import { processImage, computeSilhouette } from '../src/core/processing.js';
import { shapesToGeometry, toWorld } from '../src/core/geometry.js';
import { stlBinary, threeMF, objWithMtl, svg } from '../src/core/exporters.js';

const src = PNG.sync.read(fs.readFileSync(new URL('./captura.png', import.meta.url)));
// crop the logo area of the screenshot
const X0 = 600, Y0 = 115, X1 = 1500, Y1 = 745, W = X1 - X0, H = Y1 - Y0;
const data = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const s = ((y + Y0) * src.width + (x + X0)) * 4, d = (y * W + x) * 4;
  for (let k = 0; k < 4; k++) data[d + k] = src.data[s + k];
}
const out = new PNG({ width: W, height: H }); out.data = Buffer.from(data);
fs.writeFileSync(new URL('./logo.png', import.meta.url), PNG.sync.write(out));

let t = performance.now();
const r = processImage({ data, width: W, height: H });
console.log('process ms', Math.round(performance.now() - t));
console.log('palette', r.palette.map((p) => p.hex + ':' + p.area).join(' '));
console.log('pieces', r.pieces.length, 'fgBBox', r.fgBBox);
const depthCount = {}; r.pieces.forEach((p) => depthCount[p.depth] = (depthCount[p.depth] || 0) + 1);
console.log('depths', depthCount);
const empty = r.pieces.filter((p) => !p.shapes.length).length;
console.log('pieces without shapes', empty, 'pts total', r.pieces.reduce((a, p) => a + p.shapes.reduce((b, s) => b + s.outer.length + s.holes.reduce((c, h) => c + h.length, 0), 0), 0));
t = performance.now();
const sil = computeSilhouette(r, 20);
console.log('silhouette shapes', sil.length, 'holes', sil[0].holes.length, 'ms', Math.round(performance.now() - t));
const cx = (r.fgBBox[0] + r.fgBBox[2]) / 2, cy = (r.fgBBox[1] + r.fgBBox[3]) / 2, s = 60 / (r.fgBBox[2] - r.fgBBox[0]);
t = performance.now();
const geoms = r.pieces.map((p) => shapesToGeometry(p.shapes, cx, cy)).filter(Boolean);
console.log('geoms', geoms.length, 'ms', Math.round(performance.now() - t));
const parts = r.palette.map((pal, i) => ({ name: 'Color ' + (i + 1), color: pal.hex, filamentIndex: i,
  geometry: null, list: r.pieces.filter((p) => p.cluster === i && p.shapes.length).map((p) => toWorld(shapesToGeometry(p.shapes, cx, cy), s, 2 + i * 0.4, 0)) }));
const { mergeToIndexed } = await import('../src/core/exporters.js');
parts.forEach((p) => p.geometry = mergeToIndexed(p.list));
const stl = stlBinary(parts.map((p) => p.geometry));
const mf = threeMF(parts);
const o = objWithMtl(parts);
const sv = svg(parts.map((p, i) => ({ name: p.name, color: p.color, items: [r.pieces.filter((q) => q.cluster === i).flatMap((q) => q.shapes)] })), r.fgBBox, s);
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./out/test.stl', import.meta.url), stl);
fs.writeFileSync(new URL('./out/test.3mf', import.meta.url), mf);
fs.writeFileSync(new URL('./out/test.obj', import.meta.url), o.obj);
fs.writeFileSync(new URL('./out/test.svg', import.meta.url), sv);
console.log('stl bytes', stl.length, '3mf bytes', mf.length, 'obj', o.obj.length, 'svg', sv.length);

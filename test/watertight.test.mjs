import fs from 'fs';
import { PNG } from 'pngjs';
import { processImage, computeSilhouette } from '../src/core/processing.js';
import { shapesToGeometry, toWorld, ringGeometry } from '../src/core/geometry.js';
import { mergeToIndexed } from '../src/core/exporters.js';
const png = PNG.sync.read(fs.readFileSync(new URL('./logo.png', import.meta.url)));
for (const cfg of [{}, { colors: 4 }, { colors: 6, detail: 0.3, smooth: 0 }, { detail: 2, smooth: 3 }, { colors: 2, smooth: 2 }]) {
const r = processImage({ data: new Uint8ClampedArray(png.data), width: png.width, height: png.height }, cfg);
const cx = 400, cy = 300;
function check(g) {
  const m = mergeToIndexed([g]); const idx = m.index.array; const e = new Map();
  for (let i = 0; i < idx.length; i += 3) for (let k = 0; k < 3; k++) { const a = idx[i + k], b = idx[i + (k + 1) % 3]; const key = a < b ? a + '_' + b : b + '_' + a; e.set(key, (e.get(key) || 0) + 1); }
  let bad = 0; for (const v of e.values()) if (v !== 2) bad++; return bad;
}
let badPieces = 0, badEdges = 0;
for (const p of r.pieces) { const g = shapesToGeometry(p.shapes, cx, cy); if (!g) continue; const b = check(toWorld(g, 0.07, 2, 0)); if (b) { badPieces++; badEdges += b; } }
console.log(JSON.stringify(cfg), 'pieces', r.pieces.length, 'non-watertight pieces', badPieces, 'bad edges', badEdges);
console.log('base bad edges', check(toWorld(shapesToGeometry(computeSilhouette(r, 25), cx, cy), 0.07, 1, 0)));
console.log('ring bad edges', check(toWorld(ringGeometry(10, 10, 50, 25, cx, cy), 0.07, 1, 0)));
}


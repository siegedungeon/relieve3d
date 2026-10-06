import fs from 'fs';
import assert from 'assert';
import { PNG } from 'pngjs';
import { processImage } from '../src/core/processing.js';
import { detectElements, presetSelection, qrMatrix } from '../src/core/elements.js';
import { nearestBambu, BAMBU_PLA } from '../src/core/bambu.js';

// synthetic logo: a big square icon on the left, a word of 5 letters on the right and a small slogan below
const W = 400, H = 200, data = new Uint8ClampedArray(W * H * 4);
const rect = (x0, y0, x1, y1, [r, g, b]) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; } };
rect(10, 20, 110, 120, [220, 30, 30]);           // icon
rect(35, 45, 85, 95, [255, 255, 255]);           // icon inner colour
for (let i = 0; i < 5; i++) rect(140 + i * 45, 40, 140 + i * 45 + 32, 100, [20, 20, 120]);  // word
for (let i = 0; i < 8; i++) rect(140 + i * 26, 130, 140 + i * 26 + 18, 150, [20, 20, 120]);  // slogan
const r = processImage({ data, width: W, height: H }, { removeBg: 'auto', minArea: 4 });
const els = detectElements(r);
console.log(els.map((e) => `${e.label}(${e.kind}, ${e.pieces.length} piezas)`).join(' | '));
assert(els.some((e) => e.kind === 'icono'), 'icon found');
assert(els.some((e) => e.kind === 'texto'), 'text found');
assert(els.some((e) => e.kind === 'eslogan'), 'slogan found');
assert.strictEqual(els.find((e) => e.kind === 'icono').pieces.length, 2, 'icon keeps its inner colour');
assert.strictEqual(els.find((e) => e.kind === 'texto').pieces.length, 5, 'letters grouped');
assert.strictEqual(presetSelection(els, 'icon').length, 1);
assert(!presetSelection(els, 'noslogan').includes(els.find((e) => e.kind === 'eslogan').id));

// real logo should produce at least one element and cover all pieces exactly once
const png = PNG.sync.read(fs.readFileSync(new URL('./logo.png', import.meta.url)));
const rl = processImage({ data: new Uint8ClampedArray(png.data), width: png.width, height: png.height }, {});
const el2 = detectElements(rl);
const all = el2.flatMap((e) => e.pieces).sort((a, b) => a - b);
assert.deepStrictEqual(all, rl.pieces.map((p) => p.id), 'every piece in one element');
console.log('logo.png →', el2.map((e) => e.label).join(', '));

const q = qrMatrix('https://wa.me/573001234567');
assert(q.n >= 21 && q.isDark(0, 0), 'qr matrix');

assert.strictEqual(nearestBambu('#000000').name.includes('Black'), true);
assert(BAMBU_PLA.length > 10);
console.log('elements OK');

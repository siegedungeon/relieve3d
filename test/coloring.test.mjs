import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { createColoring, coloringOptions, applyColoringEdits, coloringShapes, coloringSVG, coloringPDF, coloringPngDPI } from '../src/core/coloring.js';
import { processImage } from '../src/core/processing.js';

const W = 128, H = 128;
const options = { pageWidth: 148, pageHeight: 148, margin: 10, lineWidth: 1, colors: 8, minDetail: 0, minArea: 0, contrast: 0, smooth: 0 };
function fixture() {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const rect = (x0, y0, x1, y1, rgb, alpha = 255) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([...rgb, alpha], (y * W + x) * 4);
  };
  return { data, width: W, height: H, rect };
}
const image = fixture();
image.rect(20, 20, 60, 100, [240, 90, 90]);
image.rect(60, 20, 104, 100, [80, 120, 230]);
const result = createColoring(image, options);
assert(result.mask.every(v => v === 0 || v === 1), 'conversion contains only binary ink');
assert.equal(result.mask[50 * W + 40], 0, 'red interior becomes white');
assert.equal(result.mask[50 * W + 80], 0, 'blue interior becomes white');
assert.equal(result.mask[0], 0, 'no artificial image frame');
assert.equal(result.mask.slice(50 * W + 55, 50 * W + 65).reduce((a, b) => a + b, 0), 1, 'shared colour boundary is a single solid line');
assert(createColoring(image, { ...options, lineWidth: 3 }).pixels > result.pixels * 2, 'line thickness is parameterized');

const black = fixture();
black.rect(20, 20, 100, 100, [0, 0, 0]);
const blackResult = createColoring(black, options);
assert.equal(blackResult.mask[60 * W + 60], 0, 'large dark regions are not solid black fills');
const outlined = fixture();
outlined.rect(20, 20, 100, 100, [25, 25, 25]);
outlined.rect(23, 23, 97, 97, [230, 90, 80]);
const outlinedResult = createColoring(outlined, options);
assert.equal(outlinedResult.mask.slice(60 * W + 17, 60 * W + 27).reduce((a, b) => a + b, 0), 1, 'pre-existing dark outlines are not doubled');
outlined.rect(20, 50, 31, 61, [25, 25, 25]);
const joinedInk = createColoring(outlined, options);
assert.equal(joinedInk.mask.slice(80 * W + 17, 80 * W + 27).reduce((a, b) => a + b, 0), 1, 'a locally thicker ink junction does not double the entire connected outline');
const checker = fixture();
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const v = ((x >> 2) + (y >> 2)) % 2 ? 221 : 255;
  checker.data.set([v, v, v, 255], (y * W + x) * 4);
}
checker.rect(25, 25, 100, 100, [240, 90, 90]);
assert.equal(createColoring(checker, options).mask[10 * W + 10], 0, 'baked-in light checkerboard backgrounds become white, not black noise');
assert(createColoring(checker, { ...options, cleanBackground: false }).pixels > createColoring(checker, options).pixels * 3, 'background cleanup can be disabled');

const details = fixture();
details.rect(20, 20, 110, 110, [240, 90, 90]);
details.rect(40, 35, 42, 85, [35, 35, 35]);
details.rect(74, 60, 77, 63, [70, 100, 240]);
const raw = createColoring(details, options);
const clean = createColoring(details, { ...options, minDetail: 4, minArea: 25 });
const countBox = (mask, x0, y0, x1, y1) => {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += mask[y * W + x];
  return n;
};
assert(countBox(raw.mask, 36, 33, 47, 88) > 20);
assert.equal(countBox(clean.mask, 36, 33, 47, 88), 0, 'thin details are removed at the requested threshold');
assert(countBox(raw.mask, 70, 55, 82, 69) > 0);
assert.equal(countBox(clean.mask, 70, 55, 82, 69), 0, 'small elements are removed by area');
const subtle = fixture();
subtle.rect(20, 20, 60, 100, [170, 70, 70]);
subtle.rect(60, 20, 104, 100, [220, 100, 100]);
assert(createColoring(subtle, { ...options, contrast: 90 }).pixels < createColoring(subtle, options).pixels, 'nearby colours can be merged');

const alpha = fixture();
alpha.rect(20, 20, 70, 80, [255, 0, 0], 0);
assert.throws(() => createColoring(alpha, options), /contornos/, 'hidden RGB is composited onto white');
assert.throws(() => createColoring(fixture(), options), /contornos/);
for (const patch of [{ lineWidth: 0 }, { colors: 1 }, { margin: 80 }, { dpi: 600 }, { smooth: 0.5 }, { minArea: NaN }]) {
  assert.throws(() => coloringOptions({ ...options, ...patch }));
}

const edits = [
  { kind: 'rect', points: [[0.12, 0.1], [0.36, 0.86]] },
  { kind: 'erase', width: 0.09, points: [[0.4, 0.16], [0.65, 0.16]] },
  { kind: 'draw', width: 0.025, points: [[0.15, 0.92], [0.85, 0.92]] },
];
const edited = applyColoringEdits(result, edits);
assert.equal(countBox(edited, 17, 18, 40, 100), 0, 'rectangular removal clears the selected element');
assert(edited[118 * W + 65], 'black pen adds a new line');
assert.deepEqual(applyColoringEdits(result, JSON.parse(JSON.stringify(edits))), edited, 'edits survive serialization exactly');
assert.deepEqual(applyColoringEdits(result, []), result.mask, 'source contours are never destructively edited');
assert.throws(() => applyColoringEdits(result, [{ kind: 'erase', width: 1, points: [[NaN, 0]] }]), /Coordenadas/);

const shapes = coloringShapes(edited, W, H), svg = coloringSVG(shapes, W, H, options);
assert(svg.includes('width="148mm"') && svg.includes('fill-rule="evenodd"'));
assert.deepEqual(new Set([...svg.matchAll(/fill="([^"]+)"/g)].map(m => m[1])), new Set(['#FFFFFF', '#000000']));
assert(!svg.includes('<image'), 'SVG is vector artwork, not an embedded bitmap');
assert.equal((svg.match(/<path /g) || []).length, 1, 'one compound path preserves nested white regions across disconnected outlines');
const pdf = coloringPDF(shapes, W, H, options), pdfText = new TextDecoder().decode(pdf);
assert(pdfText.startsWith('%PDF-1.4') && pdfText.includes('/Count 1'));
assert.equal((pdfText.match(/f\*/g) || []).length, 1, 'PDF fills nested contours together rather than painting over their holes');
const xref = Number(/startxref\n(\d+)/.exec(pdfText)[1]);
assert.equal(pdfText.slice(xref, xref + 4), 'xref');
for (const entry of [...pdfText.matchAll(/^(\d{10}) 00000 n /gm)]) assert(/^\d+ 0 obj/.test(pdfText.slice(Number(entry[1]))), 'PDF xref points at real objects');
const length = Number(/\/Length (\d+)/.exec(pdfText)[1]), stream = /stream\n([\s\S]*?)endstream/.exec(pdfText)[1];
assert.equal(length, new TextEncoder().encode(stream).length);

const png = new PNG({ width: 2, height: 2 }); png.data.fill(255);
const png300 = coloringPngDPI(PNG.sync.write(png), 300);
assert.deepEqual(PNG.sync.read(Buffer.from(png300)).data, png.data, 'PNG metadata rewrite keeps valid CRCs and pixel data');
const phys = bytes => {
  const found = [];
  for (let p = 8; p < bytes.length; p += Buffer.from(bytes).readUInt32BE(p) + 12) {
    if (Buffer.from(bytes).toString('ascii', p + 4, p + 8) === 'pHYs') found.push(Buffer.from(bytes).readUInt32BE(p + 8));
  }
  return found;
};
assert.deepEqual(phys(png300), [11811], 'PNG declares 300 pixels per inch');
assert.deepEqual(phys(coloringPngDPI(png300, 150)), [5906], 'replaces existing DPI rather than duplicating it');
assert.throws(() => coloringPngDPI(new Uint8Array(40), 300), /inválidos/);
const traced = processImage(image, { upscale: false, minWidth: -1, minArea: 1 });
const untraced = processImage(image, { upscale: false, minWidth: -1, minArea: 1, trace: false });
assert.deepEqual(untraced.comp, traced.comp);
assert.deepEqual(untraced.palette, traced.palette);
assert(traced.pieces.some(p => p.shapes.length) && untraced.pieces.every(p => !p.shapes.length), 'default vectorization stays unchanged');

const real = PNG.sync.read(fs.readFileSync(new URL('./logo.png', import.meta.url)));
const realResult = createColoring(real, { minDetail: 0.1, minArea: 0.2 });
assert(realResult.pixels > 0 && realResult.pixels < realResult.mask.length / 2, 'real logo becomes outline-only artwork');
fs.mkdirSync(new URL('./out/coloring/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./out/coloring/fixture.svg', import.meta.url), svg);
fs.writeFileSync(new URL('./out/coloring/fixture.pdf', import.meta.url), pdf);
console.log('coloring OK: single contours, dark-ink handling, cleanup thresholds, nondestructive edits, vector output and PNG DPI');

// Vectorization accuracy: synthetic anti-aliased images with analytic boundaries.
// Measures how far the traced contour vertices fall from the true edge (in source pixels).
import { processImage } from '../src/core/processing.js';

const SS = 8; // supersampling for the anti-aliased reference render
function render(W, H, shapes, bg = [255, 255, 255]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const acc = [0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
      let c = bg;
      for (const s of shapes) if (s.inside(px, py)) c = s.color;
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    }
    const i = (y * W + x) * 4;
    data[i] = acc[0] / SS / SS; data[i + 1] = acc[1] / SS / SS; data[i + 2] = acc[2] / SS / SS; data[i + 3] = 255;
  }
  return { data, width: W, height: H };
}

const rot = (a, cx, cy) => (x, y) => { const c = Math.cos(a), s = Math.sin(a); const dx = x - cx, dy = y - cy; return [c * dx + s * dy, -s * dx + c * dy]; };
const circle = (cx, cy, r, color) => ({ color, inside: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r, dist: (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) });
function rect(cx, cy, w, h, a, color) {
  const R = rot(a, cx, cy);
  const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([u, v]) => [cx + u * Math.cos(a) - v * Math.sin(a), cy + u * Math.sin(a) + v * Math.cos(a)]);
  return {
    color, corners,
    inside: (x, y) => { const [u, v] = R(x, y); return Math.abs(u) <= w / 2 && Math.abs(v) <= h / 2; },
    dist: (x, y) => { const [u, v] = R(x, y); const dx = Math.abs(u) - w / 2, dy = Math.abs(v) - h / 2; return dx > 0 || dy > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : -Math.max(dx, dy); },
  };
}

function measure(name, img, shape, opts = {}, check = {}) {
  const res = processImage(img, { colors: 1, maxRes: 1000, ...opts });
  const k = res.width / img.width;
  let sum = 0, n = 0, max = 0;
  for (const p of res.pieces) {
    if (res.palette[p.cluster].hex === '#ffffff') continue;
    for (const s of p.shapes) for (const loop of [s.outer, ...s.holes]) for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      for (const t of [0, 0.5]) {
        const d = shape.dist((a[0] + (b[0] - a[0]) * t) / k, (a[1] + (b[1] - a[1]) * t) / k); sum += d; n++; if (d > max) max = d;
      }
    }
  }
  let corner = 0;
  if (shape.corners) for (const [cx, cy] of shape.corners) {
    let best = Infinity;
    for (const p of res.pieces) for (const s of p.shapes) for (const [x, y] of s.outer) best = Math.min(best, Math.hypot(x / k - cx, y / k - cy));
    corner = Math.max(corner, best);
  }
  const mean = sum / Math.max(1, n);
  console.log(`${name.padEnd(22)} pieces=${String(res.pieces.length).padStart(2)} mean=${mean.toFixed(3)}px max=${max.toFixed(3)}px${shape.corners ? ` corner=${corner.toFixed(2)}px` : ''} verts=${n}`);
  return { mean, max, corner, res };
}

let fail = 0;
const expect = (ok, msg) => { if (!ok) { console.log('  FAIL', msg); fail++; } };

const red = [220, 30, 50], blue = [30, 60, 200];
{
  const c = circle(100, 100, 62, red);
  const m = measure('circle 200px', render(200, 200, [c]), c);
  expect(m.mean < 0.12 && m.max < 0.4, 'circle should be traced with sub-pixel accuracy');
}
{
  const r = rect(100, 100, 120, 70, 0.17, blue);
  const m = measure('rotated rect 200px', render(200, 200, [r]), r);
  expect(m.mean < 0.15 && m.max < 0.6, 'rotated rect edges should be straight');
  expect(m.corner < 1.2, 'rect corners should stay sharp');
}
{
  // thin bar (2.2 px) at a shallow angle — classic stair-step case and detail-loss case
  const r = rect(100, 60, 170, 2.2, 0.05, [20, 20, 20]);
  const m = measure('thin bar 2.2px', render(200, 120, [r]), r);
  expect(m.res.pieces.filter((p) => res0(m.res, p)).length === 1, 'thin bar must survive as a single piece');
  expect(m.mean < 0.25, 'thin bar edge should be accurate');
}
{
  // two adjacent colours: anti-aliased seam must not create a third "halo" colour
  const a = rect(70, 80, 100, 120, 0, [230, 40, 40]), b = circle(130, 80, 45, [250, 210, 30]);
  const img = render(200, 160, [a, b]);
  const res = processImage(img, { maxRes: 1000 });
  console.log(`${'red+yellow auto'.padEnd(22)} colors=${res.palette.length} (${res.palette.map((p) => p.hex).join(' ')}) pieces=${res.pieces.length}`);
  expect(res.palette.length === 2, 'red + yellow on removed background expected (no orange halo colour)');
}
{
  // large image (no upsampling): stair-steps of a shallow edge must be smoothed out
  const c = circle(500, 500, 430, red);
  const m = measure('circle 1000px', render(1000, 1000, [c]), c);
  expect(m.mean < 0.15 && m.max < 0.6, 'large circle should be smooth');
  const r = rect(500, 500, 800, 500, 0.03, blue);
  const q = measure('shallow rect 1000px', render(1000, 1000, [r]), r);
  expect(q.mean < 0.15 && q.max < 0.6 && q.corner < 1.5, 'shallow rect should be straight with sharp corners');
}
function res0(res, p) { return res.palette[p.cluster].hex !== '#ffffff'; }

// thin dark outline + hairline across a pink disc must not survive as loose slivers; a thick dark disc must
{
  const dark = [120, 40, 60], pink = [247, 188, 194];
  const img = render(520, 420, [circle(210, 210, 151.2, dark), circle(210, 210, 150, pink), rect(210, 230, 220, 1.2, 0.4, dark), circle(470, 60, 40, dark)]);
  const darkPieces = (res) => res.pieces.filter((p) => { const c = res.palette[p.cluster]; return c.r < 180 && c.g < 120; });
  const on = processImage(img, {}), off = processImage(img, { minWidth: -1 });
  console.log('thin outline: dark pieces auto', darkPieces(on).length, 'off', darkPieces(off).length);
  expect(darkPieces(off).length >= 2, 'without cleanup the outline/hairline are separate pieces');
  expect(darkPieces(on).length === 1, 'thin outline and hairline are removed, thick disc kept');
  const disc = darkPieces(on)[0];
  expect(disc && Math.abs(disc.area / (on.upscale ** 2) - Math.PI * 1600) < 0.05 * Math.PI * 1600, 'thick disc keeps its area');
}

// tiny counters (white hole inside a black letter on a white page) must survive the cleanups and can be widened
{
  const shapes = [];
  for (let k = 0; k < 6; k++) shapes.push(circle(80 + k * 160, 200, 40, [0, 0, 0]), circle(80 + k * 160, 200, 1.6, [255, 255, 255]));
  const img = render(1000, 400, shapes);
  const holesOf = (res) => res.pieces.reduce((a, p) => a + p.shapes.reduce((b, s) => b + s.holes.length, 0), 0);
  const holeArea = (res) => res.pieces.reduce((a, p) => a + p.shapes.reduce((b, s) => b + s.holes.reduce((c, h) => c + Math.abs(polyArea(h)), 0), 0), 0) / res.upscale ** 2;
  const plain = processImage(img, { minHoleMM: 0 });
  const wide = processImage(img, { minHoleMM: 1, widthMM: 100 });   // 880 px ↔ 100 mm: 1 mm ≈ 8.8 px
  console.log(`tiny counters: holes ${holesOf(plain)} (area ${holeArea(plain).toFixed(0)}) widened ${holesOf(wide)} (area ${holeArea(wide).toFixed(0)})`);
  expect(holesOf(plain) === 6, 'all 6 tiny counters kept');
  expect(holeArea(wide) > 4 * holeArea(plain), 'counters widened towards 1 mm');
  expect(holeArea(wide) / 6 < Math.PI * 6 * 6, 'widened counters stay small');
}
function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }

if (fail) { console.log(`accuracy: ${fail} check(s) failed`); process.exit(1); }
console.log('accuracy OK');

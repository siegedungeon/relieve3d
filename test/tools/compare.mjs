// Visual comparison of a colour split against the original multicolor model.
//   node test/tools/compare.mjs <model.3mf> [outDir] [--reuse] [--mm=0.1] [--views=front,back,...] [--mode=covers]
// Renders the original (painted triangles) and the reassembled parts from several views with the same camera,
// marks every pixel whose colour differs (ignoring a 2 px band along colour edges), groups the differences into
// clusters and writes: <view>.png (original | result | differences), crop_<view>_<n>.png zooms of the worst clusters,
// report.json (mismatch per view + cluster positions in model mm).
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import Module from 'manifold-3d';
import { read3MF } from '../../src/core/threemf_read.js';
import { splitColors } from '../../src/core/colorsplit.js';

const args = process.argv.slice(2), flag = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : d; };
const [file, outArg] = args.filter((a) => !a.startsWith('--'));
if (!file) { console.log('usage: node test/tools/compare.mjs model.3mf [outDir] [--reuse] [--mm=0.1] [--views=...]'); process.exit(2); }
const out = path.resolve(outArg || 'test/out/compare');
fs.mkdirSync(out, { recursive: true });
const MM = +flag('mm', 0.1), TOL = 2, MINPX = 6;
const VIEWS = {
  front: [0, 1, 0], back: [0, -1, 0], left: [1, 0, 0], right: [-1, 0, 0], top: [0, 0, -1], bottom: [0, 0, 1],
  front_l: [0.6, 0.6, -0.5], front_r: [-0.6, 0.6, -0.5], back_l: [0.6, -0.6, -0.5], back_r: [-0.6, -0.6, -0.5],
};
const views = String(flag('views', Object.keys(VIEWS).join(','))).split(',');

const model = read3MF(new Uint8Array(fs.readFileSync(file)));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const pal = model.palette.map(hex);

// ---- result parts (cached: the split takes a while on real models)
const cache = path.join(out, 'parts.json');
let parts;
if (flag('reuse') && fs.existsSync(cache)) parts = JSON.parse(fs.readFileSync(cache, 'utf8'));
else {
  const w = await Module(); w.setup();
  const t0 = Date.now();
  const opts = { ...(flag('mode') ? { mode: flag('mode') } : {}), ...(flag('opts') ? JSON.parse(flag('opts')) : {}) };
  const r = splitColors(w, model, opts, () => {});
  console.log(`split ${((Date.now() - t0) / 1000).toFixed(1)} s, ${r.parts.length} parts, warnings: ${r.warnings.join(' | ') || '-'}`);
  parts = r.parts.map((p) => ({ kind: p.kind, color: p.color, V: Array.from(p.mesh.V, (x) => Math.round(x * 1e4) / 1e4), T: Array.from(p.mesh.T) }));
  fs.writeFileSync(cache, JSON.stringify(parts));
}
const orig = model.parts.map((p) => ({ V: p.V, T: p.T, tc: p.tc }));
// colour parts win depth ties (a cover face lying on the base's surface is a cover showing there)
const res = parts.filter((p) => !flag('only') || p.kind === flag('only')).map((p) => ({ V: p.V, T: p.T, color: p.color, bias: p.kind === 'body' ? 0 : 0.03 }));

// ---- camera framing over the original's bounding box
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const p of orig) for (let i = 0; i < p.V.length; i++) { const k = i % 3; lo[k] = Math.min(lo[k], p.V[i]); hi[k] = Math.max(hi[k], p.V[i]); }
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function camera(dir) {
  const L = norm(dir), upW = Math.abs(L[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  const R = norm(cross(L, upW)), U = cross(R, L);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < 8; i++) { const p = [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]; const u = dot(p, R), v = dot(p, U); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const W = Math.ceil((u1 - u0) / MM) + 8, H = Math.ceil((v1 - v0) / MM) + 8;
  return { L, R, U, u0: u0 - 4 * MM, v1: v1 + 4 * MM, W, H };
}

// z-buffer rasterizer: per pixel the nearest surface's colour index, shade and depth
function render(cam, meshes, colorOf) {
  const { L, R, U, u0, v1, W, H } = cam, N = W * H;
  const depth = new Float32Array(N).fill(Infinity), col = new Int16Array(N).fill(-1), shade = new Float32Array(N);
  for (const m of meshes) {
    const V = m.V, T = m.T, nv = V.length / 3, P = new Float64Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      const x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2];
      P[i * 3] = (x * R[0] + y * R[1] + z * R[2] - u0) / MM; P[i * 3 + 1] = (v1 - (x * U[0] + y * U[1] + z * U[2])) / MM; P[i * 3 + 2] = x * L[0] + y * L[1] + z * L[2] - (m.bias || 0);
    }
    for (let t = 0; t < T.length / 3; t++) {
      const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2], cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-12) continue;
      const e1 = [V[b * 3] - V[a * 3], V[b * 3 + 1] - V[a * 3 + 1], V[b * 3 + 2] - V[a * 3 + 2]], e2 = [V[c * 3] - V[a * 3], V[c * 3 + 1] - V[a * 3 + 1], V[c * 3 + 2] - V[a * 3 + 2]];
      const n = norm(cross(e1, e2)), s = 0.35 + 0.65 * Math.abs(dot(n, L)), ci = colorOf(m, t);
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area, w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * az + w1 * bz + w2 * cz, i = y * W + x;
        if (z < depth[i]) { depth[i] = z; col[i] = ci; shade[i] = s; }
      }
    }
  }
  return { depth, col, shade, W, H };
}

function diff(o, r) {
  const { W, H } = o, N = W * H, bad = new Uint8Array(N);
  const near = (img, x, y, c) => { for (let dy = -TOL; dy <= TOL; dy++) for (let dx = -TOL; dx <= TOL; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && img.col[Y * W + X] === c) return true; } return false; };
  let cov = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, a = o.col[i], b = r.col[i];
    if (a >= 0) cov++;
    if (a !== b && !near(r, x, y, a) && !near(o, x, y, b)) bad[i] = 1;
  }
  // clusters (8-connected)
  const lab = new Int32Array(N).fill(-1), st = new Int32Array(N), cl = [];
  for (let s = 0; s < N; s++) {
    if (!bad[s] || lab[s] >= 0) continue;
    let sp = 0, n = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0; st[sp++] = s; lab[s] = cl.length;
    const kinds = {};
    while (sp) {
      const i = st[--sp], x = i % W, y = (i / W) | 0; n++; sx += x; sy += y;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      const k = `${o.col[i]}>${r.col[i]}`; kinds[k] = (kinds[k] || 0) + 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy, j = Y * W + X; if (X >= 0 && Y >= 0 && X < W && Y < H && bad[j] && lab[j] < 0) { lab[j] = cl.length; st[sp++] = j; } }
    }
    cl.push({ n, cx: sx / n, cy: sy / n, box: [x0, y0, x1, y1], kinds });
  }
  return { bad, cov, clusters: cl.filter((c) => c.n >= MINPX).sort((a, b) => b.n - a.n) };
}

function toRGB(img, i) {
  const c = img.col[i];
  if (c < 0) return [40, 40, 44];
  const p = pal[c] || [255, 0, 255], s = img.shade[i];
  return [p[0] * s, p[1] * s, p[2] * s];
}
function writeTriple(f, o, r, d, box, scale = 1) {
  const [x0, y0, x1, y1] = box, w = x1 - x0 + 1, h = y1 - y0 + 1, gap = 6;
  const png = new PNG({ width: (w * 3 + gap * 2) * scale, height: h * scale });
  png.data.fill(255);
  const put = (X, Y, rgb) => { for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) { const k = ((Y * scale + a) * png.width + X * scale + b) * 4; png.data[k] = rgb[0]; png.data[k + 1] = rgb[1]; png.data[k + 2] = rgb[2]; png.data[k + 3] = 255; } };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y + y0) * o.W + x + x0;
    put(x, y, toRGB(o, i)); put(x + w + gap, y, toRGB(r, i));
    put(x + 2 * (w + gap), y, d.bad[i] ? [255, 30, 30] : toRGB(r, i).map((v) => v * 0.45 + 60));
  }
  fs.writeFileSync(f, PNG.sync.write(png));
}

const report = { file: path.basename(file), mmPerPx: MM, views: {} };
let totalBad = 0, totalCov = 0;
for (const v of views) {
  const cam = camera(VIEWS[v]);
  const o = render(cam, orig, (m, t) => m.tc[t]), r = render(cam, res, (m) => m.color);
  const d = diff(o, r);
  const badPx = d.clusters.reduce((a, c) => a + c.n, 0);
  totalBad += badPx; totalCov += d.cov;
  const world = (c) => { const i = Math.round(c.cy) * cam.W + Math.round(c.cx); const z = Number.isFinite(o.depth[i]) ? o.depth[i] : r.depth[i]; const u = cam.u0 + (c.cx + 0.5) * MM, vv = cam.v1 - (c.cy + 0.5) * MM; return [0, 1, 2].map((k) => +(u * cam.R[k] + vv * cam.U[k] + z * cam.L[k]).toFixed(1)); };
  const nm = (k) => k.split('>').map((c) => (c === '-1' ? 'vacío' : model.names[c] || c)).join('→');
  report.views[v] = {
    mismatchPct: +((100 * badPx) / Math.max(1, d.cov)).toFixed(3), mismatchMM2: +(badPx * MM * MM).toFixed(1), clusters: d.clusters.length,
    worst: d.clusters.slice(0, 8).map((c) => ({ mm2: +(c.n * MM * MM).toFixed(2), at: world(c), sizeMM: [(c.box[2] - c.box[0] + 1) * MM, (c.box[3] - c.box[1] + 1) * MM].map((x) => +x.toFixed(1)), what: Object.entries(c.kinds).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => nm(k)).join(', ') })),
  };
  writeTriple(path.join(out, `${v}.png`), o, r, d, [0, 0, cam.W - 1, cam.H - 1], 1);
  d.clusters.slice(0, 6).forEach((c, k) => {
    const half = Math.max(60, Math.ceil(Math.max(c.box[2] - c.box[0], c.box[3] - c.box[1]) * 0.8));
    const bx = [Math.max(0, Math.round(c.cx) - half), Math.max(0, Math.round(c.cy) - half), Math.min(cam.W - 1, Math.round(c.cx) + half), Math.min(cam.H - 1, Math.round(c.cy) + half)];
    writeTriple(path.join(out, `crop_${v}_${k + 1}.png`), o, r, d, bx, Math.max(1, Math.floor(300 / (2 * half))));
  });
  console.log(`${v.padEnd(8)} ${report.views[v].mismatchPct}% (${report.views[v].mismatchMM2} mm², ${d.clusters.length} zonas)`);
}
report.mismatchPct = +((100 * totalBad) / Math.max(1, totalCov)).toFixed(3);
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
console.log(`TOTAL ${report.mismatchPct}% of the visible surface differs → ${out}`);

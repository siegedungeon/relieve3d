// Contact sheet of the split parts, each rendered alone (to inspect rims / sierras of single covers).
//   node test/tools/pieces.mjs <parts.json from compare.mjs> <out.png> [--kind=cover] [--px=0.06] [--views=front,back,top]
import fs from 'fs';
import { PNG } from 'pngjs';

const args = process.argv.slice(2), flag = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : d; };
const [src, dst] = args.filter((a) => !a.startsWith('--'));
const MM = +flag('px', 0.06), CELL = 520;
const DIRS = { front: [0, 1, 0], back: [0, -1, 0], top: [0, 0, -1], bottom: [0, 0, 1], left: [1, 0, 0], right: [-1, 0, 0] };
const views = String(flag('views', 'front,back,top')).split(',');
const only = flag('only') ? String(flag('only')).split(',').map(Number) : null;
const parts = JSON.parse(fs.readFileSync(src, 'utf8')).map((p, i) => ({ ...p, i })).filter((p) => (!flag('kind') || p.kind === flag('kind')) && (!only || only.includes(p.i)));
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const png = new PNG({ width: CELL * views.length, height: CELL * parts.length });
png.data.fill(40);
for (let k = 3; k < png.data.length; k += 4) png.data[k] = 255;
parts.forEach((p, row) => {
  const V = p.V, T = p.T, nv = V.length / 3;
  const c = [0, 1, 2].map((k) => { let a = Infinity, b = -Infinity; for (let i = k; i < V.length; i += 3) { a = Math.min(a, V[i]); b = Math.max(b, V[i]); } return (a + b) / 2; });
  views.forEach((vn, col) => {
    const L = norm(DIRS[vn]), up = Math.abs(L[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1], R = norm(cross(L, up)), U = cross(R, L);
    let ext = 0;
    for (let i = 0; i < nv; i++) { const q = [V[i * 3] - c[0], V[i * 3 + 1] - c[1], V[i * 3 + 2] - c[2]]; ext = Math.max(ext, Math.abs(dot(q, R)), Math.abs(dot(q, U))); }
    const s = Math.min(1 / MM, (CELL / 2 - 10) / ext);
    const P = new Float64Array(nv * 3);
    for (let i = 0; i < nv; i++) { const q = [V[i * 3] - c[0], V[i * 3 + 1] - c[1], V[i * 3 + 2] - c[2]]; P[i * 3] = CELL / 2 + dot(q, R) * s; P[i * 3 + 1] = CELL / 2 - dot(q, U) * s; P[i * 3 + 2] = dot(q, L); }
    const depth = new Float32Array(CELL * CELL).fill(Infinity), sh = new Float32Array(CELL * CELL);
    for (let t = 0; t < T.length / 3; t++) {
      const a = T[t * 3], b = T[t * 3 + 1], d = T[t * 3 + 2];
      const ax = P[a * 3], ay = P[a * 3 + 1], bx = P[b * 3], by = P[b * 3 + 1], cx = P[d * 3], cy = P[d * 3 + 1];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-12) continue;
      const e1 = [0, 1, 2].map((k) => V[b * 3 + k] - V[a * 3 + k]), e2 = [0, 1, 2].map((k) => V[d * 3 + k] - V[a * 3 + k]);
      const n = norm(cross(e1, e2)), lit = 0.25 + 0.75 * Math.max(0, -dot(n, norm([L[0] - 0.3 * R[0] + 0.4 * U[0], L[1] - 0.3 * R[1] + 0.4 * U[1], L[2] - 0.3 * R[2] + 0.4 * U[2]])));
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(CELL - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(CELL - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area, w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * P[a * 3 + 2] + w1 * P[b * 3 + 2] + w2 * P[d * 3 + 2], i = y * CELL + x;
        if (z < depth[i]) { depth[i] = z; sh[i] = lit; }
      }
    }
    const base = p.kind === 'body' ? [235, 235, 235] : [110, 210, 170];
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const i = y * CELL + x;
      if (depth[i] === Infinity) continue;
      const k = ((row * CELL + y) * png.width + col * CELL + x) * 4;
      for (let j = 0; j < 3; j++) png.data[k + j] = base[j] * sh[i];
    }
    // label: part index as small bars (top-left)
    for (let b = 0; b <= p.i; b++) for (let y = 4; y < 14; y++) { const k = ((row * CELL + y) * png.width + col * CELL + 4 + b * 4) * 4; png.data[k] = 255; png.data[k + 1] = 200; png.data[k + 2] = 0; }
  });
});
fs.writeFileSync(dst, PNG.sync.write(png));
console.log(`${parts.length} parts → ${dst}`);

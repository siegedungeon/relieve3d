// Image → color regions → pieces → vector loops (pure JS, no DOM).
import { edt, widenHoles } from './raster.js';

export const DEFAULT_PROC = {
  colors: 0,          // 0 = auto
  removeBg: 'auto',   // 'auto' | 'yes' | 'no'
  tolerance: 40,      // background color tolerance (RGB distance)
  minArea: 0,         // 0 = auto (px)
  minWidth: 0,        // thinnest kept line (source px): 0 = auto, -1 = keep everything
  minHoleMM: 0.8,     // holes (counters) narrower than this are widened; 0 = off (needs widthMM)
  detail: 0.8,        // simplification epsilon (px)
  smooth: 1,          // chaikin iterations
  maxRes: 1000,       // max processing resolution (px)
};

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- foreground / background ----------
export function computeForeground(img, o) {
  const { data, width: W, height: H } = img;
  const N = W * H;
  const fg = new Uint8Array(N);
  let hasAlpha = false;
  for (let i = 0; i < N; i++) {
    const a = data[i * 4 + 3];
    if (a >= 128) fg[i] = 1;
    if (a < 250) hasAlpha = true;
  }
  const doBg = o.removeBg === 'yes' || o.removeBg === true || (o.removeBg === 'auto' && !hasAlpha);
  if (!doBg) return fg;

  const corners = [0, W - 1, (H - 1) * W, N - 1].filter((i) => fg[i]);
  if (!corners.length) return fg;
  let rr = 0, gg = 0, bb = 0;
  for (const i of corners) { rr += data[i * 4]; gg += data[i * 4 + 1]; bb += data[i * 4 + 2]; }
  rr /= corners.length; gg /= corners.length; bb /= corners.length;
  fg.bg = [rr, gg, bb];
  const tol2 = o.tolerance * o.tolerance;
  const near = (i) => {
    const dr = data[i * 4] - rr, dg = data[i * 4 + 1] - gg, db = data[i * 4 + 2] - bb;
    return dr * dr + dg * dg + db * db <= tol2;
  };
  const stack = new Int32Array(N);
  let sp = 0;
  const push = (i) => { if (fg[i] && near(i)) { fg[i] = 0; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp) {
    const i = stack[--sp];
    const x = i % W, y = (i / W) | 0;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W);
    if (y < H - 1) push(i + W);
  }
  return fg;
}

// ---------- resampling ----------
// Bicubic (Catmull-Rom) resize on premultiplied RGBA. Upscaling small logos before segmentation puts the
// colour boundaries at sub-pixel positions, which removes the stair-steps of low-resolution images.
export function resizeBicubic(img, W2, H2) {
  const { data: s, width: W, height: H } = img;
  const pm = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const a = s[i * 4 + 3] / 255;
    pm[i * 4] = s[i * 4] * a; pm[i * 4 + 1] = s[i * 4 + 1] * a; pm[i * 4 + 2] = s[i * 4 + 2] * a; pm[i * 4 + 3] = s[i * 4 + 3];
  }
  const cub = (t) => { t = Math.abs(t); return t < 1 ? 1.5 * t * t * t - 2.5 * t * t + 1 : t < 2 ? -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2 : 0; };
  const taps = (n, n2) => {
    const sc = n / n2, idx = new Int32Array(n2 * 4), w = new Float32Array(n2 * 4);
    for (let o = 0; o < n2; o++) {
      const c = (o + 0.5) * sc - 0.5, f = Math.floor(c);
      let sum = 0;
      for (let k = 0; k < 4; k++) { const q = f - 1 + k; idx[o * 4 + k] = Math.min(n - 1, Math.max(0, q)); sum += (w[o * 4 + k] = cub(c - q)); }
      for (let k = 0; k < 4; k++) w[o * 4 + k] /= sum;
    }
    return { idx, w };
  };
  const tx = taps(W, W2), ty = taps(H, H2);
  const tmp = new Float32Array(W2 * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W2; x++) {
    const o = (y * W2 + x) * 4;
    for (let k = 0; k < 4; k++) {
      const j = (y * W + tx.idx[x * 4 + k]) * 4, wk = tx.w[x * 4 + k];
      tmp[o] += pm[j] * wk; tmp[o + 1] += pm[j + 1] * wk; tmp[o + 2] += pm[j + 2] * wk; tmp[o + 3] += pm[j + 3] * wk;
    }
  }
  const out = new Uint8ClampedArray(W2 * H2 * 4);
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = 0; k < 4; k++) {
      const j = (ty.idx[y * 4 + k] * W2 + x) * 4, wk = ty.w[y * 4 + k];
      r += tmp[j] * wk; g += tmp[j + 1] * wk; b += tmp[j + 2] * wk; a += tmp[j + 3] * wk;
    }
    const o = (y * W2 + x) * 4;
    a = Math.min(255, Math.max(0, a));
    const ia = a > 0.5 ? 255 / a : 0;
    out[o] = r * ia; out[o + 1] = g * ia; out[o + 2] = b * ia; out[o + 3] = a;
  }
  return { data: out, width: W2, height: H2 };
}

// ---------- colour space ----------
const SRGB = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; SRGB[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const labF = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
function toLab(r, g, b, out, o) {
  const R = SRGB[r], G = SRGB[g], B = SRGB[b];
  const x = labF((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = labF(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = labF((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  out[o] = 116 * y - 16; out[o + 1] = 500 * (x - y); out[o + 2] = 200 * (y - z);
}

// Pixels inside flat colour areas (not on an anti-aliased edge). Used to pick clean palette colours.
function flatMask(img, fg) {
  const { data, width: W, height: H } = img;
  const flat = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!fg[i]) continue;
    let ok = 1;
    for (const j of [i - 1, i + 1, i - W, i + W]) {
      if (!fg[j] || Math.abs(data[i * 4] - data[j * 4]) + Math.abs(data[i * 4 + 1] - data[j * 4 + 1]) + Math.abs(data[i * 4 + 2] - data[j * 4 + 2]) > 30) { ok = 0; break; }
    }
    flat[i] = ok;
  }
  return flat;
}

// ---------- color estimation & k-means ----------
export function estimateColorCount(img, fg) {
  const { data } = img;
  const cnt = new Float64Array(4096), sr = new Float64Array(4096), sg = new Float64Array(4096), sb = new Float64Array(4096);
  let total = 0;
  for (let i = 0; i < fg.length; i++) {
    if (!fg[i]) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    cnt[k]++; sr[k] += r; sg[k] += g; sb[k] += b; total++;
  }
  if (!total) return 2;
  const bins = [];
  for (let k = 0; k < 4096; k++) if (cnt[k]) bins.push(k);
  bins.sort((a, b) => cnt[b] - cnt[a]);
  const picked = [];
  for (const k of bins) {
    if (cnt[k] < total * 0.004) break;
    const c = [sr[k] / cnt[k], sg[k] / cnt[k], sb[k] / cnt[k]];
    let ok = true;
    for (const p of picked) {
      const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
      if (d < 70) { ok = false; break; }
    }
    if (ok) picked.push(c);
  }
  return Math.max(2, Math.min(12, picked.length));
}

// k-means++ on a packed 3-channel buffer (RGB or Lab), sampling pixels where mask != 0.
function kmeansVec(v, mask, k, seed = 12345) {
  const rnd = mulberry32(seed);
  let count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) count++;
  const step = Math.max(1, Math.floor(count / 60000));
  const s = [];
  let c = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    if (c++ % step === 0) s.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
  }
  const m = s.length / 3;
  if (m === 0) return [];
  k = Math.min(k, m);
  const centers = [];
  const pick = Math.floor(rnd() * m);
  centers.push([s[pick * 3], s[pick * 3 + 1], s[pick * 3 + 2]]);
  const D = new Float64Array(m).fill(Infinity);
  while (centers.length < k) {
    const last = centers[centers.length - 1];
    let sum = 0;
    for (let i = 0; i < m; i++) {
      const dr = s[i * 3] - last[0], dg = s[i * 3 + 1] - last[1], db = s[i * 3 + 2] - last[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < D[i]) D[i] = d;
      sum += D[i];
    }
    let r = rnd() * sum, idx = 0;
    for (; idx < m - 1; idx++) { r -= D[idx]; if (r <= 0) break; }
    centers.push([s[idx * 3], s[idx * 3 + 1], s[idx * 3 + 2]]);
  }
  const assign = new Int32Array(m);
  for (let it = 0; it < 30; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    let moved = 0;
    for (let i = 0; i < m; i++) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < centers.length; j++) {
        const cc = centers[j];
        const dr = s[i * 3] - cc[0], dg = s[i * 3 + 1] - cc[1], db = s[i * 3 + 2] - cc[2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = j; }
      }
      if (assign[i] !== best) moved++;
      assign[i] = best;
      const a = acc[best];
      a[0] += s[i * 3]; a[1] += s[i * 3 + 1]; a[2] += s[i * 3 + 2]; a[3]++;
    }
    for (let j = 0; j < centers.length; j++) {
      const a = acc[j];
      if (a[3]) centers[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
      else centers[j] = [s[(j * 7919 % m) * 3], s[(j * 7919 % m) * 3 + 1], s[(j * 7919 % m) * 3 + 2]];
    }
    if (it > 2 && moved < m * 0.001) break;
  }
  return centers;
}

export function kmeans(img, fg, k, seed = 12345) {
  const { data } = img, v = new Float32Array(fg.length * 3);
  for (let i = 0; i < fg.length; i++) { v[i * 3] = data[i * 4]; v[i * 3 + 1] = data[i * 4 + 1]; v[i * 3 + 2] = data[i * 4 + 2]; }
  return kmeansVec(v, fg, k, seed);
}

// Nearest-centre labelling in Lab. Anti-aliased edge pixels that are a blend of two palette colours are given to the
// nearer of those two instead of a third colour that merely sits "between" them (removes orange halos between red
// and yellow, grey fringes around black text, …).
function assignLabels(lab, fg, flat, centers, haloMin = 36, only = null) {
  const n = centers.length, labels = only ? only.labels : new Int32Array(fg.length).fill(-1);
  const pairs = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const ca = centers[a], cb = centers[b], d = [cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]];
    const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    if (L2 > 1e-6) pairs.push({ a, b, ca, d, L2 });
  }
  for (let i = 0; i < fg.length; i++) {
    if (!fg[i] || (only && (flat[i] || labels[i] < 0))) continue;
    const L = lab[i * 3], A = lab[i * 3 + 1], B = lab[i * 3 + 2];
    let best = 0, bd = Infinity;
    for (let j = 0; j < n; j++) {
      const c = centers[j];
      const d = (L - c[0]) ** 2 + (A - c[1]) ** 2 + (B - c[2]) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    if (!flat[i] && n > 2 && bd > haloMin) {
      let pb = null, pd = bd * 0.2, pt = 0;
      for (const p of pairs) {
        if (p.a === best || p.b === best) continue;
        const ux = L - p.ca[0], uy = A - p.ca[1], uz = B - p.ca[2];
        const t = (ux * p.d[0] + uy * p.d[1] + uz * p.d[2]) / p.L2;
        if (t <= 0.1 || t >= 0.9) continue;
        const ex = ux - t * p.d[0], ey = uy - t * p.d[1], ez = uz - t * p.d[2];
        const d = ex * ex + ey * ey + ez * ez;
        if (d < pd) { pd = d; pb = p; pt = t; }
      }
      if (pb) best = pt < 0.5 ? pb.a : pb.b;
    }
    labels[i] = best;
  }
  return labels;
}

// The background flood fill keeps every anti-aliased edge pixel, which fattens the design by ~half a pixel.
// Edge pixels that are closer to the background colour than to their own palette colour go back to the background.
function clusterMeans(v, labels, flat, n) {
  const f = Array.from({ length: n }, () => [0, 0, 0, 0]), a = Array.from({ length: n }, () => [0, 0, 0, 0]);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l < 0) continue;
    const t = flat[i] ? f[l] : a[l];
    t[0] += v[i * 3]; t[1] += v[i * 3 + 1]; t[2] += v[i * 3 + 2]; t[3]++;
  }
  return f.map((q, l) => { const s = q[3] >= 4 ? q : a[l]; return [s[0] / Math.max(1, s[3]), s[1] / Math.max(1, s[3]), s[2] / Math.max(1, s[3])]; });
}

function peelBackground(labels, lab, centers, bg, W, H) {
  const bl = bg;
  const N = W * H, stack = new Int32Array(N), queued = new Uint8Array(N);
  let sp = 0;
  const isBg = (j) => labels[j] < 0;
  const consider = (i) => { if (labels[i] >= 0 && !queued[i]) { queued[i] = 1; stack[sp++] = i; } };
  for (let i = 0; i < N; i++) {
    if (labels[i] < 0) continue;
    const x = i % W, y = (i / W) | 0;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || isBg(i - 1) || isBg(i + 1) || isBg(i - W) || isBg(i + W)) consider(i);
  }
  while (sp) {
    const i = stack[--sp], c = centers[labels[i]];
    const L = lab[i * 3], A = lab[i * 3 + 1], B = lab[i * 3 + 2];
    const db = (L - bl[0]) ** 2 + (A - bl[1]) ** 2 + (B - bl[2]) ** 2;
    const dc = (L - c[0]) ** 2 + (A - c[1]) ** 2 + (B - c[2]) ** 2;
    if (db >= dc) continue;
    labels[i] = -1;
    const x = i % W, y = (i / W) | 0;
    if (x > 0) consider(i - 1); if (x < W - 1) consider(i + 1);
    if (y > 0) consider(i - W); if (y < H - 1) consider(i + W);
  }
}

function modeFilter(labels, W, H, k) {
  const out = labels.slice();
  const counts = new Int32Array(k);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (labels[i] < 0) continue;
      counts.fill(0);
      let bestL = labels[i], bestC = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const l = labels[i + dy * W + dx];
        if (l >= 0) { const c = ++counts[l]; if (c > bestC) { bestC = c; bestL = l; } }
      }
      if (bestC >= 5 && counts[labels[i]] <= 2) out[i] = bestL;
    }
  }
  return out;
}

// Enclosed regions with (about) the background colour whose surrounding parts all sit on the background are
// counters of letters/shapes: they become background. Large enclosed areas (a white badge face inside a ring)
// stay pieces. Pixels are judged by their own colour too: a few tiny counters don't get a palette colour of their
// own and end up in the letter's cluster. Returns true when something changed.
function openCounters(labels, rgb, centers, bg, tol, W, H) {
  const t2 = tol * tol, K = centers.length, d2 = (a, o, b) => (a[o] - b[0]) ** 2 + (a[o + 1] - b[1]) ** 2 + (a[o + 2] - b[2]) ** 2;
  const paperC = centers.map((q) => d2(q, 0, bg) <= t2);
  const tmp = labels.slice();
  for (let i = 0; i < tmp.length; i++) {
    const l = tmp[i];
    if (l < 0) continue;
    const db = d2(rgb, i * 3, bg);
    if (paperC[l] || (db <= t2 && db < d2(rgb, i * 3, centers[l]))) tmp[i] = K;
  }
  const { comp, comps } = labelComponents(tmp, W, H);
  const n = comps.length, touch = new Uint8Array(n);
  const nb = Array.from({ length: n }, () => new Set());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, c = comp[i];
    if (c < 0) continue;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touch[c] = 1;
    const ns = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
    for (const j of ns) { if (j < 0) continue; const d = comp[j]; if (d < 0) touch[c] = 1; else if (d !== c) nb[c].add(d); }
  }
  const open = new Uint8Array(n);
  const paper = comps.map((c) => c.label === K);
  // parts lying on the real background: reachable from it through coloured (non-paper) parts only
  const onBg = new Uint8Array(n);
  let queue = [];
  for (let c = 0; c < n; c++) if (touch[c] && !paper[c]) { onBg[c] = 1; queue.push(c); }
  while (queue.length) {
    const next = [];
    for (const c of queue) for (const d of nb[c]) if (!onBg[d] && !paper[d]) { onBg[d] = 1; next.push(d); }
    queue = next;
  }
  let any = false;
  for (let c = 0; c < n; c++) {
    if (touch[c] || !paper[c] || !nb[c].size) continue;
    let around = 0, ok = true;
    for (const d of nb[c]) {
      // the letter must not sit on a paper-coloured area of the design itself (e.g. a white sticker face)
      if (!onBg[d] || [...nb[d]].some((e) => paper[e] && comps[e].area > comps[d].area)) { ok = false; break; }
      around += comps[d].area;
    }
    if (ok && comps[c].area <= 0.5 * around) { open[c] = 1; any = true; }
  }
  if (any) for (let i = 0; i < labels.length; i++) if (comp[i] >= 0 && open[comp[i]]) labels[i] = -1;
  return any;
}

// Morphological opening per colour: pixels of a colour that sit in a part narrower than ~2r (thin outlines, fringes,
// slivers along holes) are handed to the nearest colour (or background) that survives the opening.
function removeThin(labels, W, H, k, rw) {
  const r = rw + 0.5, N = W * H, m = new Uint8Array(N);
  // pixels on either side of a colour change; distance to another colour ≈ distance to this set + 1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, l = labels[i];
    m[i] = (x > 0 && labels[i - 1] !== l) || (x < W - 1 && labels[i + 1] !== l) || (y > 0 && labels[i - W] !== l) || (y < H - 1 && labels[i + W] !== l) ? 1 : 0;
  }
  const din = edt(m, W, H);
  for (let i = 0; i < N; i++) m[i] = labels[i] >= 0 && din[i] + 1 > r ? 1 : 0;      // eroded cores of every colour
  // an eroded core of another colour is always farther than r, so the nearest core within r is our own colour
  const dout = edt(m, W, H);
  let any = false;
  for (let i = 0; i < N; i++) { const t = labels[i] >= 0 && !(dout[i] <= r); m[i] = t ? 0 : 1; any = any || t; }
  if (!any) return;
  const { index: I } = edt(m, W, H, true);
  const out = labels.slice();
  for (let i = 0; i < N; i++) if (!m[i] && I[i] >= 0) out[i] = labels[I[i]];
  labels.set(out);
}

// ---------- connected components (4-connectivity) ----------
export function labelComponents(labels, W, H) {
  const N = W * H;
  const comp = new Int32Array(N).fill(-1);
  const comps = [];
  const stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (labels[s] < 0 || comp[s] >= 0) continue;
    const id = comps.length, L = labels[s];
    const info = { label: L, area: 0, minX: W, minY: H, maxX: -1, maxY: -1 };
    let sp = 0;
    stack[sp++] = s; comp[s] = id;
    while (sp) {
      const i = stack[--sp];
      const x = i % W, y = (i / W) | 0;
      info.area++;
      if (x < info.minX) info.minX = x; if (x > info.maxX) info.maxX = x;
      if (y < info.minY) info.minY = y; if (y > info.maxY) info.maxY = y;
      if (x > 0 && comp[i - 1] < 0 && labels[i - 1] === L) { comp[i - 1] = id; stack[sp++] = i - 1; }
      if (x < W - 1 && comp[i + 1] < 0 && labels[i + 1] === L) { comp[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && comp[i - W] < 0 && labels[i - W] === L) { comp[i - W] = id; stack[sp++] = i - W; }
      if (y < H - 1 && comp[i + W] < 0 && labels[i + W] === L) { comp[i + W] = id; stack[sp++] = i + W; }
    }
    comps.push(info);
  }
  return { comp, comps };
}

function mergeSmall(labels, comp, comps, W, H, minArea) {
  const small = comps.map((c) => c.area < minArea);
  if (!small.some(Boolean)) return false;
  const votes = new Map();
  const vote = (c, l) => {
    let m = votes.get(c);
    if (!m) { m = new Map(); votes.set(c, m); }
    m.set(l, (m.get(l) || 0) + 1);
  };
  const N = W * H;
  for (let i = 0; i < N; i++) {
    const c = comp[i];
    if (c < 0 || !small[c]) continue;
    const x = i % W, y = (i / W) | 0;
    if (x > 0 && comp[i - 1] >= 0 && comp[i - 1] !== c) vote(c, labels[i - 1]);
    if (x < W - 1 && comp[i + 1] >= 0 && comp[i + 1] !== c) vote(c, labels[i + 1]);
    if (y > 0 && comp[i - W] >= 0 && comp[i - W] !== c) vote(c, labels[i - W]);
    if (y < H - 1 && comp[i + W] >= 0 && comp[i + W] !== c) vote(c, labels[i + W]);
  }
  const newLabel = new Map();
  for (let c = 0; c < comps.length; c++) {
    if (!small[c]) continue;
    const m = votes.get(c);
    let best = -1, bc = -1;
    if (m) for (const [l, n] of m) if (n > bc) { bc = n; best = l; }
    newLabel.set(c, best);
  }
  for (let i = 0; i < N; i++) {
    const c = comp[i];
    if (c >= 0 && small[c]) labels[i] = newLabel.get(c);
  }
  return true;
}

// ---------- contour tracing (pixel-crack boundaries) ----------
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

// Traces all boundary loops of pixels where arr[i] === id inside bbox.
// Returns loops (arrays of [x,y] in pixel-corner coordinates). Outer loops have positive area.
export function traceRegion(arr, W, H, id, minX, minY, maxX, maxY) {
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const VW = w + 1;
  const bits = new Uint8Array(VW * (h + 1));
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && arr[y * W + x] === id;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (arr[y * W + x] !== id) continue;
      const lx = x - minX, ly = y - minY;
      if (!inside(x, y - 1)) bits[ly * VW + lx] |= 1;
      if (!inside(x + 1, y)) bits[ly * VW + lx + 1] |= 2;
      if (!inside(x, y + 1)) bits[(ly + 1) * VW + lx + 1] |= 4;
      if (!inside(x - 1, y)) bits[(ly + 1) * VW + lx] |= 8;
    }
  }
  const loops = [];
  for (let v = 0; v < bits.length; v++) {
    while (bits[v]) {
      let startDir = 0;
      while (!(bits[v] & (1 << startDir))) startDir++;
      bits[v] &= ~(1 << startDir);
      let cx = v % VW, cy = (v / VW) | 0, d = startDir;
      const pts = [[cx + minX, cy + minY]];
      for (let guard = 0; guard < 1e8; guard++) {
        cx += DX[d]; cy += DY[d];
        const cv = cy * VW + cx;
        let nd = -1;
        for (const cand of [(d + 1) & 3, d, (d + 3) & 3]) {
          if (cv === v && cand === startDir) { nd = -2; break; }
          if (bits[cv] & (1 << cand)) { nd = cand; break; }
        }
        if (nd < 0) break;
        bits[cv] &= ~(1 << nd);
        pts.push([cx + minX, cy + minY]);
        d = nd;
      }
      loops.push(pts);
    }
  }
  return loops;
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function rdp(pts, eps) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][0], ay = pts[a][1], dx = pts[b][0] - ax, dy = pts[b][1] - ay;
    const len = Math.hypot(dx, dy);
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = len > 1e-9
        ? Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / len
        : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function rdpClosed(pts, eps) {
  if (pts.length < 4) return pts.slice();
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp(pts.slice(far).concat([pts[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function rdpClosedIdx(pts, eps) {
  const n = pts.length;
  if (n < 4) return pts.map((_, i) => i);
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const keep = new Uint8Array(n + 1);
  keep[0] = keep[far] = keep[n] = 1;
  const P = (i) => pts[i % n];
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = P(a), dx = P(b)[0] - A[0], dy = P(b)[1] - A[1], len = Math.hypot(dx, dy);
    let maxD = -1, id = -1;
    for (let i = a + 1; i < b; i++) {
      const q = P(i);
      const d = len > 1e-9 ? Math.abs(dy * (q[0] - A[0]) - dx * (q[1] - A[1])) / len : Math.hypot(q[0] - A[0], q[1] - A[1]);
      if (d > maxD) { maxD = d; id = i; }
    }
    if (maxD > eps) { keep[id] = 1; stack.push([a, id], [id, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

// Total-least-squares line through pts[a..b] (closed indexing): { cx, cy, dx, dy } or null.
function fitLine(pts, a, b) {
  const n = pts.length;
  let m = 0, sx = 0, sy = 0;
  for (let i = a; i <= b; i++) { const q = pts[i % n]; sx += q[0]; sy += q[1]; m++; }
  if (m < 3) return null;
  const cx = sx / m, cy = sy / m;
  let xx = 0, xy = 0, yy = 0;
  for (let i = a; i <= b; i++) { const q = pts[i % n], u = q[0] - cx, v = q[1] - cy; xx += u * u; xy += u * v; yy += v * v; }
  const th = 0.5 * Math.atan2(2 * xy, xx - yy);
  return { cx, cy, dx: Math.cos(th), dy: Math.sin(th) };
}
const projOn = (L, p) => { const t = (p[0] - L.cx) * L.dx + (p[1] - L.cy) * L.dy; return [L.cx + t * L.dx, L.cy + t * L.dy]; };

// Moves each simplified vertex onto the least-squares lines of its two neighbouring spans, so long straight edges
// follow the average of the (stair-stepped) pixel boundary instead of its extreme points.
function fitVertices(dense, idx) {
  const n = dense.length, m = idx.length;
  const lines = idx.map((a, j) => { let b = idx[(j + 1) % m]; if (b <= a) b += n; return b - a >= 4 ? fitLine(dense, a, b) : null; });
  return idx.map((i, j) => {
    const p = dense[i], L1 = lines[(j - 1 + m) % m], L2 = lines[j];
    if (!L1 && !L2) return p;
    if (!L1 || !L2) return projOn(L1 || L2, p);
    const cr = L1.dx * L2.dy - L1.dy * L2.dx;
    if (Math.abs(cr) > 0.17) {
      const t = ((L2.cx - L1.cx) * L2.dy - (L2.cy - L1.cy) * L2.dx) / cr;
      const q = [L1.cx + t * L1.dx, L1.cy + t * L1.dy];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1.5) return q;
    }
    const a = projOn(L1, p), b = projOn(L2, p);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  });
}

function chaikin(pts, iterations) {
  let p = pts;
  for (let it = 0; it < iterations; it++) {
    const out = [];
    for (let i = 0, n = p.length; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = out;
  }
  return p;
}

// Finds sharp corners on a closed polyline (indices). A real corner turns by the same angle whether measured with
// chords of k or 2k steps; a tight curve (round letter ends) turns about twice as much at 2k, so it is not a corner.
function findCorners(p, k, maxAngleDeg = 128) {
  const n = p.length, minTurn = Math.PI - (maxAngleDeg * Math.PI) / 180;
  if (n < 4 * k + 3) return [];
  const turnAt = (i, kk) => {
    const a = p[(i - kk + n) % n], b = p[i], c = p[(i + kk) % n];
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
  };
  const sharp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t1 = turnAt(i, k);
    sharp[i] = t1 > minTurn && turnAt(i, 2 * k) < t1 * 1.45 ? t1 : -2;
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    if (sharp[i] <= -2) continue;
    let isMax = true;
    for (let j = 1; j <= k && isMax; j++) {
      if (sharp[(i - j + n) % n] > sharp[i] || sharp[(i + j) % n] >= sharp[i]) isMax = false;
    }
    if (isMax) out.push(i);
  }
  return out;
}

function gaussKernel(sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3)), w = [];
  let s = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); w.push(v); s += v; }
  return { r, w: w.map((v) => v / s) };
}

// Gaussian smoothing of a closed polyline that keeps the detected corners fixed (sharp letter corners stay sharp,
// curves and stair-stepped diagonals become clean).
export function smoothLoop(p, sigma) {
  const n = p.length;
  if (n < 5 || !(sigma > 0)) return p;
  const { r, w } = gaussKernel(sigma);
  const corners = findCorners(p, Math.max(3, Math.round(sigma * 2.2)));
  if (!corners.length) {
    return p.map((_, i) => {
      let x = 0, y = 0;
      for (let j = -r; j <= r; j++) { const q = p[((i + j) % n + n) % n]; x += q[0] * w[j + r]; y += q[1] * w[j + r]; }
      return [x, y];
    });
  }
  const out = p.map((q) => q.slice());
  for (let c = 0; c < corners.length; c++) {
    const s = corners[c], e = corners[(c + 1) % corners.length];
    const len = ((e - s + n) % n) || n;
    if (len < 3) continue;
    const seg = [];
    for (let j = 0; j <= len; j++) seg.push(p[(s + j) % n]);
    const m = seg.length - 1, A = seg[0], B = seg[m];
    // odd reflection about the fixed end points keeps straight edges straight right up to the corner
    const at = (j) => {
      if (j < 0) { const q = seg[Math.min(m, -j)]; return [2 * A[0] - q[0], 2 * A[1] - q[1]]; }
      if (j > m) { const q = seg[Math.max(0, 2 * m - j)]; return [2 * B[0] - q[0], 2 * B[1] - q[1]]; }
      return seg[j];
    };
    for (let j = 1; j < m; j++) {
      let x = 0, y = 0;
      for (let t = -r; t <= r; t++) { const q = at(j + t); x += q[0] * w[t + r]; y += q[1] * w[t + r]; }
      out[(s + j) % n] = [x, y];
    }
  }
  return out;
}

// scale: working px per source px (smoothing and tolerance are expressed in source pixels)
export function simplifyLoop(loop, eps, smooth, scale = 1) {
  const n = loop.length;
  if (n < 3) return null;
  const mids = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    mids[i] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  const dense = smooth > 0 ? smoothLoop(mids, (0.5 + 0.7 * smooth) * scale) : mids;
  const idx = rdpClosedIdx(dense, (smooth > 0 ? eps * 0.35 : eps) * scale);
  if (idx.length < 3) return null;
  let p = smooth > 0 ? fitVertices(dense, idx) : idx.map((i) => dense[i]);
  p = p.map((q) => [Math.round(q[0] * 1000) / 1000, Math.round(q[1] * 1000) / 1000]);
  return p;
}

// Groups raw loops into shapes {outer, holes} and simplifies them.
export function buildShapes(rawLoops, eps, smooth, scale = 1) {
  const outers = [], holes = [];
  for (const l of rawLoops) {
    const a = signedArea(l);
    if (a > 0) outers.push({ raw: l, area: a });
    else holes.push({ raw: l, area: -a });
  }
  outers.sort((a, b) => b.area - a.area);
  const shapes = outers.map((o) => ({ outer: o, holes: [] }));
  for (const h of holes) {
    const p = h.raw[0];
    const px = p[0] + 0.25, py = p[1] + 0.25;
    let target = shapes.find((s) => pointInPolygon(px, py, s.outer.raw)) || shapes[0];
    if (target) target.holes.push(h);
  }
  const result = [];
  for (const s of shapes) {
    const outer = simplifyLoop(s.outer.raw, eps, smooth, scale);
    if (!outer || Math.abs(signedArea(outer)) < 0.5) continue;
    const hs = [];
    for (const h of s.holes) {
      const hp = simplifyLoop(h.raw, eps, smooth, scale);
      if (hp && Math.abs(signedArea(hp)) >= 0.5) hs.push(hp);
    }
    result.push({ outer, holes: hs });
  }
  return result;
}

// ---------- main pipeline ----------
export function processImage(img, opts = {}) {
  const o = { ...DEFAULT_PROC, ...opts };
  // small images are upsampled to the working resolution so edges are located with sub-pixel precision
  const up = o.upscale === false ? 1 : Math.max(Math.min(4, (o.maxRes || 1000) / Math.max(img.width, img.height)), Math.min(2, Math.sqrt(4e6 / (img.width * img.height))));
  if (up >= 1.2) img = resizeBicubic(img, Math.round(img.width * up), Math.round(img.height * up));
  const sc = up >= 1.2 ? up : 1;
  const { width: W, height: H } = img;
  const N = W * H;
  const fg = computeForeground(img, o);
  let fgCount = 0;
  for (let i = 0; i < N; i++) fgCount += fg[i];
  if (!fgCount) throw new Error('No se encontró contenido en la imagen (¿todo es fondo?).');

  const flat = flatMask(img, fg);
  let flatCount = 0;
  for (let i = 0; i < N; i++) flatCount += flat[i];
  const sample = flatCount > Math.max(500, fgCount * 0.15) ? flat : fg;
  const lab = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) if (fg[i]) toLab(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2], lab, i * 3);

  const k = o.colors > 0 ? o.colors : estimateColorCount(img, sample);
  let centers = kmeansVec(lab, sample, k);
  // auto mode: drop near-duplicate clusters (ΔE < 8) that only come from semi-transparent/noisy pixels
  if (!(o.colors > 0) && centers.length > 1) {
    const keep = [];
    for (const c of centers) if (!keep.some((q) => (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2 < 64)) keep.push(c);
    centers = keep;
  }
  let labels = assignLabels(lab, fg, flat, centers);
  // edge pixels are blends in sRGB, so their split between two colours (and the background) is decided in RGB
  const rgb = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { rgb[i * 3] = img.data[i * 4]; rgb[i * 3 + 1] = img.data[i * 4 + 1]; rgb[i * 3 + 2] = img.data[i * 4 + 2]; }
  const rgbC = clusterMeans(rgb, labels, flat, centers.length);
  assignLabels(rgb, fg, flat, rgbC, 400, { labels });
  if (fg.bg) peelBackground(labels, rgb, rgbC, fg.bg, W, H);
  labels = modeFilter(labels, W, H, centers.length);
  // counters (hole of an "a", "e", "o"…) painted with the background colour are background, not a white piece:
  // as real holes they can't be swallowed by the thin-line / speck cleanups below
  if (fg.bg && openCounters(labels, rgb, rgbC, fg.bg, Math.max(30, o.tolerance), W, H)) peelBackground(labels, rgb, rgbC, fg.bg, W, H);
  // hairline outlines / fringes (1–3 px) become loose slivers and paper-thin walls when printed
  const minW = Number.isFinite(+o.minWidth) ? +o.minWidth : 0;
  if (minW >= 0) {
    const rThin = minW > 0 ? (minW * sc) / 2 : Math.max(1.5, 0.0015 * Math.max(W, H));
    removeThin(labels, W, H, centers.length, rThin);
  }
  // small holes are widened to a printable size (needs the final width to know the mm scale)
  if (o.minHoleMM > 0 && o.widthMM > 0) {
    let x0 = W, x1 = -1;
    for (let i = 0; i < N; i++) if (labels[i] >= 0) { const x = i % W; if (x < x0) x0 = x; if (x > x1) x1 = x; }
    const ppm = (x1 - x0 + 1) / o.widthMM;
    if (x1 >= x0) widenHoles(labels, W, H, o.minHoleMM * ppm, (o.holeWallMM ?? 0.6) * ppm);
  }

  const minArea = o.minArea > 0 ? o.minArea * sc * sc : Math.max(12, Math.round(fgCount * 0.00015));
  let comp, comps;
  for (let iter = 0; ; iter++) {
    ({ comp, comps } = labelComponents(labels, W, H));
    if (iter >= 5 || !mergeSmall(labels, comp, comps, W, H, minArea)) break;
  }

  // palette: clusters ordered by area
  const clusterArea = new Array(centers.length).fill(0);
  for (const c of comps) clusterArea[c.label] += c.area;
  const order = clusterArea.map((a, i) => i).filter((i) => clusterArea[i] > 0).sort((a, b) => clusterArea[b] - clusterArea[a]);
  const remap = new Map(order.map((old, idx) => [old, idx]));
  // palette colour = mean RGB of the clean (flat) pixels of each cluster
  const accF = centers.map(() => [0, 0, 0, 0]), accA = centers.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < N; i++) {
    const l = labels[i];
    if (l < 0) continue;
    const t = flat[i] ? accF[l] : accA[l];
    t[0] += img.data[i * 4]; t[1] += img.data[i * 4 + 1]; t[2] += img.data[i * 4 + 2]; t[3]++;
  }
  const palette = order.map((i) => {
    const a = accF[i][3] >= 4 ? accF[i] : accA[i];
    const [r, g, b] = [0, 1, 2].map((c) => Math.round(a[c] / Math.max(1, a[3])));
    return { r, g, b, hex: rgbToHex(r, g, b), area: clusterArea[i] };
  });

  // adjacency, background contact, bbox of foreground
  const nPieces = comps.length;
  const touchBg = new Uint8Array(nPieces);
  const adj = Array.from({ length: nPieces }, () => new Set());
  let fx0 = W, fy0 = H, fx1 = -1, fy1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, c = comp[i];
      if (c < 0) continue;
      if (x < fx0) fx0 = x; if (x > fx1) fx1 = x; if (y < fy0) fy0 = y; if (y > fy1) fy1 = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchBg[c] = 1;
      if (x > 0 && comp[i - 1] < 0) touchBg[c] = 1;
      if (y > 0 && comp[i - W] < 0) touchBg[c] = 1;
      if (x < W - 1) { const d = comp[i + 1]; if (d < 0) touchBg[c] = 1; else if (d !== c) { adj[c].add(d); adj[d].add(c); } }
      if (y < H - 1) { const d = comp[i + W]; if (d < 0) touchBg[c] = 1; else if (d !== c) { adj[c].add(d); adj[d].add(c); } }
    }
  }
  // nesting depth via BFS from pieces touching the background
  const depth = new Int32Array(nPieces).fill(-1);
  let queue = [];
  for (let c = 0; c < nPieces; c++) if (touchBg[c]) { depth[c] = 0; queue.push(c); }
  if (!queue.length && nPieces) { depth[0] = 0; queue.push(0); }
  while (queue.length) {
    const next = [];
    for (const c of queue) for (const d of adj[c]) if (depth[d] < 0) { depth[d] = depth[c] + 1; next.push(d); }
    queue = next;
  }

  // Suggested relief level: nesting depth, except "counters" (e.g. the hole of an "a"),
  // which return to the level of the surrounding background color.
  const level = new Int32Array(nPieces);
  for (let c = 0; c < nPieces; c++) {
    level[c] = Math.max(0, depth[c]);
    if (depth[c] >= 2 && !touchBg[c] && adj[c].size === 1) {
      const n = adj[c].values().next().value;
      if (depth[n] === depth[c] - 1 && comps[n].area < comps[c].area * 12) {
        for (const g of adj[n]) {
          if (depth[g] === depth[n] - 1 && comps[g].label === comps[c].label) { level[c] = depth[g]; break; }
        }
      }
    }
  }

  const pieces = comps.map((c, id) => {
    const raw = traceRegion(comp, W, H, id, c.minX, c.minY, c.maxX, c.maxY);
    return {
      id,
      cluster: remap.get(c.label),
      area: c.area,
      bbox: [c.minX, c.minY, c.maxX + 1, c.maxY + 1],
      depth: Math.max(0, depth[id]),
      level: level[id],
      neighbors: [...adj[id]],
      shapes: buildShapes(raw, o.detail, o.smooth, sc),
    };
  });

  return { width: W, height: H, upscale: sc, comp, palette, pieces, fgBBox: [fx0, fy0, fx1 + 1, fy1 + 1], options: o };
}

// Solid silhouette of all pieces, dilated by marginPx (for base plate).
export function computeSilhouette(result, marginPx, eps = 0.8, smooth = 1) {
  const { width: W, height: H, comp } = result;
  const P = Math.ceil(Math.max(0, marginPx)) + 2;
  const W2 = W + 2 * P, H2 = H + 2 * P, N2 = W2 * H2;
  const mask = new Uint8Array(N2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (comp[y * W + x] >= 0) mask[(y + P) * W2 + x + P] = 1;

  if (marginPx > 0) {
    const INF = 1e9, dist = new Float32Array(N2);
    for (let i = 0; i < N2; i++) dist[i] = mask[i] ? 0 : INF;
    const S2 = Math.SQRT2;
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      const i = y * W2 + x; let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) {
        d = Math.min(d, dist[i - W2] + 1);
        if (x > 0) d = Math.min(d, dist[i - W2 - 1] + S2);
        if (x < W2 - 1) d = Math.min(d, dist[i - W2 + 1] + S2);
      }
      dist[i] = d;
    }
    for (let y = H2 - 1; y >= 0; y--) for (let x = W2 - 1; x >= 0; x--) {
      const i = y * W2 + x; let d = dist[i];
      if (x < W2 - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < H2 - 1) {
        d = Math.min(d, dist[i + W2] + 1);
        if (x < W2 - 1) d = Math.min(d, dist[i + W2 + 1] + S2);
        if (x > 0) d = Math.min(d, dist[i + W2 - 1] + S2);
      }
      dist[i] = d;
    }
    for (let i = 0; i < N2; i++) mask[i] = dist[i] <= marginPx ? 1 : 0;
  }
  // fill holes: flood outside from the border
  const outside = new Uint8Array(N2), stack = new Int32Array(N2);
  let sp = 0;
  const push = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W2; x++) { push(x); push((H2 - 1) * W2 + x); }
  for (let y = 0; y < H2; y++) { push(y * W2); push(y * W2 + W2 - 1); }
  while (sp) {
    const i = stack[--sp], x = i % W2, y = (i / W2) | 0;
    if (x > 0) push(i - 1); if (x < W2 - 1) push(i + 1);
    if (y > 0) push(i - W2); if (y < H2 - 1) push(i + W2);
  }
  const arr = new Int32Array(N2);
  for (let i = 0; i < N2; i++) arr[i] = outside[i] ? 0 : 1;
  const raw = traceRegion(arr, W2, H2, 1, 0, 0, W2 - 1, H2 - 1)
    .map((l) => l.map((p) => [p[0] - P, p[1] - P]));
  return buildShapes(raw, eps, smooth);
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

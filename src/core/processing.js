// Image → color regions → pieces → vector loops (pure JS, no DOM).

export const DEFAULT_PROC = {
  colors: 0,          // 0 = auto
  removeBg: 'auto',   // 'auto' | 'yes' | 'no'
  tolerance: 40,      // background color tolerance (RGB distance)
  minArea: 0,         // 0 = auto (px)
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

export function kmeans(img, fg, k, seed = 12345) {
  const { data } = img;
  const rnd = mulberry32(seed);
  let count = 0;
  for (let i = 0; i < fg.length; i++) if (fg[i]) count++;
  const step = Math.max(1, Math.floor(count / 40000));
  const s = [];
  let c = 0;
  for (let i = 0; i < fg.length; i++) {
    if (!fg[i]) continue;
    if (c++ % step === 0) s.push(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
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
  for (let it = 0; it < 25; it++) {
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

function assignLabels(img, fg, centers) {
  const { data } = img;
  const labels = new Int32Array(fg.length).fill(-1);
  for (let i = 0; i < fg.length; i++) {
    if (!fg[i]) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    let best = 0, bd = Infinity;
    for (let j = 0; j < centers.length; j++) {
      const c = centers[j];
      const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    labels[i] = best;
  }
  return labels;
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
      if (bestC >= 5) out[i] = bestL;
    }
  }
  return out;
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

export function simplifyLoop(loop, eps, smooth) {
  const n = loop.length;
  if (n < 3) return null;
  const mids = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    mids[i] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  let p = rdpClosed(mids, eps);
  if (p.length < 3) return null;
  if (smooth > 0) p = chaikin(p, smooth);
  p = p.map((q) => [Math.round(q[0] * 1000) / 1000, Math.round(q[1] * 1000) / 1000]);
  return p;
}

// Groups raw loops into shapes {outer, holes} and simplifies them.
export function buildShapes(rawLoops, eps, smooth) {
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
    const outer = simplifyLoop(s.outer.raw, eps, smooth);
    if (!outer || Math.abs(signedArea(outer)) < 0.5) continue;
    const hs = [];
    for (const h of s.holes) {
      const hp = simplifyLoop(h.raw, eps, smooth);
      if (hp && Math.abs(signedArea(hp)) >= 0.5) hs.push(hp);
    }
    result.push({ outer, holes: hs });
  }
  return result;
}

// ---------- main pipeline ----------
export function processImage(img, opts = {}) {
  const o = { ...DEFAULT_PROC, ...opts };
  const { width: W, height: H } = img;
  const N = W * H;
  const fg = computeForeground(img, o);
  let fgCount = 0;
  for (let i = 0; i < N; i++) fgCount += fg[i];
  if (!fgCount) throw new Error('No se encontró contenido en la imagen (¿todo es fondo?).');

  const k = o.colors > 0 ? o.colors : estimateColorCount(img, fg);
  const centers = kmeans(img, fg, k);
  let labels = assignLabels(img, fg, centers);
  labels = modeFilter(labels, W, H, centers.length);

  const minArea = o.minArea > 0 ? o.minArea : Math.max(12, Math.round(fgCount * 0.00015));
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
  const palette = order.map((i) => {
    const [r, g, b] = centers[i].map((v) => Math.round(v));
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
      shapes: buildShapes(raw, o.detail, o.smooth),
    };
  });

  return { width: W, height: H, comp, palette, pieces, fgBBox: [fx0, fy0, fx1 + 1, fy1 + 1], options: o };
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

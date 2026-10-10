// Raster (binary mask / label) utilities shared by the 3D features and the 2D studio. Pure JS, no DOM.
import { traceRegion, buildShapes } from './processing.js';

const INF = 1e20;

// 1-D squared distance transform (Felzenszwalb & Huttenlocher). Writes distances to d and source index to a.
function dt1d(f, n, d, a, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    if (f[q] >= INF) continue;
    if (f[v[k]] >= INF) { v[k] = q; continue; }
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  if (f[v[0]] >= INF) { for (let q = 0; q < n; q++) { d[q] = INF; a[q] = -1; } return; }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
    a[q] = v[k];
  }
}

// Exact Euclidean distance (px) from every pixel to the nearest pixel where mask != 0.
// With wantIndex, also returns the linear index of that nearest pixel (-1 if the mask is empty).
export function edt(mask, W, H, wantIndex = false) {
  const N = W * H, M = Math.max(W, H);
  const D = new Float64Array(N);
  const I = wantIndex ? new Int32Array(N) : null;
  const f = new Float64Array(M), d = new Float64Array(M), a = new Int32Array(M), v = new Int32Array(M), z = new Float64Array(M + 1);
  const rowSrc = wantIndex ? new Int32Array(M) : null;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = mask[y * W + x] ? 0 : INF;
    dt1d(f, H, d, a, v, z);
    for (let y = 0; y < H; y++) { D[y * W + x] = d[y]; if (I) I[y * W + x] = a[y] < 0 ? -1 : a[y] * W + x; }
  }
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) { f[x] = D[o + x]; if (rowSrc) rowSrc[x] = I[o + x]; }
    dt1d(f, W, d, a, v, z);
    for (let x = 0; x < W; x++) { D[o + x] = d[x]; if (I) I[o + x] = a[x] < 0 ? -1 : rowSrc[a[x]]; }
  }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = D[i] >= INF ? Infinity : Math.sqrt(D[i]);
  return wantIndex ? { dist: out, index: I } : out;
}

export function dilate(mask, W, H, r) {
  if (!(r > 0)) return Uint8Array.from(mask, (v) => (v ? 1 : 0));
  const d = edt(mask, W, H);
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = d[i] <= r ? 1 : 0;
  return out;
}

export function erode(mask, W, H, r) {
  if (!(r > 0)) return Uint8Array.from(mask, (v) => (v ? 1 : 0));
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const d = edt(inv, W, H);
  const out = new Uint8Array(W * H);
  // pixels outside the grid count as empty, so the border erodes as well
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const edge = Math.min(x + 1, y + 1, W - x, H - y);
    out[i] = mask[i] && d[i] > r && edge > r ? 1 : 0;
  }
  return out;
}

// Morphological closing: rounds concave corners and bridges gaps narrower than 2r.
export function close(mask, W, H, r) { return r > 0 ? erode(dilate(mask, W, H, r), W, H, r) : mask; }

export function union(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] || b[i] ? 1 : 0; return o; }
export function subtract(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] && !b[i] ? 1 : 0; return o; }
export function countOn(m) { let n = 0; for (let i = 0; i < m.length; i++) if (m[i]) n++; return n; }

// Background reachable from the grid border (4-connected).
function outsideOf(mask, W, H) {
  const N = W * H, out = new Uint8Array(N), stack = new Int32Array(N);
  let sp = 0;
  const push = (i) => { if (!mask[i] && !out[i]) { out[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp) {
    const i = stack[--sp], x = i % W, y = (i / W) | 0;
    if (x > 0) push(i - 1); if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W); if (y < H - 1) push(i + W);
  }
  return out;
}

export function fillHoles(mask, W, H) {
  const out = outsideOf(mask, W, H);
  const r = new Uint8Array(W * H);
  for (let i = 0; i < r.length; i++) r[i] = out[i] ? 0 : 1;
  return r;
}

// Fills enclosed holes whose area is <= maxArea (px²). maxArea = Infinity fills all.
export function fillSmallHoles(mask, W, H, maxArea) {
  if (maxArea === Infinity) return fillHoles(mask, W, H);
  const out = outsideOf(mask, W, H);
  const hole = new Uint8Array(W * H);
  for (let i = 0; i < hole.length; i++) hole[i] = !mask[i] && !out[i] ? 1 : 0;
  const { labels, comps } = components(hole, W, H, false);
  const r = Uint8Array.from(mask, (v) => (v ? 1 : 0));
  for (let i = 0; i < r.length; i++) if (labels[i] >= 0 && comps[labels[i]].area <= maxArea) r[i] = 1;
  return r;
}

// Widens enclosed holes (L < 0 surrounded by L >= 0, e.g. the counter of an "a") narrower than minD px so they
// stay open when printed. The surrounding stroke keeps at least `wall` px towards the outside. Edits L in place;
// returns the number of widened holes.
export function widenHoles(L, W, H, minD, wall = 0) {
  if (!(minD > 0)) return 0;
  const N = W * H, fg = Uint8Array.from(L, (v) => (v >= 0 ? 1 : 0));
  const out = outsideOf(fg, W, H);
  const hole = new Uint8Array(N);
  for (let i = 0; i < N; i++) hole[i] = !fg[i] && !out[i] ? 1 : 0;
  const { labels: hl, comps } = components(hole, W, H, false);
  if (!comps.length) return 0;
  const dfg = edt(fg, W, H);
  const rho = new Float32Array(comps.length);
  for (let i = 0; i < N; i++) if (hl[i] >= 0 && dfg[i] > rho[hl[i]]) rho[hl[i]] = dfg[i];
  // inscribed diameter ≈ 2·(ridge distance − ½ px)
  const grow = Float32Array.from(rho, (r) => Math.max(0, minD / 2 - (r - 0.5)));
  const small = new Uint8Array(N);
  let n = 0;
  for (let i = 0; i < N; i++) if (hl[i] >= 0 && grow[hl[i]] > 0) small[i] = 1;
  for (let c = 0; c < comps.length; c++) if (grow[c] > 0) n++;
  if (!n) return 0;
  const { dist: dh, index: ih } = edt(small, W, H, true);
  const rest = new Uint8Array(N);                     // outside + holes that are already big enough
  for (let i = 0; i < N; i++) rest[i] = !fg[i] && !small[i] ? 1 : 0;
  const dOut = edt(rest, W, H);
  for (let i = 0; i < N; i++) {
    if (!fg[i] || ih[i] < 0) continue;
    if (dh[i] <= grow[hl[ih[i]]] && dOut[i] >= wall) L[i] = -1;
  }
  return n;
}

// Connected components of mask != 0.
export function components(mask, W, H, conn8 = true) {
  const N = W * H, labels = new Int32Array(N).fill(-1), stack = new Int32Array(N), comps = [];
  for (let s = 0; s < N; s++) {
    if (!mask[s] || labels[s] >= 0) continue;
    const id = comps.length, c = { area: 0, minX: W, minY: H, maxX: -1, maxY: -1, seed: s };
    let sp = 0; stack[sp++] = s; labels[s] = id;
    while (sp) {
      const i = stack[--sp], x = i % W, y = (i / W) | 0;
      c.area++;
      if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x; if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || (!conn8 && dx && dy)) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (mask[j] && labels[j] < 0) { labels[j] = id; stack[sp++] = j; }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

// Removes connected parts smaller than minArea px.
export function removeSmall(mask, W, H, minArea) {
  const { labels, comps } = components(mask, W, H);
  const r = new Uint8Array(W * H);
  for (let i = 0; i < r.length; i++) r[i] = labels[i] >= 0 && comps[labels[i]].area >= minArea ? 1 : 0;
  return r;
}

// Joins every loose part to the main body with straight bridges of the given width (px).
// Returns { mask, bridges: number }.
export function connectIslands(mask, W, H, widthPx) {
  let m = Uint8Array.from(mask, (v) => (v ? 1 : 0));
  let bridges = 0;
  for (let iter = 0; iter < 200; iter++) {
    const { labels, comps } = components(m, W, H);
    if (comps.length <= 1) break;
    let main = 0;
    for (let c = 1; c < comps.length; c++) if (comps[c].area > comps[main].area) main = c;
    const mainMask = new Uint8Array(W * H);
    for (let i = 0; i < mainMask.length; i++) mainMask[i] = labels[i] === main ? 1 : 0;
    const { dist, index } = edt(mainMask, W, H, true);
    // closest loose part to the main body
    let best = -1, bd = Infinity;
    for (let i = 0; i < labels.length; i++) if (labels[i] >= 0 && labels[i] !== main && dist[i] < bd) { bd = dist[i]; best = i; }
    if (best < 0) break;
    const t = index[best];
    const ax = best % W, ay = (best / W) | 0, bx = t % W, by = (t / W) | 0;
    // extend slightly into both bodies for a solid joint
    const len = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / len, uy = (by - ay) / len, ext = Math.max(1, widthPx * 0.5);
    fillCapsule(m, W, H, ax - ux * ext, ay - uy * ext, bx + ux * ext, by + uy * ext, widthPx / 2);
    bridges++;
  }
  return { mask: m, bridges };
}

// ---------- drawing primitives (grid pixel coordinates; pixel centers at +0.5) ----------
export function fillPolygon(mask, W, H, pts, value = 1) {
  if (pts.length < 3) return;
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const ya = Math.max(0, Math.floor(y0)), yb = Math.min(H - 1, Math.ceil(y1));
  const xs = [];
  for (let y = ya; y <= yb; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > sy) !== (yj > sy)) xs.push(xi + ((sy - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) mask[y * W + x] = value;
    }
  }
}

export function fillCircle(mask, W, H, cx, cy, r, value = 1) {
  const ya = Math.max(0, Math.floor(cy - r)), yb = Math.min(H - 1, Math.ceil(cy + r));
  const xa = Math.max(0, Math.floor(cx - r)), xb = Math.min(W - 1, Math.ceil(cx + r));
  const r2 = r * r;
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    if (dx * dx + dy * dy <= r2) mask[y * W + x] = value;
  }
}

// Thick segment with round caps.
export function fillCapsule(mask, W, H, x0, y0, x1, y1, r, value = 1) {
  const ya = Math.max(0, Math.floor(Math.min(y0, y1) - r)), yb = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + r));
  const xa = Math.max(0, Math.floor(Math.min(x0, x1) - r)), xb = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + r));
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1e-9, r2 = r * r;
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
    const px = x + 0.5 - x0, py = y + 0.5 - y0;
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / L2));
    const ex = px - t * dx, ey = py - t * dy;
    if (ex * ex + ey * ey <= r2) mask[y * W + x] = value;
  }
}

// ---------- parametric outline shapes (polygons centred at cx, cy; w/h = full size) ----------
export const PLATE_SHAPES = {
  circle: 'Círculo',
  rect: 'Rectángulo redondeado',
  star: 'Estrella',
  heart: 'Corazón',
  hexagon: 'Hexágono',
  octagon: 'Octágono',
  shield: 'Escudo',
  badge: 'Sello / insignia',
  cloud: 'Nube',
  speech: 'Globo de diálogo',
};

export function shapePolygon(kind, cx, cy, w, h, o = {}) {
  const pts = [];
  const rx = w / 2, ry = h / 2;
  const ellipse = (n = 128) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } };
  const roundedRect = (x0, y0, x1, y1, r) => {
    r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
    const arc = (ax, ay, a0) => { for (let i = 0; i <= 12; i++) { const a = a0 + (i / 12) * Math.PI / 2; pts.push([ax + r * Math.cos(a), ay + r * Math.sin(a)]); } };
    if (r <= 0) { pts.push([x0, y0], [x1, y0], [x1, y1], [x0, y1]); return; }
    arc(x1 - r, y0 + r, -Math.PI / 2); arc(x1 - r, y1 - r, 0); arc(x0 + r, y1 - r, Math.PI / 2); arc(x0 + r, y0 + r, Math.PI);
  };
  switch (kind) {
    case 'circle': ellipse(); break;
    case 'rect': roundedRect(cx - rx, cy - ry, cx + rx, cy + ry, o.corner ?? Math.min(rx, ry) * 0.25); break;
    case 'hexagon': case 'octagon': {
      const n = kind === 'hexagon' ? 6 : 8, off = kind === 'hexagon' ? 0 : Math.PI / 8;
      for (let i = 0; i < n; i++) { const a = off + (i / n) * Math.PI * 2; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
      break;
    }
    case 'star': {
      const n = Math.max(3, Math.round(o.points || 5)), inner = o.inner ?? 0.5, round = o.round ?? 0;
      const raw = [];
      for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2, k = i % 2 ? inner : 1;
        raw.push([cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]);
      }
      if (round > 0) pts.push(...chaikinClosed(raw, 3, round)); else pts.push(...raw);
      break;
    }
    case 'heart': {
      const n = 160;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push([cx + (x / 17) * rx, cy - ((y + 2.5) / 15) * ry]);
      }
      break;
    }
    case 'shield': {
      const x0 = cx - rx, x1 = cx + rx, y0 = cy - ry, y1 = cy + ry, ym = cy - ry * 0.1;
      const q = (a, c, b) => { for (let i = 1; i <= 24; i++) { const t = i / 24, u = 1 - t; pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); } };
      pts.push([x0, y0], [x1, y0], [x1, ym]);
      q([x1, ym], [x1, y1 - ry * 0.35], [cx, y1]);
      q([cx, y1], [x0, y1 - ry * 0.35], [x0, ym]);
      break;
    }
    case 'badge': {
      const n = Math.max(8, Math.round(o.points || 16)), depth = 0.08, m = n * 12;
      for (let i = 0; i < m; i++) {
        const a = (i / m) * Math.PI * 2, k = 1 - depth + depth * Math.cos(a * n);
        pts.push([cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]);
      }
      break;
    }
    case 'cloud': {
      const m = 240, n = 7;
      for (let i = 0; i < m; i++) {
        const a = (i / m) * Math.PI * 2, bump = Math.abs(Math.sin((a * n) / 2));
        const k = 0.86 + 0.14 * bump;
        pts.push([cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]);
      }
      break;
    }
    case 'speech': {
      const bh = h * 0.8, by1 = cy - ry + bh;
      roundedRect(cx - rx, cy - ry, cx + rx, by1, Math.min(rx, bh / 2) * 0.35);
      const tmp = pts.splice(0);
      const tail = [[cx - rx * 0.05, by1], [cx - rx * 0.35, cy + ry], [cx - rx * 0.3, by1]];
      // the bottom edge runs right→left in this winding; insert the tail there
      const out = [];
      let added = false;
      for (let i = 0; i < tmp.length; i++) {
        out.push(tmp[i]);
        const a = tmp[i], b = tmp[(i + 1) % tmp.length];
        if (!added && a[1] >= by1 - 1e-6 && b[1] >= by1 - 1e-6 && a[0] > tail[0][0] && b[0] < tail[2][0]) { out.push(...tail); added = true; }
      }
      pts.push(...out);
      break;
    }
    default: ellipse();
  }
  return pts;
}

function chaikinClosed(p, iters, amount = 0.25) {
  const q = Math.min(0.25, Math.max(0.02, amount * 0.25));
  for (let k = 0; k < iters; k++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push([a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q], [a[0] + (b[0] - a[0]) * (1 - q), a[1] + (b[1] - a[1]) * (1 - q)]);
    }
    p = out;
  }
  return p;
}

// Traces a mask into simplified shapes; output coords = grid * k + (ox, oy).
export function traceMask(mask, W, H, eps = 0.8, smooth = 1, ox = 0, oy = 0, k = 1) {
  const arr = mask instanceof Int32Array ? mask : Int32Array.from(mask, (v) => (v ? 1 : 0));
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (arr[y * W + x] === 1) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < 0) return [];
  const raw = traceRegion(arr, W, H, 1, minX, minY, maxX, maxY);
  const shapes = buildShapes(raw, eps, smooth);
  if (k === 1 && !ox && !oy) return shapes;
  const tf = (l) => l.map((p) => [p[0] * k + ox, p[1] * k + oy]);
  return shapes.map((s) => ({ outer: tf(s.outer), holes: s.holes.map(tf) }));
}

export function maskBBox(mask, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

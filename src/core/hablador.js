// Hablador (table sign / photobooth stand) in laser-cut acrylic: parametric generator. Pure JS, no DOM.
// Every outline is built from exact lines, circular fillets (SVG arcs) and font Béziers, so the cut files have
// no stair steps, spikes or hairlines. Slots are sized from the real acrylic thickness + clearance.
// Units: millimetres. SVG coordinates (y grows downwards). Panel space: x 0..panelW, y = 0 at the base top, up < 0.
import polygonClipping from 'polygon-clipping';
import { fitClosed, cubicsToPath } from './curvefit.js';
import { qrMatrix } from './elements.js';
import { edt, components, close, dilate, erode, traceMask } from './raster.js';
import { computeForeground } from './processing.js';

export const HABLADOR_FONTS = {
  'Montserrat Black': 'Montserrat-Black.ttf',
  'Montserrat ExtraBold': 'Montserrat-ExtraBold.ttf',
  'Montserrat Bold': 'Montserrat-Bold.ttf',
  'Poppins Black': 'Poppins-Black.ttf',
  'Lilita One': 'LilitaOne-Regular.ttf',
  'Bebas Neue': 'BebasNeue-Regular.ttf',
  'Titan One': 'TitanOne-Regular.ttf',
};

export const DEFAULT_HABLADOR = () => ({
  name: 'LOVECUBE',
  width: 170, height: 250, depth: 80,
  white: { t: 4, label: 'Acrílico blanco', color: '#ffffff' },
  black: { t: 3, label: 'Acrílico negro', color: '#16161a' },
  clearance: 0.15,       // added to every slot (kerf + easy fit)
  panelCorner: 6,
  baseCorner: 5,
  border: 6,             // black border around the top icon
  title: { enabled: true, text: 'LOVECUBE', font: 'Montserrat Black', height: 19, maxWidth: 124, tracking: -0.035, weld: true },
  subtitle: { enabled: true, text: 'PHOTOBOOTH', font: 'Montserrat Black', capHeight: 8.5, tracking: 0.42 },
  qr: {
    enabled: true, w: 73, h: 85, corner: 4, gap: 8, labelFont: 'Montserrat Black',
    items: [
      { label: 'ESCRÍBENOS', sub: 'POR WHATSAPP', url: 'https://wa.me/573000000000', color: '#1faf38' },
      { label: 'SÍGUENOS', sub: 'EN INSTAGRAM', url: 'https://instagram.com/lovecube.photobooth', color: '#e1306c' },
    ],
  },
  nfc: { enabled: false, diameter: 25, plate: 0 },
  cards: { enabled: true, cardW: 90, height: 40, depth: 28, frontOffset: 10, print: true },
  icon: { type: 'cube', height: 58, heart: true, custom: null },
  braces: { enabled: true, h: 50, d: 30 },
  jig: { enabled: true },
  sheet: { w: 600, h: 400, gap: 3, margin: 5 },
  tabs: { panel: 30, front: 20, side: 14, brace: 16 },
});

// ------------------------------------------------------------------ path primitives
// contour: [['M',x,y], ['L',x,y] | ['C',x1,y1,x2,y2,x,y] | ['A',rx,ry,rot,large,sweep,x,y], ..., ['Z']]
const r3 = (v) => Math.round(v * 1000) / 1000;
const f3 = (v) => String(r3(v) + 0);

export function contourD(c) {
  let d = '';
  for (const s of c) {
    if (s[0] === 'Z') d += 'Z ';
    else if (s[0] === 'A') d += `A${f3(s[1])} ${f3(s[2])} ${f3(s[3])} ${s[4]} ${s[5]} ${f3(s[6])} ${f3(s[7])} `;
    else d += s[0] + s.slice(1).map(f3).join(' ') + ' ';
  }
  return d.trim();
}
export const contoursD = (cs) => cs.map(contourD).join(' ');

function mapContour(c, fn, rotDeg = 0) {
  return c.map((s) => {
    if (s[0] === 'Z') return s;
    if (s[0] === 'A') { const p = fn([s[6], s[7]]); return ['A', s[1], s[2], s[3] + rotDeg, s[4], s[5], p[0], p[1]]; }
    const o = [s[0]];
    for (let i = 1; i < s.length; i += 2) { const p = fn([s[i], s[i + 1]]); o.push(p[0], p[1]); }
    return o;
  });
}
export const translate = (cs, dx, dy) => cs.map((c) => mapContour(c, (p) => [p[0] + dx, p[1] + dy]));
export const scaleContours = (cs, k, ox = 0, oy = 0) => cs.map((c) => mapContour(c.map((s) => (s[0] === 'A' ? ['A', s[1] * k, s[2] * k, ...s.slice(3)] : s)), (p) => [ox + p[0] * k, oy + p[1] * k]));
const rot90 = (cs) => cs.map((c) => mapContour(c, (p) => [-p[1], p[0]], 90));

// SVG arc endpoint → centre parameterisation (SVG 1.1 F.6.5)
function arcCenter(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  const phi = (phiDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  if (fs && dt < 0) dt += 2 * Math.PI;
  return { cx, cy, rx, ry, phi, t1, dt };
}

// Contour → polyline (closed ring, no repeated last point). tol: max chord error (mm).
export function flatten(c, tol = 0.01) {
  const pts = [];
  let cur = [0, 0];
  for (const s of c) {
    if (s[0] === 'M') { cur = [s[1], s[2]]; pts.push(cur); }
    else if (s[0] === 'L') { cur = [s[1], s[2]]; pts.push(cur); }
    else if (s[0] === 'C') {
      const p0 = cur, p1 = [s[1], s[2]], p2 = [s[3], s[4]], p3 = [s[5], s[6]];
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
      const n = Math.max(2, Math.ceil(Math.sqrt(L / tol) * 0.6));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        pts.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
      }
      cur = p3;
    } else if (s[0] === 'A') {
      const a = arcCenter(cur[0], cur[1], s[1], s[2], s[3], s[4], s[5], s[6], s[7]);
      const r = Math.max(a.rx, a.ry);
      const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(r, tol))));
      const n = Math.max(2, Math.ceil(Math.abs(a.dt) / Math.max(step, 1e-3)));
      for (let i = 1; i <= n; i++) {
        const t = a.t1 + (a.dt * i) / n, x = a.rx * Math.cos(t), y = a.ry * Math.sin(t);
        pts.push([a.cx + Math.cos(a.phi) * x - Math.sin(a.phi) * y, a.cy + Math.sin(a.phi) * x + Math.cos(a.phi) * y]);
      }
      cur = [s[6], s[7]];
    }
  }
  if (pts.length > 1) { const a = pts[0], b = pts[pts.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) pts.pop(); }
  return pts;
}

export function bbox(cs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cs) for (const p of flatten(c, 0.05)) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

const ringArea = (pts) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]); return a / 2; };
function inRing(x, y, pts) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

// Polygon with a fillet radius per vertex (0 = sharp). Concave and convex corners both supported.
export function roundPoly(pts, radii = 0) {
  const n = pts.length, R = Array.isArray(radii) ? radii : pts.map(() => radii);
  const seg = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const r = R[i] || 0;
    const v1 = [p0[0] - p1[0], p0[1] - p1[1]], v2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    const u1 = [v1[0] / l1, v1[1] / l1], u2 = [v2[0] / l2, v2[1] / l2];
    const cosT = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
    const th = Math.acos(cosT);
    if (r <= 0 || th > Math.PI - 1e-3 || th < 1e-3) { seg.push({ a: p1, b: p1, r: 0 }); continue; }
    let t = r / Math.tan(th / 2);
    const tmax = Math.min(l1, l2) * 0.49;
    let rr = r;
    if (t > tmax) { t = tmax; rr = t * Math.tan(th / 2); }
    const a = [p1[0] + u1[0] * t, p1[1] + u1[1] * t], b = [p1[0] + u2[0] * t, p1[1] + u2[1] * t];
    const d1 = [p1[0] - p0[0], p1[1] - p0[1]], d2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const sweep = d1[0] * d2[1] - d1[1] * d2[0] > 0 ? 1 : 0;
    seg.push({ a, b, r: rr, sweep });
  }
  const c = [['M', seg[0].b[0], seg[0].b[1]]];
  for (let k = 1; k <= n; k++) {
    const s = seg[k % n];
    c.push(['L', s.a[0], s.a[1]]);
    if (s.r > 0) c.push(['A', s.r, s.r, 0, 0, s.sweep, s.b[0], s.b[1]]);
  }
  c.push(['Z']);
  return c;
}
export const rectC = (x, y, w, h, r = 0) => roundPoly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], r);
export function circleC(cx, cy, r) {
  return [['M', cx + r, cy], ['A', r, r, 0, 0, 1, cx - r, cy], ['A', r, r, 0, 0, 1, cx + r, cy], ['Z']];
}
// Heart centred on (cx, cy), width w (height ≈ 0.9 w).
export function heartC(cx, cy, w) {
  const P = (x, y) => [cx + (x - 0.5) * w, cy + (y - 0.45) * w];
  const pts = [[0.5, 0.25], [0.5, 0.1, 0.38, 0, 0.25, 0], [0.1, 0, 0, 0.12, 0, 0.28], [0, 0.5, 0.25, 0.68, 0.5, 0.9],
    [0.75, 0.68, 1, 0.5, 1, 0.28], [1, 0.12, 0.9, 0, 0.75, 0], [0.62, 0, 0.5, 0.1, 0.5, 0.25]];
  const c = [['M', ...P(pts[0][0], pts[0][1])]];
  for (let i = 1; i < pts.length; i++) { const q = pts[i]; c.push(['C', ...P(q[0], q[1]), ...P(q[2], q[3]), ...P(q[4], q[5])]); }
  c.push(['Z']);
  return c;
}

// Convex polygon offset (positive = outward). Works for either orientation.
function offsetConvex(pts, d) {
  const n = pts.length, s = Math.sign(ringArea(pts)) || 1;
  const lines = pts.map((p, i) => {
    const q = pts[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
    // outward normal for a ring of orientation s (ringArea>0 ⇒ clockwise in y-down screen)
    const nx = (-dy / l) * s, ny = (dx / l) * s;
    return { p: [p[0] - nx * d, p[1] - ny * d], d: [dx, dy] };
  });
  return lines.map((L, i) => {
    const P = lines[(i - 1 + n) % n];
    const den = P.d[0] * L.d[1] - P.d[1] * L.d[0];
    if (Math.abs(den) < 1e-9) return L.p;
    const t = ((L.p[0] - P.p[0]) * L.d[1] - (L.p[1] - P.p[1]) * L.d[0]) / den;
    return [P.p[0] + P.d[0] * t, P.p[1] + P.d[1] * t];
  });
}
function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-9) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 1e-9) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// ------------------------------------------------------------------ text (opentype.js Font objects)
function glyphContours(path) {
  const out = [];
  let c = null, cur = [0, 0];
  for (const k of path.commands) {
    if (k.type === 'M') { if (c && c.length > 1) { c.push(['Z']); out.push(c); } c = [['M', k.x, k.y]]; cur = [k.x, k.y]; }
    else if (k.type === 'L') { c.push(['L', k.x, k.y]); cur = [k.x, k.y]; }
    else if (k.type === 'C') { c.push(['C', k.x1, k.y1, k.x2, k.y2, k.x, k.y]); cur = [k.x, k.y]; }
    else if (k.type === 'Q') {
      c.push(['C', cur[0] + (2 / 3) * (k.x1 - cur[0]), cur[1] + (2 / 3) * (k.y1 - cur[1]), k.x + (2 / 3) * (k.x1 - k.x), k.y + (2 / 3) * (k.y1 - k.y), k.x, k.y]);
      cur = [k.x, k.y];
    } else if (k.type === 'Z') { if (c && c.length > 1) { c.push(['Z']); out.push(c); } c = null; }
  }
  if (c && c.length > 1) { c.push(['Z']); out.push(c); }
  return out;
}

export function capHeightRatio(font) {
  const ch = font.tables?.os2?.sCapHeight;
  if (ch > 0) return ch / font.unitsPerEm;
  const g = font.charToGlyph('H').getBoundingBox();
  return (g.y2 - g.y1) / font.unitsPerEm;
}

// Lays out a single line. Returns glyph pieces [{ch, contours}] placed with the baseline at y=0, left at x=0.
export function layoutText(font, text, size, tracking = 0) {
  const glyphs = font.stringToGlyphs(String(text));
  const k = size / font.unitsPerEm;
  let x = 0;
  const out = [];
  const chars = [...String(text)];
  glyphs.forEach((g, i) => {
    const cs = glyphContours(g.getPath(x, 0, size));
    if (cs.length) out.push({ ch: chars[i] ?? '', contours: cs });
    x += g.advanceWidth * k + tracking * size;
    if (i + 1 < glyphs.length) x += font.getKerningValue(g, glyphs[i + 1]) * k;
  });
  return out;
}

// Text block placed so its ink bbox is centred on cx and its ink top/bottom matches the request.
function textBlock(font, text, { capHeight, height, maxWidth, tracking = 0, cx = 0, top = null, bottom = null }) {
  let size = capHeight ? capHeight / capHeightRatio(font) : 100;
  let gl = layoutText(font, text, size, tracking);
  let bb = bbox(gl.flatMap((g) => g.contours));
  let k = 1;
  if (height) k = height / bb.h;
  if (maxWidth && bb.w * k > maxWidth) k = maxWidth / bb.w;
  if (k !== 1) { size *= k; gl = layoutText(font, text, size, tracking); bb = bbox(gl.flatMap((g) => g.contours)); }
  const dx = cx - (bb.x0 + bb.x1) / 2;
  const dy = top != null ? top - bb.y0 : bottom != null ? bottom - bb.y1 : 0;
  return { glyphs: gl.map((g) => ({ ch: g.ch, contours: translate(g.contours, dx, dy) })), size, bbox: { ...bb, x0: bb.x0 + dx, x1: bb.x1 + dx, y0: bb.y0 + dy, y1: bb.y1 + dy } };
}

// ------------------------------------------------------------------ boolean (weld) with curve refit
const toRing = (pts) => { const r = pts.map((p) => [p[0], p[1]]); r.push(r[0]); return r; };
function regionOf(contours) {
  // even-odd region of one glyph / shape (handles any contour direction)
  let acc = null;
  for (const c of contours) {
    const poly = [[toRing(flatten(c, 0.004))]];
    acc = acc ? polygonClipping.xor(acc, poly) : poly;
  }
  return acc || [];
}
export function weld(shapes, { tol = 0.012 } = {}) {
  const regions = shapes.map(regionOf).filter((r) => r.length);
  if (!regions.length) return [];
  const u = regions.length === 1 ? regions[0] : polygonClipping.union(...regions);
  // each output polygon = [outer, ...holes]; refit Béziers on every ring
  return u.map((poly) => poly.map((ring) => {
    const pts = ring.slice(0, -1);
    const d = cubicsToPath(fitClosed(pts, { tol, cornerDeg: 38 }));
    return pathToContour(d);
  }));
}
// Image (RGBA ImageData-like) → logo pieces for cfg.icon.custom. The logo ink (everything that is not the
// background) becomes white acrylic; its holes show the black panel. Features thinner than `minFeature` mm
// are removed (open) and gaps narrower than it are closed, then every ring is refit with Béziers.
export function traceLogo(img, { heightMM = 58, minFeature = 1.2, tolerance = 40, minAreaMM2 = 4, invert = false } = {}) {
  const fg0 = computeForeground(img, { removeBg: 'auto', tolerance });
  const { data, width: W0, height: H0 } = img;
  // counters/holes painted in the background colour are not connected to the border: clear them too
  if (fg0.bg) {
    const [br, bg, bb] = fg0.bg, t2 = tolerance * tolerance;
    for (let i = 0; i < W0 * H0; i++) { const dr = data[i * 4] - br, dg = data[i * 4 + 1] - bg, db = data[i * 4 + 2] - bb; if (dr * dr + dg * dg + db * db <= t2) fg0[i] = 0; }
  }
  if (invert) for (let i = 0; i < W0 * H0; i++) { const l = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; fg0[i] = fg0[i] && l > 128 ? 1 : 0; }
  let x0 = W0, y0 = H0, x1 = -1, y1 = -1;
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (fg0[y * W0 + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { white: [], black: [] };
  // work at ~10 px/mm of the final size (sub-mm precision, step-free after fitting)
  const ppm = 10, s = (heightMM * ppm) / (y1 - y0 + 1);
  const pad = Math.ceil(minFeature * ppm) + 4;
  const W = Math.ceil((x1 - x0 + 1) * s) + 2 * pad, H = Math.ceil((y1 - y0 + 1) * s) + 2 * pad;
  let m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.floor((x - pad) / s + x0), sy = Math.floor((y - pad) / s + y0);
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && fg0[sy * W0 + sx]) m[y * W + x] = 1;
  }
  const r = (minFeature * ppm) / 2;
  m = close(m, W, H, Math.max(1, Math.round(r)));
  m = dilate(erode(m, W, H, Math.round(r)), W, H, Math.round(r)); // open: drop hairlines/spikes
  const { labels, comps } = components(m, W, H);
  const white = [];
  comps.forEach((c, ci) => {
    if (c.area / (ppm * ppm) < minAreaMM2) return;
    const cm = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (labels[i] === ci) cm[i] = 1;
    const shapes = traceMask(cm, W, H, 0.6, 2, 0, 0, 1 / ppm);
    for (const sh of shapes) {
      const rings = [sh.outer, ...sh.holes.filter((h) => Math.abs(polyArea(h)) > minAreaMM2 / 2)];
      white.push(rings.map((ring) => pathToContour(cubicsToPath(fitClosed(ring, { tol: 0.03, cornerDeg: 50 })))));
    }
  });
  return { white, black: [] };
}
const polyArea = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };

export function pathToContour(d) {
  const t = d.match(/[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
  const c = [];
  let i = 0;
  while (i < t.length) {
    const cmd = t[i++];
    if (cmd === 'Z' || cmd === 'z') { c.push(['Z']); continue; }
    const n = cmd === 'C' ? 6 : 2;
    c.push([cmd, ...t.slice(i, i + n).map(Number)]); i += n;
  }
  return c;
}

// ------------------------------------------------------------------ the default "open box + card" icon
// Partition of the icon (y-up, mm, bottom vertex at the origin, ~61 × 58 at scale 1); pieces are inset by gap/2.
const CUBE_ICON = {
  faceL: [[0, 0], [-22.5, 13], [-22.5, 35], [0, 22]],
  faceR: [[0, 0], [0, 22], [22.5, 35], [22.5, 13]],
  flapL: [[0, 22], [-22.5, 35], [-30.5, 44], [-8, 31]],
  flapR: [[0, 22], [8, 31], [30.5, 44], [22.5, 35]],
  card: [[0, 22], [8, 31], [13, 58], [-11, 55], [-8, 31]],
  heart: { x: 1, y: 43, w: 10.5 },
  h: 58,
};

function cubeIcon(cx, bottomY, height, gap = 2) {
  const k = height / CUBE_ICON.h;
  const T = (p) => [cx + p[0] * k, bottomY - p[1] * k];
  const names = { faceL: 'Ícono · cara izquierda', faceR: 'Ícono · cara derecha', flapL: 'Ícono · solapa izquierda', flapR: 'Ícono · solapa derecha', card: 'Ícono · tarjeta' };
  const pieces = Object.keys(names).map((key) => {
    const pts = CUBE_ICON[key].map(T);
    const ins = offsetConvex(pts, -gap / 2);
    return { key, name: names[key], contours: [roundPoly(ins, 0.8)], pts };
  });
  const hp = T([CUBE_ICON.heart.x, CUBE_ICON.heart.y]);
  const hull = convexHull(pieces.flatMap((p) => p.pts));
  return { pieces, heart: heartC(hp[0], hp[1], CUBE_ICON.heart.w * k), hull };
}

// ------------------------------------------------------------------ QR (vector, horizontal runs merged)
function qrContours(text, x, y, size) {
  const m = qrMatrix(text), n = m.n, s = size / n, cs = [];
  for (let r = 0; r < n; r++) {
    let c0 = -1;
    for (let c = 0; c <= n; c++) {
      const on = c < n && m.isDark(r, c);
      if (on && c0 < 0) c0 = c;
      if (!on && c0 >= 0) { cs.push(rectC(x + c0 * s, y + r * s, (c - c0) * s, s)); c0 = -1; }
    }
  }
  return { contours: cs, modules: n, moduleMM: s };
}

// ------------------------------------------------------------------ build
// fonts: { [family]: opentype.Font }  (loaded by the caller: fs in Node, fetch in the app)
export function buildHablador(cfgIn, fonts) {
  const cfg = cfgIn;
  const tW = cfg.white.t, tB = cfg.black.t, cl = cfg.clearance;
  const warnings = [];
  const font = (fam) => fonts[fam] || fonts[Object.keys(fonts)[0]];
  const W = cfg.width, panelW = W - 2, cx = panelW / 2;
  const baseStack = 2 * tB;
  const panelH = cfg.height - baseStack;
  const pieces = [];
  const add = (p) => { const q = { qty: 1, print: [], onPanel: false, ...p }; pieces.push(q); return q; };

  // ---- top icon
  let iconTop = -(panelH - cfg.border);
  let icon = null, iconBottom = iconTop, hullPts = [];
  if (cfg.icon.type === 'cube') {
    icon = cubeIcon(cx, iconTop + cfg.icon.height, cfg.icon.height);
    iconBottom = iconTop + cfg.icon.height;
    hullPts = offsetConvex(icon.hull, cfg.border);
  } else if (cfg.icon.type === 'custom' && cfg.icon.custom?.white?.length) {
    // custom traced logo: white pieces (+ optional black inlays), scaled to icon height and centred
    const all = cfg.icon.custom.white.flat();
    const bb = bbox(all), k = cfg.icon.height / bb.h;
    const place = (cs) => translate(scaleContours(cs, k), cx - ((bb.x0 + bb.x1) / 2) * k, iconTop - bb.y0 * k);
    icon = {
      pieces: cfg.icon.custom.white.map((cs, i) => ({ key: 'c' + i, name: `Logo · pieza ${i + 1}`, contours: place(cs) })),
      inlays: (cfg.icon.custom.black || []).map((cs) => place(cs)),
    };
    iconBottom = iconTop + cfg.icon.height;
    const pts = icon.pieces.flatMap((p) => p.contours.flatMap((c) => flatten(c, 0.2)));
    hullPts = offsetConvex(convexHull(pts), cfg.border);
  }

  // ---- QR plates
  const items = cfg.qr.enabled ? cfg.qr.items.slice(0, 3) : [];
  let plateW = cfg.qr.w, plateH = cfg.qr.h;
  const side = 7;
  if (items.length) {
    const maxW = (panelW - 2 * side - (items.length - 1) * cfg.qr.gap) / items.length;
    if (plateW > maxW) { warnings.push(`Placas QR reducidas a ${maxW.toFixed(1)} mm de ancho para caber en el panel.`); plateW = maxW; }
  }
  const platesTop = (icon ? iconBottom : iconTop) + 5;
  const platesBottom = platesTop + (items.length ? plateH : 0);
  const shoulder = -(-platesTop + 7);

  // ---- titles (bottom-up stack under the plates)
  let y = platesBottom + (items.length ? 8 : 0);
  let title = null, sub = null;
  if (cfg.title.enabled && cfg.title.text.trim()) {
    title = textBlock(font(cfg.title.font), cfg.title.text, { height: cfg.title.height, maxWidth: cfg.title.maxWidth, tracking: cfg.title.tracking, cx, top: y });
    y = title.bbox.y1 + 6;
  }
  if (cfg.subtitle.enabled && cfg.subtitle.text.trim()) {
    sub = textBlock(font(cfg.subtitle.font), cfg.subtitle.text, { capHeight: cfg.subtitle.capHeight, maxWidth: panelW - 20, tracking: cfg.subtitle.tracking, cx, top: y });
    y = sub.bbox.y1;
  }
  const lowest = y;
  if (cfg.cards.enabled && -lowest < cfg.cards.height + 3) warnings.push(`El texto inferior queda tapado por el porta tarjetas (sube el alto del hablador o reduce textos: faltan ${(cfg.cards.height + 3 + lowest).toFixed(1)} mm).`);
  if (-lowest < 5) warnings.push('El contenido no cabe en el alto del panel.');

  // ---- panel (black): hull of the body rectangle + icon border, filleted; tabs underneath
  const tabs = cfg.tabs;
  const tabX = [cx - panelW * 0.3, cx + panelW * 0.3];
  {
    const body = [[0, 0], [panelW, 0], [panelW, shoulder], [0, shoulder]];
    const hull = convexHull(body.concat(hullPts.length ? hullPts : [[0, -panelH], [panelW, -panelH]]));
    // rotate hull so it starts at the bottom-left corner, going towards bottom-right (y-down: area sign)
    let i0 = hull.findIndex((p) => Math.abs(p[0]) < 1e-6 && Math.abs(p[1]) < 1e-6);
    let ring = hull.slice(i0).concat(hull.slice(0, i0));
    if (Math.abs(ring[1][1]) > 1e-6) ring = [ring[0], ...ring.slice(1).reverse()];
    // ring[0]=(0,0), ring[1]=(panelW,0) … top vertices … back to (0,0)
    const pts = [[0, 0]], rad = [0];
    for (const tx of tabX) {
      const a = tx - tabs.panel / 2, b = tx + tabs.panel / 2;
      pts.push([a, 0], [a, tB], [b, tB], [b, 0]); rad.push(0, 0.4, 0.4, 0);
    }
    for (let i = 1; i < ring.length; i++) { pts.push(ring[i]); rad.push(Math.abs(ring[i][1]) < 1e-6 ? 0 : cfg.panelCorner); }
    const cut = [roundPoly(pts, rad)];
    if (cfg.nfc.enabled && items.length) {
      const k = Math.min(items.length - 1, cfg.nfc.plate | 0);
      const px = platesX(items.length, plateW, cfg.qr.gap, cx)[k] + plateW / 2;
      cut.push(circleC(px, platesTop + plateH * 0.42, (cfg.nfc.diameter + 1) / 2));
    }
    add({ id: 'panel', name: 'Panel principal', mat: 'black', contours: cut, view: 'front' });
  }

  // ---- QR plates (white) + UV print
  const pxs = platesX(items.length, plateW, cfg.qr.gap, cx);
  items.forEach((it, i) => {
    const x = pxs[i], cont = [rectC(x, platesTop, plateW, plateH, cfg.qr.corner)];
    const lf = font(cfg.qr.labelFont);
    const qs = Math.min(plateW - 14, plateH - 30);
    const qr = qrContours(it.url || ' ', x + (plateW - qs) / 2, platesTop + 7, qs);
    if (qr.moduleMM < 0.5) warnings.push(`QR ${i + 1}: módulos de ${qr.moduleMM.toFixed(2)} mm, puede costar escanearlo (acorta la URL o agranda la placa).`);
    const lab = textBlock(lf, it.label || '', { capHeight: 5.2, maxWidth: plateW - 10, tracking: 0.02, cx: x + plateW / 2, top: platesTop + 7 + qs + 4.5 });
    const sb = textBlock(lf, it.sub || '', { capHeight: 2.6, maxWidth: plateW - 14, tracking: 0.08, cx: x + plateW / 2, top: lab.bbox.y1 + 2 });
    add({
      id: 'qr' + (i + 1), name: `Placa QR ${i + 1}${it.label ? ' · ' + it.label : ''}`, mat: 'white', contours: cont, onPanel: true,
      print: [{ fill: it.color || '#111111', contours: qr.contours }, { fill: '#111111', contours: lab.glyphs.flatMap((g) => g.contours).concat(sb.glyphs.flatMap((g) => g.contours)) }],
      note: `QR → ${it.url}`,
    });
  });

  // ---- title / subtitle (white)
  if (title) {
    if (cfg.title.weld) {
      let polys = weld(title.glyphs.map((g) => g.contours));
      // auto-tighten until the letters overlap into one piece, then a bit more for solid (not tangent) joints
      if (polys.length > 1 && cfg.title.autoJoin !== false) {
        for (let tr = cfg.title.tracking - 0.01; tr >= -0.16; tr -= 0.01) {
          const t2 = textBlock(font(cfg.title.font), cfg.title.text, { height: cfg.title.height, maxWidth: cfg.title.maxWidth, tracking: tr, cx, top: title.bbox.y0 });
          const p2 = weld(t2.glyphs.map((g) => g.contours));
          if (p2.length === 1) {
            const t3 = textBlock(font(cfg.title.font), cfg.title.text, { height: cfg.title.height, maxWidth: cfg.title.maxWidth, tracking: tr - 0.015, cx, top: title.bbox.y0 });
            const p3 = weld(t3.glyphs.map((g) => g.contours));
            if (p3.length === 1) { title = t3; polys = p3; } else { title = t2; polys = p2; }
            break;
          }
        }
      }
      if (polys.length > 1) warnings.push(`«${cfg.title.text}» quedó en ${polys.length} piezas (baja el espaciado para unirlas en una sola).`);
      polys.forEach((cs, i) => add({ id: 'title' + (polys.length > 1 ? i + 1 : ''), name: polys.length > 1 ? `Título · pieza ${i + 1}` : `Título «${cfg.title.text}»`, mat: 'white', contours: cs, onPanel: true }));
    } else title.glyphs.forEach((g, i) => add({ id: 'title_' + i, name: `Título · letra ${g.ch}`, mat: 'white', contours: g.contours, onPanel: true }));
  }
  if (sub) sub.glyphs.forEach((g, i) => add({ id: 'sub_' + i, name: `Subtítulo · letra ${g.ch}`, mat: 'white', contours: g.contours, onPanel: true }));

  // ---- icon (white pieces + black heart / inlays)
  if (icon) {
    for (const p of icon.pieces) add({ id: 'icon_' + p.key, name: p.name, mat: 'white', contours: p.contours, onPanel: true });
    if (icon.heart && cfg.icon.heart) add({ id: 'heart', name: 'Corazón', mat: 'black', contours: [icon.heart], onPanel: true, overWhite: true });
    (icon.inlays || []).forEach((cs, i) => add({ id: 'inlay' + i, name: `Logo · detalle negro ${i + 1}`, mat: 'black', contours: cs, onPanel: true, overWhite: true }));
  }

  // ---- base layout (top view): x 0..W, y 0..D, y = D is the front edge
  const D = cfg.depth;
  const slots = [];
  const fFront = cfg.cards.frontOffset;
  const fPanel = cfg.cards.enabled ? fFront + tW + cfg.cards.depth : D * 0.45;
  const Y = (f) => D - f;
  const px0 = (W - panelW) / 2;
  for (const tx of tabX) slots.push({ x: px0 + tx - (tabs.panel + cl) / 2, y: Y(fPanel + tB) - cl / 2, w: tabs.panel + cl, h: tB + cl, what: 'panel' });

  if (cfg.cards.enabled) {
    const inner = cfg.cards.cardW + 2;
    const fw = inner + 2 * tB, fh = cfg.cards.height;
    const fx = (W - fw) / 2;
    // front (white) with two tabs
    {
      const tx = [fw * 0.25, fw * 0.75];
      const ring = [[0, -fh], [fw, -fh], [fw, 0]], rad = [3, 3, 0];
      for (const t of [...tx].reverse()) { const a = t + tabs.front / 2, b = t - tabs.front / 2; ring.push([a, 0], [a, tB], [b, tB], [b, 0]); rad.push(0, 0.4, 0.4, 0); }
      ring.push([0, 0]); rad.push(0);
      const front = add({ id: 'cardFront', name: 'Frente porta tarjetas', mat: 'white', contours: [roundPoly(ring, rad)], print: [], cardFront: { x: (panelW - fw) / 2, w: fw, h: fh } });
      for (const t of tx) slots.push({ x: fx + t - (tabs.front + cl) / 2, y: Y(fFront + tW) - cl / 2, w: tabs.front + cl, h: tW + cl, what: 'front' });
      if (cfg.cards.print) front.print = cardPrint(fw, fh);
    }
    // sides (black, x2): depth × height, tab along the depth
    {
      const d = cfg.cards.depth, h = cfg.cards.height, m = d / 2;
      const ring = [[0, 0], [0, -h], [d, -h], [d, 0], [m + tabs.side / 2, 0], [m + tabs.side / 2, tB], [m - tabs.side / 2, tB], [m - tabs.side / 2, 0]];
      add({ id: 'cardSide', name: 'Lateral porta tarjetas', mat: 'black', qty: 2, contours: [roundPoly(ring, [0, 4, 0, 0, 0, 0.4, 0.4, 0])] });
      for (const sx of [fx + tB / 2, fx + fw - tB / 2]) slots.push({ x: sx - (tB + cl) / 2, y: Y(fFront + tW + m + tabs.side / 2) - cl / 2, w: tB + cl, h: tabs.side + cl, what: 'side' });
    }
  }
  if (cfg.braces.enabled) {
    const { h, d } = cfg.braces, m = d / 2, tb = tabs.brace;
    const c = [['M', 0, 0], ['L', 0, -h], ['L', 6, -h], ['A', d - 6, h - 6, 0, 0, 0, d, -6], ['L', d, 0], ['L', m + tb / 2, 0], ['L', m + tb / 2, tB], ['L', m - tb / 2, tB], ['L', m - tb / 2, 0], ['Z']];
    add({ id: 'brace', name: 'Pestaña trasera (soporte)', mat: 'black', qty: 2, contours: [c] });
    for (const bx of [px0 + panelW * 0.12, px0 + panelW * 0.88]) slots.push({ x: bx - (tB + cl) / 2, y: Y(fPanel + tB + m + tb / 2) - cl / 2, w: tB + cl, h: tb + cl, what: 'brace' });
  }
  add({ id: 'baseTop', name: 'Base superior (con ranuras)', mat: 'black', contours: [rectC(0, 0, W, D, cfg.baseCorner), ...slots.map((s) => rectC(s.x, s.y, s.w, s.h, 0))] });
  add({ id: 'baseBottom', name: 'Base inferior', mat: 'black', contours: [rectC(0, 0, W, D, cfg.baseCorner)] });

  // ---- gluing jig: panel outline with windows where the front pieces go (cardboard / MDF)
  if (cfg.jig.enabled) {
    const panel = pieces.find((p) => p.id === 'panel');
    const windows = [];
    for (const p of pieces) if (p.onPanel && !p.overWhite) windows.push(...outerContours(p.contours));
    add({ id: 'jig', name: 'Plantilla de pegado (cartón/MDF)', mat: 'jig', contours: [panel.contours[0], ...windows] });
  }

  // ---- quality control: thin parts / loose islands
  for (const p of pieces) {
    if (p.mat === 'jig' || p.id === 'baseTop' || p.id === 'panel') continue;
    const q = thinCheck(p.contours, 0.6);
    p.qc = q;
    if (q.thin) warnings.push(`«${p.name}» tiene zonas más delgadas que 1.2 mm.`);
  }
  for (const p of pieces) p.size = bbox(p.contours);

  const model = { cfg, pieces, warnings, slots, layout: { panelW, panelH, platesTop, platesBottom, shoulder, fPanel, fFront, pxs, plateW, plateH } };

  function cardPrint(fw, fh) {
    // logo printed (UV) on the card-holder front: small icon + title + subtitle
    const out = [];
    const ih = fh * 0.36, top = 5;
    const mini = cfg.icon.type === 'cube' ? cubeIcon(fw / 2, -fh + top + ih, ih, 2 * (ih / cfg.icon.height) * 1.6) : null;
    if (mini) {
      out.push({ fill: '#111111', contours: [roundPoly(offsetConvex(mini.hull, 0.9), 0.6)] });
      out.push({ fill: '#ffffff', contours: mini.pieces.flatMap((p) => p.contours) });
      out.push({ fill: '#111111', contours: [mini.heart] });
    }
    const t1 = cfg.title.text.trim() ? textBlock(font(cfg.title.font), cfg.title.text, { height: fh * 0.2, maxWidth: fw * 0.62, tracking: cfg.title.tracking, cx: fw / 2, top: -fh + top + (mini ? ih + 2.5 : 8) }) : null;
    if (t1) out.push({ fill: '#111111', contours: t1.glyphs.flatMap((g) => g.contours) });
    if (cfg.subtitle.text.trim()) {
      const t2 = textBlock(font(cfg.subtitle.font), cfg.subtitle.text, { capHeight: fh * 0.055, maxWidth: fw * 0.5, tracking: cfg.subtitle.tracking, cx: fw / 2, top: (t1 ? t1.bbox.y1 : -fh / 2) + 1.4 });
      out.push({ fill: '#111111', contours: t2.glyphs.flatMap((g) => g.contours) });
    }
    return out;
  }
  return model;
}

function platesX(n, w, gap, cx) {
  const total = n * w + (n - 1) * gap;
  return Array.from({ length: n }, (_, i) => cx - total / 2 + i * (w + gap));
}

// Contours that are not inside another contour of the same piece.
export function outerContours(cs) {
  const rings = cs.map((c) => flatten(c, 0.1));
  return cs.filter((c, i) => !rings.some((r, j) => j !== i && inRing(rings[i][0][0], rings[i][0][1], r)));
}

// Rasterises a piece (10 px/mm, even-odd) and erodes by r mm: if parts vanish or split, it has necks/strokes < 2r.
export function thinCheck(cs, r = 0.6, ppm = 10) {
  const bb = bbox(cs), pad = 4;
  const W = Math.ceil(bb.w * ppm) + pad * 2, H = Math.ceil(bb.h * ppm) + pad * 2;
  if (W * H > 6e6) return { thin: false, skipped: true };
  const m = new Uint8Array(W * H);
  const rings = cs.map((c) => flatten(c, 0.02).map((p) => [(p[0] - bb.x0) * ppm + pad, (p[1] - bb.y0) * ppm + pad]));
  for (let y = 0; y < H; y++) {
    const sy = y + 0.5, xs = [];
    for (const R of rings) for (let i = 0, j = R.length - 1; i < R.length; j = i++) {
      const [xi, yi] = R[i], [xj, yj] = R[j];
      if ((yi > sy) !== (yj > sy)) xs.push(xi + ((sy - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(W - 1, Math.floor(xs[k + 1] - 0.5)); x++) m[y * W + x] = 1;
  }
  const before = components(m, W, H).comps.length;
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1;
  const d = edt(inv, W, H);
  const er = new Uint8Array(W * H);
  for (let i = 0; i < er.length; i++) er[i] = d[i] > r * ppm ? 1 : 0;
  const after = components(er, W, H).comps.length;
  return { thin: after !== before, before, after };
}

// ------------------------------------------------------------------ nesting on sheets (shelf packing)
export function nest(model, mat) {
  const { w: SW, h: SH, gap, margin } = model.cfg.sheet;
  const list = [];
  for (const p of model.pieces) if (p.mat === mat) for (let q = 0; q < p.qty; q++) {
    let cs = p.contours, bb = bbox(cs), rot = false;
    // landscape orientation packs best on shelves; rotate only if it still fits the sheet
    if (bb.h > bb.w * 1.15 && bb.h <= SW - 2 * margin) { cs = rot90(cs); bb = bbox(cs); rot = true; }
    list.push({ piece: p, n: q + 1, cs: translate(cs, -bb.x0, -bb.y0), w: bb.w, h: bb.h, rot });
  }
  list.sort((a, b) => b.h - a.h || b.w - a.w);
  const sheets = [];
  let sheet = null, x = 0, y = 0, shelfH = 0;
  const newSheet = () => { sheet = { items: [] }; sheets.push(sheet); x = margin; y = margin; shelfH = 0; };
  for (const it of list) {
    if (it.w > SW - 2 * margin || it.h > SH - 2 * margin) { model.warnings.push(`«${it.piece.name}» no cabe en la lámina de ${SW}×${SH} mm.`); }
    if (!sheet) newSheet();
    if (x + it.w > SW - margin) { x = margin; y += shelfH + gap; shelfH = 0; }
    if (y + it.h > SH - margin) { newSheet(); }
    sheet.items.push({ ...it, x, y, cs: translate(it.cs, x, y) });
    x += it.w + gap; shelfH = Math.max(shelfH, it.h);
  }
  for (const s of sheets) {
    let ux = 0, uy = 0;
    for (const it of s.items) { ux = Math.max(ux, it.x + it.w); uy = Math.max(uy, it.y + it.h); }
    s.used = { w: ux + margin, h: uy + margin };
  }
  return sheets;
}

// ------------------------------------------------------------------ SVG output
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const idOf = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
const svgOpen = (w, h, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${f3(w)}mm" height="${f3(h)}mm" viewBox="0 0 ${f3(w)} ${f3(h)}"${extra}>\n`;
export const CUT_STYLE = 'fill="none" stroke="#ff0000" stroke-width="0.01"';

export const MATERIALS = (cfg) => ({
  white: `${cfg.white.label} ${cfg.white.t} mm`,
  black: `${cfg.black.label} ${cfg.black.t} mm`,
  jig: 'Plantilla de pegado (cartón o MDF 3 mm)',
});

// One SVG per sheet: red hairline cut lines, one path (compound) per piece.
export function cutSVGs(model, mat) {
  const { w, h } = model.cfg.sheet;
  return nest(model, mat).map((s, i) => {
    let o = svgOpen(w, h);
    o += `<g id="CORTE_${idOf(MATERIALS(model.cfg)[mat])}_lamina_${i + 1}">\n`;
    for (const it of s.items) o += `<path id="${idOf(it.piece.id)}_${it.n}" ${CUT_STYLE} d="${contoursD(it.cs)}"><title>${esc(it.piece.name)}</title></path>\n`;
    o += '</g>\n</svg>\n';
    return { name: `${idOf(model.cfg.name)}_corte_${mat}_${i + 1}.svg`, svg: o, sheet: s };
  });
}

// UV print sheet: every white piece with print art, at 1:1, outline in cyan as a reference (not printed).
export function printSVG(model) {
  const list = model.pieces.filter((p) => p.print?.length);
  const gap = 10;
  let x = 10, H = 0;
  const parts = [];
  for (const p of list) {
    const bb = bbox(p.contours), dx = x - bb.x0, dy = 10 - bb.y0;
    let g = `<g id="IMPRESION_${idOf(p.id)}">\n<path fill="#ffffff" stroke="#00aeef" stroke-width="0.1" d="${contoursD(translate(p.contours, dx, dy))}"/>\n`;
    for (const layer of p.print) g += `<path fill="${layer.fill}" fill-rule="nonzero" d="${contoursD(translate(layer.contours, dx, dy))}"/>\n`;
    parts.push(g + '</g>\n');
    x += bb.w + gap; H = Math.max(H, bb.h);
  }
  return svgOpen(x, H + 20) + parts.join('') + '</svg>\n';
}

// Assembled front view + base top view (slots and footprints), colours as the real materials.
export function assemblySVG(model) {
  const { cfg, layout: L } = model;
  const W = cfg.width, D = cfg.depth, tB = cfg.black.t, panelW = L.panelW;
  const blk = cfg.black.color, wht = cfg.white.color, edge = '#9aa0a6';
  const ox = 20 + (W - panelW) / 2, oy = 20 + L.panelH;
  const P = (cs) => contoursD(translate(cs, ox, oy));
  let o = '';
  o += `<g id="VISTA_FRONTAL">\n`;
  const byId = (id) => model.pieces.find((p) => p.id === id);
  o += `<path fill="${blk}" fill-rule="evenodd" d="${P(byId('panel').contours)}"/>\n`;
  for (const p of model.pieces.filter((q) => q.onPanel && !q.overWhite)) {
    o += `<path fill="${wht}" stroke="${edge}" stroke-width="0.15" fill-rule="evenodd" d="${P(p.contours)}"/>\n`;
    for (const layer of p.print) o += `<path fill="${layer.fill}" d="${P(layer.contours)}"/>\n`;
  }
  for (const p of model.pieces.filter((q) => q.overWhite)) o += `<path fill="${blk}" d="${P(p.contours)}"/>\n`;
  const cf = byId('cardFront');
  if (cf) {
    const { x } = cf.cardFront;
    o += `<path fill="${wht}" stroke="${edge}" stroke-width="0.15" d="${P(translate(cf.contours, x, 0))}"/>\n`;
    for (const layer of cf.print) o += `<path fill="${layer.fill}" d="${P(translate(layer.contours, x, 0))}"/>\n`;
  }
  o += `<rect x="20" y="${f3(oy)}" width="${f3(W)}" height="${f3(2 * tB)}" rx="1" fill="${blk}"/>\n`;
  o += `</g>\n`;
  // top view of the base
  const tx = 20 + W + 30, ty = 20 + L.panelH - D;
  o += `<g id="VISTA_SUPERIOR_BASE">\n<path fill="${blk}" fill-rule="evenodd" d="${contoursD(translate(byId('baseTop').contours, tx, ty))}"/>\n`;
  const lab = { panel: 'panel', front: 'frente', side: 'lateral', brace: 'soporte' };
  for (const s of model.slots) o += `<rect x="${f3(tx + s.x)}" y="${f3(ty + s.y)}" width="${f3(s.w)}" height="${f3(s.h)}" fill="#ff9f1c"><title>${lab[s.what]}</title></rect>\n`;
  o += `</g>\n`;
  // parts list
  const M = MATERIALS(cfg);
  let ly = 20 + L.panelH + 20;
  const lines = [`${cfg.name} — ${W} × ${cfg.height} × ${D} mm`, ''];
  for (const mat of ['white', 'black', 'jig']) {
    const ps = model.pieces.filter((p) => p.mat === mat);
    if (!ps.length) continue;
    lines.push(M[mat] + ':');
    for (const p of ps) lines.push(`   ${p.qty > 1 ? p.qty + '× ' : ''}${p.name}  ${p.size.w.toFixed(1)} × ${p.size.h.toFixed(1)} mm`);
  }
  if (model.warnings.length) { lines.push('', 'Avisos:'); for (const w of model.warnings) lines.push('   • ' + w); }
  o += `<g id="LISTA_PIEZAS" font-family="Arial" font-size="4" fill="#222">\n`;
  for (const l of lines) { o += `<text x="20" y="${f3(ly)}">${esc(l)}</text>\n`; ly += 5.5; }
  o += '</g>\n';
  return svgOpen(tx + byId('baseTop').size.w + 20, ly + 10) + `<rect width="100%" height="100%" fill="#f4f4f6"/>\n` + o + '</svg>\n';
}

// All files for a job.
export function exportAll(model) {
  const files = [];
  for (const mat of ['white', 'black', 'jig']) if (model.pieces.some((p) => p.mat === mat)) files.push(...cutSVGs(model, mat));
  files.push({ name: `${idOf(model.cfg.name)}_impresion_UV.svg`, svg: printSVG(model) });
  files.push({ name: `${idOf(model.cfg.name)}_ensamble.svg`, svg: assemblySVG(model) });
  return files;
}

export function summary(model) {
  const M = MATERIALS(model.cfg);
  const out = {};
  for (const p of model.pieces) {
    const k = M[p.mat];
    out[k] ??= { pieces: 0, sheets: 0 };
    out[k].pieces += p.qty;
  }
  for (const mat of ['white', 'black', 'jig']) { const k = M[mat]; if (out[k]) out[k].sheets = nest(model, mat).length; }
  return out;
}

// Hablador (table sign / photobooth stand) in laser-cut acrylic: parametric generator. Pure JS, no DOM.
// Every outline is built from exact lines, circular fillets (SVG arcs) and font Béziers, so the cut files have
// no stair steps, spikes or hairlines. Slots are sized from the real acrylic thickness + fit adjustment
// (negative = press fit: −0.2 turns a 3 mm sheet into a 2.8 mm slot so the joint does not wobble).
// source 'mockup': the front (panel silhouette, white pieces, print) comes from analyzeMockup(); the structure
// (base, slots, supports, card holder) is still built here from the measurements and calibres.
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
  width: 170, height: 250, depth: 80,   // overall (= base width × total height × base depth)
  panelWidth: 148,                      // black back panel, narrower than the base
  // t = calibre (mm), sheet = size of the sheet each material is cut from
  white: { t: 4, label: 'Acrílico blanco', color: '#ffffff', sheet: { w: 120, h: 300 } },
  black: { t: 3, label: 'Acrílico negro', color: '#16161a', sheet: { w: 450, h: 300 } },
  clearance: -0.2,       // fit adjustment added to every slot size (negative = press fit, e.g. 3 mm → 2.8 mm slot)
  source: 'param',       // 'param' (form) | 'mockup' (front traced from a frontal image, see hablador_mockup.js)
  traced: null,
  // roof: eave heights as a fraction of the panel height, slopes rising towards the icon (asymmetric house)
  roof: { left: 0.717, right: 0.857, leftSlope: 0.45, rightSlope: 0.57, eaveCorner: 8 },
  panelCorner: 4,
  baseCorner: 5,
  border: 4,             // black outline around the top icon (from the white edge)
  title: { enabled: true, text: 'LOVECUBE', font: 'Montserrat ExtraBold', height: 14.6, maxWidth: 112, tracking: 0, weld: false, gapTop: 7.3 },
  subtitle: { enabled: true, text: 'PHOTOBOOTH', font: 'Montserrat Black', capHeight: 5.4, width: 95, tracking: 0.6, gapTop: 5.2 },
  qr: {
    // split: offset of the gap between 2 plates from the V; slopeL/slopeR: rise of each plate top away from the V
    enabled: true, w: 0, h: 71.4, corner: 4, gap: 5, side: 6.8, topGap: 6, split: 4.2, slopeL: 0.215, slopeR: 0.415, margin: 6, labelFont: 'Montserrat Black',
    items: [
      { label: 'ESCRÍBENOS', sub: 'POR WHATSAPP', url: 'https://wa.me/573000000000', color: '#22b33a', color2: '', badge: 'whatsapp' },
      { label: 'SÍGUENOS', sub: 'EN INSTAGRAM', url: 'https://instagram.com/lovecube.photobooth', color: '#ff7a1a', color2: '#e8127c', badge: 'instagram' },
    ],
  },
  nfc: { enabled: false, diameter: 25, plate: 0 },
  cards: { enabled: true, cardW: 90, frontW: 115, height: 40, sideH: 32, depth: 28, frontOffset: 10, print: true },
  icon: { type: 'cube', height: 82.1, heart: true, offsetX: -7.1, custom: null },
  braces: { enabled: true, h: 50, d: 30 },
  jig: { enabled: true },
  sheet: { w: 600, h: 400, gap: 2, margin: 3 },   // jig sheet; gap (between pieces) and margin (sheet edge) for every sheet
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
function textBlock(font, text, { capHeight, height, maxWidth, width, tracking = 0, cx = 0, top = null, bottom = null }) {
  let size = capHeight ? capHeight / capHeightRatio(font) : 100;
  if (width && [...String(text)].length > 1) {
    // solve the letter spacing so the ink spans exactly `width` (size fixed by capHeight)
    let lo = -0.2, hi = 3;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2, w = bbox(layoutText(font, text, size, mid).flatMap((g) => g.contours)).w;
      if (w > width) hi = mid; else lo = mid;
    }
    tracking = (lo + hi) / 2;
  }
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
const simplifyRing = (pts) => { let r = pts; for (let k = 0; k < 3; k++) r = r.filter((p, i) => { const a = r[(i - 1 + r.length) % r.length], c = r[(i + 1) % r.length]; const cr = (p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0]); return Math.hypot(p[0] - a[0], p[1] - a[1]) > 0.05 && Math.abs(cr) > 1e-6; }); return r; };
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
// Partition traced from the LOVECUBE front view (y-up, mm, bottom vertex of the box at the origin, 84 mm tall
// at scale 1): two box faces forming a V and a tilted card coming out of the box. Pieces are inset by gap/2 so
// the black panel shows between them as clean lines.
// White pieces measured on the target (origin = the V centre line, y up, mm at scale 1, 82.1 mm tall); the
// black panel shows ≈2.6 mm between them. "lid" is the flap of the box seen between the card and the right face.
const CUBE_ICON = {
  faceL: [[-33.9, 14.5], [-1.7, 0.4], [-1.7, 30.6], [-33.9, 45.0]],
  faceR: [[1.7, 1.1], [32.7, 17.9], [32.7, 47.6], [1.7, 31.2]],
  card: [[-5.0, 40.2], [32.7, 51.5], [32.7, 82.1], [-5.0, 70.3]],
  lid: [[-5.3, 34.8], [-0.47, 32.65], [32.7, 48.75], [32.7, 50.35], [-5.3, 37.5]],  // ≥1.6 mm wide at its tip
  heart: { x: 11.4, y: 61.9, w: 9.5 },
  h: 82.1,
};

function cubeIcon(vx, vy, height, rIn = 1) {
  const k = height / CUBE_ICON.h;
  const T = (p) => [vx + p[0] * k, vy - p[1] * k];
  const names = { faceL: 'Ícono · cara izquierda', faceR: 'Ícono · cara derecha', card: 'Ícono · tarjeta', lid: 'Ícono · tapa' };
  const pieces = Object.keys(names).map((key) => {
    const pts = CUBE_ICON[key].map(T);
    return { key, name: names[key], contours: [roundPoly(pts, key === 'lid' ? Math.min(rIn, 0.5 * k) : rIn * Math.min(1, k * 2))], pts };
  });
  const hp = T([CUBE_ICON.heart.x, CUBE_ICON.heart.y]);
  return { pieces, heart: heartC(hp[0], hp[1], CUBE_ICON.heart.w * k), hull: convexHull(pieces.flatMap((p) => p.pts)), k };
}

// ------------------------------------------------------------------ QR (vector, horizontal runs merged)
// badge: clears a centred square of whole modules (error correction H) for a small printed icon.
function qrContours(text, x, y, size, badge = false) {
  const m = qrMatrix(text, badge ? 'H' : 'M'), n = m.n, s = size / n, cs = [];
  let b0 = n, b1 = -1;
  if (badge) { let bm = Math.round(n * 0.27); if (bm % 2 !== n % 2) bm++; b0 = (n - bm) / 2; b1 = b0 + bm; }
  const hole = (r, c) => r >= b0 && r < b1 && c >= b0 && c < b1;
  for (let r = 0; r < n; r++) {
    let c0 = -1;
    for (let c = 0; c <= n; c++) {
      const on = c < n && m.isDark(r, c) && !hole(r, c);
      if (on && c0 < 0) c0 = c;
      if (!on && c0 >= 0) { cs.push(rectC(x + c0 * s, y + r * s, (c - c0) * s, s)); c0 = -1; }
    }
  }
  return { contours: cs, modules: n, moduleMM: s, badge: badge ? { cx: x + size / 2, cy: y + size / 2, size: (b1 - b0) * s } : null };
}

// Small generic social icons printed in the middle of the QR (print layer, even-odd fill).
const ringOf = (c, tol = 0.01) => toRing(flatten(c, tol));
const polysToContours = (mp) => mp.flatMap((poly) => poly.map((ring) => [['M', ...ring[0]], ...ring.slice(1, -1).map((p) => ['L', ...p]), ['Z']]));
function badgeContours(type, cx, cy, size) {
  const a = size * 0.86;
  if (type === 'instagram') {
    const t = a * 0.11;
    return [rectC(cx - a / 2, cy - a / 2, a, a, a * 0.28), rectC(cx - a / 2 + t, cy - a / 2 + t, a - 2 * t, a - 2 * t, a * 0.28 - t),
      circleC(cx, cy, a * 0.235), circleC(cx, cy, a * 0.235 - t), circleC(cx + a * 0.25, cy - a * 0.25, a * 0.065)];
  }
  if (type === 'whatsapp') {
    // speech-bubble ring with a tail + handset
    const R = a * 0.44, t = a * 0.085;
    const outer = [ringOf(circleC(cx, cy, R))];
    const tail = [[[cx - R * 0.62, cy + R * 0.55], [cx - R * 1.08, cy + R * 1.08], [cx - R * 0.18, cy + R * 0.9], [cx - R * 0.62, cy + R * 0.55]]];
    const ring = polygonClipping.difference(polygonClipping.union([outer], [tail]), [[ringOf(circleC(cx, cy, R - t))]]);
    // handset: thick arc around the bubble centre with rounded ends, rotated so it reads like a phone
    const r0 = R * 0.42, r1 = R * 0.62, A0 = (100 * Math.PI) / 180, A1 = (215 * Math.PI) / 180, steps = 40;
    const arc = [];
    for (let i = 0; i <= steps; i++) { const A = A0 + ((A1 - A0) * i) / steps; arc.push([cx + R * 0.08 + r1 * Math.cos(A), cy - R * 0.08 + r1 * Math.sin(A)]); }
    for (let i = steps; i >= 0; i--) { const A = A0 + ((A1 - A0) * i) / steps; arc.push([cx + R * 0.08 + r0 * Math.cos(A), cy - R * 0.08 + r0 * Math.sin(A)]); }
    arc.push(arc[0]);
    const end = (A) => ringOf(circleC(cx + R * 0.08 + ((r0 + r1) / 2) * Math.cos(A) * 1.04, cy - R * 0.08 + ((r0 + r1) / 2) * Math.sin(A) * 1.04, (r1 - r0) * 0.78));
    const phone = polygonClipping.union([[arc]], [[end(A0)]], [[end(A1)]]);
    return polysToContours(polygonClipping.union(ring, phone));
  }
  return [];
}

// ------------------------------------------------------------------ build
// fonts: { [family]: opentype.Font }  (loaded by the caller: fs in Node, fetch in the app)
// Panel space: x 0..panelW, y = 0 at the base top, y < 0 upwards. "h" values below are heights above the base top.
export function buildHablador(cfgIn, fonts) {
  const cfg = cfgIn;
  const tW = cfg.white.t, tB = cfg.black.t, cl = cfg.clearance;
  const warnings = [];
  const font = (fam) => fonts[fam] || fonts[Object.keys(fonts)[0]];
  const baseStack = 2 * tB;
  const panelH = cfg.height - baseStack;
  const T = cfg.source === 'mockup' && cfg.traced?.panel ? cfg.traced : null;
  const kM = T ? panelH / T.panelH : 1;   // traced front follows later changes of the total height
  const W = cfg.width, panelW = T ? T.panelW * kM : Math.min(cfg.panelWidth || W - 2, W), cx = panelW / 2;
  if (T && panelW > W) warnings.push(`El panel del mockup mide ${panelW.toFixed(1)} mm de ancho y la base ${W} mm: sube el largo o baja el alto.`);
  const pieces = [];
  const add = (p) => { const q = { qty: 1, print: [], onPanel: false, ...p }; pieces.push(q); return q; };
  const roof = { left: 0.717, right: 0.857, leftSlope: 0.45, rightSlope: 0.57, eaveCorner: 8, ...(cfg.roof || {}) };
  const hL = roof.left * panelH, hR = roof.right * panelH;
  const roofAt = (x) => Math.min(panelH, hL + roof.leftSlope * x, hR + roof.rightSlope * (panelW - x));
  const tabs = cfg.tabs;
  const tabX = [cx - panelW * 0.3, cx + panelW * 0.3];

  // ---- panel (black) outline: roof polygon ∪ outline of the icon, every corner filleted; tabs underneath
  function panelOutline(iconRings, warn = () => {}) {
    const ring = [[0, 0]];
    for (const tx of tabX) { const a = tx - tabs.panel / 2, b = tx + tabs.panel / 2; ring.push([a, 0], [a, tB], [b, tB], [b, 0]); }
    ring.push([panelW, 0], [panelW, -hR]);
    if (iconRings.length) {
      const xs = iconRings.flat().map((p) => p[0]);
      const xr = Math.min(panelW, Math.max(...xs)), xl = Math.max(0, Math.min(...xs));
      ring.push([xr, -Math.min(panelH, hR + roof.rightSlope * (panelW - xr))], [xl, -Math.min(panelH, hL + roof.leftSlope * xl)]);
    } else {
      const xa = (hR + roof.rightSlope * panelW - hL) / (roof.leftSlope + roof.rightSlope);
      const ya = hL + roof.leftSlope * xa;
      if (ya <= panelH) ring.push([xa, -ya]);
      else ring.push([(panelH - hR) / -roof.rightSlope + panelW, -panelH], [(panelH - hL) / roof.leftSlope, -panelH]);
    }
    ring.push([0, -hL]);
    let u = polygonClipping.union([toRing(ring)], ...iconRings.map((r) => [toRing(r)]));
    if (u.length > 1) { warn('El ícono no toca el techo del panel: se usa solo la parte más grande.'); u.sort((a, b) => Math.abs(ringArea(b[0])) - Math.abs(ringArea(a[0]))); }
    const pts = simplifyRing(u[0][0].slice(0, -1));
    // orientation (sum of turns) tells convex from concave corners
    const turn = (i) => { const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length]; return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); };
    const orient = Math.sign(pts.reduce((s, _, i) => s + Math.sign(turn(i)), 0)) || 1;
    const rad = pts.map((p, i) => {
      if (p[1] > 1e-6) return 0.4;                    // tab tips
      if (p[1] > -1e-6) return 0;                     // bottom edge / tab roots
      if (Math.sign(turn(i)) !== orient) return 3;    // concave: soft inner corner
      if (Math.abs(p[0]) < 1e-6 || Math.abs(p[0] - panelW) < 1e-6) return roof.eaveCorner;
      return cfg.panelCorner + (iconRings.length ? 1 : 0);
    });
    return roundPoly(pts, rad);
  }

  // ---- front: parametric (form) or traced from the mockup. Both return the plate layout.
  const FL = T ? mockupFront() : paramFront();

  function paramFront() {
    // ---- top icon. vUp = height of its lowest point (the V of the box); iconRings = black outline behind it
    const vx = cx + (cfg.icon.offsetX || 0);
    let icon = null, iconRings = [], vUp = Math.min(hL, hR), slope = 0;
    if (cfg.icon.type === 'cube') {
      const h = Math.min(cfg.icon.height, panelH * 0.6);
      // the icon touches the top: drop it by whatever the filleted panel outline overshoots the total height
      const ringsAt = (v) => cubeIcon(vx, -v, h).pieces.map((p) => offsetConvex(p.pts, cfg.border));
      vUp = panelH - cfg.border - h;
      for (let k = 0; k < 4; k++) {
        const over = -bbox([panelOutline(ringsAt(vUp))]).y0 - panelH;
        if (Math.abs(over) < 1e-4) break;
        vUp -= over + 1e-4;
      }
      icon = cubeIcon(vx, -vUp, h);
      iconRings = icon.pieces.map((p) => offsetConvex(p.pts, cfg.border));
      slope = 1;
    } else if (cfg.icon.type === 'custom' && cfg.icon.custom?.white?.length) {
      const all = cfg.icon.custom.white.flat();
      const bb = bbox(all), k = Math.min(cfg.icon.height / bb.h, (panelW - 2 * cfg.border - 4) / bb.w);
      const top = -(panelH - cfg.border);
      const place = (cs) => translate(scaleContours(cs, k), vx - ((bb.x0 + bb.x1) / 2) * k, top - bb.y0 * k);
      icon = {
        pieces: cfg.icon.custom.white.map((cs, i) => ({ key: 'c' + i, name: `Logo · pieza ${i + 1}`, contours: place(cs) })),
        inlays: (cfg.icon.custom.black || []).map((cs) => place(cs)),
      };
      vUp = panelH - cfg.border - bb.h * k;
      const pts = icon.pieces.flatMap((p) => p.contours.flatMap((c) => flatten(c, 0.2)));
      iconRings = [offsetConvex(convexHull(pts), cfg.border)];
    }

    // ---- QR plates: each top is a straight edge parallel-ish to its side of the V (own slope), clipped under the roof.
    // Two plates are split at the V (+ qr.split); one or three are spread evenly over the panel width.
    const items = cfg.qr.enabled ? cfg.qr.items.slice(0, 3) : [];
    const n = items.length, side = cfg.qr.side ?? 6, gap = cfg.qr.gap;
    let plateW = n ? (panelW - 2 * side - (n - 1) * gap) / n : 0;
    if (n && cfg.qr.w > 0) { if (cfg.qr.w > plateW) warnings.push(`Placas QR reducidas a ${plateW.toFixed(1)} mm de ancho para caber en el panel.`); else plateW = cfg.qr.w; }
    const innerTop = (icon ? vUp : Math.min(hL, hR) - 4) - (cfg.qr.topGap ?? 5);
    const plateH = cfg.qr.h;
    const plateBottom = innerTop - plateH;
    let spans = platesX(n, plateW, gap, cx).map((xl) => [xl, xl + plateW]);
    if (n === 2 && !(cfg.qr.w > 0) && icon) {
      const sx = Math.min(panelW - side - 30, Math.max(side + 30, vx + (cfg.qr.split ?? 0)));
      spans = [[side, sx - gap / 2], [sx + gap / 2, panelW - side]];
    }
    const sL = slope ? cfg.qr.slopeL ?? 0.3 : 0, sR = slope ? cfg.qr.slopeR ?? 0.3 : 0;
    const lineL = (x) => innerTop + sL * (vx - x), lineR = (x) => innerTop + sR * (x - vx);
    const plateShapes = spans.map(([xl, xr]) => {
      const mode = xr <= vx + 3 ? 'L' : xl >= vx - 3 ? 'R' : 'V';
      const top = (x) => Math.min(mode === 'L' ? lineL(x) : mode === 'R' ? lineR(x) : x < vx ? lineL(x) : lineR(x), roofAt(x) - 6);
      const pts = [[xl, -plateBottom], [xr, -plateBottom], [xr, -top(xr)]];
      if (mode === 'V') pts.push([vx, -top(vx)]);
      pts.push([xl, -top(xl)]);
      return { xl, xr, w: xr - xl, pts, top, low: Math.min(...pts.slice(2).map((p) => -p[1])) };
    });
    const pxs = plateShapes.map((p) => p.xl);

    // ---- titles (stacked under the plates)
    let y = n ? plateBottom - (cfg.title.gapTop ?? 7.5) : innerTop;
    let title = null, sub = null;
    if (cfg.title.enabled && cfg.title.text.trim()) {
      title = textBlock(font(cfg.title.font), cfg.title.text, { height: cfg.title.height, maxWidth: Math.min(cfg.title.maxWidth, panelW - 8), tracking: cfg.title.tracking, cx, top: -y });
      y = -title.bbox.y1;
    }
    if (cfg.subtitle.enabled && cfg.subtitle.text.trim()) {
      y -= cfg.subtitle.gapTop ?? 5;
      sub = textBlock(font(cfg.subtitle.font), cfg.subtitle.text, { capHeight: cfg.subtitle.capHeight, width: cfg.subtitle.width ? Math.min(cfg.subtitle.width, panelW - 10) : 0, maxWidth: panelW - 10, tracking: cfg.subtitle.tracking, cx, top: -y });
      y = -sub.bbox.y1;
    }
    const lowest = y;
    if (cfg.cards.enabled && lowest < cfg.cards.height + 3) warnings.push(`El texto inferior queda tapado por el porta tarjetas (sube el alto del hablador o reduce textos: faltan ${(cfg.cards.height + 3 - lowest).toFixed(1)} mm).`);
    if (lowest < 5) warnings.push('El contenido no cabe en el alto del panel.');

    // ---- panel (black) + NFC hole
    {
      const cut = [panelOutline(iconRings, (w) => warnings.push(w))];
      if (cfg.nfc.enabled && n) {
        const k = Math.min(n - 1, cfg.nfc.plate | 0), ps = plateShapes[k];
        cut.push(circleC((ps.xl + ps.xr) / 2, -(plateBottom + (ps.low - plateBottom) * 0.55), (cfg.nfc.diameter + 1) / 2));
      }
      add({ id: 'panel', name: 'Panel principal', mat: 'black', contours: cut, view: 'front' });
    }

    // ---- QR plates (white) + UV print
    items.forEach((it, i) => {
      const ps = plateShapes[i], x = ps.xl, pw = ps.w, pcx = x + pw / 2;
      const cont = [roundPoly(ps.pts, cfg.qr.corner)];
      const lf = font(cfg.qr.labelFont);
      // bottom-up: subtitle, label, then the biggest square QR that keeps qr.margin to the sides and 4 mm to the top
      const sb = textBlock(lf, it.sub || '', { capHeight: 2.6, width: Math.min(38.5, pw - 12), maxWidth: pw - 12, tracking: 0.04, cx: pcx, bottom: -(plateBottom + 6.2) });
      const lab = textBlock(lf, it.label || '', { capHeight: 4.8, maxWidth: pw - 8, tracking: 0.0, cx: pcx, bottom: (it.sub ? sb.bbox.y0 : -(plateBottom + 6.2)) - (it.sub ? 2.2 : 0) });
      const qrBottom = (it.label ? -lab.bbox.y0 : it.sub ? -sb.bbox.y0 : plateBottom + 1.5) + 2.8;
      let qs = pw - 2 * (cfg.qr.margin ?? 6);
      for (let k = 0; k < 3; k++) {
        const xs = [pcx - qs / 2, pcx + qs / 2]; if (vx > xs[0] && vx < xs[1]) xs.push(vx);
        qs = Math.max(10, Math.min(pw - 2 * (cfg.qr.margin ?? 6), Math.min(...xs.map(ps.top)) - 4 - qrBottom));
      }
      const qy = -(qrBottom + qs);
      const badge = it.badge && it.badge !== 'none';
      const qr = qrContours(it.url || ' ', pcx - qs / 2, qy, qs, badge);
      if (qr.moduleMM < 0.5) warnings.push(`QR ${i + 1}: módulos de ${qr.moduleMM.toFixed(2)} mm, puede costar escanearlo (acorta la URL o agranda la placa).`);
      const qrLayer = { fill: it.color || '#111111', grad: it.color2 ? [it.color || '#111111', it.color2] : null, contours: qr.contours };
      const print = [qrLayer];
      if (qr.badge) print.push({ ...qrLayer, evenodd: true, contours: badgeContours(it.badge, qr.badge.cx, qr.badge.cy, qr.badge.size) });
      print.push({ fill: '#111111', contours: lab.glyphs.flatMap((g) => g.contours).concat(sb.glyphs.flatMap((g) => g.contours)) });
      add({ id: 'qr' + (i + 1), name: `Placa QR ${i + 1}${it.label ? ' · ' + it.label : ''}`, mat: 'white', contours: cont, onPanel: true, print, note: `QR → ${it.url}` });
    });
    const platesTop = n ? -Math.max(...plateShapes.flatMap((p) => p.pts.map((q) => -q[1]))) : -innerTop, platesBottom = -plateBottom;

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
    return { platesTop, platesBottom, pxs, plateW, plateWs: plateShapes.map((p) => p.w), plateH };
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
    const fw = Math.min(Math.max(cfg.cards.frontW || 0, cfg.cards.cardW + 2), W - 2 * tB - 4), fh = cfg.cards.height;
    const fx = (W - fw) / 2;
    // front (white) with two tabs
    {
      const tx = [fw * 0.25, fw * 0.75];
      const ring = [[0, -fh], [fw, -fh], [fw, 0]], rad = [4, 4, 0];
      for (const t of [...tx].reverse()) { const a = t + tabs.front / 2, b = t - tabs.front / 2; ring.push([a, 0], [a, tB], [b, tB], [b, 0]); rad.push(0, 0.4, 0.4, 0); }
      ring.push([0, 0]); rad.push(0);
      const front = add({ id: 'cardFront', name: 'Frente porta tarjetas', mat: 'white', contours: [roundPoly(ring, rad)], print: [], cardFront: { x: (panelW - fw) / 2, w: fw, h: fh } });
      for (const t of tx) slots.push({ x: fx + t - (tabs.front + cl) / 2, y: Y(fFront + tW) - cl / 2, w: tabs.front + cl, h: tW + cl, what: 'front' });
      if (cfg.cards.print) front.print = T?.card?.print?.length ? fitPrint(T.card, fw, fh) : cardPrint(fw, fh);
    }
    // sides (black, x2) glued against the ends of the front, from the front face back to the panel; tab along the depth
    {
      const d = tW + cfg.cards.depth, h = Math.min(cfg.cards.sideH || fh, fh), m = d / 2;
      const ring = [[0, 0], [0, -h], [d, -h], [d, 0], [m + tabs.side / 2, 0], [m + tabs.side / 2, tB], [m - tabs.side / 2, tB], [m - tabs.side / 2, 0]];
      add({ id: 'cardSide', name: 'Lateral porta tarjetas', mat: 'black', qty: 2, contours: [roundPoly(ring, [0, 4, 0, 0, 0, 0.4, 0.4, 0])], cardSide: { h } });
      for (const sx of [fx - tB / 2, fx + fw + tB / 2]) slots.push({ x: sx - (tB + cl) / 2, y: Y(fFront + m + tabs.side / 2) - cl / 2, w: tB + cl, h: tabs.side + cl, what: 'side' });
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

  const model = { cfg, pieces, warnings, slots, layout: { panelW, panelH, fPanel, fFront, ...FL } };

  function fitPrint(card, fw, fh) {
    // traced card-front print scaled into the real front (bottom-anchored, centred)
    const k = Math.min(fw / card.w, fh / card.h), dx = (fw - card.w * k) / 2, dy = -(fh - card.h * k) / 2;
    return card.print.map((l) => ({ ...l, contours: scaleContours(l.contours, k, dx, dy) }));
  }

  function mockupFront() {
    const S = (cs) => scaleContours(cs, kM);
    // panel: traced silhouette cut flat at the base top, tabs added underneath, refit as smooth curves
    const sil = polygonClipping.intersection([toRing(flatten(S([T.panel])[0], 0.02))], [[[-1e4, -1e4], [1e4, -1e4], [1e4, 0], [-1e4, 0], [-1e4, -1e4]]]);
    const tabP = tabX.map((tx) => { const a = tx - tabs.panel / 2, b = tx + tabs.panel / 2; return [[[a, -0.5], [b, -0.5], [b, tB], [a, tB], [a, -0.5]]]; });
    const u = polygonClipping.union(sil, ...tabP).sort((a, b) => Math.abs(ringArea(b[0])) - Math.abs(ringArea(a[0])));
    if (u.length > 1) warnings.push('Las pestañas del panel quedan fuera de su borde inferior (revisa el mockup).');
    const cut = [pathToContour(cubicsToPath(fitClosed(u[0][0].slice(0, -1), { tol: 0.03, cornerDeg: 40 })))];

    const items = cfg.qr.enabled ? cfg.qr.items : [];
    const lf = font(cfg.qr.labelFont);
    const boxes = [];
    let np = 0;
    T.pieces.forEach((tp, i) => {
      const contours = S(tp.contours);
      if (tp.kind !== 'plate') { add({ id: 'm' + i, name: tp.name, mat: 'white', contours, onPanel: true, print: (tp.print || []).map((l) => ({ ...l, contours: S(l.contours) })) }); return; }
      const it = items[np] || {}, print = [];
      np++;
      const qy1 = (tp.qr.y + tp.qr.size) * kM;
      if (items.length >= np) {
        const badge = it.badge && it.badge !== 'none';
        const qr = qrContours(it.url || ' ', tp.qr.x * kM, tp.qr.y * kM, tp.qr.size * kM, badge);
        if (qr.moduleMM < 0.5) warnings.push(`QR ${np}: módulos de ${qr.moduleMM.toFixed(2)} mm, puede costar escanearlo (acorta la URL).`);
        const color = it.color || tp.qr.color, color2 = it.color2 ?? tp.qr.color2;
        const layer = { fill: color, grad: color2 ? [color, color2] : null, contours: qr.contours };
        print.push(layer);
        if (qr.badge) print.push({ ...layer, evenodd: true, contours: badgeContours(it.badge, qr.badge.cx, qr.badge.cy, qr.badge.size) });
      }
      // ink below the QR grouped in lines: line 1 = Texto, line 2 = Línea 2 (redrawn with the font when given)
      const lines = [];
      for (const t of [...tp.texts].sort((a, b) => a.box.y0 - b.box.y0)) {
        const ln = lines.find((l) => Math.min(l.y1, t.box.y1) - Math.max(l.y0, t.box.y0) > 0.4 * Math.min(l.y1 - l.y0, t.box.y1 - t.box.y0));
        if (ln) { ln.ts.push(t); ln.x0 = Math.min(ln.x0, t.box.x0); ln.x1 = Math.max(ln.x1, t.box.x1); ln.y0 = Math.min(ln.y0, t.box.y0); ln.y1 = Math.max(ln.y1, t.box.y1); }
        else lines.push({ ts: [t], ...t.box });
      }
      let li = 0;
      for (const ln of lines) {
        const below = ln.y0 * kM >= qy1 - 0.5;
        const txt = below ? [it.label, it.sub][li++] : '';
        if (txt && txt.trim()) {
          const w = (ln.x1 - ln.x0) * kM, cx2 = ((ln.x0 + ln.x1) / 2) * kM, bottom = ln.y1 * kM;
          let tb = textBlock(lf, txt, { height: (ln.y1 - ln.y0) * kM, maxWidth: w, cx: cx2, bottom });
          if (tb.bbox.x1 - tb.bbox.x0 < 0.96 * w && [...txt].length > 1) tb = textBlock(lf, txt, { capHeight: tb.size * capHeightRatio(lf), width: w, maxWidth: w, cx: cx2, bottom });
          const fill = ln.ts.reduce((a, b) => (b.contours.length > a.contours.length ? b : a)).fill;
          print.push({ fill, contours: tb.glyphs.flatMap((g) => g.contours) });
        } else for (const t of ln.ts) print.push({ fill: t.fill, evenodd: true, contours: S(t.contours) });
      }
      add({ id: 'qr' + np, name: `Placa QR ${np}${it.label ? ' · ' + it.label : ''}`, mat: 'white', contours, onPanel: true, print, note: it.url ? `QR → ${it.url}` : '' });
      boxes.push(bbox(contours));
    });
    if (cfg.nfc.enabled && boxes.length) {
      const b = boxes[Math.min(boxes.length - 1, cfg.nfc.plate | 0)];
      cut.push(circleC((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (cfg.nfc.diameter + 1) / 2));
    }
    pieces.unshift({ id: 'panel', name: 'Panel principal', mat: 'black', contours: cut, view: 'front', qty: 1, print: [], onPanel: false });
    const n = boxes.length;
    return {
      platesTop: n ? Math.min(...boxes.map((b) => b.y0)) : 0, platesBottom: n ? Math.max(...boxes.map((b) => b.y1)) : 0,
      pxs: boxes.map((b) => b.x0), plateW: n ? boxes.reduce((s, b) => s + b.w, 0) / n : 0, plateWs: boxes.map((b) => b.w), plateH: n ? Math.max(...boxes.map((b) => b.h)) : 0,
    };
  }

  function cardPrint(fw, fh) {
    // logo printed (UV) on the card-holder front: line-art icon + title + subtitle, stacked like the target
    const out = [];
    const ih = fh * 0.55, top = 2.5;
    let mini = null;
    if (cfg.icon.type === 'cube') {
      const k = ih / CUBE_ICON.h;
      mini = cubeIcon(fw / 2 + 0.6 * k, -fh + top + ih, ih, 0.3);
      // outline of each white piece drawn inside it (even-odd ring); the thin lid is filled
      const lw = 0.5;
      const rings = mini.pieces.flatMap((p) => p.key === 'lid' ? [p.contours[0]] : [roundPoly(p.pts, 0.3), roundPoly(offsetConvex(p.pts, -lw), 0.1)]);
      out.push({ fill: '#111111', evenodd: true, contours: rings });
      out.push({ fill: '#111111', contours: [mini.heart] });
    }
    const t1 = cfg.title.text.trim() ? textBlock(font(cfg.title.font), cfg.title.text, { height: fw * 0.46 / 7.6, maxWidth: fw * 0.46, tracking: cfg.title.tracking, cx: fw / 2, top: -fh + top + (mini ? ih + 2 : 8) }) : null;
    if (t1) out.push({ fill: '#111111', contours: t1.glyphs.flatMap((g) => g.contours) });
    if (cfg.subtitle.text.trim()) {
      const t2 = textBlock(font(cfg.subtitle.font), cfg.subtitle.text, { capHeight: 2, width: fw * 0.36, maxWidth: fw * 0.5, tracking: cfg.subtitle.tracking, cx: fw / 2, top: (t1 ? t1.bbox.y1 : -fh / 2) + 1.2 });
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

// ------------------------------------------------------------------ nesting on sheets (true-shape, raster)
// Every piece is rasterised (ppm px/mm) in 4 orientations; pieces go biggest first to the free spot closest to
// the sheet's long-side start (left on landscape sheets, top on portrait ones), so small pieces fill the gaps and
// concavities of big ones and the rest of the sheet stays as one clean offcut. Distance between real outlines
// ≥ sheet.gap; nothing enters the edge margin. Overflowing pieces open new sheets (earlier sheets are tried first).
function rasterize(cs, ppm, pad) {
  const bb = bbox(cs);
  const W = Math.ceil(bb.w * ppm) + 2 * pad + 1, H = Math.ceil(bb.h * ppm) + 2 * pad + 1;
  const m = new Uint8Array(W * H);
  const rings = cs.map((c) => flatten(c, 0.05).map((p) => [(p[0] - bb.x0) * ppm + pad, (p[1] - bb.y0) * ppm + pad]));
  for (let y = 0; y < H; y++) {
    const sy = y + 0.5, xs = [];
    for (const R of rings) for (let i = 0, j = R.length - 1; i < R.length; j = i++) {
      const [xi, yi] = R[i], [xj, yj] = R[j];
      if ((yi > sy) !== (yj > sy)) xs.push(xi + ((sy - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(W - 1, Math.floor(xs[k + 1] - 0.5)); x++) m[y * W + x] = 1;
  }
  // outlines thinner than a pixel still mark their pixels
  for (const R of rings) for (const [x, y] of R) { const xi = Math.min(W - 1, Math.max(0, Math.floor(x))), yi = Math.min(H - 1, Math.max(0, Math.floor(y))); m[yi * W + xi] = 1; }
  return { m, W, H, bb };
}
const runsOf = (m, W, H) => {
  const rows = [];
  for (let y = 0; y < H; y++) {
    let a = -1;
    for (let x = 0; x <= W; x++) {
      const on = x < W && m[y * W + x];
      if (on && a < 0) a = x;
      if (!on && a >= 0) { rows.push([y, a, x]); a = -1; }
    }
  }
  return rows;
};

const pieceArea = (p) => (p._area ??= (() => { const outs = outerContours(p.contours); return p.contours.reduce((t, c) => t + (outs.includes(c) ? 1 : -1) * Math.abs(ringArea(flatten(c, 0.1))), 0); })());
export function nest(model, mat) {
  model._nest ??= {};
  return (model._nest[mat] ??= nestSheets(model, mat));
}
function nestSheets(model, mat) {
  const { w: SW, h: SH, gap, margin } = sheetOf(model.cfg, mat);
  const ppm = Math.min(4, Math.sqrt(4e6 / (SW * SH)));
  const GW = Math.floor(SW * ppm), GH = Math.floor(SH * ppm);
  const halo = gap * ppm - 0.6, pad = Math.ceil(halo) + 2;
  const landscape = SW >= SH;
  const list = [];
  for (const p of model.pieces) if (p.mat === mat) {
    // 4 orientations (duplicates of symmetric pieces are harmless)
    let cs = p.contours;
    const ors = [];
    for (let r = 0; r < 4; r++) {
      const bb0 = bbox(cs), c0 = translate(cs, -bb0.x0, -bb0.y0);
      const ras = rasterize(c0, ppm, pad);
      const body = dilate(ras.m, ras.W, ras.H, 1);
      let bx0 = ras.W, by0 = ras.H, bx1 = -1, by1 = -1, area = 0;
      for (let y = 0; y < ras.H; y++) for (let x = 0; x < ras.W; x++) if (body[y * ras.W + x]) { area++; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      const runs = runsOf(body, ras.W, ras.H);
      // check the longest runs first: collisions are found sooner
      const order = [...runs].sort((a, b) => b[2] - b[1] - (a[2] - a[1]));
      ors.push({ rot: r * 90, cs: c0, W: ras.W, H: ras.H, body, runs: order, bx0, by0, bx1, by1, area, w: bb0.w, h: bb0.h });
      cs = rot90(cs);
    }
    for (let q = 0; q < p.qty; q++) list.push({ piece: p, n: q + 1, ors, area: ors[0].area });
  }
  list.sort((a, b) => b.area - a.area);

  const sheets = [];
  const newSheet = () => {
    const occ = new Uint8Array(GW * GH), m = Math.round(margin * ppm);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (x < m || y < m || x >= GW - m || y >= GH - m) occ[y * GW + x] = 1;
    const pre = new Int32Array((GW + 1) * GH);
    const s = { items: [], occ, pre, rowsDirty: null };
    for (let y = 0; y < GH; y++) prefixRow(s, y);
    sheets.push(s);
    return s;
  };
  const prefixRow = (s, y) => { const o = y * (GW + 1); s.pre[o] = 0; for (let x = 0; x < GW; x++) s.pre[o + x + 1] = s.pre[o + x] + s.occ[y * GW + x]; };
  const fits = (s, o, X, Y) => {
    for (const [ry, a, b] of o.runs) {
      const row = (Y + ry) * (GW + 1);
      if (s.pre[row + X + b] - s.pre[row + X + a]) return false;
    }
    return true;
  };
  // first free spot along the long side; stops as soon as it cannot beat `best`
  const search = (s, o, best) => {
    const X0 = -o.bx0, X1 = GW - 1 - o.bx1, Y0 = -o.by0, Y1 = GH - 1 - o.by1;
    if (X1 < X0 || Y1 < Y0) return null;
    if (landscape) {
      for (let X = X0; X <= X1; X++) {
        if (X + o.bx1 >= best) return null;
        for (let Y = Y0; Y <= Y1; Y++) if (fits(s, o, X, Y)) return { X, Y, score: X + o.bx1, tie: Y + o.by1 };
      }
    } else {
      for (let Y = Y0; Y <= Y1; Y++) {
        if (Y + o.by1 >= best) return null;
        for (let X = X0; X <= X1; X++) if (fits(s, o, X, Y)) return { X, Y, score: Y + o.by1, tie: X + o.bx1 };
      }
    }
    return null;
  };
  const place = (s, it, o, X, Y) => {
    // occupy the piece grown by the gap
    const grown = dilate(o.body, o.W, o.H, halo);
    for (let y = 0; y < o.H; y++) {
      const gy = Y + y;
      if (gy < 0 || gy >= GH) continue;
      for (let x = 0; x < o.W; x++) { const gx = X + x; if (gx >= 0 && gx < GW && grown[y * o.W + x]) s.occ[gy * GW + gx] = 1; }
      prefixRow(s, gy);
    }
    const dx = (X + pad) / ppm, dy = (Y + pad) / ppm;
    s.items.push({ piece: it.piece, n: it.n, rot: o.rot, x: dx, y: dy, w: o.w, h: o.h, cs: translate(o.cs, dx, dy) });
  };

  for (const it of list) {
    let done = false;
    for (const s of sheets) {
      let best = null, bo = null;
      for (const o of it.ors) {
        const r = search(s, o, best ? best.score + 1 : Infinity);
        if (r && (!best || r.score < best.score || (r.score === best.score && r.tie < best.tie))) { best = r; bo = o; }
      }
      if (best) { place(s, it, bo, best.X, best.Y); done = true; break; }
    }
    if (done) continue;
    const s = newSheet();
    let best = null, bo = null;
    for (const o of it.ors) {
      const r = search(s, o, best ? best.score + 1 : Infinity);
      if (r && (!best || r.score < best.score || (r.score === best.score && r.tie < best.tie))) { best = r; bo = o; }
    }
    if (best) place(s, it, bo, best.X, best.Y);
    else {
      model.warnings.push(`«${it.piece.name}» no cabe en la lámina de ${SW}×${SH} mm (con ${margin} mm de margen).`);
      const o = it.ors[0];
      s.items.push({ piece: it.piece, n: it.n, rot: 0, x: margin, y: margin, w: o.w, h: o.h, cs: translate(o.cs, margin, margin) });
    }
  }
  for (const s of sheets) {
    let ux = 0, uy = 0, a = 0;
    for (const it of s.items) {
      const b = bbox(it.cs);
      ux = Math.max(ux, b.x1); uy = Math.max(uy, b.y1);
      a += pieceArea(it.piece);
    }
    s.used = { w: ux + margin, h: uy + margin };
    s.fill = a / (SW * SH);
    delete s.occ; delete s.pre; delete s.rowsDirty;
  }
  return sheets;
}

// ------------------------------------------------------------------ SVG output
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const idOf = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
const svgOpen = (w, h, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${f3(w)}mm" height="${f3(h)}mm" viewBox="0 0 ${f3(w)} ${f3(h)}"${extra}>\n`;
export const CUT_STYLE = 'fill="none" stroke="#ff0000" stroke-width="0.01"';

export const sheetOf = (cfg, mat) => ({ ...cfg.sheet, ...(mat !== 'jig' && cfg[mat]?.sheet?.w > 0 && cfg[mat]?.sheet?.h > 0 ? cfg[mat].sheet : {}) });

export const MATERIALS = (cfg) => ({
  white: `${cfg.white.label} ${cfg.white.t} mm`,
  black: `${cfg.black.label} ${cfg.black.t} mm`,
  jig: 'Plantilla de pegado (cartón o MDF 3 mm)',
});

// Print layer → <path> (+ <linearGradient> for two-colour QR codes, left→right diagonal across the layer).
let gradSeq = 0;
function layerSVG(layer, cs) {
  const d = contoursD(cs), rule = layer.evenodd ? 'evenodd' : 'nonzero';
  if (!layer.grad) return `<path fill="${layer.fill}" fill-rule="${rule}" d="${d}"/>\n`;
  const bb = bbox(cs), id = 'grad' + ++gradSeq;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f3(bb.x0)}" y1="${f3(bb.y0)}" x2="${f3(bb.x1)}" y2="${f3(bb.y1)}"><stop offset="0" stop-color="${layer.grad[0]}"/><stop offset="1" stop-color="${layer.grad[1]}"/></linearGradient>\n<path fill="url(#${id})" fill-rule="${rule}" d="${d}"/>\n`;
}

// One SVG per sheet: red hairline cut lines, one path (compound) per piece.
export function cutSVGs(model, mat) {
  const { w, h } = sheetOf(model.cfg, mat);
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
    for (const layer of p.print) g += layerSVG(layer, translate(layer.contours, dx, dy));
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
    for (const layer of p.print) o += layerSVG(layer, translate(layer.contours, ox, oy));
  }
  for (const p of model.pieces.filter((q) => q.overWhite)) o += `<path fill="${blk}" d="${P(p.contours)}"/>\n`;
  const cf = byId('cardFront');
  if (cf) {
    const { x, w } = cf.cardFront, sd = byId('cardSide');
    if (sd) for (const sx of [x - tB, x + w]) o += `<path fill="${blk}" stroke="#000" stroke-width="0.15" d="${P([rectC(sx, -sd.cardSide.h, tB, sd.cardSide.h, 0.6)])}"/>\n`;
    o += `<path fill="${wht}" stroke="${edge}" stroke-width="0.15" d="${P(translate(cf.contours, x, 0))}"/>\n`;
    for (const layer of cf.print) o += layerSVG(layer, translate(layer.contours, x + ox, oy));
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
  for (const mat of ['white', 'black', 'jig']) {
    const k = M[mat];
    if (!out[k]) continue;
    const ss = nest(model, mat);
    out[k].sheets = ss.length;
    out[k].fill = ss.map((s) => Math.round(s.fill * 100));
  }
  return out;
}

// Microphone "flag" body: a solid with rounded edges whose bottom has the cavity where the wireless mic
// (DJI, Hollyland, Rode…) slides in. The cavity is a main slot for the transmitter plus a thin slot for its clip,
// separated by a divider wall that the clip grabs. The logo plate sits on the top face.
// Everything is in millimetres, body centred on the origin, Z up, bottom at z = 0.
import * as THREE from 'three';
import { shapePolygon } from './raster.js';

export const BODY_SHAPES = { rect: 'Cuadrado / rectángulo', circle: 'Círculo', star: 'Estrella', heart: 'Corazón', hexagon: 'Hexágono', custom: 'Mi STL' };

const SLOTS = { slotL: 44, slotT: 23, clipT: 5, divider: 2, depth: 35, gap: 1, clipSide: 'front', slotY: 0 };
export const BODY_PRESETS = {
  square: { name: 'Cuadrado 54.5×40 (hueco grande)', shape: 'rect', w: 54.5, d: 40, h: 40, corner: 3, fillet: 2, ...SLOTS, side: { enabled: true, outer: 18.4, inner: 15, height: 3 } },
  star: { name: 'Estrella 62×58', shape: 'star', w: 62, d: 58, h: 36, points: 5, inner: 0.62, tipR: 5, valleyR: 5,   fillet: 2.5, ...SLOTS, slotL: 36, slotT: 19, clipT: 4, depth: 31, slotY: -2.5, side: { enabled: false, outer: 16, inner: 12.5, height: 2 } },
  heart: { name: 'Corazón 62×58', shape: 'heart', w: 62, d: 58, h: 36, tipR: 5, valleyR: 5, fillet: 2.5, ...SLOTS, slotL: 36, slotT: 19, clipT: 4, depth: 31, slotY: 7.5, side: { enabled: false, outer: 16, inner: 12.5, height: 2 } },
  circle: { name: 'Círculo Ø56', shape: 'circle', w: 56, d: 56, h: 38, fillet: 2.5, ...SLOTS, slotL: 40, slotT: 20, clipT: 4, depth: 33, side: { enabled: false, outer: 16, inner: 12.5, height: 2 } },
  hexagon: { name: 'Hexágono 60×56', shape: 'hexagon', w: 60, d: 56, h: 38, tipR: 4, fillet: 2.5, ...SLOTS, slotL: 40, slotT: 20, clipT: 4, depth: 33, side: { enabled: false, outer: 16, inner: 12.5, height: 2 } },
};

export const DEFAULT_BODY = () => ({
  enabled: false, preset: 'square', ...structuredClone(BODY_PRESETS.square), points: 5, inner: 0.62, tipR: 5, valleyR: 5,
  rot: 0, ox: 0, oy: 0, filament: null, customId: null, customRot: [0, 0, 0],
});

// ---------------------------------------------------------------- 2D helpers
const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };
const ccw = (p) => (area(p) > 0 ? p : [...p].reverse());

// Replaces each corner by a circular arc of radius r(i) (convex and concave corners).
function roundCorners(pts, radiusAt, seg = 10) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const u = [a[0] - p[0], a[1] - p[1]], v = [b[0] - p[0], b[1] - p[1]];
    const lu = Math.hypot(...u), lv = Math.hypot(...v);
    const ang = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv))));
    let r = radiusAt(i);
    let t = r / Math.tan(ang / 2);
    const tMax = Math.min(lu, lv) * 0.49;
    if (t > tMax) { t = tMax; r = t * Math.tan(ang / 2); }
    if (!(r > 0.01) || ang > Math.PI - 0.01) { out.push(p); continue; }
    const s = [p[0] + (u[0] / lu) * t, p[1] + (u[1] / lu) * t], e = [p[0] + (v[0] / lv) * t, p[1] + (v[1] / lv) * t];
    const bis = [u[0] / lu + v[0] / lv, u[1] / lu + v[1] / lv], lb = Math.hypot(...bis);
    const dc = r / Math.sin(ang / 2), c = [p[0] + (bis[0] / lb) * dc, p[1] + (bis[1] / lb) * dc];
    let a0 = Math.atan2(s[1] - c[1], s[0] - c[0]), a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= seg; k++) { const aa = a0 + (da * k) / seg; out.push([c[0] + r * Math.cos(aa), c[1] + r * Math.sin(aa)]); }
  }
  return out;
}

// Removes points closer than `min` to the previous one (keeps arcs well conditioned).
function dedupe(p, min = 0.05) {
  const out = [];
  for (const q of p) { const l = out[out.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > min) out.push(q); }
  while (out.length > 3 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= min) out.pop();
  return out;
}

// Outer contour of the body (CCW, y up, centred).
export function bodyOutline(b) {
  const w = b.w, d = b.d;
  let p;
  switch (b.shape) {
    case 'circle': p = shapePolygon('circle', 0, 0, w, d); break;
    case 'heart': p = heartOutline(w, d, b.tipR ?? 5, b.valleyR ?? 5); break;
    case 'star': {
      const n = Math.max(3, Math.round(b.points || 5)), k = Math.min(0.95, Math.max(0.2, b.inner ?? 0.6)), raw = [];
      for (let i = 0; i < n * 2; i++) {
        const a = Math.PI / 2 + (i / (n * 2)) * Math.PI * 2, f = i % 2 ? k : 1;
        raw.push([(w / 2) * f * Math.cos(a), (d / 2) * f * Math.sin(a)]);
      }
      p = roundCorners(raw, (i) => (i % 2 ? b.valleyR ?? 4 : b.tipR ?? 4), 12);
      break;
    }
    case 'hexagon': {
      const raw = [];
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; raw.push([(w / 2) * Math.cos(a), (d / 2) * Math.sin(a)]); }
      p = roundCorners(raw, () => b.tipR ?? 3, 10);
      break;
    }
    default: p = shapePolygon('rect', 0, 0, w, d, { corner: b.corner ?? 3 });
  }
  p = dedupe(ccw(p));
  // centre on the bounding box and stretch to exactly w × d (rounded tips otherwise make stars/hearts smaller)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, sx = w / Math.max(1e-6, x1 - x0), sy = d / Math.max(1e-6, y1 - y0);
  return p.map(([x, y]) => [(x - cx) * sx, (y - cy) * sy]);
}

// Heart from two lobes, tangent lines to a rounded tip and a filleted (smooth) cusp — offsets cleanly.
function heartOutline(W, Hh, tipR, valleyR) {
  const R = W * 0.27, c = W / 2 - R, top = Hh / 2, yc = top - R, yb = top - Hh;
  const rv = Math.max(0.5, valleyR);
  const yf = yc + Math.sqrt(Math.max(0, (R + rv) ** 2 - c * c));
  // tangent from the tip to the right lobe (outer side)
  const dx = c, dy = yc - yb, L = Math.hypot(dx, dy), al = Math.asin(Math.min(1, R / L)), base = Math.atan2(dy, dx);
  const tl = Math.sqrt(Math.max(0, L * L - R * R));
  const tA = base - al;   // direction of the outer tangent line
  const tp = [tl * Math.cos(tA), yb + tl * Math.sin(tA)];
  const aT = Math.atan2(tp[1] - yc, tp[0] - c), aF = Math.atan2(yf - yc, -c);
  const pts = [[0, yb]];
  const right = [];
  const n1 = 40;
  for (let i = 0; i <= n1; i++) { const a = aT + ((aF - aT) * i) / n1; right.push([c + R * Math.cos(a), yc + R * Math.sin(a)]); }
  const f0 = Math.atan2(yc - yf, c), f1 = Math.atan2(yc - yf, -c);
  const fil = [];
  for (let i = 1; i < 12; i++) { const a = f0 + ((f1 - f0) * i) / 12; fil.push([rv * Math.cos(a), yf + rv * Math.sin(a)]); }
  pts.push(...right, ...fil, ...right.slice().reverse().map(([x, y]) => [-x, y]));
  return roundCorners(pts, (i) => (i === 0 ? tipR : 0), 14);
}

// Inward offset keeping the vertex count (fine for the small edge fillets used here).
function inset(p, dist) {
  if (!(dist > 0)) return p.map((q) => [q[0], q[1]]);
  const n = p.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i + n - 1) % n], q = p[i], b = p[(i + 1) % n];
    const e1 = [q[0] - a[0], q[1] - a[1]], e2 = [b[0] - q[0], b[1] - q[1]];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    const n1 = [e1[1] / l1, -e1[0] / l1], n2 = [e2[1] / l2, -e2[0] / l2];   // outward normals (CCW)
    let m = [n1[0] + n2[0], n1[1] + n2[1]];
    const lm = Math.hypot(...m) || 1;
    m = [m[0] / lm, m[1] / lm];
    const k = dist / Math.max(0.35, m[0] * n1[0] + m[1] * n1[1]);
    out.push([q[0] - m[0] * k, q[1] - m[1] * k]);
  }
  return out;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export function pointInPoly(p, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < xi + ((p[1] - yi) / (yj - yi)) * (xj - xi)) ins = !ins;
  }
  return ins;
}
// Signed distance to the polygon boundary (positive inside).
function insideDist(p, poly) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(p, poly[i], poly[(i + 1) % poly.length]));
  return pointInPoly(p, poly) ? d : -d;
}
// Distance from the origin along +dir until the boundary (first crossing).
function rayHit(poly, ox, oy, dx, dy) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den, s = ((a[0] - ox) * dy - (a[1] - oy) * dx) / den;
    if (t > 0 && s >= 0 && s <= 1) best = Math.min(best, t);
  }
  return best;
}

// ---------------------------------------------------------------- mesh helpers
function pusher(pos) {
  const tri = (a, b, c) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const triN = (a, b, c, n) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) tri(a, b, c); else tri(a, c, b);
  };
  const quadN = (a, b, c, d, n) => { triN(a, b, c, n); triN(a, c, d, n); };
  const capN = (contour, holes, z, n) => {
    const V = (arr) => arr.map((q) => new THREE.Vector2(q[0], q[1]));
    const all = [...contour, ...holes.flat()];
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(V(contour), holes.map(V))) triN([...all[i], z], [...all[j], z], [...all[k], z], n);
  };
  return { tri, triN, quadN, capN };
}

// Rectangular cavity open at z = 0. Two slots (main + clip) separated by a divider that stops `gap` mm below the roof.
function cavity(b) {
  const L = b.slotL, D = b.depth;
  const tClip = b.clipT > 0 && b.divider > 0 ? b.clipT : 0, tDiv = tClip ? b.divider : 0;
  const total = b.slotT + tClip + tDiv;
  const sy = b.slotY || 0, x0 = -L / 2, x1 = L / 2, ya = sy - total / 2, yd = sy + total / 2;
  // front = clip slot at -Y
  const front = b.clipSide !== 'back';
  const yb = front ? ya + tClip : ya + b.slotT, yc = front ? yb + tDiv : yb + tDiv;
  return { x0, x1, ya, yb, yc, yd, D, gap: Math.max(0, Math.min(b.gap ?? 1, D - 0.5)), split: tClip > 0, total };
}

function addCavity(P, c) {
  const { x0, x1, ya, yb, yc, yd, D } = c;
  const pt = (x, y, z) => [x, y, z];
  const wallsOf = (y0, y1, za, zb) => {
    P.quadN(pt(x0, y0, za), pt(x1, y0, za), pt(x1, y0, zb), pt(x0, y0, zb), [0, 1, 0]);
    P.quadN(pt(x0, y1, za), pt(x1, y1, za), pt(x1, y1, zb), pt(x0, y1, zb), [0, -1, 0]);
    P.quadN(pt(x0, y0, za), pt(x0, y1, za), pt(x0, y1, zb), pt(x0, y0, zb), [1, 0, 0]);
    P.quadN(pt(x1, y0, za), pt(x1, y1, za), pt(x1, y1, zb), pt(x1, y0, zb), [-1, 0, 0]);
  };
  const ceil = (y0, y1, z) => P.quadN(pt(x0, y0, z), pt(x1, y0, z), pt(x1, y1, z), pt(x0, y1, z), [0, 0, -1]);
  if (!c.split) { wallsOf(ya, yd, 0, D); ceil(ya, yd, D); return [[[x0, ya], [x1, ya], [x1, yd], [x0, yd]]]; }
  const holes = [[[x0, ya], [x1, ya], [x1, yb], [x0, yb]], [[x0, yc], [x1, yc], [x1, yd], [x0, yd]]];
  if (c.gap <= 0) {
    wallsOf(ya, yb, 0, D); ceil(ya, yb, D);
    wallsOf(yc, yd, 0, D); ceil(yc, yd, D);
    return holes;
  }
  const z1 = D - c.gap;
  wallsOf(ya, yb, 0, z1);
  wallsOf(yc, yd, 0, z1);
  P.quadN(pt(x0, yb, z1), pt(x1, yb, z1), pt(x1, yc, z1), pt(x0, yc, z1), [0, 0, 1]);    // divider top
  // chamber above the divider (walls split where the divider meets them so the mesh stays watertight)
  P.quadN(pt(x0, ya, z1), pt(x1, ya, z1), pt(x1, ya, D), pt(x0, ya, D), [0, 1, 0]);
  P.quadN(pt(x0, yd, z1), pt(x1, yd, z1), pt(x1, yd, D), pt(x0, yd, D), [0, -1, 0]);
  for (const [y0, y1] of [[ya, yb], [yb, yc], [yc, yd]]) {
    P.quadN(pt(x0, y0, z1), pt(x0, y1, z1), pt(x0, y1, D), pt(x0, y0, D), [1, 0, 0]);
    P.quadN(pt(x1, y0, z1), pt(x1, y1, z1), pt(x1, y1, D), pt(x1, y0, D), [-1, 0, 0]);
    ceil(y0, y1, D);
  }
  return holes;
}

// Hollow ring along ±Y on the side faces (decoration / thumb rest), embedded into the body.
function sideRings(pos, outline, b, warnings) {
  const S = b.side;
  if (!S?.enabled || !(S.outer > S.inner) || !(S.height > 0)) return;
  const R = S.outer / 2, r = Math.max(0.5, S.inner / 2), zc = b.h / 2, seg = 64;
  if (R * 2 > b.h - 2 * (b.fillet || 0)) { warnings.push('El aro lateral no cabe en la altura del cuerpo.'); return; }
  for (const dir of [1, -1]) {
    const yb = rayHit(outline, 0, 0, 0, dir);
    let ymin = yb;
    for (let i = -4; i <= 4; i++) ymin = Math.min(ymin, rayHit(outline, (R * i) / 4, 0, 0, dir));
    if (!Number.isFinite(ymin) || yb - ymin > 8) { warnings.push('El aro lateral no se pudo colocar en esta forma.'); continue; }
    const yIn = (ymin - 0.8) * dir, yOut = (yb + S.height) * dir;
    const P = pusher(pos);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const o0 = [R * Math.cos(a0), R * Math.sin(a0) + zc], o1 = [R * Math.cos(a1), R * Math.sin(a1) + zc];
      const i0 = [r * Math.cos(a0), r * Math.sin(a0) + zc], i1 = [r * Math.cos(a1), r * Math.sin(a1) + zc];
      const am = (a0 + a1) / 2;
      const P3 = (q, y) => [q[0], y, q[1]];
      P.quadN(P3(o0, yIn), P3(o1, yIn), P3(o1, yOut), P3(o0, yOut), [Math.cos(am), 0, Math.sin(am)]);
      P.quadN(P3(i0, yIn), P3(i1, yIn), P3(i1, yOut), P3(i0, yOut), [-Math.cos(am), 0, -Math.sin(am)]);
      P.quadN(P3(o0, yOut), P3(o1, yOut), P3(i1, yOut), P3(i0, yOut), [0, dir, 0]);
      P.quadN(P3(o0, yIn), P3(o1, yIn), P3(i1, yIn), P3(i0, yIn), [0, -dir, 0]);
    }
  }
}

// Best Y offset of the cavity inside the outline (maximises the thinnest wall). Returns { slotY, wall }.
export function fitSlotY(b) {
  const outline = bodyOutline(b);
  let best = { slotY: 0, wall: -Infinity };
  for (let sy = -15; sy <= 15; sy += 0.5) {
    const c = cavity({ ...b, slotY: sy });
    let m = Infinity;
    for (let i = 0; i <= 30 && m > best.wall; i++) { const x = c.x0 + ((c.x1 - c.x0) * i) / 30; m = Math.min(m, insideDist([x, c.ya], outline), insideDist([x, c.yd], outline)); }
    for (let i = 0; i <= 15 && m > best.wall; i++) { const y = c.ya + ((c.yd - c.ya) * i) / 15; m = Math.min(m, insideDist([c.x0, y], outline), insideDist([c.x1, y], outline)); }
    if (m > best.wall + 1e-6 || (Math.abs(m - best.wall) < 1e-6 && Math.abs(sy) < Math.abs(best.slotY))) best = { slotY: sy, wall: m };
  }
  return best;
}

/**
 * Parametric body. Returns { body: Float32Array positions, rings: Float32Array|null, outline, top, warnings }.
 * Positions are in local body coords (before rotation / offset).
 */
export function buildParametricBody(b) {
  const warnings = [];
  const outline = bodyOutline(b);
  const h = Math.max(2, b.h);
  const r = Math.max(0, Math.min(b.fillet || 0, h / 2 - 0.2, Math.min(b.w, b.d) / 4));
  // rings of the outer surface (bottom fillet → top fillet)
  const levels = [];
  const steps = r > 0 ? 6 : 0;
  for (let i = 0; i <= steps; i++) { const f = steps ? (i / steps) * (Math.PI / 2) : Math.PI / 2; levels.push([r - r * Math.cos(f), r - r * Math.sin(f)]); }
  for (let i = steps; i >= 0; i--) { const f = steps ? (i / steps) * (Math.PI / 2) : Math.PI / 2; levels.push([h - r + r * Math.cos(f), r - r * Math.sin(f)]); }
  const rings = levels.map(([z, d]) => ({ z, pts: inset(outline, d) }));
  const pos = [];
  const P = pusher(pos);
  for (let j = 0; j < rings.length - 1; j++) {
    const A = rings[j], B = rings[j + 1];
    if (B.z - A.z < 1e-6) continue;
    for (let i = 0; i < outline.length; i++) {
      const i2 = (i + 1) % outline.length;
      const a0 = [...A.pts[i], A.z], b0 = [...A.pts[i2], A.z], a1 = [...B.pts[i], B.z], b1 = [...B.pts[i2], B.z];
      P.tri(a0, b0, b1); P.tri(a0, b1, a1);
    }
  }
  // cavity
  let holes = [];
  const c = cavity(b);
  if (b.depth > 0 && b.slotL > 0 && b.slotT > 0) {
    const need = Math.max(1.2, r + 0.4);
    let minWall = Infinity;
    const samples = [];
    for (let i = 0; i <= 40; i++) { const x = c.x0 + ((c.x1 - c.x0) * i) / 40; samples.push([x, c.ya], [x, c.yd]); }
    for (let i = 0; i <= 20; i++) { const y = c.ya + ((c.yd - c.ya) * i) / 20; samples.push([c.x0, y], [c.x1, y]); }
    for (const s of samples) minWall = Math.min(minWall, insideDist(s, outline));
    if (minWall < need) warnings.push(`El hueco del micrófono no cabe (pared de ${Math.max(0, minWall).toFixed(1)} mm): reduce la ranura o agranda el cuerpo.`);
    else if (c.D > h - 1.2) warnings.push('El hueco es más profundo que el cuerpo: reduce la profundidad o aumenta la altura.');
    else {
      holes = addCavity(P, c);
      if (minWall < 2) warnings.push(`Pared delgada alrededor del hueco (${minWall.toFixed(1)} mm).`);
    }
  }
  P.capN(rings[0].pts, holes, 0, [0, 0, -1]);
  P.capN(rings[rings.length - 1].pts, [], h, [0, 0, 1]);
  const ringPos = [];
  sideRings(ringPos, outline, { ...b, h }, warnings);
  return { body: new Float32Array(pos), rings: ringPos.length ? new Float32Array(ringPos) : null, outline, top: h, cavity: c, warnings };
}

// Convex hull (CCW) of the XY projection of a triangle soup — footprint of imported bodies.
export function hull2D(pos) {
  const pts = [];
  for (let i = 0; i < pos.length; i += 3) pts.push([pos[i], pos[i + 1]]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

// ---------------------------------------------------------------- user STL bodies
export function parseSTL(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === u8.length) {
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true);
      return out;
    }
  }
  const txt = new TextDecoder().decode(u8);
  const nums = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m;
  while ((m = re.exec(txt))) nums.push(+m[1], +m[2], +m[3]);
  if (!nums.length || nums.length % 9) throw new Error('STL no válido');
  return new Float32Array(nums);
}

// Rotation (90° steps) as a function on [x,y,z].
function rotFn([rx, ry, rz]) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180, 'XYZ'));
  const e = m.elements;
  return (x, y, z) => [e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z];
}

// Guess the orientation: the top is the extreme face with the largest flat area (the bottom has the cavity opening).
export function autoOrient(pos) {
  const dirs = [[0, 0, 0], [180, 0, 0], [90, 0, 0], [-90, 0, 0], [0, 90, 0], [0, -90, 0]];
  let best = dirs[0], bestA = -1;
  for (const d of dirs) {
    const f = rotFn(d);
    let zmax = -Infinity;
    for (let i = 0; i < pos.length; i += 3) zmax = Math.max(zmax, f(pos[i], pos[i + 1], pos[i + 2])[2]);
    let A = 0;
    for (let i = 0; i < pos.length; i += 9) {
      const a = f(pos[i], pos[i + 1], pos[i + 2]), b = f(pos[i + 3], pos[i + 4], pos[i + 5]), c = f(pos[i + 6], pos[i + 7], pos[i + 8]);
      if (Math.max(Math.abs(a[2] - zmax), Math.abs(b[2] - zmax), Math.abs(c[2] - zmax)) > 0.3) continue;
      A += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }
    if (A > bestA + 1e-6) { bestA = A; best = d; }
  }
  return best;
}

// Rotates, centres in XY and drops to z = 0; the longer side ends up along X (like the logo). Returns { body, top, size }.
export function placeCustomBody(pos, rot) {
  const f = rotFn(rot || [0, 0, 0]);
  const out = new Float32Array(pos.length);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const [x, y, z] = f(pos[i], pos[i + 1], pos[i + 2]);
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z); x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, turn = y1 - y0 > (x1 - x0) * 1.05;
  for (let i = 0; i < out.length; i += 3) {
    const x = out[i] - cx, y = out[i + 1] - cy;
    if (turn) { out[i] = -y; out[i + 1] = x; } else { out[i] = x; out[i + 1] = y; }
    out[i + 2] -= z0;
  }
  const size = turn ? [y1 - y0, x1 - x0, z1 - z0] : [x1 - x0, y1 - y0, z1 - z0];
  return { body: out, top: z1 - z0, size };
}

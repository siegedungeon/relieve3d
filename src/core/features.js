// Builds the extra printable geometry around a processed design: base / plate shapes, keyring tab, mounting holes,
// magnet pockets, clip tongue, cake-topper sticks, pencil sleeve and cookie-cutter walls.
// All user parameters are in millimetres. Work happens on a raster grid in image-pixel space and is traced back to vectors.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  edt, dilate, fillHoles, union, subtract, countOn, fillPolygon, fillCircle, fillCapsule, shapePolygon, traceMask, maskBBox, connectIslands,
} from './raster.js';
import { DEFAULT_BODY, buildParametricBody, hull2D } from './micbody.js';

export const DEFAULT_SETTINGS = () => ({
  widthMM: 60,
  base: { enabled: false, margin: 2, thickness: 1.2, filament: null, weld: true, shape: 'contour', plateW: 40, plateH: 40, corner: 4, points: 5, inner: 0.5, round: 0 },
  ring: { enabled: false, pos: 'top', x: null, y: null, outer: 8, inner: 4, thickness: 2, filament: null },
  holes: { enabled: false, count: 2, diameter: 4, inset: 4 },
  magnets: { enabled: false, count: 1, diameter: 10, depth: 2, spacing: 20, clearance: 0.2 },
  tongue: { enabled: false, width: 14, length: 18, thickness: 2 },
  sticks: { enabled: false, count: 2, length: 70, width: 5, tip: true, bar: false, barHeight: 4, thickness: 3 },
  pencil: { enabled: false, type: 'hex', measure: 'diameter', value: 7, tolerance: 0.4, wall: 1.6, mount: 'side', length: 0, ends: 'closed-right', offset: 0, filament: null },
  cutter: { enabled: false, wall: 1, height: 14, flange: 4, flangeT: 1.6, offset: 0 },
  micBody: DEFAULT_BODY(),
});

export const PENCIL_TYPES = { round: 'Redondo', hex: 'Hexagonal', triangle: 'Triangular' };

// Pencil size across (mm): round = diameter, hex = across flats, triangle = flat to opposite (rounded) corner.
export function pencilAcross(p) {
  if (p.measure !== 'circumference') return p.value;
  const C = p.value;
  if (p.type === 'round') return C / Math.PI;
  if (p.type === 'hex') return (C * Math.sqrt(3)) / 6;
  const rc = 1;
  const ri = Math.max(0.5, (C - 2 * Math.PI * rc) / (6 * Math.sqrt(3)));
  return 3 * ri + 2 * rc;
}

// Channel cross-section centred on the axis, flat side down. Returns { pts: [[u,v]], maxR, halfWidth }.
export function pencilProfile(type, size) {
  const pts = [];
  if (type === 'round') {
    const r = size / 2;
    for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
    return { pts, maxR: r };
  }
  if (type === 'hex') {
    const R = size / Math.sqrt(3);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; pts.push([R * Math.cos(a), R * Math.sin(a)]); }
    return { pts, maxR: R };
  }
  // rounded equilateral triangle, one flat side at the bottom
  const rc = Math.min(1, size * 0.15);
  const ri = (size - 2 * rc) / 3;
  const Rv = 2 * ri;
  for (let k = 0; k < 3; k++) {
    const va = Math.PI / 2 + (k * 2 * Math.PI) / 3;
    const vx = Rv * Math.cos(va), vy = Rv * Math.sin(va);
    for (let i = 0; i <= 10; i++) {
      const a = va - Math.PI / 3 + (i / 10) * ((2 * Math.PI) / 3);
      pts.push([vx + rc * Math.cos(a), vy + rc * Math.sin(a)]);
    }
  }
  // centre the bounding box vertically so the sleeve wall is even top/bottom
  return { pts, maxR: Rv + rc };
}

function sleeveCrossSection(profile, wall) {
  const R = profile.maxR + wall, flat = Math.min(R * 0.12, wall * 0.4), zc = R - flat;
  const outer = [];
  const a0 = Math.asin(-zc / R), a1 = Math.PI - a0;
  for (let i = 0; i <= 96; i++) { const a = a0 + ((a1 - a0) * i) / 96; outer.push([R * Math.cos(a), zc + R * Math.sin(a)]); }
  return { outer, hole: profile.pts.map(([u, v]) => [u, v + zc]), R, zc, top: zc + R };
}

// Single watertight sleeve: outer prism of length L with a channel from capStart to L - capEnd.
// Local coords (u, v, w): cross-section in (u, v), axis along w.
function sleeveMesh(O, Hl, L, capStart, capEnd) {
  const ccw = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a > 0 ? p : [...p].reverse(); };
  O = ccw(O); Hl = ccw(Hl);
  const c0 = capStart, c1 = L - capEnd;
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const v3 = (p, w) => [p[0], p[1], w];
  for (let i = 0; i < O.length; i++) {
    const a = O[i], b = O[(i + 1) % O.length];
    tri(v3(a, 0), v3(b, 0), v3(b, L)); tri(v3(a, 0), v3(b, L), v3(a, L));
  }
  for (let i = 0; i < Hl.length; i++) {
    const a = Hl[i], b = Hl[(i + 1) % Hl.length];
    tri(v3(a, c0), v3(b, c1), v3(b, c0)); tri(v3(a, c0), v3(a, c1), v3(b, c1));
  }
  const V = (arr) => arr.map((p) => new THREE.Vector2(p[0], p[1]));
  const face = (contour, holes, w, normalUp) => {
    const all = [...contour, ...holes.flat()];
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(V(contour), holes.map(V))) {
      const A = all[a], Bp = all[b], C = all[c];
      const cr = (Bp[0] - A[0]) * (C[1] - A[1]) - (Bp[1] - A[1]) * (C[0] - A[0]);
      if ((cr > 0) === normalUp) tri(v3(A, w), v3(Bp, w), v3(C, w)); else tri(v3(A, w), v3(C, w), v3(Bp, w));
    }
  };
  if (capStart > 0) { face(O, [], 0, false); face(Hl, [], c0, true); } else face(O, [[...Hl].reverse()], 0, false);
  if (capEnd > 0) { face(O, [], L, true); face(Hl, [], c1, false); } else face(O, [[...Hl].reverse()], L, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// Sleeve geometry in millimetres. axis 'x': runs along +X starting at (x0, y); axis '-y': runs downwards from (x, y0).
function sleeveGeometry({ cross, length, capStart, capEnd, axis, origin }) {
  const g = sleeveMesh(cross.outer, cross.hole, length, capStart, capEnd);
  const m = new THREE.Matrix4();
  if (axis === 'x') m.makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)).setPosition(origin[0], origin[1], 0);
  else m.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)).setPosition(origin[0], origin[1], 0);
  g.applyMatrix4(m);
  g.computeVertexNormals();
  return g;
}

const rectPoly = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/**
 * result: output of processImage. opts: { scale (mm/px), center: [cx, cy] (px), detail, smooth }.
 * Returns { layers, solids, bounds, ring, warnings, hidePieces, pieceZ }.
 *   layers: [{ key, name, fil, shapes (px), z, height }]  (fil = 'base' | 'ring' | 'pencil')
 *   solids: [{ key, name, fil, geometry (model space: px XY centred & y-up, mm Z), footprint: shapes (px) }]
 */
export function buildFeatures(result, settings, opts) {
  const set = { ...DEFAULT_SETTINGS(), ...settings };
  // Mic body: the logo plate sits on top of a solid body with the mic cavity — magnets / clip tongue make no sense there.
  const MB = set.micBody?.enabled && !set.cutter?.enabled ? { ...DEFAULT_BODY(), ...set.micBody } : null;
  if (MB) { set.magnets = { ...set.magnets, enabled: false }; set.tongue = { ...set.tongue, enabled: false }; }
  let bodyInfo = null;
  const s = opts.scale, [cx, cy] = opts.center;
  const eps = opts.detail ?? 0.8, smooth = opts.smooth ?? 1;
  const mm = (v) => v / s;
  const warnings = [];
  const layers = [], solids = [];
  const fb = result.fgBBox;
  const B = set.base, cut = set.cutter.enabled, pen = set.pencil.enabled;

  // ---- region of interest (image px)
  let x0 = fb[0], y0 = fb[1], x1 = fb[2], y1 = fb[3];
  if (B.enabled && B.shape !== 'contour') {
    const gx = (fb[0] + fb[2]) / 2, gy = (fb[1] + fb[3]) / 2;
    x0 = Math.min(x0, gx - mm(B.plateW) / 2); x1 = Math.max(x1, gx + mm(B.plateW) / 2);
    y0 = Math.min(y0, gy - mm(B.plateH) / 2); y1 = Math.max(y1, gy + mm(B.plateH) / 2);
  }
  let pad = mm((B.enabled ? B.margin : 0) + 3);
  if (set.ring.enabled) pad += mm(set.ring.outer * 1.6 + 3);
  if (cut) pad += mm(set.cutter.offset + set.cutter.wall + set.cutter.flange + 2);
  let padB = pad, padX = pad;
  if (set.tongue.enabled) padB += mm(set.tongue.length + 3);
  if (set.sticks.enabled) padB += mm(set.sticks.length + 6);
  let pencilAcrossMM = 0, prof = null, cross = null;
  if (pen) {
    pencilAcrossMM = pencilAcross(set.pencil);
    prof = pencilProfile(set.pencil.type, pencilAcrossMM + set.pencil.tolerance);
    cross = sleeveCrossSection(prof, set.pencil.wall);
    if (set.pencil.mount === 'tip') padB += mm((set.pencil.length || 25) + 6);
    else { padB += mm(cross.R * 2 + 4); padX += mm(Math.max(0, (set.pencil.length || 0) - (x1 - x0) * s) / 2 + 4); }
  }
  const rx0 = x0 - padX, ry0 = y0 - pad, rx1 = x1 + padX, ry1 = y1 + padB;
  const k = Math.max(1, Math.sqrt(((rx1 - rx0) * (ry1 - ry0)) / 2.4e6));
  const GW = Math.max(4, Math.ceil((rx1 - rx0) / k)), GH = Math.max(4, Math.ceil((ry1 - ry0) / k));
  const ox = rx0, oy = ry0, N = GW * GH;
  const G = (v) => v / k;                     // image px length → grid
  const gmm = (v) => mm(v) / k;               // mm → grid
  const gx = (x) => (x - ox) / k, gy = (y) => (y - oy) / k;
  const toImg = (p) => [p[0] * k + ox, p[1] * k + oy];
  const trace = (m) => traceMask(m, GW, GH, eps / k, smooth, ox, oy, k);

  // ---- foreground on the grid
  const fg = new Uint8Array(N);
  const { width: W, height: H, comp } = result;
  for (let y = 0; y < GH; y++) {
    const iy = Math.floor(oy + (y + 0.5) * k);
    if (iy < 0 || iy >= H) continue;
    for (let x = 0; x < GW; x++) {
      const ix = Math.floor(ox + (x + 0.5) * k);
      if (ix >= 0 && ix < W && comp[iy * W + ix] >= 0) fg[y * GW + x] = 1;
    }
  }
  const gcx = gx((fb[0] + fb[2]) / 2), gcy = gy((fb[1] + fb[3]) / 2);

  let pencilInfo = null, tongue = null, ringInfo = null, pieceZ = 0, magnetMarks = null;
  // ---- cookie cutter: replaces everything else
  if (cut) {
    const C = set.cutter;
    const inner = fillHoles(dilate(fg, GW, GH, gmm(C.offset)), GW, GH);
    const wall = subtract(dilate(inner, GW, GH, gmm(C.wall)), inner);
    const flange = subtract(dilate(inner, GW, GH, gmm(C.wall + C.flange)), inner);
    layers.push({ key: 'cutterFlange', name: 'Pestaña', fil: 'base', shapes: trace(flange), z: 0, height: C.flangeT });
    layers.push({ key: 'cutterWall', name: 'Filo cortador', fil: 'base', shapes: trace(wall), z: 0, height: C.height });
    if (C.wall < 0.8) warnings.push('Pared del cortador muy delgada (< 0.8 mm).');
    return finish();
  }

  // ---- base body
  let base = null;
  const silhouette = (marginMM) => fillHoles(dilate(fg, GW, GH, gmm(marginMM)), GW, GH);
  if (B.enabled) {
    base = silhouette(B.margin);
    if (B.weld && B.shape === 'contour') base = fillHoles(connectIslands(base, GW, GH, gmm(3)).mask, GW, GH);
    if (B.shape !== 'contour') {
      const plate = new Uint8Array(N);
      fillPolygon(plate, GW, GH, shapePolygon(B.shape, gcx, gcy, gmm(B.plateW), gmm(B.plateH), {
        corner: gmm(B.corner), points: B.points, inner: B.inner, round: B.round,
      }));
      const outside = subtract(fg, plate);
      if (countOn(outside) > countOn(fg) * 0.02) warnings.push('El diseño sobresale de la forma de la placa: agranda la placa o reduce el ancho del diseño.');
      base = union(plate, silhouette(Math.min(B.margin, 1)));
    }
  }
  // reference body for attachments when there is no base
  const body = () => base || dilate(fg, GW, GH, gmm(0.5));
  const extraBody = new Uint8Array(N);     // parts that become part of the base (or a separate layer if no base)
  const extraThickness = { v: 0, name: '' };
  const addExtra = (m, thickness, name) => { for (let i = 0; i < N; i++) if (m[i]) extraBody[i] = 1; if (!extraThickness.v) { extraThickness.v = thickness; extraThickness.name = name; } };

  const colRange = (m, xa, xb) => {
    let top = Infinity, bottom = -Infinity;
    for (let y = 0; y < GH; y++) for (let x = Math.max(0, Math.floor(xa)); x <= Math.min(GW - 1, Math.ceil(xb)); x++) {
      if (m[y * GW + x]) { if (y < top) top = y; if (y > bottom) bottom = y; }
    }
    return { top, bottom: bottom + 1 };
  };

  // ---- cake topper sticks & joining bar
  if (set.sticks.enabled) {
    const S2 = set.sticks, ref = body();
    const bb = maskBBox(ref, GW, GH);
    if (bb) {
      const m = new Uint8Array(N);
      const bottom = bb[3];
      if (S2.bar) {
        const inset = gmm(2);
        fillPolygon(m, GW, GH, rectPoly(bb[0] + inset, bottom - gmm(S2.barHeight), bb[2] - inset, bottom));
      }
      const n = Math.max(1, Math.round(S2.count)), w = gmm(S2.width), L = gmm(S2.length);
      for (let i = 0; i < n; i++) {
        const xc = n === 1 ? (bb[0] + bb[2]) / 2 : bb[0] + ((bb[2] - bb[0]) * (i + 0.5)) / n;
        const cr = colRange(union(ref, m), xc - w / 2, xc + w / 2);
        const top = (Number.isFinite(cr.top) ? cr.bottom : bottom) - gmm(4);
        const yb = bottom + L, tl = S2.tip ? Math.min(w * 1.4, L * 0.3) : 0;
        fillPolygon(m, GW, GH, tl ? [[xc - w / 2, top], [xc + w / 2, top], [xc + w / 2, yb - tl], [xc, yb], [xc - w / 2, yb - tl]] : rectPoly(xc - w / 2, top, xc + w / 2, yb));
        if (!Number.isFinite(cr.top)) warnings.push(`El palito ${i + 1} no toca el diseño: activa la barra de unión.`);
      }
      addExtra(m, S2.thickness, 'Palitos');
    }
  }

  // ---- pencil sleeve
  if (pen) {
    const P = set.pencil, ref = body();
    const bb = maskBBox(ref, GW, GH);
    if (bb) {
      const R = cross.R, Rg = gmm(R);
      const xcG = (bb[0] + bb[2]) / 2 + gmm(P.offset);
      if (P.mount === 'tip') {
        const L = P.length > 0 ? P.length : 25;
        const cr = colRange(ref, xcG - Rg * 0.5, xcG + Rg * 0.5);
        const topG = (Number.isFinite(cr.top) ? cr.bottom : bb[3]) - gmm(3);
        const [xi, yi] = toImg([xcG, topG]);
        const g = sleeveGeometry({ cross, length: L, capStart: 5, capEnd: 0, axis: '-y', origin: [(xi - cx) * s, (cy - yi) * s] });
        pencilInfo = { geometry: g, footprint: [{ outer: [toImg([xcG - Rg, topG]), toImg([xcG + Rg, topG]), toImg([xcG + Rg, topG + gmm(L)]), toImg([xcG - Rg, topG + gmm(L)])], holes: [] }] };
      } else {
        const L = P.length > 0 ? P.length : (bb[2] - bb[0]) * k * s;
        const bottom = bb[3];
        const axisG = bottom + gmm(prof.maxR + 0.4);
        const xa = xcG - gmm(L) / 2, xb = xcG + gmm(L) / 2;
        const bar = new Uint8Array(N);
        fillPolygon(bar, GW, GH, rectPoly(xa, bottom - gmm(3), xb, bottom));
        addExtra(bar, B.enabled ? B.thickness : 3, 'Unión');
        const capL = P.ends === 'closed-left' ? 2 : 0, capR = P.ends === 'closed-right' ? 2 : 0;
        const [xi, yi] = toImg([xa, axisG]);
        const g = sleeveGeometry({ cross, length: L, capStart: capL, capEnd: capR, axis: 'x', origin: [(xi - cx) * s, (cy - yi) * s] });
        pencilInfo = { geometry: g, footprint: [{ outer: [toImg([xa, axisG - Rg]), toImg([xb, axisG - Rg]), toImg([xb, axisG + Rg]), toImg([xa, axisG + Rg])], holes: [] }] };
      }
      if (pencilAcrossMM < 4 || pencilAcrossMM > 14) warnings.push(`Medida de lápiz inusual: ${pencilAcrossMM.toFixed(1)} mm.`);
    }
  }

  // ---- clip tongue (for microphone clips)
  tongue = null;
  if (set.tongue.enabled) {
    const T = set.tongue, ref = body();
    const bb = maskBBox(ref, GW, GH);
    if (bb) {
      const xc = (bb[0] + bb[2]) / 2, w = gmm(T.width);
      const cr = colRange(ref, xc - w / 2, xc + w / 2);
      const top = (Number.isFinite(cr.top) ? cr.bottom : bb[3]) - gmm(Math.min(4, T.length * 0.3));
      tongue = new Uint8Array(N);
      fillPolygon(tongue, GW, GH, shapePolygon('rect', xc, top + (gmm(T.length) + gmm(Math.min(4, T.length * 0.3))) / 2, w, gmm(T.length) + gmm(Math.min(4, T.length * 0.3)), { corner: w * 0.3 }));
    }
  }

  if (base) base = union(base, extraBody);

  // ---- keyring tab
  ringInfo = null;
  if (set.ring.enabled) {
    const Rg = set.ring, ro = gmm(Rg.outer / 2), ri = gmm(Math.min(Rg.inner, Rg.outer - 0.8) / 2);
    const ref = base || union(dilate(fg, GW, GH, gmm(0.5)), extraBody);
    let P;
    if (Rg.pos === 'manual' && Rg.x != null) P = [gx(Rg.x), gy(Rg.y)];
    else {
      const dirs = { top: [0, -1], left: [-1, 0], right: [1, 0], bottom: [0, 1], topleft: [-Math.SQRT1_2, -Math.SQRT1_2], topright: [Math.SQRT1_2, -Math.SQRT1_2] };
      const d = dirs[Rg.pos] || dirs.top;
      let best = -Infinity, Q = [gcx, gcy];
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        if (!ref[y * GW + x]) continue;
        const px = x + 0.5 - gcx, py = y + 0.5 - gcy;
        const sc = px * d[0] + py * d[1] - 0.35 * Math.abs(px * d[1] - py * d[0]);
        if (sc > best) { best = sc; Q = [x + 0.5, y + 0.5]; }
      }
      const off = ri + Math.max(gmm(1.2), (ro - ri) * 0.6);
      P = [Q[0] + d[0] * off, Q[1] + d[1] * off];
    }
    const ringM = new Uint8Array(N);
    fillCircle(ringM, GW, GH, P[0], P[1], ro);
    const { dist, index } = edt(ref, GW, GH, true);
    const pi = Math.min(GH - 1, Math.max(0, Math.floor(P[1]))) * GW + Math.min(GW - 1, Math.max(0, Math.floor(P[0])));
    if (index[pi] >= 0 && dist[pi] > 0) {
      const qx = (index[pi] % GW) + 0.5, qy = ((index[pi] / GW) | 0) + 0.5;
      const L = Math.hypot(qx - P[0], qy - P[1]) || 1, ux = (qx - P[0]) / L, uy = (qy - P[1]) / L;
      fillCapsule(ringM, GW, GH, P[0], P[1], qx + ux * gmm(2), qy + uy * gmm(2), ro * 0.8);
    }
    const hole = new Uint8Array(N);
    fillCircle(hole, GW, GH, P[0], P[1], ri);
    let overlap = 0;
    for (let i = 0; i < N; i++) if (hole[i] && fg[i]) overlap++;
    if (overlap > 0) warnings.push('El agujero de la argolla toca el diseño: muévela un poco hacia afuera.');
    if (base) base = subtract(union(base, ringM), hole);
    else layers.push({ key: 'ring', name: 'Argolla', fil: 'ring', shapes: trace(subtract(ringM, hole)), z: 0, height: Rg.thickness });
    const [ix, iy] = toImg(P);
    ringInfo = { x: ix, y: iy, ro: ro * k, ri: ri * k };
  }

  // ---- mounting holes (signs)
  if (base && set.holes.enabled && set.holes.count > 0) {
    const Hh = set.holes, r = gmm(Hh.diameter / 2), bb = maskBBox(base, GW, GH);
    const inside = edt(Uint8Array.from(base, (v) => (v ? 0 : 1)), GW, GH);
    const e = gmm(Hh.inset) + r, ccx = (bb[0] + bb[2]) / 2, ccy = (bb[1] + bb[3]) / 2;
    const cand = Hh.count === 1 ? [[ccx, bb[1] + e]]
      : Hh.count === 2 ? [[bb[0] + e, bb[1] + e], [bb[2] - e, bb[1] + e]]
        : [[bb[0] + e, bb[1] + e], [bb[2] - e, bb[1] + e], [bb[0] + e, bb[3] - e], [bb[2] - e, bb[3] - e]];
    const hm = new Uint8Array(N);
    for (let [hx, hy] of cand) {
      for (let it = 0; it < 200; it++) {
        const i = Math.min(GH - 1, Math.max(0, Math.floor(hy))) * GW + Math.min(GW - 1, Math.max(0, Math.floor(hx)));
        if (base[i] && inside[i] >= r + gmm(1.5)) break;
        const L = Math.hypot(ccx - hx, ccy - hy) || 1;
        hx += ((ccx - hx) / L) * Math.max(0.5, gmm(0.3)); hy += ((ccy - hy) / L) * Math.max(0.5, gmm(0.3));
      }
      fillCircle(hm, GW, GH, hx, hy, r);
    }
    for (let i = 0; i < N; i++) if (hm[i] && fg[i]) { warnings.push('Un agujero de montaje toca el diseño.'); break; }
    base = subtract(base, hm);
  }

  // ---- base layers (with optional magnet pockets in the bottom)
  pieceZ = 0; magnetMarks = null;
  if (base) {
    let T = B.thickness;
    if (set.magnets.enabled) {
      const M = set.magnets;
      if (T < M.depth + 0.6) { T = M.depth + 0.6; warnings.push(`Base engrosada a ${T.toFixed(1)} mm para cubrir el imán.`); }
      const bb = maskBBox(base, GW, GH), r = gmm((M.diameter + M.clearance) / 2), sp = gmm(M.spacing) / 2;
      const ccx = (bb[0] + bb[2]) / 2, ccy = (bb[1] + bb[3]) / 2;
      const pos = M.count >= 4 ? [[ccx - sp, ccy - sp], [ccx + sp, ccy - sp], [ccx - sp, ccy + sp], [ccx + sp, ccy + sp]]
        : M.count === 2 ? [[ccx - sp, ccy], [ccx + sp, ccy]] : [[ccx, ccy]];
      const mag = new Uint8Array(N);
      for (const [px, py] of pos) fillCircle(mag, GW, GH, px, py, r);
      const lost = countOn(subtract(mag, base));
      if (lost > 0) warnings.push('Un imán queda fuera de la base: reduce la separación o el diámetro.');
      const inside = edt(Uint8Array.from(base, (v) => (v ? 0 : 1)), GW, GH);
      for (let i = 0; i < N; i++) if (mag[i] && inside[i] < gmm(0.8)) { warnings.push('Pared muy delgada alrededor del imán.'); break; }
      layers.push({ key: 'baseLow', name: 'Base (bolsillo imán)', fil: 'base', shapes: trace(subtract(base, mag)), z: 0, height: M.depth });
      layers.push({ key: 'base', name: 'Base', fil: 'base', shapes: trace(base), z: M.depth, height: T - M.depth });
      magnetMarks = pos.map((p) => ({ c: toImg(p), r: r * k }));
    } else {
      layers.push({ key: 'base', name: 'Base', fil: 'base', shapes: trace(base), z: 0, height: T });
    }
    pieceZ = T;
  } else if (countOn(extraBody)) {
    layers.push({ key: 'extra', name: extraThickness.name || 'Unión', fil: 'base', shapes: trace(extraBody), z: 0, height: extraThickness.v || 2 });
  }
  if (tongue) layers.push({ key: 'tongue', name: 'Lengüeta clip', fil: 'base', shapes: trace(base ? subtract(tongue, base) : tongue), z: 0, height: set.tongue.thickness });
  if (pencilInfo) solids.push({ key: 'pencil', name: 'Funda lápiz', fil: 'pencil', geometry: pencilInfo.geometry, footprint: pencilInfo.footprint });
  if (MB) addMicBody();

  return finish();

  function addMicBody() {
    let r;
    const cb = opts.customBody;
    if (MB.shape === 'custom' && cb?.positions?.length) {
      let top = 0;
      for (let i = 2; i < cb.positions.length; i += 3) top = Math.max(top, cb.positions[i]);
      r = { body: cb.positions, rings: null, outline: hull2D(cb.positions), top, warnings: [] };
    } else {
      if (MB.shape === 'custom') warnings.push('Carga el STL de tu cuerpo de micrófono (o elige una forma).');
      r = buildParametricBody(MB.shape === 'custom' ? { ...MB, shape: 'rect' } : MB);
    }
    warnings.push(...r.warnings);
    const a = ((MB.rot || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const ox = MB.ox || 0, oy = MB.oy || 0;
    const tx = (x, y) => [x * ca - y * sa + ox, x * sa + y * ca + oy];
    const toGeo = (arr) => {
      const p = new Float32Array(arr.length);
      for (let i = 0; i < arr.length; i += 3) { const [x, y] = tx(arr[i], arr[i + 1]); p[i] = x; p[i + 1] = y; p[i + 2] = arr[i + 2]; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.computeVertexNormals();
      return g;
    };
    const outer = r.outline.map(([x, y]) => { const [X, Y] = tx(x, y); return [cx + X / s, cy - Y / s]; });
    for (const L of layers) L.z += r.top;
    for (const so of solids) so.geometry.translate(0, 0, r.top);
    pieceZ += r.top;
    solids.unshift({ key: 'micbody', name: 'Cuerpo micrófono', fil: 'micBody', geometry: toGeo(r.body), footprint: [{ outer, holes: [] }] });
    if (r.rings) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let i = 0; i < r.rings.length; i += 3) { const [X, Y] = tx(r.rings[i], r.rings[i + 1]); a0 = Math.min(a0, X); a1 = Math.max(a1, X); b0 = Math.min(b0, Y); b1 = Math.max(b1, Y); }
      const P = (X, Y) => [cx + X / s, cy - Y / s];
      solids.splice(1, 0, { key: 'micrings', name: 'Aros laterales', fil: 'micBody', geometry: toGeo(r.rings), footprint: [{ outer: [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)], holes: [] }] });
    }
    // logo must sit on the body: warn when part of the design hangs over the edge
    const inPoly = (p) => { let c = false; for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) { const A = outer[i], B = outer[j]; if ((A[1] > p[1]) !== (B[1] > p[1]) && p[0] < ((B[0] - A[0]) * (p[1] - A[1])) / (B[1] - A[1]) + A[0]) c = !c; } return c; };
    const plate = layers.find((L) => L.key === 'base');
    const test = plate ? plate.shapes.flatMap((sh) => sh.outer) : [[fb[0], fb[1]], [fb[2], fb[1]], [fb[2], fb[3]], [fb[0], fb[3]]];
    if (test.some((p) => !inPoly(p))) warnings.push('El logo sobresale del cuerpo del micrófono: reduce el ancho o muévelo.');
    bodyInfo = { top: r.top, x: cx + ox / s, y: cy - oy / s, outline: outer };
  }

  function finish() {
    // convert mm-space solids to model space (px XY)
    for (const so of solids) so.geometry.applyMatrix4(new THREE.Matrix4().makeScale(1 / s, 1 / s, 1));
    let bx0 = fb[0], by0 = fb[1], bx1 = fb[2], by1 = fb[3];
    const grow = (p) => { bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]); };
    for (const L of layers) for (const sh of L.shapes) for (const p of sh.outer) grow(p);
    for (const so of solids) for (const sh of so.footprint) for (const p of sh.outer) grow(p);
    let zTop = 0;
    for (const L of layers) zTop = Math.max(zTop, L.z + L.height);
    if (pencilInfo) zTop = Math.max(zTop, cross.top + (bodyInfo?.top || 0));
    if (bodyInfo) zTop = Math.max(zTop, bodyInfo.top);
    return {
      layers, solids, bounds: [bx0, by0, bx1, by1], ring: ringInfo, warnings: [...new Set(warnings)], hidePieces: cut,
      pieceZ: cut ? 0 : pieceZ, zTop, magnets: magnetMarks, pencilAcross: pencilAcrossMM || null, body: bodyInfo,
    };
  }
}

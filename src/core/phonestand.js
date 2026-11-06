// Phone-stand keychain ("Soporte de celular llavero"): parametric print-in-place generator. Pure JS, no DOM.
// The hinge re-creates, parametrically, the working principle of the classic print-in-place pocket stand (credit:
// "Small smartphone stand – print in place" by mgm86; no mesh is copied): a body (frame) with a hinged leg on
// 45° cone pins. The leg prints standing up; it folds forward flat into its slot (keychain, held by a snap lip) and
// swings back onto a stop to hold the phone, whose back leans on the leg's slanted front face while its bottom
// edge sits in the V groove the closed leg leaves in the body. Plus a decorative top (heart, mouse head, flower…)
// with a key-ring hole, optional NFC pocket (print pause to drop the chip in), can-tab opener slot and the
// client's logo/brand in relief, inlay or engraving.
// Units: mm. Print orientation: X width, Y length (front edge at y = 0, decorative top towards +Y), Z up (bed
// z = 0, top face z = T). Hinge frame: s = yh − y (towards the front), v = z − R (R = T/2), axis at the origin.
// Leg frame (s', v'): leg upright, back face s' = −R, barrel = circle R. Pose φ (deg, + = top forward) maps
// (s', v') → (s'·cosφ + v'·sinφ, −s'·sinφ + v'·cosφ); 90° = closed (back face flush with the top face). In 3D a
// pose is a rotation about the X axis through (y = yh, z = R) by +φ (Manifold/three.js right-handed).
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { traceLogo, flatten, layoutText, capHeightRatio, HABLADOR_FONTS } from './hablador.js';

export const PHONESTAND_FONTS = HABLADOR_FONTS;
export const NFC_PAUSE_MSG = 'Inserta el chip NFC en el bolsillo y continúa';
export const PHONESTAND_PROJECT_APP = 'Relieve3D-SoporteCelular';
const D2R = Math.PI / 180;
const LAYER = 0.2;
const DENSITY = 1.24; // PLA, g/cm³
// can-tab opener slot (mm): length along the edge, depth into the body, floor at the mouth/inner end, ceiling
const SLOT = { len: 16, depth: 10, mouth: 1, inner: 2, top: 3.4, wall: 2.5 };
// Hinge geometry per size (mm, leg frame), after the reference small/large stands: T body thickness (= barrel Ø),
// Ht leg length from the axis, Hend side-plate length, rt tip radius, K keel apex (the front face runs from the
// tip down to K, the keel from K back down to the neck at 40° from vertical).
const SIZES = {
  small: { T: 11, Ht: 24.6, Hend: 20.6, rt: 1.25, K: [3.3, 11.9] },
  large: { T: 12, Ht: 26.6, Hend: 22.6, rt: 1.3, K: [3.6, 12.9] },
};
export const PHONESTAND_SIZES = [{ id: 'small', name: 'Pequeño (11 mm)' }, { id: 'large', name: 'Grande (12 mm)' }];
export const PHONESTAND_VARIANTS = [{ id: 'standard', name: 'Estándar (con barra)' }, { id: 'short', name: 'Corto' }];
const PHI_PRINT = 5, PHI_STOP = -1, PHI_END = 91;   // leg poses (deg): as printed, design stop, end of the cut sweep
const END_W = 5.5;   // width of each side knuckle / leg side plate
const BAR = 22;      // standard variant: bar between the hinge and the decorative shape
const GROW_MAX = 40;  // the decorative shape may move back up to this much to make room for the NFC chip / can opener

let engine, loading;
export async function preparePhoneStand() {
  if (!loading) loading = import('../../node_modules/manifold-3d/manifold.js')
    .then(({ default: init }) => init()).then((w) => { w.setup(); engine = w; })
    .catch((err) => { loading = null; throw err; });
  await loading;
  return engine;
}

export const PHONESTAND_SHAPES = [
  { id: 'heart', name: 'Corazón' },
  { id: 'mouse', name: 'Ratón (estilo Mickey)' },
  { id: 'bear', name: 'Osito' },
  { id: 'cat', name: 'Gatito' },
  { id: 'flower', name: 'Flor' },
  { id: 'star', name: 'Estrella' },
  { id: 'cloud', name: 'Nube' },
  { id: 'crown', name: 'Corona' },
  { id: 'circle', name: 'Círculo' },
  { id: 'classic', name: 'Clásico' },
  { id: 'custom', name: 'Tu silueta' },
];

export const DEFAULT_PHONESTAND = () => ({
  name: 'Soporte celular',
  shape: 'heart',
  shapeScale: 100,   // % of the decorative shape's default size
  size: 'small',     // 'small' (11 mm thick) | 'large' (12 mm, longer leg)
  variant: 'standard', // 'standard' (bar behind the hinge, phone upright) | 'short' (shape right behind the hinge)
  width: 36,         // body width (side knuckles + leg)
  clearance: 0.3,    // print-in-place gap: hinge cones, leg sides, swept clearance
  pin: 3.5,          // hinge cone radius (auto-limited by the thickness)
  latch: 0.3,        // snap interference that keeps the leg closed (0 = no snap)
  ring: { enabled: true, diameter: 5, wall: 2.5 },
  nfc: { enabled: false, diameter: 25.5, depth: 1, where: 'auto', mark: true },   // where: 'auto' | 'top' | 'bar'; mark: 📶 tap sign over the chip, made like the logo
  opener: { enabled: false, side: 'right' },
  // logo/text: where = 'top' (decorative shape) | 'bar' (bar behind the hinge; on the short variant it joins 'top');
  // mode applies to both: relief (on top), inlay (flush, 2nd colour) or engrave (sunk)
  logo: { enabled: true, where: 'top', mode: 'relief', height: 0.8, depth: 0.6, size: 100, dx: 0, dy: 0, invert: false, minFeature: 1.2, tolerance: 40 },
  text: { enabled: false, where: 'bar', value: '', font: 'Montserrat Black', size: 100, rel: 28 },   // rel: cap height % of the logo height when they share a place
  colors: { body: '#f4e9dc', accent: '#e8127c', twoColor: true, flapAccent: false },
});

const num = (v, d, lo, hi) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : +v;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : d);

// v1.17 cards (flat card + flap) had these keys and no `size`: their look is kept, the hinge restarts from defaults
const LEGACY_KEYS = ['thickness', 'flapLength', 'rail', 'frontBar', 'ridge', 'phoneAngle'];

export function normalizePhoneStand(cfgIn = {}) {
  const D = DEFAULT_PHONESTAND();
  let cfg = cfgIn || {};
  if (!('size' in cfg) && LEGACY_KEYS.some((k) => k in cfg)) {
    cfg = { ...cfg };
    for (const k of ['width', 'clearance', 'pin']) delete cfg[k];
  }
  const c = { ...D, ...cfg };
  for (const k of LEGACY_KEYS) delete c[k];
  for (const k of ['ring', 'nfc', 'opener', 'logo', 'text', 'colors']) c[k] = { ...D[k], ...(cfg[k] || {}) };
  const place = (v, d) => (v === 'flap' ? 'bar' : v === 'top' || v === 'bar' ? v : d);
  c.name = String(c.name || D.name).slice(0, 60);
  c.shape = PHONESTAND_SHAPES.some((s) => s.id === c.shape) ? c.shape : D.shape;
  c.shapeScale = num(c.shapeScale, D.shapeScale, 70, 140);
  c.size = SIZES[c.size] ? c.size : D.size;
  c.variant = c.variant === 'short' ? 'short' : 'standard';
  c.width = num(c.width, D.width, 30, 46);
  c.clearance = num(c.clearance, D.clearance, 0.2, 0.6);
  c.pin = num(c.pin, D.pin, 2, 4.5);
  c.latch = num(c.latch, D.latch, 0, 0.6);
  c.ring.enabled = c.ring.enabled !== false;
  c.ring.diameter = num(c.ring.diameter, D.ring.diameter, 3, 8);
  c.ring.wall = num(c.ring.wall, D.ring.wall, 1.6, 5);
  c.nfc.enabled = !!c.nfc.enabled;
  c.nfc.diameter = num(c.nfc.diameter, D.nfc.diameter, 10, 40);
  c.nfc.depth = num(c.nfc.depth, D.nfc.depth, 0.4, 2);
  c.nfc.where = c.nfc.where === 'auto' ? 'auto' : place(c.nfc.where, 'auto');
  c.nfc.mark = c.nfc.mark !== false;
  c.opener.enabled = !!c.opener.enabled;
  c.opener.side = c.opener.side === 'left' ? 'left' : 'right';
  c.logo.enabled = c.logo.enabled !== false;
  c.logo.where = place(c.logo.where, 'top');
  c.logo.mode = ['relief', 'inlay', 'engrave'].includes(c.logo.mode) ? c.logo.mode : 'relief';
  c.logo.height = num(c.logo.height, D.logo.height, 0.4, 3);
  c.logo.depth = num(c.logo.depth, D.logo.depth, 0.4, 2);
  c.logo.size = num(c.logo.size, D.logo.size, 20, 150);
  c.logo.dx = num(c.logo.dx, 0, -40, 40);
  c.logo.dy = num(c.logo.dy, 0, -40, 40);
  c.logo.invert = !!c.logo.invert;
  c.logo.minFeature = num(c.logo.minFeature, D.logo.minFeature, 0.6, 3);
  c.logo.tolerance = num(c.logo.tolerance, D.logo.tolerance, 5, 120);
  c.text.enabled = !!c.text.enabled;
  c.text.where = place(c.text.where, 'bar');
  c.text.size = num(c.text.size, D.text.size, 20, 150);
  c.text.value = String(c.text.value ?? '').slice(0, 40);
  c.text.font = HABLADOR_FONTS[c.text.font] ? c.text.font : D.text.font;
  c.text.rel = num(c.text.rel, D.text.rel, 10, 80);
  c.colors.body = hex(c.colors.body, D.colors.body);
  c.colors.accent = hex(c.colors.accent, D.colors.accent);
  c.colors.twoColor = c.colors.twoColor !== false;
  c.colors.flapAccent = !!c.colors.flapAccent;
  return c;
}

// Pure hinge math (no geometry engine): leg profile key points, axis position, stop, pins and snap latch.
export function phoneStandMechanism(cfgIn) {
  const cfg = normalizePhoneStand(cfgIn);
  const Z = SIZES[cfg.size], W = cfg.width, c = cfg.clearance;
  const T = Z.T, R = T / 2, Ht = Z.Ht, Hend = Z.Hend, rt = Z.rt, K = Z.K;
  const xm = W / 2 - END_W;                       // half width of the leg's middle (the side plates reach W/2)
  const tc = [-R + rt, Ht - rt];                  // tip circle, tangent to the back face
  // front face (the phone rest): tangent from the keel apex K to the tip circle, on its front side
  const dx = tc[0] - K[0], dy = tc[1] - K[1], Ld = Math.hypot(dx, dy), al = Math.asin(rt / Ld);
  const fd = [(dx * Math.cos(al) + dy * Math.sin(al)) / Ld, (-dx * Math.sin(al) + dy * Math.cos(al)) / Ld];
  const T1 = [K[0] + fd[0] * Ld * Math.cos(al), K[1] + fd[1] * Ld * Math.cos(al)];
  const J = [-0.5, K[1] - (K[0] + 0.5) / Math.tan(40 * D2R)];   // keel J → K at 40° from vertical (45° when printed)
  const faceIncl = Math.atan2(fd[1], -fd[0]) / D2R;              // front face lean from the table, leg upright
  const tipR = Math.hypot(tc[0], tc[1]) + rt;                    // farthest leg point from the axis
  const yh = Math.sqrt((tipR + c) ** 2 - R * R) + 2.5;           // front wall: 2.5 mm past the tip's sweep
  // stop: top edge (sC, R) of the slot's back wall. The leg's back face lands on it at PHI_STOP and is ≥ c in
  // front of it as printed.
  const sC = Math.min(R * (Math.sin(PHI_STOP * D2R) - 1) / Math.cos(PHI_STOP * D2R),
    (-R - c + R * Math.sin(PHI_PRINT * D2R)) / Math.cos(PHI_PRINT * D2R));
  let lo = -20, hi = PHI_PRINT;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2, mr = m * D2R;
    if (sC * Math.cos(mr) - R * Math.sin(mr) + R > 0) lo = m; else hi = m;
  }
  const phiS = hi;
  const rcMax = R - 1.2 - (Math.SQRT2 - 1) * c;    // ≥ 1.2 mm of barrel around the socket
  const rc = Math.min(cfg.pin, rcMax);
  const sock = rc + (Math.SQRT2 - 1) * c;          // 45° socket radius at the leg's side face (= its depth)
  const yh0 = yh - sC + 1.5;                       // back end of the hinge zone
  const ym = cfg.variant === 'short' ? yh0 : yh0 + BAR;   // the decorative shape starts here
  // snap latch: a lip on the top face over each side plate's far end. The plate's back-top corner is cut at 45°
  // (v' − s' ≥ kn) so it clears the lip by c when closed; its far end passes the lip with `pen` interference.
  const rA = Math.hypot(R, Hend) + c, sA = Math.sqrt(rA * rA - R * R);
  const latchAt = (e) => {
    const kn = sA - e + R - c * Math.SQRT2, p1 = Math.max(-R, Hend - kn);
    return { e, kn, p1, pen: Math.hypot(p1, Hend) - Math.hypot(sA - e, R) };
  };
  let latch = null;
  if (cfg.latch > 0) {
    let a = 0.05, b = 3;
    for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (latchAt(m).pen < cfg.latch) a = m; else b = m; }
    latch = latchAt(b);
  }
  const plateR = latch ? Math.hypot(latch.p1, Hend) : Math.hypot(R, Hend);   // side plate's reach from the axis
  return {
    cfg, size: cfg.size, variant: cfg.variant, W, T, R, c, Ht, Hend, rt, K, J, T1, tc, fd, xm, faceIncl, tipR, yh,
    sC, phiS, phoneAngle: faceIncl + phiS, rc, rcMax, sock, yh0, ym, rA, sA, latch, plateR,
    poses: { print: 0, stand: phiS - PHI_PRINT, closed: 90 - PHI_PRINT },
  };
}

// ------------------------------------------------------------------ small helpers (pure JS)
function crossings(polys, axis, v) {
  const out = [], a = axis, b = 1 - axis;
  for (const p of polys) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const A = p[j], B = p[i];
    if ((A[a] > v) !== (B[a] > v)) out.push(A[b] + ((v - A[a]) / (B[a] - A[a])) * (B[b] - A[b]));
  }
  return out;
}
// axis 0: highest y where the vertical line x = v crosses; axis 1: rightmost x on the line y = v
const maxAt = (polys, axis, v) => { const c = crossings(polys, axis, v); return c.length ? Math.max(...c) : -Infinity; };
const minAt = (polys, axis, v) => { const c = crossings(polys, axis, v); return c.length ? Math.min(...c) : Infinity; };
function inside(polys, [x, y]) {
  let n = 0;
  for (const p of polys) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const A = p[j], B = p[i];
    if ((A[1] > y) !== (B[1] > y) && x < A[0] + ((y - A[1]) / (B[1] - A[1])) * (B[0] - A[0])) n++;
  }
  return n % 2 === 1;
}
function nearestIn(polys, p) {
  if (inside(polys, p)) return p;
  let best = null, bd = Infinity;
  for (const poly of polys) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const A = poly[j], B = poly[i], dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - A[0]) * dx + (p[1] - A[1]) * dy) / L2)) : 0;
    const q = [A[0] + t * dx, A[1] + t * dy], dd = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (dd < bd) { bd = dd; best = q; }
  }
  return best;
}
const rectHitsCircle = (x0, x1, y0, y1, c) => Math.hypot(Math.max(x0, Math.min(c.x, x1)) - c.x, Math.max(y0, Math.min(c.y, y1)) - c.y) < c.r;
// axis-aligned rectangle vs convex polygon (separating axis test)
function rectHitsPoly(x0, x1, y0, y1, poly) {
  const R = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const axes = [[1, 0], [0, 1]];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) axes.push([poly[j][1] - poly[i][1], poly[i][0] - poly[j][0]]);
  for (const [ax, ay] of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, y] of R) { const d = x * ax + y * ay; if (d < a0) a0 = d; if (d > a1) a1 = d; }
    for (const [x, y] of poly) { const d = x * ax + y * ay; if (d < b0) b0 = d; if (d > b1) b1 = d; }
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}
const fmt = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');

// Every wasm object goes through o() and is freed by o.free() (manifold objects are not garbage collected).
function makeScope() {
  const list = [];
  const o = (x) => { if (x && typeof x.delete === 'function') list.push(x); return x; };
  o.free = () => { while (list.length) { const x = list.pop(); try { x.delete(); } catch { /* already freed */ } } };
  return o;
}
function roundRect(S, x0, x1, y0, y1, r = 0) {
  const { o, CS } = S;
  r = Math.max(0, Math.min(r, (x1 - x0) / 2 - 1e-3, (y1 - y0) / 2 - 1e-3));
  if (r <= 1e-6) return o(o(CS.square([x1 - x0, y1 - y0])).translate([x0, y0]));
  const core = o(o(CS.square([x1 - x0 - 2 * r, y1 - y0 - 2 * r])).translate([x0 + r, y0 + r]));
  return o(core.offset(r, 'Round', 2, 72));
}
const circle = (S, x, y, r, n = 96) => S.o(S.o(S.CS.circle(r, n)).translate([x, y]));
const extrudeZ = (S, cs, z0, z1) => S.o(S.o(cs.extrude(z1 - z0)).translate([0, 0, z0]));
// profile in (y, z) extruded along X over [x0, x1]: rotate([90,0,90]) maps (a, b, e) → (e, a, b)
const alongX = (S, cs, x0, x1) => S.o(S.o(S.o(cs.extrude(x1 - x0)).rotate([90, 0, 90])).translate([x0, 0, 0]));
// profile in (x, z) extruded along Y over [y0, y1]: rotate([90,0,0]) maps (a, b, e) → (a, −e, b)
const alongY = (S, cs, y0, y1) => S.o(S.o(S.o(cs.extrude(y1 - y0)).rotate([90, 0, 0])).translate([0, y1, 0]));

function meshGeometry(m) {
  const positions = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) for (let j = 0; j < 3; j++) positions[i * 3 + j] = m.vertProperties[i * m.numProp + j];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1));
  const shaded = toCreasedNormals(geometry, Math.PI / 4);
  geometry.dispose();
  return shaded;
}

// y-down contours (hablador/opentype format) → one CrossSection in y-up mm
function shapesToCS(S, shapes, rule, tol = 0.03) {
  const { o, CS } = S;
  const parts = [];
  for (const rings of shapes) {
    const polys = rings.map((c) => flatten(c, tol).map(([x, y]) => [x, -y])).filter((p) => p.length >= 3);
    if (polys.length) parts.push(o(new CS(polys, rule)));
  }
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : o(CS.union(parts));
}

const traceCache = new WeakMap();
function cachedTrace(img, heightMM, { minFeature, tolerance, invert }, minAreaMM2) {
  let m = traceCache.get(img);
  if (!m) traceCache.set(img, (m = new Map()));
  const key = [heightMM.toFixed(1), minFeature, tolerance, invert, minAreaMM2].join('|');
  if (!m.has(key)) {
    m.set(key, traceLogo(img, { heightMM, minFeature, tolerance, invert, minAreaMM2 }));
    if (m.size > 16) m.delete(m.keys().next().value);
  }
  return m.get(key);
}
// ------------------------------------------------------------------ decorative tops (unit size, y up)
// factor: shape width / body width at 100 %. join: unit y where the body's top edge meets the shape, picked where
// the shape is wider than the body so the body's corners hide inside it. bail: [x, y, r] round boss for the key ring
// (heart: sits low in the dip between the lobes so the ring does not eat the logo area and the cleft still shows).
// Kit: C circle, H hull, U union, P polygon.
// heart: much wider than the body and set low, so its sides visibly taper into the body (reads as a heart, not a
// rounded slab); the tip that would reach past the front edge is clipped off.
const SHAPE_DEFS = {
  heart: { factor: 1.6, join: 0.086, bail: [0, 0.36, 0.068], build: ({ C, H, U }) => U([-1, 1].map((s) => H([C(0.24 * s, 0.22, 0.26), C(0, -0.45, 0.04)]))) },
  mouse: { factor: 1.53, join: 0, build: ({ C, U }) => U([C(0, 0, 0.5), C(-0.409, 0.439, 0.275), C(0.409, 0.439, 0.275)]) },
  bear: { factor: 1.23, join: 0, build: ({ C, U }) => U([C(0, 0, 0.5), C(-0.36, 0.36, 0.19), C(0.36, 0.36, 0.19)]) },
  cat: {
    factor: 1.21, join: 0,
    build: ({ C, H, U }) => U([C(0, 0, 0.5), ...[-1, 1].map((s) => H([C(0.37 * s, 0.72, 0.06), C(0.08 * s, 0.4, 0.08), C(0.46 * s, 0.22, 0.08)]))]),
  },
  flower: {
    factor: 1.3, join: 0.25,
    build: ({ C, U }) => U([C(0, 0, 0.3), ...[0, 1, 2, 3, 4, 5].map((i) => C(0.3 * Math.cos((90 + 60 * i) * D2R), 0.3 * Math.sin((90 + 60 * i) * D2R), 0.2))]),
  },
  star: {
    factor: 1.5, join: 0.28, tipRound: 2.5,
    build: ({ P }) => P(Array.from({ length: 10 }, (_, i) => { const a = (90 + 36 * i) * D2R, r = i % 2 ? 0.52 : 1; return [r * Math.cos(a), r * Math.sin(a)]; })),
  },
  cloud: {
    factor: 1.35, join: -0.05,
    build: ({ C, H, U }) => U([C(-0.32, -0.05, 0.18), C(-0.1, 0.1, 0.24), C(0.17, 0.08, 0.22), C(0.35, -0.06, 0.15),
      H([C(-0.36, -0.15, 0.08), C(0.36, -0.15, 0.08), C(-0.36, -0.05, 0.08), C(0.36, -0.05, 0.08)])]),
  },
  crown: {
    factor: 1.25, join: -0.04,
    build: ({ C, H, U, P }) => {
      const b = (x, y) => C(x, y, 0.05);
      return U([
        H([b(-0.45, -0.15), b(0.45, -0.15), b(-0.45, 0.14), b(0.45, 0.14)]),
        P([[-0.5, 0.1], [-0.46, 0.42], [-0.24, 0.2], [0, 0.47], [0.24, 0.2], [0.46, 0.42], [0.5, 0.1]]),
        C(-0.46, 0.44, 0.055), C(0, 0.5, 0.06), C(0.46, 0.44, 0.055),
      ]);
    },
  },
  circle: { factor: 1.15, join: 0, build: ({ C }) => C(0, 0, 0.5) },
};
const shapeKit = ({ o, CS }) => ({
  C: (x, y, r, n = 128) => o(o(CS.circle(r, n)).translate([x, y])),
  H: (list) => o(CS.hull(list)),
  U: (list) => o(CS.union(list)),
  P: (pts) => o(new CS([pts], 'NonZero')),
});
const halfPlane = (S, y0, up = true) => S.o(S.o(S.CS.square([2000, 2000])).translate([-1000, up ? y0 : y0 - 2000]));

// Client silhouette (PNG/JPG): outer rings of the traced foreground, 50 mm tall, y up.
function customSilhouette(S, img, warnings) {
  if (!img) { warnings.push('Sube una imagen para "Tu silueta"; mientras tanto se usa la forma clásica.'); return null; }
  const tr = cachedTrace(img, 50, { minFeature: 2, tolerance: 40, invert: false }, 20);
  const cs = shapesToCS(S, (tr.white || []).map((rings) => [rings[0]]), 'NonZero', 0.05);
  if (!cs || cs.isEmpty()) { warnings.push('No se pudo trazar la silueta de la imagen; se usa la forma clásica.'); return null; }
  const b = cs.bounds();
  return { cs, def: { factor: 1.2, join: b.max[1] - 0.55 * (b.max[1] - b.min[1]) } };
}

// ------------------------------------------------------------------ hinge sections (2D, engine)
// (s, v) hinge frame / (s', v') leg frame; toYZ maps (s, v) → (y, z) for alongX.
function halfPlaneN(S, n, d) {   // {p : n·p ≥ d}, n unit
  const { o, CS } = S;
  const sq = o(o(CS.square([2000, 2000])).translate([0, -1000]));
  return o(o(sq.rotate(Math.atan2(n[1], n[0]) / D2R)).translate([n[0] * d, n[1] * d]));
}
const toYZ = (S, mech, cs) => S.o(S.o(cs.mirror([1, 0])).translate([mech.yh, mech.R]));

// Union of a leg-frame section over poses (deg) = the space it sweeps. Steps keep the chord at radius rho ≤ 1.2·c,
// so a section offset by c (round joins) still clears ≥ 0.8·c between the sampled poses.
function sweep2D(S, cs, keys, rho, c) {
  const step = Math.min(1, (1.2 * c) / rho / D2R);
  const list = [];
  for (let i = 0; i + 1 < keys.length; i++) {
    const n = Math.max(1, Math.ceil((keys[i + 1] - keys[i]) / step - 1e-9));
    for (let k = i ? 1 : 0; k <= n; k++) list.push(S.o(cs.rotate(-(keys[i] + ((keys[i + 1] - keys[i]) * k) / n))));
  }
  return S.o(S.CS.union(list));
}

function hingeSections(S, mech) {
  const { o, CS } = S, { R, c, tc, rt, T1, J, K, Hend, latch, phiS, tipR, rA, sC } = mech;
  // leg side profile: barrel + neck + keel + slanted front face + round tip (back face flat at s' = −R)
  const a0 = Math.atan2(T1[1] - tc[1], T1[0] - tc[0]);
  const pts = [[-R, 0], [-0.5, 0], J, K, T1];
  for (let i = 1; i <= 24; i++) { const a = a0 + ((Math.PI - a0) * i) / 24; pts.push([tc[0] + rt * Math.cos(a), tc[1] + rt * Math.sin(a)]); }
  const prof = o(o(new CS([pts], 'NonZero')).add(circle(S, 0, 0, R, 128)));
  // flat foot under the barrel where it sits on the bed (print pose), inside the slot's swept clearance
  const k = Math.SQRT1_2 * R, q = (Math.SQRT2 - 1) * R;
  const foot = o(o(o(new CS([[[-k, -k], [-q, -R], [q, -R], [k, -k]]], 'NonZero')).intersect(circle(S, 0, 0, R + c - 0.1, 128))).rotate(PHI_PRINT));
  const legMid = o(prof.add(foot));
  // side plates: the leg above the barrel's clearance; latch notch on the back-top corner
  let plate = o(prof.intersect(roundRect(S, -50, 50, R + c, Hend)));
  if (latch) plate = o(plate.subtract(halfPlaneN(S, [-Math.SQRT1_2, Math.SQRT1_2], latch.kn * Math.SQRT1_2)));
  // body cuts: through slot round the axis (its back wall is the stop) + all the leg sweeps while folding
  const off = (cs) => o(cs.offset(c, 'Round', 2, 64));
  const midCarve = o(roundRect(S, sC, R + c, -R - 1, R + 1).add(sweep2D(S, off(legMid), [PHI_PRINT, 90, PHI_END], tipR + c, c)));
  const endCarve = sweep2D(S, off(plate), [phiS - 1, phiS, PHI_PRINT, 90, PHI_END], rA, c);
  const sec = { prof, legMid, plate, midCarve, endCarve };
  phoneSeat(S, mech, () => sec);
  return sec;
}

// Phone seat at the stand pose: the phone's back leans on the leg's front face (plane n·p = a) and its bottom edge
// slides down until it meets the body's mid section (the V groove the folded leg leaves) or the table: u·p = b.
// Also the thickest phone (case included) that clears the body's top edges, and the phone's centre of gravity.
// Sets mech.seat and mech.cgNeed (y the footprint must reach: portrait phone, landscape on the short variant).
const seatCache = new Map();
function phoneSeat(S, mech, sections) {
  const key = [mech.size, mech.c, mech.latch ? mech.latch.e.toFixed(5) : 0].join('|');
  let seat = seatCache.get(key);
  if (!seat) {
    const sec = sections(), { o } = S, { R, yh, phoneAngle: pa } = mech;
    const n = [Math.sin(pa * D2R), Math.cos(pa * D2R)], u = [-Math.cos(pa * D2R), Math.sin(pa * D2R)];
    const dot = (w, p) => w[0] * p[0] + w[1] * p[1];
    let a = -Infinity;
    for (const p of o(sec.prof.rotate(-mech.phiS)).toPolygons()) for (const v of p) a = Math.max(a, dot(n, v));
    const pts = [];
    for (const p of o(roundRect(S, -40, yh, -R, R).subtract(sec.midCarve)).toPolygons()) {
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const A = p[j], B = p[i], m = Math.max(1, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) / 0.1));
        for (let k = 0; k < m; k++) pts.push([A[0] + ((B[0] - A[0]) * k) / m, A[1] + ((B[1] - A[1]) * k) / m]);
      }
    }
    for (let s = -40; s <= yh + 60; s += 0.1) pts.push([s, -R]);   // the table
    const bAt = (t) => {
      let b = -Infinity;
      for (const p of pts) { const d = dot(n, p); if (d >= a && d <= a + t) b = Math.max(b, dot(u, p)); }
      return b;
    };
    const b = bAt(9);
    // top-face edges in front of the phone (front wall, side walls, snap lips): a thicker phone would sit on them
    const edge = (cs) => maxAt(cs.toPolygons(), 1, R - 0.01);
    const cands = [[edge(sec.midCarve), R], [edge(sec.endCarve), R], [yh, R]];
    if (mech.latch) cands.push([mech.sA - mech.latch.e, R]);
    let tMax = Infinity;
    for (const p of cands) if (Number.isFinite(p[0]) && dot(u, p) > b + 0.3) tMax = Math.min(tMax, dot(n, p) - a);
    const cgY = (H, t) => yh - (n[0] * (a + t / 2) + u[0] * (bAt(t) + H / 2));
    seat = { n, u, a, b, bMin: bAt(6), tMax, cgPortrait: cgY(160, 9), cgLandscape: cgY(75, 9) };
    seatCache.set(key, seat);
    if (seatCache.size > 32) seatCache.delete(seatCache.keys().next().value);
  }
  mech.seat = seat;
  mech.cgNeed = mech.variant === 'short' ? seat.cgLandscape : seat.cgPortrait;
  return seat;
}

// Card outline: body rectangle (hinge zone + bar) topped by the decorative shape. The shape is pushed up until the
// stand cannot tip backwards with the phone on it (convex footprint ≥ 5 mm behind the phone's CG: portrait on the
// standard variant, landscape on the short one) and, on the short variant, until at least 0.6·width of it shows
// behind the hinge zone (room for the key ring and the logo); grow (mm) moves it further back (room for the NFC
// chip). In the hinge zone nothing may stick out past the body's sides (the leg's side plates fold down there and
// the phone rests on it).
function makeOutline(S, mech, cfg, shapeImage, warnings, grow = 0) {
  const { o, CS } = S;
  const W = mech.W, sc = cfg.shapeScale / 100;
  let id = cfg.shape, def = SHAPE_DEFS[id], unit = null;
  if (id === 'custom') {
    const cust = customSilhouette(S, shapeImage, warnings);
    if (cust) { unit = cust.cs; def = cust.def; } else id = 'classic';
  }
  let raw, yTop, yRect;
  const minTop = mech.variant === 'short' ? mech.yh0 + 0.6 * W * sc : -Infinity;
  if (id === 'classic') {
    yTop = Math.max(mech.ym + 24 * sc, mech.cgNeed + 5, minTop) + grow;
    yRect = yTop;
    raw = o(CS.union([roundRect(S, -W / 2, W / 2, 0, yTop - 10, 4), roundRect(S, -W / 2, W / 2, 10, yTop, 9)]));
  } else {
    if (!unit) {
      const kit = shapeKit(S);
      unit = def.build(kit);
      if (def.bail && cfg.ring.enabled) unit = o(unit.add(kit.C(...def.bail)));
    }
    const ub = unit.bounds();
    const k = (W * def.factor * sc) / (ub.max[0] - ub.min[0]);
    let mm = o(o(unit.translate([-(ub.min[0] + ub.max[0]) / 2, -def.join])).scale([k, k]));
    if (def.tipRound) mm = o(o(mm.offset(-def.tipRound, 'Round', 2, 48)).offset(def.tipRound, 'Round', 2, 48));
    const mb = mm.bounds();
    const hullTop = maxAt(o(mm.hull()).toPolygons(), 0, 0);
    const joinDrop = mb.max[1], hullDrop = Number.isFinite(hullTop) ? mb.max[1] - hullTop : 0;
    yTop = Math.max(mech.ym + joinDrop, mech.cgNeed + 5 + hullDrop, minTop) + grow;
    yRect = yTop - joinDrop;
    // nothing may stick out past the front edge, nor past the sides in the hinge zone
    const allowed = o(halfPlane(S, mech.yh0).add(roundRect(S, -W / 2, W / 2, 0, mech.yh0 + 0.01)));
    const placed = o(o(mm.translate([0, yRect])).intersect(allowed));
    raw = o(CS.union([roundRect(S, -W / 2, W / 2, 0, yRect, 4), placed]));
    if (cfg.shape === 'custom') {
      const ch = crossings(placed.toPolygons(), 1, yRect - 0.5);
      if (!ch.length || Math.max(...ch) < W / 2 - 0.5 || Math.min(...ch) > -W / 2 + 0.5)
        warnings.push('Tu silueta es más angosta que el cuerpo donde se une: se verán las esquinas del cuerpo.');
    }
  }
  // close (fillets r 3 where the shape meets the body), open (drops < 2 mm slivers/needles), tidy
  let out = o(o(o(raw.offset(3, 'Round', 2, 64)).offset(-3, 'Round', 2, 64)).offset(-1, 'Round', 2, 48));
  out = o(o(out.offset(1, 'Round', 2, 48)).simplify(0.005));
  const comps = out.decompose().map(o);
  if (comps.length > 1) {
    const main = comps.find((cmp) => inside(cmp.toPolygons(), [0, 2])) || comps[0];
    warnings.push('Partes sueltas de la forma se quitaron (no estaban unidas al cuerpo).');
    out = main;
  }
  const b = out.bounds();
  return { outline: out, polys: out.toPolygons(), yTop: b.max[1], yRect, shapeId: id };
}

// Key-ring hole: on the centre line as high as the wall allows (falls back to the region's topmost point).
function ringSpot(S, deco, cfg, warnings) {
  if (!cfg.ring.enabled) return null;
  const r = cfg.ring.diameter / 2;
  const inset = S.o(deco.offset(-(r + cfg.ring.wall), 'Round', 2, 48));
  if (inset.isEmpty()) { warnings.push('No cabe el agujero del llavero: aumenta el tamaño de la forma.'); return null; }
  const polys = inset.toPolygons();
  const y = maxAt(polys, 0, 0);
  if (Number.isFinite(y)) return { x: 0, y: y - 0.05, r };
  let best = null;
  for (const p of polys) for (const v of p) if (!best || v[1] > best[1]) best = v;
  return { x: best[0], y: best[1] - 0.05, r };
}
// ------------------------------------------------------------------ logo / brand text
// Two places on the body's top face, behind the hinge zone (nothing goes on the leg: its faces are the phone rest
// and the lid of the folded keychain): 'bar' = a line right behind the hinge (standard variant; on the short one it
// joins 'top') and 'top' = the decorative shape — the whole face behind the hinge zone when the bar is free, else
// what the bar's block leaves behind it. Both keep clear of the key ring.
function shapeRegion(S, outline, ring, y0) {
  const { o } = S;
  let fit = o(o(outline.offset(-1.8, 'Round', 2, 48)).intersect(halfPlane(S, y0 + 0.5)));
  let clip = o(o(outline.offset(-0.8, 'Round', 2, 48)).intersect(halfPlane(S, y0 + 0.1)));
  if (ring) {
    fit = o(fit.subtract(circle(S, ring.x, ring.y, ring.r + 1.6)));
    clip = o(clip.subtract(circle(S, ring.x, ring.y, ring.r + 1)));
  }
  return { fit, clip, name: 'la forma' };
}

function buildArt(S, mech, cfg, outline, ring, { logoImage, font }, warnings) {
  const hasLogo = !!(logoImage && cfg.logo.enabled);
  const wantText = !!(cfg.text.enabled && cfg.text.value.trim());
  if (wantText && !font) warnings.push('No se pudo cargar la fuente del texto; se omite el texto.');
  const hasText = wantText && !!font;
  const at = (w) => (w === 'bar' && mech.variant !== 'short' ? 'bar' : 'top');
  const used = { top: { logo: false, text: false }, bar: { logo: false, text: false } };
  if (hasLogo) used[at(cfg.logo.where)].logo = true;
  if (hasText) used[at(cfg.text.where)].text = true;
  const out = { top: null, bar: null };
  let y0 = mech.yh0;
  if (used.bar.logo || used.bar.text) {
    const x = mech.W / 2, ya = mech.yh0, yb = mech.ym;
    const bar = { fit: roundRect(S, -x + 1.5, x - 1.5, ya + 0.5, yb - 0.5, 2), clip: roundRect(S, -x + 0.8, x - 0.8, ya + 0.2, yb - 0.1, 2), name: 'la barra' };
    out.bar = fitBlock(S, bar, used.bar, cfg, { logoImage, font }, warnings, 'low');
    y0 = out.bar ? out.bar.box.cy + out.bar.box.h / 2 + 1.2 : mech.ym;
  }
  if (used.top.logo || used.top.text) out.top = fitBlock(S, shapeRegion(S, outline, ring, y0), used.top, cfg, { logoImage, font }, warnings);
  return out;
}

// The block (logo with the text under it when both share the place) is fitted as large as possible inside the
// region, then rebuilt at its real size so the trace honours the minimum printable feature.
function fitBlock(S, region, items, cfg, { logoImage, font }, warnings, prefer = 'centre') {
  const { o, CS } = S;
  const { fit: fitR, clip: clipR, name } = region;
  if (fitR.isEmpty()) { warnings.push(`No queda espacio para el logo/texto en ${name}.`); return null; }
  const compose = (H) => {
    let logoCS = null, textCS = null, cap = 0;
    if (items.logo) {
      const cs = shapesToCS(S, cachedTrace(logoImage, H, cfg.logo, 1.5).white || [], 'EvenOdd', 0.03);
      if (cs && !cs.isEmpty()) { const b = cs.bounds(); logoCS = o(cs.translate([-(b.min[0] + b.max[0]) / 2, -b.min[1]])); }
    }
    if (items.text) {
      cap = logoCS ? (cfg.text.rel / 100) * H : H;
      const glyphs = layoutText(font, cfg.text.value.trim(), cap / capHeightRatio(font), 0);
      const cs = shapesToCS(S, glyphs.map((g) => g.contours), 'NonZero', 0.02);
      if (cs && !cs.isEmpty()) { const b = cs.bounds(); textCS = o(cs.translate([-(b.min[0] + b.max[0]) / 2, (logoCS ? -0.12 * H : 0) - b.max[1]])); }
    }
    const parts = [logoCS, textCS].filter(Boolean);
    if (!parts.length) return null;
    const u = parts.length > 1 ? o(CS.union(parts)) : parts[0];
    const b = u.bounds();
    return { cs: o(u.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2])), w: b.max[0] - b.min[0], h: b.max[1] - b.min[1], cap };
  };

  const Hn = items.logo ? 30 : 10;
  const nom = compose(Hn);
  if (!nom) { warnings.push(items.logo ? 'No se encontró el logo en la imagen (¿fondo sin contraste?).' : 'El texto quedó vacío.'); return null; }
  const hull = o(nom.cs.hull());
  const fb = fitR.bounds();
  const mid = (fb.min[0] + fb.max[0]) / 2, xc = Math.abs(mid) < 0.5 ? 0 : mid;
  const sHi = Math.min((fb.max[0] - fb.min[0]) / nom.w, (fb.max[1] - fb.min[1]) / nom.h);
  const tolA = 1e-4 * nom.w * nom.h;
  const fits = (s, yc) => {
    const a = hull.scale([s, s]), b = a.translate([xc, yc]), d = b.subtract(fitR);
    const ok = d.area() <= tolA * s * s;
    a.delete(); b.delete(); d.delete();
    return ok;
  };
  const best = { s: 0, yc: (fb.min[1] + fb.max[1]) / 2 };
  const yMid = best.yc;
  // largest block wins; near-ties (< 0.5 %) go to the most centred position (prefer 'low': the one nearest the hinge)
  const better = (yc) => (prefer === 'low' ? yc < best.yc : Math.abs(yc - yMid) < Math.abs(best.yc - yMid));
  const scan = (y0, y1, step, iters) => {
    for (let yc = y0; yc <= y1 + 1e-9; yc += step) {
      let lo = 0, hi = sHi;
      for (let i = 0; i < iters; i++) { const m = (lo + hi) / 2; if (fits(m, yc)) lo = m; else hi = m; }
      if (lo > best.s * 1.005 || (lo > best.s * 0.995 && better(yc))) { best.s = Math.max(lo, best.s); best.yc = yc; }
    }
  };
  scan(fb.min[1], fb.max[1], 1, 12);
  scan(best.yc - 1, best.yc + 1, 0.25, 18);
  if (best.s <= 0.02) { warnings.push(`No cabe el logo/texto en ${name}: agranda la forma o el ancho.`); return null; }

  const size = items.logo ? cfg.logo.size : cfg.text.size;
  const [dx, dy] = items.logo ? [cfg.logo.dx, cfg.logo.dy] : [0, 0];
  const fin = compose(Hn * best.s * (size / 100));
  if (!fin) { warnings.push(`El ${items.logo ? 'logo' : 'texto'} queda demasiado pequeño en ${name} para imprimirse: agranda la forma o el ancho.`); return null; }
  let cs = o(fin.cs.translate([xc + dx, best.yc + dy]));
  const a0 = cs.area();
  cs = o(cs.intersect(clipR));
  const lost = a0 > 0 ? 1 - cs.area() / a0 : 0;
  if (lost > 0.01) warnings.push(`El ${items.logo ? 'logo' : 'texto'} se recorta en el borde de ${name} (${Math.round(lost * 100)} %): reduce el tamaño o muévelo.`);
  cs = o(o(o(cs.offset(-0.2, 'Round', 2, 24)).offset(0.2, 'Round', 2, 24)).simplify(0.002));
  if (cs.isEmpty()) { warnings.push(`El logo/texto de ${name} quedó vacío después de ajustarlo.`); return null; }
  // strokes under 0.6 mm (below what a 0.4 mm nozzle lays down reliably): what a 0.3 mm opening removes,
  // ignoring the corner slivers it also trims
  const thin = o(o(cs.offset(-0.3, 'Round', 2, 24)).offset(0.3, 'Round', 2, 24));
  const thinLost = o(o(o(cs.subtract(thin)).offset(-0.15, 'Round', 2, 16)).offset(0.15, 'Round', 2, 16));
  if (thinLost.area() > 0.02 * cs.area()) warnings.push(`El ${items.logo ? 'logo' : 'texto'} de ${name} tiene trazos de menos de 0,6 mm: súbele el tamaño para que se imprima bien.`);
  if (items.text && fin.cap < 3) warnings.push(`Texto muy pequeño en ${name} (${fmt(fin.cap)} mm de alto): puede no leerse.`);
  const b = cs.bounds();
  return { cs, items, box: { cx: (b.min[0] + b.max[0]) / 2, cy: (b.min[1] + b.max[1]) / 2, w: b.max[0] - b.min[0], h: b.max[1] - b.min[1] }, cap: fin.cap, fit: best.s };
}

// ------------------------------------------------------------------ NFC pocket (print pause drops the chip in)
// In the body behind the hinge zone, clear of the key ring, ≥ 1.2 mm under the top face (≥ 0.8 mm under an
// engraved/inlaid logo or the tap sign) so the phone reads it through the plastic. where: 'bar' = right behind the
// hinge, 'top' = middle of the decorative shape, 'auto' = under the logo/text (tap it) or in the middle.
// nfcRegion = where the chip's centre may go (1.5 mm walls round it); the shape grows until it is not empty.
function nfcRegion(S, mech, cfg, outline, ring) {
  const { o } = S, r = cfg.nfc.diameter / 2;
  let reg = o(o(outline.intersect(halfPlane(S, mech.yh0))).offset(-(r + 1.5), 'Round', 2, 48));
  if (ring && !reg.isEmpty()) reg = o(reg.subtract(circle(S, ring.x, ring.y, ring.r + 1.5 + r)));
  return reg;
}
function placeNfc(S, mech, cfg, outline, ring, art, warnings) {
  if (!cfg.nfc.enabled) return null;
  const T = mech.T, r = cfg.nfc.diameter / 2, where = cfg.nfc.where;
  const reg = nfcRegion(S, mech, cfg, outline, ring);
  if (reg.isEmpty()) {
    warnings.push(`El chip NFC de Ø${fmt(cfg.nfc.diameter)} mm no cabe detrás de la bisagra: agranda la forma o el ancho, o usa un chip más pequeño.`);
    return null;
  }
  const yTop = outline.bounds().max[1];
  const artAt = (a) => [a.box.cx, a.box.cy];
  const target = where === 'bar' ? [0, mech.yh0] : where === 'top' ? [0, (mech.ym + yTop) / 2]
    : art.top ? artAt(art.top) : art.bar ? artAt(art.bar) : [0, (mech.yh0 + yTop) / 2];
  const [x, y] = nearestIn(reg.toPolygons(), target);
  const hit = (a) => !!a && rectHitsCircle(a.box.cx - a.box.w / 2, a.box.cx + a.box.w / 2, a.box.cy - a.box.h / 2, a.box.cy + a.box.h / 2, { x, y, r });
  const over = [art.top, art.bar].filter(hit), covered = over.length > 0;
  const under = covered ? (over.some((a) => a.items.logo) ? 'logo' : 'texto') : null;   // what to tap
  const mark = cfg.nfc.mark && !covered;
  // the tap sign is made like the logo: an engraved/inlaid one sinks into the face just as deep
  const sunk = (covered || mark) && cfg.logo.mode !== 'relief' ? cfg.logo.depth : 0;
  const dep = Math.ceil(cfg.nfc.depth / LAYER - 1e-6) * LAYER;
  const z1 = Math.round(Math.floor((T - Math.max(1.2, sunk + 0.8)) / LAYER + 1e-6) * LAYER * 100) / 100;
  const z0 = Math.round((z1 - dep) * 100) / 100;
  return { where, x, y, r, z0, z1, mark, covered, under };
}

// Contactless sign (dot + 3 arcs) over the chip so people know where to tap the phone. Made like the logo (relief,
// inlay or engraved, in its colour); lines ≥ 0.8 mm and gaps ≥ 0.6 mm wide so they print.
function nfcMark(S, nfc) {
  const { o, CS } = S;
  const k = Math.min(1.3, Math.max(0.8, nfc.r / 12.75)), L = 20 * k, hw = Math.max(0.4, 0.45 * k);
  const fan = o(new CS([[[0, 0], ...[-50, -25, 0, 25, 50].map((a) => [L * Math.cos(a * D2R), L * Math.sin(a * D2R)])]], 'NonZero'));
  const parts = [circle(S, 0, 0, Math.max(1, 1.1 * k), 32)];
  for (const rr of [2.6, 4.4, 6.2]) parts.push(o(o(circle(S, 0, 0, rr * k + hw, 96).subtract(circle(S, 0, 0, rr * k - hw, 96))).intersect(fan)));
  return o(o(CS.union(parts)).translate([nfc.x - 2.8 * k, nfc.y]));
}

// ------------------------------------------------------------------ can-tab opener: a slit open to a side edge
// The thin lip under the slit (1 mm at the mouth) slides under the can's tab; lever up to open. The slit may turn
// (−45°…60° from the chosen side) to sit square on a curved edge; straighter edges and a plain side slot win.
function placeOpener(mech, cfg, polys, yTop, ring, nfc, warnings) {
  if (!cfg.opener.enabled) return null;
  const sg = cfg.opener.side === 'left' ? -1 : 1;
  const P0 = sg > 0 ? polys : polys.map((p) => p.map(([x, y]) => [-x, y]));
  const keep0 = [];
  if (ring) keep0.push({ x: sg * ring.x, y: ring.y, r: ring.r + 2.5 });
  if (nfc && nfc.z0 - SLOT.top < 1) keep0.push({ x: sg * nfc.x, y: nfc.y, r: nfc.r + 1 });
  // 1.5 mm clear of the hinge zone (slot, knuckles, folding leg): only on the bar or the shape behind it
  const yKeep = mech.yh0 + 1.5, W2 = mech.W;
  const win0 = [[-W2, -50], [W2, -50], [W2, yKeep], [-W2, yKeep]];
  const step = 0.5, nLen = Math.round(SLOT.len / step), nWall = Math.round(SLOT.wall / step);
  let best = null;
  for (let deg = -45; deg <= 60; deg += 5) {
    // frame where the slit runs along +x: the shape turned by −deg
    const a = -deg * D2R, ca = Math.cos(a), sa = Math.sin(a);
    const rot = ([x, y]) => [x * ca - y * sa, x * sa + y * ca];
    const P = P0.map((p) => p.map(rot));
    const keep = keep0.map((k) => { const [x, y] = rot([k.x, k.y]); return { x, y, r: k.r }; });
    const win = win0.map(rot);
    let ymin = Infinity, ymax = -Infinity;
    for (const p of P) for (const v of p) { if (v[1] < ymin) ymin = v[1]; if (v[1] > ymax) ymax = v[1]; }
    const y0 = Math.ceil(ymin / step) * step, n = Math.floor((ymax - y0) / step) + 1;
    const CR = [], X = [];
    for (let i = 0; i < n; i++) { const cr = crossings(P, 1, y0 + i * step); CR.push(cr); X.push(cr.length ? Math.max(...cr) : -Infinity); }
    // the mouth must be the frontmost part of the shape in its direction: you lever on the lid right at the lip,
    // anything sticking out further (an ear, a lobe) would dig into the can first
    const front = Math.max(...X);
    for (let i = nWall; i + nLen + nWall < n; i++) {
      let lo = Infinity, hi = -Infinity;
      for (let k = i; k <= i + nLen; k++) { if (X[k] < lo) lo = X[k]; if (X[k] > hi) hi = X[k]; }
      if (!(hi - lo <= 6) || hi < front - 1) continue;
      const xin = lo - SLOT.depth, ys = y0 + i * step, y1 = ys + SLOT.len, x1 = xin + 16;
      // solid from 3 mm behind the slit out to the edge, 2.5 mm past both of its sides (no gaps, no other lobe)
      let solid = true;
      for (let k = i - nWall; k <= i + nLen + nWall && solid; k++) solid = X[k] >= xin + 3 && CR[k].filter((x) => x > xin - 3).length === 1;
      if (!solid || rectHitsPoly(xin, x1, ys, y1, win) || keep.some((c) => rectHitsCircle(xin, x1, ys, y1, c))) continue;
      const score = hi - lo + 0.02 * Math.abs(deg) - 0.01 * lo;
      if (!best || score < best.score) best = { score, deg, xin, ys, edge: lo };
    }
  }
  if (!best) {
    warnings.push('No hay un borde libre de 16 mm para el abre latas: prueba el otro lado, otra forma o una forma más grande.');
    return null;
  }
  return { side: cfg.opener.side, sg, angle: best.deg, xin: best.xin, ys: best.ys, edge: best.edge, len: SLOT.len, depth: SLOT.depth, lip: SLOT.mouth };
}
function openerCutter(S, mech, op) {
  const { o, CS } = S;
  // the edge varies ≤ 6 mm along the slit: run the cut ≥ 4 mm past it so no skin closes the mouth
  const { xin, ys } = op, x2 = xin + SLOT.depth + 10;
  const prof = o(new CS([[[xin, SLOT.inner], [xin + SLOT.depth, SLOT.mouth], [x2, SLOT.mouth], [x2, SLOT.top], [xin, SLOT.top]]], 'NonZero'));
  const plan = extrudeZ(S, roundRect(S, xin, x2 + 3, ys, ys + SLOT.len, 3), -1, mech.T + 1);
  let cut = o(alongY(S, prof, ys, ys + SLOT.len).intersect(plan));
  if (op.angle) cut = o(cut.rotate([0, 0, op.angle]));
  return op.sg < 0 ? o(cut.mirror([1, 0, 0])) : cut;
}
// ------------------------------------------------------------------ solids
// Returns live manifold solids (caller must call dispose()). body = frame with the slot, stop, V groove, side
// knuckles, cone pins and snap lips; leg = hinged leg as printed (standing in its slot, PHI_PRINT); art pieces;
// chip = preview of the NFC chip (never exported).
export function phoneStandSolids(cfgIn, { logoImage = null, shapeImage = null, font = null } = {}) {
  if (!engine) throw new Error('El motor 3D no está listo: llama a preparePhoneStand() primero.');
  const { Manifold: M, CrossSection: CS } = engine;
  const o = makeScope(), S = { o, CS, M };
  try {
    const mech = phoneStandMechanism(cfgIn), cfg = mech.cfg;
    const { W, T, R, c, xm, yh, rc, sock, sC } = mech;
    const warnings = [];
    if (rc < cfg.pin - 0.01) warnings.push(`Pasador de la bisagra limitado a Ø${fmt(2 * rc)} mm por el grosor.`);
    const sec = hingeSections(S, mech), seat = mech.seat;

    // the shape moves back (longer neck) in 2 mm steps until the NFC chip and the can opener fit behind the hinge
    // zone; if they never both fit, the first growth where one of them fits stays (chip first, else none) and
    // placeNfc / placeOpener warn about the other
    let shp, ring, wShape;
    const fitsAt = (g) => {
      wShape = [];
      shp = makeOutline(S, mech, cfg, shapeImage, wShape, g);
      ring = ringSpot(S, o(shp.outline.intersect(halfPlane(S, mech.ym))), cfg, wShape);
      return [
        !cfg.nfc.enabled || !nfcRegion(S, mech, cfg, shp.outline, ring).isEmpty(),
        !cfg.opener.enabled || !!placeOpener(mech, cfg, shp.polys, shp.yTop, ring, null, []),
      ];
    };
    const first = [-1, -1];
    let grow = -1;
    for (let g = 0; g <= GROW_MAX && grow < 0; g += 2) {
      const ok = fitsAt(g);
      ok.forEach((v, k) => { if (v && first[k] < 0) first[k] = g; });
      if (ok[0] && ok[1]) grow = g;
    }
    if (grow < 0) { grow = Math.max(first[0] >= 0 ? first[0] : first[1], 0); fitsAt(grow); }
    const growFor = grow ? ['nfc', 'opener'].filter((k, i) => first[i] > 0 && first[i] <= grow) : [];
    warnings.push(...wShape);
    const { outline, polys, yTop } = shp;
    const art = buildArt(S, mech, cfg, outline, ring, { logoImage, font }, warnings);
    const nfc = placeNfc(S, mech, cfg, outline, ring, art, warnings);
    const opener = placeOpener(mech, cfg, polys, yTop, ring, nfc, warnings);

    const both = (m) => o(m.add(o(m.mirror([1, 0, 0]))));
    // a solid riding on the leg, turned about the hinge axis by deg (pose relative to the frame of m)
    const pose = (m, deg) => o(o(o(m.translate([0, -yh, -R])).rotate([deg, 0, 0])).translate([0, yh, R]));
    const slab = extrudeZ(S, outline, 0, T);
    const midCut = alongX(S, toYZ(S, mech, sec.midCarve), -(xm + c), xm + c);
    // side knuckles: what the plates' sweep leaves of the end zones, kept as a 45° cone round the axis (normal gap
    // c to the plates' 45° undersides)
    const kh = END_W + 1 + c, kr = R - c * Math.SQRT2;
    const knuckle = o(o(o(M.cylinder(kh, kr, kr + kh, 96)).rotate([0, 90, 0])).translate([xm - c, yh, R]));
    const endCut = both(o(alongX(S, toYZ(S, mech, sec.endCarve), xm - c, W / 2 + 1).subtract(knuckle)));
    // the knuckles' front tops would prop the phone up out of its groove: bevel them back to the phone's plane
    const rK = R + c - c * Math.SQRT2 + END_W;
    const bev = o(o(halfPlaneN(S, seat.n, seat.a - 0.2).intersect(halfPlaneN(S, seat.u, seat.bMin - 0.3))).intersect(circle(S, 0, 0, rK + 1, 96)));
    const bevel = both(alongX(S, toYZ(S, mech, bev), xm + c, W / 2 + 1));
    let lips = null;
    if (mech.latch) {
      const e = mech.latch.e, sA = mech.sA;
      const tri = o(new CS([[[sA - e, R], [sA + 0.6, R], [sA + 0.6, R - e - 0.6]]], 'NonZero'));
      lips = o(both(alongX(S, toYZ(S, mech, tri), xm + c, W / 2)).intersect(slab));
    }
    // 45° cone pins on the knuckles' inner faces, matching 45° cone sockets in the leg (normal gap = c)
    const pin = o(o(o(o(M.cylinder(rc, rc, 0, 48)).add(o(o(M.cylinder(0.5, rc, rc, 48)).translate([0, 0, -0.5])))).rotate([0, -90, 0])).translate([xm + c, yh, R]));
    const hs = sock + 0.5;
    const socket = o(o(o(M.cylinder(hs, 0, hs, 48)).rotate([0, 90, 0])).translate([xm - sock, yh, R]));
    // elephant-foot reliefs where the barrel and the knuckles both stand on the bed 1 c apart
    const footCut = (pts, y0, y1) => both(alongY(S, o(new CS([pts], 'NonZero')), y0, y1));
    const kneeFoot = footCut([[xm + c - 1, -1], [xm + c + 1.5, -1], [xm + c - 1, 1.5]], yh - R - c, yh - sC);
    const barrelFoot = footCut([[xm - 1.5, -1], [xm + 1, -1], [xm + 1, 1.5]], yh - R - 2, yh + R + 2);
    const ringCut = ring ? o(o(M.cylinder(T + 2, ring.r, ring.r, 48)).translate([ring.x, ring.y, -1])) : null;
    const pocket = nfc ? o(o(M.cylinder(nfc.z1 - nfc.z0, nfc.r, nfc.r, 96)).translate([nfc.x, nfc.y, nfc.z0])) : null;
    const slot = opener ? openerCutter(S, mech, opener) : null;
    // logo/text per place and the NFC tap sign: relief piece on the face, or recess (+ inlay piece for a 2nd colour)
    const artSolid = (cs) => {
      if (!cs) return { piece: null, recess: null };
      if (cfg.logo.mode === 'relief') return { piece: extrudeZ(S, cs, T, T + cfg.logo.height), recess: null };
      return { recess: extrudeZ(S, cs, T - cfg.logo.depth, T + 1), piece: cfg.logo.mode === 'inlay' ? extrudeZ(S, cs, T - cfg.logo.depth, T) : null };
    };
    const artTop = artSolid(art.top?.cs), artBar = artSolid(art.bar?.cs), sign = artSolid(nfc?.mark ? nfcMark(S, nfc) : null);

    let body = o(o(o(slab.subtract(midCut)).subtract(endCut)).subtract(bevel));
    if (lips) body = o(body.add(lips));
    body = o(o(body.add(both(pin))).subtract(kneeFoot));
    for (const cut of [ringCut, pocket, slot, artTop.recess, artBar.recess, sign.recess]) if (cut) body = o(body.subtract(cut));

    // leg, built upright in the leg frame: middle (barrel, neck, keel, front face) + side plates over the knuckles
    // (45° undersides, no overhang), then turned to its print pose
    let leg = alongX(S, toYZ(S, mech, sec.legMid), -xm, xm);
    const keep = alongY(S, o(new CS([[[xm - 1, T + c], [xm, T + c], [W / 2 + 1, T + c + END_W + 1], [W / 2 + 1, T + mech.Ht + 2], [xm - 1, T + mech.Ht + 2]]], 'NonZero')), yh - 40, yh + 40);
    const plate = o(alongX(S, toYZ(S, mech, sec.plate), xm - 0.5, W / 2).intersect(keep));
    leg = o(o(leg.add(both(plate))).subtract(both(socket)));
    leg = o(pose(leg, PHI_PRINT).subtract(barrelFoot));
    const chip = nfc ? o(o(M.cylinder(Math.max(0.2, nfc.z1 - nfc.z0 - 0.1), nfc.r - 0.2, nfc.r - 0.2, 96)).translate([nfc.x, nfc.y, nfc.z0 + 0.05])) : null;

    // solid pieces only: a sealed NFC pocket is an inner shell (negative volume), not a loose piece
    const pieces = (m) => { const d = m.decompose(); const n = d.filter((x) => x.volume() > 1e-6).length; d.forEach((x) => x.delete()); return n; };
    const nBody = pieces(body), nLeg = pieces(leg);
    if (nBody !== 1) warnings.push(`El cuerpo quedó en ${nBody} piezas sueltas: cambia la forma, el tamaño o el abre latas.`);
    if (nLeg !== 1) warnings.push(`La pata quedó en ${nLeg} piezas sueltas.`);
    const gap = body.minGap(leg, 2);
    if (gap < 0.9 * c) warnings.push(`La pata queda a ${fmt(gap)} mm del cuerpo: puede salir pegada.`);

    const backAtCentre = maxAt(o(outline.hull()).toPolygons(), 0, 0);
    const stability = { portrait: backAtCentre - seat.cgPortrait, landscape: backAtCentre - seat.cgLandscape };
    if (mech.variant === 'short' && stability.portrait < 2) warnings.push('Variante corta: en vertical el celular puede volcarse hacia atrás; úsalo horizontal.');
    if (seat.tMax < 10) warnings.push(`Solo caben celulares de hasta ${fmt(seat.tMax)} mm de grosor (con forro).`);
    const bbox = (list) => list.map((m) => m.boundingBox()).reduce((u, b) => ({ min: u.min.map((v, i) => Math.min(v, b.min[i])), max: u.max.map((v, i) => Math.max(v, b.max[i])) }));
    const dims = (b) => ({ w: b.max[0] - b.min[0], l: b.max[1] - b.min[1], h: b.max[2] - b.min[2] });
    const solids = [body, leg, artTop.piece, artBar.piece, sign.piece].filter(Boolean);
    const vol = solids.reduce((s, m) => s + m.volume(), 0) / 1000;
    const closedLeg = pose(leg, mech.poses.closed);
    const artInfo = (a) => (a ? { ...a.box, cap: a.cap, logo: a.items.logo, text: a.items.text } : null);
    const info = {
      shape: { id: shp.shapeId, yTop, yRect: shp.yRect, grow, growFor },
      size: dims(bbox(solids)), closedSize: dims(bbox([body, closedLeg, artTop.piece, artBar.piece, sign.piece].filter(Boolean))),
      model: { size: mech.size, variant: mech.variant, thickness: T },
      poses: mech.poses,
      phone: { angle: mech.phoneAngle, tMax: seat.tMax, landscape: mech.variant === 'short' },
      stability,
      hinge: { pinDiameter: 2 * rc, socketWall: R - sock, gap, clearance: c, axis: { y: yh, z: R } },
      latch: mech.latch ? { e: mech.latch.e, interference: cfg.latch } : null,
      ring, nfc, opener,
      art: { mode: cfg.logo.mode, top: artInfo(art.top), bar: artInfo(art.bar) },
      volume: vol, grams: vol * DENSITY, parts: { body: nBody, leg: nLeg },
    };
    const pauses = nfc ? [{ z: nfc.z1, msg: NFC_PAUSE_MSG }] : [];
    return {
      body, leg, topArt: artTop.piece, barArt: artBar.piece, signArt: sign.piece, chip, art, outline, mech, cfg, info, warnings, pauses, sections: sec,
      pose, legAt: (deg) => pose(leg, deg), dispose: () => o.free(),
    };
  } catch (err) {
    o.free();
    throw err;
  }
}

// Phone mock-up (three.js) on the open stand: back on the leg's front face, bottom edge in the groove. Portrait on
// the standard variant, landscape on the short one.
function phoneMock(mech, t = 9) {
  const s = mech.seat, land = mech.variant === 'short';
  const H = land ? 72 : 150, w = land ? 150 : 72;
  const g = new THREE.BoxGeometry(w, t, H);
  g.applyMatrix4(new THREE.Matrix4().makeRotationX((mech.phoneAngle - 90) * D2R));
  const k1 = s.a + t / 2, k2 = s.b + H / 2;
  g.translate(0, mech.yh - (s.n[0] * k1 + s.u[0] * k2), mech.R + s.n[1] * k1 + s.u[1] * k2);
  return g;
}

// Ready-to-show/export result (three.js geometries). Requires preparePhoneStand() first.
// parts[i].moving marks pieces that turn with the leg about axis (x, axis.y, axis.z) — rotation.x = pose (rad),
// pose = info.poses.* in degrees from the print pose. parts[i].preview marks see-through helpers (NFC chip): shown
// in the 3D view only, never exported or counted as filament. parts[i].art marks the logo/text/📶 sign pieces (the
// view draws them over the see-through chip, as they sit over it).
export function buildPhoneStand(cfgIn, opts = {}) {
  const sol = phoneStandSolids(cfgIn, opts);
  try {
    const { cfg, mech, art } = sol, col = cfg.colors;
    const fil = (accent) => (accent ? { color: col.accent, filamentIndex: 1 } : { color: col.body, filamentIndex: 0 });
    const artName = (a) => (a.items.logo && a.items.text ? 'Logo y texto' : a.items.logo ? 'Logo' : 'Texto');
    const geo = (m) => meshGeometry(m.getMesh());
    const parts = [
      { name: 'Cuerpo', ...fil(false), geometry: geo(sol.body), moving: false },
      { name: 'Pata (bisagra)', ...fil(col.flapAccent), geometry: geo(sol.leg), moving: true },
    ];
    const deco = (name, m) => parts.push({ name, ...fil(col.twoColor), geometry: geo(m), moving: false, art: true });
    if (sol.topArt) deco(artName(art.top), sol.topArt);
    if (sol.barArt) deco(`${artName(art.bar)} (barra)`, sol.barArt);
    if (sol.signArt) deco('Señal NFC', sol.signArt);
    if (sol.chip) parts.push({ name: 'Chip NFC', color: '#d9a400', filamentIndex: -1, preview: true, geometry: geo(sol.chip), moving: false });
    return {
      cfg, mech, parts, pauses: sol.pauses, warnings: sol.warnings, info: sol.info,
      phone: phoneMock(mech), axis: { y: mech.yh, z: mech.R },
    };
  } finally {
    sol.dispose();
  }
}

// SVG previews of every top shape with the current measurements (hinge slot + key-ring hole cut out).
export function shapeThumbnails(cfgIn, { shapeImage = null } = {}) {
  if (!engine) throw new Error('El motor 3D no está listo: llama a preparePhoneStand() primero.');
  const o = makeScope(), S = { o, CS: engine.CrossSection };
  try {
    const mech = phoneStandMechanism(cfgIn);
    phoneSeat(S, mech, () => hingeSections(S, mech));
    const out = {};
    for (const s of PHONESTAND_SHAPES) {
      const w = [];
      const shp = makeOutline(S, mech, { ...mech.cfg, shape: s.id }, shapeImage, w);
      let cs = o(shp.outline.subtract(roundRect(S, -(mech.xm + mech.c), mech.xm + mech.c, 2.5, mech.yh - mech.sC, 1)));
      const ring = ringSpot(S, o(shp.outline.intersect(halfPlane(S, mech.ym))), mech.cfg, w);
      if (ring) cs = o(cs.subtract(circle(S, ring.x, ring.y, ring.r, 32)));
      const b = cs.bounds(), pad = 2;
      const d = cs.toPolygons().map((p) => 'M' + p.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join('L') + 'Z').join('');
      out[s.id] = { d, viewBox: `${(b.min[0] - pad).toFixed(2)} ${(-b.max[1] - pad).toFixed(2)} ${(b.max[0] - b.min[0] + 2 * pad).toFixed(2)} ${(b.max[1] - b.min[1] + 2 * pad).toFixed(2)}`, custom: s.id === 'custom' && shp.shapeId !== 'custom' };
    }
    return out;
  } finally {
    o.free();
  }
}

// ------------------------------------------------------------------ project file (.r3p)
// v1 = Relieve3D 1.17 (flat card + flap): read and migrated by normalizePhoneStand.
export function phoneStandProject(cfg, { logoSrc = null, shapeSrc = null } = {}) {
  return JSON.stringify({ app: PHONESTAND_PROJECT_APP, version: 2, cfg: normalizePhoneStand(cfg), logoSrc: logoSrc || null, shapeSrc: shapeSrc || null });
}
export function readPhoneStandProject(text) {
  let j;
  try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('El archivo no es un proyecto válido.'); }
  if (!j || j.app !== PHONESTAND_PROJECT_APP || !j.cfg) throw new Error('No es un proyecto de soporte de celular.');
  if (j.version !== 1 && j.version !== 2) throw new Error(`Versión de proyecto no compatible (${j.version}).`);
  const src = (v) => (typeof v === 'string' && /^data:image\//.test(v) ? v : null);
  return { cfg: normalizePhoneStand(j.cfg), logoSrc: src(j.logoSrc), shapeSrc: src(j.shapeSrc) };
}

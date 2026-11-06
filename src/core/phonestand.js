// Phone-stand keychain ("Soporte de celular llavero"): parametric print-in-place generator. Pure JS, no DOM.
// Original Relieve3D design (no third-party mesh is copied): a flat card printed lying down whose flap, held by a
// cone-pin hinge printed in place, flips up to hold a phone; a decorative top (heart, mouse head, flower…) with a
// key-ring hole; optional NFC pocket (print pause to drop the chip in), can-tab opener slot and the client's
// logo/brand in relief, inlay or engraving.
// Units: mm. Print orientation = use orientation: X width, Y length (front bar at y = 0, decorative top towards
// +Y), Z up (bed z = 0, top face z = T). The flap hinges about the X axis through (y = yh, z = T/2); opening by θ
// maps (u, w) = (y − yh, z − T/2) → (u·cosθ + w·sinθ, −u·sinθ + w·cosθ): the tip rises and leans back, the old
// bottom face becomes the face the phone leans on and the old top face swings onto the stop behind the hinge.
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
  width: 46,         // body width (rails + window)
  thickness: 7,      // card thickness T
  flapLength: 30,    // hinged flap length L (how high the phone leans on it)
  rail: 8,           // side rails beside the window
  frontBar: 7,       // bar in front of the window
  clearance: 0.4,    // print-in-place gap: hinge cones, flap sides, stop
  pin: 2.2,          // hinge cone radius (auto-limited by the thickness)
  ridge: 3,          // bumps that stop the phone sliding forward
  phoneAngle: 62,    // phone lean from the table, degrees
  ring: { enabled: true, diameter: 5, wall: 2.5 },
  nfc: { enabled: false, diameter: 25.5, depth: 1, where: 'auto' },   // where: 'auto' | 'top' | 'flap'
  opener: { enabled: false, side: 'right' },
  // logo/text: where = 'top' (decorative shape) | 'flap' (hinged tab, the big face of the closed keychain);
  // mode applies to both: relief (on top), inlay (flush, 2nd colour) or engrave (sunk)
  logo: { enabled: true, where: 'top', mode: 'relief', height: 0.8, depth: 0.6, size: 100, dx: 0, dy: 0, invert: false, minFeature: 1.2, tolerance: 40 },
  text: { enabled: false, where: 'flap', value: '', font: 'Montserrat Black', size: 100, rel: 28 },   // rel: cap height % of the logo height when they share a place
  colors: { body: '#f4e9dc', accent: '#e8127c', twoColor: true, flapAccent: false },
});

const num = (v, d, lo, hi) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : +v;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : d);

export function normalizePhoneStand(cfg = {}) {
  const D = DEFAULT_PHONESTAND();
  const c = { ...D, ...cfg };
  for (const k of ['ring', 'nfc', 'opener', 'logo', 'text', 'colors']) c[k] = { ...D[k], ...(cfg[k] || {}) };
  c.name = String(c.name || D.name).slice(0, 60);
  c.shape = PHONESTAND_SHAPES.some((s) => s.id === c.shape) ? c.shape : D.shape;
  c.shapeScale = num(c.shapeScale, D.shapeScale, 70, 140);
  c.width = num(c.width, D.width, 38, 60);
  c.thickness = num(c.thickness, D.thickness, 6, 10);
  c.flapLength = num(c.flapLength, D.flapLength, 22, 40);
  c.rail = num(c.rail, D.rail, 6, 12);
  c.frontBar = num(c.frontBar, D.frontBar, 5, 12);
  c.clearance = num(c.clearance, D.clearance, 0.2, 0.6);
  c.pin = num(c.pin, D.pin, 1.2, 4);
  c.ridge = num(c.ridge, D.ridge, 1.5, 5);
  c.phoneAngle = num(c.phoneAngle, D.phoneAngle, 50, 75);
  c.ring.enabled = c.ring.enabled !== false;
  c.ring.diameter = num(c.ring.diameter, D.ring.diameter, 3, 8);
  c.ring.wall = num(c.ring.wall, D.ring.wall, 1.6, 5);
  c.nfc.enabled = !!c.nfc.enabled;
  c.nfc.diameter = num(c.nfc.diameter, D.nfc.diameter, 10, 40);
  c.nfc.depth = num(c.nfc.depth, D.nfc.depth, 0.4, 2);
  c.nfc.where = ['auto', 'top', 'flap'].includes(c.nfc.where) ? c.nfc.where : 'auto';
  c.opener.enabled = !!c.opener.enabled;
  c.opener.side = c.opener.side === 'left' ? 'left' : 'right';
  c.logo.enabled = c.logo.enabled !== false;
  c.logo.where = c.logo.where === 'flap' ? 'flap' : 'top';
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
  c.text.where = c.text.where === 'top' ? 'top' : 'flap';
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

// Pure mechanism math (no geometry engine): hinge, stop, phone contact, stability.
export function phoneStandMechanism(cfgIn) {
  const cfg = normalizePhoneStand(cfgIn);
  const W = cfg.width, T = cfg.thickness, L = cfg.flapLength, R = cfg.rail, F = cfg.frontBar, c = cfg.clearance;
  const xw = W / 2 - R;                          // window half width
  const wf = 2 * (xw - c);                       // flap width
  const gf = Math.hypot(L, T / 2) - L + c;       // front gap: the tip corner swings out of radius √(L²+T²/4)
  const yh = F + gf + L;                         // hinge axis
  const phi = cfg.phoneAngle, thOpen = 180 - phi - 4;   // flap 4° steeper than the phone → it touches the tip
  const uE = (T / 2) * Math.tan((thOpen / 2) * D2R);    // stop edge on the top face: the open flap's back face meets it
  // stop face through E at distance T/2 + c from the axis: (T/2)·tan(θs/2) + c/sin θs = uE (g is increasing on [60°, θ])
  const d = T / 2 + c;
  const g = (s) => (T / 2) * Math.tan((s / 2) * D2R) + c / Math.sin(s * D2R) - uE;
  let lo = 60, hi = thOpen;
  for (let i = 0; i < 64; i++) { const m = (lo + hi) / 2; if (g(m) > 0) hi = m; else lo = m; }
  const thS = (lo + hi) / 2;
  const stopU = (w) => (d - w * Math.cos(thS * D2R)) / Math.sin(thS * D2R);
  const ym = yh + uE + 1;                        // end of the mechanism: the decorative region starts here
  const rcMax = T / 2 - 1 + c - c * Math.SQRT2;  // keeps ≥ 1 mm of flap around the socket
  const rc = Math.min(cfg.pin, rcMax);
  const rs = rc - c + c * Math.SQRT2;            // socket radius at the flap side face
  const th = thOpen * D2R, ph = phi * D2R;
  // phone: leans on the open flap's tip edge P, its back-bottom edge B rests on the rails, the ridges stop it
  const Pu = -L * Math.cos(th) - (T / 2) * Math.sin(th), Pw = L * Math.sin(th) - (T / 2) * Math.cos(th);
  const P = [yh + Pu, T / 2 + Pw];
  const By = P[0] - (P[1] - T) / Math.tan(ph);
  const yr = By - cfg.ridge * Math.tan(ph);
  const s = -(T / 2) * (1 + Math.cos(th)) / Math.sin(th);
  const flapAtTop = yh + s * Math.cos(th) - (T / 2) * Math.sin(th);
  const cg = (H, t) => By + (H / 2) * Math.cos(ph) - (t / 2) * Math.sin(ph);
  return {
    cfg, W, T, L, R, F, c, xw, wf, gf, yh, phi, thOpen, uE, thS, stopU, ym, rc, rcMax, rs,
    P, By, yr, flapAtTop, baseClear: flapAtTop - By, cgPortrait: cg(160, 9), cgLandscape: cg(75, 9),
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

// Card outline: body rectangle (front bar + rails + mechanism) topped by the decorative shape. The shape is
// pushed up until the stand cannot tip backwards with a tall phone (convex footprint ≥ 5 mm behind its CG).
function makeOutline(S, mech, cfg, shapeImage, warnings) {
  const { o, CS } = S;
  const W = mech.W, sc = cfg.shapeScale / 100;
  let id = cfg.shape, def = SHAPE_DEFS[id], unit = null;
  if (id === 'custom') {
    const cust = customSilhouette(S, shapeImage, warnings);
    if (cust) { unit = cust.cs; def = cust.def; } else id = 'classic';
  }
  let raw, yTop, yRect;
  if (id === 'classic') {
    yTop = Math.max(mech.ym + 24 * sc, mech.cgPortrait + 5);
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
    yTop = Math.max(mech.ym + joinDrop, mech.cgPortrait + 5 + hullDrop);
    yRect = yTop - joinDrop;
    // nothing may stick out past the front edge (a big heart's tip would poke out under the front bar)
    const placed = o(o(mm.translate([0, yRect])).intersect(halfPlane(S, 0)));
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
// Two places: 'top' (decorative shape, clear of the ring) and 'flap' (top face of the hinged tab, i.e. the big
// centre face of the closed keychain). Reliefs keep clear of the open flap's rest edge E: when open, the flap's
// old top face leans back from E at (180 − θ) and a relief on either side must fit inside that wedge.
function artRegions(S, mech, cfg, outline, ring, used) {
  const { o } = S;
  const a = (180 - mech.thOpen) * D2R, sa = Math.sin(a), ca = Math.cos(a);
  const relief = cfg.logo.mode === 'relief' ? cfg.logo.height : 0;
  const hf = used.flap ? relief : 0, ht = used.top ? relief : 0;
  const yE = mech.yh + mech.uE;
  const yB = yE + Math.max(1.2, (hf + ca * ht) / sa + 0.5);
  let topFit = o(o(outline.offset(-1.8, 'Round', 2, 48)).intersect(halfPlane(S, yB)));
  let topClip = o(o(outline.offset(-0.8, 'Round', 2, 48)).intersect(halfPlane(S, yB - 0.4)));
  if (ring) {
    topFit = o(topFit.subtract(circle(S, ring.x, ring.y, ring.r + 1.6)));
    topClip = o(topClip.subtract(circle(S, ring.x, ring.y, ring.r + 1)));
  }
  const fx = mech.wf / 2, y0 = mech.yh - mech.L, y1 = mech.yh - mech.uE - Math.max(1.5, (ca / sa) * hf + 1);
  return {
    top: { fit: topFit, clip: topClip, name: 'la forma' },
    flap: { fit: roundRect(S, -fx + 1.5, fx - 1.5, y0 + 1.5, y1, 2), clip: roundRect(S, -fx + 0.8, fx - 0.8, y0 + 0.8, y1 + 0.4, 2), name: 'la tapa' },
  };
}

function buildArt(S, mech, cfg, outline, ring, { logoImage, font }, warnings) {
  const hasLogo = !!(logoImage && cfg.logo.enabled);
  const wantText = !!(cfg.text.enabled && cfg.text.value.trim());
  if (wantText && !font) warnings.push('No se pudo cargar la fuente del texto; se omite el texto.');
  const hasText = wantText && !!font;
  const out = { top: null, flap: null };
  const used = {};
  for (const w of ['top', 'flap']) used[w] = { logo: hasLogo && cfg.logo.where === w, text: hasText && cfg.text.where === w };
  const regions = artRegions(S, mech, cfg, outline, ring, { top: used.top.logo || used.top.text, flap: used.flap.logo || used.flap.text });
  for (const w of ['top', 'flap']) if (used[w].logo || used[w].text) out[w] = fitBlock(S, regions[w], used[w], cfg, { logoImage, font }, warnings);
  return out;
}

// The block (logo with the text under it when both share the place) is fitted as large as possible inside the
// region, then rebuilt at its real size so the trace honours the minimum printable feature.
function fitBlock(S, region, items, cfg, { logoImage, font }, warnings) {
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
  // largest block wins; near-ties (< 0.5 %) go to the most centred position
  const scan = (y0, y1, step, iters) => {
    for (let yc = y0; yc <= y1 + 1e-9; yc += step) {
      let lo = 0, hi = sHi;
      for (let i = 0; i < iters; i++) { const m = (lo + hi) / 2; if (fits(m, yc)) lo = m; else hi = m; }
      if (lo > best.s * 1.005 || (lo > best.s * 0.995 && Math.abs(yc - yMid) < Math.abs(best.yc - yMid))) { best.s = Math.max(lo, best.s); best.yc = yc; }
    }
  };
  scan(fb.min[1], fb.max[1], 1, 12);
  scan(best.yc - 1, best.yc + 1, 0.25, 18);
  if (best.s <= 0.02) { warnings.push(`No cabe el logo/texto en ${name}: agranda la forma o la tapa.`); return null; }

  const size = items.logo ? cfg.logo.size : cfg.text.size;
  const [dx, dy] = items.logo ? [cfg.logo.dx, cfg.logo.dy] : [0, 0];
  const fin = compose(Hn * best.s * (size / 100));
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
function placeNfc(S, mech, cfg, deco, yTop, ring, art, warnings) {
  if (!cfg.nfc.enabled) return null;
  const T = mech.T, r = cfg.nfc.diameter / 2;
  const dep = Math.ceil(cfg.nfc.depth / LAYER - 1e-6) * LAYER;
  const snap = (z) => Math.round(Math.floor(z / LAYER + 1e-6) * LAYER * 100) / 100;
  // ≥ 1.2 mm of cover over the chip, and ≥ 0.8 mm under an engraved/inlaid logo on the same face
  const cover = (a) => Math.max(1.2, (a && cfg.logo.mode !== 'relief' ? cfg.logo.depth : 0) + 0.8);
  const atTop = () => {
    let reg = S.o(deco.offset(-(r + 1.5), 'Round', 2, 48));
    if (ring && !reg.isEmpty()) reg = S.o(reg.subtract(circle(S, ring.x, ring.y, ring.r + 1.5 + r)));
    if (reg.isEmpty()) return null;
    const p = nearestIn(reg.toPolygons(), art.top ? [art.top.box.cx, art.top.box.cy] : [0, (mech.ym + yTop) / 2]);
    const z1 = snap(T - cover(art.top));
    return { where: 'top', x: p[0], y: p[1], r, z0: Math.round((z1 - dep) * 100) / 100, z1 };
  };
  const inFlap = () => {
    const cy = mech.yh - mech.L / 2 - 0.5;
    if (r + 1.5 > mech.wf / 2 || cy - r < mech.yh - mech.L + 1.5 || cy + r > mech.yh - 2) return null;
    const z1 = snap(T - cover(art.flap));
    return { where: 'flap', x: 0, y: cy, r, z0: Math.round((z1 - dep) * 100) / 100, z1 };
  };
  const order = cfg.nfc.where === 'top' ? [atTop] : cfg.nfc.where === 'flap' ? [inFlap] : [atTop, inFlap];
  for (const f of order) {
    const n = f();
    if (!n) continue;
    if (n.z0 < 0.8) warnings.push('Queda poco piso bajo el chip NFC: aumenta el grosor.');
    return n;
  }
  const where = cfg.nfc.where === 'top' ? 'en la parte decorativa' : cfg.nfc.where === 'flap' ? 'en la tapa' : 'ni arriba ni en la tapa';
  warnings.push(`El chip NFC de Ø${fmt(cfg.nfc.diameter)} mm no cabe ${where}: agranda la forma o usa un chip más pequeño.`);
  return null;
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
  if (nfc && nfc.where === 'top' && nfc.z0 - SLOT.top < 1) keep0.push({ x: sg * nfc.x, y: nfc.y, r: nfc.r + 1 });
  // 2.5 mm clear of the window, its slanted stop (at the slot's top height) and the finger notch
  const nd = Math.max(0, Math.min(3, mech.F - 3.5));
  const wx = mech.xw + 2.5, wy0 = mech.F - nd - 2.5, wy1 = mech.yh + mech.stopU(SLOT.top - mech.T / 2) + 2.5;
  const win0 = [[-wx, wy0], [wx, wy0], [wx, wy1], [-wx, wy1]];
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
// Returns live manifold solids (caller must call dispose()). body = card + rails + hinge pins + ridges;
// flap = hinged tab (printed in place inside the window); logo = relief/inlay piece (null when engraved).
export function phoneStandSolids(cfgIn, { logoImage = null, shapeImage = null, font = null } = {}) {
  if (!engine) throw new Error('El motor 3D no está listo: llama a preparePhoneStand() primero.');
  const { Manifold: M, CrossSection: CS } = engine;
  const o = makeScope(), S = { o, CS, M };
  try {
    const mech = phoneStandMechanism(cfgIn), cfg = mech.cfg;
    const { W, T, L, F, c, xw, wf, yh, rc } = mech;
    const warnings = [];
    if (rc < cfg.pin - 0.01) warnings.push(`Pasador de la bisagra limitado a Ø${fmt(2 * rc)} mm por el grosor.`);
    if (rc < 1.5) warnings.push('El pasador de la bisagra queda muy pequeño: aumenta el grosor.');
    if (mech.baseClear < 1) warnings.push('El celular queda muy pegado a la tapa abierta: aumenta el largo de la tapa o el ángulo.');

    const shp = makeOutline(S, mech, cfg, shapeImage, warnings);
    const { outline, polys, yTop } = shp;
    const deco = o(outline.intersect(halfPlane(S, mech.ym)));
    const ring = ringSpot(S, deco, cfg, warnings);
    const art = buildArt(S, mech, cfg, outline, ring, { logoImage, font }, warnings);
    const nfc = placeNfc(S, mech, cfg, deco, yTop, ring, art, warnings);
    const opener = placeOpener(mech, cfg, polys, yTop, ring, nfc, warnings);

    // window with the slanted stop behind the hinge (the open flap rests on its top edge)
    const winPlan = o(roundRect(S, -xw, xw, F, yh + 10, 2 + c).intersect(halfPlane(S, yh + 0.5, false)));
    const wedge = alongX(S, o(new CS([[[yh - 0.5, -1], [yh + mech.stopU(-T / 2 - 1), -1], [yh + mech.stopU(T / 2 + 1), T + 1], [yh - 0.5, T + 1]]], 'NonZero')), -xw, xw);
    const windowCut = o(extrudeZ(S, winPlan, -1, T + 1).add(wedge));
    // hinge: 45° cone pins on the window walls, matching cone sockets in the flap (normal gap = clearance)
    const pin = o(o(o(o(M.cylinder(rc, rc, 0, 48)).add(o(o(M.cylinder(0.5, rc, rc, 48)).translate([0, 0, -0.5])))).rotate([0, -90, 0])).translate([xw, yh, T / 2]));
    const pins = o(pin.add(o(pin.mirror([1, 0, 0]))));
    const xa = xw - rc - c * Math.SQRT2, xb = xw - c + 1, hs = xb - xa;
    const sock = o(o(o(M.cylinder(hs, hs, 0, 48)).rotate([0, -90, 0])).translate([xb, yh, T / 2]));
    const sockets = o(sock.add(o(sock.mirror([1, 0, 0]))));
    // phone stop ridges on the rails, in front of where the phone's bottom edge lands
    const h = cfg.ridge, yr = mech.yr;
    const ridge = alongX(S, o(new CS([[[yr, T - 0.5], [yr, T + h], [yr - 1.5, T + h], [yr - 2 - h, T - 0.5]]], 'NonZero')), xw, W / 2);
    const ridges = o(o(ridge.add(o(ridge.mirror([1, 0, 0])))).intersect(extrudeZ(S, outline, 0, T + h + 1)));
    const nd = Math.min(3, F - 3.5);
    const notch = nd > 0.5 ? extrudeZ(S, roundRect(S, -6, 6, F - nd, F + 6, 2.5), -1, T + 1) : null;
    const ringCut = ring ? o(o(M.cylinder(T + 2, ring.r, ring.r, 48)).translate([ring.x, ring.y, -1])) : null;
    const pocket = nfc ? o(o(M.cylinder(nfc.z1 - nfc.z0, nfc.r, nfc.r, 96)).translate([nfc.x, nfc.y, nfc.z0])) : null;
    const slot = opener ? openerCutter(S, mech, opener) : null;
    // logo/text per place: relief piece on the face, or recess (+ inlay piece for a 2nd colour)
    const artSolid = (a) => {
      if (!a) return { piece: null, recess: null };
      if (cfg.logo.mode === 'relief') return { piece: extrudeZ(S, a.cs, T, T + cfg.logo.height), recess: null };
      return { recess: extrudeZ(S, a.cs, T - cfg.logo.depth, T + 1), piece: cfg.logo.mode === 'inlay' ? extrudeZ(S, a.cs, T - cfg.logo.depth, T) : null };
    };
    const artTop = artSolid(art.top), artFlap = artSolid(art.flap);

    let body = o(o(o(extrudeZ(S, outline, 0, T).add(ridges)).subtract(windowCut)).add(pins));
    for (const cut of [notch, ringCut, nfc?.where === 'top' ? pocket : null, slot, artTop.recess]) if (cut) body = o(body.subtract(cut));
    const flapProf = o(CS.union([o(o(CS.square([L, T])).translate([yh - L, 0])), circle(S, yh, T / 2, T / 2, 64)]));
    let flap = o(o(alongX(S, flapProf, -wf / 2, wf / 2).intersect(extrudeZ(S, roundRect(S, -wf / 2, wf / 2, yh - L, yh + T, 2), -1, T + 1))).subtract(sockets));
    if (nfc?.where === 'flap') flap = o(flap.subtract(pocket));
    if (artFlap.recess) flap = o(flap.subtract(artFlap.recess));

    // solid pieces only: a sealed NFC pocket is an inner shell (negative volume), not a loose piece
    const pieces = (m) => { const d = m.decompose(); const n = d.filter((x) => x.volume() > 1e-6).length; d.forEach((x) => x.delete()); return n; };
    const nBody = pieces(body), nFlap = pieces(flap);
    if (nBody !== 1) warnings.push(`El cuerpo quedó en ${nBody} piezas sueltas: cambia la forma, el tamaño o el abre latas.`);
    if (nFlap !== 1) warnings.push(`La tapa quedó en ${nFlap} piezas sueltas: revisa el chip NFC.`);
    const gap = body.minGap(flap, 2);
    if (gap < 0.9 * c) warnings.push(`La tapa queda a ${fmt(gap)} mm del cuerpo: puede salir pegada.`);

    const backAtCentre = maxAt(o(outline.hull()).toPolygons(), 0, 0);
    const solids = [body, flap, artTop.piece, artFlap.piece].filter(Boolean);
    const box = solids.map((m) => m.boundingBox()).reduce((u, b) => ({ min: u.min.map((v, i) => Math.min(v, b.min[i])), max: u.max.map((v, i) => Math.max(v, b.max[i])) }));
    const vol = solids.reduce((s, m) => s + m.volume(), 0) / 1000;
    const artInfo = (a) => (a ? { ...a.box, cap: a.cap, logo: a.items.logo, text: a.items.text } : null);
    const info = {
      shape: { id: shp.shapeId, yTop, yRect: shp.yRect },
      size: { w: box.max[0] - box.min[0], l: box.max[1] - box.min[1], h: box.max[2] - box.min[2] },
      thetaOpen: mech.thOpen, phoneAngle: mech.phi, supportHeight: mech.P[1], baseClear: mech.baseClear,
      stability: { portrait: backAtCentre - mech.cgPortrait, landscape: backAtCentre - mech.cgLandscape },
      hinge: { pinDiameter: 2 * rc, socketWall: T / 2 - mech.rs, gap, clearance: c },
      ring, nfc, opener,
      art: { mode: cfg.logo.mode, top: artInfo(art.top), flap: artInfo(art.flap) },
      volume: vol, grams: vol * DENSITY, parts: { body: nBody, flap: nFlap },
    };
    const pauses = nfc ? [{ z: nfc.z1, msg: NFC_PAUSE_MSG }] : [];
    // any solid that rides on the flap, turned about the hinge axis (deg = how far the flap is opened)
    const rotateOpen = (m, deg) => o(o(o(m.translate([0, -yh, -T / 2])).rotate([-deg, 0, 0])).translate([0, yh, T / 2]));
    return {
      body, flap, topArt: artTop.piece, flapArt: artFlap.piece, art, outline, mech, cfg, info, warnings, pauses,
      rotateOpen, rotateFlap: (deg) => rotateOpen(flap, deg), dispose: () => o.free(),
    };
  } catch (err) {
    o.free();
    throw err;
  }
}

// Phone mock-up (three.js) leaning on the open stand: back face on the flap tip, bottom edge on the rails.
function phoneMock(mech, H = 150, t = 9, w = 72) {
  const ph = mech.phi * D2R;
  const g = new THREE.BoxGeometry(w, t, H);
  g.applyMatrix4(new THREE.Matrix4().makeRotationX((mech.phi - 90) * D2R));
  g.translate(0, mech.By + (H / 2) * Math.cos(ph) - (t / 2) * Math.sin(ph), mech.T + (H / 2) * Math.sin(ph) + (t / 2) * Math.cos(ph));
  return g;
}

// Ready-to-show/export result (three.js geometries). Requires preparePhoneStand() first.
// parts[i].moving marks pieces that ride on the flap; their openGeometry is the flap fully open (stand mode).
export function buildPhoneStand(cfgIn, opts = {}) {
  const sol = phoneStandSolids(cfgIn, opts);
  try {
    const { cfg, mech, art } = sol, col = cfg.colors;
    const fil = (accent) => (accent ? { color: col.accent, filamentIndex: 1 } : { color: col.body, filamentIndex: 0 });
    const artName = (a) => (a.items.logo && a.items.text ? 'Logo y texto' : a.items.logo ? 'Logo' : 'Texto');
    const geo = (m) => meshGeometry(m.getMesh());
    const parts = [
      { name: 'Cuerpo', ...fil(false), geometry: geo(sol.body), moving: false },
      { name: 'Tapa (bisagra)', ...fil(col.flapAccent), geometry: geo(sol.flap), moving: true, openGeometry: geo(sol.rotateFlap(mech.thOpen)) },
    ];
    if (sol.topArt) parts.push({ name: artName(art.top), ...fil(col.twoColor), geometry: geo(sol.topArt), moving: false });
    if (sol.flapArt) {
      // contrasts with the flap: the other colour in two-colour mode, else the flap's own colour
      parts.push({
        name: `${artName(art.flap)} (tapa)`, ...fil(col.twoColor ? !col.flapAccent : col.flapAccent),
        geometry: geo(sol.flapArt), moving: true, openGeometry: geo(sol.rotateOpen(sol.flapArt, mech.thOpen)),
      });
    }
    return {
      cfg, mech, parts, pauses: sol.pauses, warnings: sol.warnings, info: sol.info,
      phone: phoneMock(mech), axis: { y: mech.yh, z: mech.T / 2 },
    };
  } finally {
    sol.dispose();
  }
}

// SVG previews of every top shape with the current measurements (window + key-ring hole cut out).
export function shapeThumbnails(cfgIn, { shapeImage = null } = {}) {
  if (!engine) throw new Error('El motor 3D no está listo: llama a preparePhoneStand() primero.');
  const o = makeScope(), S = { o, CS: engine.CrossSection };
  try {
    const mech = phoneStandMechanism(cfgIn);
    const out = {};
    for (const s of PHONESTAND_SHAPES) {
      const w = [];
      const shp = makeOutline(S, mech, { ...mech.cfg, shape: s.id }, shapeImage, w);
      let cs = o(shp.outline.subtract(roundRect(S, -mech.xw, mech.xw, mech.F, mech.yh + 3, 2)));
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
export function phoneStandProject(cfg, { logoSrc = null, shapeSrc = null } = {}) {
  return JSON.stringify({ app: PHONESTAND_PROJECT_APP, version: 1, cfg: normalizePhoneStand(cfg), logoSrc: logoSrc || null, shapeSrc: shapeSrc || null });
}
export function readPhoneStandProject(text) {
  let j;
  try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('El archivo no es un proyecto válido.'); }
  if (!j || j.app !== PHONESTAND_PROJECT_APP || !j.cfg) throw new Error('No es un proyecto de soporte de celular.');
  if (j.version !== 1) throw new Error(`Versión de proyecto no compatible (${j.version}).`);
  const src = (v) => (typeof v === 'string' && /^data:image\//.test(v) ? v : null);
  return { cfg: normalizePhoneStand(j.cfg), logoSrc: src(j.logoSrc), shapeSrc: src(j.shapeSrc) };
}

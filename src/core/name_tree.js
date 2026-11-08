// Parametric name tree, v2. XY is the front silhouette (X across, Y up) and Z is the depth.
// The depth tapers evenly on both faces around Z=0, so the assembled tree stands upright.
// Every word sits between thin rails; hidden trapezoid keys inside the depth register the stacked pieces.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { HABLADOR_FONTS, layoutText, flatten, heartC } from './hablador.js';
import { threeMF, stlBinary } from './exporters.js';

export const NAME_TREE_APP = 'Relieve3D-ArbolNombres';
export const NAME_TREE_FONTS = HABLADOR_FONTS;
export const DEFAULT_NAME_TREE = () => ({
  name: 'Árbol de mi familia',
  names: [{ text: 'Diego' }, { text: 'Mildred' }, { text: 'Violetta' }, { text: 'Celeste' }],
  font: 'Bebas Neue', uppercase: true, order: 'manual',
  trunk: 'text', trunkText: String(new Date().getFullYear()),
  maxWidth: 160, maxHeight: 240, bottomDepth: 30, topDepth: 12,
  minStroke: 1.2, clearance: 0.2,
  shape: 'star', custom: null,
  colors: { first: '#c12e1f', second: '#008b45', trunk: '#754629', top: '#fec600' },
  bedWidth: 256, bedHeight: 256,
});
// k = width gained per mm going down the tree (the reference model is ≈0.96); a narrow range keeps its proportions.
// Only when many names would shrink the top below a legible size does the slope steepen, down to K_LO.
const K_MIN = 0.85, K_LO = 0.5, K_MAX = 1.1, MIN_CAP = 5, MIN_TOPPER = 12, STABLE_DEG = 8, OV = 0.3, BIG = 1e4;
// The topper keeps the reference proportion (≈⅓ of the tree width) even when many names fill the triangle, and the
// top name stays wide enough to carry it; every name keeps letters of at least CAP_FRAC of the width.
const TOP_MIN = 0.28, TOP_MAX = 0.38, TOP_WORD = 0.6, CAP_FRAC = 0.06;
// Thin strokes grow to the minimum stroke, which narrows every white gap. Letters are spaced apart so the gaps between
// them keep at least gapFor(stroke) once printed, and a name never shrinks below the size at which its counters
// (the holes of A, R, O, the slots deeper than SLOT·cap of E, M, N… and the passages of G, S) would close or pinch
// shut to less than that gap.
// ROW, DSTEP and DMAX are font units at size 100 (cap ≈ 70); GRID widths are scanned near the narrowest tree.
const GAP_MIN = 0.8, gapFor = s => Math.max(GAP_MIN, 0.65 * s), SLOT = 0.19, ROW = 0.5, DSTEP = 0.25, DMAX = 128, GRID = 33;
const FLANK = 50, KEY_TIP = 1, KEY_MIN = 0.8, KEY_GOOD = 2.5, KEY_MAX = 6;
const TOPPERS = { star: 'Estrella', heart: 'Corazón', circle: 'Círculo', custom: 'Remate personalizado' };

let engine, loading;
export async function prepareNameTree() {
  if (!loading) loading = import('../../node_modules/manifold-3d/manifold.js')
    .then(({ default: init }) => init()).then(w => { w.setup(); engine = w; })
    .catch(error => { loading = null; throw error; });
  return loading;
}
const color = (v, fallback) => /^#[0-9a-f]{6}$/i.test(String(v)) ? v.toLowerCase() : fallback;
const number = (v, fallback, min, max, label) => {
  const n = v === undefined ? fallback : Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label}: usa un valor entre ${min} y ${max} mm.`);
  return n;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const degrees = r => r * 180 / Math.PI;
export function parseTreeNames(value) {
  const list = typeof value === 'string' ? value.split(/[\r\n;,]+/).filter(s => s.trim()) : value;
  if (!Array.isArray(list) || !list.length || list.length > 20) throw new Error('Escribe entre 1 y 20 nombres, uno por renglón.');
  return list.map(item => {
    const text = String(typeof item === 'string' ? item : item?.text ?? '').normalize('NFC').trim();
    if (!text || [...text].length > 32 || /[\x00-\x1f\x7f]/.test(text)) throw new Error('Cada nombre debe tener entre 1 y 32 caracteres visibles.');
    return { text, color: color(item?.color, '') };
  });
}
export function normalizeNameTree(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('Configuración del árbol no válida.');
  const d = DEFAULT_NAME_TREE(), c = {
    name: String(input.name ?? d.name).trim().slice(0, 60) || d.name,
    names: parseTreeNames(input.names ?? d.names),
    font: input.font ?? d.font, uppercase: input.uppercase !== false,
    order: (input.order ?? d.order) === 'manual' ? 'manual' : 'auto',
    trunk: input.trunk ?? d.trunk,
    trunkText: String(input.trunkText ?? d.trunkText).normalize('NFC').trim(),
    shape: input.shape ?? d.shape, custom: input.custom ?? null, colors: {},
  };
  if (!['text', 'block'].includes(c.trunk)) throw new Error('Tronco no válido.');
  if ([...c.trunkText].length > 16 || /[\x00-\x1f\x7f]/.test(c.trunkText)) throw new Error('El texto del tronco admite hasta 16 caracteres visibles.');
  if (c.trunk === 'text' && !c.trunkText) throw new Error('Escribe el texto del tronco (por ejemplo, el año) o elige el tronco liso.');
  for (const [k, lo, hi, label] of [
    ['maxWidth', 40, 500, 'Ancho máximo'], ['maxHeight', 60, 600, 'Alto máximo'],
    ['bottomDepth', 8, 80, 'Grosor inferior'], ['topDepth', 6, 60, 'Grosor superior'],
    ['minStroke', 0.8, 3, 'Trazo mínimo'], ['clearance', 0.12, 0.5, 'Holgura por lado'],
    ['bedWidth', 80, 500, 'Ancho de placa'], ['bedHeight', 80, 500, 'Largo de placa'],
  ]) c[k] = number(input[k], d[k], lo, hi, label);
  if (c.topDepth > c.bottomDepth) throw new Error('El grosor superior no puede superar el inferior.');
  if (!NAME_TREE_FONTS[c.font]) throw new Error('La fuente seleccionada no está disponible.');
  if (!TOPPERS[c.shape]) throw new Error('Remate no válido.');
  for (const k of Object.keys(d.colors)) c.colors[k] = color(input.colors?.[k], d.colors[k]);
  if (c.custom !== null) {
    if (!Array.isArray(c.custom) || !c.custom.length || c.custom.length > 100
      || c.custom.some(r => !Array.isArray(r) || r.length < 3)
      || c.custom.reduce((n, r) => n + r.length, 0) > 20000
      || c.custom.some(r => r.some(p => !Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v) || Math.abs(v) > 1000)))) {
      throw new Error('La silueta personalizada no es válida.');
    }
    c.custom = c.custom.map(r => r.map(p => [...p]));
  }
  return c;
}
function scope() {
  const objects = [];
  const own = v => { objects.push(v); return v; };
  own.dispose = () => { for (const v of objects.reverse()) v.delete(); };
  return own;
}
const boundsSize = b => b.max.map((v, i) => v - b.min[i]);
const rectangle = (CS, own, x0, y0, x1, y1) => own(own(CS.square([x1 - x0, y1 - y0])).translate([x0, y0]));
const root = (f, lo, hi) => {
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
  return lo;
};
// Glyph outlines at size 100 in their kerned positions; spaces leave no glyph.
function glyphSections(font, text, CS, own) {
  return layoutText(font, text, 100).map(g => ({ ch: g.ch, cs: own(new CS(
    g.contours.map(c => flatten(c, 0.04).map(([x, y]) => [x, -y])), 'EvenOdd')) }))
    .filter(g => !g.cs.isEmpty() && g.cs.area() > 1e-6);
}
function inkSection(font, text, CS, own) {
  const glyphs = glyphSections(font, text, CS, own).map(g => g.cs);
  return glyphs.length ? own(CS.union(glyphs)) : null;
}
const metricsCache = new WeakMap(), spacingCache = new WeakMap(), apertureCache = new WeakMap();
function fontMetrics(font, CS, own) {
  if (!metricsCache.has(font)) {
    const measure = ch => font.charToGlyphIndex(ch) ? inkSection(font, ch, CS, own) : null;
    const H = measure('H'), I = measure('I');
    const capH = H && !H.isEmpty() ? H.bounds().max[1] : 70;
    const stem = I && !I.isEmpty() ? boundsSize(I.bounds())[0] : 0.14 * capH;
    metricsCache.set(font, { capH, stem: Math.min(stem, 0.3 * capH) });
  }
  return metricsCache.get(font);
}
// Leftmost and rightmost outline point in each closed row [y0 + j·ROW, y0 + (j + 1)·ROW]. Inside a band a polygon is
// extreme at one of its vertices or where an edge crosses the band border, so these extents are exact.
function rowExtents(cs, y0, rows) {
  const L = new Float64Array(rows).fill(Infinity), R = new Float64Array(rows).fill(-Infinity);
  const put = (j, x) => { if (j >= 0 && j < rows) { L[j] = Math.min(L[j], x); R[j] = Math.max(R[j], x); } };
  for (const ring of cs.toPolygons()) ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length], u = (a[1] - y0) / ROW, v = (b[1] - y0) / ROW, j = Math.floor(u);
    put(j, a[0]);
    if (j === u) put(j - 1, a[0]);
    for (let k = Math.floor(Math.min(u, v)) + 1; k < Math.max(u, v); k++) {
      const x = a[0] + (b[0] - a[0]) * (k - u) / (v - u);
      put(k - 1, x); put(k, x);
    }
  });
  return { L, R };
}
// Letter spacing: glyph i moves right by i·τ. table[k] is the τ that keeps every glyph at least D = k·DSTEP away from
// its next two neighbours. Rows are compared with their vertical distance, so kerned pairs that only overlap at
// different heights (L·T, A·V) open just enough.
function trackingTable(sections, index) {
  if (sections.length < 2) return null;
  let y0 = Infinity, y1 = -Infinity;
  for (const s of sections) { const b = s.bounds(); y0 = Math.min(y0, b.min[1]); y1 = Math.max(y1, b.max[1]); }
  const rows = Math.ceil((y1 - y0) / ROW) + 1, ext = sections.map(s => rowExtents(s, y0, rows));
  const table = new Float64Array(Math.round(DMAX / DSTEP) + 1);
  let far = 0;
  for (let a = 0; a < sections.length; a++) for (let b = a + 1; b < Math.min(a + 3, sections.length); b++) {
    const A = ext[a].R, B = ext[b].L, m = index[b] - index[a], records = [], envelope = [];
    for (let d = 1 - rows; d < rows; d++) {
      let gap = -Infinity;
      for (let j = Math.max(0, -d); j < Math.min(rows, rows - d); j++) gap = Math.max(gap, A[j + d] - B[j]);
      if (gap > -Infinity) records.push({ dy: Math.max(0, Math.abs(d) - 1) * ROW, gap });
    }
    records.sort((p, q) => p.dy - q.dy || q.gap - p.gap);
    for (const r of records) if (!envelope.length || r.gap > envelope.at(-1).gap) envelope.push(r);
    if (!envelope.length) continue;
    far = Math.max(far, envelope.at(-1).gap);
    table.forEach((t, k) => {
      const D = k * DSTEP;
      let need = 0;
      for (const r of envelope) { if (r.dy >= D) break; need = Math.max(need, r.gap + Math.sqrt(D * D - r.dy * r.dy)); }
      table[k] = Math.max(t, need / m);
    });
  }
  return { table, far };
}
const tracking = (t, D) => !t ? 0 : D > DMAX ? t.far + D : t.table[Math.ceil(D / DSTEP - 1e-9)];
function inradius(cs) {
  let lo = 0, hi = Math.min(...boundsSize(cs.bounds())) / 2;
  for (let i = 0; i < 14; i++) {
    const m = (lo + hi) / 2, inner = cs.offset(-m, 'Round', 2, 16), open = !inner.isEmpty() && inner.area() > 1e-6;
    inner.delete();
    if (open) lo = m; else hi = m;
  }
  return lo;
}
const inside = (rings, [x, y]) => {
  let hit = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < xi + (xj - xi) * (y - yi) / (yj - yi)) hit = !hit;
  }
  return hit;
};
// Smallest growth of the strokes that seals a pocket of white: part of an open white cut off from the outside (the
// slit and the inner bar of G, the mouths of S, a, e) or a counter pinched in two. Only pockets still a quarter as wide
// as their white count; the tip of a tapering slit just fills in. Scanned upwards because sealed pockets later vanish.
function sealRadius(cs, hull, mouth, deep, whites, limit) {
  const sealed = r => {
    const grown = cs.offset(r, 'Round', 2, 16), rest = hull.subtract(grown), parts = rest.decompose();
    let hit = false;
    for (const w of whites) w.pieces = 0;
    for (const part of parts) {
      const v = part.toPolygons()[0]?.[0], lip = part.intersect(mouth), open = lip.area() > 0.025;
      lip.delete();
      const home = !hit && v && !open && whites.find(w => inside(w.rings, v));
      if (!home) continue;
      const core = part.offset(-Math.max(1, 0.25 * home.ρ), 'Round', 2, 16), wide = !core.isEmpty() && core.area() > 1e-6;
      core.delete();
      if (!wide) continue;
      if (!home.open) hit = ++home.pieces > 1;
      else { const d = part.intersect(deep); hit = d.area() > 1e-6; d.delete(); }
    }
    for (const x of [grown, rest, ...parts]) x.delete();
    return hit;
  };
  let lo = 0, hi = Infinity;
  for (let k = 1; k <= 8 && hi === Infinity; k++) { const r = limit * k / 8; if (sealed(r)) hi = r; else lo = r; }
  if (hi === Infinity) return Infinity;
  for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (sealed(m)) hi = m; else lo = m; }
  return lo;
}
// Radius of the narrowest white that makes a glyph readable: its closed counters (A, O, R…), its open slots deeper
// than SLOT (E, M, N, U…) and the passages that keep them open (G, S). Shallow notches (waist of B, sides of Y, tail
// of Q) only round off when strokes thicken, and specks under one font unit are outline noise.
function apertureRadius(font, ch, cs, capH, CS, own) {
  let cache = apertureCache.get(font);
  if (!cache) apertureCache.set(font, cache = new Map());
  const key = [cs.area(), ...boundsSize(cs.bounds())].map(v => v.toFixed(2)).join('|') + ch;
  if (!cache.has(key)) {
    const hull = own(cs.hull()), mouth = own(hull.subtract(own(hull.offset(-0.05, 'Miter', 2))));
    const deep = own(hull.offset(-SLOT * capH, 'Miter', 2)), whites = [];
    let r = Infinity;
    for (const white of own(hull.subtract(cs)).decompose().map(own)) {
      if (white.area() < 1e-3) continue;
      const open = own(white.intersect(mouth)).area() > 0.025;
      if (open && own(white.intersect(deep)).area() < 1e-6) continue;
      const ρ = inradius(white);
      if (open || ρ >= 1) { r = Math.min(r, ρ); whites.push({ rings: white.toPolygons(), ρ, open }); }
    }
    if (r < Infinity) r = Math.min(r, sealRadius(cs, hull, mouth, deep, whites, r));
    cache.set(key, r);
  }
  return cache.get(key);
}
// Capitals are split at the cap height: marks above it (accents, tildes) become windows in a flat top band,
// so every piece keeps a flat top for the next one and no accent floats loose.
function rawWord(font, text, cased, metrics, CS, own) {
  for (const ch of [...text]) if (!/\s/.test(ch) && !font.charToGlyphIndex(ch)) {
    throw new Error(`La fuente no tiene el carácter «${ch}» de «${text}». Elige otra fuente o cambia ese carácter.`);
  }
  const empty = () => new Error(`«${text}» no contiene letras imprimibles.`);
  const { capH, stem } = metrics, cut = 1.03 * capH, band = cased ? rectangle(CS, own, -BIG, -BIG, BIG, cut) : null;
  const glyphs = [];
  for (const { ch, cs } of glyphSections(font, text, CS, own)) {
    let body = band ? own(cs.intersect(band)) : cs, marks = band ? own(cs.subtract(band)) : null;
    if (body.isEmpty() || body.area() < 1e-6) body = null;
    if (marks && (marks.isEmpty() || marks.area() < 1e-4)) marks = null;
    if (body || marks) glyphs.push({ ch, body, marks, i: glyphs.length });
  }
  const bodies = glyphs.filter(g => g.body), marked = glyphs.filter(g => g.marks);
  if (!bodies.length) throw empty();
  const maxY = Math.max(...bodies.map(g => g.body.bounds().max[1])), top = cased ? capH : maxY;
  const span = (cs, y0, y1) => {
    const s = own(cs.intersect(rectangle(CS, own, -BIG, y0, BIG, y1)));
    if (s.isEmpty() || s.area() < 1e-6) return null;
    const sb = s.bounds();
    return [sb.min[0], sb.max[0]];
  };
  for (const g of bodies) {
    const b = g.body.bounds();
    Object.assign(g, { x: [b.min[0], b.max[0]], foot: span(g.body, -0.03 * capH, 0.1 * capH),
      head: span(g.body, top - 0.1 * capH, cased ? cut : top + 1) });
  }
  for (const g of marked) { const b = g.marks.bounds(); g.m = [b.min[0], b.max[0]]; }
  const marks = marked.length ? own(CS.union(marked.map(g => g.marks))) : null, mb = marks?.bounds();
  const reachOf = (list, key) => Float64Array.from(list.filter(g => g[key]).flatMap(g => [...g[key], g.i]));
  let cache = spacingCache.get(font);
  if (!cache) spacingCache.set(font, cache = new Map());
  const key = `${cased ? 1 : 0}${text}`;
  if (!cache.has(key) && cache.size > 300) cache.clear();
  if (!cache.has(key)) cache.set(key, {
    track: trackingTable(bodies.map(g => g.body), bodies.map(g => g.i)),
    markTrack: trackingTable(marked.map(g => g.marks), marked.map(g => g.i)),
    counter: Math.min(...bodies.map(g => apertureRadius(font, g.ch, g.body, capH, CS, own))),
  });
  const w = { text, glyphs, capH, stem, cased, maxY, top, ...cache.get(key),
    reach: { x: reachOf(bodies, 'x'), m: reachOf(marked, 'm'), foot: reachOf(bodies, 'foot'), head: reachOf(bodies, 'head') },
    accents: marks ? marks.decompose().map(own).length : 0, mark: mb && { y0: mb.min[1], y1: mb.max[1] } };
  const e = extent(w, 0);
  return Object.assign(w, { x0: e.x0, x1: e.x1, cx: e.cx, aspect: (e.x1 - e.x0) / capH });
}
// [min, max] of the x intervals stored as (lo, hi, glyph index) once glyph i moves right by i·τ; null if none.
function reach(list, τ) {
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < list.length; j += 3) {
    const t = list[j + 2] * τ;
    lo = Math.min(lo, list[j] + t); hi = Math.max(hi, list[j + 1] + t);
  }
  return lo <= hi ? [lo, hi] : null;
}
// Horizontal extents of a word whose glyphs are spaced by τ (font units).
function extent(w, τ) {
  const [x0, x1] = reach(w.reach.x, τ), m = reach(w.reach.m, τ);
  return { x0, x1, cx: (x0 + x1) / 2, m0: m?.[0], m1: m?.[1],
    foot: reach(w.reach.foot, τ) || [x0, x1], head: reach(w.reach.head, τ) || [x0, x1] };
}
const thicken = (w, σ, s) => clamp((s - 0.75 * w.stem * σ) / 2, 0, s / 2);
// Smallest cap height at which the word's narrowest white stays g wide once its strokes thicken: σ·counter − δ ≥ g/2.
const legibleCap = (w, s, g) => w.capH * Math.max(g / (2 * w.counter), (g + s) / (2 * w.counter + 0.75 * w.stem));
// Vertical layout of one word band for scale σ; δ thickens thin strokes up to the minimum stroke and τ spaces the
// letters so the white between them stays g wide (and s of solid band between accent windows).
function wordDims(w, σ, s, rails, g) {
  σ = Math.max(σ, 1e-6);
  const δ = thicken(w, σ, s), τ = Math.max(tracking(w.track, (g + 2 * δ) / σ), tracking(w.markTrack, (s + 2 * δ) / σ));
  const [x0, x1] = reach(w.reach.x, τ);
  let half = σ * (x1 - x0) / 2 + δ;
  const yb = rails.rb - OV + δ, yc = yb + σ * w.top + δ - OV;
  let height = yc + rails.rt, lift = 0;
  if (w.mark) {
    const [m0, m1] = reach(w.reach.m, τ), cx = (x0 + x1) / 2;
    half = Math.max(half, σ * (cx - m0) + δ + s, σ * (m1 - cx) + δ + s);
    const floor = Math.max(yc, yb + σ * w.maxY + δ) + s;
    lift = Math.max(0, floor - (yb + σ * w.mark.y0 - δ));
    height = Math.max(height, yb + σ * w.mark.y1 + δ + lift + Math.max(rails.rt, s));
  }
  return { δ, τ, yb, yc, height, lift, width: 2 * half, cap: σ * w.capH };
}
function topperShape(c, CS, own) {
  let cs;
  if (c.shape === 'custom') {
    if (!c.custom) throw new Error('Carga una silueta para el remate personalizado.');
    cs = own(new CS(c.custom, 'EvenOdd'));
    const pieces = cs.decompose().map(own);
    if (pieces.length !== 1 || cs.area() <= 0) throw new Error('El remate debe ser una sola silueta conectada, sin islas sueltas.');
  } else if (c.shape === 'circle') cs = own(CS.circle(0.5, 96));
  else if (c.shape === 'heart') cs = own(new CS([flatten(heartC(0, 0, 1), 0.001).map(([x, y]) => [x, -y])], 'EvenOdd'));
  else {
    const star = own(new CS([Array.from({ length: 10 }, (_, i) => {
      const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.23 : 0.5;
      return [r * Math.cos(a), r * Math.sin(a)];
    })]));
    cs = own(own(star.offset(-0.025, 'Round', 2, 24)).offset(0.025, 'Round', 2, 24));
  }
  const b = cs.bounds(), [w, h] = boundsSize(b);
  if (!(w > 0 && h > 0)) throw new Error('La silueta del remate está vacía.');
  let left = null, right = null;
  for (const p of cs.toPolygons().flat()) {
    if (!left || p[0] < left[0]) left = p;
    if (!right || p[0] > right[0]) right = p;
  }
  // wy: height fraction of the widest point (star arm tips), which rests on the triangle edges.
  return { cs, b, w, h, wy: clamp(((left[1] + right[1]) / 2 - b.min[1]) / h, 0.15, 0.85) };
}
// Reference rule: every band is as wide as the triangle at its top, width = k·(apex − top). Every name also keeps its
// legible size; a loose layout (λ < 1, only used to explain failures) asks for that share of it and ignores CAP_FRAC.
function layoutTree(c, words, trunk, topper, W, k, λ = null) {
  const s = c.minStroke, g = gapFor(s), rails = { rb: Math.max(s + 1, 0.012 * W), rt: Math.max(s, 0.0065 * W) };
  const dims = (w, σ) => wordDims(w, σ, s, rails, g), span = w => w.x1 - w.x0;
  const floor = w => (λ ?? 1) * Math.max(MIN_CAP, w.legible), frac = λ === null ? CAP_FRAC * W : 0;
  let trunkPlan;
  if (trunk) {
    const σw = root(σ => dims(trunk, σ).width - 0.6 * W, 0, 0.6 * W / span(trunk) + 1);
    const σ = Math.min(0.19 * W / trunk.capH, σw);
    trunkPlan = { σ, ...dims(trunk, σ), bottom: 0 };
  } else trunkPlan = { width: 0.3 * W, height: 0.15 * W, cap: Infinity, bottom: 0 };
  let y = trunkPlan.height;
  const σ1 = root(σ => dims(words[0], σ).width - W, 0, W / span(words[0]) + 1);
  const levels = [{ σ: σ1, ...dims(words[0], σ1), bottom: y }];
  const apex = y + levels[0].height + W / k;
  y += levels[0].height;
  for (const w of words.slice(1)) {
    const f = σ => { const d = dims(w, σ); return d.width - k * (apex - y - d.height); };
    if (f(0) >= 0) return { ok: false, W, k, height: Infinity };
    const σ = root(f, 0, k * (apex - y) / span(w) + 1);
    levels.push({ σ, ...dims(w, σ), bottom: y });
    y += levels.at(-1).height;
  }
  const shapeH = tw => Math.max(0, tw - s) / topper.w * topper.h + s, rem = apex - y;
  const gap = tw => tw - k * (rem - rails.rb - (topper.wy - 0.08) * shapeH(tw));
  const fit = gap(0) < 0 ? root(gap, 0, k * rem + 1) : 0, tw = clamp(fit, TOP_MIN * W, TOP_MAX * W), h = shapeH(tw);
  const top = { width: tw, fit, height: h, cut: 0.08 * h, bottom: y, band: rails.rb - 0.08 * h + h };
  const ok = levels.every((l, i) => l.cap >= Math.max(floor(words[i]), frac))
    && (!trunk || trunkPlan.cap >= floor(trunk)) && tw >= MIN_TOPPER && levels.at(-1).width >= TOP_WORD * tw;
  return { ok, W, k, rails, apex, trunk: trunkPlan, levels, top, height: y + top.band };
}
const widths = (lo, hi) => hi - lo < 1e-9 ? [lo] : Array.from({ length: GRID }, (_, i) => lo + (hi - lo) * i / (GRID - 1));
// shortest(W): the flattest feasible tree of width W (largest slope k). Layouts never depend on the maximum size, so
// the same planner answers any size. narrowest(): the smallest width that still fits every rule.
function planner(c, words, trunk, topper, λ = null) {
  const at = (W, k) => layoutTree(c, words, trunk, topper, W, k, λ), memo = new Map();
  const largestK = W => {
    if (at(W, K_MAX).ok) return K_MAX;
    if (!at(W, K_LO).ok) return null;
    let lo = K_LO, hi = K_MAX;
    for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (at(W, mid).ok) lo = mid; else hi = mid; }
    return lo;
  };
  const shortest = W => {
    if (!memo.has(W)) { const k = largestK(W); memo.set(W, k === null ? null : at(W, k)); }
    return memo.get(W);
  };
  let narrow;
  const narrowest = () => {
    if (narrow === undefined) {
      if (!shortest(500)) narrow = null;
      else if (shortest(20)) narrow = 20;
      else {
        let lo = 20, hi = 500;
        for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (shortest(mid)) hi = mid; else lo = mid; }
        narrow = hi;
      }
    }
    return narrow;
  };
  return { at, shortest, narrowest };
}
// Use the full width when possible, then the tallest slope in [K_MIN, K_MAX] that respects the maximum height
// (steeper, down to K_LO, only when the proportion rules demand it).
function searchPlan(c, P) {
  const tall = p => p.height > c.maxHeight + 1e-6;
  let W = c.maxWidth, p = P.shortest(W);
  if (p && tall(p)) {
    let lo = Math.min(20, W), hi = W;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2, q = P.shortest(mid);
      if (!q || !tall(q)) lo = mid; else hi = mid;
    }
    W = lo; p = P.shortest(W);
  }
  if (!p || tall(p)) {
    // Close to the narrowest width the slope must steepen and the tree grows taller again, so scan the widths.
    const Wmin = P.narrowest();
    if (Wmin === null || Wmin > c.maxWidth) return null;
    const grid = widths(Wmin, c.maxWidth), i = grid.findLastIndex(x => { const q = P.shortest(x); return q && !tall(q); });
    if (i < 0) return null;
    let lo = grid[i], hi = grid[i + 1] ?? lo;
    for (let j = 0; j < 24 && hi > lo; j++) {
      const mid = (lo + hi) / 2, q = P.shortest(mid);
      if (q && !tall(q)) lo = mid; else hi = mid;
    }
    W = lo; p = P.shortest(W);
  }
  const low = Math.min(K_MIN, p.k), flat = P.at(W, low);
  if (!tall(flat)) return flat;
  let lo = low, hi = p.k;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (tall(P.at(W, mid))) lo = mid; else hi = mid; }
  return P.at(W, hi);
}
// The smallest maximum size (only ever larger than the current one) that fits every rule, or null past the limits.
function smallestFit(c, P) {
  const Wmin = P.narrowest();
  if (Wmin === null) return null;
  const maxWidth = Math.max(c.maxWidth, Math.ceil(Wmin));
  const height = Math.min(...widths(Wmin, maxWidth).map(W => P.shortest(W)?.height ?? Infinity));
  const maxHeight = Math.max(c.maxHeight, Math.ceil(height - 1e-6));
  return maxWidth <= 500 && maxHeight <= 600 ? { maxWidth, maxHeight } : null;
}
const byLength = (a, b) => b.aspect - a.aspect || a.index - b.index;
// Explains which name would become unreadable and offers the changes that fix it (error.suggestions).
function tooSmall(c, words, trunk, topper, P) {
  const size = f => f.maxWidth > c.maxWidth ? `${f.maxWidth} × ${f.maxHeight} mm` : `${f.maxHeight} mm de alto`;
  const fit = smallestFit(c, P), options = [], suggestions = [];
  if (fit) {
    options.push(fit.maxWidth > c.maxWidth ? `sube el ancho máximo a ${fit.maxWidth} mm y el alto máximo a ${fit.maxHeight} mm`
      : `sube el alto máximo a ${fit.maxHeight} mm`);
    suggestions.push({ label: `Usar ${size(fit)}`, changes: { ...fit } });
  }
  const sorted = [...words].sort(byLength);
  if (c.order === 'manual' && sorted.some((w, i) => w !== words[i])) {
    const A = planner(c, sorted, trunk, topper);
    if (searchPlan(c, A)) {
      options.push('usa el orden automático (largos abajo), que sí cabe en este tamaño');
      suggestions.push({ label: 'Usar orden automático', changes: { order: 'auto' } });
    } else {
      const auto = smallestFit(c, A);
      if (auto && (!fit || auto.maxWidth * auto.maxHeight < fit.maxWidth * fit.maxHeight)) {
        options.push(`usa el orden automático (largos abajo) con ${size(auto)}`);
        suggestions.push({ label: `Orden automático con ${size(auto)}`, changes: { order: 'auto', ...auto } });
      }
    }
  }
  // How short the names fall: the largest share λ of their legible size that fits (proportions aside) and its tightest name.
  const fits = λ => searchPlan(c, planner(c, words, trunk, topper, λ));
  let worst = null;
  if (!fits(1)) {
    let lo = 0, hi = 1, best = fits(0);
    for (let i = 0; best && i < 6; i++) { const λ = (lo + hi) / 2, p = fits(λ); if (p) { lo = λ; best = p; } else hi = λ; }
    if (best) for (const [w, cap] of [...words.map((w, i) => [w, best.levels[i].cap]), ...(trunk ? [[trunk, best.trunk.cap]] : [])]) {
      const need = Math.max(MIN_CAP, w.legible), r = cap / need;
      if (!worst || r < worst.r) worst = { w, cap, need, r };
    }
  }
  const why = !worst ? '' : `: «${worst.w.text}» ${worst.cap >= 1 ? `quedaría con letras de ${worst.cap.toFixed(1)} mm y ` : ''}`
    + `con esta fuente necesita al menos ${worst.need.toFixed(1)} mm para que sus letras no se peguen ni se cierren sus huecos`;
  const fix = options.length ? `Para arreglarlo: ${options.join('; ')}; o acorta o quita nombres.` : 'Acorta o quita nombres.';
  const error = new Error(`Los nombres quedarían demasiado pequeños para leerse${why}. ${fix}`);
  error.suggestions = suggestions;
  return error;
}
function planTree(c, words, trunk, topper) {
  const P = planner(c, words, trunk, topper), plan = searchPlan(c, P);
  if (plan) return plan;
  throw tooSmall(c, words, trunk, topper, P);
}
// Join stray islands (hyphens, lowercase dots) to the nearest outline, never through letter counters.
function connectedSection(cs, stroke, CS, own) {
  const islands = cs.decompose().map(own).filter(p => p.area() > 1e-6).sort((a, b) => b.area() - a.area());
  if (!islands.length) return cs;
  let joined = islands.shift();
  while (islands.length) {
    const edge = joined.toPolygons().flat();
    let best = null;
    islands.forEach((island, index) => {
      for (const a of island.toPolygons().flat()) for (const b of edge) {
        const distance = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
        if (!best || distance < best.distance) best = { a, b, distance, index };
      }
    });
    const ends = [best.a, best.b].map(p => own(own(CS.circle(stroke / 2, 24)).translate(p)));
    joined = own(CS.union([joined, islands.splice(best.index, 1)[0], own(CS.hull(ends))]));
  }
  return joined;
}
function wordProfile(w, L, rails, nextFoot, s, CS, own, minFoot = 0) {
  const rect = (x0, y0, x1, y1) => rectangle(CS, own, x0, y0, x1, y1);
  const e = extent(w, L.τ), y0 = L.bottom, X = x => L.σ * (x - e.cx);
  const spaced = key => own(CS.union(w.glyphs.filter(g => g[key]).map(g => own(g[key].translate([g.i * L.τ, 0])))));
  const place = (cs, dy = 0) => {
    const placed = own(own(own(cs.translate([-e.cx, 0])).scale([L.σ, L.σ])).translate([0, y0 + L.yb + dy]));
    return L.δ > 1e-4 ? own(placed.offset(L.δ, 'Round', 2, 32)) : placed;
  };
  const foot = [Math.min(X(e.foot[0]) - L.δ, -minFoot / 2), Math.max(X(e.foot[1]) + L.δ, minFoot / 2)];
  const head = [X(e.head[0]) - L.δ, X(e.head[1]) + L.δ];
  const rail = nextFoot ? [Math.min(head[0], nextFoot[0]), Math.max(head[1], nextFoot[1])] : head;
  const pieces = [place(spaced('body')), rect(foot[0], y0, foot[1], y0 + rails.rb), rect(rail[0], y0 + L.yc, rail[1], y0 + L.yc + rails.rt)];
  if (w.mark) {
    const holes = place(spaced('marks'), L.lift), hb = holes.bounds();
    pieces.push(own(rect(Math.min(rail[0], hb.min[0] - s), y0 + L.yc, Math.max(rail[1], hb.max[0] + s), y0 + L.height).subtract(holes)));
  }
  const cs = own(own(CS.union(pieces)).intersect(rect(-BIG, y0, BIG, y0 + L.height)));
  return { cs: connectedSection(cs, s, CS, own), foot };
}
function topperProfile(T, P, rails, s, CS, own) {
  const rect = (x0, y0, x1, y1) => rectangle(CS, own, x0, y0, x1, y1);
  const y0 = P.bottom, σ = (P.width - s) / T.w;
  const shape = own(own(own(own(T.cs.translate([-(T.b.min[0] + T.b.max[0]) / 2, -T.b.min[1]])).scale([σ, σ]))
    .offset(s / 2, 'Round', 2, 32)).translate([0, y0 + rails.rb - P.cut + s / 2]));
  const legs = own(shape.intersect(rect(-BIG, y0, BIG, y0 + rails.rb))), lb = legs.isEmpty() ? null : legs.bounds();
  const foot = [Math.min(lb ? lb.min[0] : 0, -0.15 * P.width), Math.max(lb ? lb.max[0] : 0, 0.15 * P.width)];
  const cs = own(own(CS.union([shape, rect(foot[0], y0, foot[1], y0 + rails.rb)])).intersect(rect(-BIG, y0, BIG, y0 + P.band)));
  return { cs: connectedSection(cs, s, CS, own), foot };
}
function xExtent(cs, y0, y1, CS, own) {
  const slice = own(cs.intersect(rectangle(CS, own, -BIG, y0, BIG, y1)));
  if (slice.isEmpty()) return null;
  const b = slice.bounds();
  return [b.min[0], b.max[0]];
}
// X intervals where the section is solid over the whole band [y0, y1].
function solidIntervals(cs, y0, y1, CS, own) {
  const gaps = own(rectangle(CS, own, -BIG, y0, BIG, y1).subtract(cs)).decompose().map(own).filter(g => g.area() > 1e-5)
    .map(g => { const b = g.bounds(); return [b.min[0], b.max[0]]; }).sort((a, b) => a[0] - b[0]);
  const out = [];
  let x = -BIG;
  for (const [a, b] of gaps) { if (a > x + 1e-9) out.push([x, a]); x = Math.max(x, b); }
  if (x < BIG) out.push([x, BIG]);
  return out.filter(([a, b]) => a > -BIG + 1 && b < BIG - 1);
}
const shrink = (list, m) => list.map(([a, b]) => [a + m, b - m]).filter(([a, b]) => b >= a);
const overlapIntervals = (A, B) => A.flatMap(([a0, a1]) => B.map(([b0, b1]) => [Math.max(a0, b0), Math.min(a1, b1)])).filter(([a, b]) => b >= a);
function nearest(list, x, lo = -Infinity, hi = Infinity) {
  let best = null;
  for (const [a, b] of list) {
    const a2 = Math.max(a, lo), b2 = Math.min(b, hi);
    if (b2 < a2) continue;
    const v = clamp(x, a2, b2);
    if (best === null || Math.abs(v - x) < Math.abs(best - x)) best = v;
  }
  return best;
}
// Trapezoid keys stay inside the depth (skin on both faces) and inside the solid rails/letters above and below the
// joint, so no seam is visible from the front or the back. Their 50° flanks print without supports. A key rises from
// the lower piece (dir 1) or hangs from the upper one (dir −1), whichever side has more solid letter to hide its groove.
function placeKeys(lower, upper, y, cfg, depth, limits, tilt, names, CS, own) {
  const c = cfg.clearance, flank = FLANK * Math.PI / 180 + tilt, tan = Math.tan(flank);
  // The groove is the key grown by the clearance, so its mouth on the joint face is c / cos(flank) wider than the key.
  const skin = clamp(0.15 * depth(y), 1.2, 2), room = (depth(y + 0.2) / 2 - skin - c / Math.cos(flank) - KEY_TIP / 2) / tan;
  if (Math.min(KEY_MAX, room) < KEY_MIN) throw new Error('El grosor es demasiado delgado para las guías ocultas: aumenta el grosor superior.');
  const below = xExtent(lower, y - 0.3, y, CS, own), above = xExtent(upper, y, y + 0.3, CS, own);
  const x0 = Math.max(below?.[0] ?? 0, above?.[0] ?? 0), x1 = Math.min(below?.[1] ?? 0, above?.[1] ?? 0);
  if (!below || !above || x1 <= x0) throw new Error(`«${names[1]}» no se apoya sobre «${names[0]}».`);
  const m = (x0 + x1) / 2, span = x1 - x0, cache = new Map();
  const memo = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
  const ways = [
    { dir: 1, pMax: Math.min(KEY_MAX, limits.up, room), base: solidIntervals(lower, y - 0.6, y - 0.02, CS, own),
      deep: p => memo(`u${p}`, () => solidIntervals(upper, y + 0.05, y + p + c + 0.8, CS, own)) },
    { dir: -1, pMax: Math.min(KEY_MAX, limits.down, room), base: solidIntervals(upper, y + 0.02, y + 0.6, CS, own),
      deep: p => memo(`d${p}`, () => solidIntervals(lower, y - p - c - 0.8, y - 0.05, CS, own)) },
  ].filter(w => w.pMax >= KEY_MIN);
  const longest = clamp(0.1 * span, 4, 10), lengths = [longest, 5, 3].filter((v, i) => i === 0 || v < longest);
  // Each key independently takes the longest size that still reaches a good depth there, otherwise its deepest one.
  const pickWay = (way, lo, hi, target) => {
    const depths = [], good = Math.min(way.pMax, KEY_GOOD);
    for (let p = way.pMax; p > KEY_MIN + 1e-9; p -= 0.25) depths.push(p);
    depths.push(KEY_MIN);
    let fallback = null;
    for (const len of lengths) for (const p of depths) {
      const sep = len / 2 + c + 1.2, options = overlapIntervals(shrink(way.deep(p), sep), shrink(way.base, len / 2 + 0.3));
      const x = options.length ? nearest(options, target, lo(sep), hi(sep)) : null;
      if (x === null) continue;
      if (p >= good - 1e-9) return { x, len, p, dir: way.dir, good: true };
      if (!fallback || p > fallback.p + 1e-9) fallback = { x, len, p, dir: way.dir, good: false };
      break;
    }
    return fallback;
  };
  const better = (a, b) => !b ? a : !a ? b : a.good !== b.good ? (a.good ? a : b)
    : a.good ? (a.len > b.len + 1e-9 || (Math.abs(a.len - b.len) < 1e-9 && a.p > b.p) ? a : b) : (a.p > b.p + 1e-9 ? a : b);
  const pick = (lo, hi, target) => ways.reduce((best, way) => better(pickWay(way, lo, hi, target), best), null);
  const left = pick(() => -Infinity, sep => m - sep, m - span / 4), right = pick(sep => m + sep, () => Infinity, m + span / 4);
  const single = left && right ? null : pick(() => -Infinity, () => Infinity, m);
  const chosen = left && right ? [left, right] : single ? [single] : null;
  if (!chosen) throw new Error(`No hay espacio para las guías ocultas entre «${names[0]}» y «${names[1]}». Aumenta el tamaño o el trazo mínimo.`);
  return { skin, keys: chosen.map(({ x, len, p, dir }) => ({ x, len, p, dir, a: KEY_TIP / 2 + p * tan, t: KEY_TIP })) };
}
function keyPrism(key, y, grow, CS, Manifold, own) {
  const { a, t, p } = key, d = key.dir ?? 1, wide = a + 0.5 * (a - t / 2) / p;
  // The flanks run straight 0.5 mm past the joint face (hidden in the other piece), so the grown groove has no ledge
  // at its mouth that would hang over the bed.
  let section = own(new CS([[[-wide, y - 0.5 * d], [wide, y - 0.5 * d], [t / 2, y + p * d], [-t / 2, y + p * d]]], 'EvenOdd'));
  if (grow) section = own(section.offset(grow, 'Miter', 2));
  const length = key.len + 2 * grow;
  // Extruded along Z, then turned so the prism runs along X: (u, v, w) → (w, v, −u).
  return own(own(own(section.extrude(length)).rotate([0, 90, 0])).translate([key.x - length / 2, 0, 0]));
}
function centerOfMass(solids) {
  let volume = 0;
  const g = [0, 0, 0];
  for (const solid of solids) {
    const m = solid.getMesh(), P = m.vertProperties, n = m.numProp, T = m.triVerts;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * n, b = T[t + 1] * n, d = T[t + 2] * n;
      const v = (P[a] * (P[b + 1] * P[d + 2] - P[b + 2] * P[d + 1]) - P[a + 1] * (P[b] * P[d + 2] - P[b + 2] * P[d])
        + P[a + 2] * (P[b] * P[d + 1] - P[b + 1] * P[d])) / 6;
      volume += v;
      for (let i = 0; i < 3; i++) g[i] += v * (P[a + i] + P[b + i] + P[d + i]) / 4;
    }
  }
  return g.map(v => v / volume);
}
export function nameTreeSolids(input, { font } = {}) {
  if (!engine || !font) throw new Error('Prepara el motor 3D y la fuente antes de generar el árbol.');
  const c = normalizeNameTree(input), own = scope(), CS = engine.CrossSection, Manifold = engine.Manifold;
  try {
    const metrics = fontMetrics(font, CS, own), cased = c.uppercase;
    const words = c.names.map((n, index) => ({
      ...rawWord(font, cased ? n.text.toLocaleUpperCase('es') : n.text, cased, metrics, CS, own), index, color: n.color,
    }));
    // Automatic order puts long names low, where the tree is wide, so every name keeps the largest letters.
    if (c.order === 'auto') words.sort(byLength);
    const trunk = c.trunk === 'text' ? rawWord(font, cased ? c.trunkText.toLocaleUpperCase('es') : c.trunkText, cased, metrics, CS, own) : null;
    const s = c.minStroke, gap = gapFor(s);
    for (const w of trunk ? [...words, trunk] : words) w.legible = legibleCap(w, s, gap);
    const topper = topperShape(c, CS, own), plan = planTree(c, words, trunk, topper), rails = plan.rails;
    // Profiles are built from the top down so each top rail can carry the foot of the piece above it.
    const top = topperProfile(topper, plan.top, rails, s, CS, own), levels = [];
    let nextFoot = top.foot;
    for (let i = words.length - 1; i >= 0; i--) {
      levels[i] = wordProfile(words[i], plan.levels[i], rails, nextFoot, s, CS, own);
      nextFoot = levels[i].foot;
    }
    const base = trunk ? wordProfile(trunk, plan.trunk, rails, null, s, CS, own, 0.3 * plan.W) : {
      cs: rectangle(CS, own, -0.15 * plan.W, 0, 0.15 * plan.W, plan.trunk.height), foot: [-0.15 * plan.W, 0.15 * plan.W],
    };
    const profiles = [base, ...levels, top].map(p => p.cs);
    const parts = [
      { name: 'Tronco', role: 'trunk', color: c.colors.trunk },
      ...words.map((w, i) => ({ name: w.text, role: 'name', sourceIndex: w.index, color: w.color || c.colors[i % 2 ? 'second' : 'first'] })),
      { name: TOPPERS[c.shape], role: 'top', color: c.colors.top },
    ];
    const H = plan.height, tilt = Math.atan((c.bottomDepth - c.topDepth) / (2 * H));
    const depth = y => c.bottomDepth + (c.topDepth - c.bottomDepth) * clamp(y / H, 0, 1);
    const bodies = profiles.map(p => own(own(p.extrude(1)).warp(v => { v[2] = (v[2] - 0.5) * depth(v[1]); })));
    const bottoms = [0, ...plan.levels.map(l => l.bottom), plan.top.bottom], joints = [];
    const caps = [trunk ? plan.trunk.cap : plan.trunk.height, ...plan.levels.map(l => l.cap), plan.top.height / 2];
    for (let i = 0; i + 1 < profiles.length; i++) {
      const y = bottoms[i + 1], limits = { up: 0.3 * caps[i + 1], down: 0.3 * caps[i] };
      const { keys, skin } = placeKeys(profiles[i], profiles[i + 1], y, c, depth, limits, tilt, [parts[i].name, parts[i + 1].name], CS, own);
      for (const [dir, male, female] of [[1, i, i + 1], [-1, i + 1, i]]) {
        const set = keys.filter(k => k.dir === dir);
        if (!set.length) continue;
        bodies[male] = own(Manifold.union([bodies[male], ...set.map(k => keyPrism(k, y, 0, CS, Manifold, own))]));
        bodies[female] = own(bodies[female].subtract(own(Manifold.union(set.map(k => keyPrism(k, y, c.clearance, CS, Manifold, own))))));
      }
      joints.push({ lower: i, upper: i + 1, y, keys, clearance: c.clearance, skin });
    }
    parts.forEach((part, i) => {
      const solid = bodies[i];
      if (solid.status() !== 'NoError' || solid.volume() <= 0 || solid.decompose().map(own).length !== 1) {
        throw new Error(`«${part.name}» no forma una pieza sólida. Aumenta el tamaño o cambia la fuente/silueta.`);
      }
      Object.assign(part, { profile: profiles[i], solid, bounds: solid.boundingBox(), tilt });
      part.size = boundsSize(own(solid.rotate([-degrees(tilt), 0, 0])).boundingBox());
    });
    const g = centerOfMass(bodies), [f0, f1] = base.foot, lean = Math.abs(g[2]);
    const minX = Math.min(...parts.map(p => p.bounds.min[0])), maxX = Math.max(...parts.map(p => p.bounds.max[0]));
    const result = {
      width: maxX - minX, height: Math.max(...parts.map(p => p.bounds.max[1])), depth: c.bottomDepth,
      W: plan.W, k: plan.k, tilt: degrees(tilt), rails,
      trunk: { type: c.trunk, text: trunk?.text ?? '', cap: trunk ? plan.trunk.cap : 0, width: f1 - f0, height: plan.trunk.height },
      levels: words.map((w, i) => ({ index: w.index, text: w.text, cap: plan.levels[i].cap, legible: w.legible, accents: w.accents,
        width: plan.levels[i].width, bottom: plan.levels[i].bottom, height: plan.levels[i].height })),
      top: { shape: c.shape, width: plan.top.width, height: plan.top.band, bottom: plan.top.bottom },
      stability: {
        center: g, frontBack: degrees(Math.atan2(c.bottomDepth / 2 - lean, g[1])),
        sideways: degrees(Math.atan2(Math.min(g[0] - f0, f1 - g[0]), g[1])),
        suggestedBottomDepth: Math.ceil(2 * (g[1] * Math.tan(STABLE_DEG * Math.PI / 180) + lean)),
      },
    };
    return { cfg: c, plan: result, parts, joints, dispose: own.dispose };
  } catch (error) { own.dispose(); throw error; }
}
function geometryOf(solid) {
  const m = solid.getMesh(), positions = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) for (let j = 0; j < 3; j++) positions[i * 3 + j] = m.vertProperties[i * m.numProp + j];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1));
  const shaded = toCreasedNormals(g, Math.PI / 4); g.dispose();
  return shaded;
}
export function buildNameTree(cfg, options) {
  const sol = nameTreeSolids(cfg, options);
  try {
    const filaments = [];
    const parts = sol.parts.map(({ solid, profile, ...p }) => {
      if (!filaments.includes(p.color)) filaments.push(p.color);
      return { ...p, filamentIndex: filaments.indexOf(p.color), geometry: geometryOf(solid) };
    });
    const warnings = [], st = sol.plan.stability;
    if (st.frontBack < STABLE_DEG) warnings.push(`Poca estabilidad hacia delante/atrás (${st.frontBack.toFixed(1)}°): usa un grosor inferior de al menos ${st.suggestedBottomDepth} mm.`);
    if (st.sideways < STABLE_DEG) warnings.push(`Poca estabilidad lateral (${st.sideways.toFixed(1)}°): usa un tronco más ancho o un árbol más bajo.`);
    return { cfg: sol.cfg, plan: sol.plan, joints: sol.joints, parts, filaments, warnings };
  } finally { sol.dispose(); }
}
export function packNameTree(result) {
  const { bedWidth, bedHeight } = result.cfg, margin = 6, gap = 4, plates = [];
  const colors = [...new Set(result.parts.map(p => p.color))];
  for (const color of colors) {
    const group = result.parts.map((p, index) => ({ p, index })).filter(q => q.p.color === color)
      .sort((a, b) => b.p.size[0] * b.p.size[1] - a.p.size[0] * a.p.size[1]);
    let plate, x, y, row;
    const fresh = () => { plate = { color, placements: [] }; plates.push(plate); x = y = margin; row = 0; };
    fresh();
    for (const { p, index } of group) {
      const variants = [false, true].map(rotate => ({ rotate, width: p.size[rotate ? 1 : 0], height: p.size[rotate ? 0 : 1] }))
        .filter(v => v.width <= bedWidth - 2 * margin + 1e-5 && v.height <= bedHeight - 2 * margin + 1e-5).sort((a, b) => a.height - b.height);
      if (!variants.length) throw new Error(`«${p.name}» no cabe en la placa de ${bedWidth} × ${bedHeight} mm. Reduce el árbol o aumenta la placa.`);
      let fit = variants.find(v => x + v.width <= bedWidth - margin + 1e-5 && y + v.height <= bedHeight - margin + 1e-5);
      if (!fit) {
        x = margin; y += row + gap; row = 0;
        fit = variants.find(v => y + v.height <= bedHeight - margin + 1e-5);
      }
      if (!fit) { fresh(); fit = variants[0]; }
      plate.placements.push({ index, x, y, ...fit });
      x += fit.width + gap; row = Math.max(row, fit.height);
    }
  }
  return plates;
}
// Print pose: the piece lies on its back face, which the taper tilts by `tilt` around X.
export function placedTreeGeometry(part, placement = { x: 0, y: 0, rotate: false }) {
  const g = part.geometry.clone();
  if (part.tilt) g.rotateX(-part.tilt);
  if (placement.rotate) g.rotateZ(Math.PI / 2);
  g.computeBoundingBox();
  g.translate(placement.x - g.boundingBox.min.x, placement.y - g.boundingBox.min.y, -g.boundingBox.min.z);
  return g;
}
export function nameTreeProject(cfg) {
  return JSON.stringify({ app: NAME_TREE_APP, version: 2, cfg: normalizeNameTree(cfg) });
}
// Version 1 trees had a flat back and much thinner tops; keep their names, colors and limits.
function migrateV1(cfg) {
  const top = Math.max(6, Number(cfg.topDepth) || 6);
  return { ...cfg, trunk: 'text', order: cfg.order === 'manual' ? 'manual' : 'auto',
    topDepth: top, bottomDepth: Math.max(8, top, Number(cfg.bottomDepth) || 8) };
}
export function readNameTreeProject(value) {
  let j;
  try { j = typeof value === 'string' ? JSON.parse(value) : value; } catch { throw new Error('El archivo no es un proyecto válido.'); }
  if (j?.app !== NAME_TREE_APP || ![1, 2].includes(j.version) || !j.cfg || typeof j.cfg !== 'object') {
    throw new Error('Proyecto de árbol de nombres no compatible.');
  }
  return normalizeNameTree(j.version === 1 ? migrateV1(j.cfg) : j.cfg);
}
export function nameTreeAssembly(result) {
  const parts = result.parts.map(p => ({ ...p, geometry: p.geometry.clone().rotateX(Math.PI / 2) }));
  try { return threeMF(parts, result.cfg.name); }
  finally { parts.forEach(p => p.geometry.dispose()); }
}
export function nameTreeFiles(result, { profile } = {}) {
  const plates = packNameTree(result), files = [
    { name: 'Proyecto.r3t', data: nameTreeProject(result.cfg) },
    { name: 'Vista_armada_NO_IMPRIMIR.3mf', data: nameTreeAssembly(result) },
  ];
  result.parts.forEach((p, index) => {
    const g = placedTreeGeometry(p);
    try { files.push({ name: `Pieza_${String(index + 1).padStart(2, '0')}.stl`, data: stlBinary([g]) }); }
    finally { g.dispose(); }
  });
  const plateFiles = [];
  plates.forEach((plate, index) => {
    const parts = plate.placements.map(pos => ({ ...result.parts[pos.index], filamentIndex: 0, geometry: placedTreeGeometry(result.parts[pos.index], pos) }));
    try {
      const name = `Placa_${String(index + 1).padStart(3, '0')}${profile ? '_Bambu_A1' : ''}.3mf`;
      const assemblies = parts.map((p, i) => ({ name: `Pieza ${plate.placements[i].index + 1} · ${p.name}`, parts: [i], settings: { enable_support: '0' } }));
      files.push({ name, data: threeMF(parts, result.cfg.name, { assemblies, ...(profile ? { bambu: profile } : {}) }) });
      plateFiles.push(name);
    } finally { parts.forEach(p => p.geometry.dispose()); }
  });
  const { plan, cfg } = result, st = plan.stability;
  files.push({ name: 'Montaje.txt', data: [
    cfg.name, `${plan.width.toFixed(1)} mm de ancho × ${plan.height.toFixed(1)} mm de alto.`,
    `Grosor: ${cfg.bottomDepth} mm abajo → ${cfg.topDepth} mm arriba, repartido por igual delante y detrás (${plan.tilt.toFixed(1)}° por cara): el árbol queda vertical.`,
    `Estabilidad: aguanta ${st.frontBack.toFixed(1)}° hacia delante o atrás y ${st.sideways.toFixed(1)}° de lado antes de volcar.`,
    '', 'IMPRIMIR: Placa_*.3mf. Cada pieza va acostada sobre su espalda, sin soportes. Una placa = un color, sin AMS.',
    'Vista_armada_NO_IMPRIMIR.3mf sirve solo para comprobar el montaje.',
    ...plates.map((p, i) => `Placa ${i + 1} (${p.color}): ${p.placements.map(q => `pieza ${q.index + 1}`).join(', ')}.`),
    '', 'MONTAJE, desde abajo:', ...result.parts.map((p, i) => `${i + 1}. ${p.name}`),
    'Cada unión tiene guías ocultas dentro del grosor: no se ven por delante ni por detrás.',
    'Baja cada pieza en vertical sobre la anterior, con las caras alineadas, hasta que las barras queden a ras.',
    `Holgura por lado: ${cfg.clearance} mm. Comprueba primero una pareja: la tolerancia real depende de tu impresora y material.`,
    'Si queda flojo, reduce la holgura o fija con una gota de adhesivo apropiado. Para reajustar usa Proyecto.r3t.',
  ].join('\r\n') });
  return { files, plateFiles, plates };
}

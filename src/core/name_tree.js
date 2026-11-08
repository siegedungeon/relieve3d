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
const FLANK = 50, KEY_TIP = 1, KEY_MIN = 0.8, KEY_GOOD = 2.5, KEY_MAX = 6;
const TOO_SMALL = 'Los nombres o encajes quedarían demasiado pequeños. Aumenta el alto/ancho máximo o reduce la cantidad/longitud de los nombres.';
const tooSmall = c => new Error(c.order === 'manual' ? `${TOO_SMALL} También puedes usar el orden automático (largos abajo).` : TOO_SMALL);
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
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
  return lo;
};
function inkSection(font, text, CS, own) {
  const glyphs = layoutText(font, text, 100).map(g => own(new CS(
    g.contours.map(c => flatten(c, 0.04).map(([x, y]) => [x, -y])), 'EvenOdd')));
  return glyphs.length ? own(CS.union(glyphs)) : null;
}
const metricsCache = new WeakMap();
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
// Capitals are split at the cap height: marks above it (accents, tildes) become windows in a flat top band,
// so every piece keeps a flat top for the next one and no accent floats loose.
function rawWord(font, text, cased, metrics, CS, own) {
  for (const ch of [...text]) if (!/\s/.test(ch) && !font.charToGlyphIndex(ch)) {
    throw new Error(`La fuente no tiene el carácter «${ch}» de «${text}». Elige otra fuente o cambia ese carácter.`);
  }
  const empty = () => new Error(`«${text}» no contiene letras imprimibles.`);
  const rect = (x0, y0, x1, y1) => rectangle(CS, own, x0, y0, x1, y1);
  const ink = inkSection(font, text, CS, own);
  if (!ink || ink.isEmpty()) throw empty();
  const { capH, stem } = metrics, cut = 1.03 * capH;
  const body = cased ? own(ink.intersect(rect(-BIG, -BIG, BIG, cut))) : ink;
  if (body.isEmpty() || body.area() < 1e-6) throw empty();
  let marks = cased ? own(ink.subtract(rect(-BIG, -BIG, BIG, cut))) : null;
  if (marks && (marks.isEmpty() || marks.area() < 1e-4)) marks = null;
  const b = body.bounds(), full = [b.min[0], b.max[0]], top = cased ? capH : b.max[1];
  const span = (y0, y1) => {
    const s = own(body.intersect(rect(-BIG, y0, BIG, y1)));
    if (s.isEmpty() || s.area() < 1e-6) return null;
    const sb = s.bounds();
    return [sb.min[0], sb.max[0]];
  };
  const mb = marks?.bounds();
  return {
    text, body, marks, accents: marks ? marks.decompose().map(own).length : 0, capH, stem, cased,
    cx: (full[0] + full[1]) / 2, x0: full[0], x1: full[1], maxY: b.max[1], top,
    foot: span(-0.03 * capH, 0.1 * capH) || full, head: span(top - 0.1 * capH, cased ? cut : top + 1) || full,
    mark: mb && { x0: mb.min[0], x1: mb.max[0], y0: mb.min[1], y1: mb.max[1] },
    aspect: (full[1] - full[0]) / capH,
  };
}
// Vertical layout of one word band for scale σ; δ thickens thin strokes up to the minimum stroke.
function wordDims(w, σ, s, rails) {
  const δ = clamp((s - 0.75 * w.stem * σ) / 2, 0, s / 2);
  let half = σ * (w.x1 - w.x0) / 2 + δ;
  const yb = rails.rb - OV + δ, yc = yb + σ * w.top + δ - OV;
  let height = yc + rails.rt, lift = 0;
  if (w.mark) {
    half = Math.max(half, σ * (w.cx - w.mark.x0) + δ + s, σ * (w.mark.x1 - w.cx) + δ + s);
    const floor = Math.max(yc, yb + σ * w.maxY + δ) + s;
    lift = Math.max(0, floor - (yb + σ * w.mark.y0 - δ));
    height = Math.max(height, yb + σ * w.mark.y1 + δ + lift + Math.max(rails.rt, s));
  }
  return { δ, yb, yc, height, lift, width: 2 * half, cap: σ * w.capH };
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
// Reference rule: every band is as wide as the triangle at its top, width = k·(apex − top).
function layoutTree(c, words, trunk, topper, W, k) {
  const s = c.minStroke, rails = { rb: Math.max(s + 1, 0.012 * W), rt: Math.max(s, 0.0065 * W) };
  const dims = (w, σ) => wordDims(w, σ, s, rails), span = w => w.x1 - w.x0;
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
  const g = tw => tw - k * (rem - rails.rb - (topper.wy - 0.08) * shapeH(tw));
  const fit = g(0) < 0 ? root(g, 0, k * rem + 1) : 0, tw = clamp(fit, TOP_MIN * W, TOP_MAX * W), h = shapeH(tw);
  const top = { width: tw, fit, height: h, cut: 0.08 * h, bottom: y, band: rails.rb - 0.08 * h + h };
  const ok = levels.every(l => l.cap >= Math.max(MIN_CAP, CAP_FRAC * W)) && trunkPlan.cap >= MIN_CAP && tw >= MIN_TOPPER
    && levels.at(-1).width >= TOP_WORD * tw;
  return { ok, W, k, rails, apex, trunk: trunkPlan, levels, top, height: y + top.band };
}
// Use the full width when possible, then the tallest slope in [K_MIN, K_MAX] that respects the maximum height
// (steeper, down to K_LO, only when the proportion rules demand it).
function planTree(c, words, trunk, topper) {
  const at = (W, k) => layoutTree(c, words, trunk, topper, W, k), tall = p => p.height > c.maxHeight + 1e-6;
  const largestK = W => {
    if (at(W, K_MAX).ok) return K_MAX;
    if (!at(W, K_LO).ok) return null;
    let lo = K_LO, hi = K_MAX;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (at(W, mid).ok) lo = mid; else hi = mid; }
    return lo;
  };
  let W = c.maxWidth, kv = largestK(W);
  if (kv === null) throw tooSmall(c);
  if (tall(at(W, kv))) {
    let lo = Math.min(20, W), hi = W;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2, km = largestK(mid);
      if (km === null || !tall(at(mid, km))) lo = mid; else hi = mid;
    }
    W = lo; kv = largestK(W);
    if (kv === null || tall(at(W, kv))) throw tooSmall(c);
  }
  const low = Math.min(K_MIN, kv);
  if (!tall(at(W, low))) return at(W, low);
  let lo = low, hi = kv;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (tall(at(W, mid))) lo = mid; else hi = mid; }
  return at(W, hi);
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
  const y0 = L.bottom, X = x => L.σ * (x - w.cx);
  const place = (cs, dy = 0) => {
    const placed = own(own(own(cs.translate([-w.cx, 0])).scale([L.σ, L.σ])).translate([0, y0 + L.yb + dy]));
    return L.δ > 1e-4 ? own(placed.offset(L.δ, 'Round', 2, 32)) : placed;
  };
  const foot = [Math.min(X(w.foot[0]) - L.δ, -minFoot / 2), Math.max(X(w.foot[1]) + L.δ, minFoot / 2)];
  const head = [X(w.head[0]) - L.δ, X(w.head[1]) + L.δ];
  const rail = nextFoot ? [Math.min(head[0], nextFoot[0]), Math.max(head[1], nextFoot[1])] : head;
  const pieces = [place(w.body), rect(foot[0], y0, foot[1], y0 + rails.rb), rect(rail[0], y0 + L.yc, rail[1], y0 + L.yc + rails.rt)];
  if (w.marks) {
    const holes = place(w.marks, L.lift), hb = holes.bounds();
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
    if (c.order === 'auto') words.sort((a, b) => b.aspect - a.aspect || a.index - b.index);
    const trunk = c.trunk === 'text' ? rawWord(font, cased ? c.trunkText.toLocaleUpperCase('es') : c.trunkText, cased, metrics, CS, own) : null;
    const topper = topperShape(c, CS, own), plan = planTree(c, words, trunk, topper), s = c.minStroke, rails = plan.rails;
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
      levels: words.map((w, i) => ({ index: w.index, text: w.text, cap: plan.levels[i].cap, accents: w.accents,
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

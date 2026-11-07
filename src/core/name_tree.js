// Original parametric name tree. XY is the front silhouette; Z is depth, with every back at Z=0.
// All parts print in that plane. Assembly rotates the entire tree, never individual words.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { HABLADOR_FONTS, layoutText, flatten, heartC } from './hablador.js';
import { threeMF, stlBinary } from './exporters.js';

export const NAME_TREE_APP = 'Relieve3D-ArbolNombres';
export const NAME_TREE_FONTS = HABLADOR_FONTS;
export const DEFAULT_NAME_TREE = () => ({
  name: 'Árbol de mi familia',
  names: [{ text: 'Sofía' }, { text: 'Mateo' }, { text: 'Valentina' }],
  font: 'Montserrat Black', uppercase: true, order: 'auto',
  maxWidth: 180, maxHeight: 240, bottomDepth: 18, topDepth: 5,
  minStroke: 1.2, clearance: 0.2,
  shape: 'star', custom: null,
  colors: { first: '#c12e1f', second: '#008b45', trunk: '#754629', top: '#fec600' },
  bedWidth: 256, bedHeight: 256,
});
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
    order: input.order === 'manual' ? 'manual' : 'auto',
    shape: input.shape ?? d.shape, custom: input.custom ?? null, colors: {},
  };
  for (const [k, lo, hi, label] of [
    ['maxWidth', 40, 500, 'Ancho máximo'], ['maxHeight', 60, 600, 'Alto máximo'],
    ['bottomDepth', 4, 60, 'Grosor inferior'], ['topDepth', 2, 60, 'Grosor superior'],
    ['minStroke', 0.8, 3, 'Trazo mínimo'], ['clearance', 0.12, 0.5, 'Holgura por lado'],
    ['bedWidth', 80, 500, 'Ancho de placa'], ['bedHeight', 80, 500, 'Largo de placa'],
  ]) c[k] = number(input[k], d[k], lo, hi, label);
  if (c.topDepth > c.bottomDepth) throw new Error('El grosor superior no puede superar el inferior.');
  if (!NAME_TREE_FONTS[c.font]) throw new Error('La fuente seleccionada no está disponible.');
  if (!['star', 'heart', 'circle', 'custom'].includes(c.shape)) throw new Error('Remate no válido.');
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
function wordSection(font, text, CS, own) {
  for (const ch of [...text]) if (!/\s/.test(ch) && !font.charToGlyphIndex(ch)) {
    throw new Error(`La fuente no tiene el carácter «${ch}» de «${text}». Elige otra fuente o cambia ese carácter.`);
  }
  const glyphs = layoutText(font, text, 100).map(g => own(new CS(
    g.contours.map(c => flatten(c, 0.04).map(([x, y]) => [x, -y])), 'EvenOdd')));
  if (!glyphs.length) throw new Error(`«${text}» no contiene letras imprimibles.`);
  const cs = own(CS.union(glyphs)), b = cs.bounds(), [width, height] = boundsSize(b);
  if (!(width > 0 && height > 0)) throw new Error(`«${text}» no contiene letras imprimibles.`);
  return { cs, b, width, height };
}
function topperSection(c, CS, own) {
  let cs;
  if (c.shape === 'custom') {
    if (!c.custom) throw new Error('Carga una silueta para el remate personalizado.');
    cs = own(new CS(c.custom, 'EvenOdd'));
    const pieces = cs.decompose().map(own);
    if (pieces.length !== 1 || cs.area() <= 0) throw new Error('El remate debe ser una sola silueta conectada, sin islas sueltas.');
  } else if (c.shape === 'circle') cs = own(CS.circle(0.5, 96));
  else if (c.shape === 'heart') cs = own(new CS([flatten(heartC(0, 0, 1), 0.001).map(([x, y]) => [x, -y])], 'EvenOdd'));
  else cs = own(new CS([Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.23 : 0.5;
    return [r * Math.cos(a), r * Math.sin(a)];
  })]));
  const b = cs.bounds(), [width, height] = boundsSize(b);
  if (!(width > 0 && height > 0)) throw new Error('La silueta del remate está vacía.');
  return { cs, b, width, height };
}
function planTree(c, words, top) {
  const stroke = c.minStroke, socketHeight = 3 + c.clearance + stroke;
  const count = words.length, fraction = 0.34 + 0.2 / count;
  const sizeAt = width => {
    let y = Math.max(9, width * 0.14);
    const trunkHeight = y;
    const levels = words.map((word, i) => {
      const w = width * (count === 1 ? 1 : 1 - (1 - fraction) * i / (count - 1));
      const scale = (w - stroke) / word.width, inkHeight = word.height * scale + stroke;
      const level = { index: word.index, text: word.text, width: w, scale, inkHeight, bottom: y, height: inkHeight + socketHeight };
      y += level.height;
      return level;
    });
    const topWidth = width * Math.min(0.28, fraction * 0.9), topScale = (topWidth - stroke) / top.width;
    const topHeight = top.height * topScale + stroke, topBottom = y;
    y += socketHeight + topHeight;
    return { width, height: y, trunkHeight, levels, topWidth, topScale, topHeight, topBottom, socketHeight };
  };
  let lo = 1, hi = c.maxWidth;
  if (sizeAt(hi).height > c.maxHeight) {
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (sizeAt(mid).height > c.maxHeight) hi = mid; else lo = mid;
    }
    hi = lo;
  }
  const p = sizeAt(hi);
  if (p.width < 30 || p.topWidth < 12 || p.levels.some(l => l.inkHeight < 6 || l.width < 12)) {
    throw new Error('Los nombres o encajes quedarían demasiado pequeños. Aumenta el alto/ancho máximo o reduce la cantidad/longitud de los nombres.');
  }
  return p;
}
function rectangle(CS, own, x0, y0, x1, y1) {
  return own(own(CS.square([x1 - x0, y1 - y0])).translate([x0, y0]));
}
function fitSection(shape, scale, x, y, stroke, own) {
  return own(own(own(shape.cs.translate([-(shape.b.min[0] + shape.b.max[0]) / 2, -shape.b.min[1]]))
    .scale([scale, scale])).translate([x, y + stroke / 2])).offset(stroke / 2, 'Round', 2, 32);
}
// Join accent marks/dots to the nearest solid outline, not through the counters of the letters.
function connectedSection(cs, stroke, CS, own) {
  const islands = cs.decompose().map(own).sort((a, b) => b.area() - a.area());
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
function keySection(joint, CS, own) {
  const { y, neck, head, depth } = joint;
  return own(new CS([[
    [-neck / 2, y - 1], [neck / 2, y - 1], [neck / 2, y + 0.15],
    [head / 2, y + depth - 0.4], [head / 2 - 0.4, y + depth],
    [-head / 2 + 0.4, y + depth], [-head / 2, y + depth - 0.4], [-neck / 2, y + 0.15],
  ]]));
}
export function nameTreeSolids(input, { font } = {}) {
  if (!engine || !font) throw new Error('Prepara el motor 3D y la fuente antes de generar el árbol.');
  const c = normalizeNameTree(input), own = scope(), CS = engine.CrossSection;
  try {
    const words = c.names.map((n, index) => {
      const text = c.uppercase ? n.text.toLocaleUpperCase('es') : n.text;
      return { ...wordSection(font, text, CS, own), text, index, color: n.color };
    });
    if (c.order === 'auto') words.sort((a, b) => b.width / b.height - a.width / a.height || a.index - b.index);
    const top = topperSection(c, CS, own), plan = planTree(c, words, top), s = c.minStroke;
    const profiles = [], parts = [];
    const rect = (x0, y0, x1, y1) => rectangle(CS, own, x0, y0, x1, y1);
    const trunkWidth = Math.max(14, plan.width * 0.22), footWidth = Math.max(trunkWidth, plan.width * 0.44);
    profiles.push(own(CS.union([rect(-trunkWidth / 2, 0, trunkWidth / 2, plan.trunkHeight),
      rect(-footWidth / 2, 0, footWidth / 2, Math.min(4, plan.trunkHeight / 3))])));
    parts.push({ name: 'Tronco', role: 'trunk', color: c.colors.trunk });
    plan.levels.forEach((level, i) => {
      const y = level.bottom, w = level.width, word = words[i];
      const ink = own(fitSection(word, level.scale, 0, y + plan.socketHeight - s / 2, s, own));
      const cs = own(CS.union([ink, rect(-w / 2, y, w / 2, y + plan.socketHeight),
        rect(-w / 2, y + level.height - s, w / 2, y + level.height)]));
      profiles.push(connectedSection(cs, s, CS, own));
      parts.push({ name: word.text, role: 'name', sourceIndex: word.index, color: word.color || c.colors[i % 2 ? 'second' : 'first'] });
    });
    const shape = own(fitSection(top, plan.topScale, 0, plan.topBottom + plan.socketHeight, s, own));
    const collarWidth = Math.min(plan.topWidth, Math.max(12, plan.topWidth * 0.36));
    const collar = rect(-collarWidth / 2, plan.topBottom, collarWidth / 2,
      plan.topBottom + plan.socketHeight + plan.topHeight * 0.55);
    profiles.push(connectedSection(own(CS.union([shape, collar])), s, CS, own));
    parts.push({ name: { star: 'Estrella', heart: 'Corazón', circle: 'Círculo', custom: 'Remate personalizado' }[c.shape], role: 'top', color: c.colors.top });
    const joints = [];
    for (let i = 0; i < profiles.length - 1; i++) {
      const y = i === 0 ? plan.trunkHeight : plan.levels[i - 1].bottom + plan.levels[i - 1].height;
      const head = Math.min(9, (i === profiles.length - 2 ? collarWidth : plan.levels[i].width) - 2 * s - 2 * c.clearance);
      if (head < 5) throw new Error('El remate es demasiado estrecho para un encaje resistente.');
      const joint = { lower: i, upper: i + 1, y, head, neck: head * 0.62, depth: 3, clearance: c.clearance };
      const key = keySection(joint, CS, own);
      profiles[i] = own(profiles[i].add(key));
      profiles[i + 1] = own(profiles[i + 1].subtract(own(key.offset(c.clearance, 'Round', 2, 32))));
      joints.push(joint);
    }
    const thickness = y => c.bottomDepth + (c.topDepth - c.bottomDepth) * y / plan.height;
    parts.forEach((part, i) => {
      const solid = own(own(profiles[i].extrude(1)).warp(v => { v[2] *= thickness(v[1]); }));
      if (solid.status() !== 'NoError' || solid.volume() <= 0 || solid.decompose().map(own).length !== 1) {
        throw new Error(`«${part.name}» no forma una pieza sólida. Aumenta el tamaño o cambia la fuente/silueta.`);
      }
      part.solid = solid;
      part.bounds = solid.boundingBox();
      part.size = boundsSize(part.bounds);
    });
    return { cfg: c, plan, parts, joints, dispose: own.dispose };
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
    const parts = sol.parts.map(({ solid, ...p }) => {
      if (!filaments.includes(p.color)) filaments.push(p.color);
      return { ...p, filamentIndex: filaments.indexOf(p.color), geometry: geometryOf(solid) };
    });
    const warnings = [];
    if (sol.cfg.bottomDepth / sol.plan.height < 0.07) warnings.push('Árbol muy alto y delgado: aumenta el grosor inferior para mejorar la estabilidad.');
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
export function placedTreeGeometry(part, placement = { x: 0, y: 0, rotate: false }) {
  const g = part.geometry.clone();
  if (placement.rotate) g.rotateZ(Math.PI / 2);
  g.computeBoundingBox();
  g.translate(placement.x - g.boundingBox.min.x, placement.y - g.boundingBox.min.y, -g.boundingBox.min.z);
  return g;
}
export function nameTreeProject(cfg) {
  return JSON.stringify({ app: NAME_TREE_APP, version: 1, cfg: normalizeNameTree(cfg) });
}
export function readNameTreeProject(value) {
  let j;
  try { j = typeof value === 'string' ? JSON.parse(value) : value; } catch { throw new Error('El archivo no es un proyecto válido.'); }
  if (j?.app !== NAME_TREE_APP || j.version !== 1 || !j.cfg) throw new Error('Proyecto de árbol de nombres no compatible.');
  return normalizeNameTree(j.cfg);
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
  files.push({ name: 'Montaje.txt', data: [
    result.cfg.name, `${result.plan.width.toFixed(1)} mm de ancho × ${result.plan.height.toFixed(1)} mm de alto.`,
    `Grosor: ${result.cfg.bottomDepth} mm abajo → ${result.cfg.topDepth} mm arriba. Espalda plana, sin alternar inclinaciones.`,
    '', 'IMPRIMIR: Placa_*.3mf, piezas acostadas con la espalda en la cama, sin soportes. Una placa = un color, sin AMS.',
    'Vista_armada_NO_IMPRIMIR.3mf sirve solo para comprobar el montaje.',
    ...plates.map((p, i) => `Placa ${i + 1} (${p.color}): ${p.placements.map(q => `pieza ${q.index + 1}`).join(', ')}.`),
    '', 'MONTAJE, desde abajo:', ...result.parts.map((p, i) => `${i + 1}. ${p.name}`),
    'Desliza cada unión por el grosor (de delante hacia atrás), hasta alinear las espaldas. No fuerces el encaje verticalmente.',
    `Holgura por lado: ${result.cfg.clearance} mm. Comprueba primero una pareja: la tolerancia real depende de tu impresora y material.`,
    'Si queda flojo, reduce la holgura o fija con una gota de adhesivo apropiado. Para reajustar usa Proyecto.r3t.',
  ].join('\r\n') });
  return { files, plateFiles, plates };
}

import * as THREE from 'three';
import { threeMF } from './exporters.js';
import { DEFAULT_PHONESTAND, normalizePhoneStand, preparePhoneStand, phoneStandShared as H } from './phonestand.js';

export const CAN_OPENER_SHAPES = [
  { id: 'heart', name: 'Corazón' }, { id: 'star', name: 'Estrella' },
  { id: 'flower', name: 'Flor' }, { id: 'nailpolish', name: 'Esmalte' },
  { id: 'circle', name: 'Círculo' }, { id: 'square', name: 'Cuadrado redondeado' },
  { id: 'mouse', name: 'Ratón' }, { id: 'bear', name: 'Osito' },
  { id: 'cat', name: 'Gatito' }, { id: 'cloud', name: 'Nube' },
  { id: 'crown', name: 'Corona' }, { id: 'custom', name: 'Tu silueta' },
];

export const DEFAULT_CAN_OPENER = () => ({
  name: 'Destapador', shape: 'heart', width: 49, thickness: 8,
  side: 'right',
  attachment: { mount: 'integrated', kind: 'round', position: 'left', diameter: 3, slotWidth: 8, wall: 1.5 },
  logo: { ...DEFAULT_PHONESTAND().logo },
  text: { ...DEFAULT_PHONESTAND().text, where: 'top' },
  colors: { ...DEFAULT_PHONESTAND().colors },
});

let engine;
export async function prepareCanOpener() {
  engine = await preparePhoneStand();
  return engine;
}
const PROJECT_APP = 'Relieve3D-Destapador';
const LINK_DIAMETER = 4.5;

function measure(v, fallback, min, max, label) {
  const n = v === undefined ? fallback : Number(typeof v === 'string' ? v.replace(',', '.') : v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label}: usa un valor de ${min} a ${max} mm.`);
  return n;
}

export function normalizeCanOpener(input = {}) {
  const d = DEFAULT_CAN_OPENER(), cfg = input && typeof input === 'object' ? input : {};
  const shared = normalizePhoneStand({ logo: cfg.logo, text: cfg.text, colors: cfg.colors });
  const a = { ...d.attachment, ...(cfg.attachment || {}) };
  const shape = cfg.shape === undefined ? d.shape : cfg.shape;
  if (!CAN_OPENER_SHAPES.some((s) => s.id === shape)) throw new Error('Elige una forma válida.');
  if (!['integrated', 'external', 'separate'].includes(a.mount)) throw new Error('Elige un tipo de enganche válido.');
  if (!['round', 'double-horizontal', 'double-vertical', 'slot', 'lateral', 'cord-loop'].includes(a.kind)) throw new Error('Elige una forma de agujero válida.');
  if (!['left', 'center', 'right'].includes(a.position)) throw new Error('Elige una posición válida para el enganche.');
  const thickness = measure(cfg.thickness, d.thickness, 6, 12, 'Grosor');
  a.diameter = measure(a.diameter, d.attachment.diameter, 3, 9, 'Diámetro del agujero');
  a.slotWidth = measure(a.slotWidth, d.attachment.slotWidth, 6, 16, 'Ancho de la ranura para cinta');
  a.wall = measure(a.wall, d.attachment.wall, 1.5, 5, 'Pared alrededor del agujero');
  if (a.kind === 'slot' && a.slotWidth < a.diameter) throw new Error('La ranura para cinta debe ser más ancha que su alto.');
  if ((a.kind === 'lateral' || a.kind === 'cord-loop') && a.diameter > thickness - 3) throw new Error('El agujero lateral necesita al menos 1,5 mm arriba y abajo: reduce su diámetro o aumenta el grosor.');
  const logo = { ...shared.logo, where: 'top' }, text = { ...shared.text, where: 'top' };
  const sink = logo.mode === 'flat' ? logo.flatDepth : logo.mode === 'engrave' ? logo.depth : 0;
  if (thickness - sink < 4.6) throw new Error('El logo hundido dejaría muy poco techo sobre la ranura: aumenta el grosor o reduce la profundidad.');
  return {
    name: String(cfg.name || d.name).slice(0, 60), shape,
    width: measure(cfg.width, d.width, 40, 100, 'Ancho de la forma'),
    thickness, side: cfg.side === 'left' ? 'left' : 'right',
    attachment: a, logo, text, colors: shared.colors,
  };
}

function shapeOutline(S, cfg, image, warnings) {
  const { o, CS } = S, kit = H.shapeKit(S);
  let shape;
  if (cfg.shape === 'custom') {
    if (!image) throw new Error('Carga una imagen para usar tu silueta.');
    shape = H.customSilhouette(S, image, warnings)?.cs;
    if (!shape) throw new Error('No se pudo construir la silueta de la imagen.');
  } else if (cfg.shape === 'square') {
    shape = H.roundRect(S, -0.5, 0.5, -0.5, 0.5, 0.13);
  } else if (cfg.shape === 'nailpolish') {
    shape = o(CS.union([
      H.roundRect(S, -0.45, 0.45, -0.48, 0.23, 0.12),
      H.roundRect(S, -0.18, 0.18, 0.18, 0.4, 0.035),
      H.roundRect(S, -0.26, 0.26, 0.34, 0.65, 0.055),
    ]));
  } else shape = H.SHAPE_DEFS[cfg.shape].build(kit);
  let b = shape.bounds(), k = cfg.width / (b.max[0] - b.min[0]);
  shape = o(o(shape.translate([-(b.min[0] + b.max[0]) / 2, -b.min[1]])).scale([k, k]));
  shape = H.opening(S, shape, 0.6, 48);
  if (shape.isEmpty()) throw new Error('La silueta es demasiado delgada.');
  const components = shape.decompose().map(o);
  if (components.length !== 1) throw new Error('La silueta tiene partes separadas o demasiado delgadas. Usa otra imagen o una forma mayor.');
  b = shape.bounds();
  if (b.max[1] - b.min[1] > 170) throw new Error('La forma es demasiado alta para la placa: reduce el ancho.');
  return o(shape.translate([0, -b.min[1]]));
}

function holeLayout(kind, diameter, slotWidth, wall) {
  const r = diameter / 2, gap = diameter + wall;
  if (kind === 'cord-loop') return { centers: [[-gap / 2, 0], [gap / 2, 0]], r, cordLoop: true };
  if (kind === 'double-horizontal') return { centers: [[-gap / 2, 0], [gap / 2, 0]], r };
  if (kind === 'double-vertical') return { centers: [[0, -gap / 2], [0, gap / 2]], r };
  if (kind === 'slot') {
    const half = (slotWidth - diameter) / 2, n = Math.max(1, Math.ceil(2 * half));
    return { centers: Array.from({ length: n + 1 }, (_, i) => [-half + 2 * half * i / n, 0]), r, slot: true };
  }
  return { centers: [[0, 0]], r, lateral: kind === 'lateral' };
}

function footprint(S, layout, extra = 0) {
  const discs = layout.centers.map(([x, y]) => H.circle(S, x, y, layout.r + extra, 64));
  return layout.slot ? S.o(S.CS.hull(discs)) : discs.length === 1 ? discs[0] : S.o(S.CS.union(discs));
}

function findPosition(S, outline, layout, wall, position) {
  const safe = S.o(outline.offset(-(layout.r + wall), 'Round', 2, 64));
  if (safe.isEmpty()) throw new Error('No cabe el enganche con la pared requerida: agranda la forma o reduce el agujero.');
  const polys = safe.toPolygons(), b = safe.bounds();
  const target = position === 'left' ? b.min[0] : position === 'right' ? b.max[0] : (b.min[0] + b.max[0]) / 2;
  let best = null, score = -Infinity;
  for (let y = b.min[1]; y <= b.max[1]; y += 0.6) {
    for (let x = b.min[0]; x <= b.max[0]; x += 0.6) {
      if (!layout.centers.every(([dx, dy]) => H.inside(polys, [x + dx, y + dy]))) continue;
      const s = y - Math.abs(x - target) * 0.45;
      if (s > score) { score = s; best = [x, y]; }
    }
  }
  if (!best) throw new Error('No caben los agujeros con la pared requerida: agranda la forma, reduce el diámetro o usa una argolla exterior.');
  return best;
}

function lateralCut(S, center, endY, diameter, thickness) {
  const { o, M } = S, length = endY - center[1] + 1;
  if (!(length > 0)) throw new Error('No se pudo abrir el agujero lateral hacia el borde.');
  return o(o(o(M.cylinder(length, diameter / 2, diameter / 2, 64)).rotate([-90, 0, 0]))
    .translate([center[0], center[1], thickness / 2]));
}

function cordBridge(S, centers, position, diameter, thickness) {
  const { o, M } = S;
  const left = centers[0][0] + position[0], right = centers[1][0] + position[0];
  return o(o(o(M.cylinder(right - left + 0.2, diameter / 2, diameter / 2, 64)).rotate([0, 90, 0]))
    .translate([left - 0.1, centers[0][1] + position[1], thickness / 2]));
}

function makeConnector(S, layout, cfg, bodyBounds) {
  const { o, CS } = S, a = cfg.attachment;
  const left = holeLayout('round', LINK_DIAMETER, 8, a.wall);
  const leftRadius = LINK_DIAMETER / 2, rightMin = Math.min(...layout.centers.map(([x]) => x)) - layout.r;
  const offset = leftRadius + a.wall - rightMin;
  const right = { ...layout, centers: layout.centers.map(([x, y]) => [x + offset, y]) };
  const outer = o(CS.hull([
    H.circle(S, 0, 0, leftRadius + a.wall, 64),
    ...right.centers.map(([x, y]) => H.circle(S, x, y, right.r + a.wall, 64)),
  ]));
  const holes = o(CS.union([footprint(S, left), footprint(S, right)]));
  let solid = H.extrudeZ(S, o(outer.subtract(holes)), 0, cfg.thickness);
  if (layout.cordLoop) solid = o(solid.subtract(cordBridge(S, right.centers, [0, 0], a.diameter, cfg.thickness)));
  if (layout.lateral) {
    const center = right.centers[0], end = outer.bounds().max[1] + 1;
    solid = o(solid.subtract(lateralCut(S, center, end, a.diameter, cfg.thickness)));
  }
  const bounds = solid.boundingBox();
  const shift = [bodyBounds.max[0] + 5 - bounds.min[0], bodyBounds.min[1] - bounds.min[1], 0];
  return {
    solid: o(solid.translate(shift)),
    holes: [
      { x: shift[0], y: shift[1], diameter: LINK_DIAMETER },
      ...right.centers.map(([x, y]) => ({ x: x + shift[0], y: y + shift[1], diameter: a.diameter })),
    ],
  };
}

export function canOpenerSolids(input = {}, { logoImage = null, shapeImage = null, font = null } = {}) {
  if (!engine) throw new Error('El motor 3D no está listo: llama a prepareCanOpener() primero.');
  const cfg = normalizeCanOpener(input), { attachment: a, thickness: T } = cfg;
  const o = H.makeScope(), S = { o, CS: engine.CrossSection, M: engine.Manifold };
  const { CS, M } = S;
  try {
    const warnings = [], original = shapeOutline(S, cfg, shapeImage, warnings);
    const selected = holeLayout(a.kind, a.diameter, a.slotWidth, a.wall);
    const layout = a.mount === 'separate' ? holeLayout('round', LINK_DIAMETER, 8, a.wall) : selected;
    let outline = original, position;
    if (a.mount === 'external') {
      const anchor = findPosition(S, original, { centers: [[0, 0]], r: 0 }, a.wall + 0.2, a.position);
      const top = H.maxAt(original.toPolygons(), 0, anchor[0]);
      const low = Math.min(...layout.centers.map(([, y]) => y - layout.r));
      position = [anchor[0], top - low + 0.4];
      const expanded = layout.centers.map(([x, y]) => H.circle(S, x + position[0], y + position[1], layout.r + a.wall, 64));
      const ear = o(CS.hull([H.circle(S, anchor[0], anchor[1], a.wall + 0.1, 64), ...expanded]));
      outline = o(original.add(ear));
    } else position = findPosition(S, original, layout, a.wall, a.position);
    const holeCS = o(footprint(S, layout).translate(position));
    const bodyHoles = layout.centers.map(([x, y]) => ({ x: x + position[0], y: y + position[1], diameter: layout.r * 2 }));
    const ringRadius = Math.max(...layout.centers.map(([x, y]) => Math.hypot(x, y) + layout.r));
    const mech = { W: 150, T, yh0: -48, variant: 'short' }, opCfg = { opener: { enabled: true, side: cfg.side } };
    const ringGuard = { x: position[0], y: position[1], r: ringRadius + a.wall - 2.5 };
    const place = () => H.placeOpener(mech, opCfg, outline.toPolygons(), outline.bounds().max[1], ringGuard, null, []);
    let opener = place();
    if (!opener) {
      const base = outline, b = base.bounds();
      const first = Math.max(b.min[1] + 14, Math.min(b.max[1] - 14, b.min[1] + (b.max[1] - b.min[1]) * 0.38));
      const x0 = cfg.side === 'right' ? 0 : b.min[0] - 5, x1 = cfg.side === 'right' ? b.max[0] + 5 : 0;
      for (const cy of [first, b.min[1] + 8, b.min[1] + 3, b.min[1] - 2, b.min[1] - 5]) {
        const ledge = H.roundRect(S, x0, x1, cy - 14, cy + 14, 1.5);
        outline = o(base.add(ledge));
        opener = place();
        if (opener) break;
      }
      if (opener) warnings.push('Se añadió un borde lateral para que la ranura del abre latas tenga espacio y paredes.');
    }
    if (!opener) throw new Error('No cabe una ranura funcional sin debilitar el enganche: agranda la forma, cambia el lado o usa otro enganche.');
    const slot = H.openerCutter(S, mech, opener);
    const through = H.extrudeZ(S, holeCS, -1, T + 1);
    let cuts = through, sideCut = null;
    if (layout.lateral) {
      const end = H.maxAt(outline.toPolygons(), 0, position[0]) + 1;
      sideCut = lateralCut(S, position, end, a.diameter, T);
      cuts = o(cuts.add(sideCut));
    }
    if (layout.cordLoop) cuts = o(cuts.add(cordBridge(S, layout.centers, position, a.diameter, T)));
    const collision = o(slot.intersect(cuts));
    if (collision.volume() > 0.001) throw new Error('La ranura del abre latas se cruza con el enganche: cambia el lado o la posición.');
    const avoid = { fit: o(holeCS.offset(1.6, 'Round', 2, 48)), clip: o(holeCS.offset(1, 'Round', 2, 48)) };
    const art = H.buildArt(S, { variant: 'short', yh0: original.bounds().min[1] - 1 }, cfg, original, null,
      { logoImage, font }, warnings, avoid);
    const mode = cfg.logo.mode, sink = mode === 'flat' ? cfg.logo.flatDepth : cfg.logo.depth;
    const artPieces = [];
    if (art.top && mode !== 'engrave') for (const p of art.top.pieces) {
      const height = mode === 'relief' ? p.height : sink;
      const solid = H.extrudeZ(S, p.cs, mode === 'relief' ? T : T - sink, mode === 'relief' ? T + height : T);
      artPieces.push({ ...p, solid, height });
    }
    let body = o(H.extrudeZ(S, outline, 0, T).subtract(slot));
    body = o(body.subtract(cuts));
    if (a.mount === 'external' && a.kind !== 'lateral' && a.kind !== 'cord-loop') {
      // Keep the eyelet thin enough for a split ring or folded ribbon to pass around it.
      const outside = o(outline.subtract(original));
      const relief = H.extrudeZ(S, outside, 3.5, T + 1);
      body = o(body.subtract(relief));
    }
    if (art.top && mode !== 'relief') {
      const recess = H.extrudeZ(S, o(art.top.cs.simplify(1e-6)), T - sink, T + 1);
      body = o(body.subtract(recess));
    }
    const components = body.decompose().map(o);
    if (body.status() !== 'NoError' || body.volume() <= 0 || components.filter((p) => p.volume() > 1e-6).length !== 1) {
      throw new Error('La forma, ranura y enganche no producen un cuerpo sólido. Cambia las medidas o la forma.');
    }
    const connector = a.mount === 'separate' ? makeConnector(S, selected, cfg, body.boundingBox()) : null;
    if (connector) {
      const pieces = connector.solid.decompose().map(o);
      if (connector.solid.status() !== 'NoError' || pieces.length !== 1 || connector.solid.minGap(body, 6) < 4) {
        throw new Error('No se pudo construir un conector separado sólido y libre del cuerpo.');
      }
      warnings.push('El conector se imprime aparte; únelo al destapador con una argolla o hilo adicional, no incluido.');
    }
    if (layout.lateral || layout.cordLoop || (connector && (selected.lateral || selected.cordLoop))) warnings.push('El agujero lateral y la ranura del abre latas tienen puentes: revisa el laminado y realiza una prueba física.');
    const used = new Set(artPieces.filter((p) => p.kind === 'logo').map((p) => p.idx));
    const logo = art.palette?.map((e) => ({ ...e, used: used.has(e.idx) || (mode === 'engrave' && !art.skip.has(e.idx)), skipped: !e.on ? 'off' : art.skip.has(e.idx) ? 'body' : null })) || null;
    const bbox = body.boundingBox(), info = {
      shape: cfg.shape, opener,
      attachment: { mount: a.mount, kind: a.kind, wall: a.wall, position, bodyHoles, connectorHoles: connector?.holes || [], lateral: !!layout.lateral },
      art: { mode, box: art.top?.box || null }, logo,
      size: { w: bbox.max[0] - bbox.min[0], l: bbox.max[1] - bbox.min[1], h: T },
      volume: (body.volume() + artPieces.reduce((s, p) => s + p.solid.volume(), 0) + (connector?.solid.volume() || 0)) / 1000,
    };
    return { cfg, body, outline, artPieces, connector: connector?.solid || null, info, warnings, dispose: () => o.free() };
  } catch (err) { o.free(); throw err; }
}

export function buildCanOpener(input = {}, media = {}) {
  const sol = canOpenerSolids(input, media);
  try {
    const colors = [], parts = [];
    const add = (name, solid, color, extra = {}) => {
      const shade = color.toLowerCase();
      let filamentIndex = colors.indexOf(shade);
      if (filamentIndex < 0) { filamentIndex = colors.length; colors.push(shade); }
      parts.push({ name, color: shade, filamentIndex, geometry: H.meshGeometry(solid.getMesh()), ...extra });
    };
    add('Cuerpo destapador', sol.body, sol.cfg.colors.body);
    for (const p of sol.artPieces) {
      const label = p.kind === 'text' ? 'Texto' : `Logo color ${p.idx + 1}`;
      add(label, p.solid, sol.cfg.colors.twoColor ? p.color : sol.cfg.colors.body, { art: true, layer: p.key });
    }
    if (sol.connector) add('Conector independiente', sol.connector, sol.cfg.colors.body, { apart: true });
    const warnings = [...sol.warnings];
    if (colors.length > 4) warnings.push(`El diseño usa ${colors.length} colores; un AMS Lite tiene 4 posiciones. Planifica los cambios de filamento.`);
    return { cfg: sol.cfg, parts, colors, info: sol.info, warnings };
  } finally { sol.dispose(); }
}

export function exportCanOpener(result, opts = {}) {
  if (!result?.parts?.length) throw new Error('Primero genera el destapador.');
  const parts = result.parts.map((p) => ({ ...p, blockSupports: true }));
  const bounds = new THREE.Box3();
  for (const part of parts) { part.geometry.computeBoundingBox(); bounds.union(part.geometry.boundingBox); }
  const shift = [10 - bounds.min.x, 10 - bounds.min.y];
  if (bounds.max.x + shift[0] > 246 || bounds.max.y + shift[1] > 246) throw new Error('Las piezas no caben juntas en la placa; reduce el tamaño.');
  const main = parts.map((p, i) => p.apart ? -1 : i).filter((i) => i >= 0);
  const apart = parts.map((p, i) => p.apart ? i : -1).filter((i) => i >= 0);
  const settings = { enable_support: '0' };
  const assemblies = [
    { name: result.cfg.name, parts: main, shift, extruder: parts[main[0]].filamentIndex + 1, settings },
    ...apart.map((i) => ({ name: parts[i].name, parts: [i], shift, extruder: parts[i].filamentIndex + 1, settings })),
  ];
  return threeMF(parts, result.cfg.name, { bambu: opts.bambu, assemblies });
}

export function canOpenerProject(cfg, { logoSrc = null, shapeSrc = null } = {}) {
  const image = (v) => typeof v === 'string' && /^data:image\//i.test(v) ? v : null;
  return JSON.stringify({ app: PROJECT_APP, version: 1, cfg: normalizeCanOpener(cfg), logoSrc: image(logoSrc), shapeSrc: image(shapeSrc) });
}

export function readCanOpenerProject(text) {
  let j;
  try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('El archivo no es un proyecto válido.'); }
  if (!j || j.app !== PROJECT_APP || !j.cfg) throw new Error('No es un proyecto de destapador.');
  if (j.version !== 1) throw new Error(`Versión de proyecto no compatible (${j.version}).`);
  const image = (v) => typeof v === 'string' && /^data:image\//i.test(v) ? v : null;
  return { cfg: normalizeCanOpener(j.cfg), logoSrc: image(j.logoSrc), shapeSrc: image(j.shapeSrc) };
}

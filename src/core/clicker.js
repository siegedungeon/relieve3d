import * as THREE from 'three';
import { computeSilhouette, processImage } from './processing.js';
import { threeMF } from './exporters.js';

let engine, loading;
export async function prepareClicker() {
  if (!loading) loading = import('../../node_modules/manifold-3d/manifold.js')
    .then(({ default: init }) => init()).then((w) => { w.setup(); engine = w; })
    .catch((err) => { loading = null; throw err; });
  await loading;
  return engine;
}

const isHex = (value) => /^#[0-9a-f]{6}$/i.test(String(value));

function pointInPolygons(polygons, x, y) {
  let inside = false;
  for (const p of polygons) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function supportPoint(area) {
  const polygons = area.toPolygons();
  if (!polygons.length) throw new Error('La silueta no tiene suficiente material para el encaje MX. Aumenta el tamaño o el borde.');
  if (pointInPolygons(polygons, 0, 0)) return [0, 0];
  const b = area.bounds();
  let best = null, dist = Infinity;
  for (let x = b.min[0]; x <= b.max[0]; x += 0.7) for (let y = b.min[1]; y <= b.max[1]; y += 0.7) {
    const d = x * x + y * y;
    if (d < dist && pointInPolygons(polygons, x, y)) { best = [x, y]; dist = d; }
  }
  if (!best) throw new Error('La silueta no tiene suficiente material para el encaje MX. Aumenta el tamaño o el borde.');
  return best;
}

function copiedMesh(solid) {
  const mesh = solid.getMesh(), V = new Float64Array(mesh.numVert * 3);
  for (let i = 0; i < mesh.numVert; i++) for (let j = 0; j < 3; j++) V[i * 3 + j] = mesh.vertProperties[i * mesh.numProp + j];
  return { V, T: new Uint32Array(mesh.triVerts) };
}

export function buildClicker(image, options = {}) {
  if (!engine) throw new Error('El motor 3D aún no está listo.');
  if (!image || !(image.width > 0 && image.height > 0) || image.data?.length !== image.width * image.height * 4) {
    throw new Error('Carga una imagen válida.');
  }
  const o = { width: 45, margin: 0.8, relief: 0.8, colors: 0, background: 'auto', stemClearance: 0.1, mountClearance: 0.1, capColor: '#f4e9dc', baseColor: '#333333', ...options };
  for (const key of ['width', 'margin', 'relief', 'colors', 'stemClearance', 'mountClearance']) {
    o[key] = Number(o[key]);
    if (!Number.isFinite(o[key])) throw new Error('Revisa las medidas del clicker.');
  }
  if (o.width < 25 || o.width > 100) throw new Error('El ancho de la imagen debe estar entre 25 y 100 mm.');
  if (o.margin < 0 || o.margin > 3 || o.relief < 0.4 || o.relief > 2) throw new Error('El borde debe ser de 0 a 3 mm y el relieve de 0,4 a 2 mm.');
  if (o.stemClearance < -0.1 || o.stemClearance > 0.35 || o.mountClearance < -0.1 || o.mountClearance > 0.35) throw new Error('Las holguras deben estar entre -0,1 y 0,35 mm.');
  if (!Number.isInteger(o.colors) || o.colors < 0 || o.colors > 6 || !['auto', 'yes', 'no'].includes(o.background) || !isHex(o.capColor) || !isHex(o.baseColor)) throw new Error('Revisa los colores y el fondo de la imagen.');

  const processed = processImage(image, {
    colors: o.colors, removeBg: o.background, widthMM: o.width, maxRes: 700,
    minWidth: Math.max(0.4, 0.5 * image.width / o.width), minHoleMM: 0, detail: 0.7, smooth: 1,
  });
  const [x0, y0, x1, y1] = processed.fgBBox, scale = o.width / (x1 - x0);
  if (!(scale > 0) || (y1 - y0) * scale + 2 * o.margin > 180) throw new Error('La silueta es demasiado alta para la placa. Reduce el ancho.');
  const center = [(x0 + x1) / 2, (y0 + y1) / 2];
  const owned = [], own = (value) => { owned.push(value); return value; };
  const CS = engine.CrossSection, M = engine.Manifold;
  const convert = (shapes) => {
    const sections = [];
    for (const shape of shapes) {
      const polys = [shape.outer, ...shape.holes].map((loop) => loop.map(([x, y]) => [(x - center[0]) * scale, (center[1] - y) * scale]));
      if (polys[0]?.length >= 3) sections.push(own(new CS(polys, 'EvenOdd')));
    }
    return sections.length ? (sections.length === 1 ? sections[0] : own(CS.union(sections))) : null;
  };
  try {
    const raw = convert(computeSilhouette(processed, o.margin / scale));
    if (!raw || raw.area() <= 0) throw new Error('No se pudo construir una silueta para el clicker.');
    const outline = own(own(raw.offset(-0.3, 'Round', 2, 32)).offset(0.3, 'Round', 2, 32));
    if (outline.isEmpty()) throw new Error('La silueta es demasiado delgada. Aumenta el tamaño o el borde.');
    const shapeSolid = own(outline.extrude(1)), shapeParts = shapeSolid.decompose().map(own);
    if (shapeParts.length !== 1) throw new Error('La imagen tiene partes separadas. Aumenta el borde o usa una silueta conectada.');
    const mountArea = own(outline.offset(-3.6, 'Round', 2, 32));
    const capCenter = supportPoint(mountArea);
    const capThickness = 4, socketDepth = 3, socketLength = 4 + o.stemClearance, socketWidth = 1.2 + o.stemClearance;
    const armA = own(CS.square([socketLength, socketWidth], true)), armB = own(CS.square([socketWidth, socketLength], true));
    const cross = own(own(CS.union([armA, armB])).translate(capCenter));
    const crossCut = own(own(cross.extrude(socketDepth + 0.02)).translate([0, 0, -0.02]));
    const cap = own(own(outline.extrude(capThickness)).subtract(crossCut));

    const plateThickness = 1.5, switchOpening = 14 + o.mountClearance, baseWidth = 24, baseHeight = 8.5;
    const b = outline.bounds(), baseCenter = [b.max[0] + 5 + baseWidth / 2, (b.min[1] + b.max[1]) / 2];
    if (b.max[0] - b.min[0] + 5 + baseWidth > 230 || Math.max(b.max[1] - b.min[1], baseWidth) > 230) throw new Error('Las piezas no caben juntas en la placa; reduce el tamaño.');
    const outer = own(own(CS.square([baseWidth, baseWidth], true)).translate(baseCenter));
    const opening = own(own(CS.square([switchOpening, switchOpening], true)).translate(baseCenter));
    const cavity = own(own(CS.square([19, 19], true)).translate(baseCenter));
    const plate = own(own(outer.subtract(opening)).extrude(plateThickness));
    const walls = own(own(own(outer.subtract(cavity)).extrude(baseHeight - plateThickness)).translate([0, 0, plateThickness]));
    const base = own(M.union([plate, walls]));
    const capParts = cap.decompose().map(own), baseParts = base.decompose().map(own);
    if (cap.status() !== 'NoError' || base.status() !== 'NoError' || capParts.length !== 1 || baseParts.length !== 1 || cap.volume() <= 0 || base.volume() <= 0) {
      throw new Error('La tapa o la base no forman un sólido imprimible.');
    }
    const parts = [
      { name: 'Tapa con encaje MX', role: 'cap', color: o.capColor, ...copiedMesh(cap) },
      { name: 'Base para interruptor MX', role: 'base', color: o.baseColor, ...copiedMesh(base) },
    ];
    let omitted = 0, simplified = false;
    for (let color = 0; color < processed.palette.length; color++) {
      const shapes = processed.pieces.filter((piece) => piece.cluster === color).flatMap((piece) => piece.shapes);
      const original = convert(shapes);
      if (!original) continue;
      const clipped = own(original.intersect(outline));
      const cleaned = own(own(clipped.offset(-0.25, 'Round', 2, 24)).offset(0.25, 'Round', 2, 24));
      if (clipped.area() - cleaned.area() > Math.max(0.2, clipped.area() * 0.005)) simplified = true;
      if (cleaned.isEmpty() || cleaned.area() < 0.3) { omitted++; continue; }
      const relief = own(own(cleaned.extrude(o.relief)).translate([0, 0, capThickness]));
      if (relief.status() !== 'NoError' || relief.volume() <= 0) { omitted++; continue; }
      parts.push({ name: `Relieve color ${color + 1}`, role: 'relief', color: processed.palette[color].hex, ...copiedMesh(relief) });
    }
    const colors = [];
    for (const p of parts) {
      const key = p.color.toLowerCase();
      if (!colors.includes(key)) colors.push(key);
      p.filamentIndex = colors.indexOf(key);
    }
    const warnings = [];
    if (raw.area() - outline.area() > raw.area() * 0.005 || omitted || simplified) warnings.push('Los detalles demasiado finos se suavizaron u omitieron para mejorar la impresión; revisa la vista previa.');
    if (Math.hypot(...capCenter) > 1) warnings.push('El encaje se desplazó para quedar dentro de la silueta; la base puede no quedar centrada visualmente.');
    return {
      options: o, parts, colors, warnings,
      info: { capCenter, baseCenter, capThickness, socketDepth, socketLength, socketWidth, switchOpening, plateThickness, baseWidth, baseHeight },
    };
  } finally { for (let i = owned.length - 1; i >= 0; i--) owned[i].delete(); }
}

export function exportClicker(result, title = 'Clicker desde imagen', opts = {}) {
  if (!result?.parts?.length) throw new Error('Primero genera el clicker.');
  const parts = result.parts.map((p) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.V), 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(p.T), 1));
    return { name: p.name, color: p.color, filamentIndex: p.filamentIndex, geometry };
  });
  try {
    const cap = result.parts.map((p, i) => p.role === 'base' ? -1 : i).filter((i) => i >= 0);
    const base = result.parts.map((p, i) => p.role === 'base' ? i : -1).filter((i) => i >= 0);
    const bounds = new THREE.Box3();
    for (const part of parts) { part.geometry.computeBoundingBox(); bounds.union(part.geometry.boundingBox); }
    const shift = [10 - bounds.min.x, 10 - bounds.min.y];
    return threeMF(parts, title, { bambu: opts.bambu, assemblies: [
      { name: 'Tapa con relieve', parts: cap, shift, extruder: result.parts[cap[0]].filamentIndex + 1 },
      { name: 'Base para interruptor MX', parts: base, shift, extruder: result.parts[base[0]].filamentIndex + 1 },
    ] });
  } finally { parts.forEach((p) => p.geometry.dispose()); }
}

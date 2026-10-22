import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import clipping from 'polygon-clipping';
import { bounds, transformLoops, assertSimple, coveredPolyline, pointSegmentDistance, validateLayout } from './core/laser_geometry.js';

const NS = 'http://www.w3.org/2000/svg';
export const escapeXML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const serial = node => new XMLSerializer().serializeToString(node);
const shapeTags = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);
const geometryAttrs = new Set(['d', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'x2', 'y1', 'y2', 'points']);
const styleAttrs = { fill: 'fill', fillOpacity: 'fill-opacity', fillRule: 'fill-rule', stroke: 'stroke', strokeOpacity: 'stroke-opacity',
  strokeWidth: 'stroke-width', strokeLineJoin: 'stroke-linejoin', strokeLineCap: 'stroke-linecap', strokeMiterLimit: 'stroke-miterlimit' };
const allowedStyles = new Set([...Object.values(styleAttrs), 'opacity', 'visibility']);
const f = n => Number(n.toFixed(9));

function physicalLength(text, unitless) {
  const m = String(text || '').trim().match(/^([+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(mm|cm|in|pt|pc|px)?$/i);
  if (!m) throw new Error('El SVG necesita ancho y alto fisicos; no se admiten porcentajes.');
  const unit = m[2]?.toLowerCase() || unitless;
  if (!unit || unit === 'reject') throw new Error('SVG sin unidades: elige explicitamente mm, cm o px (96 ppp).');
  return Number(m[1]) * ({ mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 }[unit]);
}
function checkStyle(style) {
  if (/url\s*\(|@|expression\s*\(/i.test(style)) throw new Error('No se admiten referencias externas, gradientes ni reglas CSS especiales.');
  for (const declaration of style.split(';')) {
    if (!declaration.trim()) continue;
    const index = declaration.indexOf(':'), key = declaration.slice(0, index).trim(), value = declaration.slice(index + 1).trim();
    if (!allowedStyles.has(key)) throw new Error(`Estilo SVG no soportado: ${key}. Convierte efectos y texto a curvas.`);
    if (key === 'opacity' && Number(value) !== 1) throw new Error('Convierte transparencias de grupo a colores antes de importar.');
    if (key === 'visibility' && value !== 'visible') throw new Error('Elimina o muestra los objetos ocultos antes de importar.');
  }
}
function sanitize(doc) {
  const root = doc.documentElement;
  if (root.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('Archivo SVG invalido.');
  for (const node of [...root.querySelectorAll('*')]) {
    if (['metadata', 'title', 'desc'].includes(node.localName)) { node.remove(); continue; }
    if (!node.isConnected) continue;
    if (!shapeTags.has(node.localName) && !['g', 'style', 'defs'].includes(node.localName)) throw new Error(`Elemento SVG no soportado: ${node.localName}. Convierte texto, imagenes y efectos a curvas.`);
  }
  for (const node of [root, ...root.querySelectorAll('*')]) {
    node.removeAttribute('data-laser-import');
    if (node.localName === 'style') {
      const css = node.textContent;
      const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
      if (css.replace(/[^{}]+\{[^{}]*\}/g, '').trim() || !rules.length) throw new Error('Hoja de estilos SVG no soportada.');
      for (const [, selector, declarations] of rules) {
        if (!/^[\w.#,\s>_-]+$/.test(selector.trim())) throw new Error('Selector CSS SVG no soportado.');
        checkStyle(declarations);
      }
    }
    for (const attribute of [...node.attributes]) {
      const name = attribute.name, value = attribute.value;
      if (/^on/i.test(name) || /href$/i.test(name) || /url\s*\(|javascript:/i.test(value)) throw new Error('El SVG contiene acciones o referencias no permitidas.');
      if (['clip-path', 'mask', 'filter', 'vector-effect', 'stroke-dasharray', 'stroke-dashoffset', 'display'].includes(name)) throw new Error(`Atributo no soportado: ${name}. Convierte el efecto a curvas.`);
      if (name === 'style') checkStyle(value);
      if (name === 'opacity' && Number(value) !== 1) throw new Error('Convierte transparencias de grupo a colores antes de importar.');
      if (name === 'visibility' && value !== 'visible') throw new Error('El SVG contiene objetos ocultos.');
      if (geometryAttrs.has(name) && /%/.test(value)) throw new Error('No se admiten coordenadas porcentuales.');
    }
    if (node.localName === 'path') {
      const d = node.getAttribute('d') || '', tokens = d.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z]/g) || [];
      if (d.replace(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z]|[\s,]/g, '')) throw new Error('Sintaxis de curva SVG invalida.');
      const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
      let index = 0;
      while (index < tokens.length) {
        const command = tokens[index++].toUpperCase(), count = arity[command];
        if (count === undefined) throw new Error('Comando de curva SVG invalido.');
        let n = 0;
        while (index < tokens.length && !/^[A-Za-z]$/.test(tokens[index])) { if (!Number.isFinite(Number(tokens[index++]))) throw new Error('Numero SVG invalido.'); n++; }
        if (count ? !n || n % count : n) throw new Error('Curva SVG con coordenadas incompletas.');
      }
      if (!/^[mM]/.test(tokens[0] || '')) throw new Error('La curva SVG debe empezar con M.');
    }
  }
  return root;
}
function flattenCurve(curve, scale) {
  const result = [], tolerance = 0.004 / scale;
  const visit = (a, b, pa, pb, depth) => {
    const q1 = curve.getPoint(a + (b - a) / 4), mid = curve.getPoint((a + b) / 2), q3 = curve.getPoint(a + (b - a) * 3 / 4);
    const pts = [q1, mid, q3].map(p => [p.x, p.y]), start = [pa.x, pa.y], end = [pb.x, pb.y];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const chain = [start, ...pts, end].reduce((sum, p, i, all) => i ? sum + Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) : 0, 0);
    if (Math.max(...pts.map(p => pointSegmentDistance(p, start, end))) <= tolerance && chain - length <= tolerance) result.push(start);
    else {
      if (depth >= 18) throw new Error('Curva demasiado compleja; simplifica el SVG sin cambiar su escala.');
      visit(a, (a + b) / 2, pa, mid, depth + 1);
      visit((a + b) / 2, b, mid, pb, depth + 1);
    }
  };
  for (let i = 0; i < 4; i++) visit(i / 4, (i + 1) / 4, curve.getPoint(i / 4), curve.getPoint((i + 1) / 4), 0);
  const end = curve.getPoint(1); result.push([end.x, end.y]);
  return result;
}
function cleanLoop(points) {
  const out = [];
  for (const p of points) if (!out.length || Math.hypot(p[0] - out.at(-1)[0], p[1] - out.at(-1)[1]) > 1e-7) out.push(p);
  if (out.length > 1 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < 1e-7) out.pop();
  return out;
}
function unionLoops(loops) {
  if (!loops.length) throw new Error('La pieza necesita un contorno exterior cerrado. Agrupa los detalles con su silueta.');
  const merged = clipping.union(...loops.map(loop => [[...loop, loop[0]]]));
  return merged.map(polygon => cleanLoop(polygon[0]));
}
function envelope(body, width, height) {
  return `<svg xmlns="${NS}" width="${f(width)}mm" height="${f(height)}mm" viewBox="0 0 ${f(width)} ${f(height)}">${body}</svg>`;
}

export function importLaserSVG(text, { name = 'Pieza', unitless = 'reject', join = false, sourceId = crypto.randomUUID() } = {}) {
  if (text.length > 10_000_000 || /<!ENTITY/i.test(text)) throw new Error('SVG demasiado grande o con entidades no admitidas.');
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), root = sanitize(doc);
  const width = physicalLength(root.getAttribute('width'), unitless), height = physicalLength(root.getAttribute('height'), unitless);
  if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 10000)) throw new Error('Dimensiones SVG fuera de rango.');
  const viewport = (attribute, mm) => /^[+\d.eE-]+$/.test(root.getAttribute(attribute).trim()) ? Number(root.getAttribute(attribute)) : mm * 96 / 25.4;
  const vb = root.hasAttribute('viewBox') ? root.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number) : [0, 0, viewport('width', width), viewport('height', height)];
  if (vb.length !== 4 || !vb.every(Number.isFinite) || vb[2] <= 0 || vb[3] <= 0) throw new Error('viewBox SVG invalido.');
  let sx = width / vb[2], sy = height / vb[3], ox = -vb[0] * sx, oy = -vb[1] * sy;
  const aspect = root.getAttribute('preserveAspectRatio') || 'xMidYMid meet';
  if (aspect !== 'none') {
    if (!/^x(Min|Mid|Max)Y(Min|Mid|Max)(\s+(meet|slice))?$/.test(aspect)) throw new Error('preserveAspectRatio no soportado.');
    if (aspect.includes('slice')) throw new Error('El SVG recorta con slice; convierte el recorte a curvas.');
    sx = sy = Math.min(sx, sy);
    const match = aspect.match(/^x(Min|Mid|Max)Y(Min|Mid|Max)/), align = { Min: 0, Mid: 0.5, Max: 1 };
    ox = -vb[0] * sx + (width - vb[2] * sx) * align[match[1]];
    oy = -vb[1] * sy + (height - vb[3] * sy) * align[match[2]];
  }
  let parent = root, nodes = [...parent.children].filter(n => shapeTags.has(n.localName) || n.localName === 'g');
  if (!join) while (nodes.length === 1 && nodes[0].localName === 'g') {
    parent = nodes[0]; nodes = [...parent.children].filter(n => shapeTags.has(n.localName) || n.localName === 'g');
  }
  if (join) nodes = [root];
  if (!nodes.length || nodes.length > 100) throw new Error('El SVG debe contener entre 1 y 100 figuras o grupos.');
  nodes.forEach((node, i) => node.setAttribute('data-laser-import', String(i)));
  const loader = new SVGLoader(); loader.defaultDPI = 96;
  const parsed = loader.parse(serial(root)), buckets = nodes.map((n, i) => ({ name: join ? name : n.getAttribute('data-name') || n.getAttribute('id') || `${name} ${i + 1}`, loops: [], open: [], body: [], padding: 0 }));
  for (const path of parsed.paths) {
    const node = path.userData.node, marker = node.closest('[data-laser-import]');
    if (!marker) throw new Error('Geometria fuera de los grupos importados.');
    const bucket = buckets[Number(marker.getAttribute('data-laser-import'))], style = path.userData.style;
    for (const key of ['strokeWidth', 'strokeOpacity', 'fillOpacity']) if (style[key] !== undefined && !Number.isFinite(style[key])) throw new Error('Grosor u opacidad SVG invalido.');
    for (const color of [style.fill, style.stroke]) if (color && color !== 'none' && (/currentcolor|context-|inherit|var\(/i.test(color) || !CSS.supports('color', color))) throw new Error(`Color SVG no soportado: ${color}.`);
    if (style.fill === 'none' && (!style.stroke || style.stroke === 'none')) throw new Error('El SVG contiene geometria invisible; eliminala antes de importar.');
    for (const subpath of path.subPaths) {
      const raw = subpath.curves.flatMap(curve => flattenCurve(curve, Math.max(sx, sy))).map(([x, y]) => [x * sx + ox, y * sy + oy]);
      const closed = subpath.autoClose || raw.length > 2 && Math.hypot(raw[0][0] - raw.at(-1)[0], raw[0][1] - raw.at(-1)[1]) < 0.001;
      const points = cleanLoop(raw);
      if (points.length > 20000) throw new Error('Contorno demasiado complejo: simplifica el archivo antes de importar.');
      if (closed) { assertSimple(points); bucket.loops.push(points); }
      else if (points.length > 1) bucket.open.push(points);
    }
    const e = path.userData.transform.elements, determinant = Math.abs(e[0] * e[4] - e[1] * e[3]);
    if (determinant < 1e-16) throw new Error('Transformacion SVG degenerada.');
    const matrix = [e[0] * sx, e[1] * sy, e[3] * sx, e[4] * sy, e[6] * sx + ox, e[7] * sy + oy];
    const leaf = doc.createElementNS(NS, node.localName);
    for (const attr of node.attributes) if (geometryAttrs.has(attr.name)) leaf.setAttribute(attr.name, attr.value);
    leaf.setAttribute('transform', `matrix(${matrix.map(f).join(' ')})`);
    const strokeWidth = (style.strokeWidth || 0) / Math.sqrt(determinant);
    for (const [key, attr] of Object.entries(styleAttrs)) if (style[key] !== undefined) leaf.setAttribute(attr, String(key === 'strokeWidth' ? f(strokeWidth) : style[key]));
    const [a, b, c, d] = matrix, trace = a * a + b * b + c * c + d * d;
    const maximumScale = Math.sqrt((trace + Math.sqrt(Math.max(0, trace * trace - 4 * (a * d - b * c) ** 2))) / 2);
    if (style.stroke && style.stroke !== 'none') {
      const factor = style.strokeLineJoin === 'miter' ? Math.max(1, style.strokeMiterLimit || 4) : style.strokeLineCap === 'square' ? Math.SQRT2 : 1;
      bucket.padding = Math.max(bucket.padding, strokeWidth * maximumScale / 2 * factor);
    }
    bucket.body.push(serial(leaf));
  }
  return buckets.map(bucket => {
    const loops = unionLoops(bucket.loops);
    for (const path of bucket.open) if (!coveredPolyline(path, loops)) throw new Error(`${bucket.name}: un trazo abierto sobresale de su contorno cerrado.`);
    const bb = bounds(loops);
    if (bb.width < 0.05 || bb.height < 0.05 || bb.width > 3000 || bb.height > 3000) throw new Error('Pieza fuera del rango de 0.05 a 3000 mm.');
    const body = `<g transform="translate(${f(-bb.minX)} ${f(-bb.minY)})">${bucket.body.join('')}</g>`;
    return { id: crypto.randomUUID(), name: bucket.name, role: 'figure', enabled: true, quantity: 1, ratio: 1, complementId: '',
      sourceId, origin: [bb.minX, bb.minY], width: bb.width, height: bb.height,
      loops: transformLoops(loops, { x: -bb.minX, y: -bb.minY }), padding: bucket.padding,
      body, svg: envelope(body, bb.width, bb.height) };
  });
}

export function groupLaserTemplates(templates, name = 'Grupo') {
  if (templates.length < 2 || new Set(templates.map(t => t.sourceId)).size !== 1) throw new Error('Selecciona al menos dos piezas del mismo SVG para conservar su posicion relativa.');
  const minX = Math.min(...templates.map(t => t.origin[0])), minY = Math.min(...templates.map(t => t.origin[1]));
  const body = templates.map(t => `<g transform="translate(${f(t.origin[0] - minX)} ${f(t.origin[1] - minY)})">${t.body}</g>`).join('');
  const maxX = Math.max(...templates.map(t => t.origin[0] + t.width)), maxY = Math.max(...templates.map(t => t.origin[1] + t.height));
  const [group] = importLaserSVG(envelope(body, maxX - minX, maxY - minY), { name, join: true, sourceId: templates[0].sourceId });
  group.origin = [minX, minY];
  return group;
}
export function laserSVG(templates, placements, config) {
  const result = validateLayout(templates, placements, config);
  if (!result.valid) throw new Error(result.issues[0]?.message || 'No hay distribucion valida para exportar.');
  const byId = new Map(templates.map(t => [t.id, t]));
  const body = placements.map(p => `<g data-name="${escapeXML(byId.get(p.templateId).name)}" data-template="${escapeXML(p.templateId)}" transform="translate(${f(p.x)} ${f(p.y)}) rotate(${f(p.angle)})">${byId.get(p.templateId).body}</g>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${envelope(body, config.width, config.height)}\n`;
}
export function laserProject(templates, placements, config) {
  return { app: 'Relieve3D-Laser', version: 1, config, placements,
    templates: templates.map(({ id, name, role, enabled, quantity, ratio, complementId, svg, origin, sourceId }) =>
      ({ id, name, role, enabled, quantity, ratio, complementId, svg, origin, sourceId })) };
}
export function readLaserProject(project) {
  if (project.app !== 'Relieve3D-Laser' || project.version !== 1 || !Array.isArray(project.templates) || project.templates.length > 100 || !Array.isArray(project.placements)) throw new Error('Proyecto laser no compatible.');
  const templates = project.templates.map(saved => {
    if (typeof saved.svg !== 'string' || typeof saved.name !== 'string' || !Array.isArray(saved.origin) || saved.origin.length !== 2 || !saved.origin.every(Number.isFinite)) throw new Error('Pieza guardada invalida.');
    const [fresh] = importLaserSVG(saved.svg, { name: saved.name, join: true });
    return { ...fresh, id: saved.id, role: saved.role, enabled: saved.enabled, quantity: saved.quantity, ratio: saved.ratio,
      complementId: saved.complementId, origin: saved.origin, sourceId: saved.sourceId };
  });
  const validation = validateLayout(templates, project.placements, project.config);
  return { templates, placements: project.placements, config: project.config, validation };
}

import * as THREE from 'three';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { read3MF } from './threemf_read.js';

let engine, loading;
export async function prepareKeyring() {
  if (!loading) loading = import('../../node_modules/manifold-3d/manifold.js')
    .then(({ default: init }) => init()).then((w) => { w.setup(); engine = w; })
    .catch((err) => { loading = null; throw err; });
  await loading;
  return engine;
}

const attr = (s, name) => {
  const m = new RegExp(`(?:^|\\s)${name.replace(/[.:]/g, '\\$&')}="([^"]*)"`).exec(s);
  return m ? m[1] : null;
};
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const number = (v) => {
  if (!Number.isFinite(v)) throw new Error('El 3MF contiene coordenadas no finitas.');
  return Math.abs(v) < 1e-12 ? '0' : String(Number(v.toPrecision(15)));
};
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

export function inspectKeyringSource(bytes) {
  const source = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
  const model = read3MF(source);
  const files = unzipSync(source);
  const modelPath = Object.keys(files).find((p) => p.toLowerCase() === '3d/3dmodel.model');
  const xml = strFromU8(files[modelPath]);
  if (!/<resources(?:\s[^>]*)?>[\s\S]*<\/resources>/.test(xml) || !/<build(?:\s[^>]*)?>[\s\S]*<\/build>/.test(xml)) {
    throw new Error('No se pudo identificar la estructura editable del 3MF.');
  }
  return { source, model, files, modelPath, xml };
}

function bounds(parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.V.length; i += 3) for (let j = 0; j < 3; j++) {
    min[j] = Math.min(min[j], p.V[i + j]);
    max[j] = Math.max(max[j], p.V[i + j]);
  }
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite) || max.some((v, i) => v <= min[i])) {
    throw new Error('El objeto no tiene un volumen válido.');
  }
  return { min, max, size: max.map((v, i) => v - min[i]) };
}

// Intersect the actual surface at the ring height, then find the outermost point along the chosen side.
function edgeAt(parts, axis, across, z, positive) {
  let best = positive ? -Infinity : Infinity;
  const other = 1 - axis, eps = 1e-8;
  for (const p of parts) for (let t = 0; t < p.T.length; t += 3) {
    const tri = [0, 1, 2].map((j) => {
      const i = p.T[t + j] * 3;
      return [p.V[i], p.V[i + 1], p.V[i + 2]];
    });
    const hits = [];
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3], dz = b[2] - a[2];
      if (Math.abs(dz) < eps) continue;
      const u = (z - a[2]) / dz;
      if (u >= -eps && u <= 1 + eps) hits.push([a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])]);
    }
    if (hits.length < 2) continue;
    for (let j = 1; j < hits.length; j++) {
      const a = hits[0], b = hits[j], d = b[other] - a[other];
      if (Math.abs(d) < eps) {
        if (Math.abs(a[other] - across) > eps) continue;
        best = positive ? Math.max(best, a[axis], b[axis]) : Math.min(best, a[axis], b[axis]);
      } else {
        const u = (across - a[other]) / d;
        if (u < -eps || u > 1 + eps) continue;
        const value = a[axis] + u * (b[axis] - a[axis]);
        best = positive ? Math.max(best, value) : Math.min(best, value);
      }
    }
  }
  if (!Number.isFinite(best)) throw new Error('No hay superficie en esa posición y altura. Mueve la argolla o cambia su altura.');
  const point = [0, 0]; point[axis] = best; point[other] = across;
  return point;
}

function inverseTransform(transform) {
  const a = transform || identity;
  const m = new THREE.Matrix4().set(a[0], a[3], a[6], a[9], a[1], a[4], a[7], a[10], a[2], a[5], a[8], a[11], 0, 0, 0, 1);
  if (Math.abs(m.determinant()) < 1e-10) throw new Error('La transformación del objeto no se puede invertir.');
  m.invert();
  const e = m.elements;
  return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]];
}

function assertUniqueInstance(scene, item) {
  const refs = [...scene.xml.matchAll(/<(?:item|component)\s([^>]*?)\/?>/g)]
    .filter((m) => attr(m[1], 'objectid') === item.objectId && !attr(m[1], 'p:path'));
  if (refs.length !== 1) throw new Error('Esta pieza tiene instancias repetidas o compartidas. Sepáralas en el laminador antes de agregar la argolla.');
}

function solidFromPart(p, own) {
  const mesh = new engine.Mesh({ numProp: 3, vertProperties: new Float32Array(p.V), triVerts: new Uint32Array(p.T) });
  mesh.merge();
  const solid = own(new engine.Manifold(mesh));
  if (solid.status() !== 'NoError' || solid.volume() <= 0) {
    throw new Error('Una pieza cerca de la argolla no es un sólido cerrado. Repárala en el laminador y vuelve a abrirla.');
  }
  return solid;
}

export function buildKeyring(scene, opts = {}) {
  if (!engine) throw new Error('El motor 3D aún no está listo.');
  const o = { itemIndex: 0, side: 'top', position: 0.5, outer: 10, inner: 4, thickness: 2.4, overlap: 1.5, zOffset: 0, color: '#ffffff', extruder: 1, ...opts };
  for (const k of ['position', 'outer', 'inner', 'thickness', 'overlap', 'zOffset']) {
    o[k] = Number(o[k]);
    if (!Number.isFinite(o[k])) throw new Error('Revisa las medidas de la argolla.');
  }
  if (!Number.isInteger(o.itemIndex) || !scene.model.instances[o.itemIndex]) throw new Error('Selecciona el objeto al que se unirá la argolla.');
  if (!['top', 'bottom', 'left', 'right'].includes(o.side) || o.position < 0 || o.position > 1) throw new Error('Revisa la posición de la argolla.');
  if (o.inner < 2.5 || o.outer > 40 || o.outer - o.inner < 2.4) throw new Error('La argolla necesita un agujero de al menos 2,5 mm y una pared de al menos 1,2 mm.');
  if (o.thickness < 1.2 || o.thickness > 20 || o.zOffset < 0) throw new Error('El grosor debe ser de 1,2 a 20 mm y la altura no puede ser negativa.');
  if (o.overlap < 0.6 || o.overlap > (o.outer - o.inner) / 2 - 0.2) throw new Error('Revisa el solapamiento: debe unir la pared sin tapar el agujero.');
  if (!/^#[0-9a-f]{6}$/i.test(o.color) || !Number.isInteger(+o.extruder) || +o.extruder < 1 || +o.extruder > 16) throw new Error('Revisa el color y filamento de la argolla.');

  const item = scene.model.instances[o.itemIndex];
  assertUniqueInstance(scene, item);
  inverseTransform(item.transform);
  const parts = scene.model.parts.filter((p) => p.instanceIndex === o.itemIndex), box = bounds(parts);
  const axis = ['top', 'bottom'].includes(o.side) ? 1 : 0, positive = ['top', 'right'].includes(o.side), other = 1 - axis;
  const z = box.min[2] + o.zOffset, middle = z + o.thickness / 2;
  if (middle <= box.min[2] || middle >= box.max[2]) throw new Error('La altura de la argolla debe cortar el volumen del objeto.');
  const across = box.min[other] + o.position * box.size[other];
  const anchor = edgeAt(parts, axis, across, middle, positive);
  const center = [...anchor]; center[axis] += (positive ? 1 : -1) * (o.outer / 2 - o.overlap);
  const owned = [], own = (value) => { owned.push(value); return value; };
  try {
    const CS = engine.CrossSection;
    const outside = own(CS.circle(o.outer / 2, 96)), inside = own(CS.circle(o.inner / 2, 96));
    const section = own(outside.subtract(inside));
    const ring = own(own(section.extrude(o.thickness)).translate([center[0], center[1], z]));
    const hole = own(own(own(CS.circle(o.inner / 2, 96)).extrude(o.thickness + 0.2)).translate([center[0], center[1], z - 0.1]));
    let attachmentVolume = 0, holeBlockedVolume = 0;
    for (const p of scene.model.parts) {
      const pb = bounds([p]), r = o.outer / 2;
      if (pb.max[0] < center[0] - r || pb.min[0] > center[0] + r || pb.max[1] < center[1] - r || pb.min[1] > center[1] + r || pb.max[2] < z || pb.min[2] > z + o.thickness) continue;
      const body = solidFromPart(p, own);
      if (p.instanceIndex === o.itemIndex) attachmentVolume += own(body.intersect(ring)).volume();
      holeBlockedVolume += own(body.intersect(hole)).volume();
    }
    if (attachmentVolume < Math.max(0.15, o.thickness * 0.25)) throw new Error('La argolla no se une con suficiente material. Cambia su posición o aumenta el solapamiento.');
    if (holeBlockedVolume > 1e-5) throw new Error('El modelo tapa el agujero de la argolla. Mueve la argolla o reduce el solapamiento.');
    const mesh = ring.getMesh(), components = ring.decompose().map(own);
    if (ring.status() !== 'NoError' || components.length !== 1 || ring.volume() <= 0) throw new Error('No se pudo construir una argolla sólida.');
    const V = new Float64Array(mesh.numVert * 3);
    for (let i = 0; i < mesh.numVert; i++) for (let j = 0; j < 3; j++) V[i * 3 + j] = mesh.vertProperties[i * mesh.numProp + j];
    return { itemIndex: o.itemIndex, center, z, options: o, V, T: new Uint32Array(mesh.triVerts), volume: ring.volume(), components: components.length, attachmentVolume, holeBlockedVolume };
  } finally { for (let i = owned.length - 1; i >= 0; i--) owned[i].delete(); }
}

function replaceObject(xml, id, update) {
  const matches = [...xml.matchAll(/<object\s([^>]*)>([\s\S]*?)<\/object>/g)].filter((m) => attr(m[1], 'id') === String(id));
  if (matches.length !== 1) throw new Error('No se encontró un objeto 3MF editable y único.');
  const m = matches[0], result = update(m[1], m[2]);
  return xml.slice(0, m.index) + `<object ${m[1]}>${result}</object>` + xml.slice(m.index + m[0].length);
}

export function exportKeyring(scene, result) {
  const item = scene.model.instances[result.itemIndex];
  if (!item || result.options.itemIndex !== result.itemIndex) throw new Error('La argolla no corresponde al objeto seleccionado.');
  assertUniqueInstance(scene, item);
  const files = { ...scene.files };
  let maxId = 0;
  for (const [path, data] of Object.entries(files)) if (/\.model$/i.test(path) || /model_settings\.config$/i.test(path)) {
    for (const m of strFromU8(data).matchAll(/\bid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  }
  if (maxId > 2147483640) throw new Error('El archivo usa identificadores 3MF demasiado grandes.');
  const sourceId = ++maxId, ringId = ++maxId, materialId = ++maxId;
  const inverse = inverseTransform(item.transform).map(number).join(' ');
  const component = `<component objectid="${ringId}" transform="${inverse}"/>`;
  let originalMesh = '', sourceAttrs = '';
  let xml = replaceObject(scene.xml, item.objectId, (attrs, body) => {
    const cm = /<components(?:\s[^>]*)?>([\s\S]*?)<\/components>/.exec(body);
    const mm = /<mesh(?:\s[^>]*)?>[\s\S]*?<\/mesh>/.exec(body);
    if (cm && !mm) return body.replace(cm[0], cm[0].replace('</components>', `${component}</components>`));
    if (!cm && mm) {
      originalMesh = mm[0];
      sourceAttrs = ['type', 'name', 'pid', 'pindex'].map((k) => attr(attrs, k) == null ? '' : ` ${k}="${attr(attrs, k)}"`).join('');
      return body.replace(mm[0], `<components><component objectid="${sourceId}"/>${component}</components>`);
    }
    throw new Error('El objeto contiene una estructura que no se puede modificar con seguridad.');
  });
  const v = result.V, t = result.T, scale = scene.model.unitFactor;
  const vertices = [];
  for (let i = 0; i < v.length; i += 3) vertices.push(`<vertex x="${number(v[i] / scale)}" y="${number(v[i + 1] / scale)}" z="${number(v[i + 2] / scale)}"/>`);
  const triangles = [];
  for (let i = 0; i < t.length; i += 3) triangles.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>`);
  const source = originalMesh ? `<object id="${sourceId}"${sourceAttrs}>${originalMesh}</object>` : '';
  const material = `<basematerials id="${materialId}"><base name="Argolla" displaycolor="${result.options.color.toUpperCase()}FF"/></basematerials>`;
  const ring = `<object id="${ringId}" type="model" name="Argolla Relieve3D" pid="${materialId}" pindex="0"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`;
  if ((xml.match(/<\/resources>/g) || []).length !== 1) throw new Error('No se pueden actualizar los recursos del 3MF.');
  xml = xml.replace('</resources>', `${source}${material}${ring}</resources>`);
  files[scene.modelPath] = strToU8(xml);

  const cfgPath = Object.keys(files).find((p) => p.toLowerCase() === 'metadata/model_settings.config') || 'Metadata/model_settings.config';
  let cfg = files[cfgPath] ? strFromU8(files[cfgPath]) : '<?xml version="1.0" encoding="UTF-8"?><config></config>';
  const settings = [...cfg.matchAll(/<object\s([^>]*)>([\s\S]*?)<\/object>/g)].filter((m) => attr(m[1], 'id') === item.objectId);
  const ringPart = `<part id="${ringId}" subtype="normal_part"><metadata key="name" value="Argolla Relieve3D"/><metadata key="extruder" value="${+result.options.extruder}"/></part>`;
  if (settings.length > 1) throw new Error('La configuración del objeto 3MF está repetida.');
  if (settings.length === 1) {
    cfg = replaceObject(cfg, item.objectId, (_attrs, body) => {
      if (originalMesh) {
        const matches = [...body.matchAll(/<part\s([^>]*)>/g)];
        if (matches.length > 1 || (matches.length === 1 && attr(matches[0][1], 'id') !== item.objectId)) {
          throw new Error('La configuración de piezas no coincide con la malla original.');
        }
        if (matches.length) body = body.replace(matches[0][0], matches[0][0].replace(/(\bid=")\d+(")/, `$1${sourceId}$2`));
        else body += `<part id="${sourceId}" subtype="normal_part"><metadata key="name" value="Modelo original"/></part>`;
      }
      return body + ringPart;
    });
  } else {
    if ((cfg.match(/<\/config>/g) || []).length !== 1) throw new Error('La configuración del 3MF no es compatible.');
    const originalPart = originalMesh ? `<part id="${sourceId}" subtype="normal_part"><metadata key="name" value="Modelo original"/></part>` : '';
    cfg = cfg.replace('</config>', `<object id="${xmlEsc(item.objectId)}">${originalPart}${ringPart}</object></config>`);
  }
  files[cfgPath] = strToU8(cfg);
  const removed = new Set();
  for (const path of Object.keys(files)) {
    if (/\.gcode(?:\..*)?$/i.test(path) || /^metadata\/slice_info\.config$/i.test(path) ||
      /^metadata\/plate_\d+\.json$/i.test(path) || /^metadata\/(?:plate_\d+(?:_small)?|plate_no_light_\d+|top_\d+|pick_\d+)\.png$/i.test(path)) {
      removed.add(path.toLowerCase());
      delete files[path];
    }
  }
  for (const path of Object.keys(files).filter((p) => /\.rels$/i.test(p))) {
    const base = path.toLowerCase() === '_rels/.rels' ? '' : path.replace(/(?:^|\/)_rels\/[^/]+\.rels$/i, '');
    const rels = strFromU8(files[path]).replace(/<Relationship\s([^>]*?)(?:\/>|>\s*<\/Relationship>)/g, (element, attrs) => {
      let target = attr(attrs, 'Target');
      if (!target || /external/i.test(attr(attrs, 'TargetMode') || '')) return element;
      try { target = decodeURIComponent(target.split(/[?#]/)[0]); } catch { return element; }
      const segments = (target.startsWith('/') ? target : `${base}/${target}`).split('/');
      const normalized = [];
      for (const segment of segments) {
        if (segment === '..') normalized.pop();
        else if (segment && segment !== '.') normalized.push(segment);
      }
      return removed.has(normalized.join('/').toLowerCase()) ? '' : element;
    });
    files[path] = strToU8(rels);
  }
  return zipSync(files, { level: 6 });
}

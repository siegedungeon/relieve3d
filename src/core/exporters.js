import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { zipSync, strToU8 } from 'fflate';

// parts: [{ name, color, filamentIndex, geometry }]  (geometry in mm)

export function mergeToIndexed(geoms) {
  const clean = geoms.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    const c = new THREE.BufferGeometry();
    c.setAttribute('position', n.getAttribute('position'));
    return c;
  });
  const merged = clean.length === 1 ? clean[0] : mergeGeometries(clean, false);
  return mergeVertices(merged, 1e-4);
}

function triangles(geometry, cb) {
  const pos = geometry.getAttribute('position');
  const idx = geometry.index;
  const n = idx ? idx.count : pos.count;
  for (let i = 0; i < n; i += 3) {
    const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
    cb(a, b, c, pos);
  }
}

export function stlBinary(geoms) {
  let tri = 0;
  for (const g of geoms) tri += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  const buf = new ArrayBuffer(84 + 50 * tri);
  const dv = new DataView(buf);
  const header = 'Relieve3D STL';
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, tri, true);
  let off = 84;
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), cb = new THREE.Vector3(), ab = new THREE.Vector3();
  for (const g of geoms) {
    triangles(g, (a, b, c, pos) => {
      va.fromBufferAttribute(pos, a); vb.fromBufferAttribute(pos, b); vc.fromBufferAttribute(pos, c);
      cb.subVectors(vc, vb); ab.subVectors(va, vb); cb.cross(ab).normalize();
      for (const v of [cb, va, vb, vc]) {
        dv.setFloat32(off, v.x, true); dv.setFloat32(off + 4, v.y, true); dv.setFloat32(off + 8, v.z, true);
        off += 12;
      }
      dv.setUint16(off, 0, true);
      off += 2;
    });
  }
  return new Uint8Array(buf);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const f = (v) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(4).replace(/\.?0+$/, ''));

// Multi-part 3MF: one mesh object per part, assembled into a single object (works with Bambu/Orca/Prusa).
// opts.pauses: [{ z, msg }] → Bambu Studio "pause print" at that layer height (e.g. to insert an NFC chip or magnets)
export function threeMF(parts, modelName = 'Relieve3D', opts = {}) {
  const filamentColors = [];
  for (const p of parts) if (!filamentColors[p.filamentIndex]) filamentColors[p.filamentIndex] = p.color;
  const colors = Array.from(filamentColors, (c) => c || '#808080');

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  out.push('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n');
  out.push(`<metadata name="Title">${esc(modelName)}</metadata>\n<metadata name="Application">Relieve3D</metadata>\n<metadata name="Designer">Relieve3D</metadata>\n`);
  out.push('<resources>\n<basematerials id="1">\n');
  for (let i = 0; i < colors.length; i++) out.push(`<base name="Filamento ${i + 1}" displaycolor="${colors[i].toUpperCase()}FF"/>\n`);
  out.push('</basematerials>\n');
  let id = 2;
  const ids = [];
  for (const p of parts) {
    const g = mergeToIndexed([p.geometry]);
    const pos = g.getAttribute('position');
    out.push(`<object id="${id}" type="model" name="${esc(p.name)}" pid="1" pindex="${p.filamentIndex}">\n<mesh>\n<vertices>\n`);
    const vs = [];
    for (let i = 0; i < pos.count; i++) vs.push(`<vertex x="${f(pos.getX(i))}" y="${f(pos.getY(i))}" z="${f(pos.getZ(i))}"/>`);
    out.push(vs.join('\n'), '\n</vertices>\n<triangles>\n');
    const ts = [];
    triangles(g, (a, b, c) => { if (a !== b && b !== c && a !== c) ts.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`); });
    out.push(ts.join('\n'), '\n</triangles>\n</mesh>\n</object>\n');
    ids.push(id++);
  }
  const asm = id;
  out.push(`<object id="${asm}" type="model" name="${esc(modelName)}">\n<components>\n`);
  for (const i of ids) out.push(`<component objectid="${i}"/>\n`);
  out.push('</components>\n</object>\n</resources>\n');
  out.push(`<build>\n<item objectid="${asm}"/>\n</build>\n</model>\n`);

  // Bambu Studio / OrcaSlicer: per-part extruder assignment
  const cfg = ['<?xml version="1.0" encoding="UTF-8"?>\n<config>\n', `  <object id="${asm}">\n`,
    `    <metadata key="name" value="${esc(modelName)}"/>\n    <metadata key="extruder" value="1"/>\n`];
  parts.forEach((p, k) => {
    cfg.push(`    <part id="${ids[k]}" subtype="normal_part">\n      <metadata key="name" value="${esc(p.name)}"/>\n      <metadata key="extruder" value="${p.filamentIndex + 1}"/>\n    </part>\n`);
  });
  cfg.push('  </object>\n</config>\n');

  const contentTypes = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/><Default Extension="xml" ContentType="text/xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  const files = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(out.join('')),
    'Metadata/model_settings.config': strToU8(cfg.join('')),
  };
  if (opts.pauses?.length) files['Metadata/custom_gcode_per_layer.xml'] = strToU8(pauseXML(opts.pauses, colors.length));
  return zipSync(files, { level: 6 });
}

export function pauseXML(pauses, nColors = 1) {
  const L = pauses.map((p) => `<layer top_z="${f(p.z)}" type="1" extruder="1" color="" extra="${esc(p.msg || 'Pausa')}" gcode="M400 U1"/>`).join('');
  const mode = nColors > 1 ? 'MultiAsSingle' : 'SingleExtruder';
  return `<?xml version="1.0" encoding="utf-8"?>\n<custom_gcodes_per_layer><plate><plate_info id="1"/>${L}<mode value="${mode}"/></plate></custom_gcodes_per_layer>\n`;
}

export function objWithMtl(parts, mtlName = 'modelo.mtl') {
  const obj = [`# Relieve3D\nmtllib ${mtlName}\n`];
  const mtl = ['# Relieve3D\n'];
  const mats = new Set();
  let base = 1;
  for (const p of parts) {
    const mat = `filamento_${p.filamentIndex + 1}`;
    if (!mats.has(mat)) {
      mats.add(mat);
      const c = new THREE.Color(p.color);
      mtl.push(`newmtl ${mat}\nKd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}\nKa 0 0 0\nd 1\n\n`);
    }
    const g = mergeToIndexed([p.geometry]);
    const pos = g.getAttribute('position');
    obj.push(`o ${p.name.replace(/\s+/g, '_')}\nusemtl ${mat}\n`);
    const lines = [];
    for (let i = 0; i < pos.count; i++) lines.push(`v ${f(pos.getX(i))} ${f(pos.getY(i))} ${f(pos.getZ(i))}`);
    triangles(g, (a, b, c) => lines.push(`f ${a + base} ${b + base} ${c + base}`));
    obj.push(lines.join('\n'), '\n');
    base += pos.count;
  }
  return { obj: obj.join(''), mtl: mtl.join('') };
}

// layers: [{ name, color, shapes, ring? }] in pixel coords; bbox [x0,y0,x1,y1] px; scale mm/px
export function svg(layers, bbox, scale) {
  const [x0, y0, x1, y1] = bbox;
  const w = x1 - x0, h = y1 - y0;
  const out = [`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${f(w * scale)}mm" height="${f(h * scale)}mm" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}">\n`];
  for (const L of layers) {
    out.push(`<g id="${esc(L.name.replace(/\s+/g, '_'))}" fill="${L.color}" fill-rule="evenodd">\n`);
    for (const shapes of L.items) {
      if (shapes.ring) {
        const r = shapes.ring;
        const d = `M ${f(r.x + r.ro)} ${f(r.y)} A ${f(r.ro)} ${f(r.ro)} 0 1 0 ${f(r.x - r.ro)} ${f(r.y)} A ${f(r.ro)} ${f(r.ro)} 0 1 0 ${f(r.x + r.ro)} ${f(r.y)} Z ` +
          `M ${f(r.x + r.ri)} ${f(r.y)} A ${f(r.ri)} ${f(r.ri)} 0 1 1 ${f(r.x - r.ri)} ${f(r.y)} A ${f(r.ri)} ${f(r.ri)} 0 1 1 ${f(r.x + r.ri)} ${f(r.y)} Z`;
        out.push(`<path d="${d}"/>\n`);
        continue;
      }
      let d = '';
      for (const s of shapes) {
        for (const loop of [s.outer, ...s.holes]) {
          d += 'M' + loop.map((p) => `${f(p[0])} ${f(p[1])}`).join(' L') + ' Z ';
        }
      }
      if (d) out.push(`<path d="${d.trim()}"/>\n`);
    }
    out.push('</g>\n');
  }
  out.push('</svg>\n');
  return out.join('');
}

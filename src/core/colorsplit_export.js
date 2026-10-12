// Files for the color-separated model: one print plate per color (3MF + STL, parts laid flat in their
// print pose), a reference 3MF with the assembled model and the assembly instructions.
import { zipSync, strToU8 } from 'fflate';
import { applyPose, layoutPlates } from './colorsplit.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (x) => (Math.round(x * 10000) / 10000).toString();
const safe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '-').trim();

// Separate objects (one build item each) so the slicer can move / rotate every piece on its own.
export function write3MF(objects, title = 'Relieve3D', palette = []) {
  const cols = palette.length ? palette : ['#808080'];
  const out = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n',
    `<metadata name="Title">${esc(title)}</metadata>\n<metadata name="Application">Relieve3D</metadata>\n<resources>\n<basematerials id="1">\n`];
  cols.forEach((c, i) => out.push(`<base name="Color ${i + 1}" displaycolor="${c.toUpperCase()}FF"/>\n`));
  out.push('</basematerials>\n');
  const cfg = ['<?xml version="1.0" encoding="UTF-8"?>\n<config>\n'];
  objects.forEach((o, k) => {
    const id = k + 2;
    out.push(`<object id="${id}" type="model" name="${esc(o.name)}" pid="1" pindex="${o.color || 0}">\n<mesh>\n<vertices>\n`);
    const vs = [];
    for (let i = 0; i < o.V.length; i += 3) vs.push(`<vertex x="${f(o.V[i])}" y="${f(o.V[i + 1])}" z="${f(o.V[i + 2])}"/>`);
    out.push(vs.join('\n'), '\n</vertices>\n<triangles>\n');
    const ts = [];
    for (let i = 0; i < o.T.length; i += 3) ts.push(`<triangle v1="${o.T[i]}" v2="${o.T[i + 1]}" v3="${o.T[i + 2]}"/>`);
    out.push(ts.join('\n'), '\n</triangles>\n</mesh>\n</object>\n');
    cfg.push(`  <object id="${id}">\n    <metadata key="name" value="${esc(o.name)}"/>\n    <metadata key="extruder" value="${(o.color || 0) + 1}"/>\n  </object>\n`);
  });
  out.push('</resources>\n<build>\n');
  objects.forEach((o, k) => out.push(`<item objectid="${k + 2}"/>\n`));
  out.push('</build>\n</model>\n');
  cfg.push('</config>\n');
  const types = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  return zipSync({
    '[Content_Types].xml': strToU8(types),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(out.join('')),
    'Metadata/model_settings.config': strToU8(cfg.join('')),
  }, { level: 6 });
}

export function writeSTL(objects) {
  let n = 0;
  for (const o of objects) n += o.T.length / 3;
  const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  const head = 'Relieve3D color split';
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, n, true);
  let off = 84;
  for (const { V, T } of objects) {
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
      const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (const x of [nx, ny, nz, V[a], V[a + 1], V[a + 2], V[b], V[b + 1], V[b + 2], V[c], V[c + 1], V[c + 2]]) { dv.setFloat32(off, x, true); off += 4; }
      dv.setUint16(off, 0, true);
      off += 2;
    }
  }
  return new Uint8Array(buf);
}

export const colorName = (res, c) => res.names?.[c] || `Color ${c + 1}`;

// Plates per color: [{ color, plate, items: [{ part, x, y, rot }], objects: [{ name, V, T, color }] }]
export function platesFor(res, { bedW = 256, bedH = 256, gap = 3 } = {}) {
  const plates = [];
  const colors = [...new Set(res.parts.map((p) => p.color))];
  for (const c of colors) {
    const parts = res.parts.filter((p) => p.color === c);
    const lay = layoutPlates(parts.map((p) => p.print.size), bedW, gap, bedH);
    // center each plate's group of parts on the bed
    const ext = new Map();
    parts.forEach((p, i) => {
      const L = lay[i], [w, h] = L.rot ? [p.print.size[1], p.print.size[0]] : p.print.size;
      const e = ext.get(L.plate) || [Infinity, Infinity, -Infinity, -Infinity];
      ext.set(L.plate, [Math.min(e[0], L.x - w / 2), Math.min(e[1], L.y - h / 2), Math.max(e[2], L.x + w / 2), Math.max(e[3], L.y + h / 2)]);
    });
    for (const L of lay) {
      const e = ext.get(L.plate);
      L.x += Math.max(gap - e[0], (bedW - e[0] - e[2]) / 2);
      L.y += Math.max(gap - e[1], (bedH - e[1] - e[3]) / 2);
    }
    const by = new Map();
    parts.forEach((p, i) => {
      const L = lay[i];
      if (!by.has(L.plate)) by.set(L.plate, { color: c, plate: L.plate, items: [], objects: [] });
      const pl = by.get(L.plate);
      pl.items.push({ part: p, ...L });
      const m = applyPose(p.mesh, p.print, L.x, L.y, L.rot);
      pl.objects.push({ name: p.name, V: m.V, T: m.T, color: c });
    });
    plates.push(...[...by.values()].sort((a, b) => a.plate - b.plate));
  }
  return plates;
}

export function instructions(res, opts, plates) {
  const L = [];
  const names = (c) => colorName(res, c);
  const body = res.parts.filter((p) => p.kind === 'body');
  const solids = res.parts.filter((p) => p.kind === 'solid');
  const inlays = res.parts.filter((p) => p.kind === 'inlay');
  L.push(`SEPARACIÓN DE COLORES — ${opts.title || 'modelo'}`, '');
  L.push(`Piezas: ${res.parts.length}  (cuerpo: ${body.length}, piezas sólidas: ${solids.length}, incrustaciones: ${inlays.length})`);
  L.push(`Holgura de encaje: ${opts.clearance} mm en total (${(opts.clearance / 2).toFixed(2)} mm por lado)`, '');
  L.push('IMPRESIÓN', '');
  for (const pl of plates) L.push(`  ${names(pl.color)} — placa ${pl.plate + 1}: ${pl.items.length} pieza(s)${pl.items.some((i) => !i.fits) ? '  ⚠ hay piezas más grandes que la cama' : ''}`);
  if (res.cut) {
    L.push('',
      '  • El modelo va cortado por un plano vertical en dos mitades: FRENTE y ATRÁS. Cada archivo ya trae las piezas',
      '    orientadas: las mitades del cuerpo se apoyan en su cara plana del corte (sin soportes) y las piezas de color',
      '    con la cara visible ARRIBA; las que llegan al corte se apoyan también en esa cara plana.',
      '  • Si alguna pieza de color tiene la cara oculta curva sin tocar la cama, activa soportes tipo árbol "solo en la cama".',
      '  • Usa capas de 0.12–0.16 mm para las piezas de color (la superficie curva sale más lisa).',
      '  • Si las piezas entran muy duras sube la holgura a 0.2 mm; si quedan flojas bájala a 0.1 mm y vuelve a generar.', '');
    L.push('ARMADO', '',
      '  1. Presenta cada pieza de color en su mitad SIN pegamento: entra recta, empujando hacia la mitad (de frente en',
      '     la mitad delantera, desde atrás en la trasera). Cada forma sólo encaja en su lugar (usa el mapa de armado).',
      '  2. Pégalas con una gota de cianoacrilato (gel) en el fondo del bolsillo, no en los bordes.',
      '  3. Con las dos mitades completas, lija plana la cara del corte si hace falta y pega FRENTE con ATRÁS',
      '     (cianoacrilato o epóxico de 5 min), alineando los bordes de las franjas.',
      '  4. Las piezas sólidas (ej. el moño) entran en su asiento; pégalas al final.', '');
  } else {
  L.push('',
    '  • Cada archivo ya trae las piezas en su mejor orientación: la cara de color (visible) queda ARRIBA.',
    '  • Las incrustaciones son cascarones curvos que copian la superficie: su cara oculta (la que se pega)',
    '    es curva → activa soportes tipo árbol "solo en la cama". Esa cara no se ve; la visible sale limpia.',
    '  • Cuerpo: imprímelo como viene (Z hacia arriba). Si el slicer marca voladizos dentro de los bolsillos',
    '    activa soportes "solo en la cama" o árbol; los bolsillos son poco profundos.',
    '  • Usa capas de 0.12–0.16 mm para las incrustaciones (la superficie curva sale más lisa).',
    '  • Calibra el flujo / la compensación XY: si las piezas entran muy duras, sube la holgura a 0.2 mm;',
    '    si quedan flojas, bájala a 0.1 mm y vuelve a generar.', '');
  L.push('ARMADO', '',
    '  1. Retira los soportes y lija suave la cara oculta de cada incrustación (lija 400) para que asiente bien.',
    '  2. Presenta cada pieza en su bolsillo SIN pegamento: cada forma sólo encaja en su lugar (usa el mapa de armado).',
    '  3. Pega con una gota de cianoacrilato (gel) en el fondo del bolsillo, no en los bordes, para que no rebose.',
    '     Para PETG/PLA también sirve pegamento para plásticos tipo epóxico de 5 minutos.',
    '  4. Las piezas sólidas (ej. el moño) entran en su asiento en el cuerpo; pégalas al final.', '');
  }
  if (res.warnings?.length) { L.push('AVISOS', ''); for (const w of res.warnings) L.push('  • ' + w); L.push(''); }
  L.push('LISTA DE PIEZAS', '');
  for (const p of res.parts) L.push(`  ${p.name.padEnd(28)} ${p.kind === 'body' ? 'cuerpo' : p.kind === 'solid' ? 'sólida' : 'incrustación'}  ${p.print.size.map((x) => x.toFixed(1)).join(' × ')} mm  ${p.volume.toFixed(1)} mm³`);
  return L.join('\r\n');
}

// All files: [{ name, data }]
export function exportFiles(res, opts = {}) {
  const o = { bedW: 256, bedH: 256, gap: 3, clearance: 0.15, title: 'modelo', ...opts };
  const plates = platesFor(res, o);
  const files = [];
  const multi = new Map();
  for (const pl of plates) multi.set(pl.color, (multi.get(pl.color) || 0) + 1);
  for (const pl of plates) {
    const nm = safe(`${o.title} - ${colorName(res, pl.color)}${multi.get(pl.color) > 1 ? ` - placa ${pl.plate + 1}` : ''}`);
    pl.file = nm + '.3mf';
    files.push({ name: pl.file, data: write3MF(pl.objects, nm, res.palette) });
    files.push({ name: nm + '.stl', data: writeSTL(pl.objects) });
  }
  const asm = res.parts.map((p) => ({ name: p.name, V: p.mesh.V, T: p.mesh.T, color: p.color }));
  files.push({ name: safe(`${o.title} - ensamble (referencia)`) + '.3mf', data: write3MF(asm, o.title + ' ensamble', res.palette) });
  files.push({ name: safe(`${o.title} - instrucciones`) + '.txt', data: strToU8('\ufeff' + instructions(res, o, plates)) });
  return { files, plates };
}

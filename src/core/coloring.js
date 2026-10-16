import { processImage, modeFilter, computeForeground, smoothLoop, signedArea } from './processing.js';
import { components, edt, dilate, fillCapsule, traceMask, countOn } from './raster.js';
import { fitClosed, cubicsToPath } from './curvefit.js';

export const COLORING_DEFAULTS = Object.freeze({
  colors: 10, minDetail: 0.25, minArea: 0.4, contrast: 16, smooth: 1,
  lineWidth: 0.6, keepInk: true, cleanBackground: true, backgroundTolerance: 50,
  mode: 'regions', shadowTolerance: 70, curveSmooth: 0,
  pageWidth: 210, pageHeight: 297, margin: 10, dpi: 300,
});

export function coloringOptions(input = {}) {
  const o = { ...COLORING_DEFAULTS, ...input };
  const limits = {
    colors: [2, 24, 'Cantidad de colores'], minDetail: [0, 5, 'Detalle mínimo'],
    minArea: [0, 100, 'Área mínima'], contrast: [0, 120, 'Contraste mínimo'],
    smooth: [0, 4, 'Suavizado'], lineWidth: [0.15, 3, 'Grosor de línea'],
    pageWidth: [50, 500, 'Ancho de página'], pageHeight: [50, 500, 'Alto de página'],
    margin: [0, 80, 'Margen'], dpi: [72, 300, 'Resolución'],
    backgroundTolerance: [0, 120, 'Tolerancia de fondo'],
    shadowTolerance: [0, 120, 'Sombras'],
    curveSmooth: [0, 1.2, 'Pulido de curvas'],
  };
  for (const [key, [min, max, label]] of Object.entries(limits)) {
    if (!Number.isFinite(o[key]) || o[key] < min || o[key] > max) throw new Error(`${label}: usa un valor entre ${min} y ${max}.`);
  }
  if (![o.colors, o.smooth, o.dpi].every(Number.isInteger)) throw new Error('Colores, suavizado y resolución deben ser enteros.');
  if (!['regions', 'illustration'].includes(o.mode)) throw new Error('Modo de conversión inválido.');
  if (typeof o.keepInk !== 'boolean' || typeof o.cleanBackground !== 'boolean') throw new Error('Las opciones de trazos y fondo deben ser sí/no.');
  if (o.margin * 2 + 10 > Math.min(o.pageWidth, o.pageHeight)) throw new Error('El margen deja menos de 10 mm para el dibujo.');
  if (Math.ceil(o.pageWidth * o.dpi / 25.4) * Math.ceil(o.pageHeight * o.dpi / 25.4) > 36000000) {
    throw new Error('La página supera 36 megapíxeles: reduce su tamaño o la resolución.');
  }
  return o;
}

export function coloringLayout(W, H, input) {
  const o = coloringOptions(input);
  const scale = Math.min((o.pageWidth - 2 * o.margin) / W, (o.pageHeight - 2 * o.margin) / H);
  return { scale, x: (o.pageWidth - W * scale) / 2, y: (o.pageHeight - H * scale) / 2, width: W * scale, height: H * scale };
}

// Zhang-Suen thinning keeps source ink as one line, not the two edges of a dark stripe.
function thinInk(mask, W, H) {
  const w = W + 2, h = H + 2, m = new Uint8Array(w * h), drop = [];
  for (let y = 0; y < H; y++) m.set(mask.subarray(y * W, (y + 1) * W), (y + 1) * w + 1);
  let changed;
  do {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      drop.length = 0;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!m[i]) continue;
        const p = [m[i - w], m[i - w + 1], m[i + 1], m[i + w + 1], m[i + w], m[i + w - 1], m[i - 1], m[i - w - 1]];
        const n = p.reduce((a, b) => a + b, 0);
        if (n < 2 || n > 6) continue;
        let changes = 0;
        for (let j = 0; j < 8; j++) if (!p[j] && p[(j + 1) % 8]) changes++;
        if (changes !== 1) continue;
        if (pass === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        drop.push(i);
      }
      for (const i of drop) m[i] = 0;
      changed ||= drop.length > 0;
    }
  } while (changed);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) out.set(m.subarray((y + 1) * w + 1, (y + 1) * w + 1 + W), y * W);
  return out;
}

function sameShade(a, b, tolerance) {
  if (!tolerance || Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b)) > tolerance) return false;
  if (Math.min(a.r, a.g, a.b, b.r, b.g, b.b) >= 180 &&
    Math.max(a.r, a.g, a.b) - Math.min(a.r, a.g, a.b) <= 45 &&
    Math.max(b.r, b.g, b.b) - Math.min(b.r, b.g, b.b) <= 45) return true;
  const hue = c => {
    const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b), d = max - min;
    if (d <= 25) return null;
    return ((max === c.r ? (c.g - c.b) / d : max === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4) * 60 + 360) % 360;
  };
  const ha = hue(a), hb = hue(b);
  if (ha === null || hb === null) return ha === hb && Math.min(a.r, a.g, a.b, b.r, b.g, b.b) >= 128;
  return Math.min(Math.abs(ha - hb), 360 - Math.abs(ha - hb)) <= 12;
}

function coloredStrokes(result, W, H, radius) {
  const { comp, pieces, palette } = result, n = pieces.length;
  const boundary = new Uint8Array(W * H), total = new Uint32Array(n), lighter = new Uint32Array(n), neighbors = new Uint32Array(n);
  const light = palette.map(c => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722);
  const pair = (i, j) => {
    const a = comp[i], b = comp[j];
    if (a === b || a < 0 || b < 0) return;
    boundary[i] = boundary[j] = 1; total[a]++; total[b]++;
    const ca = pieces[a].cluster, cb = pieces[b].cluster;
    if (light[cb] - light[ca] > 4) { lighter[a]++; neighbors[a] |= 1 << cb; }
    if (light[ca] - light[cb] > 4) { lighter[b]++; neighbors[b] |= 1 << ca; }
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (x + 1 < W) pair(i, i + 1);
    if (y + 1 < H) pair(i, i + W);
  }
  const distance = edt(boundary, W, H), thick = new Uint32Array(n);
  for (let i = 0; i < comp.length; i++) if (comp[i] >= 0 && distance[i] > radius) thick[comp[i]]++;
  // A colored stroke is a narrow band darker than different regions on both sides, not a small filled detail.
  const bands = pieces.map((p, id) => {
    const c = palette[p.cluster], hues = neighbors[id];
    if (Math.max(c.r, c.g, c.b) < 85 && Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 35) return false;
    return thick[id] <= p.area * 0.05 && lighter[id] > total[id] * 0.72 && !!(hues & (hues - 1)) &&
      (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) > 25 || light[p.cluster] < 180);
  });
  return Uint8Array.from(comp, id => id >= 0 && bands[id] ? 1 : 0);
}

export function createColoring(img, input = {}, progress = () => {}) {
  const o = coloringOptions(input), { width: W, height: H } = img;
  const illustration = o.mode === 'illustration';
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 2 || H < 2 || W * H > 4000000 || img.data?.length !== W * H * 4) {
    throw new Error('La imagen debe tener al menos 2 × 2 píxeles y no superar 4 megapíxeles de trabajo.');
  }
  const layout = coloringLayout(W, H, o), ppm = 1 / layout.scale;
  const rgba = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < W * H; i++) {
    const a = img.data[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = img.data[i * 4 + c] * a + 255 * (1 - a);
    rgba[i * 4 + 3] = 255;
  }
  if (o.cleanBackground && [0, W - 1, W * (H - 1), W * H - 1].every(i => {
    const rgb = rgba.subarray(i * 4, i * 4 + 3);
    return Math.min(...rgb) >= 185 && Math.max(...rgb) - Math.min(...rgb) <= (illustration ? 25 : 50);
  })) {
    const background = illustration ? rgba.slice() : rgba;
    if (illustration) for (let i = 0; i < W * H; i++) {
      const [r, g, b] = rgba.subarray(i * 4, i * 4 + 3);
      // Flood neutral shadows without leaking through a pale colored outline into the drawing.
      if (Math.max(r, g, b) - Math.min(r, g, b) > 25) background[i * 4] = background[i * 4 + 1] = background[i * 4 + 2] = 0;
    }
    const tolerance = illustration ? Math.max(o.backgroundTolerance, o.shadowTolerance * Math.sqrt(3)) : o.backgroundTolerance;
    const foreground = computeForeground({ data: background, width: W, height: H }, { removeBg: 'yes', tolerance });
    for (let i = 0; i < foreground.length; i++) if (!foreground[i]) rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255;
  }
  progress('Simplificando las zonas de color…');
  const r = processImage({ data: rgba, width: W, height: H }, {
    colors: o.colors, removeBg: 'no', minHoleMM: 0, upscale: false, trace: false,
    minWidth: o.minDetail > 0 ? o.minDetail * ppm : -1, minArea: Math.max(1, o.minArea * ppm * ppm),
  });
  let labels = Int16Array.from(r.comp, id => id < 0 ? -1 : r.pieces[id].cluster);
  for (let p = 0; p < o.smooth; p++) labels = modeFilter(labels, W, H, r.palette.length);
  const roots = r.palette.map((_, i) => i);
  const root = i => { while (roots[i] !== i) i = roots[i]; return i; };
  for (let a = 0; a < roots.length; a++) for (let b = 0; b < a; b++) {
    const ca = r.palette[a], cb = r.palette[b];
    if (Math.hypot(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b) <= o.contrast || (illustration && sameShade(ca, cb, o.shadowTolerance))) {
      // Assign each fringe once; never use it to join two already established colors.
      roots[root(a)] = root(b);
      if (illustration) break;
    }
  }
  const ink = new Uint8Array(W * H), linePx = o.lineWidth * ppm;
  const protectedRegions = new Uint8Array(r.pieces.length);
  if (o.keepInk) {
    const dark = r.palette.map(c => Math.max(c.r, c.g, c.b) < 85 && Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 35);
    const mask = Uint8Array.from(labels, c => c >= 0 && dark[c] ? 1 : 0);
    if (mask.includes(1)) {
      const { labels: ids, comps } = components(mask, W, H);
      const distance = edt(Uint8Array.from(mask, v => 1 - v), W, H), thick = new Uint32Array(comps.length);
      for (let i = 0; i < mask.length; i++) if (ids[i] >= 0 && distance[i] > Math.max(3, linePx * (illustration ? 3 : 2))) thick[ids[i]]++;
      // A few wider intersections must not turn an otherwise thin ink network into double contours.
      const narrow = comps.map((c, i) => thick[i] <= c.area * 0.05 && (!illustration || c.area >= o.minArea * ppm * ppm));
      for (let i = 0; i < mask.length; i++) ink[i] = ids[i] >= 0 && narrow[ids[i]] ? 1 : 0;
    }
    if (illustration) {
      const bands = coloredStrokes(r, W, H, Math.max(3, linePx * 3));
      for (let i = 0; i < ink.length; i++) if (bands[i]) ink[i] = 1;
      const overlap = new Uint32Array(r.pieces.length);
      for (let i = 0; i < ink.length; i++) if (ink[i] && r.comp[i] >= 0) overlap[r.comp[i]]++;
      for (const piece of r.pieces) if (dark[piece.cluster] && overlap[piece.id] >= piece.area * 0.25) protectedRegions[piece.id] = 1;
    }
  }
  progress('Dibujando contornos negros…');
  const edge = ink.includes(1) ? thinInk(ink, W, H) : ink.slice();
  const protectedInk = illustration ? dilate(Uint8Array.from(ink, (v, i) => v || protectedRegions[r.comp[i]] ? 1 : 0), W, H, Math.max(1, ppm * 0.18)) : ink;
  const different = (i, j) => !protectedInk[i] && !protectedInk[j] && labels[i] >= 0 && labels[j] >= 0 && root(labels[i]) !== root(labels[j]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if ((x + 1 < W && different(i, i + 1)) || (y + 1 < H && different(i, i + W))) edge[i] = 1;
  }
  const mask = dilate(edge, W, H, Math.max(0, linePx / 2));
  const pixels = countOn(mask);
  if (!pixels) throw new Error('No se encontraron contornos. Reduce la limpieza o usa una imagen con formas y colores diferentes.');
  return { width: W, height: H, mask, colors: r.palette.length, pixels };
}

export function validateColoringEdits(edits) {
  if (!Array.isArray(edits) || edits.length > 2000) throw new Error('El proyecto contiene demasiadas ediciones o una lista inválida.');
  let points = 0;
  for (const e of edits) {
    if (!e || !['erase', 'draw', 'rect'].includes(e.kind) || !Array.isArray(e.points) || !e.points.length) throw new Error('Edición de coloreado inválida.');
    if (e.kind === 'rect' ? e.points.length !== 2 : !Number.isFinite(e.width) || e.width <= 0 || e.width > 2) throw new Error('Tamaño de edición inválido.');
    points += e.points.length;
    for (const p of e.points) if (!Array.isArray(p) || p.length !== 2 || !p.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('Coordenadas de edición inválidas.');
  }
  if (points > 100000) throw new Error('El proyecto supera 100000 puntos de edición.');
}

export function applyColoringEdit(mask, W, H, edit) {
  validateColoringEdits([edit]);
  const points = edit.points.map(([x, y]) => [x * W, y * H]);
  if (edit.kind === 'rect') {
    const [[ax, ay], [bx, by]] = points;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by))); y < Math.min(H, Math.ceil(Math.max(ay, by))); y++) {
      mask.fill(0, y * W + Math.max(0, Math.floor(Math.min(ax, bx))), y * W + Math.min(W, Math.ceil(Math.max(ax, bx))));
    }
  } else {
    const radius = edit.width * Math.max(W, H) / 2, value = edit.kind === 'draw' ? 1 : 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)], b = points[i];
      fillCapsule(mask, W, H, a[0], a[1], b[0], b[1], radius, value);
    }
  }
}

export function applyColoringEdits(result, edits) {
  validateColoringEdits(edits);
  const mask = result.mask.slice();
  for (const edit of edits) applyColoringEdit(mask, result.width, result.height, edit);
  return mask;
}

function curveLoop(loop, radius, linePx) {
  const lengths = loop.map((a, i) => {
    const b = loop[(i + 1) % loop.length];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
  const perimeter = lengths.reduce((sum, v) => sum + v, 0);
  const count = Math.max(12, Math.ceil(perimeter)), step = perimeter / count, points = [];
  let index = 0, start = 0;
  for (let i = 0; i < count; i++) {
    const distance = i * step;
    while (index < loop.length - 1 && start + lengths[index] < distance) start += lengths[index++];
    const a = loop[index], b = loop[(index + 1) % loop.length], t = (distance - start) / (lengths[index] || 1);
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  // Arc-length sampling avoids stair steps; size and area/perimeter caps protect tiny or narrow loops.
  const reach = Math.min(radius, perimeter / 32, Math.abs(signedArea(loop)) / perimeter);
  const smooth = smoothLoop(points, reach / step);
  const curves = fitClosed(smooth, { tol: Math.max(0.02, Math.min(reach / 4, linePx / 5)), cornerDeg: 180 });
  if (!curves.length) throw new Error('No se pudo ajustar un contorno a curvas.');
  return curves;
}

export function coloringShapes(mask, W, H, input = {}) {
  const o = coloringOptions(input), shapes = traceMask(mask, W, H, 0.3, 1);
  if (!o.curveSmooth) return shapes;
  const ppm = 1 / coloringLayout(W, H, o).scale;
  return shapes.map(s => ({ ...s, curves: [s.outer, ...s.holes].map(loop => curveLoop(loop, o.curveSmooth * ppm, o.lineWidth * ppm)) }));
}

const fmt = n => String(Math.round(n * 10000) / 10000);
export function coloringPathData(shapes, transform = p => p) {
  return shapes.flatMap(s => s.curves
    ? s.curves.map(loop => cubicsToPath(loop.map(c => c.map(transform)), fmt))
    : [s.outer, ...s.holes].map(loop => 'M' + loop.map(p => transform(p).map(fmt).join(' ')).join(' L') + ' Z')).join(' ');
}

export function coloringSVG(shapes, W, H, input) {
  const o = coloringOptions(input), l = coloringLayout(W, H, o);
  // Trace grouping can attach an island's holes to a containing outline; fill all loops together.
  const d = coloringPathData(shapes, ([x, y]) => [l.x + x * l.scale, l.y + y * l.scale]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(o.pageWidth)}mm" height="${fmt(o.pageHeight)}mm" viewBox="0 0 ${fmt(o.pageWidth)} ${fmt(o.pageHeight)}"><rect width="100%" height="100%" fill="#FFFFFF"/>\n<path d="${d}" fill="#000000" fill-rule="evenodd"/>\n</svg>`;
}

// A vector-only PDF needs no fonts, image encoder or external service.
export function coloringPDF(shapes, W, H, input) {
  const o = coloringOptions(input), l = coloringLayout(W, H, o), pt = 72 / 25.4;
  const pw = o.pageWidth * pt, ph = o.pageHeight * pt;
  const content = [`1 g 0 0 ${fmt(pw)} ${fmt(ph)} re f\n0 g\n`];
  const point = ([x, y]) => `${fmt((l.x + x * l.scale) * pt)} ${fmt(ph - (l.y + y * l.scale) * pt)}`;
  for (const s of shapes) {
    if (s.curves) {
      for (const loop of s.curves) {
        content.push(point(loop[0][0]) + ' m\n');
        for (const c of loop) content.push(c.slice(1).map(point).join(' ') + ' c\n');
        content.push('h\n');
      }
      continue;
    }
    for (const loop of [s.outer, ...s.holes]) {
      loop.forEach((p, i) => content.push(`${point(p)} ${i ? 'l' : 'm'}\n`));
      content.push('h\n');
    }
  }
  content.push('f*\n');
  const stream = content.join('');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pw)} ${fmt(ph)}] /Resources << >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = '%PDF-1.4\n', offsets = [0];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export function coloringPngDPI(png, dpi) {
  if (!Number.isFinite(dpi) || dpi < 72 || dpi > 300 || png.length < 33 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => png[i] === v)) throw new Error('PNG o resolución inválidos.');
  const chunk = new Uint8Array(21), view = new DataView(chunk.buffer);
  view.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4);
  view.setUint32(8, Math.round(dpi / 0.0254)); view.setUint32(12, Math.round(dpi / 0.0254)); chunk[16] = 1;
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 17)) {
    crc ^= byte;
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(17, (crc ^ 0xffffffff) >>> 0);
  const parts = [png.subarray(0, 8)], source = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let i = 8; i < png.length;) {
    if (i + 12 > png.length) throw new Error('PNG incompleto.');
    const length = source.getUint32(i), end = i + length + 12;
    if (end > png.length) throw new Error('Bloque PNG incompleto.');
    const type = String.fromCharCode(...png.subarray(i + 4, i + 8));
    if (type !== 'pHYs') parts.push(png.subarray(i, end));
    if (type === 'IHDR') parts.push(chunk);
    i = end;
  }
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

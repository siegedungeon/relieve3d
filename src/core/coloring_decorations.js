import { mulberry32 } from './processing.js';
import { shapePolygon, dilate, fillPolygon, fillCapsule } from './raster.js';
import { fitClosed, cubicsToPath } from './curvefit.js';

export const DECORATION_THEMES = Object.freeze({
  nature: 'Flores, plantas y estrellas', space: 'Estrellas, luna y espacio',
  fantasy: 'Corazones y mariposas', mixed: 'Mixto infantil',
});
export const DECORATION_ASSETS = Object.freeze({
  bouquet: { name: 'Ramo floral', aspect: [0.72, 1] }, sprig: { name: 'Ramita', aspect: [0.62, 1] },
  flower: { name: 'Flor', aspect: [1, 1] }, star: { name: 'Estrella', aspect: [1, 1] },
  moon: { name: 'Luna', aspect: [0.85, 1] }, planet: { name: 'Planeta', aspect: [1, 0.8] },
  butterfly: { name: 'Mariposa', aspect: [1, 0.9] }, heart: { name: 'Corazón', aspect: [1, 1] },
  bubble: { name: 'Círculo', aspect: [1, 1] },
});
const fmt = n => String(Math.round(n * 10000) / 10000);
const uint = n => Number.isInteger(n) && n >= 0 && n <= 4294967295;
const paper = o => ({ w: o.pageWidth - 2 * o.margin, h: o.pageHeight - 2 * o.margin, unit: Math.min(o.pageWidth, o.pageHeight) - 2 * o.margin });
const line = (a, b) => [a, a.map((v, i) => v + (b[i] - v) / 3), a.map((v, i) => v + (b[i] - v) * 2 / 3), b];

export function validateDecorations(value) {
  if (value === undefined) return { seed: 0, items: null };
  if (!value || !uint(value.seed) || (value.items !== null && (!Array.isArray(value.items) || value.items.length > 80))) throw new Error('Composición de adornos inválida.');
  const ids = new Set();
  const items = value.items?.map(p => {
    if (!p || !Number.isInteger(p.id) || p.id < 1 || p.id > 1000000 || ids.has(p.id) ||
      !Object.hasOwn(DECORATION_ASSETS, p.kind) || !uint(p.variant) ||
      ![p.x, p.y, p.size, p.angle].every(Number.isFinite) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 ||
      p.size < 0.01 || p.size > 0.4 || p.angle < -180 || p.angle > 180) throw new Error('Posición, tamaño o recurso del adorno inválidos.');
    ids.add(p.id);
    return { id: p.id, kind: p.kind, variant: p.variant, x: p.x, y: p.y, size: p.size, angle: p.angle };
  }) ?? null;
  return { seed: value.seed, items };
}

// Original parametric line art: no external clip-art files or image services.
function assetPaths(kind, seed) {
  const paths = [], rnd = mulberry32(seed);
  const add = (curves, fill = true, closed = true, weight = 1) => paths.push({ curves, fill, closed, weight });
  const ellipse = (x, y, rx, ry = rx) => {
    const k = 0.5522847498307936;
    add([
      [[x + rx, y], [x + rx, y + ry * k], [x + rx * k, y + ry], [x, y + ry]],
      [[x, y + ry], [x - rx * k, y + ry], [x - rx, y + ry * k], [x - rx, y]],
      [[x - rx, y], [x - rx, y - ry * k], [x - rx * k, y - ry], [x, y - ry]],
      [[x, y - ry], [x + rx * k, y - ry], [x + rx, y - ry * k], [x + rx, y]],
    ]);
  };
  const leaf = (a, b, width) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
    const at = (t, s) => [a[0] + dx * t - dy / d * s, a[1] + dy * t + dx / d * s];
    add([[a, at(0.25, width), at(0.7, width), b], [b, at(0.72, -width), at(0.18, -width), a]]);
    add([line(a, at(0.86, 0))], false, false, 0.7);
  };
  const flower = (x, y, radius, petals) => {
    const pts = Array.from({ length: petals * 24 }, (_, i) => {
      const a = i / (petals * 24) * Math.PI * 2, r = radius * (0.76 + 0.24 * Math.cos(petals * a));
      return [x + r * Math.cos(a), y + r * Math.sin(a)];
    });
    add(fitClosed(pts, { tol: 0.12, cornerDeg: 180 }));
    ellipse(x, y, radius * 0.24);
  };
  if (kind === 'bouquet' || kind === 'sprig') {
    const sway = rnd() * 12 - 6;
    add([[[50, 96], [35 + sway, 68], [63 + sway, 36], [49, 7]]], false, false);
    for (let i = 0; i < 5; i++) {
      const y = 81 - i * 14, right = i % 2, x = 49 + Math.sin(i) * 4;
      leaf([x, y], [right ? 85 + rnd() * 10 : 5 + rnd() * 12, y - 13 - rnd() * 12], 8 + rnd() * 3);
    }
    if (kind === 'bouquet') {
      ellipse(72, 41, 6); ellipse(84, 46, 6); ellipse(76, 54, 6);
      flower(43, 78, 22, 5 + seed % 3);
    } else ellipse(49, 7, 4);
  } else if (kind === 'flower') flower(50, 50, 43, 5 + seed % 3);
  else if (kind === 'star' || kind === 'heart') {
    const pts = shapePolygon(kind, 50, 50, 88, 88, { points: 5, inner: 0.5 + rnd() * 0.09, round: 0.16 });
    add(fitClosed(pts, { tol: 0.12, cornerDeg: 180 }));
  } else if (kind === 'bubble') ellipse(50, 50, 40);
  else if (kind === 'moon') {
    add([[[70, 8], [10, -1], [0, 80], [49, 93]], [[49, 93], [63, 97], [76, 89], [83, 79]], [[83, 79], [28, 83], [22, 38], [70, 8]]]);
  } else if (kind === 'planet') {
    ellipse(50, 50, 46, 15);
    ellipse(50, 46, 27);
    add([[[4, 50], [22, 79], [81, 65], [96, 50]]], false, false);
    add([[[31, 37], [36, 28], [44, 26], [49, 26]]], false, false, 0.7);
  } else if (kind === 'butterfly') {
    for (const side of [-1, 1]) {
      const p = (x, y) => [50 + side * x, y];
      add([[p(0, 47), p(19, 2), p(52, 5), p(44, 40)], [p(44, 40), p(44, 51), p(33, 56), p(25, 56)],
        [p(25, 56), p(46, 67), p(36, 96), p(16, 85)], [p(16, 85), p(4, 77), p(2, 59), p(0, 47)]]);
      add([[p(0, 32), p(5, 17), p(13, 15), p(16, 17)]], false, false, 0.7);
    }
    ellipse(50, 60, 5, 26); ellipse(50, 31, 7);
  } else throw new Error('Recurso para colorear desconocido.');
  const pts = paths.flatMap(p => p.curves.flat()), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), [ax, ay] = DECORATION_ASSETS[kind].aspect;
  return paths.map(p => ({ ...p, curves: p.curves.map(c => c.map(([x, y]) => [(x - (x0 + x1) / 2) / (x1 - x0) * ax, (y - (y0 + y1) / 2) / (y1 - y0) * ay])) }));
}

function extent(item, o) {
  const { unit } = paper(o), [x, y] = DECORATION_ASSETS[item.kind].aspect;
  const angle = item.angle * Math.PI / 180, c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  return [(x * c + y * s) * item.size * unit / 2 + o.lineWidth / 2, (y * c + x * s) * item.size * unit / 2 + o.lineWidth / 2];
}
export function decorationBounds(item, o) {
  const { w, h } = paper(o), [rx, ry] = extent(item, o), x = o.margin + item.x * w, y = o.margin + item.y * h;
  return { x0: x - rx, y0: y - ry, x1: x + rx, y1: y + ry };
}
export function fitDecoration(item, o) {
  const { w, h } = paper(o), [rx, ry] = extent(item, o);
  if (rx * 2 > w || ry * 2 > h) throw new Error('El adorno no cabe entre los márgenes. Reduce su tamaño.');
  return { ...item, x: Math.max(rx / w, Math.min(1 - rx / w, item.x)), y: Math.max(ry / h, Math.min(1 - ry / h, item.y)) };
}
function placedPaths(item, o, center) {
  const size = item.size * paper(o).unit, a = item.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return assetPaths(item.kind, item.variant).map(p => ({
    closed: p.closed, fill: p.fill, strokeWidth: p.weight * o.lineWidth,
    curves: p.curves.map(curve => curve.map(([x, y]) => [center[0] + (x * c - y * s) * size, center[1] + (x * s + y * c) * size])),
  }));
}
export function decorationScene(model, o) {
  const { items } = validateDecorations(model), { w, h } = paper(o);
  if (!o.decorate || !items) return [];
  return items.map(original => {
    const item = fitDecoration(original, o);
    return { id: item.id, kind: item.kind, bounds: decorationBounds(item, o),
      paths: placedPaths(item, o, [o.margin + item.x * w, o.margin + item.y * h]) };
  });
}
export function decorationPathData(path) {
  const d = cubicsToPath(path.curves, fmt);
  return path.closed ? d : d.slice(0, -2);
}
export function decorationSVG(scene) {
  return scene.map(item => `<g data-decoration="${item.id}" stroke="#000000" stroke-linecap="round" stroke-linejoin="round">${item.paths.map(p =>
    `<path d="${decorationPathData(p)}" fill="${p.fill ? '#FFFFFF' : 'none'}" stroke-width="${fmt(p.strokeWidth)}"/>`).join('')}</g>`).join('\n');
}
export function decorationPDF(scene, pageHeight) {
  const pt = 72 / 25.4, point = p => `${fmt(p[0] * pt)} ${fmt((pageHeight - p[1]) * pt)}`;
  let text = 'q 0 G 1 J 1 j\n';
  for (const item of scene) for (const p of item.paths) {
    text += `1 g ${point(p.curves[0][0])} m\n`;
    for (const c of p.curves) text += c.slice(1).map(point).join(' ') + ' c\n';
    if (p.closed) text += 'h\n';
    text += `${fmt(p.strokeWidth * pt)} w ${p.fill ? 'B' : 'S'}\n`;
  }
  return text + 'Q\n';
}
export function decorationIcon(kind) {
  const paths = assetPaths(kind, 21).map(p => ({ ...p, strokeWidth: 0.026 * p.weight }));
  return `<svg viewBox="-0.56 -0.56 1.12 1.12" aria-hidden="true">${decorationSVG([{ id: 0, paths }])}</svg>`;
}

function sample(c, t) {
  const s = 1 - t;
  return [0, 1].map(k => s ** 3 * c[0][k] + 3 * s * s * t * c[1][k] + 3 * s * t * t * c[2][k] + t ** 3 * c[3][k]);
}
function footprint(item, o, scale) {
  const [rx, ry] = extent(item, o), pad = 1.2;
  const ox = Math.floor((-rx - pad) * scale), oy = Math.floor((-ry - pad) * scale);
  const W = Math.ceil((rx + pad) * scale) - ox + 1, H = Math.ceil((ry + pad) * scale) - oy + 1, mask = new Uint8Array(W * H);
  for (const p of placedPaths(item, o, [0, 0])) {
    const points = p.curves.flatMap(c => Array.from({ length: 17 }, (_, i) => sample(c, i / 16).map((v, k) => v * scale - (k ? oy : ox))));
    if (p.fill) fillPolygon(mask, W, H, points);
    for (let i = 1; i < points.length; i++) fillCapsule(mask, W, H, ...points[i - 1], ...points[i], (p.strokeWidth / 2 + pad) * scale);
  }
  const pixels = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) pixels.push([i % W + ox, Math.floor(i / W) + oy]);
  return { pixels, rx: rx * scale, ry: ry * scale };
}

export function createDecorations(result, layout, o, seed) {
  validateDecorations({ seed, items: [] });
  if (!o.decorate) return { items: [], warnings: [] };
  const rnd = mulberry32(seed), scale = 384 / Math.max(o.pageWidth, o.pageHeight);
  const W = Math.ceil(o.pageWidth * scale), H = Math.ceil(o.pageHeight * scale), protectedInk = new Uint8Array(W * H);
  // Reserve each source row's silhouette, including open contours and the blank center of a sign.
  for (let y = 0; y < result.height; y++) {
    let left = result.width, right = -1;
    for (let x = 0; x < result.width; x++) if (result.mask[y * result.width + x]) { left = Math.min(left, x); right = x; }
    if (right < 0) continue;
    const x0 = Math.max(0, Math.floor((layout.x + left * layout.scale) * scale));
    const x1 = Math.min(W, Math.ceil((layout.x + (right + 1) * layout.scale) * scale));
    const y0 = Math.max(0, Math.floor((layout.y + y * layout.scale) * scale));
    const y1 = Math.min(H, Math.ceil((layout.y + (y + 1) * layout.scale) * scale));
    for (let py = y0; py < y1; py++) protectedInk.fill(1, py * W + x0, py * W + x1);
  }
  const reserved = dilate(protectedInk, W, H, scale), occupied = reserved.slice();
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let i = 0; i < reserved.length; i++) if (reserved[i]) {
    const x = i % W, y = Math.floor(i / W); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 < 0) throw new Error('Genera primero un dibujo con contornos para colocar los adornos.');
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, box = paper(o);
  const theme = o.decorTheme === 'mixed' ? ['nature', 'space', 'fantasy'][Math.floor(rnd() * 3)] : o.decorTheme;
  const primary = theme === 'space' ? ['planet', 'moon'] : theme === 'fantasy' ? ['butterfly', 'bouquet'] : ['bouquet', rnd() < 0.7 ? 'bouquet' : 'sprig'];
  const extras = o.decorTheme === 'mixed' ? ['star', 'flower', 'butterfly', 'heart', 'moon', 'bubble'] :
    theme === 'space' ? ['star', 'star', 'bubble', 'moon'] : theme === 'fantasy' ? ['heart', 'star', 'butterfly', 'bubble'] : ['star', 'star', 'flower', 'bubble'];
  const items = [];
  for (let i = 0; i < o.decorCount; i++) {
    const kind = i < 2 ? primary[i] : i === 2 ? 'star' : extras[Math.floor(rnd() * extras.length)];
    const size = i < 2 ? 0.21 + rnd() * 0.035 : kind === 'bubble' ? 0.017 + rnd() * 0.01 : 0.045 + rnd() * 0.025;
    const proto = { id: i + 1, kind, variant: Math.floor(rnd() * 4294967296), x: 0.5, y: 0.5, size, angle: rnd() * 36 - 18 };
    let found = null;
    for (const shrink of [1, 0.86, 0.72]) {
      const item = { ...proto, size: Math.max(0.01, size * shrink) }, fp = footprint(item, o, scale);
      for (let attempt = 0; attempt < 100; attempt++) {
        let gx, gy;
        if (i < 2) {
          gy = y0 + (y1 - y0) * (0.56 + rnd() * 0.28);
          let edge = i === 0 ? W : 0;
          for (let y = Math.max(0, Math.floor(gy - fp.ry)); y <= Math.min(H - 1, Math.ceil(gy + fp.ry)); y++) {
            for (let x = 0; x < W; x++) if (reserved[y * W + x]) edge = i === 0 ? Math.min(edge, x) : Math.max(edge, x);
          }
          gx = edge + (i === 0 ? -1 : 1) * (fp.rx + 2 + rnd() * 3);
        } else {
          const a = rnd() * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
          let last = 0;
          for (let r = 0; r < Math.hypot(W, H); r += 1) {
            const x = Math.round(cx + ux * r), y = Math.round(cy + uy * r);
            if (x < 0 || y < 0 || x >= W || y >= H) break;
            if (reserved[y * W + x]) last = r;
          }
          const r = last + Math.max(fp.rx, fp.ry) + 2 + rnd() * 7;
          gx = cx + ux * r; gy = cy + uy * r;
        }
        const p = fitDecoration({ ...item, x: (gx / scale - o.margin) / box.w, y: (gy / scale - o.margin) / box.h }, o);
        gx = Math.round((o.margin + p.x * box.w) * scale); gy = Math.round((o.margin + p.y * box.h) * scale);
        if (fp.pixels.some(([x, y]) => x + gx < 0 || x + gx >= W || y + gy < 0 || y + gy >= H || occupied[(y + gy) * W + x + gx])) continue;
        for (const [x, y] of fp.pixels) occupied[(y + gy) * W + x + gx] = 1;
        found = p; break;
      }
      if (found) break;
    }
    if (found) items.push(found);
  }
  if (!items.length) throw new Error('No hay espacio para los adornos. Amplía la página o reduce el grosor.');
  return { items, warnings: items.length < o.decorCount ? [`Caben ${items.length} de ${o.decorCount} adornos sin tapar el dibujo. Reduce la densidad o amplía la página.`] : [] };
}

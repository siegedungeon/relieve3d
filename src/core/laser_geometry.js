export const LASER_TOLERANCE = 0.02;
export const LASER_DEFAULTS = { width: 480, height: 400, gap: 1, margin: 1, angleStep: 15, seconds: 30, mode: 'fill', balanced: true };
const sq = x => x * x;
export const area = loop => Math.abs(loop.reduce((sum, p, i) => { const q = loop[(i + 1) % loop.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
export function bounds(loops) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const loop of loops) for (const [x, y] of loop) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
export function transformLoops(loops, { x = 0, y = 0, angle = 0 }) {
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return loops.map(loop => loop.map(([px, py]) => [px * c - py * s + x, px * s + py * c + y]));
}
export function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export function segmentDistance(a, b, c, d) {
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}
export function inside(point, loop) {
  let result = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if (pointSegmentDistance(point, a, b) < 1e-8) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}
export function coveredPolyline(points, loops) {
  const covered = point => loops.some(loop => inside(point, loop));
  if (!points.every(covered)) return false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], rx = b[0] - a[0], ry = b[1] - a[1], cuts = [0, 1];
    for (const loop of loops) for (let j = 0; j < loop.length; j++) {
      const c = loop[j], d = loop[(j + 1) % loop.length], sx = d[0] - c[0], sy = d[1] - c[1];
      const denominator = rx * sy - ry * sx;
      if (Math.abs(denominator) < 1e-12) continue;
      const dx = c[0] - a[0], dy = c[1] - a[1];
      const t = (dx * sy - dy * sx) / denominator, u = (dx * ry - dy * rx) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((a, b) => a - b);
    for (let j = 1; j < cuts.length; j++) {
      const t = (cuts[j - 1] + cuts[j]) / 2;
      if (!covered([a[0] + rx * t, a[1] + ry * t])) return false;
    }
  }
  return true;
}
export function assertSimple(loop) {
  if (loop.length < 3 || area(loop) < 0.0001) throw new Error('Contorno cerrado sin superficie.');
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    if (![...a, ...b].every(Number.isFinite)) throw new Error('Coordenadas no finitas.');
    for (let j = i + 2; j < loop.length; j++) {
      if (i === 0 && j === loop.length - 1) continue;
      const c = loop[j], d = loop[(j + 1) % loop.length];
      if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
          Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) continue;
      if (segmentDistance(a, b, c, d) < 1e-8) throw new Error('Contorno que se cruza o se toca a si mismo; revisa el SVG.');
    }
  }
}
function boxDistance(a, b) {
  return Math.sqrt(sq(Math.max(0, a.minX - b.maxX, b.minX - a.maxX)) + sq(Math.max(0, a.minY - b.maxY, b.minY - a.maxY)));
}
function tree(segments) {
  const b = bounds(segments.flatMap(s => [s]));
  if (segments.length <= 8) return { ...b, segments };
  const axis = b.width >= b.height ? 0 : 1;
  segments.sort((a, c) => a[0][axis] + a[1][axis] - c[0][axis] - c[1][axis]);
  const mid = Math.floor(segments.length / 2);
  return { ...b, left: tree(segments.slice(0, mid)), right: tree(segments.slice(mid)) };
}
export function geometry(loops, padding = 0) {
  const segments = loops.flatMap(loop => loop.map((p, i) => [p, loop[(i + 1) % loop.length]]));
  return { loops, padding, box: bounds(loops), tree: tree(segments) };
}
export function distance(a, b, limit = Infinity) {
  let best = limit + a.padding + b.padding;
  if (boxDistance(a.box, b.box) > best) return limit;
  if (a.loops.some(loop => b.loops.some(other => inside(loop[0], other))) ||
      b.loops.some(loop => a.loops.some(other => inside(loop[0], other)))) return 0 - a.padding - b.padding;
  const visit = (u, v) => {
    if (boxDistance(u, v) >= best) return;
    if (u.segments && v.segments) {
      for (const [p, q] of u.segments) for (const [r, s] of v.segments) {
        best = Math.min(best, segmentDistance(p, q, r, s));
        if (best === 0) return;
      }
    } else {
      const pairs = !u.segments && (v.segments || u.width + u.height > v.width + v.height)
        ? [[u.left, v], [u.right, v]] : [[u, v.left], [u, v.right]];
      pairs.sort((x, y) => boxDistance(...x) - boxDistance(...y));
      for (const pair of pairs) visit(...pair);
    }
  };
  visit(a.tree, b.tree);
  return best - a.padding - b.padding;
}
export function validateConfig(input) {
  const c = { ...LASER_DEFAULTS, ...input };
  for (const k of ['width', 'height', 'gap', 'margin', 'angleStep', 'seconds']) {
    if (!Number.isFinite(c[k])) throw new Error(`Valor invalido: ${k}`);
  }
  if (c.width < 5 || c.height < 5 || c.width > 3000 || c.height > 3000) throw new Error('La lamina debe medir entre 5 y 3000 mm por lado.');
  if (c.gap < 0.1 || c.margin < 0.1 || c.margin * 2 >= Math.min(c.width, c.height)) throw new Error('Separacion y margen deben ser al menos 0.1 mm y dejar espacio util.');
  if (![5, 10, 15, 30, 45, 90, 180, 360].includes(c.angleStep)) throw new Error('Paso angular no soportado.');
  if (c.seconds < 1 || c.seconds > 300) throw new Error('El tiempo debe estar entre 1 y 300 segundos.');
  if (!['fill', 'exact'].includes(c.mode) || typeof c.balanced !== 'boolean') throw new Error('Modo de distribucion invalido.');
  return c;
}
export function validateTemplates(templates) {
  const ids = new Set();
  if (!templates.length || templates.length > 100) throw new Error('Selecciona entre 1 y 100 piezas.');
  for (const t of templates) {
    if (typeof t.id !== 'string' || !t.id || ids.has(t.id)) throw new Error('Identificador de pieza duplicado.');
    ids.add(t.id);
    if (!['figure', 'complement'].includes(t.role)) throw new Error('Tipo de pieza invalido.');
    if (typeof t.enabled !== 'boolean') throw new Error('Seleccion de pieza invalida.');
    if (!Number.isInteger(t.quantity) || t.quantity < 0 || t.quantity > 500) throw new Error('La cantidad debe ser un entero entre 0 y 500.');
    if (!Number.isInteger(t.ratio) || t.ratio < 1 || t.ratio > 20) throw new Error('La proporcion debe ser un entero entre 1 y 20.');
    if (!Number.isFinite(t.padding) || t.padding < 0 || !t.loops?.length) throw new Error('Geometria de pieza invalida.');
  }
  for (const t of templates) if (t.role === 'figure' && t.complementId && !templates.some(o => o.id === t.complementId && o.role === 'complement' && o.enabled)) throw new Error(`Selecciona un complemento activo para ${t.name}.`);
  if (!templates.some(t => t.role === 'figure' && t.enabled)) throw new Error('Selecciona al menos una figura.');
}
export function validateLayout(templates, placements, input) {
  const config = validateConfig(input);
  validateTemplates(templates);
  const byId = new Map(templates.map(t => [t.id, t])), counts = Object.fromEntries(templates.map(t => [t.id, 0]));
  const issues = [], shapes = [], ids = new Set();
  let minGap = Infinity, minMargin = Infinity, pairs = 0;
  if (placements.length > 1000) throw new Error('La distribucion excede el limite de 1000 piezas.');
  for (const p of placements) {
    const t = byId.get(p.templateId);
    if (!t || !t.enabled || !p.id || ids.has(p.id) || ![p.x, p.y, p.angle].every(Number.isFinite)) throw new Error('Posicion o identificador de pieza invalido.');
    ids.add(p.id); counts[t.id]++;
    const g = geometry(transformLoops(t.loops, p), t.padding + LASER_TOLERANCE);
    const margin = Math.min(g.box.minX, g.box.minY, config.width - g.box.maxX, config.height - g.box.maxY) - g.padding;
    minMargin = Math.min(minMargin, margin);
    if (margin + 1e-7 < config.margin) issues.push({ ids: [p.id], message: `${t.name}: fuera del margen.` });
    shapes.push(g);
  }
  for (let i = 0; i < shapes.length; i++) for (let j = 0; j < i; j++) {
    pairs++;
    const d = distance(shapes[i], shapes[j], Math.max(config.gap + 0.001, minGap));
    minGap = Math.min(minGap, d);
    if (d + 1e-7 < config.gap) issues.push({ ids: [placements[i].id, placements[j].id], message: 'Piezas en contacto, solapadas o demasiado proximas.' });
  }
  const required = Object.fromEntries(templates.filter(t => t.role === 'complement').map(t => [t.id, 0]));
  for (const t of templates) if (t.role === 'figure' && t.enabled && t.complementId) required[t.complementId] += counts[t.id] * t.ratio;
  for (const [id, n] of Object.entries(required)) if (counts[id] !== n) issues.push({ ids: placements.filter(p => p.templateId === id).map(p => p.id), message: `${byId.get(id).name}: hacen falta exactamente ${n} complementos, hay ${counts[id]}.` });
  const figures = templates.filter(t => t.enabled && t.role === 'figure');
  const values = figures.map(t => counts[t.id]);
  if (config.mode === 'fill' && config.balanced && Math.max(...values) - Math.min(...values) > 1) issues.push({ ids: [], message: 'Las cantidades de figuras no estan equilibradas.' });
  const pending = figures.map(t => ({ id: t.id, name: t.name, count: Math.max(0, t.quantity - counts[t.id]) }));
  if (config.mode === 'exact') for (const t of figures) if (counts[t.id] > t.quantity) issues.push({ ids: [], message: `${t.name}: cantidad superior a la solicitada.` });
  return { valid: issues.length === 0 && placements.length > 0, issues, counts, pending,
    figures: values.reduce((a, b) => a + b, 0), complements: Object.values(required).reduce((a, b) => a + b, 0),
    minGap: Number.isFinite(minGap) ? minGap : null, minMargin: Number.isFinite(minMargin) ? minMargin : null, pairs };
}

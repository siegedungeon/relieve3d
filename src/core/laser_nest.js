import { dilate } from './raster.js';
import { bounds, transformLoops, validateConfig, validateTemplates, validateLayout, LASER_TOLERANCE, area } from './laser_geometry.js';

function raster(loops, cell, clearance) {
  const bb = bounds(loops), pad = Math.ceil(clearance / cell) + 2;
  const w = Math.ceil(bb.width / cell) + 2 * pad + 1, h = Math.ceil(bb.height / cell) + 2 * pad + 1;
  const mask = new Uint8Array(w * h);
  const paths = loops.map(loop => loop.map(([x, y]) => [(x - bb.minX) / cell + pad, (y - bb.minY) / cell + pad]));
  for (const loop of paths) {
    for (let y = 0; y < h; y++) {
      const xs = [];
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i], b = loop[j], sy = y + 0.5;
        if ((a[1] > sy) !== (b[1] > sy)) xs.push(a[0] + (sy - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const first = Math.max(0, Math.ceil(xs[i] - 0.5)), last = Math.min(w - 1, Math.floor(xs[i + 1] - 0.5));
        mask.fill(1, y * w + first, y * w + last + 1);
      }
    }
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2);
      for (let j = 0; j <= n; j++) {
        const t = n ? j / n : 0, x = Math.floor(a[0] + t * (b[0] - a[0])), y = Math.floor(a[1] + t * (b[1] - a[1]));
        mask[y * w + x] = 1;
      }
    }
  }
  const grown = dilate(mask, w, h, clearance / cell), runs = [];
  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      if (x < w && grown[y * w + x]) { if (start < 0) start = x; }
      else if (start >= 0) { runs.push([y, start, x]); start = -1; }
    }
  }
  const minX = Math.min(...runs.map(r => r[1])), maxX = Math.max(...runs.map(r => r[2]));
  const minY = Math.min(...runs.map(r => r[0])), maxY = Math.max(...runs.map(r => r[0]));
  return { w: maxX - minX, h: maxY - minY + 1,
    runs: runs.map(([y, a, b]) => [y - minY, a - minX, b - minX]).sort((a, b) => b[2] - b[1] - a[2] + a[1]),
    dx: (minX - pad) * cell + bb.minX, dy: (minY - pad) * cell + bb.minY };
}
const randomGenerator = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const shuffle = (array, random) => {
  for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; }
  return array;
};
const pause = () => new Promise(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
  channel.port2.postMessage(null);
});

export async function optimizeLaser(templates, input, { onProgress = () => {}, cancelled = () => false, seed = 431, maxTrials = Infinity } = {}) {
  const config = validateConfig(input); validateTemplates(templates);
  const active = templates.filter(t => t.enabled), figures = active.filter(t => t.role === 'figure');
  const cell = Math.max(0.6, Math.max(config.width, config.height) / 650);
  const w = Math.floor(config.width / cell), h = Math.floor(config.height / cell), stride = w + 1;
  const margin = Math.ceil(config.margin / cell), startTime = Date.now();
  let deadline = Infinity;
  const cache = new Map(), byId = new Map(active.map(t => [t.id, t]));
  const expired = () => cancelled() || Date.now() >= deadline;
  for (const t of active) {
    const ors = [], clearance = config.gap / 2 + t.padding + LASER_TOLERANCE + cell * 0.35;
    for (let angle = 0; angle < 360; angle += config.angleStep) {
      const loops = transformLoops(t.loops, { angle }), bb = bounds(loops);
      if (bb.width + 2 * clearance < config.width && bb.height + 2 * clearance < config.height) {
        ors.push({ ...raster(loops, cell, clearance), angle });
      }
      if (angle % 90 === 0) { await pause(); if (cancelled()) return { placements: [], cancelled: true, trials: 0 }; }
    }
    cache.set(t.id, ors);
    onProgress({ phase: 'preparing', name: t.name, elapsed: (Date.now() - startTime) / 1000 });
  }
  deadline = Date.now() + config.seconds * 1000;
  const sheet = () => {
    const occ = new Uint8Array(w * h), pre = new Int32Array(stride * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < margin || y < margin || x >= w - margin || y >= h - margin) occ[y * w + x] = 1;
    const s = { occ, pre };
    for (let y = 0; y < h; y++) prefix(s, y);
    return s;
  };
  const prefix = (s, y) => { const off = y * stride; for (let x = 0; x < w; x++) s.pre[off + x + 1] = s.pre[off + x] + s.occ[y * w + x]; };
  const occupy = (s, o, x, y) => {
    for (const [dy, a, b] of o.runs) s.occ.fill(1, (y + dy) * w + x + a, (y + dy) * w + x + b);
    for (let yy = y; yy < y + o.h; yy++) prefix(s, yy);
  };
  const restore = placements => {
    const s = sheet();
    for (const p of placements) {
      const o = cache.get(p.templateId).find(o => o.angle === p.angle);
      occupy(s, o, Math.round((p.x + o.dx) / cell), Math.round((p.y + o.dy) / cell));
    }
    return s;
  };
  const add = (s, t, random, weight) => {
    let best = null, checks = 0;
    for (const o of shuffle([...cache.get(t.id)], random)) {
      for (let y = margin; y <= h - margin - o.h; y++) {
        if (best && y + weight * o.h > best.score) break;
        for (let x = margin; x <= w - margin - o.w;) {
          if ((++checks & 4095) === 0 && expired()) return null;
          let next = x;
          for (const [dy, a, b] of o.runs) {
            const row = (y + dy) * stride, count = s.pre[row + x + b];
            if (count === s.pre[row + x + a]) continue;
            // A collided solid run cannot fit again until it passes this occupied pixel.
            let lo = x + a, hi = x + b - 1;
            while (lo < hi) {
              const mid = Math.ceil((lo + hi) / 2);
              if (s.pre[row + mid] < count) lo = mid; else hi = mid - 1;
            }
            next = lo - a + 1;
            break;
          }
          if (next !== x) { x = next; continue; }
          const score = y + weight * o.h + x * 0.015;
          if (!best || score < best.score) best = { o, x, y, score };
          break;
        }
      }
    }
    if (!best) return null;
    const { o, x, y } = best;
    occupy(s, o, x, y);
    return { templateId: t.id, x: x * cell - o.dx, y: y * cell - o.dy, angle: o.angle };
  };
  let best = { placements: [], figures: 0, trials: 0 }, trial = 0;
  while (!expired() && trial < maxTrials) {
    const random = randomGenerator(seed + trial * 7919), weight = [0.3, 0.6, 0.9][trial % 3];
    const retained = trial > 1 && trial % 2 === 0
      ? best.placements.filter(p => byId.get(p.templateId).role === 'figure').sort((a, b) => a.y - b.y).slice(0, Math.floor(best.figures * (0.35 + random() * 0.35))) : [];
    const s = restore(retained), plannedCounts = new Map(figures.map(t => [t.id, retained.filter(p => p.templateId === t.id).length]));
    const remaining = new Map(figures.map(t => [t.id, (config.mode === 'exact' ? t.quantity : 250) - plannedCounts.get(t.id)]));
    const order = [];
    while (order.length + retained.length < 250 && [...remaining.values()].some(n => n > 0)) {
      let cycle = shuffle(figures.filter(t => remaining.get(t.id) > 0), random);
      if (config.mode === 'fill' && config.balanced) {
        const minimum = Math.min(...cycle.map(t => plannedCounts.get(t.id)));
        cycle = cycle.filter(t => plannedCounts.get(t.id) === minimum);
      }
      if (!config.balanced && config.mode === 'fill') cycle.sort((a, b) => a.loops.reduce((v, p) => v + area(p), 0) - b.loops.reduce((v, p) => v + area(p), 0));
      for (const t of cycle) {
        if (order.length + retained.length >= 250) break;
        order.push(t); remaining.set(t.id, remaining.get(t.id) - 1); plannedCounts.set(t.id, plannedCounts.get(t.id) + 1);
      }
    }
    const placed = [...retained], states = [];
    for (const t of order) {
      if (expired()) break;
      const p = add(s, t, random, weight);
      if (!p) {
        if (config.mode === 'fill' && config.balanced) break;
        continue;
      }
      placed.push(p);
      if (placed.length > best.figures) states.push(placed.slice());
      if (placed.length % 8 === 0) await pause();
    }
    for (const saved of states.reverse()) {
      if (expired()) break;
      const candidate = [...saved], requirements = new Map();
      for (const p of candidate) {
        const t = byId.get(p.templateId);
        if (t.complementId) requirements.set(t.complementId, (requirements.get(t.complementId) || 0) + t.ratio);
      }
      if (candidate.length + [...requirements.values()].reduce((a, b) => a + b, 0) > 1000) continue;
      const state = restore(saved);
      let complete = true;
      for (const [id, count] of requirements) {
        for (let i = 0; i < count; i++) {
          const p = add(state, byId.get(id), random, 0.5);
          if (!p) { complete = false; break; }
          candidate.push(p);
        }
        if (!complete) break;
      }
      if (!complete) continue;
      const placements = candidate.map((p, i) => ({ ...p, id: `piece-${i + 1}` }));
      const check = validateLayout(templates, placements, config);
      if (check.valid && check.figures > best.figures) {
        best = { placements, figures: check.figures, trials: trial + 1, validation: check };
        onProgress({ phase: 'best', ...best, elapsed: (Date.now() - startTime) / 1000 });
        break;
      }
    }
    trial++;
    onProgress({ phase: 'searching', figures: best.figures, trials: trial, elapsed: (Date.now() - startTime) / 1000 });
    if (config.mode === 'exact' && best.figures === figures.reduce((sum, t) => sum + t.quantity, 0)) break;
    await pause();
  }
  return { ...best, trials: trial, elapsed: (Date.now() - startTime) / 1000, cancelled: cancelled(),
    capped: best.figures >= 250, message: best.placements.length ? 'Mejor distribucion valida encontrada; no es un maximo matematico demostrado.' : 'No se encontro un juego completo. Amplia el tiempo o revisa medidas, margen y complementos.' };
}

// Logo "elements": groups the vectorized pieces into meaningful parts (icon, brand name, slogan, details) so the user
// can choose which ones go into the product, and recomposes them into alternative layouts (stacked, in a row…).
// detectElements is pure (tests run it in Node); composeLayout / qrCanvas need a DOM canvas.
import qrcode from 'qrcode-generator';

const bboxUnion = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

// gap: 0..1 (fraction of the design diagonal used to decide that two pieces belong together)
export function detectElements(result, { gap = 0.025 } = {}) {
  const P = result.pieces;
  if (!P.length) return [];
  const fb = result.fgBBox, diag = Math.hypot(fb[2] - fb[0], fb[3] - fb[1]);
  const gp = gap * diag;
  const parent = P.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  // nested pieces (inner colours) always belong to the piece that contains them
  for (const p of P) for (const n of p.neighbors || []) join(p.id, n);
  const tops = [...new Set(P.map((p) => find(p.id)))];
  const box = new Map();
  for (const p of P) { const r = find(p.id); box.set(r, box.has(r) ? bboxUnion(box.get(r), p.bbox) : p.bbox); }
  for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
    const a = box.get(tops[i]), b = box.get(tops[j]);
    const ha = a[3] - a[1], hb = b[3] - b[1];
    const ex = Math.max(gp, 0.45 * Math.min(ha, hb)), ey = gp * 0.5;
    const dx = Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2]));
    const dy = Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3]));
    // letters of the same line: similar height and vertically overlapping
    const sameLine = dy === 0 && Math.min(ha, hb) > 0.35 * Math.max(ha, hb);
    if ((dx <= ex && dy <= ey && sameLine) || (dx <= gp * 0.3 && dy <= gp * 0.3)) join(tops[i], tops[j]);
  }
  const groups = new Map();
  for (const p of P) {
    const r = find(p.id);
    if (!groups.has(r)) groups.set(r, { pieces: [], bbox: p.bbox, area: 0, parts: new Set() });
    const g = groups.get(r);
    g.pieces.push(p.id); g.bbox = bboxUnion(g.bbox, p.bbox); g.area += p.area;
  }
  // count top-level "glyphs" of each group (pieces not nested inside another of the group)
  for (const p of P) if (p.depth === 0) groups.get(find(p.id)).parts.add(p.id);
  const total = P.reduce((a, p) => a + p.area, 0);
  let els = [...groups.values()].map((g) => {
    const w = g.bbox[2] - g.bbox[0], h = g.bbox[3] - g.bbox[1];
    const glyphs = g.parts.size;
    const kind = glyphs >= 3 && w / Math.max(1, h) > 2.2 ? 'texto' : g.area < total * 0.01 ? 'detalle' : 'icono';
    return { pieces: g.pieces.sort((a, b) => a - b), bbox: g.bbox, area: g.area, kind, glyphs, w, h };
  });
  // tiny marks (®, ™, dots) are details
  els.sort((a, b) => b.area - a.area);
  const textH = Math.max(0, ...els.filter((e) => e.kind === 'texto').map((e) => e.h));
  for (const e of els) if (e.kind === 'texto' && e.h < textH * 0.55) e.kind = 'eslogan';
  const names = { icono: 'Ícono', texto: 'Nombre / texto', eslogan: 'Eslogan', detalle: 'Detalle' };
  const count = {};
  els = els.map((e, i) => {
    count[e.kind] = (count[e.kind] || 0) + 1;
    return { ...e, id: i, label: names[e.kind] + (count[e.kind] > 1 ? ' ' + count[e.kind] : '') };
  });
  return els;
}

// Default selection for a layout preset. Returns element ids.
export function presetSelection(els, preset) {
  const icon = els.find((e) => e.kind === 'icono');
  const text = els.find((e) => e.kind === 'texto');
  const all = els.map((e) => e.id);
  switch (preset) {
    case 'icon': return icon ? [icon.id] : all;
    case 'text': return text ? els.filter((e) => e.kind === 'texto').map((e) => e.id) : all;
    case 'noslogan': return els.filter((e) => e.kind !== 'eslogan' && e.kind !== 'detalle').map((e) => e.id);
    case 'stack': case 'row': return [icon, text].filter(Boolean).map((e) => e.id);
    default: return all;
  }
}

export const LAYOUTS = [
  { id: 'original', name: 'Como el logo' },
  { id: 'stack', name: 'Ícono arriba, nombre abajo' },
  { id: 'row', name: 'Ícono a la izquierda, nombre a la derecha' },
];

// Crops the selected elements from the processed image and arranges them.
// src: canvas/img at the processed resolution (result.width × result.height).
// extras: [{ canvas, scale? }] extra blocks appended (QR code, name line…)
export function composeLayout(src, result, els, { ids, layout = 'original', scales = {}, extras = [], extraPos = 'below' } = {}) {
  const W = result.width, H = result.height, comp = result.comp;
  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  const bctx = base.getContext('2d', { willReadFrequently: true });
  bctx.drawImage(src, 0, 0, W, H);
  const img = bctx.getImageData(0, 0, W, H);
  const crop = (e) => {
    const [x0, y0, x1, y1] = e.bbox.map(Math.round), w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const set = new Set(e.pieces);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const out = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y + y0) * W + x + x0;
      if (y + y0 >= H || x + x0 >= W || !set.has(comp[i])) continue;
      const o = (y * w + x) * 4;
      out.data[o] = img.data[i * 4]; out.data[o + 1] = img.data[i * 4 + 1]; out.data[o + 2] = img.data[i * 4 + 2]; out.data[o + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return { c, x0, y0, w: w * (scales[e.id] || 1), h: h * (scales[e.id] || 1), e };
  };
  const sel = els.filter((e) => ids.includes(e.id));
  if (!sel.length) return null;
  const blocks = sel.map(crop);
  const ref = Math.max(...blocks.map((b) => Math.max(b.w, b.h)));
  const padIn = ref * 0.08;
  let placed = [];
  if (layout === 'original') {
    // keep relative positions (scaled elements grow around their own centre)
    for (const b of blocks) {
      const cx = b.x0 + b.c.width / 2, cy = b.y0 + b.c.height / 2;
      placed.push({ ...b, x: cx - b.w / 2, y: cy - b.h / 2 });
    }
  } else {
    const icons = blocks.filter((b) => b.e.kind === 'icono' || b.e.kind === 'detalle');
    const texts = blocks.filter((b) => !(b.e.kind === 'icono' || b.e.kind === 'detalle'));
    const head = icons.length ? icons : texts.slice(0, 1);
    const rest = icons.length ? texts : texts.slice(1);
    const stackV = (arr, x0, y0, align = 'center') => {
      const wMax = Math.max(0, ...arr.map((b) => b.w));
      let y = y0;
      for (const b of arr) { placed.push({ ...b, x: align === 'left' ? x0 : x0 + (wMax - b.w) / 2, y }); y += b.h + padIn * 0.6; }
      return { w: wMax, h: y - y0 - (arr.length ? padIn * 0.6 : 0) };
    };
    if (layout === 'stack') {
      const hb = stackV(head, 0, 0);
      const tb = { w: Math.max(0, ...rest.map((b) => b.w)) };
      const W2 = Math.max(hb.w, tb.w);
      placed = placed.map((p) => ({ ...p, x: p.x + (W2 - hb.w) / 2 }));
      const n0 = placed.length;
      stackV(rest, 0, hb.h + padIn);
      for (let i = n0; i < placed.length; i++) placed[i].x += (W2 - tb.w) / 2;
    } else {
      // row: icon left, texts stacked on the right, vertically centred
      const hb = stackV(head, 0, 0);
      const n0 = placed.length;
      const tb = stackV(rest, hb.w + padIn, 0, 'left');
      const Hm = Math.max(hb.h, tb.h);
      for (let i = 0; i < placed.length; i++) placed[i].y += ((i < n0 ? Hm - hb.h : Hm - tb.h) / 2);
    }
  }
  // extras below / right of the composition
  let bx0 = Math.min(...placed.map((p) => p.x)), by0 = Math.min(...placed.map((p) => p.y));
  let bx1 = Math.max(...placed.map((p) => p.x + p.w)), by1 = Math.max(...placed.map((p) => p.y + p.h));
  for (const ex of extras) {
    const s = ex.scale || 1, w = ex.canvas.width * s, h = ex.canvas.height * s;
    if (extraPos === 'right') { placed.push({ c: ex.canvas, x: bx1 + padIn, y: (by0 + by1) / 2 - h / 2, w, h }); bx1 += padIn + w; by0 = Math.min(by0, (by0 + by1) / 2 - h / 2); by1 = Math.max(by1, (by0 + by1) / 2 + h / 2); }
    else { placed.push({ c: ex.canvas, x: (bx0 + bx1) / 2 - w / 2, y: by1 + padIn, w, h }); by1 += padIn + h; bx0 = Math.min(bx0, (bx0 + bx1) / 2 - w / 2); bx1 = Math.max(bx1, (bx0 + bx1) / 2 + w / 2); }
  }
  bx0 = Math.min(...placed.map((p) => p.x)); by0 = Math.min(...placed.map((p) => p.y));
  bx1 = Math.max(...placed.map((p) => p.x + p.w)); by1 = Math.max(...placed.map((p) => p.y + p.h));
  const m = Math.round(ref * 0.05);
  const out = document.createElement('canvas');
  out.width = Math.ceil(bx1 - bx0 + 2 * m); out.height = Math.ceil(by1 - by0 + 2 * m);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = false;          // keep flat colours (no new blended colours at the edges)
  for (const p of placed) octx.drawImage(p.c, p.x - bx0 + m, p.y - by0 + m, p.w, p.h);
  return out;
}

// QR code as a flat 2-colour tile (dark modules on a light tile with quiet zone). moduleMM: warning helper.
export function qrCanvas(text, { dark = '#111111', light = '#ffffff', px = 12, quiet = 2 } = {}) {
  qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));
  const q = qrcode(0, 'M');
  q.addData(String(text || ' '), 'Byte');
  q.make();
  const n = q.getModuleCount(), size = (n + quiet * 2) * px;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const r = px * 1.2;
  ctx.fillStyle = light;
  ctx.beginPath(); ctx.roundRect(0, 0, size, size, r); ctx.fill();
  ctx.fillStyle = dark;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) ctx.fillRect((x + quiet) * px, (y + quiet) * px, px, px);
  return { canvas: c, modules: n + quiet * 2 };
}

// Pure QR matrix (for tests / size checks)
export function qrMatrix(text) {
  qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));
  const q = qrcode(0, 'M');
  q.addData(String(text || ' '), 'Byte');
  q.make();
  const n = q.getModuleCount();
  return { n, isDark: (y, x) => q.isDark(y, x) };
}

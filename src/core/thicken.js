// Style-preserving thickening of an element (logo part, slogan, text) on a label raster.
// Letters keep their shape, inner holes (o, a, e…) stay open and, when spreading, every letter/line is moved
// apart by exactly what it grows, so the original spacing, alignment and centre are preserved.
import { edt, components, fillHoles } from './raster.js';

// Groups the foreground into lines and glyphs (a glyph = connected parts that overlap horizontally,
// e.g. "i" + its dot, letters + accents). textLike tells whether it looks like a row of letters.
export function glyphLayout(fg, W, H) {
  const { labels, comps } = components(fg, W, H);
  if (!comps.length) return { labels, comps, lines: [], textLike: false };
  const maxH = Math.max(...comps.map((c) => c.maxY - c.minY + 1));
  // lines from the tall parts
  let lines = comps.filter((c) => c.maxY - c.minY + 1 >= maxH * 0.35).map((c) => ({ y0: c.minY, y1: c.maxY }))
    .sort((a, b) => a.y0 - b.y0);
  const merged = [];
  for (const l of lines) {
    const p = merged[merged.length - 1];
    if (p && Math.min(p.y1, l.y1) - Math.max(p.y0, l.y0) > 0.3 * Math.min(p.y1 - p.y0, l.y1 - l.y0)) { p.y0 = Math.min(p.y0, l.y0); p.y1 = Math.max(p.y1, l.y1); } else merged.push({ ...l });
  }
  lines = merged.map((l) => ({ ...l, comps: [], glyphs: [] }));
  comps.forEach((c, i) => {
    const cy = (c.minY + c.maxY) / 2;
    let best = 0, bd = Infinity;
    lines.forEach((l, k) => { const d = cy < l.y0 ? l.y0 - cy : cy > l.y1 ? cy - l.y1 : 0; if (d < bd) { bd = d; best = k; } });
    lines[best].comps.push(i);
  });
  for (const l of lines) {
    const ids = l.comps.slice().sort((a, b) => comps[a].minX - comps[b].minX);
    const gl = [];
    for (const i of ids) {
      const c = comps[i];
      const g = gl.find((q) => Math.min(q.x1, c.maxX) - Math.max(q.x0, c.minX) >= 0.3 * Math.min(q.x1 - q.x0 + 1, c.maxX - c.minX + 1));
      if (g) { g.comps.push(i); g.x0 = Math.min(g.x0, c.minX); g.x1 = Math.max(g.x1, c.maxX); } else gl.push({ comps: [i], x0: c.minX, x1: c.maxX });
    }
    // the main part of each glyph is the largest; parts fully above/below it are accents/dots
    for (const g of gl) {
      g.main = g.comps.reduce((a, b) => (comps[b].area > comps[a].area ? b : a));
      const m = comps[g.main];
      g.above = g.comps.filter((i) => i !== g.main && comps[i].maxY <= m.minY + 1);
      g.below = g.comps.filter((i) => i !== g.main && comps[i].minY >= m.maxY - 1);
    }
    l.glyphs = gl.sort((a, b) => a.x0 - b.x0);
  }
  const big = lines.map((l) => l.glyphs.filter((g) => { const m = comps[g.main]; return m.maxY - m.minY + 1 >= (l.y1 - l.y0 + 1) * 0.4; }));
  const textLike = big.some((g) => {
    if (g.length < 3) return false;
    const hs = g.map((q) => comps[q.main].maxY - comps[q.main].minY + 1), mean = hs.reduce((a, b) => a + b, 0) / hs.length;
    const sd = Math.sqrt(hs.reduce((a, b) => a + (b - mean) ** 2, 0) / hs.length);
    return sd / mean < 0.6;
  });
  return { labels, comps, lines, textLike };
}

// Typical stroke width (px) of the thin parts: 2 × the medial-axis distance, median (ends/junctions excluded by being local maxima).
export function strokeWidth(L, W, H) {
  const inv = new Uint8Array(W * H);
  let any = false;
  for (let i = 0; i < inv.length; i++) { inv[i] = L[i] >= 0 ? 0 : 1; if (L[i] >= 0) any = true; }
  if (!any) return 0;
  const d = edt(inv, W, H);
  const ridge = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, v = d[i];
    if (!(v > 0.9) || v === Infinity) continue;
    if (v >= d[i - 1] && v >= d[i + 1] && v >= d[i - W] && v >= d[i + W]) ridge.push(v);
  }
  if (!ridge.length) return 1;
  ridge.sort((a, b) => a - b);
  return 2 * ridge[Math.floor(ridge.length * 0.5)];
}

// L: Int16Array labels (-1 = empty). r: growth in px.
// mode: 'letters' (spread letters & lines), 'none' (grow in place), 'auto' (letters if it looks like text).
// Returns { L, W, H, ox, oy, spread } where (ox, oy) is where the input's (0, 0) lands in the output.
export function thickenLabels(L, W, H, r, { mode = 'auto', keepHoles = true } = {}) {
  if (!(r > 0)) return { L, W, H, ox: 0, oy: 0, spread: false };
  const fg = Uint8Array.from(L, (v) => (v >= 0 ? 1 : 0));
  let dx = null, dy = null, spread = false;
  if (mode !== 'none') {
    const lay = glyphLayout(fg, W, H);
    spread = mode === 'letters' || lay.textLike;
    if (spread && lay.lines.length) {
      const nc = lay.comps.length;
      dx = new Float32Array(nc); dy = new Float32Array(nc);
      const step = 2 * r;
      // vertical: each line moves by what the lines above it grow (accents moved up/down need room too)
      const ext = lay.lines.map((l) => ({ up: l.glyphs.some((g) => g.above.length) ? step : 0, down: l.glyphs.some((g) => g.below.length) ? step : 0 }));
      const ly = [0];
      for (let k = 1; k < lay.lines.length; k++) ly[k] = ly[k - 1] + step + ext[k - 1].down + ext[k].up;
      const midY = (ly[0] + ly[ly.length - 1]) / 2;
      lay.lines.forEach((l, k) => {
        const n = l.glyphs.length;
        l.glyphs.forEach((g, j) => {
          const sx = (j - (n - 1) / 2) * step;
          for (const i of g.comps) {
            dx[i] = sx;
            dy[i] = ly[k] - midY + (g.above.includes(i) ? -step : g.below.includes(i) ? step : 0);
          }
        });
      });
    }
  }
  let mnx = 0, mny = 0, mxx = 0, mxy = 0;
  if (dx) for (let i = 0; i < dx.length; i++) { mnx = Math.min(mnx, dx[i]); mxx = Math.max(mxx, dx[i]); mny = Math.min(mny, dy[i]); mxy = Math.max(mxy, dy[i]); }
  const pad = Math.ceil(r) + 2;
  const ox = Math.ceil(pad - mnx), oy = Math.ceil(pad - mny);
  const W2 = Math.ceil(W + ox + mxx + pad), H2 = Math.ceil(H + oy + mxy + pad), N2 = W2 * H2;
  const L2 = new Int16Array(N2).fill(-1);
  const lab = dx ? glyphLabels(fg, W, H) : null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = L[y * W + x];
    if (v < 0) continue;
    let tx = x + ox, ty = y + oy;
    if (dx) { const c = lab[y * W + x]; tx += Math.round(dx[c]); ty += Math.round(dy[c]); }
    if (tx >= 0 && ty >= 0 && tx < W2 && ty < H2) L2[ty * W2 + tx] = v;
  }
  // grow every colour into the empty space around it (nearest colour wins)
  const fg2 = Uint8Array.from(L2, (v) => (v >= 0 ? 1 : 0));
  const { dist, index } = edt(fg2, W2, H2, true);
  let allow = null;
  if (keepHoles) {
    const filled = fillHoles(fg2, W2, H2);
    const hole = Uint8Array.from(filled, (v, i) => (v && !fg2[i] ? 1 : 0));
    const { labels: hl, comps: hc } = components(hole, W2, H2, false);
    if (hc.length) {
      const rho = new Float32Array(hc.length);
      for (let i = 0; i < N2; i++) if (hl[i] >= 0 && dist[i] > rho[hl[i]]) rho[hl[i]] = dist[i];
      // a hole may shrink to at most half its inner radius, so counters stay open and recognisable
      const lim = Float32Array.from(rho, (p) => Math.min(r, Math.max(0, p * 0.5)));
      allow = (i) => (hl[i] >= 0 ? lim[hl[i]] : r);
    }
  }
  const out = L2.slice();
  for (let i = 0; i < N2; i++) {
    if (L2[i] >= 0 || index[i] < 0) continue;
    if (dist[i] <= (allow ? allow(i) : r)) out[i] = L2[index[i]];
  }
  return { L: out, W: W2, H: H2, ox, oy, spread: !!dx };
}

function glyphLabels(fg, W, H) { return components(fg, W, H).labels; }

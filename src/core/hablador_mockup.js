// Front-view mockup → traced hablador front. Pure JS (ImageData-like input), no DOM.
// The image must be a straight frontal view (no perspective) on a plain background, base visible at the bottom.
// Colours are classified against the two acrylic colours: the dark silhouette becomes the back panel, every light
// region on it a front piece; non-acrylic colours and the dark ink inside printed pieces become UV print. QR spots
// are stored as boxes (the build draws a real, scannable QR there) and the white piece touching the base is the
// card-holder front. The structure (base, slots, supports, card holder) stays parametric from the measurements.
// Output units: mm, panel space (x 0..panelW from the left edge, y = 0 at the base top, y < 0 upwards).
import { fitClosed, cubicsToPath } from './curvefit.js';
import { components, close, dilate, erode, fillHoles, fillSmallHoles, traceMask } from './raster.js';
import { computeForeground, resizeBicubic, rgbToHex } from './processing.js';
import { pathToContour } from './hablador.js';

const hexRGB = (h) => { const s = String(h || '#000').replace('#', ''); const n = parseInt(s.length === 3 ? s.replace(/./g, '$&$&') : s.padEnd(6, '0').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const open = (m, W, H, r) => (r > 0 ? dilate(erode(m, W, H, r), W, H, r) : m);
const fitRing = (ring, tol) => pathToContour(cubicsToPath(fitClosed(ring, { tol, cornerDeg: 45 })));
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

// Copies the bbox [x0,y0,x1,y1) of a mask with `pad` empty pixels around it.
function cropMask(m, W, x0, y0, x1, y1, pad, keep = (v) => v) {
  const w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad, out = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (keep(m[y * W + x], y * W + x)) out[(y - y0 + pad) * w + (x - x0 + pad)] = 1;
  return { m: out, w, h, ox: x0 - pad, oy: y0 - pad };
}

export function analyzeMockup(img, { height = 250, baseStack = 6, white = '#ffffff', black = '#16161a', ppm = 8, minFeature = 1.2, tolerance = 40, minAreaMM2 = 4 } = {}) {
  const { width: W0, height: H0, data: D0 } = img;
  // ---- 1. the hablador = biggest foreground blob (background flood-filled from the image border)
  const fg = computeForeground(img, { removeBg: 'yes', tolerance });
  const { labels, comps } = components(fg, W0, H0);
  if (!comps.length) throw new Error('No se encontró el hablador en la imagen (usa un fondo liso).');
  let ci = 0;
  comps.forEach((c, i) => { if (c.area > comps[ci].area) ci = i; });
  const C = comps[ci];
  const ext = (y) => { let a = -1, b = -1; for (let x = C.minX; x <= C.maxX; x++) if (labels[y * W0 + x] === ci) { if (a < 0) a = x; b = x; } return a < 0 ? null : [a, b]; };
  const wRow = (y) => { const e = ext(y); return e ? e[1] - e[0] + 1 : 0; };

  // ---- 2. base strip at the bottom: rows as wide as the bottom; falls back to the known stack height
  const yT = C.minY, yB = C.maxY, total = yB - yT + 1;
  const expect = Math.max(1, Math.round((total * baseStack) / height));
  const wb = median([wRow(yB), wRow(yB - 1), wRow(yB - 2), wRow(yB - Math.min(3, expect))]);
  let y = yB;
  while (y > yT && wRow(y) >= 0.9 * wb) y--;
  let baseTop = y + 1;
  const found = yB - baseTop + 1;
  const baseFound = found <= 4 * expect && found >= 0.3 * expect;
  if (!baseFound) baseTop = yB + 1 - expect;
  let baseW = 0;
  for (let yy = baseTop; yy <= yB; yy++) baseW = Math.max(baseW, wRow(yy));

  // ---- 3. panel rows, resampled to `ppm` px/mm (bicubic → sub-pixel edges, no stair steps) and padded
  const panelH = height - baseStack, panelPx = baseTop - yT;
  if (panelPx < 40) throw new Error('La imagen es muy pequeña: usa un mockup de al menos 800 px de alto.');
  let xa = W0, xb = -1;
  for (let yy = yT; yy < baseTop; yy++) { const e = ext(yy); if (e) { xa = Math.min(xa, e[0]); xb = Math.max(xb, e[1]); } }
  const cw = xb - xa + 1, s = (panelH * ppm) / panelPx;
  // the dark base strip stays under the panel: light pieces touching it (card holder) must not leak into the background
  const nRows = yB + 1 - yT;
  const crop = { width: cw, height: nRows, data: new Uint8ClampedArray(cw * nRows * 4) };
  for (let yy = 0; yy < nRows; yy++) crop.data.set(D0.subarray(((yT + yy) * W0 + xa) * 4, ((yT + yy) * W0 + xa + cw) * 4), yy * cw * 4);
  const Wr = Math.max(8, Math.round(cw * s)), Hr = Math.round(panelH * ppm), Hc = Math.max(Hr + 2, Math.round(nRows * s));
  const R = resizeBicubic(crop, Wr, Hc);
  const pad = 12, Wp = Wr + 2 * pad, Hp = Hc + 2 * pad, N = Wp * Hp;
  const bgc = fg.bg || [255, 255, 255];
  const px = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) { px[i * 4] = bgc[0]; px[i * 4 + 1] = bgc[1]; px[i * 4 + 2] = bgc[2]; px[i * 4 + 3] = 255; }
  for (let yy = 0; yy < Hc; yy++) for (let xx = 0; xx < Wr; xx++) {
    const si = (yy * Wr + xx) * 4, di = ((yy + pad) * Wp + xx + pad) * 4, a = R.data[si + 3] / 255;
    for (let k = 0; k < 3; k++) px[di + k] = R.data[si + k] * a + bgc[k] * (1 - a);
  }
  const P = { width: Wp, height: Hp, data: px };
  const fg2 = computeForeground(P, { removeBg: 'yes', tolerance });

  // ---- 4. classify: 1 = dark acrylic, 2 = light acrylic, 3 = other colour (print). Projection on the dark→light axis.
  const B = hexRGB(black), Wt = hexRGB(white), d = [Wt[0] - B[0], Wt[1] - B[1], Wt[2] - B[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const cls = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!fg2[i]) continue;
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    if (dd < 3000) { cls[i] = 0.299 * r + 0.587 * g + 0.114 * b > 128 ? 2 : 1; continue; }
    const t = ((r - B[0]) * d[0] + (g - B[1]) * d[1] + (b - B[2]) * d[2]) / dd;
    const er = r - B[0] - t * d[0], eg = g - B[1] - t * d[1], eb = b - B[2] - t * d[2];
    cls[i] = Math.sqrt(er * er + eg * eg + eb * eb) > 55 ? 3 : t > 0.5 ? 2 : 1;
  }
  const rad = Math.max(1, Math.round((minFeature * ppm) / 2));

  // ---- 5. panel = filled silhouette, cleaned of hairlines/spikes, flat bottom at the base top
  let pm = fillHoles(fg2, Wp, Hp);
  pm = open(close(pm, Wp, Hp, rad), Wp, Hp, rad);
  for (let yy = pad + Hr; yy < Hp; yy++) pm.fill(0, yy * Wp, (yy + 1) * Wp);
  let x0 = Wp, x1 = -1, top = Hp;
  for (let yy = 0; yy < Hp; yy++) for (let xx = 0; xx < Wp; xx++) if (pm[yy * Wp + xx]) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < top) top = yy; }
  if (x1 < 0) throw new Error('No se pudo separar el panel del fondo.');
  const bottom = pad + Hr;
  const ox = -x0 / ppm, oy = -bottom / ppm, k = 1 / ppm;
  const panelShapes = traceMask(pm, Wp, Hp, 0.6, 2, ox, oy, k);
  panelShapes.sort((a, b) => b.outer.length - a.outer.length);
  const panel = fitRing(panelShapes[0].outer, 0.04);
  const panelW = (x1 - x0 + 1) / ppm;

  // ---- 6. light pieces on the panel
  let wm = new Uint8Array(N);
  for (let i = 0; i < N; i++) wm[i] = pm[i] && (cls[i] === 2 || cls[i] === 3) ? 1 : 0;
  // close only hairline gaps: thin dark lines between pieces (e.g. the icon faces) must keep them apart
  wm = open(close(wm, Wp, Hp, Math.max(1, Math.round(0.25 * ppm))), Wp, Hp, rad);
  const wc = components(wm, Wp, Hp, false);
  const pieces = [];
  let card = null;
  const minA = minAreaMM2 * ppm * ppm;
  const mean = (idx) => { let r = 0, g = 0, b = 0; for (const i of idx) { r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; } const n = idx.length || 1; return [r / n, g / n, b / n]; };
  const hex = (c) => rgbToHex(Math.round(c[0]), Math.round(c[1]), Math.round(c[2]));
  // biggest first: light islands enclosed by the print of a piece (e.g. inside a printed logo) belong to that piece
  const covered = new Uint8Array(N);
  const order = wc.comps.map((c, li) => li).sort((p, q) => wc.comps[q].area - wc.comps[p].area);
  for (const li of order) {
    const c = wc.comps[li];
    if (c.area < minA) continue;
    { let inside = 0, n = 0; for (let yy = c.minY; yy <= c.maxY; yy++) for (let xx = c.minX; xx <= c.maxX; xx++) { const i = yy * Wp + xx; if (wc.labels[i] === li) { n++; if (covered[i]) inside++; } } if (inside > 0.5 * n) continue; }
    const cm = cropMask(wc.labels, Wp, c.minX, c.minY, c.maxX + 1, c.maxY + 1, 3, (v) => v === li);
    const filled = fillHoles(cm.m, cm.w, cm.h);
    const holes = new Uint8Array(cm.w * cm.h);
    for (let i = 0; i < holes.length; i++) holes[i] = filled[i] && !cm.m[i] ? 1 : 0;
    const nHoles = components(holes, cm.w, cm.h, false).comps.filter((h) => h.area >= 3).length;
    let other = 0;
    for (let yy = c.minY; yy <= c.maxY; yy++) for (let xx = c.minX; xx <= c.maxX; xx++) { const i = yy * Wp + xx; if (wc.labels[i] === li && cls[i] === 3) other++; }
    const isCard = c.maxY >= bottom - 1 - 1.5 * ppm && (c.maxX - c.minX + 1) >= 25 * ppm;
    const printed = isCard || nHoles >= 6 || other > 0.02 * c.area;
    const shape = printed ? filled : fillSmallHoles(cm.m, cm.w, cm.h, (minAreaMM2 / 2) * ppm * ppm);
    if (printed) for (let yy = 0; yy < cm.h; yy++) for (let xx = 0; xx < cm.w; xx++) if (filled[yy * cm.w + xx]) { const gy = yy + cm.oy, gx = xx + cm.ox; if (gx >= 0 && gy >= 0 && gx < Wp && gy < Hp) covered[gy * Wp + gx] = 1; }
    const pox = (cm.ox - x0) / ppm, poy = (cm.oy - bottom) / ppm;
    const contours = traceMask(shape, cm.w, cm.h, 0.6, 2, pox, poy, k).flatMap((sh) => [sh.outer, ...sh.holes].map((r) => fitRing(r, 0.03)));
    const box = { x0: (c.minX - x0) / ppm, x1: (c.maxX + 1 - x0) / ppm, y0: (c.minY - bottom) / ppm, y1: (c.maxY + 1 - bottom) / ppm };

    // UV print: everything that is not light acrylic inside the (slightly eroded) piece
    const print = [], texts = [];
    let qr = null;
    if (printed) {
      const inner = erode(filled, cm.w, cm.h, 2);
      const pmk = new Uint8Array(cm.w * cm.h);
      for (let yy = 0; yy < cm.h; yy++) for (let xx = 0; xx < cm.w; xx++) {
        const i = yy * cm.w + xx, gi = (yy + cm.oy) * Wp + xx + cm.ox;
        if (inner[i] && cls[gi] !== 2) pmk[i] = 1;
      }
      const blobs = components(dilate(pmk, cm.w, cm.h, Math.round(0.8 * ppm)), cm.w, cm.h);
      blobs.comps.forEach((b, bi) => {
        const idx = [], loc = [];
        for (let yy = b.minY; yy <= b.maxY; yy++) for (let xx = b.minX; xx <= b.maxX; xx++) {
          const i = yy * cm.w + xx;
          if (pmk[i] && blobs.labels[i] === bi) { loc.push(i); idx.push((yy + cm.oy) * Wp + xx + cm.ox); }
        }
        if (idx.length < 0.5 * ppm * ppm) return;
        let bx0 = cm.w, by0 = cm.h, bx1 = -1, by1 = -1;
        for (const i of loc) { const xx = i % cm.w, yy = (i / cm.w) | 0; if (xx < bx0) bx0 = xx; if (xx > bx1) bx1 = xx; if (yy < by0) by0 = yy; if (yy > by1) by1 = yy; }
        const bw = (bx1 - bx0 + 1) / ppm, bh = (by1 - by0 + 1) / ppm, dens = loc.length / ((bx1 - bx0 + 1) * (by1 - by0 + 1));
        const X0 = (bx0 + cm.ox - x0) / ppm, Y0 = (by0 + cm.oy - bottom) / ppm;
        if (!isCard && Math.min(bw, bh) >= 12 && bw / bh > 0.8 && bw / bh < 1.25 && dens > 0.22 && dens < 0.85) {
          // QR: colour from the two opposite quadrants (gradient if they differ)
          const q = (fx, fy) => idx.filter((_, j) => { const xx = loc[j] % cm.w, yy = (loc[j] / cm.w) | 0; return (xx - bx0) / (bx1 - bx0 + 1) < 0.5 === fx && (yy - by0) / (by1 - by0 + 1) < 0.5 === fy; });
          const a = mean(q(true, true)), z = mean(q(false, false));
          const grad = Math.hypot(a[0] - z[0], a[1] - z[1], a[2] - z[2]) > 60;
          const size = Math.max(bw, bh);
          if (!qr || size > qr.size) qr = { x: X0 + (bw - size) / 2, y: Y0 + (bh - size) / 2, size, color: hex(grad ? a : mean(idx)), color2: grad ? hex(z) : '' };
          return;
        }
        const bm = new Uint8Array(cm.w * cm.h);
        for (const i of loc) bm[i] = 1;
        const cs = traceMask(bm, cm.w, cm.h, 0.5, 1, pox, poy, k).flatMap((sh) => [sh.outer, ...sh.holes].map((r) => fitRing(r, 0.02)));
        if (cs.length) texts.push({ box: { x0: X0, y0: Y0, x1: X0 + bw, y1: Y0 + bh }, fill: hex(mean(idx)), contours: cs });
      });
    }
    const item = { contours, box, print, texts, qr, area: c.area / (ppm * ppm) };
    if (isCard && (!card || item.area > card.area)) { if (card) pieces.push(card); card = item; }
    else pieces.push(item);
  }

  // ---- 7. names: QR plates left→right, the rest by rows (top→bottom, left→right)
  const plates = pieces.filter((p) => p.qr).sort((a, b) => a.box.x0 - b.box.x0);
  plates.forEach((p, i) => { p.kind = 'plate'; p.name = `Placa QR ${i + 1}`; });
  const rest = pieces.filter((p) => !p.qr).sort((a, b) => a.box.y0 - b.box.y0);
  const rows = [];
  for (const p of rest) {
    const h = p.box.y1 - p.box.y0;
    const row = rows.find((r) => Math.min(r.y1, p.box.y1) - Math.max(r.y0, p.box.y0) > 0.4 * Math.min(h, r.y1 - r.y0));
    if (row) { row.items.push(p); row.y0 = Math.min(row.y0, p.box.y0); row.y1 = Math.max(row.y1, p.box.y1); } else rows.push({ y0: p.box.y0, y1: p.box.y1, items: [p] });
  }
  rows.forEach((r, ri) => {
    r.items.sort((a, b) => a.box.x0 - b.box.x0);
    r.items.forEach((p, i) => { p.kind = 'piece'; p.name = r.items.length > 1 ? `Fila ${ri + 1} · pieza ${i + 1}` : `Fila ${ri + 1}`; });
  });
  const front = [...plates, ...rows.flatMap((r) => r.items)];
  for (const p of front) {
    // remaining texts of a printed piece without QR become plain print layers
    if (p.kind !== 'plate') { p.print = p.texts.map((t) => ({ fill: t.fill, evenodd: true, contours: t.contours })); p.texts = []; }
    delete p.area;
  }
  let cardOut = null;
  if (card) {
    const { box } = card, dx = -box.x0;
    cardOut = {
      x: box.x0, w: box.x1 - box.x0, h: -box.y0,
      print: card.texts.map((t) => ({ fill: t.fill, evenodd: true, contours: t.contours.map((c) => c.map((sg) => (sg[0] === 'Z' ? sg : [sg[0], ...sg.slice(1).map((v, j) => (j % 2 ? v : v + dx))]))) })),
    };
  }
  const mmPerSrcPx = panelH / panelPx;
  return {
    version: 1, ppm, panelW, panelH, panel, pieces: front, card: cardOut,
    info: { baseFound, baseW: baseW * mmPerSrcPx, totalW: (C.maxX - C.minX + 1) * mmPerSrcPx, srcPxPerMM: 1 / mmPerSrcPx, plates: plates.length, pieces: front.length - plates.length },
  };
}

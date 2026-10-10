// Mockup → hablador round trip: the generator's own front view is rasterised like a photo-realistic mockup,
// analysed back into a traced front and rebuilt. Run: node test/hablador_mockup.test.mjs
import fs from 'fs';
import { PNG } from 'pngjs';
import { parse } from '../node_modules/opentype.js/dist/opentype.mjs';
import { HABLADOR_FONTS, DEFAULT_HABLADOR, buildHablador, exportAll, nest, bbox, flatten } from '../src/core/hablador.js';
import { analyzeMockup } from '../src/core/hablador_mockup.js';

let fails = 0;
const ok = (c, msg) => { console.log(`  ${c ? '✓' : '✗'} ${msg}`); if (!c) fails++; };
const fonts = {};
for (const [fam, file] of Object.entries(HABLADOR_FONTS)) {
  const b = fs.readFileSync(new URL('../src/fonts/' + file, import.meta.url));
  fonts[fam] = parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
const hexRGB = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// Front view of a model as RGBA (k px/mm), same layering as the assembly view, base strip at the bottom.
function renderFront(m, k, bg = '#ffffff', margin = 15) {
  const { cfg, layout: L } = m;
  const W = cfg.width, tB = cfg.black.t;
  const ox = margin + (W - L.panelW) / 2, oy = margin + L.panelH;
  const Wi = Math.round((W + 2 * margin) * k), Hi = Math.round((L.panelH + 2 * tB + 2 * margin) * k);
  const data = new Uint8ClampedArray(Wi * Hi * 4);
  const B = hexRGB(bg);
  for (let i = 0; i < Wi * Hi; i++) data.set([...B, 255], i * 4);
  // 3×3 supersampled even-odd fill
  const fill = (cs, color, dx = 0, dy = 0) => {
    const rings = cs.map((c) => flatten(c, 0.03).map((p) => [(p[0] + dx + ox) * k, (p[1] + dy + oy) * k]));
    const bb = bbox(cs);
    const y0 = Math.max(0, Math.floor((bb.y0 + dy + oy) * k)), y1 = Math.min(Hi - 1, Math.ceil((bb.y1 + dy + oy) * k));
    const cov = new Float32Array(Wi);
    for (let y = y0; y <= y1; y++) {
      cov.fill(0);
      let any = false;
      for (const sy of [0.17, 0.5, 0.83]) {
        const yy = y + sy, xs = [];
        for (const R of rings) for (let i = 0, j = R.length - 1; i < R.length; j = i++) {
          const [xi, yi] = R[i], [xj, yj] = R[j];
          if ((yi > yy) !== (yj > yy)) xs.push(xi + ((yy - yi) / (yj - yi)) * (xj - xi));
        }
        xs.sort((a, b) => a - b);
        for (let q = 0; q + 1 < xs.length; q += 2) {
          for (const sx of [0.17, 0.5, 0.83]) {
            const a = Math.ceil(xs[q] - sx), b = Math.floor(xs[q + 1] - sx);
            for (let x = Math.max(0, a); x <= Math.min(Wi - 1, b); x++) { cov[x] += 1 / 9; any = true; }
          }
        }
      }
      if (!any) continue;
      for (let x = 0; x < Wi; x++) if (cov[x] > 0) {
        const c = typeof color === 'function' ? color(x / k - ox - dx, y / k - oy - dy) : color, a = Math.min(1, cov[x]), i = (y * Wi + x) * 4;
        for (let ch = 0; ch < 3; ch++) data[i + ch] = data[i + ch] * (1 - a) + c[ch] * a;
      }
    }
  };
  const blk = hexRGB(cfg.black.color), wht = hexRGB(cfg.white.color);
  const layer = (l, dx = 0) => {
    if (l.grad) {
      const [c1, c2] = l.grad.map(hexRGB), b = bbox(l.contours);
      fill(l.contours, (x) => { const t = Math.max(0, Math.min(1, (x - b.x0) / (b.w || 1))); return c1.map((v, i) => v + (c2[i] - v) * t); }, dx);
    } else fill(l.contours, hexRGB(l.fill || '#000000'), dx);
  };
  const byId = (id) => m.pieces.find((p) => p.id === id);
  fill(byId('panel').contours, blk);
  for (const p of m.pieces.filter((q) => q.onPanel && !q.overWhite)) { fill(p.contours, wht); for (const l of p.print) layer(l); }
  for (const p of m.pieces.filter((q) => q.overWhite)) fill(p.contours, blk);
  const cf = byId('cardFront');
  if (cf) { fill(cf.contours, wht, cf.cardFront.x); for (const l of cf.print) layer(l, cf.cardFront.x); }
  fill([[['M', -(W - L.panelW) / 2, 0], ['L', (W + L.panelW) / 2, 0], ['L', (W + L.panelW) / 2, 2 * tB], ['L', -(W - L.panelW) / 2, 2 * tB], ['Z']]], blk);
  return { width: Wi, height: Hi, data };
}
const savePNG = (img, f) => { const p = new PNG({ width: img.width, height: img.height }); p.data = Buffer.from(img.data.buffer); fs.writeFileSync(f, PNG.sync.write(p)); };

function roundTrip(label, cfg0, bg) {
  console.log(label);
  const ref = buildHablador(cfg0, fonts);
  const img = renderFront(ref, 6, bg);
  fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
  savePNG(img, new URL(`./out/mockup_${label}.png`, import.meta.url));
  const t0 = Date.now();
  const T = analyzeMockup(img, { height: cfg0.height, baseStack: 2 * cfg0.black.t, white: cfg0.white.color, black: cfg0.black.color });
  const dt = Date.now() - t0;
  const refWhite = ref.pieces.filter((p) => p.onPanel && p.mat === 'white');
  const refPlates = ref.pieces.filter((p) => /^qr/.test(p.id));
  ok(T.info.plates === refPlates.length, `${label}: ${T.info.plates} placas QR detectadas (esperadas ${refPlates.length}) en ${dt} ms`);
  ok(Math.abs(T.panelW - ref.layout.panelW) < 1.2, `${label}: ancho del panel ${T.panelW.toFixed(1)} ≈ ${ref.layout.panelW.toFixed(1)} mm`);
  ok(Math.abs(T.info.baseW - cfg0.width) < 1.5, `${label}: base medida ${T.info.baseW.toFixed(1)} ≈ ${cfg0.width} mm`);
  ok(!!T.card === !!ref.pieces.find((p) => p.id === 'cardFront'), `${label}: porta tarjetas ${T.card ? `detectado (${T.card.w.toFixed(1)} × ${T.card.h.toFixed(1)} mm)` : 'no detectado'}`);
  ok(Math.abs(T.pieces.length - refWhite.length) <= 1, `${label}: ${T.pieces.length} piezas blancas trazadas (referencia ${refWhite.length})`);
  for (const p of T.pieces.filter((q) => q.qr)) {
    const r = refPlates.map((q) => bbox(q.contours)).find((b) => b.x0 < p.qr.x + p.qr.size / 2 && b.x1 > p.qr.x + p.qr.size / 2);
    ok(!!r, `${label}: ${p.name}: QR ${p.qr.size.toFixed(1)} mm ${p.qr.color}${p.qr.color2 ? '→' + p.qr.color2 : ''} dentro de una placa`);
  }

  const cfg = structuredClone(cfg0);
  cfg.source = 'mockup';
  cfg.traced = T;
  for (const it of cfg.qr.items) { it.label = ''; it.sub = ''; }
  const m = buildHablador(cfg, fonts);
  const files = exportAll(m);
  ok(!m.warnings.length, `${label}: reconstrucción sin avisos${m.warnings.length ? ': ' + m.warnings.join(' | ') : ''}`);
  const bad = m.pieces.flatMap((p) => p.contours).filter((c) => c.at(-1)[0] !== 'Z' || c.flat().some((v) => typeof v === 'number' && !Number.isFinite(v)));
  ok(!bad.length, `${label}: contornos cerrados y finitos`);
  const panel = m.pieces.find((p) => p.id === 'panel');
  ok(Math.abs(bbox(panel.contours).w - ref.layout.panelW) < 1.5, `${label}: panel reconstruido ${bbox(panel.contours).w.toFixed(1)} mm de ancho`);
  ok(Math.abs(-bbox(panel.contours).y0 - ref.layout.panelH) < 1, `${label}: alto del panel ${(-bbox(panel.contours).y0).toFixed(1)} mm`);
  const slots = m.slots.filter((s) => s.what === 'panel');
  ok(slots.length >= 2 && slots.every((s) => Math.abs(s.h - (cfg.black.t + cfg.clearance)) < 1e-6), `${label}: ranuras del panel de ${(cfg.black.t + cfg.clearance).toFixed(1)} mm (lámina ${cfg.black.t} − 0.2)`);
  for (const mat of ['white', 'black']) {
    const ss = nest(m, mat);
    ok(ss.length >= 1 && ss.every((s) => s.items.length), `${label}: ${mat}: ${ss.length} lámina(s), aprovechamiento ${ss.map((s) => Math.round(s.fill * 100) + '%').join(', ')}`);
  }
  ok(files.some((f) => /_ensamble\.svg$/.test(f.name)), `${label}: exporta ensamble + ${files.length - 1} archivos`);
  fs.writeFileSync(new URL(`./out/mockup_${label}_ensamble.svg`, import.meta.url), files.find((f) => /_ensamble/.test(f.name)).svg);
  return m;
}

roundTrip('LOVECUBE', DEFAULT_HABLADOR(), '#ffffff');
{
  const c = DEFAULT_HABLADOR();
  c.qr.items.length = 1; c.nfc.plate = 0; c.cards.enabled = false; c.width = 150; c.height = 230;
  roundTrip('una_placa', c, '#dfe3e8');
}

console.log(fails ? `\nhablador mockup: ${fails} FALLAS` : '\nhablador mockup: OK');
process.exit(fails ? 1 : 0);

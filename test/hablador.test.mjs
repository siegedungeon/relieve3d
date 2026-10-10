// Hablador acrílico: geometry, slots, nesting, QC and logo tracing.
import fs from 'fs';
import { parse } from '../node_modules/opentype.js/dist/opentype.mjs';
import { HABLADOR_FONTS, DEFAULT_HABLADOR, buildHablador, exportAll, nest, bbox, flatten, traceLogo, thinCheck } from '../src/core/hablador.js';
import { fitClosed } from '../src/core/curvefit.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const fonts = {};
for (const [fam, file] of Object.entries(HABLADOR_FONTS)) {
  const b = fs.readFileSync(new URL('../src/fonts/' + file, import.meta.url));
  fonts[fam] = parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

function checkModel(m, label) {
  const cfg = m.cfg;
  const pnl = m.pieces.find((p) => p.id === 'panel').size;
  ok(pnl.x0 >= -0.01 && pnl.x1 <= m.layout.panelW + 0.01 && pnl.h <= cfg.height - 2 * cfg.black.t + cfg.black.t + 0.01, `${label}: el panel no se sale de su ancho ni del alto total`);
  // every contour closed and finite
  let bad = 0;
  for (const p of m.pieces) for (const c of p.contours) {
    if (c[0][0] !== 'M' || c[c.length - 1][0] !== 'Z') bad++;
    for (const s of c) for (const v of s.slice(1)) if (typeof v === 'number' && !Number.isFinite(v)) bad++;
  }
  ok(bad === 0, `${label}: todos los contornos cerrados y finitos`);
  // no runaway Bézier handles: control points stay near the piece outline
  let runaway = 0;
  for (const p of m.pieces) {
    const pts = p.contours.flatMap((c) => flatten(c, 0.05));
    const bb = { x0: Math.min(...pts.map((q) => q[0])), x1: Math.max(...pts.map((q) => q[0])), y0: Math.min(...pts.map((q) => q[1])), y1: Math.max(...pts.map((q) => q[1])) };
    for (const c of p.contours) for (const s of c) if (s[0] === 'C') for (let i = 1; i < 7; i += 2) {
      if (s[i] < bb.x0 - 5 || s[i] > bb.x1 + 5 || s[i + 1] < bb.y0 - 5 || s[i + 1] > bb.y1 + 5) runaway++;
    }
  }
  ok(runaway === 0, `${label}: sin puntos de control disparados`);
  // slots = thickness + clearance
  const tOf = { panel: cfg.black.t, front: cfg.white.t, side: cfg.black.t, brace: cfg.black.t };
  ok(m.slots.every((s) => near(Math.min(s.w, s.h), tOf[s.what] + cfg.clearance)), `${label}: ancho de ranuras = grosor + holgura`);
  ok(m.slots.every((s) => s.x > 0 && s.y > 0 && s.x + s.w < cfg.width && s.y + s.h < cfg.depth), `${label}: ranuras dentro de la base`);
  // tabs of the panel match its slots
  const panelSlots = m.slots.filter((s) => s.what === 'panel');
  ok(panelSlots.length === 2 && panelSlots.every((s) => near(s.w, cfg.tabs.panel + cfg.clearance)), `${label}: 2 ranuras de panel del largo de la pestaña`);
  // nesting: inside the sheet, no overlaps
  for (const mat of ['white', 'black', 'jig']) {
    const sheets = nest(m, mat);
    let overlap = 0, outside = 0;
    for (const s of sheets) {
      const boxes = s.items.map((it) => bbox(it.cs));
      boxes.forEach((b, i) => {
        if (b.x0 < 0 || b.y0 < 0 || b.x1 > cfg.sheet.w || b.y1 > cfg.sheet.h) outside++;
        for (let j = i + 1; j < boxes.length; j++) { const o = boxes[j]; if (b.x0 < o.x1 - 1e-6 && o.x0 < b.x1 - 1e-6 && b.y0 < o.y1 - 1e-6 && o.y0 < b.y1 - 1e-6) overlap++; }
      });
    }
    ok(!overlap && !outside, `${label}: lámina ${mat} sin solapes y dentro de ${cfg.sheet.w}×${cfg.sheet.h}`);
  }
  // cut files: red hairline, no fill, mm units
  const files = exportAll(m);
  const cut = files.filter((f) => f.name.includes('_corte_'));
  ok(cut.length >= 2 && cut.every((f) => /width="\d+(\.\d+)?mm"/.test(f.svg) && !/fill="(?!none)[^"]*" stroke="#ff0000"/.test(f.svg) && f.svg.includes('stroke="#ff0000" stroke-width="0.01"')), `${label}: SVG de corte en mm, rojo hairline sin relleno`);
  ok(files.some((f) => f.name.endsWith('_ensamble.svg')) && files.some((f) => f.name.endsWith('_impresion_UV.svg')), `${label}: ensamble e impresión UV`);
  return files;
}

console.log('Hablador LOVECUBE (por defecto)');
{
  const t0 = Date.now();
  const cfg0 = DEFAULT_HABLADOR();
  const m = buildHablador(cfg0, fonts);
  ok(Date.now() - t0 < 5000, `genera en ${Date.now() - t0} ms`);
  ok(m.warnings.length === 0, 'sin avisos: ' + JSON.stringify(m.warnings));
  checkModel(m, 'LOVECUBE');
  ok(m.pieces.filter((p) => p.id.startsWith('title_')).length === 'LOVECUBE'.length, 'título en letras sueltas');
  ok(['icon_faceL', 'icon_faceR', 'icon_card', 'icon_lid'].every((id) => m.pieces.some((p) => p.id === id && p.mat === 'white')), 'ícono: 2 caras + tarjeta + tapa en blanco');
  ok(m.pieces.filter((p) => p.id.startsWith('sub_')).length === 'PHOTOBOOTH'.length, 'subtítulo en letras sueltas');
  ok(m.pieces.every((p) => !p.qc?.thin), 'ninguna pieza con zonas < 1.2 mm');
  const W = m.pieces.filter((p) => p.mat === 'white'), B = m.pieces.filter((p) => p.mat === 'black');
  ok(W.some((p) => p.id === 'qr1') && W.some((p) => p.id === 'qr2') && W.some((p) => p.id === 'cardFront'), 'blanco: placas QR y frente porta tarjetas');
  ok(['panel', 'baseTop', 'baseBottom', 'cardSide', 'brace', 'heart'].every((id) => B.some((p) => p.id === id)), 'negro: panel, bases, laterales, soportes y corazón');
  const panel = m.pieces.find((p) => p.id === 'panel');
  ok(near(panel.size.w, 148, 0.01) && panel.size.h <= 250 - 2 * 3 + 3 + 0.01 && panel.size.h > 245, `panel ${panel.size.w.toFixed(2)} × ${panel.size.h.toFixed(2)} (incl. pestañas, sin pasar el alto total)`);
  const qr = m.pieces.find((p) => p.id === 'qr1'), qr2 = m.pieces.find((p) => p.id === 'qr2');
  ok(qr.size.w > 58 && qr2.size.w > qr.size.w && near(qr.size.w + qr2.size.w + 5 + 2 * 6.8, 148, 0.05) && qr2.size.h > qr.size.h, `placas QR partidas en la V (${qr.size.w.toFixed(1)} / ${qr2.size.w.toFixed(1)} mm) con techo inclinado (${qr.size.h.toFixed(1)} / ${qr2.size.h.toFixed(1)} mm)`);
  // calibres: every tab goes through the black base top (3 mm), every slot = thickness of its piece
  const P = (id) => m.pieces.find((p) => p.id === id);
  ok(near(P('cardFront').size.h, 40 + 3) && near(P('cardSide').size.h, 32 + 3) && near(P('brace').size.h, 50 + 3) && near(panel.size.h, m.layout.panelH + 3, 0.01), 'pestañas de 3 mm = grosor de la base negra');
  ok(m.slots.filter((s) => s.what === 'front').every((s) => near(s.h, 4 + cfg0.clearance)) && m.slots.filter((s) => s.what !== 'front').every((s) => near(Math.min(s.w, s.h), 3 + cfg0.clearance)), 'ranuras: 4 mm (+holgura) para el frente blanco, 3 mm para panel, laterales y soportes negros');
  ok(near(m.layout.fPanel - m.layout.fFront, 4 + 28), 'laterales: cubren el canto del frente blanco (4 mm) + fondo del porta tarjetas');
  const sl = m.slots.filter((s) => s.what === 'side'), fr = m.slots.filter((s) => s.what === 'front');
  ok(sl.length === 2 && sl[0].x + sl[0].w < Math.min(...fr.map((s) => s.x)) && sl[1].x > Math.max(...fr.map((s) => s.x + s.w)), 'laterales del porta tarjetas por fuera del frente');
  ok(qr.print.some((l) => l.evenodd) && qr2.print.some((l) => l.grad), 'QR con ícono central y degradado');
}

console.log('Variantes: 3 QR, NFC, sin porta tarjetas, acrílico 5 mm');
{
  const cfg = DEFAULT_HABLADOR();
  cfg.qr.items.push({ label: 'VISÍTANOS', sub: 'WEB', url: 'https://ejemplo.com', color: '#111111' });
  cfg.nfc.enabled = true; cfg.nfc.plate = 1;
  cfg.cards.enabled = false;
  cfg.white.t = 5;
  const m = buildHablador(cfg, fonts);
  checkModel(m, 'variante');
  ok(m.pieces.filter((p) => /^qr\d$/.test(p.id)).length === 3, '3 placas QR');
  ok(!m.pieces.some((p) => p.id.startsWith('card')), 'sin porta tarjetas');
  const panel = m.pieces.find((p) => p.id === 'panel');
  const holes = panel.contours.slice(1).map((c) => bbox([c]));
  ok(holes.some((h) => near(h.w, 26, 0.05) && near(h.h, 26, 0.05)), 'hueco NFC Ø26 en el panel');
}

console.log('Sin ícono ni QR');
{
  const cfg = DEFAULT_HABLADOR();
  cfg.icon.type = 'none'; cfg.qr.enabled = false;
  const m = buildHablador(cfg, fonts);
  checkModel(m, 'mínimo');
  ok(!m.pieces.some((p) => p.id.startsWith('icon_') || p.id.startsWith('qr')), 'sin piezas de ícono ni QR');
}

console.log('Logo desde imagen (traceLogo)');
{
  const W = 400, H = 300, data = new Uint8ClampedArray(W * H * 4).fill(255);
  const ink = (x, y) => { const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = 20; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = Math.hypot(x - 150, y - 150);
    if (r < 100 && r > 60) ink(x, y);                                            // ring with a white counter
    const a = Math.atan2(y - 150, x - 310), rr = Math.hypot(x - 310, y - 150);
    if (rr < 55 * (0.6 + 0.4 * Math.cos(5 * a))) ink(x, y);                       // flower
    if (y === 20 && x > 20 && x < 380) ink(x, y);                                 // 1 px hairline: must go
  }
  const logo = traceLogo({ data, width: W, height: H }, { heightMM: 50, minFeature: 1.2 });
  ok(logo.white.length === 2, `2 piezas (anillo + flor), línea fina eliminada: ${logo.white.length}`);
  ok(logo.white.some((p) => p.length === 2), 'el anillo conserva su hueco');
  ok(logo.white.every((p) => !thinCheck(p, 0.6).thin), 'sin zonas delgadas');
  const cfg = DEFAULT_HABLADOR();
  cfg.icon = { type: 'custom', height: 50, custom: logo };
  const m = buildHablador(cfg, fonts);
  checkModel(m, 'logo');
  ok(m.warnings.length === 0, 'logo sin avisos');
}

console.log('Ajuste de curvas');
{
  // teardrop: one sharp corner → the loop must not blow up
  const pts = [];
  for (let i = 0; i < 200; i++) { const t = (i / 200) * 2 * Math.PI; pts.push([10 * Math.sin(t / 2) ** 3 * 2, -10 * Math.sin(t)]); }
  const segs = fitClosed(pts, { tol: 0.02 });
  let maxd = 0;
  for (const s of segs) for (let k = 0; k <= 20; k++) {
    const t = k / 20, u = 1 - t;
    const p = [0, 1].map((j) => u * u * u * s[0][j] + 3 * u * u * t * s[1][j] + 3 * u * t * t * s[2][j] + t * t * t * s[3][j]);
    let best = Infinity; for (const q of pts) best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1]));
    maxd = Math.max(maxd, best);
  }
  ok(maxd < 0.2, `lágrima: desviación máx ${maxd.toFixed(3)} mm`);
  // a square stays a square (4 exact corners)
  const sq = fitClosed([[0, 0], [10, 0], [10, 10], [0, 10]], { tol: 0.01 });
  ok(sq.length === 4, 'cuadrado = 4 tramos rectos');
}

if (fails) { console.log(`\n${fails} fallo(s)`); process.exit(1); }
console.log('\nhablador: OK');

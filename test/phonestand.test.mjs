// Soporte de celular llavero (print-in-place): every decorative top, in both variants, gives watertight one-piece
// parts; the leg (printed standing on its 45° cone pins) swings free from its stand stop to its closed snap and can
// never come off; the phone rests on the leg and in the groove; the NFC chip (SIM-style tray in a side slot, or a
// sealed pocket with a print pause), can-tab opener and key-ring hole are printable and where they must be; the
// logo's colour layers (heights, colours, off), the text and the flat "keychain tag" finish tile and print.
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { unzipSync, strFromU8 } from 'fflate';
import { parse } from '../node_modules/opentype.js/dist/opentype.mjs';
import { threeMF } from '../src/core/exporters.js';
import {
  preparePhoneStand, PHONESTAND_SHAPES, PHONESTAND_SIZES, PHONESTAND_VARIANTS, DEFAULT_PHONESTAND, normalizePhoneStand,
  phoneStandMechanism, phoneStandSolids, buildPhoneStand, phoneStandExport, shapeThumbnails, phoneStandProject,
  readPhoneStandProject, NFC_PAUSE_MSG, PHONESTAND_PROJECT_APP,
} from '../src/core/phonestand.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const t0 = Date.now();

const fb = fs.readFileSync(new URL('../src/fonts/Montserrat-Black.ttf', import.meta.url));
const font = parse(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength));
const png = PNG.sync.read(fs.readFileSync(new URL('./logo.png', import.meta.url)));
const logoImage = { data: png.data, width: png.width, height: png.height };
const { Manifold } = await preparePhoneStand();
const solid = (cfg, extra = {}) => phoneStandSolids(cfg, { logoImage, font, ...extra });
const EXTRAS = { nfc: { enabled: true }, opener: { enabled: true }, text: { enabled: true, value: 'Pabonitas' } };

// exported mesh: every edge shared by exactly 2 triangles in opposite directions, positive volume
function watertight(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position.array;
  const key = new Map(), id = (i) => { const k = `${pos[i].toFixed(4)},${pos[i + 1].toFixed(4)},${pos[i + 2].toFixed(4)}`; if (!key.has(k)) key.set(k, key.size); return key.get(k); };
  const E = new Map();
  let vol = 0;
  for (let t = 0; t < pos.length; t += 9) {
    const v = [id(t), id(t + 3), id(t + 6)];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    for (let k = 0; k < 3; k++) { const a = v[k], b = v[(k + 1) % 3]; const e = a < b ? `${a}_${b}` : `${b}_${a}`; E.set(e, (E.get(e) || 0) + (a < b ? 1 : 100)); }
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = pos.slice(t, t + 9);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  let bad = 0;
  for (const n of E.values()) if (n !== 101) bad++;
  return bad === 0 && vol > 0;
}
const overlap = (a, b) => { const x = a.intersect(b); const v = x.volume(); x.delete(); return v; };
const cyl = (x, y, r, z0, z1) => { const c = Manifold.cylinder(z1 - z0, r, r, 64), m = c.translate([x, y, z0]); c.delete(); return m; };
const lowered = (m, dz) => m.translate([0, 0, -dz]);
// the frame plus the art on it (what the leg and the phone must not cut into)
const fixedOf = (sol) => { const art = [sol.topArt, sol.barArt, sol.signArt].filter(Boolean); return art.length ? Manifold.union([sol.body, ...art]) : sol.body; };
// faces leaning more than ~44° from vertical (normal z < −0.72) above the bed: total area and highest point
function overhangs(m) {
  const g = m.getMesh(), V = g.vertProperties, np = g.numProp, T = g.triVerts;
  let area = 0, zTop = -Infinity;
  for (let t = 0; t < T.length; t += 3) {
    const p = [0, 1, 2].map((k) => [V[T[t + k] * np], V[T[t + k] * np + 1], V[T[t + k] * np + 2]]);
    const u = p[1].map((v, i) => v - p[0][i]), w = p[2].map((v, i) => v - p[0][i]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const L = Math.hypot(...n);
    if (L < 1e-12 || n[2] / L >= -0.72 || Math.min(p[0][2], p[1][2], p[2][2]) <= 0.01) continue;
    area += L / 2;
    zTop = Math.max(zTop, p[0][2], p[1][2], p[2][2]);
  }
  return { area, zTop };
}
// box given in the opener's own frame (slit along +x), placed like its cutter: turned by the slit angle, mirrored on the left
function slotBox(op, [x0, x1], [y0, y1], [z0, z1]) {
  const a = Manifold.cube([x1 - x0, y1 - y0, z1 - z0]), b = a.translate([x0, y0, z0]), c = b.rotate([0, 0, op.angle]);
  a.delete(); b.delete();
  if (op.sg > 0) return c;
  const d = c.mirror([1, 0, 0]); c.delete(); return d;
}

function checkOpener(label, sol) {
  const op = sol.info.opener;
  ok(!!op, `${label}: abre latas colocado`);
  if (!op) return;
  // the slit is empty from inside the body to well past the mouth (no skin closes it), the 1 mm lip under it is solid
  const slit = slotBox(op, [op.xin + 4, op.edge + 9], [op.ys + 4, op.ys + op.len - 4], [2.2, 3.2]);
  const lip = slotBox(op, [op.edge - 3, op.edge - 0.3], [op.ys + 4, op.ys + op.len - 4], [0.1, 0.9]);
  const vSlit = overlap(sol.body, slit), vLip = overlap(sol.body, lip), lipVol = lip.volume();
  slit.delete(); lip.delete();
  ok(vSlit < 1e-3, `${label}: ranura abierta hasta el borde (${f2(vSlit)} mm³ de material dentro)`);
  ok(vLip > 0.98 * lipVol, `${label}: labio sólido bajo la ranura`);
  // the mouth is the frontmost part of the shape in the slit direction: an ear or lobe sticking out further would
  // hit the can lid before the lip gets under the tab
  const a = -op.angle * Math.PI / 180;
  const front = Math.max(...sol.outline.toPolygons().flat().map(([x, y]) => op.sg * x * Math.cos(a) - y * Math.sin(a)));
  ok(front - op.edge <= 7.5, `${label}: la boca del abre latas es lo más saliente en su dirección (algo sobresale ${f2(front - op.edge)} mm)`);
  // the slit stays out of the hinge zone (slot, knuckles, folding leg)
  const zone = slotBox(op, [op.xin, op.xin + 16], [op.ys, op.ys + op.len], [0, 1]), yMin = zone.boundingBox().min[1];
  zone.delete();
  ok(yMin >= sol.mech.yh0 + 1.5 - 0.01, `${label}: ranura lejos de la bisagra (desde y ${f2(yMin)} mm, bisagra hasta ${f2(sol.mech.yh0)})`);
}

// relief art lies on the face (bottom 0.3 mm fully inside the part below it) and never over a hole
function checkRelief(label, sol, piece, base, T, h) {
  const bb = piece.boundingBox();
  ok(Math.abs(bb.min[2] - T) < 1e-3 && Math.abs(bb.max[2] - (T + h)) < 1e-3, `${label}: relieve entre z ${f2(bb.min[2])} y ${f2(bb.max[2])}`);
  const foot = lowered(piece, 0.3), v = overlap(base, foot) / (piece.volume() * 0.3 / h);
  foot.delete();
  ok(v > 0.995, `${label}: el relieve se apoya completo sobre la pieza (${(v * 100).toFixed(1)} %)`);
}

// the chip lies ≥ 1.2 mm under the face (≥ 0.8 under a sunk logo or the tap sign), layer-aligned, covered, with the
// see-through chip shown in the app. 'pause': sealed pocket, pause at its top. 'tray' (SIM style, no pause): a
// one-piece tray in a side slot, flush with the edge, held by its click bumps, the nail notch clear of the chip
function checkNfc(label, sol) {
  const n = sol.info.nfc, T = sol.mech.T, L = sol.cfg.logo;
  ok(!!n, `${label}: chip NFC colocado`);
  if (!n) return;
  const sink = L.mode === 'flat' ? L.flatDepth : L.mode === 'engrave' ? L.depth : 0, sunk = n.covered || n.mark ? sink : 0;
  ok(T - n.z1 >= Math.max(1.2, sunk + 0.8) - 1e-9 && n.z0 >= 0.8 && Math.abs(n.z1 / 0.2 - Math.round(n.z1 / 0.2)) < 1e-6, `${label}: NFC (${n.mount}) z ${n.z0}–${n.z1} alineado a capas, ${f2(T - n.z1)} mm bajo la cara`);
  const cover = cyl(n.x, n.y, n.r - 1, n.z1 + 0.05, T - sunk - 0.05);
  ok(overlap(sol.body, cover) > 0.99 * cover.volume(), `${label}: el chip queda tapado`);
  cover.delete();
  if (n.mount === 'pause') {
    ok(sol.pauses.length === 1 && sol.pauses[0].z === n.z1 && sol.pauses[0].msg === NFC_PAUSE_MSG && !sol.tray, `${label}: pausa para el chip en z ${n.z1}`);
    const pocket = cyl(n.x, n.y, n.r - 0.2, n.z0 + 0.05, n.z1 - 0.05);
    ok(overlap(sol.body, pocket) < 1e-3, `${label}: bolsillo vacío`);
    pocket.delete();
    const cb = sol.chip?.boundingBox();
    ok(!!sol.chip && overlap(sol.body, sol.chip) < 1e-3 && cb.min[2] >= n.z0 - 1e-6 && cb.max[2] <= n.z1 + 1e-6, `${label}: chip de vista previa dentro del bolsillo`);
    return;
  }
  const d = n.dims, tray = sol.tray;
  ok(sol.pauses.length === 0 && !!tray && sol.info.parts.tray === 1, `${label}: bandeja de una pieza, sin pausa`);
  if (!tray) return;
  ok(n.arm >= 6 && overlap(sol.body, tray) < 1e-3, `${label}: la bandeja (brazos de ${f2(n.arm)} mm) entra en su ranura sin rozar`);
  // flush: its end reaches the edge; click: pulled 0.6 mm out, its bumps hit the notches in the slot's walls
  const tb = tray.boundingBox(), end = n.sg > 0 ? tb.max[0] : -tb.min[0];
  const out = tray.translate([n.sg * 0.6, 0, 0]), vOut = overlap(sol.body, out);
  out.delete();
  ok(end >= n.m0 - 1e-3 && vOut > 1e-3, `${label}: queda a ras del borde y hace clic (${f2(vOut)} mm³ de traba)`);
  // the nail notch opens over the tray's end, ≥ 0.8 mm of tray away from the chip's pocket
  const nail = cyl(n.sg * n.m0 - n.sg * 1.5, n.y, 1.5, n.z0 + d.th + 0.05, T - 0.05);
  ok(overlap(sol.body, nail) < 1e-3 && n.mouth >= n.r + 0.8 + 3.5 - 1e-9, `${label}: muesca para la uña sobre la punta de la bandeja (a ${f2(n.mouth)} mm del centro del chip)`);
  nail.delete();
  const cb = sol.chip?.boundingBox();
  ok(!!sol.chip && overlap(tray, sol.chip) < 1e-3 && overlap(sol.body, sol.chip) < 1e-3 && cb.min[2] >= n.z0 + 0.6 - 1e-6 && cb.max[2] <= n.z0 + d.th + 1e-6, `${label}: chip de vista previa dentro del hueco de la bandeja`);
}

// the leg turns from just past its stand stop to closed without touching the frame or the art on it, except in the
// snap window right before it closes (the lips give way); the stop catches it, and it sits free open and closed
function checkHinge(label, sol, fixed) {
  const { stand, closed } = sol.mech.poses;
  const at = (d) => { const l = sol.legAt(d), v = overlap(fixed, l); l.delete(); return v; };
  const hits = [];
  for (let d = Math.ceil(stand + 0.5); d < closed; d += 2) if (at(d) > 1e-3) hits.push(d);
  const vStand = at(stand), vClosed = at(closed), vPast = at(stand - 1.5);
  ok(vStand < 1e-3 && vClosed < 1e-3, `${label}: la pata queda suelta abierta y cerrada (${vStand.toExponential(1)} / ${vClosed.toExponential(1)} mm³)`);
  ok(vPast > 0.5, `${label}: el tope la frena al abrir (${f2(vPast)} mm³ si pasara 1,5°)`);
  // the snap rubs only near closed (a stronger snap starts a bit earlier); never in the working range
  if (sol.mech.latch) ok(hits.length > 0 && hits.every((d) => d >= closed - 15), `${label}: gira libre y solo hace clic al cerrar (roce a ${hits.join('°, ')}°)`);
  else ok(hits.length === 0, `${label}: sin clic gira libre todo el recorrido`);
}

// the phone shown in the app rests on the open leg and in the groove: touches both, cuts into neither
function checkPhone(label, cfg, sol, fixed) {
  const r = buildPhoneStand(cfg, { logoImage, font });
  const pos = r.phone.attributes.position.array, pts = [];
  for (let i = 0; i < pos.length; i += 3) pts.push([pos[i], pos[i + 1], pos[i + 2]]);
  const phone = Manifold.hull(pts), leg = sol.legAt(sol.mech.poses.stand);
  const vBody = overlap(phone, fixed), vLeg = overlap(phone, leg), gBody = phone.minGap(fixed, 5), gLeg = phone.minGap(leg, 5);
  phone.delete(); leg.delete();
  ok(vBody < 0.01 && vLeg < 0.01 && gBody < 0.05 && gLeg < 0.05, `${label}: el celular se apoya en la pata y en la ranura (cruce ${f2(vBody + vLeg)} mm³, distancia ${f2(gBody)} / ${f2(gLeg)} mm)`);
}

// ------------------------------------------------------------------ every shape in both variants, plain and with all the extras
console.log('Formas (estándar y corto | solo logo y con NFC, abre latas y texto):');
for (const variant of ['standard', 'short']) {
  for (const s of PHONESTAND_SHAPES) {
    for (const extras of [false, true]) {
      const short = variant === 'short', label = `${s.id}${short ? ' corto' : ''}${extras ? ' +extras' : ''}`;
      const sol = solid({ shape: s.id, variant, ...(extras ? EXTRAS : {}) });
      try {
        const I = sol.info, T = sol.mech.T;
        ok(sol.body.status() === 'NoError' && sol.leg.status() === 'NoError', `${label}: sólidos válidos`);
        ok(I.parts.body === 1 && I.parts.leg === 1, `${label}: cuerpo y pata en una pieza cada uno`);
        ok(I.hinge.gap >= 0.9 * I.hinge.clearance && I.hinge.socketWall >= 1, `${label}: pata suelta del cuerpo (${f2(I.hinge.gap)} mm), pared del cono ${f2(I.hinge.socketWall)} mm`);
        // the thickening notice depends on the logo's detail at each size (checked on its own below)
        const warn = sol.warnings.filter((w) => !(s.id === 'custom' && w.includes('Sube una imagen')) && !w.includes('trazos'));
        ok(warn.length === 0, `${label}: sin avisos${warn.length ? ` (${warn.join(' | ')})` : ''}`);
        const margin = short ? I.stability.landscape : I.stability.portrait;
        ok(margin >= 4.9 && I.phone.landscape === short, `${label}: no se vuelca con el celular ${short ? 'horizontal' : 'vertical'} (margen ${f2(margin)} mm)`);
        // printability: no part of the outline thinner than 2 mm (slivers, needle tips)
        const opened = sol.outline.offset(-1, 'Round', 2, 48), back = opened.offset(1, 'Round', 2, 48), lost = sol.outline.subtract(back);
        ok(lost.area() < 1, `${label}: contorno sin astillas de menos de 2 mm (${f2(lost.area())} mm²)`);
        opened.delete(); back.delete(); lost.delete();
        // key-ring hole: through the body, art clear of it
        const ring = I.ring;
        ok(!!ring, `${label}: agujero del llavero`);
        if (ring) {
          const hole = cyl(ring.x, ring.y, ring.r - 0.2, -1, T + 5), halo = cyl(ring.x, ring.y, ring.r + 0.9, -1, T + 5);
          ok(overlap(sol.body, hole) < 1e-3, `${label}: el agujero del llavero atraviesa la pieza`);
          if (sol.topArt) ok(overlap(sol.topArt, halo) < 1e-3, `${label}: el logo no toca el agujero del llavero`);
          hole.delete(); halo.delete();
        }
        const minLogo = short ? 12 : extras ? 20 : 25;
        ok(!!sol.topArt && I.art.top.w >= minLogo, `${label}: logo arriba de ${f2(I.art.top?.w)} mm de ancho`);
        if (sol.topArt) checkRelief(`${label} logo`, sol, sol.topArt, sol.body, T, sol.cfg.logo.height);
        if (!extras) {
          // nothing to support: the frame has no face past 45° above the bed, the standing leg only its barrel's foot
          const ob = overhangs(sol.body), ol = overhangs(sol.leg);
          ok(ob.area < 0.01 && ol.zTop < 0.7, `${label}: sin voladizos de más de 45° (cuerpo ${f2(ob.area)} mm², pata hasta z ${f2(Math.max(0, ol.zTop))})`);
        } else {
          // text: on the bar (standard), or with the logo on the shape (short: no bar)
          const tx = short ? I.art.top : I.art.bar;
          ok(!!tx?.text && tx.cap >= 3 && !!sol.barArt === !short, `${label}: "Pabonitas" ${short ? 'junto al logo' : 'en la barra'} de ${f2(tx?.cap)} mm de alto`);
          if (sol.barArt) checkRelief(`${label} texto`, sol, sol.barArt, sol.body, T, sol.cfg.logo.height);
          checkNfc(label, sol);
          ok(I.nfc?.covered && !I.nfc.mark, `${label}: el chip queda bajo el logo (se toca el logo)`);
          checkOpener(label, sol);
        }
      } finally {
        sol.dispose();
      }
    }
  }
}

// ------------------------------------------------------------------ hinge: sizes, clearances, snap, widths, phone
console.log('Bisagra (barrido de la pata y celular encima):');
for (const [label, cfg, tMin] of [
  ['por defecto', {}],
  ['grande', { size: 'large' }],
  ['corto', { variant: 'short' }],
  ['holgura 0,2', { clearance: 0.2 }],
  ['holgura 0,6 sin clic', { clearance: 0.6, latch: 0 }],
  ['clic 0,6', { latch: 0.6 }, 11.2],   // the stronger snap's lip sits closer to the phone
  ['ancho 30 estrella', { width: 30, shape: 'star' }],
  ['ancho 46 nube grande corta', { width: 46, shape: 'cloud', size: 'large', variant: 'short' }],
  ['con todo, relieve 2 mm', { ...EXTRAS, logo: { height: 2 } }],
]) {
  const sol = solid(cfg);
  const fixed = fixedOf(sol);
  try {
    const I = sol.info, m = sol.mech, large = m.size === 'large';
    ok(I.parts.body === 1 && I.parts.leg === 1 && I.hinge.gap >= 0.9 * m.c, `${label}: cuerpo y pata de una pieza, separados ${f2(I.hinge.gap)} mm`);
    ok(m.T === (large ? 12 : 11) && I.model.thickness === m.T, `${label}: ${m.T} mm de grueso`);
    const lb = sol.leg.boundingBox(), bb = sol.body.boundingBox();
    ok(Math.abs(lb.min[2]) < 1e-3 && Math.abs(bb.min[2]) < 1e-3 && I.size.h > m.T + 10, `${label}: la pata se imprime parada sobre la cama (${f2(I.size.h)} mm de alto)`);
    const artH = (sol.topArt || sol.barArt || sol.signArt) && sol.cfg.logo.mode === 'relief' ? sol.cfg.logo.height : 0;
    ok(I.closedSize.h <= m.T + artH + 1e-3, `${label}: cerrado queda plano (${f2(I.closedSize.h)} mm de alto)`);
    ok(I.phone.angle >= 59 && I.phone.angle <= 62 && I.phone.tMax >= (tMin ?? (large ? 12.5 : 11.5)), `${label}: celular a ${f2(I.phone.angle)}°, hasta ${f2(I.phone.tMax)} mm de grueso`);
    ok(!!I.latch === (m.cfg.latch > 0), `${label}: ${I.latch ? 'con' : 'sin'} clic de cierre`);
    // captive: printed already assembled, the leg can never come off — moved 1 mm any way, it runs into the body
    const caught = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].filter((t) => { const l = sol.leg.translate(t), v = overlap(sol.body, l); l.delete(); return v > 1e-3; }).length;
    ok(I.hinge.captured && I.hinge.retention >= 1 && caught === 6, `${label}: bisagra cautiva, la pata no se sale (choca al moverla 1 mm en ${caught}/6 direcciones; pasador ${f2(I.hinge.retention)} mm adentro)`);
    checkHinge(label, sol, fixed);
    checkPhone(label, cfg, sol, fixed);
  } finally {
    if (fixed !== sol.body) fixed.delete();
    sol.dispose();
  }
}

// ------------------------------------------------------------------ NFC: tray or pause pocket, place, tap sign, growing shape, chip too big
console.log('Chip NFC (bandeja tipo SIM, pausa, lugar, señal y alargue):');
{
  const nfc = (o = {}) => ({ enabled: true, ...o });
  // SIM-style tray (default): its slot opens on the side away from the can opener, or the one asked for
  for (const [label, cfg, side] of [
    ['bandeja sola', { nfc: nfc() }, 'right'],
    ['bandeja + abre latas a la derecha', { nfc: nfc(), opener: { enabled: true } }, 'left'],
    ['bandeja + abre latas a la izquierda', { nfc: nfc(), opener: { enabled: true, side: 'left' } }, 'right'],
    ['bandeja pedida a la izquierda', { nfc: nfc({ side: 'left' }) }, 'left'],
    // the same side as the opener works too: the slit runs ≤ 3.4 mm up, the tray's slot ≥ 1.6 mm above it
    ['bandeja y abre latas del mismo lado', { nfc: nfc({ side: 'right' }), opener: { enabled: true } }, 'right'],
  ]) {
    const sol = solid(cfg);
    ok(sol.info.nfc?.mount === 'tray' && sol.info.nfc.side === side && sol.warnings.length === 0, `${label}: ranura por la ${side === 'left' ? 'izquierda' : 'derecha'}${sol.warnings.length ? ` (${sol.warnings.join(' | ')})` : ''}`);
    ok(sol.info.parts.body === 1 && sol.body.status() === 'NoError', `${label}: cuerpo de una pieza`);
    checkNfc(label, sol);
    if (sol.info.opener) checkOpener(label, sol);
    sol.dispose();
  }
  // the tray prints apart, flat, beside the stand (its own object in the 3MF, no pause); the view puts it back
  // in its slot with the chip
  const st = solid({ nfc: nfc() }), ib = st.tray.boundingBox();
  st.dispose();
  const bt = buildPhoneStand({ nfc: nfc() }, { logoImage, font });
  const tp = bt.parts.find((p) => p.name === 'Bandeja NFC'), cp = bt.parts.find((p) => p.name === 'Chip NFC');
  const bbOf = (p) => { p.geometry.computeBoundingBox(); return p.geometry.boundingBox; };
  const tbb = bbOf(tp), maxX = Math.max(...bt.parts.filter((p) => !p.apart && !p.preview).map((p) => bbOf(p).max.x));
  ok(tp.apart && watertight(tp.geometry) && Math.abs(tbb.min.z) < 1e-4 && tbb.max.z <= 2 && tbb.min.x >= maxX + 3.9, `la bandeja se imprime aparte, plana (${f2(tbb.max.z)} mm), al lado del soporte`);
  const back = [tbb.min.x, tbb.min.y, tbb.min.z].map((v, i) => v + tp.assembled[i]);
  ok(back.every((v, i) => Math.abs(v - ib.min[i]) < 1e-3) && cp?.preview && cp.assembled?.join() === tp.assembled.join(), 'la vista la arma en su ranura, con el chip');
  const ex = phoneStandExport(bt);
  const z3 = unzipSync(threeMF(ex.parts, 'Soporte', { pauses: ex.pauses, assemblies: ex.assemblies }));
  const mdl = strFromU8(z3['3D/3dmodel.model']);
  ok(ex.assemblies.length === 2 && (mdl.match(/<item /g) || []).length === 2 && mdl.includes('name="Bandeja NFC">\n<components>') && !z3['Metadata/custom_gcode_per_layer.xml'] && !mdl.includes('Chip NFC'),
    '3MF: la bandeja es un objeto propio, sin pausa ni chip');
  // the other mount: sealed pocket and a print pause to drop the chip in
  const pz = solid({ nfc: nfc({ mount: 'pause' }) });
  ok(pz.info.nfc?.mount === 'pause' && !pz.tray && pz.info.parts.tray === 0, 'modo pausa: bolsillo cerrado, sin bandeja');
  checkNfc('modo pausa', pz);
  pz.dispose();
  const bar = solid({ nfc: nfc({ where: 'bar', mount: 'pause' }) });
  const nb = bar.info.nfc;
  ok(nb?.where === 'bar' && Math.abs(nb.y - (bar.mech.yh0 + nb.r + 1.5)) < 0.05, `pausa en la barra: chip a y ${f2(nb?.y)} mm, justo detrás de la bisagra`);
  checkNfc('pausa en la barra', bar);
  bar.dispose();
  const barT = solid({ nfc: nfc({ where: 'bar' }) });
  const nt = barT.info.nfc, yA = barT.mech.yh0 + 2.5 + (nt?.dims.Bt ?? 0);
  ok(nt?.where === 'bar' && nt.y >= yA - 1e-9 && nt.y < yA + 0.5, `bandeja en la barra: chip a y ${f2(nt?.y)} mm, lo más cerca de la bisagra que deja su ranura`);
  checkNfc('bandeja en la barra', barT);
  barT.dispose();
  // 'top' = as high up the shape as the key ring lets it. The pause pocket climbs into the heart; a Ø25 chip's tray
  // slot (~29 mm across) only rises until it nears the heart's ring, whose wall stays whole
  const topP = solid({ nfc: nfc({ where: 'top', mount: 'pause' }) });
  ok(topP.info.nfc?.where === 'top' && topP.info.nfc.y > nb.y + 3, `pausa arriba: sube a y ${f2(topP.info.nfc?.y)} mm (en la barra ${f2(nb.y)} mm)`);
  checkNfc('pausa arriba', topP);
  topP.dispose();
  const top = solid({ nfc: nfc({ where: 'top' }) }), tn = top.info.nfc, rg = top.info.ring;
  const rw = cyl(rg.x, rg.y, rg.r + 1.5, 0.1, top.mech.T - 0.1), rh = cyl(rg.x, rg.y, rg.r + 0.01, -1, top.mech.T + 1), ringWall = rw.subtract(rh);
  ok(tn?.where === 'top' && tn.y >= nt.y && overlap(top.body, ringWall) > 0.99 * ringWall.volume(), `bandeja arriba: sube a y ${f2(tn?.y)} mm (en la barra ${f2(nt.y)}) sin cortar el aro del llavero`);
  rw.delete(); rh.delete(); ringWall.delete();
  checkNfc('bandeja arriba', top);
  top.dispose();
  const topC = solid({ shape: 'classic', nfc: nfc({ where: 'top' }) });
  ok(topC.info.nfc?.y > topC.mech.ym, `clásica con espacio: el chip queda en la forma de arriba (y ${f2(topC.info.nfc?.y)} mm)`);
  topC.dispose();
  // no logo over the chip: the 📶 sign shows where to tap (unless turned off). It is made like the logo: raised in the
  // accent colour by default, flush (flat finish) or engraved, always right over the chip
  const mk = solid({ logo: { enabled: false }, nfc: nfc() }), plain = solid({ logo: { enabled: false }, nfc: nfc({ mark: false }) });
  ok(mk.info.nfc?.mark && !mk.info.nfc.covered && !plain.info.nfc?.mark && !plain.signArt, 'sin logo encima va la señal 📶 (se puede quitar)');
  ok(!!mk.signArt && mk.signArt.volume() > 5 && Math.abs(mk.body.volume() - plain.body.volume()) < 1e-6, `en relieve: la señal sobresale ${f2(mk.signArt?.volume())} mm³ sin tocar el cuerpo`);
  if (mk.signArt) checkRelief('señal 📶', mk, mk.signArt, mk.body, mk.mech.T, mk.cfg.logo.height);
  const over = (sol) => { const b = sol.signArt?.boundingBox() || sol.body.boundingBox(), n = sol.info.nfc; return b.min[0] > n.x - n.r && b.max[0] < n.x + n.r && b.min[1] > n.y - n.r && b.max[1] < n.y + n.r; };
  ok(over(mk), `la señal queda encima del chip (en x ${f2(mk.info.nfc.x)}, y ${f2(mk.info.nfc.y)})`);
  checkNfc('con señal 📶', mk);
  const fin = (mode, o) => solid({ logo: { enabled: false, mode, flatDepth: 0.6 }, nfc: nfc(o) });
  const inS = fin('flat'), inP = fin('flat', { mark: false }), enS = fin('engrave'), enP = fin('engrave', { mark: false });
  ok(!!inS.signArt && over(inS) && overlap(inS.body, inS.signArt) < 1e-3 && Math.abs(inS.body.volume() + inS.signArt.volume() - inP.body.volume()) < 0.5, 'a ras: la señal llena exacto su hueco');
  checkNfc('señal a ras', inS);
  ok(!enS.signArt && enP.body.volume() - enS.body.volume() > 5 && enS.info.parts.body === 1, `grabada: la señal se hunde ${f2(enP.body.volume() - enS.body.volume())} mm³ en la cara`);
  checkNfc('señal grabada', enS);
  // a small chip keeps the sign printable: lines ≥ 0.8 mm (an inset of 0.36 mm leaves every stroke) and gaps ≥ 0.6 mm
  // (a 0.29 mm outset merges none)
  const sm = solid({ logo: { enabled: false }, nfc: nfc({ diameter: 12 }) });
  const sgn = sm.signArt ? sm.signArt.slice(sm.mech.T + 0.4) : null;
  const thin = sgn?.offset(-0.36, 'Round'), fat = sgn?.offset(0.29, 'Round');
  ok(!!sgn && sgn.numContour() === 4 && thin.numContour() === 4 && fat.numContour() === 4, `chip de Ø12: la señal mantiene sus 4 trazos imprimibles (${sgn?.numContour()} / ${thin?.numContour()} / ${fat?.numContour()})`);
  checkNfc('chip de Ø12', sm);
  sgn?.delete(); thin?.delete(); fat?.delete(); sm.dispose();
  for (const s of [inS, inP, enS, enP]) s.dispose();
  // in the 3MF it is its own piece, in the accent colour
  const bs = buildPhoneStand({ logo: { enabled: false }, nfc: nfc() }, { logoImage, font });
  const sp = bs.parts.find((p) => p.name === 'Señal NFC');
  ok(sp?.filamentIndex === 1 && sp.art && !sp.preview && watertight(sp.geometry), 'la señal sale como pieza propia en el color de acento (filamento 2)');
  const bx = phoneStandExport(bs);
  const sz = unzipSync(threeMF(bx.parts, 'Soporte', { pauses: bx.pauses, assemblies: bx.assemblies }));
  ok(strFromU8(sz['3D/3dmodel.model']).includes('name="Señal NFC"'), 'el 3MF trae la pieza «Señal NFC»');
  mk.dispose(); plain.dispose();
  // the info says what to tap: the logo, or the brand text when only the text is over the chip
  const ul = solid({ nfc: nfc() }), ut = solid({ logo: { enabled: false }, text: { enabled: true, value: 'Pabonitas' }, nfc: nfc({ where: 'bar' }) });
  ok(ul.info.nfc?.under === 'logo' && ut.info.nfc?.covered && ut.info.nfc.under === 'texto' && !ut.info.nfc.mark && mk.info.nfc.under === null,
    `se sabe dónde tocar: el ${ul.info.nfc?.under} / el ${ut.info.nfc?.under}`);
  ul.dispose(); ut.dispose();
  // a chip that does not fit at first makes the shape longer
  const fl0 = solid({ shape: 'flower' }), fl = solid({ shape: 'flower', nfc: nfc() });
  const g = fl.info.shape;
  ok(!!fl.info.nfc && g.grow > 0 && g.growFor.join() === 'nfc' && Math.abs(g.yTop - (fl0.info.shape.yTop + g.grow)) < 1e-6 && fl0.info.shape.grow === 0, `flor: se alarga ${g.grow} mm para que quepa la bandeja`);
  checkNfc('flor alargada', fl);
  fl0.dispose(); fl.dispose();
  // a chip that never fits: warning, no slot, tray, pocket nor pause, and the shape is not stretched for nothing
  for (const mount of ['tray', 'pause']) {
    const nv0 = solid({ shape: 'classic', width: 30 }), nv = solid({ shape: 'classic', width: 30, nfc: nfc({ diameter: 40, mount }) });
    ok(!nv.info.nfc && !nv.chip && !nv.tray && nv.pauses.length === 0 && nv.warnings.some((w) => w.includes('no cabe')), `chip de Ø40 que no cabe (${mount}) → aviso, sin hueco ni pausa`);
    ok(nv.info.shape.grow === 0 && nv.info.shape.yTop === nv0.info.shape.yTop && Math.abs(nv.body.volume() - nv0.body.volume()) < 1e-6, `y la forma no se estira en vano (${mount})`);
    nv0.dispose(); nv.dispose();
  }
  // under an engraved logo the chip keeps 0.8 mm under the logo's floor (and under a flat one too)
  for (const [label, logo, cap] of [['grabado 1,2 mm', { mode: 'engrave', depth: 1.2 }, 2], ['liso 1 mm', { mode: 'flat', flatDepth: 1 }, 1.8]]) {
    const sol = solid({ logo, nfc: nfc() });
    ok(sol.info.nfc?.covered && sol.mech.T - sol.info.nfc.z1 >= cap - 1e-9 && sol.info.parts.body === 1 && sol.info.parts.tray === 1, `bajo un logo ${label}: ${f2(sol.mech.T - sol.info.nfc?.z1)} mm de tapa`);
    checkNfc(`bajo logo ${label}`, sol);
    sol.dispose();
  }
}

// ------------------------------------------------------------------ can opener: side, turned slit, growing shape
console.log('Abre latas (lado, giro y alargue):');
{
  const l = solid({ opener: { enabled: true, side: 'left' } });
  ok(l.info.opener?.sg === -1, 'abre latas a la izquierda');
  checkOpener('corazón izquierda', l);
  l.dispose();
  const rc = solid({ shape: 'circle', opener: { enabled: true } });
  ok(rc.info.opener && rc.info.opener.angle !== 0, `círculo: ranura girada ${rc.info.opener?.angle}° para quedar de frente al borde curvo`);
  checkOpener('círculo (ranura girada)', rc);
  rc.dispose();
  // no free 16 mm edge at first (the mouse's ears, the short variant's small shapes): the shape grows until there is
  for (const [label, cfg] of [['ratón', { shape: 'mouse' }], ['estrella corta', { shape: 'star', variant: 'short' }], ['corona corta', { shape: 'crown', variant: 'short' }]]) {
    const sol = solid({ ...cfg, opener: { enabled: true } });
    const g = sol.info.shape;
    // (a small logo on a small shape may get its thickening notice: that one is about the logo, not the opener)
    ok(!!sol.info.opener && g.grow > 0 && g.growFor.join() === 'opener' && sol.warnings.filter((w) => !w.includes('trazos')).length === 0, `${label}: se alarga ${g.grow} mm para que quepa el abre latas`);
    checkOpener(label, sol);
    sol.dispose();
  }
  const big = solid({ shape: 'mouse', shapeScale: 120, opener: { enabled: true } });
  ok(!!big.info.opener && big.info.shape.grow === 0, 'ratón al 120 %: cabe sin alargarlo');
  big.dispose();
}

// ------------------------------------------------------------------ logo/text places and modes
console.log('Logo y texto (lugar y modo):');
{
  const a = solid({ logo: { where: 'bar' } });
  const ab = a.info.art.bar;
  ok(!a.topArt && !!a.barArt && ab?.logo && !a.info.art.top, `logo en la barra (${f2(ab?.w)} × ${f2(ab?.h)} mm)`);
  if (a.barArt) checkRelief('logo en la barra', a, a.barArt, a.body, a.mech.T, a.cfg.logo.height);
  ok(ab && ab.cy - ab.h / 2 >= a.mech.yh0 - 1e-6 && ab.cy + ab.h / 2 <= a.mech.ym + 1e-6, 'el logo de la barra queda entre la bisagra y la forma');
  a.dispose();
  const b = solid({ text: { enabled: true, where: 'top', value: 'Pabonitas' } });
  ok(b.info.art.top?.logo && b.info.art.top.text && !b.barArt, 'logo y texto juntos arriba');
  ok(Math.abs(b.info.art.top.cap / b.info.art.top.h - 0.28 / 1.4) < 0.15, `texto a ~28 % del logo (cap ${f2(b.info.art.top.cap)} mm)`);
  b.dispose();
  const sh = solid({ variant: 'short', text: { enabled: true, value: 'Pabonitas' } });
  ok(!sh.barArt && sh.info.art.top?.text && sh.info.art.top.logo, 'variante corta (sin barra): el texto se une al logo arriba');
  sh.dispose();
  const heart = solid({});
  const ring = heart.info.ring, top = heart.info.art.top;
  ok(ring.y > top.cy + top.h / 2, 'el aro del corazón va arriba del logo, en el hueco entre los lóbulos');
  heart.dispose();
  const noLogo = solid({ logo: { enabled: false } });
  const eng = solid({ logo: { mode: 'engrave', depth: 0.6 } });
  ok(!eng.topArt && eng.body.volume() < noLogo.body.volume() - 5 && overhangs(eng.body).area < 0.01, 'grabado: el logo se hunde en el cuerpo, sin voladizos');
  // the hollow of a traced multi-colour logo is clean: once its cut left ramps of body inside it
  const clean = (sol, z) => { const s = sol.body.slice(z), x = s.intersect(sol.art.top.cs), a = x.area(); s.delete(); x.delete(); return a; };
  const le = clean(eng, eng.mech.T - 0.3);
  ok(le < 1e-3, `grabado: el hueco queda limpio (${le.toExponential(1)} mm² de cuerpo dentro)`);
  const inl = solid({ logo: { mode: 'flat', flatDepth: 0.6 } }), T = inl.mech.T;
  const bb = inl.topArt.boundingBox();
  ok(Math.abs(bb.min[2] - (T - 0.6)) < 1e-3 && Math.abs(bb.max[2] - T) < 1e-3, 'liso (tipo llavero): las capas del logo quedan a ras de la cara');
  const vp = inl.artPieces.reduce((t, p) => t + p.solid.volume(), 0), cross = inl.artPieces.reduce((t, p) => t + overlap(inl.body, p.solid), 0);
  ok(cross < 1e-3 && Math.abs(inl.body.volume() + vp - noLogo.body.volume()) < 0.5, `liso: llenan exacto su hueco (${cross.toExponential(1)} mm³ de cruce con el cuerpo)`);
  const lf = clean(inl, T - 0.3);
  ok(lf < 1e-3, `liso: el hueco queda limpio, sin rampas del cuerpo (${lf.toExponential(1)} mm²)`);
  noLogo.dispose(); eng.dispose(); inl.dispose();
  const tiny = solid({ text: { enabled: true, value: 'Pabonitas', size: 40 } });
  ok(tiny.warnings.some((w) => w.includes('trazos')) && tiny.warnings.some((w) => w.includes('pequeño')), 'texto chico → avisos de trazos finos y de tamaño');
  tiny.dispose();
  const gone = solid({ text: { enabled: true, value: 'Pabonitas', size: 20 } });
  ok(!gone.barArt && gone.warnings.filter((w) => w.includes('no se genera')).length === 1 && !gone.warnings.some((w) => w.includes('vacío')), `texto demasiado chico para imprimirse → un solo aviso y no se genera (${gone.warnings.join(' | ')})`);
  gone.dispose();
  const cu = solid({ shape: 'custom' }, { shapeImage: logoImage });
  ok(cu.info.shape.id === 'custom' && cu.info.parts.body === 1 && cu.body.status() === 'NoError', 'silueta propia desde una imagen');
  cu.dispose();
  const cu0 = solid({ shape: 'custom' });
  ok(cu0.info.shape.id === 'classic' && cu0.warnings.some((w) => w.includes('Sube una imagen')), 'sin imagen, "Tu silueta" usa la clásica y avisa');
  cu0.dispose();
}

// ------------------------------------------------------------------ logo by colour layers (like the keychains), flat tag finish, fine strokes, text colour
console.log('Logo por capas de color, acabado liso y trazos finos:');
{
  const synth = (w, h, paint) => {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = paint(x, y), i = (y * w + x) * 4; if (c) { data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255; } }
    return { data, width: w, height: h };
  };
  // red disc, blue square and green bar on a transparent background
  const tri = synth(600, 400, (x, y) => (Math.hypot(x - 150, y - 160) < 120 ? [220, 30, 30] : x > 330 && x < 570 && y > 40 && y < 280 ? [30, 60, 220] : y > 310 && y < 380 && x > 30 && x < 570 ? [30, 170, 60] : null));
  const s0 = solid({}, { logoImage: tri }), T = s0.mech.T, H = s0.cfg.logo.height;
  const keys = s0.info.logo.map((e) => e.key);
  ok(keys.length === 3 && s0.artPieces.length === 3 && s0.artPieces.every((p) => p.kind === 'logo' && p.height === H) && s0.warnings.length === 0, `detecta sus 3 colores (${keys.join(', ')}): una pieza por color`);
  for (const p of s0.artPieces) checkRelief(`capa ${p.key}`, s0, p.solid, s0.body, T, H);
  let cross = 0;
  for (let i = 0; i < s0.artPieces.length; i++) for (let j = i + 1; j < s0.artPieces.length; j++) cross += overlap(s0.artPieces[i].solid, s0.artPieces[j].solid);
  ok(cross < 0.01, `las capas no se pisan (${cross.toExponential(1)} mm³)`);
  s0.dispose();
  const ch = (k, i) => parseInt(k.slice(1 + 2 * i, 3 + 2 * i), 16);
  const red = keys.find((k) => ch(k, 0) > 150), blue = keys.find((k) => ch(k, 2) > 150), green = keys.find((k) => k !== red && k !== blue);
  const body = DEFAULT_PHONESTAND().colors.body;
  // red printed yellow and 1.6 mm high, blue off, green in the body's colour
  const layers = { [red]: { color: '#ffd400', height: 1.6 }, [blue]: { on: false }, [green]: { color: body } };
  const by = (sol) => Object.fromEntries(sol.artPieces.map((p) => [p.key, p])), entry = (sol, k) => sol.info.logo.find((e) => e.key === k);
  const rl = solid({ logo: { layers } }, { logoImage: tri }), P = by(rl);
  ok(!P[blue] && entry(rl, blue)?.skipped === 'off' && !entry(rl, blue).used, 'una capa apagada no se imprime');
  ok(P[red]?.color === '#ffd400' && P[green]?.color === body && P[red].height === 1.6 && P[green].height === H, 'relieve: cada capa con su color y su altura');
  if (P[red]) checkRelief('capa a 1,6 mm', rl, P[red].solid, rl.body, T, 1.6);
  if (P[green]) checkRelief(`capa a ${H} mm`, rl, P[green].solid, rl.body, T, H);
  rl.dispose();
  // flat (keychain tag): flush, a piece per colour; a layer in the body's colour is left to the body itself
  const fl = solid({ logo: { mode: 'flat', layers } }, { logoImage: tri }), F = by(fl), fd = fl.cfg.logo.flatDepth;
  ok(Object.keys(F).join() === red && entry(fl, green)?.skipped === 'body' && entry(fl, red).used, 'liso: la capa del color del cuerpo la pone el cuerpo');
  const fb = F[red]?.solid.boundingBox();
  ok(!!fb && Math.abs(fb.min[2] - (T - fd)) < 1e-3 && Math.abs(fb.max[2] - T) < 1e-3 && overlap(fl.body, F[red].solid) < 1e-3, `liso: la capa amarilla a ras, ${fd} mm de hondo`);
  fl.dispose();
  // engraved: the layers that print sink into the face, no pieces
  const en = solid({ logo: { mode: 'engrave', layers } }, { logoImage: tri }), en0 = solid({ logo: { mode: 'engrave', enabled: false } });
  ok(en.artPieces.length === 0 && en0.body.volume() - en.body.volume() > 5 && entry(en, blue)?.skipped === 'off', `grabado: se hunde ${f2(en0.body.volume() - en.body.volume())} mm³, sin piezas`);
  en.dispose(); en0.dispose();
  // a single 0.2 mm layer (smooth tag): the body plus the logo's colours give back the plain piece, nothing overlaps
  const one = solid({ logo: { mode: 'flat', flatDepth: 0.2 } }), one0 = solid({ logo: { mode: 'flat', flatDepth: 0.2, enabled: false } });
  const vp = one.artPieces.reduce((t, p) => t + p.solid.volume(), 0);
  let ov = one.artPieces.reduce((t, p) => t + overlap(one.body, p.solid), 0);
  for (let i = 0; i < one.artPieces.length; i++) for (let j = i + 1; j < one.artPieces.length; j++) ov += overlap(one.artPieces[i].solid, one.artPieces[j].solid);
  ok(one.artPieces.length === 3 && one.artPieces.every((p) => { const b = p.solid.boundingBox(); return Math.abs(b.min[2] - (T - 0.2)) < 1e-3 && Math.abs(b.max[2] - T) < 1e-3; }), 'liso de una capa: los 3 colores en la última capa (0,2 mm)');
  ok(Math.abs(one.body.volume() + vp - one0.body.volume()) < 0.1 && ov < 0.01, `y encajan sin huecos ni cruces (Δ ${f2(one.body.volume() + vp - one0.body.volume())} mm³, cruces ${ov.toExponential(1)} mm³)`);
  one.dispose(); one0.dispose();
  // fine strokes: 3 px lines (~0.25 mm at this size) are thickened to the minimum line, so they print and never break
  const thin = synth(400, 280, (x, y) => {
    const frame = x < 30 || x >= 370 || y < 30 || y >= 250;
    const lines = (y > 60 && y < 220 && [80, 140, 200, 260, 320].some((c) => Math.abs(x - c) <= 1)) || (Math.abs(y - 140) <= 1 && x > 40 && x < 360);
    return frame || lines ? [20, 20, 20] : null;
  });
  for (const minLine of [0.3, 0.5, 0.8]) {
    const s = solid({ logo: { minLine } }, { logoImage: thin });
    const sec = s.topArt.slice(T + 0.4), inset = sec.offset(-(minLine / 2 - 0.03), 'Round', 2, 24);
    ok(sec.numContour() === 3 && inset.numContour() === 3, `trazo mínimo ${minLine} mm: las líneas de 0,25 mm quedan enteras y de ≥ ${minLine} mm (${sec.numContour()} → ${inset.numContour()} contornos)`);
    if (minLine !== 0.5) ok(s.warnings.some((w) => w.includes('trazos')) === (minLine > 0.5), `trazo mínimo ${minLine} mm: ${minLine > 0.5 ? 'avisa que engrosó mucho' : 'engrosa poco, sin aviso'}`);
    sec.delete(); inset.delete(); s.dispose();
  }
  // a 0.2 mm outline with a dashed ring 0.3 mm outside it (like the Pabonitas logo): the thickening follows the centre
  // lines (a smooth edge, ≈ the minimum line, not twice it) and keeps the gap, so the dashes never fuse into the
  // outline as blobs (they used to: one 1 mm band, beaded edges)
  {
    const R = 300, dashed = synth(2 * R + 60, 2 * R + 60, (x, y) => {
      const c = R + 30, d = Math.hypot(x - c, y - c), a = Math.atan2(y - c, x - c);
      return Math.abs(d - (R - 10)) <= 2 || (Math.abs(d - R) <= 2 && ((a + Math.PI) * R) % 24 < 14) ? [40, 30, 20] : null;
    });
    const s = solid({}, { logoImage: dashed }), polys = s.art.top.cs.toPolygons(), mmPx = s.info.art.top.w / (2 * R + 4);
    const centroid = (p) => { let a = 0, x = 0, y = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const f = p[j][0] * p[i][1] - p[i][0] * p[j][1]; a += f; x += (p[j][0] + p[i][0]) * f; y += (p[j][1] + p[i][1]) * f; } return { a: Math.abs(a / 2), x: x / (3 * a), y: y / (3 * a) }; };
    const o = polys.map(centroid).sort((p, q) => q.a - p.a)[0];
    const rings = polys.map((p) => { const r = p.map(([x, y]) => Math.hypot(x - o.x, y - o.y)); return { min: Math.min(...r), max: Math.max(...r), mean: r.reduce((t, v) => t + v, 0) / r.length }; }).sort((p, q) => p.mean - q.mean);
    const [hole, rim] = rings, dashes = rings.filter((r) => r.mean > rim.mean + 0.05).length, width = rim.mean - hole.mean;
    ok(mmPx > 0.04 && mmPx < 0.07 && dashes >= 70, `rayitas a 0,3 mm de un contorno de 0,2 mm: quedan separadas, sin fundirse en manchas (${dashes} de 78; ${f2(mmPx * 4)} mm de trazo)`);
    ok(width > 0.38 && width < 0.65 && hole.max - hole.min < 0.11, `el contorno se engrosa liso a ≈ el trazo mínimo, no al doble (${f2(width)} mm, borde ±${f2((hole.max - hole.min) / 2)} mm)`);
    s.dispose();
  }
  // every colour of the logo keeps its piece: with the text on the bar the mouse's logo moved 0.001 mm, the tiling left
  // zero-width seams in its last colour and the shrink that cleans each piece came out empty, so the purple was gone
  for (const [label, cfg] of [['ratón + texto', { shape: 'mouse', text: EXTRAS.text }], ['ratón con todo', { shape: 'mouse', ...EXTRAS }], ['corazón + texto', { text: EXTRAS.text }]]) {
    const s = solid(cfg), got = s.artPieces.filter((p) => p.kind === 'logo').map((p) => p.key);
    ok(s.info.logo.length === 3 && s.info.logo.every((e) => e.used && got.includes(e.key)), `${label}: los ${s.info.logo.length} colores del logo tienen su pieza (${got.join(', ')})`);
    s.dispose();
  }
  // the text's own colour and height
  const tx = solid({ text: { enabled: true, value: 'Pabonitas', color: '#1e90ff', height: 1.2 } });
  const tp = tx.artPieces.find((p) => p.kind === 'text');
  ok(tp?.color === '#1e90ff' && tp.height === 1.2 && Math.abs(tp.solid.boundingBox().max[2] - (T + 1.2)) < 1e-3, 'el texto con su propio color y altura');
  tx.dispose();
}

// ------------------------------------------------------------------ the heart reads as a heart; big tops stay behind the front edge
console.log('Corazón y formas grandes:');
{
  // highest point of the outline on the vertical line x = v
  const topAt = (polys, v) => {
    let m = -Infinity;
    for (const p of polys) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const A = p[j], B = p[i];
      if ((A[0] > v) !== (B[0] > v)) m = Math.max(m, A[1] + ((v - A[0]) / (B[0] - A[0])) * (B[1] - A[1]));
    }
    return m;
  };
  const h = solid({});
  const hb = h.outline.bounds(), ratio = (hb.max[0] - hb.min[0]) / h.mech.W, cleft = hb.max[1] - topAt(h.outline.toPolygons(), 0);
  ok(ratio >= 1.5, `corazón ${f2(ratio)} veces el ancho del cuerpo: sus lados se ven bajar hasta el cuerpo`);
  ok(cleft >= 2.5, `el hueco entre los lóbulos se ve (${f2(cleft)} mm) aun con el aro`);
  h.dispose();
  for (const s of PHONESTAND_SHAPES) {
    const sol = solid({ shape: s.id, shapeScale: 140 }, { shapeImage: logoImage });
    const y0 = sol.outline.bounds().min[1];
    ok(y0 > -0.01 && sol.info.parts.body === 1 && sol.info.parts.leg === 1, `${s.id} al 140 %: nada sobresale del borde delantero (y mín. ${f2(y0)} mm)`);
    sol.dispose();
  }
}

// ------------------------------------------------------------------ exported parts (what goes into the 3MF/STL)
console.log('Piezas exportadas:');
{
  const r = buildPhoneStand({ ...EXTRAS }, { logoImage, font });
  const names = r.parts.map((p) => p.name), fil = (res) => res.parts.map((p) => p.filamentIndex).join();
  ok(JSON.stringify(names) === JSON.stringify(['Cuerpo', 'Pata (bisagra)', 'Logo · color 1', 'Logo · color 2', 'Logo · color 3', 'Texto (barra)', 'Bandeja NFC', 'Chip NFC']), `piezas: ${names.join(', ')}`);
  ok(r.parts.every((p) => watertight(p.geometry)), 'todas las mallas son cerradas');
  ok(r.parts.filter((p) => p.moving).map((p) => p.name).join() === 'Pata (bisagra)', 'solo la pata gira con la bisagra');
  const prev = r.parts.filter((p) => p.preview);
  ok(prev.length === 1 && prev[0].name === 'Chip NFC' && prev[0].filamentIndex === -1, 'el chip NFC es solo vista previa (sin filamento)');
  ok(fil(r) === '0,0,1,2,3,4,0,-1' && r.filaments.length === 5, `filamentos ${fil(r)} (uno por color del logo, el texto en el de acento, la bandeja en el del cuerpo)`);
  ok(r.warnings.some((w) => w.includes('5 colores de filamento')), 'más de 4 colores → avisa (un AMS tiene 4)');
  ok(r.axis.y === r.info.hinge.axis.y && r.axis.z === r.info.hinge.axis.z && r.phone?.attributes?.position?.count > 0, 'eje de la bisagra y celular de muestra para la vista');
  const ex = phoneStandExport(r);
  const zip = unzipSync(threeMF(ex.parts, 'Soporte', { pauses: ex.pauses, assemblies: ex.assemblies }));
  const model = strFromU8(zip['3D/3dmodel.model']);
  ok(ex.parts.length === 7 && ex.parts.every((p) => model.includes(`name="${p.name}"`)) && !model.includes('Chip NFC') && !zip['Metadata/custom_gcode_per_layer.xml'], '3MF con las 7 piezas por nombre, sin el chip ni pausas');
  // the pause mount instead: one object and the pause to drop the chip in
  const rp = buildPhoneStand({ ...EXTRAS, nfc: { enabled: true, mount: 'pause' } }, { logoImage, font });
  const ep = phoneStandExport(rp);
  const zp = unzipSync(threeMF(ep.parts, 'Soporte', { pauses: ep.pauses, assemblies: ep.assemblies }));
  const gcode = strFromU8(zp['Metadata/custom_gcode_per_layer.xml'] || new Uint8Array());
  ok(ep.assemblies.length === 1 && !rp.parts.some((p) => p.apart) && gcode.includes(`top_z="${rp.info.nfc.z1}"`) && gcode.includes(NFC_PAUSE_MSG), `modo pausa: 3MF de un objeto con la pausa del NFC en z ${rp.info.nfc.z1}`);
  // the logo's white printed with the body's filament: 4 colours, fits an AMS
  const lum = (h) => [1, 3, 5].reduce((t, i) => t + parseInt(h.slice(i, i + 2), 16), 0);
  const white = r.info.logo.reduce((a, e) => (lum(e.key) > lum(a.key) ? e : a)).key;
  const j = buildPhoneStand({ ...EXTRAS, logo: { layers: { [white]: { color: DEFAULT_PHONESTAND().colors.body } } } }, { logoImage, font });
  ok(j.filaments.length === 4 && !j.warnings.some((w) => w.includes('colores de filamento')) && j.parts.find((p) => p.layer === white)?.filamentIndex === 0, `el ${white} del logo con el filamento del cuerpo → 4 colores, cabe en un AMS`);
  const acc = buildPhoneStand({ ...EXTRAS, colors: { flapAccent: true } }, { logoImage, font });
  ok(fil(acc) === '0,1,2,3,4,1,0,-1', `pata en el color de acento (${fil(acc)})`);
  const mono = buildPhoneStand({ ...EXTRAS, colors: { twoColor: false } }, { logoImage, font });
  ok(mono.parts.filter((p) => !p.preview).every((p) => p.filamentIndex === 0) && mono.filaments.length === 1, 'un solo color → todo en el filamento 1');
}

// ------------------------------------------------------------------ mechanism, settings, 1.17 migration, thumbnails, project file
console.log('Mecanismo, ajustes y proyecto:');
{
  const m = phoneStandMechanism({}), ms = phoneStandMechanism({ variant: 'short' });
  ok(m.poses.print === 0 && m.poses.stand < 0 && m.poses.closed === 85, `poses: impresa 0°, abierta ${f2(m.poses.stand)}°, cerrada ${m.poses.closed}°`);
  ok(m.ym - m.yh0 === 22 && ms.ym === ms.yh0, 'la barra solo existe en la variante estándar');
  ok(PHONESTAND_SIZES.map((s) => s.id).join() === 'small,large' && PHONESTAND_VARIANTS.map((s) => s.id).join() === 'standard,short', '2 tamaños y 2 variantes');

  const raw = { width: 100, clearance: 0, pin: 9, latch: 2, size: 'huge', variant: 'x', shape: 'dragon', nfc: { where: 'x', diameter: 2 }, logo: { mode: 'x', size: 999, where: 'flap' }, text: { value: 'x'.repeat(60), font: 'Comic' }, colors: { body: 'red' }, opener: { side: 'LEFT' } };
  const before = JSON.stringify(raw);
  const n = normalizePhoneStand(raw), D = DEFAULT_PHONESTAND();
  ok(n.width === 46 && n.clearance === 0.2 && n.pin === 4.5 && n.latch === 0.6 && n.size === 'small' && n.variant === 'standard', 'medidas fuera de rango se ajustan');
  ok(n.shape === 'heart' && n.nfc.where === 'auto' && n.nfc.diameter === 10 && n.logo.where === 'bar', 'forma, lugar del NFC y del logo válidos');
  ok(n.logo.mode === 'relief' && n.logo.size === 150 && n.text.value.length === 40 && n.text.font === D.text.font, 'modo, tamaño, texto y fuente válidos');
  ok(n.colors.body === D.colors.body && n.opener.side === 'right' && n.ring.enabled === true && n.nfc.mark === true, 'colores, lado y señal 📶 por defecto');
  ok(JSON.stringify(raw) === before, 'no modifica la configuración recibida');
  // 1.20: NFC tray/side, colour layers, minimum line, flat finish in whole layers, text colour and height
  const nn = normalizePhoneStand({
    nfc: { mount: 'x', side: 'up' }, text: { color: 'blue', height: 9 },
    logo: { colors: 9, tolerance: 1, minLine: 5, flatDepth: 0.75, layers: { '#ABCDEF': { color: 'red', height: 9, on: false }, nope: { on: false }, '#123456': 5 } },
  });
  ok(nn.nfc.mount === 'tray' && nn.nfc.side === 'auto' && normalizePhoneStand({ nfc: { mount: 'pause', side: 'left' } }).nfc.side === 'left', 'NFC: bandeja por defecto, lado automático');
  ok(nn.logo.colors === 6 && nn.logo.tolerance === 5 && nn.logo.minLine === 1.2 && nn.logo.flatDepth === 0.8 && normalizePhoneStand({ logo: { flatDepth: 0 } }).logo.flatDepth === 0.2, 'colores, tolerancia, trazo mínimo y profundidad lisa (capas enteras de 0,2 mm) válidos');
  ok(JSON.stringify(nn.logo.layers) === JSON.stringify({ '#abcdef': { color: '#abcdef', height: 3, on: false } }), `capas del logo válidas (${JSON.stringify(nn.logo.layers)})`);
  ok(nn.text.color === '' && nn.text.height === 3 && normalizePhoneStand({ text: { color: '#1E90FF' } }).text.color === '#1e90ff', 'color y altura del texto válidos');
  // 1.19 'inlay' (flush, its depth was logo.depth) → the flat multicolour finish
  const li = normalizePhoneStand({ logo: { mode: 'inlay', depth: 0.6 } });
  ok(li.logo.mode === 'flat' && li.logo.flatDepth === 0.6, 'el incrustado de la 1.19 pasa a liso con su profundidad');
  // 1.17 cards (flat card + flap): their look is kept, the hinge measures restart from the new defaults
  const v1 = { shape: 'mouse', width: 58, thickness: 7.5, flapLength: 40, phoneAngle: 60, rail: true, clearance: 0.5, pin: 2.5, logo: { where: 'flap', mode: 'engrave' }, nfc: { enabled: true, where: 'flap' }, text: { enabled: true, where: 'flap', value: 'Ana' } };
  const mv = normalizePhoneStand(v1);
  ok(mv.width === D.width && mv.clearance === D.clearance && mv.pin === D.pin && !['thickness', 'flapLength', 'phoneAngle', 'rail'].some((k) => k in mv), 'configuración 1.17: la bisagra vuelve a las medidas nuevas');
  ok(mv.shape === 'mouse' && mv.logo.where === 'bar' && mv.logo.mode === 'engrave' && mv.nfc.enabled && mv.nfc.where === 'bar' && mv.text.where === 'bar' && mv.text.value === 'Ana', 'y conserva forma, logo, texto y NFC (tapa → barra)');
  ok(normalizePhoneStand({ size: 'small', width: 40 }).width === 40, 'un ancho nuevo se respeta');

  const th = shapeThumbnails({});
  ok(PHONESTAND_SHAPES.every((s) => th[s.id]?.d.startsWith('M') && th[s.id].viewBox.split(' ').map(Number).every(Number.isFinite)), 'miniaturas SVG de las 11 formas');
  ok(th.custom.custom === true, 'sin imagen, "Tu silueta" se muestra como clásica');

  const cfg = { ...D, shape: 'mouse', size: 'large', variant: 'short', nfc: { enabled: true, where: 'bar' }, text: { enabled: true, value: 'Ana' } };
  const txt = phoneStandProject(cfg, { logoSrc: 'data:image/png;base64,AAAA', shapeSrc: 'https://example.com/x.png' });
  const back = readPhoneStandProject(txt);
  ok(JSON.parse(txt).version === 3 && JSON.stringify(back.cfg) === JSON.stringify(normalizePhoneStand(cfg)) && back.logoSrc === 'data:image/png;base64,AAAA' && back.shapeSrc === null, 'proyecto .r3p v3: guarda y abre igual (solo imágenes data:)');
  const old = readPhoneStandProject({ app: PHONESTAND_PROJECT_APP, version: 1, cfg: v1 });
  ok(old.cfg.width === D.width && old.cfg.logo.where === 'bar' && old.cfg.shape === 'mouse', 'abre proyectos de la 1.17 (v1) ya migrados');
  const v2 = readPhoneStandProject({ app: PHONESTAND_PROJECT_APP, version: 2, cfg: { shape: 'flower', logo: { mode: 'inlay', depth: 0.8 }, nfc: { enabled: true } } });
  ok(v2.cfg.shape === 'flower' && v2.cfg.logo.mode === 'flat' && v2.cfg.logo.flatDepth === 0.8 && v2.cfg.nfc.mount === 'tray', 'abre proyectos de la 1.19 (v2): incrustado → liso, NFC en bandeja');
  const throws = (x) => { try { readPhoneStandProject(x); return false; } catch { return true; } };
  ok(throws('{') && throws({ app: 'Otro', cfg: {} }) && throws({ ...JSON.parse(txt), version: 4 }), 'rechaza archivos ajenos o de otra versión');
}

console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (fails) { console.log(`phonestand FAILED (${fails})`); process.exit(1); }
console.log('phonestand OK');

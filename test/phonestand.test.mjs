// Soporte de celular llavero (print-in-place): every decorative top, in both variants, gives watertight one-piece
// parts; the leg (printed standing on its 45° cone pins) swings free from its stand stop to its closed snap; the
// phone rests on the leg and in the groove; and the NFC pocket (with its see-through chip preview and tap sign),
// can-tab opener and key-ring hole are printable and where they must be.
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { unzipSync, strFromU8 } from 'fflate';
import { parse } from '../node_modules/opentype.js/dist/opentype.mjs';
import { threeMF } from '../src/core/exporters.js';
import {
  preparePhoneStand, PHONESTAND_SHAPES, PHONESTAND_SIZES, PHONESTAND_VARIANTS, DEFAULT_PHONESTAND, normalizePhoneStand,
  phoneStandMechanism, phoneStandSolids, buildPhoneStand, shapeThumbnails, phoneStandProject, readPhoneStandProject,
  NFC_PAUSE_MSG, PHONESTAND_PROJECT_APP,
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

// sealed pocket ≥ 1.2 mm under the face (≥ 0.8 under a sunk logo or the tap sign), layer-aligned, pause at its top,
// and the see-through chip shown in the app inside it
function checkNfc(label, sol) {
  const n = sol.info.nfc, T = sol.mech.T;
  ok(!!n, `${label}: chip NFC colocado`);
  if (!n) return;
  const sunk = (n.covered || n.mark) && sol.cfg.logo.mode !== 'relief' ? sol.cfg.logo.depth : 0;
  ok(T - n.z1 >= Math.max(1.2, sunk + 0.8) - 1e-9 && n.z0 >= 0.8 && Math.abs(n.z1 / 0.2 - Math.round(n.z1 / 0.2)) < 1e-6, `${label}: bolsillo NFC z ${n.z0}–${n.z1} alineado a capas, ${f2(T - n.z1)} mm bajo la cara`);
  ok(sol.pauses.length === 1 && sol.pauses[0].z === n.z1 && sol.pauses[0].msg === NFC_PAUSE_MSG, `${label}: pausa para el chip en z ${n.z1}`);
  const pocket = cyl(n.x, n.y, n.r - 0.2, n.z0 + 0.05, n.z1 - 0.05), cover = cyl(n.x, n.y, n.r - 1, n.z1 + 0.05, T - sunk - 0.05);
  ok(overlap(sol.body, pocket) < 1e-3 && overlap(sol.body, cover) > 0.99 * cover.volume(), `${label}: bolsillo vacío y tapado`);
  pocket.delete(); cover.delete();
  const cb = sol.chip?.boundingBox();
  ok(!!sol.chip && overlap(sol.body, sol.chip) < 1e-3 && cb.min[2] >= n.z0 - 1e-6 && cb.max[2] <= n.z1 + 1e-6, `${label}: chip de vista previa dentro del bolsillo`);
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
        const warn = sol.warnings.filter((w) => !(s.id === 'custom' && w.includes('Sube una imagen')));
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
    checkHinge(label, sol, fixed);
    checkPhone(label, cfg, sol, fixed);
  } finally {
    if (fixed !== sol.body) fixed.delete();
    sol.dispose();
  }
}

// ------------------------------------------------------------------ NFC: place, tap sign, growing shape, chip too big
console.log('Chip NFC (lugar, señal y alargue):');
{
  const nfc = (o = {}) => ({ enabled: true, ...o });
  const bar = solid({ nfc: nfc({ where: 'bar' }) });
  const nb = bar.info.nfc;
  ok(nb?.where === 'bar' && Math.abs(nb.y - (bar.mech.yh0 + nb.r + 1.5)) < 0.05, `en la barra: chip a y ${f2(nb?.y)} mm, justo detrás de la bisagra`);
  checkNfc('en la barra', bar);
  bar.dispose();
  // 'top' = as high up the shape as the key ring lets it (the heart's ring sits in the cleft, right above it)
  const top = solid({ nfc: nfc({ where: 'top' }) });
  ok(top.info.nfc?.where === 'top' && top.info.nfc.y > nb.y + 3, `arriba: sube a y ${f2(top.info.nfc?.y)} mm (en la barra ${f2(nb.y)} mm)`);
  checkNfc('arriba', top);
  top.dispose();
  const topC = solid({ shape: 'classic', nfc: nfc({ where: 'top' }) });
  ok(topC.info.nfc?.y > topC.mech.ym, `clásica con espacio: el chip queda en la forma de arriba (y ${f2(topC.info.nfc?.y)} mm)`);
  topC.dispose();
  // no logo over the chip: the 📶 sign shows where to tap (unless turned off). It is made like the logo: raised in the
  // logo colour by default, inlaid flush or engraved, always right over the chip
  const mk = solid({ logo: { enabled: false }, nfc: nfc() }), plain = solid({ logo: { enabled: false }, nfc: nfc({ mark: false }) });
  ok(mk.info.nfc?.mark && !mk.info.nfc.covered && !plain.info.nfc?.mark && !plain.signArt, 'sin logo encima va la señal 📶 (se puede quitar)');
  ok(!!mk.signArt && mk.signArt.volume() > 5 && Math.abs(mk.body.volume() - plain.body.volume()) < 1e-6, `en relieve: la señal sobresale ${f2(mk.signArt?.volume())} mm³ sin tocar el cuerpo`);
  if (mk.signArt) checkRelief('señal 📶', mk, mk.signArt, mk.body, mk.mech.T, mk.cfg.logo.height);
  const over = (sol) => { const b = sol.signArt?.boundingBox() || sol.body.boundingBox(), n = sol.info.nfc; return b.min[0] > n.x - n.r && b.max[0] < n.x + n.r && b.min[1] > n.y - n.r && b.max[1] < n.y + n.r; };
  ok(over(mk), `la señal queda encima del chip (en x ${f2(mk.info.nfc.x)}, y ${f2(mk.info.nfc.y)})`);
  checkNfc('con señal 📶', mk);
  const inS = solid({ logo: { enabled: false, mode: 'inlay' }, nfc: nfc() }), enS = solid({ logo: { enabled: false, mode: 'engrave' }, nfc: nfc() });
  ok(!!inS.signArt && over(inS) && overlap(inS.body, inS.signArt) < 1e-3 && Math.abs(inS.body.volume() + inS.signArt.volume() - plain.body.volume()) < 0.5, 'a ras: la señal llena exacto su hueco');
  checkNfc('señal a ras', inS);
  ok(!enS.signArt && plain.body.volume() - enS.body.volume() > 5 && enS.info.parts.body === 1, `grabada: la señal se hunde ${f2(plain.body.volume() - enS.body.volume())} mm³ en la cara`);
  checkNfc('señal grabada', enS);
  // a small chip keeps the sign printable: lines ≥ 0.8 mm (an inset of 0.36 mm leaves every stroke) and gaps ≥ 0.6 mm
  // (a 0.29 mm outset merges none)
  const sm = solid({ logo: { enabled: false }, nfc: nfc({ diameter: 12 }) });
  const sgn = sm.signArt ? sm.signArt.slice(sm.mech.T + 0.4) : null;
  const thin = sgn?.offset(-0.36, 'Round'), fat = sgn?.offset(0.29, 'Round');
  ok(!!sgn && sgn.numContour() === 4 && thin.numContour() === 4 && fat.numContour() === 4, `chip de Ø12: la señal mantiene sus 4 trazos imprimibles (${sgn?.numContour()} / ${thin?.numContour()} / ${fat?.numContour()})`);
  sgn?.delete(); thin?.delete(); fat?.delete(); sm.dispose();
  inS.dispose(); enS.dispose();
  // in the 3MF it is its own piece, in the logo colour
  const bs = buildPhoneStand({ logo: { enabled: false }, nfc: nfc() }, { logoImage, font });
  const sp = bs.parts.find((p) => p.name === 'Señal NFC');
  ok(sp?.filamentIndex === 1 && sp.art && !sp.preview && watertight(sp.geometry), 'la señal sale como pieza propia en el color del logo (filamento 2)');
  const sz = unzipSync(threeMF(bs.parts.filter((p) => !p.preview), 'Soporte', { pauses: bs.pauses }));
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
  ok(!!fl.info.nfc && g.grow > 0 && g.growFor.join() === 'nfc' && Math.abs(g.yTop - (fl0.info.shape.yTop + g.grow)) < 1e-6 && fl0.info.shape.grow === 0, `flor: se alarga ${g.grow} mm para que quepa el chip`);
  fl0.dispose(); fl.dispose();
  // a chip that never fits: warning, no pocket nor pause, and the shape is not stretched for nothing
  const nv0 = solid({ shape: 'classic', width: 30 }), nv = solid({ shape: 'classic', width: 30, nfc: nfc({ diameter: 40 }) });
  ok(!nv.info.nfc && !nv.chip && nv.pauses.length === 0 && nv.warnings.some((w) => w.includes('no cabe')), 'chip de Ø40 que no cabe → aviso, sin bolsillo ni pausa');
  ok(nv.info.shape.grow === 0 && nv.info.shape.yTop === nv0.info.shape.yTop && Math.abs(nv.body.volume() - nv0.body.volume()) < 1e-6, 'y la forma no se estira en vano');
  nv0.dispose(); nv.dispose();
  // under an engraved logo the chip keeps 0.8 mm under the logo's floor
  const eng = solid({ logo: { mode: 'engrave', depth: 1.2 }, nfc: nfc() });
  ok(eng.info.nfc?.covered && eng.mech.T - eng.info.nfc.z1 >= 2 - 1e-9 && eng.info.parts.body === 1, `bajo un logo grabado 1,2 mm: ${f2(eng.mech.T - eng.info.nfc?.z1)} mm de tapa`);
  checkNfc('bajo logo grabado', eng);
  eng.dispose();
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
    ok(!!sol.info.opener && g.grow > 0 && g.growFor.join() === 'opener' && sol.warnings.length === 0, `${label}: se alarga ${g.grow} mm para que quepa el abre latas`);
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
  const inl = solid({ logo: { mode: 'inlay', depth: 0.6 } });
  const bb = inl.topArt.boundingBox();
  ok(Math.abs(bb.min[2] - (inl.mech.T - 0.6)) < 1e-3 && Math.abs(bb.max[2] - inl.mech.T) < 1e-3, 'incrustado: pieza a ras de la cara');
  ok(overlap(inl.body, inl.topArt) < 1e-3 && Math.abs(inl.body.volume() + inl.topArt.volume() - noLogo.body.volume()) < 0.5, 'incrustado: llena exacto su hueco');
  noLogo.dispose(); eng.dispose(); inl.dispose();
  const tiny = solid({ text: { enabled: true, value: 'Pabonitas', size: 40 } });
  ok(tiny.warnings.some((w) => w.includes('trazos')) && tiny.warnings.some((w) => w.includes('pequeño')), 'texto chico → avisos de trazos finos y de tamaño');
  tiny.dispose();
  const gone = solid({ text: { enabled: true, value: 'Pabonitas', size: 20 } });
  ok(!gone.barArt && gone.warnings.some((w) => w.includes('vacío')), 'texto demasiado chico para imprimirse → aviso y no se genera');
  gone.dispose();
  const cu = solid({ shape: 'custom' }, { shapeImage: logoImage });
  ok(cu.info.shape.id === 'custom' && cu.info.parts.body === 1 && cu.body.status() === 'NoError', 'silueta propia desde una imagen');
  cu.dispose();
  const cu0 = solid({ shape: 'custom' });
  ok(cu0.info.shape.id === 'classic' && cu0.warnings.some((w) => w.includes('Sube una imagen')), 'sin imagen, "Tu silueta" usa la clásica y avisa');
  cu0.dispose();
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
  ok(JSON.stringify(names) === JSON.stringify(['Cuerpo', 'Pata (bisagra)', 'Logo', 'Texto (barra)', 'Chip NFC']), `piezas: ${names.join(', ')}`);
  ok(r.parts.every((p) => watertight(p.geometry)), 'todas las mallas son cerradas');
  ok(r.parts.filter((p) => p.moving).map((p) => p.name).join() === 'Pata (bisagra)', 'solo la pata gira con la bisagra');
  const prev = r.parts.filter((p) => p.preview);
  ok(prev.length === 1 && prev[0].name === 'Chip NFC' && prev[0].filamentIndex === -1, 'el chip NFC es solo vista previa (sin filamento)');
  ok(fil(r) === '0,0,1,1,-1', `filamentos ${fil(r)} (logo y texto en color de acento)`);
  ok(r.axis.y === r.info.hinge.axis.y && r.axis.z === r.info.hinge.axis.z && r.phone?.attributes?.position?.count > 0, 'eje de la bisagra y celular de muestra para la vista');
  const real = r.parts.filter((p) => !p.preview);
  const zip = unzipSync(threeMF(real, 'Soporte', { pauses: r.pauses }));
  const gcode = strFromU8(zip['Metadata/custom_gcode_per_layer.xml'] || new Uint8Array());
  ok(gcode.includes(`top_z="${r.info.nfc.z1}"`) && gcode.includes(NFC_PAUSE_MSG), `3MF con la pausa del NFC en z ${r.info.nfc.z1}`);
  const model = strFromU8(zip['3D/3dmodel.model']);
  ok(real.every((p) => model.includes(`name="${p.name}"`)) && !model.includes('Chip NFC'), '3MF con las 4 piezas por nombre y sin el chip');
  const acc = buildPhoneStand({ ...EXTRAS, colors: { flapAccent: true } }, { logoImage, font });
  ok(fil(acc) === '0,1,1,1,-1', 'pata en el color de acento');
  const mono = buildPhoneStand({ ...EXTRAS, colors: { twoColor: false } }, { logoImage, font });
  ok(mono.parts.filter((p) => !p.preview).every((p) => p.filamentIndex === 0), 'un solo color → todo en el filamento 1');
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
  ok(JSON.parse(txt).version === 2 && JSON.stringify(back.cfg) === JSON.stringify(normalizePhoneStand(cfg)) && back.logoSrc === 'data:image/png;base64,AAAA' && back.shapeSrc === null, 'proyecto .r3p v2: guarda y abre igual (solo imágenes data:)');
  const old = readPhoneStandProject({ app: PHONESTAND_PROJECT_APP, version: 1, cfg: v1 });
  ok(old.cfg.width === D.width && old.cfg.logo.where === 'bar' && old.cfg.shape === 'mouse', 'abre proyectos de la 1.17 (v1) ya migrados');
  const throws = (x) => { try { readPhoneStandProject(x); return false; } catch { return true; } };
  ok(throws('{') && throws({ app: 'Otro', cfg: {} }) && throws({ ...JSON.parse(txt), version: 3 }), 'rechaza archivos ajenos o de otra versión');
}

console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (fails) { console.log(`phonestand FAILED (${fails})`); process.exit(1); }
console.log('phonestand OK');

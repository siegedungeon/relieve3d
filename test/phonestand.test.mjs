// Soporte de celular llavero (print-in-place): every decorative top gives watertight one-piece parts, the hinge
// swings freely up to its stop with the logo/text on either face, and the NFC pocket, can-tab opener and key-ring
// hole are printable and where they must be.
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { unzipSync, strFromU8 } from 'fflate';
import { parse } from '../node_modules/opentype.js/dist/opentype.mjs';
import { threeMF } from '../src/core/exporters.js';
import {
  preparePhoneStand, PHONESTAND_SHAPES, DEFAULT_PHONESTAND, normalizePhoneStand, phoneStandMechanism, phoneStandSolids,
  buildPhoneStand, shapeThumbnails, phoneStandProject, readPhoneStandProject, NFC_PAUSE_MSG,
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
}

// the flap (with whatever rides on it) never touches the body (with its top art) until it reaches the open angle,
// and the stop catches it right there
function checkSweep(label, sol) {
  const th = sol.mech.thOpen;
  const fixed = sol.topArt ? sol.body.add(sol.topArt) : sol.body;
  const moving = sol.flapArt ? sol.flap.add(sol.flapArt) : sol.flap;
  let early = 0, hitAt = null;
  const angles = [];
  for (let a = 0; a < th - 0.5; a += 1) angles.push(a);
  for (let a = th - 0.5; a <= th + 1.5 + 1e-9; a += 0.25) angles.push(a);
  for (const a of angles) {
    const v = overlap(fixed, sol.rotateOpen(moving, a));
    if (a <= th - 0.5 + 1e-9) early = Math.max(early, v);
    else if (hitAt === null && v > 1e-3) hitAt = a;
  }
  if (fixed !== sol.body) fixed.delete();
  if (moving !== sol.flap) moving.delete();
  ok(early < 1e-3, `${label}: la tapa abre sin rozar hasta ${f2(th - 0.5)}° (máx. ${early.toExponential(1)} mm³)`);
  ok(hitAt !== null, `${label}: el tope frena la tapa a ${hitAt ?? '—'}° (abierta = ${f2(th)}°)`);
}

// relief art lies on the face (bottom 0.3 mm fully inside the part below it) and never over a hole
function checkRelief(label, sol, piece, base, T, h) {
  const bb = piece.boundingBox();
  ok(Math.abs(bb.min[2] - T) < 1e-3 && Math.abs(bb.max[2] - (T + h)) < 1e-3, `${label}: relieve entre z ${f2(bb.min[2])} y ${f2(bb.max[2])}`);
  const foot = lowered(piece, 0.3), v = overlap(base, foot) / (piece.volume() * 0.3 / h);
  foot.delete();
  ok(v > 0.995, `${label}: el relieve se apoya completo sobre la pieza (${(v * 100).toFixed(1)} %)`);
}

// ------------------------------------------------------------------ every shape, plain and with all the extras
console.log('Formas (logo arriba | + NFC, abre latas y texto en la tapa):');
const EXTRAS = { nfc: { enabled: true }, opener: { enabled: true }, text: { enabled: true, value: 'Pabonitas' } };
for (const s of PHONESTAND_SHAPES) {
  for (const extras of [false, true]) {
    const label = s.id + (extras ? '+extras' : '');
    const cfg = { shape: s.id, ...(extras ? EXTRAS : {}) };
    const sol = phoneStandSolids(cfg, { logoImage, font });
    try {
      const I = sol.info, T = sol.mech.T, W = sol.mech.W;
      ok(sol.body.status() === 'NoError' && sol.flap.status() === 'NoError', `${label}: sólidos válidos`);
      ok(I.parts.body === 1 && I.parts.flap === 1 && !sol.warnings.some((w) => w.includes('piezas sueltas')), `${label}: cuerpo y tapa en una pieza cada uno`);
      ok(I.hinge.gap >= 0.9 * I.hinge.clearance, `${label}: holgura tapa/cuerpo ${f2(I.hinge.gap)} mm`);
      ok(I.hinge.socketWall >= 1, `${label}: pared del encaje de la bisagra ${f2(I.hinge.socketWall)} mm`);
      ok(I.stability.portrait >= 4.9, `${label}: no se vuelca con el celular vertical (margen ${f2(I.stability.portrait)} mm)`);
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
      ok(!!sol.topArt && I.art.top.w >= 15, `${label}: logo arriba de ${f2(I.art.top?.w)} mm de ancho`);
      if (sol.topArt) checkRelief(`${label} logo`, sol, sol.topArt, sol.body, T, sol.cfg.logo.height);
      ok(!sol.warnings.some((w) => w.includes('trazos') || w.includes('recorta')), `${label}: logo sin trazos finos ni recortes`);
      if (extras) {
        ok(!!sol.flapArt && I.art.flap.text && I.art.flap.cap >= 3, `${label}: texto en la tapa de ${f2(I.art.flap?.cap)} mm de alto`);
        if (sol.flapArt) checkRelief(`${label} texto`, sol, sol.flapArt, sol.flap, T, sol.cfg.logo.height);
        ok(!sol.warnings.some((w) => w.includes('trazos') || w.includes('pequeño')), `${label}: "Pabonitas" sin avisos de trazos finos`);
        // NFC (auto): in the decorative top when a 25.5 mm tag fits there (only the big heart's lobe does), else in
        // the flap; sealed pocket under ≥ 1.2 mm, pause at its top
        const n = I.nfc;
        ok(n?.where === (s.id === 'heart' ? 'top' : 'flap'), `${label}: chip NFC en ${n?.where === 'top' ? 'la forma' : 'la tapa'}`);
        if (n) {
          const holder = n.where === 'top' ? sol.body : sol.flap;
          ok(T - n.z1 >= 1.2 - 1e-9 && n.z0 >= 0.8 && Math.abs(n.z1 / 0.2 - Math.round(n.z1 / 0.2)) < 1e-6, `${label}: bolsillo NFC z ${n.z0}–${n.z1} alineado a capas`);
          ok(sol.pauses.length === 1 && sol.pauses[0].z === n.z1 && sol.pauses[0].msg === NFC_PAUSE_MSG, `${label}: pausa para el chip en z ${n.z1}`);
          const pocket = cyl(n.x, n.y, n.r - 0.2, n.z0 + 0.05, n.z1 - 0.05), cover = cyl(n.x, n.y, n.r - 1, n.z1 + 0.05, T - 0.05);
          ok(overlap(holder, pocket) < 1e-3 && overlap(holder, cover) > 0.99 * cover.volume(), `${label}: bolsillo vacío y tapado`);
          pocket.delete(); cover.delete();
        }
        if (s.id === 'star') ok(!I.opener && sol.warnings.some((w) => w.includes('abre latas')), `${label}: sin borde recto para el abre latas → aviso`);
        else checkOpener(label, sol);
      }
    } finally {
      sol.dispose();
    }
  }
}

// ------------------------------------------------------------------ exported parts (what goes into the 3MF/STL)
console.log('Piezas exportadas:');
{
  const r = buildPhoneStand({ ...EXTRAS }, { logoImage, font });
  const names = r.parts.map((p) => p.name);
  ok(JSON.stringify(names) === JSON.stringify(['Cuerpo', 'Tapa (bisagra)', 'Logo', 'Texto (tapa)']), `piezas: ${names.join(', ')}`);
  ok(r.parts.every((p) => watertight(p.geometry)), 'todas las mallas exportadas son cerradas');
  ok(r.parts.filter((p) => p.moving).every((p) => p.openGeometry) && r.parts.filter((p) => p.moving).length === 2, 'la tapa y su texto tienen vista abierta');
  ok(r.parts.map((p) => p.filamentIndex).join() === '0,0,1,1', `filamentos ${r.parts.map((p) => p.filamentIndex).join()} (logo y texto en color de acento)`);
  const zip = unzipSync(threeMF(r.parts, 'Soporte', { pauses: r.pauses }));
  const gcode = strFromU8(zip['Metadata/custom_gcode_per_layer.xml'] || new Uint8Array());
  ok(gcode.includes(`top_z="${r.info.nfc.z1}"`) && gcode.includes(NFC_PAUSE_MSG), `3MF con la pausa del NFC en z ${r.info.nfc.z1}`);
  const model = strFromU8(zip['3D/3dmodel.model']);
  ok(names.every((n) => model.includes(`name="${n}"`)), '3MF con las 4 piezas por nombre');
  const acc = buildPhoneStand({ ...EXTRAS, colors: { flapAccent: true } }, { logoImage, font });
  ok(acc.parts.map((p) => p.filamentIndex).join() === '0,1,1,0', 'tapa en color de acento → su texto en el color del cuerpo');
  const mono = buildPhoneStand({ ...EXTRAS, colors: { twoColor: false } }, { logoImage, font });
  ok(mono.parts.every((p) => p.filamentIndex === 0), 'un solo color → todo en el filamento 1');
}

// ------------------------------------------------------------------ hinge sweep with art on both faces
console.log('Bisagra (barrido de apertura):');
for (const [label, cfg] of [
  ['por defecto + extras', { ...EXTRAS, nfc: { enabled: true, where: 'flap' } }],
  ['logo en la tapa 3 mm + texto arriba 3 mm', { logo: { where: 'flap', height: 3 }, text: { enabled: true, where: 'top', value: 'Pabonitas' } }],
  ['celular a 50°, grosor 6', { phoneAngle: 50, thickness: 6, logo: { where: 'flap', height: 1.5 }, text: { enabled: true, where: 'top', value: 'Ana' } }],
  ['celular a 75°, grosor 10, tapa 40', { phoneAngle: 75, thickness: 10, flapLength: 40, logo: { height: 2 }, text: { enabled: true, value: 'Pabonitas' } }],
]) {
  const sol = phoneStandSolids(cfg, { logoImage, font });
  try {
    ok(sol.info.parts.body === 1 && sol.info.parts.flap === 1 && sol.info.hinge.gap >= 0.9 * sol.info.hinge.clearance, `${label}: piezas sueltas entre sí y de una pieza`);
    checkSweep(label, sol);
  } finally {
    sol.dispose();
  }
}

// ------------------------------------------------------------------ logo/text places and modes
console.log('Logo y texto (lugar y modo):');
{
  const solid = (cfg) => phoneStandSolids(cfg, { logoImage, font });
  const a = solid({ logo: { where: 'flap' } });
  ok(!a.topArt && !!a.flapArt && a.info.art.flap.logo && !a.info.art.top, 'logo en la tapa');
  checkRelief('logo en la tapa', a, a.flapArt, a.flap, a.mech.T, a.cfg.logo.height);
  ok(a.info.art.flap.cy + a.info.art.flap.h / 2 <= a.mech.yh - a.mech.uE, 'el logo de la tapa queda lejos del borde donde se apoya al abrir');
  a.dispose();
  const b = solid({ text: { enabled: true, where: 'top', value: 'Pabonitas' } });
  ok(b.info.art.top.logo && b.info.art.top.text && !b.flapArt, 'logo y texto juntos arriba');
  ok(Math.abs(b.info.art.top.cap / (b.info.art.top.h) - 0.28 / 1.4) < 0.15, `texto a ~28 % del logo (cap ${f2(b.info.art.top.cap)} mm)`);
  b.dispose();
  const heart = solid({});
  ok(heart.info.art.top.w >= 20, `logo del corazón grande: ${f2(heart.info.art.top.w)} mm (antes 11 mm)`);
  const ring = heart.info.ring, top = heart.info.art.top;
  ok(ring.y > top.cy + top.h / 2, 'el aro del corazón va arriba del logo, en el hueco entre los lóbulos');
  const noLogo = solid({ logo: { enabled: false } });
  const eng = solid({ logo: { mode: 'engrave', depth: 0.6 } });
  ok(!eng.topArt && eng.body.volume() < noLogo.body.volume() - 5, 'grabado: el logo se hunde en el cuerpo');
  const inl = solid({ logo: { mode: 'inlay', depth: 0.6 } });
  const bb = inl.topArt.boundingBox();
  ok(Math.abs(bb.min[2] - (inl.mech.T - 0.6)) < 1e-3 && Math.abs(bb.max[2] - inl.mech.T) < 1e-3, 'incrustado: pieza a ras de la cara');
  ok(overlap(inl.body, inl.topArt) < 1e-3 && Math.abs(inl.body.volume() + inl.topArt.volume() - noLogo.body.volume()) < 0.5, 'incrustado: llena exacto su hueco');
  heart.dispose(); noLogo.dispose(); eng.dispose(); inl.dispose();
  // NFC under a sunk logo keeps 0.8 mm under the logo's floor
  const c = solid({ logo: { where: 'flap', mode: 'engrave', depth: 1.2 }, nfc: { enabled: true, where: 'flap' } });
  ok(c.info.nfc && c.mech.T - c.info.nfc.z1 >= 1.2 + 0.8 - 1e-9 && c.info.parts.flap === 1, `NFC bajo logo grabado 1,2 mm: tapa ${f2(c.mech.T - c.info.nfc.z1)} mm`);
  c.dispose();
  const tiny = solid({ text: { enabled: true, value: 'Pabonitas', size: 40 } });
  ok(tiny.warnings.some((w) => w.includes('trazos')) && tiny.warnings.some((w) => w.includes('pequeño')), 'texto chico → avisos de trazos finos y de tamaño');
  tiny.dispose();
  const gone = solid({ text: { enabled: true, value: 'Pabonitas', size: 20 } });
  ok(!gone.flapArt && gone.warnings.some((w) => w.includes('vacío')), 'texto demasiado chico para imprimirse → aviso y no se genera');
  gone.dispose();
}

// ------------------------------------------------------------------ NFC on the decorative top, left opener, custom silhouette
console.log('NFC arriba, abre latas a la izquierda y silueta propia:');
{
  const t = phoneStandSolids({ shape: 'circle', shapeScale: 140, nfc: { enabled: true, where: 'top', diameter: 15 }, opener: { enabled: true } }, { logoImage, font });
  const n = t.info.nfc;
  ok(n?.where === 'top' && t.info.parts.body === 1, 'NFC de 15 mm sellado en la parte decorativa (cuerpo de una pieza)');
  if (n) {
    const pocket = cyl(n.x, n.y, n.r - 0.2, n.z0 + 0.05, n.z1 - 0.05);
    ok(overlap(t.body, pocket) < 1e-3 && t.pauses[0]?.z === n.z1, `bolsillo arriba vacío, pausa en z ${n.z1}`);
    pocket.delete();
  }
  checkOpener('círculo grande con NFC arriba', t);
  t.dispose();
  const rc = phoneStandSolids({ shape: 'circle', opener: { enabled: true } }, { logoImage, font });
  ok(rc.info.opener && rc.info.opener.angle !== 0, `círculo: ranura girada ${rc.info.opener?.angle}° para quedar de frente al borde curvo`);
  checkOpener('círculo (ranura girada)', rc);
  rc.dispose();
  const l = phoneStandSolids({ opener: { enabled: true, side: 'left' } }, { logoImage, font });
  ok(l.info.opener?.sg === -1, 'abre latas a la izquierda');
  checkOpener('corazón izquierda', l);
  l.dispose();
  const cu = phoneStandSolids({ shape: 'custom' }, { logoImage, font, shapeImage: logoImage });
  ok(cu.info.shape.id === 'custom' && cu.info.parts.body === 1 && cu.body.status() === 'NoError', 'silueta propia desde una imagen');
  cu.dispose();
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
  const h = phoneStandSolids({}, { logoImage });
  const hb = h.outline.bounds(), ratio = (hb.max[0] - hb.min[0]) / h.mech.W, cleft = hb.max[1] - topAt(h.outline.toPolygons(), 0);
  ok(ratio >= 1.5, `corazón ${f2(ratio)} veces el ancho del cuerpo: sus lados se ven bajar hasta el cuerpo (antes 1,4)`);
  ok(cleft >= 3, `el hueco entre los lóbulos se ve (${f2(cleft)} mm) aun con el aro`);
  h.dispose();
  for (const s of PHONESTAND_SHAPES) {
    const sol = phoneStandSolids({ shape: s.id, shapeScale: 140 }, { shapeImage: logoImage });
    const y0 = sol.outline.bounds().min[1];
    ok(y0 > -0.01 && sol.info.parts.body === 1, `${s.id} al 140 %: nada sobresale del borde delantero (y mín. ${f2(y0)} mm)`);
    sol.dispose();
  }
}

// ------------------------------------------------------------------ mechanism, settings, thumbnails, project file
console.log('Mecanismo, ajustes y proyecto:');
{
  const m = phoneStandMechanism({});
  ok(m.thOpen === 180 - 62 - 4 && m.thS < m.thOpen && m.uE > 0, `tapa abre a ${m.thOpen}° (tope en ${f2(m.thS)}°)`);
  ok(m.baseClear > 1, `el celular no pisa la tapa (${f2(m.baseClear)} mm)`);
  ok(m.yr < m.By && m.By < m.P[0] + 30, 'topes del celular delante de su borde inferior');

  const raw = { width: 100, thickness: '7,5', shape: 'dragon', nfc: { where: 'x', diameter: 2 }, logo: { mode: 'x', size: 999 }, text: { value: 'x'.repeat(60), font: 'Comic' }, colors: { body: 'red' }, opener: { side: 'LEFT' } };
  const before = JSON.stringify(raw);
  const n = normalizePhoneStand(raw);
  ok(n.width === 60 && n.thickness === 7.5 && n.shape === 'heart' && n.nfc.where === 'auto' && n.nfc.diameter === 10, 'medidas fuera de rango se ajustan');
  ok(n.logo.mode === 'relief' && n.logo.size === 150 && n.text.value.length === 40 && n.text.font === DEFAULT_PHONESTAND().text.font, 'modo, tamaño, texto y fuente válidos');
  ok(n.colors.body === DEFAULT_PHONESTAND().colors.body && n.opener.side === 'right' && n.ring.enabled === true, 'colores y lado por defecto');
  ok(JSON.stringify(raw) === before, 'no modifica la configuración recibida');

  const th = shapeThumbnails({});
  ok(PHONESTAND_SHAPES.every((s) => th[s.id]?.d.startsWith('M') && th[s.id].viewBox.split(' ').map(Number).every(Number.isFinite)), 'miniaturas SVG de las 11 formas');
  ok(th.custom.custom === true, 'sin imagen, "Tu silueta" se muestra como clásica');

  const cfg = { ...DEFAULT_PHONESTAND(), shape: 'mouse', nfc: { enabled: true, where: 'flap' }, text: { enabled: true, value: 'Ana' } };
  const txt = phoneStandProject(cfg, { logoSrc: 'data:image/png;base64,AAAA', shapeSrc: 'https://example.com/x.png' });
  const back = readPhoneStandProject(txt);
  ok(JSON.stringify(back.cfg) === JSON.stringify(normalizePhoneStand(cfg)) && back.logoSrc === 'data:image/png;base64,AAAA' && back.shapeSrc === null, 'proyecto .r3p: guarda y abre igual (solo imágenes data:)');
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  ok(throws(() => readPhoneStandProject('{')) && throws(() => readPhoneStandProject({ app: 'Otro', cfg: {} })) && throws(() => readPhoneStandProject({ ...JSON.parse(txt), version: 2 })), 'rechaza archivos ajenos o de otra versión');
}

console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (fails) { console.log(`phonestand FAILED (${fails})`); process.exit(1); }
console.log('phonestand OK');

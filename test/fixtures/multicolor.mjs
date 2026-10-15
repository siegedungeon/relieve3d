// Synthetic painted multicolour models for the colour-split benchmark (test/tools/bench.mjs, model spec "fx:<name>").
// Every fixture is ONE closed, outward-oriented body built with manifold-3d primitives / booleans, refined to ~0.6 mm
// triangles and painted per triangle from its centroid, so colour borders zig-zag along the triangles like real paint.
// Colour 0 is the base (largest painted area). Front = -y (what the "front" view of test/tools/compare.mjs shows).
// Each function takes the manifold module `w` and returns { title, palette, names, parts: [{ name, V, T, tc }] }.
//   node test/fixtures/multicolor.mjs    self-check: triangles, area per colour, manifold + genus, 3MF round trip
import path from 'path';
import { fileURLToPath } from 'url';
import { zipSync, strToU8 } from 'fflate';

export const PALETTE = ['#F4F4F4', '#E8AFCF', '#8ADFBD', '#3F51B5', '#FFC107', '#E53935', '#212121', '#43A047'];
const EDGE = 0.6; // target triangle edge length (mm)
const DEG = Math.PI / 180;

function hslHex(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}
const paletteOf = (n) => Array.from({ length: n }, (_, i) => PALETTE[i] || hslHex((i * 137.508) % 360, 0.6, 0.55));

// Refines `man` (takes ownership) to small triangles and paints every triangle with colorOf(centroid, unitNormal).
function painted(man, nCol, name, colorOf) {
  const ref = man.refineToLength(EDGE);
  const mesh = ref.getMesh();
  ref.delete();
  man.delete();
  const np = mesh.numProp, P = mesh.vertProperties, nV = P.length / np;
  const V = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) for (let k = 0; k < 3; k++) V[i * 3 + k] = P[i * np + k];
  const T = Uint32Array.from(mesh.triVerts), nT = T.length / 3, tc = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
    const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    const col = colorOf([(V[a] + V[b] + V[c]) / 3, (V[a + 1] + V[b + 1] + V[c + 1]) / 3, (V[a + 2] + V[b + 2] + V[c + 2]) / 3], [nx / l, ny / l, nz / l]);
    if (!(col >= 0 && col < nCol)) throw new Error(`${name}: colour ${col} out of range`);
    tc[t] = col;
  }
  const palette = paletteOf(nCol);
  return { title: name, palette, names: palette.map((_, i) => `Filamento ${i + 1}`), parts: [{ name, V, T, tc }] };
}

// Sphere r 20: colour 0 on the bottom half, the top half split into nCol-1 longitude sectors (all meet at the pole).
// The mesh is tilted so the equator and the pole fall across triangles (zig-zag borders everywhere).
export function bandSphere(w, nCol = 6) {
  nCol = Math.max(2, Math.min(18, Math.round(+nCol || 6)));
  const s = w.Manifold.sphere(20, 96), man = s.rotate([13, 7, 0]);
  s.delete();
  const nS = nCol - 1;
  return painted(man, nCol, nCol === 6 ? 'bandSphere' : `bandSphere${nCol}`, ([x, y, z]) =>
    z < 0 ? 0 : 1 + Math.min(nS - 1, Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * nS)));
}

// Torus (major R 20, minor r 6, around z): colour 0 except 3 bands across the tube (slabs 4, 8 and 2 mm wide).
export function bandTorus(w) {
  const c0 = w.CrossSection.circle(6, 48), cs = c0.translate([20, 0]), man = cs.revolve(128);
  c0.delete();
  cs.delete();
  const bands = [[10, 4, 1], [130, 8, 2], [250, 2, 3]].map(([a, wd, c]) => ({ cx: Math.cos(a * DEG), cy: Math.sin(a * DEG), h: wd / 2, c }));
  return painted(man, 4, 'bandTorus', ([x, y]) => {
    for (const b of bands) if (x * b.cx + y * b.cy > 0 && Math.abs(y * b.cx - x * b.cy) < b.h) return b.c;
    return 0;
  });
}

// Rounded figure: ellipsoid 40 x 24 x 50 (front = -y) with two eye dots (Ø3, colour 1), a 5 mm belt around the waist
// (colour 2), a 1.2 mm thin fin plate (15 x 20) sticking out of the top/back painted colour 3 on its +x side only, and
// a 4 mm checker patch of colours 1,2,3,0 on the belly.
export function figure(w) {
  const A = [20, 12, 25];
  const u = w.Manifold.sphere(1, 96), body = u.scale(A);
  const c0 = w.Manifold.cube([1.2, 15, 20]), fin = c0.translate([-0.6, 4, 8]); // x -0.6..0.6, y 4..19, z 8..28
  const man = body.add(fin);
  [u, body, c0, fin].forEach((m) => m.delete());
  const frontY = (x, z) => -A[1] * Math.sqrt(Math.max(0, 1 - (x / A[0]) ** 2 - (z / A[2]) ** 2));
  const eyes = [-6, 6].map((x) => [x, frontY(x, 12), 12]);
  const patch = [1, 2, 3, 0];
  return painted(man, 4, 'figure', ([x, y, z], n) => {
    for (const e of eyes) if ((x - e[0]) ** 2 + (y - e[1]) ** 2 + (z - e[2]) ** 2 < 1.5 ** 2) return 1;
    if (n[0] > 0.9 && Math.abs(x - 0.6) < 0.01) return 3; // the fin's +x face (only flat face at x = 0.6)
    if (n[1] < -0.5 && x >= -6 && x < 6 && z >= -19 && z < -7) return patch[(Math.floor((x + 6) / 4) + 2 * Math.floor((z + 19) / 4)) % 4];
    if (Math.abs(z + 2) < 2.5) return 2;
    return 0;
  });
}

// Cube 30 mm: 3D checkerboard of 7.5 mm cells on every face (half the squares colour 0, the rest colours 1..3), so the
// colour borders cross the cube edges and corners.
export function checkerCube(w) {
  const S = 30, Q = 7.5;
  const cell = (v) => Math.max(0, Math.min(3, Math.floor((v + S / 2) / Q)));
  return painted(w.Manifold.cube([S, S, S], true), 4, 'checkerCube', ([x, y, z]) => {
    const i = cell(x), j = cell(y), k = cell(z);
    return (i + j + k) % 2 === 0 ? 0 : 1 + ((i + 2 * j + k) % 3);
  });
}

export const FIXTURES = { bandSphere, bandTorus, figure, checkerCube };
export const EXPECTED_GENUS = { bandSphere: 0, bandTorus: 1, figure: 0, checkerCube: 0 };

// "fx:name[:arg...]" (or "name[:arg]") → model; numeric args are passed to the fixture (fx:bandSphere:8 = 8 colours)
export function fixtureModel(w, spec) {
  const [name, ...args] = String(spec).replace(/^fx:/, '').split(':');
  const fn = FIXTURES[name];
  if (!fn) throw new Error(`unknown fixture '${name}' (have: ${Object.keys(FIXTURES).join(', ')})`);
  return fn(w, ...args.map((a) => (Number.isFinite(+a) ? +a : a)));
}

// Bambu-style 3MF (paint_color = filament number per triangle + filament_colour list) that read3MF() reads back with the
// same palette order, names and colour indices, so test/tools/compare.mjs can render bench results of a fixture.
export function to3MF(model) {
  const code = (c) => {
    const s = c + 1; // filament number
    if (s < 3) return (s << 2).toString(16).toUpperCase();
    if (s > 18) throw new Error('to3MF: at most 18 colours');
    return (s - 3).toString(16).toUpperCase() + 'C';
  };
  const objs = model.parts.map((p, k) => {
    const out = [`<object id="${k + 1}" type="model" name="${p.name || 'part ' + (k + 1)}"><mesh><vertices>`];
    for (let i = 0; i < p.V.length; i += 3) out.push(`<vertex x="${p.V[i]}" y="${p.V[i + 1]}" z="${p.V[i + 2]}"/>`);
    out.push('</vertices><triangles>');
    for (let t = 0; t < p.T.length / 3; t++) out.push(`<triangle v1="${p.T[t * 3]}" v2="${p.T[t * 3 + 1]}" v3="${p.T[t * 3 + 2]}" paint_color="${code(p.tc ? p.tc[t] : 0)}"/>`);
    out.push('</triangles></mesh></object>');
    return out.join('');
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${model.title || ''}</metadata>
<resources>${objs.join('\n')}</resources>
<build>${model.parts.map((_, k) => `<item objectid="${k + 1}"/>`).join('')}</build>
</model>`;
  return zipSync({
    '3D/3dmodel.model': strToU8(xml),
    'Metadata/project_settings.config': strToU8(JSON.stringify({ filament_colour: model.palette })),
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
  });
}

// ---------- self-check ----------
async function selfCheck() {
  const { default: Module } = await import('manifold-3d');
  const { read3MF } = await import('../../src/core/threemf_read.js');
  const w = await Module();
  w.setup();
  let fails = 0;
  for (const [name, fn] of Object.entries(FIXTURES)) {
    const t0 = performance.now();
    const model = fn(w);
    const ms = performance.now() - t0;
    const p = model.parts[0], nT = p.T.length / 3;
    const area = new Array(model.palette.length).fill(0);
    let vol = 0;
    for (let t = 0; t < nT; t++) {
      const a = p.T[t * 3] * 3, b = p.T[t * 3 + 1] * 3, c = p.T[t * 3 + 2] * 3;
      const u = [0, 1, 2].map((k) => p.V[b + k] - p.V[a + k]), v = [0, 1, 2].map((k) => p.V[c + k] - p.V[a + k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      area[p.tc[t]] += Math.hypot(...n) / 2;
      vol += (p.V[a] * n[0] + p.V[a + 1] * n[1] + p.V[a + 2] * n[2]) / 6;
    }
    const tot = area.reduce((x, y) => x + y, 0), problems = [];
    if (!area.every((x) => x > 0)) problems.push('unused colour');
    if (!area.every((x, i) => i === 0 || x < area[0])) problems.push('colour 0 not dominant');
    if (!(vol > 0)) problems.push('signed volume ≤ 0 (inward)');
    let genus = '?', mvol = 0;
    try {
      const m = new w.Manifold(new w.Mesh({ numProp: 3, vertProperties: Float32Array.from(p.V), triVerts: Uint32Array.from(p.T) }));
      const comps = m.decompose();
      genus = m.genus();
      mvol = m.volume();
      if (comps.length !== 1) problems.push(`${comps.length} components`);
      comps.forEach((c) => c.delete());
      m.delete();
      if (genus !== EXPECTED_GENUS[name]) problems.push(`genus ${genus} ≠ ${EXPECTED_GENUS[name]}`);
    } catch (e) {
      problems.push('not a manifold: ' + e.message);
    }
    let rt = 'ok';
    try {
      const back = read3MF(to3MF(model)), q = back.parts[0];
      if (back.palette.join() !== model.palette.join() || back.names.join() !== model.names.join()) rt = 'palette/names differ';
      else if (q.T.length !== p.T.length || q.T.some((x, i) => x !== p.T[i]) || q.tc.some((x, i) => x !== p.tc[i])) rt = 'triangles/colours differ';
      else if (q.V.some((x, i) => Math.abs(x - p.V[i]) > 1e-6)) rt = 'vertices differ';
    } catch (e) {
      rt = 'error ' + e.message;
    }
    if (rt !== 'ok') problems.push('3MF round trip: ' + rt);
    if (problems.length) fails++;
    console.log(`${problems.length ? '✗' : '✓'} ${name.padEnd(12)} ${String(nT).padStart(6)} tris  genus ${genus}  vol ${mvol.toFixed(0)} mm³  ${ms.toFixed(0)} ms  3MF ${rt}`);
    console.log(`    area: ${area.map((x, i) => `${i} ${x.toFixed(0)} mm² (${((100 * x) / tot).toFixed(1)}%)`).join(' | ')}`);
    if (problems.length) console.log('    PROBLEMS: ' + problems.join('; '));
  }
  console.log(fails ? `${fails} fixture(s) FAILED` : 'all fixtures OK');
  process.exitCode = fails ? 1 : 0;
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && same(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) await selfCheck();

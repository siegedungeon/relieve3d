// Carve colour split (mode 'carve'): the paint clean-up passes (thin two-colour walls, narrow strokes, checker corners)
// and the split itself on synthetic painted models: single-colour, solid, non-overlapping pieces.
import Module from 'manifold-3d';
import { thinWalls, openPaint } from '../src/core/colorcarve.js';
import { splitColors } from '../src/core/colorsplit.js';
import { checkerCube, figure } from './fixtures/multicolor.mjs';

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

const w = await Module();
w.setup();
const { Manifold, CrossSection, Mesh } = w;

// refined triangle mesh of a Manifold (takes ownership) + per-triangle unit normal and centroid
function meshOf(man, edge) {
  const ref = man.refineToLength(edge), m = ref.getMesh();
  ref.delete();
  man.delete();
  const P = m.vertProperties, np = m.numProp, T = m.triVerts, nT = T.length / 3, N = [], C = [];
  for (let t = 0; t < nT; t++) {
    const v = [0, 1, 2].map((k) => [0, 1, 2].map((a) => P[T[t * 3 + k] * np + a]));
    const u = v[1].map((x, a) => x - v[0][a]), q = v[2].map((x, a) => x - v[0][a]);
    const n = [u[1] * q[2] - u[2] * q[1], u[2] * q[0] - u[0] * q[2], u[0] * q[1] - u[1] * q[0]], l = Math.hypot(...n) || 1;
    N.push(n.map((x) => x / l));
    C.push([0, 1, 2].map((a) => (v[0][a] + v[1][a] + v[2][a]) / 3));
  }
  const merged = new Uint32Array(P.length / np).map((_, i) => i);
  return { P, np, T, nT, N, C, merged };
}
// edge-connected components of the triangles of colour c
function compCount(col, T, c) {
  const nT = T.length / 3, par = new Int32Array(nT).map((_, i) => i), edge = new Map();
  const find = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  for (let t = 0; t < nT; t++) {
    if (col[t] !== c) continue;
    for (let k = 0; k < 3; k++) {
      const a = T[t * 3 + k], b = T[t * 3 + ((k + 1) % 3)], key = Math.min(a, b) * 4294967296 + Math.max(a, b);
      const o = edge.get(key);
      if (o === undefined) edge.set(key, t); else par[find(o)] = find(t);
    }
  }
  let n = 0;
  for (let t = 0; t < nT; t++) if (col[t] === c && find(t) === t) n++;
  return n;
}
const Wt = 0.8 + 0.15; // minWall + clearance (defaults)

// ---------- thinWalls ----------
{
  // 0.6 mm plate: top face colour 1, the rest base 0 → carved, each colour would get a 0.2 mm sliver: all base
  const s = meshOf(Manifold.cube([20, 20, 0.6]), 0.5);
  const col = new Int16Array(s.nT).map((_, t) => (s.N[t][2] > 0.9 ? 1 : 0));
  const top = col.reduce((a, c) => a + (c === 1), 0);
  const n = thinWalls(col, s.P, s.np, s.T, 0, Wt);
  check(top > 100 && n === top && !col.includes(1), `thin plate painted on one face → one colour, the base (${n} of ${top} recoloured)`);
}
{
  // the same paint on a 3 mm plate is left alone
  const s = meshOf(Manifold.cube([20, 20, 3]), 0.5);
  const col = new Int16Array(s.nT).map((_, t) => (s.N[t][2] > 0.9 ? 1 : 0));
  const n = thinWalls(col, s.P, s.np, s.T, 0, Wt);
  check(n === 0, `3 mm plate: paint untouched (${n} recoloured)`);
}
{
  // thick box, top colour 1, sides base: a convex edge is not a thin wall (rays run deep into the box)
  const s = meshOf(Manifold.cube([10, 10, 10]), 0.3);
  const col = new Int16Array(s.nT).map((_, t) => (s.N[t][2] > 0.9 ? 1 : 0));
  const n = thinWalls(col, s.P, s.np, s.T, 0, Wt);
  check(n === 0, `thick box: no recolouring along its convex edges (${n})`);
}
{
  // two non-base colours on a thin plate: the colour painted over the larger area wins
  const s = meshOf(Manifold.cube([20, 20, 0.6]), 0.5);
  const col = new Int16Array(s.nT).map((_, t) => (s.N[t][2] > 0.9 ? 1 : 2));
  thinWalls(col, s.P, s.np, s.T, 0, Wt);
  check(!col.includes(1) && col.every((c) => c === 2), 'thin plate in colours 1 (top) / 2 (bottom + sides): all colour 2, the larger');
}
{
  // faces of different pieces (key: a solid part fused to the rest) are not compared
  const s = meshOf(Manifold.cube([20, 20, 0.6]), 0.5);
  const col = new Int16Array(s.nT).map((_, t) => (s.N[t][2] > 0.9 ? 1 : 0)), key = new Int16Array(s.nT).map((_, t) => (s.N[t][2] > 0.9 ? 0 : -1));
  const n = thinWalls(col, s.P, s.np, s.T, 0, Wt, key);
  check(n === 0, `thin plate whose faces belong to different pieces: untouched (${n})`);
}
{
  // blade (prism, 50° between its flanks, 4 mm tall) on a block, left flank colour 1: where the blade is thinner than
  // Wt the flank goes base. Rays cross the blade slantwise (1.56× its thickness): the thickness is the distance to the
  // far flank's plane, not the ray length
  const H = 4, half = H * Math.tan((25 * Math.PI) / 180);
  const cs = new CrossSection([[-half, 0], [half, 0], [0, H]]);
  const blade = cs.extrude(20), block = Manifold.cube([20, 3, 20]).translate([-10, -3, 0]);
  const s = meshOf(Manifold.union([blade, block]), 0.2);
  [cs, blade, block].forEach((m) => m.delete());
  const L = Math.hypot(H, half), NA = [-H / L, half / L, 0], NB = [H / L, half / L, 0];
  const onA = (t) => s.N[t][0] * NA[0] + s.N[t][1] * NA[1] > 0.999;
  const col = new Int16Array(s.nT).map((_, t) => (onA(t) ? 1 : 0));
  thinWalls(col, s.P, s.np, s.T, 0, Wt);
  let thin = 0, thinKept = 0, thick = 0, thickLost = 0;
  for (let t = 0; t < s.nT; t++) {
    if (!onA(t)) continue;
    const d = -((s.C[t][0] - 0) * NB[0] + (s.C[t][1] - H) * NB[1]); // centroid → far flank plane
    if (d < Wt - 0.1) { thin++; if (col[t] === 1) thinKept++; }
    if (d > Wt + 0.1) { thick++; if (col[t] !== 1) thickLost++; }
  }
  check(thin > 50 && thinKept === 0, `blade: flank thinner than ${Wt.toFixed(2)} mm → base (${thinKept} of ${thin} still painted)`);
  check(thick > 50 && thickLost === 0, `blade: flank thicker than ${Wt.toFixed(2)} mm keeps its colour (${thickLost} of ${thick} lost)`);
}

// ---------- openPaint ----------
{
  // checker cube: where four cells meet at a vertex, the dropped corner triangles must not bridge the two diagonal
  // cells of one colour (they would turn into a ring-shaped piece that cannot be put in)
  const m = checkerCube(w), p = m.parts[0];
  const nT = p.T.length / 3, col = Int16Array.from(p.tc), merged = new Uint32Array(p.V.length / 3).map((_, i) => i);
  const before = [1, 2, 3].map((c) => compCount(col, p.T, c)), bBase = compCount(col, p.T, 0);
  const prev = col.slice();
  openPaint(col, p.V, 3, p.T, merged, 0.3);
  const after = [1, 2, 3].map((c) => compCount(col, p.T, c)), aBase = compCount(col, p.T, 0);
  let changed = 0;
  for (let t = 0; t < nT; t++) if (col[t] !== prev[t]) changed++;
  check(after.every((n, i) => n >= before[i]) && aBase >= bBase, `checker cube: no colour cells merged (components ${[bBase, ...before].join('/')} → ${[aBase, ...after].join('/')})`);
  check(changed < 600, `checker cube: only the cell corners change (${changed} of ${nT} triangles)`);
}
{
  // a 0.3 mm stroke of colour 1 across a colour-2 area is removed and the two sides of colour 2 become one again
  const s = meshOf(Manifold.cube([20, 20, 3]), 0.25);
  const col = new Int16Array(s.nT).map((_, t) => (s.N[t][2] < 0.9 ? 0 : Math.abs(s.C[t][1] - 10) < 0.15 ? 1 : 2));
  const had = col.reduce((a, c) => a + (c === 1), 0), sides = compCount(col, s.T, 2);
  openPaint(col, s.P, s.np, s.T, s.merged, 0.3);
  check(had > 20 && !col.includes(1) && sides === 2 && compCount(col, s.T, 2) === 1, `0.3 mm stroke removed, its two sides joined (${had} triangles, colour 2: ${sides} → ${compCount(col, s.T, 2)} areas)`);
}

// ---------- the split ----------
const toMan = (m) => {
  const mesh = new Mesh({ numProp: 3, vertProperties: Float32Array.from(m.V), triVerts: Uint32Array.from(m.T) });
  mesh.merge();
  return new Manifold(mesh);
};
function partsCheck(name, r, { coverGenus0 = true } = {}) {
  const mans = r.parts.map((p) => toMan(p.mesh));
  check(mans.every((m) => m.status() === 'NoError' && m.volume() > 0), `${name}: every piece is a valid closed solid`);
  const bodies = r.parts.filter((p) => p.kind === 'body');
  check(bodies.length === 1 && bodies[0].color === r.base, `${name}: one base body (${bodies.length})`);
  check(r.parts.every((p) => (p.kind === 'body') === (p.color === r.base)), `${name}: every other piece is a colour piece`);
  const sum = mans.reduce((a, m) => a + m.volume(), 0), uni = Manifold.union(mans), ov = sum - uni.volume();
  check(ov < 0.5, `${name}: pieces do not overlap (${ov.toFixed(3)} mm³)`);
  if (coverGenus0) {
    const g = mans.filter((_, i) => r.parts[i].kind === 'cover').map((m) => m.genus());
    check(g.every((x) => x === 0), `${name}: colour pieces without holes or rings (genus ${g.join(' ')})`);
  }
  check(mans.filter((_, i) => r.parts[i].kind === 'body').every((m) => m.genus() === 0), `${name}: base body without handles`);
  uni.delete();
  mans.forEach((m) => m.delete());
}
{
  const t0 = Date.now();
  const r = splitColors(w, checkerCube(w), { mode: 'carve' }, () => {});
  console.log(`— carve checkerCube: ${((Date.now() - t0) / 1000).toFixed(1)} s, ${r.parts.length} parts`);
  check(r.parts.filter((p) => p.kind === 'cover').length >= 24, `checkerCube: one piece per colour cell (${r.parts.filter((p) => p.kind === 'cover').length} covers)`);
  partsCheck('checkerCube', r);
}
{
  const t0 = Date.now();
  const r = splitColors(w, figure(w), { mode: 'carve' }, () => {});
  console.log(`— carve figure: ${((Date.now() - t0) / 1000).toFixed(1)} s, ${r.parts.length} parts`);
  check([1, 2, 3].every((c) => r.parts.some((p) => p.color === c)), 'figure: eyes, belt and fin colours all present');
  partsCheck('figure', r);
}
{
  // white block with a 0.6 mm fin painted pink on one face: the fin prints white in one piece, no pink sliver
  const block = Manifold.cube([20, 20, 5]), fin = Manifold.cube([0.6, 12, 10]).translate([9.7, 4, 5]);
  const s = meshOf(Manifold.union([block, fin]), 0.6);
  block.delete();
  fin.delete();
  const V = new Float32Array(s.P.length / s.np * 3);
  for (let i = 0; i < V.length / 3; i++) for (let k = 0; k < 3; k++) V[i * 3 + k] = s.P[i * s.np + k];
  const tc = new Uint8Array(s.nT).map((_, t) => (s.N[t][0] > 0.9 && s.C[t][2] > 5.01 ? 1 : 0));
  const model = { palette: ['#F4F4F4', '#E8AFCF'], names: ['Blanco', 'Rosa'], parts: [{ name: 'fin', V, T: Uint32Array.from(s.T), tc }] };
  const r = splitColors(w, model, { mode: 'carve' }, () => {});
  check(!r.parts.some((p) => p.color === 1), `thin fin painted on one face: no pink sliver (${r.parts.length} piece(s))`);
  check(r.warnings.some((x) => /paredes de menos de/.test(x)), 'thin fin: the user is told the wall went one colour');
}

{
  // a white block with a 6 x 6 mm pink patch and three 2 x 2 mm pink dots on top. With pieces under 6 mm³ not printed
  // the dots are specks: the base keeps their spot whole (it used to carve their recess and put each speck back in it
  // as a loose crumb of base inside a groove of clearance)
  const s = meshOf(Manifold.cube([20, 20, 5]), 0.6);
  const V = new Float32Array(s.P.length / s.np * 3);
  for (let i = 0; i < V.length / 3; i++) for (let k = 0; k < 3; k++) V[i * 3 + k] = s.P[i * s.np + k];
  const dots = [[14, 4], [14, 14], [4, 14]];
  const inSq = (c, x, y, a) => c[0] > x && c[0] < x + a && c[1] > y && c[1] < y + a;
  const tc = new Uint8Array(s.nT).map((_, t) => (s.N[t][2] > 0.9 && (inSq(s.C[t], 3, 3, 6) || dots.some(([x, y]) => inSq(s.C[t], x, y, 2))) ? 1 : 0));
  const model = { palette: ['#F4F4F4', '#E8AFCF'], names: ['Blanco', 'Rosa'], parts: [{ name: 'specks', V, T: Uint32Array.from(s.T), tc }] };
  const r = splitColors(w, model, { mode: 'carve', carveMinPiece: 6 }, () => {});
  const mans = r.parts.map((p) => toMan(p.mesh)), bodies = mans.filter((_, i) => r.parts[i].kind === 'body');
  check(bodies.length === 1, `colour specks: no loose crumbs of base (${bodies.length} base piece(s), ${bodies.map((m) => m.volume().toFixed(1)).join(' / ')} mm³)`);
  check(r.parts.filter((p) => p.color === 1).length === 1, `colour specks: only the big patch is a piece (${r.parts.filter((p) => p.color === 1).length} pink)`);
  const whole = dots.map(([x, y]) => {
    const c0 = Manifold.cube([2.4, 2.4, 1.6]), c = c0.translate([x - 0.2, y - 0.2, 3.4]);
    const v = bodies.reduce((a, m) => { const i = m.intersect(c), vi = i.volume(); i.delete(); return a + vi; }, 0) / c.volume();
    c0.delete();
    c.delete();
    return v;
  });
  check(whole.every((f) => f > 0.99), `colour specks: the base is whole where they were (${whole.map((f) => (100 * f).toFixed(1) + '%').join(' ')})`);
  check(r.warnings.some((x) => /trocito/.test(x)), 'colour specks: the user is told they stay base colour');
  partsCheck('colour specks', r);
  mans.forEach((m) => m.delete());
}
// ---------- closed voids and locked parts (print-in-place) ----------
// several closed shells in one painted part (not united: the split does that)
function shellsModel(name, shells, palette) {
  const V = [], T = [], tc = [];
  for (const { man, colorOf } of shells) {
    const s = meshOf(man, 0.6), b = V.length / 3;
    for (let i = 0; i < s.P.length / s.np; i++) V.push(s.P[i * s.np], s.P[i * s.np + 1], s.P[i * s.np + 2]);
    for (const x of s.T) T.push(x + b);
    for (let t = 0; t < s.nT; t++) tc.push(colorOf(s.C[t], s.N[t]));
  }
  return { palette, names: palette.map((_, i) => `Color ${i + 1}`), parts: [{ name, V: Float32Array.from(V), T: Uint32Array.from(T), tc: Uint8Array.from(tc) }] };
}
{
  // a cup closed by a lid that overlaps its rim: a 16 x 16 x 7 mm void inside (like the gap of a print-in-place joint).
  // Lid top painted; the void's floor and ceiling painted a colour nobody sees
  const c0 = Manifold.cube([20, 20, 10]), c1 = Manifold.cube([16, 16, 9]), c2 = c1.translate([2, 2, 2]), cup = c0.subtract(c2);
  const l0 = Manifold.cube([20, 20, 2]), lid = l0.translate([0, 0, 9]);
  [c0, c1, c2, l0].forEach((m) => m.delete());
  const model = shellsModel('lidded box', [
    { man: cup, colorOf: (c, n) => (n[2] > 0.9 && Math.abs(c[2] - 2) < 0.01 ? 2 : 0) },
    { man: lid, colorOf: (c, n) => (n[2] > 0.9 && c[2] > 10.99 ? 1 : n[2] < -0.9 && Math.abs(c[2] - 9) < 0.01 ? 2 : 0) },
  ], ['#F4F4F4', '#E53935', '#3F51B5']);
  const want = 20 * 20 * 11 - 16 * 16 * 7;
  for (const mode of ['carve', 'covers']) {
    const r = splitColors(w, model, { mode }, () => {});
    const mans = r.parts.map((p) => toMan(p.mesh)), vol = mans.reduce((a, m) => a + m.volume(), 0);
    check(Math.abs(vol - want) < 0.03 * want, `${mode}: closed void kept (pieces ${vol.toFixed(0)} mm³, solid minus void ${want})`);
    const voids = mans.filter((_, i) => r.parts[i].kind === 'body').map((m) => m.decompose().filter((c) => c.volume() < -1000).length);
    check(voids.some((n) => n === 1), `${mode}: the base keeps the void inside`);
    check(r.parts.some((p) => p.color === 1) && !r.parts.some((p) => p.color === 2), `${mode}: paint inside the void makes no piece (colours ${r.parts.map((p) => p.color).join(',')})`);
    mans.forEach((m) => m.delete());
  }
}
// two linked rings (a print-in-place chain, 0.5 mm apart): printed apart they could never be put together
const rings = () => {
  const ca = CrossSection.circle(3.5, 48), ta = ca.translate([7, 0]), A = ta.revolve(96);
  const cb = CrossSection.circle(3, 48), tb = cb.translate([7, 0]), rb = tb.revolve(96), rr = rb.rotate([90, 0, 0]), B = rr.translate([7, 0, 0]);
  [ca, ta, cb, tb, rb, rr].forEach((m) => m.delete());
  return [A, B];
};
const ringA = 2 * Math.PI ** 2 * 7 * 3.5 ** 2;
{
  const [A, B] = rings();
  const model = shellsModel('chain', [{ man: A, colorOf: (c, n) => (c[0] < -6 && n[2] > 0.5 ? 1 : 0) }, { man: B, colorOf: () => 0 }], ['#F4F4F4', '#E53935']);
  const r = splitColors(w, model, { mode: 'carve' }, () => {});
  const bodies = r.parts.filter((p) => p.kind === 'body');
  check(bodies.length === 1 && String(bodies[0].up) === '0,0,1', `linked rings: one base piece, printed as modelled (${bodies.length} piece(s), up ${bodies.map((b) => b.up).join(' | ')})`);
  check(r.warnings.some((x) => /trabados/.test(x)), 'linked rings: the user is told they print together');
}
{
  const [A, B] = rings();
  const model = shellsModel('chain2', [{ man: A, colorOf: () => 0 }, { man: B, colorOf: () => 1 }], ['#F4F4F4', '#E53935']);
  const r = splitColors(w, model, { mode: 'carve' }, () => {});
  const mans = r.parts.map((p) => toMan(p.mesh)), bodies = mans.filter((_, i) => r.parts[i].kind === 'body');
  check(bodies.length === 1 && bodies[0].volume() > 1.15 * ringA, `ring of one colour linked to the base: its core prints with the base (base ${bodies.map((m) => m.volume().toFixed(0)).join('/')} mm³, other ring ${ringA.toFixed(0)})`);
  check(r.warnings.some((x) => /trabadas en el modelo/.test(x)), 'locked ring of one colour: the user is told it is carved');
  mans.forEach((m) => m.delete());
}
{
  // a scarf of one colour round a neck, between a head and a body wider than it: locked as a whole, but glued on (it
  // touches the neck), so it is cut in pieces that slide on. Carved as a skin, it was a thin shell full of holes
  const n0 = Manifold.cylinder(20, 4, 4, 48), b0 = Manifold.cube([16, 16, 6], true), b1 = b0.translate([0, 0, -2]), b2 = b0.translate([0, 0, 21]);
  const fig = Manifold.union([n0, b1, b2]);
  const sc = CrossSection.circle(1.6, 32), st = sc.translate([5.2, 0]), sr = st.revolve(64), scarf = sr.translate([0, 0, 10]);
  [n0, b0, b1, b2, sc, st, sr].forEach((m) => m.delete());
  const figVol = fig.volume();
  const model = shellsModel('scarf', [{ man: fig, colorOf: () => 0 }, { man: scarf, colorOf: () => 1 }], ['#F4F4F4', '#E53935']);
  for (const mode of ['carve', 'covers']) {
    const r = splitColors(w, model, { mode }, () => {});
    const mans = r.parts.map((p) => toMan(p.mesh)), red = mans.filter((_, i) => r.parts[i].color === 1);
    check(!r.warnings.some((x) => /trabad/.test(x)), `${mode}: a glued-on scarf is not taken for a print-in-place joint`);
    check(red.length >= 2 && red.every((m) => m.genus() === 0), `${mode}: the scarf comes in pieces without holes that slide on (${red.map((m) => m.genus()).join(',')})`);
    const body = mans.filter((_, i) => r.parts[i].kind === 'body');
    const ov = red.reduce((a, m) => a + body.reduce((b, q) => { const x = m.intersect(q), v = x.volume(); x.delete(); return b + v; }, 0), 0);
    check(ov < 0.5, `${mode}: the scarf pieces fit on the base, nothing of them inside it (${ov.toFixed(2)} mm³)`);
    if (mode === 'carve') {
      const bv = mans.filter((_, i) => r.parts[i].kind === 'body').reduce((a, m) => a + m.volume(), 0);
      check(bv < figVol + 2, `carve: no base core inside the scarf (base ${bv.toFixed(0)} mm³, figure ${figVol.toFixed(0)})`);
    }
    mans.forEach((m) => m.delete());
  }
}

{
  // a ribbon on the front of a block with a thin knot standing in front of it (held by a stem under the ribbon), like
  // the loops of a bow behind its knot: the knot goes in after the ribbon, so only the base can block a piece. Taken
  // for blocked by the knot, the ribbon was turned to slide in sideways along the block (its end hit the base's core)
  const boxes = [[[40, 10, 20], [-20, 0, 0]], [[30, 2, 4], [-15, -2, 8]], [[8, 2, 12], [-4, -5, 4]], [[8, 5, 2], [-4, -5, 4]]].map(([s, t]) => {
    const c = Manifold.cube(s), m = c.translate(t);
    c.delete();
    return m;
  });
  const fig = Manifold.union(boxes);
  boxes.forEach((m) => m.delete());
  const knot = (c) => Math.abs(c[0]) < 4.001 && (c[2] < 6.001 || c[1] < -2.999);
  const model = shellsModel('ribbon and knot', [{ man: fig, colorOf: (c) => (c[1] > -0.001 ? 0 : knot(c) ? 2 : 1) }], ['#F4F4F4', '#E53935', '#3F51B5']);
  const r = splitColors(w, model, { mode: 'carve' }, () => {});
  partsCheck('ribbon and knot', r);
  const red = r.parts.filter((p) => p.color === 1), u = red.map((p) => p.up.map((x) => x / Math.hypot(...p.up)));
  check(red.length === 1 && u[0][1] < -0.9, `ribbon behind a knot: one piece that goes in from the front (${red.length} piece(s), up ${u.map((v) => v.map((x) => x.toFixed(2)).join(',')).join(' | ')})`);
  const bad = r.warnings.filter((x) => /delante|presión/.test(x));
  check(r.parts.some((p) => p.color === 2) && !bad.length, `ribbon behind a knot: no piece taken for blocked (${bad.join(' / ') || 'no warning'})`);
}

{
  // a mitten on the bed at the end of an arm that comes down into it from the body, a low wall behind it. Cut on the
  // first axis, the inner half was a ring round the arm (it can never come off it), and as every cut left a piece
  // blocked somewhere that first cut was kept. The least blocked cut wins (front / back halves, opened at the arm), and
  // the back half, held by the wall at its edge only, is told to need some pressure, not to be blocked
  const s0 = Manifold.sphere(1, 64), s1 = s0.scale([7, 6, 5]), c0 = Manifold.cube([40, 40, 20]), c1 = c0.translate([-20, -20, 0]), dome = s1.intersect(c1);
  const L = Math.hypot(12, 18), a0 = Manifold.cylinder(L, 1.8, 1.8, 32), a1 = a0.rotate([0, (Math.atan2(12, 18) * 180) / Math.PI, 0]), arm = a1.translate([2.5, 0, 1.5]);
  const b0 = Manifold.cube([12, 34, 24]), body = b0.translate([9, -17, 0]), w0 = Manifold.cube([18, 3, 2.3]), wall = w0.translate([-8, 7, 0]);
  const fig = Manifold.union([dome, arm, body, wall]);
  [s0, s1, c0, c1, dome, a0, a1, arm, b0, body, w0, wall].forEach((m) => m.delete());
  const armD = (c) => { const p = [c[0] - 2.5, c[1], c[2] - 1.5], t = (p[0] * 12 + p[2] * 18) / L; return Math.hypot(p[0] - (t * 12) / L, p[1], p[2] - (t * 18) / L); };
  const mitten = (c) => Math.abs((c[0] / 7) ** 2 + (c[1] / 6) ** 2 + (c[2] / 5) ** 2 - 1) < 0.12 && c[2] > 0.01 && armD(c) > 1.85;
  const model = shellsModel('mitten on an arm', [{ man: fig, colorOf: (c) => (mitten(c) ? 1 : 0) }], ['#F4F4F4', '#E53935']);
  const r = splitColors(w, model, { mode: 'carve' }, () => {});
  partsCheck('mitten on an arm', r);
  const mans = r.parts.map((p) => toMan(p.mesh)), base = mans.filter((_, i) => r.parts[i].kind === 'body');
  // slid out along its arrow, the most of the base a piece runs into
  const hits = r.parts.map((p, i) => ({ p, m: mans[i] })).filter((x) => x.p.color === 1).map(({ p, m }) => {
    const d = p.up.map((x) => x / Math.hypot(...p.up));
    let h = 0;
    for (const s of [0.5, 1, 2, 3, 5, 8]) {
      const mv = m.translate(d.map((x) => x * s));
      for (const b of base) { const x = mv.intersect(b); h = Math.max(h, x.volume()); x.delete(); }
      mv.delete();
    }
    return h;
  });
  check(hits.length === 2 && hits.every((h) => h < 1), `mitten on an arm: cut open at the arm, both halves slide off (${hits.length} piece(s), hitting ${hits.map((h) => h.toFixed(2)).join(' / ')} mm³ of base)`);
  const bad = r.warnings.filter((x) => /delante/.test(x));
  check(!bad.length, `mitten on an arm: a half held at its edge only is not taken for blocked (${bad.join(' / ') || 'no such warning'})`);
  mans.forEach((m) => m.delete());
}

console.log(fails ? `\n${fails} FAILED` : '\ncolorcarve OK');
process.exit(fails ? 1 : 0);

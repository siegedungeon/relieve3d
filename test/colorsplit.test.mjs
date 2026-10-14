// Color separation: synthetic multicolor 3MF (painted sphere + solid colored block sunk into it)
// → single-color parts that are watertight, don't overlap, rebuild the original and lie on the bed.
import Module from 'manifold-3d';
import { paintedSphere3MF, paintedBox3MF, paintedWedge3MF, paintedFloatingBall3MF, paintedRoughShell3MF, paintedWing3MF } from './fixtures/painted_sphere.mjs';
import { read3MF } from '../src/core/threemf_read.js';
import { splitColors, layoutPlates, applyPose, DEFAULT_SPLIT } from '../src/core/colorsplit.js';
import { exportFiles } from '../src/core/colorsplit_export.js';

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

const bytes = paintedSphere3MF();

const model = read3MF(bytes);
check(model.palette.length === 3, `palette ${model.palette.join(' ')}`);
check(model.parts.length === 2, `parts read: ${model.parts.length}`);

const WHITE = model.palette.indexOf('#F4F4F4'), PINK = model.palette.indexOf('#E8AFCF'), GREEN = model.palette.indexOf('#8ADFBD');
const w = await Module();
w.setup();
const { Manifold, Mesh } = w;
const toMan = (m) => {
  const mesh = new Mesh({ numProp: 3, vertProperties: Float32Array.from(m.V), triVerts: Uint32Array.from(m.T) });
  mesh.merge();
  return new Manifold(mesh);
};
const t0 = Date.now();
const r = splitColors(w, model, { mode: 'inlays' }, () => {});
console.log('— inlays mode');
console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)} s, ${r.parts.length} parts, warnings: ${r.warnings.join(' | ') || '-'}`);
const kinds = (k, c) => r.parts.filter((p) => p.kind === k && (c == null || p.color === c));
check(r.base === WHITE, `base color = white (${r.base})`);
check(r.cut ? kinds('body').length === 2 : kinds('body').length === 1, `${r.cut ? 'front/back halves' : 'one body'} (${kinds('body').length})`);
if (r.cut) check(kinds('body').every((p) => p.half === 0 || p.half === 1) && new Set(kinds('body').map((p) => p.half)).size === 2, 'one body half per side of the cut');
// with the cut every colour piece slides in along ±cut axis
if (r.cut) check(kinds('inlay').every((p) => Math.abs(p.n[0] * r.cut.axis[0] + p.n[1] * r.cut.axis[1] + p.n[2] * r.cut.axis[2]) > 0.999), 'inlays slide in along the cut axis');
check(kinds('solid', GREEN).length === 1, `green block → one solid part (${kinds('solid', GREEN).length})`);
check(kinds('inlay', PINK).length >= 2 && kinds('inlay', PINK).length <= 40, `pink inlays: ${kinds('inlay', PINK).length}`);
check(r.parts.every((p) => (p.kind === 'body' ? p.color === WHITE : p.color !== WHITE)), 'every part is single-color');

// watertight + positive volume
const mans = r.parts.map((p) => toMan(p.mesh));
check(mans.every((m) => m.status() === 'NoError' && m.volume() > 0.3), 'all parts are valid closed solids');
// (zero-volume fins, or sub-mm³ whiskers pinched to a body half at the cut face, can split off when the float32 mesh is
// re-welded with tolerance; they aren't printable matter)
const comps = mans.map((m) => m.decompose().filter((q) => q.volume() > 1).length);
check(comps.every((c) => c === 1), `each part is a single connected piece (${comps.join(',')})`);
if (r.cut) {
  // every inlay slides straight out of its half along n without hitting it
  let worst = 0;
  r.parts.forEach((p, i) => {
    if (p.kind !== 'inlay') return;
    const h = r.parts.findIndex((b) => b.kind === 'body' && b.n.every((x, k) => Math.abs(x - p.n[k]) < 1e-6));
    for (const t of [0.3, 1, 2, 4, 8, 16]) worst = Math.max(worst, mans[i].translate(p.n.map((x) => x * t)).intersect(mans[h]).volume());
  });
  check(worst < 0.5, `inlays slide straight out of their half (max hit ${worst.toFixed(2)} mm³)`);
}

// no part overlaps another (clearance keeps them apart)
let maxOv = 0;
for (let i = 0; i < mans.length; i++) for (let j = i + 1; j < mans.length; j++) maxOv = Math.max(maxOv, mans[i].intersect(mans[j]).volume());
check(maxOv < 0.01, `no overlaps (max ${maxOv.toFixed(4)} mm³)`);

// reassembled volume ≈ original (only the clearance gaps are missing)
const orig = toMan({ V: model.parts[0].V, T: model.parts[0].T }).add(toMan({ V: model.parts[1].V, T: model.parts[1].T })).volume();
const total = mans.reduce((a, m) => a + m.volume(), 0);
check(total < orig && total > orig * 0.97, `reassembled volume ${total.toFixed(0)} vs ${orig.toFixed(0)} mm³`);

// the parts' outside surface matches the original surface: assembled union covers the original within the clearance
const asm = Manifold.union(mans);
const missing = toMan({ V: model.parts[0].V, T: model.parts[0].T }).add(toMan({ V: model.parts[1].V, T: model.parts[1].T })).subtract(asm).volume();
check(missing < orig * 0.03, `uncovered volume ${missing.toFixed(1)} mm³`);

// inlays: curved colour shells, visible face up, no thicker than maxPocket
for (const p of kinds('inlay')) {
  const m = applyPose(p.mesh, p.print);
  let zmin = Infinity, up = 0, all = 0;
  for (let i = 2; i < m.V.length; i += 3) zmin = Math.min(zmin, m.V[i]);
  for (let t = 0; t < m.T.length; t += 3) {
    const [a, b, c] = [m.T[t] * 3, m.T[t + 1] * 3, m.T[t + 2] * 3];
    const u = [m.V[b] - m.V[a], m.V[b + 1] - m.V[a + 1], m.V[b + 2] - m.V[a + 2]], v = [m.V[c] - m.V[a], m.V[c + 1] - m.V[a + 1], m.V[c + 2] - m.V[a + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) / 2;
    all += l; if (n[2] / (2 * l || 1) > 0.2) up += l;
  }
  // shell: about half of its skin looks up (the visible face), the other half down (the glued face)
  p._up = up / (all || 1);
  p._thick = p.volume / (all / 2);
  p._zmin = zmin;
}
check(kinds('inlay').every((p) => Math.abs(p._zmin) < 1e-3), 'inlays rest on z = 0');
check(kinds('inlay').every((p) => p._up > (r.cut ? 0.2 : 0.3)), `inlays print with the visible face up (min ${Math.min(...kinds('inlay').map((p) => p._up)).toFixed(2)})`);
check(kinds('inlay').every((p) => p._thick >= DEFAULT_SPLIT.depth * 0.6 && p._thick <= DEFAULT_SPLIT.maxPocket + 0.5), `inlay shells ${Math.min(...kinds('inlay').map((p) => p._thick)).toFixed(2)}–${Math.max(...kinds('inlay').map((p) => p._thick)).toFixed(2)} mm thick`);

// solid part is smaller than its socket by the clearance
const solid = kinds('solid')[0];
check(solid.volume < 14 * 10 * 12 && solid.volume > 14 * 10 * 12 * 0.9, `solid shrunk for clearance (${solid.volume.toFixed(0)} mm³)`);

// plate layout keeps items inside the plate and apart
const sizes = r.parts.map((p) => p.print.size);
const lay = layoutPlates(sizes, 256, 3);
let inside = true, overlap = false;
const rs = (i) => (lay[i].rot ? [sizes[i][1], sizes[i][0]] : sizes[i]);
lay.forEach((l, i) => { const [sx, sy] = rs(i); if (l.x - sx / 2 < 0 || l.y - sy / 2 < 0 || l.x + sx / 2 > 256 || l.y + sy / 2 > 256) inside = false; });
for (let i = 0; i < lay.length; i++) for (let j = i + 1; j < lay.length; j++) {
  if (lay[i].plate !== lay[j].plate) continue;
  const dx = Math.abs(lay[i].x - lay[j].x) * 2, dy = Math.abs(lay[i].y - lay[j].y) * 2;
  if (dx < rs(i)[0] + rs(j)[0] && dy < rs(i)[1] + rs(j)[1]) overlap = true;
}
check(inside && !overlap, 'plate layout: inside the plate, no overlap');

// numbers engraved on the inlays' hidden face (compare with an unlabelled run)
const r0 = splitColors(w, model, { labels: false, mode: 'inlays' }, () => {});
const v0 = r0.parts.filter((p) => p.kind === 'inlay').map((p) => p.volume);
const v1 = kinds('inlay').map((p) => p.volume);
const engraved = v1.filter((v, i) => v0[i] - v > 0.3).length;
check(v0.length === v1.length && engraved >= v1.length * 0.5, `numbers engraved on ${engraved}/${v1.length} inlays`);

// covers mode (default): the base stays ONE intact piece, each extra colour is a thin cover glued on top
console.log('— covers mode');
const t1 = Date.now();
const rc = splitColors(w, model, {}, () => {});
console.log(`  ${((Date.now() - t1) / 1000).toFixed(1)} s, ${rc.parts.length} parts, warnings: ${rc.warnings.join(' | ') || '-'}`);
const ck = (k, c) => rc.parts.filter((p) => p.kind === k && (c == null || p.color === c));
check(rc.covers && !rc.cut, 'covers mode is the default');
check(ck('body').length === 1 && ck('body')[0].color === WHITE, `one intact white base (${ck('body').length})`);
// a solid colour part (the green block) is not printed solid: a white core fused to the base + ONE green cover
// (a cap over it, not split in halves); thin back covers only where its back is left exposed
const gc = ck('cover', GREEN), gcFront = gc.filter((p) => !p.backCover);
check(ck('solid').length === 0 && gcFront.length === 1 && gc.length <= 3 && gc.every((p) => p.fromSolid), `green block → white core + 1 green cap (${gcFront.length} cap, ${gc.length - gcFront.length} back)`);
check(ck('cover', PINK).length >= 1 && ck('cover', PINK).length <= 6, `pink covers: ${ck('cover', PINK).length}`);
check(ck('inlay').length === 0, 'no inlays in covers mode');
const cm = rc.parts.map((p) => toMan(p.mesh));
check(cm.every((m) => m.status() === 'NoError' && m.volume() > 0.3), 'covers mode: all parts are valid closed solids');
check(cm[rc.parts.indexOf(ck('body')[0])].decompose().filter((q) => q.volume() > 1).length === 1, 'base is a single connected piece');
let cOv = 0;
for (let i = 0; i < cm.length; i++) for (let j = i + 1; j < cm.length; j++) cOv = Math.max(cOv, cm[i].intersect(cm[j]).volume());
check(cOv < 0.01, `covers mode: no overlaps (max ${cOv.toFixed(4)} mm³)`);
const cTotal = cm.reduce((a, m) => a + m.volume(), 0);
check(cTotal < orig && cTotal > orig * 0.97, `covers mode: reassembled volume ${cTotal.toFixed(0)} vs ${orig.toFixed(0)} mm³`);
const cMiss = toMan({ V: model.parts[0].V, T: model.parts[0].T }).add(toMan({ V: model.parts[1].V, T: model.parts[1].T })).subtract(Manifold.union(cm)).volume();
check(cMiss < orig * 0.03, `covers mode: uncovered volume ${cMiss.toFixed(1)} mm³`);
// covers are thin skins, printed visible face up
for (const p of ck('cover')) {
  const m = applyPose(p.mesh, p.print);
  let zmin = Infinity, up = 0, all = 0;
  for (let i = 2; i < m.V.length; i += 3) zmin = Math.min(zmin, m.V[i]);
  for (let t = 0; t < m.T.length; t += 3) {
    const [a, b, c] = [m.T[t] * 3, m.T[t + 1] * 3, m.T[t + 2] * 3];
    const u = [m.V[b] - m.V[a], m.V[b + 1] - m.V[a + 1], m.V[b + 2] - m.V[a + 2]], v = [m.V[c] - m.V[a], m.V[c + 1] - m.V[a + 1], m.V[c + 2] - m.V[a + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) / 2;
    all += l; if (n[2] / (2 * l || 1) > 0.2) up += l;
  }
  p._up = up / (all || 1); p._thick = p.volume / (all / 2); p._zmin = zmin;
}
check(ck('cover').every((p) => Math.abs(p._zmin) < 1e-3 && (p.fromSolid || p._up > 0.2)), `covers rest on z = 0, visible face up (min ${Math.min(...ck('cover').filter((p) => !p.fromSolid).map((p) => p._up)).toFixed(2)})`);
{
  // the base holds the block's core, and each green cover slides straight off it along its axis (no undercut)
  const bodyM = cm[rc.parts.indexOf(ck('body')[0])];
  const blockM = toMan({ V: model.parts[1].V, T: model.parts[1].T });
  const coreV = bodyM.intersect(blockM).volume();
  check(coreV > 14 * 10 * 12 * 0.3, `base keeps a core inside the block (${coreV.toFixed(0)} mm³)`);
  let hit = 0;
  for (const p of gc) { const m = toMan(p.mesh); for (const d of [0.5, 2, 5, 10, 15]) hit = Math.max(hit, m.translate(p.n.map((x) => x * d)).intersect(bodyM).volume()); }
  check(hit < 0.05, `green covers slide off the core along their axis (max hit ${hit.toFixed(3)} mm³)`);
}
check(ck('cover').every((p) => p._thick <= DEFAULT_SPLIT.depth + 0.6), `covers ${Math.min(...ck('cover').map((p) => p._thick)).toFixed(2)}–${Math.max(...ck('cover').map((p) => p._thick)).toFixed(2)} mm thick`);
// the pink stripe wraps around the sphere: it is split front/back by ONE straight vertical plane (a clean seam,
// no saw teeth), so both halves are separated by a flat gap no wider than the clearance
{
  const zr = (p) => { let lo = Infinity, hi = -Infinity; for (let i = 2; i < p.mesh.V.length; i += 3) { lo = Math.min(lo, p.mesh.V[i]); hi = Math.max(hi, p.mesh.V[i]); } return [lo, hi]; };
  const band = ck('cover', PINK).filter((p) => { const [lo, hi] = zr(p); return lo > -8 && hi < 8; });
  let seam = null;
  if (band.length === 2) for (const ax of [0, 1]) {
    const rng = band.map((p) => { let lo = Infinity, hi = -Infinity; for (let i = ax; i < p.mesh.V.length; i += 3) { lo = Math.min(lo, p.mesh.V[i]); hi = Math.max(hi, p.mesh.V[i]); } return [lo, hi]; });
    const [a, b] = rng[0][0] < rng[1][0] ? rng : [rng[1], rng[0]];
    const gap = b[0] - a[1];
    if (gap > -0.05 && (!seam || gap > seam.gap)) seam = { ax, gap };
  }
  check(band.length === 2, `wrapping stripe → 2 covers, front and back (${band.length})`);
  check(seam && seam.gap < DEFAULT_SPLIT.clearance * 2 + 0.3, `stripe halves meet at one straight vertical plane (gap ${seam ? seam.gap.toFixed(2) : '—'} mm)`);
}
// no crumbs or shards: every cover is one solid piece of printable size
const coverM = ck('cover').map((p) => toMan(p.mesh));
check(ck('cover').every((p) => p.volume >= DEFAULT_SPLIT.minCover), `no cover crumbs (min ${Math.min(...ck('cover').map((p) => p.volume)).toFixed(0)} mm³)`);
check(coverM.every((m) => m.decompose().filter((q) => q.volume() > 0.5).length === 1), 'every cover is one connected piece (no loose shards)');
check(!rc.warnings.some((t) => /piezas \(paredes/.test(t)), 'no "base split" warning for a single object');
// a colour border on a sharp edge (painted top face of a box) is already exact: the cover reaches the edge itself
{
  const rb = splitColors(w, read3MF(paintedBox3MF()), {}, () => {});
  const cv = rb.parts.filter((p) => p.kind === 'cover');
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const p of cv) for (let i = 0; i < p.mesh.V.length; i += 3) for (let k = 0; k < 2; k++) { lo[k] = Math.min(lo[k], p.mesh.V[i + k]); hi[k] = Math.max(hi[k], p.mesh.V[i + k]); }
  const gap = Math.max(lo[0], lo[1], 40 - hi[0], 30 - hi[1]);
  check(cv.length === 1 && gap < 0.02, `crease border: top cover reaches the box edges (${cv.length} cover, gap ${gap.toFixed(3)} mm)`);
}
{
  // round colour part barely touching the base (a bow's knot over the head): the base holds its core, the part is ONE
  // front cover (plus a back cover where its back is exposed) and every cover lifts straight off the core: no film of
  // cover left under the core, no back skin left on the front cover, locking it in place
  {
    const fb = read3MF(paintedFloatingBall3MF());
    const rf = splitColors(w, fb, {}, () => {});
    const body = rf.parts.filter((p) => p.kind === 'body'), cv = rf.parts.filter((p) => p.kind === 'cover');
    const bM = toMan(body[0].mesh), ballM = toMan({ V: fb.parts[1].V, T: fb.parts[1].T });
    const pieces = bM.decompose().filter((q) => q.volume() > 1).length, coreV = bM.intersect(ballM).volume();
    check(body.length === 1 && pieces === 1 && coreV > 300, `ball: the base holds its core (${pieces} piece, core ${coreV.toFixed(0)} mm³)`);
    const cap = cv.filter((p) => !p.backCover);
    let hit = 0;
    for (const p of cv) { const m = toMan(p.mesh); for (const d of [0.3, 1, 2, 4, 8, 16]) hit = Math.max(hit, m.translate(p.n.map((x) => x * d)).intersect(bM).volume()); }
    check(cap.length === 1 && cv.length <= 3 && hit < 0.05, `ball: one cover (+${cv.length - cap.length} back) lifts off the core (max hit ${hit.toFixed(3)} mm³)`);
  }
  // knife edge: the cover runs out to the tip of a wedge instead of leaving base-colour notches along it
  const rw = splitColors(w, read3MF(paintedWedge3MF()), {}, () => {});
  const cv = rw.parts.filter((p) => p.kind === 'cover');
  let lo = Infinity;
  for (const p of cv) for (let i = 0; i < p.mesh.V.length; i += 3) lo = Math.min(lo, p.mesh.V[i]);
  check(cv.length >= 1 && lo < 0.1, `knife edge: wedge cover reaches the tip (${cv.length} cover, gap ${lo.toFixed(3)} mm)`);
  // ...but it doesn't poke through the white underside: one smooth cut keeps the cover off the foreign visible surface
  // (per-triangle cuts left green teeth on it and jagged white bits in the base -> sierras)
  let under = 0, far = 0;
  for (const p of cv) {
    const { V, T } = p.mesh;
    for (let i = 0; i < T.length; i += 3) {
      const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3;
      const u = [0, 1, 2].map((k) => V[b + k] - V[a + k]), v = [0, 1, 2].map((k) => V[c + k] - V[a + k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n);
      if (n[2] / (l || 1) < -0.99 && (V[a + 2] + V[b + 2] + V[c + 2]) / 3 < 0.01) { under += l / 2; far = Math.max(far, V[a], V[b], V[c]); }
    }
  }
  check(under < 0.4 && far < 0.3, `knife edge: no cover on the white underside (${under.toFixed(2)} mm², up to x ${far.toFixed(2)} mm)`);
  // ...and the cut is a thin slab (0.35 mm) under that surface: the base strip it leaves along the tip on the painted
  // face stays a hairline, not a visible white band at every knife edge (0.6 mm slabs did: x up to ~0.55)
  let strip = 0;
  for (const p of rw.parts.filter((q) => q.kind === 'body')) {
    const { V, T } = p.mesh;
    for (let i = 0; i < T.length; i += 3) {
      const q = [0, 1, 2].map((k) => [V[T[i + k] * 3], V[T[i + k] * 3 + 1], V[T[i + k] * 3 + 2]]);
      const u = q[1].map((x, k) => x - q[0][k]), v = q[2].map((x, k) => x - q[0][k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n);
      if ((n[2] - n[0]) / Math.SQRT2 / (l || 1) > 0.99 && q.every((x) => Math.abs(x[2] - x[0]) < 0.01 && x[0] < 5 && x[1] > 1 && x[1] < 29)) strip = Math.max(strip, ...q.map((x) => x[0]));
    }
  }
  check(strip < 0.4, `knife edge: only a hairline of base on the painted face at the tip (up to x ${strip.toFixed(2)} mm)`);
}
{
  // irregular mesh (slivers, noisy normals and wall thickness): the cover floor is smoothed over the patch instead of
  // offsetting each vertex on its own, and slivers do not collapse it -> no spikes, no near-zero spots in the covers
  const rr = splitColors(w, read3MF(paintedRoughShell3MF()), {}, () => {});
  const th = [];
  for (const p of rr.parts.filter((q) => q.kind === 'cover')) {
    const m = toMan(p.mesh);
    for (let a = 0; a < 360; a += 1.5) for (let z = -4; z <= 4; z += 0.5) {
      const r = Math.sqrt(400 - z * z), d = [(Math.cos((a * Math.PI) / 180) * r) / 20, (Math.sin((a * Math.PI) / 180) * r) / 20, z / 20];
      const hits = m.rayCast(d.map((x) => x * 20.5), d.map((x) => x * 15)).map((h) => h.distance * 5.5).sort((x, y) => x - y);
      if (hits.length >= 2) th.push(hits[hits.length - 1] - hits[0]);
    }
  }
  th.sort((x, y) => x - y);
  const p1 = th[Math.floor(th.length * 0.01)];
  check(th.length > 1000 && p1 > 0.4, `rough mesh: cover floors stay smooth (thickness p1 ${p1.toFixed(2)} mm, ${th.length} samples)`);
  // the bits cut off the covers go back to the base by not carving them (M - (recesses - cutters)), not by a union
  // with the carved base: that union shreds the coincident faces into a knot of degenerate triangles (thousands on a
  // real model: spikes in the view and a viewer frozen at "Piezas sólidas 85 %")
  let deg = 0, nb = 0;
  for (const p of rr.parts.filter((q) => q.kind === 'body')) {
    const { V, T } = p.mesh;
    nb += T.length / 3;
    for (let i = 0; i < T.length; i += 3) {
      const q = [0, 1, 2].map((k) => [V[T[i + k] * 3], V[T[i + k] * 3 + 1], V[T[i + k] * 3 + 2]]);
      const u = q[1].map((x, k) => x - q[0][k]), v = q[2].map((x, k) => x - q[0][k]);
      if (Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) < 1e-6) deg++;
    }
  }
  check(deg < 1500, `rough mesh: no knot of degenerate triangles in the base (${deg} of ${nb})`);
  // thin bow wing: the core's outline follows the wing, not the voxel staircase (few sharp folds in the core)
  const rw2 = splitColors(w, read3MF(paintedWing3MF()), {}, () => {});
  const { V, T } = rw2.parts.find((p) => p.kind === 'body').mesh;
  const N = [], A2 = [], em = new Map();
  let sharp = 0;
  for (let t = 0; t < T.length / 3; t++) {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const u = [0, 1, 2].map((k) => V[b + k] - V[a + k]), v = [0, 1, 2].map((k) => V[c + k] - V[a + k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;
    N.push(n.map((x) => x / l)); A2.push(l / 2);
    if ((V[a + 2] + V[b + 2] + V[c + 2]) / 3 < 12) continue;
    for (let k = 0; k < 3; k++) {
      const p = T[t * 3 + k], q = T[t * 3 + ((k + 1) % 3)], key = Math.min(p, q) * 1e7 + Math.max(p, q);
      if (!em.has(key)) { em.set(key, t); continue; }
      const o2 = em.get(key);
      if (A2[o2] > 1e-3 && A2[t] > 1e-3 && N[o2][0] * N[t][0] + N[o2][1] * N[t][1] + N[o2][2] * N[t][2] < 0.5) sharp++;
    }
  }
  check(sharp < 160, `thin wing: smooth core outline, no voxel staircase (${sharp} folds > 60°)`);
}
const exc = exportFiles(rc, { bedW: 120, bedH: 100, title: 'test' });
const txt = new TextDecoder().decode(exc.files.find((f) => f.name.endsWith('.txt')).data);
check(/covers: \d+/.test(txt) && /COVER/.test(txt), 'covers instructions exported');

// export: one 3MF + STL per color plate (parts on the bed), reference assembly, instructions
const ex = exportFiles(r, { bedW: 120, bedH: 100, title: 'test' });
const names = ex.files.map((f) => f.name);
check(names.filter((n) => n.endsWith('.3mf')).length === ex.plates.length + 1 && names.some((n) => n.endsWith('.txt')), `export files: ${names.length}`);
let bedOk = true, countOk = 0;
for (const pl of ex.plates) {
  const f = ex.files.find((x) => x.name === pl.file);
  const m = read3MF(f.data);
  countOk += m.parts.length;
  for (const p of m.parts) for (let i = 0; i < p.V.length; i += 3) if (p.V[i] < -0.01 || p.V[i + 1] < -0.01 || p.V[i] > 120.01 || p.V[i + 1] > 100.01 || p.V[i + 2] < -0.01) bedOk = false;
  if (m.palette.length !== 1 || m.palette[0] !== r.palette[pl.color]) bedOk = false;
}
check(countOk === r.parts.length, `exported 3MFs re-open with all ${countOk} parts`);
check(bedOk, 'exported parts sit on the bed (inside 120×100, z ≥ 0) with their color');

console.log(fails ? `\n${fails} FAILED` : '\ncolorsplit OK');
process.exit(fails ? 1 : 0);

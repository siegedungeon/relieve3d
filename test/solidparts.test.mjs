// Clean-up helpers of the colour split (src/core/solidparts.js). dropSpecks: specks, tiny voids and the flat zero-volume
// leftovers of booleans go, real voids stay, and every kept triangle still knows the painted shell and triangle it came
// from (the colour of each face is read from that).
import Module from 'manifold-3d';
import { dropSpecks } from '../src/core/solidparts.js';

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

const w = await Module();
w.setup();
const { Manifold, Mesh } = w;
const garbage = [];
const keep = (m) => { garbage.push(m); return m; };

// an axis-aligned box (outward, or inward = the wall of a void) appended to the triangle list of one source object
function box(o, lo, hi, inward = false) {
  const b = o.V.length / 3;
  for (let i = 0; i < 8; i++) o.V.push(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]);
  for (const [a, c, d, e] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) {
    const q = inward ? [a, e, d, c] : [a, c, d, e];
    o.T.push(b + q[0], b + q[1], b + q[2], b + q[0], b + q[2], b + q[3]);
  }
}
// a closed tetrahedron whose apex lies `lift` off the plane of its base: lift 0 = flat, zero volume (what booleans of
// overlapping shells leave behind); the sign of lift sets the sign of the volume
function sliver(o, x, y, z, lift) {
  const b = o.V.length / 3;
  o.V.push(x, y, z, x + 2, y, z, x, y + 2, z, x + 0.5, y + 0.5, z + lift);
  o.T.push(b, b + 2, b + 1, b, b + 1, b + 3, b + 1, b + 2, b + 3, b + 2, b, b + 3);
}

// sources: A = 10 mm cube with a 4 mm void and a 0.6 mm void, B = 6 mm cube, S = a 0.5 mm speck, J = flat leftovers
const A = { V: [], T: [] }, B = { V: [], T: [] }, S = { V: [], T: [] }, J = { V: [], T: [] };
box(A, [0, 0, 0], [10, 10, 10]);
box(A, [3, 3, 3], [7, 7, 7], true);
box(A, [8, 1, 1], [8.6, 1.6, 1.6], true);
box(B, [20, 0, 0], [26, 6, 6]);
box(S, [30, 0, 0], [30.5, 0.5, 0.5]);
sliver(J, 40, 0, 0, 0);
sliver(J, 40, 5, 0, 1e-4);
sliver(J, 40, 10, 0, -1e-4);
const srcs = [A, B, S, J], ids = srcs.map(() => Manifold.reserveIDs(1));
const V = [], T = [], runIndex = [0], faceID = [];
for (const s of srcs) {
  const b = V.length / 3;
  V.push(...s.V);
  for (const v of s.T) T.push(v + b);
  for (let t = 0; t < s.T.length / 3; t++) faceID.push(t);
  runIndex.push(T.length);
}
const M = keep(new Manifold(new Mesh({ numProp: 3, vertProperties: new Float32Array(V), triVerts: new Uint32Array(T), runIndex: new Uint32Array(runIndex), runOriginalID: new Uint32Array(ids), faceID: new Uint32Array(faceID) })));
const vols = (m) => m.decompose().map((c) => { const v = c.volume(); c.delete(); return v; }).sort((a, b) => b - a);
const v0 = vols(M);
check(v0.length >= 7 && v0.filter((v) => Math.abs(v) < 1e-3).length >= 2, `the test model has the cubes, voids, speck and flat leftovers as separate pieces (${v0.map((v) => v.toFixed(4)).join(' ')})`);

const R = dropSpecks(w, M, keep);
const v1 = vols(R);
check(v1.length === 3 && Math.abs(v1[0] - 1000) < 0.01 && Math.abs(v1[1] - 216) < 0.01 && Math.abs(v1[2] + 64) < 0.01,
  `kept: the two cubes and the real void, nothing else - no speck, flat leftover or tiny void (${v1.map((v) => v.toFixed(4)).join(' ')})`);
check(Math.abs(R.volume() - (1000 - 64 + 216)) < 0.01, `volume ${R.volume().toFixed(3)} = cube with its real void (tiny void filled) + cube B`);
check(R.numTri() === 36, `no triangles added: ${R.numTri()} (outer cube, its void and cube B have 12 each)`);
// provenance: each triangle maps back to the very triangle of its source object
const g = R.getMesh(), P = g.vertProperties, np = g.numProp;
let bad = 0, srcHit = new Set();
for (let r = 0; r < g.runOriginalID.length; r++) {
  const k = ids.indexOf(g.runOriginalID[r]);
  for (let t = g.runIndex[r] / 3; t < g.runIndex[r + 1] / 3; t++) {
    if (k < 0) { bad++; continue; }
    srcHit.add(k);
    const s = srcs[k], f = g.faceID[t];
    const want = [0, 1, 2].map((j) => s.V.slice(s.T[f * 3 + j] * 3, s.T[f * 3 + j] * 3 + 3).join()).sort().join('|');
    const got = [0, 1, 2].map((j) => [0, 1, 2].map((a) => P[g.triVerts[t * 3 + j] * np + a]).join()).sort().join('|');
    if (want !== got) bad++;
  }
}
check(!bad && srcHit.size === 2 && srcHit.has(0) && srcHit.has(1), `every kept triangle maps to its source object and triangle (${bad} wrong; sources ${[...srcHit].join(',')})`);

// a model that is already clean comes back as it is
const C = keep(Manifold.cube([5, 5, 5]));
check(dropSpecks(w, C, keep) === C, 'a single solid is returned untouched');

for (const m of garbage) m.delete();
console.log(fails ? `\n${fails} FAILED` : '\nall solidparts checks passed');
process.exitCode = fails ? 1 : 0;

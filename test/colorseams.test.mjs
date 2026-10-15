import Module from 'manifold-3d';
import { splitColors } from '../src/core/colorsplit.js';
import { painted } from './fixtures/multicolor.mjs';
import { triangleQuery } from '../src/core/trianglequery.js';
import { triDist2 } from '../src/core/colorskin.js';
import { openPaint } from '../src/core/colorcarve.js';

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
const w = await Module(); w.setup();
const { Manifold, CrossSection, Mesh } = w;
for (const flip of [false, true]) for (const curved of [false, true]) {
  // Narrow triangles along a wide patch are not a narrow painted stroke (the real bow's white bites).
  const P = [], T = [], colors = [], xs = [-1, 0, 0.2, 4];
  for (let j = 0; j <= 10; j++) for (const x of xs) P.push(x, j * 2, curved ? 0.04 * j * j : 0);
  for (let j = 0; j < 10; j++) for (let i = 0; i < 3; i++) {
    const a = j * 4 + i, b = a + 1, c = a + 4, d = c + 1;
    T.push(...((flip !== !!(i % 2)) ? [a, b, d, a, d, c] : [a, b, c, b, d, c]));
    colors.push(i ? 1 : 0, i ? 1 : 0);
  }
  const merged = Uint32Array.from({ length: P.length / 3 }, (_, i) => i), col = Int16Array.from(colors);
  const changed = openPaint(col, P, 3, T, merged, 0.3);
  check(changed === 0 && col.every((c, t) => c === colors[t]), `cleanup: wide patch keeps its exact edge with uneven triangles (flip ${flip}, curved ${curved})`);
  const narrow = Int16Array.from(colors, (_, t) => Math.floor(t / 2) % 3 === 1 ? 1 : 0);
  openPaint(narrow, P, 3, T, merged, 0.3);
  check(narrow.every(c => c === 0), 'cleanup: a real 0.2 mm stroke is still removed');
  const separated = Int16Array.from(colors), key = Int16Array.from(colors, (_, t) => Math.floor(t / 2) % 3 === 2 ? 1 : 0);
  openPaint(separated, P, 3, T, merged, 0.3, undefined, key);
  check(separated.every((c, t) => c === (key[t] ? 1 : 0)), 'cleanup: a separate wide piece cannot protect the thin stroke');
}
{
  let seed = 12345;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const P = new Float64Array(128 * 3 * 4), T = Uint32Array.from({ length: 128 * 3 }, (_, i) => i);
  const col = Int16Array.from({ length: 128 }, (_, i) => i % 43);
  for (let t = 0; t < 128; t++) {
    const origin = [random() * 10, random() * 10, random() * 10], size = t % 2 ? 0.02 : 2;
    for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) P[(t * 3 + v) * 4 + k] = origin[k] + random() * size;
  }
  const query = triangleQuery(P, 4, T, col), hit = new Float64Array(2);
  let correct = true;
  for (let i = 0; i < 200; i++) for (const [only, except] of [[-1, -1], [2, -1], [-1, 2], [34, -1], [-1, 34], [43, -1]]) {
    const p = i < 128 ? [0, 1, 2].map(k => (P[i * 12 + k] + P[i * 12 + 4 + k] + P[i * 12 + 8 + k]) / 3 + (k === 2 ? 1e-4 : 0)) :
      [random() * 12 - 1, random() * 12 - 1, random() * 12 - 1];
    let best = Infinity;
    for (let t = 0; t < col.length; t++) {
      if (col[t] === except || (only >= 0 && col[t] !== only)) continue;
      const a = t * 12, b = a + 4, c = b + 4;
      best = Math.min(best, triDist2(...p, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]));
    }
    query(p, only, except, hit);
    correct &&= best === Infinity ? hit[0] === -1 && hit[1] === Infinity : Math.abs(hit[1] - best) < 1e-10;
    if (hit[0] >= 0) correct &&= col[hit[0]] !== except && (only < 0 || col[hit[0]] === only);
  }
  check(correct, 'triangle queries: tiny faces and 43-colour filters match exhaustive distances');
  triangleQuery([], 3, [], [])([0, 0, 0], -1, -1, hit);
  check(hit[0] === -1 && hit[1] === Infinity, 'triangle queries: empty surfaces have no nearest triangle');
}
const rotation = (angles) => ([x, y, z]) => {
  for (let axis = 0; axis < 3; axis++) {
    const c = Math.cos(angles[axis] * Math.PI / 180), s = Math.sin(angles[axis] * Math.PI / 180);
    if (axis === 0) [y, z] = [c * y - s * z, s * y + c * z];
    if (axis === 1) [x, z] = [c * x + s * z, -s * x + c * z];
    if (axis === 2) [x, y] = [c * x - s * y, s * x + c * y];
  }
  return [x, y, z];
};
function split(model, rotate, options = {}) {
  for (const p of model.parts) for (let i = 0; i < p.V.length; i += 3) p.V.set(rotate(p.V.subarray(i, i + 3)), i);
  const r = splitColors(w, model, options);
  const parts = r.parts.map(p => {
    const g = new Mesh({ numProp: 3, vertProperties: p.mesh.V, triVerts: p.mesh.T });
    g.merge();
    return { ...p, man: new Manifold(g) };
  });
  check(parts.every(p => p.man.status() === 'NoError' && p.man.volume() > 1), 'seams: all parts are closed solids, not crumbs');
  const disconnected = parts.some(p => {
    const cs = p.man.decompose(), n = cs.length;
    cs.forEach(c => c.delete());
    return n !== 1;
  });
  check(!disconnected, 'seams: no loose bodies inside a part');
  const union = Manifold.union(parts.map(p => p.man));
  const overlap = parts.reduce((s, p) => s + p.man.volume(), 0) - union.volume();
  check(overlap < 0.005, `seams: no assembled overlap (${overlap.toFixed(6)} mm3)`);
  union.delete();
  return parts;
}
function paintedAt(parts, color, p, normal) {
  const a = p.map((x, k) => x + normal[k] * 0.1), b = p.map((x, k) => x - normal[k] * 0.005);
  return parts.some(q => q.color === color && q.man.rayCast(a, b).length);
}
function boundary(test, increasing, lo, hi) {
  for (let k = 0; k < 13; k++) {
    const x = (lo + hi) / 2;
    if (test(x) === increasing) hi = x; else lo = x;
  }
  return (lo + hi) / 2;
}

for (const angles of [[13, 7, 11], [27, -19, 31]]) {
  const rotate = rotation(angles), half = 4 * Math.tan(25 * Math.PI / 180), len = Math.hypot(4, half);
  const normal = [-4 / len, half / len, 0], rn = rotate(normal);
  const cs = new CrossSection([[-half, 0], [half, 0], [0, 4]]), blade = cs.extrude(20);
  const cube = Manifold.cube([20, 3, 20]), block = cube.translate([-10, -3, 0]);
  const model = painted(blade.add(block), 2, 'rotated taper', (_, n) => n[0] * normal[0] + n[1] * normal[1] > 0.999 ? 1 : 0);
  [cs, blade, cube, block].forEach(m => m.delete());
  const parts = split(model, rotate);
  check(parts.length === 2 && parts.filter(p => p.kind === 'body').length === 1, 'taper: one base and one attached colour piece');
  const edges = [];
  let interior = true;
  for (let i = 0; i < 200; i++) {
    const z = 3 + i * 0.07, point = y => rotate([-half * (1 - y / 4), y, z]);
    edges.push(boundary(y => paintedAt(parts, 1, point(y), rn), false, 2, 4));
    for (const y of [2.97, 3.1, 3.5]) interior &&= paintedAt(parts, 1, point(y), rn);
  }
  const scale = len / 4, waviness = (Math.max(...edges) - Math.min(...edges)) * scale;
  const ideal = 4 - 0.075 * 4 / half, error = Math.max(...edges.map(y => Math.abs(y - ideal))) * scale;
  check(waviness < 0.035 && error < 0.035, `taper ${angles}: straight edge within 0.035 mm (waviness ${waviness.toFixed(4)}, error ${error.toFixed(4)})`);
  check(interior, 'taper: the opposite face and finite paint corners make no holes in the colour');
  parts.forEach(p => p.man.delete());
}

for (const clearance of [0.15, 0]) {
  const rotate = rotation([13, 7, 11]), normal = rotate([0, 0, 1]);
  // Measure the straight span away from protected end junctions, then check those corners separately.
  const a = Manifold.cube([6, 20, 5]), b = Manifold.cube([6, 20, 5]);
  const left = a.translate([-6, -10, -5]), right = b.translate([0, -10, -5]);
  const model = painted(left.add(right), 3, 'flat seam', (c, n) => n[2] > 0.999 ? (c[0] < 0 ? 1 : 2) : 0);
  [a, b, left, right].forEach(m => m.delete());
  const source = model.parts[0];
  check(source.tc.every((c, t) => c === 0 || [0, 1, 2].every(k => (c === 1 ? -1 : 1) * source.V[source.T[t * 3 + k] * 3] >= -1e-6)), 'flat fixture: the original paint edge is exactly straight');
  const parts = split(model, rotate, { clearance });
  check(parts.length === 3 && parts.filter(p => p.kind === 'body').length === 1, 'flat seam: one base and two non-base colours');
  let maxError = 0, minGap = Infinity, maxGap = -Infinity;
  for (let i = 0; i < 80; i++) {
    const y = -4 + i * 0.1, point = x => rotate([x, y, 0]);
    const a = boundary(x => paintedAt(parts, 1, point(x), normal), false, -1, 1);
    const b = boundary(x => paintedAt(parts, 2, point(x), normal), true, -1, 1);
    maxError = Math.max(maxError, Math.abs(a + clearance / 2), Math.abs(b - clearance / 2));
    minGap = Math.min(minGap, b - a); maxGap = Math.max(maxGap, b - a);
  }
  check(maxError < 0.02, `non-base seam: exact paint boundary (${maxError.toFixed(4)} mm error)`);
  check(minGap >= clearance - 0.025 && maxGap <= clearance + 0.025, `non-base seam: ${clearance} mm clearance kept (${minGap.toFixed(4)}..${maxGap.toFixed(4)})`);
  let corners = true;
  for (const y of [-9.3, 9.3]) for (const x of [-0.7, 0.7]) {
    corners &&= paintedAt(parts, x < 0 ? 1 : 2, rotate([x, y, 0]), normal);
    corners &&= paintedAt(parts, 0, rotate([x, Math.sign(y) * 10, -0.5]), rotate([0, Math.sign(y), 0]));
  }
  check(corners, 'three-colour corners: no holes in either patch and no paint on the adjacent base face');
  parts.forEach(p => p.man.delete());
}

console.log(fails ? `\n${fails} FAILED` : '\ncolorseams OK');
process.exit(fails ? 1 : 0);

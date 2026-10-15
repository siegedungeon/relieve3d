import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { fitSculptParts } from '../src/core/colorsculpt_fit.js';
import { instructions, write3MF, writeSTL } from '../src/core/colorsplit_export.js';
import { unzipSync, strFromU8 } from 'fflate';

const w = await Module(); w.setup();
const { Manifold } = w, owned = new Set();
const keep = m => (owned.add(m), m);
const cube = (size, at) => keep(keep(Manifold.cube(size)).translate(at));
const fit = parts => fitSculptParts({ w, parts, keep, warnings: [], progress: () => {} });
const cover = (man, color = 1, up = [0, 0, 1]) => ({ kind: 'cover', man, color, up });
const base = man => ({ kind: 'body', man, color: 0, up: null });
const intersection = (a, b) => {
  const m = a.intersect(b);
  try { return Math.max(0, m.volume()); } finally { m.delete(); }
};

try {
  const coordinates = Float32Array.from([1.000041, 0, 0, 1.000049, 0, 0, 1, 1, 0]);
  const file = write3MF([{ name: 'Fine mesh edge', V: coordinates, T: [0, 1, 2], color: 0 }]);
  const xml = strFromU8(unzipSync(file)['3D/3dmodel.model']);
  const restored = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].flatMap(m => m.slice(1).map(Number));
  assert.deepEqual(restored, Array.from(coordinates), '3MF serialization does not collapse nearby vertices by rounding');
  assert.throws(() => write3MF([{ name: 'Invalid', V: [NaN, 0, 0], T: [], color: 0 }]), /no finita/);
  const microscopic = keep(cube([10, 10, 10], [0, 0, 0]).trimByPlane([-1, -1, -1], -29.999995));
  const cleanBody = fit([base(microscopic)])[0].man.getMesh();
  const posed = Float32Array.from(cleanBody.vertProperties, (v, i) => v + (i % 3 < 2 ? 128 : 0));
  const stl = writeSTL([{ V: posed, T: cleanBody.triVerts }]), bytes = new DataView(stl.buffer, stl.byteOffset, stl.byteLength), triangles = bytes.getUint32(80, true);
  const points = new Float32Array(triangles * 9);
  for (let t = 0; t < triangles; t++) for (let k = 0; k < 9; k++) points[t * 9 + k] = bytes.getFloat32(84 + t * 50 + 12 + k * 4, true);
  const stlMesh = new w.Mesh({ numProp: 3, vertProperties: points, triVerts: Uint32Array.from({ length: triangles * 3 }, (_, i) => i) });
  stlMesh.merge();
  const placed = keep(new Manifold(stlMesh)), placedParts = placed.decompose();
  assert.equal(placedParts.length, 1, 'microscopic mesh edges do not become extra STL shells after bed placement');
  assert.equal(placed.genus(), 0);
  placedParts.forEach(p => p.delete());
  const core = cube([20, 20, 5], [-10, -10, -5]);
  const tower = cube([0.5, 2, 2.4], [2.1, -1, 0]);
  const lip = cube([0.8, 2, 0.4], [1.8, -1, 2]);
  const body = keep(Manifold.union([core, tower, lip]));
  const tile = cube([4, 4, 1], [-2, -2, 0.15]);
  assert.equal(intersection(body, tile), 0, 'the seat itself is clear');
  const blocked = keep(tile.translate([0, 0, 1]));
  assert.ok(intersection(body, blocked) > 0.01, 'the hidden lip obstructs the approach, not the seat');
  const result = fit([base(body), cover(tile)]);
  const fitted = result[0].man;
  assert.ok(body.volume() - fitted.volume() > 0.1 && body.volume() - fitted.volume() < 1, 'only the obstructing lip is relieved');
  assert.equal(fitted.genus(), 0);
  const difference = keep(tile.subtract(result[1].man)), reverse = keep(result[1].man.subtract(tile));
  assert.ok(Math.abs(difference.volume()) + Math.abs(reverse.volume()) < 1e-8, 'the visible coloured part is unchanged');
  for (let d = 0; d < 20; d += 0.05) {
    const moved = tile.translate([0, 0, d]);
    assert.ok(intersection(fitted, moved) < 1e-6, `complete insertion is clear at ${d} mm`);
    moved.delete();
  }
  const upper = cube([4, 4, 1], [-2, -2, 1.35]);
  const ordered = fit([base(core), cover(upper, 2), cover(tile)]);
  assert.deepEqual(ordered.map(p => p.color), [0, 1, 2], 'a lower piece must be mounted before the piece over it');
  assert.deepEqual(ordered.map(p => p.assemblyStep), [0, 1, 2]);
  const assembly = instructions({
    covers: true, sculpt: true, assemblyChecked: true,
    parts: ordered.map(p => ({
      ...p, name: `Part ${p.color}`, n: p.up, volume: p.man.volume(),
      print: { size: [0, 1, 2].map(a => p.man.boundingBox().max[a] - p.man.boundingBox().min[a]) }
    }))
  }, { clearance: 0.15 }, []);
  assert.ok(assembly.includes('volúmenes rellenos'), 'sculpt instructions include the filled colour solids');
  assert.ok(!assembly.includes('pégalas al final'), 'generic glue-last advice must not contradict the computed assembly order');
  assert.ok(assembly.includes('  1. Part 1: salida (0.0000, 0.0000, 1.0000)\r\n  2. Part 2: salida (0.0000, 0.0000, 1.0000)'), 'instructions preserve the checked installation order and directions');

  const cavity = cube([2, 2, 2], [-1, -1, -3.5]), hollow = keep(core.subtract(cavity));
  const hollowResult = fit([base(hollow), cover(tile)]);
  const hollowParts = hollowResult[0].man.decompose();
  assert.equal(hollowParts.length, 2);
  assert.ok(hollowParts.some(p => p.volume() < -7.99), 'an existing enclosed void is retained with its body');
  hollowParts.forEach(p => p.delete());

  const away = cube([10, 10, 10], [30, 30, -10]);
  assert.throws(() => fit([base(away), cover(tile), cover(upper, 2, [0, 0, -1])]), /orden de montaje seguro/, 'mutually blocked colour pieces are rejected');
  const trapped = cube([4, 4, 1], [-2, -2, -4]);
  assert.throws(() => fit([base(core), cover(trapped)]), /alteraría demasiado/, 'a destructive assembly recess is rejected');
  console.log('colorsculpt fit OK');
} finally {
  for (const m of owned) m.delete();
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'manifold-3d';
import { read3MF } from '../src/core/threemf_read.js';

export async function checkPencilExports(directory, name, channel,
  { calibre = 7.8, height = 13.4, colors = 3, maxDimensions = null, minContourVariation = 0, minWall = 0 } = {}) {
  const w = await Module(); w.setup();
  const model = read3MF(new Uint8Array(fs.readFileSync(path.join(directory, name + '.3mf'))));
  assert.equal(model.palette.length, colors, 'export keeps the selected colours');
  const owned = [];
  const own = m => { owned.push(m); return m; };
  const from = (V, T) => {
    const mesh = new w.Mesh({ numProp: 3, vertProperties: Float32Array.from(V), triVerts: Uint32Array.from(T) });
    mesh.merge();
    const m = own(new w.Manifold(mesh));
    assert.equal(m.status(), 'NoError', 'exported part is a closed solid');
    return m;
  };
  const measure = m => {
    const b = m.boundingBox(), [_, y, z] = channel.center;
    assert.equal(m.rayCast([b.min[0] - 1, y, z], [b.max[0] + 1, y, z]).length, 0, 'export retains a through-bore');
    for (const x of [b.min[0] + 6, (b.min[0] + b.max[0]) / 2, b.max[0] - 6]) for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ray = Math.max(b.max[1] - b.min[1], b.max[2] - b.min[2]) + 2;
      const hits = m.rayCast([x, y, z], [x, y + ray * u, z + ray * v]);
      assert(hits.length > 0, 'no unintended side opening in channel');
      assert(Math.abs(hits[0].distance * ray * 2 - calibre) < 0.015, 'exported bore has the requested final calibre');
      if (minWall) assert(hits.length >= 2 && (hits[1].distance - hits[0].distance) * ray >= minWall - 0.02, 'channel retains its minimum solid wall');
    }
    assert(Math.abs(b.max[2] - height) < 0.002, 'base and relief heights survive export');
    if (maxDimensions) for (let i = 0; i < 3; i++) {
      assert(b.max[i] - b.min[i] <= maxDimensions[i], 'export respects the maximum dimensions');
    }
  };
  try {
    const parts = model.parts.map(p => from(p.V, p.T));
    const baseIndex = model.parts.findIndex(p => /Base con canal/.test(p.name));
    assert(baseIndex >= 0, 'drilled base exported');
    const base = parts[baseIndex];
    assert.equal(base.genus(), 1);
    assert.equal(base.decompose().map(own).length, 1);
    if (minContourVariation > 0) {
      const b = base.boundingBox(), edge = [], reach = b.max[1] - b.min[1] + 2;
      for (let i = 0; i <= 100; i++) {
        const x = b.min[0] + 6 + (b.max[0] - b.min[0] - 22) * i / 100;
        const hits = base.rayCast([x, b.min[1] - 1, b.max[2] - 0.2], [x, b.max[1] + 1, b.max[2] - 0.2]);
        assert(hits.length >= 2, 'name contour remains connected');
        edge.push(hits[0].distance * reach);
      }
      assert(Math.max(...edge) - Math.min(...edge) >= minContourVariation, 'base follows the letters rather than a straight rectangular strip');
    }
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      assert(own(parts[i].intersect(parts[j])).volume() < 1e-4, 'colour volumes do not overlap');
    }
    const union = own(w.Manifold.union(parts));
    assert.equal(union.decompose().map(own).length, 1, 'letters, dot and ribbon all attached to the base');
    measure(union);
    const data = fs.readFileSync(path.join(directory, name + '.stl')), n = data.readUInt32LE(80);
    assert.equal(data.length, 84 + 50 * n);
    const V = new Float32Array(n * 9), T = Uint32Array.from({ length: n * 3 }, (_, i) => i);
    for (let t = 0; t < n; t++) for (let j = 0; j < 9; j++) V[t * 9 + j] = data.readFloatLE(84 + t * 50 + 12 + j * 4);
    const stl = from(V, T);
    assert.equal(stl.decompose().map(own).length, 1, 'single STL is a fused solid, not coincident shells');
    assert.equal(stl.genus(), union.genus(), 'STL preserves the channel and counters');
    assert(Math.abs(stl.volume() - union.volume()) < 0.1, '3MF and STL represent the same material');
    measure(stl);
    return { size: stl.boundingBox(), volume: stl.volume(), colors: model.palette, parts: model.parts.length };
  } finally { for (const m of owned.reverse()) m.delete(); }
}

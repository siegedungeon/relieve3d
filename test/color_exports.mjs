import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'manifold-3d';
import { read3MF } from '../src/core/threemf_read.js';

export async function checkColorExports(directory, originals, { assembly = false } = {}) {
  const w = await Module(); w.setup();
  if (assembly) {
    const manifolds = [];
    try {
      for (const p of originals) {
        const mesh = new w.Mesh({ numProp: 3, vertProperties: Float32Array.from(p.V), triVerts: Uint32Array.from(p.T) }); mesh.merge();
        manifolds.push(new w.Manifold(mesh));
      }
      let step = 0;
      for (let i = 0; i < originals.length; i++) {
        const p = originals[i];
        if (p.kind === 'body') continue;
        assert.equal(p.assemblyStep, ++step, 'pieces are listed in assembly order');
        assert.ok(Math.abs(Math.hypot(...p.n) - 1) < 1e-6, 'insertion direction is normalized');
        for (let j = 0; j < i; j++) for (const d of [0, 0.025, 0.05, 0.1, 0.3, 1, 3, 6, 10, 30, 80]) {
          const move = manifolds[i].translate(p.n.map(x => x * d));
          let hit;
          try {
            hit = move.intersect(manifolds[j]);
            assert.ok(hit.volume() < 1e-4, `${p.name} collides with ${originals[j].name} at ${d} mm (${hit.volume()} mm3)`);
          } finally { hit?.delete(); move.delete(); }
        }
      }
    } finally { manifolds.forEach(m => m.delete()); }
  }
  const signature = ({ V, T }, label = 'app mesh') => {
    const mesh = new w.Mesh({ numProp: 3, vertProperties: Float32Array.from(V), triVerts: Uint32Array.from(T) });
    mesh.merge();
    const man = new w.Manifold(mesh);
    let components = [];
    try {
      assert.equal(man.status(), 'NoError', 'exported mesh is a closed manifold');
      components = man.decompose();
      assert.ok(components.every(c => Math.abs(c.volume()) > 1e-5), `${label}: no flat leftovers or floating specks (${components.filter(c => Math.abs(c.volume()) <= 1e-5).map(c => c.volume()).join(', ')})`);
      return { volume: man.volume(), topology: components.map(c => `${Math.sign(c.volume())}:${c.genus()}`).sort() };
    } finally {
      components.forEach(c => c.delete()); man.delete();
    }
  };
  const expected = new Map(originals.map(p => [p.name, signature(p)]));
  const files = fs.readdirSync(directory).filter(f => f.endsWith('.3mf'));
  assert.ok(files.length >= 2, 'reference and print plates exist');
  for (const file of files) {
    const model = read3MF(new Uint8Array(fs.readFileSync(path.join(directory, file))));
    const all = [], seen = new Set();
    for (const p of model.parts) {
      const want = expected.get(p.name);
      assert.ok(want, `exported object ${p.name} exists in the app`);
      const got = signature(p, `${file}: ${p.name}`);
      assert.deepEqual(got.topology, want.topology, `${file}: ${p.name} keeps its holes and components after placement`);
      assert.ok(Math.abs(got.volume - want.volume) < Math.max(1e-4, want.volume * 1e-5), `${file}: ${p.name} retains its volume`);
      all.push(...got.topology); seen.add(p.name);
    }
    if (/ensamble \(referencia\)/.test(file)) assert.equal(seen.size, originals.length, 'the reference contains every assembled piece');
    const stlPath = path.join(directory, file.replace(/\.3mf$/, '.stl'));
    if (!fs.existsSync(stlPath)) continue;
    const data = fs.readFileSync(stlPath), n = data.readUInt32LE(80);
    assert.equal(data.length, 84 + n * 50);
    const V = new Float32Array(n * 9), T = Uint32Array.from({ length: n * 3 }, (_, i) => i);
    for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) V[t * 9 + k] = data.readFloatLE(84 + t * 50 + 12 + k * 4);
    const stl = signature({ V, T }, stlPath);
    assert.deepEqual(stl.topology, all.sort(), `${file}: STL keeps the same solids and holes as 3MF`);
  }
  return files.length;
}

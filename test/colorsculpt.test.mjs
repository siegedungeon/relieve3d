import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { splitColors } from '../src/core/colorsplit.js';
import { blurGrid } from '../src/core/gridfield.js';
import { exportFiles } from '../src/core/colorsplit_export.js';

const w = await Module(); w.setup();
const { Manifold, Mesh } = w;

function strip(amplitude, count = 2) {
  const V = [], T = [], tc = [], rows = 81, columns = count + 1;
  const id = (layer, j, i) => (layer * rows + j) * columns + i;
  for (let layer = 0; layer < 2; layer++) for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const x = -6 + 12 * i / count + (i > 0 && i < count ? amplitude * Math.sin(j * Math.PI / 2) : 0);
      V.push(x, -10 + j * 0.25, layer ? 0 : -5);
    }
  }
  const face = (a, b, c, d, color) => { T.push(a, b, c, a, c, d); tc.push(color, color); };
  for (let j = 0; j + 1 < rows; j++) {
    for (let i = 0; i < count; i++) {
      face(id(1, j, i), id(1, j, i + 1), id(1, j + 1, i + 1), id(1, j + 1, i), i + 1);
      face(id(0, j, i), id(0, j + 1, i), id(0, j + 1, i + 1), id(0, j, i + 1), 0);
    }
    face(id(0, j, 0), id(1, j, 0), id(1, j + 1, 0), id(0, j + 1, 0), 0);
    face(id(0, j, count), id(0, j + 1, count), id(1, j + 1, count), id(1, j, count), 0);
  }
  for (let i = 0; i < count; i++) {
    face(id(0, 0, i), id(0, 0, i + 1), id(1, 0, i + 1), id(1, 0, i), 0);
    face(id(0, rows - 1, i), id(1, rows - 1, i), id(1, rows - 1, i + 1), id(0, rows - 1, i + 1), 0);
  }
  return { palette: ['#FFFFFF', '#88DDBB', '#EEAACC', '#88AADD', '#DDAA88'].slice(0, columns), names: ['Base', 'Green', 'Pink', 'Blue', 'Orange'].slice(0, columns),
    parts: [{ V: Float64Array.from(V), T: Uint32Array.from(T), tc: Uint8Array.from(tc) }] };
}
function solid(p) {
  const mesh = new Mesh({ numProp: 3, vertProperties: Float32Array.from(p.V), triVerts: p.T });
  mesh.merge();
  return new Manifold(mesh);
}
{
  const n = [4, 5, 6], F = Float32Array.from({ length: 120 }, (_, i) => Math.sin(i));
  const expected = F.slice(), temp = new Float32Array(F.length), strides = [1, 4, 20];
  for (let p = 0; p < 2; p++) for (let k = 0; k < 3; k++) {
    const s = strides[k];
    for (let i = 0; i < F.length; i++) {
      const c = Math.floor(i / s) % n[k];
      temp[i] = (expected[c ? i - s : i] + expected[i] + expected[c + 1 < n[k] ? i + s : i]) / 3;
    }
    expected.set(temp);
  }
  assert.deepEqual(blurGrid(F, n, 2), expected, 'shared diffusion preserves the existing grid blur');
}

for (const options of [{ skinSmooth: 0 }, { skinSmooth: -1 }, { skinSmooth: Infinity }, { skinSmooth: 4 }, { skinGrid: 0 }, { skinDepth: 0 }, { clearance: 3 }]) {
  assert.throws(() => splitColors(w, strip(0), { mode: 'sculpt', ...options }), /esculpido|Esculpido/, 'invalid sculpt settings are rejected explicitly');
}
assert.throws(() => splitColors(w, strip(0), { mode: 'sculpt' }, message => {
  if (message === 'Capa exterior: distancias') throw new Error('interrupted sculpt regression');
}), /interrupted sculpt regression/, 'an interrupted job propagates its error; subsequent runs still work');

for (const angles of [[0, 0, 0], [27, -19, 31]]) {
  const rotate = p => {
    p = p.slice();
    for (let a = 0; a < 3; a++) {
      const angle = angles[a] * Math.PI / 180, b = (a + 1) % 3, c = (a + 2) % 3, x = p[b], y = p[c];
      p[b] = x * Math.cos(angle) - y * Math.sin(angle);
      p[c] = x * Math.sin(angle) + y * Math.cos(angle);
    }
    return p;
  };
  const model = strip(0), source = model.parts[0];
  // The base-colour half exercises the drafted wall, unlike a joint between two coloured covers.
  source.tc = source.tc.map(c => Math.max(0, c - 1));
  for (let i = 0; i < source.V.length; i += 3) source.V.set(rotate(Array.from(source.V.slice(i, i + 3))), i);
  const result = splitColors(w, model, { mode: 'sculpt', skinGrid: 0.29 });
  assert.equal(result.parts.length, 2, 'a base-colour boundary keeps one body and one coloured piece');
  const body = solid(result.parts[0].mesh), cover = solid(result.parts[1].mesh);
  try {
    for (const man of [body, cover]) {
      assert.equal(man.status(), 'NoError');
      assert.equal(man.genus(), 0, 'polishing does not create tunnels');
      const components = man.decompose();
      assert.equal(components.length, 1, 'polishing does not create floating fragments');
      components.forEach(c => c.delete());
    }
    const edges = [[], []], gaps = [];
    for (let j = 0; j <= 300; j++) {
      const y = -4 + j * 8 / 300;
      for (const [i, man] of [body, cover].entries()) {
        const hits = man.rayCast(rotate([-2, y, 1.195]), rotate([2, y, 1.195]));
        assert.ok(hits.length, 'each colour keeps a continuous visible edge');
        edges[i].push(hits.map(h => -2 + 4 * h.distance).sort((a, b) => Math.abs(a) - Math.abs(b))[0]);
      }
      gaps.push(edges[1].at(-1) - edges[0].at(-1));
    }
    const waviness = Math.max(...edges.map(e => Math.max(...e) - Math.min(...e)));
    console.log('sculpt base seam', { angles, waviness, gap: [Math.min(...gaps), Math.max(...gaps)] });
    assert.ok(waviness < 0.01, 'the drafted base edge has no grid serrations, including on oblique faces');
    assert.ok(Math.min(...gaps) > 0.02 && Math.max(...gaps) < 0.08, 'the polished visible joint stays narrow and open');
    for (const distance of [0, 0.025, 0.05, 0.1, 0.3, 1, 3, 10, 30]) {
      const moved = cover.translate(result.parts[1].n.map(x => x * distance));
      const hit = moved.intersect(body);
      try { assert.ok(hit.volume() < 1e-4, `polished pieces still assemble at ${distance} mm`); }
      finally { hit.delete(); moved.delete(); }
    }
  } finally { body.delete(); cover.delete(); }
}

for (const [amplitude, count] of [[0, 2], [0.18, 2], [0.18, 4]]) {
  const model = strip(amplitude, count), original = solid(model.parts[0]);
  assert.equal(original.status(), 'NoError');
  assert.ok(Math.abs(original.volume() - 1200) < 1e-4, 'closed fixture with unchanged external shape');
  const result = splitColors(w, model, { mode: 'sculpt' });
  assert.equal(result.previewOnly, false);
  assert.equal(result.assemblyChecked, true, 'exportable geometry has passed the assembly stage');
  assert.deepEqual(result.parts.map(p => p.assemblyStep), Array.from({ length: count + 1 }, (_, i) => i));
  assert.ok(exportFiles(result).files.some(f => f.name.endsWith('.3mf')), 'checked sculpt geometry can be exported');
  assert.throws(() => exportFiles({ ...result, previewOnly: true }), /vista previa/, 'old previews remain blocked');
  assert.throws(() => exportFiles({ ...result, assemblyChecked: false }), /comprobación/, 'unchecked sculpt geometry is blocked');
  const parts = result.parts.map(p => ({ ...p, man: solid(p.mesh) }));
  console.log('sculpt fixture', { amplitude, parts: parts.length, warnings: result.warnings });
  assert.equal(parts.length, count + 1, 'flat colour patches are not split because of their hidden side walls');
  assert.equal(parts.filter(p => p.kind === 'body').length, 1);
  for (let c = 1; c <= count; c++) assert.ok(parts.some(p => p.color === c), `colour ${c} remains`);
  let overlap = 0;
  for (let i = 0; i < parts.length; i++) {
    const m = parts[i].man, components = m.decompose();
    assert.equal(m.status(), 'NoError');
    assert.ok(m.volume() > 1);
    assert.equal(components.length, 1, 'no floating fragments');
    assert.equal(m.genus(), 0, 'no accidental tunnels');
    components.forEach(c => c.delete());
    for (let j = i + 1; j < parts.length; j++) {
      const hit = m.intersect(parts[j].man);
      overlap += Math.max(0, hit.volume()); hit.delete();
    }
  }
  assert.ok(overlap < 0.01, `parts do not overlap (${overlap})`);
  const body = parts.find(p => p.kind === 'body').man, missing = original.subtract(body);
  assert.ok(missing.volume() < 240 * 0.075 + 0.01 * original.volume(), 'core loss is limited to its half-clearance and bounded rounding');
  const floor = body.rayCast([0, 0, -1], [0, 0, 1]).map(h => -1 + 2 * h.distance);
  assert.ok(floor.some(z => Math.abs(z + 0.075) < 0.001), 'the core shares the clearance with the cover floor');
  missing.delete();
  for (const height of [0.2, 1.19]) {
    const edges = [[], []], gaps = [];
    for (let j = 0; j < 100; j++) {
      const y = -4 + 0.08 * j;
      for (let side = 0; side < 2; side++) {
        const c = count / 2 + side;
        const hits = parts.filter(p => p.color === c).flatMap(p => p.man.rayCast([-2, y, height], [2, y, height]));
        assert.ok(hits.length, `colour ${c} has a continuous wall at ${y}, ${height}`);
        edges[side].push(hits.map(h => -2 + 4 * h.distance).sort((a, b) => Math.abs(a) - Math.abs(b))[0]);
      }
      gaps.push(edges[1].at(-1) - edges[0].at(-1));
    }
    const waviness = Math.max(...edges.map(e => Math.max(...e) - Math.min(...e)));
    console.log('sculpt seam', { amplitude, height, waviness, gap: [Math.min(...gaps), Math.max(...gaps)] });
    assert.ok(waviness < 0.05, 'redrawn boundary removes teeth rather than preserving their zigzag');
    assert.ok(gaps.every(g => g >= -0.005), 'the two colour walls do not cross');
    if (height > 1) assert.ok(Math.max(...gaps) < 0.08, 'visible joint stays narrow');
    else assert.ok(Math.min(...gaps) > 0.09 && Math.max(...gaps) < 0.19, 'clearance remains beneath the visible joint');
  }
  parts.forEach(p => p.man.delete()); original.delete();
}
console.log('colorsculpt OK');

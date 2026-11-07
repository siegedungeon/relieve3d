import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '../node_modules/opentype.js/dist/opentype.mjs';
import { unzipSync, strFromU8 } from 'fflate';
import { read3MF } from '../src/core/threemf_read.js';
import {
  DEFAULT_NAME_TREE, NAME_TREE_FONTS, normalizeNameTree, parseTreeNames, prepareNameTree, nameTreeSolids,
  buildNameTree, packNameTree, nameTreeFiles, nameTreeProject, readNameTreeProject,
} from '../src/core/name_tree.js';

const bytes = fs.readFileSync(new URL('../src/fonts/Montserrat-Black.ttf', import.meta.url));
const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
await prepareNameTree();
const names = ['Valentina', 'Sebastián', 'Mateo', 'Camila', 'Lucía', 'José', 'Ana'];
const overlap = (a, b) => { const m = a.intersect(b); try { return m.volume(); } finally { m.delete(); } };
const release = r => r.parts.forEach(p => p.geometry.dispose());

test('names retain accents, spaces, duplicates and per-name colors; invalid limits are rejected', () => {
  assert.deepEqual(parseTreeNames('Ana\nMaría José;Ana').map(n => n.text), ['Ana', 'María José', 'Ana']);
  assert.throws(() => parseTreeNames('  \n'), /nombres/);
  assert.throws(() => parseTreeNames(['A\u0000']), /caracteres/);
  assert.throws(() => parseTreeNames(Array(21).fill('Ana')), /20/);
  assert.throws(() => normalizeNameTree({ maxHeight: '' }), /Alto/);
  assert.throws(() => normalizeNameTree({ bottomDepth: 4, topDepth: 5 }), /superior/);
  assert.throws(() => normalizeNameTree({ maxWidth: Infinity }), /Ancho/);
  assert.throws(() => normalizeNameTree({ custom: [[[0, 0], [1, NaN], [1, 0]]] }), /silueta/);
});

for (const count of [2, 3, 7]) test(`${count} names form printable, aligned, interlocking solids within the exact maximum dimensions`, () => {
  const c = { ...DEFAULT_NAME_TREE(), names: names.slice(0, count) };
  const r = nameTreeSolids(c, { font });
  try {
    assert.equal(r.parts.length, count + 2);
    assert.equal(r.joints.length, count + 1);
    assert(r.plan.width <= c.maxWidth + 1e-5 && r.plan.height <= c.maxHeight + 1e-5);
    assert.deepEqual([...r.plan.levels.map(l => l.index)].sort(), Array.from({ length: count }, (_, i) => i));
    for (const [i, p] of r.parts.entries()) {
      assert.equal(p.solid.status(), 'NoError');
      const islands = p.solid.decompose();
      assert.equal(islands.length, 1, p.name + ' must not contain loose letters or dots');
      islands.forEach(m => m.delete());
      assert(p.solid.volume() > 0);
      assert(Math.abs(p.bounds.min[2]) < 1e-5, 'every back lies directly on the print bed');
      assert(p.bounds.min[0] >= -c.maxWidth / 2 - 1e-4 && p.bounds.max[0] <= c.maxWidth / 2 + 1e-4);
      assert(p.bounds.min[1] >= -1e-5 && p.bounds.max[1] <= c.maxHeight + 1e-4);
      const m = p.solid.getMesh(), V = m.vertProperties, n = m.numProp;
      for (let v = 0; v < m.numVert; v++) {
        const depth = c.bottomDepth + (c.topDepth - c.bottomDepth) * V[v * n + 1] / r.plan.height;
        assert(Math.abs(V[v * n + 2]) < 1e-5 || Math.abs(V[v * n + 2] - depth) < 1e-4,
          'one continuous depth taper, not alternating tilted words');
      }
      for (let t = 0; t < m.triVerts.length; t += 3) {
        const [a, b, d] = [0, 1, 2].map(j => Array.from(V.slice(m.triVerts[t + j] * n, m.triVerts[t + j] * n + 3)));
        const nz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
        assert(nz >= -1e-6 || Math.max(a[2], b[2], d[2]) < 1e-5, 'no downward-facing roofs above the bed');
      }
      for (const other of r.parts.slice(i + 1)) assert(overlap(p.solid, other.solid) < 1e-5, `${p.name} collides with ${other.name}`);
    }
    for (const joint of r.joints) {
      const lower = r.parts[joint.lower].solid, upper = r.parts[joint.upper].solid;
      const lifted = upper.translate([0, 1, 0]);
      try { assert(overlap(lower, lifted) > 0.01, 'dovetail prevents pulling apart vertically'); }
      finally { lifted.delete(); }
      for (const dz of [2, 5, 12]) {
        const sliding = upper.translate([0, 0, dz]);
        try { assert(overlap(lower, sliding) < 1e-5, 'the joint can slide into place through its depth'); }
        finally { sliding.delete(); }
      }
    }
  } finally { r.dispose(); }
});

test('heart/custom toppers, equal depths and lowercase marks remain solid; unreadable or disconnected designs fail explicitly', () => {
  for (const shape of ['heart', 'custom']) {
    const r = nameTreeSolids({ names: ['José', 'María Paz'], uppercase: false, shape, topDepth: 8, bottomDepth: 8,
      custom: [[[-1, 0], [0, -0.5], [1, 0], [0.8, 1], [-0.8, 1]]] }, { font });
    try { assert.equal(r.parts.length, 4); assert(r.parts.every(p => Math.abs(p.size[2] - 8) < 1e-5)); }
    finally { r.dispose(); }
  }
  assert.throws(() => nameTreeSolids({ names: ['😀', 'Ana'] }, { font }), /carácter/);
  assert.throws(() => nameTreeSolids({ names: Array(20).fill('Un nombre demasiado largo'), maxWidth: 40, maxHeight: 60 }, { font }), /pequeños/);
  assert.throws(() => nameTreeSolids({ shape: 'custom', custom: [
    [[0, 0], [1, 0], [1, 1]], [[3, 0], [4, 0], [4, 1]],
  ] }, { font }), /islas/);
});

test('project round-trip preserves custom shape, order, duplicate names, tolerances and colors', () => {
  const cfg = normalizeNameTree({ names: [{ text: 'Ana', color: '#123456' }, { text: 'Ana', color: '#654321' }],
    order: 'manual', shape: 'custom', custom: [[[0, 0], [1, 0], [0.5, 1]]], clearance: 0.35 });
  assert.deepEqual(readNameTreeProject(nameTreeProject(cfg)), cfg);
  assert.throws(() => readNameTreeProject({ app: 'Relieve3D-ArbolNombres', version: 99, cfg }), /compatible/);
  assert.throws(() => readNameTreeProject('broken'), /válido/);
});

test('all offered fonts keep accented names connected and inside their allocated dimensions', () => {
  for (const [family, file] of Object.entries(NAME_TREE_FONTS)) {
    const data = fs.readFileSync(new URL('../src/fonts/' + file, import.meta.url));
    const selected = parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    const r = nameTreeSolids({ font: family, names: ['Ángel', 'María José'], maxWidth: 140, maxHeight: 190 }, { font: selected });
    try {
      for (const p of r.parts) {
        assert(p.bounds.min[0] >= -70.001 && p.bounds.max[0] <= 70.001, family + ' width');
        assert(p.bounds.max[1] <= 190.001, family + ' height');
      }
    } finally { r.dispose(); }
  }
});

test('color plates preserve every independent part, fit the bed without overlap and export a complete assembly and editable project', () => {
  const r = buildNameTree({ names, maxWidth: 150, maxHeight: 300, bedWidth: 180, bedHeight: 180 }, { font });
  try {
    const plates = packNameTree(r), indices = plates.flatMap(p => p.placements.map(q => q.index));
    assert.deepEqual(indices.sort((a, b) => a - b), r.parts.map((_, i) => i));
    for (const plate of plates) for (const [i, a] of plate.placements.entries()) {
      assert.equal(r.parts[a.index].color, plate.color);
      assert(a.x >= 6 && a.y >= 6 && a.x + a.width <= 174 + 1e-5 && a.y + a.height <= 174 + 1e-5);
      for (const b of plate.placements.slice(i + 1)) assert(a.x + a.width + 3.99 <= b.x || b.x + b.width + 3.99 <= a.x
        || a.y + a.height + 3.99 <= b.y || b.y + b.height + 3.99 <= a.y);
    }
    const exported = nameTreeFiles(r);
    assert.equal(exported.files.filter(f => f.name.endsWith('.stl')).length, names.length + 2);
    assert.deepEqual(readNameTreeProject(exported.files.find(f => f.name === 'Proyecto.r3t').data), r.cfg);
    for (const name of exported.plateFiles) {
      const data = exported.files.find(f => f.name === name).data, model = read3MF(data);
      assert.equal(model.palette.length, 1, 'no AMS/color changes on a plate');
      assert(model.parts.length > 0);
      const settings = strFromU8(unzipSync(data)['Metadata/model_settings.config']);
      assert.equal((settings.match(/enable_support" value="0"/g) || []).length, model.parts.length);
      for (const p of model.parts) {
        assert(Math.abs(Math.min(...p.V.filter((_, i) => i % 3 === 2))) < 1e-4);
        const edges = new Map();
        for (let t = 0; t < p.T.length; t += 3) for (let i = 0; i < 3; i++) {
          const a = p.T[t + i], b = p.T[t + (i + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
          edges.set(key, (edges.get(key) || 0) + (a < b ? 1 : 100));
        }
        assert([...edges.values()].every(n => n === 101), 'exported mesh stays closed with consistently oriented shared edges');
      }
    }
    const assembled = read3MF(exported.files.find(f => f.name.startsWith('Vista_armada')).data);
    assert.equal(assembled.parts.length, names.length + 2);
    assert(Math.max(...assembled.parts.map(p => Math.max(...p.V.filter((_, i) => i % 3 === 2)))) <= r.cfg.maxHeight + 1e-4);
    assert.throws(() => packNameTree({ ...r, cfg: { ...r.cfg, bedWidth: 20, bedHeight: 20 } }), /no cabe/);
  } finally { release(r); }
});

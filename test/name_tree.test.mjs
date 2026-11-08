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

const loadFont = file => {
  const bytes = fs.readFileSync(new URL('../src/fonts/' + file, import.meta.url));
  return parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};
const font = loadFont(NAME_TREE_FONTS['Bebas Neue']);
await prepareNameTree();
const seven = ['Sebastián', 'María José', 'Ana', 'Luis', 'Valentina', 'Mateo', 'Sofía'];
const take = (m, f) => { try { return f(m); } finally { m.delete(); } };
const volume = m => take(m, x => x.volume());
const overlap = (a, b) => volume(a.intersect(b));
const moved = (m, d, f) => take(m.translate(d), f);
const islands = m => { const list = m.decompose(); list.forEach(x => x.delete()); return list.length; };
const release = r => r.parts.forEach(p => p.geometry.dispose());
const mesh = solid => {
  const m = solid.getMesh(), V = [];
  for (let v = 0; v < m.numVert; v++) V.push([0, 1, 2].map(j => m.vertProperties[v * m.numProp + j]));
  return { V, T: m.triVerts };
};
// What is left of each white the plaque closes in (holes, slots and gaps between letters) once the printed walls take
// 0.35 mm on each side: 0 means it fills up and 2 or more that it pinches shut, so the word stops reading.
const holes = cs => {
  const hull = cs.hull(), inset = hull.offset(-0.02, 'Miter', 2), white = hull.subtract(cs), whites = white.decompose();
  try {
    return whites.filter(w => w.area() > 1e-3 && take(w.subtract(inset), x => x.area() < 1e-6)).map(w => take(w.offset(-0.35, 'Round', 2, 32), e => {
      const parts = e.decompose(), n = parts.filter(x => x.area() > 1e-6).length;
      parts.forEach(x => x.delete());
      return n;
    }));
  } finally { [hull, inset, white, ...whites].forEach(x => x.delete()); }
};

test('names, trunk text, depths and limits are validated', () => {
  assert.deepEqual(parseTreeNames('Ana\nMaría José;Ana').map(n => n.text), ['Ana', 'María José', 'Ana']);
  assert.throws(() => parseTreeNames('  \n'), /nombres/);
  assert.throws(() => parseTreeNames(['A\u0000']), /caracteres/);
  assert.throws(() => parseTreeNames(Array(21).fill('Ana')), /20/);
  assert.throws(() => normalizeNameTree({ maxHeight: '' }), /Alto/);
  assert.throws(() => normalizeNameTree({ bottomDepth: 10, topDepth: 12 }), /superior/);
  assert.throws(() => normalizeNameTree({ bottomDepth: 6 }), /Grosor inferior/);
  assert.throws(() => normalizeNameTree({ topDepth: 4 }), /Grosor superior/);
  assert.throws(() => normalizeNameTree({ maxWidth: Infinity }), /Ancho/);
  assert.throws(() => normalizeNameTree({ trunk: 'pino' }), /Tronco/);
  assert.throws(() => normalizeNameTree({ trunkText: '   ' }), /tronco/);
  assert.throws(() => normalizeNameTree({ trunkText: 'x'.repeat(17) }), /16/);
  assert.equal(normalizeNameTree({ trunk: 'block', trunkText: '' }).trunk, 'block');
  assert.throws(() => normalizeNameTree({ custom: [[[0, 0], [1, NaN], [1, 0]]] }), /silueta/);
});

test('the default tree follows the reference model: listed names bottom-up, narrowing bands and a proportional star', () => {
  const r = nameTreeSolids(DEFAULT_NAME_TREE(), { font });
  try {
    assert.deepEqual(r.parts.map(p => p.name), ['Tronco', 'DIEGO', 'MILDRED', 'VIOLETTA', 'CELESTE', 'Estrella']);
    assert(Math.abs(r.plan.width - 160) < 0.5 && Math.abs(r.plan.height - 240) < 0.5, 'uses the full maximum size');
    r.plan.levels.slice(1).forEach((l, i) => assert(l.width < r.plan.levels[i].width && l.cap < r.plan.levels[i].cap));
    assert(r.plan.top.width >= 0.28 * r.plan.W - 1e-6 && r.plan.top.width <= 0.38 * r.plan.W + 1e-6);
    assert(r.plan.trunk.cap >= 0.15 * r.plan.W && r.plan.trunk.text === String(new Date().getFullYear()));
  } finally { r.dispose(); }
});

for (const [label, cfg] of [
  ['2 names', { names: ['Ana', 'Luis'] }],
  ['3 names', { names: ['Papá', 'Mamá', 'Emilia'] }],
  ['7 names in automatic order', { names: seven, order: 'auto' }],
]) test(`${label}: an upright symmetric taper with hidden guides that print without supports`, () => {
  const r = nameTreeSolids(cfg, { font }), c = r.cfg, slope = 2 * Math.tan(r.parts[0].tilt);
  const depth = y => c.bottomDepth - slope * Math.max(0, y);
  const plains = r.parts.map(p => take(p.profile.extrude(1), e => e.warp(v => { v[2] = (v[2] - 0.5) * depth(v[1]); })));
  try {
    assert.equal(r.parts.length, c.names.length + 2);
    assert.equal(r.joints.length, c.names.length + 1);
    assert(r.plan.width <= c.maxWidth + 1e-4 && r.plan.height <= c.maxHeight + 1e-4);
    assert.deepEqual(r.plan.levels.map(l => l.index).sort(), c.names.map((_, i) => i));
    assert(Math.abs(r.plan.stability.center[2]) < 0.01, 'the centre of mass stays on the mid-plane: the tree does not lean');
    assert(r.plan.stability.frontBack >= 8, 'the default depths keep the tree standing');
    for (const [i, p] of r.parts.entries()) {
      assert.equal(p.solid.status(), 'NoError');
      assert.equal(islands(p.solid), 1, `${p.name} is one solid`);
      assert(Math.abs(p.bounds.min[2] + p.bounds.max[2]) < 1e-4, `${p.name} tapers equally front and back`);
      for (const [, y, z] of mesh(p.solid).V) assert(Math.abs(z) <= depth(y) / 2 + 1e-4, `${p.name} stays inside the tapered envelope`);
      // Grooves open only on a joint face and keep walls on every other side; keys sit inside the neighbour's envelope.
      const pb = p.profile.bounds(), grooves = plains[i].subtract(p.solid), keys = p.solid.subtract(plains[i]);
      try {
        for (const g of grooves.decompose()) {
          try {
            if (g.volume() < 1e-3) continue;
            const b = g.boundingBox(), down = Math.abs(b.min[1] - pb.min[1]) < 1e-3;
            assert(down || Math.abs(b.max[1] - pb.max[1]) < 1e-3, `${p.name}: every groove opens on a joint face`);
            for (const d of [[0.5, 0, 0], [-0.5, 0, 0], [0, 0, 0.5], [0, 0, -0.5], [0, down ? 0.5 : -0.5, 0]]) {
              assert(moved(g, d, t => volume(t.subtract(plains[i]))) < 1e-3, `${p.name}: the groove is hidden (${d})`);
            }
          } finally { g.delete(); }
        }
        for (const k of keys.decompose()) {
          try {
            if (k.volume() < 1e-3) continue;
            const b = k.boundingBox(), up = b.min[1] >= pb.max[1] - 1e-3;
            assert(up || b.max[1] <= pb.min[1] + 1e-3, `${p.name}: keys only stick out of joint faces`);
            const host = plains[up ? i + 1 : i - 1];
            assert(host && volume(k.subtract(host)) < 1e-3, `${p.name}: keys stay hidden inside the next piece`);
          } finally { k.delete(); }
        }
      } finally { grooves.delete(); keys.delete(); }
      // Print pose: lying on its back, nothing above the bed faces down more steeply than the 50° guide flanks.
      take(p.solid.rotate([-p.tilt * 180 / Math.PI, 0, 0]), pose => {
        const { V: P, T: PT } = mesh(pose), z0 = P.reduce((m, v) => Math.min(m, v[2]), Infinity);
        let bed = 0;
        for (let t = 0; t < PT.length; t += 3) {
          const [a, b, d] = [0, 1, 2].map(j => P[PT[t + j]]);
          const u = b.map((v, k) => v - a[k]), w = d.map((v, k) => v - a[k]);
          const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], len = Math.hypot(...n);
          if (len < 2e-4) continue;
          if (Math.max(a[2], b[2], d[2]) - z0 < 1e-3) bed += len / 2;
          else assert(n[2] / len >= -0.72, `${p.name}: overhang would need supports`);
        }
        assert(bed >= 0.98 * p.profile.area(), `${p.name}: the whole back lies on the bed`);
      });
      for (const other of r.parts.slice(i + 1)) assert(overlap(p.solid, other.solid) < 1e-4, `${p.name} collides with ${other.name}`);
    }
    for (const joint of r.joints) {
      const lower = r.parts[joint.lower].solid, upper = r.parts[joint.upper].solid, s = joint.clearance + 0.3;
      assert(joint.keys.length >= 1 && joint.keys.every(k => k.p >= 0.8 && Math.abs(k.dir) === 1));
      for (const d of [[s, 0, 0], [-s, 0, 0], [0, 0, s], [0, 0, -s]]) {
        assert(moved(upper, d, t => overlap(lower, t)) > 0.01, 'seated pieces cannot slide sideways or front/back');
      }
      const reach = Math.max(...joint.keys.map(k => k.p)) + joint.clearance;
      for (const lift of [0.05, reach / 2, reach + 0.05]) {
        assert(moved(upper, [0, lift, 0], t => overlap(lower, t)) < 1e-4, 'each piece goes on by lowering it vertically');
      }
    }
  } finally { plains.forEach(m => m.delete()); r.dispose(); }
});

test('many names keep the reference proportions and the automatic order puts long names low', () => {
  const r = nameTreeSolids({ names: seven, order: 'auto' }, { font });
  try {
    const { W, levels, top } = r.plan;
    assert.equal(levels[0].text, 'MARÍA JOSÉ');
    assert(top.width >= 0.28 * W - 1e-6, 'the star does not shrink to a dot');
    assert(levels.at(-1).width >= 0.6 * top.width - 1e-6, 'the top name can carry the star');
    assert(levels.every(l => l.cap >= 0.06 * W - 1e-6), 'every name stays legible');
    assert.equal(levels.find(l => l.text === 'SEBASTIÁN').accents, 1);
  } finally { r.dispose(); }
  assert.throws(() => nameTreeSolids({ names: [...seven].sort((a, b) => a.length - b.length) }, { font }), /orden automático/);
});

test('crowded trees keep letters apart and their holes open, or name the word that would not read and offer working fixes', () => {
  const crowded = { names: ['Parce', 'Samara', 'Sara', 'Gina', 'Alex', 'Familia'], trunkText: 'Dios', order: 'manual', maxWidth: 160, maxHeight: 130 };
  let error;
  try { nameTreeSolids(crowded, { font }).dispose(); } catch (e) { error = e; }
  assert(error, 'FAMILIA at 3 mm would print with its letters stuck together and its holes closed');
  assert.match(error.message, /«FAMILIA» quedaría con letras de [\d.]+ mm .*al menos [\d.]+ mm/);
  assert.deepEqual(error.suggestions.map(s => s.label), ['Usar 195 mm de alto', 'Orden automático con 135 mm de alto']);
  for (const { label, changes } of error.suggestions) {
    const r = nameTreeSolids({ ...crowded, ...changes }, { font });
    try {
      assert(r.plan.levels.some(l => Math.abs(l.cap - l.legible) < 0.05), `${label}: some name sits right at its legible size`);
      for (const p of r.parts.filter(p => p.role !== 'top')) {
        const left = holes(p.profile);
        if (p.name === 'FAMILIA') assert.equal(left.length, 13, `${label}: FAMILIA keeps the 13 whites of its letters`);
        left.forEach((n, i) => assert.equal(n, 1, `${label}: white ${i} of ${p.name} stays open in print`));
      }
    } finally { r.dispose(); }
  }
});

test('block trunk, toppers, lowercase and accents stay single solids; unusable designs fail explicitly', () => {
  for (const extra of [
    { trunk: 'block', shape: 'heart' },
    { shape: 'circle', uppercase: false, names: ['José', 'María Paz', 'Iñaki'] },
    { shape: 'custom', custom: [[[-1, 0], [0, -0.5], [1, 0], [0.8, 1], [-0.8, 1]]], bottomDepth: 20, topDepth: 20 },
  ]) {
    const r = nameTreeSolids({ names: ['Sebastián', 'Lucía', 'Ana'], ...extra }, { font });
    try {
      for (const p of r.parts) assert.equal(islands(p.solid), 1, p.name);
      if (extra.trunk === 'block') assert.equal(r.plan.trunk.text, '');
      if (extra.topDepth === 20) assert.equal(r.plan.tilt, 0);
    } finally { r.dispose(); }
  }
  assert.throws(() => nameTreeSolids({ names: ['😀', 'Ana'] }, { font }), /carácter/);
  assert.throws(() => nameTreeSolids({ names: Array(20).fill('Un nombre demasiado largo'), maxWidth: 40, maxHeight: 60 }, { font }), /pequeños/);
  assert.throws(() => nameTreeSolids({ shape: 'custom', custom: [[[0, 0], [1, 0], [1, 1]], [[3, 0], [4, 0], [4, 1]]] }, { font }), /islas/);
});

test('a thin base warns with the depth that keeps the tree standing', () => {
  const thin = buildNameTree({ bottomDepth: 12, topDepth: 10 }, { font });
  try {
    const warning = thin.warnings.find(w => /delante\/atrás/.test(w));
    assert(warning, 'thin bases are reported');
    const suggested = Number(warning.match(/al menos (\d+) mm/)[1]);
    const fixed = buildNameTree({ bottomDepth: suggested, topDepth: 10 }, { font });
    try { assert(!fixed.warnings.some(w => /delante\/atrás/.test(w)) && fixed.plan.stability.frontBack >= 8); }
    finally { release(fixed); }
  } finally { release(thin); }
});

test('projects round-trip and version 1 projects migrate to the symmetric design', () => {
  const cfg = normalizeNameTree({ names: [{ text: 'Ana', color: '#123456' }, { text: 'Ana', color: '#654321' }],
    order: 'auto', trunk: 'text', trunkText: 'Familia', shape: 'custom', custom: [[[0, 0], [1, 0], [0.5, 1]]], clearance: 0.35 });
  assert.deepEqual(readNameTreeProject(nameTreeProject(cfg)), cfg);
  const old = readNameTreeProject({ app: 'Relieve3D-ArbolNombres', version: 1,
    cfg: { names: [{ text: 'Sofía' }, { text: 'Mateo' }], order: 'manual', topDepth: 3, bottomDepth: 5 } });
  assert.deepEqual([old.topDepth, old.bottomDepth, old.trunk, old.order], [6, 8, 'text', 'manual']);
  assert.throws(() => readNameTreeProject({ app: 'Relieve3D-ArbolNombres', version: 99, cfg }), /compatible/);
  assert.throws(() => readNameTreeProject('broken'), /válido/);
});

test('all offered fonts keep accented names connected and inside the maximum size', () => {
  for (const [family, file] of Object.entries(NAME_TREE_FONTS)) {
    const r = nameTreeSolids({ font: family, order: 'auto', names: ['Ángel', 'María José', 'Sebastián'], maxWidth: 140, maxHeight: 200 },
      { font: loadFont(file) });
    try {
      for (const p of r.parts) {
        assert(p.bounds.min[0] >= -70.001 && p.bounds.max[0] <= 70.001, family + ' width');
        assert(p.bounds.max[1] <= 200.001, family + ' height');
      }
    } finally { r.dispose(); }
  }
});

test('color plates hold every part on its back without supports and the export explains the hidden guides', () => {
  const r = buildNameTree({ names: seven, order: 'auto', maxWidth: 150, maxHeight: 300, bedWidth: 180, bedHeight: 180 }, { font });
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
    assert.equal(exported.files.filter(f => f.name.endsWith('.stl')).length, seven.length + 2);
    assert.deepEqual(readNameTreeProject(exported.files.find(f => f.name === 'Proyecto.r3t').data), r.cfg);
    const notes = exported.files.find(f => f.name === 'Montaje.txt').data;
    for (const phrase of [/guías ocultas/, /en vertical/, /por igual delante y detrás/]) assert.match(notes, phrase);
    for (const name of exported.plateFiles) {
      const data = exported.files.find(f => f.name === name).data, model = read3MF(data);
      assert.equal(model.palette.length, 1, 'no AMS/color changes on a plate');
      assert(model.parts.length > 0);
      const settings = strFromU8(unzipSync(data)['Metadata/model_settings.config']);
      assert.equal((settings.match(/enable_support" value="0"/g) || []).length, model.parts.length);
      for (const p of model.parts) {
        assert(Math.abs(p.V.reduce((m, v, i) => i % 3 === 2 ? Math.min(m, v) : m, Infinity)) < 1e-4);
        const edges = new Map();
        for (let t = 0; t < p.T.length; t += 3) for (let i = 0; i < 3; i++) {
          const a = p.T[t + i], b = p.T[t + (i + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
          edges.set(key, (edges.get(key) || 0) + (a < b ? 1 : 100));
        }
        assert([...edges.values()].every(n => n === 101), 'exported mesh stays closed with consistently oriented shared edges');
      }
    }
    const assembled = read3MF(exported.files.find(f => f.name.startsWith('Vista_armada')).data);
    assert.equal(assembled.parts.length, seven.length + 2);
    const top = assembled.parts.reduce((m, p) => p.V.reduce((n, v, i) => i % 3 === 2 ? Math.max(n, v) : n, m), -Infinity);
    assert(top <= r.cfg.maxHeight + 1e-4);
    assert.throws(() => packNameTree({ ...r, cfg: { ...r.cfg, bedWidth: 20, bedHeight: 20 } }), /no cabe/);
  } finally { release(r); }
});

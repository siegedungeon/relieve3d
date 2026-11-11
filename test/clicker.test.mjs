import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { read3MF } from '../src/core/threemf_read.js';
import { prepareClicker, buildClicker, exportClicker } from '../src/core/clicker.js';

const w = await prepareClicker();

function image({ separate = false } = {}) {
  const width = 72, height = 72, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 8; y < 64; y++) for (let x = 8; x < 64; x++) {
    if (separate && x > 28 && x < 43) continue;
    const i = (y * width + x) * 4, accent = x > 27 && x < 45 && y > 23 && y < 49;
    data[i] = accent ? 33 : 210; data[i + 1] = accent ? 135 : 30; data[i + 2] = accent ? 70 : 50; data[i + 3] = 255;
  }
  return { width, height, data };
}

function asSolid(part) {
  const mesh = new w.Mesh({ numProp: 3, vertProperties: new Float32Array(part.V), triVerts: new Uint32Array(part.T) });
  mesh.merge();
  return new w.Manifold(mesh);
}

test('image becomes a closed silhouette cap and an open-back MX switch housing with relief', () => {
  const result = buildClicker(image(), { width: 45, margin: 0.8, stemClearance: 0.1, mountClearance: 0.1 });
  const cap = result.parts.find((p) => p.role === 'cap'), base = result.parts.find((p) => p.role === 'base');
  assert.ok(cap && base && result.parts.some((p) => p.role === 'relief'));
  const capSolid = asSolid(cap), baseSolid = asSolid(base), capPieces = capSolid.decompose(), basePieces = baseSolid.decompose();
  try {
    assert.equal(capSolid.status(), 'NoError'); assert.equal(baseSolid.status(), 'NoError');
    assert.equal(capPieces.length, 1); assert.equal(basePieces.length, 1);
    assert.equal(result.info.plateThickness, 1.5);
    assert.ok(Math.abs(result.info.switchOpening - 14.1) < 1e-8);
    assert.ok(result.info.capThickness - result.info.socketDepth >= 0.8);
    const { capCenter, baseCenter, socketLength, socketWidth, socketDepth } = result.info;
    const cross = w.Manifold.cube([socketLength - 0.1, socketWidth - 0.1, socketDepth - 0.2], true)
      .translate([capCenter[0], capCenter[1], socketDepth / 2]);
    const switchHole = w.Manifold.cube([13.9, 13.9, 1.3], true).translate([baseCenter[0], baseCenter[1], 0.75]);
    const ceiling = w.Manifold.cube([1, 1, 0.5], true).translate([capCenter[0], capCenter[1], socketDepth + 0.3]);
    const capVoid = capSolid.intersect(cross), baseVoid = baseSolid.intersect(switchHole), roof = capSolid.intersect(ceiling);
    try {
      assert.ok(capVoid.volume() < 1e-5, 'the MX cross socket opens from the underside');
      assert.ok(baseVoid.volume() < 1e-5, 'the switch opening goes through the 1.5 mm plate');
      assert.ok(roof.volume() > 0.4, 'the socket retains a solid roof');
    } finally { cross.delete(); switchHole.delete(); ceiling.delete(); capVoid.delete(); baseVoid.delete(); roof.delete(); }
    for (const piece of result.parts.filter((p) => p.role === 'relief')) {
      const solid = asSolid(piece);
      try { assert.equal(solid.status(), 'NoError'); assert.ok(solid.volume() > 0); } finally { solid.delete(); }
    }
    const bytes = exportClicker(result), model = read3MF(bytes);
    assert.equal(model.instances.length, 2, 'the cap and housing are independently printable objects');
    assert.equal(model.parts.length, result.parts.length);
    for (const part of model.parts) for (let i = 0; i < part.V.length; i += 3) {
      assert.ok(part.V[i] >= 0 && part.V[i] <= 256 && part.V[i + 1] >= 0 && part.V[i + 1] <= 256,
        'both objects are inside a 256 mm Bambu plate without auto-arrangement');
    }
    const archive = unzipSync(bytes), cfg = strFromU8(archive['Metadata/model_settings.config']);
    const baseId = model.instances[1].objectId;
    const baseSettings = new RegExp(`<object id="${baseId}">([\\s\\S]*?)<part`).exec(cfg)?.[1];
    assert.ok(baseSettings?.includes(`key="extruder" value="${base.filamentIndex + 1}"`),
      'a single-part housing keeps its own filament at object level in Bambu Studio');
  } finally { capPieces.forEach((s) => s.delete()); basePieces.forEach((s) => s.delete()); capSolid.delete(); baseSolid.delete(); }
});

test('adjustable clearances change only the designed interfaces and unsafe inputs are rejected', () => {
  const a = buildClicker(image(), { width: 45, stemClearance: 0, mountClearance: 0 });
  const b = buildClicker(image(), { width: 45, stemClearance: 0.25, mountClearance: 0.3 });
  assert.ok(Math.abs(b.info.socketLength - a.info.socketLength - 0.25) < 1e-8);
  assert.ok(Math.abs(b.info.switchOpening - a.info.switchOpening - 0.3) < 1e-8);
  assert.throws(() => buildClicker(image(), { width: 10 }), /tamaño|ancho/i);
  assert.throws(() => buildClicker(image(), { stemClearance: 2 }), /holgura/i);
  assert.throws(() => buildClicker(image({ separate: true }), { width: 45, margin: 0 }), /separad|conectad/i);
});

test('warns when fine silhouette or relief details are simplified for printing', () => {
  const width = 128, height = 128, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 5; y < 123; y++) for (let x = 5; x < 123; x++) {
    const body = x >= 24 && x < 104 && y >= 24 && y < 104;
    const tab = x >= 104 && x < 116 && Math.abs(y - 38) <= 3;
    if (!body && !tab) continue;
    const accent = body && (x + y * 2 + 2) % 23 < 3;
    data.set(accent ? [25, 150, 30, 255] : [210, 30, 30, 255], (y * width + x) * 4);
  }
  const result = buildClicker({ width, height, data }, { width: 35, colors: 2, margin: 0 });
  assert.ok(result.warnings.some((warning) => /detalles demasiado finos/i.test(warning)));
});

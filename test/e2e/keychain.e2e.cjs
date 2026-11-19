const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

// An optional .r3d runs the same checks with a real design and its saved ring.
module.exports = async ({ run }) => {
  const input = process.env.E2E_INPUT;
  const project = input && path.extname(input) === '.r3d' ? JSON.parse(fs.readFileSync(input, 'utf8')) : null;
  const png = new PNG({ width: 400, height: 240 });
  const colors = [[245, 230, 205, 255], [130, 48, 25, 255], [255, 157, 205, 255], [30, 145, 225, 255]];
  for (let y = 20; y < 220; y++) for (let x = 20; x < 380; x++) {
    const index = x > 60 && x < 340 && y > 65 && y < 175 ? 1 + Math.min(2, Math.floor((x - 60) / 94)) : 0;
    png.data.set(colors[index], (y * png.width + x) * 4);
  }
  const image = project ? project.image.dataURL.split(',')[1] : PNG.sync.write(png).toString('base64');
  const imageName = project?.image.name || 'keychain.png';
  const output = process.env.R3D_AUTOSAVE_DIR;
  const sourceFile = `new File([Uint8Array.from(atob(${JSON.stringify(image)}), c => c.charCodeAt(0))], ${JSON.stringify(imageName)}, { type: 'image/png' })`;
  const { read3MF } = await import('../../src/core/threemf_read.js');
  const init = (await import('manifold-3d')).default;
  const w = await init(); w.setup();
  const open = file => read3MF(fs.readFileSync(file));
  const exported = path.join(output, path.parse(imageName).name + '.3mf');

  if (project) {
    await run(`window.__r3d.openProjectFile(new File([${JSON.stringify(JSON.stringify(project))}], 'original.r3d'))`);
    const result = await run(`(async () => {
      const r = window.__r3d;
      const parts = r.exportParts();
      const ring = parts.find(p => p.name === 'Argolla');
      ring.geometry.computeBoundingBox();
      await r.doExport('3mf');
      return { ring: ring.geometry.boundingBox.max.z, heights: [...new Set(r.S.pieces.map(p => p.height))] };
    })()`);
    assert.deepEqual(result.heights, [2]);
    assert.equal(result.ring, 2);
    const model = open(exported);
    const owned = [];
    try {
      const solid = p => {
        const m = new w.Manifold(new w.Mesh({ numProp: 3, vertProperties: Float32Array.from(p.V), triVerts: Uint32Array.from(p.T) }));
        owned.push(m); assert.equal(m.status(), 'NoError'); return m;
      };
      const ring = solid(model.parts.find(p => p.name === 'Argolla'));
      for (const p of model.parts.filter(p => p.name !== 'Argolla')) {
        const intersection = ring.intersect(solid(p)); owned.push(intersection);
        assert(Math.abs(intersection.volume()) < 0.02, 'support does not intrude into the design');
      }
    } finally { owned.reverse().forEach(m => m.delete()); }
    fs.renameSync(exported, path.join(output, 'Pabonitas-argolla-corregida.3mf'));
    console.log('[e2e] ok saved keychain, ring corrected without repainting the artwork');
  }

  for (const count of [3, 4]) {
    await run(`(async () => {
      const r = window.__r3d;
      if (r.S.module !== 'keychain') await r.enterModule('keychain');
      r.S.proc.colors = ${count};
      await r.loadImageFile(${sourceFile});
    })()`);
    console.log('[e2e] imported', count, 'colors');
    const data = await run(`(async () => {
      const r = window.__r3d;
      const detected = r.S.result.palette.map(c => c.hex);
      const assigned = r.S.filaments.map(f => f.color);
      r.S.settings.kc.finish = 'flat';
      await r.onSettingChanged('kc.finish');
      const parts = r.exportParts();
      const limits = parts.map(p => {
        p.geometry.computeBoundingBox();
        const b = p.geometry.boundingBox;
        return { min: b.min.z, max: b.max.z, color: p.color };
      });
      return { detected, assigned, limits, flat: r.getFeat().flat, height: r.getFeat().zTop };
    })()`);
    assert.deepEqual(data.assigned, data.detected, 'import keeps the detected palette');
    assert.equal(data.detected.length, count);
    assert(data.flat && data.limits.length === count, JSON.stringify(data));
    assert.deepEqual(data.limits.map(p => p.color).sort(), [...data.detected].sort());
    for (const p of data.limits) assert(Math.abs(p.max - data.height) < 1e-5);
    assert.equal(data.limits.filter(p => Math.abs(p.max - p.min - 0.2) < 1e-5).length, count - 1);
    console.log('[e2e] exporting', count, 'colors');
    await run(`window.__r3d.doExport('3mf')`);
    const model = open(exported);
    assert.deepEqual(model.palette.map(c => c.toLowerCase()).sort(), data.detected.map(c => c.toLowerCase()).sort());
    for (const p of model.parts) {
      const mesh = new w.Mesh({ numProp: 3, vertProperties: Float32Array.from(p.V), triVerts: Uint32Array.from(p.T) });
      const m = new w.Manifold(mesh);
      try { assert.equal(m.status(), 'NoError', p.name); } finally { m.delete(); }
    }
    fs.renameSync(exported, path.join(output, `llavero-plano-${count}-colores.3mf`));
    console.log('[e2e] ok', count, 'detected colors preserved, a single face layer, closed 3MF meshes');
  }
  console.log('[e2e] done');
};

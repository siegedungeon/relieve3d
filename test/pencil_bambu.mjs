import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Module from 'manifold-3d';
import { unzipSync, strFromU8 } from 'fflate';
import { read3MF } from '../src/core/threemf_read.js';

export async function checkBambuBatch(folder, output) {
  const exe = path.join(process.env.ProgramFiles, 'Bambu Studio', 'bambu-studio.exe');
  fs.mkdirSync(output, { recursive: true });
  const source = path.join(folder, 'Placa_01_Bambu_A1.3mf');
  const cli = (input, name, slicing = false) => {
    const args = ['--arrange', '0', ...(slicing ? ['--slice', '1'] : []), '--export-3mf', name, '--outputdir', output, input];
    const p = spawnSync(exe, args, { timeout: 180000, windowsHide: true });
    assert.ifError(p.error); assert.equal(p.status, 0, 'native Bambu command succeeds');
    const result = JSON.parse(fs.readFileSync(path.join(output, 'result.json')));
    assert.equal(result.return_code, 0);
    assert(fs.existsSync(path.join(output, name)));
    return result;
  };
  cli(source, 'Nativa.3mf');
  const bytes = fs.readFileSync(path.join(output, 'Nativa.3mf'));
  const model = read3MF(bytes), report = JSON.parse(fs.readFileSync(path.join(folder, 'lote.json')));
  assert.equal(model.parts.length, report.models.length * 2);
  const archive = unzipSync(bytes), profile = JSON.parse(strFromU8(archive['Metadata/project_settings.config']));
  const savedProfile = JSON.parse(strFromU8(unzipSync(fs.readFileSync(source))['Metadata/project_settings.config']));
  for (const key of ['best_object_pos', 'filament_colour', 'nozzle_temperature', 'different_settings_to_system']) {
    assert.deepEqual(savedProfile[key], profile[key], 'saved plate already uses the native project schema: ' + key);
  }
  assert.deepEqual(profile.filament_colour.map(c => c.toLowerCase()), ['#5e43b7', '#ffffff']);
  assert.equal(profile.printer_model, 'Bambu Lab A1');
  assert.equal(profile.printer_structure, 'i3');
  assert(profile.machine_start_gcode && profile.change_filament_gcode);
  const w = await Module(); w.setup();
  const bounds = p => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.V.length; i++) { min[i % 3] = Math.min(min[i % 3], p.V[i]); max[i % 3] = Math.max(max[i % 3], p.V[i]); }
    return { min, max };
  };
  for (const placement of report.plates[0]) {
    const expected = report.models[placement.index], owned = [], own = m => { owned.push(m); return m; };
    try {
      const parts = model.parts.filter(p => {
        const b = bounds(p);
        return b.min[0] >= placement.x - 0.002 && b.max[0] <= placement.x + placement.width + 0.002
          && b.min[1] >= placement.y - 0.002 && b.max[1] <= placement.y + placement.height + 0.002;
      });
      assert.equal(parts.length, 2);
      const solids = parts.map(p => {
        const b = bounds(p), color = b.min[2] < 0.002 ? '#5e43b7' : '#ffffff';
        assert([...p.tc].every(i => model.palette[i].toLowerCase() === color));
        const mesh = new w.Mesh({ numProp: 3, vertProperties: Float32Array.from(p.V), triVerts: Uint32Array.from(p.T) });
        mesh.merge();
        const solid = own(new w.Manifold(mesh));
        assert.equal(solid.status(), 'NoError');
        return solid;
      });
      assert(own(solids[0].intersect(solids[1])).volume() < 0.0001);
      const joined = own(w.Manifold.union(solids)), b = joined.boundingBox();
      assert.equal(joined.decompose().map(own).length, 1);
      const y = expected.channel.center[1] + placement.shift[1], z = expected.channel.center[2];
      assert.equal(joined.rayCast([b.min[0] - 1, y, z], [b.max[0] + 1, y, z]).length, 0);
      for (const x of [b.min[0] + 6, (b.min[0] + b.max[0]) / 2, b.max[0] - 6]) {
        for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const hits = joined.rayCast([x, y, z], [x, y + 25 * u, z + 25 * v]);
          assert(hits.length >= 2);
          assert(Math.abs(hits[0].distance * 50 - 7.9) < 0.015);
          assert((hits[1].distance - hits[0].distance) * 25 >= 1.58);
        }
      }
    } finally { owned.reverse().forEach(m => m.delete()); }
  }
  const result = cli(path.join(output, 'Nativa.3mf'), 'Laminado.3mf', true);
  assert.equal(result.sliced_plates.length, 1);
  const plate = result.sliced_plates[0];
  assert.deepEqual(plate.objects.map(o => o.name).sort(), report.models.map(m => m.name).sort());
  assert.equal(plate.filaments.length, 2);
  assert.equal(plate.filament_change_times, 1);
  assert(plate.filaments.every(f => f.total_used_g > 0));
  assert(!plate.warning_message || /floating cantilever/.test(plate.warning_message), plate.warning_message);
  return { objects: plate.objects.length, changes: plate.filament_change_times, warning: plate.warning_message, seconds: plate.total_predication };
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { unzipSync, strFromU8 } from 'fflate';
import { parsePencilNames, fitPencilName, packPencilModels } from '../src/core/pencil_batch.js';
import { threeMF } from '../src/core/exporters.js';
import { read3MF } from '../src/core/threemf_read.js';
import { writeNewExportFolder } from '../src/main/export_folder.cjs';
import { loadBambuPencilProfile } from '../src/main/bambu_profile.cjs';

test('names preserve case, accents, spaces and requested duplicate copies', () => {
  assert.deepEqual(parsePencilNames(' Helena\r\nDulce Maria,María Paz;Violeta G\nHelena\n'), ['Helena', 'Dulce Maria', 'María Paz', 'Violeta G', 'Helena']);
  assert.throws(() => parsePencilNames(' \n,; '), /nombre/);
  assert.throws(() => parsePencilNames('Ana\u0000'), /control/);
});

test('long names compress only X and reject illegible extreme compression', () => {
  const metrics = w => ({ actualBoundingBoxLeft: 0, actualBoundingBoxRight: w, actualBoundingBoxAscent: 80, actualBoundingBoxDescent: 20 });
  const short = fitPencilName(metrics(300)), long = fitPencilName(metrics(800));
  assert.equal(short.widthMM, 42); assert.equal(short.scaleX, 100);
  assert.equal(long.widthMM, 70.8);
  assert(Math.abs(long.widthMM / (800 * long.scaleX / 100) * 100 - 14) < 1e-9);
  assert.throws(() => fitPencilName(metrics(4000)), /largo/);
});

test('packing spills onto more plates, retains all copies, and reserves purge space', () => {
  const models = Array.from({ length: 70 }, (_, i) => ({ name: `Nombre ${i}`, size: [75, 19, 13], bounds: { min: [-37.5, -9.5, 0] } }));
  const plates = packPencilModels(models);
  assert(plates.length > 1);
  assert.deepEqual(plates.flat().map(p => p.index), models.map((_, i) => i));
  for (const plate of plates) for (const [i, a] of plate.entries()) {
    assert(a.x >= 6 && a.x + a.width <= 250 && a.y >= 6 && a.y + a.height <= 205);
    for (const b of plate.slice(i + 1)) assert(a.x + a.width + 3 <= b.x || b.x + b.width + 3 <= a.x
      || a.y + a.height + 3 <= b.y || b.y + b.height + 3 <= a.y);
  }
  assert.throws(() => packPencilModels([{ ...models[0], size: [76, 19, 13] }]), /75/);
});

test('3MF preserves independent two-colour assemblies and build transforms', () => {
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  try {
    const parts = [0, 1, 0, 1].map((filamentIndex, i) => ({ name: `Parte ${i}`, geometry, filamentIndex, color: filamentIndex ? '#ffffff' : '#5e43b7' }));
    const data = threeMF(parts, 'Lote', { bambu: { printer_model: 'Bambu Lab A1' }, assemblies: [
      { name: 'María & Luz', parts: [0, 1], shift: [10, 20] }, { name: 'Ana', parts: [2, 3], shift: [30, 40] },
    ] });
    const archive = unzipSync(data), cfg = strFromU8(archive['Metadata/model_settings.config']);
    assert.equal((cfg.match(/<model_instance>/g) || []).length, 2);
    assert.equal((cfg.match(/<part /g) || []).length, 4);
    assert(cfg.includes('María &amp; Luz'));
    const result = read3MF(data);
    assert.equal(result.parts.length, 4);
    assert.deepEqual(result.palette, ['#5E43B7', '#FFFFFF']);
    assert.equal(Math.min(...result.parts[0].V.filter((_, i) => i % 3 === 0)), 9);
    assert.equal(Math.min(...result.parts[2].V.filter((_, i) => i % 3 === 1)), 39);
    assert.throws(() => threeMF(parts, 'Lote', { assemblies: [{ name: 'Incompleto', parts: [0] }] }), /piezas/);
  } finally { geometry.dispose(); }
});

test('installed printer inheritance and templates survive two-material export', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r3d-profile-test-'));
  const put = (kind, name, data) => writeFile(path.join(root, kind, name + '.json'), JSON.stringify(data));
  try {
    for (const kind of ['machine', 'process', 'filament']) await mkdir(path.join(root, kind));
    await put('machine', 'common', { printer_model: 'Bambu Lab A1', nozzle_diameter: ['0.4'] });
    await put('machine', 'commands', { machine_start_gcode: 'A1 start', change_filament_gcode: 'A1 change' });
    await put('machine', 'Bambu Lab A1 0.4 nozzle', { inherits: 'common', include: ['commands'], printable_height: '256' });
    await put('process', '0.20mm Standard @BBL A1', { layer_height: '0.2', enable_support: '1' });
    await put('filament', 'Bambu PLA Basic @BBL A1', { nozzle_temperature: ['220'], filament_is_support: ['0'] });
    const p = await loadBambuPencilProfile(root);
    assert.equal(p.machine_start_gcode, 'A1 start');
    assert.equal(p.change_filament_gcode, 'A1 change');
    assert.deepEqual(p.nozzle_temperature, ['220', '220']);
    assert.deepEqual(p.filament_is_support, ['0', '0']);
    assert.equal(p.enable_support, '0');
    await put('machine', 'common', { inherits: 'Bambu Lab A1 0.4 nozzle' });
    await assert.rejects(loadBambuPencilProfile(root), /Referencia/);
    await put('machine', 'common', { inherits: '..\\outside' });
    await assert.rejects(loadBambuPencilProfile(root), /Referencia/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('saving another batch never overwrites a prior batch and rejects path escapes', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'r3d-batch-test-'));
  try {
    const first = await writeNewExportFolder(parent, 'Lote', [{ name: '001_Ana.r3d', data: 'primero' }]);
    const second = await writeNewExportFolder(parent, 'Lote', [{ name: '001_Ana.r3d', data: 'segundo' }]);
    assert.notEqual(first, second);
    assert.equal(await readFile(path.join(first, '001_Ana.r3d'), 'utf8'), 'primero');
    for (const folder of ['..', '..\\fuera', 'C:\\fuera']) await assert.rejects(writeNewExportFolder(parent, folder, [{ name: 'a', data: '' }]));
    for (const name of ['..\\fuera', 'C:\\fuera', 'nul.txt']) await assert.rejects(writeNewExportFolder(parent, 'Lote', [{ name, data: '' }]));
    await assert.rejects(writeNewExportFolder(parent, 'Lote', [{ name: 'Ana', data: '' }, { name: 'ANA', data: '' }]));
    await assert.rejects(writeNewExportFolder(parent, 'Lote', [{ name: 'Ana', data: '' }], async () => {
      throw new Error('Native conversion failed');
    }), /Native conversion failed/);
    assert.equal((await readdir(parent)).length, 2);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

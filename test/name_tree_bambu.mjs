// Native Windows slicing regression: generates every plate, resaves it as the app does, then slices all parts.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { parse } from '../node_modules/opentype.js/dist/opentype.mjs';
import { unzipSync, strFromU8 } from 'fflate';
import { NAME_TREE_FONTS, prepareNameTree, buildNameTree, nameTreeFiles } from '../src/core/name_tree.js';
import profiles from '../src/main/bambu_profile.cjs';

const run = promisify(execFile), root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'out', 'name-tree-bambu');
const executable = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Bambu Studio', 'bambu-studio.exe');
const bytes = await fs.readFile(new URL('../src/fonts/' + NAME_TREE_FONTS['Bebas Neue'], import.meta.url));
const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const profile = await profiles.getBambuNameTreeProfile();
const golden = JSON.parse(await fs.readFile(new URL('./fixtures/name_tree_v1.25.1.json', import.meta.url), 'utf8')).project.cfg;
await prepareNameTree(); await fs.mkdir(out, { recursive: true });
const report = { cases: [], passed: false };
const list = ['Valentina', 'Sebastián', 'Mateo', 'Camila', 'Lucía', 'José', 'Ana'];
// Automatic order on 7 names produces guides rising from the lower piece and hanging from the upper one; two names lie
// face down, and a corrected piece of a printed tree is sliced alone, face down too.
for (const [id, cfg] of [
  ['2', { names: list.slice(0, 2), order: 'manual', shape: 'heart', maxWidth: 180, maxHeight: 240, bedFace: 'front' }],
  ['7', { names: list, order: 'auto', shape: 'star', maxWidth: 180, maxHeight: 240 }],
  ['correccion', { ...golden, bedFace: 'front', fixes: [{ index: 1, text: 'Valery' }, { index: 3, text: 'Lucía' }] }],
]) {
  const dir = path.join(out, id);
  await fs.mkdir(dir, { recursive: true });
  const tree = buildNameTree(cfg, { font });
  assert(id !== '7' || tree.joints.some(j => j.keys.some(k => k.dir === -1)), 'both guide directions are sliced');
  let batch;
  try { batch = nameTreeFiles(tree, { profile }); }
  finally { tree.parts.forEach(p => p.geometry.dispose()); }
  assert(id !== 'correccion' || batch.files.filter(f => f.name.endsWith('.stl')).map(f => f.name).join() === 'Pieza_03_corregida.stl,Pieza_05_corregida.stl',
    'a correction slices only its corrected pieces');
  for (const file of batch.files) await fs.writeFile(path.join(dir, file.name), file.data);
  await profiles.normalizePencilPlates(dir, batch.plateFiles);
  for (const plate of batch.plateFiles) {
    const target = path.join(dir, path.basename(plate, '.3mf'));
    await fs.mkdir(target, { recursive: true });
    const { stdout, stderr } = await run(executable, ['--arrange', '0', '--slice', '0', '--export-3mf', 'sliced.3mf',
      '--outputdir', target, path.join(dir, plate)], { windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    await fs.writeFile(path.join(target, 'slicer.log'), stdout + stderr);
    const result = JSON.parse(await fs.readFile(path.join(target, 'result.json'), 'utf8'));
    assert.equal(result.return_code, 0, `${id} / ${plate}: slicing succeeds`);
    const zip = unzipSync(await fs.readFile(path.join(target, 'sliced.3mf')));
    const gcode = strFromU8(zip['Metadata/plate_1.gcode']);
    await fs.writeFile(path.join(target, 'plate_1.gcode'), gcode);
    assert(gcode.length > 10000 && /^G1 .*E[0-9]/m.test(gcode), 'real printable extrusion paths must be generated');
    assert(!/^; FEATURE: Support/m.test(gcode), 'no support or support interface toolpaths');
    assert(!/^; FEATURE: Prime tower/m.test(gcode), 'no unnecessary purge tower for a monochrome plate');
    const sliced = result.sliced_plates[0], times = sliced.feature_type_times;
    assert.equal((times.Support || 0) + (times['Support interface'] || 0), 0);
    report.cases.push({ id, face: tree.cfg.bedFace, plate, featureTimes: times, warnings: sliced.warning_message || null });
    console.log(`${id} / ${tree.cfg.bedFace} / ${plate}: native slice OK, zero supports.`);
  }
}
report.passed = true;
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log('name tree Bambu OK:', path.join(out, 'report.json'));

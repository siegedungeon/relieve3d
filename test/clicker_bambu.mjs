// Native Windows regression: slices the actual 3MF exported by the Electron clicker flow.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { read3MF } from '../src/core/threemf_read.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const input = path.resolve(process.argv[2] || path.join(root, 'out', 'e2e', 'clicker', 'export', 'diseno_clicker_Bambu_A1.3mf'));
const out = path.join(root, 'out', 'clicker-bambu');
const installs = [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
const exe = installs.map((p) => path.join(p, 'Bambu Studio', 'bambu-studio.exe')).find((p) => fs.existsSync(p));
assert(exe, 'Install Bambu Studio before running this native slicer regression.');
assert(fs.existsSync(input), 'Run the clicker Electron E2E first to generate the native input.');
const original = fs.readFileSync(input), hash = (b) => createHash('sha256').update(b).digest('hex');
const zip = unzipSync(original), config = strFromU8(zip['Metadata/model_settings.config']);
const profile = JSON.parse(strFromU8(zip['Metadata/project_settings.config']));
const model = read3MF(original);
assert.equal(model.instances.length, 2, 'the UI exports two independent objects');
assert.equal(profile.printer_model, 'Bambu Lab A1');
const objects = [...config.matchAll(/<object id="(\d+)">([\s\S]*?)<\/object>/g)].map((m) => ({
  id: m[1],
  object: m[2].split('<part')[0],
  parts: [...m[2].matchAll(/<part\b[^>]*>([\s\S]*?)<\/part>/g)].map((p) => p[1]),
}));
const value = (xml, key) => new RegExp(`<metadata key="${key}" value="([^"]*)"\\s*/>`).exec(xml)?.[1];
const cap = objects.find((o) => value(o.object, 'name') === 'Tapa con relieve');
const base = objects.find((o) => value(o.object, 'name') === 'Base para interruptor MX');
assert(cap && base, 'the native file contains the cap and housing');
const baseFilament = Number(value(base.object, 'extruder'));
const capFilaments = new Set(cap.parts.map((p) => Number(value(p, 'extruder'))));
assert(baseFilament > 0 && capFilaments.size >= 2 && !capFilaments.has(baseFilament), 'fixture uses distinct cap, relief and base filaments');
assert(profile.filament_colour.length <= 4, 'the fixture fits one A1 AMS Lite');
const instances = [...config.matchAll(/<model_instance>([\s\S]*?)<\/model_instance>/g)].map((m) => ({
  id: value(m[1], 'object_id'), label: Number(value(m[1], 'identify_id')),
}));
const capLabel = instances.find((i) => i.id === cap.id)?.label;
const baseLabel = instances.find((i) => i.id === base.id)?.label;
assert(capLabel && baseLabel && capLabel !== baseLabel, 'objects have separate print labels');

fs.mkdirSync(out, { recursive: true });
for (const name of ['result.json', 'sliced.3mf', 'slicer.log', 'plate_1.gcode', 'report.json']) {
  const file = path.join(out, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
const run = spawnSync(exe, ['--arrange', '0', '--slice', '0', '--export-3mf', 'sliced.3mf', '--outputdir', out, input],
  { windowsHide: true, timeout: 180000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
fs.writeFileSync(path.join(out, 'slicer.log'), (run.stdout || '') + (run.stderr || ''));
assert.ifError(run.error);
assert.equal(run.status, 0, 'Bambu Studio failed; see slicer.log');
const result = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
assert.equal(result.return_code, 0, `native slicing: ${result.error_string}`);
assert.equal(result.sliced_plates.length, 1);
const plate = result.sliced_plates[0];
assert.equal(plate.objects.length, 2);
for (const obj of plate.objects) {
  const b = obj.bbox;
  assert(b.x >= -0.01 && b.y >= -0.01 && b.z >= -0.01 && b.x + b.width <= 256.01 && b.y + b.depth <= 256.01,
    `${obj.name} fits inside the A1 plate`);
}
const sliced = unzipSync(fs.readFileSync(path.join(out, 'sliced.3mf'))), gcodeBytes = sliced['Metadata/plate_1.gcode'];
assert(gcodeBytes?.length > 10000, 'the slice contains actual G-code');
const gcode = strFromU8(gcodeBytes);
assert(/^G1 .*E[0-9.]/m.test(gcode), 'the slice contains extrusion moves');
fs.writeFileSync(path.join(out, 'plate_1.gcode'), gcode);

let tool = null, activeObject = null;
const used = new Map();
for (const line of gcode.split(/\r?\n/)) {
  const select = /^M620 S(\d+)A\b/.exec(line);
  if (select) tool = Number(select[1]) + 1;
  const start = /^; start printing object, unique label id: (\d+)/.exec(line);
  if (start) activeObject = Number(start[1]);
  if (/^; stop printing object/.test(line)) activeObject = null;
  if (activeObject && tool && /^G[0123]\b/.test(line) && /[XY][-.\d]/.test(line) && /E(?:\d+\.?\d*|\.\d+)/.test(line)) {
    if (!used.has(activeObject)) used.set(activeObject, new Set());
    used.get(activeObject).add(tool);
  }
}
const sorted = (set) => [...(set || [])].sort((a, b) => a - b);
assert.deepEqual(sorted(used.get(baseLabel)), [baseFilament], 'actual base extrusion uses only its assigned filament');
assert.deepEqual(sorted(used.get(capLabel)), sorted(capFilaments), 'actual cap and relief extrusion uses their assigned filaments');
assert.equal(hash(fs.readFileSync(input)), hash(original), 'the exported source 3MF remains unchanged');
const report = { passed: true, input, objects: plate.objects, filaments: plate.filaments, baseFilament,
  capFilaments: sorted(capFilaments), changes: plate.filament_change_times, warning: plate.warning_message || null };
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`clicker Bambu OK: ${sorted(capFilaments).join(', ')} for cap/relief; ${baseFilament} for the base; ${plate.filament_change_times} filament changes.`);

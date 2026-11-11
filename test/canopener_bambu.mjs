// Slice the native 3MF produced by the real Electron flow, not a reconstruction of its configuration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { read3MF } from '../src/core/threemf_read.js';
import { prepareCanOpener } from '../src/core/canopener.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const input = path.resolve(process.argv[2] || path.join(root, 'out', 'e2e', 'canopener', 'export', 'Destapador_Bambu_A1.3mf'));
const expectedPath = path.resolve(process.argv[3] || path.join(root, 'out', 'e2e', 'canopener', 'expected.json'));
const out = path.join(root, 'out', 'canopener-bambu');
const installs = [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
const exe = installs.map((p) => path.join(p, 'Bambu Studio', 'bambu-studio.exe')).find((p) => fs.existsSync(p));
assert(exe, 'Install Bambu Studio before running this native slicer regression.');
assert(fs.existsSync(input) && fs.existsSync(expectedPath), 'Run the opener Electron E2E first.');
const original = fs.readFileSync(input), expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const zip = unzipSync(original), config = strFromU8(zip['Metadata/model_settings.config']);
const profile = JSON.parse(strFromU8(zip['Metadata/project_settings.config']));
const model = read3MF(original);
assert.equal(model.instances.length, 2, 'the UI exports the body and connector as independent objects');
assert.equal(profile.printer_model, 'Bambu Lab A1');
assert.deepEqual(profile.filament_colour, expected.colors);
assert(profile.filament_colour.length <= 4, 'the fixture fits one A1 AMS Lite');
const objects = [...config.matchAll(/<object id="(\d+)">([\s\S]*?)<\/object>/g)].map((m) => ({
  id: m[1], object: m[2].split('<part')[0],
  parts: [...m[2].matchAll(/<part\b[^>]*>([\s\S]*?)<\/part>/g)].map((p) => p[1]),
}));
const value = (xml, key) => new RegExp(`<metadata key="${key}" value="([^"]*)"\\s*/>`).exec(xml)?.[1];
const body = objects.find((o) => value(o.object, 'name') === 'Destapador');
const connector = objects.find((o) => value(o.object, 'name') === 'Conector independiente');
assert(body && connector, 'the native file contains the opener and connector');
const bodyFilaments = new Set(body.parts.map((p) => Number(value(p, 'extruder'))));
const connectorFilament = Number(value(connector.object, 'extruder'));
assert(bodyFilaments.size >= 2 && connectorFilament === 1 && bodyFilaments.has(1), 'the body, logo and connector retain their assigned filaments');
const instances = [...config.matchAll(/<model_instance>([\s\S]*?)<\/model_instance>/g)].map((m) => ({
  id: value(m[1], 'object_id'), label: Number(value(m[1], 'identify_id')),
}));
const bodyLabel = instances.find((i) => i.id === body.id)?.label;
const connectorLabel = instances.find((i) => i.id === connector.id)?.label;
assert(bodyLabel && connectorLabel && bodyLabel !== connectorLabel);

// Verify the exported mesh itself still has its functional slot and through holes.
const engine = await prepareCanOpener(), { Manifold, Mesh } = engine;
const partSolid = (name) => {
  const p = model.parts.find((q) => q.name === name);
  assert(p, `missing ${name}`);
  const mesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(p.V), triVerts: new Uint32Array(p.T) });
  mesh.merge();
  const m = new Manifold(mesh);
  assert.equal(m.status(), 'NoError', `${name} is closed after reimport`);
  return m;
};
const overlap = (a, b) => { const m = a.intersect(b), volume = m.volume(); m.delete(); return volume; };
const bodySolid = partSolid('Cuerpo destapador'), connectorSolid = partSolid('Conector independiente');
try {
  const shift = model.instances[0].transform.slice(9, 12), op = expected.info.opener;
  const a = Manifold.cube([op.edge + 9 - op.xin - 4, op.len - 8, 1]);
  const b = a.translate([op.xin + 4, op.ys + 4, 2.2]), c = b.rotate([0, 0, op.angle]);
  a.delete(); b.delete();
  const d = op.sg > 0 ? c : c.mirror([1, 0, 0]);
  if (d !== c) c.delete();
  const slit = d.translate(shift); d.delete();
  try { assert(overlap(bodySolid, slit) < 0.01, 'the exported slit remains open to the edge'); } finally { slit.delete(); }
  for (const [solid, holes] of [[bodySolid, expected.info.attachment.bodyHoles], [connectorSolid, expected.info.attachment.connectorHoles]]) {
    for (const h of holes) {
      const disk = Manifold.cylinder(expected.cfg.thickness + 2, h.diameter / 2 - 0.2, h.diameter / 2 - 0.2, 48);
      const probe = disk.translate([h.x + shift[0], h.y + shift[1], -1]); disk.delete();
      try { assert(overlap(solid, probe) < 0.01, 'the exported attachment hole is open'); } finally { probe.delete(); }
    }
  }
} finally { bodySolid.delete(); connectorSolid.delete(); }

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
assert.deepEqual(sorted(used.get(connectorLabel)), [connectorFilament], 'actual connector extrusion uses its assigned filament');
assert.deepEqual(sorted(used.get(bodyLabel)), sorted(bodyFilaments), 'actual body and logo extrusion use their assigned filaments');
assert.equal(hash(fs.readFileSync(input)), hash(original), 'the exported source 3MF remains unchanged');
const report = { passed: true, input, objects: plate.objects, filaments: plate.filaments, connectorFilament,
  bodyFilaments: sorted(bodyFilaments), changes: plate.filament_change_times, warning: plate.warning_message || null };
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`destapador Bambu OK: ${sorted(bodyFilaments).join(', ')} for body/logo; ${connectorFilament} for connector; ${plate.filament_change_times} filament changes.`);

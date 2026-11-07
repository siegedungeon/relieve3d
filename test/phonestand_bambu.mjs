// Native slicer regression (Windows + Bambu Studio): node test\phonestand_bambu.mjs
// Keeps the inputs, sliced projects, G-code, logs and report in test\out\phonestand-bambu.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { preparePhoneStand, buildPhoneStand, phoneStandExport } from '../src/core/phonestand.js';
import { threeMF } from '../src/core/exporters.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'out', 'phonestand-bambu');
const install = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Bambu Studio');
const exe = path.join(install, 'bambu-studio.exe');
const profiles = path.join(install, 'resources', 'profiles', 'BBL');
assert(fs.existsSync(exe), 'Install Bambu Studio before running this native slicer regression.');
fs.mkdirSync(out, { recursive: true });

const machine = path.join(profiles, 'machine', 'Bambu Lab A1 0.4 nozzle.json');
const filament = path.join(profiles, 'filament', 'Bambu PLA Basic @BBL A1.json');
const processFile = path.join(out, 'supports-forced-on.json');
const processProfile = JSON.parse(fs.readFileSync(path.join(profiles, 'process', '0.20mm Standard @BBL A1.json')));
fs.writeFileSync(processFile, JSON.stringify({
  ...processProfile, enable_support: '1', support_type: 'tree(auto)', support_threshold_angle: '30',
  support_on_build_plate_only: '0',
}, null, 2));

function toolpaths(gcode) {
  const support = { segments: 0, extrusion: 0 }, bridges = {};
  let feature = '', z = 0, x = 0, y = 0, e = 0, relativeE = false;
  for (const line of gcode.split(/\r?\n/)) {
    if (line.startsWith('; FEATURE: ')) feature = line.slice(11).trim();
    if (line.startsWith('; Z_HEIGHT: ')) z = Number(line.slice(12));
    const code = line.split(';')[0].trim();
    if (/^M83\b/.test(code)) relativeE = true;
    if (/^M82\b/.test(code)) relativeE = false;
    const v = Object.fromEntries([...code.matchAll(/([XYE])(-?(?:\d+(?:\.\d*)?|\.\d+))/g)].map((m) => [m[1], Number(m[2])]));
    if (/^G92\b/.test(code) && v.E !== undefined) e = v.E;
    if (!/^G[0-3]\b/.test(code)) continue;
    const nx = v.X ?? x, ny = v.Y ?? y, length = Math.hypot(nx - x, ny - y);
    const extrusion = v.E === undefined ? 0 : relativeE ? v.E : v.E - e;
    if (v.E !== undefined) e = relativeE ? e + v.E : v.E;
    x = nx; y = ny;
    if (extrusion <= 0 || length < 0.01) continue;
    if (/^Support(?: interface)?$/.test(feature)) {
      support.segments++;
      support.extrusion += extrusion;
    }
    if (feature === 'Bridge') {
      const b = bridges[z] ||= { segments: 0, maxLinearSpan: 0, extrusion: 0 };
      b.segments++;
      if (/^G1\b/.test(code)) b.maxLinearSpan = Math.max(b.maxLinearSpan, length);
      b.extrusion += extrusion;
    }
  }
  return { support, bridges };
}

await preparePhoneStand();
const model = buildPhoneStand({
  nfc: { enabled: true }, opener: { enabled: true }, logo: { enabled: false }, colors: { twoColor: false },
});
const exported = phoneStandExport(model);
const report = {
  generatedAt: new Date().toISOString(), appVersion: JSON.parse(fs.readFileSync(path.join(root, '..', 'package.json'))).version,
  machine, filament, processFile, geometry: model.info, cases: {}, passed: false,
};
try {
  // Same geometry in every case: the control must reproduce the trapped-support problem.
  for (const [name, settings, paint] of [
    ['unprotected-control', false, false], ['object-settings-only', true, false],
    ['paint-only', false, true], ['app-export', true, true],
  ]) {
    const dir = path.join(out, name);
    fs.mkdirSync(dir, { recursive: true });
    const input = path.join(dir, 'input.3mf'), output = path.join(dir, 'sliced.3mf');
    const parts = exported.parts.map((p) => ({ ...p, blockSupports: paint && p.blockSupports }));
    const assemblies = exported.assemblies.map((a) => ({ ...a, settings: settings ? a.settings : undefined }));
    fs.writeFileSync(input, threeMF(parts, model.cfg.name, { assemblies, pauses: exported.pauses }));
    for (const file of [output, path.join(dir, 'result.json')]) if (fs.existsSync(file)) fs.unlinkSync(file);
    const args = ['--load-settings', `${machine};${processFile}`, '--load-filaments', filament,
      '--slice', '0', '--export-3mf', path.basename(output), '--outputdir', dir, input];
    const run = spawnSync(exe, args, { timeout: 180000, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    fs.writeFileSync(path.join(dir, 'slicer.log'), (run.stdout || '') + (run.stderr || ''));
    assert.ifError(run.error);
    assert.equal(run.status, 0, `${name}: Bambu Studio failed; see slicer.log`);
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json')));
    assert.equal(result.return_code, 0, `${name}: native slicing succeeds`);
    const zip = unzipSync(fs.readFileSync(output)), gcode = zip['Metadata/plate_1.gcode'];
    assert(gcode?.length > 10000, `${name}: actual plate G-code, not just model metadata`);
    fs.writeFileSync(path.join(dir, 'plate_1.gcode'), gcode);
    const text = strFromU8(gcode), paths = toolpaths(text);
    const plate = result.sliced_plates[0], featureTimes = plate.feature_type_times;
    report.cases[name] = { args, ...paths, featureTimes, warnings: plate.warning_message ? [plate.warning_message] : [] };
    report.slicer = text.match(/^; (BambuStudio [^\r\n]+)/m)?.[1];
    assert(report.slicer, `${name}: G-code identifies the native slicer version`);
    console.log(`${name}: ${paths.support.segments} support extrusion segments; bridge layers ${Object.keys(paths.bridges).join(', ')}`);
  }
  assert(report.cases['unprotected-control'].support.segments > 0, 'control must reproduce supports');
  for (const name of ['object-settings-only', 'paint-only', 'app-export']) {
    const sliced = report.cases[name];
    assert.equal(sliced.support.segments, 0, `${name}: no support extrusion, including inside either slot`);
    assert.equal((sliced.featureTimes.Support || 0) + (sliced.featureTimes['Support interface'] || 0), 0,
      `${name}: native slicer also reports no support toolpaths`);
    for (const bridge of model.info.print.bridges) {
      const at = sliced.bridges[Number((bridge.z + 0.2).toFixed(2))];
      assert(at?.segments > 5 && at.maxLinearSpan > 5, `${name}: ${bridge.kind} roof has real bridge extrusion`);
    }
  }
  report.passed = true;
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  model.parts.forEach((p) => p.geometry.dispose());
  model.phone.dispose();
}
console.log(`phonestand Bambu OK - ${path.join(out, 'report.json')}`);

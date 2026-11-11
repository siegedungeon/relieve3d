import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { paintedBox3MF } from './fixtures/painted_sphere.mjs';
import { read3MF } from '../src/core/threemf_read.js';
import { prepareKeyring, inspectKeyringSource, buildKeyring, exportKeyring } from '../src/core/keyring_3mf.js';

await prepareKeyring();

function fixture(transform = '') {
  const files = unzipSync(paintedBox3MF());
  let xml = strFromU8(files['3D/3dmodel.model']);
  if (transform) xml = xml.replace('<item objectid="2"/>', `<item objectid="2" transform="${transform}"/>`);
  files['3D/3dmodel.model'] = strToU8(xml);
  files['Metadata/project_settings.config'] = strToU8('{"filament_colour":["#F4F4F4","#E8AFCF"],"custom_setting":"kept"}');
  files['Metadata/plate_1.gcode'] = strToU8('stale toolpath');
  files['Metadata/plate_1.png'] = new Uint8Array([1, 2, 3]);
  files['Metadata/plate_1.json'] = strToU8('{"bbox_all":[0,0,40,30],"first_layer_time":3}');
  files['_rels/.rels'] = strToU8('<Relationships><Relationship Target="/3D/3dmodel.model" Id="model"/><Relationship Target="/Metadata/plate_1.png" Id="thumbnail"/><Relationship Target="Metadata/plate_1.png" Id="relative-thumbnail"/></Relationships>');
  return zipSync(files);
}

function originalParts(model) {
  return model.parts.filter((part) => part.name !== 'Argolla Relieve3D')
    .map((part) => ({ V: [...part.V], T: [...part.T], colors: [...part.tc].map((c) => model.palette[c]) }));
}

test('adds a solid, open ring to the selected 3MF object without changing original geometry or painted colours', () => {
  const source = fixture(), beforeZip = unzipSync(source), before = read3MF(source);
  const scene = inspectKeyringSource(source);
  const result = buildKeyring(scene, { itemIndex: 0, side: 'top', position: 0.5, outer: 10, inner: 4, thickness: 2.4, overlap: 1.5, zOffset: 0, color: '#ffffff', extruder: 1 });
  assert.ok(result.attachmentVolume > 1, 'the ring must overlap the selected model by a real volume');
  assert.ok(result.holeBlockedVolume < 1e-5, 'the hole must remain open');
  assert.ok(result.volume > 0);
  assert.equal(result.components, 1, 'the ring is one closed solid');
  const out = exportKeyring(scene, result), afterZip = unzipSync(out), after = read3MF(out);
  assert.deepEqual(originalParts(after), originalParts(before), 'original triangles, coordinates and colour per triangle are retained');
  assert.equal(after.parts.length, before.parts.length + 1);
  assert.equal(strFromU8(afterZip['Metadata/project_settings.config']), strFromU8(beforeZip['Metadata/project_settings.config']));
  assert.equal(afterZip['Metadata/plate_1.gcode'], undefined, 'old toolpaths cannot be reused');
  assert.equal(afterZip['Metadata/plate_1.png'], undefined, 'old thumbnails must not misrepresent the result');
  assert.equal(afterZip['Metadata/plate_1.json'], undefined, 'old slice bounds and timing must not misrepresent the result');
  assert.ok(!strFromU8(afterZip['_rels/.rels']).includes('plate_1.png'), 'removed thumbnails must not leave broken package relationships');
  assert.ok(strFromU8(afterZip['_rels/.rels']).includes('/3D/3dmodel.model'), 'the model relationship remains');
  assert.deepEqual(unzipSync(source), beforeZip, 'the input archive is never modified');
  assert.ok(strFromU8(afterZip['3D/3dmodel.model']).includes('pid="1" p1="1"'), 'painted triangle properties remain in the file');
});

test('respects rotated and translated build instances', () => {
  const source = fixture('0 1 0 -1 0 0 0 0 1 85 12 0');
  const before = read3MF(source), scene = inspectKeyringSource(source);
  const result = buildKeyring(scene, { itemIndex: 0, side: 'top', position: 0.5, outer: 10, inner: 4, thickness: 2.4, overlap: 1.5, zOffset: 0 });
  const after = read3MF(exportKeyring(scene, result));
  assert.deepEqual(originalParts(after), originalParts(before));
  const ring = after.parts.find((part) => part.name === 'Argolla Relieve3D');
  assert.ok(ring);
  const centerY = (Math.max(...ring.V.filter((_, i) => i % 3 === 1)) + Math.min(...ring.V.filter((_, i) => i % 3 === 1))) / 2;
  assert.ok(Math.abs(centerY - result.center[1]) < 0.001, 'the ring stays in its world position after re-import');
});

test('preserves escaped XML names and dimensions in transformed inch projects', () => {
  const files = unzipSync(fixture('0 1 0 -1 0 0 0 0 1 2 3 0'));
  let xml = strFromU8(files['3D/3dmodel.model']).replace('unit="millimeter"', 'unit="inch"')
    .replace('<object id="2" type="model"', '<object id="2" name="Caja &amp; &quot;árbol&quot;" type="model"');
  xml = xml.replace(/<vertex ([^>]*)\/>/g, (_, a) => `<vertex ${a.replace(/([xyz])="([^"]+)"/g, (_m, k, v) => `${k}="${Number(v) / 25.4}"`)}/>`);
  files['3D/3dmodel.model'] = strToU8(xml);
  const source = zipSync(files), before = read3MF(source), scene = inspectKeyringSource(source);
  const result = buildKeyring(scene);
  const exported = exportKeyring(scene, result), after = read3MF(exported);
  assert.deepEqual(originalParts(after), originalParts(before));
  assert.equal(after.parts.find((p) => p.name !== 'Argolla Relieve3D').name, before.parts[0].name);
  const savedXml = strFromU8(unzipSync(exported)['3D/3dmodel.model']);
  assert.ok(!savedXml.includes('&amp;amp;') && !savedXml.includes('&amp;quot;'), 'pre-escaped names must not be encoded a second time');
  const ring = after.parts.find((p) => p.name === 'Argolla Relieve3D');
  const centerY = (Math.max(...ring.V.filter((_, i) => i % 3 === 1)) + Math.min(...ring.V.filter((_, i) => i % 3 === 1))) / 2;
  assert.ok(Math.abs(centerY - result.center[1]) < 0.001);
});

test('preserves external native model meshes and settings while adding a component to the selected object', () => {
  const files = unzipSync(fixture('1 0 0 0 1 0 0 0 1 70 50 0'));
  const original = strFromU8(files['3D/3dmodel.model']);
  const external = original.replace('<object id="2"', '<object id="7"').replace('<item objectid="2"', '<item objectid="7"');
  files['3D/Objects/object_1.model'] = strToU8(external);
  files['3D/_rels/3dmodel.model.rels'] = strToU8('<Relationships><Relationship Target="/3D/Objects/object_1.model" Id="part"/></Relationships>');
  files['3D/3dmodel.model'] = strToU8(original.replace('<model unit=', '<model xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" unit=')
    .replace(/<object id="2"[^>]*>[\s\S]*?<\/object>/, '<object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="7"/></components></object>'));
  files['Metadata/model_settings.config'] = strToU8('<config><object id="2"><metadata key="extruder" value="1"/><part id="7" subtype="normal_part"><metadata key="name" value="original"/><metadata key="extruder" value="2"/></part></object></config>');
  const source = zipSync(files), before = read3MF(source), scene = inspectKeyringSource(source);
  const result = buildKeyring(scene), exported = exportKeyring(scene, result), after = read3MF(exported), saved = unzipSync(exported);
  assert.deepEqual(originalParts(after), originalParts(before));
  assert.deepEqual(saved['3D/Objects/object_1.model'], files['3D/Objects/object_1.model']);
  assert.deepEqual(saved['3D/_rels/3dmodel.model.rels'], files['3D/_rels/3dmodel.model.rels']);
  const cfg = strFromU8(saved['Metadata/model_settings.config']);
  assert.ok(cfg.includes('<part id="7"') && cfg.includes('value="original"') && cfg.includes('Argolla Relieve3D'));
});

test('reader accepts reordered vertex attributes and rejects cyclic or mixed-unit references', () => {
  const source = fixture(), files = unzipSync(source), original = strFromU8(files['3D/3dmodel.model']);
  files['3D/3dmodel.model'] = strToU8(original.replace(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g, '<vertex z="$3" x="$1" y="$2"/>'));
  assert.deepEqual(originalParts(read3MF(zipSync(files))), originalParts(read3MF(source)));
  files['3D/3dmodel.model'] = strToU8(original.replace(/<object id="2"[^>]*>[\s\S]*?<\/object>/, '<object id="2" type="model"><components><component objectid="2"/></components></object>'));
  assert.throws(() => read3MF(zipSync(files)), /cíclic/i);
  files['3D/3dmodel.model'] = strToU8(original.replace('<item objectid="2"/>', '<item objectid="99"/>'));
  assert.throws(() => read3MF(zipSync(files)), /inexistente/i);
  files['3D/3dmodel.model'] = strToU8(original.replace(/<object id="2"[^>]*>[\s\S]*?<\/object>/, '<object id="2" type="model"><components><component p:path="/3D/external.model" objectid="2"/></components></object>'));
  files['3D/external.model'] = strToU8(original.replace('unit="millimeter"', 'unit="inch"'));
  assert.throws(() => read3MF(zipSync(files)), /mezcla unidades/i);
});

test('rejects a unitless external model when the root uses inches', () => {
  const files = unzipSync(fixture()), original = strFromU8(files['3D/3dmodel.model']);
  files['3D/3dmodel.model'] = strToU8(original.replace('unit="millimeter"', 'unit="inch"')
    .replace(/<object id="2"[^>]*>[\s\S]*?<\/object>/, '<object id="2" type="model"><components><component p:path="/3D/external.model" objectid="2"/></components></object>'));
  files['3D/external.model'] = strToU8(original.replace(' unit="millimeter"', ''));
  assert.throws(() => read3MF(zipSync(files)), /mezcla unidades/i);
});

test('rejects weak dimensions, blocked holes and ambiguous shared instances', () => {
  const source = fixture(), scene = inspectKeyringSource(source);
  assert.throws(() => buildKeyring(scene, { outer: 5, inner: 4, thickness: 2.4, overlap: 1.5 }), /pared/i);
  assert.throws(() => buildKeyring(scene, { outer: 10, inner: 4, thickness: 0.4, overlap: 1.5 }), /grosor/i);
  assert.throws(() => buildKeyring(scene, { outer: 10, inner: 4, thickness: 2.4, overlap: 4 }), /agujero|solap/i);
  const files = unzipSync(source);
  files['3D/3dmodel.model'] = strToU8(strFromU8(files['3D/3dmodel.model']).replace('<item objectid="2"/>', '<item objectid="2"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 50 0 0"/>'));
  const duplicate = inspectKeyringSource(zipSync(files));
  assert.throws(() => buildKeyring(duplicate, { itemIndex: 0 }), /instancia|repetid/i);
});

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { unzipSync, strFromU8 } = require('fflate');

module.exports = async ({ win, run, shot, wait }) => {
  const names = ['Helena', 'Dulce Maria', 'Abigail', 'Violeta', 'Antonia', 'Martina', 'Maria Paz', 'Allegra', 'Yessica', 'Violeta G', 'Guadalupe', 'Alba', 'Juanita'];
  const log = (...args) => console.log('[e2e]', ...args);
  const ok = (value, message) => { assert(value, message); log('ok', message); };
  const root = path.resolve(__dirname, '..', '..'), output = process.env.R3D_AUTOSAVE_DIR;
  const errors = [];
  win.webContents.setBackgroundThrottling(false);
  win.setSize(1600, 1000); win.show(); win.focus();
  win.webContents.on('console-message', e => {
    if ((e.level === 'error' || e.level >= 3) && !/al menos un nombre|demasiado largo|WebGLProgram|disk_cache/.test(e.message)) errors.push(e.message);
  });
  const setNames = value => run(`(()=>{const e=document.getElementById('pencilBatchNames');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const state = () => run(`document.getElementById('pencilBatchStatus').dataset.state`);
  const finished = async () => {
    const until = Date.now() + 240000;
    while (Date.now() < until) {
      const s = await state();
      if (['saved', 'error', 'cancelled'].includes(s)) return s;
      await wait(200);
    }
    throw new Error('Batch timed out');
  };
  await run(`window.__r3d.enterModule('pencil')`);
  ok(await run(`!document.getElementById('pencilBatchCard').hidden && window.__r3d.S.text.decoration==='none'`), 'new module exposes list generator without default figures');
  const original = await run(`JSON.stringify({text:window.__r3d.S.text,settings:window.__r3d.S.settings,image:window.__r3d.S.image.dataURL})`);
  await setNames(' \n;');
  await run(`document.getElementById('pencilBatchGenerate').click()`);
  ok(await finished() === 'error', 'empty input gives an explicit error');
  await setNames('W'.repeat(160));
  await run(`document.getElementById('pencilBatchGenerate').click()`);
  ok(await finished() === 'error', 'impossible width is rejected instead of scaling the channel');
  await setNames(names.join('\n'));
  await run(`document.getElementById('pencilBatchGenerate').click();document.getElementById('pencilBatchCancel').click()`);
  ok(await finished() === 'cancelled' && fs.readdirSync(output).length === 0, 'cancel leaves no partial batch files');
  await run(`document.getElementById('pencilBatchGenerate').click()`);
  const result = await finished();
  ok(result === 'saved', 'all requested names generated: ' + await run(`document.getElementById('pencilBatchStatus').textContent`));
  ok(original === await run(`JSON.stringify({text:window.__r3d.S.text,settings:window.__r3d.S.settings,image:window.__r3d.S.image.dataURL})`), 'generation leaves the open document untouched');
  ok(await run(`localStorage.getItem('r3d.pencilBatch.names')===${JSON.stringify(names.join('\n'))}`), 'list persists for the next launch');
  const folders = fs.readdirSync(output, { withFileTypes: true }).filter(f => f.isDirectory());
  assert.equal(folders.length, 1);
  const folder = path.join(output, folders[0].name);
  const report = JSON.parse(fs.readFileSync(path.join(folder, 'lote.json')));
  assert.deepEqual(report.models.map(m => m.name), names);
  assert.equal(report.plates.length, 1);
  assert.equal(fs.readdirSync(folder).filter(f => f.endsWith('.stl')).length, 13);
  const { checkPencilExports } = await import(pathToFileURL(path.join(root, 'test', 'pencil_exports.mjs')).href);
  const { read3MF } = await import(pathToFileURL(path.join(root, 'src', 'core', 'threemf_read.js')).href);
  for (const model of report.models) {
    const project = JSON.parse(fs.readFileSync(path.join(folder, model.file + '.r3d')));
    assert.equal(project.state.text.text, model.name);
    assert.equal(project.state.text.font, 'Matemasie');
    assert.equal(project.state.text.decoration, 'none');
    assert.equal(project.state.text.outline, false);
    assert.equal(project.state.text.baseColor, '#5e43b7');
    assert.equal(project.state.text.fill, '#ffffff');
    const measured = await checkPencilExports(folder, model.file, model.channel, { calibre: 7.9, height: 13, colors: 2, maxDimensions: [75, 19, 13.002], minWall: 1.6 });
    assert.equal(measured.parts, 2);
    log('ok solid, connected, 7.9 mm bore, 1.6 mm walls', model.name, model.size.map(v => v.toFixed(2)).join(' x '));
  }
  const plateBytes = fs.readFileSync(path.join(folder, 'Placa_01_Bambu_A1.3mf'));
  const plate = read3MF(plateBytes), archive = unzipSync(plateBytes);
  assert.equal(plate.parts.length, 26);
  assert.equal((strFromU8(archive['Metadata/model_settings.config']).match(/<model_instance>/g) || []).length, 13);
  const bbox = p => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.V.length; i++) { min[i % 3] = Math.min(min[i % 3], p.V[i]); max[i % 3] = Math.max(max[i % 3], p.V[i]); }
    return { min, max };
  };
  for (const [i, placement] of report.plates[0].entries()) {
    for (const part of plate.parts.slice(i * 2, i * 2 + 2)) {
      const b = bbox(part);
      assert(b.min[0] >= placement.x - 0.002 && b.max[0] <= placement.x + placement.width + 0.002);
      assert(b.min[1] >= placement.y - 0.002 && b.max[1] <= placement.y + placement.height + 0.002);
    }
    for (const other of report.plates[0].slice(i + 1)) assert(placement.x + placement.width + 2.999 <= other.x
      || other.x + other.width + 2.999 <= placement.x || placement.y + placement.height + 2.999 <= other.y
      || other.y + other.height + 2.999 <= placement.y);
  }
  log('ok 13 independent two-colour objects on one plate with 3 mm separation');
  const model = report.models.find(m => m.name === 'Allegra');
  const project = fs.readFileSync(path.join(folder, model.file + '.r3d'), 'utf8');
  await run(`window.__r3d.S.settings.widthMM=240`);
  await run(`window.__r3d.openProjectFile(new File([${JSON.stringify(project)}],'Allegra.r3d'))`);
  const reopened = JSON.parse(await run(`JSON.stringify(window.__r3d.exportParts().map(p=>({color:p.color,vertices:Array.from(p.geometry.attributes.position.array)})))`));
  const exported = read3MF(fs.readFileSync(path.join(folder, model.file + '.3mf')));
  for (const part of exported.parts) {
    const color = exported.palette[part.tc[0]].toLowerCase();
    const current = reopened.find(p => p.color.toLowerCase() === color);
    assert.equal(current.vertices.length, part.V.length);
    for (let i = 0; i < part.V.length; i++) assert(Math.abs(current.vertices[i] - part.V[i]) < 0.00006, 'project restores exact geometry even from a different previous width');
  }
  log('ok editable project reproduces exported geometry');
  await run(`document.querySelector('#pencilBatchResults button').click()`);
  await wait(1800);
  ok(await run(`window.__r3d.S.text.text==='Helena' && !!window.__r3d.getFeat()?.pencilChannel`), 'generated name opens from the results list');
  await shot(path.join(process.env.E2E_DIR, 'pencil-batch.png'));
  const { checkBambuBatch } = await import(pathToFileURL(path.join(root, 'test', 'pencil_bambu.mjs')).href);
  log('ok native Bambu import and complete two-colour slice', JSON.stringify(await checkBambuBatch(folder, path.join(process.env.E2E_DIR, 'bambu'))));
  const { dialog } = require('electron'), originalDialog = dialog.showOpenDialog;
  try {
    delete process.env.R3D_AUTOSAVE_DIR;
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    await setNames('Alba');
    await run(`document.getElementById('pencilBatchGenerate').click()`);
    ok(await finished() === 'cancelled', 'cancelling the folder dialog creates no files');
  } finally { dialog.showOpenDialog = originalDialog; process.env.R3D_AUTOSAVE_DIR = output; }
  assert.equal(fs.readdirSync(output).length, 1);
  await setNames('Alba\nAlba');
  await run(`document.getElementById('pencilBatchGenerate').click()`);
  ok(await finished() === 'saved', 'duplicate names generate independent copies');
  const second = fs.readdirSync(output).find(name => name !== folders[0].name);
  const duplicate = JSON.parse(fs.readFileSync(path.join(output, second, 'lote.json')));
  assert.deepEqual(duplicate.models.map(m => m.name), ['Alba', 'Alba']);
  assert.notEqual(duplicate.models[0].file, duplicate.models[1].file);
  assert.equal(fs.readFileSync(path.join(folder, 'lote.json'), 'utf8'), JSON.stringify(report, null, 2));
  await setNames(names.join('\n'));
  assert.deepEqual(errors, []);
  log('done');
};

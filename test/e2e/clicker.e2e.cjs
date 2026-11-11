const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { pathToFileURL } = require('url');
const { unzipSync, strFromU8 } = require('fflate');

module.exports = async ({ win, run, shot, wait }) => {
  const dir = process.env.E2E_DIR, exp = process.env.R3D_AUTOSAVE_DIR;
  const errors = [];
  win.webContents.on('console-message', (event) => {
    if ((event.level === 'error' || event.level >= 3) && !/WebGLProgram|disk_cache/.test(event.message)) errors.push(event.message);
  });
  const log = (...args) => console.log('[e2e]', ...args);
  const ok = (condition, text) => log(condition ? 'ok  ' : 'FAIL', text);
  const hash = () => createHash('sha256').update(fs.readFileSync(process.env.E2E_INPUT)).digest('hex');
  const before = hash(), b64 = fs.readFileSync(process.env.E2E_INPUT).toString('base64');
  await win.setSize(1500, 900);
  ok(await run(`(() => { const card = document.querySelector('[data-mod="clicker"]'); if (!card) return false; card.click(); return true; })()`), 'the clicker module opens from home');
  await wait(800);
  await run(`(() => { const bytes = Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0)), transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'diseno.png', { type: 'image/png' })); document.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer })); })()`);
  for (let n = 0; n < 120; n++) {
    const state = await run(`!!window.__r3d.clicker.res || !!document.querySelector('#clicker [data-r=warn]').textContent`);
    if (state) break;
    await wait(500);
  }
  const initial = JSON.parse(await run(`JSON.stringify({ ready: !document.querySelector('#clicker [data-r=export]').disabled, roles: window.__r3d.clicker.res?.parts.map(p => p.role), info: window.__r3d.clicker.res?.info, warning: document.querySelector('#clicker [data-r=warn]').textContent })`));
  ok(initial.ready && initial.roles.includes('cap') && initial.roles.includes('base') && initial.roles.includes('relief'), 'dropping an image creates a cap, colour relief and an MX housing' + (initial.ready ? '' : ': ' + initial.warning));
  ok(await run(`/vectorización puede simplificar u omitir detalles finos/i.test(document.querySelector('#clicker').textContent)`), 'the interface explains that fine image details may be simplified');
  await shot(path.join(dir, 'clicker-initial.png'));
  await run(`(() => { const p = document.querySelector('#clicker [data-k=width]'); p.value = '10'; p.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  ok(await run(`document.querySelector('#clicker [data-r=export]').disabled`), 'pending changes cannot be exported');
  await run(`window.__r3d.clicker.rebuild()`);
  ok(await run(`document.querySelector('#clicker [data-r=export]').disabled && /ancho/i.test(document.querySelector('#clicker [data-r=warn]').textContent)`), 'unsafe size is rejected with an explanation');
  await run(`(() => { for (const [k,v] of [['width','50'],['stemClearance','0,2'],['mountClearance','0,25'],['colors','2']]) { const p = document.querySelector('#clicker [data-k='+k+']'); p.value = v; p.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  await run(`window.__r3d.clicker.rebuild()`);
  const adjusted = JSON.parse(await run(`JSON.stringify({ ready: !document.querySelector('#clicker [data-r=export]').disabled, info: window.__r3d.clicker.res?.info, warning: document.querySelector('#clicker [data-r=warn]').textContent })`));
  ok(adjusted.ready && Math.abs(adjusted.info.switchOpening - 14.25) < 1e-8 && Math.abs(adjusted.info.socketLength - 4.2) < 1e-8, 'adjusted size and clearances are reflected in the generated model' + (adjusted.ready ? '' : ': ' + adjusted.warning));
  await shot(path.join(dir, 'clicker-ready.png'));
  const expected = JSON.parse(await run(`JSON.stringify({ colors: window.__r3d.clicker.res.colors, baseExtruder: window.__r3d.clicker.res.parts.find(p => p.role === 'base').filamentIndex + 1 })`));
  const { read3MF } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'core', 'threemf_read.js')).href);
  const reopen = (name) => {
    const file = path.join(exp, name);
    if (!fs.existsSync(file)) { ok(false, `${name} is saved`); return null; }
    const bytes = fs.readFileSync(file), model = read3MF(bytes);
    ok(model.instances.length === 2 && model.parts.some((p) => /Tapa/.test(p.name)) && model.parts.some((p) => /Base/.test(p.name)) && model.parts.some((p) => /Relieve/.test(p.name)), `${name} reopens with the cap, relief and separate housing`);
    const zip = unzipSync(bytes), cfg = strFromU8(zip['Metadata/model_settings.config']);
    const baseId = model.instances[1].objectId;
    const base = new RegExp(`<object id="${baseId}">([\\s\\S]*?)<part`).exec(cfg)?.[1];
    ok(base?.includes(`key="extruder" value="${expected.baseExtruder}"`), `${name} keeps the housing's assigned filament`);
    return { model, zip };
  };
  ok(await run(`document.querySelector('#clicker [data-r=format]').value === 'bambu'`), 'the installed Bambu A1 profile is the default');
  const profileRoots = [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const bambuInstalled = profileRoots.some((root) => fs.existsSync(path.join(root, 'Bambu Studio', 'resources', 'profiles', 'BBL')));
  let native = null;
  if (bambuInstalled) {
    await run(`window.__r3d.clicker.export()`);
    native = reopen('diseno_clicker_Bambu_A1.3mf');
    if (native) {
      const settings = native.zip['Metadata/project_settings.config'] && JSON.parse(strFromU8(native.zip['Metadata/project_settings.config']));
      ok(settings?.printer_model === 'Bambu Lab A1' && JSON.stringify(settings.filament_colour) === JSON.stringify(expected.colors), 'the native file embeds the A1 profile and every designed filament');
    }
  } else {
    log('skip native A1 export: Bambu Studio profiles are not installed');
  }
  await run(`(() => { document.querySelector('#clicker [data-r=format]').value = 'standard'; })()`);
  await run(`window.__r3d.clicker.export()`);
  const standard = reopen('diseno_clicker.3mf');
  if (standard) {
    ok(!standard.zip['Metadata/project_settings.config'], 'the standard file has no machine-specific profile');
    if (native) {
      const shapes = (model) => model.parts.map((p) => ({ name: p.name, vertices: [...p.V], triangles: [...p.T] }));
      ok(JSON.stringify(shapes(standard.model)) === JSON.stringify(shapes(native.model)), 'both formats preserve the same geometry');
    }
  }
  ok(hash() === before, 'the source image remains unchanged');
  await run(`document.querySelector('#clicker [data-a=home]').click()`);
  ok(await run(`!document.querySelector('#home').hidden && document.querySelector('#clicker').hidden`), 'returning home closes the module');
  ok(!errors.length, 'console errors: ' + (errors.join(' | ') || 'none'));
  log('done');
};

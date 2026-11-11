const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { unzipSync, strFromU8 } = require('fflate');
const { read3MF } = require('../../src/core/threemf_read.js');

module.exports = async ({ win, run, shot, wait }) => {
  const dir = process.env.E2E_DIR, exp = process.env.R3D_AUTOSAVE_DIR;
  const errors = [];
  win.webContents.on('console-message', (event) => {
    if ((event.level === 'error' || event.level >= 3) && !/WebGLProgram|disk_cache/.test(event.message)) errors.push(event.message);
  });
  const log = (...args) => console.log('[e2e]', ...args);
  const ok = (condition, text) => log(condition ? 'ok  ' : 'FAIL', text);
  const hash = () => createHash('sha256').update(fs.readFileSync(process.env.E2E_INPUT)).digest('hex');
  const before = hash(), logo = fs.readFileSync(process.env.E2E_INPUT);
  const q = (selector) => `document.querySelector('#canopener ${selector}')`;
  const set = (key, value) => run(`(() => { const el=${q(`[data-k="${key}"]`)}; el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const check = (key, value) => run(`(() => { const el=${q(`[data-k="${key}"]`)}; if(el.checked!==${value}) el.click(); })()`);
  const drop = (bytes, name, type) => run(`(() => { const b=Uint8Array.from(atob('${bytes.toString('base64')}'),c=>c.charCodeAt(0)), dt=new DataTransfer(); dt.items.add(new File([b],${JSON.stringify(name)},{type:${JSON.stringify(type)}})); document.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt})); })()`);
  const until = async (expr, timeout = 90000) => {
    for (const start = Date.now(); Date.now() - start < timeout; await wait(200)) if (await run(expr)) return true;
    return false;
  };
  const info = () => run(`JSON.stringify({cfg:window.__r3d.canopener.cfg,info:window.__r3d.canopener.res?.info,colors:window.__r3d.canopener.res?.colors,parts:window.__r3d.canopener.res?.parts.map(p=>({name:p.name,art:!!p.art,apart:!!p.apart,color:p.color,filamentIndex:p.filamentIndex})),warning:${q('[data-r="warn"]')}.textContent})`).then(JSON.parse);
  win.webContents.setBackgroundThrottling(false);
  await win.setSize(1500, 900);
  ok(await run(`(() => { const card=document.querySelector('[data-mod="canopener"]'); if(!card)return false; card.click(); return true; })()`), 'the standalone opener opens from its home card');
  ok(await until(`!!window.__r3d.canopener.res && !window.__r3d.canopener.stale`), 'the default heart is generated with a functional slot');
  const initial = await info();
  ok(initial.cfg.shape === 'heart' && initial.cfg.thickness === 8 && initial.info.opener && initial.info.attachment.kind === 'round' && initial.info.attachment.mount === 'external', 'the default heart has a slot and an external ring eyelet');
  await wait(600); await shot(path.join(dir, 'canopener-heart.png'));

  for (const [preset, kind] of [['small', 'round'], ['large', 'round'], ['cord', 'round'], ['ribbon', 'slot']]) {
    await run(`(() => { const el=${q('[data-r="preset"]')}; el.value=${JSON.stringify(preset)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    ok(await until(`window.__r3d.canopener.res?.cfg.attachment.kind === ${JSON.stringify(kind)} && !window.__r3d.canopener.stale`), preset + ' updates the preview');
    const option = await info();
    ok(option.cfg.attachment.mount === 'external' && option.parts.every(p => !p.apart) &&
      (kind === 'slot' || option.info.attachment.bodyHoles.length === 1), preset + ' uses one opening and no separate connector');
  }
  await set('shape', 'nailpolish'); await set('side', 'right'); await set('width', '60'); await set('thickness', '8');
  await run('window.__r3d.canopener.rebuild()');
  await drop(logo, 'logo-prueba.png', 'image/png');
  ok(await until(`!!window.__r3d.canopener.logoImg && !!window.__r3d.canopener.res && !window.__r3d.canopener.stale`), 'dropping a client logo loads and rebuilds the custom opener');
  await set('logo.colors', '2'); await set('logo.mode', 'flat');
  await check('text.enabled', true); await set('text.value', 'Pabonitas');
  await run('window.__r3d.canopener.rebuild()');
  state = await info();
  ok(state.cfg.shape === 'nailpolish' && state.cfg.attachment.mount === 'external' && state.cfg.attachment.kind === 'slot' && state.cfg.attachment.slotWidth === 10,
    'the nail-polish figure and ribbon opening use the selected dimensions');
  ok(state.info.logo?.length >= 1 && state.parts.some((p) => p.art) && state.colors.length <= 4,
    'the logo produces coloured pieces');
  const firstLayer = await run(`!!${q('[data-layer="0"] [data-lm="color"]')}`);
  if (firstLayer) {
    await run(`(() => { const el=${q('[data-layer="0"] [data-lm="color"]')}; el.value='#1199ee'; el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await run('window.__r3d.canopener.rebuild()');
    state = await info();
  }
  ok(firstLayer && state.colors.includes('#1199ee'), 'a detected logo colour can be assigned a filament colour');
  await wait(600); await shot(path.join(dir, 'canopener-customized.png'));

  await run('window.__r3d.canopener.saveProject()');
  const projectFile = path.join(exp, 'Destapador.r3o');
  ok(fs.existsSync(projectFile), 'the editable project is saved');
  if (fs.existsSync(projectFile)) {
    const project = fs.readFileSync(projectFile), parsed = JSON.parse(project.toString());
    ok(parsed.app === 'Relieve3D-Destapador' && parsed.logoSrc?.startsWith('data:image/') && parsed.cfg.attachment.kind === 'slot', 'the project embeds the logo and attachment settings');
    await set('shape', 'flower'); await run('window.__r3d.canopener.rebuild()');
    await drop(project, 'Destapador.r3o', 'application/json');
    ok(await until(`window.__r3d.canopener.cfg.shape === 'nailpolish' && !!window.__r3d.canopener.res && !window.__r3d.canopener.stale`), 'dropping the project restores the figure, logo and settings');
  }
  state = await info();
  fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify(state, null, 2));
  const reopen = (name) => {
    const file = path.join(exp, name);
    if (!fs.existsSync(file)) { ok(false, `${name} is saved`); return null; }
    const bytes = fs.readFileSync(file), model = read3MF(bytes), zip = unzipSync(bytes);
    ok(model.instances.length === 1 && model.parts.some((p) => /Cuerpo destapador/.test(p.name)) && model.parts.some((p) => /Logo/.test(p.name)), `${name} reopens with the body and logo`);
    return { model, zip };
  };
  const roots = [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const installed = roots.some((root) => fs.existsSync(path.join(root, 'Bambu Studio', 'resources', 'profiles', 'BBL')));
  let native = null;
  if (installed) {
    await run('window.__r3d.canopener.export()');
    native = reopen('Destapador_Bambu_A1.3mf');
    if (native) {
      const settings = JSON.parse(strFromU8(native.zip['Metadata/project_settings.config']));
      ok(settings.printer_model === 'Bambu Lab A1' && JSON.stringify(settings.filament_colour) === JSON.stringify(state.colors), 'the Bambu file embeds the A1 profile and selected colours');
    }
  } else log('skip native A1 export: Bambu Studio profiles are not installed');
  await run(`(${q('[data-r="format"]')}.value='standard')`);
  await run('window.__r3d.canopener.export()');
  const standard = reopen('Destapador.3mf');
  if (standard) {
    ok(!standard.zip['Metadata/project_settings.config'], 'the standard 3MF contains no machine-specific profile');
    if (native) {
      const geometry = (model) => model.parts.map((p) => ({ name: p.name, vertices: [...p.V], triangles: [...p.T] }));
      ok(JSON.stringify(geometry(standard.model)) === JSON.stringify(geometry(native.model)), 'standard and A1 exports have identical geometry');
    }
  }
  ok(hash() === before, 'the source logo remains unchanged');
  await run(`${q('[data-a="home"]')}.click()`);
  ok(await run(`!document.querySelector('#home').hidden && document.querySelector('#canopener').hidden`), 'returning home closes the editor');
  ok(!errors.length, 'console errors: ' + (errors.join(' | ') || 'none'));
  log('done');
};

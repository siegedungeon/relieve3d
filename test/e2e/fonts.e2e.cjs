const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

module.exports = async ({ win, run, shot, wait }) => {
  const dir = process.env.E2E_DIR, exports = process.env.R3D_AUTOSAVE_DIR;
  const errors = [];
  win.webContents.on('console-message', event => {
    if ((event.level === 'error' || event.level >= 3) && !/WebGLProgram|disk_cache/.test(event.message)) errors.push(event.message);
  });
  const ok = (condition, message) => {
    console.log('[e2e]', condition ? 'ok  ' : 'FAIL', message);
    if (!condition) throw new Error(message);
  };
  const until = async (expression, message) => {
    const deadline = Date.now() + 60000;
    while (!await run(expression)) {
      if (Date.now() > deadline) throw new Error(message);
      await wait(100);
    }
  };
  const click = async selector => {
    const point = await run(`(()=>{
      const element=document.querySelector(${JSON.stringify(selector)});
      if(!element) throw new Error('Missing control: '+${JSON.stringify(selector)});
      element.scrollIntoView({block:'nearest'});
      const r=element.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
    })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    await wait(150);
  };
  const key = async keyCode => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await wait(100);
  };
  const set = async (selector, value, event = 'change') => {
    await run(`(()=>{
      const element=document.querySelector(${JSON.stringify(selector)});
      if(element.type==='checkbox') element.checked=${JSON.stringify(value)};
      else element.value=${JSON.stringify(value)};
      element.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));
    })()`);
    await wait(1200);
  };
  const popup = '.font-picker-popup:popover-open';
  const open = async selector => {
    await click(`${selector} + .font-picker-trigger`);
    await until(`!!document.querySelector('${popup}')`, 'font list did not open');
  };
  const search = async family => {
    await set(`${popup} .font-picker-search`, family, 'input');
  };
  const choose = async (selector, family, keyboard = false) => {
    await open(selector);
    await search(family);
    const option = `${popup} [data-font=${JSON.stringify(family)}]`;
    await until(`document.querySelector(${JSON.stringify(option + ' .font-picker-sample')})?.dataset.state==='ready'`, 'font preview did not load: ' + family);
    if (keyboard) await key('Enter');
    else await click(option);
    await until(`!document.querySelector('${popup}') && document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(family)}`, 'font selection was not applied');
    await wait(1500);
  };
  const capture = async name => {
    win.webContents.invalidate(); await wait(300);
    await shot(path.join(dir, name + '.png'));
  };
  const home = async module => {
    await run(`window.__r3d.showHome(); window.__r3d.enterModule(${JSON.stringify(module)})`);
    await wait(1500);
  };
  ipcMain.removeHandler('confirm');
  ipcMain.handle('confirm', () => 1);
  win.setSize(1600, 1000); win.show(); win.focus();
  await until('!!window.__r3d', 'application failed to initialize');
  ok(await run(`['#txtFont','#backFont','#studio [data-t="font"]','#studio [data-e="font"]',
    '#hablador [data-k="title.font"]','#hablador [data-k="subtitle.font"]','#hablador [data-k="qr.labelFont"]']
    .every(s=>document.querySelector(s)?.nextElementSibling?.matches('.font-picker-trigger'))`),
  'all seven font selectors have a preview control');

  await home('keychain');
  await click('#sourceSeg [data-src="text"]');
  await set('#txtText', 'Sof\u00eda', 'input');
  await until("!!window.__r3d.S.result && document.getElementById('busy').hidden", 'keychain did not generate');
  const before = await run('window.__r3d.S.image.dataURL');
  const originalFont = await run('window.__r3d.S.text.font');
  await open('#txtFont');
  await search('ma');
  await until(`document.querySelector('${popup} [data-font="Matemasie"] .font-picker-sample')?.dataset.state==='ready'`, 'Matemasie preview did not load');
  ok(await run(`(()=>{
    const sample=document.querySelector('${popup} [data-font="Matemasie"] .font-picker-sample');
    return sample.textContent==='Sofía' && getComputedStyle(sample).fontFamily.includes('Matemasie')
      && [...document.fonts].some(f=>f.family==='Matemasie' && f.status==='loaded');
  })()`), 'the keychain word is drawn using the real bundled face before selection');
  await capture('fonts_01_keychain_choices');
  await key('ArrowDown');
  await key('Escape');
  ok(await run(`window.__r3d.S.text.font===${JSON.stringify(originalFont)} && window.__r3d.S.image.dataURL===${JSON.stringify(before)}`),
    'browsing and cancelling do not modify the model');
  await open('#txtFont');
  await search('no-such-font-9274');
  await key('Enter');
  ok(await run(`document.querySelector('${popup} .font-picker-list').children.length===0 && window.__r3d.S.text.font===${JSON.stringify(originalFont)}`),
    'an empty search cannot apply a different font');
  await key('Escape');
  await choose('#txtFont', 'Matemasie', true);
  ok(await run(`window.__r3d.S.text.font==='Matemasie' && window.__r3d.S.image.dataURL!==${JSON.stringify(before)}`),
    'keyboard selection regenerates the actual keychain');
  await choose('#txtFont', 'Titan One');
  await run('window.__r3d.undo()');
  await until(`document.querySelector('#txtFont + .font-picker-trigger .font-picker-name').textContent==='Matemasie'`, 'undo did not synchronize font control');
  await run('window.__r3d.redo()');
  await until(`document.querySelector('#txtFont + .font-picker-trigger .font-picker-name').textContent==='Titan One'`, 'redo did not synchronize font control');
  await set('#txtItalic', true);
  await open('#txtFont'); await search('Matemasie');
  await until(`document.querySelector('${popup} .font-picker-sample')?.dataset.state==='ready'`, 'italic preview did not load');
  ok(await run(`getComputedStyle(document.querySelector('${popup} .font-picker-sample')).fontStyle==='italic'`), 'previews respect the text style');
  await key('Escape'); await set('#txtItalic', false);

  await set('[data-set="back.enabled"]', true);
  await set('#backText', 'Hecho a mano');
  await open('#backFont'); await search('Lilita');
  await until(`document.querySelector('${popup} .font-picker-sample')?.dataset.state==='ready'`, 'back font did not load');
  ok(await run(`document.querySelector('${popup} .font-picker-sample').textContent==='Hecho a mano'`),
    'engraving previews use the back text, not the front name');
  await capture('fonts_02_back_choices'); await key('Escape');
  await choose('#backFont', 'Lilita One');
  await run('window.__r3d.saveProject()');
  const projectName = fs.readdirSync(exports).find(file => file.endsWith('.r3d'));
  const project = JSON.parse(fs.readFileSync(path.join(exports, projectName), 'utf8'));
  for (const kind of ['3mf', 'stl-one', 'svg']) await run(`window.__r3d.doExport('${kind}')`);
  ok(['.3mf', '.stl', '.svg'].every(ext => fs.readdirSync(exports).some(file => file.endsWith(ext) && fs.statSync(path.join(exports, file)).size > 1000)),
    'the personalized keychain exports actual 3MF, STL and SVG files');
  const systemFont = await run(`document.querySelector('#txtFont optgroup[label^="Fuentes instaladas"] option[value="Arial"]')?.value`);
  ok(!!systemFont, 'installed Windows fonts remain available');
  await choose('#txtFont', systemFont);
  await run(`window.__r3d.openProjectFile(new File([${JSON.stringify(JSON.stringify(project))}],'saved.r3d'))`);
  ok(await run(`window.__r3d.S.text.font==='Titan One' && window.__r3d.S.settings.back.font==='Lilita One'
    && document.querySelector('#txtFont + .font-picker-trigger .font-picker-name').textContent==='Titan One'
    && document.querySelector('#backFont + .font-picker-trigger .font-picker-name').textContent==='Lilita One'`),
    'reopening restores both editable font selections and their controls');

  await home('logoprep');
  await run(`window.__r3d.studio.setSource('text')`); await wait(1500);
  await set('#studio [data-t="text"]', 'Luna', 'input');
  await choose('#studio [data-t="font"]', 'Titan One');
  await run('window.__r3d.studio.addText()');
  await set('#studio [data-e="text"]', 'Sol', 'input');
  await choose('#studio [data-e="font"]', 'Great Vibes');
  ok(await run(`window.__r3d.studio.st.text.font==='Titan One' && window.__r3d.studio.selEl().font==='Great Vibes'
    && document.querySelector('#studio [data-e="font"] + .font-picker-trigger .font-picker-sample').textContent==='Sol'`),
    '2D source text and added elements have independent previews and fonts');
  await run('delete window.__r3d.studio.selEl().weight; window.__r3d.studio.fontPickers[1].sync()');
  await until(`document.querySelector('#studio [data-e="font"] + .font-picker-trigger .font-picker-sample').dataset.state==='ready'`, 'legacy text preview did not load');
  ok(await run(`getComputedStyle(document.querySelector('#studio [data-e="font"] + .font-picker-trigger .font-picker-sample')).fontWeight==='700'`),
    'older text elements preview the same default weight used for rendering');
  await run('(async()=>{await window.__r3d.studio.saveProject(); await window.__r3d.studio.export("svg");})()');
  await wait(1000);
  const studioName = fs.readdirSync(exports).find(file => file.endsWith('.r3s'));
  await run(`window.__r3d.studio.openProject(${fs.readFileSync(path.join(exports, studioName), 'utf8')})`);
  ok(await run(`window.__r3d.studio.st.elements.some(e=>e.kind==='text' && e.font==='Great Vibes')`),
    '2D font choices survive project reopening');
  await home('cakelaser');
  await set('#studio [data-t="text"]', 'Luna', 'input');
  await choose('#studio [data-t="font"]', 'Matemasie');
  await run('window.__r3d.studio.export("svg-cut")');
  ok(fs.readdirSync(exports).some(file => file.endsWith('_corte.svg')), 'laser topper uses the same picker and exports its selected lettering');

  await home('hablador');
  ok(await run(`[...document.querySelectorAll('#hablador .panel')].every(panel=>panel.getBoundingClientRect().bottom<=innerHeight)`),
    'sign panels remain scrollable inside the viewport with preview controls');
  await set('#hablador [data-k="title.text"]', 'LUNA');
  await open('#hablador [data-k="title.font"]'); await search('Montserrat');
  await until(`document.querySelector('${popup} [data-font="Montserrat Bold"] .font-picker-sample')?.dataset.state==='ready'`, 'sign-specific face did not load');
  ok(await run(`document.querySelector('${popup} [data-font="Montserrat Bold"] .font-picker-sample').textContent==='LUNA'
    && [...document.fonts].some(f=>f.family.replace(/^"|"$/g,'')==='Montserrat Bold' && f.status==='loaded')`),
    'sign previews load the same Montserrat font file used for the cut geometry');
  win.setSize(1100, 680); await wait(500);
  ok(await run(`(()=>{
    const r=document.querySelector('${popup}').getBoundingClientRect();
    return r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight;
  })()`), 'the font list stays inside a small application window');
  await capture('fonts_03_hablador_small'); await key('Escape');
  await choose('#hablador [data-k="title.font"]', 'Montserrat Bold');
  await choose('#hablador [data-k="subtitle.font"]', 'Poppins Black');
  await choose('#hablador [data-k="qr.labelFont"]', 'Bebas Neue');
  await run('(async()=>{await window.__r3d.hablador.saveProject(); await window.__r3d.hablador.export();})()');
  await wait(1000);
  const signName = fs.readdirSync(exports).find(file => file.endsWith('.r3h'));
  const sign = JSON.parse(fs.readFileSync(path.join(exports, signName), 'utf8'));
  await run(`window.__r3d.hablador.openProject(${JSON.stringify(sign)})`);
  ok(await run(`window.__r3d.hablador.cfg.title.font==='Montserrat Bold'
    && window.__r3d.hablador.cfg.subtitle.font==='Poppins Black'
    && window.__r3d.hablador.cfg.qr.labelFont==='Bebas Neue'`),
    'title, subtitle and QR fonts survive SVG export and project reopening');
  await run(`(async()=>{
    const {FontPicker}=await import('./font_picker.js');
    const root=document.createElement('div');root.id='font-fixture';
    root.style.cssText='position:fixed;left:20px;top:70px;z-index:60;width:200px';
    const select=document.createElement('select');select.id='font-fixture-select';
    for(const family of ['Arial','Georgia','Slow','Broken'])select.add(new Option(family,family));
    root.append(select);document.body.append(root);
    const state=window.__fontFixture={changes:0,errors:[]};
    const slow=new Promise(resolve=>state.release=resolve);
    select.addEventListener('change',()=>state.changes++);
    state.picker=new FontPicker(select,{sample:()=>({text:'<b>Texto</b>'}),onError:message=>state.errors.push(message),
      loadFont:async family=>{if(family==='Slow')await slow;if(family==='Broken')throw new Error('Carga fallida de prueba');}});
  })()`);
  await open('#font-fixture-select'); await search('Slow');
  await click(`${popup} [data-font="Slow"]`);
  await key('Escape');
  await run('window.__fontFixture.release()'); await wait(200);
  ok(await run(`document.getElementById('font-fixture-select').value==='Arial' && window.__fontFixture.changes===0`),
    'cancelling a pending font load never applies a late selection');
  await open('#font-fixture-select'); await search('Broken');
  await click(`${popup} [data-font="Broken"]`);
  ok(await run(`window.__fontFixture.errors.length===1 && document.getElementById('font-fixture-select').value==='Arial'
    && document.querySelector('${popup} .font-picker-status').textContent.includes('Carga fallida')`),
    'a failed font load is reported without changing the current font');
  await key('Escape');
  await choose('#font-fixture-select', 'Georgia');
  ok(await run(`window.__fontFixture.changes===1
    && document.querySelector('#font-fixture .font-picker-trigger .font-picker-sample').textContent==='<b>Texto</b>'
    && !document.querySelector('#font-fixture .font-picker-trigger b')`),
    'selection recovers after failure, emits one change and displays text literally');
  await run("document.getElementById('font-fixture').remove()");
  ok(!errors.length, 'renderer errors: ' + (errors.join(' | ') || 'none'));
  console.log('[e2e] done');
};

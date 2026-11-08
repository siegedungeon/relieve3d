const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { unzipSync, strFromU8 } = require('fflate');

module.exports = async ({ win, run, shot, wait }) => {
  const out = process.env.E2E_DIR, exp = process.env.R3D_AUTOSAVE_DIR, errors = [];
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', e => { if ((e.level === 'error' || e.level >= 3) && !/WebGLProgram|disk_cache/.test(e.message)) errors.push(e.message); });
  const ok = (value, label) => { assert.ok(value, label); console.log('[e2e] ok', label); };
  const p = expression => run(`(async(t)=>(${expression}))(window.__r3d.nameTree)`);
  const idle = () => p('t.whenIdle()');
  const until = async predicate => {
    for (let i = 0; i < 1000; i++) { if (await predicate()) return; await wait(100); }
    throw new Error('Timed out waiting for the tree workflow');
  };
  const set = async (key, value) => {
    await run(`(()=>{const e=document.querySelector('#nameTree [data-k="${key}"]');e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await idle();
  };
  const names = async values => {
    await run(`(()=>{const e=document.getElementById('treeNames');e.value=${JSON.stringify(values.join('\n'))};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await idle();
  };
  const click = action => run(`document.querySelector('#nameTree [data-a="${action}"]').click()`);
  const view = async name => { await run(`document.querySelector('#nameTree [data-view="${name}"]').click()`); await wait(100); };
  const picture = async name => {
    win.setAlwaysOnTop(true);
    try { win.show(); win.focus(); win.webContents.invalidate(); await wait(350); await shot(path.join(out, name + '.png')); }
    finally { win.setAlwaysOnTop(false); }
  };
  win.setSize(1600, 1000); win.show(); win.focus();
  await run(`window.__r3d.showHome(); document.querySelector('#homeGrid3d [data-mod="nametree"]').click()`);
  await until(() => p('t.ready()'));
  ok(await p('!t.root.hidden && document.getElementById("home").hidden && t.res.parts.length===6'), 'home card opens the independent tree module with a complete default model');
  ok(await p(`t.cfg.order==="manual" && t.res.parts.filter(p=>p.role==="name").map(p=>p.name).join()==="DIEGO,MILDRED,VIOLETTA,CELESTE" &&
    t.res.plan.trunk.text===String(new Date().getFullYear()) && t.res.joints.every(j=>j.keys.length>0) &&
    t.res.plan.stability.frontBack>=8 && Math.abs(t.res.plan.stability.center[2])<0.01 &&
    t.res.parts.every(p=>Math.abs(p.bounds.min[2]+p.bounds.max[2])<0.01) && t.$("summary").textContent.includes("adelante/atrás")`),
  'default follows the reference: list from bottom to top, year trunk, hidden guides and a symmetric depth that stands upright');
  await view('front'); await picture('01_default_front');
  const list = ['Valentina', 'Sebastián', 'Mateo', 'Camila', 'Lucía', 'José', 'Ana'];
  for (const count of [2, 3, 7]) {
    await names(list.slice(0, count));
    ok(await p(`t.res.parts.length===${count + 2} && t.res.joints.length===${count + 1} &&
      t.res.plan.width<=t.cfg.maxWidth+0.001 && t.res.plan.height<=t.cfg.maxHeight+0.001`),
    `${count} names recalculate their sizes, trunk, topper and every interlock`);
  }
  for (const [key, value] of [['maxWidth', 200], ['maxHeight', 260], ['bottomDepth', 24], ['topDepth', 8], ['clearance', '0,25']]) await set(key, value);
  ok(await p('t.res.cfg.bottomDepth===24 && t.res.cfg.topDepth===8 && t.res.cfg.clearance===0.25'), 'dimensions and independent depth taper use the actual edited values');
  ok(await p('!t.$("warnings").hidden && t.$("warnings").textContent.includes("Poca estabilidad hacia delante/atrás")'), 'a thin base under a tall tree warns that it could tip over');
  const suggested = await p('t.res.plan.stability.suggestedBottomDepth');
  await set('bottomDepth', suggested);
  ok(await p(`t.res.cfg.bottomDepth===${suggested} && t.res.plan.stability.frontBack>=8 && t.$("warnings").hidden`), 'the suggested bottom depth makes the tree stable');
  await set('order', 'auto');
  ok(await p('t.res.parts.filter(p=>p.role==="name").map(p=>p.sourceIndex).some((v,i)=>v!==i)'), 'automatic order moves the longest names down');
  await set('order', 'manual');
  ok(await p('t.res.parts.filter(p=>p.role==="name").map(p=>p.sourceIndex).every((v,i)=>v===i)'), 'manual order follows the list from trunk to topper');
  await set('order', 'auto');
  await set('trunk', 'block');
  ok(await p(`t.res.plan.trunk.type==="block" && t.res.plan.trunk.text==="" && t.res.parts[0].role==="trunk" &&
    document.querySelector('#nameTree [data-k="trunkText"]').disabled`), 'a plain trunk has no text and disables its text field');
  await set('trunk', 'text');
  await set('trunkText', 'Familia');
  ok(await p(`t.res.plan.trunk.type==="text" && t.res.plan.trunk.text==="FAMILIA" &&
    !document.querySelector('#nameTree [data-k="trunkText"]').disabled`), 'the trunk carries the text typed by the user');
  for (const shape of ['heart', 'circle', 'star']) {
    await set('shape', shape);
    ok(await p(`t.res.cfg.shape===${JSON.stringify(shape)} && t.res.parts.at(-1).role==="top"`), `${shape} topper is a real separate encajable piece`);
  }
  await run(`(()=>{const e=document.querySelector('#nameTree [data-name-color="0"]');e.value='#1249ab';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await idle();
  ok(await p('t.res.parts.find(p=>p.sourceIndex===0).color==="#1249ab"'), 'each name can have its own filament color');
  for (const tab of ['assembled', 'front', 'side', 'exploded', 'plates']) {
    await view(tab);
    ok(await p(`t.view===${JSON.stringify(tab)} && t.viewer.meshes.size>0`), `${tab} view shows the corresponding assembled/print geometry`);
    if (['front', 'side', 'plates'].includes(tab)) await picture('02_' + tab);
  }
  const startTheme = await run('document.documentElement.dataset.theme');
  for (const theme of ['light', 'dark', startTheme]) {
    await run(`(()=>{const e=document.getElementById('themeSelect');e.value='${theme}';e.dispatchEvent(new Event('change'));})()`);
    ok(await p(`t.root.getBoundingClientRect().top>=34 &&
      [...t.root.querySelectorAll('.panel')].every(e=>e.scrollWidth<=e.clientWidth+1)`), `${theme} theme retains readable panels without horizontal clipping`);
  }
  const before = await p('JSON.stringify(t.res.plan)');
  await run(`(()=>{const e=document.querySelector('#nameTree [data-k="topDepth"]');e.value='60';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(() => p('!!t.error && !t.activeBuilds'));
  ok(await p(`!t.ready() && document.querySelector('#nameTree [data-a="export"]').disabled && t.error.includes("no puede superar") &&
    JSON.stringify(t.res.plan)===${JSON.stringify(before)}`), 'invalid dimensions keep the last preview but block stale exports with a useful error');
  await set('topDepth', 8);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill="black" d="M50 90 L10 45 Q-5 10 25 10 Q45 10 50 30 Q55 10 75 10 Q105 10 90 45Z"/></svg>';
  await run(`(()=>{const e=document.querySelector('#nameTree [data-r="fileShape"]'),dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(svg)}],'mi-remate.svg',{type:'image/svg+xml'}));e.files=dt.files;e.dispatchEvent(new Event('change'));})()`);
  await until(() => p('t.cfg.shape==="custom" && t.ready()'));
  ok(await p('t.cfg.custom.length>0 && t.res.parts.length===9'), 'custom silhouette upload creates a solid topper with its bottom socket');
  await view('front'); await picture('03_custom_topper');
  await click('save');
  await until(() => {
    try { const file = fs.readdirSync(exp).find(n => n.endsWith('.r3t')); return !!JSON.parse(fs.readFileSync(path.join(exp, file), 'utf8')).cfg; }
    catch { return false; }
  });
  const file = fs.readdirSync(exp).find(n => n.endsWith('.r3t')), project = fs.readFileSync(path.join(exp, file), 'utf8');
  await click('photo'); await click('assembly');
  await until(() => Promise.resolve(fs.readdirSync(exp).some(n => n.endsWith('.png')) && fs.readdirSync(exp).some(n => n.endsWith('.3mf'))));
  await click('reset'); await idle();
  ok(await p('t.cfg.names.length===4 && t.cfg.shape==="star" && t.cfg.order==="manual" && t.cfg.trunk==="text"'), 'reset restores the reference example');
  await run(`(async()=>{window.__r3d.showHome();await window.__r3d.openProjectFile(new File([${JSON.stringify(project)}],${JSON.stringify(file)}));})()`);
  ok(await p('!t.root.hidden && document.getElementById("home").hidden && t.cfg.names.length===7 && t.cfg.shape==="custom" && t.cfg.names[0].color==="#1249ab" && t.cfg.trunkText==="Familia"'),
    'global project opening restores names, custom outline, colors, trunk text, dimensions and module');
  const saved = await p('JSON.stringify(t.cfg)');
  ok(await p(`(async()=>{try{await t.openProject({app:'Relieve3D-ArbolNombres',version:99,cfg:{}});return false;}catch{return JSON.stringify(t.cfg)===${JSON.stringify(saved)}&&t.ready();}})()`),
    'invalid project does not overwrite the current design');
  await run(`window.__treeExport=window.__r3d.nameTree.exportAll(); true`);
  await until(() => p('t.busy'));
  await set('maxWidth', 140);
  const folder = await run('window.__treeExport');
  ok(!!folder && fs.existsSync(folder), 'native plate export completes while later edits remain independent');
  const exportedProject = JSON.parse(fs.readFileSync(path.join(folder, 'Proyecto.r3t'), 'utf8'));
  ok(exportedProject.cfg.maxWidth === 200 && await p('t.cfg.maxWidth===140'), 'export snapshots the selected design instead of mixing newer edits into its files');
  const files = fs.readdirSync(folder), plates = files.filter(n => /^Placa_.*\.3mf$/.test(n));
  ok(files.filter(n => n.endsWith('.stl')).length === 9 && plates.length >= 4 && files.includes('Montaje.txt') &&
    files.includes('Vista_armada_NO_IMPRIMIR.3mf'), 'delivery includes every part STL, color plate, assembly, instructions and editable project');
  const { read3MF } = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'src', 'core', 'threemf_read.js')));
  let count = 0;
  for (const plate of plates) {
    const data = fs.readFileSync(path.join(folder, plate)), zip = unzipSync(data);
    const model = read3MF(data); count += model.parts.length;
    const settings = JSON.parse(strFromU8(zip['Metadata/project_settings.config']));
    ok(settings.filament_colour.length === 1 && settings.enable_support === '0' && settings.enable_prime_tower === '0',
      `${plate}: native single-color A1 profile, no supports and no purge tower`);
    for (const part of model.parts) {
      const xs = part.V.filter((_, i) => i % 3 === 0), ys = part.V.filter((_, i) => i % 3 === 1), zs = part.V.filter((_, i) => i % 3 === 2);
      ok(Math.min(...xs) >= 5.99 && Math.max(...xs) <= 250.01 && Math.min(...ys) >= 5.99 && Math.max(...ys) <= 250.01 &&
        Math.abs(Math.min(...zs)) < 0.001, 'native resave retains the object on the bed inside its plate');
    }
  }
  ok(count === 9, 'native plates preserve exactly the nine independent pieces');
  await run(`window.__r3d.enterModule('phonestand')`);
  ok(await p('t.root.hidden'), 'another module closes the tree surface');
  await run(`window.__r3d.showHome(); window.__r3d.enterModule('nametree')`); await idle();
  ok(await p('t.cfg.maxWidth===140 && !t.root.hidden'), 'returning from Home preserves the latest tree edits');
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload(); });
  await wait(700);
  await run(`window.__r3d.enterModule('nametree')`); await idle();
  ok(await p('t.cfg.maxWidth===140 && t.cfg.names.length===7 && t.cfg.shape==="custom" && t.cfg.trunkText==="Familia"'), 'reloading the app restores the last valid tree without a project import');
  await view('assembled'); await picture('04_final');
  // Version 1.24 remembered its own design; only the names typed there carry over to the reference design.
  await run(`(()=>{localStorage.removeItem('relieve3d.nameTree.v2');localStorage.setItem('relieve3d.nameTree',JSON.stringify({app:'Relieve3D-ArbolNombres',version:1,
    cfg:{name:'Mi árbol',names:[{text:'Abuela'},{text:'Abuelo'}],order:'manual',font:'Montserrat Black',bottomDepth:18,topDepth:5,maxWidth:180}}));return true;})()`);
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload(); });
  await wait(700);
  await run(`window.__r3d.enterModule('nametree')`); await idle();
  ok(await p(`t.ready() && t.cfg.names.map(n=>n.text).join()==="Abuela,Abuelo" && t.cfg.order==="manual" && t.cfg.font==="Bebas Neue" &&
    t.cfg.bottomDepth===30 && t.cfg.topDepth===12 && t.cfg.maxWidth===160 && localStorage.getItem('relieve3d.nameTree')===null &&
    !!localStorage.getItem('relieve3d.nameTree.v2')`), 'names typed in version 1.24 carry over to the new reference design');
  ok(errors.length === 0, 'no renderer errors: ' + errors.join(' | '));
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ folder, plates, parts: count, complete: true }, null, 2));
  console.log('[e2e] done');
};

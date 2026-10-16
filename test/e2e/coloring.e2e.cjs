const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

module.exports = async ({ win, run, shot, wait }) => {
  const out = process.env.E2E_DIR, exp = process.env.R3D_AUTOSAVE_DIR, errors = [];
  win.webContents.on('console-message', e => {
    if ((e.level === 'error' || e.level >= 3) && !/disk_cache|WebGLProgram/.test(e.message)) errors.push(e.message);
  });
  const ok = (value, message) => { console.log('[e2e]', value ? 'ok  ' : 'FAIL', message); if (!value) throw new Error(message); };
  const read = async expression => JSON.parse(await run(`JSON.stringify(${expression})`));
  const capture = async name => { win.show(); win.focus(); await wait(300); await shot(path.join(out, name + '.png')); };
  const set = async (key, value) => run(`(()=>{
    const e=document.querySelector('#coloring [data-opt="${key}"]');
    e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  const sameMask = expression => run(`(()=>{const a=window.__r3d.coloring.mask,b=${expression};return a.length===b.length&&a.every((v,i)=>v===b[i]);})()`);
  const rectEmpty = () => run(`(()=>{
    const c=window.__r3d.coloring,W=c.base.width,H=c.base.height;
    for(let y=Math.ceil(H*0.04);y<Math.floor(H*0.29);y++)for(let x=Math.ceil(W*0.73);x<Math.floor(W*0.93);x++)if(c.mask[y*W+x])return false;
    return true;
  })()`);
  const drag = async (tool, a, b) => {
    await run(`document.querySelector('#coloring [data-tool="${tool}"]').click()`);
    const points = await read(`(()=>{
      const c=window.__r3d.coloring,r=c.canvas.getBoundingClientRect(),o=c.state.options;
      const k=Math.min((o.pageWidth-2*o.margin)/c.base.width,(o.pageHeight-2*o.margin)/c.base.height);
      const x=(o.pageWidth-c.base.width*k)/2,y=(o.pageHeight-c.base.height*k)/2;
      return ${JSON.stringify([a, b])}.map(p=>({x:Math.round(r.left+c.view.x+(x+p[0]*c.base.width*k)*c.view.scale),y:Math.round(r.top+c.view.y+(y+p[1]*c.base.height*k)*c.view.scale)}));
    })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...points[0] });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...points[0] });
    for (let i = 1; i <= 12; i++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(points[0].x + (points[1].x - points[0].x) * i / 12), y: Math.round(points[0].y + (points[1].y - points[0].y) * i / 12) });
      await wait(15);
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...points[1] });
    await wait(200);
  };
  win.setSize(1600, 1000);
  ok(await run(`!!document.querySelector('#homeGrid2d [data-mod="coloring"]')`), 'coloring module is available on the home screen');
  await run(`window.__r3d.enterModule('coloring')`);
  await wait(300);
  const input = fs.readFileSync(process.env.E2E_INPUT).toString('base64');
  ok(await run(`(async()=>{
    let ticks=0;const timer=setInterval(()=>ticks++,20);
    try {
      await window.__r3d.coloring.loadFile(new File([Uint8Array.from(atob('${input}'),c=>c.charCodeAt(0))],'Bosque.v1.svg',{type:'image/svg+xml'}));
      return window.__r3d.coloring.ready()&&ticks>2;
    } finally {clearInterval(timer);}
  })()`), 'actual image import converts in a worker while the UI remains responsive');
  await run(`document.querySelector('#coloring [data-a="original"]').click()`);
  await capture('coloring_01_original');
  await run(`document.querySelector('#coloring [data-a="original"]').click()`);
  await capture('coloring_02_contours');
  ok(await run(`window.__r3d.coloring.mask.every(v=>v===0||v===1)`), 'working artwork is pure black/white');
  ok(await run(`(async()=>{
    const c=window.__r3d.coloring;
    const old=JSON.stringify({app:'Relieve3D-Coloring',version:1,state:{...c.state,name:'Proyecto anterior'}});
    const file=new File([old],'anterior.r3c');let release;
    file.text=()=>new Promise(resolve=>{release=()=>resolve(old);});
    const pending=c.loadFile(file);
    await c.loadFile(new File([Uint8Array.from(atob('${input}'),v=>v.charCodeAt(0))],'Bosque.v1.svg',{type:'image/svg+xml'}));
    release();await pending;
    return c.ready()&&c.state.name==='Bosque.v1';
  })()`), 'a delayed project read cannot replace a newer image import');
  ok(await run(`(async()=>{
    const app=window.__r3d,c=app.coloring;
    const data=JSON.stringify({app:'Relieve3D-Coloring',version:1,state:c.state});
    const file=new File([data],'cancelado.r3c');let release;
    file.text=()=>new Promise(resolve=>{release=()=>resolve(data);});
    const opening=app.openProjectFile(file);
    app.showHome();await app.enterModule('logoprep');
    release();await opening;
    return !document.getElementById('studio').hidden&&document.getElementById('coloring').hidden;
  })()`), 'leaving during global project loading cannot reopen the coloring module');
  await run(`(async()=>{window.__r3d.showHome();await window.__r3d.enterModule('coloring');})()`);

  await set('lineWidth', 0.65);
  ok(await run(`window.__r3d.coloring.stale&&document.querySelector('#coloring [data-export="svg"]').disabled`), 'pending parameters disable stale exports');
  ok(await run(`(async()=>{try{await window.__r3d.coloring.export('svg');return false;}catch(e){return /Generar/.test(e.message);}})()`), 'direct export also rejects stale artwork');
  ok(await run('window.__r3d.coloring.generate()'), 'new parameters regenerate successfully');
  const expectedErrorStart = errors.length;
  await set('lineWidth', 'no');
  ok(await run(`!window.__r3d.coloring.ready()&&document.querySelector('#coloring [data-opt="lineWidth"]').getAttribute('aria-invalid')==='true'`), 'invalid fields block export and are visibly marked');
  await run('window.__r3d.coloring.undo()');
  ok(await run(`window.__r3d.coloring.ready()&&!document.querySelector('#coloring [data-opt="lineWidth"]').hasAttribute('aria-invalid')`), 'undo clears both invalid values and their error markers');
  await run('window.__r3d.coloring.redo()');
  ok(await run('window.__r3d.coloring.ready()&&window.__r3d.coloring.state.options.lineWidth===0.65'), 'redo recovers the valid parameter after invalid input');
  const expectedErrors = errors.splice(expectedErrorStart);
  ok(expectedErrors.length === 1 && /Grosor de línea/.test(expectedErrors[0]), 'invalid input reports its specific error');
  await run('window.__coloringBefore=window.__r3d.coloring.mask.slice()');
  await drag('rect', [0.71, 0.025], [0.95, 0.31]);
  ok(await rectEmpty(), 'dragging a rectangle removes an entire unwanted element');
  ok(await run('window.__r3d.coloring.state.edits.length===1'), 'rectangle gesture creates one undoable edit');
  await run('window.__coloringRect=window.__r3d.coloring.mask.slice()');
  await drag('erase', [0.27, 0.463], [0.56, 0.463]);
  ok(!(await sameMask('window.__coloringRect')), 'eraser removes selected lines');
  await run('window.__coloringErased=window.__r3d.coloring.mask.slice()');
  await run('window.__r3d.coloring.undo()');
  ok(await sameMask('window.__coloringRect'), 'undo restores the erased lines exactly');
  await run('window.__r3d.coloring.redo()');
  ok(await sameMask('window.__coloringErased'), 'redo restores the edited artwork exactly');
  const beforeDraw = await run('window.__r3d.coloring.pixels');
  await drag('draw', [0.10, 0.965], [0.28, 0.965]);
  ok(await run(`window.__r3d.coloring.pixels>${beforeDraw}`), 'black pen can close or add a line');
  await capture('coloring_03_edited');
  await set('minDetail', 0.6);
  await run('window.__r3d.coloring.generate()');
  ok(await rectEmpty(), 'manual removals survive changing automatic cleanup');
  ok(await run('window.__r3d.coloring.state.edits.length===3'), 'automatic cleanup does not discard edits');
  await run('window.__coloringSaved=window.__r3d.coloring.mask.slice()');
  await run('window.__r3d.coloring.saveProject()');
  const projectPath = path.join(exp, 'Bosque.v1.r3c');
  ok(fs.existsSync(projectPath), 'editable coloring project is saved');
  const project = fs.readFileSync(projectPath, 'utf8');
  await run('window.__r3d.showHome()');
  await run(`window.__r3d.openProjectFile(new File([${JSON.stringify(project)}],'Bosque.v1.r3c'))`);
  ok(await run(`!document.getElementById('coloring').hidden&&window.__r3d.coloring.state.name==='Bosque.v1'`), 'global project opening restores the module and filename');
  ok(await sameMask('window.__coloringSaved'), 'save/reopen reproduces the exact edited contours');
  ok(await run(`(async()=>{
    const c=window.__r3d.coloring;
    try{await c.openProject({app:'Relieve3D-Coloring',version:99,state:{}});return false;}
    catch(e){return c.ready()&&c.state.edits.length===3;}
  })()`), 'invalid projects leave the current drawing intact');
  ok(await run(`(async()=>{
    const c=window.__r3d.coloring,first=c.generate();
    c.setOptions({lineWidth:0.85});const latest=await c.generate();
    return !(await first)&&latest&&c.ready()&&c.state.options.lineWidth===0.85;
  })()`), 'obsolete worker jobs are cancelled and cannot replace newer results');
  ok(await rectEmpty(), 'cancel/recompute also preserves manual removals');
  await run(`(async()=>{
    const c=window.__r3d.coloring,pending=c.export('svg');
    c.setOptions({pageWidth:148});await pending;
  })()`);
  const snapshotSVG = fs.readFileSync(path.join(exp, 'Bosque.v1.svg'), 'utf8');
  ok(snapshotSVG.includes('width="210mm"'), 'export takes a consistent snapshot before later parameter changes');
  await run('window.__r3d.coloring.undo()');
  for (const kind of ['png', 'svg', 'pdf']) await run(`window.__r3d.coloring.export('${kind}')`);
  const pngBytes = fs.readFileSync(path.join(exp, 'Bosque.v1.png')), png = PNG.sync.read(pngBytes);
  ok(png.width === 2480 && png.height === 3508, 'PNG is an A4 page at 300 ppp');
  let black = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const v = png.data[i];
    if ((v !== 0 && v !== 255) || png.data[i + 1] !== v || png.data[i + 2] !== v || png.data[i + 3] !== 255) throw new Error('PNG contains colour, gray or transparency');
    if (!v) black++;
  }
  ok(black > 10000 && black < png.width * png.height / 3, 'PNG has solid black outlines on opaque white, not filled colours');
  const pixelAtArtwork = (x, y) => {
    const mmX = 10 + x / 800 * 190, mmY = (297 - 142.5) / 2 + y / 600 * 142.5;
    return png.data[(Math.round(mmY * 300 / 25.4) * png.width + Math.round(mmX * 300 / 25.4)) * 4];
  };
  ok(pixelAtArtwork(397, 324) === 255 && pixelAtArtwork(335, 205) === 255, 'nested window panes and roof details remain white in the exported artwork');
  let phys = 0;
  for (let i = 8; i < pngBytes.length; i += pngBytes.readUInt32BE(i) + 12) {
    if (pngBytes.toString('ascii', i + 4, i + 8) === 'pHYs') { ok(pngBytes.readUInt32BE(i + 8) === 11811, 'PNG stores its physical 300 ppp resolution'); phys++; }
  }
  ok(phys === 1, 'exactly one PNG resolution record');
  const svg = fs.readFileSync(path.join(exp, 'Bosque.v1.svg'), 'utf8');
  ok(svg.includes('width="210mm"') && svg.includes('height="297mm"') && !svg.includes('<image'), 'SVG preserves physical paper size and vector paths');
  ok([...svg.matchAll(/fill="([^"]+)"/g)].every(m => ['#FFFFFF', '#000000'].includes(m[1])), 'SVG uses only black and white');
  const pdf = fs.readFileSync(path.join(exp, 'Bosque.v1.pdf'), 'ascii');
  ok(pdf.startsWith('%PDF-1.4') && pdf.includes('/Count 1') && pdf.includes('/MediaBox [0 0 595.2756 841.8898]'), 'PDF is a single vector A4 page');
  ok(await run(`(async()=>{
    const c=window.__r3d.coloring,job=c.generate();window.__r3d.showHome();
    return !(await job)&&!c.worker&&document.getElementById('coloring').hidden;
  })()`), 'leaving the module terminates pending conversion cleanly');
  await run(`window.__r3d.enterModule('logo')`);
  ok(await run(`document.getElementById('coloring').hidden&&document.getElementById('home').hidden`), '3D workspace is not covered by the new module');
  await run(`window.__r3d.showHome();window.__r3d.enterModule('logoprep')`);
  ok(await run(`!document.getElementById('studio').hidden&&document.getElementById('coloring').hidden`), 'existing 2D editor remains accessible');
  await run(`window.__r3d.showHome();window.__r3d.enterModule('coloring')`);
  for (let i = 0; i < 600 && !(await run('window.__r3d.coloring.ready()')); i++) await wait(100);
  ok(await run('window.__r3d.coloring.ready()'), 'coloring workspace can be resumed after visiting other modules');
  await capture('coloring_04_final');
  ok(errors.length === 0, 'renderer errors: ' + (errors.join(' | ') || 'none'));
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ exports: ['png', 'svg', 'pdf', 'r3c'], width: png.width, height: png.height, blackPixels: black, manualEdits: 3 }, null, 2));
  console.log('[e2e] done');
};

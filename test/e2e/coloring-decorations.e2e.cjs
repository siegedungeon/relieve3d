const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

module.exports = async ({ win, run, shot, wait }) => {
  const out = process.env.E2E_DIR, exp = process.env.R3D_AUTOSAVE_DIR, errors = [];
  win.webContents.on('console-message', e => { if ((e.level === 'error' || e.level >= 3) && !/disk_cache|WebGLProgram/.test(e.message)) errors.push(e.message); });
  const ok = (value, label) => { console.log('[e2e]', value ? 'ok' : 'FAIL', label); if (!value) throw new Error(label); };
  const ready = async () => {
    for (let i = 0; i < 600; i++) { if (await run('window.__r3d.coloring.ready()')) return; await wait(50); }
    throw new Error('The decorated coloring page did not become ready');
  };
  const set = async (key, value) => {
    await run(`(()=>{const e=document.querySelector('#coloring [data-opt="${key}"]');e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await ready();
  };
  const toggle = async () => { await run(`document.querySelector('#coloring [data-opt="decorate"]').click()`); await ready(); };
  const gesture = async (a, b) => {
    const points = await run(`(()=>{
      const c=window.__r3d.coloring,r=c.canvas.getBoundingClientRect();
      return ${JSON.stringify([a, b])}.map(p=>({x:Math.round(r.left+c.view.x+p[0]*c.view.scale),y:Math.round(r.top+c.view.y+p[1]*c.view.scale)}));
    })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...points[0] });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...points[0] });
    for (let i = 1; i <= 10; i++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(points[0].x + (points[1].x - points[0].x) * i / 10), y: Math.round(points[0].y + (points[1].y - points[0].y) * i / 10) });
      await wait(15);
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...points[1] });
    await wait(50); await ready();
  };
  win.setSize(1600, 1000); await run(`window.__r3d.enterModule('coloring')`); await wait(200);
  const input = fs.readFileSync(process.env.E2E_INPUT).toString('base64');
  const mime = /\.jpe?g$/i.test(process.env.E2E_INPUT) ? 'image/jpeg' : /\.png$/i.test(process.env.E2E_INPUT) ? 'image/png' : 'image/svg+xml';
  await run(`window.__r3d.coloring.loadFile(new File([Uint8Array.from(atob('${input}'),c=>c.charCodeAt(0))],'Bosque_adornos.svg',{type:'${mime}'}))`);
  await ready();
  ok(await run('!window.__r3d.coloring.state.options.decorate&&!window.__r3d.coloring.decorationScene.length'), 'new images start without any automatic decoration');
  await run('window.__plainColoringMask=window.__r3d.coloring.mask.slice()');
  await toggle();
  ok(await run('window.__r3d.coloring.state.options.decorate&&window.__r3d.coloring.state.decorations.items.length>=6'), 'the real checkbox explicitly enables a thematic composition');
  ok(await run('window.__plainColoringMask.every((v,i)=>!v||window.__r3d.coloring.mask[i])'), 'making room for ornaments preserves the original source details');
  await run('window.__firstDecor=JSON.stringify(window.__r3d.coloring.state.decorations)');
  await run(`document.querySelector('#coloring [data-a="surprise"]').click()`); await ready();
  ok(await run('JSON.stringify(window.__r3d.coloring.state.decorations)!==window.__firstDecor'), 'Surprise creates another composition, not the same template');
  await run('window.__r3d.coloring.undo()');
  ok(await run('JSON.stringify(window.__r3d.coloring.state.decorations)===window.__firstDecor'), 'one undo restores the preceding surprise exactly');
  await run('window.__r3d.coloring.redo()');
  ok(await run('JSON.stringify(window.__r3d.coloring.state.decorations)!==window.__firstDecor'), 'redo restores the new surprise');
  await run('window.__r3d.coloring.undo()');
  const automaticCount = await run('window.__r3d.coloring.state.decorations.items.length');
  await run(`document.querySelector('#coloring details').open=true;document.querySelector('#coloring [data-decor-kind="star"]').click()`);
  await gesture([30, 40], [30, 40]);
  ok(await run(`window.__r3d.coloring.state.decorations.items.length===${automaticCount + 1}&&window.__r3d.coloring.selectedItem().kind==='star'`), 'a library resource can be placed by a real canvas click');
  const manualId = await run('window.__r3d.coloring.selectedDecoration');
  for (const [key, value] of [['decor-size', '15'], ['decor-angle', '37']]) await run(`(()=>{const e=document.querySelector('#coloring [data-r="${key}"]');e.value='${value}';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  ok(await run('Math.abs(window.__r3d.coloring.selectedItem().size*window.__r3d.coloring.decorUnit()-15)<0.001&&window.__r3d.coloring.selectedItem().angle===37'), 'manual ornaments have editable physical size and rotation');
  ok(await run(`(()=>{const p=document.querySelector('#coloring .panel.right');return p.scrollWidth<=p.clientWidth+1;})()`), 'themes, catalog and selected-resource controls fit the sidebar without horizontal overflow');
  await gesture([30, 40], [51, 54]);
  ok(await run('window.__r3d.coloring.selectedItem().x>0.2'), 'a real pointer drag moves the selected ornament');
  await run('window.__manualDecor=JSON.stringify(window.__r3d.coloring.state.decorations)');
  const anchor = await run(`(()=>{
    const c=window.__r3d.coloring,r=c.canvas.getBoundingClientRect();
    window.__beforeCancelledDecor=JSON.stringify(c.decorationScene);
    return {x:Math.round(r.left+c.view.x+51*c.view.scale),y:Math.round(r.top+c.view.y+54*c.view.scale)};
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...anchor });
  win.webContents.sendInputEvent({ type: 'mouseMove', x: anchor.x + 35, y: anchor.y + 20 });
  await wait(80);
  ok(await run('!!window.__r3d.coloring.drag?.decoration&&JSON.stringify(window.__r3d.coloring.decorationScene)!==window.__beforeCancelledDecor'), 'dragging previews a movement before committing it');
  await run(`(async()=>{window.__r3d.showHome();await window.__r3d.enterModule('coloring');})()`);
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: anchor.x + 35, y: anchor.y + 20 });
  ok(await run('JSON.stringify(window.__r3d.coloring.state.decorations)===window.__manualDecor&&JSON.stringify(window.__r3d.coloring.decorationScene)===window.__beforeCancelledDecor'), 'leaving during a drag cancels the preview without leaving ghost positions in exports');
  await run(`document.querySelector('#coloring [data-a="decor-remove"]').click()`);
  ok(await run(`window.__r3d.coloring.state.decorations.items.length===${automaticCount}`), 'an unwanted ornament can be removed independently');
  await run('window.__r3d.coloring.undo()');
  ok(await run('JSON.stringify(window.__r3d.coloring.state.decorations)===window.__manualDecor'), 'undo restores the moved, resized and rotated ornament');
  await toggle();
  ok(await run('!window.__r3d.coloring.decorationScene.length&&window.__r3d.coloring.mask.every((v,i)=>v===window.__plainColoringMask[i])'), 'turning decorations off restores the original undecorated image exactly');
  await run(`window.__r3d.coloring.export('svg')`);
  ok(!fs.readFileSync(path.join(exp, 'Bosque_adornos.svg'), 'utf8').includes('data-decoration='), 'disabled ornaments cannot leak into an export');
  await toggle();
  ok(await run('JSON.stringify(window.__r3d.coloring.state.decorations)===window.__manualDecor'), 're-enabling keeps the customized composition instead of randomizing it');
  await set('decorTheme', 'space');
  ok(await run(`window.__r3d.coloring.state.decorations.items.some(p=>p.kind==='planet')`), 'the space theme changes resources through its real control');
  await run('window.__r3d.coloring.undo()');
  ok(await run('JSON.stringify(window.__r3d.coloring.state.decorations)===window.__manualDecor'), 'undoing a theme change recovers manual adjustments too');
  await set('decorCount', 8);
  ok(await run('window.__r3d.coloring.state.decorations.items.length===8'), 'the requested density updates the composition');
  await run('window.__r3d.coloring.undo()');
  await run('window.__beforeDecorPen=window.__r3d.coloring.mask.slice()');
  await run(`document.querySelector('#coloring [data-tool="draw"]').click()`);
  await gesture([90, 187], [115, 187]);
  ok(await run('window.__r3d.coloring.state.edits.length===1&&JSON.stringify(window.__r3d.coloring.state.decorations)===window.__manualDecor'), 'drawing edits do not flatten or change the ornament layer');
  await run('window.__r3d.coloring.undo()');
  ok(await run('window.__r3d.coloring.mask.every((v,i)=>v===window.__beforeDecorPen[i])'), 'undo restores the original drawing without moving its decorations');
  const corners = await run(`(async()=>{
    const c=window.__r3d.coloring,{coloringLayout}=await import('./core/coloring.js');
    const l=coloringLayout(c.base.width,c.base.height,c.state.options);
    document.querySelector('#coloring [data-tool="rect"]').click();
    return [[l.x+l.width*.001,l.y+l.height*.001],[l.x+l.width*.999,l.y+l.height*.999]];
  })()`);
  await gesture(...corners);
  ok(await run('window.__r3d.coloring.pixels===0&&window.__r3d.coloring.hasArtwork()&&!document.querySelector(\'#coloring [data-export="svg"]\').disabled'), 'the ornament layer remains valid artwork when the original drawing is erased');
  await run(`window.__r3d.coloring.export('svg')`);
  ok(fs.readFileSync(path.join(exp, 'Bosque_adornos.svg'), 'utf8').includes('data-decoration='), 'an ornament-only page can actually be exported');
  await toggle();
  ok(await run(`(async()=>{try{await window.__r3d.coloring.export('svg');return false;}catch(e){return /vacía/.test(e.message);}})()`), 'a page with neither drawing nor enabled ornaments still rejects export');
  await run('window.__r3d.coloring.undo()');
  await run('window.__r3d.coloring.undo()');
  ok(await run('window.__r3d.coloring.mask.every((v,i)=>v===window.__beforeDecorPen[i])&&JSON.stringify(window.__r3d.coloring.state.decorations)===window.__manualDecor'), 'undo restores both independent layers after clearing and hiding them');
  await run('window.__beforeRotateDecor=JSON.stringify(window.__r3d.coloring.state.decorations)');
  ok(await run(`(async()=>{
    const c=window.__r3d.coloring;c.setOptions({pageWidth:297,pageHeight:210});await c.generate();
    return c.decorationScene.every(p=>p.bounds.x0>=10-1e-6&&p.bounds.y0>=10-1e-6&&p.bounds.x1<=287+1e-6&&p.bounds.y1<=200+1e-6);
  })()`), 'changing paper orientation keeps customized ornaments inside the print margins');
  await run('window.__r3d.coloring.undo()');
  ok(await run('JSON.stringify(window.__r3d.coloring.state.decorations)===window.__beforeRotateDecor'), 'undoing a paper change restores the exact ornament placement');
  await run('window.__savedDecorScene=JSON.stringify(window.__r3d.coloring.decorationScene)');
  await run('window.__r3d.coloring.saveProject()');
  const projectPath = path.join(exp, 'Bosque_adornos.r3c'), project = fs.readFileSync(projectPath, 'utf8');
  ok(JSON.parse(project).version === 2, 'decorated projects use a version that older apps reject instead of silently losing resources');
  await run(`(async()=>{window.__r3d.showHome();await window.__r3d.openProjectFile(new File([${JSON.stringify(project)}],'Bosque_adornos.r3c'));})()`);
  ok(await run('window.__r3d.coloring.ready()&&JSON.stringify(window.__r3d.coloring.decorationScene)===window.__savedDecorScene'), 'global project reopening reproduces exactly the saved vector composition');
  ok(await run(`(async()=>{
    const c=window.__r3d.coloring,bad=JSON.parse(${JSON.stringify(project)});bad.state.decorations.items[0].kind='unknown';
    try{await c.openProject(bad);return false;}catch(e){return c.ready()&&JSON.stringify(c.decorationScene)===window.__savedDecorScene;}
  })()`), 'invalid resource data cannot overwrite the current drawing');
  await run(`(async()=>{
    const c=window.__r3d.coloring,pending=c.export('svg');c.selectedDecoration=${manualId};c.removeDecoration();await pending;
  })()`);
  ok((fs.readFileSync(path.join(exp, 'Bosque_adornos.svg'), 'utf8').match(/data-decoration=/g) || []).length === automaticCount + 1, 'export snapshots ornaments before later deletions');
  await run('window.__r3d.coloring.undo()');
  await run(`document.querySelector('#coloring [data-tool="pan"]').click()`);
  for (const kind of ['png', 'svg', 'pdf']) await run(`window.__r3d.coloring.export('${kind}')`);
  const pngBytes = fs.readFileSync(path.join(exp, 'Bosque_adornos.png')), png = PNG.sync.read(pngBytes);
  ok(png.width === 2480 && png.height === 3508, 'the decorated PNG is A4 at 300 ppp');
  for (let i = 0; i < png.data.length; i += 4) {
    const v = png.data[i];
    if ((v !== 0 && v !== 255) || png.data[i + 1] !== v || png.data[i + 2] !== v || png.data[i + 3] !== 255) throw new Error('Decorated PNG is not opaque pure black/white');
  }
  const comparison = await run(`(async()=>{
    const c=window.__r3d.coloring,image=new Image();image.src='data:image/png;base64,${pngBytes.toString('base64')}';await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const target=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const saved={view:c.view,width:c.canvas.width,height:c.canvas.height};
    try{
      c.canvas.width=canvas.width;c.canvas.height=canvas.height;c.view={x:0,y:0,scale:canvas.width/c.state.options.pageWidth/devicePixelRatio};c.draw();
      const actual=c.ctx.getImageData(0,0,canvas.width,canvas.height).data;let diff=0;
      for(let i=0;i<actual.length;i+=4)if((actual[i+3]<128||actual[i]>=128?255:0)!==target[i])diff++;
      return diff/(actual.length/4);
    }finally{c.canvas.width=saved.width;c.canvas.height=saved.height;c.view=saved.view;c.draw();}
  })()`);
  ok(comparison < 0.003, 'ornaments use matching geometry in the actual canvas and PNG export');
  const protection = await run(`(async()=>{
    const c=window.__r3d.coloring,{coloringSVG,coloringLayout}=await import('./core/coloring.js');
    const o=c.state.options,l=coloringLayout(c.base.width,c.base.height,o),base=new Image(),full=new Image();
    base.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(coloringSVG(c.shapes,c.base.width,c.base.height,o));
    full.src='data:image/png;base64,${pngBytes.toString('base64')}';await Promise.all([base.decode(),full.decode()]);
    const canvas=document.createElement('canvas');canvas.width=full.naturalWidth;canvas.height=full.naturalHeight;
    const ctx=canvas.getContext('2d');ctx.drawImage(base,0,0,canvas.width,canvas.height);
    const original=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(full,0,0);const decorated=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let checked=0,changed=0;
    for(let y=0;y<c.base.height;y+=4){
      let left=c.base.width,right=-1;
      for(let x=0;x<c.base.width;x++)if(c.base.mask[y*c.base.width+x]){left=Math.min(left,x);right=x;}
      for(let x=left;x<=right;x+=4){
        const px=Math.floor((l.x+(x+.5)*l.scale)/o.pageWidth*canvas.width),py=Math.floor((l.y+(y+.5)*l.scale)/o.pageHeight*canvas.height);
        const i=(py*canvas.width+px)*4;checked++;if((original[i]>=128?255:0)!==decorated[i])changed++;
      }
    }
    return {checked,changed};
  })()`);
  ok(protection.checked > 10000 && protection.changed === 0, 'rendered ornaments do not cover characters or the protected white interiors');
  const svg = fs.readFileSync(path.join(exp, 'Bosque_adornos.svg'), 'utf8'), pdf = fs.readFileSync(path.join(exp, 'Bosque_adornos.pdf'), 'ascii');
  ok((svg.match(/data-decoration=/g) || []).length === automaticCount + 1 && !svg.includes('<image'), 'SVG exports all ornaments as editable vector paths');
  ok(pdf.includes('1 J 1 j') && pdf.includes(' B\n') && pdf.includes('/Count 1'), 'PDF includes the rounded black strokes and white interiors');
  const legacy = JSON.parse(project); legacy.version = 1;
  delete legacy.state.decorations; delete legacy.state.options.decorate; delete legacy.state.options.decorTheme; delete legacy.state.options.decorCount;
  await run(`window.__r3d.coloring.openProject(${JSON.stringify(legacy)})`);
  ok(await run('!window.__r3d.coloring.state.options.decorate&&!window.__r3d.coloring.decorationScene.length'), 'old projects remain undecorated');
  await run(`window.__r3d.openProjectFile(new File([${JSON.stringify(project)}],'Bosque_adornos.r3c'))`);
  await run(`window.__r3d.coloring.loadFile(new File([Uint8Array.from(atob('${input}'),c=>c.charCodeAt(0))],'Nueva_imagen.svg',{type:'${mime}'}))`);
  ok(await run('window.__r3d.coloring.ready()&&!window.__r3d.coloring.state.options.decorate&&!window.__r3d.coloring.decorationScene.length'), 'a different image requires its own explicit opt-in');
  await run(`window.__r3d.openProjectFile(new File([${JSON.stringify(project)}],'Bosque_adornos.r3c'))`);
  await run(`document.querySelector('#coloring details').open=false;window.__r3d.coloring.fit()`);
  win.show(); win.focus(); await wait(400); await shot(path.join(out, 'decorations_final.png'));
  ok(errors.length === 0, 'renderer errors: ' + (errors.join(' | ') || 'none'));
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ornaments: automaticCount + 1, previewDifference: comparison, protection, exports: ['r3c', 'png', 'svg', 'pdf'] }, null, 2));
  console.log('[e2e] done');
};

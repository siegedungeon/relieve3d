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
  ipcMain.removeHandler('confirm');
  ipcMain.handle('confirm', () => 1);
  win.webContents.setBackgroundThrottling(false);
  win.setSize(1600, 1000);
  win.show(); win.focus();
  await run(`window.__r3d.enterModule('keychain')`);
  const accuracy = await run(`(async()=>{
    const {S,applyText}=window.__r3d;
    const {DEFAULT_TEXT}=await import('./core/text.js');
    const {edt,maskBBox}=await import('./core/raster.js');
    S.source='text'; S.settings.widthMM=50;
    S.text={...DEFAULT_TEXT(),text:'O',font:'Titan One',weight:400,outline:false};
    await applyText();
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
    const setup=()=>{ctx.font='400 2048px "Titan One"';ctx.textBaseline='alphabetic';};
    setup(); const m=ctx.measureText('O');
    canvas.width=Math.ceil(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)+32;
    canvas.height=Math.ceil(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)+32;
    setup();ctx.fillText('O',16+m.actualBoundingBoxLeft,16+m.actualBoundingBoxAscent);
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const mask=Uint8Array.from({length:canvas.width*canvas.height},(_,i)=>data[i*4+3]>=128?1:0);
    const inside=edt(Uint8Array.from(mask,v=>1-v),canvas.width,canvas.height);
    const outside=edt(mask,canvas.width,canvas.height);
    const ref=maskBBox(mask,canvas.width,canvas.height),b=S.result.fgBBox;
    const ratio=(ref[2]-ref[0])/(b[2]-b[0]),mm=50/(ref[2]-ref[0]),errors=[];
    for(const piece of S.result.pieces)for(const shape of piece.shapes)for(const loop of [shape.outer,...shape.holes]){
      for(let i=0;i<loop.length;i++){
        const a=loop[i],z=loop[(i+1)%loop.length];
        for(const t of [0,0.25,0.5,0.75]){
          const x=Math.floor(ref[0]+(a[0]+(z[0]-a[0])*t-b[0])*ratio);
          const y=Math.floor(ref[1]+(a[1]+(z[1]-a[1])*t-b[1])*ratio);
          const j=y*canvas.width+x;
          errors.push(Math.max(0,(mask[j]?inside[j]:outside[j])-0.5)*mm);
        }
      }
    }
    errors.sort((a,b)=>a-b);
    return {max:errors.at(-1),p95:errors[Math.floor(errors.length*0.95)],
      holes:S.result.pieces.flatMap(p=>p.shapes).reduce((n,s)=>n+s.holes.length,0)};
  })()`);
  console.log('[e2e] contour deviation from native font (mm)', JSON.stringify(accuracy));
  ok(accuracy.max < 0.08 && accuracy.p95 < 0.04, 'curves follow the native font within 0.08 mm, including between vertices');
  ok(accuracy.holes === 1, 'the intentional O counter remains open');

  const families = await run(`['Pacifico',...([...document.querySelector('#txtFont').options].some(o=>o.value==='Love Mama')?['Love Mama']:[])]`);
  for (const family of families) {
    const result = await run(`(async()=>{
      const {S,applyText,exportParts}=window.__r3d;
      const {DEFAULT_TEXT}=await import('./core/text.js');
      const {components,fillHoles}=await import('./core/raster.js');
      S.text={...DEFAULT_TEXT(),text:${JSON.stringify(family === 'Pacifico' ? 'i' : 'Aminta')},font:${JSON.stringify(family)}};
      await applyText();
      const r=S.result,fg=Uint8Array.from(r.comp,v=>v>=0?1:0),filled=fillHoles(fg,r.width,r.height);
      const holes=components(Uint8Array.from(fg,(v,i)=>filled[i]&&!v?1:0),r.width,r.height,false).comps;
      let badEdges=0;
      const parts=exportParts();
      for(const part of parts){
        const idx=part.geometry.index.array,edges=new Map();
        for(let i=0;i<idx.length;i+=3)for(let k=0;k<3;k++){
          const a=idx[i+k],b=idx[i+(k+1)%3],key=a<b?a+'_'+b:b+'_'+a;
          edges.set(key,(edges.get(key)||0)+1);
        }
        for(const count of edges.values())if(count!==2)badEdges++;
        part.geometry.dispose();
      }
      return {holes:holes.length,badEdges,parts:parts.length,
        baseHoles:window.__r3d.getFeat().layers.filter(l=>l.key==='base').flatMap(l=>l.shapes).reduce((n,s)=>n+s.holes.length,0)};
    })()`);
    console.log('[e2e] outline topology', family, JSON.stringify(result));
    ok(result.holes === 0, family + ': the colored outline has no accidental pinholes');
    ok(result.parts >= 3 && result.badEdges === 0, family + ': every exported mesh is closed');
    ok(result.baseHoles === 1, family + ': only the intentional keyring hole passes through the base');
  }
  if (process.env.E2E_INPUT) {
    const original = JSON.parse(fs.readFileSync(process.env.E2E_INPUT, 'utf8'));
    ok(original.app === 'Relieve3D' && original.state.source === 'text', 'the supplied reproduction is an editable text project');
    await run(`window.__r3d.openProjectFile(new File([${JSON.stringify(JSON.stringify(original))}],'original.r3d'))`);
    await run('window.__r3d.applyText()');
    ok(await run(`JSON.stringify(window.__r3d.S.text)===${JSON.stringify(JSON.stringify(original.state.text))}
      && JSON.stringify(window.__r3d.S.settings)===${JSON.stringify(JSON.stringify(original.state.settings))}`),
      'regenerating the original project preserves its lettering, colors, dimensions and accessory settings');
  }
  await run('window.__qualityShapes=JSON.stringify(window.__r3d.S.result.pieces)');
  await run(`window.__r3d.saveProject()`);
  const projectName = fs.readdirSync(exports).find(file => file.endsWith('.r3d'));
  const project = fs.readFileSync(path.join(exports, projectName), 'utf8');
  await run(`window.__r3d.openProjectFile(new File([${JSON.stringify(project)}],'saved.r3d'))`);
  ok(await run(`window.__r3d.S.text.text===${JSON.stringify(JSON.parse(project).state.text.text)} && window.__r3d.S.settings.widthMM===50`), 'reopening preserves the editable design and its size');
  ok(await run('JSON.stringify(window.__r3d.S.result.pieces)===window.__qualityShapes'), 'reopening preserves the corrected geometry exactly');
  for (const kind of ['3mf', 'stl-one', 'svg']) await run(`window.__r3d.doExport('${kind}')`);
  ok(['.3mf', '.stl', '.svg'].every(ext => fs.readdirSync(exports).some(file => file.endsWith(ext) && fs.statSync(path.join(exports, file)).size > 1000)),
    'the corrected keychain saves and exports actual 3MF, STL and SVG files');
  win.show(); win.focus(); await wait(300);
  await shot(path.join(dir, 'text_quality_keychain.png'));
  ok(errors.length === 0, 'renderer errors: ' + (errors.join(' | ') || 'none'));
  console.log('[e2e] done');
};

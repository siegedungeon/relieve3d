const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
module.exports = async ({ win, run, shot, wait }) => {
  const D = process.env.E2E_DIR, exp = process.env.R3D_AUTOSAVE_DIR;
  const errs = [];
  win.webContents.on('console-message', e => {
    if ((e.level === 'error' || e.level >= 3) && !/WebGLProgram|disk_cache|canal necesita|Aumenta el ancho/.test(e.message)) errs.push(e.message);
  });
  const log = (...args) => console.log('[e2e]', ...args);
  const ok = (c, m) => { log(c ? 'ok  ' : 'FAIL', m); if (!c) throw new Error(m); };
  const read = async expr => JSON.parse(await run(`JSON.stringify(${expr})`));
  const decorationHeight = () => run(`(()=>{
    const {S}=window.__r3d, b=S.result.fgBBox;
    const p=S.result.pieces.reduce((a,p)=>p.bbox[2]>a.bbox[2]?p:a);
    return (p.bbox[3]-p.bbox[1])*S.settings.widthMM/(b[2]-b[0]);
  })()`);
  const set = async (selector, value) => {
    await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(1200);
  };
  const text = async value => {
    await run(`(()=>{const e=document.getElementById('txtText');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait(2000);
  };
  const capture = async name => { win.show(); win.focus(); await wait(500); await shot(path.join(D, name + '.png')); };
  win.setSize(1600, 1000);
  ok(await run(`(async()=>{
    const {BUNDLED_FONTS}=await import('./core/text.js');
    return BUNDLED_FONTS.some(f=>f.family==='Matemasie' && f.file==='Matemasie-Regular.ttf');
  })()`), 'Matemasie is bundled, not dependent on a system installation');
  ok(await run(`['#txtFont','#backFont','#studio [data-t="font"]'].every(selector=>{
    const select=document.querySelector(selector);
    return select && [...select.options].some(o=>o.value==='Matemasie');
  })`), 'Matemasie is selectable in text, engraving and 2D editors');
  const stretch = JSON.parse(await run(`(async()=>{
    const {DEFAULT_TEXT,ensureFont,renderTextImage,decorationWidthMM}=await import('./core/text.js');
    await ensureFont('Matemasie',400);
    const c=document.createElement('canvas'),ctx=c.getContext('2d');
    ctx.font='400 220px "Matemasie"';ctx.letterSpacing='0px';
    const h=ctx.measureText('H'),m=ctx.measureText('YANNETHZI');
    const naturalWidth=(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)*12/(h.actualBoundingBoxAscent+h.actualBoundingBoxDescent);
    const opts={...DEFAULT_TEXT(),text:'YANNETHZI',font:'Matemasie',weight:400,fill:'#ffffff',outline:false,
      decoration:'ribbon',decorationSize:14,decorationGap:2,decorationColor:'#f28bb4'};
    const width=70.95,scaleX=(width-decorationWidthMM(opts)-opts.decorationGap)/naturalWidth*100;
    const r=renderTextImage({...opts,scaleX},width),im=new Image();im.src=r.dataURL;await im.decode();
    c.width=im.width;c.height=im.height;ctx.drawImage(im,0,0);
    const d=ctx.getImageData(0,0,c.width,c.height).data;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      const i=(y*c.width+x)*4;if(!d[i+3])continue;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);
      if(d[i]===255&&d[i+1]===255&&d[i+2]===255){minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    }
    return JSON.stringify({scaleX,height:(maxY-minY+1)*width/(maxX-minX+1),
      legacyUnchanged:renderTextImage({...opts,scaleX:undefined},width).dataURL===renderTextImage({...opts,scaleX:100},width).dataURL});
  })()`));
  ok(Math.abs(stretch.height - 12) < 0.12, 'long names retain 12 mm capitals when only their width is compressed');
  ok(stretch.legacyUnchanged, '100% horizontal proportion preserves legacy rendering');
  ok(await run(`(async()=>{
    const {DEFAULT_TEXT,renderTextImage}=await import('./core/text.js');
    const opts={...DEFAULT_TEXT(),text:'H',font:'Matemasie',weight:400,fill:'#ffffff',
      outline:true,outlineColor:'#f28bb4',outlineMM:0.8,thicken:0.4};
    const measure=async options=>{
      const r=renderTextImage(options,20),im=new Image();im.src=r.dataURL;await im.decode();
      const c=document.createElement('canvas');c.width=im.width;c.height=im.height;
      const ctx=c.getContext('2d');ctx.drawImage(im,0,0);
      const d=ctx.getImageData(0,0,c.width,c.height).data;
      const outer=[Infinity,Infinity,-Infinity,-Infinity],inner=[...outer];
      const add=(b,x,y)=>{b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y);};
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
        const i=(y*c.width+x)*4;if(!d[i+3])continue;add(outer,x,y);
        if(d[i]===255&&d[i+1]===255&&d[i+2]===255)add(inner,x,y);
      }
      const mm=20/(outer[2]-outer[0]+1);
      return [0,1].every(axis=>Math.abs(((outer[axis+2]-outer[axis])-(inner[axis+2]-inner[axis]))*mm/2-0.8)<0.12);
    };
    for(const scaleX of [50,150])for(const align of ['left','center','right']){
      if(!await measure({...opts,scaleX,align,text:'H\\nHH'}))return false;
    }
    for(const scaleX of [0,24,201,NaN]){
      let rejected=false;try{renderTextImage({...opts,scaleX},20);}catch(e){rejected=/horizontal/.test(e.message);}
      if(!rejected)return false;
    }
    return true;
  })()`), 'compressed/expanded multiline text keeps isotropic mm borders and rejects invalid proportions');
  const { ipcMain } = require('electron');
  let confirmation = 0;
  ipcMain.removeHandler('confirm');
  ipcMain.handle('confirm', () => confirmation);
  await run(`window.__r3d.enterModule('logo')`);
  const logo = fs.readFileSync(path.join(__dirname, '..', 'logo.png')).toString('base64');
  await run(`window.__r3d.loadImageFile(new File([Uint8Array.from(atob('${logo}'),c=>c.charCodeAt(0))],'logo.png',{type:'image/png'}))`);
  await run(`window.__r3d.enterModule('pencil')`);
  ok(await run(`window.__r3d.S.source==='image' && !!window.__r3d.getFeat()?.pencilChannel`), 'reusing an image prepares the integrated engine on first use');
  confirmation = 1;
  await run(`window.__r3d.enterModule('logo')`);
  await run(`window.__r3d.enterModule('pencil')`);
  await wait(1000);
  ok(await run(`window.__r3d.S.text.text === 'Linda' && !!window.__r3d.getFeat()?.pencilChannel`), 'Linda generated with integrated channel');
  ok(await run(`window.__r3d.getFeat().layers.length === 0 && window.__r3d.getFeat().solids.length === 1`), 'no overlapping undrilled base or external sleeve');
  await run(`window.__r3d.setViewMode('3d')`); await wait(700);
  await capture('pencil_01_linda');
  await run(`window.__r3d.viewer.frame(true)`); await capture('pencil_02_top');
  const { checkPencilExports } = await import(pathToFileURL(path.join(__dirname, '..', 'pencil_exports.mjs')).href);
  for (const kind of ['3mf', 'stl-one']) await run(`window.__r3d.doExport('${kind}')`);
  const channel = await read('window.__r3d.getFeat().pencilChannel');
  const dimensions = await checkPencilExports(exp, 'Linda', channel);
  log('Linda', JSON.stringify(dimensions));
  ok(Math.abs(await decorationHeight() - 14) < 0.12, 'ribbon has the requested physical height');
  const image63 = await run(`window.__r3d.S.image.dataURL`);
  await set('[data-set="widthMM"]', 75);
  const image75 = await run(`window.__r3d.S.image.dataURL`);
  ok(image63 !== image75 && Math.abs(await decorationHeight() - 14) < 0.12, 'width change preserves decoration size in mm');
  await run(`window.__r3d.undo()`);
  ok(await run(`window.__r3d.S.settings.widthMM===63 && window.__r3d.S.image.dataURL===${JSON.stringify(image63)}`), 'undo restores width-dependent text raster');
  await run(`window.__r3d.redo()`);
  ok(await run(`window.__r3d.S.settings.widthMM===75 && window.__r3d.S.image.dataURL===${JSON.stringify(image75)}`), 'redo restores width-dependent text raster');
  await run(`window.__r3d.undo()`);

  ok(await run(`(async()=>{
    const e=document.getElementById('txtText');e.value='Pendiente';e.dispatchEvent(new Event('input',{bubbles:true}));
    let blocked=false;try{window.__r3d.exportParts();}catch(e){blocked=/pendientes/.test(e.message);}
    await window.__r3d.saveProject();return blocked;
  })()`), 'export blocked immediately before text debounce');
  ok(!fs.existsSync(path.join(exp, 'Pendiente.r3d')), 'pending text cannot save a mismatched project');
  await text('Linda');

  await set('[data-set="pencil.relief"]', 2);
  await set('[data-set="pencil.decorationRelief"]', 2.6);
  await set('#txtFill', '#a22ed1');
  await set('#txtDecorationColor', '#ed8eb3');
  await set('#txtBaseColor', '#f1e9dc');
  await text('Violeta');
  ok(await run(`window.__r3d.S.pieces.some(p=>p.height===2) && window.__r3d.S.pieces.some(p=>p.height===2.6)`), 'separate text and decoration heights survive recolouring and name changes');
  await set('#txtDecoration', 'heart');
  await set('#txtFont', 'Lilita One');
  await set('[data-set="widthMM"]', 75);
  await set('[data-set="pencil.value"]', 8);
  await set('[data-set="pencil.tolerance"]', 0.3);
  for (const kind of ['3mf', 'stl-one']) await run(`window.__r3d.doExport('${kind}')`);
  await checkPencilExports(exp, 'Violeta', await read('window.__r3d.getFeat().pencilChannel'), { calibre: 8.3, height: 14.6 });
  log('ok  ', 'Violeta / heart / font / size / colours / reliefs / 8.3 mm final bore');
  await set('#txtDecoration', 'star');
  await text('Ana María');
  ok(await run(`window.__r3d.exportParts().length===3`), 'multiword accented name with star');
  await set('#txtDecoration', 'none');
  ok(await run(`window.__r3d.exportParts().length===2`), 'decoration can be removed');

  await set('[data-set="base.thickness"]', 5);
  ok(await run(`(()=>{try{window.__r3d.exportParts();return false;}catch(e){return /al menos/.test(e.message);}})()`), 'thin base rejected and export blocked');
  await run(`window.__r3d.saveProject()`);
  ok(!fs.existsSync(path.join(exp, 'Ana María.r3d')), 'invalid base cannot save a mismatched project');
  await set('[data-set="base.thickness"]', 12);
  await set('#txtDecoration', 'ribbon');
  await set('#txtDecorationSize', 100);
  ok(await run(`(()=>{try{window.__r3d.exportParts();return false;}catch(e){return /ancho/.test(e.message);}})()`), 'oversized decoration cannot export a stale preview');
  await set('#txtDecorationSize', 14);

  await text('Linda');
  await set('#txtFont', 'Matemasie');
  await set('#txtWeight', 400);
  ok(await run(`[...document.fonts].some(f=>f.family==='Matemasie' && f.status==='loaded') && window.__r3d.S.text.font==='Matemasie'`), 'the actual bundled Matemasie face loads without fallback');
  await set('#txtFill', '#dc397b');
  await set('#txtDecorationColor', '#f28bb4');
  await set('#txtBaseColor', '#ffffff');
  await set('[data-set="widthMM"]', 63);
  await set('[data-set="pencil.value"]', 7.8);
  await set('[data-set="pencil.tolerance"]', 0);
  await set('[data-set="pencil.relief"]', 1.4);
  await set('[data-set="pencil.decorationRelief"]', 1.4);
  const before = await read('window.__r3d.S.text');
  await run(`window.__r3d.saveProject()`);
  const project = fs.readFileSync(path.join(exp, 'Linda.r3d'), 'utf8');
  const image = JSON.parse(project).image.dataURL.split(',')[1];
  await run(`(async()=>{
    const e=document.getElementById('txtText');e.value='Texto descartado';e.dispatchEvent(new Event('input',{bubbles:true}));
    const bytes=Uint8Array.from(atob(${JSON.stringify(image)}),c=>c.charCodeAt(0));
    await window.__r3d.loadImageFile(new File([bytes],'imported.png',{type:'image/png'}));
  })()`);
  await wait(800);
  ok(await run(`window.__r3d.S.source==='image' && window.__r3d.S.image.name==='imported.png' && window.__r3d.exportParts().length>0`), 'loading an image cancels pending text without blocking the new model');
  await run(`(async()=>{
    const e=document.getElementById('txtText');e.value='Cambio temporal';e.dispatchEvent(new Event('input',{bubbles:true}));
    await window.__r3d.openProjectFile(new File([${JSON.stringify(project)}],'Linda.r3d'));
  })()`);
  await wait(800);
  ok(JSON.stringify(await read('window.__r3d.S.text')) === JSON.stringify(before), 'saved project restores editable text and decorations');
  ok(await run(`window.__r3d.hist.stack.length===1 && window.__r3d.exportParts().length===3`), 'opening a project cancels queued text generation');
  await text('Lina');
  ok(await run(`window.__r3d.S.text.text==='Lina' && !!window.__r3d.getFeat()?.pencilChannel`), 'reopened project is still editable');
  await text('Linda');
  for (const kind of ['3mf', 'stl-one', 'svg']) await run(`window.__r3d.doExport('${kind}')`);
  await run(`window.__r3d.saveProject()`);
  const finalDimensions = await checkPencilExports(exp, 'Linda', await read('window.__r3d.getFeat().pencilChannel'));
  await run(`(()=>{
    const v=window.__r3d.viewer;v.frame();const t=v.controls.target,d=v.camera.position.distanceTo(t);
    v.camera.position.set(t.x-d*0.5,t.y+d*0.6,t.z+d*0.65);v.controls.update();v.requestRender();
  })()`); await capture('pencil_03_final');
  fs.writeFileSync(path.join(D, 'result.json'), JSON.stringify({ ...finalDimensions, channel: await read('window.__r3d.getFeat().pencilChannel'), font: 'Matemasie', project: 'Linda.r3d' }, null, 2));
  await text('YANNETHZI');
  await set('#txtScaleX', stretch.scaleX);
  await set('[data-set="widthMM"]', 70.95);
  await set('[data-set="base.thickness"]', 11.6);
  await set('[data-set="pencil.value"]', 7.9);
  await set('#txtFill', '#ffffff');
  await set('#txtDecorationColor', '#ffffff');
  await set('#txtBaseColor', '#f28bb4');
  const stretchedImage = await run('window.__r3d.S.image.dataURL');
  await set('#txtScaleX', 100);
  await run('window.__r3d.undo()');
  ok(await run(`window.__r3d.S.image.dataURL===${JSON.stringify(stretchedImage)}`), 'undo restores horizontal letter proportion and artwork');
  await run('window.__r3d.redo()');
  ok(await run('window.__r3d.S.text.scaleX===100'), 'redo restores the original letter proportion');
  await run('window.__r3d.undo()');
  await run('window.__r3d.saveProject()');
  const stretchedProject = fs.readFileSync(path.join(exp, 'YANNETHZI.r3d'), 'utf8');
  await text('Otro nombre');
  await run(`window.__r3d.openProjectFile(new File([${JSON.stringify(stretchedProject)}],'YANNETHZI.r3d'))`);
  ok(await run(`Math.abs(window.__r3d.S.text.scaleX-${stretch.scaleX})<1e-8 && window.__r3d.S.image.dataURL===${JSON.stringify(stretchedImage)}`), 'horizontal proportion survives saving and reopening');
  await text('YANNETHZI');
  ok(Math.abs(await decorationHeight() - 14) < 0.12, 'horizontal letter compression does not deform the ribbon');
  for (const kind of ['3mf', 'stl-one']) await run(`window.__r3d.doExport('${kind}')`);
  await checkPencilExports(exp, 'YANNETHZI', await read('window.__r3d.getFeat().pencilChannel'),
    { calibre: 7.9, height: 13, colors: 2, maxDimensions: [75, 19, 13], minContourVariation: 0.4 });
  await run('window.__r3d.viewer.frame(true)');
  await capture('pencil_04_compressed_name');
  ok(!errs.length, 'console errors: ' + (errs.join(' | ') || 'none'));
  log('done');
};

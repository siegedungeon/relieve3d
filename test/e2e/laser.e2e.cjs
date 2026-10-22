const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

module.exports = async ({ win, run, shot, wait }) => {
  const dir = process.env.E2E_DIR, exported = process.env.R3D_AUTOSAVE_DIR;
  const ok = (value, message) => {
    console.log('[e2e]', value ? 'ok  ' : 'FAIL', message);
    if (!value) throw new Error(message);
  };
  const until = async (expression, message, timeout = 90000) => {
    const deadline = Date.now() + timeout;
    while (!await run(expression)) {
      if (Date.now() > deadline) throw new Error(message);
      await wait(150);
    }
  };
  const click = async selector => {
    await run(`document.querySelector(${JSON.stringify(selector)}).click()`); await wait(100);
  };
  const set = async (selector, value) => {
    await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); if(e.type==='checkbox')e.checked=${JSON.stringify(value)};else e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(150);
  };
  const errors = [];
  win.webContents.on('console-message', event => {
    if ((event.level === 'error' || event.level >= 3) && !/WebGLProgram|disk_cache/.test(event.message)) errors.push(event.message);
  });
  ipcMain.removeHandler('confirm'); ipcMain.handle('confirm', () => 0);
  win.setSize(1600, 1000);
  await until('!!window.__r3d?.laser', 'laser module did not initialize');
  await click('[data-mod="laser"]');
  ok(await run("!document.querySelector('#laser').hidden"), 'home opens a separate local laser tool');
  const specimen = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80"><g id="Figura"><path d="M5 5 H25 V18 H15 V30 H5 Z" fill="none" stroke="red" stroke-width=".05"/></g><circle id="Exterior" cx="50" cy="20" r="6" fill="none" stroke="red" stroke-width=".05"/><circle id="Interior" cx="50" cy="20" r="4" fill="none" stroke="red" stroke-width=".05"/></svg>';
  await run(`window.__r3d.laser.loadFile(new File([${JSON.stringify(specimen)}],'figuras.svg',{type:'image/svg+xml'}))`);
  ok(await run('window.__r3d.laser.templates.length===3 && Math.abs(window.__r3d.laser.templates[0].width-20)<.01'), 'SVG imports groups and circles at physical millimeter scale');
  const ids = await run('window.__r3d.laser.templates.map(t=>t.id)');
  for (const id of ids) await set(`#laser [data-select="${id}"]`, id !== ids[0]);
  await click('#laser [data-action="group"]');
  ok(await run('window.__r3d.laser.templates.length===2 && (window.__r3d.laser.templates[1].svg.match(/<circle /g)||[]).length===2'), 'two concentric circles form one indivisible template without losing either curve');
  const ring = await run('window.__r3d.laser.templates[1].id');
  await set(`#laser [data-template="${ring}"][data-field="name"]`, 'Anillo');
  await set(`#laser [data-template="${ring}"][data-field="role"]`, 'complement');
  await set(`#laser [data-template="${ids[0]}"][data-field="complementId"]`, ring);
  await set('#laser [data-config="width"]', 120);
  await set('#laser [data-config="height"]', 100);
  await set('#laser [data-config="mode"]', 'exact');
  await set('#laser [data-config="angleStep"]', 90);
  await set('#laser [data-config="seconds"]', 10);
  await set(`#laser [data-template="${ids[0]}"][data-field="quantity"]`, 6);
  await click('#laser [data-action="optimize"]');
  await until('!window.__r3d.laser.worker', 'worker did not finish exact job');
  ok(await run('window.__r3d.laser.best?.figures===6 && window.__r3d.laser.best.placements.length===12'), 'off-thread search fits six figures AND six complete rings');
  ok(await run('window.__r3d.laser.placements.length===0 && document.querySelector(\'#laser [data-action="export"]\').disabled'), 'preview is not silently applied or exported');
  await click('#laser [data-action="apply"]');
  await click('#laser [data-action="validate"]');
  ok(await run('window.__r3d.laser.validation.valid && window.__r3d.laser.validation.minGap>=1 && window.__r3d.laser.validation.minMargin>=1'), 'all 66 pairs and sheet margins are validated including stroke clearance');
  await shot(path.join(dir, 'laser_01_paired-layout.png'));
  await click('#laser [data-action="save"]');
  await until(`!!document.querySelector('#laser [data-role="status"]').textContent.includes('Proyecto guardado')`, 'save did not finish');
  await click('#laser [data-action="export"]');
  await until(`!!document.querySelector('#laser [data-role="status"]').textContent.includes('SVG guardado')`, 'export did not finish');
  const saved = JSON.parse(fs.readFileSync(path.join(exported, 'distribucion_laser.r3l'), 'utf8'));
  const svg = fs.readFileSync(path.join(exported, 'distribucion_laser.svg'), 'utf8');
  ok(/width="120mm"/.test(svg) && /height="100mm"/.test(svg) && (svg.match(/<circle /g) || []).length === 12 && (svg.match(/data-template=/g) || []).length === 12, 'export preserves true sheet scale, twelve circles and twelve logical pieces with no UI guides');
  await run(`window.__r3d.laser.instance=window.__r3d.laser.placements[1].id;window.__r3d.laser.draw()`);
  const first = await run('window.__r3d.laser.placements[0]');
  await set('#laser [data-position="x"]', first.x);
  await set('#laser [data-position="y"]', first.y);
  ok(await run('!window.__r3d.laser.validation.valid && document.querySelector(\'#laser [data-action="export"]\').disabled'), 'manual contact/overlap is highlighted and blocks export');
  await click('#laser [data-action="undo"]'); await click('#laser [data-action="undo"]');
  ok(await run('window.__r3d.laser.validation.valid'), 'undo restores the previous safe positions');
  await click('#laser [data-action="redo"]'); await click('#laser [data-action="redo"]');
  ok(await run('!window.__r3d.laser.validation.valid'), 'redo restores the edit and its collision warning');
  await run(`window.__r3d.laser.openProject(${JSON.stringify(saved)})`);
  ok(await run('window.__r3d.laser.validation.valid && window.__r3d.laser.placements.length===12'), 'reopening reconstructs source vectors, relationships and valid placements');
  const exportCheck = await run(`(async()=>{const {importLaserSVG}=await import('./laser_svg.js');const ts=importLaserSVG(${JSON.stringify(svg)});return {count:ts.length,figures:ts.filter(t=>Math.abs(t.width-20)<.01||Math.abs(t.height-20)<.01).length};})()`);
  ok(exportCheck.count === 12 && exportCheck.figures === 6, 'exported SVG reimports as twelve exact-scale groups, not a raster image');
  const rejection = await run(`(async()=>{const {importLaserSVG}=await import('./laser_svg.js');const failures=[];for(const source of [
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="10" height="10"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm"><text>x</text></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm"><path d="M0 0L10 10"/></svg>'
  ]){try{importLaserSVG(source);failures.push(false);}catch(e){failures.push(!!e.message);}}return failures.every(Boolean);})()`);
  ok(rejection, 'ambiguous units, executable content, text and unbounded open paths fail explicitly');
  await run(`(async()=>{const {importLaserSVG}=await import('./laser_svg.js');const a=importLaserSVG('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',{unitless:'cm'});if(Math.abs(a[0].width-100)>.001)throw Error('unit conversion');})()`);
  console.log('[e2e] ok   explicitly selected centimeters preserve physical scale');
  await run(`(async()=>{const {importLaserSVG}=await import('./laser_svg.js');const a=importLaserSVG('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',{unitless:'cm'});if(Math.abs(a[0].width-100)>.001)throw Error('unit conversion without viewBox');})()`);
  console.log('[e2e] ok   unitless SVG without viewBox uses the explicitly chosen units too');
  await set('#laser [data-config="mode"]', 'fill');
  await set('#laser [data-config="seconds"]', 30);
  win.minimize();
  await click('#laser [data-action="optimize"]');
  await until('!!window.__r3d.laser.best', 'fill search produced no valid intermediate result', 45000);
  await click('#laser [data-action="cancel"]');
  win.restore(); win.show(); win.focus();
  ok(await run('!window.__r3d.laser.worker && !!window.__r3d.laser.best?.placements.length'), 'search works while minimized; cancelling keeps the best paired solution and releases the worker');
  await click('#laser [data-action="apply"]');
  await set('#laser [data-config="width"]', 20);
  await set('#laser [data-config="height"]', 20);
  await set('#laser [data-config="mode"]', 'exact');
  await set('#laser [data-config="seconds"]', 2);
  await click('#laser [data-action="optimize"]'); await until('!window.__r3d.laser.worker', 'impossible job did not terminate');
  ok(await run('!window.__r3d.laser.best && document.querySelector(\'#laser [data-role="status"]\').textContent.includes("No se encontro")'), 'an impossible job reports failure instead of putting overflow outside the sheet');
  await run(`window.__r3d.laser.openProject(${JSON.stringify(saved)})`);
  await click('#laser [data-action="home"]');
  await click('[data-mod="laser"]');
  ok(await run('window.__r3d.laser.placements.length===12 && window.__r3d.laser.validation.valid'), 'leaving and reentering preserves the independent laser project');
  win.setSize(1100, 680); await wait(300);
  ok(await run(`document.querySelector('#laser .laser-settings').scrollHeight>0 && document.querySelector('#laser .laser-work').getBoundingClientRect().right<=innerWidth`), 'settings and board remain accessible at the minimum window size');
  win.setSize(1600, 1000);
  await run(`window.__r3d.laser.templates=[];window.__r3d.laser.placements=[];window.__r3d.laser.commit(false)`);
  await click('#laser [data-action="example"]');
  await until('window.__r3d.laser.templates.length===7', 'six-figure example failed to import');
  ok(await run('window.__r3d.laser.templates.some(t=>t.name==="Anillo"&&(t.svg.match(/<circle /g)||[]).length===2)'), 'six-design example includes one intact two-circle ring');
  if (process.env.E2E_INPUT) {
    await run(`window.__r3d.laser.templates=[];window.__r3d.laser.placements=[];window.__r3d.laser.commit(false)`);
    const reference = fs.readFileSync(process.env.E2E_INPUT, 'utf8');
    await run(`window.__r3d.laser.importSVG(${JSON.stringify(reference)},{name:'Referencia'})`);
  }
  const all = await run('window.__r3d.laser.templates.map(t=>({id:t.id,name:t.name}))'), last = all.at(-1).id;
  await set(`#laser [data-template="${last}"][data-field="role"]`, 'complement');
  for (const t of all.slice(0, -1)) await set(`#laser [data-template="${t.id}"][data-field="complementId"]`, last);
  await set('#laser [data-config="width"]', 480); await set('#laser [data-config="height"]', 400);
  await set('#laser [data-config="mode"]', 'fill'); await set('#laser [data-config="seconds"]', 30); await set('#laser [data-config="angleStep"]', 15);
  fs.writeFileSync(path.join(dir, 'nest-input.json'), await run('JSON.stringify({templates:window.__r3d.laser.templates,config:window.__r3d.laser.config})'));
  await click('#laser [data-action="optimize"]');
  await until('!window.__r3d.laser.worker', 'full six-design job did not finish', 120000);
  console.log('[e2e] search result', await run('JSON.stringify({figures:window.__r3d.laser.best?.figures,trials:window.__r3d.laser.best?.trials,status:document.querySelector(\'#laser [data-role="status"]\').textContent})'));
  ok(await run('window.__r3d.laser.best?.figures>=24'), 'full-sheet six-design optimization finds at least 24 complete games');
  await click('#laser [data-action="apply"]');
  await click('#laser [data-action="validate"]'); await click('#laser [data-action="save"]'); await wait(500);
  await click('#laser [data-action="export"]'); await wait(500);
  const summary = await run('window.__r3d.laser.validation');
  ok(summary.valid && summary.figures === summary.complements && summary.minGap >= 1, 'final six-design sheet has balanced figures, exact complements and no touching outlines');
  console.log('[e2e] final counts', JSON.stringify(summary));
  await shot(path.join(dir, 'laser_02_six-designs.png'));
  const priorTemplateCount = await run('window.__r3d.laser.templates.length');
  await run("window.__r3d.showHome();window.__r3d.enterModule('logoprep')");
  await run("window.__r3d.studio.setSource('text')");
  await until('!!window.__r3d.studio.comp?.bbox', '2D design did not generate', 60000);
  await run("window.__r3d.studio.sendToLaser()");
  await until('!document.querySelector("#laser").hidden', '2D design was not sent to laser nesting', 60000);
  ok(await run(`window.__r3d.laser.templates.length===${priorTemplateCount + 1} && window.__r3d.studio.comp.bbox.length===4`), '2D editor sends its complete vector design to nesting without destroying the original');
  ok(errors.length === 0, 'no renderer errors: ' + errors.join('; '));
  console.log('[e2e] done');
};

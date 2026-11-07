const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');

module.exports = async ({ win, run, shot, wait }) => {
  const dir = process.env.E2E_DIR;
  const errors = [];
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', e => {
    if ((e.level === 'error' || e.level >= 3) && !/WebGLProgram|disk_cache/.test(e.message)) errors.push(e.message);
  });
  const ok = (value, message) => { assert.ok(value, message); console.log('[e2e] ok  ', message); };
  const theme = async value => {
    await run(`(() => {
      const select = document.getElementById('themeSelect');
      select.value = ${JSON.stringify(value)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await wait(100);
  };
  const screenshot = async name => {
    win.setAlwaysOnTop(true);
    try {
      win.show(); win.focus(); win.webContents.invalidate(); await wait(300);
      await shot(path.join(dir, name + '.png'));
    } finally { win.setAlwaysOnTop(false); }
  };
  const reload = async () => {
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload(); });
    await wait(500);
  };
  const selectorVisible = () => run(`(() => {
    const e = document.getElementById('themeSelect'), r = e.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= 34 &&
      document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e;
  })()`);
  const contrast = selector => run(`(() => {
    const e = document.querySelector(${JSON.stringify(selector)});
    if (!e || !e.getClientRects().length) return 0;
    const rgb = color => color.match(/[\\d.]+/g).slice(0, 3).map(Number);
    const luminance = color => rgb(color).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; })
      .reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
    let node = e, bg;
    while (node) {
      bg = getComputedStyle(node).backgroundColor;
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') break;
      node = node.parentElement;
    }
    const a = luminance(getComputedStyle(e).color), b = luminance(bg);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  })()`);
  if (process.env.E2E_THEME_RESTART) {
    const expected = process.env.E2E_THEME_RESTART;
    ok(await run(`document.documentElement.dataset.theme === ${JSON.stringify(expected)} &&
      document.getElementById('themeSelect').value === ${JSON.stringify(expected)}`),
    `${expected} preference survives closing and reopening Electron`);
    await theme('light');
    console.log('[e2e] done');
    return;
  }
  await win.setSize(1500, 920);
  await run(`localStorage.removeItem('relieve3d.theme')`);
  await reload();
  ok(await run(`document.documentElement.dataset.theme === 'light' && document.getElementById('themeSelect').value === 'light'`),
    'a new profile starts in light mode');
  await screenshot('theme_01_home_light');
  await theme('dark');
  ok(await selectorVisible(), 'theme selector is visible and reachable on Home');
  await run(`document.getElementById('themeSelect').focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' });
  await wait(100);
  ok(await run(`document.documentElement.dataset.theme === 'light'`), 'the selector works with keyboard input');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
  await wait(100);
  ok(await run(`document.documentElement.dataset.theme === 'dark'`), 'keyboard selection applies dark mode');
  ok(await contrast('.home-card .hc-title') >= 4.5 && await contrast('.home-card .hc-desc') >= 4.5,
    'home labels and descriptions have readable dark-mode contrast');
  await screenshot('theme_02_home_dark');
  await reload();
  ok(await run(`document.documentElement.dataset.theme === 'dark' && document.getElementById('themeSelect').value === 'dark'`),
    'dark preference survives a real page reload');

  // These modules have different surfaces; preset-based 3D modules share the main editor.
  for (const [module, root, sample] of [
    ['logo', 'body > .topbar', '#btnSaveProject'],
    ['logoprep', '#studio', '#studio .btn'],
    ['cakelaser', '#studio', '#studio .btn'],
    ['hablador', '#hablador', '#hablador .btn'],
    ['colorsplit', '#colorsplit', '#colorsplit .btn'],
    ['coloring', '#coloring', '#coloring .btn'],
    ['nametree', '#nameTree', '#nameTree .btn'],
    ['laser', '#laser', '#laser .btn'],
    ['quote', '#quote', '#quote .q-field > span'],
  ]) {
    await run(`(__r3d.showHome(), true)`);
    await run(`__r3d.enterModule(${JSON.stringify(module)})`);
    await wait(200);
    for (const value of ['light', 'dark']) {
      await theme(value);
      ok(await selectorVisible() && await run(`document.querySelector(${JSON.stringify(root)}).getBoundingClientRect().top >= 34`),
        `${module}: selector stays accessible without covering the module in ${value} mode`);
      if (['logo', 'logoprep'].includes(module)) {
        const red = await run(`__r3d.${module === 'logo' ? 'view2d' : 'studio'}.ctx.getImageData(0, 0, 1, 1).data[0]`);
        ok(value === 'light' ? red > 200 : red < 80, `${module}: canvas surroundings follow the theme`);
      }
    }
    ok(await contrast(sample) >= 4.5, `${module}: dark controls remain readable`);
    if (['logoprep', 'quote'].includes(module)) await screenshot(`theme_${module}_dark`);
  }
  await win.setSize(390, 760); await wait(300);
  ok(await selectorVisible(), 'selector remains usable in the narrow quotation layout');
  await screenshot('theme_quote_narrow_dark');
  await win.setSize(1500, 920);
  await run(`(__r3d.showHome(), true)`);
  await run(`__r3d.enterModule('phonestand')`);
  await run(`__r3d.phonestand.whenIdle().then(() => true)`);
  await run(`(() => {
    const input = document.querySelector('#phonestand [data-k="name"]');
    input.value = 'Prueba de tema'; input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await run(`__r3d.phonestand.whenIdle().then(() => true)`);
  ok(await selectorVisible() && await run(`__r3d.phonestand.cfg.name === 'Prueba de tema'`),
    'phone stand keeps the selector accessible and accepts model edits');
  const state = () => run(`JSON.stringify({
    cfg: __r3d.phonestand.cfg,
    parts: __r3d.phonestand.res.parts.map(p => [p.geometry.uuid, p.color]),
    camera: __r3d.phonestand.viewer.camera.position.toArray()
  })`);
  const before = await state();
  const model = async () => {
    const file = await run(`__r3d.phonestand.export3MF()`);
    assert.ok(file, '3MF exported');
    return strFromU8(unzipSync(fs.readFileSync(file))['3D/3dmodel.model'])
      .replace(/<metadata name="CreationDate">.*?<\/metadata>/g, '');
  };
  const darkModel = await model();
  await theme('light');
  ok(await state() === before, 'switching theme preserves the edited model, material colours and camera');
  ok(await model() === darkModel, '3MF geometry and filament colours are identical in both themes');
  await theme('dark');
  await screenshot('theme_phonestand_dark');
  await run(`__r3d.phonestand.saveProject()`);
  ok(fs.readdirSync(process.env.R3D_AUTOSAVE_DIR).some(f => f.endsWith('.r3p')), 'edited project can still be saved');
  await run(`(__r3d.showHome(), true)`);
  await theme('light'); await reload();
  ok(await run(`document.documentElement.dataset.theme === 'light'`), 'returning to light is also remembered');
  ok(!errors.length, 'no renderer errors: ' + errors.join(' | '));
  await theme('dark');
  console.log('[e2e] done');
};

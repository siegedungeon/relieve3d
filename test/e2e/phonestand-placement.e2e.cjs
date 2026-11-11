module.exports = async ({ win, run, wait }) => {
  const log = (...args) => console.log('[e2e]', ...args);
  const ok = (condition, message) => log(condition ? 'ok  ' : 'FAIL', message);
  const until = async (expr) => {
    for (let i = 0; i < 300; i++) {
      if (await run(expr)) return true;
      await wait(200);
    }
    return false;
  };
  await win.setSize(1500, 900);
  await run("document.querySelector('[data-mod=phonestand]').click()");
  ok(await until('!!window.__r3d.phonestand.res && !window.__r3d.phonestand.building'), 'phone stand opens');
  await run("document.querySelector('#phonestand [data-k=\"opener.enabled\"]').click()");
  ok(await until('!!window.__r3d.phonestand.res?.info.opener && !window.__r3d.phonestand.building'), 'can opener is enabled');
  for (const id of ['attachment', 'opener']) {
    const p = await run(`(() => {
      const studio = window.__r3d.phonestand, marker = studio.handles.handles.get(${JSON.stringify(id)});
      studio.viewer.model.updateWorldMatrix(true, true);
      const v = marker.getWorldPosition(marker.position.clone()).project(studio.viewer.camera);
      const r = studio.viewer.renderer.domElement.getBoundingClientRect();
      return { x: Math.round(r.left + (v.x + 1) * r.width / 2), y: Math.round(r.top + (1 - v.y) * r.height / 2) };
    })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x + 25, y: p.y + 10, button: 'left' });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x + 25, y: p.y + 10, button: 'left', clickCount: 1 });
    const field = id === 'opener' ? 'opener.target' : 'ring.target';
    ok(await until(`!!window.__r3d.phonestand.cfg.${field} && !window.__r3d.phonestand.building && !window.__r3d.phonestand._t`), id + ' moves with the mouse');
  }
  await run("document.querySelector('#phonestand [data-k=\"opener.notch\"]').click()");
  ok(await until('window.__r3d.phonestand.res?.info.opener?.notch === true && !window.__r3d.phonestand.building'), 'optional notch is generated');
  log('done');
};

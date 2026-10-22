async function exportCommercial(BrowserWindow, document, format) {
  const { commercialHTML, commercialText } = await import('../core/quote_document.js');
  const stem = `${document.number}_v${document.version}`;
  if (format === 'text') return { name: `${stem}.txt`, text: commercialText(document), extension: 'txt' };
  if (!['pdf', 'png', 'compact', 'html'].includes(format)) throw new Error('Formato comercial no permitido.');
  const html = commercialHTML(document, format === 'compact');
  if (format === 'html') return { name: `${stem}.html`, text: html, extension: 'html' };
  const width = format === 'compact' ? 1080 : 900;
  const window = new BrowserWindow({ show: false, width, height: 1200, useContentSize: true, backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await window.webContents.executeJavaScript('Promise.all([document.fonts.ready,...Array.from(document.images).map(i=>i.decode())])');
    if (format === 'pdf') {
      const bytes = await window.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
      return { name: `${stem}.pdf`, bytes, extension: 'pdf' };
    }
    const height = Math.max(format === 'compact' ? 1080 : 1200, await window.webContents.executeJavaScript('document.documentElement.scrollHeight'));
    if (height > 16000) throw new Error('El documento es demasiado largo para una imagen. Usa PDF o acorta las observaciones.');
    window.setContentSize(width, height);
    await window.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const bytes = (await window.webContents.capturePage({ x: 0, y: 0, width, height })).toPNG();
    return { name: `${stem}_${format}.png`, bytes, extension: 'png' };
  } finally { if (!window.isDestroyed()) window.destroy(); }
}
module.exports = { exportCommercial };

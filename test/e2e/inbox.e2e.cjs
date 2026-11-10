// Real Electron UI + real, disposable local inbox backend with simulated social networks.
// The runner requires an explicit local sandbox, fake-provider control file and test password.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { BrowserWindow, safeStorage } = require('electron');
const { PNG } = require('pngjs');
const { createQuoteStore } = require('../../src/main/quote_store.cjs');
const { createInboxClient } = require('../../src/main/inbox_client.cjs');

const WA_PHONE = '106540352242922';
const META_SECRET = 'meta-app-secret-e2e';
const PAGE_ID = '1122334455';
const INSTAGRAM_ID = '17841400000000001';
const TIKTOK_APP_ID = '7300000000000000001';
const TIKTOK_SECRET = 'tiktok-secret-e2e';
const API = '/api/v1';

module.exports = async ({ win, run, shot, wait }) => {
  const server = process.env.R3D_INBOX_E2E_SERVER;
  const control = process.env.R3D_INBOX_E2E_CONTROL;
  const fakeLog = process.env.R3D_INBOX_E2E_LOG || path.join(path.dirname(control), 'fake-requests.jsonl');
  const password = process.env.R3D_INBOX_E2E_PASSWORD;
  const email = process.env.R3D_INBOX_E2E_EMAIL;
  const out = process.env.E2E_DIR;
  const capture = global.__r3dInbox;
  const errors = [];
  const unique = crypto.randomBytes(4).toString('hex');
  const suffix = String(parseInt(unique, 16)).padStart(10, '0').slice(-8);
  const ana = { phone: `5730${suffix}`, name: `Ana Prueba ${unique}` };
  const pedro = { phone: `5731${suffix}`, name: `Pedro Prueba ${unique}` };
  let token = '';
  let web;
  const originalControl = fs.readFileSync(control, 'utf8');
  win.webContents.on('console-message', (event) => {
    if ((event.level === 'error' || event.level >= 3) && !/disk_cache|WebGLProgram/.test(event.message)) errors.push(event.message);
  });
  const ok = (condition, message) => {
    console.log('[e2e]', condition ? 'ok  ' : 'FAIL', message);
    if (!condition) throw new Error(message);
  };
  const read = async (expression, wc = win.webContents) =>
    JSON.parse(await wc.executeJavaScript(`Promise.resolve(${expression}).then(v => JSON.stringify(v))`, true) ?? 'null');
  const until = async (fn, description, ms = 20000) => {
    for (const start = Date.now(); Date.now() - start < ms; await wait(100)) {
      const value = await fn();
      if (value) return value;
    }
    throw new Error(`Tiempo agotado esperando ${description}`);
  };
  const click = (selector) => run(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled) throw new Error(${JSON.stringify(`Control no disponible: ${selector}`)}); el.click(); })()`);
  const fill = (selector, value) => run(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled) throw new Error(${JSON.stringify(`Campo no disponible: ${selector}`)});
    el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const submit = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
  const request = async (method, route, body, isForm = false) => {
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body && !isForm) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${server}${API}${route}`, { method, headers, body: body && !isForm ? JSON.stringify(body) : body });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status}: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : null;
  };
  const formFile = (name, type, bytes, fields = {}) => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), name);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return form;
  };
  const postMeta = async (hook, payload) => {
    const body = JSON.stringify(payload);
    const signature = `sha256=${crypto.createHmac('sha256', META_SECRET).update(body).digest('hex')}`;
    const response = await fetch(`${server}${hook}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body });
    if (!response.ok) throw new Error(`Webhook simulado: HTTP ${response.status} ${await response.text()}`);
  };
  const sendWebhook = async (hook, customer, kind, content) => {
    const message = { from: customer.phone, id: `wamid.IN-${crypto.randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: kind, [kind]: content };
    await postMeta(hook, { object: 'whatsapp_business_account', entry: [{ id: 'WABA-E2E', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '573005550101', phone_number_id: WA_PHONE },
      contacts: [{ profile: { name: customer.name }, wa_id: customer.phone }], messages: [message],
    } }] }] });
    return message.id;
  };
  const sendMetaMessage = (hook, platform, account, customer, text) => postMeta(hook, {
    object: platform, entry: [{ id: account, time: Date.now(), messaging: [{
      sender: { id: customer }, recipient: { id: account }, timestamp: Date.now(),
      message: { mid: `e2e-${crypto.randomUUID()}`, text },
    }] }],
  });
  const sendTikTokMessage = async (hook, text) => {
    const message = { conversation_id: 'tt-conv-0001', message_id: `tt-in-${crypto.randomUUID()}`, timestamp: Date.now(),
      from_user: { id: 'tt-user-0001' }, to_user: { id: 'tt-open-pabonitas' }, type: 'text', text: { body: text } };
    const body = JSON.stringify({ client_key: TIKTOK_APP_ID, event: 'im_receive_msg', create_time: Math.floor(Date.now() / 1000),
      user_openid: 'tt-open-pabonitas', content: JSON.stringify(message) });
    const stamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac('sha256', TIKTOK_SECRET).update(`${stamp}.${body}`).digest('hex');
    const response = await fetch(`${server}${hook}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'TikTok-Signature': `t=${stamp},s=${signature}` }, body });
    if (!response.ok) throw new Error(`Webhook TikTok simulado: HTTP ${response.status} ${await response.text()}`);
  };
  const findConversation = (name) => until(async () => {
    const result = await request('GET', `/inbox/conversations?view=all&q=${encodeURIComponent(name)}`);
    return result.items.find((item) => item.display_name === name);
  }, `conversación ${name}`);
  const findPlatform = (platform) => until(async () => {
    const result = await request('GET', `/inbox/conversations?view=all&platform=${platform}`);
    return result.items.find((item) => item.last_message_preview?.includes(unique));
  }, `mensaje entrante de ${platform}`);
  const openConversation = async (id) => {
    await click(`#inbox [data-act="select"][data-id="${id}"]`);
    await until(() => read(`window.__r3d.inbox.detail?.conversation?.id === ${id}`), `chat ${id}`);
  };
  const waitMessage = (text, status) => until(() => read(`window.__r3d.inbox.detail?.messages?.some(m =>
    m.body?.includes(${JSON.stringify(text)}) ${status ? `&& m.status === ${JSON.stringify(status)}` : ''})`), `mensaje ${text}`);
  const composer = '#inbox [data-r="composer-text"]';
  const sendText = async (text, status = 'sent') => {
    await fill(composer, text);
    await submit('#inbox [data-form="send"]');
    await waitMessage(text, status);
    await until(() => read(`!window.__r3d.inbox.busy.has('send')`), 'fin del envío');
  };
  const tool = async (name) => {
    await click(`#inbox [data-act="open-tool"][data-tab="${name}"]`);
    await until(() => read(`window.__r3d.inbox.toolTab === ${JSON.stringify(name)} && !document.querySelector('#inbox [data-r="tools"]').hidden`), `herramienta ${name}`);
  };
  const attach = async (name, type, bytes) => {
    await run(`(() => { const input = document.querySelector('#inbox [data-r="file"]');
      const data = Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), c => c.charCodeAt(0));
      const transfer = new DataTransfer(); transfer.items.add(new File([data], ${JSON.stringify(name)}, {type:${JSON.stringify(type)}}));
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  };
  const screenshot = async (name) => { win.show(); win.focus(); await wait(200); await shot(path.join(out, `${name}.png`)); };

  try {
    if (process.env.E2E_INBOX_RESTART) {
      await until(async () => (await capture.client.state()).signedIn, 'ingreso automático al reiniciar');
      ok((await capture.client.request('GET', '/inbox/summary')).ok && capture.notifications.length === 0,
        'Electron reinicia la sesión cifrada sin avisar por mensajes antiguos');
      await click('#homeGridSocial [data-mod="inbox"]');
      await until(() => read(`window.__r3d.inbox.mode === 'ready' && window.__r3d.inbox.list.loaded`), 'bandeja tras reiniciar');
      await click('#inbox [data-act="logout"]');
      await until(() => read(`window.__r3d.inbox.mode === 'login'`), 'salida tras reiniciar');
      ok(!(await capture.client.state()).hasSavedPassword, 'salir después del reinicio elimina la contraseña cifrada');
      console.log('[e2e] done');
      return;
    }
    // All seed data and provider requests stay in the explicitly selected disposable sandbox.
    const health = await request('GET', '/health');
    ok(health.status === 'ok', 'backend aislado disponible');
    const login = await request('POST', '/auth/login', { tenant_slug: 'pabonitas', email, password });
    token = login.access_token;
    ok(Boolean(token), 'cuenta sintética del sandbox disponible');
    const settings = await request('PATCH', '/inbox/settings', { meta_app_id: '123456789012345', meta_app_secret: META_SECRET,
      tiktok_app_id: TIKTOK_APP_ID, tiktok_client_secret: TIKTOK_SECRET, welcome_enabled: false, away_enabled: false });
    const hook = new URL(settings.webhook_urls.meta).pathname;
    const channel = await request('POST', '/inbox/channels', { platform: 'whatsapp', account_id: WA_PHONE, access_token: 'EAAGwhatsappE2E', name: 'WhatsApp E2E', auto_reply_enabled: false });
    await request('POST', '/inbox/channels', { platform: 'messenger', account_id: PAGE_ID, access_token: 'EAAGpageE2E', name: 'Messenger E2E', auto_reply_enabled: false });
    await request('POST', '/inbox/channels', { platform: 'instagram', account_id: INSTAGRAM_ID, access_token: 'EAAGpageE2E',
      name: 'Instagram E2E', options: { api: 'facebook_login', page_id: PAGE_ID }, auto_reply_enabled: false });
    const portal = new URL('https://business-api.tiktok.com/portal/auth');
    portal.search = new URLSearchParams({ app_id: TIKTOK_APP_ID, redirect_uri: settings.webhook_urls.tiktok_oauth }).toString();
    const authorize = await request('POST', '/inbox/channels/tiktok/authorize', { authorize_url: portal.href });
    const oauthState = new URL(authorize.url).searchParams.get('state');
    const callback = await fetch(`${server}${new URL(settings.webhook_urls.tiktok_oauth).pathname}?${new URLSearchParams({ auth_code: 'fake-auth-code', state: oauthState })}`);
    if (!callback.ok || !(await callback.text()).includes('TikTok quedó conectado')) throw new Error('No se pudo autorizar TikTok simulado');
    const tiktok = (await request('GET', '/inbox/channels')).find((item) => item.platform === 'tiktok');
    await request('PATCH', `/inbox/channels/${tiktok.id}`, { options: { image_send: false }, auto_reply_enabled: false });
    ok(channel.channel.platform === 'whatsapp' && tiktok, 'cuatro redes usan proveedores simulados');
    const reply = await request('POST', '/inbox/saved-replies', { title: `Respuesta E2E ${unique}`, shortcut: `e2e${unique}`, body: 'Hola {nombre}, cuesta [PRECIO].', category: 'Pruebas' });
    const image = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < image.data.length; i += 4) image.data.set([225, 58, 110, 255], i);
    const png = PNG.sync.write(image);
    const pdf = Buffer.from('%PDF-1.4\n% synthetic E2E document\n%%EOF\n');
    const sticker = await request('POST', '/inbox/stickers', formFile('sticker.png', 'image/png', png, { name: `Sticker E2E ${unique}` }), true);
    const quick = await request('POST', '/inbox/quick-links/upload', formFile('catalogo-e2e.pdf', 'application/pdf', pdf, { title: `Archivo E2E ${unique}`, kind: 'documento' }), true);
    const products = await request('GET', '/products?limit=200');
    const product = products.find((item) => item.slug === 'llavero-personalizado');
    if (!product) throw new Error('El sandbox no contiene el producto sintético llavero-personalizado');
    await request('POST', `/products/${product.id}/image`, formFile('producto-e2e.png', 'image/png', png), true);
    await request('PATCH', `/products/${product.id}`, { base_price: '12000', is_published: true, is_public: true });
    const store = createQuoteStore(process.env.R3D_QUOTE_TEST_DIR, { actor: () => 'operador-e2e' });
    const library = await store.load();
    const { newQuote } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'core', 'quotation.js')).href);
    const input = newQuote(library.configs[0].value);
    input.customer.name = ana.name;
    input.product = `Producto E2E ${unique}`;
    input.quantity = 2;
    const localQuote = await store.save({ configVersion: 1, input, issue: true });
    const synced = await store.load();
    const webInput = structuredClone(input);
    webInput.product = `Solo web E2E ${unique}`;
    const webQuote = await store.save({ configVersion: 1, input: webInput, issue: true });
    const allQuotes = await store.load();
    // The local store retains just the first quote; the backend gets both to check deduplication.
    fs.writeFileSync(path.join(process.env.R3D_QUOTE_TEST_DIR, 'quotations-v1.json'), JSON.stringify(synced));
    const document = await request('GET', '/relieve3d/documents/quotations');
    await request('PUT', '/relieve3d/documents/quotations', { expected_version: document.version, data: allQuotes });
    await sendWebhook(hook, ana, 'text', { body: 'Hola, quiero un llavero de prueba.' });
    const anaChat = await findConversation(ana.name);

    win.setSize(1500, 1000);
    ok(await read(`!!document.querySelector('#homeGridSocial [data-mod="inbox"]')`), 'Inicio muestra Mensajes en escritorio');
    await click('#homeGridSocial [data-mod="inbox"]');
    await until(() => read(`window.__r3d.inbox.mode === 'login'`), 'formulario de ingreso');
    await fill('#inbox [name="email"]', email);
    await fill('#inbox [name="password"]', 'contraseña-incorrecta-e2e');
    await submit('#inbox [data-form="login"]');
    await until(() => read(`!!window.__r3d.inbox.loginError`), 'error de contraseña');
    ok(await read(`window.__r3d.inbox.mode === 'login'`), 'contraseña incorrecta no inicia sesión');
    await fill('#inbox [name="password"]', password);
    await submit('#inbox [data-form="login"]');
    await until(() => read(`window.__r3d.inbox.mode === 'ready' && window.__r3d.inbox.boot && window.__r3d.inbox.list.loaded`), 'bandeja autenticada');
    ok(await read(`window.__r3d.inbox.list.items.some(x => x.id === ${anaChat.id})`), 'ingreso carga conversaciones y canales');
    const state = await capture.client.state();
    if (state.canRemember) {
      const config = fs.readFileSync(process.env.R3D_INBOX_CONFIG, 'utf8');
      ok(state.hasSavedPassword && !config.includes(password), 'Recordarme cifra la contraseña fuera del renderer');
      fs.copyFileSync(process.env.R3D_INBOX_CONFIG, path.join(out, 'startup-test.json'));
      const resumeConfig = path.join(out, 'resume-test.json');
      fs.copyFileSync(process.env.R3D_INBOX_CONFIG, resumeConfig);
      const fresh = createInboxClient({ configFile: resumeConfig, safeStorage });
      const resumed = await fresh.resume();
      ok(resumed.ok && (await fresh.request('GET', '/inbox/summary')).ok, 'sesión guardada se reanuda en un cliente nuevo');
      await fresh.logout();
    } else ok(!state.hasSavedPassword, 'sin cifrado disponible no se guarda la contraseña');
    await capture.poll();
    await run('window.__r3d.showHome()');
    await wait(1200);
    await sendWebhook(hook, pedro, 'text', { body: 'Hola, quiero una lámpara de prueba.' });
    const pedroChat = await findConversation(pedro.name);
    await capture.poll();
    await until(() => capture.notifications.some((item) => item.conversationId === pedroChat.id), 'notificación de Pedro');
    ok(await read(`!document.getElementById('homeInboxBadge').hidden`), 'aviso y contador se actualizan con Mensajes cerrado');
    capture.click(capture.notifications.findIndex((item) => item.conversationId === pedroChat.id));
    await until(() => read(`!document.getElementById('inbox').hidden && window.__r3d.inbox.detail?.conversation?.id === ${pedroChat.id}`), 'abrir chat desde notificación');
    ok(true, 'clic en el aviso abre la conversación correcta');
    await until(() => read(`window.__r3d.inbox.list.items.some(x => x.id === ${anaChat.id})`), 'lista de conversaciones');
    await openConversation(anaChat.id);
    await until(() => read(`window.__r3d.inbox.detail?.conversation?.unread_count === 0`), 'lectura del chat');
    await fill(composer, 'Borrador que no se debe perder');
    await openConversation(pedroChat.id);
    await openConversation(anaChat.id);
    ok(await read(`document.querySelector(${JSON.stringify(composer)}).value === 'Borrador que no se debe perder'`),
      'borrador se conserva al cambiar de conversación');
    await fill(composer, '');
    const theme = process.env.R3D_TEST_THEME || 'light';
    const contrast = await read(`(() => {
      const luminance = color => color.match(/[\\d.]+/g).slice(0, 3).map(Number)
        .map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; })
        .reduce((n, value, i) => n + value * [.2126, .7152, .0722][i], 0);
      return ['#inbox .ib-title', '#inbox [data-r="composer-text"]'].every(selector => {
        const el = document.querySelector(selector); let bg = el;
        while (bg && getComputedStyle(bg).backgroundColor === 'rgba(0, 0, 0, 0)') bg = bg.parentElement;
        const a = luminance(getComputedStyle(el).color), b = luminance(getComputedStyle(bg).backgroundColor);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5;
      });
    })()`);
    ok(contrast && await read(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`),
      `tema ${theme} aplicado con contraste legible`);
    await screenshot('01-chat');

    await fill(composer, `/e2e${unique}`);
    ok(await read(`!!document.querySelector('#inbox [data-slash="0"]')`), 'atajo muestra la respuesta guardada');
    await run(`document.querySelector(${JSON.stringify(composer)}).dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}))`);
    ok(await read(`document.querySelector(${JSON.stringify(composer)}).value.includes('Hola Ana') && document.querySelector(${JSON.stringify(composer)}).value.includes('[PRECIO]')`), 'respuesta sustituye nombre y conserva el precio pendiente');
    await submit('#inbox [data-form="send"]');
    ok(await read(`!!document.querySelector('#inbox [data-feedback]') && document.querySelector(${JSON.stringify(composer)}).value.includes('[PRECIO]')`), 'no envía marcadores pendientes');
    await sendText('Hola Ana, cuesta $12.000.');
    await click('#inbox [data-act="picker"][data-key="stickers"]');
    await until(() => read(`!!document.querySelector('#inbox [data-act="sticker"][data-id="${sticker.id}"]')`), 'sticker');
    await click(`#inbox [data-act="sticker"][data-id="${sticker.id}"]`);
    await until(() => read(`window.__r3d.inbox.detail?.messages?.some(m => m.direction === 'out' && m.kind === 'sticker')`), 'sticker enviado');
    ok(true, 'respuesta y sticker se envían por el canal simulado');

    await attach('foto-e2e.png', 'image/png', png);
    await until(() => read(`!!document.querySelector('#inbox [data-attachment]')`), 'adjunto de foto');
    await fill(composer, 'Foto de prueba');
    await submit('#inbox [data-form="send"]');
    await waitMessage('Foto de prueba');
    await attach('catalogo-e2e.pdf', 'application/pdf', pdf);
    await until(() => read(`!!document.querySelector('#inbox [data-attachment]')`), 'adjunto PDF');
    await fill(composer, 'Documento de prueba');
    await submit('#inbox [data-form="send"]');
    await waitMessage('Documento de prueba');
    await attach('programa.exe', 'application/octet-stream', Buffer.from('not an executable'));
    await until(() => read(`!!document.querySelector('#inbox [data-feedback]')`), 'rechazo de archivo');
    ok(await read(`!document.querySelector('#inbox [data-attachment]')`), 'envía foto y PDF, pero bloquea extensiones no permitidas');

    await sendWebhook(hook, ana, 'image', { id: 'wa-media-e2e', mime_type: 'image/jpeg', caption: 'Imagen recibida E2E' });
    await run('window.__r3d.inbox.loadDetail(false)');
    const incomingImage = await until(() => read(`window.__r3d.inbox.detail?.messages?.find(m => m.direction === 'in' && m.kind === 'image' && m.body?.includes('Imagen recibida E2E'))?.id`), 'mensaje de foto recibido');
    const imageButton = `#inbox [data-message="${incomingImage}"] [data-act="zoom"]`;
    await until(() => read(`(() => { const img = document.querySelector(${JSON.stringify(imageButton)} + ' img[src^="blob:"]'); return img?.complete && img.naturalWidth > 0; })()`), 'foto recibida');
    await click(imageButton);
    ok(await read(`!!document.querySelector('#inbox [role="dialog"] img[src^="blob:"]')`), 'visor amplía una imagen autenticada');
    await click('#inbox [role="dialog"] [data-act="save-media"]');
    const download = await until(() => fs.readdirSync(process.env.R3D_AUTOSAVE_DIR)[0], 'archivo descargado');
    ok(fs.readFileSync(path.join(process.env.R3D_AUTOSAVE_DIR, download)).subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
      'la descarga contiene la foto JPEG recibida');
    await click('#inbox [role="dialog"] [data-act="close-lightbox"]');
    ok(true, 'imagen recibida se puede guardar');
    const linkProviderId = await sendWebhook(hook, ana, 'text', { body: 'Enlace E2E https://example.com/e2e <img src=x onerror=alert(1)>' });
    await run('window.__r3d.inbox.loadDetail(false)');
    const linkMessage = await until(() => read(`window.__r3d.inbox.detail?.messages?.find(m => m.body?.includes('Enlace E2E'))?.id`), 'enlace recibido');
    ok(await read(`!document.querySelector('#inbox [data-message="${linkMessage}"] .ib-text img') && document.querySelector('#inbox [data-message="${linkMessage}"] .ib-text').textContent.includes('<img')`),
      'texto de cliente se muestra sin interpretar HTML');
    await click(`#inbox [data-message="${linkMessage}"] [data-act="link"]`);
    await until(() => capture.opened.includes('https://example.com/e2e'), 'enlace externo');

    await until(() => fs.existsSync(fakeLog) && fs.readFileSync(fakeLog, 'utf8').split('\n').some((line) => {
      try { const call = JSON.parse(line); return call.json?.status === 'read' && call.json.message_id === linkProviderId; }
      catch { return false; }
    }), 'acuse de lectura del proveedor simulado');
    await until(() => read(`window.__r3d.inbox.detail?.conversation?.unread_count === 0 && !window.__r3d.inbox.busy.has('send')`), 'chat leído antes del fallo');
    fs.writeFileSync(control, JSON.stringify({ fail: [{ pattern: `POST .*/${WA_PHONE}/messages$`, times: 1, status: 500, body: { error: { message: 'Servicio temporal E2E', code: 2 } } }] }));
    await sendText('Prueba de reintento E2E', 'failed');
    await until(() => read(`!!document.querySelector('#inbox [data-act="retry"]')`), 'mensaje fallido');
    const failedId = await read(`Number(document.querySelector('#inbox [data-act="retry"]').dataset.id)`);
    fs.writeFileSync(control, JSON.stringify({ fail: [] }));
    await click(`#inbox [data-act="retry"][data-id="${failedId}"]`);
    await until(() => read(`window.__r3d.inbox.detail?.messages?.some(m => m.id === ${failedId} && ['sent', 'delivered', 'read'].includes(m.status))`), 'reintento exitoso');
    ok(true, 'error del proveedor se muestra y se reintenta sin duplicar');

    await request('PATCH', `/inbox/channels/${channel.channel.id}`, { status: 'paused' });
    await run('window.__r3d.inbox.loadBoot()');
    await until(() => read(`window.__r3d.inbox.channel(window.__r3d.inbox.detail.conversation)?.status === 'paused'`), 'canal en pausa');
    ok(await read(`document.querySelector(${JSON.stringify(composer)}).disabled && document.querySelector('#inbox [data-r="notices"]').textContent.includes('pausa')`),
      'un canal en pausa impide responder y explica por qué');
    await request('PATCH', `/inbox/channels/${channel.channel.id}`, { status: 'active' });
    await run('window.__r3d.inbox.loadBoot()');
    await until(() => read(`!document.querySelector(${JSON.stringify(composer)}).disabled`), 'canal reactivado');
    await click('#inbox [data-act="edit-customer"]');
    await fill('#inbox [data-form="customer"] [name="name"]', `Ana Editada ${unique}`);
    await fill('#inbox [data-form="customer"] [name="tags"]', 'regalo, urgente');
    await fill('#inbox [data-form="customer"] [name="note"]', 'Nota interna E2E');
    await submit('#inbox [data-form="customer"]');
    await until(() => read(`window.__r3d.inbox.detail?.conversation?.note === 'Nota interna E2E'`), 'datos del cliente');
    await click('#inbox [data-act="status"][data-status="pending"]');
    await until(() => read(`window.__r3d.inbox.detail?.conversation?.status === 'pending'`), 'estado pendiente');
    await click('#inbox [data-act="status"][data-status="open"]');
    await until(() => read(`window.__r3d.inbox.detail?.conversation?.status === 'open'`), 'conversación reabierta');
    await click('#inbox [data-act="status"][data-status="closed"]');
    await until(() => read(`window.__r3d.inbox.detail?.conversation?.status === 'closed'`), 'conversación cerrada');
    await click('#inbox [data-act="view"][data-view="closed"]');
    await until(() => read(`window.__r3d.inbox.list.loaded && window.__r3d.inbox.list.items.some(x => x.id === ${anaChat.id})`), 'filtro de cerradas');
    await click('#inbox [data-act="status"][data-status="open"]');
    await until(() => read(`window.__r3d.inbox.detail?.conversation?.status === 'open'`), 'reabrir conversación cerrada');
    await click('#inbox [data-act="view"][data-view="bandeja"]');
    await until(() => read(`window.__r3d.inbox.list.loaded && window.__r3d.inbox.list.items.some(x => x.id === ${anaChat.id})`), 'filtro de bandeja');
    ok(await read(`window.__r3d.inbox.detail.conversation.tags.includes('urgente')`), 'edición de cliente, etiquetas y estados persiste');

    await tool('catalogo');
    await until(() => read(`!!document.querySelector('#inbox [data-product="${product.id}"]')`), 'producto del catálogo');
    await click(`#inbox [data-product="${product.id}"] [data-act="paste"]`);
    ok(await read(`document.querySelector(${JSON.stringify(composer)}).value.includes('Llavero')`), 'catálogo pega el producto sin enviarlo');
    await fill(composer, '');
    await tool('precios');
    await until(() => read(`!!document.querySelector('#inbox .ib-price-list')`), 'lista de precios');
    await click('#inbox [data-r="tool-body"] [data-act="paste"]');
    ok(await read(`document.querySelector(${JSON.stringify(composer)}).value.length > 10`), 'lista de precios se puede pegar');
    await fill(composer, '');
    await tool('cotizaciones');
    await until(() => read(`!!document.querySelector('#inbox [data-local-quote="${localQuote.id}"]') && !!document.querySelector('#inbox [data-web-quote="${webQuote.id}"]')`), 'cotizaciones local y web');
    const expectedTotal = `$${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(Number(localQuote.result.total))}`;
    ok(await read(`!document.querySelector('#inbox [data-web-quote="${localQuote.id}"]') && document.querySelector('#inbox [data-local-quote="${localQuote.id}"] .ib-total')?.textContent === ${JSON.stringify(expectedTotal)}`), 'cotizaciones muestran total decimal y evitan duplicados sincronizados');
    await click(`#inbox [data-local-quote="${localQuote.id}"] [data-act="paste"]`);
    ok(await read(`document.querySelector(${JSON.stringify(composer)}).value.includes(${JSON.stringify(localQuote.number)})`), 'cotización emitida se pega en el chat');
    await fill(composer, '');
    await tool('calculadora');
    await fill('#inbox [data-calc="expr"]', '15000 * 12 - 10%');
    ok(await read(`document.querySelector('#inbox [data-calc-result]')?.textContent.includes('162.000')`), 'calculadora aplica porcentaje correctamente');
    await fill('#inbox [data-line="0"][data-field="name"]', 'Llaveros');
    await fill('#inbox [data-line="0"][data-field="quantity"]', '2');
    await fill('#inbox [data-line="0"][data-field="unitPrice"]', '12000');
    await until(() => read(`document.querySelector('#inbox [data-order-text]')?.textContent.includes('24.000')`), 'resumen del pedido');
    await tool('archivos');
    await until(() => read(`!!document.querySelector('#inbox [data-quick-link="${quick.id}"]')`), 'archivo rápido');
    await click(`#inbox [data-quick-link="${quick.id}"] [data-act="send-asset"]`);
    await until(() => read(`window.__r3d.inbox.detail?.messages?.some(m => m.direction === 'out' && m.kind === 'file' && m.media_name === 'catalogo-e2e.pdf')`), 'archivo rápido enviado');
    ok(true, 'calculadora, pedido y archivos rápidos funcionan');
    await screenshot('02-herramientas');

    await sendMetaMessage(hook, 'page', PAGE_ID, '24000000000000001', `Mensaje Messenger E2E ${unique}`);
    await sendMetaMessage(hook, 'instagram', INSTAGRAM_ID, '17800000000000001', `Mensaje Instagram E2E ${unique}`);
    await sendTikTokMessage(new URL(settings.webhook_urls.tiktok).pathname, `Mensaje TikTok E2E ${unique}`);
    const messengerChat = await findPlatform('messenger');
    const instagramChat = await findPlatform('instagram');
    const tiktokChat = await findPlatform('tiktok');
    await run('window.__r3d.inbox.reloadList(false)');
    await until(() => read(`[${messengerChat.id}, ${instagramChat.id}, ${tiktokChat.id}].every(id => window.__r3d.inbox.list.items.some(x => x.id === id))`), 'las otras tres redes');
    await openConversation(messengerChat.id);
    await sendText(`Respuesta Messenger E2E ${unique}`);
    await openConversation(instagramChat.id);
    const previousIds = await read(`window.__r3d.inbox.detail.messages.map(m => m.id)`);
    const longInstagram = `Instagram ${unique} ` + '😀'.repeat(260);
    await fill(composer, longInstagram);
    await submit('#inbox [data-form="send"]');
    const parts = await until(() => read(`(() => { const items = window.__r3d.inbox.detail?.messages?.filter(m => m.direction === 'out' && !${JSON.stringify(previousIds)}.includes(m.id)) || [];
      return !window.__r3d.inbox.busy.has('send') && items.length >= 2 && items.every(m => m.status === 'sent') ? items.map(m => m.body) : null; })()`), 'mensaje largo de Instagram');
    ok(parts.join('') === longInstagram, 'Messenger responde e Instagram divide texto por límite UTF-8 sin perder contenido');
    await openConversation(tiktokChat.id);
    ok(await read(`document.querySelector('#inbox [data-act="attach"]').disabled && document.querySelector('#inbox [data-act="picker"][data-key="stickers"]').disabled`),
      'TikTok bloquea adjuntos cuando no están habilitados');
    await sendText(`Respuesta TikTok E2E ${unique}`);
    await request('PATCH', `/inbox/channels/${tiktok.id}`, { options: { image_send: true } });
    await run('window.__r3d.inbox.loadBoot(); window.__r3d.inbox.loadDetail(false)');
    await until(() => read(`window.__r3d.inbox.detail?.capabilities?.images === true && !document.querySelector('#inbox [data-act="attach"]').disabled`), 'fotos habilitadas en TikTok');
    const oldTikTokIds = await read(`window.__r3d.inbox.detail.messages.map(m => m.id)`);
    await attach('foto-tiktok-e2e.png', 'image/png', png);
    await until(() => read(`!!document.querySelector('#inbox [data-attachment]')`), 'foto para TikTok');
    await submit('#inbox [data-form="send"]');
    await until(() => read(`window.__r3d.inbox.detail?.messages?.some(m => m.direction === 'out' && !${JSON.stringify(oldTikTokIds)}.includes(m.id) && m.kind === 'image' && m.status === 'sent')`), 'foto enviada a TikTok');
    ok(true, 'TikTok responde y envía fotos solo después de habilitarlas');
    await openConversation(anaChat.id);

    await fill('#inbox [data-r="search"]', `Ana Editada ${unique}`);
    await until(() => read(`window.__r3d.inbox.list.loaded && window.__r3d.inbox.list.items.length === 1 && window.__r3d.inbox.list.items[0].id === ${anaChat.id}`), 'búsqueda de cliente');
    await fill('#inbox [data-r="search"]', '');
    await until(() => read(`window.__r3d.inbox.list.loaded && window.__r3d.inbox.list.items.some(x => x.id === ${pedroChat.id})`), 'restaurar lista');
    capture.client.invalidateToken();
    await click('#inbox [data-act="refresh"]');
    await until(() => read(`window.__r3d.inbox.mode === 'ready' && !window.__r3d.inbox.list.loading && !window.__r3d.inbox.list.error`), 'renovación de sesión');
    ok((await capture.client.request('GET', '/inbox/summary')).ok, 'token rechazado se renueva sin perder la sesión');
    await click(`#inbox [data-r="chat-head"] [data-act="web"]`);
    await until(() => capture.opened.some((url) => url.endsWith(`/app/mensajes/${anaChat.id}`)), 'enlace al chat web');
    const blocked = await read(`window.r3dInbox.openLink('file:///C:/e2e')`);
    ok(!blocked.ok && blocked.status === 400, 'enlace web correcto y apertura de file: bloqueada');

    win.setContentSize(1100, 750);
    await wait(400);
    ok(await read(`(() => { const b=document.querySelector('#inbox [data-r="body"]'); return b.scrollWidth <= b.clientWidth + 2; })()`), 'vista estrecha no desborda horizontalmente');
    await screenshot('03-estrecho');
    await run('window.__r3d.showHome()');
    await click('#homeGridSocial [data-mod="inbox"]');
    await until(() => read(`window.__r3d.inbox.mode === 'ready' && window.__r3d.inbox.detail?.conversation?.id === ${anaChat.id}`), 'volver a Mensajes');
    ok(true, 'cerrar y volver conserva la conversación');
    await capture.poll();
    await wait(1200);
    await sendWebhook(hook, pedro, 'text', { body: `Nuevo mensaje antes de salir ${unique}` });
    await until(async () => (await findConversation(pedro.name)).last_message_preview?.includes(`antes de salir ${unique}`), 'mensaje sin leer antes de salir');
    const requestBeforeLogout = capture.client.request;
    let unblock, intercepted;
    const gate = new Promise((resolve) => { unblock = resolve; });
    const started = new Promise((resolve) => { intercepted = resolve; });
    let summaryBlocked = false;
    capture.client.request = async (...args) => {
      const result = await requestBeforeLogout(...args);
      if (!summaryBlocked && args[1] === '/inbox/summary') { summaryBlocked = true; intercepted(); await gate; }
      return result;
    };
    const pendingPoll = capture.poll();
    await Promise.race([started, wait(10000).then(() => { throw new Error('No se interceptó el resumen pendiente'); })]);
    await click('#inbox [data-act="logout"]');
    await until(() => read(`window.__r3d.inbox.mode === 'login'`), 'cierre de sesión');
    const notificationsBefore = capture.notifications.length;
    unblock();
    await pendingPoll;
    capture.client.request = requestBeforeLogout;
    await wait(200);
    ok(await read(`document.getElementById('homeInboxBadge').hidden`) && capture.notifications.length === notificationsBefore,
      'un resumen anterior no reaparece ni notifica después de cerrar sesión');
    ok(!(await capture.client.state()).hasSavedPassword, 'cerrar sesión borra la contraseña guardada');

    await fill('#inbox [name="email"]', email);
    await fill('#inbox [name="password"]', password);
    await submit('#inbox [data-form="login"]');
    await until(() => read(`window.__r3d.inbox.mode === 'ready' && window.__r3d.inbox.summary`), 'ingreso para probar cambio de sesión');
    await run(`(() => { window.__e2eInboxPushes = []; window.r3dInbox.onSummary((payload) => window.__e2eInboxPushes.push(payload)); return true; })()`);
    await until(async () => { await capture.poll(); return read(`window.__e2eInboxPushes.length > 0`); }, 'resumen inicial para cambio de sesión');
    const requestBeforeSwitch = capture.client.request;
    let releaseSwitch, interceptSwitch, switchBlocked = false;
    const switchGate = new Promise((resolve) => { releaseSwitch = resolve; });
    const switchStarted = new Promise((resolve) => { interceptSwitch = resolve; });
    capture.client.request = async (...args) => {
      const result = await requestBeforeSwitch(...args);
      if (!switchBlocked && args[1] === '/inbox/summary') {
        switchBlocked = true;
        interceptSwitch();
        await switchGate;
        return { ...result, data: { ...result.data, unread_conversations: 987 } };
      }
      return result;
    };
    const pendingSwitch = capture.poll();
    await Promise.race([switchStarted, wait(10000).then(() => { throw new Error('No se interceptó el resumen de la sesión anterior'); })]);
    await click('#inbox [data-act="logout"]');
    await until(() => read(`window.__r3d.inbox.mode === 'login'`), 'salida para cambio de sesión');
    await fill('#inbox [name="email"]', email);
    await fill('#inbox [name="password"]', password);
    await submit('#inbox [data-form="login"]');
    await until(() => read(`window.__r3d.inbox.mode === 'ready' && window.__r3d.inbox.summary`), 'nueva sesión con resumen pendiente');
    await run(`window.__e2eInboxPushes = []`);
    releaseSwitch();
    await pendingSwitch;
    await until(() => read(`window.__e2eInboxPushes.some(p => p.signedIn && p.summary)`), 'resumen de la nueva sesión');
    ok(await read(`window.__e2eInboxPushes.every(p => p.summary?.unread_conversations !== 987)`),
      'cambiar de sesión descarta el resumen anterior y consulta el nuevo');
    capture.client.request = requestBeforeSwitch;
    await click('#inbox [data-act="logout"]');
    await until(() => read(`window.__r3d.inbox.mode === 'login'`), 'salida final');

    web = new BrowserWindow({ show: false, width: 1300, height: 900,
      webPreferences: { preload: path.join(__dirname, 'web-like-preload.cjs'), contextIsolation: true, sandbox: false, partition: 'e2e-inbox-web-like' } });
    await web.loadFile(path.join(__dirname, '..', '..', 'src', 'index.html'));
    await until(() => read(`!!window.__r3d && !!document.querySelector('#homeGridSocial')`, web.webContents), 'versión tipo web');
    ok(await read(`typeof window.r3dInbox === 'undefined' && !document.querySelector('#homeGridSocial [data-mod="inbox"]')`, web.webContents), 'la versión web no ofrece el módulo exclusivo de escritorio');
    ok(!errors.length, `sin errores de consola${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log('[e2e] done');
  } catch (error) {
    try { await screenshot('fallo'); } catch { /* preserve the original error */ }
    throw error;
  } finally {
    fs.writeFileSync(control, originalControl);
    if (web && !web.isDestroyed()) web.destroy();
  }
};

// Mensajes · Pabonitas (solo escritorio): cliente del proceso principal para la bandeja de la web (pabonitas.co).
// El formulario envía la contraseña por IPC al iniciar sesión; el token no vuelve al renderer. Las rutas que el renderer
// puede pedir (window.r3dInbox) se comparan con una lista cerrada. Los ajustes y canales se manejan en la web.
// <userData>/mensajes.json guarda servidor, empresa, correo y preferencias; la contraseña solo si se marca «Recordarme»,
// cifrada con safeStorage (DPAPI en Windows). El token vive en memoria y se renueva solo antes de vencer.
// Cada método responde { ok: true, data } o { ok: false, status, detail } (status 0 = sin conexión): no lanza por HTTP.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_SERVER = 'https://pabonitas.co';
const DEFAULT_TENANT = 'pabonitas';
const API = '/api/v1';
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MAX_BODY_CHARS = 64 * 1024;
const RENEW_BEFORE_MS = 60_000;
const FALLBACK_TOKEN_MS = 10 * 60_000;
const ID = '[1-9][0-9]{0,17}';
const TENANT = /^[a-z0-9-]{2,60}$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// Pestañas de /app/mensajes/ajustes/<pestaña> en la web.
const SETTINGS_TABS = ['canales', 'automaticos', 'respuestas', 'stickers', 'archivos'];

const TEXTS = {
  server: 'La dirección del servidor no es válida: usa https://… (por ejemplo https://pabonitas.co).',
  tenant: 'Escribe el código de la empresa: minúsculas, números o guiones (por ejemplo pabonitas).',
  email: 'Escribe un correo válido.',
  password: 'Escribe tu contraseña.',
  signIn: 'Inicia sesión en Mensajes para continuar.',
  temporary: 'Tu contraseña es temporal. Cámbiala primero en la web y vuelve a entrar aquí.',
  badSession: 'El servidor no devolvió una sesión válida. Revisa la dirección del servidor.',
  unexpected: 'El servidor respondió algo inesperado. Revisa la dirección del servidor.',
  redirect: 'El servidor respondió con una redirección. Revisa la dirección (por ejemplo https://pabonitas.co).',
  timeout: 'El servidor tardó demasiado en responder. Intenta de nuevo.',
  route: 'Ruta de la bandeja no permitida.',
  body: 'Los datos enviados no son válidos.',
  media: 'Ese archivo no es de tu bandeja.',
  mediaSize: 'El archivo pesa más de 25 MB: ábrelo en la web.',
  upload: 'Elige un archivo para subir.',
  uploadSize: 'El archivo pesa más de 15 MB. Súbelo a Drive y guarda el enlace.',
};

// Lo único que puede pedir el renderer: [método, ruta (sin /api/v1), parámetros de consulta permitidos].
const ROUTES = [
  ['GET', /^\/inbox\/bootstrap$/, []],
  ['GET', /^\/inbox\/summary$/, []],
  ['GET', /^\/inbox\/conversations$/, ['view', 'platform', 'q', 'offset']],
  ['GET', new RegExp(`^/inbox/conversations/${ID}$`), ['before_id']],
  ['PATCH', new RegExp(`^/inbox/conversations/${ID}$`), []],
  ['POST', new RegExp(`^/inbox/conversations/${ID}/(?:read|messages|render)$`), []],
  ['POST', new RegExp(`^/inbox/messages/${ID}/retry$`), []],
  ['GET', /^\/inbox\/tools\/catalog$/, ['q', 'category']],
  ['GET', /^\/inbox\/tools\/prices$/, []],
  ['GET', /^\/inbox\/tools\/quotes$/, ['q']],
  ['GET', /^\/users\/me$/, []],
];
// Adjuntos: el de un cliente va con sesión; lo que enviamos nosotros y las fotos del catálogo son enlaces públicos firmados.
const MEDIA_PRIVATE = new RegExp(`^/inbox/messages/${ID}/media$`);
const MEDIA_PUBLIC = new RegExp(`^${API}/public/inbox-media/[A-Za-z0-9_-]{8,128}/${ID}\\.[a-z0-9]{1,8}(?:\\?[A-Za-z0-9=&_.%-]{1,300})?$`);
const ASSET_PUBLIC = new RegExp(`^${API}/public/assets/${ID}/content\\?variant=[a-z]{1,20}$`);
const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a', 'audio/aac': 'aac', 'video/mp4': 'mp4', 'application/pdf': 'pdf',
};

const fail = (status, detail) => ({ ok: false, status, detail });

/** Ruta permitida y normalizada ({ method, path }) o null. */
function allowedRoute(method, route) {
  if (typeof method !== 'string' || typeof route !== 'string' || route.length > 600) return null;
  const match = /^(\/[A-Za-z0-9/_-]*)(?:\?([^#\s]*))?$/.exec(route);
  if (!match) return null;
  const [, pathname, query = ''] = match;
  const verb = method.toUpperCase();
  const rule = ROUTES.find(([ruleMethod, pattern]) => ruleMethod === verb && pattern.test(pathname));
  if (!rule) return null;
  const params = new URLSearchParams(query);
  const seen = new Set();
  for (const [key, value] of params) {
    if (!rule[2].includes(key) || seen.has(key) || value.length > 200) return null;
    seen.add(key);
  }
  const search = params.toString();
  return { method: verb, path: search ? `${pathname}?${search}` : pathname };
}

/** Origen del servidor (https, o http solo en este equipo) o null. «pabonitas.co» se entiende como https://pabonitas.co. */
function normalizeServer(value) {
  let text = String(value ?? '').trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
  return url.origin;
}

function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Nombre de archivo seguro para guardarlo en Windows (sin rutas, reservados ni saltos de línea). */
function cleanFileName(value, max = 120) {
  const text = String(value ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  const name = [...text].slice(0, max).join('').replace(/[.\s]+$/, '');
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name) ? `_${name}` : name;
}

function dispositionName(header) {
  if (!header) return '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* nombre mal codificado: se usa el de respaldo */
    }
  }
  const plain = /filename="([^"]*)"/i.exec(header) || /filename=([^;]+)/i.exec(header);
  return plain ? plain[1].trim() : '';
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return null;
}

// --- Avisos de mensajes nuevos (proceso principal, sin la UI abierta) ---

/** Milisegundos de una fecha del backend (sin zona = UTC, igual que la web). */
function inboundTime(value) {
  if (typeof value !== 'string' || !value) return null;
  const text = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
}

/** Igual que conversationTitle de src/core/inbox.js (el proceso principal no carga módulos ESM). */
function chatTitle(item) {
  const name = typeof item.display_name === 'string' ? item.display_name.trim() : '';
  if (name) return name;
  const username = typeof item.username === 'string' ? item.username.trim().replace(/^@+/, '') : '';
  if (username) return `@${username}`;
  const phone = typeof item.phone === 'string' ? item.phone.trim() : '';
  return phone || `Cliente de ${item.platform_label || 'la bandeja'}`;
}

/**
 * Aviso a mostrar si el resumen trae un mensaje de cliente más nuevo que `previous` (ms o null si no había ninguno):
 * { conversationId, title, body } con la conversación sin leer más reciente; null si no hay nada nuevo.
 */
function newInboundAlert(previous, summary) {
  const latest = inboundTime(summary?.latest_inbound_at);
  if (latest === null || (previous !== null && previous !== undefined && latest <= previous)) return null;
  if (!(Number(summary.unread_messages) > 0)) return null;
  const items = Array.isArray(summary.recent_unread) ? summary.recent_unread.filter((item) => item && item.id) : [];
  const item = items.reduce((best, entry) => ((inboundTime(entry.last_inbound_at) ?? 0) > (inboundTime(best?.last_inbound_at) ?? -1) ? entry : best), null);
  if (!item) return null;
  const preview = typeof item.last_message_preview === 'string' ? item.last_message_preview.replace(/\s+/g, ' ').trim() : '';
  return {
    conversationId: item.id,
    title: `${chatTitle(item)} · ${item.platform_label || 'Mensajes'}`,
    body: [...(preview || 'Te escribió un mensaje nuevo.')].slice(0, 160).join(''),
  };
}

function createInboxClient({ configFile, fetch: fetchImpl = globalThis.fetch, safeStorage = null, timeoutMs = 30_000, transferTimeoutMs = 120_000, now = Date.now }) {
  let config = null;
  let loading = null;
  let writing = Promise.resolve();
  let session = null; // { server, tenant, email, password, token, expires, me }
  let generation = 0;
  let renewing = null;
  let resuming = null;

  const defaults = () => ({ server: DEFAULT_SERVER, tenant: DEFAULT_TENANT, email: '', remember: true, notify: true, password_enc: null });

  function cleanConfig(data) {
    const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    return {
      server: normalizeServer(source.server) || DEFAULT_SERVER,
      tenant: typeof source.tenant === 'string' && TENANT.test(source.tenant) ? source.tenant : DEFAULT_TENANT,
      email: typeof source.email === 'string' ? source.email.trim().slice(0, 254) : '',
      remember: source.remember !== false,
      notify: source.notify !== false,
      password_enc: typeof source.password_enc === 'string' && source.password_enc ? source.password_enc : null,
    };
  }

  function loaded() {
    if (config) return Promise.resolve(config);
    loading ??= fs.readFile(configFile, 'utf8')
      .then((raw) => cleanConfig(JSON.parse(raw.replace(/^\uFEFF/, ''))))
      .catch(() => defaults())
      .then((value) => (config = value));
    return loading;
  }

  // Escritura atómica y en fila (dos guardados seguidos no se pisan). Si el disco falla, la sesión sigue en memoria.
  function save() {
    const snapshot = `${JSON.stringify(config, null, 2)}\n`;
    writing = writing.then(async () => {
      await fs.mkdir(path.dirname(configFile), { recursive: true });
      const temp = `${configFile}.${process.pid}.tmp`;
      await fs.writeFile(temp, snapshot, 'utf8');
      await fs.rename(temp, configFile);
    }).catch((err) => console.error('[mensajes] No pude guardar', configFile, err.message));
    return writing;
  }

  function canRemember() {
    try {
      return Boolean(safeStorage?.isEncryptionAvailable());
    } catch {
      return false;
    }
  }
  const encrypt = (password) => safeStorage.encryptString(password).toString('base64');
  function decrypt(value) {
    try {
      return canRemember() ? safeStorage.decryptString(Buffer.from(value, 'base64')) : null;
    } catch {
      return null;
    }
  }

  // Una llamada HTTP con límite de tiempo. json: cuerpo JSON; form: FormData; binary: devuelve { mime, name, bytes }.
  async function call(server, method, route, { json, form, token, binary = false } = {}) {
    const headers = { Accept: binary ? '*/*' : 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) body = form;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), binary || form ? transferTimeoutMs : timeoutMs);
    try {
      const url = `${server}${route.startsWith(`${API}/`) ? route : API + route}`;
      const response = await fetchImpl(url, { method, headers, body, signal: controller.signal, redirect: 'manual' });
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) return fail(response.status || 302, TEXTS.redirect);
      if (binary && response.ok) {
        if (Number(response.headers.get('content-length')) > MAX_MEDIA_BYTES) return fail(413, TEXTS.mediaSize);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_MEDIA_BYTES) return fail(413, TEXTS.mediaSize);
        const mime = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
        const fallback = path.posix.basename(route.split('?')[0]);
        let name = cleanFileName(dispositionName(response.headers.get('content-disposition')));
        if (!name) name = /\.[a-z0-9]{1,8}$/i.test(fallback) ? fallback : `archivo${MIME_EXTENSIONS[mime] ? `.${MIME_EXTENSIONS[mime]}` : ''}`;
        return { ok: true, status: response.status, data: { mime, name, bytes } };
      }
      const text = await response.text();
      let data = null;
      let parsed = !text;
      if (text) {
        try {
          data = JSON.parse(text);
          parsed = true;
        } catch {
          /* respuesta que no es JSON */
        }
      }
      if (!response.ok) return fail(response.status, typeof data?.detail === 'string' ? data.detail : null);
      return parsed ? { ok: true, status: response.status, data } : fail(502, TEXTS.unexpected);
    } catch {
      return fail(0, controller.signal.aborted ? TEXTS.timeout : null);
    } finally {
      clearTimeout(timer);
    }
  }

  // Inicia sesión en el servidor: { ok, data: { token, expires, me } }.
  async function authenticate({ server, tenant, email, password }) {
    const result = await call(server, 'POST', '/auth/login', { json: { email, password, tenant_slug: tenant } });
    if (!result.ok) return result;
    const token = result.data?.access_token;
    if (typeof token !== 'string' || !token) return fail(502, TEXTS.badSession);
    if (result.data.must_change_password) return fail(403, TEXTS.temporary);
    const expires = tokenExpiry(token) ?? now() + FALLBACK_TOKEN_MS;
    const me = await call(server, 'GET', '/users/me', { token });
    const user = me.ok && me.data ? me.data : {};
    return {
      ok: true,
      data: {
        token,
        expires,
        me: { id: Number.isInteger(user.id) ? user.id : null, name: typeof user.name === 'string' ? user.name : '', email: typeof user.email === 'string' ? user.email : email },
      },
    };
  }

  async function forgetSavedPassword() {
    const current = await loaded();
    if (!current.password_enc) return;
    config = { ...current, password_enc: null };
    await save();
  }

  // Renueva el token con la contraseña en memoria; una sola vez aunque lo pidan varias llamadas a la vez.
  function renew() {
    if (!session) return Promise.resolve(fail(401, TEXTS.signIn));
    if (!renewing) {
      const target = session;
      renewing = authenticate(target)
        .then(async (result) => {
          if (session !== target) return fail(401, TEXTS.signIn);
          if (result.ok) {
            Object.assign(target, result.data);
            return { ok: true };
          }
          if (result.status === 401 || result.status === 403) {
            session = null;
            await forgetSavedPassword();
          }
          return result;
        })
        .finally(() => {
          renewing = null;
        });
    }
    return renewing;
  }

  async function ensureToken() {
    if (!session) return fail(401, TEXTS.signIn);
    if (session.token && session.expires - now() > RENEW_BEFORE_MS) return { ok: true };
    return renew();
  }

  // Llamada con sesión: si el servidor responde 401 se renueva el token una vez y se repite.
  async function authed(method, route, options = {}) {
    const target = session;
    if (!target) return fail(401, TEXTS.signIn);
    const ready = await ensureToken();
    if (!ready.ok) return ready;
    if (session !== target) return fail(401, TEXTS.signIn);
    const used = target.token;
    const result = await call(target.server, method, route, { ...options, token: used });
    if (session !== target) return fail(401, TEXTS.signIn);
    if (result.status !== 401) return result;
    if (target.token === used) {
      const renewed = await renew();
      if (!renewed.ok) return renewed;
      if (session !== target) return fail(401, TEXTS.signIn);
    }
    const retried = await call(target.server, method, route, { ...options, token: target.token });
    return session === target ? retried : fail(401, TEXTS.signIn);
  }

  async function state() {
    const current = await loaded();
    return {
      server: session?.server ?? current.server,
      tenant: session?.tenant ?? current.tenant,
      email: session?.email ?? current.email,
      remember: current.remember,
      notify: current.notify,
      canRemember: canRemember(),
      hasSavedPassword: Boolean(current.password_enc),
      signedIn: Boolean(session?.token),
      me: session?.me ?? null,
    };
  }

  async function login(form = {}) {
    const current = await loaded();
    const server = normalizeServer(form.server ?? current.server);
    if (!server) return fail(400, TEXTS.server);
    const tenant = String(form.tenant ?? current.tenant).trim().toLowerCase();
    if (!TENANT.test(tenant)) return fail(400, TEXTS.tenant);
    const email = String(form.email ?? '').trim();
    if (!EMAIL.test(email) || email.length > 254) return fail(400, TEXTS.email);
    const password = typeof form.password === 'string' ? form.password : '';
    if (!password || password.length > 256) return fail(400, TEXTS.password);
    const started = ++generation;
    session = null;
    const result = await authenticate({ server, tenant, email, password });
    if (started !== generation) return fail(401, TEXTS.signIn);
    if (!result.ok) return result;
    session = { server, tenant, email, password, ...result.data };
    const remember = form.remember !== false;
    config = { ...(await loaded()), server, tenant, email, remember, password_enc: remember && canRemember() ? encrypt(password) : null };
    await save();
    return { ok: true, data: await state() };
  }

  // Al abrir Relieve3D: entra con la contraseña guardada (si se marcó «Recordarme»).
  function resume() {
    if (session?.token) return state().then((data) => ({ ok: true, data }));
    resuming ??= (async () => {
      const current = await loaded();
      if (!current.password_enc) return fail(401, TEXTS.signIn);
      const password = decrypt(current.password_enc);
      if (!password) {
        await forgetSavedPassword();
        return fail(401, TEXTS.signIn);
      }
      const started = ++generation;
      const { server, tenant, email } = current;
      const result = await authenticate({ server, tenant, email, password });
      if (started !== generation) return fail(401, TEXTS.signIn);
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) await forgetSavedPassword();
        return result;
      }
      session = { server, tenant, email, password, ...result.data };
      return { ok: true, data: await state() };
    })().finally(() => {
      resuming = null;
    });
    return resuming;
  }

  // Cerrar sesión también olvida la contraseña guardada en este equipo.
  async function logout() {
    generation++;
    session = null;
    await forgetSavedPassword();
    return { ok: true, data: await state() };
  }

  async function request(method, route, body) {
    const allowed = allowedRoute(method, route);
    if (!allowed) return fail(400, TEXTS.route);
    if (body === undefined || body === null) return authed(allowed.method, allowed.path);
    if (allowed.method === 'GET' || typeof body !== 'object' || Array.isArray(body)) return fail(400, TEXTS.body);
    if (JSON.stringify(body).length > MAX_BODY_CHARS) return fail(413, TEXTS.body);
    return authed(allowed.method, allowed.path, { json: body });
  }

  async function media(ref) {
    if (!session) return fail(401, TEXTS.signIn);
    let route = typeof ref === 'string' ? ref.trim() : '';
    if (/^https?:\/\//i.test(route)) {
      let url;
      try {
        url = new URL(route);
      } catch {
        return fail(400, TEXTS.media);
      }
      if (url.origin !== session.server) return fail(400, TEXTS.media);
      route = url.pathname + url.search;
    }
    if (MEDIA_PRIVATE.test(route)) return authed('GET', route, { binary: true });
    if (MEDIA_PUBLIC.test(route) || ASSET_PUBLIC.test(route)) return call(session.server, 'GET', route, { binary: true });
    return fail(400, TEXTS.media);
  }

  async function upload(file) {
    if (!session) return fail(401, TEXTS.signIn);
    const bytes = toBuffer(file?.bytes);
    if (!bytes || !bytes.length) return fail(400, TEXTS.upload);
    if (bytes.length > MAX_UPLOAD_BYTES) return fail(413, TEXTS.uploadSize);
    const name = cleanFileName(file?.name, 150) || 'archivo';
    const type = typeof file?.type === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.type) ? file.type.toLowerCase() : 'application/octet-stream';
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), name);
    return authed('POST', '/inbox/uploads', { form });
  }

  async function setNotify(value) {
    if (typeof value !== 'boolean') return fail(400, TEXTS.body);
    config = { ...(await loaded()), notify: value };
    await save();
    return { ok: true, data: await state() };
  }

  // Un chat (id), los ajustes («ajustes» o «ajustes/<pestaña>» de la web) o la bandeja.
  function webUrl(id) {
    const server = session?.server ?? config?.server ?? DEFAULT_SERVER;
    const text = String(id ?? '');
    const tab = /^ajustes(?:\/([a-z]+))?$/.exec(text);
    if (new RegExp(`^${ID}$`).test(text) || (tab && (!tab[1] || SETTINGS_TABS.includes(tab[1])))) return `${server}/app/mensajes/${text}`;
    return `${server}/app/mensajes`;
  }

  return {
    configFile,
    state,
    login,
    resume,
    logout,
    request,
    media,
    upload,
    setNotify,
    webUrl,
    signedIn: () => Boolean(session?.token),
    notifyEnabled: () => config?.notify !== false,
    // El servidor rechazará el token actual (las pruebas E2E lo usan para comprobar la renovación automática).
    invalidateToken: () => {
      if (session) session.token = 'token-invalidado';
    },
  };
}

module.exports = {
  createInboxClient,
  newInboundAlert,
  inboundTime,
  allowedRoute,
  normalizeServer,
  cleanFileName,
  DEFAULT_SERVER,
  DEFAULT_TENANT,
  MAX_UPLOAD_BYTES,
  MAX_MEDIA_BYTES,
  ROUTES,
};

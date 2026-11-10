// Mensajes · Pabonitas: la bandeja de pabonitas.co (WhatsApp, Messenger, Instagram y TikTok) dentro de Relieve3D.
// Todo pasa por window.r3dInbox (proceso principal, src/main/inbox_client.cjs): el renderer nunca ve el token ni la
// contraseña. Los textos y las reglas son los mismos de la web (frontend/src/features/inbox) vía src/core/inbox.js.
// El dibujo es por regiones: put() solo reemplaza el HTML que cambió y frame() arma una sola vez las zonas con
// campos de texto, así escribir nunca vuelve a dibujar el campo donde está el cursor.
import * as I from './core/inbox.js';

const DETAIL_POLL_MS = 15_000;
const CLOCK_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 300;
const STICK_PX = 96;
const MAX_ORDER_LINES = 20;
const MAX_MEDIA_CACHE = 120;
const MAX_RELOAD_PAGES = 5;
const NARROW = '(max-width: 1279px)';
const DEFAULT_SERVER = 'https://pabonitas.co';
const DEFAULT_TENANT = 'pabonitas';
const CHANNEL_PLATFORMS = ['whatsapp', 'messenger', 'instagram', 'tiktok'];
const DESCRIPTION =
  'Instagram, Messenger, TikTok y WhatsApp de Pabonitas en una sola bandeja. Responde con respuestas guardadas, stickers, catálogo, precios y cotizaciones sin salir del chat.';
const STATUS_FEEDBACK = {
  open: 'Conversación abierta de nuevo.',
  pending: 'Quedó en «Pendientes» para retomarla después.',
  closed: 'Conversación cerrada. Si el cliente vuelve a escribir, se abre sola.',
};
const STATUS_TONES = { open: 'success', pending: 'warning', closed: 'muted' };
const UPLOAD_FAILED = 'No pudimos subir el archivo. Intenta de nuevo.';
const SEND_FAILED = 'No pudimos enviar el mensaje. Intenta de nuevo.';
const TOOL_FAILED = 'No pudimos cargar la información. Intenta de nuevo.';
const NO_REPLY_TOOLS = 'Por ahora no puedes escribir en esta conversación: copia lo que necesites para enviarlo por otro medio.';
const SIMULATOR_HINT = 'Esta es una conversación de prueba: para escribir como cliente usa «Probar» en la web.';
const IPC_PREFIX = /^Error invoking remote method '[^']+': (?:\w*Error: )?/;
const TOOL_ICONS = { catalogo: '🛍️', precios: '🏷️', cotizaciones: '🧾', calculadora: '🧮', archivos: '📁' };

const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ipcMessage = (message) => String(message ?? '').replace(IPC_PREFIX, '').trim();
const plural = (n, one, many) => (n === 1 ? one : many.replace('{n}', String(n)));
const emptyLine = () => ({ name: '', quantity: '1', unitPrice: '' });
const dataAttrs = (data = {}) =>
  Object.entries(data).map(([key, value]) => (value === undefined || value === null ? '' : ` data-${key}="${e(value)}"`)).join('');

/** Botón con data-act (el texto se escapa; `html` permite un icono). data-fk devuelve el foco tras redibujar. */
function button(label, act, opts = {}) {
  const { cls = 'btn', data = {}, disabled = false, title = '', aria = '', pressed, expanded, html = null, type = 'button' } = opts;
  const fk = opts.fk ?? `${act}:${data.id ?? data.key ?? data.view ?? data.tab ?? data.status ?? ''}`;
  return `<button type="${type}" class="${cls}" data-act="${act}" data-fk="${e(fk)}"${dataAttrs(data)}${disabled ? ' disabled' : ''}${
    title ? ` title="${e(title)}"` : ''}${aria ? ` aria-label="${e(aria)}"` : ''}${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}${
    expanded === undefined ? '' : ` aria-expanded="${expanded}"`}>${html ?? e(label)}</button>`;
}

function notice(tone, body, action = '', attrs = '') {
  return `<div class="ib-notice is-${tone}" role="${tone === 'danger' ? 'alert' : 'status'}"${attrs}><p>${body}</p>${action ? `<div class="ib-notice-act">${action}</div>` : ''}</div>`;
}

function empty(title, text, action = '') {
  return `<div class="ib-empty">${title ? `<p class="ib-empty-title">${e(title)}</p>` : ''}${text ? `<p>${e(text)}</p>` : ''}${action ? `<div class="ib-row">${action}</div>` : ''}</div>`;
}

const badge = (label, tone = 'muted') => `<span class="ib-badge is-${tone}">${e(label)}</span>`;
const platformLabel = (item) => item?.platform_label || I.INBOX_PLATFORM_LABELS[item?.platform] || item?.platform || 'la bandeja';
const platformDot = (platform) => `<span class="ib-dot is-${e(platform)}" aria-hidden="true"></span>`;
const platformBadge = (item) => `<span class="ib-platform is-${e(item.platform)}">${platformDot(item.platform)}${e(platformLabel(item))}</span>`;

function avatar(title, platform) {
  return `<span class="ib-avatar" aria-hidden="true">${e(I.conversationInitials(title))}<span class="ib-avatar-dot is-${e(platform)}"></span></span>`;
}

/** Texto con enlaces que se abren en el navegador del sistema (nunca dentro de Relieve3D). */
function linkify(text) {
  return I.linkifyParts(text ?? '')
    .map((part) => {
      if (part.kind !== 'link') return e(part.value);
      const url = /^https?:\/\//i.test(part.value) ? part.value : `https://${part.value}`;
      return `<a href="${e(url)}" data-act="link" data-url="${e(url)}" rel="noreferrer">${e(part.value)}</a>`;
    })
    .join('');
}

/** «2026-12-24» → «24 dic 2026» (fechas de las cotizaciones). */
function shortDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!match) return String(value ?? '');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Error de una llamada a la bandeja ({ status, detail }); `quiet` = respuesta vieja que ya no importa. */
class InboxError extends Error {
  constructor(result) {
    super(result?.detail || 'Error de la bandeja');
    this.status = Number.isInteger(result?.status) ? result.status : 500;
    this.detail = result?.detail ?? null;
    this.quiet = Boolean(result?.stale);
  }
}

export class InboxStudio {
  constructor(root, cb = {}) {
    this.root = root;
    this.cb = cb;
    this.seq = 0;
    this.gen = 0;
    this.mode = 'idle';
    this.state = null;
    this.loginError = '';
    this.busy = new Set();
    this.boot = null;
    this.bootError = null;
    this.summary = null;
    this.summarySig = '';
    this.view = 'bandeja';
    this.platform = '';
    this.search = '';
    this.list = { items: [], hasMore: false, loaded: false, loading: false, more: false, error: null };
    this.listSeq = 0;
    this.convId = null;
    this.pendingOpen = null;
    this.detailSeq = 0;
    this.resetConversation();
    this.drafts = new Map();
    this.narrow = window.matchMedia?.(NARROW) ?? null;
    this.toolsOpen = !this.narrow?.matches;
    this.toolTab = 'catalogo';
    this.tool = {};
    this.catalogQ = '';
    this.catalogCategory = '';
    this.quotesQ = '';
    this.calc = { expr: '', lines: [emptyLine()], discount: '', shipping: '', deposit: '' };
    this.calcRev = 0;
    this.copied = new Map();
    this.lightbox = null;
    this.media = new Map();
    this.shownMedia = new Set();
    this.html = new WeakMap();
    this.frames = new WeakMap();
    this.timers = {};
    this.debounces = {};

    root.addEventListener('click', (event) => {
      const el = event.target.closest('[data-act]');
      if (!el || !root.contains(el)) return;
      if (el.tagName === 'A') event.preventDefault();
      if (el.disabled) return;
      Promise.resolve()
        .then(() => this.act(el.dataset.act, el.dataset, el))
        .catch((err) => this.fail(err));
    });
    // Un enlace nunca navega dentro de la ventana (ni con la rueda del ratón).
    root.addEventListener('auxclick', (event) => {
      if (event.target.closest('a')) event.preventDefault();
    });
    root.addEventListener('input', (event) => this.onInput(event.target));
    root.addEventListener('change', (event) => {
      Promise.resolve()
        .then(() => this.onChange(event.target))
        .catch((err) => this.fail(err));
    });
    root.addEventListener('submit', (event) => {
      event.preventDefault();
      Promise.resolve()
        .then(() => this.onSubmit(event.target))
        .catch((err) => this.fail(err));
    });
    // En document: Esc tiene que cerrar la foto ampliada aunque el foco haya quedado fuera del módulo.
    document.addEventListener('keydown', (event) => this.onKey(event));
    // El clic en una sugerencia de «/» no debe quitarle el foco al cuadro de texto.
    root.addEventListener('mousedown', (event) => {
      const option = event.target.closest('[data-slash]');
      if (!option) return;
      event.preventDefault();
      this.pickSlash(Number(option.dataset.slash)).catch((err) => this.fail(err));
    });
    root.addEventListener(
      'scroll',
      (event) => {
        const log = event.target;
        if (log?.dataset?.r === 'log') this.stick = log.scrollHeight - log.scrollTop - log.clientHeight < STICK_PX;
      },
      true,
    );
    // Una foto que termina de cargar cambia la altura del chat: si se estaba viendo lo último, se sigue viendo.
    root.addEventListener(
      'load',
      (event) => {
        const log = this.region('log');
        if (event.target?.tagName === 'IMG' && this.stick && log?.contains(event.target)) log.scrollTop = log.scrollHeight;
      },
      true,
    );
    document.addEventListener('visibilitychange', () => this.maybeMarkRead());
    window.addEventListener('focus', () => this.maybeMarkRead());
    this.narrow?.addEventListener?.('change', () => this.render());
    if (window.r3dInbox) {
      window.r3dInbox.onSummary?.((payload) => this.onPush(payload));
      window.r3dInbox.onOpen?.((id) => this.onOpenChat(id));
    }
  }

  resetConversation() {
    this.detailSeq++;
    this.detail = null;
    this.detailError = null;
    this.detailLoading = false;
    this.older = [];
    this.olderHasMore = null;
    this.olderLoading = false;
    this.olderError = false;
    this.feedback = null;
    this.editingCustomer = false;
    this.customerError = '';
    this.markedRead = '';
    this.stick = true;
    this.restoreScroll = null;
    this.picker = null;
    this.pickerQuery = '';
    this.slashIndex = 0;
    this.slashDismissed = false;
  }

  // --- Puente con el proceso principal ---

  /** Llama a window.r3dInbox.<name> sin lanzar nunca: { ok, data } o { ok: false, status, detail }. */
  async bridge(name, ...args) {
    if (!window.r3dInbox) return { ok: false, status: 0, detail: 'Mensajes solo funciona en la app de escritorio de Relieve3D.' };
    try {
      const result = await window.r3dInbox[name](...args);
      return result && typeof result === 'object' && 'ok' in result ? result : { ok: false, status: 500, detail: null };
    } catch (err) {
      return { ok: false, status: 500, detail: ipcMessage(err?.message) || null };
    }
  }

  /** Como bridge(), pero descarta lo que llegue de una sesión anterior y vuelve al ingreso si la sesión se perdió. */
  async call(name, ...args) {
    const gen = this.gen;
    const result = await this.bridge(name, ...args);
    if (gen !== this.gen) return { ok: false, status: 0, detail: null, stale: true };
    if (!result.ok && result.status === 401 && this.mode === 'ready') {
      this.expired(result);
      return { ...result, stale: true };
    }
    return result;
  }

  api(method, path, body = null) {
    return this.call('request', method, path, body);
  }

  /** Los datos de la respuesta, o un InboxError que fail() muestra como aviso. */
  need(result) {
    if (result.ok) return result.data;
    throw new InboxError(result);
  }

  fail(err) {
    if (!err || err.quiet) return;
    if (err instanceof InboxError) {
      this.cb.toast?.(I.inboxErrorMessage(err), true);
      return;
    }
    console.error('[mensajes]', err);
    this.cb.toast?.(ipcMessage(err.message) || 'Algo salió mal en Mensajes. Intenta de nuevo.', true);
  }

  async readState() {
    try {
      return await window.r3dInbox.state();
    } catch {
      return null;
    }
  }

  // --- Abrir, cerrar y sesión ---

  /** Muestra el módulo. false si esta ventana no tiene el puente (la versión web de Relieve3D no trae Mensajes). */
  async open() {
    if (!window.r3dInbox) return false;
    const seq = ++this.seq;
    this.root.hidden = false;
    if (this.mode === 'ready') {
      this.render();
      this.startTimers();
      this.refreshAll();
      return true;
    }
    if (this.mode !== 'login') {
      this.mode = 'loading';
      this.loadingText = 'Abriendo Mensajes…';
      this.render();
    }
    const state = await this.readState();
    if (seq !== this.seq) return true;
    if (state) this.state = state;
    if (state?.signedIn) this.enter(state);
    else if (state?.hasSavedPassword && this.mode !== 'login') await this.resume();
    else this.showLogin(this.mode === 'login' ? this.loginError : '');
    return true;
  }

  close() {
    this.seq++;
    this.root.hidden = true;
    this.stopTimers();
    this.lightbox = null;
    this.picker = null;
    // Al volver se releen las cotizaciones del Cotizador (pudieron cambiar mientras estaba cerrado).
    delete this.tool.local;
  }

  enter(state) {
    this.state = state;
    this.mode = 'ready';
    this.loginError = '';
    this.busy.delete('login');
    if (this.root.hidden) return;
    this.render();
    this.startTimers();
    this.refreshAll();
  }

  showLogin(error = '') {
    this.mode = 'login';
    this.loginError = error;
    this.loginRev = (this.loginRev ?? 0) + 1;
    this.busy.delete('login');
    this.stopTimers();
    this.render();
    const form = this.root.querySelector('[data-form=login]');
    if (form && !this.root.hidden) form.elements[form.elements.email.value ? 'password' : 'email']?.focus();
  }

  async submitLogin(form) {
    if (this.busy.has('login')) return;
    const data = new FormData(form);
    const payload = {
      server: String(data.get('server') ?? '').trim() || DEFAULT_SERVER,
      tenant: String(data.get('tenant') ?? '').trim().toLowerCase() || DEFAULT_TENANT,
      email: String(data.get('email') ?? '').trim(),
      password: String(data.get('password') ?? ''),
      remember: data.get('remember') === 'on',
    };
    if (!payload.email) return this.loginFailed('Escribe tu correo.', 'email');
    if (!payload.password) return this.loginFailed('Escribe tu contraseña.', 'password');
    this.gen++;
    this.busy.add('login');
    this.loginError = '';
    this.render();
    const result = await this.bridge('login', payload);
    this.busy.delete('login');
    if (!result.ok) return this.loginFailed(I.inboxLoginError(result), 'password');
    form.elements.password.value = '';
    this.cb.toast?.(`Entraste a Mensajes como ${result.data?.email || payload.email}.`);
    this.enter(result.data);
  }

  loginFailed(message, field) {
    this.loginError = message;
    this.render();
    const input = this.root.querySelector(`[data-form=login] [name=${field}]`);
    input?.focus();
    input?.select?.();
  }

  /** Entra con la contraseña que se guardó cifrada al marcar «Recordarme». */
  async resume() {
    if (this.busy.has('login')) return;
    const seq = this.seq;
    const gen = ++this.gen;
    this.mode = 'loading';
    this.loadingText = 'Entrando con la contraseña guardada…';
    this.busy.add('login');
    this.render();
    const result = await this.bridge('resume');
    this.busy.delete('login');
    if (gen !== this.gen) return;
    if (result.ok) {
      this.enter(result.data);
      return;
    }
    this.state = (await this.readState()) ?? this.state;
    if (seq !== this.seq && this.root.hidden) {
      this.mode = 'login';
      return;
    }
    this.showLogin(result.status === 401 ? 'La contraseña guardada ya no sirve. Escríbela de nuevo.' : I.inboxLoginError(result));
  }

  /** La sesión se perdió (cambiaron la contraseña o desactivaron el usuario): al ingreso sin perder borradores ni filtros. */
  async expired(result) {
    if (this.mode !== 'ready') return;
    this.gen++;
    this.mode = 'login';
    this.stopTimers();
    this.busy.clear();
    this.cb.onBadge?.(0);
    const state = await this.readState();
    if (state) this.state = state;
    if (this.mode === 'login') this.showLogin(I.inboxErrorMessage(result));
  }

  async logout() {
    if (this.busy.has('logout')) return;
    this.busy.add('logout');
    this.render();
    this.gen++;
    const result = await this.bridge('logout');
    this.busy.delete('logout');
    this.state = result.ok ? result.data : ((await this.readState()) ?? this.state);
    this.clearSession();
    this.cb.onBadge?.(0);
    this.cb.toast?.('Cerraste la sesión de Mensajes en este equipo.');
    this.showLogin();
  }

  clearSession() {
    this.boot = null;
    this.bootError = null;
    this.summary = null;
    this.summarySig = '';
    this.list = { items: [], hasMore: false, loaded: false, loading: false, more: false, error: null };
    this.convId = null;
    this.pendingOpen = null;
    this.resetConversation();
    this.drafts.clear();
    this.tool = {};
    for (const entry of this.media.values()) if (entry.url) URL.revokeObjectURL(entry.url);
    this.media.clear();
  }

  /** Resumen que manda el proceso principal cada pocos segundos (también con el módulo cerrado: contador de Inicio). */
  onPush(payload) {
    if (!payload) return;
    if (payload.signedIn === false) {
      this.cb.onBadge?.(0);
      if (this.mode === 'ready') this.expired({ status: 401, detail: null });
      return;
    }
    if (payload.summary) this.applySummary(payload.summary);
  }

  /** Clic en un aviso de Windows: abre Mensajes en esa conversación. */
  onOpenChat(id) {
    const convId = Number(id);
    if (!Number.isInteger(convId) || convId <= 0) return;
    if (this.root.hidden || this.mode !== 'ready') {
      this.pendingOpen = convId;
      if (this.root.hidden) this.cb.openModule?.('inbox');
      return;
    }
    this.select(convId);
  }

  startTimers() {
    this.stopTimers();
    this.timers.detail = setInterval(() => {
      if (!this.root.hidden && !document.hidden && this.convId && this.mode === 'ready') this.loadDetail(true);
    }, DETAIL_POLL_MS);
    this.timers.clock = setInterval(() => {
      if (!this.root.hidden && this.mode === 'ready') this.render();
    }, CLOCK_MS);
  }

  stopTimers() {
    clearInterval(this.timers.detail);
    clearInterval(this.timers.clock);
    this.timers = {};
  }

  later(key, fn, ms = SEARCH_DEBOUNCE_MS) {
    clearTimeout(this.debounces[key]);
    this.debounces[key] = setTimeout(() => {
      delete this.debounces[key];
      Promise.resolve()
        .then(fn)
        .catch((err) => this.fail(err));
    }, ms);
  }

  // --- Datos ---

  refreshAll() {
    this.loadBoot();
    this.loadSummary();
    this.reloadList(this.list.loaded);
    if (this.pendingOpen) this.openPending();
    else if (this.convId) this.loadDetail(Boolean(this.detail));
  }

  openPending() {
    const id = this.pendingOpen;
    this.pendingOpen = null;
    if (id) this.select(id);
  }

  async loadBoot() {
    const result = await this.api('GET', '/inbox/bootstrap');
    if (result.stale) return;
    if (result.ok) {
      this.boot = result.data;
      this.bootError = null;
    } else this.bootError = result;
    this.render();
  }

  async loadSummary() {
    const result = await this.api('GET', '/inbox/summary');
    if (result.ok) this.applySummary(result.data);
  }

  /** Nuevo resumen: si cambió algo que se ve en la lista o en el chat, se vuelven a pedir. */
  applySummary(summary) {
    if (!summary || typeof summary !== 'object') return;
    const sig = [summary.latest_inbound_at, summary.unread_messages, summary.failed_messages, summary.open_conversations, summary.pending_conversations].join('|');
    const changed = this.summary !== null && sig !== this.summarySig;
    this.summary = summary;
    this.summarySig = sig;
    this.cb.onBadge?.(Number(summary.unread_conversations) || 0);
    if (this.mode !== 'ready' || this.root.hidden) return;
    if (changed) {
      this.reloadList(true);
      if (this.convId) this.loadDetail(true);
    }
    this.render();
  }

  listPath(offset = 0) {
    const params = new URLSearchParams({ view: this.view });
    if (this.platform) params.set('platform', this.platform);
    const query = this.search.trim();
    if (query) params.set('q', query);
    if (offset) params.set('offset', String(offset));
    return `/inbox/conversations?${params}`;
  }

  resetList() {
    this.listSeq++;
    this.list = { items: [], hasMore: false, offset: 0, loaded: false, loading: true, more: false, error: null };
    this.reloadList(false);
  }

  /** Pide otra vez las páginas que ya se veían (hasta 5) sin perder la conversación abierta ni el desplazamiento. */
  async reloadList(silent = false) {
    const token = ++this.listSeq;
    const list = this.list;
    if (!silent) {
      list.loading = true;
      this.render();
    }
    const wanted = Math.max(1, list.items.length);
    const items = [];
    const seen = new Set();
    let offset = 0;
    let hasMore = false;
    let error = null;
    for (let page = 0; page < MAX_RELOAD_PAGES; page++) {
      const result = await this.api('GET', this.listPath(offset));
      if (result.stale || token !== this.listSeq) return;
      if (!result.ok) {
        error = result;
        break;
      }
      const rows = Array.isArray(result.data?.items) ? result.data.items : [];
      for (const item of rows) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
      offset += rows.length;
      hasMore = Boolean(result.data?.has_more);
      if (!hasMore || !rows.length || items.length >= wanted) break;
    }
    list.loading = false;
    list.error = error;
    if (!error || items.length) {
      list.items = items;
      list.offset = offset;
      list.hasMore = error ? list.hasMore : hasMore;
      list.loaded = true;
    }
    this.render();
  }

  async moreList() {
    const list = this.list;
    if (list.more || !list.hasMore) return;
    const token = this.listSeq;
    list.more = true;
    this.render();
    const result = await this.api('GET', this.listPath(list.offset));
    list.more = false;
    if (result.stale || token !== this.listSeq) return this.render();
    if (!result.ok) {
      this.render();
      throw new InboxError(result);
    }
    const rows = Array.isArray(result.data?.items) ? result.data.items : [];
    const seen = new Set(list.items.map((item) => item.id));
    list.items = [...list.items, ...rows.filter((item) => !seen.has(item.id))];
    list.offset += rows.length;
    list.hasMore = Boolean(result.data?.has_more) && rows.length > 0;
    this.render();
  }

  patchItem(item) {
    if (!item?.id) return;
    const index = this.list.items.findIndex((row) => row.id === item.id);
    if (index >= 0) this.list.items[index] = { ...this.list.items[index], ...item };
  }

  applyConversation(item) {
    if (!item?.id) return;
    if (this.detail?.conversation.id === item.id) this.detail = { ...this.detail, conversation: { ...this.detail.conversation, ...item } };
    this.patchItem(item);
  }

  select(id) {
    const convId = Number(id);
    if (!Number.isInteger(convId) || convId <= 0) return;
    if (this.convId === convId) {
      if (!this.detail && !this.detailLoading) this.loadDetail(false);
      this.render();
      return;
    }
    this.convId = convId;
    this.resetConversation();
    if (this.narrow?.matches) this.toolsOpen = false;
    this.loadDetail(false);
    this.render();
  }

  async loadDetail(silent = true) {
    const id = this.convId;
    if (!id) return;
    const token = ++this.detailSeq;
    if (!silent) {
      this.detailLoading = true;
      this.render();
    }
    const result = await this.api('GET', `/inbox/conversations/${id}`);
    if (result.stale || token !== this.detailSeq || id !== this.convId) return;
    this.detailLoading = false;
    if (!result.ok) {
      this.detailError = result;
      this.render();
      return;
    }
    this.applyDetail(result.data);
  }

  applyDetail(detail) {
    if (!detail?.conversation || detail.conversation.id !== this.convId) return;
    const previous = this.detail?.messages ?? [];
    const latest = Array.isArray(detail.messages) ? detail.messages : [];
    // Con mensajes anteriores ya cargados, lo que sale de la última página pasa a «anteriores» y no desaparece.
    if (this.olderHasMore !== null && previous.length) {
      const ids = new Set(latest.map((message) => message.id));
      const dropped = previous.filter((message) => !ids.has(message.id));
      if (dropped.length) this.older = I.mergeInboxMessages(this.older, dropped);
    }
    this.detail = { ...detail, messages: latest };
    this.detailError = null;
    this.detailLoading = false;
    this.patchItem(detail.conversation);
    this.render();
    this.maybeMarkRead();
  }

  /** Marca leída la conversación abierta cuando de verdad se está viendo (una vez por mensaje nuevo). */
  maybeMarkRead() {
    const detail = this.detail;
    if (!detail || this.mode !== 'ready' || this.root.hidden || document.visibilityState !== 'visible') return;
    const conversation = detail.conversation;
    if (!(conversation.unread_count > 0)) return;
    const key = `${conversation.id}:${detail.messages.at(-1)?.id ?? 0}`;
    if (this.markedRead === key) return;
    this.markedRead = key;
    this.api('POST', `/inbox/conversations/${conversation.id}/read`).then((result) => {
      if (result.stale) return;
      if (!result.ok) {
        if (this.markedRead === key) this.markedRead = '';
        return;
      }
      this.applyConversation(result.data);
      this.loadSummary();
      this.render();
    });
  }

  async loadOlder() {
    const detail = this.detail;
    if (!detail || this.olderLoading) return;
    const first = this.older[0] ?? detail.messages[0];
    if (!first) return;
    const id = this.convId;
    this.olderLoading = true;
    this.olderError = false;
    this.render();
    const result = await this.api('GET', `/inbox/conversations/${id}?before_id=${first.id}`);
    if (result.stale || id !== this.convId) return;
    this.olderLoading = false;
    if (!result.ok) {
      this.olderError = true;
      this.render();
      return;
    }
    const log = this.region('log');
    if (log) this.restoreScroll = { height: log.scrollHeight, top: log.scrollTop };
    this.older = I.mergeInboxMessages(Array.isArray(result.data?.messages) ? result.data.messages : [], this.older);
    this.olderHasMore = Boolean(result.data?.has_more);
    this.render();
  }

  allMessages() {
    return this.detail ? I.mergeInboxMessages(this.older, this.detail.messages) : [];
  }

  conversation() {
    return this.detail?.conversation ?? this.list.items.find((item) => item.id === this.convId) ?? null;
  }

  channel(conversation) {
    return this.boot?.channels?.find((channel) => channel.id === conversation?.channel_id) ?? null;
  }

  /** Lo que se puede hacer en el chat abierto, con las mismas reglas de la web. */
  sendContext() {
    const detail = this.detail;
    if (!detail) return null;
    const conversation = detail.conversation;
    const win = detail.window ?? {};
    const paused = this.channel(conversation)?.status === 'paused';
    return {
      conversation,
      win,
      caps: detail.capabilities ?? { images: false, stickers: false, files: false, max_text_chars: I.INBOX_MAX_TEXT },
      paused,
      label: platformLabel(conversation),
      template: win.mode === 'template',
      canSend: Boolean(win.can_reply) && win.mode !== 'template' && !paused,
    };
  }

  draft(id = this.convId) {
    if (!this.drafts.has(id)) this.drafts.set(id, { text: '', savedReplyId: null, attachment: null });
    return this.drafts.get(id);
  }

  activeReplies() {
    return (this.boot?.saved_replies ?? []).filter((reply) => reply.is_active !== false);
  }

  /** Sugerencias de «/atajo» mientras el cuadro de texto solo tiene la barra y el atajo. */
  slashState() {
    const ctx = this.sendContext();
    if (!ctx?.canSend || this.slashDismissed) return null;
    const query = I.slashQuery(this.draft().text);
    if (query === null) return null;
    const matches = I.matchSavedReplies(this.activeReplies(), query);
    return { query, matches, index: Math.min(this.slashIndex, Math.max(0, matches.length - 1)) };
  }

  // --- Acciones ---

  async act(name, data, el) {
    switch (name) {
      case 'back':
        return this.cb.onBack?.();
      case 'refresh':
        this.tool = {};
        this.refreshAll();
        return this.render();
      case 'web':
        return this.openWeb(data.id ?? '');
      case 'settings':
        return this.openWeb(data.tab ? `ajustes/${data.tab}` : 'ajustes');
      case 'link':
        return this.openLink(data.url);
      case 'logout':
        return this.logout();
      case 'resume':
        return this.resume();
      case 'reload-boot':
        return this.loadBoot();
      case 'view':
        if (this.view === data.view) return undefined;
        this.view = data.view;
        return this.resetList();
      case 'clear-filters':
        this.view = 'bandeja';
        this.platform = '';
        this.search = '';
        this.syncFilters();
        return this.resetList();
      case 'select':
        return this.select(data.id);
      case 'more':
        return this.moreList();
      case 'retry-list':
        return this.reloadList(false);
      case 'close-chat':
        this.convId = null;
        this.resetConversation();
        return this.render();
      case 'retry-detail':
        return this.loadDetail(false);
      case 'status':
        return this.setStatus(data.status);
      case 'edit-customer':
        this.editingCustomer = true;
        this.customerError = '';
        this.render();
        return this.root.querySelector('[data-form=customer] [name=name]')?.focus();
      case 'cancel-customer':
        this.editingCustomer = false;
        this.customerError = '';
        return this.render();
      case 'older':
        return this.loadOlder();
      case 'retry':
        return this.retryMessage(Number(data.id));
      case 'zoom': {
        const entry = this.media.get(data.ref);
        if (!entry?.url) return undefined;
        this.lightbox = { url: entry.url, ref: data.ref, alt: data.alt || 'Foto del mensaje', name: data.name || entry.name || '' };
        this.render();
        return this.root.querySelector('[data-r=lightbox] [data-act=close-lightbox].btn')?.focus();
      }
      case 'close-lightbox':
        return this.closeLightbox();
      case 'save-media':
        return this.saveMedia(data.ref, data.name);
      case 'media-retry':
        this.media.delete(data.ref);
        return this.render();
      case 'tools':
        this.toolsOpen = !this.toolsOpen;
        return this.render();
      case 'close-tools':
        this.toolsOpen = false;
        return this.render();
      case 'tool-tab':
        this.toolTab = data.tab;
        return this.render();
      case 'open-tool':
        this.toolTab = data.tab;
        this.toolsOpen = true;
        this.render();
        return this.root.querySelector(`[data-r=tool-tabs] [data-tab="${CSS.escape(data.tab ?? '')}"]`)?.focus();
      case 'retry-tool':
        delete this.tool[data.key];
        return this.render();
      case 'open-quote':
        return this.cb.openModule?.('quote');
      case 'template':
        return this.send({ kind: 'template' });
      case 'picker':
        this.picker = this.picker === data.key ? null : data.key;
        this.pickerQuery = '';
        this.render();
        return this.root.querySelector('[data-r=picker-q]')?.focus();
      case 'reply':
        return this.insertReply(this.activeReplies().find((reply) => reply.id === Number(data.id)));
      case 'sticker':
        this.picker = null;
        return this.send({ kind: 'sticker', sticker_id: Number(data.id) });
      case 'attach':
        return this.root.querySelector('[data-r=file]')?.click();
      case 'remove-attachment':
        this.draft().attachment = null;
        this.feedback = null;
        this.render();
        return this.focusComposer();
      case 'copy':
        return this.copy(data.text ?? '', data.key);
      case 'paste':
        return this.insertText(data.text ?? '');
      case 'send-asset':
        return this.sendAsset(data.kind, Number(data.asset), data.text ?? '');
      case 'calc-add':
        if (this.calc.lines.length >= MAX_ORDER_LINES) return undefined;
        this.calc.lines.push(emptyLine());
        this.calcRev++;
        this.render();
        return this.root.querySelector(`[data-line="${this.calc.lines.length - 1}"][data-field=name]`)?.focus();
      case 'calc-remove': {
        const index = Number(data.index);
        if (this.calc.lines.length === 1) this.calc.lines[0] = emptyLine();
        else this.calc.lines.splice(index, 1);
        this.calcRev++;
        return this.render();
      }
      case 'noop':
        return undefined;
      default:
        console.warn('[mensajes] acción desconocida', name, el);
        return undefined;
    }
  }

  /** Deja los campos de búsqueda y red como dicen los filtros (tras «Ver la bandeja»). */
  syncFilters() {
    const search = this.root.querySelector('[data-r=search]');
    if (search) search.value = this.search;
    const select = this.root.querySelector('[data-r=platform]');
    if (select) select.value = this.platform;
  }

  async setStatus(status) {
    const conversation = this.detail?.conversation;
    if (!conversation || this.busy.has('status')) return;
    this.busy.add('status');
    this.render();
    const result = await this.api('PATCH', `/inbox/conversations/${conversation.id}`, { status });
    this.busy.delete('status');
    if (result.stale) return;
    if (!result.ok) this.feedback = { tone: 'danger', text: I.inboxErrorMessage(result) };
    else {
      this.applyConversation(result.data);
      this.feedback = { tone: 'success', text: STATUS_FEEDBACK[status] ?? 'Listo.' };
      this.reloadList(true);
      this.loadSummary();
    }
    this.render();
  }

  async saveCustomer(form) {
    const conversation = this.detail?.conversation;
    if (!conversation || this.busy.has('customer')) return;
    const data = new FormData(form);
    const tags = I.parseInboxTags(String(data.get('tags') ?? ''));
    if (tags.length > I.INBOX_MAX_TAGS) {
      this.customerError = I.INBOX_TAGS_ERROR;
      this.render();
      form.elements.tags?.focus();
      return;
    }
    const payload = { display_name: String(data.get('name') ?? '').trim(), tags, note: String(data.get('note') ?? '').trim() || null };
    this.busy.add('customer');
    this.customerError = '';
    this.render();
    const result = await this.api('PATCH', `/inbox/conversations/${conversation.id}`, payload);
    this.busy.delete('customer');
    if (result.stale) return;
    if (!result.ok) {
      this.customerError = I.inboxErrorMessage(result);
      this.render();
      return;
    }
    this.applyConversation(result.data);
    this.editingCustomer = false;
    this.feedback = { tone: 'success', text: 'Datos del cliente guardados.' };
    this.reloadList(true);
    this.render();
  }

  async retryMessage(id) {
    const key = `retry:${id}`;
    if (!id || this.busy.has(key)) return;
    this.busy.add(key);
    this.render();
    const result = await this.api('POST', `/inbox/messages/${id}/retry`);
    this.busy.delete(key);
    if (result.stale) return;
    if (!result.ok) {
      this.feedback = { tone: 'danger', text: I.inboxErrorMessage(result) };
      this.render();
      return;
    }
    this.detailSeq++;
    this.applyDetail(result.data);
    const message = (result.data?.messages ?? []).find((item) => item.id === id);
    this.feedback =
      message?.status === 'failed' ? { tone: 'danger', text: I.retryFailedFeedback(message.error) } : { tone: 'success', text: 'Mensaje reenviado.' };
    this.reloadList(true);
    this.loadSummary();
    this.render();
  }

  /** Envía al chat abierto. true si el servidor lo recibió (aunque luego la red lo rechace). */
  async send(payload) {
    const ctx = this.sendContext();
    if (!ctx || this.busy.has('send')) return false;
    const id = ctx.conversation.id;
    const before = new Set(this.allMessages().map((message) => message.id));
    this.busy.add('send');
    this.render();
    const result = await this.api('POST', `/inbox/conversations/${id}/messages`, payload);
    this.busy.delete('send');
    if (result.stale) return false;
    if (id !== this.convId) {
      this.reloadList(true);
      this.render();
      return result.ok;
    }
    if (!result.ok) {
      this.feedback = { tone: 'danger', text: I.inboxErrorMessage(result, SEND_FAILED) };
      this.render();
      return false;
    }
    this.detailSeq++;
    this.stick = true;
    this.applyDetail(result.data);
    const failed = (result.data?.messages ?? []).find((message) => !before.has(message.id) && message.direction === 'out' && message.status === 'failed');
    this.feedback = failed ? { tone: 'danger', text: I.sendFailedFeedback(failed.error) } : null;
    this.reloadList(true);
    this.loadSummary();
    this.render();
    return true;
  }

  /** «Enviar»: mismas validaciones y en el mismo orden que la web. */
  async submitComposer() {
    const ctx = this.sendContext();
    if (!ctx || this.busy.has('send') || this.busy.has('upload')) return;
    const id = ctx.conversation.id;
    const draft = this.draft(id);
    const text = draft.text.trim();
    const warn = (message) => {
      this.feedback = { tone: 'warning', text: message };
      this.render();
    };
    if (ctx.paused) return warn(I.INBOX_SEND_ERRORS.paused);
    if (!ctx.canSend) return undefined;
    if (!text && !draft.attachment) return warn(I.INBOX_SEND_ERRORS.empty);
    const placeholder = I.placeholderSendError(text);
    if (placeholder) {
      warn(placeholder);
      return this.focusComposer(I.firstPlaceholderRange(draft.text));
    }
    const attachmentError = I.attachmentSendError(draft.attachment, ctx.label, ctx.caps);
    if (attachmentError) return warn(attachmentError);
    if (I.inboxTextLength(text) > I.INBOX_MAX_TEXT) return warn(I.INBOX_SEND_ERRORS.tooLong);
    const attachment = draft.attachment;
    const payload = attachment
      ? { kind: attachment.is_image ? 'image' : 'file', asset_id: attachment.asset_id, text: text || null, saved_reply_id: draft.savedReplyId ?? null }
      : { kind: 'text', text, saved_reply_id: draft.savedReplyId ?? null };
    const sentText = draft.text;
    if (!(await this.send(payload))) return undefined;
    // Si mientras se enviaba se escribió algo más, se conserva.
    if (draft.text === sentText) {
      draft.text = '';
      draft.savedReplyId = null;
    }
    if (draft.attachment === attachment) draft.attachment = null;
    if (id !== this.convId) return undefined;
    const input = this.composerInput();
    if (input && input.value !== draft.text) input.value = draft.text;
    this.render();
    return this.focusComposer();
  }

  async upload(file) {
    const ctx = this.sendContext();
    if (!ctx || !file || this.busy.has('upload')) return;
    const id = ctx.conversation.id;
    const error = I.inboxUploadError(file, !ctx.caps.files);
    if (error) {
      this.feedback = { tone: 'warning', text: error };
      this.render();
      return;
    }
    this.busy.add('upload');
    this.render();
    let result;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      result = await this.call('upload', { name: file.name, type: file.type, bytes });
    } catch {
      result = { ok: false, status: 400, detail: null };
    }
    this.busy.delete('upload');
    if (result.stale) return;
    if (!result.ok) {
      if (id === this.convId) this.feedback = { tone: 'danger', text: I.inboxErrorMessage(result, UPLOAD_FAILED) };
      this.render();
      return;
    }
    this.draft(id).attachment = result.data;
    if (id === this.convId) {
      const warning = I.attachmentSendError(result.data, ctx.label, ctx.caps);
      this.feedback = warning ? { tone: 'warning', text: warning } : null;
    }
    this.render();
    this.focusComposer();
  }

  /** Pone una respuesta guardada en el cuadro de texto con los datos del cliente y selecciona el primer [DATO]. */
  async insertReply(reply) {
    const ctx = this.sendContext();
    if (!ctx || !reply) return;
    const id = ctx.conversation.id;
    const variables = this.boot?.variables ?? [];
    let text = reply.body ?? '';
    if (variables.length) text = I.renderInboxText(text, I.conversationVariables(variables, ctx.conversation)).text;
    else {
      const result = await this.api('POST', `/inbox/conversations/${id}/render`, { text });
      if (result.stale) return;
      if (result.ok && typeof result.data?.text === 'string') text = result.data.text;
    }
    if (id !== this.convId) return;
    const draft = this.draft(id);
    draft.text = I.slashQuery(draft.text) !== null ? text : I.appendInboxText(draft.text, text);
    draft.savedReplyId = reply.id;
    this.picker = null;
    this.slashDismissed = false;
    this.slashIndex = 0;
    const input = this.composerInput();
    if (input) input.value = draft.text;
    this.render();
    this.focusComposer(I.firstPlaceholderRange(draft.text));
  }

  async pickSlash(index) {
    const reply = this.slashState()?.matches[index];
    if (reply) await this.insertReply(reply);
  }

  composerInput() {
    return this.root.querySelector('[data-r=composer-text]');
  }

  focusComposer(range = null) {
    const input = this.composerInput();
    if (!input || input.disabled) return;
    input.focus();
    if (range) input.setSelectionRange(range.start, range.end);
    else input.setSelectionRange(input.value.length, input.value.length);
  }

  /** «Pegar» de las herramientas: agrega el texto al mensaje (no lo envía). */
  insertText(text) {
    const ctx = this.sendContext();
    if (!ctx?.canSend || !text) return;
    const draft = this.draft();
    draft.text = I.appendInboxText(draft.text, text);
    if (this.narrow?.matches) this.toolsOpen = false;
    const input = this.composerInput();
    if (input) input.value = draft.text;
    this.render();
    this.focusComposer();
  }

  async sendAsset(kind, assetId, caption) {
    if (!assetId || (kind !== 'image' && kind !== 'file')) return;
    if (this.narrow?.matches) this.toolsOpen = false;
    await this.send({ kind, asset_id: assetId, text: caption || null });
  }

  async copy(text, key) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.append(area);
      area.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      area.remove();
    }
    this.copied.set(key, ok);
    this.render();
    clearTimeout(this.debounces[`copy:${key}`]);
    this.debounces[`copy:${key}`] = setTimeout(() => {
      delete this.debounces[`copy:${key}`];
      this.copied.delete(key);
      this.render();
    }, 2000);
  }

  async openWeb(target) {
    this.need(await this.call('openWeb', target));
  }

  async openLink(url) {
    this.need(await this.call('openLink', url));
  }

  async saveMedia(ref, name) {
    const data = this.need(await this.call('saveMedia', ref, name || ''));
    if (data?.path) this.cb.toast?.(`Guardado en ${data.path}`);
  }

  async setNotify(value) {
    const result = await this.call('setNotify', value);
    if (result.ok) this.state = result.data;
    this.render();
    if (!result.ok) throw new InboxError(result);
  }

  /** Trae un adjunto por el proceso principal (con sesión si es privado) y lo deja como blob: para la vista. */
  async loadMedia(ref) {
    if (!ref || this.media.has(ref)) return;
    this.media.set(ref, { state: 'loading' });
    const result = await this.call('media', ref);
    if (result.stale) {
      this.media.delete(ref);
      return;
    }
    if (!result.ok) {
      this.media.set(ref, { state: 'error' });
      this.render();
      return;
    }
    const { bytes, mime, name } = result.data;
    this.media.set(ref, { state: 'ok', url: URL.createObjectURL(new Blob([bytes], { type: mime })), mime, name });
    this.trimMedia();
    this.render();
  }

  trimMedia() {
    for (const [ref, entry] of this.media) {
      if (this.media.size <= MAX_MEDIA_CACHE) break;
      if (this.shownMedia.has(ref) || entry.state === 'loading') continue;
      if (entry.url) URL.revokeObjectURL(entry.url);
      this.media.delete(ref);
    }
  }

  // --- Herramientas: catálogo, precios y cotizaciones se piden solo al abrir su pestaña ---

  toolsVisible() {
    return this.mode === 'ready' && !this.root.hidden && Boolean(this.detail) && this.toolsOpen;
  }

  catalogPath() {
    const params = new URLSearchParams();
    if (this.catalogQ.trim()) params.set('q', this.catalogQ.trim());
    if (this.catalogCategory) params.set('category', this.catalogCategory);
    const query = params.toString();
    return `/inbox/tools/catalog${query ? `?${query}` : ''}`;
  }

  quotesPath() {
    const query = this.quotesQ.trim();
    return `/inbox/tools/quotes${query ? `?${new URLSearchParams({ q: query })}` : ''}`;
  }

  ensureTools() {
    if (!this.toolsVisible()) return;
    if (this.toolTab === 'catalogo') this.loadTool('catalog', this.catalogPath());
    else if (this.toolTab === 'precios') this.loadTool('prices', '/inbox/tools/prices');
    else if (this.toolTab === 'cotizaciones') {
      this.loadLocalQuotes();
      if (this.boot?.quote_studio) this.loadTool('quotes', this.quotesPath());
    }
  }

  loadTool(name, path) {
    if (this.debounces[name]) return;
    const entry = this.tool[name];
    if (entry && entry.path === path) return;
    const next = { path, loading: true, data: entry?.data ?? null, error: null };
    this.tool[name] = next;
    this.api('GET', path).then((result) => {
      if (result.stale || this.tool[name] !== next) return;
      next.loading = false;
      if (result.ok) next.data = result.data;
      else next.error = result;
      this.render();
    });
  }

  /** Cotizaciones del cotizador de este equipo (módulo «Cotizador» de Relieve3D). */
  loadLocalQuotes() {
    if (this.tool.local) return;
    const entry = { loading: true, library: null, error: false };
    this.tool.local = entry;
    if (!window.api) {
      entry.loading = false;
      return;
    }
    Promise.resolve()
      .then(() => window.api.quoteLoad())
      .then((library) => {
        entry.library = library;
      })
      .catch(() => {
        entry.error = true;
      })
      .finally(() => {
        entry.loading = false;
        if (this.tool.local === entry) this.render();
      });
  }

  // --- Eventos ---

  onInput(target) {
    const region = target.dataset?.r;
    if (region === 'search') {
      this.search = target.value;
      this.later('list', () => this.resetList());
      return;
    }
    if (region === 'composer-text') {
      const draft = this.draft();
      draft.text = target.value;
      if (!draft.text.trim()) draft.savedReplyId = null;
      if (I.slashQuery(draft.text) === null) this.slashDismissed = false;
      this.slashIndex = 0;
      this.render();
      return;
    }
    if (region === 'picker-q') {
      this.pickerQuery = target.value;
      this.render();
      return;
    }
    const tool = target.dataset?.tool;
    if (tool === 'catalog-q') {
      this.catalogQ = target.value;
      this.later('catalog', () => this.render());
      return;
    }
    if (tool === 'quotes-q') {
      this.quotesQ = target.value;
      this.render();
      this.later('quotes', () => this.render());
      return;
    }
    if (target.dataset?.calc) {
      this.calc[target.dataset.calc] = target.value;
      this.render();
      return;
    }
    if (target.dataset?.line !== undefined) {
      const line = this.calc.lines[Number(target.dataset.line)];
      if (!line || !(target.dataset.field in line)) return;
      line[target.dataset.field] = target.value;
      this.render();
    }
  }

  async onChange(target) {
    const region = target.dataset?.r;
    if (region === 'platform') {
      this.platform = target.value;
      this.resetList();
    } else if (region === 'notify') await this.setNotify(target.checked);
    else if (region === 'file') {
      const file = target.files?.[0];
      target.value = '';
      await this.upload(file);
    } else if (target.dataset?.tool === 'catalog-cat') {
      this.catalogCategory = target.value;
      this.render();
    }
  }

  async onSubmit(form) {
    const kind = form.dataset?.form;
    if (kind === 'login') await this.submitLogin(form);
    else if (kind === 'customer') await this.saveCustomer(form);
    else if (kind === 'send') await this.submitComposer();
  }

  onKey(event) {
    if (this.root.hidden) return;
    if (event.target?.dataset?.r === 'composer-text' && this.composerKey(event)) return;
    if (event.key !== 'Escape') return;
    if (this.lightbox) {
      event.preventDefault();
      this.closeLightbox();
      return;
    }
    if (this.picker) {
      this.picker = null;
      this.render();
      this.focusComposer();
      event.preventDefault();
      return;
    }
    if (this.toolsOpen && this.narrow?.matches) this.toolsOpen = false;
    else return;
    event.preventDefault();
    this.render();
  }

  /** Teclas del cuadro de mensaje: «/» para respuestas guardadas, Enter envía y Shift + Enter salta de línea. */
  composerKey(event) {
    const slash = this.slashState();
    if (slash) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!slash.matches.length) return true;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.slashIndex = (slash.index + step + slash.matches.length) % slash.matches.length;
        this.render();
        return true;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        if (slash.matches.length) {
          event.preventDefault();
          this.pickSlash(slash.index).catch((err) => this.fail(err));
          return true;
        }
        // Sin coincidencias, Enter no manda «/algo» por accidente (Ctrl + Enter sí lo envía como texto).
        if (event.key === 'Enter' && !event.ctrlKey) {
          event.preventDefault();
          return true;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.slashDismissed = true;
        this.render();
        return true;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.submitComposer().catch((err) => this.fail(err));
      return true;
    }
    return false;
  }

  // --- Dibujo ---

  region(name, scope = this.root) {
    return scope?.querySelector(`[data-r="${name}"]`) ?? null;
  }

  /** Reemplaza el HTML de `el` solo si cambió y devuelve el foco al mismo control (data-fk). true si lo cambió. */
  put(el, html) {
    if (!el || this.html.get(el) === html) return false;
    const active = document.activeElement;
    const fk = active && el.contains(active) ? active.getAttribute('data-fk') : null;
    el.innerHTML = html;
    this.html.set(el, html);
    if (fk) el.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus();
    return true;
  }

  /** Arma `el` solo cuando cambia `key`: así escribir en un campo nunca lo vuelve a dibujar. true si lo armó. */
  frame(el, key, build) {
    if (!el || this.frames.get(el) === key) return false;
    const active = document.activeElement;
    const fk = active && el.contains(active) ? active.getAttribute('data-fk') : null;
    let selection = null;
    try {
      if (fk && typeof active.selectionStart === 'number') selection = [active.selectionStart, active.selectionEnd];
    } catch {
      selection = null;
    }
    el.innerHTML = build();
    this.frames.set(el, key);
    if (fk) {
      const next = el.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
      next?.focus();
      try {
        if (selection && next?.setSelectionRange) next.setSelectionRange(...selection);
      } catch {
        /* campo sin selección de texto */
      }
    }
    return true;
  }

  render() {
    if (this.root.hidden) return;
    this.shownMedia = new Set();
    if (this.mode === 'login') {
      this.renderLogin();
      return;
    }
    if (this.mode !== 'ready') {
      this.frame(this.root, 'loading', () => this.loadingHtml());
      this.put(this.region('loading-text'), e(this.loadingText || 'Abriendo Mensajes…'));
      return;
    }
    this.frame(this.root, 'shell', () => this.shellHtml());
    this.renderHead();
    this.renderBanners();
    this.renderFilters();
    this.renderList();
    this.renderChat();
    this.renderTools();
    this.renderLightbox();
    for (const ref of this.shownMedia) if (!this.media.has(ref)) this.loadMedia(ref);
    this.ensureTools();
  }

  headHtml(side = '') {
    return `<header class="ib-head">
      <div class="ib-head-main">${button('← Inicio', 'back', { cls: 'btn ghost' })}<div class="ib-head-text"><h1 class="ib-title">Mensajes · Pabonitas</h1><p class="ib-desc">${e(DESCRIPTION)}</p></div></div>
      ${side}
    </header>`;
  }

  loadingHtml() {
    return `${this.headHtml()}<div class="ib-center"><div class="ib-loading" role="status"><span class="ib-spinner" aria-hidden="true"></span><p data-r="loading-text"></p></div></div>`;
  }

  renderLogin() {
    this.frame(this.root, `login:${this.loginRev ?? 0}`, () => this.loginHtml());
    const error = this.region('login-error');
    if (error) {
      error.hidden = !this.loginError;
      this.put(error, e(this.loginError));
    }
    const busy = this.busy.has('login');
    const submit = this.region('login-submit');
    if (submit) {
      submit.disabled = busy;
      submit.textContent = busy ? 'Entrando…' : 'Entrar';
    }
    this.root.querySelectorAll('[data-form=login] [data-act=resume]').forEach((el) => {
      el.disabled = busy;
    });
  }

  loginHtml() {
    const state = this.state ?? {};
    const canRemember = state.canRemember !== false;
    const hint = canRemember
      ? 'Guarda la contraseña cifrada con Windows para entrar sola al abrir Relieve3D y avisarte de mensajes nuevos.'
      : 'Este equipo no puede cifrar la contraseña: tendrás que escribirla cada vez que abras Relieve3D.';
    return `${this.headHtml()}
    <div class="ib-center">
      <form class="ib-login" data-form="login" novalidate>
        <p class="ib-kicker">Mensajes · Pabonitas</p>
        <h2>Entra con tu cuenta de pabonitas.co</h2>
        <p class="ib-muted">Usa el mismo correo y la misma contraseña con los que entras a la web.</p>
        <label class="ib-field"><span>Correo</span><input name="email" type="email" autocomplete="username" maxlength="254" required value="${e(state.email)}" data-fk="login-email"></label>
        <label class="ib-field"><span>Contraseña</span><input name="password" type="password" autocomplete="current-password" maxlength="256" required data-fk="login-password"></label>
        <details class="ib-details">
          <summary>Servidor y empresa</summary>
          <label class="ib-field"><span>Servidor</span><input name="server" type="url" autocomplete="off" spellcheck="false" placeholder="${DEFAULT_SERVER}" value="${e(state.server || DEFAULT_SERVER)}"></label>
          <label class="ib-field"><span>Empresa</span><input name="tenant" autocomplete="off" spellcheck="false" placeholder="${DEFAULT_TENANT}" value="${e(state.tenant || DEFAULT_TENANT)}"></label>
        </details>
        <label class="ib-check"><input type="checkbox" name="remember"${canRemember && state.remember !== false ? ' checked' : ''}${canRemember ? '' : ' disabled'}><span>Recordarme en este equipo</span></label>
        <p class="ib-hint">${e(hint)}</p>
        <p class="ib-error" data-r="login-error" role="alert" hidden></p>
        <div class="ib-row">
          <button type="submit" class="btn primary" data-r="login-submit">Entrar</button>
          ${state.hasSavedPassword ? button('Entrar con la contraseña guardada', 'resume') : ''}
          ${button('Abrir en la web', 'web', { cls: 'btn ghost' })}
        </div>
      </form>
    </div>`;
  }

  shellHtml() {
    return `${this.headHtml('<div class="ib-head-side" data-r="head"></div>')}
    <div class="ib-banners" data-r="banners"></div>
    <div class="ib-body" data-r="body">
      <section class="ib-list" aria-label="Conversaciones">
        <div class="ib-filters">
          <label class="ib-search"><span class="sr-only">Buscar conversaciones</span><input type="search" data-r="search" data-fk="search" maxlength="120" autocomplete="off" placeholder="Buscar por nombre, usuario, teléfono o mensaje" value="${e(this.search)}"></label>
          <select data-r="platform" data-fk="platform" aria-label="Filtrar por red">${this.platformOptions()}</select>
          <div class="ib-views" role="group" aria-label="Filtrar conversaciones" data-r="views"></div>
        </div>
        <div class="ib-list-body" data-r="list"></div>
      </section>
      <section class="ib-chat" data-r="chat"></section>
      <aside class="ib-tools" data-r="tools" aria-label="Herramientas del chat" hidden></aside>
    </div>
    <div data-r="lightbox"></div>`;
  }

  platformOptions() {
    const options = [['', 'Todas las redes'], ...CHANNEL_PLATFORMS.map((platform) => [platform, I.INBOX_PLATFORM_LABELS[platform]]), ['simulator', 'Pruebas']];
    return options.map(([value, label]) => `<option value="${value}"${value === this.platform ? ' selected' : ''}>${e(label)}</option>`).join('');
  }

  renderHead() {
    const state = this.state ?? {};
    const channels = (this.boot?.channels ?? []).filter((channel) => channel.platform !== 'simulator');
    const pills = channels.length
      ? `<ul class="ib-channels" aria-label="Canales conectados">${channels
          .map((channel) => {
            const status = channel.last_error ? 'error' : channel.status === 'paused' ? 'paused' : 'active';
            const suffix = status === 'error' ? ' · con error' : status === 'paused' ? ' · en pausa' : '';
            return `<li data-state="${status}" title="${e(channel.name)}">${platformDot(channel.platform)}${e(platformLabel(channel))}${suffix}</li>`;
          })
          .join('')}</ul>`
      : '';
    const leaving = this.busy.has('logout');
    this.put(
      this.region('head'),
      `${pills}<div class="ib-account">
        <span class="ib-who" title="${e(state.email)}">${e(state.me?.name || state.email || '')}</span>
        <label class="ib-check" title="Una notificación de Windows cuando un cliente escribe y Relieve3D no está al frente."><input type="checkbox" data-r="notify" data-fk="notify"${state.notify !== false ? ' checked' : ''}><span>Avisos de Windows</span></label>
        ${button('Actualizar', 'refresh')}
        ${button('Abrir en la web', 'web')}
        ${button(leaving ? 'Cerrando…' : 'Cerrar sesión', 'logout', { cls: 'btn ghost', disabled: leaving })}
      </div>`,
    );
  }

  renderBanners() {
    const summary = this.summary ?? {};
    const admin = Boolean(this.boot?.can_admin);
    const out = [];
    if (this.bootError) {
      out.push(notice('warning', e(`No pudimos cargar tus respuestas guardadas, stickers y canales. ${I.inboxErrorMessage(this.bootError)}`), button('Intentar de nuevo', 'reload-boot')));
    }
    const errors = Number(summary.channel_errors) || 0;
    if (errors) {
      const text = plural(
        errors,
        'Un canal tiene un error de conexión: puede que no estén llegando mensajes. Revisa el token o los permisos.',
        '{n} canales tienen errores de conexión: puede que no estén llegando mensajes. Revisa el token o los permisos.',
      );
      out.push(notice('danger', e(text), button('Ver canales', 'settings', { data: { tab: 'canales' } })));
    }
    const failed = Number(summary.failed_messages) || 0;
    if (failed) {
      const text = plural(
        failed,
        'Un mensaje no se pudo enviar en las últimas 48 horas. Ábrelo en su conversación y toca «Reintentar».',
        '{n} mensajes no se pudieron enviar en las últimas 48 horas. Ábrelos en su conversación y toca «Reintentar».',
      );
      out.push(notice('warning', e(text)));
    }
    if (this.boot && !(this.boot.channels ?? []).some((channel) => channel.platform !== 'simulator')) {
      const text = admin
        ? 'Aún no hay redes conectadas. Conecta WhatsApp, Messenger, Instagram o TikTok; mientras tanto puedes probar la bandeja con «Probar» en la web.'
        : 'Aún no hay redes conectadas. Pídele a un administrador que las conecte; mientras tanto puedes probar la bandeja con «Probar» en la web.';
      out.push(notice('info', e(text), admin ? button('Conectar canales', 'settings', { data: { tab: 'canales' } }) : ''));
    }
    this.put(this.region('banners'), out.join(''));
  }

  renderFilters() {
    const chips = I.INBOX_VIEWS.map(({ key, label }) => {
      const count = I.inboxViewCount(this.summary, key);
      const active = this.view === key;
      const countHtml = count ? `<span class="ib-count${key === 'unread' ? ' is-unread' : ''}">${e(I.unreadBadgeText(count))}</span>` : '';
      return button(label, 'view', { cls: `ib-chip${active ? ' is-active' : ''}`, data: { view: key }, pressed: active, html: `${e(label)}${countHtml}` });
    });
    this.put(this.region('views'), chips.join(''));
  }

  renderList() {
    const list = this.list;
    let html;
    if (!list.loaded && !list.error) html = '<p class="ib-state" role="status">Cargando conversaciones…</p>';
    else if (!list.loaded) {
      html = empty('No pudimos cargar las conversaciones', I.inboxErrorMessage(list.error), button('Intentar de nuevo', 'retry-list', { cls: 'btn primary' }));
    } else {
      const parts = [];
      if (list.error) parts.push(notice('warning', 'No pudimos actualizar la lista. Mostramos lo último que cargó.'));
      if (list.loading) parts.push('<p class="ib-state is-inline" role="status">Cargando conversaciones…</p>');
      if (!list.items.length && !list.loading) {
        const hasFilters = this.view !== 'bandeja' || Boolean(this.platform) || Boolean(this.search.trim());
        parts.push(
          hasFilters
            ? empty('Sin resultados', 'Ninguna conversación coincide con el filtro o la búsqueda.', button('Ver la bandeja', 'clear-filters'))
            : empty('Bandeja al día', 'No tienes conversaciones abiertas. Los mensajes nuevos de tus redes llegan aquí solos; las que cerraste están en «Cerradas».'),
        );
      } else if (list.items.length) {
        parts.push(`<ul class="ib-rows">${list.items.map((item) => this.rowHtml(item)).join('')}</ul>`);
        if (list.hasMore) parts.push(button(list.more ? 'Cargando…' : 'Cargar más conversaciones', 'more', { cls: 'btn ib-more', disabled: list.more }));
      }
      html = parts.join('');
    }
    this.put(this.region('list'), html);
  }

  rowHtml(item) {
    const title = I.conversationTitle(item);
    const unread = item.unread_count > 0;
    const active = item.id === this.convId;
    const outgoing = item.last_message_direction === 'out' ? '<span class="ib-ticks" aria-hidden="true">✓✓</span><span class="sr-only">Último mensaje enviado por tu equipo:</span> ' : '';
    const status = item.status !== 'open' ? badge(I.INBOX_STATUS_LABELS[item.status] ?? item.status, STATUS_TONES[item.status] ?? 'muted') : '';
    const tags = (item.tags ?? []).slice(0, 3).map((tag) => `<span class="ib-tag">${e(tag)}</span>`).join('');
    const unreadHtml = unread ? `<span class="ib-unread">${e(I.unreadBadgeText(item.unread_count))}<span class="sr-only"> sin leer</span></span>` : '';
    return `<li><button type="button" class="ib-item${active ? ' is-active' : ''}${unread ? ' is-unread' : ''}" data-act="select" data-id="${item.id}" data-fk="select:${item.id}"${active ? ' aria-current="true"' : ''}>${avatar(title, item.platform)}<span class="ib-item-main"><span class="ib-item-top"><span class="ib-item-title">${e(title)}</span><span class="ib-item-time">${e(item.last_message_at ? I.inboxRelativeTime(item.last_message_at) : '')}</span></span><span class="ib-item-mid"><span class="ib-item-preview">${outgoing}${e(item.last_message_preview || 'Sin mensajes')}</span>${unreadHtml}</span><span class="ib-item-meta">${platformDot(item.platform)}<span>${e(platformLabel(item))}</span>${status}${tags}</span></span></button></li>`;
  }

  /**
   * Como put(), pero por elementos con clave (data-k): lo que no cambió no se toca, así un audio que suena sigue
   * sonando y una foto no parpadea cuando llega otro mensaje. true si cambió algo.
   */
  keyed(el, items) {
    if (!el) return false;
    const active = document.activeElement;
    const fk = active && el.contains(active) ? active.getAttribute('data-fk') : null;
    const keys = new Set(items.map((item) => item.key));
    let changed = false;
    const current = new Map();
    for (const node of [...el.children]) {
      if (node.dataset.k && keys.has(node.dataset.k) && !current.has(node.dataset.k)) current.set(node.dataset.k, node);
      else {
        node.remove();
        changed = true;
      }
    }
    const template = document.createElement('template');
    let cursor = el.firstElementChild;
    for (const { key, html } of items) {
      let node = current.get(key);
      if (!node || this.html.get(node) !== html) {
        template.innerHTML = html;
        const fresh = template.content.firstElementChild;
        fresh.dataset.k = key;
        this.html.set(fresh, html);
        if (node) {
          if (cursor === node) cursor = fresh;
          node.replaceWith(fresh);
        }
        node = fresh;
        changed = true;
      }
      if (node === cursor) cursor = node.nextElementSibling;
      else {
        el.insertBefore(node, cursor);
        changed = true;
      }
    }
    if (fk && !el.contains(document.activeElement)) el.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus();
    return changed;
  }

  // --- Chat abierto ---

  renderChat() {
    this.region('body')?.classList.toggle('has-chat', Boolean(this.convId));
    const el = this.region('chat');
    if (!el) return;
    if (!this.convId) {
      this.frame(
        el,
        'none',
        () =>
          `<div class="ib-center">${empty(
            'Selecciona una conversación',
            'Abre un chat de la lista para leerlo y responder con texto, respuestas guardadas, stickers, fotos, catálogo o cotizaciones.',
          )}</div>`,
      );
      return;
    }
    this.frame(
      el,
      `conv:${this.convId}`,
      () =>
        '<header class="ib-chat-head" data-r="chat-head"></header><div class="ib-customer" data-r="customer"></div><div class="ib-notices" data-r="notices"></div><div class="ib-log" data-r="log" role="region" tabindex="0"></div><div class="ib-composer" data-r="composer"></div>',
    );
    const conversation = this.conversation();
    const ctx = this.sendContext();
    this.put(this.region('chat-head', el), conversation ? this.chatHeadHtml(conversation) : '');
    this.renderCustomer();
    this.put(this.region('notices', el), this.noticesHtml(ctx));
    const log = this.region('log', el);
    log.setAttribute('aria-label', `Mensajes con ${conversation ? I.conversationTitle(conversation) : 'el cliente'}`);
    const changed = this.keyed(log, this.logItems());
    if (this.restoreScroll) {
      log.scrollTop = log.scrollHeight - this.restoreScroll.height + this.restoreScroll.top;
      this.restoreScroll = null;
    } else if (changed && this.stick) log.scrollTop = log.scrollHeight;
    this.renderComposer(ctx);
  }

  chatHeadHtml(conversation) {
    const title = I.conversationTitle(conversation);
    const username = conversation.username?.trim().replace(/^@+/, '');
    const contact = username ? `@${username}` : conversation.phone?.trim() || '';
    const meta = [platformBadge(conversation)];
    if (conversation.channel_name) meta.push(`<span>${e(conversation.channel_name)}</span>`);
    if (contact && contact !== title) meta.push(`<span>${e(contact)}</span>`);
    meta.push(badge(I.INBOX_STATUS_LABELS[conversation.status] ?? conversation.status, STATUS_TONES[conversation.status] ?? 'muted'));
    const disabled = this.busy.has('status') || !this.detail;
    const status = (next, label, hint = '') => button(label, 'status', { data: { status: next }, disabled, title: hint, fk: `status:${label}` });
    const actions =
      conversation.status === 'closed'
        ? [status('open', 'Reabrir')]
        : [
            conversation.status === 'pending'
              ? status('open', 'Quitar pendiente')
              : status('pending', 'Pendiente', 'Guárdala en «Pendientes» para retomarla después'),
            status('closed', 'Cerrar', 'Si el cliente vuelve a escribir, se abre sola'),
          ];
    return `${button('← Conversaciones', 'close-chat', { cls: 'btn ghost ib-only-narrow', aria: 'Volver a la lista de conversaciones' })}
      ${avatar(title, conversation.platform)}
      <div class="ib-chat-title"><h2>${e(title)}</h2><p class="ib-chat-meta">${meta.join('')}</p></div>
      <div class="ib-chat-actions">
        <div class="ib-row" role="group" aria-label="Estado de la conversación">${actions.join('')}</div>
        ${button('Herramientas', 'tools', { cls: `btn${this.toolsOpen ? ' is-on' : ''}`, expanded: this.toolsOpen, html: '<span aria-hidden="true">🧰</span> Herramientas' })}
        ${button('Abrir en la web', 'web', { cls: 'btn ghost', data: { id: conversation.id } })}
      </div>`;
  }

  renderCustomer() {
    const el = this.region('customer');
    if (!el) return;
    const conversation = this.detail?.conversation;
    el.hidden = !conversation;
    if (!conversation) {
      this.frame(el, 'none', () => '');
      return;
    }
    if (this.editingCustomer) {
      this.frame(el, `edit:${conversation.id}`, () => this.customerFormHtml(conversation));
      const error = this.region('customer-error', el);
      if (error) {
        error.hidden = !this.customerError;
        this.put(error, e(this.customerError));
      }
      const save = this.region('customer-save', el);
      if (save) {
        const busy = this.busy.has('customer');
        save.disabled = busy;
        save.textContent = busy ? 'Guardando…' : 'Guardar';
      }
      return;
    }
    this.frame(el, `view:${conversation.id}`, () => '<div class="ib-customer-view" data-r="customer-view"></div>');
    this.put(this.region('customer-view', el), this.customerViewHtml(conversation));
  }

  customerViewHtml(conversation) {
    const tags = (conversation.tags ?? []).map((tag) => `<span class="ib-tag">${e(tag)}</span>`).join('');
    const note = conversation.note?.trim() ?? '';
    const info =
      tags || note
        ? `${tags ? `<div class="ib-tags" aria-label="Etiquetas">${tags}</div>` : ''}${
            note ? `<p class="ib-note" title="${e(note)}"><span class="sr-only">Nota interna: </span>${e(note)}</p>` : ''
          }`
        : '<p class="ib-muted">Sin etiquetas ni notas internas.</p>';
    const hasData = Boolean(tags || note || conversation.display_name?.trim());
    return `<div class="ib-customer-info">${info}</div>${button(hasData ? 'Editar datos' : 'Agregar datos', 'edit-customer', { cls: 'btn ghost' })}`;
  }

  customerFormHtml(conversation) {
    return `<form class="ib-customer-form" data-form="customer" novalidate>
      <label class="ib-field"><span>Nombre del cliente</span><input name="name" maxlength="160" autocomplete="off" placeholder="Como quieres verlo en la bandeja" value="${e(conversation.display_name ?? '')}" data-fk="customer-name"></label>
      <label class="ib-field"><span>Etiquetas</span><input name="tags" maxlength="400" autocomplete="off" placeholder="Ej.: llavero, Navidad, pagó anticipo" value="${e((conversation.tags ?? []).join(', '))}" aria-describedby="ib-tags-hint" data-fk="customer-tags"><small class="ib-hint" id="ib-tags-hint">Separadas por comas. Máximo ${I.INBOX_MAX_TAGS}.</small></label>
      <label class="ib-field is-wide"><span>Nota interna</span><textarea name="note" rows="2" maxlength="2000" placeholder="Solo la ve tu equipo: pedido, ciudad, fecha de entrega…" data-fk="customer-note">${e(conversation.note ?? '')}</textarea></label>
      <p class="ib-error is-wide" data-r="customer-error" role="alert" hidden></p>
      <div class="ib-row is-wide"><button type="submit" class="btn primary" data-r="customer-save" data-fk="customer-save">Guardar</button>${button('Cancelar', 'cancel-customer', { cls: 'btn ghost' })}</div>
    </form>`;
  }

  noticesHtml(ctx) {
    const out = [];
    const conversation = this.conversation();
    if (ctx?.win?.note) out.push(notice(I.windowTone(ctx.win), e(ctx.win.note), '', ` data-window="${e(ctx.win.mode)}"`));
    if (ctx?.paused) {
      const action = this.boot?.can_admin ? button('Ir a canales', 'settings', { data: { tab: 'canales' } }) : '';
      out.push(notice('warning', e(I.INBOX_SEND_ERRORS.paused), action));
    }
    if (conversation?.platform === 'simulator') {
      out.push(notice('info', e(SIMULATOR_HINT), button('Probar en la web', 'web', { data: { id: conversation.id }, fk: 'simulator-web' })));
    }
    if (this.detail && this.detailError) {
      out.push(notice('warning', 'No pudimos actualizar la conversación. Mostramos los últimos mensajes cargados.'));
    }
    if (this.feedback) out.push(notice(this.feedback.tone, e(this.feedback.text), '', ' data-feedback'));
    return out.join('');
  }

  /** Elementos del historial con su clave: «cargar anteriores», separadores de día y mensajes. */
  logItems() {
    const detail = this.detail;
    if (!detail) {
      if (this.detailError) {
        const actions = `${button('Intentar de nuevo', 'retry-detail', { cls: 'btn primary' })}${button('Volver a la bandeja', 'close-chat', { cls: 'btn ghost' })}`;
        return [{ key: 'state', html: empty('No pudimos abrir esta conversación', I.inboxErrorMessage(this.detailError), actions) }];
      }
      return [{ key: 'state', html: '<p class="ib-state" role="status">Cargando conversación…</p>' }];
    }
    const items = [];
    if (this.olderHasMore ?? detail.has_more) {
      const label = this.olderLoading ? 'Cargando…' : 'Cargar mensajes anteriores';
      const error = this.olderError ? '<p class="ib-error" role="alert">No pudimos cargar los mensajes anteriores.</p>' : '';
      items.push({ key: 'older', html: `<div class="ib-older">${button(label, 'older', { disabled: this.olderLoading })}${error}</div>` });
    }
    const messages = this.allMessages();
    if (!messages.length) {
      items.push({ key: 'empty', html: '<p class="ib-state">Todavía no hay mensajes en esta conversación.</p>' });
      return items;
    }
    const now = new Date();
    let day = '';
    for (const message of messages) {
      const key = I.inboxDayKey(message.occurred_at);
      if (key && key !== day) {
        day = key;
        items.push({ key: `day:${key}`, html: `<div class="ib-day"><span>${e(I.inboxDayLabel(message.occurred_at, now))}</span></div>` });
      }
      items.push({ key: `m:${message.id}`, html: this.bubbleHtml(message) });
    }
    return items;
  }

  bubbleHtml(message) {
    const out = message.direction === 'out';
    const failed = out && message.status === 'failed';
    const me = this.state?.me?.id;
    const author = out && message.author === 'agent' && me && message.sent_by_user_id === me ? 'Tú' : I.messageAuthorLabel(message);
    const tone = !out ? 'in' : failed ? 'failed' : message.author === 'auto' ? 'auto' : 'out';
    const media = this.messageMediaHtml(message);
    const text = message.body?.trim() ? `<p class="ib-text">${linkify(message.body)}</p>` : '';
    const content = media || text ? `${media}${text}` : `<p class="ib-text is-kind">${e(I.INBOX_KIND_PREVIEW[message.kind] ?? 'Mensaje')}</p>`;
    const foot = [];
    if (author) foot.push(`<span class="ib-author">${e(author)}</span>`);
    foot.push(`<time datetime="${e(message.occurred_at)}">${e(I.inboxMessageTime(message.occurred_at))}</time>`);
    if (out) {
      const status = message.status;
      const ticks = status === 'sent' ? '✓' : status === 'delivered' || status === 'read' ? '✓✓' : '';
      const tickHtml = ticks ? `<span class="ib-ticks${status === 'read' ? ' is-read' : ''}" aria-hidden="true">${ticks}</span> ` : '';
      foot.push(`<span class="ib-status" data-status="${e(status)}">${tickHtml}${e(I.INBOX_MESSAGE_STATUS_LABELS[status] ?? status)}</span>`);
    }
    let failure = '';
    if (failed) {
      const retrying = this.busy.has(`retry:${message.id}`);
      failure = `<div class="ib-failure"><p>${e(message.error?.trim() || 'El canal no aceptó el mensaje.')}</p>${button(retrying ? 'Reintentando…' : 'Reintentar', 'retry', {
        data: { id: message.id },
        disabled: retrying,
      })}</div>`;
    }
    return `<div class="ib-msg is-${tone}" data-message="${message.id}"><div class="ib-bubble">${content}<p class="ib-msg-foot">${foot.join(
      '<span aria-hidden="true"> · </span>',
    )}</p></div>${failure}</div>`;
  }

  messageMediaHtml(message) {
    const ref = I.inboxMediaRef(message);
    if (!ref) return '';
    const kind = I.inboxMediaKind(message);
    const name = message.media_name || '';
    if (kind === 'file') {
      const label = name || 'Archivo';
      return `<a href="#" class="ib-file" data-act="save-media" data-ref="${e(ref)}" data-name="${e(label)}" title="Guardar en este equipo"><span aria-hidden="true">📎</span> ${e(label)}</a>`;
    }
    const sticker = message.kind === 'sticker';
    const alt = sticker ? 'Sticker' : name || { image: 'Foto del mensaje', audio: 'Audio del mensaje', video: 'Video del mensaje' }[kind];
    return this.mediaHtml(ref, kind, { alt, name, sticker });
  }

  /** Foto, audio o video de un mensaje (se trae por el proceso principal y se muestra como blob:). */
  mediaHtml(ref, kind = 'image', { alt = '', name = '', sticker = false } = {}) {
    this.shownMedia.add(ref);
    const entry = this.media.get(ref);
    if (entry?.state === 'error') {
      return `<span class="ib-media is-error">No pudimos cargar el archivo ${button('Reintentar', 'media-retry', { cls: 'btn ghost', data: { ref }, fk: `media-retry:${ref}` })}</span>`;
    }
    if (entry?.state !== 'ok') return '<span class="ib-media is-loading">Cargando…</span>';
    const url = e(entry.url);
    if (kind === 'audio') return `<audio class="ib-audio" controls preload="metadata" src="${url}" aria-label="${e(alt)}"></audio>`;
    if (kind === 'video') return `<video class="ib-video" controls preload="metadata" src="${url}" aria-label="${e(alt)}"></video>`;
    return `<button type="button" class="ib-media-img${sticker ? ' is-sticker' : ''}" data-act="zoom" data-ref="${e(ref)}" data-alt="${e(alt)}" data-name="${e(name)}" data-fk="zoom:${e(
      ref,
    )}" aria-label="Ampliar: ${e(alt)}"><img src="${url}" alt="${e(alt)}"></button>`;
  }

  /** Miniatura sin ampliar (catálogo, stickers, archivos rápidos); si no carga, queda el recuadro. */
  thumbHtml(ref, alt = '', cls = 'ib-thumb', glyph = '🖼️') {
    if (!ref) return `<span class="${cls} is-empty" aria-hidden="true">${glyph}</span>`;
    this.shownMedia.add(ref);
    const entry = this.media.get(ref);
    if (entry?.state === 'ok') return `<img class="${cls}" src="${e(entry.url)}" alt="${e(alt)}">`;
    return `<span class="${cls} is-empty${entry?.state === 'error' ? '' : ' is-loading'}" aria-hidden="true">${entry?.state === 'error' ? glyph : ''}</span>`;
  }

  closeLightbox() {
    const ref = this.lightbox?.ref;
    this.lightbox = null;
    this.render();
    if (ref) this.root.querySelector(`[data-act=zoom][data-ref="${CSS.escape(ref)}"]`)?.focus();
  }

  // --- Cuadro de mensaje ---

  renderComposer(ctx) {
    const el = this.region('composer');
    if (!el) return;
    el.hidden = !ctx;
    if (!ctx) {
      this.frame(el, 'none', () => '');
      return;
    }
    const id = ctx.conversation.id;
    const sending = this.busy.has('send');
    if (ctx.template) {
      this.frame(el, `template:${id}`, () => '<div class="ib-template" data-r="template"></div>');
      const label = sending ? 'Enviando…' : `Enviar plantilla «${ctx.win.template_name ?? ''}»`;
      this.put(
        this.region('template', el),
        `<p>Pasaron más de 24 horas desde el último mensaje del cliente. Envía la plantilla aprobada y, cuando responda, podrás escribirle libremente.</p>${button(label, 'template', {
          cls: 'btn primary',
          disabled: sending || ctx.paused,
          fk: 'template',
        })}`,
      );
      return;
    }
    const draft = this.draft(id);
    const built = this.frame(el, `compose:${id}:${ctx.canSend}:${ctx.caps.files}`, () => this.composerHtml(ctx));
    const input = this.region('composer-text', el);
    if (built && input) input.value = draft.text;
    this.renderPicker(ctx);
    this.put(this.region('attachment', el), this.attachmentHtml(ctx, draft));
    const slash = this.slashState();
    this.put(this.region('slash', el), slash ? this.slashHtml(slash) : '');
    if (input) {
      input.setAttribute('aria-expanded', String(Boolean(slash)));
      if (slash?.matches.length) {
        input.setAttribute('aria-controls', 'ib-slash-list');
        input.setAttribute('aria-activedescendant', `ib-slash-${slash.index}`);
      } else {
        input.removeAttribute('aria-controls');
        input.removeAttribute('aria-activedescendant');
      }
    }
    this.put(this.region('counter', el), this.counterHtml(ctx, draft));
    const blocked = !ctx.canSend || sending || this.busy.has('upload');
    this.put(
      this.region('send-slot', el),
      `<button type="submit" class="btn primary" data-fk="send"${blocked ? ' disabled' : ''}>${sending ? 'Enviando…' : 'Enviar'}</button>`,
    );
    this.put(this.region('toolbar', el), this.toolbarHtml(ctx));
  }

  composerHtml(ctx) {
    const placeholder = ctx.canSend
      ? 'Escribe un mensaje… (usa / para buscar una respuesta guardada)'
      : 'Por ahora no puedes responder en esta conversación.';
    return `<form class="ib-compose" data-form="send" novalidate>
      <div data-r="picker"></div>
      <div data-r="attachment"></div>
      <div class="ib-compose-box">
        <div data-r="slash"></div>
        <textarea data-r="composer-text" data-fk="composer-text" rows="3" placeholder="${e(placeholder)}" aria-label="${e(`Mensaje para ${I.conversationTitle(ctx.conversation)}`)}" aria-describedby="ib-composer-hint" aria-autocomplete="list" aria-expanded="false"${ctx.canSend ? '' : ' disabled'}></textarea>
      </div>
      <div class="ib-compose-foot"><div data-r="counter"></div><div data-r="send-slot"></div></div>
      <div class="ib-toolbar" role="toolbar" aria-label="Herramientas del mensaje" data-r="toolbar"></div>
      <input type="file" data-r="file" accept="${ctx.caps.files ? I.INBOX_UPLOAD_ACCEPT : I.INBOX_IMAGE_ACCEPT}" tabindex="-1" hidden>
    </form>`;
  }

  /** Respuestas guardadas o stickers, arriba del cuadro de texto. */
  renderPicker(ctx) {
    const el = this.region('picker');
    if (!el) return;
    if (!this.picker || !ctx.canSend) {
      this.frame(el, 'none', () => '');
      return;
    }
    if (this.picker === 'replies') {
      this.frame(
        el,
        'replies',
        () =>
          `<div class="ib-picker" data-picker="replies"><div class="ib-picker-bar"><label class="ib-search"><span class="sr-only">Buscar respuesta guardada</span><input type="search" data-r="picker-q" data-fk="picker-q" maxlength="80" autocomplete="off" placeholder="Buscar por título, atajo o texto" aria-label="Buscar respuesta guardada" value="${e(
            this.pickerQuery,
          )}"></label>${button('Administrar', 'settings', { cls: 'btn ghost', data: { tab: 'respuestas' } })}</div><div data-r="picker-list"></div></div>`,
      );
      const replies = this.activeReplies();
      const matches = I.matchSavedReplies(replies, this.pickerQuery, 50);
      const html = matches.length
        ? `<ul class="ib-picker-list">${matches
            .map(
              (reply) =>
                `<li>${button('', 'reply', {
                  cls: 'ib-reply',
                  data: { id: reply.id },
                  html: `<span class="ib-reply-top"><b>${e(reply.title)}</b>${reply.shortcut ? `<code>/${e(reply.shortcut)}</code>` : ''}${
                    reply.category ? `<span class="ib-pill">${e(reply.category)}</span>` : ''
                  }</span><span class="ib-reply-body">${e(reply.body)}</span>`,
                })}</li>`,
            )
            .join('')}</ul>`
        : `<p class="ib-muted">${
            replies.length ? 'Ninguna respuesta coincide con la búsqueda.' : 'Aún no tienes respuestas guardadas. Créalas en Ajustes → Respuestas guardadas.'
          }</p>`;
      this.put(this.region('picker-list', el), html);
      return;
    }
    this.frame(el, 'stickers', () => '<div class="ib-picker" data-picker="stickers" data-r="sticker-out"></div>');
    const stickers = this.boot?.stickers ?? [];
    const sending = this.busy.has('send');
    const hint = ctx.caps.stickers ? '' : `<p class="ib-hint">${e(`${ctx.label} no recibe stickers propios: se envían como foto.`)}</p>`;
    const grid = stickers.length
      ? `<ul class="ib-stickers">${stickers
          .map(
            (sticker) =>
              `<li>${button('', 'sticker', {
                cls: 'ib-sticker',
                data: { id: sticker.id },
                disabled: sending,
                title: sticker.name,
                aria: `Enviar sticker ${sticker.name}`,
                html: `${this.thumbHtml(sticker.url, '', 'ib-sticker-img', '💟')}<span>${e(sticker.name)}</span>`,
              })}</li>`,
          )
          .join('')}</ul>`
      : `<div class="ib-row"><span class="ib-muted">Aún no tienes stickers.</span>${button('Subir stickers', 'settings', { data: { tab: 'stickers' } })}</div>`;
    this.put(this.region('sticker-out', el), `${hint}${grid}`);
  }

  attachmentHtml(ctx, draft) {
    const attachment = draft.attachment;
    if (!attachment) return '';
    const name = attachment.file_name || (attachment.is_image ? 'Foto' : 'Archivo');
    const preview = attachment.is_image ? this.thumbHtml(attachment.url, '', 'ib-attachment-thumb') : '<span class="ib-attachment-thumb is-empty" aria-hidden="true">📄</span>';
    const size = I.formatFileSize(attachment.size_bytes);
    const parts = I.estimateSendParts(draft.text, ctx.conversation.platform, ctx.caps, true);
    let hint = '';
    if (draft.text.trim() && parts > 1) {
      const text = I.INBOX_CAPTION_PLATFORMS.includes(ctx.conversation.platform)
        ? 'El texto es largo para ir debajo de la foto: se enviará en un mensaje aparte.'
        : `${ctx.label} no admite texto debajo de la foto: se enviará en un mensaje aparte.`;
      hint = `<p class="ib-hint">${e(text)}</p>`;
    }
    return `<div class="ib-attachment" data-attachment="${e(attachment.asset_id)}">${preview}<span class="ib-attachment-name">${e(name)}</span>${
      size ? `<span class="ib-muted">${e(size)}</span>` : ''
    }${button('Quitar', 'remove-attachment', { cls: 'btn ghost', aria: `Quitar ${name}` })}</div>${hint}`;
  }

  slashHtml(slash) {
    if (!slash.matches.length) {
      const text = this.activeReplies().length
        ? 'Ninguna respuesta coincide. Sigue escribiendo, borra la «/» o pulsa Esc para enviarlo como texto.'
        : 'Aún no tienes respuestas guardadas. Créalas en Ajustes → Respuestas guardadas. Pulsa Esc para seguir escribiendo.';
      return `<div class="ib-slash" data-slash-empty><p class="ib-muted">${e(text)}</p></div>`;
    }
    const options = slash.matches
      .map(
        (reply, index) =>
          `<li role="option" id="ib-slash-${index}" data-slash="${index}" aria-selected="${index === slash.index}"${index === slash.index ? ' class="is-active"' : ''}><span class="ib-reply-top">${
            reply.shortcut ? `<code>/${e(reply.shortcut)}</code>` : ''
          }<b>${e(reply.title)}</b></span><span class="ib-reply-body">${e(reply.body)}</span></li>`,
      )
      .join('');
    return `<div class="ib-slash"><ul role="listbox" id="ib-slash-list" aria-label="Respuestas guardadas">${options}</ul></div>`;
  }

  counterHtml(ctx, draft) {
    const text = draft.text.trim();
    if (!text) return '<p class="ib-hint" id="ib-composer-hint">Enter envía · Shift + Enter hace un salto de línea.</p>';
    const chars = I.inboxTextLength(text);
    const parts = I.estimateSendParts(draft.text, ctx.conversation.platform, ctx.caps, Boolean(draft.attachment));
    const label = `${I.formatInboxNumber(chars)} caracteres${parts > 1 ? ` · saldrá en ${parts} mensajes` : ''}`;
    return `<p class="ib-hint${chars > I.INBOX_MAX_TEXT ? ' is-error' : ''}" id="ib-composer-hint">${e(label)}</p>`;
  }

  toolbarHtml(ctx) {
    const { caps, label, canSend } = ctx;
    const uploading = this.busy.has('upload');
    const stickerBlocked = !caps.stickers && !caps.images ? I.fillLabel(I.INBOX_SEND_ERRORS.stickers, label) : '';
    const attachBlocked = !caps.images && !caps.files ? I.fillLabel(I.INBOX_SEND_ERRORS.images, label) : '';
    const icon = (glyph, text) => `<span aria-hidden="true">${glyph}</span> ${e(text)}`;
    const attachLabel = uploading ? 'Subiendo…' : caps.files ? 'Foto o archivo' : 'Foto';
    const tools = I.INBOX_TOOLS_TABS.map(({ key, label: text }) =>
      button(text, 'open-tool', {
        cls: `btn ghost${this.toolsOpen && this.toolTab === key ? ' is-on' : ''}`,
        data: { tab: key },
        html: icon(TOOL_ICONS[key] ?? '•', text),
      }),
    );
    return [
      button('Respuestas', 'picker', { data: { key: 'replies' }, expanded: this.picker === 'replies', disabled: !canSend, html: icon('⚡', 'Respuestas') }),
      button('Stickers', 'picker', {
        data: { key: 'stickers' },
        expanded: this.picker === 'stickers',
        disabled: !canSend || Boolean(stickerBlocked),
        title: stickerBlocked,
        html: icon('💟', 'Stickers'),
      }),
      button(attachLabel, 'attach', { disabled: !canSend || uploading || Boolean(attachBlocked), title: attachBlocked, html: icon('📎', attachLabel) }),
      '<span class="ib-sep" aria-hidden="true"></span>',
      ...tools,
    ].join('');
  }

  // --- Herramientas del chat ---

  renderTools() {
    const el = this.region('tools');
    if (!el) return;
    const ctx = this.sendContext();
    const open = Boolean(ctx) && this.toolsOpen;
    el.hidden = !open;
    this.region('body')?.classList.toggle('has-tools', open);
    if (!open) return;
    this.frame(
      el,
      'tools',
      () =>
        `<div class="ib-tools-head"><div><h2>Herramientas del chat</h2><p class="ib-muted" data-r="tools-desc"></p></div>${button('✕', 'close-tools', {
          cls: 'btn ghost ib-icon',
          aria: 'Cerrar herramientas',
        })}</div><div class="ib-tabs" role="group" aria-label="Herramienta" data-r="tool-tabs"></div><div data-r="tool-note"></div><div class="ib-tool-body" data-r="tool-body"></div>`,
    );
    this.put(this.region('tools-desc', el), e(`Para responder a ${I.conversationTitle(ctx.conversation)} · ${ctx.label}`));
    this.put(
      this.region('tool-tabs', el),
      I.INBOX_TOOLS_TABS.map(({ key, label }) =>
        button(label, 'tool-tab', { cls: `ib-chip${this.toolTab === key ? ' is-active' : ''}`, data: { tab: key }, pressed: this.toolTab === key }),
      ).join(''),
    );
    this.put(this.region('tool-note', el), ctx.canSend ? '' : notice('info', e(NO_REPLY_TOOLS)));
    const body = this.region('tool-body', el);
    if (this.toolTab === 'catalogo') this.renderCatalog(body, ctx);
    else if (this.toolTab === 'precios') this.renderPrices(body, ctx);
    else if (this.toolTab === 'cotizaciones') this.renderQuotes(body, ctx);
    else if (this.toolTab === 'calculadora') this.renderCalculator(body, ctx);
    else this.renderFiles(body, ctx);
  }

  /** «Pegar» deja el texto en el cuadro de mensaje para revisarlo antes de enviar (solo si se puede escribir). */
  pasteButton(ctx, text, label = 'Pegar', key = '', aria = '') {
    if (!ctx?.canSend || !text?.trim()) return '';
    return button(label, 'paste', { data: { text }, fk: `paste:${key}`, aria, title: 'Lo pone en el cuadro de mensaje para que lo revises antes de enviar' });
  }

  copyButton(key, text, label = 'Copiar', aria = '') {
    if (!text) return '';
    const state = this.copied.get(key);
    const shown = state === true ? 'Copiado' : state === false ? 'No se pudo copiar' : label;
    return button(shown, 'copy', { cls: 'btn ghost', data: { text, key }, fk: `copy:${key}`, aria: state === undefined ? aria : '' });
  }

  toolErrorHtml(err, key) {
    return notice('danger', e(I.inboxErrorMessage(err, TOOL_FAILED)), button('Intentar de nuevo', 'retry-tool', { data: { key } }));
  }

  loadingLine(text) {
    return `<p class="ib-state" role="status">${e(text)}</p>`;
  }

  renderCatalog(body, ctx) {
    this.frame(
      body,
      'catalogo',
      () =>
        `<div class="ib-tool-bar"><label class="ib-search"><span class="sr-only">Buscar en el catálogo</span><input type="search" data-tool="catalog-q" data-fk="catalog-q" maxlength="80" autocomplete="off" placeholder="Buscar producto (llavero, lámpara, taza…)" value="${e(
          this.catalogQ,
        )}"></label><span data-r="catalog-cat"></span></div><div data-r="tool-out"></div>`,
    );
    const entry = this.tool.catalog;
    const categories = entry?.data?.categories ?? [];
    this.put(
      this.region('catalog-cat', body),
      categories.length
        ? `<select data-tool="catalog-cat" data-fk="catalog-cat" aria-label="Categoría"><option value="">Todas las categorías</option>${categories
            .map((category) => `<option value="${e(category.slug)}"${category.slug === this.catalogCategory ? ' selected' : ''}>${e(category.name)}</option>`)
            .join('')}</select>`
        : '',
    );
    this.put(this.region('tool-out', body), this.catalogHtml(ctx, entry));
  }

  catalogHtml(ctx, entry) {
    const data = entry?.data;
    if (!data) return entry?.error ? this.toolErrorHtml(entry.error, 'catalog') : this.loadingLine('Cargando catálogo…');
    const out = [];
    if (entry.error) out.push(this.toolErrorHtml(entry.error, 'catalog'));
    if (!data.catalog_url) out.push(notice('warning', 'La tienda en línea no está publicada, así que no hay catálogo para compartir todavía.'));
    else {
      out.push(
        `<div class="ib-callout"><p class="ib-callout-title">Catálogo completo</p><p class="ib-url">${e(data.catalog_url)}</p><div class="ib-row">${this.pasteButton(
          ctx,
          `Mira nuestro catálogo completo aquí: ${data.catalog_url}`,
          'Pegar enlace',
          'catalog-url',
        )}${this.copyButton('catalog-url', data.catalog_url, 'Copiar', 'Copiar enlace del catálogo')}</div></div>`,
      );
    }
    const products = data.products ?? [];
    if (!products.length) {
      const filtered = this.catalogQ.trim() || this.catalogCategory;
      out.push(`<p class="ib-muted">${filtered ? 'Ningún producto coincide con la búsqueda.' : 'Aún no hay productos publicados en la tienda.'}</p>`);
    } else {
      out.push(`<ul class="ib-cards${entry.loading ? ' is-stale' : ''}" aria-busy="${entry.loading}">${products.map((product) => this.productHtml(ctx, product)).join('')}</ul>`);
    }
    if (ctx.canSend && !ctx.caps.images) out.push('<p class="ib-hint">Este canal no recibe fotos desde la bandeja: pega el texto, que ya trae el enlace del producto.</p>');
    return out.join('');
  }

  productHtml(ctx, product) {
    const meta = `${product.category || 'Sin categoría'}${product.is_available === false ? ' · Agotado' : ''}`;
    const actions = [this.pasteButton(ctx, product.share_text, 'Pegar texto', `product:${product.id}`, `Pegar texto de ${product.name}`)];
    if (ctx.canSend && ctx.caps.images && product.image_asset_id) {
      actions.push(
        button('Enviar con foto', 'send-asset', {
          cls: 'btn primary',
          data: { kind: 'image', asset: product.image_asset_id, text: product.share_text ?? '' },
          disabled: this.busy.has('send'),
          aria: `Enviar ${product.name} con foto`,
          fk: `send-product:${product.id}`,
        }),
      );
    }
    if (product.url) actions.push(this.copyButton(`product-url:${product.id}`, product.url, 'Copiar enlace', `Copiar enlace de ${product.name}`));
    return `<li class="ib-card" data-product="${e(product.id)}">${this.thumbHtml(product.thumbnail_path || product.image_path)}<div class="ib-card-main"><p class="ib-card-title">${e(
      product.name,
    )}</p><p class="ib-price">${e(product.price_text || 'Precio por cotización')}</p><p class="ib-muted">${e(meta)}</p><div class="ib-row">${actions.join('')}</div></div></li>`;
  }

  renderPrices(body, ctx) {
    this.frame(body, 'precios', () => '<div data-r="tool-out"></div>');
    this.put(this.region('tool-out', body), this.pricesHtml(ctx, this.tool.prices));
  }

  pricesHtml(ctx, entry) {
    const data = entry?.data;
    if (!data) return entry?.error ? this.toolErrorHtml(entry.error, 'prices') : this.loadingLine('Cargando precios…');
    const groups = (data.groups ?? []).filter((group) => group.items?.length);
    if (!groups.length) return '<p class="ib-muted">Aún no hay productos publicados en la tienda.</p>';
    const callout = `<div class="ib-callout"><p class="ib-callout-title">Lista de precios completa</p><p class="ib-muted">Todos los productos por categoría, con el enlace al catálogo al final.</p><div class="ib-row">${this.pasteButton(
      ctx,
      data.text,
      'Pegar lista',
      'prices',
    )}${this.copyButton('prices', data.text, 'Copiar', 'Copiar lista de precios')}</div></div>`;
    const list = groups
      .map((group) => {
        const items = group.items
          .map((item) => {
            const price = item.price_text?.trim() || 'precio por cotización';
            const text = item.url ? I.priceItemText(item) : `${item.name.trim()}: ${price}`;
            return `<li><div class="ib-card-main"><p class="ib-card-title">${e(item.name)}</p><p class="ib-muted">${e(item.price_text || 'Precio por cotización')}${
              item.is_available === false ? ' · Agotado' : ''
            }</p></div><div class="ib-row">${this.pasteButton(ctx, text, 'Pegar', `price:${item.id}`, `Pegar precio de ${item.name}`)}${this.copyButton(
              `price:${item.id}`,
              text,
              'Copiar',
              `Copiar precio de ${item.name}`,
            )}</div></li>`;
          })
          .join('');
        return `<section class="ib-price-group"><h3>${e(group.category)}</h3><ul class="ib-price-list">${items}</ul></section>`;
      })
      .join('');
    return `${entry.error ? this.toolErrorHtml(entry.error, 'prices') : ''}${callout}${list}`;
  }

  renderQuotes(body, ctx) {
    this.frame(
      body,
      'cotizaciones',
      () =>
        `<div class="ib-tool-bar"><label class="ib-search"><span class="sr-only">Buscar cotizaciones</span><input type="search" data-tool="quotes-q" data-fk="quotes-q" maxlength="80" autocomplete="off" placeholder="Buscar por número, cliente o producto" value="${e(
          this.quotesQ,
        )}"></label>${button('Abrir cotizador', 'open-quote', { cls: 'btn ghost', title: 'Abre el Cotizador de Relieve3D' })}</div><div data-r="tool-out"></div>`,
    );
    this.put(this.region('tool-out', body), this.quotesHtml(ctx));
  }

  quotesHtml(ctx) {
    const query = this.quotesQ.trim();
    const local = this.tool.local;
    const localItems = local?.library ? I.localQuoteItems(local.library, query) : [];
    let localBody;
    if (!local || (local.loading && !local.library)) localBody = this.loadingLine('Cargando cotizaciones…');
    else if (local.error) {
      localBody = notice('danger', 'No pudimos leer las cotizaciones de este equipo.', button('Intentar de nuevo', 'retry-tool', { data: { key: 'local' } }));
    } else if (!localItems.length) {
      const saved = (local.library?.quotes ?? []).length > 0;
      const text = query
        ? 'Ninguna cotización coincide con la búsqueda.'
        : saved
          ? 'Tus cotizaciones de este equipo aún no tienen una versión emitida. Emítela en el Cotizador de Relieve3D para compartirla.'
          : 'Aún no tienes cotizaciones en este equipo. Créalas en el Cotizador de Relieve3D.';
      localBody = `<p class="ib-muted">${e(text)}</p>`;
    } else localBody = `<ul class="ib-cards">${localItems.map((item) => this.localQuoteHtml(ctx, item)).join('')}</ul>`;
    const sections = [`<section class="ib-quote-section" data-quotes="local"><h3>En este equipo · Cotizador de Relieve3D</h3>${localBody}</section>`];
    const studio = this.boot?.quote_studio;
    if (studio) {
      const name = studio.name || 'el cotizador';
      const entry = this.tool.quotes;
      let webBody;
      if (!entry?.data) webBody = entry?.error ? this.toolErrorHtml(entry.error, 'quotes') : this.loadingLine('Cargando cotizaciones…');
      else {
        // Las que ya salen arriba (mismo registro sincronizado) no se repiten.
        const shown = new Set(localItems.map((item) => String(item.id)));
        const all = entry.data.quotes ?? [];
        const quotes = all.filter((quote) => !shown.has(String(quote.id)));
        if (!quotes.length) {
          const text = all.length
            ? 'Las cotizaciones sincronizadas ya aparecen arriba, en las de este equipo.'
            : query
              ? 'Ninguna cotización coincide con la búsqueda.'
              : `Aún no hay cotizaciones sincronizadas. Créalas en ${name} y aparecerán aquí.`;
          webBody = `<p class="ib-muted">${e(text)}</p>`;
        } else webBody = `<ul class="ib-cards${entry.loading ? ' is-stale' : ''}">${quotes.map((quote) => this.webQuoteHtml(ctx, quote, name)).join('')}</ul>`;
        if (entry.error) webBody = `${this.toolErrorHtml(entry.error, 'quotes')}${webBody}`;
      }
      sections.push(
        `<section class="ib-quote-section" data-quotes="web"><h3>${e(`Sincronizadas en ${name}`)}</h3><p class="ib-hint">${e(
          `Las cotizaciones se hacen en el cotizador de ${name} y se sincronizan aquí. Solo se pueden compartir las que ya tienen una versión emitida.`,
        )}</p>${webBody}</section>`,
      );
    }
    return sections.join('');
  }

  quoteCardHtml({ attrs, number, status, version, who, product, valid, total, actions }) {
    return `<li class="ib-card ib-quote"${attrs}><div class="ib-card-main"><p class="ib-card-title">${e(number)}${status ? ` <span class="ib-pill">${e(status)}</span>` : ''}${
      version ? ` <span class="ib-muted">versión ${e(version)}</span>` : ''
    }</p><p>${e(who)}</p>${product ? `<p class="ib-muted">${e(product)}</p>` : ''}<p class="ib-muted">${e(valid)}</p>${
      total ? `<p class="ib-total">${e(total)}</p>` : ''
    }${actions}</div></li>`;
  }

  localQuoteHtml(ctx, item) {
    const product = item.product ? `${item.product}${item.quantity ? ` · ${item.quantity} u.` : ''}` : '';
    const total = item.total === null || item.total === undefined || item.total === '' ? null : Number(item.total);
    return this.quoteCardHtml({
      attrs: ` data-local-quote="${e(item.id)}"`,
      number: item.number,
      status: item.statusLabel,
      version: item.version,
      who: [item.customer, item.contact].filter(Boolean).join(' · ') || 'Sin cliente',
      product,
      valid: item.validUntil ? `Válida hasta ${shortDate(item.validUntil)}` : 'Sin fecha de vencimiento',
      total: Number.isFinite(total) ? I.formatCop(total) : '',
      actions: `<div class="ib-row">${this.pasteButton(ctx, item.text, 'Pegar cotización', `local:${item.id}`, `Pegar cotización ${item.number}`)}${this.copyButton(
        `local:${item.id}`,
        item.text,
        'Copiar',
        `Copiar cotización ${item.number}`,
      )}</div>`,
    });
  }

  webQuoteHtml(ctx, quote, studioName) {
    const product = quote.product ? `${quote.product}${quote.quantity ? ` · ${quote.quantity} u.` : ''}` : '';
    const valid = `${quote.valid_until ? `Válida hasta ${quote.valid_until}` : 'Sin fecha de vencimiento'}${quote.order_number ? ` · Pedido ${quote.order_number}` : ''}`;
    const actions =
      quote.shareable && quote.share_text
        ? `<div class="ib-row">${this.pasteButton(ctx, quote.share_text, 'Pegar cotización', `quote:${quote.id}`, `Pegar cotización ${quote.number}`)}${this.copyButton(
            `quote:${quote.id}`,
            quote.share_text,
            'Copiar',
            `Copiar cotización ${quote.number}`,
          )}</div>`
        : `<p class="ib-hint">${e(`Emite una versión en ${studioName} para poder compartirla con el cliente.`)}</p>`;
    return this.quoteCardHtml({
      attrs: ` data-web-quote="${e(quote.id)}"`,
      number: quote.number,
      status: quote.status_label,
      version: quote.version,
      who: [quote.customer, quote.contact].filter(Boolean).join(' · ') || 'Sin cliente',
      product,
      valid,
      total: quote.total_text,
      actions,
    });
  }

  renderCalculator(body, ctx) {
    this.frame(body, `calc:${this.calcRev}`, () => this.calculatorHtml());
    this.put(this.region('calc-result', body), this.calcResultHtml(ctx));
    this.put(this.region('order-result', body), this.orderResultHtml(ctx));
    for (const remove of body.querySelectorAll('[data-act=calc-remove]')) {
      const index = Number(remove.dataset.index);
      remove.setAttribute('aria-label', `Quitar ${this.calc.lines[index]?.name.trim() || `producto ${index + 1}`}`);
    }
  }

  calculatorHtml() {
    const calc = this.calc;
    const field = (label, attrs, value, cls = 'ib-field') =>
      `<label class="${cls}"><span>${e(label)}</span><input ${attrs} autocomplete="off" value="${e(value)}"></label>`;
    const lines = calc.lines
      .map(
        (line, index) =>
          `<li class="ib-order-line">${field('Producto', `data-line="${index}" data-field="name" data-fk="line-${index}-name" maxlength="120" placeholder="Producto ${index + 1}"`, line.name)}${field(
            'Cant.',
            `data-line="${index}" data-field="quantity" data-fk="line-${index}-quantity" inputmode="numeric" maxlength="6"`,
            line.quantity,
            'ib-field is-qty',
          )}${field('Precio unidad', `data-line="${index}" data-field="unitPrice" data-fk="line-${index}-unitPrice" inputmode="decimal" maxlength="16" placeholder="15.000"`, line.unitPrice)}${button(
            '',
            'calc-remove',
            { cls: 'btn ghost ib-icon', data: { index }, fk: `calc-remove:${index}`, aria: `Quitar ${line.name.trim() || `producto ${index + 1}`}`, html: '<span aria-hidden="true">🗑</span>' },
          )}</li>`,
      )
      .join('');
    const add =
      calc.lines.length < MAX_ORDER_LINES ? button('Agregar producto', 'calc-add', { cls: 'btn ghost', html: '<span aria-hidden="true">＋</span> Agregar producto' }) : '';
    return `<section class="ib-calc" data-calc-section="quick"><h3>Calculadora rápida</h3>
      <label class="ib-field"><span>Operación</span><input data-calc="expr" data-fk="calc-expr" inputmode="decimal" maxlength="200" autocomplete="off" placeholder="Ej.: 15.000 × 12 - 10%" aria-describedby="ib-calc-hint" value="${e(
        calc.expr,
      )}"><small class="ib-hint" id="ib-calc-hint">Suma, resta, × o *, ÷ o /, paréntesis y %. «a - 10%» descuenta el 10 % de a.</small></label>
      <div data-r="calc-result"></div>
    </section>
    <section class="ib-calc" data-calc-section="order"><h3>Resumen de pedido</h3><p class="ib-hint">Cantidades × precio, descuento, envío y anticipo. Arma el texto para pegarlo en el chat.</p>
      <ul class="ib-order-lines">${lines}</ul>${add}
      <div class="ib-order-totals">${field('Descuento %', 'data-calc="discount" data-fk="calc-discount" inputmode="decimal" maxlength="6" placeholder="0"', calc.discount)}${field(
        'Envío',
        'data-calc="shipping" data-fk="calc-shipping" inputmode="decimal" maxlength="16" placeholder="0"',
        calc.shipping,
      )}${field('Anticipo %', 'data-calc="deposit" data-fk="calc-deposit" inputmode="decimal" maxlength="6" placeholder="Ej.: 50"', calc.deposit)}</div>
      <div data-r="order-result"></div>
    </section>`;
  }

  calcResultHtml(ctx) {
    const { value, error } = I.evaluateCalculator(this.calc.expr);
    if (error) return `<p class="ib-error" role="alert">${e(error)}</p>`;
    if (value === null || value === undefined) return '';
    const text = I.formatCop(value);
    return `<div class="ib-result"><p class="ib-total" data-calc-result aria-live="polite">${e(text)} <span class="ib-muted">(${e(I.formatInboxNumber(value))})</span></p><div class="ib-row">${this.pasteButton(
      ctx,
      text,
      'Pegar',
      'calc',
      'Pegar resultado',
    )}${this.copyButton('calc', text, 'Copiar', 'Copiar resultado')}</div></div>`;
  }

  orderResultHtml(ctx) {
    const calc = this.calc;
    const order = I.calculateOrder({ lines: calc.lines, discountPercent: calc.discount, shipping: calc.shipping, depositPercent: calc.deposit });
    const errors = order.errors.length ? `<ul class="ib-error" role="alert">${order.errors.map((error) => `<li>${e(error)}</li>`).join('')}</ul>` : '';
    if (!order.text) return errors;
    const paste = order.errors.length ? '' : this.pasteButton(ctx, order.text, 'Pegar resumen', 'order');
    return `${errors}<div class="ib-result"><pre data-order-text>${e(order.text)}</pre><div class="ib-row">${paste}${this.copyButton('order', order.text, 'Copiar', 'Copiar resumen')}</div></div>`;
  }

  renderFiles(body, ctx) {
    this.frame(body, 'archivos', () => '<div data-r="tool-out"></div>');
    this.put(this.region('tool-out', body), this.filesHtml(ctx));
  }

  filesHtml(ctx) {
    if (!this.boot) return this.loadingLine('Cargando archivos…');
    const links = (this.boot.quick_links ?? []).filter((link) => link.is_active !== false);
    if (!links.length) {
      return empty(
        'Aún no tienes archivos rápidos',
        'Guarda enlaces (catálogo en PDF, carpeta de fotos, videos) o sube archivos para enviarlos con un toque.',
        button('Agregar archivos', 'settings', { data: { tab: 'archivos' } }),
      );
    }
    return `<div class="ib-tool-bar"><p class="ib-muted">${e(plural(links.length, '1 archivo rápido', '{n} archivos rápidos'))}</p>${button('Administrar', 'settings', {
      cls: 'btn ghost',
      data: { tab: 'archivos' },
    })}</div><ul class="ib-cards">${links.map((link) => this.quickLinkHtml(ctx, link)).join('')}</ul>`;
  }

  quickLinkHtml(ctx, link) {
    const kind = I.quickLinkSendKind(link, ctx.caps);
    const preview = link.is_image ? this.thumbHtml(link.preview_url) : '<span class="ib-thumb is-empty" aria-hidden="true">📄</span>';
    const actions = [this.pasteButton(ctx, I.quickLinkText(link), 'Pegar enlace', `link:${link.id}`, `Pegar enlace de ${link.title}`)];
    if (ctx.canSend && kind) {
      const label = kind === 'image' ? 'Enviar foto' : 'Enviar archivo';
      actions.push(
        button(label, 'send-asset', {
          cls: 'btn primary',
          data: { kind, asset: link.asset_id, text: '' },
          disabled: this.busy.has('send'),
          aria: `${label}: ${link.title}`,
          fk: `send-link:${link.id}`,
        }),
      );
    }
    actions.push(this.copyButton(`link:${link.id}`, link.url, 'Copiar enlace', `Copiar enlace de ${link.title}`));
    return `<li class="ib-card" data-quick-link="${e(link.id)}">${preview}<div class="ib-card-main"><p class="ib-card-title">${e(link.title)} <span class="ib-pill">${e(
      I.INBOX_QUICK_LINK_KIND_LABELS[link.kind] ?? link.kind,
    )}</span></p>${link.description ? `<p>${e(link.description)}</p>` : ''}<p class="ib-url">${e(link.file_name || link.url)}</p><div class="ib-row">${actions.join(
      '',
    )}</div></div></li>`;
  }

  // --- Foto ampliada ---

  renderLightbox() {
    const el = this.region('lightbox');
    if (!el) return;
    const box = this.lightbox;
    this.put(
      el,
      box
        ? `<div class="ib-lightbox" role="dialog" aria-modal="true" aria-label="Foto ampliada" data-act="close-lightbox"><figure data-act="noop"><img src="${e(box.url)}" alt="${e(
            box.alt,
          )}">${box.name ? `<figcaption>${e(box.name)}</figcaption>` : ''}<div class="ib-row">${button('Guardar', 'save-media', {
            data: { ref: box.ref, name: box.name },
            fk: 'lightbox-save',
          })}${button('Cerrar', 'close-lightbox', { cls: 'btn primary', fk: 'lightbox-close' })}</div></figure></div>`
        : '',
    );
  }
}

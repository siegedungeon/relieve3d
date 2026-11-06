import * as T from './core/tiktok_studio.js';
import { LibMixin } from './tiktok_lib_ui.js';

const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TABS = [['hoy', 'Hoy'], ['kit', 'Kit del video'], ['crear', 'Crear guion'], ['biblioteca', 'Biblioteca'], ['tendencias', 'Tendencias'], ['prompts', 'Prompts IA'], ['medir', 'Responder y medir'], ['config', 'Configuración']];
const ICON = { ok: '✓', pendiente: '○', parcial: '◐', espera: '⏳', info: '•' };
const ESTADO_TXT = { idea: 'Idea', guion: 'Guion', grabado: 'Grabado', editado: 'Editado', listo: 'Listo', publicado: 'Publicado', medido: 'Medido' };
const PEDIDO_ESTADOS = ['consulta', 'cotizado', 'vendido', 'entregado', 'perdido'];
const TIPOS = ['consulta', 'pedido', 'empresa'];
const CANALES = ['DM TikTok', 'comentario', 'WhatsApp', 'web'];
const DOCS = [['perfil', 'estrategia/perfil-cuenta.md', 'catálogo y precios, WhatsApp, quién sale en cámara'], ['voz', 'estrategia/voz-y-marca.md', 'cómo hablas, frases prohibidas, colores'], ['hashtags', 'estrategia/hashtags-y-seo.md', 'sets de hashtags'], ['campana', 'estrategia/campana-navidad-2026.md', 'fases, semanas, horarios, respuestas rápidas'], ['videosCsv', 'registro/videos.csv', 'estado de cada video'], ['metricasCsv', 'registro/metricas.csv', 'mediciones'], ['pedidosCsv', 'registro/pedidos-tiktok.csv', 'consultas y ventas'], ['ideas', 'ideas/banco-de-ideas.md', 'banco de ideas (se ve en Biblioteca → Ideas)']];
const STRUCT = ['producto', 'ocasion', 'objetivo', 'formula', 'formato', 'hook', 'tendencia'];
const opt = (v, label, sel) => `<option value="${e(v)}"${String(v) === String(sel) ? ' selected' : ''}>${e(label)}</option>`;
const pill = (estado) => `<span class="tk-pill tk-st-${e(estado)}">${e(ESTADO_TXT[estado] || estado || '—')}</span>`;
const cop = (n) => (Number.isFinite(+n) && n !== '' && n != null ? T.formatCOP(+n) : '—');

export class TiktokStudio {
  constructor(root, cb) {
    this.root = root; this.cb = cb; this.tab = 'hoy'; this.seq = 0; this.busy = false;
    this.data = null; this.ctx = null; this.videoId = ''; this.input = null; this.draft = null; this.draftError = '';
    this.subject = 'draft'; this.log = []; this.logMin = false; this.copies = []; this.lastError = ''; this.lastCopied = '';
    this.publishUrl = ''; this.respuesta = ''; this.metric = null; this.pedido = null; this.kit = null; this.opened = new Map();
    this.libInit();
    window.api?.onTiktokLog?.((d) => this.pushLog(d.line, d.tag));
    root.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-copy],[data-action],[data-tab]');
      if (!t || !root.contains(t)) return;
      if (t.dataset.copy !== undefined) { this.copy(this.copies[+t.dataset.copy]); return; }
      if (this.busy) return;
      if (t.dataset.tab) { this.tab = t.dataset.tab; this.lastError = ''; this.render(); return; }
      this.perform(() => this.action(t.dataset.action, t.dataset));
    });
    root.addEventListener('input', (ev) => this.inputEvent(ev));
    root.addEventListener('change', (ev) => this.changeEvent(ev));
    root.addEventListener('toggle', (ev) => { if (ev.target.dataset?.fase) this.opened.set(ev.target.dataset.fase, ev.target.open); }, true);
  }

  async open(tab) {
    const seq = ++this.seq;
    this.root.hidden = false;
    if (tab) this.tab = tab;
    this.root.innerHTML = '<div class="tk-loading">Leyendo tu espacio de TikTok…</div>';
    try {
      await this.reload();
      if (seq !== this.seq) return false;
      this.render(); return true;
    } catch (error) {
      if (seq !== this.seq) return false;
      console.error(error);
      this.root.innerHTML = `<div class="tk-loading tk-error"><h2>No se pudo abrir el Estudio TikTok</h2><p>${e(error.message)}</p><button class="btn" data-action="home">Volver al inicio</button></div>`;
      this.cb.toast(error.message, true); return false;
    }
  }
  close() { if (this.root.hidden) return; this.seq++; this.root.hidden = true; }

  async reload() {
    const data = await window.api.tiktokLoad();
    this.data = data;
    if (!data.ok) { this.ctx = null; this.tab = 'config'; return; }
    this.ctx = T.buildContext({ ...data.docs, videos: data.videos, root: data.root, today: data.today || undefined, now: data.now || undefined });
    this.agenda = T.agenda(this.ctx);
    this.libLoad();
    const ids = this.ctx.videos.map((v) => v.id);
    if (!ids.includes(this.videoId)) {
      const a = this.agenda;
      this.videoId = [...a.vencidos, ...a.deHoy, ...a.deManana, ...a.proximos, ...a.sinFecha][0]?.id || ids[ids.length - 1] || '';
    }
    if (this.subject !== 'draft' && !ids.includes(this.subject)) this.subject = 'draft';
    if (!this.input || !this.ctx.catalogo.some((p) => p.id === this.input.producto)) this.input = this.defaultInput();
    if (!this.metric) this.resetMetric();
    if (!this.pedido) this.resetPedido();
    this.computeDraft();
  }
  defaultInput() {
    const fase = this.agenda.fase;
    const heroe = this.ctx.catalogo.find((p) => p.precio != null && fase?.heroe && fase.heroe.toLowerCase().includes(p.corto.split(' ')[0].toLowerCase())) || this.ctx.catalogo.find((p) => p.precio != null) || this.ctx.catalogo[0];
    return { producto: heroe?.id || '', ocasion: /amigo secreto/i.test(`${fase?.mensaje} ${this.agenda.semanaPlan?.cta}`) ? 'amigo-secreto' : 'general', objetivo: 'comentarios', formula: 'T1', formato: '', hook: 0, fechaPlan: this.agenda.hueco || '', titulo: '', tendencia: '', lista: [], escenas: [] };
  }
  resetMetric(id = '', horas = 24) {
    const pub = this.ctx?.videos.filter((v) => ['publicado', 'medido'].includes(v.estado)) || [];
    this.metric = { id: id || pub[pub.length - 1]?.id || this.videoId || '', horas_desde_publicacion: String(horas), fecha_medicion: this.ctx?.today || '', vistas: '', tiempo_medio_s: '', vio_completo_pct: '', me_gusta: '', comentarios: '', compartidos: '', guardados: '', seguidores_nuevos: '', trafico_para_ti_pct: '', trafico_busqueda_pct: '', nuevos_espectadores_pct: '', notas: '' };
  }
  resetPedido(videoId = '') {
    this.pedido = { fecha: this.ctx?.today || '', video_id: videoId, tipo: 'consulta', canal: 'DM TikTok', producto: '', cantidad: '1', valor_cop: '', estado: 'consulta', notas: '' };
  }
  computeDraft() {
    if (!this.ctx) return;
    try { this.draft = T.draftVideo(this.input, this.ctx); this.draftError = ''; }
    catch (error) { this.draft = null; this.draftError = error.message; }
  }
  video(id = this.videoId) { return this.ctx?.videos.find((v) => v.id === id) || null; }

  async perform(action) {
    this.busy = true; this.lastError = '';
    this.root.querySelectorAll('button:not([data-copy]),input,select,textarea').forEach((b) => { b.disabled = true; });
    try { await action(); }
    catch (error) {
      const msg = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
      console.warn('[tiktok]', msg); this.lastError = msg; this.cb.toast(msg, true);
    }
    finally { this.busy = false; if (!this.root.hidden) this.render(); }
  }

  async copy(text) {
    if (text == null) return;
    this.lastCopied = String(text);
    try { await navigator.clipboard.writeText(this.lastCopied); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = this.lastCopied; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    this.cb.toast('Copiado: pégalo donde dice el paso');
  }
  copyBtn(text, label = 'Copiar') {
    if (!text) return '';
    this.copies.push(String(text));
    return `<button class="btn tk-copy" data-copy="${this.copies.length - 1}">${e(label)}</button>`;
  }

  pushLog(line, tag) {
    this.log.push(`${tag === 'err' ? '! ' : ''}${line}`);
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
    const pre = this.root.querySelector('[data-log]');
    if (pre) { pre.textContent = this.log.join('\n'); pre.scrollTop = pre.scrollHeight; pre.closest('.tk-log')?.removeAttribute('hidden'); }
  }
  async runCmd(args, label) {
    this.log.push(`$ python herramientas\\tiktok3d.py ${args.join(' ')}`);
    this.logMin = false;
    this.render();
    this.root.querySelectorAll('button:not([data-copy]),input,select,textarea').forEach((b) => { b.disabled = true; });
    const res = await window.api.tiktokRun(args);
    if (!res.ok) throw new Error(`${label || args[0]}: ${(res.stderr || res.stdout || '').trim().split(/\r?\n/).pop() || `código ${res.code}`}`);
    await this.reload();
    return res;
  }
  async saveKit(silent = false, id = this.videoId) {
    const v = this.video(id);
    if (!v) throw new Error('Elige un video.');
    const kit = T.buildKit(v, this.ctx);
    const file = await window.api.tiktokSaveKit({ carpeta: v.carpeta, md: T.kitMarkdown(kit, this.ctx.today) });
    if (!silent) this.cb.toast(`Kit guardado: ${file}`);
    return file;
  }

  async action(action, d) {
    switch (action) {
      case 'home': this.cb.onBack(); return;
      case 'reload': await this.reload(); this.cb.toast('Espacio TikTok recargado'); return;
      case 'panel': { const f = await window.api.tiktokPanel(); this.cb.toast(`Panel del plan: ${f}`); return; }
      case 'open': await window.api.tiktokOpen(d.ruta); return;
      case 'url': await window.api.tiktokUrl(d.url); return;
      case 'kit': this.videoId = d.id; this.publishUrl = ''; this.tab = 'kit'; return;
      case 'to-prompts': this.subject = d.id || 'draft'; this.tab = 'prompts'; return;
      case 'to-create': if (d.fecha) { this.input.fechaPlan = d.fecha; this.computeDraft(); } this.tab = 'crear'; return;
      case 'step': return this.stepAction(d.step);
      case 'save-kit': await this.saveKit(); return;
      case 'publish': {
        const url = (this.publishUrl || '').trim();
        if (!/^https:\/\/(www\.|vm\.|vt\.|m\.)?tiktok\.com\//i.test(url)) throw new Error('Pega la URL del video (Compartir → Copiar enlace): https://www.tiktok.com/@…');
        await this.runCmd(['estado', this.videoId, 'publicado', '--url', url], 'Marcar publicado');
        this.publishUrl = ''; await this.saveKit(true);
        this.cb.toast(`${this.videoId} publicado. Mide a las 24 h, 72 h y 7 días.`); return;
      }
      case 'new-draft': this.input = this.defaultInput(); this.computeDraft(); return;
      case 'create': return this.createVideo();
      case 'apply-ai': return this.applyAi();
      case 'metric-save': {
        const row = await window.api.tiktokAppend({ kind: 'metricas', row: this.metric });
        await this.reload();
        const v = this.video(row.id);
        if (v && v.estado === 'publicado' && +row.horas_desde_publicacion >= 160) await this.runCmd(['estado', v.id, 'medido'], 'Marcar medido');
        if (v) await this.saveKit(true, v.id);
        this.resetMetric(row.id, 72); this.cb.toast(`Métricas de ${row.id} anotadas`); return;
      }
      case 'metric-for': this.resetMetric(d.id, +d.horas || 24); this.tab = 'medir'; return;
      case 'pedido-for': this.resetPedido(d.id || ''); this.tab = 'medir'; return;
      case 'pedido-save': {
        await window.api.tiktokAppend({ kind: 'pedidos', row: this.pedido });
        await this.reload(); this.resetPedido(this.pedido.video_id); this.cb.toast('Consulta anotada (sin datos del cliente)'); return;
      }
      case 'pick-root': { const s = await window.api.tiktokPickRoot(); if (s) { await this.reload(); this.tab = 'hoy'; this.cb.toast(`Espacio TikTok: ${s.root}`); } return; }
      case 'save-python': {
        const v = this.root.querySelector('[data-cfg="python"]')?.value ?? '';
        await window.api.tiktokConfig({ python: v }); await this.reload(); this.cb.toast('Python guardado'); return;
      }
      case 'sfx': await this.runCmd(['sfx'], 'Kit de sonidos'); this.cb.toast('Kit de sonidos listo en audio/sfx'); return;
      case 'clear-log': this.log = []; return;
      case 'log-toggle': this.logMin = !this.logMin; return;
      case 'module': this.cb.openModule?.(d.id); return;
      default:
        if (await this.libAction(action, d)) return;
        throw new Error(`Acción desconocida: ${action}`);
    }
  }

  async stepAction(stepId) {
    const s = this.kit?.fases.flatMap((f) => f.pasos).find((p) => p.id === stepId);
    const a = s?.accion;
    if (!a) throw new Error('Este paso no tiene acción.');
    if (a.tipo === 'module') { this.cb.openModule?.(a.id); return; }
    if (a.tipo === 'open') { await window.api.tiktokOpen(a.ruta); return; }
    if (a.tipo === 'url') { await window.api.tiktokUrl(a.url); return; }
    if (a.tipo === 'panel') { const f = await window.api.tiktokPanel(); this.cb.toast(`Panel del plan: ${f}`); return; }
    if (a.tipo === 'run') {
      const res = await this.runCmd(a.args, a.label);
      if (['voz', 'video'].includes(a.args[0])) await this.saveKit(true);
      const last = res.stdout.trim().split(/\r?\n/).filter(Boolean);
      this.cb.toast(a.args[0] === 'video' ? `Video listo: ${last[0] || ''}` : `${a.label}: listo`);
      return;
    }
    if (a.tipo === 'form') {
      if (a.form === 'metrica') { this.resetMetric(this.videoId, a.horas || 24); this.tab = 'medir'; }
      else if (a.form === 'pedido') { this.resetPedido(this.videoId); this.tab = 'medir'; }
      else if (a.form === 'publicar') this.root.querySelector('[data-pub]')?.focus();
    }
  }

  async createVideo() {
    const d = this.draft;
    if (!d) throw new Error(this.draftError || 'Completa el borrador.');
    const guion = T.renderGuion(d, { id: '__ID__', fecha: this.ctx.today, carpeta: '__CARPETA__' });
    const videoJson = JSON.stringify(T.renderVideoJson(d, { id: '__ID__' }));
    const r = await window.api.tiktokCreate({ titulo: d.titulo, pilar: d.pilar, formula: d.formula, fechaPlan: d.fechaPlan, guion, videoJson });
    await this.reload();
    this.videoId = r.id;
    await this.saveKit(true, r.id);
    await this.reload();
    this.input = this.defaultInput(); this.computeDraft();
    this.tab = 'kit';
    this.cb.toast(`Creé ${r.id} en ${r.carpeta}: sigue el kit paso a paso`);
  }

  applyAi() {
    if (!this.draft) throw new Error('No hay borrador.');
    const bloques = (this.respuesta || '').replace(/^\s*\d+[.)]\s*/gm, '').split(/\s*\|\s*|\r?\n+/).map((s) => s.trim().replace(/^["“]|["”]$/g, '')).filter(Boolean);
    const n = this.draft.escenas.length;
    if (bloques.length !== n) throw new Error(`La respuesta tiene ${bloques.length} bloques y el video tiene ${n} escenas. Pídele a la IA exactamente ${n} bloques separados por |.`);
    this.input.escenas = bloques.map((voz, i) => ({ ...(this.input.escenas[i] || {}), voz }));
    this.computeDraft(); this.respuesta = ''; this.tab = 'crear';
    this.cb.toast('Guion de la IA aplicado: revisa los avisos antes de crear el video');
  }

  inputEvent(ev) {
    const t = ev.target;
    if (this.libInput(t)) return;
    if (t.dataset.scene !== undefined) {
      const i = +t.dataset.scene;
      this.input.escenas[i] = { ...(this.input.escenas[i] || {}), [t.dataset.field]: t.value };
      this.computeDraft(); this.updateSide(); return;
    }
    if (t.dataset.draft === 'titulo') { this.input.titulo = t.value; this.computeDraft(); this.updateSide(); return; }
    if (t.dataset.m !== undefined) { this.metric[t.dataset.m] = t.value; return; }
    if (t.dataset.p !== undefined) { this.pedido[t.dataset.p] = t.value; return; }
    if (t.dataset.pub !== undefined) { this.publishUrl = t.value; return; }
    if (t.dataset.resp !== undefined) { this.respuesta = t.value; }
  }
  changeEvent(ev) {
    const t = ev.target;
    if (this.busy) return;
    if (this.libChange(t)) return;
    if (t.dataset.draft && t.dataset.draft !== 'titulo') {
      const k = t.dataset.draft;
      this.input[k] = k === 'hook' ? +t.value : t.value;
      if (STRUCT.includes(k)) { this.input.escenas = []; if (k !== 'hook') this.input.hook = 0; }
      if (k === 'formula' || k === 'producto' || k === 'formato') this.input.lista = [];
      this.computeDraft(); this.render(); return;
    }
    if (t.dataset.lista !== undefined) { this.input.lista[+t.dataset.lista] = t.value; this.input.escenas = []; this.computeDraft(); this.render(); return; }
    if (t.dataset.video !== undefined) { this.videoId = t.value; this.publishUrl = ''; this.render(); return; }
    if (t.dataset.subject !== undefined) { this.subject = t.value; this.render(); return; }
    if (t.dataset.m === 'id') { this.metric.id = t.value; this.render(); return; }
    if (t.dataset.estado !== undefined && t.value && t.value !== this.video()?.estado) {
      const estado = t.value;
      this.perform(async () => { await this.runCmd(['estado', this.videoId, estado], 'Cambiar estado'); await this.saveKit(true); this.cb.toast(`${this.videoId}: ${ESTADO_TXT[estado]}`); });
    }
  }

  render() {
    this.copies = [];
    const d = this.data || {};
    const a = this.agenda;
    const ok = d.ok && this.ctx;
    if (!ok) this.tab = 'config';
    const f = ok ? a.fase : null;
    const sub = ok ? [this.ctx.perfil.usuario || '@pabonitaslaser', f ? `Fase ${f.letra} · ${f.nombre}` : '', a.semana, `hoy ${T.fechaHumana(a.hoy)}`].filter(Boolean).join(' · ') : 'Configura la carpeta del espacio TikTok';
    const page = !ok ? this.configPage() : this.tab === 'kit' ? this.kitPage() : this.tab === 'crear' ? this.crearPage() : this.tab === 'biblioteca' ? this.bibliotecaPage() : this.tab === 'tendencias' ? this.tendenciasPage() : this.tab === 'prompts' ? this.promptsPage() : this.tab === 'medir' ? this.medirPage() : this.tab === 'config' ? this.configPage() : this.hoyPage();
    const avisos = ok ? this.ctx.avisos : [];
    this.root.innerHTML = `<header class="tk-header"><button class="btn" data-action="home">← Inicio</button>
      <div class="tk-brand"><span>PABONITAS · TIKTOK</span><strong>Estudio TikTok</strong><small>${e(sub)}</small></div>
      <div class="tk-actions"><button class="btn" data-action="reload">Recargar</button>${ok ? '<button class="btn" data-action="open" data-ruta=".">Abrir carpeta</button><button class="btn primary" data-action="panel">Abrir panel del plan</button>' : ''}</div></header>
      <nav class="tk-tabs" aria-label="Secciones del Estudio TikTok">${TABS.map(([k, t]) => `<button data-tab="${k}" class="${this.tab === k ? 'active' : ''}" aria-current="${this.tab === k ? 'page' : 'false'}"${!ok && k !== 'config' ? ' disabled' : ''}>${t}</button>`).join('')}</nav>
      <div class="tk-notice">Relieve3D escribe guiones, prompts, captions y monta el video con tu voz. Grabar, publicar y responder lo haces tú: cada paso dice <b>dónde</b> hacerlo y <b>qué pegar</b>.</div>
      ${avisos.length ? `<div class="tk-warn tk-band">${avisos.map((x) => e(x)).join(' · ')}</div>` : ''}
      ${this.lastError ? `<div class="tk-error" role="alert">${e(this.lastError)}</div>` : ''}
      <main class="tk-page" data-page="${this.tab}">${page}</main>
      <section class="tk-log${this.logMin ? ' tk-min' : ''}"${this.log.length ? '' : ' hidden'}><header><b>Salida de tiktok3d.py</b><span class="tk-row"><button class="btn" data-action="log-toggle" aria-expanded="${!this.logMin}">${this.logMin ? 'Mostrar' : 'Ocultar'}</button><button class="btn" data-action="clear-log">Limpiar</button></span></header><pre data-log>${e(this.log.join('\n'))}</pre></section>`;
    const pre = this.root.querySelector('[data-log]');
    if (pre) pre.scrollTop = pre.scrollHeight;
  }

  updateSide() {
    const el = this.root.querySelector('[data-side]');
    if (el) el.innerHTML = this.sideHTML();
  }

  vcard(v, cls = '') {
    return `<div class="tk-vcard ${cls}"><div class="tk-vtop"><b>${e(v.id)}</b> ${pill(v.estado)} <small>${v.fecha_plan ? e(T.fechaHumana(v.fecha_plan)) : 'sin fecha'}</small></div>
      <strong>${e(v.titulo)}</strong><p>→ ${e(v.siguiente)}</p>
      <div class="tk-row"><button class="btn primary" data-action="kit" data-id="${e(v.id)}">Abrir kit paso a paso</button><button class="btn" data-action="to-prompts" data-id="${e(v.id)}">Prompts IA</button></div></div>`;
  }
  bloque(titulo, lista, vacio, cls = '') {
    return `<section class="tk-card"><h3>${titulo}</h3>${lista.length ? `<div class="tk-vgrid">${lista.map((v) => this.vcard(v, cls)).join('')}</div>` : `<p class="tk-muted">${e(vacio)}</p>`}</section>`;
  }

  hoyPage() {
    const a = this.agenda, k = a.kpis, f = a.fase, sp = a.semanaPlan;
    return `<div class="tk-kpis">
        <div><span>Publicados</span><strong>${k.publicados}/${k.videos}</strong><small>${k.pendientes} en producción</small></div>
        <div><span>Mediana de vistas</span><strong>${k.medianaVistas ?? '—'}</strong><small>${k.mejor ? `mejor: ${e(k.mejor.id)} con ${k.mejor.vistas}` : 'aún sin mediciones'}</small></div>
        <div><span>Consultas desde TikTok</span><strong>${k.consultas}</strong><small>DM, comentarios y WhatsApp</small></div>
        <div><span>Ventas</span><strong>${k.ventas}</strong><small>${cop(k.valorVentas)}</small></div></div>
      ${f ? `<section class="tk-card tk-fasecard"><span class="tk-kicker">Campaña de Navidad · ${e(a.semana)}</span><h2>Fase ${e(f.letra)} · ${e(f.nombre)} <small>${e(f.semanas)}</small></h2>
        <p><b>Mensaje:</b> ${e(f.mensaje)}</p><p><b>Producto héroe:</b> ${e(f.heroe)}</p>${f.meta ? `<p><b>Meta:</b> ${e(f.meta)}</p>` : ''}
        ${sp ? `<p><b>Esta semana (${e(sp.rango)}):</b> ${e(sp.videos)}</p><p><b>CTA de la semana:</b> ${e(sp.cta)}</p>` : ''}</section>` : ''}
      ${a.vencidos.length ? this.bloque('⚠ Atrasados', a.vencidos, '', 'tk-late') : ''}
      ${this.bloque(`Hoy · ${e(T.fechaHumana(a.hoy))}`, a.deHoy, 'Nada programado para hoy: adelanta la grabación de los próximos o crea un guion para el siguiente hueco.')}
      ${this.bloque(`Mañana · ${e(T.fechaHumana(a.manana))}`, a.deManana, 'Nada para mañana.')}
      ${a.porMedir.length ? `<section class="tk-card"><h3>Por medir</h3>${a.porMedir.map((v) => `<div class="tk-line"><b>${e(v.id)}</b> ${e(v.titulo)} · faltan ${v.faltan.map((h) => `<button class="btn" data-action="metric-for" data-id="${e(v.id)}" data-horas="${h}">${h === 168 ? '7 días' : `${h} h`}</button>`).join(' ')}</div>`).join('')}</section>` : ''}
      <section class="tk-card"><h3>Siguiente hueco libre</h3><p>${a.hueco ? `<b>${e(T.fechaHumana(a.hueco))}</b> todavía no tiene video.` : 'No quedan huecos en el calendario.'}</p>${a.hueco ? `<button class="btn primary" data-action="to-create" data-fecha="${e(a.hueco)}">Crear guion para ese día</button>` : ''}</section>
      ${this.bloque('Próximos 7 días', a.proximos, 'Sin videos programados en los próximos días.')}
      ${a.sinFecha.length ? this.bloque('Sin fecha', a.sinFecha, '') : ''}`;
  }

  kitPage() {
    const v = this.video();
    if (!v) return '<section class="tk-card"><p>Todavía no hay videos.</p><button class="btn primary" data-tab="crear">Crear el primero</button></section>';
    const kit = this.kit = T.buildKit(v, this.ctx);
    const pct = kit.progreso.total ? Math.round((kit.progreso.hechos * 100) / kit.progreso.total) : 0;
    return `<section class="tk-card tk-kit-head">
      <label class="tk-field"><span>Video</span><select data-video>${this.ctx.videos.map((x) => opt(x.id, `${x.id} · ${x.titulo} (${ESTADO_TXT[x.estado] || x.estado})`, v.id)).join('')}</select></label>
      <h1>${e(kit.id)} · ${e(kit.titulo)}</h1>
      <p>${pill(kit.estado)}${kit.hora ? ` · publicar: <b>${e(kit.hora)}</b>` : ''}${kit.producto ? ` · ${e(kit.producto.nombre)} ${e(T.precioTexto(kit.producto))}` : ''}</p>
      <p class="tk-next">Siguiente: ${e(kit.siguiente)}</p>
      <div class="tk-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <small>${kit.progreso.hechos}/${kit.progreso.total} pasos hechos · se calculan con los archivos reales de la carpeta del video</small>
      <div class="tk-row"><label class="tk-inline">Estado <select data-estado>${T.ESTADOS.map((s) => opt(s, ESTADO_TXT[s], v.estado)).join('')}</select></label>
        <button class="btn" data-action="save-kit">Guardar kit.md en la carpeta</button><button class="btn" data-action="open" data-ruta="${e(v.carpeta)}">Abrir carpeta del video</button><button class="btn" data-action="to-prompts" data-id="${e(v.id)}">Prompts IA de este video</button></div></section>
      ${kit.fases.map((f) => {
        const ps = f.pasos.filter((p) => p.estado !== 'info');
        const hechos = ps.filter((p) => p.estado === 'ok').length;
        const key = `${kit.id}:${f.id}`;
        const open = this.opened.has(key) ? this.opened.get(key) : !(ps.length && hechos === ps.length);
        return `<details class="tk-card tk-fase" data-fase="${e(key)}"${open ? ' open' : ''}><summary>${e(f.titulo)}${ps.length ? ` <small>${hechos}/${ps.length}</small>` : ''}</summary><div class="tk-steps">${f.pasos.map((s) => this.stepHTML(s, v)).join('')}</div></details>`;
      }).join('')}`;
  }

  stepHTML(s, v) {
    const a = s.accion;
    const btn = a && a.form !== 'publicar' ? `<button class="btn${a.tipo === 'run' || a.tipo === 'module' ? ' primary' : ''}" data-action="step" data-step="${e(s.id)}">${e(a.label || 'Abrir')}</button>` : '';
    const pub = a?.form === 'publicar'
      ? s.estado === 'ok' ? `<p class="tk-ok">✓ Publicado${v.url ? ` · <button class="btn tk-link" data-action="url" data-url="${e(v.url)}">${e(v.url)}</button>` : ''}</p>`
        : `<div class="tk-row"><input data-pub type="url" placeholder="https://www.tiktok.com/@pabonitaslaser/video/…" value="${e(this.publishUrl)}" aria-label="URL del video publicado"><button class="btn primary" data-action="publish">Marcar publicado</button></div>`
      : '';
    return `<div class="tk-step tk-s-${e(s.estado)}" data-step-id="${e(s.id)}"><span class="tk-icon" title="${e(s.estado)}">${ICON[s.estado] || '•'}</span><div class="tk-step-body"><strong>${e(s.titulo)}</strong>
      ${s.donde ? `<p class="tk-donde"><b>Dónde:</b> ${e(s.donde)}</p>` : ''}${s.que ? `<p class="tk-que">${md(s.que)}</p>` : ''}
      ${s.copiar ? `<div class="tk-copybox"><pre>${e(s.copiar)}</pre>${this.copyBtn(s.copiar)}</div>` : ''}
      ${(s.items || []).map((it) => `<div class="tk-item"><b>${e(it.nombre)}</b><p>${e(it.texto)}</p>${it.pendientes?.length ? `<small class="tk-warn-text">Completa antes de enviar: ${e(it.pendientes.join(' '))}</small>` : ''}${it.pendientes ? this.copyBtn(it.texto) : ''}</div>`).join('')}
      ${pub}${btn ? `<div class="tk-row">${btn}</div>` : ''}</div></div>`;
  }

  crearPage() {
    const c = this.ctx, i = this.input, d = this.draft;
    const sel = (k, label, entries) => `<label class="tk-field"><span>${label}</span><select data-draft="${k}">${entries.map(([v, t]) => opt(v, t, i[k])).join('')}</select></label>`;
    const conPrecio = c.catalogo.filter((p) => p.precio != null);
    const lista = d?.formato === 'F4' ? `<div class="tk-grid">${[0, 1].map((n) => `<label class="tk-field"><span>Producto ${n + 2} de la lista</span><select data-lista="${n}">${conPrecio.filter((p) => p.id !== d.producto.id).map((p) => opt(p.id, `${p.nombre} · ${T.precioTexto(p)}`, d.lista[n + 1]?.id)).join('')}</select></label>`).join('')}</div>` : '';
    const form = `<section class="tk-card"><h3>1 · Qué vas a mostrar</h3>
        ${sel('producto', 'Producto (el precio sale de perfil-cuenta.md)', c.catalogo.map((p) => [p.id, `${p.nombre} · ${p.precio != null ? T.precioTexto(p) : 'bajo cotización'}`]))}
        <div class="tk-grid">${sel('ocasion', 'Para quién / ocasión', Object.entries(T.OCASIONES).map(([k, o]) => [k, o.nombre]))}
        ${sel('objetivo', 'Qué quieres que hagan', Object.entries(T.OBJETIVOS).map(([k, o]) => [k, o.nombre]))}
        ${sel('formula', 'Fórmula del hook', Object.entries(T.FORMULAS).map(([k, o]) => [k, `${k} · ${o.nombre}`]))}
        ${sel('formato', 'Formato', [['', `Automático${d ? ` (${d.formato})` : ''}`], ...Object.entries(T.FORMATOS).map(([k, t]) => [k, `${k} · ${t}`])])}</div>
        ${lista}
        ${i.formula === 'T10' ? `<label class="tk-field"><span>Frase o momento del sonido en tendencia</span><input data-draft="tendencia" value="${e(i.tendencia)}" placeholder="Ej.: la frase que todos repiten en el audio"><small>Búscala en Creative Center → Música (Colombia) y escúchala en la app.</small></label>` : ''}
        <div class="tk-grid"><label class="tk-field"><span>Fecha y hora de publicación</span><input type="datetime-local" data-draft="fechaPlan" value="${e(i.fechaPlan)}"><small>Siguiente hueco libre: ${e(T.fechaHumana(this.agenda.hueco) || '—')}</small></label>
        <label class="tk-field"><span>Título interno (opcional)</span><input data-draft="titulo" value="${e(i.titulo)}" maxlength="80" placeholder="${e(d?.titulo || '')}"></label></div></section>`;
    if (!d) return `${form}<div class="tk-error">${e(this.draftError)}</div>`;
    const hooks = `<section class="tk-card"><h3>2 · Hook (los primeros 3 segundos)</h3>${d.hooks.map((h, k) => `<label class="tk-hook"><input type="radio" name="tk-hook" data-draft="hook" value="${k}"${k === d.hookIndex ? ' checked' : ''}><span><b>${e(h.etiqueta)}</b> «${e(h.hablado)}»<small>En pantalla: ${e(h.texto)} · Primer fotograma: ${e(h.fotograma)}</small></span></label>`).join('')}</section>`;
    const escenas = `<section class="tk-card"><h3>3 · Escenas: edita lo que dices y el texto en pantalla</h3><p class="tk-muted">Un bloque de voz por escena. Tu toma de cara se lee de corrido; el montaje la corta sola.</p>
      ${d.escenas.map((s, k) => `<div class="tk-scene"><div class="tk-scene-head"><b>${k + 1}</b><span class="tk-tag tk-tag-${e(s.tipo.toLowerCase())}">${e(s.tipo)}</span><code>${e(s.archivo)}</code>${s.sonido ? `<small>♪ ${e(s.sonido)}</small>` : ''}</div>
        <p class="tk-visual">${e(s.visual)}</p>
        <label class="tk-field"><span>Lo que dices</span><textarea rows="2" data-scene="${k}" data-field="voz">${e(s.voz)}</textarea></label>
        <label class="tk-field"><span>Texto en pantalla</span><input data-scene="${k}" data-field="texto" value="${e(s.texto)}"></label></div>`).join('')}${this.ctaPick()}</section>`;
    return `<div class="tk-split"><div class="tk-form">${form}${hooks}${this.crearExtras()}${escenas}</div><aside data-side>${this.sideHTML()}</aside></div>`;
  }

  sideHTML() {
    const d = this.draft;
    if (!d) return `<div class="tk-error">${e(this.draftError)}</div>`;
    const pilar = T.PILARES.find((p) => p.id === d.pilar)?.nombre || d.pilar;
    const tele = d.teleprompter.join('\n');
    return `<div class="tk-card tk-sum"><span class="tk-kicker">${e(d.formula)} · ${e(d.formato)} · ${e(pilar)}</span><h2>${e(d.titulo)}</h2>
        <p>≈ ${d.duracion} s · ${d.escenas.length} escenas · ${d.fechaPlan ? e(T.fechaHumana(d.fechaPlan)) : 'sin fecha'}</p>
        ${d.avisos.length ? `<div class="tk-warn"><b>Revisa antes de crear:</b><ul>${d.avisos.map((x) => `<li>${e(x)}</li>`).join('')}</ul></div>` : '<p class="tk-ok">✓ Sin avisos: precios del catálogo y frases permitidas.</p>'}
        <button class="btn primary tk-big" data-action="create">Crear el video en el espacio TikTok</button>
        <small class="tk-muted">Crea videos/V0NN-…/ con guion.md, video.json y kit.md, lo registra y lo agenda.</small>
        <div class="tk-row"><button class="btn" data-action="to-prompts" data-id="draft">Mejorarlo con IA</button><button class="btn" data-action="new-draft">Empezar de nuevo</button></div></div>
      <div class="tk-card"><h3>Teleprompter (toma de cara)</h3><pre>${e(tele)}</pre>${this.copyBtn(tele)}</div>
      <div class="tk-card"><h3>Caption</h3><pre>${e(d.caption)}</pre>${this.copyBtn(d.caption)}</div>
      <div class="tk-card"><h3>Comentario para fijar</h3><p>${e(d.comentarioFijado)}</p>${this.copyBtn(d.comentarioFijado)}<h3>Texto de portada</h3><p>${e(d.portada)}</p>${this.copyBtn(d.portada)}</div>
      <div class="tk-card"><h3>Tomas que vas a grabar</h3><ul>${d.tomas.map((t) => `<li><code>${e(t.archivo)}</code> ${md(t.desc)}</li>`).join('')}</ul>${d.notas.length ? `<h3>Ten listo</h3><ul>${d.notas.map((n) => `<li>${md(n)}</li>`).join('')}</ul>` : ''}</div>`;
  }

  promptsPage() {
    const subj = this.subject === 'draft' ? this.draft : this.video(this.subject);
    const prompts = T.promptLibrary(this.ctx, subj);
    const sel = `<select data-subject>${opt('draft', `Borrador de Crear guion: ${this.draft?.titulo || '—'}`, this.subject)}${this.ctx.videos.map((v) => opt(v.id, `${v.id} · ${v.titulo}`, this.subject)).join('')}</select>`;
    return `<section class="tk-card"><label class="tk-field"><span>Prompts para</span>${sel}</label><p class="tk-muted">Cada prompt ya lleva tu contexto: precios reales, cómo hablas, lo que nunca dices y la fase de la campaña. Cópialo, ábrelo en la IA que prefieras y trae la respuesta.</p></section>
      <div class="tk-prompts">${prompts.map((p) => `<article class="tk-card tk-prompt" data-prompt="${e(p.id)}"><h3>${e(p.titulo)}</h3><p class="tk-muted">${e(p.para)}</p>
        <details><summary>Ver el prompt completo</summary><pre>${e(p.texto)}</pre></details>
        <div class="tk-row">${this.copyBtn(p.texto, 'Copiar prompt')}${(p.donde || []).map((x) => (x.url ? `<button class="btn" data-action="url" data-url="${e(x.url)}">Abrir ${e(x.nombre)}</button>` : `<span class="tk-pill">${e(x.nombre)}</span>`)).join('')}</div>
        <p><b>Después:</b> ${e(p.despues)}</p>
        ${p.id === 'guion' && this.subject === 'draft' ? `<label class="tk-field"><span>Pega aquí la respuesta de la IA (${this.draft.escenas.length} bloques separados por |)</span><textarea rows="4" data-resp>${e(this.respuesta)}</textarea></label><button class="btn primary" data-action="apply-ai">Aplicar al borrador</button>` : ''}</article>`).join('')}</div>`;
  }

  medirPage() {
    const c = this.ctx, m = this.metric, pd = this.pedido;
    const num = (k, label) => `<label class="tk-field"><span>${label}</span><input inputmode="decimal" data-m="${k}" value="${e(m[k])}"></label>`;
    const ult = T.latestMetrics(c)[m.id];
    const v = this.video(m.id);
    const diag = ult ? T.diagnose(ult, { mediana: this.agenda.kpis.medianaVistas || 220, duracion: +(v?.guion?.meta?.duracion_objetivo_s || 0) }) : [];
    const pselect = (k, list) => `<select data-p="${k}">${list.map((x) => opt(x, x, pd[k])).join('')}</select>`;
    const tabla = (cols, rows) => `<div class="tk-table"><table><thead><tr>${cols.map((h) => `<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${cols.length}" class="tk-muted">Todavía no hay registros.</td></tr>`}</tbody></table></div>`;
    return `<div class="tk-split tk-even"><div>
      ${this.agenda.porMedir.length ? `<section class="tk-card"><h3>Pendientes de medir</h3>${this.agenda.porMedir.map((x) => `<div class="tk-line"><b>${e(x.id)}</b> ${e(x.titulo)} · ${x.faltan.map((h) => `<button class="btn" data-action="metric-for" data-id="${e(x.id)}" data-horas="${h}">${h === 168 ? '7 días' : `${h} h`}</button>`).join(' ')}</div>`).join('')}</section>` : ''}
      <section class="tk-card"><h3>Anotar métricas</h3><p class="tk-muted">Dónde: App → tu video → ··· → Estadísticas · o TikTok Studio → Analíticas. Se guarda en registro/metricas.csv.</p>
        <div class="tk-grid"><label class="tk-field"><span>Video</span><select data-m="id">${c.videos.map((x) => opt(x.id, `${x.id} · ${x.titulo}`, m.id)).join('')}</select></label>
        <label class="tk-field"><span>Momento</span><select data-m="horas_desde_publicacion">${[24, 72, 168].map((h) => opt(h, h === 168 ? '7 días (168 h)' : `${h} h`, m.horas_desde_publicacion)).join('')}</select></label>
        <label class="tk-field"><span>Fecha de medición</span><input type="date" data-m="fecha_medicion" value="${e(m.fecha_medicion)}"></label>
        ${num('vistas', 'Vistas *')}${num('tiempo_medio_s', 'Tiempo medio de visualización (s)')}${num('vio_completo_pct', 'Vio el video completo %')}${num('me_gusta', 'Me gusta')}${num('comentarios', 'Comentarios')}${num('compartidos', 'Compartidos')}${num('guardados', 'Guardados')}${num('seguidores_nuevos', 'Seguidores nuevos')}${num('trafico_para_ti_pct', 'Tráfico Para ti %')}${num('trafico_busqueda_pct', 'Tráfico de búsqueda %')}${num('nuevos_espectadores_pct', 'Nuevos espectadores %')}</div>
        <label class="tk-field"><span>Notas</span><input data-m="notas" value="${e(m.notas)}"></label>
        <button class="btn primary" data-action="metric-save">Guardar métricas</button></section>
      ${diag.length ? `<section class="tk-card"><h3>Diagnóstico de ${e(m.id)} · ${e(ult.horas_desde_publicacion)} h · ${e(ult.vistas)} vistas</h3>${diag.map((x) => `<div class="tk-item"><b>${e(x.sintoma)}</b><p>${e(x.causa)} → ${e(x.accion)}</p></div>`).join('')}</section>` : ''}
      <section class="tk-card"><h3>Últimas métricas</h3>${tabla(['Video', 'Horas', 'Vistas', 'Tiempo medio', 'Completo %', 'Compartidos', 'Guardados'], c.metricas.slice(-8).reverse().map((r) => `<tr><td>${e(r.id)}</td><td>${e(r.horas_desde_publicacion)}</td><td>${e(r.vistas)}</td><td>${e(r.tiempo_medio_s)}</td><td>${e(r.vio_completo_pct)}</td><td>${e(r.compartidos)}</td><td>${e(r.guardados)}</td></tr>`))}</section>
    </div><div>
      <section class="tk-card"><h3>Anotar consulta o venta</h3><p class="tk-muted">Sin nombres, teléfonos ni usuarios de clientes: solo producto, cantidad, valor y estado. Se guarda en registro/pedidos-tiktok.csv.</p>
        <div class="tk-grid"><label class="tk-field"><span>Fecha</span><input type="date" data-p="fecha" value="${e(pd.fecha)}"></label>
        <label class="tk-field"><span>Vino del video</span><select data-p="video_id">${opt('', '— no sé / general —', pd.video_id)}${c.videos.map((x) => opt(x.id, `${x.id} · ${x.titulo}`, pd.video_id)).join('')}</select></label>
        <label class="tk-field"><span>Tipo</span>${pselect('tipo', TIPOS)}</label><label class="tk-field"><span>Canal</span>${pselect('canal', CANALES)}</label>
        <label class="tk-field"><span>Producto</span><input data-p="producto" list="tk-productos" value="${e(pd.producto)}"><datalist id="tk-productos">${c.catalogo.map((p) => `<option value="${e(p.nombre)}">`).join('')}</datalist></label>
        <label class="tk-field"><span>Cantidad</span><input inputmode="numeric" data-p="cantidad" value="${e(pd.cantidad)}"></label>
        <label class="tk-field"><span>Valor (COP)</span><input inputmode="numeric" data-p="valor_cop" value="${e(pd.valor_cop)}"></label>
        <label class="tk-field"><span>Estado</span>${pselect('estado', PEDIDO_ESTADOS)}</label></div>
        <label class="tk-field"><span>Notas (sin datos personales)</span><input data-p="notas" value="${e(pd.notas)}"></label>
        <button class="btn primary" data-action="pedido-save">Guardar consulta</button></section>
      <section class="tk-card"><h3>Respuestas rápidas (DM y WhatsApp)</h3>${c.campana.respuestas.length ? c.campana.respuestas.map((r) => `<div class="tk-item"><b>${e(r.nombre)}</b><p>${e(r.texto)}</p>${r.pendientes.length ? `<small class="tk-warn-text">Completa antes de enviar: ${e(r.pendientes.join(' '))}</small>` : ''}${this.copyBtn(r.texto)}</div>`).join('') : '<p class="tk-muted">No encontré la sección «Respuestas rápidas» en la campaña.</p>'}</section>
      <section class="tk-card"><h3>Últimas consultas</h3>${tabla(['Fecha', 'Video', 'Tipo', 'Producto', 'Valor', 'Estado'], c.pedidos.slice(-8).reverse().map((r) => `<tr><td>${e(r.fecha)}</td><td>${e(r.video_id)}</td><td>${e(r.tipo)}</td><td>${e(r.producto)}</td><td>${cop(r.valor_cop)}</td><td>${e(r.estado)}</td></tr>`))}</section>
    </div></div>`;
  }

  configPage() {
    const d = this.data || {};
    const quien = [['Guion, hooks, caption, hashtags, portada y comentario fijado', 'Relieve3D → Crear guion', 'Tú eliges producto, ocasión y hook'], ['Mejorar textos o pedir ideas', 'ChatGPT, Copilot o Gemini', 'Copias el prompt de Prompts IA y traes la respuesta'], ['La pieza del video', 'Relieve3D (Llavero, Letrero, Micrófono…) + Bambu Studio', 'Imprimes con timelapse activado'], ['Tu cara y tu voz', 'Celular + teleprompter de CapCut', 'Lees el texto del kit en una sola toma'], ['Montaje 1080×1920 con subtítulos', 'Relieve3D → Kit → Montar', 'Solo copias los clips con los nombres exactos'], ['Sonido en tendencia', 'Creative Center + app de TikTok', 'Lo eliges al publicar, volumen 10-15 %'], ['Publicar o programar', 'App de TikTok o TikTok Studio', 'Pegas caption y fijas el comentario'], ['Responder y anotar consultas', 'App de TikTok + Relieve3D → Responder y medir', 'Respondes con video; Relieve3D anota sin datos personales'], ['Métricas y plan de cada día', 'TikTok Studio → Relieve3D → Responder y medir · panel del plan', 'Anotas 24 h, 72 h y 7 días']];
    return `<section class="tk-card"><h3>Carpeta del espacio TikTok</h3><p><code>${e(d.root || '')}</code></p>${d.ok ? '<p class="tk-ok">✓ Encontré herramientas/tiktok3d.py y los documentos de estrategia.</p>' : `<div class="tk-warn">${e(d.motivo || 'Sin configurar')}</div>`}
        <div class="tk-row"><button class="btn primary" data-action="pick-root"${d.fixed ? ' disabled' : ''}>Cambiar carpeta…</button>${d.ok ? '<button class="btn" data-action="open" data-ruta=".">Abrir carpeta</button>' : ''}</div>${d.fixed ? '<small class="tk-muted">Fijada por la variable R3D_TIKTOK_DIR.</small>' : ''}</section>
      <section class="tk-card"><h3>Python</h3><p class="tk-muted">Se usa para el montaje (voz, video, revisar, panel). Escribe python, py o la ruta completa a python.exe.</p><div class="tk-row"><input data-cfg="python" value="${e(d.python || 'python')}" aria-label="Comando de Python"><button class="btn" data-action="save-python">Guardar</button></div></section>
      ${d.ok ? `<section class="tk-card"><h3>Lo que leo de tu espacio</h3><div class="tk-table"><table><tbody>${DOCS.map(([k, f, para]) => `<tr><td>${d.docs?.[k] ? '✓' : '✗'}</td><td><code>${e(f)}</code></td><td>${e(para)}</td></tr>`).join('')}</tbody></table></div>
        <p class="tk-muted">Para cambiar precios, frases o la campaña, edita esos archivos (o pídeselo a Copilot) y pulsa Recargar. Relieve3D nunca inventa precios.</p>
        <div class="tk-row"><button class="btn" data-action="sfx">Generar kit de sonidos (audio/sfx)</button><button class="btn" data-action="panel">Abrir panel del plan</button></div></section>` : ''}
      <section class="tk-card"><h3>Qué hace Relieve3D y qué haces tú</h3><div class="tk-table"><table><thead><tr><th>Tarea</th><th>Dónde</th><th>Tu parte</th></tr></thead><tbody>${quien.map((r) => `<tr>${r.map((x) => `<td>${e(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }
}

function md(s) {
  return e(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
}

Object.assign(TiktokStudio.prototype, LibMixin);

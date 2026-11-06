// Estudio TikTok · pestañas Biblioteca y Tendencias + ganchos de la biblioteca en Crear guion.
// Se mezcla en TiktokStudio (usa this.ctx, this.input, this.draft, this.copy, this.copyBtn, this.reload…).
import * as T from './core/tiktok_studio.js';
import * as B from './core/tiktok_biblioteca.js';
import * as TR from './core/tiktok_tendencias.js';

const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const opt = (v, label, sel) => `<option value="${e(v)}"${String(v) === String(sel) ? ' selected' : ''}>${e(label)}</option>`;
const COLS = Object.keys(B.COLECCIONES);
const ORIGEN = { semilla: 'Base', 'semilla-editada': 'Base editada', tuyo: 'Tuyo' };
const FUENTES_IA = ['ChatGPT', 'Copilot', 'Gemini', 'Otra IA', 'Yo'];
const MAX_CARDS = 150;
const ahora = () => { const d = new Date(); return `${T.isoDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const horaDe = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(+d) ? iso : `${T.fechaHumana(T.isoDate(d))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const ESTADO_FECHA = { 'publica ya': 'tk-st-listo', 'en curso': 'tk-st-publicado', hoy: 'tk-st-publicado', prepara: 'tk-st-idea' };

export const LibMixin = {
  libInit() {
    this.lib = { col: 'ganchos', q: '', ocultos: false, n: '20', tema: '', pegar: '', fuente: 'ChatGPT', revision: null };
    this.trend = { errores: {}, cc: '' };
    this.libArch = {}; this.libErr = {};
  },

  // Tras cada recarga: archivos de la biblioteca (validados) y últimas tendencias guardadas.
  libLoad() {
    for (const col of COLS) {
      const raw = this.data?.biblioteca?.[col] ?? null;
      if (raw && raw.error && !Array.isArray(raw.items)) { this.libArch[col] = B.archivoVacio(col); this.libErr[col] = raw.error; continue; }
      const r = B.leerArchivo(col, raw);
      this.libArch[col] = r.archivo;
      this.libErr[col] = [r.error, ...r.avisos].filter(Boolean).join(' · ');
    }
    this.snaps = Object.values(this.data?.tendencias || {});
    this.ranking = TR.rankingFormulas(this.ctx);
  },
  libItems(col, ocultos = false) { return B.efectivos(col, this.libArch[col], { ocultos }); },
  libItem(col, id) { return this.libItems(col, true).find((x) => x.id === id); },
  snap(fuente) { return this.snaps?.find((s) => s.fuente === fuente) || null; },

  async libSave(col, archivo, resumen) {
    // Si el archivo actual tiene problemas, guardar lo reemplaza por lo que se ve (el original queda respaldado con fecha).
    if (this.libErr[col] && !window.confirm(`Ojo con biblioteca/${col}.json: ${this.libErr[col]}\n\nSi guardas, el archivo actual se respalda en biblioteca/.anterior/ y se reemplaza por lo que ves aquí. ¿Guardar?`)) {
      throw new Error(`No guardé nada. Revisa biblioteca/${col}.json y pulsa «Recargar».`);
    }
    const r = await window.api.tiktokLibSave({ col, archivo, resumen });
    await this.reload();
    return r;
  },

  aplicar(res, msg) {
    this.input = res.input; this.computeDraft(); this.tab = 'crear';
    this.cb.toast(res.avisos.length ? `${msg}. Ojo: ${res.avisos.join(' · ')}` : msg, false);
  },

  async libAction(action, d) {
    const col = this.lib.col;
    switch (action) {
      case 'lib-col': this.lib.col = d.col; this.lib.revision = null; this.lib.q = ''; this.tab = 'biblioteca'; return true;
      case 'lib-ocultos': this.lib.ocultos = !this.lib.ocultos; return true;
      case 'lib-use': {
        const it = this.libItem(d.col || col, d.id);
        if (!it) throw new Error('No encontré ese elemento.');
        const c = d.col || col;
        if (c === 'ganchos') this.aplicar(B.usarGancho(this.ctx, this.input, it, { tema: this.input.tendencia }), 'Gancho puesto en la escena 1');
        else if (c === 'guiones') this.aplicar(B.usarGuion(this.ctx, this.input, it), `Guion «${it.titulo}» listo para editar`);
        else if (c === 'ctas') this.aplicar(B.usarCta(this.ctx, this.input, it, this.draft?.escenas.length || 6), 'Cierre puesto en la última escena');
        else if (c === 'ideas') this.aplicar(B.usarIdea(this.ctx, this.input, it), 'Idea pasada a Crear guion');
        return true;
      }
      case 'lib-use-banco': {
        const r = this.bancoIdeas().find((x) => x.id === d.id);
        if (!r) throw new Error('No encontré esa idea en el banco.');
        this.aplicar(B.usarIdea(this.ctx, this.input, r), `Idea ${r.id} pasada a Crear guion`);
        return true;
      }
      case 'lib-hide': {
        const it = this.libItem(col, d.id);
        const propio = !B.esSemilla(col, d.id);
        if (propio && !window.confirm(`¿Borrar «${T.recortar(B.resumenDe(col, it), 60)}» de tu biblioteca?`)) return true;
        await this.libSave(col, B.ocultar(col, this.libArch[col], d.id, { ahora: ahora() }), `${propio ? 'borré' : 'oculté'} ${d.id}`);
        this.cb.toast(propio ? 'Borrado (si lo exportaste, puedes volver a importarlo)' : 'Oculto: lo ves con «Mostrar ocultos»');
        return true;
      }
      case 'lib-unhide': {
        const a = this.libArch[col];
        await this.libSave(col, { ...a, ocultos: a.ocultos.filter((x) => x !== d.id), actualizado: ahora() }, `restauré ${d.id}`);
        this.cb.toast('Restaurado');
        return true;
      }
      case 'lib-revert': {
        if (!window.confirm(`¿Descartar tu versión de ${d.id} y volver al texto base?`)) return true;
        await this.libSave(col, B.volverABase(col, this.libArch[col], d.id, { ahora: ahora() }), `volví ${d.id} a la base`);
        this.cb.toast('De vuelta al texto base');
        return true;
      }
      case 'lib-prompt': {
        const items = this.libItems(col);
        const p = d.modo === 'mejorar'
          ? B.promptColeccion(this.ctx, col, { mejorar: this.libFiltrados(items).slice(0, 30) })
          : B.promptColeccion(this.ctx, col, { n: +this.lib.n || 20, tema: this.lib.tema.trim(), existentes: items });
        await this.copy(p.texto);
        this.lastPrompt = { ...p, col };
        return true;
      }
      case 'lib-export': {
        const items = this.libFiltrados(this.libItems(col));
        await this.copy(B.exportar(col, items));
        this.cb.toast(`Copié ${items.length} ${B.COLECCIONES[col].nombre.toLowerCase()} en JSON: guárdalos donde quieras o pégalos en una IA`);
        return true;
      }
      case 'lib-review': {
        this.lib.revision = B.revisarImport(col, this.lib.pegar, this.ctx, this.libArch[col], { ahora: ahora(), fuente: this.lib.fuente });
        if (this.lib.revision.error) throw new Error(this.lib.revision.error);
        return true;
      }
      case 'lib-import': {
        const r = this.lib.revision;
        if (!r || r.error) throw new Error('Primero pulsa «Revisar».');
        if (!r.nuevos.length && !r.actualizados.length) throw new Error('No hay nada nuevo para guardar.');
        const resumen = `${this.lib.fuente}: ${B.resumenImport(col, r)}`;
        await this.libSave(col, r.archivo, resumen);
        this.lib.revision = null; this.lib.pegar = '';
        this.cb.toast(`Guardado en biblioteca/${col}.json · ${B.resumenImport(col, r)}`);
        return true;
      }
      case 'lib-discard': this.lib.revision = null; return true;
      case 'trend-refresh': return this.trendRefresh();
      case 'trend-use': {
        const g = this.ganchosTendencia(50).find((x) => x.tema === d.tema);
        const tpl = g && this.libItem('ganchos', g.opciones[+d.o || 0].id);
        if (!tpl) throw new Error('No encontré ese gancho.');
        const input = B.compatible(this.draft?.formato || 'F1', 'T10') ? { ...this.input, formula: 'T10' } : this.input;
        this.aplicar(B.usarGancho(this.ctx, input, tpl, { tema: g.tema }), `Gancho con «${g.tema}» en la escena 1 (${g.fuenteNombre})`);
        return true;
      }
      case 'trend-idea': {
        const s = this.snap(d.fuente);
        const it = s?.items[+d.k];
        if (!it) throw new Error('No encontré esa publicación.');
        const sub = d.fuente.replace('reddit-', 'r/').replace('bambulab', 'BambuLab').replace('3dprinting', '3Dprinting');
        // Sin comillas: usarIdea convertiría el título (en inglés) en el gancho hablado.
        const titulo = T.recortar(String(it.titulo).replace(/["“”«»]/g, "'"), 120);
        const idea = { idea: `Versión Pabonitas de lo más votado en ${sub}: ${titulo}`, pilar: 'mira-como', formula: 'T1', objetivo: 'comentarios', formato: 'F1', temporada: 'siempre', url: it.url };
        const v = B.validarItem('ideas', idea, this.ctx);
        if (!v.ok) throw new Error(`No se puede guardar: ${v.motivos.join(' · ')}`);
        const f = B.fusionar('ideas', this.libArch.ideas, [v.item], { ahora: ahora(), fuente: `Reddit ${sub}` });
        if (!f.nuevos.length) throw new Error('Esa idea ya está en tu biblioteca.');
        await this.libSave('ideas', f.archivo, `idea desde ${sub}: ${it.titulo}`);
        this.cb.toast(`Guardada como idea ${f.nuevos[0].id} (Biblioteca → Ideas)`);
        return true;
      }
      case 'cc-open': {
        await window.api.tiktokCcOpen();
        this.cb.toast('Creative Center abierto: inicia sesión, elige Colombia y luego pulsa «Capturar lo que se ve»');
        return true;
      }
      case 'cc-capture': {
        const r = await window.api.tiktokCcCapture();
        return this.ccGuardar(r.texto, r.url);
      }
      case 'cc-parse': return this.ccGuardar(this.trend.cc, '');
      case 'cc-set': {
        const s = this.snap('creative-center');
        if (!s?.items?.length) throw new Error('Primero trae los hashtags del Creative Center.');
        if (s.aviso && !window.confirm(`${s.aviso}.\n\n¿Guardarlos igual como set?`)) return true;
        const tags = [...new Set([...s.items.slice(0, 4).map((x) => x.hashtag), '#pabonitas'])];
        const set = { nombre: `Tendencia TikTok ${s.region || ''} ${T.isoDate(new Date(s.obtenido || Date.now()))}`.replace(/\s+/g, ' '), tags, para: `Hashtags en tendencia según el Creative Center (${s.region || 'región sin confirmar'}). Úsalos solo si tu video encaja con el tema`, url: s.url };
        const v = B.validarItem('hashtags', set, this.ctx);
        if (!v.ok) throw new Error(v.motivos.join(' · '));
        const f = B.fusionar('hashtags', this.libArch.hashtags, [v.item], { ahora: ahora(), fuente: 'Creative Center' });
        if (!f.nuevos.length) throw new Error('Ese set ya está en tu biblioteca.');
        await this.libSave('hashtags', f.archivo, `set desde el Creative Center (${s.region || '?'})`);
        this.cb.toast(`Set guardado: ${tags.join(' ')}`);
        return true;
      }
      case 'fecha-crear': {
        const f = TR.fechasClave(this.ctx.today).find((x) => x.id === d.id);
        if (!f) throw new Error('Fecha no encontrada.');
        this.input = { ...this.input, ocasion: f.ocasion, titulo: `${f.nombre}: ${T.recortar(f.angulo, 60)}`, escenas: [], hook: 0 };
        this.computeDraft(); this.tab = 'crear';
        this.cb.toast(`Borrador para ${f.nombre}: publica desde el ${T.fechaHumana(f.publicarDesde)}`);
        return true;
      }
      default: return false;
    }
  },

  async ccGuardar(texto, url) {
    const s = TR.snapshotDe('creative-center', { texto, url, obtenido: new Date().toISOString() });
    if (s.error) throw new Error(s.error);
    await window.api.tiktokTrendSave([s]);
    this.trend.cc = '';
    await this.reload();
    this.cb.toast(`Creative Center: ${s.items.length} hashtags${s.aviso ? ` · ${s.aviso}` : ''}`, !!s.aviso);
    return true;
  },

  async trendRefresh() {
    const ok = [];
    this.trend.errores = {};
    await Promise.all(TR.FUENTES_AUTO.map(async (f) => {
      try {
        const r = await window.api.tiktokTrendFetch(f);
        const s = TR.snapshotDe(f, { texto: r.texto, url: r.url, obtenido: r.obtenido });
        if (s.error) this.trend.errores[f] = s.error; else ok.push(s);
      } catch (err) { this.trend.errores[f] = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''); }
    }));
    if (ok.length) await window.api.tiktokTrendSave(ok);
    await this.reload();
    const fallas = Object.keys(this.trend.errores);
    this.cb.toast(`Tendencias: ${ok.length} de ${TR.FUENTES_AUTO.length} fuentes actualizadas${fallas.length ? ` (falló ${fallas.join(', ')})` : ''}`, !ok.length);
    return true;
  },

  ganchosTendencia(max = 4) {
    return TR.ganchosDeTendencia(this.ctx, this.snaps, this.libItems('ganchos'), { input: this.input, max });
  },

  bancoIdeas() {
    return T.parseTable(this.data?.docs?.ideas || '').map((r) => Object.values(r)).filter((v) => /^I\d+/.test(v[0] || '') && !/descartada|fusionada/i.test(v[v.length - 1] || ''))
      .map((v) => ({ id: v[0], idea: v[1], pilar: v[2], formula: v[3], objetivo: v[4], estado: v[v.length - 1] }));
  },

  libFiltrados(items) {
    const q = B.normalizarClave(this.lib.q);
    if (!q) return items;
    const plano = (v) => (v && typeof v === 'object' ? Object.values(v).map(plano).join(' ') : String(v ?? ''));
    return items.filter((it) => B.normalizarClave(plano(it)).includes(q));
  },

  // ------------------------------------------------------------------ Crear guion: ganchos sugeridos y en tendencia

  crearExtras() {
    const d = this.draft;
    if (!d) return '';
    const sug = B.sugerirGanchos(this.ctx, this.libItems('ganchos'), this.input, { formato: d.formato, ranking: this.ranking, max: 6 });
    const tend = B.compatible(d.formato, 'T10') ? this.ganchosTendencia(3) : [];
    return `<section class="tk-card tk-libpick" data-libpick><h3>Más ganchos de tu biblioteca <small class="tk-muted">(compatibles con ${e(d.formato)}${this.ranking.length ? ', primero lo que mejor te funciona' : ''})</small></h3>
      ${sug.map((g) => `<div class="tk-line"><span>«${e(g.voz)}»${g.pantalla ? ` <small class="tk-muted">· ${e(g.pantalla)}</small>` : ''} <small class="tk-pill">${e(g.formula || '—')}</small></span><button class="btn" data-action="lib-use" data-col="ganchos" data-id="${e(g.id)}">Usar</button></div>`).join('')}
      ${tend.length ? `<h3>En tendencia hoy</h3>${tend.map((t) => `<div class="tk-trendpick"><b>${e(t.tema)}</b> <small class="tk-muted">${e(t.fuenteNombre)}${t.region && t.region !== 'Colombia' ? ` · ${e(t.region)}` : ''} · ${e(horaDe(t.obtenido))}</small>
        ${t.opciones.map((o, k) => `<div class="tk-line"><span>«${e(o.voz)}»</span><button class="btn" data-action="trend-use" data-tema="${e(t.tema)}" data-o="${k}">Usar</button></div>`).join('')}</div>`).join('')}<small class="tk-muted">${e(TR.NOTA_TENDENCIA)}</small>`
        : `<p class="tk-muted">${this.snaps.length ? '' : 'Pulsa «Actualizar todo» en la pestaña Tendencias para ver ganchos con lo que se busca hoy en Colombia. '}</p>`}
      <div class="tk-row"><button class="btn" data-action="lib-col" data-col="ganchos">Ver los ${this.libItems('ganchos').length} ganchos</button><button class="btn" data-action="lib-col" data-col="guiones">Ver los ${this.libItems('guiones').length} guiones base</button><button class="btn" data-tab="tendencias">Tendencias</button></div></section>`;
  },

  ctaPick() {
    const d = this.draft;
    if (!d) return '';
    const ctas = this.libItems('ctas').filter((c) => !c.objetivo || c.objetivo === (this.input.objetivo || 'comentarios')).slice(0, 4);
    if (!ctas.length) return '';
    return `<div class="tk-libpick"><b>Cierre de la biblioteca</b> <small class="tk-muted">(reemplaza lo que dices en la escena ${d.escenas.length})</small>${ctas.map((c) => `<div class="tk-line"><span>«${e(B.rellenar(c.voz, B.variables(this.ctx, this.input)).texto)}»</span><button class="btn" data-action="lib-use" data-col="ctas" data-id="${e(c.id)}">Usar</button></div>`).join('')}</div>`;
  },

  // ------------------------------------------------------------------ pestaña Biblioteca

  libCard(col, it, oculto) {
    const o = B.origenDe(col, this.libArch[col], it);
    const vars = B.variables(this.ctx, this.input);
    const fill = (s) => B.rellenar(s || '', vars).texto;
    const meta = (keys) => keys.map((k) => it[k]).filter(Boolean).map((v) => `<span class="tk-pill">${e(v)}</span>`).join(' ');
    let body = '';
    let copiar = B.resumenDe(col, it);
    if (col === 'ganchos') { body = `<p class="tk-say">«${e(it.texto)}»</p>${it.pantalla ? `<p><small>En pantalla:</small> <b>${e(it.pantalla)}</b></p>` : ''}${it.fotograma ? `<small class="tk-muted">Primer fotograma: ${e(it.fotograma)}</small>` : ''}`; copiar = fill(it.texto); }
    else if (col === 'guiones') {
      body = `<p class="tk-say">«${e(it.escenas?.[0]?.voz || '')}»</p><details><summary>${it.escenas?.length || 0} escenas</summary><ol>${(it.escenas || []).map((s) => `<li>${s.voz != null ? `«${e(s.voz)}»` : '<i>(se genera sola)</i>'}${s.texto ? ` <small>· ${e(s.texto)}</small>` : ''}</li>`).join('')}</ol></details>`;
      copiar = (it.escenas || []).map((s) => fill(s.voz)).filter(Boolean).join('\n');
    }
    else if (col === 'ctas') { body = `<p class="tk-say">«${e(it.voz)}»</p>${it.pantalla ? `<p><small>En pantalla:</small> <b>${e(it.pantalla)}</b></p>` : ''}${it.caption ? `<small class="tk-muted">Caption: ${e(it.caption)}</small>` : ''}`; copiar = fill(it.voz); }
    else if (col === 'hashtags') { body = `<p><b>${e(it.nombre)}</b></p><p class="tk-tags">${e((it.tags || []).join(' '))}</p>${it.para ? `<small class="tk-muted">${e(it.para)}</small>` : ''}`; copiar = (it.tags || []).join(' '); }
    else if (col === 'ideas') body = `<p>${e(it.idea)}</p>`;
    else if (col === 'respuestas') { body = `<p><b>${e(it.nombre)}</b>${it.cuando ? ` <small class="tk-muted">· ${e(it.cuando)}</small>` : ''}</p><p>${e(fill(it.texto))}</p>`; copiar = fill(it.texto); }
    else if (col === 'sonidos') body = `<p><b>${e(it.nombre)}</b> ${it.tipo ? `<span class="tk-pill">${e(it.tipo)}</span>` : ''}</p>${it.uso ? `<p>${e(it.uso)}</p>` : ''}${it.donde ? `<small class="tk-muted">Dónde: ${e(it.donde)}</small>` : ''}`;
    const usar = ['ganchos', 'guiones', 'ctas', 'ideas'].includes(col) && !oculto ? `<button class="btn primary" data-action="lib-use" data-col="${col}" data-id="${e(it.id)}">Usar en Crear guion</button>` : '';
    const link = it.url ? `<button class="btn" data-action="url" data-url="${e(it.url)}">Abrir enlace</button>` : '';
    const quitar = oculto ? `<button class="btn" data-action="lib-unhide" data-id="${e(it.id)}">Restaurar</button>` : `<button class="btn" data-action="lib-hide" data-id="${e(it.id)}" title="${o === 'tuyo' ? 'Borrar de tu biblioteca' : 'Ocultar este elemento base'}">${o === 'tuyo' ? 'Borrar' : 'Ocultar'}</button>`;
    const base = o === 'semilla-editada' && !oculto ? `<button class="btn" data-action="lib-revert" data-id="${e(it.id)}" title="Descartar tu versión">Volver a la base</button>` : '';
    return `<article class="tk-libcard${oculto ? ' tk-oculto' : ''}" data-lib-id="${e(it.id)}"><div class="tk-vtop"><code>${e(it.id)}</code> <span class="tk-origen tk-o-${o}">${oculto ? 'Oculto' : ORIGEN[o]}</span> ${meta(['formula', 'formato', 'pilar', 'objetivo', 'ocasion', 'producto', 'temporada'])}</div>
      ${body}${it.nota ? `<small class="tk-muted">Nota: ${e(it.nota)}</small>` : ''}${it.fuente ? `<small class="tk-muted">Fuente: ${e(it.fuente)}${it.actualizado || it.creado ? ` · ${e(String(it.actualizado || it.creado).slice(0, 10))}` : ''}</small>` : ''}
      <div class="tk-row">${usar}${this.copyBtn(copiar)}${link}${base}${quitar}</div></article>`;
  },

  bibliotecaPage() {
    const col = this.lib.col, meta = B.COLECCIONES[col], a = this.libArch[col];
    const todos = this.libItems(col, this.lib.ocultos);
    const hidden = new Set(a.ocultos);
    const lista = this.libFiltrados(todos);
    const chips = COLS.map((c) => `<button class="tk-chip${c === col ? ' active' : ''}" data-action="lib-col" data-col="${c}">${e(B.COLECCIONES[c].nombre)} <b>${this.libItems(c).length}</b></button>`).join('');
    const propios = a.items.filter((i) => !B.esSemilla(col, i.id)).length;
    const r = this.lib.revision;
    const p = this.lastPrompt?.col === col ? this.lastPrompt : B.promptColeccion(this.ctx, col, { n: +this.lib.n || 20, tema: this.lib.tema, existentes: todos });
    const reporte = r ? `<div class="tk-report" data-report>
        <p><b>${e(B.resumenImport(col, r))}</b> <small class="tk-muted">(formato ${e(r.formato)}, ${r.total} leídos)</small></p>
        ${r.nuevos.length ? `<details open><summary>Nuevos (${r.nuevos.length})</summary><ul>${r.nuevos.slice(0, 12).map((x) => `<li><code>${e(x.id)}</code> ${e(T.recortar(B.resumenDe(col, x), 90))}</li>`).join('')}${r.nuevos.length > 12 ? `<li>… y ${r.nuevos.length - 12} más</li>` : ''}</ul></details>` : ''}
        ${r.actualizados.length ? `<details open><summary>Actualizados (${r.actualizados.length})</summary><ul>${r.actualizados.map((x) => `<li><code>${e(x.id)}</code> ${e(T.recortar(B.resumenDe(col, x), 90))}</li>`).join('')}</ul></details>` : ''}
        ${r.repetidos.length ? `<details><summary>Repetidos, no se guardan (${r.repetidos.length})</summary><ul>${r.repetidos.slice(0, 12).map((x) => `<li>${e(T.recortar(B.resumenDe(col, x.item || x), 90))}${x.igualA ? ` <small>= ${e(x.igualA)}</small>` : ''}</li>`).join('')}</ul></details>` : ''}
        ${r.rechazados.length ? `<details open class="tk-warn"><summary>Rechazados (${r.rechazados.length}): corrígelos o pídeselos de nuevo a la IA</summary><ul>${r.rechazados.map((x) => `<li>#${x.n} ${e(T.recortar(x.resumen || '', 70))}: <b>${e(x.motivos.join(' · '))}</b></li>`).join('')}</ul></details>` : ''}
        ${r.avisos.length ? `<details><summary>Avisos (${r.avisos.length})</summary><ul>${r.avisos.map((x) => `<li>#${x.n} ${e(x.resumen)}: ${e(x.avisos.join(' · '))}</li>`).join('')}</ul></details>` : ''}
        <div class="tk-row"><button class="btn primary" data-action="lib-import"${r.nuevos.length || r.actualizados.length ? '' : ' disabled'}>Guardar en la biblioteca</button><button class="btn" data-action="lib-discard">Descartar</button></div></div>` : '';
    const extra = col === 'hashtags' ? `<section class="tk-card"><h3>Sets de tu estrategia <small class="tk-muted">(estrategia/hashtags-y-seo.md, solo lectura)</small></h3>${Object.entries(this.ctx.hashtags || {}).map(([k, s]) => `<div class="tk-line"><span><b>${e(k)} · ${e(s.nombre)}</b> <span class="tk-tags">${e(s.tags.join(' '))}</span></span>${this.copyBtn(s.tags.join(' '))}</div>`).join('') || '<p class="tk-muted">No encontré sets.</p>'}</section>`
      : col === 'ideas' ? `<section class="tk-card"><h3>Banco de ideas del espacio <small class="tk-muted">(ideas/banco-de-ideas.md, solo lectura)</small></h3>${this.bancoIdeas().map((x) => `<div class="tk-line"><span><code>${e(x.id)}</code> ${e(x.idea)} <small class="tk-muted">${e([x.pilar, x.formula, x.estado].filter(Boolean).join(' · '))}</small></span><button class="btn" data-action="lib-use-banco" data-id="${e(x.id)}">Usar</button></div>`).join('') || '<p class="tk-muted">No encontré el banco de ideas.</p>'}</section>` : '';
    return `<section class="tk-card"><div class="tk-chips" role="tablist">${chips}</div>
        <p class="tk-muted">${e(meta.nombre)}: ${todos.length - (this.lib.ocultos ? hidden.size : 0)} disponibles (${B.efectivos(col, a).length - propios} base${a.items.length - propios ? `, ${a.items.length - propios} editados por ti` : ''}, ${propios} tuyos${hidden.size ? `, ${hidden.size} ocultos` : ''}). Se guardan en <code>biblioteca/${col}.json</code> de tu espacio: nunca se pierden y viajan con la carpeta.</p>
        ${this.libErr[col] ? `<div class="tk-warn">${e(this.libErr[col])}</div>` : ''}</section>
      <div class="tk-split"><div>
        <section class="tk-card"><div class="tk-row tk-libtools"><input type="search" data-lib="q" value="${e(this.lib.q)}" placeholder="Buscar en ${e(meta.nombre.toLowerCase())}…" aria-label="Buscar">
          <button class="btn" data-action="lib-ocultos" aria-pressed="${this.lib.ocultos}">${this.lib.ocultos ? 'Esconder ocultos' : `Mostrar ocultos${hidden.size ? ` (${hidden.size})` : ''}`}</button>
          <button class="btn" data-action="lib-export">Exportar ${lista.length} (JSON)</button></div>
          <small class="tk-muted" data-lib-count>${lista.length} de ${todos.length}${lista.length > MAX_CARDS ? ` · muestro los primeros ${MAX_CARDS}: usa la búsqueda` : ''}</small></section>
        <div class="tk-libgrid" data-lib-list>${lista.slice(0, MAX_CARDS).map((it) => this.libCard(col, it, hidden.has(it.id))).join('') || '<p class="tk-muted">Nada coincide con la búsqueda.</p>'}</div>
        ${extra}
      </div><aside>
        <section class="tk-card"><h3>Pedir más a la IA</h3><p class="tk-muted">El prompt ya lleva tu catálogo, tu voz, las reglas y la lista de lo que ya tienes (para que no repita). La IA responde en JSON listo para pegar abajo.</p>
          <div class="tk-grid"><label class="tk-field"><span>Cuántos</span><select data-lib="n">${['10', '20', '30', '50'].map((n) => opt(n, n, this.lib.n)).join('')}</select></label>
          <label class="tk-field"><span>Tema (opcional)</span><input data-lib="tema" value="${e(this.lib.tema)}" placeholder="Ej.: novena, amigo secreto, empresas"></label></div>
          <div class="tk-row"><button class="btn primary" data-action="lib-prompt" data-modo="nuevos">Copiar prompt: ${e(this.lib.n)} nuevos</button><button class="btn" data-action="lib-prompt" data-modo="mejorar" title="Manda a la IA los que ves (máx. 30) para que los mejore conservando el id">Copiar prompt: mejorar los que ves</button></div>
          <div class="tk-row">${p.donde.map((x) => `<button class="btn" data-action="url" data-url="${e(x.url)}">Abrir ${e(x.nombre)}</button>`).join('')}</div>
          <details><summary>Ver el prompt</summary><pre data-lib-prompt>${e(p.texto)}</pre></details>
          <p><b>Después:</b> ${e(p.despues)}</p></section>
        <section class="tk-card"><h3>Pegar lo que respondió la IA</h3><p class="tk-muted">Acepta JSON (aunque venga con texto o \`\`\`json alrededor), una lista con viñetas o una línea por elemento. Si un elemento trae <code>"id"</code> de uno que ya tienes, se actualiza.</p>
          <div class="tk-grid"><label class="tk-field"><span>Lo generó</span><select data-lib="fuente">${FUENTES_IA.map((f) => opt(f, f, this.lib.fuente)).join('')}</select></label></div>
          <label class="tk-field"><span>Respuesta</span><textarea rows="8" data-lib="pegar" placeholder="[ { ... }, { ... } ]">${e(this.lib.pegar)}</textarea></label>
          <div class="tk-row"><button class="btn primary" data-action="lib-review">Revisar</button></div>
          ${reporte}
          <details><summary>Ejemplo del formato</summary><pre>${e(JSON.stringify(B.EJEMPLOS[col], null, 2))}</pre></details></section>
      </aside></div>`;
  },

  // ------------------------------------------------------------------ pestaña Tendencias

  tendenciasPage() {
    const g = this.snap('google-co');
    const fuenteHead = (f, s) => {
      const F = TR.FUENTES[f];
      const err = this.trend.errores[f];
      return `<div class="tk-fuente"><b>${e(F.nombre)}</b> <small class="tk-muted">${e(F.que)}</small><br><small>${s ? `Actualizado ${e(horaDe(s.obtenido))}` : 'Sin datos todavía'} · <button class="btn tk-link" data-action="url" data-url="${e(F.web)}">ver la fuente</button></small>${err ? `<div class="tk-warn">${e(err)}</div>` : ''}${s?.error ? `<div class="tk-warn">${e(s.error)}</div>` : ''}</div>`;
    };
    const tend = this.ganchosTendencia(50);
    const temas = new Set(tend.map((t) => t.tema));
    const google = g?.items?.length ? `<div class="tk-table"><table><thead><tr><th>Tema</th><th>Búsquedas</th><th>Noticia</th><th></th></tr></thead><tbody>${[...g.items].sort((a, b) => (b.trafico_n || 0) - (a.trafico_n || 0)).map((it) => {
      const seg = TR.tendenciaSegura(it.termino, it.noticias);
      const n = it.noticias?.[0];
      return `<tr${seg.ok ? '' : ' class="tk-muted"'}><td><b>${e(it.termino)}</b></td><td>${e(it.trafico || '—')}</td><td>${n ? `<button class="btn tk-link" data-action="url" data-url="${e(n.url)}">${e(T.recortar(n.titulo, 70))}</button> <small>${e(n.fuente || '')}</small>` : ''}</td><td>${seg.ok && temas.has(it.termino) ? `<button class="btn" data-action="trend-use" data-tema="${e(it.termino)}" data-o="0">Gancho con esto</button>` : `<small title="${e(seg.motivo || '')}">${e(seg.motivo ? `No: ${seg.motivo}` : '')}</small>`}</td></tr>`;
    }).join('')}</tbody></table></div><small class="tk-muted">${e(TR.NOTA_TENDENCIA)}</small>` : '';
    const reddit = (f) => {
      const s = this.snap(f);
      return `<section class="tk-card">${fuenteHead(f, s)}${s?.items?.length ? `<ol class="tk-reddit">${s.items.slice(0, 15).map((it, k) => `<li><button class="btn tk-link" data-action="url" data-url="${e(it.url)}">${e(it.titulo)}</button> <small class="tk-muted">${e(it.autor || '')}</small> <button class="btn tk-copy tk-mini" data-action="trend-idea" data-fuente="${f}" data-k="${k}">Guardar como idea</button></li>`).join('')}</ol>` : ''}</section>`;
    };
    const cc = this.snap('creative-center');
    const fechas = TR.fechasClave(this.ctx.today, 120);
    return `<section class="tk-card"><div class="tk-row"><button class="btn primary" data-action="trend-refresh">Actualizar todo</button><span class="tk-muted">Lee ${TR.FUENTES_AUTO.map((f) => TR.FUENTES[f].nombre).join(', ')} directamente de la fuente (sin IA). Cada dato guarda su enlace y la hora en <code>tendencias/&lt;fecha&gt;/</code> de tu espacio.</span></div></section>
      <div class="tk-split tk-even"><div>
        <section class="tk-card">${fuenteHead('google-co', g)}${google}</section>
        ${reddit('reddit-bambulab')}${reddit('reddit-3dprinting')}
      </div><div>
        <section class="tk-card"><h3>Fechas que vienen <small class="tk-muted">(calendario comercial de Colombia)</small></h3>${fechas.map((f) => `<div class="tk-item tk-fecha"><div class="tk-vtop"><b>${e(f.nombre)}</b> <span class="tk-pill ${ESTADO_FECHA[f.estado] || ''}">${e(f.estado)}</span> <small>${e(T.fechaHumana(f.fecha))}${f.hasta ? ` → ${e(T.fechaHumana(f.hasta))}` : ''} · ${f.faltan > 0 ? `faltan ${f.faltan} días` : 'ya'}</small></div>
          <p>${e(f.angulo)}</p><small class="tk-muted">Publica desde el ${e(T.fechaHumana(f.publicarDesde))} · ${e(Array.isArray(f.hashtags) ? f.hashtags.join(' ') : f.hashtags || '')}${f.regla ? ` · ${e(f.regla)}` : ''}</small>
          <div class="tk-row"><button class="btn" data-action="fecha-crear" data-id="${e(f.id)}">Crear guion para esta fecha</button></div></div>`).join('') || '<p class="tk-muted">No hay fechas comerciales en los próximos 4 meses.</p>'}</section>
        <section class="tk-card"><h3>Lo que te funciona a ti <small class="tk-muted">(tus métricas: registro/metricas.csv)</small></h3>${this.ranking.length ? `<div class="tk-table"><table><thead><tr><th>Fórmula</th><th>Videos</th><th>Vistas (mediana)</th><th>Vio completo</th><th>Compartidos + guardados por cada 100 vistas</th></tr></thead><tbody>${this.ranking.map((r) => `<tr><td><b>${e(r.formula)}</b> ${e(r.nombre)}</td><td title="${e(r.videos.join(', '))}">${r.n}</td><td>${e(r.vistas ?? '—')}</td><td>${r.completo != null ? `${e(r.completo)} %` : '—'}</td><td>${r.tasa != null ? e(r.tasa) : '—'}</td></tr>`).join('')}</tbody></table></div><small class="tk-muted">Crear guion pone primero los ganchos de las fórmulas que mejor te funcionan.</small>` : '<p class="tk-muted">Anota métricas en «Responder y medir» y aquí verás qué fórmulas te dan más vistas.</p>'}</section>
        <section class="tk-card">${fuenteHead('creative-center', cc)}
          <p class="tk-muted">TikTok no tiene una fuente pública para esto: sin sesión la página muestra solo Estados Unidos y el top 3. Ábrela aquí con tu cuenta (queda guardada solo en Relieve3D), elige <b>Colombia</b> y captura; o copia el texto de la página (Ctrl+A, Ctrl+C) y pégalo abajo.</p>
          <div class="tk-row"><button class="btn" data-action="cc-open">Abrir Creative Center</button><button class="btn" data-action="cc-capture">Capturar lo que se ve</button></div>
          <label class="tk-field"><span>O pega el texto de la página</span><textarea rows="3" data-trend="cc">${e(this.trend.cc)}</textarea></label>
          <div class="tk-row"><button class="btn" data-action="cc-parse">Leer hashtags pegados</button></div>
          ${cc?.items?.length ? `${cc.aviso ? `<div class="tk-warn">${e(cc.aviso)}</div>` : ''}<div class="tk-table"><table><thead><tr><th>#</th><th>Hashtag</th><th>Publicaciones</th><th>Vistas</th></tr></thead><tbody>${cc.items.slice(0, 20).map((it) => `<tr><td>${e(it.rank ?? '')}</td><td><b>${e(it.hashtag)}</b>${it.categoria ? ` <small>${e(it.categoria)}</small>` : ''}</td><td>${e(it.posts || '—')}</td><td>${e(it.vistas || '—')}</td></tr>`).join('')}</tbody></table></div>
            <div class="tk-row"><button class="btn" data-action="cc-set">Guardar los 4 primeros como set de hashtags</button></div>` : ''}</section>
      </div></div>`;
  },

  libInput(t) {
    if (t.dataset.lib !== undefined) {
      const k = t.dataset.lib;
      this.lib[k] = t.value;
      if (k === 'q') {
        const todos = this.libItems(this.lib.col, this.lib.ocultos);
        const lista = this.libFiltrados(todos);
        const hidden = new Set(this.libArch[this.lib.col].ocultos);
        const el = this.root.querySelector('[data-lib-list]');
        if (el) el.innerHTML = lista.slice(0, MAX_CARDS).map((it) => this.libCard(this.lib.col, it, hidden.has(it.id))).join('') || '<p class="tk-muted">Nada coincide con la búsqueda.</p>';
        const c = this.root.querySelector('[data-lib-count]');
        if (c) c.textContent = `${lista.length} de ${todos.length}${lista.length > MAX_CARDS ? ` · muestro los primeros ${MAX_CARDS}: usa la búsqueda` : ''}`;
      }
      if (k === 'pegar' && this.lib.revision) { this.lib.revision = null; this.root.querySelector('[data-report]')?.remove(); }
      if (k === 'tema') this.lastPrompt = null;
      return true;
    }
    if (t.dataset.trend === 'cc') { this.trend.cc = t.value; return true; }
    return false;
  },
  // Solo selects: re-renderizar al perder el foco de un input se comería el clic del botón siguiente.
  libChange(t) {
    if (t.dataset.lib === 'n' || t.dataset.lib === 'fuente') { this.lib[t.dataset.lib] = t.value; this.lastPrompt = null; if (t.dataset.lib === 'fuente') this.lib.revision = null; this.render(); return true; }
    return t.dataset.lib !== undefined || t.dataset.trend !== undefined;
  },
};

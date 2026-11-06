// Biblioteca del Estudio TikTok: colecciones base (semillas, siempre disponibles) + lo que agregas tú o una IA,
// guardado en biblioteca/<colección>.json del espacio de trabajo. Módulo puro (sin DOM ni Node):
// validar, importar lo que devuelve una IA, fusionar (crear / actualizar por id / descartar repetidos),
// exportar, ocultar y aplicar un elemento al borrador de Crear guion.
import * as T from './tiktok_studio.js';
import { SEMILLAS } from './tiktok_semillas.js';

export { SEMILLAS };
export const VERSION = 1;
export const MAX_IMPORT = 500;
export const ESCENAS_POR_FORMATO = { F1: 6, F3: 4, F4: 5, F5: 5 };
export const TIPOS_SONIDO = ['tendencia', 'comercial', 'original', 'sfx'];
export const MARCADORES = ['producto', 'Producto', 'corto', 'el_producto', 'El_producto', 'lo', 'Lo', 'PRODUCTO', 'precio', 'PRECIO',
  'para', 'guardar', 'compartir', 'dm', 'cta', 'CTA', 'ciudad', 'marca', 'web', 'cotizar', 'generador', 'whatsapp', 'catalogo', 'tema', 'TEMA'];

export const COLECCIONES = {
  ganchos: { nombre: 'Ganchos', prefijo: 'gan', que: 'ganchos (hooks) para los primeros 3 segundos', campos: ['texto', 'pantalla', 'fotograma', 'formula', 'pilar', 'ocasion'] },
  guiones: { nombre: 'Guiones base', prefijo: 'gui', que: 'guiones completos de TikTok, escena por escena', campos: ['titulo', 'formato', 'formula', 'pilar', 'objetivo', 'ocasion', 'producto', 'escenas'] },
  ctas: { nombre: 'Llamados a la acción', prefijo: 'cta', que: 'llamados a la acción (CTA) para el final del video', campos: ['voz', 'pantalla', 'caption', 'objetivo'] },
  hashtags: { nombre: 'Sets de hashtags', prefijo: 'has', que: 'sets de 3 a 5 hashtags', campos: ['nombre', 'tags', 'para'] },
  ideas: { nombre: 'Ideas de videos', prefijo: 'ide', que: 'ideas de videos', campos: ['idea', 'pilar', 'formula', 'objetivo', 'formato', 'temporada'] },
  respuestas: { nombre: 'Respuestas rápidas', prefijo: 'res', que: 'respuestas rápidas para DM y WhatsApp', campos: ['nombre', 'texto', 'cuando'] },
  sonidos: { nombre: 'Sonidos', prefijo: 'son', que: 'sonidos y música para los videos', campos: ['nombre', 'tipo', 'uso', 'donde', 'url'] },
};
const COMUNES = ['nota', 'tags', 'url'];
const META = ['fuente', 'creado', 'actualizado'];

const ALIAS = {
  ganchos: { texto: ['texto', 'hook', 'gancho', 'frase', 'hablado', 'frase_hablada', 'voz'], pantalla: ['pantalla', 'texto_pantalla', 'texto_en_pantalla', 'en_pantalla', 'overlay'], fotograma: ['fotograma', 'primer_fotograma', 'visual', 'plano'] },
  guiones: { titulo: ['titulo', 'title', 'nombre'], escenas: ['escenas', 'scenes', 'bloques'] },
  ctas: { voz: ['voz', 'cta', 'texto', 'hablado', 'frase'], pantalla: ['pantalla', 'texto_pantalla', 'texto_en_pantalla', 'en_pantalla'], caption: ['caption', 'descripcion'] },
  hashtags: { nombre: ['nombre', 'set', 'titulo'], tags: ['tags', 'hashtags'], para: ['para', 'uso', 'cuando'] },
  ideas: { idea: ['idea', 'titulo', 'hook', 'texto'], temporada: ['temporada', 'fecha', 'epoca'] },
  respuestas: { nombre: ['nombre', 'atajo', 'titulo'], texto: ['texto', 'respuesta', 'mensaje'], cuando: ['cuando', 'uso', 'para'] },
  sonidos: { nombre: ['nombre', 'sonido', 'titulo'], uso: ['uso', 'para', 'cuando'], donde: ['donde', 'app', 'plataforma'] },
};
const ALIAS_COMUN = { formula: ['formula', 'tipo_de_hook'], formato: ['formato', 'format'], pilar: ['pilar'], objetivo: ['objetivo', 'meta'], ocasion: ['ocasion'], producto: ['producto', 'product'], tipo: ['tipo', 'type'], url: ['url', 'link', 'enlace'], nota: ['nota', 'notas', 'por_que', 'razon'], tags: ['tags', 'etiquetas'] };

const LIMITES = { texto: 220, pantalla: 60, fotograma: 220, titulo: 90, voz: 300, caption: 300, nombre: 80, para: 160, idea: 300, temporada: 60, cuando: 160, uso: 220, donde: 220, url: 500, nota: 300, producto: 60 };
const MARCAS = ['grinch', 'disney', 'marvel', 'stitch', 'pokémon', 'pokemon', 'mickey', 'minnie', 'barbie', 'hello kitty', 'harry potter', 'star wars', 'frozen', 'spiderman', 'spider-man', 'batman', 'mario bros', 'sanrio', 'pixar', 'kuromi', 'bluey', 'paw patrol', 'minecraft'];

// ------------------------------------------------------------------ utilidades

const pad = (n, w = 3) => String(n).padStart(w, '0');
const sinAcentos = (s) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
export const normalizarClave = (s) => sinAcentos(s).toLowerCase().replace(/\{[^}]*\}/g, (m) => m.replace(/\W/g, '')).replace(/[^a-z0-9ñ]+/g, ' ').trim();
const limpio = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/^["“«']+|["”»']+$/g, '').trim();
const llave = (k) => sinAcentos(k).toLowerCase().trim().replace(/[\s-]+/g, '_');

export function claveDe(col, it) {
  if (!it) return '';
  if (col === 'hashtags') return [...(it.tags || [])].map((t) => t.toLowerCase()).sort().join(' ');
  if (col === 'guiones') return normalizarClave(it.titulo);
  const campo = { ganchos: 'texto', ctas: 'voz', ideas: 'idea', respuestas: 'nombre', sonidos: 'nombre' }[col];
  return normalizarClave(it[campo]);
}

export function resumenDe(col, it) {
  if (!it) return '';
  return { ganchos: it.texto, guiones: it.titulo, ctas: it.voz, hashtags: `${it.nombre}: ${(it.tags || []).join(' ')}`, ideas: it.idea, respuestas: `${it.nombre}: ${it.texto}`, sonidos: `${it.nombre} (${it.tipo || '—'})` }[col] || '';
}

const ID_RE = /^(gan|gui|cta|has|ide|res|son)-(b\d{2}|\d{3,})$/;
export const idValido = (col, id) => ID_RE.test(String(id || '')) && String(id).startsWith(COLECCIONES[col].prefijo + '-');
const seedIds = (col) => new Set(SEMILLAS[col].map((s) => s.id));
export const esSemilla = (col, id) => seedIds(col).has(id);

function enumFormula(v) {
  const m = String(v || '').match(/\bT\s?(\d{1,2})\b/i);
  return m && T.FORMULAS[`T${+m[1]}`] ? `T${+m[1]}` : '';
}
function enumFormato(v) {
  const m = String(v || '').match(/\bF\s?(\d)\b/i);
  return m && T.FORMATOS[`F${m[1]}`] ? `F${m[1]}` : '';
}
function enumPilar(v) {
  const s = normalizarClave(v);
  if (!s) return '';
  if (/mira/.test(s)) return 'mira-como';
  if (/util/.test(s)) return 'util';
  if (/ensen/.test(s)) return 'ensena';
  if (/histor/.test(s)) return 'historia';
  if (/tenden|promo/.test(s)) return 'tendencia-promo';
  return '';
}
function enumObjetivo(v) {
  const s = normalizarClave(v);
  if (!s) return '';
  if (/coment/.test(s)) return 'comentarios';
  if (/\bdm|mensaje|direct/.test(s)) return 'dms';
  if (/guard/.test(s)) return 'guardados';
  if (/compart|envia/.test(s)) return 'compartidos';
  if (/complet|bucle|loop/.test(s)) return 'completar';
  return '';
}
function enumOcasion(v) {
  const s = normalizarClave(v).replace(/ /g, '-');
  if (!s) return '';
  if (T.OCASIONES[s]) return s;
  return Object.keys(T.OCASIONES).find((k) => s.includes(k) || normalizarClave(T.OCASIONES[k].nombre).replace(/ /g, '-').startsWith(s)) || '';
}
function listaTags(v) {
  const s = Array.isArray(v) ? v.join(' ') : String(v ?? '');
  return [...new Set((s.match(/#?[\p{L}\p{N}_]+/gu) || []).map((t) => (t.startsWith('#') ? t : `#${t}`)).map((t) => t.toLowerCase()))];
}

// ------------------------------------------------------------------ validación de un elemento

function tomar(obj, nombres) {
  for (const n of nombres) if (obj[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  return undefined;
}

function escenaDe(s) {
  if (s === null || s === undefined || s === '') return { voz: null, texto: null };
  if (typeof s === 'string') return { voz: limpio(s).replace(/\|/g, '/'), texto: '' };
  const o = Object.fromEntries(Object.entries(s).map(([k, v]) => [llave(k), v]));
  const voz = tomar(o, ['voz', 'hablado', 'dices', 'lo_que_dices', 'audio', 'texto_hablado']);
  const texto = tomar(o, ['texto', 'pantalla', 'texto_pantalla', 'texto_en_pantalla', 'en_pantalla']);
  if (voz === undefined && texto === undefined) return { voz: null, texto: null };
  return { voz: limpio(voz ?? '').replace(/\|/g, '/'), texto: limpio(texto ?? '').replace(/\|/g, '/') };
}

// Convierte lo que venga (de una semilla, del archivo o de una IA) al esquema de la colección.
export function normalizarItem(col, raw) {
  const meta = COLECCIONES[col];
  if (!meta) throw new Error(`Colección desconocida: ${col}`);
  if (typeof raw === 'string') raw = { [meta.campos[0]]: raw };
  const o = Object.fromEntries(Object.entries(raw || {}).map(([k, v]) => [llave(k), v]));
  const alias = { ...ALIAS_COMUN, ...(ALIAS[col] || {}) };
  const it = {};
  if (o.id) it.id = String(o.id).trim();
  for (const campo of [...meta.campos, ...COMUNES]) {
    let v = tomar(o, alias[campo] || [campo]);
    if (campo === 'escenas') { it.escenas = Array.isArray(v) ? v.map(escenaDe) : []; continue; }
    if (campo === 'tags') { if (v !== undefined) it.tags = listaTags(v); continue; }
    if (v === undefined) continue;
    v = limpio(Array.isArray(v) ? v.join(' ') : v);
    if (['texto', 'voz'].includes(campo) && col !== 'respuestas') v = v.replace(/\|/g, '/');
    if (campo === 'formula') v = enumFormula(v);
    else if (campo === 'formato') v = enumFormato(v);
    else if (campo === 'pilar') v = enumPilar(v);
    else if (campo === 'objetivo') v = enumObjetivo(v);
    else if (campo === 'ocasion') v = enumOcasion(v);
    else if (campo === 'tipo') v = TIPOS_SONIDO.find((t) => normalizarClave(v).includes(t)) || (/music|cancion|comercial/.test(normalizarClave(v)) ? 'comercial' : /efect/.test(normalizarClave(v)) ? 'sfx' : '');
    if (v !== '') it[campo] = v;
  }
  if (col === 'hashtags' && !it.tags) it.tags = [];
  for (const k of META) if (o[k]) it[k] = String(o[k]);
  return it;
}

function textosDe(it) {
  const out = [];
  for (const [k, v] of Object.entries(it)) {
    if (['id', 'url', ...META].includes(k)) continue;
    if (k === 'escenas') v.forEach((s) => out.push(s.voz || '', s.texto || ''));
    else if (Array.isArray(v)) out.push(v.join(' '));
    else out.push(String(v ?? ''));
  }
  return out.join(' \n ');
}

// { ok, item, motivos[] (por qué se rechaza), avisos[] (se acepta, pero revisa) }
export function validarItem(col, raw, ctx) {
  const motivos = [];
  const avisos = [];
  let it;
  try { it = normalizarItem(col, raw); } catch (e) { return { ok: false, item: null, motivos: [e.message], avisos }; }
  const meta = COLECCIONES[col];
  const req = { ganchos: ['texto'], guiones: ['titulo', 'formato'], ctas: ['voz'], hashtags: ['nombre'], ideas: ['idea'], respuestas: ['nombre', 'texto'], sonidos: ['nombre'] }[col];
  for (const r of req) if (!it[r]) motivos.push(r === 'formato' ? 'Falta "formato" (F1, F3, F4 o F5)' : `Falta "${r}"`);
  if (it.id && !idValido(col, it.id)) { avisos.push(`Id "${it.id}" no válido para ${meta.nombre.toLowerCase()}: se tratará como nuevo`); delete it.id; }
  for (const [k, max] of Object.entries(LIMITES)) {
    if (col === 'respuestas' && k === 'texto') continue;
    if (typeof it[k] === 'string' && it[k].length > max) motivos.push(`"${k}" es muy largo (${it[k].length} de máximo ${max} caracteres)`);
  }
  if (col === 'respuestas' && (it.texto || '').length > 1000) motivos.push('La respuesta es muy larga (máximo 1000 caracteres)');
  if (it.url && !/^https:\/\/[^\s]+$/.test(it.url)) motivos.push('La url debe empezar por https://');
  if (col === 'hashtags') {
    if (!it.tags.length) motivos.push('No trae hashtags');
    if (it.tags.length > 10) motivos.push('Más de 10 hashtags (usa de 3 a 5)');
    if (it.tags.some((t) => t.length > 40)) motivos.push('Hashtag demasiado largo');
  }
  if (col === 'guiones' && it.formato) {
    const n = ESCENAS_POR_FORMATO[it.formato];
    if (it.escenas.length !== n) motivos.push(`El formato ${it.formato} lleva ${n} escenas y trae ${it.escenas.length}`);
    const forzado = T.FORMULAS[it.formula]?.formato;
    if (forzado && forzado !== it.formato) motivos.push(`La fórmula ${it.formula} solo funciona con el formato ${forzado}`);
    it.escenas.forEach((s, i) => {
      if ((s.voz || '').length > LIMITES.voz) motivos.push(`Escena ${i + 1}: lo que dices es muy largo`);
      if ((s.texto || '').length > LIMITES.pantalla) motivos.push(`Escena ${i + 1}: el texto en pantalla es muy largo`);
    });
    if (it.escenas.length && it.escenas[0].voz == null) motivos.push('La escena 1 (el gancho) no puede ir vacía');
  }
  const txt = textosDe(it);
  const low = txt.toLowerCase();
  const propio = String(ctx?.perfil?.usuario || '').toLowerCase();
  const arrobas = (txt.match(/(^|[\s(])@[A-Za-z0-9_.]{2,}/g) || []).map((x) => x.trim().replace(/^\(/, '').toLowerCase()).filter((x) => x !== propio);
  if (/(?:\+?57[\s.-]?)?\b3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(txt) || /\b\d{8,}\b/.test(txt) || /[\w.+-]+@[\w-]+\.[\w.]+/.test(txt) || arrobas.length) {
    motivos.push('Trae datos de contacto (teléfono, correo o @usuario): usa {whatsapp}, {web} o {cotizar}');
  }
  const marcas = MARCAS.filter((m) => low.includes(m));
  if (marcas.length) motivos.push(`Personaje o marca registrada (${marcas.join(', ')}): no se usa en productos a la venta`);
  for (const f of [...(ctx?.voz?.prohibidas || []), 'sígueme para más']) {
    if (f && low.includes(f.toLowerCase())) motivos.push(`Frase prohibida por tu voz de marca: "${f}"`);
  }
  if (ctx) {
    const precios = T.preciosDesconocidos(ctx, txt);
    if (precios.length) motivos.push(`Precio que no está en el catálogo (${precios.join(', ')}): escribe {precio}`);
    else if (/\$\s?\d/.test(txt)) avisos.push('Trae un precio escrito: mejor usa {precio} para que siempre salga el del catálogo');
  }
  if (/\b\d{1,2}\s?%\s*(de\s+)?(descuento|dto|off)\b|\b2\s?x\s?1\b|\bdescuento\b/i.test(txt)) motivos.push('Promete un descuento: no se inventan descuentos');
  if (/env[ií]o(s)? gratis|gratis el env[ií]o|entrega inmediata|llega (ma[ñn]ana|hoy)|en 24 horas/i.test(txt)) motivos.push('Promete envío gratis o un plazo que no está confirmado');
  const desconocidos = [...new Set((txt.match(/\{[^}]*\}/g) || []).filter((m) => !MARCADORES.includes(m.slice(1, -1))))];
  if (desconocidos.length) motivos.push(`Marcador desconocido ${desconocidos.join(', ')}: usa [ASÍ] para lo que completas tú`);
  if (/\bvela(s)?\b/i.test(txt) && !/\bled\b/i.test(txt)) avisos.push('Si salen velas: solo velas LED cerca de piezas impresas');
  if (col === 'ganchos' && it.texto && it.texto.split(/\s+/).length > 22) avisos.push('Gancho largo: intenta decirlo en menos de 3 segundos');
  return { ok: !motivos.length, item: it, motivos, avisos };
}

// ------------------------------------------------------------------ importar lo que devuelve una IA

function intentarJSON(t) {
  try { return { v: JSON.parse(t) }; } catch (e) { return { e }; }
}

export function extraerJSON(texto) {
  let t = String(texto ?? '').replace(/^\uFEFF/, '').trim();
  const fence = t.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('['), o = t.indexOf('{');
  const start = a < 0 ? o : o < 0 ? a : Math.min(a, o);
  if (start < 0) return null;
  const end = t[start] === '[' ? t.lastIndexOf(']') : t.lastIndexOf('}');
  if (end <= start) throw new Error('El JSON está incompleto (¿se cortó la respuesta de la IA?)');
  t = t.slice(start, end + 1);
  let r = intentarJSON(t);
  if (r.e) r = intentarJSON(t.replace(/,\s*([\]}])/g, '$1'));
  if (r.e) r = intentarJSON(t.replace(/,\s*([\]}])/g, '$1').replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
  if (r.e) throw new Error(`No pude leer el JSON: ${r.e.message}`);
  return r.v;
}

function lineasA(col, texto) {
  const out = [];
  for (let l of String(texto || '').split(/\r?\n/)) {
    l = l.trim().replace(/^(?:[-*•]|\d{1,3}[.)])\s+/, '').trim();
    if (!l || /^#{1,6}\s/.test(l) || /^(aqu[ií] tienes|claro|listo|espero)/i.test(l) || (/:$/.test(l) && l.split(/\s+/).length <= 6)) continue;
    const c = l.split(/\s*\|\s*/).map(limpio);
    if (col === 'ganchos') out.push({ texto: c[0], pantalla: c[1], fotograma: c[2], formula: c[3] });
    else if (col === 'ctas') out.push({ voz: c[0], pantalla: c[1], objetivo: c[2] });
    else if (col === 'ideas') out.push({ idea: c[0], formula: c[1], objetivo: c[2], formato: c[3] });
    else if (col === 'sonidos') out.push({ nombre: c[0], tipo: c[1], uso: c[2], donde: c[3], url: c[4] });
    else if (col === 'respuestas') {
      if (c.length > 1) out.push({ nombre: c[0], texto: c[1], cuando: c[2] });
      else { const m = l.match(/^\**([^:*]{2,40})\**\s*:\s*(.+)$/); if (m) out.push({ nombre: limpio(m[1]), texto: limpio(m[2]) }); else out.push({ texto: limpio(l) }); }
    } else if (col === 'hashtags') {
      const m = l.match(/^([^#:|]{2,60})[:|]\s*(.*)$/);
      out.push(m ? { nombre: limpio(m[1]), tags: m[2] } : { nombre: '', tags: l });
    }
  }
  return out;
}

// Lee el texto pegado (JSON, con o sin ```; o una línea por elemento) y valida cada elemento.
export function parseImport(col, texto, ctx) {
  if (!COLECCIONES[col]) throw new Error(`Colección desconocida: ${col}`);
  const res = { formato: 'json', items: [], rechazados: [], error: '' };
  if (!String(texto || '').trim()) { res.error = 'No pegaste nada.'; return res; }
  let crudos;
  const pareceJSON = /^\s*(```|\[|\{)/.test(String(texto)) || /```|\[\s*\{/.test(String(texto));
  try {
    const v = pareceJSON || col === 'guiones' ? extraerJSON(texto) : null;
    if (v === null && col === 'guiones') throw new Error('Los guiones se importan en JSON: usa el prompt de "Pedir más a la IA".');
    if (v !== null) {
      crudos = Array.isArray(v) ? v : Array.isArray(v.items) ? v.items : Array.isArray(v[col]) ? v[col]
        : Object.values(v).find(Array.isArray) || [v];
    } else { res.formato = 'lineas'; crudos = lineasA(col, texto); }
  } catch (e) { res.error = e.message; return res; }
  if (crudos.length > MAX_IMPORT) { res.error = `Son ${crudos.length} elementos: el máximo por importación es ${MAX_IMPORT}. Pégalos en partes.`; return res; }
  const vistos = new Map();
  crudos.forEach((raw, i) => {
    if (col === 'hashtags' && raw && typeof raw === 'object' && !raw.nombre && !raw.set) raw = { ...raw, nombre: `Set importado ${i + 1}` };
    const v = validarItem(col, raw, ctx);
    const k = v.item ? claveDe(col, v.item) : '';
    if (v.ok && k && vistos.has(k)) { v.ok = false; v.motivos.push(`Repetido dentro de lo pegado (igual al #${vistos.get(k) + 1})`); }
    if (v.ok) { vistos.set(k, i); res.items.push({ n: i + 1, item: v.item, avisos: v.avisos }); }
    else res.rechazados.push({ n: i + 1, resumen: T.recortar(v.item ? resumenDe(col, v.item) || JSON.stringify(raw) : JSON.stringify(raw), 90), motivos: v.motivos });
  });
  if (!crudos.length) res.error = 'No encontré elementos en lo pegado.';
  return res;
}

// ------------------------------------------------------------------ archivo biblioteca/<colección>.json

export function archivoVacio(col) {
  return { coleccion: col, version: VERSION, actualizado: '', ultimo: 0, ocultos: [], items: [] };
}

// Número de un id propio (gan-007 → 7; las semillas gan-b01 → 0).
export const numeroId = (id) => +((String(id || '').match(/-(\d{3,})$/) || [])[1] || 0);
const ultimoDe = (v, items) => Math.max(0, Number.isInteger(v) && v > 0 && v < 1e6 ? v : 0, ...items.map((i) => numeroId(i.id)));

// Valida lo leído del disco (null = no existe todavía). Nunca lanza.
export function leerArchivo(col, json) {
  if (json == null) return { archivo: archivoVacio(col), avisos: [], error: '' };
  if (typeof json !== 'object' || Array.isArray(json) || !Array.isArray(json.items)) {
    return { archivo: archivoVacio(col), avisos: [], error: `biblioteca/${col}.json no tiene el formato esperado ({ "items": [...] })` };
  }
  const avisos = [];
  const ids = new Set();
  const items = [];
  for (const raw of json.items) {
    if (!raw || !idValido(col, raw.id) || ids.has(raw.id)) { avisos.push(`Se ignoró un elemento sin id válido o repetido (${raw?.id || '—'})`); continue; }
    ids.add(raw.id);
    items.push({ ...normalizarItem(col, raw), id: raw.id });
  }
  const ocultos = [...new Set((Array.isArray(json.ocultos) ? json.ocultos : []).filter((id) => esSemilla(col, id)))];
  return { archivo: { coleccion: col, version: VERSION, actualizado: String(json.actualizado || ''), ultimo: ultimoDe(json.ultimo, items), ocultos, items }, avisos, error: '' };
}

const copia = (col, a) => ({ ...(a || archivoVacio(col)), coleccion: col, version: VERSION, ultimo: ultimoDe(a?.ultimo, a?.items || []), ocultos: [...(a?.ocultos || [])], items: [...(a?.items || [])] });

// Lista efectiva: semillas (menos las ocultas; con tu versión si la editaste) + lo tuyo.
export function efectivos(col, archivo, { ocultos = false } = {}) {
  const a = archivo || archivoVacio(col);
  const propios = new Map(a.items.map((i) => [i.id, i]));
  const hidden = new Set(a.ocultos);
  const ids = seedIds(col);
  const semillas = SEMILLAS[col].filter((s) => ocultos || !hidden.has(s.id)).map((s) => propios.get(s.id) || s);
  return [...semillas, ...a.items.filter((i) => !ids.has(i.id))];
}

export function origenDe(col, archivo, it) {
  if (!esSemilla(col, it.id)) return 'tuyo';
  return archivo?.items?.some((i) => i.id === it.id) ? 'semilla-editada' : 'semilla';
}

const contenido = (col, it) => {
  const n = normalizarItem(col, it);
  for (const k of [...META, 'id']) delete n[k];
  return JSON.stringify(Object.fromEntries(Object.entries(n).sort(([a], [b]) => a.localeCompare(b))));
};

// Agrega lo nuevo, actualiza lo que trae un id existente y descarta lo repetido (mismo texto sin id).
export function fusionar(col, archivo, entrantes, { ahora = '', fuente = 'IA' } = {}) {
  const a = copia(col, archivo);
  const pre = COLECCIONES[col].prefijo;
  const porId = new Map(efectivos(col, a, { ocultos: true }).map((i) => [i.id, i]));
  const porClave = new Map(efectivos(col, a).map((i) => [claveDe(col, i), i.id]));
  // Los ids nunca se reutilizan: un id borrado y exportado, al reimportarlo, no pisa a otro elemento.
  let sig = a.ultimo + 1;
  const r = { nuevos: [], actualizados: [], repetidos: [] };
  const guardar = (it) => {
    const k = a.items.findIndex((x) => x.id === it.id);
    if (k >= 0) a.items[k] = it; else a.items.push(it);
    porId.set(it.id, it);
    porClave.set(claveDe(col, it), it.id);
  };
  for (const e0 of entrantes) {
    const e = normalizarItem(col, e0);
    for (const k of META) delete e[k];
    const prev = e.id ? porId.get(e.id) : null;
    if (prev) {
      const merged = { ...normalizarItem(col, prev), ...e, id: prev.id };
      const oculto = a.ocultos.includes(prev.id);
      if (contenido(col, merged) === contenido(col, prev) && !oculto) { r.repetidos.push({ item: e, igualA: prev.id }); continue; }
      merged.actualizado = ahora;
      a.ocultos = a.ocultos.filter((x) => x !== prev.id);
      guardar(merged);
      r.actualizados.push(merged);
      continue;
    }
    delete e.id;
    const k = claveDe(col, e);
    if (porClave.has(k)) { r.repetidos.push({ item: e, igualA: porClave.get(k) }); continue; }
    const f = typeof e0?.fuente === 'string' && e0.fuente && e0.fuente !== 'semilla' ? e0.fuente : fuente;
    const nuevo = { id: `${pre}-${pad(sig++)}`, ...e, fuente: f, creado: ahora, actualizado: ahora };
    guardar(nuevo);
    r.nuevos.push(nuevo);
  }
  a.ultimo = sig - 1;
  if (r.nuevos.length || r.actualizados.length) a.actualizado = ahora;
  return { archivo: a, ...r };
}

// Revisión completa de lo pegado: qué entra, qué actualiza, qué se descarta y por qué (no guarda nada).
export function revisarImport(col, texto, ctx, archivo, opts = {}) {
  const p = parseImport(col, texto, ctx);
  const f = p.error ? { archivo: copia(col, archivo), nuevos: [], actualizados: [], repetidos: [] } : fusionar(col, archivo, p.items.map((x) => x.item), opts);
  const avisos = p.items.filter((x) => x.avisos.length).map((x) => ({ n: x.n, resumen: T.recortar(resumenDe(col, x.item), 90), avisos: x.avisos }));
  return { ...f, formato: p.formato, error: p.error, rechazados: p.rechazados, avisos, total: p.items.length + p.rechazados.length };
}

export function resumenImport(col, r) {
  return `${COLECCIONES[col].nombre}: ${r.nuevos.length} nuevos, ${r.actualizados.length} actualizados, ${r.repetidos.length} repetidos, ${r.rechazados?.length || 0} rechazados`;
}

// Una base solo se oculta (si la editaste, tu versión se conserva para cuando la restaures); lo tuyo se borra.
export function ocultar(col, archivo, id, { ahora = '' } = {}) {
  const a = copia(col, archivo);
  if (esSemilla(col, id)) { if (!a.ocultos.includes(id)) a.ocultos.push(id); }
  else a.items = a.items.filter((i) => i.id !== id);
  a.actualizado = ahora;
  return a;
}

// Descarta tu versión de un elemento base y vuelve al original.
export function volverABase(col, archivo, id, { ahora = '' } = {}) {
  const a = copia(col, archivo);
  if (!esSemilla(col, id)) return a;
  a.items = a.items.filter((i) => i.id !== id);
  a.actualizado = ahora;
  return a;
}

export function restaurarOcultos(col, archivo, { ahora = '' } = {}) {
  const a = copia(col, archivo);
  a.ocultos = [];
  a.actualizado = ahora;
  return a;
}

// Mismo formato que se importa (con id: si lo vuelves a importar, actualiza en vez de duplicar).
export function exportar(col, items) {
  return JSON.stringify(items.map((it) => {
    const n = normalizarItem(col, it);
    for (const k of META) delete n[k];
    return n;
  }), null, 2);
}

// ------------------------------------------------------------------ marcadores y "Usar" en Crear guion

export function variables(ctx, input = {}, { tema = '' } = {}) {
  const p = T.findProduct(ctx, input.producto) || { frase: 'tu regalo personalizado', corto: 'regalo personalizado', g: 'm', pantalla: 'REGALO PERSONALIZADO', precio: null };
  const o = T.OCASIONES[input.ocasion] || T.OCASIONES.general;
  const ob = T.OBJETIVOS[input.objetivo] || T.OBJETIVOS.comentarios;
  const lo = T.pron(p.g);
  const pf = ctx.perfil || {};
  const web = pf.web || 'pabonitas.co';
  const t = String(tema || '').replace(/\s+/g, ' ').trim();
  return {
    producto: p.frase, Producto: T.cap(p.frase), corto: p.corto, el_producto: `${T.art(p)} ${p.corto}`, El_producto: T.cap(`${T.art(p)} ${p.corto}`),
    lo, Lo: T.cap(lo), PRODUCTO: p.pantalla, precio: T.precioHablado(p) || 'cotiza gratis', PRECIO: T.precioTexto(p).toUpperCase(),
    para: o.para, guardar: o.guardar, compartir: o.compartir, dm: o.dm, cta: ob.voz(o), CTA: ob.texto(o),
    ciudad: pf.ciudad || 'Colombia', marca: pf.marca || 'Pabonitas', web, cotizar: pf.links?.cotizar || web, generador: pf.links?.generador || web,
    whatsapp: pf.whatsapp || '[WHATSAPP]',
    catalogo: (ctx.catalogo || []).filter((x) => x.precio != null).map((x) => `${x.corto} ${T.precioTexto(x)}`).join(' · ') || 'te cotizo gratis',
    tema: t || '[TEMA]', TEMA: t ? T.recortar(t.toUpperCase(), 28) : '[TEMA]',
  };
}

export function rellenar(s, vars) {
  const faltan = [];
  const src = String(s ?? '');
  let texto = src.replace(/\{([A-Za-z_]+)\}/g, (m, k) => (k in vars ? vars[k] : (faltan.push(m), m)));
  if (/^[¿¡"«]*\{/.test(src)) texto = texto.replace(/^([¿¡"«]*)(\p{Ll})/u, (m, a, b) => a + b.toUpperCase());
  return { texto, faltan };
}

function rellenarTodo(campos, vars) {
  const faltan = [];
  const out = {};
  for (const [k, v] of Object.entries(campos)) {
    if (v == null) { out[k] = v; continue; }
    const r = rellenar(v, vars);
    out[k] = r.texto;
    faltan.push(...r.faltan);
  }
  return { out, faltan };
}

const avisoFaltan = (faltan) => (faltan.length ? [`Marcadores sin dato: ${[...new Set(faltan)].join(', ')}`] : []);
const formatoDe = (ctx, input) => { try { return T.draftVideo(input, ctx).formato; } catch { return ''; } };

export function compatible(formato, formula) {
  if (!formula) return true;
  if (formato === 'F3') return ['T4', 'T1', 'T2', 'T10'].includes(formula);
  if (formato === 'F4') return ['T7', 'T5', 'T6', 'T3'].includes(formula);
  if (formato === 'F5') return ['T1', 'T5', 'T6', 'T3', 'T10'].includes(formula);
  return !['T4', 'T7'].includes(formula);
}

// Gancho → escena 1 del borrador. Cambia la fórmula solo si no cambia el formato (no rompe tus escenas).
export function usarGancho(ctx, input, gancho, { tema = '' } = {}) {
  const tm = tema || (gancho.formula === 'T10' ? input.tendencia : '');
  const vars = variables(ctx, input, { tema: tm });
  const { out, faltan } = rellenarTodo({ voz: gancho.texto, texto: gancho.pantalla || '', visual: gancho.fotograma || null }, vars);
  const nuevo = { ...input, escenas: [...(input.escenas || [])], hook: 0 };
  const avisos = [];
  const actual = formatoDe(ctx, input);
  if (gancho.formula && gancho.formula !== input.formula) {
    if (formatoDe(ctx, { ...input, formula: gancho.formula }) === actual) nuevo.formula = gancho.formula;
    else avisos.push(`El gancho es de la fórmula ${gancho.formula}; se dejó ${input.formula} para no cambiar el formato ${actual}`);
  }
  if (gancho.ocasion && gancho.ocasion !== 'general' && (!input.ocasion || input.ocasion === 'general')) nuevo.ocasion = gancho.ocasion;
  if (nuevo.formula === 'T10' && tm) nuevo.tendencia = tm;
  nuevo.escenas[0] = { ...(nuevo.escenas[0] || {}), voz: out.voz, texto: out.texto, ...(out.visual ? { visual: out.visual } : {}) };
  return { input: nuevo, avisos: [...avisos, ...avisoFaltan(faltan)] };
}

// Guion base → borrador completo (producto, fórmula, formato, ocasión, objetivo y escenas).
export function usarGuion(ctx, input, guion) {
  const avisos = [];
  const base = {
    ...input, titulo: guion.titulo || '', formula: guion.formula || 'T1', formato: guion.formato, hook: 0, lista: [], escenas: [], tendencia: '',
    ...(guion.ocasion ? { ocasion: guion.ocasion } : {}), ...(guion.objetivo ? { objetivo: guion.objetivo } : {}), ...(guion.pilar ? { pilar: guion.pilar } : {}),
  };
  const sugerido = guion.producto ? T.detectProduct(ctx, guion.producto) : null;
  if (guion.producto && !sugerido) avisos.push(`No encontré "${guion.producto}" en tu catálogo: se usa otro producto`);
  const candidatos = [...new Set([sugerido?.id, guion.producto ? null : input.producto, ...ctx.catalogo.filter((p) => p.precio != null).map((p) => p.id), ...ctx.catalogo.map((p) => p.id)].filter(Boolean))];
  const producto = candidatos.find((id) => formatoDe(ctx, { ...base, producto: id }) === guion.formato);
  if (!producto) return { input: { ...base, producto: input.producto }, avisos: [...avisos, `Ningún producto del catálogo funciona con el formato ${guion.formato}`] };
  if (sugerido && producto !== sugerido.id) avisos.push(`"${sugerido.nombre}" no funciona con el formato ${guion.formato}: se usa otro producto`);
  base.producto = producto;
  const vars = variables(ctx, base);
  const faltan = [];
  base.escenas = (guion.escenas || []).map((s) => {
    if (!s || (s.voz == null && s.texto == null)) return {};
    const r = rellenarTodo({ voz: s.voz ?? '', texto: s.texto ?? '' }, vars);
    faltan.push(...r.faltan);
    return r.out;
  });
  return { input: base, avisos: [...avisos, ...avisoFaltan(faltan)] };
}

// CTA → última escena (siempre con "Enviamos a toda Colombia") y objetivo del caption.
export function usarCta(ctx, input, cta, nEscenas) {
  const nuevo = { ...input, escenas: [...(input.escenas || [])] };
  if (T.OBJETIVOS[cta.objetivo]) nuevo.objetivo = cta.objetivo;
  const vars = variables(ctx, nuevo);
  const { out, faltan } = rellenarTodo({ voz: cta.voz, texto: cta.pantalla || '' }, vars);
  const ultima = Math.max(0, (nEscenas || 1) - 1);
  nuevo.escenas[ultima] = { ...(nuevo.escenas[ultima] || {}), voz: /colombia/i.test(out.voz) ? out.voz : `Enviamos a toda Colombia. ${out.voz}`, texto: out.texto };
  return { input: nuevo, avisos: avisoFaltan(faltan) };
}

// Idea → borrador nuevo con su fórmula, formato y objetivo. Si la idea trae una frase entre comillas, es el gancho.
export function usarIdea(ctx, input, idea) {
  const texto = String(idea.idea || '');
  const frase = (texto.match(/["“«]([^"”»]{6,})["”»]/) || [])[1] || '';
  const titulo = T.recortar(texto.replace(/["“”«»]/g, '').replace(/\s*\([^)]*\)\s*/g, ' ').trim(), 80);
  const nuevo = { ...input, titulo, hook: 0, lista: [], escenas: [], tendencia: '' };
  if (T.FORMULAS[idea.formula]) nuevo.formula = idea.formula;
  if (T.FORMATOS[idea.formato]) nuevo.formato = idea.formato;
  if (T.OBJETIVOS[idea.objetivo]) nuevo.objetivo = idea.objetivo;
  if (idea.pilar) nuevo.pilar = idea.pilar;
  if (frase) nuevo.escenas[0] = { voz: frase };
  return { input: nuevo, avisos: [] };
}

// Ganchos para el paso 2 de Crear guion: compatibles con el formato, de la ocasión y ordenados por lo que te funciona.
export function sugerirGanchos(ctx, ganchos, input, { formato = 'F1', ranking = [], max = 8 } = {}) {
  const pos = new Map(ranking.map((r, i) => [r.formula, ranking.length - i]));
  const oc = input.ocasion || 'general';
  return ganchos
    .filter((g) => compatible(formato, g.formula) && !/\{tema\}|\{TEMA\}/.test(`${g.texto} ${g.pantalla || ''}`))
    .map((g, i) => {
      const score = (g.ocasion && g.ocasion !== 'general' ? (g.ocasion === oc ? 4 : -4) : 1) + (pos.get(g.formula) || 0) * 2 + (g.pilar && g.pilar === input.pilar ? 1 : 0);
      return { g, i, score };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .map(({ g }) => {
      const vars = variables(ctx, input);
      return { id: g.id, formula: g.formula, voz: rellenar(g.texto, vars).texto, pantalla: rellenar(g.pantalla || '', vars).texto, fuente: g.fuente };
    });
}

// ------------------------------------------------------------------ prompts para pedirle más a una IA

const IAS = [{ nombre: 'ChatGPT', url: T.ENLACES.chatgpt }, { nombre: 'Copilot', url: T.ENLACES.copilot }, { nombre: 'Gemini', url: T.ENLACES.gemini }];

const REGLAS = {
  ganchos: [
    'Cada gancho: "texto" = lo que digo en los primeros 3 segundos (máximo 15 palabras); "pantalla" = texto en pantalla de máximo 5 palabras y distinto de lo que digo; "fotograma" = qué se ve en el primer fotograma (el producto terminado o algo que dé curiosidad).',
    '"formula": T1 (resultado en frío), T2 (interrupción de patrón), T3 (número concreto: precio), T4 (¿adivinas qué es?, con timelapse), T5 (identificación: "¿te tocó…?"), T6 (afirmación sin rodeos), T7 (lista con precios), T8 (historia en medio), T9 (tutorial directo) o T10 (tendencia con giro: usa {tema}).',
    '"pilar": mira-como, util, ensena, historia o tendencia-promo. "ocasion": general, amigo-secreto, novena, profe, pareja, empresas, hogar o creadores.',
  ],
  guiones: [
    'Cada guion: "titulo", "formato", "formula", "pilar", "objetivo" (comentarios, dms, guardados, compartidos o completar), "ocasion", "producto" (una palabra de mi catálogo: llavero, nombre decorativo, soporte, figura, organizador, charms, home, funda, micrófono, lápices o logo) y "escenas".',
    'Número de escenas según el formato: F1 (toma a cámara + b-roll) = 6; F3 (timelapse + revelación) = 4; F4 (lista de 3 productos) = 5, con las escenas 2, 3 y 4 en null (el programa las llena con el catálogo); F5 (antes/después) = 5. T4 solo con F3 y T7 solo con F4.',
    'Cada escena: {"voz": lo que digo (frases cortas), "texto": texto en pantalla de máximo 5 palabras o ""}. La escena 1 es el gancho; la última dice "Enviamos a toda Colombia." y el llamado a la acción {cta}.',
  ],
  ctas: [
    'Cada CTA: "voz" = lo que digo al final (una acción concreta: comentar algo, escribir por DM una palabra clave, guardar o enviar); "pantalla" = máximo 4 palabras; "caption" = versión para el caption con 1 emoji; "objetivo" = comentarios, dms, guardados, compartidos o completar.',
  ],
  hashtags: [
    'Cada set: "nombre", "tags" (de 3 a 5 hashtags en minúscula que de verdad se usen en TikTok en español; siempre #pabonitas; mezcla 1-2 grandes con nicho y local Colombia/Bucaramanga) y "para" (cuándo usarlo).',
  ],
  ideas: [
    'Cada idea: "idea" (una línea; si hay frase de gancho, entre comillas), "pilar", "formula", "objetivo", "formato" (F1, F3, F4 o F5) y "temporada" (siempre, navidad, amor y amistad, día de la madre…).',
    'Ideas que pueda grabar en mi taller con mis impresoras Bambu Lab y con productos de mi catálogo.',
  ],
  respuestas: [
    'Cada respuesta: "nombre" (atajo corto), "texto" (máximo 4 líneas, cálido y concreto, de tú) y "cuando" (en qué caso la uso).',
    'Para la lista de precios escribe {catalogo} (yo pongo la real). Lo que no sepas, déjalo entre corchetes: [DATO …]. No inventes plazos ni costos de envío.',
  ],
  sonidos: [
    'Cada sonido: "nombre", "tipo" (tendencia, comercial, original o sfx), "uso" (en qué momento del video), "donde" (dónde lo encuentro) y "url" (https, opcional).',
    'Solo música con licencia clara para redes sociales o de la biblioteca comercial de TikTok.',
  ],
};

export const EJEMPLOS = {
  ganchos: [
    { texto: '¿Te tocó amigo secreto y no sabes qué regalar?', pantalla: 'AMIGO SECRETO RESUELTO', fotograma: 'Tú con {el_producto} en la mano', formula: 'T5', pilar: 'util', ocasion: 'amigo-secreto' },
    { texto: '{Producto} por {precio}.', pantalla: '{PRODUCTO} {PRECIO}', fotograma: 'El producto terminado junto al precio escrito a mano', formula: 'T3', pilar: 'util', ocasion: 'general' },
  ],
  guiones: [
    { titulo: '¿Adivinas qué es?', formato: 'F3', formula: 'T4', pilar: 'mira-como', objetivo: 'comentarios', ocasion: 'general', producto: 'figura', escenas: [
      { voz: '¿Adivinas qué es antes de que termine?', texto: '¿QUÉ ES?' },
      { voz: 'Ya casi… mira cómo sale de la placa.', texto: '' },
      { voz: '¡Es {producto}! {precio}.', texto: '{PRODUCTO} {PRECIO}' },
      { voz: 'Enviamos a toda Colombia. {cta}', texto: '{CTA}' },
    ] },
  ],
  ctas: [{ voz: 'Comenta tu nombre y el próximo video es el tuyo.', pantalla: 'COMENTA TU NOMBRE', caption: 'Comenta tu nombre y el próximo video es el tuyo 👇', objetivo: 'comentarios' }],
  hashtags: [{ nombre: 'Amigo secreto', tags: ['#amigosecreto', '#regalosdenavidad', '#colombia', '#pabonitas'], para: 'Regalos para el amigo secreto' }],
  ideas: [{ idea: '"Nadie adivina qué sale de aquí." Timelapse de una figura con revelación', pilar: 'mira-como', formula: 'T4', objetivo: 'comentarios', formato: 'F3', temporada: 'siempre' }],
  respuestas: [{ nombre: 'Precios', texto: '¡Hola! Algunos precios: {catalogo}. ¿Qué te gustaría y para cuándo? Te mostramos el diseño antes de fabricar.', cuando: 'Cuando preguntan el precio' }],
  sonidos: [{ nombre: 'Crack de la placa al despegar', tipo: 'original', uso: 'Revelación final, sin música encima', donde: 'Grábalo en macro con el audio original' }],
};

export function promptColeccion(ctx, col, { n = 20, tema = '', existentes = [], mejorar = null } = {}) {
  const meta = COLECCIONES[col];
  const b = T.brandContext(ctx);
  const marcas = 'Marcadores que puedes usar (yo los cambio por el dato real): {producto} (ej. "un llavero con tu nombre"), {Producto} (igual, con mayúscula), {el_producto} (ej. "el llavero con nombre"), {El_producto} (igual, con mayúscula), {PRODUCTO} (nombre en pantalla), {precio} (precio real dicho en voz), {PRECIO} (precio en pantalla), {para} (ej. "el amigo secreto"), {cta} y {CTA} (mi llamado a la acción), {dm} (palabra clave del DM), {ciudad}, {marca}, {cotizar} (enlace para cotizar), {catalogo} (lista de precios) y {tema} (tema en tendencia).';
  const comunes = [
    'Español de Colombia, de tú, frases cortas que se dicen en menos de 3 segundos.',
    ...REGLAS[col],
    'NUNCA escribas precios con números: usa {precio}. No inventes descuentos, plazos ni envíos gratis.',
    'Nada de personajes con marca registrada (Grinch, Disney, Marvel, Stitch…), ni teléfonos, correos o @usuarios.',
    'Nunca "sígueme para más", "hey chicos" ni "en el video de hoy".',
  ];
  const formato = (k) => `Devuelve SOLO un arreglo JSON válido (sin texto antes ni después, sin comentarios), con ${k} objetos con esta forma:\n${JSON.stringify(EJEMPLOS[col], null, 2)}`;
  if (mejorar?.length) {
    const lista = mejorar.slice(0, 30).map((it) => JSON.parse(exportar(col, [it]))[0]);
    return {
      id: `${col}-mejorar`, titulo: `Mejorar ${lista.length} ${meta.nombre.toLowerCase()} que ya tengo`, donde: IAS,
      despues: 'Pega la respuesta en Importar → Revisar → Guardar. Como trae los mismos "id", se actualizan (no se duplican).',
      texto: `${b}\n\nMejora estos ${lista.length} ${meta.que} para que enganchen más en TikTok Colombia, sin cambiar su intención.\nReglas:\n${comunes.map((r) => `- ${r}`).join('\n')}\n- CONSERVA el "id" de cada uno (así se actualizan en mi biblioteca en vez de duplicarse).\n${marcas}\n\nDevuelve SOLO el arreglo JSON (sin texto antes ni después) con los mismos campos:\n${JSON.stringify(lista, null, 2)}`,
    };
  }
  const ya = existentes.map((it) => T.recortar(resumenDe(col, it), 80)).filter(Boolean).slice(0, 60);
  return {
    id: `${col}-nuevos`, titulo: `Pedir ${n} ${meta.nombre.toLowerCase()} nuevos${tema ? ` sobre ${tema}` : ''}`, donde: IAS,
    despues: 'Copia la respuesta completa de la IA y pégala en Importar → Revisar → Guardar en la biblioteca.',
    texto: `${b}\n\nEscribe ${n} ${meta.que} NUEVOS para mi TikTok de regalos personalizados en impresión 3D${tema ? `, sobre: ${tema}` : ''}.\nReglas:\n${comunes.map((r) => `- ${r}`).join('\n')}\n${marcas}\n${ya.length ? `\nYa tengo estos (no los repitas):\n${ya.map((x) => `- ${x}`).join('\n')}\n` : ''}\n${formato(n)}`,
  };
}

// Estudio TikTok: generador puro (sin DOM ni Node) de guiones, kits paso a paso y prompts
// a partir de los documentos del espacio de trabajo TikTok-Impresion3D.
// Regla de marca: los precios salen SOLO del catálogo (perfil-cuenta.md §3); nunca se inventan.

export const ESTADOS = ['idea', 'guion', 'grabado', 'editado', 'listo', 'publicado', 'medido'];

export const PILARES = [
  { id: 'mira-como', nombre: 'Mira cómo (timelapse y revelación)', formulas: ['T1', 'T2', 'T4', 'T10'] },
  { id: 'util', nombre: 'Útil (regalos con precio)', formulas: ['T7', 'T6', 'T1', 'T3'] },
  { id: 'ensena', nombre: 'Enseña (cómo se diseña o fabrica)', formulas: ['T9', 'T3', 'T7'] },
  { id: 'historia', nombre: 'Historia (taller, pedidos, clientes)', formulas: ['T8', 'T5', 'T1'] },
  { id: 'tendencia-promo', nombre: 'Tendencia / promo', formulas: ['T10', 'T1', 'T5'] },
];

export const FORMULAS = {
  T1: { nombre: 'Resultado en frío', pilar: 'mira-como' },
  T2: { nombre: 'Interrupción de patrón', pilar: 'mira-como' },
  T3: { nombre: 'Número concreto (precio)', pilar: 'util' },
  T4: { nombre: 'Bucle abierto: ¿adivinas qué es?', pilar: 'mira-como', formato: 'F3' },
  T5: { nombre: 'Identificación', pilar: 'util' },
  T6: { nombre: 'Afirmación sin rodeos', pilar: 'util' },
  T7: { nombre: 'Lista con precios', pilar: 'util', formato: 'F4' },
  T8: { nombre: 'Historia en medio', pilar: 'historia' },
  T9: { nombre: 'Tutorial directo', pilar: 'ensena' },
  T10: { nombre: 'Tendencia con giro', pilar: 'tendencia-promo' },
};

export const FORMATOS = {
  F1: 'Toma continua a cámara + b-roll (diseño, timelapse, despegar)',
  F3: 'Timelapse + revelación con tu cara',
  F4: 'Lista de 3 productos con precio',
  F5: 'Antes / después (mismo encuadre) + tu reacción',
};

export const OCASIONES = {
  general: { nombre: 'Regalo con nombre (general)', para: 'alguien especial', clave: 'Un regalo que sí parece pensado.', set: 'N1', dm: 'NAVIDAD', pantalla: 'REGALO CON NOMBRE', guardar: 'tu lista de regalos', compartir: 'quien siempre deja los regalos para el final' },
  'amigo-secreto': { nombre: 'Amigo secreto', para: 'el amigo secreto', clave: 'Perfecto para el amigo secreto.', set: 'N2', dm: 'AMIGO', pantalla: 'AMIGO SECRETO RESUELTO', guardar: 'tu amigo secreto', compartir: 'quien te tocó en el amigo secreto' },
  novena: { nombre: 'Detalles para la novena', para: 'la novena', clave: 'Ideal para repartir en la novena.', set: 'N1', extra: ['#novenadeaguinaldos'], dm: 'NAVIDAD', pantalla: 'DETALLES PARA LA NOVENA', guardar: 'la novena', compartir: 'quien organiza la novena' },
  profe: { nombre: 'Detalle para la profe', para: 'la profe', clave: 'Un detalle bonito para cerrar el año con la profe.', set: 'N1', extra: ['#regaloparaprofesora'], dm: 'NAVIDAD', pantalla: 'PARA LA PROFE', guardar: 'el regalo de la profe', compartir: 'el grupo de papás del colegio' },
  pareja: { nombre: 'Pareja o mejor amiga', para: 'tu pareja', clave: 'Para tu pareja o tu mejor amiga.', set: 'N1', dm: 'NAVIDAD', pantalla: 'PARA TU PAREJA', guardar: 'el regalo de tu pareja', compartir: 'tu pareja (como indirecta)' },
  empresas: { nombre: 'Empresas (logo, volumen)', para: 'tu empresa', clave: 'Con tu logo y por cantidad para tu equipo o tus clientes.', set: 'N4', dm: 'EMPRESA', pantalla: 'CON EL LOGO DE TU EMPRESA', guardar: 'los regalos de la empresa', compartir: 'quien organiza la fiesta de la empresa' },
  hogar: { nombre: 'Decoración navideña del hogar', para: 'tu casa', clave: 'Tu casa lista para Navidad.', set: 'N5', dm: 'NAVIDAD', pantalla: 'TU CASA EN NAVIDAD', guardar: 'la decoración de diciembre', compartir: 'quien decora la casa en diciembre' },
  creadores: { nombre: 'Creadores de contenido', para: 'los creadores de contenido', clave: 'Para que tu marca salga en cada video.', set: 'N3', extra: ['#creadoresdecontenido'], dm: 'MICRO', pantalla: 'TU LOGO EN CÁMARA', guardar: 'tu próximo setup', compartir: 'un creador que necesita esto' },
};

export const OBJETIVOS = {
  comentarios: { nombre: 'Comentarios (serie de nombres)', voz: () => 'Comenta tu nombre y el próximo video es el tuyo.', texto: () => 'COMENTA TU NOMBRE', caption: () => 'Comenta tu nombre y el próximo video es el tuyo 👇' },
  dms: { nombre: 'Mensajes directos (pedidos)', voz: (o) => `Escríbeme ${o.dm} por DM y te mando el diseño antes de fabricar.`, texto: (o) => `ESCRÍBEME ${o.dm}`, caption: (o) => `Escríbeme ${o.dm} por DM y te mando el diseño antes de fabricar 📩` },
  guardados: { nombre: 'Guardados', voz: (o) => `Guárdalo para ${o.guardar}.`, texto: () => 'GUÁRDALO', caption: (o) => `Guárdalo para ${o.guardar} 📌` },
  compartidos: { nombre: 'Compartidos', voz: (o) => `Envíaselo a ${o.compartir}.`, texto: () => 'ENVÍASELO', caption: (o) => `Envíaselo a ${o.compartir} 🎁` },
  completar: { nombre: 'Ver completo (bucle)', voz: () => 'Y así, otra vez desde el principio…', texto: () => 'MÍRALO OTRA VEZ', caption: () => 'Míralo otra vez: el final conecta con el inicio 🔁' },
};

// Pistas por producto (se cruzan con los nombres del catálogo; el precio siempre viene del catálogo)
const PRODUCT_HINTS = [
  { re: /charms/i, corto: 'llavero con nombre y charms', frase: 'un llavero con nombre y charms', g: 'm', pantalla: 'LLAVERO CON CHARMS', keyword: 'Llavero con nombre y charms', modulo: 'keychain' },
  { re: /llaver.*margarita/i, corto: 'llavero con margarita', frase: 'un llavero con margarita', g: 'm', pantalla: 'LLAVERO CON MARGARITA', keyword: 'Llavero con margarita en 3D', modulo: 'keychain' },
  { re: /llaver/i, corto: 'llavero con nombre', frase: 'un llavero con tu nombre', g: 'm', pantalla: 'LLAVERO CON NOMBRE', keyword: 'Llavero con tu nombre en 3D', modulo: 'keychain' },
  { re: /nombres? decorativ/i, corto: 'nombre decorativo', frase: 'tu nombre decorativo en 3D', g: 'm', pantalla: 'NOMBRE DECORATIVO', keyword: 'Tu nombre decorativo en 3D', modulo: 'sign' },
  { re: /soporte/i, corto: 'soporte para celular', frase: 'un soporte para celular personalizado', g: 'm', pantalla: 'SOPORTE PARA CELULAR', keyword: 'Soporte para celular en 3D', modulo: null },
  { re: /figura/i, corto: 'figura decorativa', frase: 'una figura decorativa en 3D', g: 'f', pantalla: 'FIGURA EN 3D', keyword: 'Figura decorativa en 3D', modulo: null },
  { re: /organizador/i, corto: 'organizador de escritorio', frase: 'un organizador de escritorio', g: 'm', pantalla: 'ORGANIZADOR', keyword: 'Organizador de escritorio en 3D', modulo: null },
  { re: /home/i, corto: 'pieza de la colección HOME', frase: 'una pieza de la colección HOME', g: 'f', pantalla: 'DECORACIÓN 3D', keyword: 'Decoración 3D para tu casa', modulo: null },
  { re: /funda/i, corto: 'funda navideña para puerta', frase: 'una funda navideña para la puerta', g: 'f', pantalla: 'FUNDA PARA PUERTA', keyword: 'Funda navideña para puerta', modulo: null, proceso: 'sublimacion', formato: 'F5' },
  { re: /micr[oó]fono/i, corto: 'micrófono viral', frase: 'el micrófono viral con tu logo', g: 'm', pantalla: 'MICRÓFONO CON TU LOGO', keyword: 'Micrófono con tu logo en 3D', modulo: 'mic' },
  { re: /l[aá]pi/i, corto: 'lápices con nombre', frase: 'lápices con tu nombre', g: 'mp', pantalla: 'LÁPICES CON NOMBRE', keyword: 'Lápices con nombre en 3D', modulo: 'pencil' },
  { re: /logo/i, corto: 'logo 3D para tu negocio', frase: 'el logo de tu negocio en 3D', g: 'm', pantalla: 'TU LOGO EN 3D', keyword: 'Logo 3D para tu negocio', modulo: 'logo' },
  { re: /mo[ñn]o/i, corto: 'moños 3D', frase: 'moños 3D para regalo', g: 'mp', pantalla: 'MOÑOS 3D', keyword: 'Moños 3D para regalo', modulo: null },
  { re: /florero/i, corto: 'florero estriado', frase: 'un florero estriado', g: 'm', pantalla: 'FLORERO 3D', keyword: 'Florero estriado en 3D', modulo: null },
  { re: /bandeja/i, corto: 'bandeja arcoíris', frase: 'una bandeja arcoíris', g: 'f', pantalla: 'BANDEJA ARCOÍRIS', keyword: 'Bandeja arcoíris en 3D', modulo: null },
  { re: /cajita/i, corto: 'cajitas para regalar', frase: 'cajitas para regalar', g: 'fp', pantalla: 'CAJITAS PARA REGALO', keyword: 'Cajitas para regalar en 3D', modulo: null },
];

export const MODULOS_R3D = { keychain: 'Llavero', sign: 'Letrero / placa', mic: 'Logo para micrófono', pencil: 'Nombres para lápices', logo: 'Logo / figura en relieve' };

export const ENLACES = {
  creativeCenter: 'https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/es',
  studioUpload: 'https://www.tiktok.com/tiktokstudio/upload',
  studioAnaliticas: 'https://www.tiktok.com/tiktokstudio/analytics',
  chatgpt: 'https://chatgpt.com',
  copilot: 'https://copilot.microsoft.com',
  gemini: 'https://gemini.google.com',
};

const SFX = ['boom', 'click', 'ding', 'pop', 'riser', 'whoosh'];
const COLORES = { CARA: '#4A1C1C', 'B-ROLL': '#123B2C', TIMELAPSE: '#1F2633' };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

// ------------------------------------------------------------------ utilidades

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const clean = (s) => String(s ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim();
const words = (s) => String(s || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const pad = (n) => String(n).padStart(2, '0');

export function formatCOP(n) {
  if (n == null || !Number.isFinite(n)) return '';
  return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function parseCOP(text) {
  const m = String(text || '').match(/\$\s?(\d{1,3}(?:[.,]\d{3})+|\d+)/);
  return m ? Number(m[1].replace(/[.,]/g, '')) : null;
}

export function precioHablado(p) {
  if (!p || p.precio == null) return null;
  const n = p.precio;
  let t;
  if (n >= 1e6) {
    const m = Math.floor(n / 1e6);
    const r = Math.round((n % 1e6) / 1000);
    t = `${m === 1 ? 'un millón' : m + ' millones'}${r ? ' ' + r + ' mil' : ''} pesos`;
  } else if (n >= 1000) t = `${Math.round(n / 1000)} mil pesos`;
  else t = `${n} pesos`;
  return (p.desde ? 'desde ' : '') + t;
}

export function precioTexto(p) {
  if (!p || p.precio == null) return 'cotiza gratis';
  return (p.desde ? 'desde ' : '') + formatCOP(p.precio);
}

const pron = (g) => ({ m: 'lo', f: 'la', mp: 'los', fp: 'las' }[g] || 'lo');

export function slug(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

export function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
}

export function fechaHumana(s) {
  const d = parseISO(s);
  if (!d) return '';
  const t = /T\d{2}:\d{2}/.test(s) ? ` · ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
  return `${DIAS[d.getDay()]} ${d.getDate()}-${MESES[d.getMonth()]}${t}`;
}

// ------------------------------------------------------------------ parsers

export function parseCSV(text, sep = ';') {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(sep).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split(sep);
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

export function parseFrontMatter(text) {
  const m = String(text || '').replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const meta = {};
  if (!m) return meta;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^["']/.test(v)) v = v.replace(/^(["'])(.*?)\1.*$/, '$2');
    else v = v.replace(/\s+#.*$/, '').trim();
    meta[kv[1]] = v;
  }
  return meta;
}

// Secciones "## N. Título" → { '3': {titulo, cuerpo}, ... } (también por título en minúsculas)
export function parseSections(text, level = 2) {
  const out = {};
  const hashes = '#'.repeat(level);
  const re = new RegExp(`^${hashes} (.+)$`, 'gm');
  const heads = [...String(text || '').matchAll(re)];
  heads.forEach((h, i) => {
    const start = h.index + h[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    const titulo = h[1].trim();
    const cuerpo = text.slice(start, end).replace(/^\r?\n/, '');
    const num = titulo.match(/^(\d+(?:\.\d+)?)[.\s]/);
    const sec = { titulo, cuerpo };
    if (num) out[num[1]] = sec;
    out[titulo.toLowerCase()] = sec;
  });
  return out;
}

export function parseTable(md) {
  const rows = [];
  for (const line of String(md || '').split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) { if (rows.length) break; continue; }
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
    rows.push(cells);
  }
  if (!rows.length) return [];
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [clean(h), r[i] ?? ''])));
}

function enrich(nombre) {
  const h = PRODUCT_HINTS.find((x) => x.re.test(nombre));
  const base = h || { corto: nombre.toLowerCase(), frase: nombre.toLowerCase(), g: 'm', pantalla: nombre.toUpperCase(), keyword: nombre, modulo: null };
  const { re, ...rest } = base;
  return { ...rest, proceso: base.proceso || '3d' };
}

export function parseCatalog(perfilMd) {
  const sec = Object.entries(parseSections(perfilMd)).find(([k]) => /^3$/.test(k))?.[1]
    || Object.values(parseSections(perfilMd)).find((s) => /cat[aá]logo/i.test(s.titulo));
  if (!sec) return [];
  const out = [];
  for (const row of parseTable(sec.cuerpo)) {
    const nombreRaw = clean(row['Producto'] ?? Object.values(row)[0]);
    const precioRaw = clean(row['Precio (COP)'] ?? Object.values(row)[1]);
    const angulo = clean(row['Ángulo de TikTok'] ?? Object.values(row)[2] ?? '');
    if (/^bajo cotizaci/i.test(nombreRaw)) {
      const lista = nombreRaw.replace(/^bajo cotizaci[oó]n:\s*/i, '');
      for (const item of splitTop(lista)) {
        const nombre = cap(item.replace(/\s*\(.*\)\s*/g, ' ').trim());
        const detalle = (item.match(/\((.*)\)/) || [])[1] || '';
        out.push({ id: slug(nombre), nombre, detalle, precio: null, desde: false, angulo, ...enrich(nombre) });
      }
      continue;
    }
    const nombre = nombreRaw.replace(/\s*\(.*\)\s*/g, ' ').trim();
    const detalle = (nombreRaw.match(/\((.*)\)/) || [])[1] || '';
    out.push({ id: slug(nombre), nombre, detalle, precio: parseCOP(precioRaw), desde: /desde/i.test(precioRaw), angulo, ...enrich(nombre) });
  }
  return out;
}

// separa por comas que no estén dentro de paréntesis
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

// ------------------------------------------------------------------ documentos de la marca

const firstBold = (s) => (String(s || '').match(/\*\*(.+?)\*\*/) || [])[1] || clean(s);

export function parseProfile(perfilMd, vozMd = '') {
  const secs = parseSections(perfilMd);
  const s1 = secs['1'] || Object.values(secs)[0];
  const rows = s1 ? parseTable(s1.cuerpo) : [];
  const val = (re) => (rows.find((r) => re.test(clean(r.Campo ?? Object.values(r)[0]))) || {}).Valor ?? '';
  const usuario = (val(/usuario/i).match(/@[\w.]+/) || [])[0] || '';
  const ubic = firstBold(val(/ubicaci/i));
  const whatsapp = (clean(val(/canal de ventas/i)).match(/\b(\d{3}\s?\d{3}\s?\d{4})\b/) || [])[1] || '';
  const links = [...new Set((String(perfilMd).match(/pabonitas\.co\/[\w-]+/g) || []))];
  const web = (String(perfilMd).match(/web \*\*([\w.-]+\.\w+)\*\*/) || [])[1] || (links[0] || '').split('/')[0] || '';
  const vozRows = Object.fromEntries((String(vozMd).match(/^- [^:\n]+:.*$/gm) || []).map((l) => {
    const m = l.match(/^- ([^:]+):\s*(.*)$/);
    return [m[1].trim().toLowerCase(), m[2].trim()];
  }));
  return {
    usuario,
    marca: firstBold(val(/^marca/i)) || '',
    ciudad: ubic.split(',')[0].trim(),
    ubicacion: ubic,
    whatsapp,
    camara: firstBold(val(/c[aá]mara/i)),
    web,
    links: {
      cotizar: links.find((l) => /cotizar/.test(l)) || '',
      generador: links.find((l) => /generador/.test(l)) || '',
      simulador: links.find((l) => /simulador/.test(l)) || '',
    },
    quienEs: clean(vozRows['you are'] || '').replace(/\*/g, ''),
    lema: (clean(vozRows['you are'] || '').match(/Lema de la marca:\s*\*?"([^"]+)"/) || [])[1] || '',
  };
}

export function parseVoice(vozMd) {
  const get = (label) => {
    const m = String(vozMd || '').match(new RegExp(`^- ${label}:\\s*(.+)$`, 'mi'));
    return m ? clean(m[1]) : '';
  };
  const nunca = get('Words and phrases you NEVER use');
  return {
    ritmo: get('Sentence rhythm'),
    aperturas: get('Signature openers'),
    usa: get('Words and phrases you use a lot'),
    nunca,
    prohibidas: (nunca.match(/"([^"]+)"/g) || []).map((x) => x.slice(1, -1)),
    trato: get('Tú / usted'),
    emoji: get('Emoji'),
    siempre: get('Always'),
    jamas: get('Never'),
    cta: get('Your CTA style'),
    colores: [...new Set(String(vozMd || '').match(/#[0-9A-Fa-f]{6}\b/g) || [])].slice(0, 3),
  };
}

export function parseHashtagSets(md) {
  const sets = {};
  for (const line of String(md || '').split(/\r?\n/)) {
    const m = line.match(/^\|\s*\*{0,2}([A-Z]\d?)\s*·\s*([^|]+?)\*{0,2}\s*\|\s*`?([^|`]+)`?\s*\|\s*([^|]*)\|/);
    if (!m) continue;
    const tags = m[3].match(/#[\p{L}\p{N}_]+/gu) || [];
    if (tags.length) sets[m[1]] = { nombre: m[2].trim(), tags, para: clean(m[4]) };
  }
  return sets;
}

export function parseQuickReplies(campanaMd) {
  const sec = Object.values(parseSections(campanaMd)).find((s) => /respuestas r[aá]pidas/i.test(s.titulo));
  if (!sec) return [];
  const out = [];
  const re = /^\*\*([^*\n]+)\*\*\s*\r?\n((?:>.*(?:\r?\n|$))+)/gm;
  for (const m of sec.cuerpo.matchAll(re)) {
    const texto = m[2].split(/\r?\n/).map((l) => l.replace(/^>\s?/, '')).join(' ').trim();
    out.push({ nombre: m[1].trim(), texto, pendientes: [...new Set(texto.match(/\[[^\]]+\]/g) || [])] });
  }
  return out;
}

function parseRango(txt, anio) {
  const m = String(txt).match(/\((\d{1,2})(?:\s*([a-zé]{3}))?\s*-\s*(\d{1,2})\s*([a-zé]{3})\)/i);
  if (!m) return null;
  const mes2 = MESES.indexOf(m[4].toLowerCase().slice(0, 3));
  const mes1 = m[2] ? MESES.indexOf(m[2].toLowerCase().slice(0, 3)) : mes2;
  if (mes1 < 0 || mes2 < 0) return null;
  const y = (mes) => (mes < 6 ? anio + 1 : anio);
  return { desde: isoDate(new Date(y(mes1), mes1, +m[1])), hasta: isoDate(new Date(y(mes2), mes2, +m[3])) };
}

export function parseCampaign(campanaMd) {
  const text = String(campanaMd || '');
  const anio = +(text.match(/\b(20\d{2})\b/) || [])[1] || new Date().getFullYear();
  const secs = parseSections(text);
  const fasesSec = Object.values(secs).find((s) => /^\d+\.\s*Fases/i.test(s.titulo));
  const fases = (fasesSec ? parseTable(fasesSec.cuerpo) : []).map((r) => {
    const f = clean(r.Fase);
    const rango = parseRango(r.Semanas, anio) || {};
    return {
      letra: f.split('·')[0].trim(), nombre: (f.split('·')[1] || f).trim(), semanas: clean(r.Semanas), ...rango,
      mensaje: clean(r.Mensaje), heroe: clean(r['Producto héroe']), meta: clean(r['Meta principal']),
    };
  });
  const mapaSec = Object.values(secs).find((s) => /semana a semana/i.test(s.titulo));
  const semanas = (mapaSec ? parseTable(mapaSec.cuerpo) : []).map((r) => {
    const s = clean(r.Semana);
    return { semana: (s.match(/W\d{2}/) || [])[0] || s, rango: s.replace(/W\d{2}\s*/, ''), videos: clean(Object.values(r)[1]), cta: clean(r['CTA de la semana'] ?? Object.values(r)[2]) };
  });
  const h = text.match(/L-V\s*(\d{1,2}:\d{2})\s*·\s*s[aá]b\s*(\d{1,2}:\d{2})\s*·\s*dom\s*(\d{1,2}:\d{2})/i);
  const horarios = h ? { semana: h[1], sabado: h[2], domingo: h[3] } : { semana: '18:30', sabado: '11:00', domingo: '18:00' };
  return { anio, fases, semanas, horarios, respuestas: parseQuickReplies(text) };
}

export function parseGuion(text) {
  const t = String(text || '');
  const meta = parseFrontMatter(t);
  const secs = Object.values(parseSections(t));
  const find = (re) => secs.find((s) => re.test(s.titulo));
  const hookRows = parseTable(find(/^2\.|hook/i)?.cuerpo || '');
  const capa = (re) => clean((hookRows.find((r) => re.test(r.Capa || '')) || {}).Contenido || '').replace(/^"|"$/g, '');
  const tele = find(/teleprompter|decir a c[aá]mara/i)?.cuerpo || '';
  const tomasTxt = find(/lista de tomas/i)?.cuerpo || '';
  const tomas = [];
  const notas = [];
  for (const line of tomasTxt.split(/\r?\n/)) {
    const m = line.match(/^- \[( |x|X)\]\s+(.*)$/);
    if (m) {
      const archivo = (m[2].match(/`(clips\/[^`]+)`/) || [])[1] || '';
      tomas.push({ archivo, desc: clean(m[2].replace(/`clips\/[^`]+`:?\s*/, '')), hecho: m[1] !== ' ' });
      continue;
    }
    const n = line.match(/^- Nota:\s*(.*)$/);
    if (n) notas.push(clean(n[1]));
  }
  const pub = find(/publicaci/i)?.cuerpo || '';
  return {
    meta,
    titulo: meta.titulo || (t.match(/^# (.+)$/m) || [])[1] || '',
    hook: { hablado: capa(/hablada/i), texto: capa(/texto/i), fotograma: capa(/fotograma/i) },
    teleprompter: [...tele.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1].trim()),
    escenas: parseTable(find(/por escenas|por tiempos/i)?.cuerpo || ''),
    tomas,
    notas,
    caption: ((pub.match(/```[^\n]*\n([\s\S]*?)```/) || [])[1] || '').trim(),
    portada: clean((pub.match(/Portada[^:\n]*:\s*\*\*(.+?)\*\*/) || [])[1] || ''),
    ajustes: clean((pub.match(/^- Ajustes:\s*(.+)$/m) || [])[1] || ''),
    hora: clean((pub.match(/^- Hora:\s*(.+)$/m) || [])[1] || ''),
    notasVideo: (find(/notas y reglas/i)?.cuerpo || '').trim(),
  };
}

// ------------------------------------------------------------------ contexto, agenda y métricas

export function buildContext(data = {}) {
  const avisos = [];
  for (const [k, n] of [['perfil', 'estrategia/perfil-cuenta.md'], ['voz', 'estrategia/voz-y-marca.md'], ['hashtags', 'estrategia/hashtags-y-seo.md'], ['campana', 'estrategia/campana-navidad-2026.md']]) {
    if (!data[k]) avisos.push(`No encontré ${n}`);
  }
  const catalogo = parseCatalog(data.perfil || '');
  if (data.perfil && !catalogo.length) avisos.push('No pude leer el catálogo (perfil-cuenta.md §3)');
  const campana = parseCampaign(data.campana || '');
  const filas = parseCSV(data.videosCsv || '');
  const carpetas = new Map((data.videos || []).map((v) => [v.carpeta, v]));
  const videos = filas.map((r) => {
    const f = carpetas.get(r.carpeta) || {};
    carpetas.delete(r.carpeta);
    return { ...r, ...folderInfo(f) };
  });
  for (const f of carpetas.values()) {
    const id = (f.carpeta.match(/V\d{3,}/) || [])[0];
    if (id && !videos.some((v) => v.id === id)) {
      const g = parseGuion(f.guion);
      videos.push({ id, titulo: g.titulo, estado: g.meta.estado || 'idea', fecha_plan: g.meta.fecha_plan || '', carpeta: f.carpeta, pilar: g.meta.pilar || '', formula: g.meta.formula || '', ...folderInfo(f) });
    }
  }
  videos.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  const now = data.now ? parseISO(data.now) || new Date(data.now) : new Date();
  return {
    root: data.root || '',
    today: data.today || isoDate(now),
    now,
    catalogo,
    perfil: parseProfile(data.perfil || '', data.voz || ''),
    voz: parseVoice(data.voz || ''),
    hashtags: parseHashtagSets(data.hashtags || ''),
    campana,
    videos,
    metricas: parseCSV(data.metricasCsv || ''),
    pedidos: parseCSV(data.pedidosCsv || ''),
    avisos,
  };
}

function folderInfo(f) {
  if (!f || !f.carpeta) return { existe: false, clips: [], salida: [], guion: null, spec: null };
  return {
    existe: true,
    clips: f.clips || [],
    salida: f.salida || [],
    transcripcion: !!f.transcripcion,
    vozGuia: !!f.vozGuia,
    tieneKit: !!f.kit,
    guionMd: f.guion || '',
    guion: f.guion ? parseGuion(f.guion) : null,
    spec: f.spec || null,
  };
}

export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 864e5 + 1) / 7);
}

export function faseDe(ctx, iso) {
  return ctx.campana.fases.find((f) => f.desde && iso >= f.desde && iso <= f.hasta) || null;
}

export function horaPara(ctx, d) {
  const h = ctx.campana.horarios;
  return d.getDay() === 6 ? h.sabado : d.getDay() === 0 ? h.domingo : h.semana;
}

const PENDIENTE = new Set(['idea', 'guion', 'grabado', 'editado', 'listo']);

export function nextFreeSlot(ctx, desde) {
  const base = parseISO(desde || ctx.today) || new Date();
  const ocupados = new Set(ctx.videos.filter((v) => v.fecha_plan).map((v) => v.fecha_plan.slice(0, 10)));
  for (let i = 0; i < 30; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const hora = horaPara(ctx, d);
    const slot = `${isoDate(d)}T${hora}`;
    if (ocupados.has(isoDate(d))) continue;
    if (parseISO(slot) <= ctx.now) continue;
    return slot;
  }
  return '';
}

export function latestMetrics(ctx) {
  const out = {};
  for (const m of ctx.metricas) {
    const prev = out[m.id];
    if (!prev || (+m.horas_desde_publicacion || 0) >= (+prev.horas_desde_publicacion || 0)) out[m.id] = m;
  }
  return out;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

export const SIGUIENTE = {
  idea: 'Escribir el guion (pestaña Crear guion)',
  guion: 'Preparar y grabar (Kit → Preparar y Grabar)',
  grabado: 'Pasar los clips al PC y montar (Kit → Montar)',
  editado: 'Revisar el video final y dejarlo listo',
  listo: 'Publicar o programar (Kit → Publicar)',
  publicado: 'Medir a las 24 h, 72 h y 7 días (Kit → Medir)',
  medido: 'Sacar el aprendizaje y pasarlo a aprendizajes.md',
};

export function medicionesPendientes(ctx, v) {
  if (!['publicado', 'medido'].includes(v.estado) || !v.fecha_publicado) return [];
  const pub = parseISO(v.fecha_publicado);
  const horas = (ctx.now - pub) / 36e5;
  const hechas = ctx.metricas.filter((m) => m.id === v.id).map((m) => +m.horas_desde_publicacion || 0);
  return [24, 72, 168].filter((h) => horas >= h && !hechas.some((x) => Math.abs(x - h) <= h * 0.35));
}

export function agenda(ctx) {
  const hoy = ctx.today;
  const d0 = parseISO(hoy);
  const manana = isoDate(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1));
  const en7 = isoDate(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 7));
  const pend = ctx.videos.filter((v) => PENDIENTE.has(v.estado));
  const dia = (v) => (v.fecha_plan || '').slice(0, 10);
  const conAccion = (v) => ({ ...v, siguiente: SIGUIENTE[v.estado] || '' });
  const byPlan = (a, b) => (a.fecha_plan || '').localeCompare(b.fecha_plan || '');
  const ult = latestMetrics(ctx);
  const vistas = Object.values(ult).map((m) => +m.vistas).filter(Number.isFinite);
  const ventas = ctx.pedidos.filter((p) => /vendido|entregado/i.test(p.estado));
  const fase = faseDe(ctx, hoy);
  const semana = `W${pad(isoWeek(d0))}`;
  const mejor = Object.values(ult).sort((a, b) => (+b.vistas || 0) - (+a.vistas || 0))[0];
  return {
    hoy, manana, fase, semana,
    semanaPlan: ctx.campana.semanas.find((s) => s.semana === semana) || null,
    vencidos: pend.filter((v) => dia(v) && dia(v) < hoy).sort(byPlan).map(conAccion),
    deHoy: pend.filter((v) => dia(v) === hoy).sort(byPlan).map(conAccion),
    deManana: pend.filter((v) => dia(v) === manana).sort(byPlan).map(conAccion),
    proximos: pend.filter((v) => dia(v) > manana && dia(v) <= en7).sort(byPlan).map(conAccion),
    sinFecha: pend.filter((v) => !dia(v)).map(conAccion),
    porMedir: ctx.videos.map((v) => ({ ...v, faltan: medicionesPendientes(ctx, v) })).filter((v) => v.faltan.length),
    hueco: nextFreeSlot(ctx, hoy),
    kpis: {
      videos: ctx.videos.length,
      publicados: ctx.videos.filter((v) => ['publicado', 'medido'].includes(v.estado)).length,
      pendientes: pend.length,
      medianaVistas: median(vistas),
      mejor: mejor ? { id: mejor.id, vistas: +mejor.vistas } : null,
      consultas: ctx.pedidos.length,
      ventas: ventas.length,
      valorVentas: ventas.reduce((s, p) => s + (+p.valor_cop || 0), 0),
    },
  };
}

// Diagnóstico con la tabla de SKILL.md §5 (línea base de la cuenta: mediana ≈ 220, meta 450)
export function diagnose(m, { mediana = 220, duracion = 0 } = {}) {
  if (!m) return [];
  const vistas = +m.vistas || 0;
  const pct = (k) => (vistas ? ((+m[k] || 0) / vistas) * 100 : 0);
  const out = [];
  const tm = +m.tiempo_medio_s || 0;
  const ref = mediana || 220;
  if (vistas >= 2 * ref) out.push({ sintoma: `${vistas} vistas: ≥ 2× la mediana (${Math.round(ref)})`, causa: 'Formato ganador', accion: 'Doblar la apuesta: 2-3 variaciones del mismo formato en las próximas 72 h' });
  if (tm && duracion && tm / duracion < 0.25) out.push({ sintoma: `Tiempo medio ${tm}s de ${duracion}s`, causa: 'Hook débil o primer fotograma lento', accion: 'Reescribe el hook (prompt "10 hooks") y pon el producto terminado en el fotograma 1' });
  else if (tm && duracion && tm / duracion < 0.5) out.push({ sintoma: `Tiempo medio ${tm}s de ${duracion}s`, causa: 'Relleno o explicación larga a mitad del video', accion: 'Recorta 20-30 % y haz cortes cada 1-2 s' });
  if ((+m.vio_completo_pct || 0) >= 30 && pct('compartidos') < 1) out.push({ sintoma: 'Lo ven completo pero casi no lo comparten', causa: 'Útil pero no "para alguien"', accion: 'Añade el ángulo "envíaselo a…" o una identificación (amigo secreto, profe, pareja)' });
  if (pct('guardados') >= 2) out.push({ sintoma: `${pct('guardados').toFixed(1)} % de guardados`, causa: 'Formato de valor', accion: 'Conviértelo en serie: parte 2 y 3' });
  if ((+m.trafico_busqueda_pct || 0) >= 15) out.push({ sintoma: `${m.trafico_busqueda_pct} % del tráfico viene de búsqueda`, causa: 'Buena palabra clave', accion: 'Repite la palabra clave en la voz, el texto en pantalla y el caption' });
  if (!out.length && vistas < 450 && (+m.horas_desde_publicacion || 0) >= 72) out.push({ sintoma: `${vistas} vistas a las ${m.horas_desde_publicacion} h (meta 450)`, causa: 'No despegó', accion: 'Prueba otro hook y otro primer fotograma con el mismo producto; publica a la hora de más actividad' });
  if (!out.length) out.push({ sintoma: 'Sin señales fuertes todavía', causa: '—', accion: 'Sigue midiendo a las 24 h, 72 h y 7 días' });
  return out;
}

// ------------------------------------------------------------------ borrador de video

const art = (p) => ({ m: 'el', f: 'la', mp: 'los', fp: 'las' }[p.g] || 'el');
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
// Short text for an on-screen card: whole words only, never an unclosed parenthesis.
export function recortar(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  let cut = t.slice(0, n).replace(/\s+\S*$/, '');
  const abre = cut.lastIndexOf('(');
  if (abre > cut.lastIndexOf(')')) cut = cut.slice(0, abre);
  return `${cut.replace(/[\s,;:.(—-]+$/, '')}…`;
}
const sinPipe = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

const DUDA = {
  general: '¿Todavía no sabes qué regalar esta Navidad?',
  'amigo-secreto': '¿Te tocó amigo secreto y no sabes qué regalar?',
  novena: '¿Necesitas detalles para repartir en la novena?',
  profe: '¿No sabes qué regalarle a la profe este fin de año?',
  pareja: '¿No sabes qué regalarle a tu pareja esta Navidad?',
  empresas: '¿Tu empresa todavía no tiene los regalos de fin de año?',
  hogar: '¿Tu casa todavía no parece de Navidad?',
  creadores: '¿Grabas videos y tu micrófono no dice quién eres?',
};

const DEFAULT_SETS = {
  N1: ['#regalospersonalizados', '#navidad', '#impresion3d', '#llaveropersonalizado', '#pabonitas'],
  N2: ['#amigosecreto', '#regalosdenavidad', '#ideasderegalo', '#colombia', '#pabonitas'],
  N3: ['#impresion3d', '#bambulab', '#timelapse', '#emprendimiento', '#pabonitas'],
  N4: ['#regalosempresariales', '#detallesempresariales', '#logo3d', '#bucaramanga', '#pabonitas'],
  N5: ['#decoracionnavideña', '#navidad', '#hogar', '#antesydespues', '#pabonitas'],
};

const VOL = { pop: 0.6, whoosh: 0.5, ding: 0.7, riser: 0.5, click: 0.6, boom: 0.6 };

export function findProduct(ctx, ref) {
  const c = ctx.catalogo;
  if (ref && typeof ref === 'object') return ref;
  return c.find((p) => p.id === ref) || c.find((p) => p.nombre.toLowerCase() === String(ref || '').toLowerCase())
    || c.find((p) => p.precio != null) || c[0] || null;
}

export function detectProduct(ctx, text) {
  const t = String(text || '');
  for (const h of PRODUCT_HINTS) {
    if (!h.re.test(t)) continue;
    const p = ctx.catalogo.find((x) => h.re.test(x.nombre));
    if (p) return p;
  }
  return null;
}

function espacio(p) {
  if (/funda/i.test(p.nombre)) return 'Mi puerta';
  if (/organizador|soporte/i.test(p.nombre)) return 'Mi escritorio';
  return 'Mi casa';
}

function hookFor(id, p, o, x) {
  const precio = precioHablado(p);
  const P = precioTexto(p).toUpperCase();
  const oid = x.ocasionId;
  const lo = pron(p.g);
  switch (id) {
    case 'AD': return { hablado: `${espacio(p)} antes y después de ${precio || 'un detalle personalizado'}.`, texto: `ANTES Y DESPUÉS ${precio ? formatCOP(p.precio) : ''}`.trim(), fotograma: `El después: ${espacio(p).replace('Mi ', 'la ').replace('la casa', 'tu casa')} ya con ${art(p)} ${p.corto}` };
    case 'T1': return { hablado: `Esto salió así de la impresora: ${p.frase}.`, texto: p.pantalla, fotograma: `${cap(art(p))} ${p.corto} terminado en tu mano, a 20 cm del lente` };
    case 'T2': return { hablado: 'Escucha esto.', texto: 'SUBE EL VOLUMEN', fotograma: `Macro de la boquilla imprimiendo ${art(p)} ${p.corto}, con el sonido de los motores` };
    case 'T3': return precio
      ? { hablado: `${cap(p.frase)} por ${precio}.`, texto: `${p.pantalla} ${P}`, fotograma: `${cap(art(p))} ${p.corto} terminado junto al precio escrito a mano` }
      : { hablado: `¿Cuánto cuesta ${p.frase}? Te ${lo} cotizo gratis.`, texto: `${p.pantalla} · COTIZA GRATIS`, fotograma: `${cap(art(p))} ${p.corto} terminado en tu mano` };
    case 'T4': return { hablado: '¿Adivinas qué es antes de que termine?', texto: '¿QUÉ ES?', fotograma: 'Timelapse a media impresión, sin pistas de lo que es' };
    case 'T4b': return { hablado: 'Nadie adivina qué sale de aquí.', texto: 'NADIE ADIVINA', fotograma: 'Timelapse de las primeras capas, sin pistas' };
    case 'T4c': return { hablado: `Mira cómo nace ${p.frase}.`, texto: 'MIRA CÓMO NACE', fotograma: 'Timelapse: la primera capa sobre la placa' };
    case 'T5': return { hablado: DUDA[oid] || DUDA.general, texto: o.pantalla, fotograma: `Tú mirando a cámara con ${art(p)} ${p.corto} en la mano` };
    case 'T6': return oid === 'hogar'
      ? { hablado: 'Deja de decorar con lo mismo de siempre.', texto: 'DECORA CON ALGO TUYO', fotograma: `${cap(art(p))} ${p.corto} ya puesto en la casa` }
      : { hablado: `Deja de regalar lo mismo de siempre${oid === 'general' ? '' : ` para ${o.para}`}.`, texto: 'REGALA ALGO CON NOMBRE', fotograma: `Tú con ${art(p)} ${p.corto} en la mano, señalándolo` };
    case 'T7': {
      const min = Math.min(...(x.lista || []).map((i) => i.precio).filter((n) => n != null));
      const para = oid === 'general' ? 'con nombre' : `para ${o.para}`;
      return Number.isFinite(min)
        ? { hablado: `Tres regalos ${para} desde ${precioHablado({ precio: min })}.`, texto: `3 REGALOS DESDE ${formatCOP(min)}`, fotograma: 'Los 3 productos en la mesa, con tus manos' }
        : { hablado: `Tres regalos ${para} que puedes pedir hoy.`, texto: '3 REGALOS', fotograma: 'Los 3 productos en la mesa, con tus manos' };
    }
    case 'T7b': return { hablado: oid === 'general' ? 'Guarda esta lista de regalos con nombre.' : `Si te tocó ${o.para}, guarda esta lista.`, texto: 'GUARDA ESTA LISTA', fotograma: 'Los 3 productos en fila, el más barato adelante' };
    case 'T8': return { hablado: `Me escribieron por TikTok pidiendo ${p.frase}… y esto pasó.`, texto: 'UN PEDIDO REAL', fotograma: 'Tú en el taller con la impresora trabajando detrás' };
    case 'T9': return p.proceso === 'sublimacion'
      ? { hablado: `Así se hace ${p.frase}, paso a paso.`, texto: 'PASO A PASO', fotograma: `${cap(art(p))} ${p.corto} terminado y la plancha detrás` }
      : { hablado: `Así diseño ${p.frase} en un minuto.`, texto: 'EN 1 MINUTO', fotograma: 'Pantalla de Relieve3D o Bambu Studio con el diseño a medio hacer' };
    case 'T10': return {
      hablado: `${x.tendencia ? x.tendencia.replace(/[.…]+$/, '') : '[frase o momento del sonido en tendencia]'}… pero en impresión 3D.`,
      texto: x.tendencia ? recortar(x.tendencia.toUpperCase(), 40) : '[TEXTO DE LA TENDENCIA]',
      fotograma: `${cap(art(p))} ${p.corto} haciendo el momento de la tendencia`,
    };
    default: return hookFor('T1', p, o, x);
  }
}

const HOOK_LABEL = { AD: 'Antes / después', T4b: 'Bucle abierto (variante)', T4c: 'Mira cómo nace', T7b: 'Lista para guardar' };

function hookVariants(formato, formula, pilar, p, o, x) {
  let ids;
  if (formato === 'F3') ids = ['T4', 'T4b', 'T4c'];
  else if (formato === 'F4') ids = ['T7', 'T5', 'T7b'];
  else if (formato === 'F5') ids = ['AD', ...(formula === 'T10' ? ['T10'] : []), 'T5', 'T6'];
  else {
    const pil = PILARES.find((q) => q.id === pilar)?.formulas || [];
    ids = uniq([formula, 'T5', 'T3', ...pil, 'T1', 'T6']).filter((f) => !['T4', 'T7'].includes(f) && (f === formula || !['T2', 'T10'].includes(f)));
  }
  if (formato === 'F3' && formula !== 'T4' && FORMULAS[formula]) ids = uniq([formula, ...ids]);
  return ids.slice(0, 3).map((id) => ({ formula: id, etiqueta: HOOK_LABEL[id] || `${id} · ${FORMULAS[id]?.nombre || ''}`, ...hookFor(id, p, o, x) }));
}

function esc(tipo, archivo, visual, voz, texto, sonido, modo = {}) {
  return { tipo, archivo, visual, voz, texto, sonido, ...modo };
}

export function preciosDesconocidos(ctx, texto) {
  const conocidos = new Set(ctx.catalogo.map((p) => p.precio).filter((n) => n != null));
  const out = [];
  for (const m of String(texto || '').matchAll(/\$\s?(\d{1,3}(?:\.\d{3})+|\d{4,})/g)) {
    const n = Number(m[1].replace(/\./g, ''));
    if (!conocidos.has(n)) out.push(m[0]);
  }
  for (const m of String(texto || '').matchAll(/\b(\d{1,3})\s*mil\b/gi)) {
    if (!conocidos.has(+m[1] * 1000)) out.push(m[0]);
  }
  return uniq(out);
}

export function revisarTexto(ctx, texto) {
  const avisos = [];
  const t = String(texto || '').toLowerCase();
  for (const f of [...(ctx.voz.prohibidas || []), 'sígueme para más']) {
    if (f && t.includes(f.toLowerCase())) avisos.push(`Frase prohibida por tu voz de marca: "${f}"`);
  }
  for (const marca of ['grinch', 'disney', 'marvel', 'stitch', 'pokémon', 'pokemon', 'mickey']) {
    if (t.includes(marca)) avisos.push(`Personaje con marca registrada ("${marca}"): no se usa en productos a la venta`);
  }
  if (/\bvela(s)?\b/.test(t) && !/\bled\b/.test(t)) avisos.push('Si salen velas: solo velas LED cerca de piezas impresas (el PLA se deforma con el calor)');
  const p = preciosDesconocidos(ctx, texto);
  if (p.length) avisos.push(`Precio que no está en el catálogo: ${p.join(', ')}. Usa solo los de perfil-cuenta.md §3 o "cotiza gratis"`);
  return avisos;
}

export function draftVideo(input = {}, ctx) {
  const p = findProduct(ctx, input.producto);
  if (!p) throw new Error('No hay productos en el catálogo (estrategia/perfil-cuenta.md §3)');
  const ocasionId = OCASIONES[input.ocasion] ? input.ocasion : 'general';
  const o = OCASIONES[ocasionId];
  const objetivo = OBJETIVOS[input.objetivo] ? input.objetivo : 'comentarios';
  const cta = OBJETIVOS[objetivo];
  const formula = FORMULAS[input.formula] ? input.formula : 'T1';
  const sub = p.proceso === 'sublimacion';
  const avisos = [];
  let formato = FORMULAS[formula].formato || p.formato || (FORMATOS[input.formato] ? input.formato : 'F1');
  if (sub && formato === 'F3') { formato = 'F5'; avisos.push('La sublimación no tiene timelapse: se usa el formato antes/después (F5)'); }
  const pilar = PILARES.some((x) => x.id === input.pilar) ? input.pilar : (formato === 'F3' ? 'mira-como' : FORMULAS[formula].pilar);
  const ciudad = ctx.perfil.ciudad;
  const taller = `nuestro taller${ciudad ? ` de ${ciudad}` : ''}`;
  const lo = pron(p.g);
  const Lo = cap(lo);

  let lista = [];
  if (formato === 'F4') {
    const elegidos = (input.lista || []).map((id) => findProduct(ctx, id)).filter(Boolean);
    const resto = ctx.catalogo.filter((x) => x.precio != null && x.id !== p.id && !elegidos.some((e) => e.id === x.id)).sort((a, b) => a.precio - b.precio);
    lista = uniq([p, ...elegidos, ...resto]).slice(0, 3);
  }
  const x = { ocasionId, lista, tendencia: sinPipe(input.tendencia || '') };
  const hooks = hookVariants(formato, formula, pilar, p, o, x);
  const hookIndex = Math.min(Math.max(+input.hook || 0, 0), hooks.length - 1);
  const hook = hooks[hookIndex];

  const precio = precioHablado(p);
  const pantallaPrecio = p.precio != null ? `${p.pantalla} ${precioTexto(p).toUpperCase()}` : `${p.pantalla} · COTIZA GRATIS`;
  const lineaPrecio = precio ? `${cap(p.corto)}: ${precio}.` : `${cap(p.corto)}: te ${lo} cotizo gratis.`;
  const envio = `${Lo} enviamos a toda Colombia.`;
  const ctaVoz = cta.voz(o);
  const ctaVisual = objetivo === 'comentarios' ? 'Tú señalando hacia abajo (a los comentarios), sonriendo' : objetivo === 'dms' ? 'Tú mostrando el celular con el chat abierto' : 'Tú con el producto en la mano, sonriendo a cámara';
  const disenoVoz = ['keychain', 'sign', 'pencil'].includes(p.modulo) ? 'Así: escribo el nombre y elijo los colores.'
    : ['mic', 'logo'].includes(p.modulo) ? 'Así: pongo tu logo y te muestro el diseño antes de fabricar.'
      : 'Primero te muestro el diseño antes de fabricar.';
  const disenoDonde = p.modulo ? `Relieve3D (módulo ${MODULOS_R3D[p.modulo]})` : 'Bambu Studio';

  let escenas;
  if (formato === 'F3') {
    escenas = [
      esc('TIMELAPSE', 'clips/timelapse.mp4', `Timelapse Bambu de ${art(p)} ${p.corto}, sin pistas`, hook.hablado, hook.texto, 'riser', { velocidad: 'auto' }),
      esc('B-ROLL', 'clips/despegar.mp4', `Macro: doblas la placa y sale ${art(p)} ${p.corto} (que se oiga el crack)`, 'Ya casi… mira cómo sale de la placa.', '', 'clip', { audio_original: true }),
      esc('CARA', 'clips/cara.mp4', `Revelación: tú mostrando ${art(p)} ${p.corto} terminado a cámara`, `¡Es ${p.frase}! ${precio ? `Cuesta ${precio}.` : `Te ${lo} cotizo gratis.`} ${o.clave}`, pantallaPrecio, 'ding'),
      esc('CARA', 'clips/cara.mp4', ctaVisual, `${envio} ${ctaVoz}`, cta.texto(o), 'pop'),
    ];
  } else if (formato === 'F4') {
    const nums = ['Uno', 'Dos', 'Tres'];
    escenas = [
      esc('CARA', 'clips/cara.mp4', hook.fotograma, hook.hablado, hook.texto, 'pop'),
      ...lista.map((it, i) => esc('B-ROLL', `clips/p${i + 1}-${slug(it.corto).slice(0, 20)}.mp4`, `Primer plano: ${art(it)} ${it.corto} en tu mano, girándolo`,
        `${nums[i]}: ${it.frase}, ${precioHablado(it) || 'cotiza gratis'}.`, `${it.pantalla} ${precioTexto(it).toUpperCase()}`, i === 1 ? 'click' : 'pop')),
      esc('CARA', 'clips/cara.mp4', ctaVisual, `${o.clave} Los enviamos a toda Colombia. ${ctaVoz}`, cta.texto(o), 'ding'),
    ];
  } else if (formato === 'F5') {
    escenas = [
      esc('B-ROLL', 'clips/despues.mp4', `Después (resultado primero, 1-2 s): ${hook.fotograma}`, hook.hablado, hook.texto, 'whoosh'),
      esc('B-ROLL', 'clips/antes.mp4', 'Antes: mismo encuadre exacto, sin nada (celular en trípode, no lo muevas)', 'Así estaba antes…', 'ANTES', ''),
      esc('B-ROLL', 'clips/poniendo.mp4', `Tú poniendo ${art(p)} ${p.corto} (en cámara rápida)`, sub ? `${Lo} sublimamos con el diseño que elijas y se pone en un minuto.` : `${Lo} fabricamos en ${taller} y se pone en un minuto.`, '', 'clip', { audio_original: true }),
      esc('CARA', 'clips/cara.mp4', `Tú junto al resultado, mostrando ${art(p)} ${p.corto}`, `${lineaPrecio} ${o.clave}`, pantallaPrecio, 'ding'),
      esc('CARA', 'clips/cara.mp4', ctaVisual, `${envio} ${ctaVoz}`, cta.texto(o), 'pop'),
    ];
  } else {
    escenas = [
      esc('CARA', 'clips/cara.mp4', hook.fotograma, hook.hablado, hook.texto, 'pop', { sincronizar: true }),
      esc('B-ROLL', 'clips/diseno.mp4', `Grabación de pantalla: diseñas ${art(p)} ${p.corto} en ${disenoDonde} y eliges colores`, disenoVoz, '', 'whoosh'),
      esc('TIMELAPSE', 'clips/timelapse.mp4', `Timelapse Bambu: ${art(p)} ${p.corto} creciendo capa por capa`, `La impresora ${lo} construye capa por capa…`, 'CAPA POR CAPA', '', { velocidad: 'auto' }),
      esc('B-ROLL', 'clips/despegar.mp4', `Macro: doblas la placa y sale ${art(p)} ${p.corto} (que se oiga el crack)`, `…y sale así, hecho a mano en ${taller}.`, '', 'clip', { audio_original: true }),
      esc('CARA', 'clips/cara.mp4', `Tú mostrando ${art(p)} ${p.corto} terminado, cerca del lente`, `${lineaPrecio} ${o.clave}`, pantallaPrecio, 'ding'),
      esc('CARA', 'clips/cara.mp4', ctaVisual, `${envio} ${ctaVoz}`, cta.texto(o), 'pop'),
    ];
  }
  for (const e of escenas) if (e.tipo === 'CARA') e.sincronizar = true;

  // ediciones del usuario (mismo número de escenas: un bloque de voz por escena)
  (input.escenas || []).forEach((ov, i) => {
    if (!ov || !escenas[i]) return;
    for (const k of ['voz', 'texto', 'visual']) if (typeof ov[k] === 'string') escenas[i][k] = ov[k];
  });
  for (const e of escenas) { e.voz = sinPipe(e.voz); e.texto = sinPipe(e.texto); e.visual = sinPipe(e.visual); }

  const emoji = enCampana(ctx, input.fechaPlan || ctx.today) ? ' 🎄' : '';
  const kw = formato === 'F4'
    ? `3 regalos ${ocasionId === 'general' ? 'con nombre' : `para ${o.para}`}${Number.isFinite(Math.min(...lista.map((i) => i.precio ?? Infinity))) ? ` desde ${formatCOP(Math.min(...lista.map((i) => i.precio ?? Infinity)))}` : ''}`
    : p.precio != null ? `${p.keyword} ${p.desde ? '' : 'por '}${precioTexto(p)}` : `${p.keyword}: cotiza gratis`;
  const pl = formato === 'F4' ? 'los' : lo;
  const contexto = sub
    ? `${cap(pl)} sublimamos con el diseño que elijas en ${taller}. Envíos a toda Colombia.`
    : `${cap(pl)} diseñamos, te mostramos cómo ${pl === 'los' || pl === 'las' ? 'quedan' : 'queda'} y ${pl} fabricamos en ${taller}. Envíos a toda Colombia.`;
  const hashtags = pickHashtags(ctx, o, p, formato);
  const caption = [`${kw}${emoji}`, contexto, cta.caption(o) + (objetivo === 'dms' && ctx.perfil.links.cotizar ? ` · ${ctx.perfil.links.cotizar}` : ''), hashtags.join(' ')].join('\n');
  const sinPrecio = formato !== 'F4' && p.precio == null;
  const lineaLista = formato === 'F4' ? lista.map((i) => `${cap(i.corto)} ${precioTexto(i)}`).join(' · ') : sinPrecio ? p.keyword : `${p.keyword}: ${precioTexto(p)}`;
  const contacto = [ctx.perfil.links.cotizar ? `cotiza${sinPrecio ? ' gratis' : ''} en ${ctx.perfil.links.cotizar}` : '', ctx.perfil.whatsapp ? `escríbenos al WhatsApp ${ctx.perfil.whatsapp}` : ''].filter(Boolean).join(' o ');
  const comentarioFijado = `${lineaLista}. ${contacto ? cap(contacto) + '. ' : ''}Envíos a toda Colombia${emoji}`;
  const textoVoz = escenas.map((e) => e.voz).join(' | ');
  const duracion = Math.max(7, Math.round(escenas.reduce((s, e) => s + words(e.voz) / 2.5, 0) + 1));
  const titulo = sinPipe(input.titulo || hook.hablado.replace(/[.…!]+$/, '')).slice(0, 80);

  if (p.precio == null) avisos.push(`"${p.nombre}" no tiene precio publicado: el guion dice "cotiza gratis". Si quieres un precio, agrégalo primero a estrategia/perfil-cuenta.md §3`);
  if (formula === 'T10' && !x.tendencia) avisos.push('Tendencia: escribe la frase o momento del sonido (o completa los [ ] antes de grabar)');
  if (formula === 'T8') avisos.push('Historia en medio: cuenta solo algo que pasó de verdad (nada inventado)');
  if (escenas.some((e) => /\[[^\]]+\]/.test(e.voz + e.texto))) avisos.push('Hay marcas [ ] por completar en la voz o el texto en pantalla');
  avisos.push(...revisarTexto(ctx, escenas.map((e) => `${e.voz} ${e.texto}`).join(' ')));

  return {
    titulo, pilar, formula, formato, objetivo, ocasion: ocasionId, producto: p, lista,
    hooks, hookIndex, hook: { ...hook, hablado: escenas[0].voz, texto: escenas[0].texto },
    escenas, textoVoz, teleprompter: escenas.map((e) => e.voz),
    caption, hashtags, portada: escenas[0].texto && !/\[/.test(escenas[0].texto) ? escenas[0].texto : p.pantalla,
    comentarioFijado, duracion, fechaPlan: input.fechaPlan || '',
    idea: `${cap(formato === 'F4' ? lineaLista : p.frase + ' (' + precioTexto(p) + ')')} · ${o.nombre.toLowerCase()} · ${FORMATOS[formato]} · objetivo: ${cta.nombre.toLowerCase()}`,
    tomas: buildTomas(escenas, p, objetivo, disenoDonde),
    notas: buildNotas(p, o, ocasionId, objetivo, formato),
    avisos: uniq(avisos),
  };
}

function enCampana(ctx, iso) {
  const f = ctx.campana.fases;
  if (!f.length || !f[0].desde) return false;
  const d = String(iso || '').slice(0, 10);
  return d >= f[0].desde && d <= f[f.length - 1].hasta;
}

function pickHashtags(ctx, o, p, formato) {
  const set = ctx.hashtags[o.set]?.tags || DEFAULT_SETS[o.set] || DEFAULT_SETS.N1;
  const proc = formato === 'F3' ? (ctx.hashtags.N3?.tags || DEFAULT_SETS.N3) : [];
  const prod = p.modulo === 'keychain' ? ['#llaveropersonalizado'] : [];
  const all = uniq([...(o.extra || []), ...set, ...proc.slice(0, 2), ...prod])
    .filter((t) => t !== '#pabonitas' && (p.modulo === 'keychain' || !/llavero/i.test(t)));
  return [...all.slice(0, 4), '#pabonitas'];
}

function buildTomas(escenas, p, objetivo, disenoDonde) {
  const out = [];
  const caras = escenas.map((e, i) => (e.archivo === 'clips/cara.mp4' ? i + 1 : 0)).filter(Boolean);
  if (caras.length) out.push({ archivo: 'clips/cara.mp4', desc: `**toma continua a cámara** leyendo el texto de la sección 3 completo (se usa en las escenas ${caras.join(', ')}; en el resto suena tu voz sobre el b-roll). Vertical, ojos al lente, luz de frente, micrófono de solapa si tienes` });
  escenas.forEach((e, i) => {
    if (e.archivo === 'clips/cara.mp4' || out.some((t) => t.archivo === e.archivo)) return;
    if (e.tipo === 'TIMELAPSE') out.push({ archivo: e.archivo, desc: `timelapse de Bambu (Studio/Handy → descargar). Escena ${i + 1}; se acelera solo para caber en su escena (\`velocidad: auto\`)` });
    else out.push({ archivo: e.archivo, desc: `${e.visual} (escena ${i + 1}, 3-5 s)${e.audio_original ? ' · con sonido ambiente (déjalo grabar 2 s más)' : ''}` });
  });
  return out;
}

function buildNotas(p, o, ocasionId, objetivo, formato) {
  const n = [];
  if (objetivo === 'comentarios' && p.modulo === 'keychain') n.push('Ten listos 3 llaveros: el de tu nombre y dos nombres comunes (por ejemplo María y Andrés).');
  if (formato === 'F1' || formato === 'F3') n.push(`\`diseno.mp4\`: graba la pantalla con Win + Alt + R (Xbox Game Bar) o con el celular vertical apuntando al monitor.`);
  if (formato === 'F5') n.push('Antes y después con el celular en el mismo sitio (trípode o marca en el piso con cinta).');
  if (['hogar', 'novena'].includes(ocasionId)) n.push('Si salen velas: solo velas LED cerca de piezas impresas.');
  n.push('Nada de personajes con marca (Grinch, Disney, Marvel…) en productos a la venta. Diseños de MakerWorld solo con licencia comercial (CC0 / CC BY / CC BY-SA).');
  return n;
}

// ------------------------------------------------------------------ archivos del video

const md = (s) => String(s ?? '').replace(/\|/g, '\\|');

export function renderGuion(d, { id = 'V000', fecha = '', carpeta = '' } = {}) {
  const sfx = (e) => (e.sonido === 'clip' ? 'sonido del clip' : e.sonido || '·');
  const tipoArchivo = (e) => `**${e.tipo}** \`${e.archivo}\`: ${md(e.visual)}`;
  const win = carpeta.replace(/\//g, '\\');
  const hora = d.fechaPlan ? fechaHumana(d.fechaPlan) : '[elige fecha y hora]';
  const L = [];
  L.push('---', `id: ${id}`, `titulo: "${d.titulo.replace(/"/g, "'")}"`,
    'estado: guion            # idea | guion | grabado | editado | listo | publicado | medido',
    `pilar: ${d.pilar}        # mira-como | util | ensena | historia | tendencia-promo`,
    `formula: ${d.formula}    # T1..T10 (ver skills/tiktok-3d-studio/references/nicho-impresion-3d.md)`,
    `objetivo: ${d.objetivo}`, `duracion_objetivo_s: ${d.duracion}`, `fecha_creado: ${fecha}`,
    `fecha_plan: ${d.fechaPlan || ''}`, 'fecha_publicado:', 'url:', 'campana: navidad-2026', 'idea:',
    `formato: ${d.formato}`, `producto: ${d.producto.nombre}`, `ocasion: ${d.ocasion}`, 'generado_por: Relieve3D · Estudio TikTok', '---', '');
  L.push(`# ${id} · ${d.titulo}`, '');
  L.push(`> Campaña de Navidad 2026 (\`estrategia/campana-navidad-2026.md\`) · Publicación: **${hora}**`);
  L.push(`> Con **tu cara y tu voz**. La voz IA del animatic (\`salida/${id}-animatic.mp4\`) es solo una guía de ritmo.`);
  L.push('> Kit paso a paso (dónde hacer cada cosa y qué copiar): Relieve3D → Estudio TikTok → Kit del video, o `kit.md` en esta carpeta.', '');
  L.push('## 1. Idea en una frase', `> ${d.idea}`, '');
  L.push('## 2. Hook (0-3 s): las 3 capas disparan a la vez', '| Capa | Contenido |', '|---|---|',
    `| Frase hablada | "${md(d.hook.hablado)}" |`, `| Texto en pantalla | ${md(d.hook.texto)} |`, `| Primer fotograma | ${md(d.hooks[d.hookIndex]?.fotograma || '')} |`, '');
  const alt = d.hooks.filter((_, i) => i !== d.hookIndex);
  if (alt.length) L.push('Hooks alternativos (para una variación o una parte 2):', ...alt.map((h) => `- "${h.hablado}" · ${h.texto}`), '');
  L.push('## 3. Texto para decir a cámara (teleprompter)',
    '> Léelo **de corrido en una sola toma** mirando al lente (teleprompter de CapCut o similar), con energía y sonriendo.',
    '> Si te equivocas, haz una pausa de 2 s y repite la frase entera. Puedes improvisar: los subtítulos salen de lo que digas.',
    '> Cada número es un bloque = una escena. Está igual en `video.json → voz.texto`, separado con `|`.', '');
  d.escenas.forEach((e, i) => L.push(`${i + 1}. ${e.voz}`));
  L.push('', '## 4. Guion por escenas', '| Escena | Visual / toma (archivo) | Voz (bloque) | Texto en pantalla | Sonido |', '|---|---|---|---|---|');
  d.escenas.forEach((e, i) => L.push(`| ${i + 1} | ${tipoArchivo(e)} | ${md(e.voz)} | ${md(e.texto) || '·'} | ${sfx(e)} |`));
  L.push('', '## 5. Lista de tomas (sesión de grabación)');
  d.tomas.forEach((t) => L.push(`- [ ] \`${t.archivo}\`: ${t.desc}`));
  d.notas.forEach((n) => L.push(`- Nota: ${n}`));
  L.push('', '## 6. Montaje', '1. Guarda los clips en `clips/` **con estos nombres exactos**. Lo que aún no exista sale como tarjeta guía.',
    `2. \`python herramientas\\tiktok3d.py voz ${win}\` → transcribe tu voz y muestra dónde empieza cada escena.`,
    `3. \`python herramientas\\tiktok3d.py video ${win}\` → \`salida\\${id}-final.mp4\` (o \`-animatic\` con la lista de lo que falta).`,
    `4. \`python herramientas\\tiktok3d.py revisar ${win}\\salida\\${id}-final.mp4\` y mira los fotogramas.`,
    '   (Los tres botones están en Relieve3D → Estudio TikTok → Kit del video → Montar.)', '');
  L.push('## 7. Audio', '- Voz: **la tuya** (`clips/cara.mp4`). Efectos de `audio/sfx` ya puestos por escena en `video.json`.',
    '- Música dentro del archivo: ninguna. Añade un sonido en tendencia **en la app** al publicar (10-15 % bajo la voz).', '');
  L.push('## 8. Publicación', 'Caption:', '```', d.caption, '```', `- Portada (texto): **${d.portada}**`,
    `- Comentario para fijar: ${d.comentarioFijado}`,
    '- Ajustes: público · comentarios ON · dúo/stitch ON · "Tu marca" ON · contenido IA: no (tu cara y tu voz)', `- Hora: **${hora}**`, '');
  L.push('## 9. Notas y reglas de este video');
  if (d.objetivo === 'comentarios') L.push('- **Serie de respuestas (formato F2):** responde 1-2 comentarios al día **con video** (Responder → video, 10-15 s) enseñando el nombre en pantalla.');
  if (d.objetivo === 'dms') L.push('- Cuando escriban, responde con la respuesta rápida PRECIOS o CÓMO PEDIR (campaña §6) y anota la consulta en `registro/pedidos-tiktok.csv`.');
  d.avisos.forEach((a) => L.push(`- ⚠️ ${a}`));
  L.push('- Si alguien lo quiere de verdad, pasa al DM con la respuesta rápida PRECIOS (campaña §6) y anótalo en `registro/pedidos-tiktok.csv`.', '');
  L.push('## 10. Resultados (`registro/metricas.csv` a las 24 h, 72 h y 7 d · consultas en `registro/pedidos-tiktok.csv`)', '- Aprendizaje (1 línea, pásalo a `aprendizajes/aprendizajes.md`):', '');
  return L.join('\n');
}

export function renderVideoJson(d, { id = 'V000' } = {}) {
  return {
    id, titulo: d.titulo, fps: 30, ajuste: 'rellenar',
    voz: { texto: d.escenas.map((e) => e.voz).join(' | '), archivo: 'clips/cara.mp4', voz: 'es-CO-GonzaloNeural', velocidad: '+8%', tono: '+0Hz', volumen: 1.0 },
    subtitulos: { activar: true, palabras_por_linea: 3, mayusculas: false },
    textos: d.escenas.map((e, i) => (e.texto ? { texto: e.texto, escena: i + 1, posicion: 'arriba' } : null)).filter(Boolean),
    musica: { archivo: '', volumen: 0.12, atenuar_con_voz: true },
    ambiente_volumen: 0.6,
    efectos: d.escenas.map((e, i) => (SFX.includes(e.sonido) ? { archivo: `audio/sfx/${e.sonido}.wav`, escena: i + 1, en: 0.0, volumen: VOL[e.sonido] } : null)).filter(Boolean),
    escenas: d.escenas.map((e) => {
      const s = { archivo: e.archivo };
      if (e.sincronizar) s.sincronizar = true;
      if (e.velocidad) s.velocidad = e.velocidad;
      if (e.audio_original) s.audio_original = true;
      s.color = COLORES[e.tipo] || COLORES['B-ROLL'];
      s.texto = recortar(`${e.tipo}: ${e.visual}`, 80);
      return s;
    }),
  };
}

// ------------------------------------------------------------------ kit paso a paso

export function productOfVideo(ctx, v) {
  const g = v.guion || { meta: {} };
  const porNombre = g.meta?.producto && ctx.catalogo.find((p) => p.nombre === g.meta.producto);
  if (porNombre) return porNombre;
  const texto = [v.titulo, g.titulo, g.caption, g.meta?.idea, (g.teleprompter || []).join(' '), v.spec?.voz?.texto].join(' ');
  return detectProduct(ctx, texto);
}

export function bloquesDeVoz(v) {
  const t = v.spec?.voz?.texto;
  if (t) return t.split('|').map((s) => s.trim()).filter(Boolean);
  return v.guion?.teleprompter || [];
}

const step = (id, titulo, o = {}) => ({ id, titulo, donde: '', que: '', copiar: '', accion: null, estado: 'info', ...o });

export function buildKit(v, ctx) {
  const g = v.guion || { meta: {}, hook: {}, teleprompter: [], escenas: [], tomas: [], notas: [] };
  const id = v.id;
  const carpeta = v.carpeta || '';
  const win = carpeta.replace(/\//g, '\\');
  const abs = ctx.root ? `${ctx.root.replace(/[\\/]+$/, '')}\\${win}` : win;
  const clips = new Set(v.clips || []);
  const has = (a) => clips.has(String(a).replace(/^clips\//, ''));
  const p = productOfVideo(ctx, v);
  const lo = p ? pron(p.g) : 'lo';
  const bloques = bloquesDeVoz(v);
  const specEsc = v.spec?.escenas || [];
  let tomas = (g.tomas || []).filter((t) => t.archivo);
  if (!tomas.length) tomas = uniq(specEsc.map((e) => e.archivo)).map((a) => ({ archivo: a, desc: specEsc.find((e) => e.archivo === a)?.texto || '' }));
  const tieneTimelapse = specEsc.some((e) => /timelapse/i.test(e.archivo)) || tomas.some((t) => /timelapse/i.test(t.archivo));
  const final = `${id}-final.mp4`;
  const animatic = `${id}-animatic.mp4`;
  const salida = new Set(v.salida || []);
  const video = salida.has(final) ? final : salida.has(animatic) ? animatic : '';
  const publicado = ['publicado', 'medido'].includes(v.estado);
  const hora = g.hora || (v.fecha_plan ? fechaHumana(v.fecha_plan) : '');
  const sub = p?.proceso === 'sublimacion';
  const fases = [];

  fases.push({ id: 'preparar', titulo: '1 · Preparar (taller)', pasos: [
    sub
      ? step('prep-diseno', 'Sublima la pieza del video', { donde: 'Plancha de sublimación del taller', que: 'Prepara la funda con el diseño elegido (Santa, Reno, Nacimiento, Merry Christmas…). Sin personajes con marca registrada.' })
      : step('prep-diseno', p?.modulo ? `Diseña ${art(p)} ${p.corto} en Relieve3D` : 'Diseña o elige la pieza', {
        donde: p?.modulo ? `Relieve3D → ${MODULOS_R3D[p.modulo]} → exporta el 3MF → ábrelo en Bambu Studio` : 'Bambu Studio (o MakerWorld, solo con licencia comercial: CC0 / CC BY / CC BY-SA)',
        que: 'Prepara la pieza que sale en el video. Si es la serie de nombres, haz también 2 variantes con nombres comunes.',
        accion: p?.modulo ? { tipo: 'module', id: p.modulo, label: `Abrir ${MODULOS_R3D[p.modulo]}` } : null,
      }),
    ...(tieneTimelapse ? [step('prep-timelapse', 'Imprime con el timelapse activado', {
      donde: 'Bambu Studio → Imprimir placa → en la ventana de envío marca «Timelapse» · o Bambu Handy → Imprimir → Timelapse',
      que: 'Actívalo ANTES de enviar la impresión. Si tu impresora lo ofrece, usa el modo suave (añade la torre de purga).',
      estado: has('clips/timelapse.mp4') ? 'ok' : 'pendiente',
    })] : []),
    ...(g.notas?.length ? [step('prep-notas', 'Ten listo antes de grabar', { que: g.notas.join('\n') })] : []),
  ] });

  const grabar = [step('grab-tele', 'Lee el texto en una sola toma (teleprompter)', {
    donde: 'CapCut → Cámara → Teleprompter (o la app gratis «Teleprompter») · celular vertical a la altura de los ojos',
    que: `Pega este texto, velocidad media. Graba \`cara.mp4\` de corrido mirando al lente. Si te equivocas, pausa 2 s y repite la frase. (${bloques.length} bloques = ${bloques.length} escenas)`,
    copiar: bloques.join('\n'),
    estado: has('clips/cara.mp4') ? 'ok' : 'pendiente',
  })];
  for (const t of tomas.filter((t) => t.archivo !== 'clips/cara.mp4')) {
    const nombre = t.archivo.replace(/^clips\//, '');
    const donde = /timelapse/i.test(nombre) ? 'Bambu Handy → Impresora → Timelapse → descargar · o Bambu Studio → Dispositivo → Timelapse · o la microSD de la impresora'
      : /diseno|pantalla/i.test(nombre) ? 'PC: Win + Alt + R (Xbox Game Bar) graba la pantalla · o el celular vertical apuntando al monitor'
        : 'Celular vertical (cámara normal, 1080p, 30 fps), luz de frente';
    grabar.push(step(`grab-${slug(nombre)}`, `Graba ${nombre}`, { donde, que: t.desc, estado: has(t.archivo) ? 'ok' : 'pendiente' }));
  }
  grabar.push(step('grab-tips', 'Antes de cada toma', { que: 'Vertical 9:16 · luz de frente (ventana o aro) · limpia el lente · modo avión · graba 2 s antes y después de cada toma.' }));
  fases.push({ id: 'grabar', titulo: '2 · Grabar (celular)', pasos: grabar });

  const faltan = tomas.filter((t) => !has(t.archivo)).map((t) => t.archivo.replace(/^clips\//, ''));
  fases.push({ id: 'pasar', titulo: '3 · Pasar los clips al PC', pasos: [step('pasar-copiar', 'Copia los clips con los nombres exactos', {
    donde: 'Cable USB (Explorador de Windows → tu celular → DCIM) o Google Drive. Nunca por WhatsApp: comprime el video.',
    que: `Nombres exactos: ${tomas.map((t) => t.archivo.replace(/^clips\//, '')).join(', ')}. Activa «Vista → Mostrar → Extensiones de nombre de archivo» antes de renombrar. Si el timelapse es .avi, solo cámbiale la extensión a .mp4.${faltan.length ? `\nFaltan: ${faltan.join(', ')}` : '\nEstán todos.'}`,
    copiar: `${abs}\\clips`,
    accion: { tipo: 'open', ruta: `${carpeta}/clips`, label: 'Abrir carpeta clips' },
    estado: faltan.length ? 'pendiente' : 'ok',
  })] });

  fases.push({ id: 'montar', titulo: '4 · Montar (Relieve3D lo hace por ti)', pasos: [
    step('montar-voz', 'Transcribe tu voz (o crea la voz guía si aún no grabas)', {
      donde: 'Botón de aquí · o terminal en la carpeta TikTok-Impresion3D', copiar: `python herramientas\\tiktok3d.py voz ${win}`,
      que: 'Con clips/cara.mp4: transcribe tu voz y marca dónde empieza cada escena. Sin él: genera la voz guía (necesita internet).',
      accion: { tipo: 'run', args: ['voz', carpeta], label: 'Ejecutar voz' }, estado: v.transcripcion ? 'ok' : v.vozGuia ? 'parcial' : 'pendiente',
    }),
    step('montar-video', 'Renderiza el video 1080×1920', {
      donde: 'Botón de aquí · o terminal', copiar: `python herramientas\\tiktok3d.py video ${win}`,
      que: 'Si falta algún clip sale el animatic con tarjetas guía (sirve para ensayar el ritmo); con todos los clips sale el final.',
      accion: { tipo: 'run', args: ['video', carpeta], label: 'Renderizar' }, estado: salida.has(final) ? 'ok' : salida.has(animatic) ? 'parcial' : 'pendiente',
    }),
    step('montar-revisar', 'Revisa formato y fotogramas', {
      donde: 'Botón de aquí', que: 'Valida 1080×1920, duración y audio, y saca fotogramas de revisión.',
      accion: video ? { tipo: 'run', args: ['revisar', `${carpeta}/salida/${video}`], label: 'Revisar' } : null,
    }),
    step('montar-abrir', 'Míralo completo en el PC', { que: video ? `salida\\${video}` : 'Todavía no hay video renderizado.', accion: video ? { tipo: 'open', ruta: `${carpeta}/salida/${video}`, label: 'Abrir video' } : null }),
    step('montar-capcut', 'Retoques (opcional)', { donde: 'CapCut (PC o celular)', que: 'Solo si quieres ajustar algo: importa el final y exporta en 1080p. NO le pongas música: el sonido va en TikTok.' }),
  ] });

  const comentario = g.meta?.comentario || (v.guionMd || '').match(/^- Comentario para fijar:\s*(.+)$/m)?.[1]
    || (p ? `${p.keyword}: ${precioTexto(p)}.${ctx.perfil.links.cotizar ? ` Cotiza en ${ctx.perfil.links.cotizar}` : ''}${ctx.perfil.whatsapp ? ` o escríbenos al WhatsApp ${ctx.perfil.whatsapp}` : ''}. Envíos a toda Colombia` : '');
  fases.push({ id: 'publicar', titulo: '5 · Publicar (TikTok)', pasos: [
    step('pub-sonido', 'Elige un sonido en tendencia', {
      donde: 'TikTok Creative Center → Música → país Colombia (no pide iniciar sesión). Si tu cuenta es de empresa, filtra «Aprobado para uso comercial».',
      que: 'Guárdalo en favoritos en la app. Al publicar: Sonidos → Favoritos → volumen del sonido 10-15 %, sonido original 100 %.',
      accion: { tipo: 'url', url: ENLACES.creativeCenter, label: 'Abrir Creative Center' },
    }),
    step('pub-subir', 'Sube el video', {
      donde: 'App de TikTok → + → Subir (pasa el mp4 al celular por cable o Drive) · o TikTok Studio en el PC',
      que: video ? `Archivo: salida\\${video}${video === animatic ? ' (OJO: es el animatic; publica solo el final)' : ''}` : 'Primero renderiza el video (paso 4).',
      copiar: video ? `${abs}\\salida\\${video}` : '', accion: { tipo: 'url', url: ENLACES.studioUpload, label: 'Abrir TikTok Studio' },
      estado: publicado ? 'ok' : salida.has(final) ? 'pendiente' : 'espera',
    }),
    step('pub-caption', 'Pega el caption', { donde: 'Descripción del post', copiar: g.caption, que: g.caption ? '' : 'Este guion no tiene caption en la sección de Publicación.' }),
    step('pub-portada', 'Portada', { donde: 'Editar portada → elige el fotograma del producto terminado → Texto', copiar: g.portada, que: 'Texto grande y centrado, que se lea en miniatura. Prompt para el fondo en la pestaña Prompts IA.' }),
    step('pub-ajustes', 'Ajustes antes de publicar', { donde: 'Más opciones al publicar', que: `${g.ajustes || 'público · comentarios ON · dúo/stitch ON'}\nDivulgación de contenido → «Tu marca» (promocionas tu propio negocio) · Contenido generado por IA: no (tu cara y tu voz).` }),
    step('pub-hora', `Publica o programa${hora ? `: ${hora}` : ''}`, { donde: 'TikTok Studio (web) → Programar (de 15 min a 10 días antes) · o publica a esa hora desde la app', copiar: hora, accion: { tipo: 'url', url: ENLACES.studioUpload, label: 'Programar en TikTok Studio' } }),
    step('pub-fijar', 'Comenta y fija el comentario', { donde: 'En tu video publicado: comenta → mantén presionado tu comentario → Fijar', copiar: comentario }),
    step('pub-marcar', 'Marca el video como publicado', { que: 'Pega la URL del video (Compartir → Copiar enlace). Queda en el registro y en el panel.', accion: { tipo: 'form', form: 'publicar', label: 'Marcar publicado' }, estado: publicado ? 'ok' : 'pendiente' }),
  ] });

  const precio = p ? precioHablado(p) : null;
  fases.push({ id: 'responder', titulo: '6 · Primera hora: responder', pasos: [
    step('resp-video', 'Responde comentarios con video', {
      donde: 'App → toca el comentario → icono de cámara roja (Responder con video), 10-15 s',
      copiar: `¡Aquí está el tuyo, [NOMBRE]! [muestra la pieza con su nombre]${p ? ` ${cap(p.corto)}: ${precio || `te ${lo} cotizo gratis`}.` : ''} Escríbeme por DM si ${lo} quieres.`,
      que: 'Elige nombres comunes o curiosos: más gente se identifica. 1-2 respuestas al día mientras el video tenga comentarios.',
    }),
    step('resp-rapidas', 'Respuestas rápidas para DM y WhatsApp', { donde: 'DM de TikTok o WhatsApp', que: 'Completa lo que está entre [ ] antes de enviarlas.', items: ctx.campana.respuestas }),
    step('resp-pedido', 'Anota cada consulta o venta', { que: 'Sin nombres ni teléfonos de clientes: solo producto, cantidad, valor y estado.', accion: { tipo: 'form', form: 'pedido', label: 'Anotar consulta' } }),
  ] });

  const hechas = ctx.metricas.filter((m) => m.id === id);
  const pend = medicionesPendientes(ctx, v);
  const medir = [24, 72, 168].map((h) => step(`med-${h}`, `Métricas a las ${h === 168 ? '7 días' : `${h} h`}`, {
    donde: 'App → tu video → ··· → Estadísticas · o TikTok Studio → Analíticas',
    accion: { tipo: 'form', form: 'metrica', horas: h, label: 'Anotar métricas' },
    estado: hechas.some((m) => Math.abs((+m.horas_desde_publicacion || 0) - h) <= h * 0.35) ? 'ok' : pend.includes(h) ? 'pendiente' : 'espera',
  }));
  const ult = latestMetrics(ctx)[id];
  const mediana = agendaMediana(ctx);
  medir.push(step('med-diag', 'Diagnóstico', { items: diagnose(ult, { mediana, duracion: +(g.meta?.duracion_objetivo_s || 0) }).map((d) => ({ nombre: d.sintoma, texto: `${d.causa} → ${d.accion}` })), que: ult ? '' : 'Aparece cuando anotes la primera medición.' }));
  medir.push(step('med-panel', 'Abre el panel del plan', { que: 'Cómo vamos, qué falta y el plan de cada día.', accion: { tipo: 'panel', label: 'Abrir panel' } }));
  fases.push({ id: 'medir', titulo: '7 · Medir y aprender', pasos: medir });

  const todos = fases.flatMap((f) => f.pasos).filter((s) => s.estado !== 'info');
  return {
    id, titulo: v.titulo || g.titulo, estado: v.estado, carpeta, producto: p, hora, fases,
    progreso: { hechos: todos.filter((s) => s.estado === 'ok').length, total: todos.length },
    siguiente: SIGUIENTE[v.estado] || '',
  };
}

function agendaMediana(ctx) {
  const vistas = Object.values(latestMetrics(ctx)).map((m) => +m.vistas).filter(Number.isFinite);
  return median(vistas) || 220;
}

export function kitMarkdown(kit, fecha = '') {
  const L = [`# Kit paso a paso · ${kit.id} · ${kit.titulo}`, '',
    `> Generado por Relieve3D → Estudio TikTok${fecha ? ` el ${fecha}` : ''}. Estado del video: **${kit.estado}** · ${kit.progreso.hechos}/${kit.progreso.total} pasos hechos.`,
    '> Se regenera cada vez que lo guardas desde Relieve3D (las casillas salen de los archivos reales).', ''];
  for (const f of kit.fases) {
    L.push(`## ${f.titulo}`, '');
    for (const s of f.pasos) {
      const box = s.estado === 'ok' ? '[x]' : s.estado === 'info' ? '-' : '[ ]';
      L.push(box === '-' ? `- **${s.titulo}**` : `- ${box} **${s.titulo}**${s.estado === 'parcial' ? ' (animatic listo, falta el final)' : ''}`);
      if (s.donde) L.push(`  - Dónde: ${s.donde}`);
      if (s.que) s.que.split('\n').forEach((q) => L.push(`  - ${q}`));
      if (s.accion?.tipo === 'url') L.push(`  - Enlace: ${s.accion.url}`);
      if (s.copiar) L.push('', '  ```', ...s.copiar.split('\n').map((c) => `  ${c}`), '  ```', '');
      for (const it of s.items || []) L.push(`  - **${it.nombre}**: ${it.texto}`);
    }
    L.push('');
  }
  return L.join('\n');
}

// ------------------------------------------------------------------ prompts para IA

export function brandContext(ctx) {
  const pf = ctx.perfil;
  const vz = ctx.voz;
  const conPrecio = ctx.catalogo.filter((p) => p.precio != null).map((p) => `${p.nombre} ${precioTexto(p)}`).join('; ');
  const cotizar = ctx.catalogo.filter((p) => p.precio == null).map((p) => p.nombre.toLowerCase()).join(', ');
  const f = faseDe(ctx, ctx.today);
  return [
    'Contexto de mi negocio (úsalo en todo lo que escribas):',
    pf.quienEs ? `- Quiénes somos: ${pf.quienEs}` : `- Marca: ${pf.marca}`,
    `- TikTok: ${pf.usuario}. País: Colombia (pesos colombianos). Enviamos a toda Colombia${pf.ciudad ? ` desde ${pf.ciudad}` : ''}.`,
    conPrecio ? `- Precios reales (NO inventes otros; si algo no está aquí di "cotiza gratis"): ${conPrecio}.` : '',
    cotizar ? `- Bajo cotización: ${cotizar}.` : '',
    vz.ritmo ? `- Cómo hablo: ${vz.ritmo}. ${cap(vz.trato)}` : '',
    vz.usa ? `- Frases mías: ${vz.usa}` : '',
    vz.nunca ? `- Nunca digo: ${vz.nunca}. Tampoco "sígueme para más".` : '',
    vz.cta ? `- Llamados a la acción: ${vz.cta}` : '',
    vz.jamas ? `- Reglas: nunca ${vz.jamas.charAt(0).toLowerCase()}${vz.jamas.slice(1)}` : '',
    f ? `- Momento de la campaña de Navidad: fase ${f.letra} · ${f.nombre} (${f.semanas}). Mensaje: ${f.mensaje}. Producto héroe: ${f.heroe}.` : '',
  ].filter(Boolean).join('\n');
}

function sujetoDe(ctx, s) {
  if (!s) return null;
  if (s.escenas && s.producto) return { titulo: s.titulo, bloques: s.escenas.map((e) => e.voz), producto: s.producto, caption: s.caption, ocasion: OCASIONES[s.ocasion], formato: s.formato };
  return { titulo: s.titulo, bloques: bloquesDeVoz(s), producto: productOfVideo(ctx, s), caption: s.guion?.caption || '', id: s.id, video: s };
}

export function promptLibrary(ctx, sujeto) {
  const b = brandContext(ctx);
  const s = sujetoDe(ctx, sujeto);
  const IA = [{ nombre: 'ChatGPT', url: ENLACES.chatgpt }, { nombre: 'Copilot', url: ENLACES.copilot }, { nombre: 'Gemini', url: ENLACES.gemini }];
  const tema = s?.producto ? `${s.producto.frase} (${precioTexto(s.producto)})${s.ocasion ? ` para ${s.ocasion.para}` : ''}` : '[producto y ocasión]';
  const a = agenda(ctx);
  const out = [];
  if (s?.bloques?.length) {
    const n = s.bloques.length;
    out.push({ id: 'guion', titulo: 'Mejorar el guion (sin romper las escenas)', para: 'Cuando el texto no te suena natural o el hook se siente flojo.', donde: IA,
      despues: 'Pega la respuesta en Crear guion → escenas (o en video.json → voz.texto), bloque por bloque.',
      texto: `${b}\n\nMejora este guion de TikTok "${s.titulo}" para que enganche en los primeros 3 segundos y suene natural dicho por mí a cámara.\nReglas: devuelve EXACTAMENTE ${n} bloques separados por " | " (cada bloque es una escena del video), frases cortas (menos de 3 s cada una), sin inventar precios, plazos ni descuentos, y conserva el llamado a la acción del final.\n\nGuion actual:\n${s.bloques.map((x, i) => `${i + 1}. ${x}`).join('\n')}` });
  }
  out.push({ id: 'hooks', titulo: '10 hooks para probar', para: 'Antes de grabar, o para hacer una variación de un video que funcionó.', donde: IA,
    despues: 'Elige 1-3 y úsalos como hook alternativo (Crear guion → escena 1).',
    texto: `${b}\n\nDame 10 hooks para un TikTok sobre ${tema}. Para cada uno: (1) frase hablada de menos de 3 segundos, (2) texto en pantalla de máximo 5 palabras y distinto de la frase, (3) qué se ve en el primer fotograma. Mezcla fórmulas: resultado en frío, pregunta que deja la duda, identificación ("¿te tocó amigo secreto…?"), número concreto con un precio real, lista y tendencia. Ordénalos del más fuerte al más débil y explica en una línea por qué el primero.` });
  out.push({ id: 'caption', titulo: 'Caption, hashtags y comentario fijado (SEO)', para: 'Al publicar, si quieres otra opción de caption.', donde: IA,
    despues: 'Pega el caption en la descripción del post y fija el comentario.',
    texto: `${b}\n\nEscribe 3 opciones de caption para mi TikTok "${s?.titulo || '[título]'}" sobre ${tema}. Fórmula: línea 1 con la palabra clave que la gente busca en TikTok Colombia (por ejemplo "regalo amigo secreto" o "llavero personalizado") + una línea de contexto + un llamado a la acción concreto + 3 a 5 hashtags (siempre #pabonitas). Máximo 2 emojis. Además, un comentario para fijar con el precio y cómo pedir.${s?.caption ? `\n\nCaption actual:\n${s.caption}` : ''}` });
  out.push({ id: 'respuestas', titulo: 'Respuestas con video a comentarios', para: 'Primera hora y días siguientes: convierte comentarios en videos nuevos.', donde: IA,
    despues: 'Graba cada respuesta en la app: comentario → cámara roja.',
    texto: `${b}\n\nEn mi video "${s?.titulo || '[título]'}" me comentaron esto: [PEGA AQUÍ LOS COMENTARIOS O NOMBRES]. Escríbeme un guion de 10 a 15 segundos para responder cada uno con video: lo saludo por su nombre, muestro la pieza${s?.producto ? ` (${s.producto.corto}, ${precioTexto(s.producto)})` : ''}, digo el precio real y cierro invitando al DM. Tono cercano, de tú.` });
  out.push({ id: 'tendencia', titulo: 'Adaptar una tendencia o sonido', para: 'Cuando veas un sonido o formato fuerte en Colombia.', donde: [{ nombre: 'Creative Center (Colombia)', url: ENLACES.creativeCenter }, ...IA],
    despues: 'Crea el video en Crear guion con la fórmula T10 y pega la frase de la tendencia.',
    texto: `${b}\n\nEste sonido o tendencia está fuerte en TikTok Colombia: [DESCRIBE EL SONIDO O PEGA EL ENLACE Y QUÉ PASA EN EL VIDEO]. Adáptalo a mi taller de impresión 3D en 3 ideas. Cada idea con: qué se ve segundo a segundo (máximo 15 s), texto en pantalla, qué producto mío sale (con su precio real) y el llamado a la acción. Sin personajes con marca registrada.` });
  const plan = [...a.vencidos, ...a.deHoy, ...a.deManana, ...a.proximos].map((v) => `${v.id} ${v.titulo} (${fechaHumana(v.fecha_plan)})`).join('; ');
  out.push({ id: 'semana', titulo: 'Ideas para completar la semana', para: 'Cuando haya huecos en el calendario.', donde: IA,
    despues: 'Crea las que te gusten en Crear guion (una por hueco libre).',
    texto: `${b}\n\nEstamos en la semana ${a.semana}${a.semanaPlan?.cta ? ` y el llamado de la semana es "${a.semanaPlan.cta}"` : ''}. Ya tengo planeados: ${plan || 'nada todavía'}. Dame 5 ideas nuevas de videos que no repitan lo anterior. Para cada una: formato (toma a cámara, timelapse con revelación, lista con precios o antes/después), hook, producto con su precio real y objetivo (comentarios, DMs, guardados o compartidos).` });
  const vid = s?.video;
  const m = vid ? latestMetrics(ctx)[vid.id] : null;
  const datos = m ? `vistas ${m.vistas}, tiempo medio ${m.tiempo_medio_s} s, vio completo ${m.vio_completo_pct} %, me gusta ${m.me_gusta}, comentarios ${m.comentarios}, compartidos ${m.compartidos}, guardados ${m.guardados}, seguidores nuevos ${m.seguidores_nuevos}, tráfico Para ti ${m.trafico_para_ti_pct} %, búsqueda ${m.trafico_busqueda_pct} % (a las ${m.horas_desde_publicacion} h)` : '[PEGA LAS MÉTRICAS: vistas, tiempo medio, % que lo vio completo, me gusta, comentarios, compartidos, guardados, seguidores nuevos, % tráfico Para ti y búsqueda]';
  out.push({ id: 'diagnostico', titulo: 'Diagnóstico de métricas', para: 'A las 72 h o 7 días de publicar.', donde: IA,
    despues: 'Pasa el aprendizaje (1 línea) a aprendizajes/aprendizajes.md.',
    texto: `${b}\n\nAnaliza las métricas de mi TikTok "${s?.titulo || '[título]'}": ${datos}. Mi mediana es ${Math.round(agendaMediana(ctx))} vistas y la meta es 450. Dame un diagnóstico, 3 cambios concretos para el próximo video (hook, duración, llamado a la acción) y dime si conviene hacer una parte 2.` });
  const colores = ctx.voz.colores.length ? ctx.voz.colores.join(', ') : 'tonos pastel cálidos';
  out.push({ id: 'portada', titulo: 'Fondo para la portada (imagen IA)', para: 'Solo el fondo: el producto siempre es una foto real tuya.', donde: IA,
    despues: 'En CapCut pon encima la foto real del producto y el texto de portada; expórtala y elígela en «Editar portada».',
    texto: `Crea una imagen vertical 1080×1920 para usar como FONDO de la portada de un TikTok sobre ${s?.producto ? s.producto.corto : 'regalos personalizados impresos en 3D'}. Sin texto, sin personas, sin logos ni personajes con marca. Estilo: fondo limpio y cálido de Navidad con luces bokeh suaves y un espacio vacío en el centro donde pondré la foto real del producto. Paleta: ${colores}. Iluminación cálida, aspecto profesional.` });
  out.push({ id: 'dm', titulo: 'Responder un DM o WhatsApp', para: 'Cuando un cliente pregunta algo que no cubren las respuestas rápidas.', donde: IA,
    despues: 'Anota la consulta en Responder y medir → Pedidos.',
    texto: `${b}\n\nUn cliente me escribió esto: [PEGA EL MENSAJE, SIN SU NOMBRE NI TELÉFONO]. Respóndele en máximo 4 líneas, cálido y concreto, usando estas respuestas base de mi negocio:\n${ctx.campana.respuestas.map((r) => `- ${r.nombre}: ${r.texto}`).join('\n')}\nSi pregunta algo que no está aquí (fechas límite, costo de envío a su ciudad), dile que se lo confirmo enseguida; no inventes.` });
  out.push({ id: 'copilot', titulo: 'Pedírmelo a mí (Copilot CLI)', para: 'Para tareas largas: guiones completos, calendarios, retro semanal.', donde: [{ nombre: 'Terminal en la carpeta TikTok-Impresion3D → copilot', url: '' }],
    despues: 'Al terminar, abre el panel para ver cómo vamos.',
    texto: [`Crea el guion de un video de ${tema} con mi cara y mi voz`, `Haz el calendario de la semana ${a.semana} con los huecos libres`, 'Revisa las métricas de esta semana y dame 3 reglas nuevas para aprendizajes.md', 'Actualiza mi perfil de voz con las transcripciones de mis videos', 'Abre el panel y dime qué falta hoy'].join('\n') });
  return out;
}

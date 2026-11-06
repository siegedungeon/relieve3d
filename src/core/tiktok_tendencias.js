// Tendencias del Estudio TikTok sin IA: fuentes públicas verificables (RSS de Google Trends Colombia y de Reddit),
// lo que copies del TikTok Creative Center, el calendario de fechas que venden en Colombia y tus propias métricas.
// Módulo puro: recibe texto ya descargado y devuelve datos con su fuente, enlace y hora.
import * as T from './tiktok_studio.js';
import { variables, rellenar } from './tiktok_biblioteca.js';

export const FUENTES = {
  'google-co': {
    nombre: 'Google Trends · Colombia', url: 'https://trends.google.com/trending/rss?geo=CO', web: 'https://trends.google.com/trending?geo=CO',
    que: 'Lo más buscado en Google en Colombia en las últimas horas (temas para un gancho de tendencia)', tipo: 'rss',
  },
  'reddit-bambulab': {
    nombre: 'Reddit · r/BambuLab (top de la semana)', url: 'https://www.reddit.com/r/BambuLab/top/.rss?t=week', web: 'https://www.reddit.com/r/BambuLab/top/?t=week',
    que: 'Lo que más gustó esta semana entre dueños de impresoras Bambu Lab (ideas de proyectos y de videos)', tipo: 'atom',
  },
  'reddit-3dprinting': {
    nombre: 'Reddit · r/3Dprinting (top de la semana)', url: 'https://www.reddit.com/r/3Dprinting/top/.rss?t=week', web: 'https://www.reddit.com/r/3Dprinting/top/?t=week',
    que: 'Lo más votado de la semana en la comunidad de impresión 3D (ideas de proyectos y de videos)', tipo: 'atom',
  },
  'creative-center': {
    nombre: 'TikTok Creative Center · hashtags', url: 'https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/es?countryCode=CO&period=7',
    web: 'https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/es?countryCode=CO&period=7',
    que: 'Hashtags en tendencia en TikTok (oficial). Sin iniciar sesión solo muestra 3 y de Estados Unidos', tipo: 'manual',
  },
};
export const FUENTES_AUTO = Object.keys(FUENTES).filter((k) => FUENTES[k].tipo !== 'manual');

// ------------------------------------------------------------------ XML mínimo (sin DOM)

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodificar(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ').trim();
}
const etiqueta = (xml, tag) => {
  const m = String(xml).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? decodificar(m[1]) : '';
};
const bloques = (xml, tag) => [...String(xml).matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
const httpsUrl = (u) => (/^https:\/\/[^\s"<>]+$/.test(u) ? u : '');

export function numeroCompacto(s) {
  const m = String(s ?? '').replace(/\u00a0/g, ' ').trim().match(/^(\d+(?:[.,]\d+)*)\s*(k|m|b|mil(?:l(?:ones|\.)?)?|millones|mm)?\+?$/i);
  if (!m) return null;
  let num = m[1];
  const suf = (m[2] || '').toLowerCase();
  if (suf) num = num.replace(',', '.');
  else num = num.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
  const mult = !suf ? 1 : suf === 'k' || suf === 'mil' ? 1e3 : suf === 'b' || suf === 'mm' ? 1e9 : 1e6;
  const n = Math.round(parseFloat(num) * mult);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------------ parsers

export function parseGoogleTrendsRss(xml) {
  return bloques(xml, 'item').map((it) => {
    const trafico = etiqueta(it, 'ht:approx_traffic');
    const fecha = new Date(etiqueta(it, 'pubDate'));
    return {
      termino: etiqueta(it, 'title'),
      trafico,
      trafico_n: numeroCompacto(trafico) || 0,
      fecha: Number.isNaN(+fecha) ? '' : fecha.toISOString(),
      noticias: bloques(it, 'ht:news_item').map((n) => ({ titulo: etiqueta(n, 'ht:news_item_title'), url: httpsUrl(etiqueta(n, 'ht:news_item_url')), fuente: etiqueta(n, 'ht:news_item_source') })).filter((n) => n.titulo),
    };
  }).filter((x) => x.termino);
}

export function parseRedditAtom(xml) {
  return bloques(xml, 'entry').map((e) => {
    const link = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    const autor = etiqueta(bloques(e, 'author')[0] || '', 'name').replace(/^\/u\//, 'u/');
    const fecha = new Date(etiqueta(e, 'published') || etiqueta(e, 'updated'));
    return { titulo: etiqueta(e, 'title'), url: httpsUrl(decodificar(link)), autor, fecha: Number.isNaN(+fecha) ? '' : fecha.toISOString() };
  }).filter((x) => x.titulo && x.url);
}

const PAISES = ['The United States', 'United States', 'Estados Unidos', 'Colombia', 'México', 'Mexico', 'Spain', 'España', 'Argentina', 'Chile', 'Perú', 'Peru', 'Brazil', 'Brasil', 'Canada', 'United Kingdom', 'Reino Unido'];
const NUM = String.raw`\d+(?:[.,]\d+)*\s?(?:K|M|B|mil(?:l(?:ones|\.)?)?|millones)?`;

// Texto copiado de la página de hashtags del Creative Center (Ctrl+A, Ctrl+C) o capturado por la app.
export function parseCreativeCenterText(texto, url = FUENTES['creative-center'].url) {
  const t = String(texto || '').replace(/\u00a0/g, ' ');
  const plano = t.replace(/\s+/g, ' ');
  const tras = plano.match(/(?:trending now in|tendencias? (?:ahora )?en|lo que es tendencia (?:ahora )?en)\s+(.+?)(?:\s+(?:Find|Encuentra|Descubre)\b|$)/i);
  let region = (tras && PAISES.find((p) => tras[1].startsWith(p))) || PAISES.find((p) => plano.includes(p)) || '';
  region = region.replace(/^The /, '').replace(/^United States$/, 'Estados Unidos');
  const items = [];
  const re = new RegExp(String.raw`(?:^|\s)(\d{1,3})\s+#([\p{L}\p{N}_]+)\s+(?:([^#\d]{2,40}?)\s+)?(${NUM})\s+(?:Posts|Publicaciones|publicaciones|posts)\s+(${NUM})\s+(?:Views|Visualizaciones|visualizaciones|views|Vistas|vistas)`, 'gu');
  for (const m of plano.matchAll(re)) {
    if (items.some((x) => x.hashtag === `#${m[2].toLowerCase()}`)) continue;
    items.push({ rank: +m[1], hashtag: `#${m[2].toLowerCase()}`, categoria: (m[3] || '').trim(), posts: m[4].trim(), posts_n: numeroCompacto(m[4]), vistas: m[5].trim(), vistas_n: numeroCompacto(m[5]) });
  }
  if (!items.length) {
    const tags = [...new Set((plano.match(/#[\p{L}\p{N}_]{2,}/gu) || []).map((x) => x.toLowerCase()))];
    tags.forEach((h, i) => items.push({ rank: i + 1, hashtag: h, categoria: '', posts: '', posts_n: null, vistas: '', vistas_n: null }));
  }
  return { region, url: httpsUrl(url) || FUENTES['creative-center'].url, items: items.slice(0, 100) };
}

export function avisoRegion(region) {
  if (!region) return 'No pude leer el país de la página: verifica que diga Colombia';
  return /colombia/i.test(region) ? '' : `Estos datos son de ${region}, no de Colombia. Inicia sesión en el Creative Center y elige Colombia para ver los de aquí`;
}

// Snapshot = lo que se guarda en tendencias/<fecha>/<fuente>.json (con fuente, enlace y hora: verificable).
export function snapshotDe(fuente, { texto = '', url = '', obtenido = '' } = {}) {
  const f = FUENTES[fuente];
  if (!f) return { fuente, error: `Fuente desconocida: ${fuente}`, items: [] };
  const base = { fuente, nombre: f.nombre, url: httpsUrl(url) || f.url, web: f.web, obtenido };
  try {
    if (fuente === 'google-co') {
      const items = parseGoogleTrendsRss(texto);
      return { ...base, region: 'Colombia', items, error: items.length ? '' : 'La respuesta no trae tendencias (¿cambió el formato del RSS?)' };
    }
    if (fuente.startsWith('reddit-')) {
      const items = parseRedditAtom(texto);
      return { ...base, region: '', items, error: items.length ? '' : 'La respuesta no trae publicaciones (¿Reddit pidió verificación?)' };
    }
    const cc = parseCreativeCenterText(texto, url);
    return { ...base, url: cc.url, region: cc.region, aviso: avisoRegion(cc.region), items: cc.items, error: cc.items.length ? '' : 'No encontré hashtags en el texto. Abre la página de hashtags, espera a que cargue la tabla y vuelve a copiar' };
  } catch (e) {
    return { ...base, items: [], error: `No pude leer la respuesta: ${e.message}` };
  }
}

// ------------------------------------------------------------------ filtro: qué tendencias NO usar para vender

const SENSIBLE = [
  [/\b(muere|murio|muerte|muerto|fallec\w*|asesin\w*|homicid\w*|masacre|cadaver|funeral|luto|velorio|suicid\w*)\b/, 'muerte o tragedia'],
  [/\b(accidente|tragedia|victimas?|herid[oa]s?|choque|derrumbe|explosion|incendio|terremoto|sismo|temblor|inundacion\w*|huracan|tormenta|alerta|emergencia|desastre|avalancha)\b/, 'accidente o desastre'],
  [/\b(guerra|ataque|atentado|bomba|disparo\w*|balacera|bala|arma\w*|violencia|secuestr\w*|extorsion|terroris\w*|militar\w*|ejercito|disidencia\w*|eln|farc|paro armado)\b/, 'violencia'],
  [/\b(robo|hurto|estafa|captur\w*|carcel|preso|prision|condena\w*|fiscal\w*|policia|narco\w*|droga\w*|cartel|abuso|violacion|denuncia\w*|escandalo|investigacion)\b/, 'crimen o justicia'],
  [/\b(ley|leyes|reforma\w*|congreso|senado|senador\w*|camara de representantes|presidente|presidencia|president[ea]|petro|uribe|elecciones?|electoral|candidat\w*|votacion|consulta|registraduria|ministr\w*|gobierno|alcald\w*|gobernador\w*|partido|politic\w*|decreto|trump|maduro)\b/, 'política'],
  [/\b(impuesto\w*|dian|iva|dolar|inflacion|riesgo|crisis|pension\w*|salario minimo|desempleo|bolsa de valores)\b/, 'economía o impuestos'],
  [/\b(cancer|enfermedad\w*|hospital\w*|clinica|dengue|covid|virus|pandemia|epidemia|vacuna\w*|salud|sintomas|diagnostico|eps)\b/, 'salud'],
  [/\b(iglesia|papa|religion|religios\w*|dios|virgen|santo|pastor|cristian\w*|catolic\w*|islam|judio)\b/, 'religión'],
];
const plano = (s) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function tendenciaSegura(termino, noticias = []) {
  const t = plano(termino);
  if (!t || t.length < 3) return { ok: false, motivo: 'tema vacío' };
  for (const [re, motivo] of SENSIBLE) if (re.test(t)) return { ok: false, motivo };
  const titulares = plano(noticias.map((n) => n.titulo).join(' · '));
  for (const [re, motivo] of SENSIBLE.slice(0, 3)) if (re.test(titulares)) return { ok: false, motivo: `${motivo} (según las noticias)` };
  return { ok: true, motivo: '' };
}

export const NOTA_TENDENCIA = 'Úsala como tema del gancho, no en el producto: nada de personas, equipos o marcas reales en lo que vendes.';

// T10 con tendencias reales: tema (de dónde salió, con enlace y hora) + 2 plantillas de gancho ya rellenas.
export function ganchosDeTendencia(ctx, snapshots, ganchos, { input = {}, max = 5 } = {}) {
  const plantillas = ganchos.filter((g) => /\{tema\}|\{TEMA\}/.test(`${g.texto} ${g.pantalla || ''}`));
  if (!plantillas.length) return [];
  const temas = [];
  const vistos = new Set();
  for (const s of snapshots || []) {
    if (!s || s.error || !Array.isArray(s.items)) continue;
    if (s.fuente === 'google-co') {
      for (const it of [...s.items].sort((a, b) => (b.trafico_n || 0) - (a.trafico_n || 0))) {
        const seg = tendenciaSegura(it.termino, it.noticias);
        if (seg.ok) temas.push({ tema: it.termino, fuente: s.fuente, fuenteNombre: s.nombre, url: it.noticias?.[0]?.url || s.web || s.url, obtenido: s.obtenido, region: 'Colombia', detalle: it.trafico ? `${it.trafico} búsquedas` : '' });
      }
    } else if (s.fuente === 'creative-center') {
      for (const it of s.items) {
        const tema = it.hashtag.replace(/^#/, '');
        if (tendenciaSegura(tema).ok) temas.push({ tema: it.hashtag, fuente: s.fuente, fuenteNombre: s.nombre, url: s.url, obtenido: s.obtenido, region: s.region || '', detalle: [it.posts && `${it.posts} posts`, it.vistas && `${it.vistas} vistas`].filter(Boolean).join(' · ') });
      }
    }
  }
  const out = [];
  let k = 0;
  for (const t of temas) {
    const clave = plano(t.tema).replace(/^#/, '');
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const vars = variables(ctx, input, { tema: t.tema });
    const opciones = [plantillas[k % plantillas.length], plantillas[(k + 1) % plantillas.length]].filter((g, i, a) => a.indexOf(g) === i)
      .map((g) => ({ id: g.id, voz: rellenar(g.texto, vars).texto, pantalla: rellenar(g.pantalla || '', vars).texto }));
    k += 2;
    out.push({ ...t, nota: NOTA_TENDENCIA, opciones });
    if (out.length >= max) break;
  }
  return out;
}

// ------------------------------------------------------------------ fechas que venden en Colombia

const FIJAS = [
  { id: 'san-valentin', nombre: 'San Valentín', md: '02-14', previo: 14, ocasion: 'pareja', angulo: 'Regalo con su nombre para tu pareja (en Colombia el grande es Amor y Amistad, pero el 14 de febrero también vende)', hashtags: ['#sanvalentin', '#regalospersonalizados', '#pareja', '#pabonitas'] },
  { id: 'mujer', nombre: 'Día de la Mujer', md: '03-08', previo: 10, ocasion: 'general', angulo: 'Detalles con nombre para regalar en la oficina o a mamá', hashtags: ['#diadelamujer', '#detalles', '#regalospersonalizados', '#pabonitas'] },
  { id: 'secretaria', nombre: 'Día de la Secretaria', md: '04-26', previo: 10, ocasion: 'empresas', angulo: 'Organizador o soporte con su nombre para el escritorio', hashtags: ['#diadelasecretaria', '#regalosempresariales', '#pabonitas'] },
  { id: 'maestro', nombre: 'Día del Maestro', md: '05-15', previo: 12, ocasion: 'profe', angulo: 'Regalo para la profe con su nombre (lápices, placa, llavero)', hashtags: ['#diadelmaestro', '#regaloparaprofe', '#pabonitas'] },
  { id: 'halloween', nombre: 'Halloween', md: '10-31', previo: 14, ocasion: 'general', angulo: 'Piezas de Halloween sin personajes con marca (calabazas, fantasmas, murciélagos)', hashtags: ['#halloween', '#impresion3d', '#pabonitas'] },
  { id: 'velitas', nombre: 'Día de las Velitas', md: '12-07', previo: 7, ocasion: 'hogar', angulo: 'Decoración navideña de la casa; si salen velas, que sean LED (el PLA se deforma con el calor)', hashtags: ['#diadelasvelitas', '#navidad', '#decoracionnavideña', '#pabonitas'] },
  { id: 'nochebuena', nombre: 'Nochebuena', md: '12-24', previo: 21, ocasion: 'general', angulo: 'Último día para pedir y que llegue: urgencia real con fecha límite de pedido', hashtags: ['#navidad', '#regalosdenavidad', '#regalospersonalizados', '#pabonitas'] },
  { id: 'inocentes', nombre: 'Día de los Inocentes', md: '12-28', previo: 4, ocasion: 'general', angulo: 'Video de humor (inocentada con una impresión 3D), sin promo', hashtags: ['#diadelosinocentes', '#impresion3d', '#pabonitas'] },
  { id: 'ano-nuevo', nombre: 'Año Nuevo', md: '12-31', previo: 7, ocasion: 'hogar', angulo: 'Detalles para la cena de fin de año y propósitos (agenda, organizador)', hashtags: ['#añonuevo', '#findeaño', '#pabonitas'] },
  { id: 'reyes', nombre: 'Día de Reyes', md: '01-06', previo: 7, ocasion: 'general', angulo: 'Regalo tardío para quien no recibió nada en Navidad', hashtags: ['#diadereyes', '#regalospersonalizados', '#pabonitas'] },
];

const d = (y, m, dd) => new Date(y, m - 1, dd);
function nthDow(y, m, dow, n) {
  const first = d(y, m, 1);
  return d(y, m, 1 + ((dow - first.getDay() + 7) % 7) + (n - 1) * 7);
}
function lastDow(y, m, dow) {
  const last = d(y, m + 1, 0);
  return d(y, m, last.getDate() - ((last.getDay() - dow + 7) % 7));
}
const mas = (f, n) => new Date(f.getFullYear(), f.getMonth(), f.getDate() + n);

function fechasDelAno(y) {
  const bf = mas(nthDow(y, 11, 4, 4), 1);
  const movibles = [
    { id: 'nino', nombre: 'Día del Niño', fecha: lastDow(y, 4, 6), previo: 12, ocasion: 'general', angulo: 'Juguetes impresos y llaveros con su nombre (sin personajes con marca)', hashtags: ['#diadelniño', '#juguetes', '#impresion3d', '#pabonitas'], regla: 'último sábado de abril' },
    { id: 'madre', nombre: 'Día de la Madre', fecha: nthDow(y, 5, 0, 2), previo: 21, ocasion: 'hogar', angulo: 'La fecha que más vende en Colombia: regalo con su nombre, pide con tiempo', hashtags: ['#diadelamadre', '#regalosparamama', '#regalospersonalizados', '#pabonitas'], regla: 'segundo domingo de mayo' },
    { id: 'padre', nombre: 'Día del Padre', fecha: nthDow(y, 6, 0, 3), previo: 18, ocasion: 'general', angulo: 'Soporte, organizador o llavero con su nombre para papá', hashtags: ['#diadelpadre', '#regalosparapapa', '#pabonitas'], regla: 'tercer domingo de junio' },
    { id: 'prima-junio', nombre: 'Prima de mitad de año', fecha: d(y, 6, 30), previo: 10, ocasion: 'general', angulo: 'La gente tiene plata extra: "date un gusto" con tu precio', hashtags: ['#prima', '#regalospersonalizados', '#pabonitas'], regla: 'se paga a más tardar el 30 de junio' },
    { id: 'amor-amistad', nombre: 'Amor y Amistad', fecha: nthDow(y, 9, 6, 3), previo: 21, ocasion: 'amigo-secreto', angulo: 'Amigo secreto de septiembre: el gancho "¿te tocó amigo secreto?" funciona igual que en diciembre', hashtags: ['#amoryamistad', '#amigosecreto', '#regalospersonalizados', '#pabonitas'], regla: 'tercer sábado de septiembre' },
    { id: 'black-friday', nombre: 'Black Friday', fecha: bf, previo: 10, ocasion: 'general', angulo: 'Sin descuentos inventados: muestra tus precios reales y que los regalos de Navidad se piden con tiempo', hashtags: ['#blackfriday', '#regalosdenavidad', '#pabonitas'], regla: 'día siguiente al cuarto jueves de noviembre' },
    { id: 'cyber-monday', nombre: 'Cyber Monday', fecha: mas(bf, 3), previo: 7, ocasion: 'general', angulo: 'Compra en línea: lleva al enlace de cotizar y al catálogo', hashtags: ['#cybermonday', '#comprasenlinea', '#pabonitas'], regla: 'lunes siguiente al Black Friday' },
    { id: 'prima-diciembre', nombre: 'Prima de diciembre', fecha: d(y, 12, 20), previo: 15, ocasion: 'general', angulo: 'Pagan la prima: es cuando más se compran regalos; muestra precios y fecha límite de pedido', hashtags: ['#prima', '#regalosdenavidad', '#pabonitas'], regla: 'se paga a más tardar el 20 de diciembre' },
    { id: 'novena', nombre: 'Novena de aguinaldos', fecha: d(y, 12, 16), hasta: d(y, 12, 24), previo: 14, ocasion: 'novena', angulo: 'Detalles para repartir en la novena (llaveros, nombres) y decoración', hashtags: ['#novenadeaguinaldos', '#navidad', '#detalles', '#pabonitas'], regla: '16 al 24 de diciembre' },
  ];
  const fijas = FIJAS.map((f) => ({ ...f, fecha: d(y, +f.md.slice(0, 2), +f.md.slice(3)), regla: 'fecha fija' }));
  return [...fijas, ...movibles];
}

// Fechas desde hoy hasta "dias" adelante (incluye las que están en curso), con cuándo empezar a publicar.
export function fechasClave(hoy, dias = 60) {
  const h = T.parseISO(String(hoy).slice(0, 10)) || new Date();
  const h0 = d(h.getFullYear(), h.getMonth() + 1, h.getDate());
  const fin = mas(h0, dias);
  const out = [];
  for (const y of [h0.getFullYear() - 1, h0.getFullYear(), h0.getFullYear() + 1]) {
    for (const f of fechasDelAno(y)) {
      const hasta = f.hasta || f.fecha;
      if (hasta < h0 || f.fecha > fin) continue;
      const faltan = Math.round((f.fecha - h0) / 864e5);
      const desde = mas(f.fecha, -f.previo);
      const estado = faltan <= 0 ? (f.hasta && hasta >= h0 ? 'en curso' : 'hoy') : h0 >= desde ? 'publica ya' : 'prepara';
      out.push({
        id: `${f.id}-${y}`, nombre: f.nombre, fecha: T.isoDate(f.fecha), hasta: f.hasta ? T.isoDate(f.hasta) : '', faltan, estado,
        publicarDesde: T.isoDate(desde), ocasion: f.ocasion, angulo: f.angulo, hashtags: f.hashtags, regla: f.regla,
      });
    }
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// ------------------------------------------------------------------ lo que te funciona a ti (tus métricas)

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const mediana = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

export function rankingFormulas(ctx) {
  const ult = T.latestMetrics(ctx);
  const grupos = new Map();
  for (const v of ctx.videos || []) {
    const m = ult[v.id];
    const f = T.FORMULAS[v.formula] ? v.formula : '';
    if (!m || !f || num(m.vistas) == null) continue;
    if (!grupos.has(f)) grupos.set(f, []);
    grupos.get(f).push({ id: v.id, m });
  }
  return [...grupos.entries()].map(([formula, xs]) => {
    const vistas = mediana(xs.map((x) => num(x.m.vistas)));
    const completo = mediana(xs.map((x) => num(x.m.vio_completo_pct)));
    const tasa = mediana(xs.map((x) => { const v = num(x.m.vistas); return v ? ((num(x.m.compartidos) || 0) + (num(x.m.guardados) || 0)) / v : null; }));
    return { formula, nombre: T.FORMULAS[formula].nombre, videos: xs.map((x) => x.id), n: xs.length, vistas, completo, tasa: tasa == null ? null : Math.round(tasa * 10000) / 100 };
  }).sort((a, b) => (b.tasa ?? -1) - (a.tasa ?? -1) || (b.vistas ?? -1) - (a.vistas ?? -1));
}

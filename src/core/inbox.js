// Mensajes · Pabonitas: helpers puros (sin DOM ni Node) de la bandeja de WhatsApp, Messenger, Instagram y TikTok.
// Portados de saas-shop-meyer-sublimados/frontend/src/features/inbox/inbox.ts (contrato con backend/app/schemas/inbox.py):
// mismas reglas y textos que la web para avisar antes de enviar. Si cambian allá, cambian aquí.
import { commercialQuote, commercialText } from './quote_document.js';

// --- Constantes espejo del backend (las verifica scripts/inbox.test.mjs) ---
export const INBOX_PLATFORM_LABELS = {
  whatsapp: 'WhatsApp',
  messenger: 'Facebook Messenger',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  simulator: 'Simulador',
};
export const INBOX_VIEWS = [
  { key: 'bandeja', label: 'Bandeja' },
  { key: 'unread', label: 'Sin leer' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'closed', label: 'Cerradas' },
  { key: 'all', label: 'Todas' },
];
export const INBOX_STATUS_LABELS = {
  open: 'Abierta',
  pending: 'Pendiente',
  closed: 'Cerrada',
};
export const INBOX_MESSAGE_STATUS_LABELS = {
  received: 'Recibido',
  pending: 'Enviando…',
  sent: 'Enviado',
  delivered: 'Entregado',
  read: 'Leído',
  failed: 'No se envió',
};
export const INBOX_KIND_PREVIEW = {
  image: '📷 Foto',
  sticker: '💟 Sticker',
  audio: '🎤 Audio',
  video: '🎬 Video',
  file: '📎 Archivo',
  location: '📍 Ubicación',
  template: '📋 Plantilla',
  reaction: 'Reaccionó',
  unsupported: 'Mensaje no compatible',
};
export const INBOX_QUICK_LINK_KIND_LABELS = {
  catalogo: 'Catálogo',
  fotos: 'Fotos',
  carpeta: 'Carpeta',
  documento: 'Documento',
  video: 'Video',
  enlace: 'Enlace',
};
export const INBOX_MAX_TAGS = 8;
export const INBOX_MAX_TEXT = 8000;
export const INBOX_CAPTION_MAX_CHARS = 1024;
export const INBOX_INSTAGRAM_MAX_TEXT_BYTES = 1000;
export const INBOX_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const INBOX_FILE_MAX_BYTES = 15 * 1024 * 1024;
export const INBOX_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const INBOX_DOCUMENT_EXTENSIONS = ['pdf', 'txt', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'mp4', 'zip'];
export const INBOX_UPLOAD_ACCEPT = [...INBOX_IMAGE_TYPES, ...INBOX_DOCUMENT_EXTENSIONS.map(extension => `.${extension}`)].join(',');
export const INBOX_IMAGE_ACCEPT = INBOX_IMAGE_TYPES.join(',');
export const INBOX_CAPTION_PLATFORMS = ['whatsapp', 'simulator'];
/** Variables que se pueden escribir en respuestas guardadas y mensajes automáticos, en el orden del backend. */
export const INBOX_VARIABLE_LABELS = {
  nombre: 'Nombre del cliente',
  marca: 'Nombre de la marca',
  catalogo: 'Enlace al catálogo',
  tienda: 'Enlace a la tienda',
  cotizar: 'Enlace para cotizar',
  generador: 'Generador de llaveros 3D',
  simulador: 'Simulador de sublimación',
  whatsapp: 'Enlace de WhatsApp',
  ciudad: 'Ciudad del taller',
  horario: 'Horario de atención',
  canal: 'Canal de la conversación',
  produccion: 'Tiempo de fabricación',
  pago: 'Medios de pago',
  envio: 'Tiempos de entrega',
};
export const INBOX_PLACEHOLDER_PATTERN = /\[(?:DATO|FECHA|NOMBRE|PRECIO|CONFIRMAR)[^\]]*\]/i;
export const INBOX_VARIABLE_PATTERN = /\{([A-Za-z_]+)\}/;
/** Igual que `inbox_core.RENDER_PATTERN`: toma el punto que sigue para no repetirlo si el dato ya termina en punto. */
const INBOX_RENDER_PATTERN = new RegExp(String.raw`${INBOX_VARIABLE_PATTERN.source}(\.?)`);
export const INBOX_NAME_GAP_PATTERN = /(?:,\s*|\s)?\{nombre\}/i;
export const INBOX_SEND_ERRORS = {
  empty: 'Escribe un mensaje.',
  tooLong: 'El mensaje es demasiado largo (máximo 8.000 caracteres).',
  paused: 'El canal está en pausa. Actívalo en Ajustes → Canales para responder.',
  stickers: '{label} no permite enviar stickers ni fotos desde la bandeja.',
  images: '{label} no permite enviar fotos desde la bandeja. Envía el enlace.',
  files: '{label} no permite enviar archivos. Envía el enlace.',
};
export const fillLabel = (template, label) => template.split('{label}').join(label);
// --- Texto: variables, [DATOS] pendientes y respuestas guardadas ---
const hasOwn = (record, key) => Object.prototype.hasOwnProperty.call(record, key);
const globalPattern = pattern => new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
export function findPlaceholders(text) {
  return [...new Set((text ?? '').match(globalPattern(INBOX_PLACEHOLDER_PATTERN)) ?? [])];
}
/** Igual que `inbox_core.render_text`: sin nombre «¡Hola {nombre}!» queda «¡Hola!»; otro dato vacío deja [DATO …]. */
export function renderInboxText(template, variables) {
  let text = template ?? '';
  if (!variables.nombre) text = text.replace(globalPattern(INBOX_NAME_GAP_PATTERN), '');
  const missing = [];
  text = text
    .replace(globalPattern(INBOX_RENDER_PATTERN), (match, rawKey, dot) => {
      const key = rawKey.toLowerCase();
      if (!hasOwn(INBOX_VARIABLE_LABELS, key)) return match;
      const value = (variables[key] ?? '').trim();
      if (value) return value.endsWith('.') ? value : value + dot;
      const label = INBOX_VARIABLE_LABELS[key];
      missing.push(label);
      return `[DATO ${label.toLowerCase()}]${dot}`;
    })
    .trim();
  const placeholders = findPlaceholders(text);
  return { text, missing, placeholders, ready: missing.length === 0 && placeholders.length === 0 };
}
const LETTER = /\p{L}/u;
const isLowerText = value => value === value.toLowerCase() && value !== value.toUpperCase();
const isUpperText = value => value === value.toUpperCase() && value !== value.toLowerCase();
/** Primer nombre presentable para saludar («MARÍA JOSÉ» → «María»); vacío si no parece un nombre. */
export function firstName(value) {
  const tokens = (value ?? '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';
  const cleaned = Array.from(tokens[0])
    .filter(char => LETTER.test(char) || "'’-".includes(char))
    .join('')
    .replace(/^['’-]+|['’-]+$/g, '');
  const chars = Array.from(cleaned);
  if (chars.filter(char => LETTER.test(char)).length < 2 || chars.length > 30) return '';
  if (isLowerText(cleaned) || isUpperText(cleaned)) return chars[0].toUpperCase() + chars.slice(1).join('').toLowerCase();
  return cleaned;
}
export function conversationVariables(base, conversation) {
  const values = {};
  for (const variable of base) values[variable.key] = variable.value;
  values.nombre = firstName(conversation.display_name);
  values.canal = INBOX_PLATFORM_LABELS[conversation.platform] ?? '';
  return values;
}
export const foldText = value => (value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** «/env» escrito solo en el cuadro de texto abre el buscador de respuestas guardadas. */
export function slashQuery(text) {
  const match = /^\/([^\s/]*)$/.exec(text);
  return match ? match[1] : null;
}
/** Busca respuestas activas: atajo exacto, atajo que empieza igual, título/categoría y por último el texto. */
export function matchSavedReplies(replies, query, limit = 8) {
  const needle = foldText(query.trim().replace(/^\/+/, ''));
  const ranked = [];
  for (const reply of replies) {
    if (!reply.is_active) continue;
    let rank = 0;
    if (needle) {
      const shortcut = foldText(reply.shortcut);
      if (shortcut && shortcut === needle) rank = 0;
      else if (shortcut.startsWith(needle)) rank = 1;
      else if (foldText(`${reply.title} ${reply.category}`).includes(needle)) rank = 2;
      else if (foldText(reply.body).includes(needle)) rank = 3;
      else continue;
    }
    ranked.push({ reply, rank });
  }
  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      b.reply.use_count - a.reply.use_count ||
      a.reply.sort_order - b.reply.sort_order ||
      a.reply.title.localeCompare(b.reply.title, 'es'),
  );
  return ranked.slice(0, limit).map(entry => entry.reply);
}
// --- Partir mensajes largos (igual que inbox_providers.split_text) ---
const utf8Length = char => {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
};
/** Cuenta en caracteres Unicode (como Python) y, si el canal lo pide, en bytes UTF-8 (Instagram: 1.000). */
export function splitInboxText(text, maxChars, maxBytes = null) {
  const parts = [];
  let remaining = (text ?? '').trim();
  while (remaining) {
    const chars = Array.from(remaining);
    const bytes = [0];
    for (const char of chars) bytes.push(bytes[bytes.length - 1] + utf8Length(char));
    const fits = count => count <= maxChars && (maxBytes === null || bytes[count] <= maxBytes);
    if (fits(chars.length)) {
      parts.push(remaining);
      break;
    }
    let limit = Math.min(chars.length, maxChars);
    while (limit > 1 && !fits(limit)) limit -= 1;
    const window = chars.slice(0, limit).join('');
    let cut = limit;
    for (const separator of ['\n\n', '\n', '. ', ' ']) {
      const unitIndex = window.lastIndexOf(separator);
      if (unitIndex < 0) continue;
      const index = Array.from(window.slice(0, unitIndex)).length;
      if (index >= Math.floor(limit / 2)) {
        cut = index + separator.length;
        break;
      }
    }
    const piece = chars.slice(0, cut).join('').trimEnd();
    if (piece) parts.push(piece);
    remaining = chars.slice(cut).join('').trimStart();
  }
  return parts;
}
export function inboxTextLimits(platform, capabilities) {
  return { maxChars: capabilities.max_text_chars, maxBytes: platform === 'instagram' ? INBOX_INSTAGRAM_MAX_TEXT_BYTES : null };
}
/** Cuántos mensajes saldrán: la foto o el archivo cuenta como uno; el texto va de pie de foto solo en WhatsApp y el simulador. */
export function estimateSendParts(text, platform, capabilities, hasMedia = false) {
  const body = text.trim();
  const { maxChars, maxBytes } = inboxTextLimits(platform, capabilities);
  if (hasMedia && body && INBOX_CAPTION_PLATFORMS.includes(platform) && Array.from(body).length <= INBOX_CAPTION_MAX_CHARS) return 1;
  return (hasMedia ? 1 : 0) + (body ? splitInboxText(body, maxChars, maxBytes).length : 0);
}
export function windowTone(window) {
  if (!window.can_reply || window.mode === 'closed') return 'danger';
  if (window.mode === 'template') return 'warning';
  if (window.mode === 'human_agent') return 'info';
  if (window.remaining !== null && window.remaining <= 2) return 'warning';
  return 'success';
}
/** Separa los enlaces del texto para mostrarlos como vínculos (sin la puntuación final). */
export function linkifyParts(text) {
  const source = text ?? '';
  const parts = [];
  let last = 0;
  for (const match of source.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const start = match.index ?? 0;
    const url = match[0].replace(/[.,)!?;:]+$/, '');
    if (start > last) parts.push({ kind: 'text', value: source.slice(last, start) });
    parts.push({ kind: 'link', value: url });
    last = start + url.length;
  }
  if (last < source.length) parts.push({ kind: 'text', value: source.slice(last) });
  return parts;
}
// --- Conversaciones y mensajes ---
export function conversationTitle(conversation) {
  const name = conversation.display_name?.trim();
  if (name) return name;
  const username = conversation.username?.trim().replace(/^@+/, '');
  if (username) return `@${username}`;
  const phone = conversation.phone?.trim();
  if (phone) return phone;
  return `Cliente de ${conversation.platform_label}`;
}
export function conversationInitials(title) {
  const words = title
    .replace(/^@+/, '')
    .split(/[\s._-]+/)
    .filter(word => /[\p{L}\d]/u.test(word));
  const letters = words
    .slice(0, 2)
    .map(word => Array.from(word.replace(/[^\p{L}\d]/gu, ''))[0] ?? '')
    .join('');
  return (letters || '?').toUpperCase();
}
export function messagePreviewText(kind, body) {
  const text = (body ?? '').split(/\s+/).filter(Boolean).join(' ');
  if ((kind === 'text' || kind === 'template') && text) return text;
  return INBOX_KIND_PREVIEW[kind] ?? 'Mensaje';
}
export function messageAuthorLabel(message) {
  if (message.direction === 'in') return null;
  if (message.author === 'auto') return 'Automático';
  if (message.author === 'echo') return 'Desde el celular';
  return message.sent_by_name?.trim() || 'Equipo';
}
export const unreadBadgeText = count => (count > 99 ? '99+' : String(Math.max(0, count)));
// --- Fechas (hora de Colombia; el backend guarda UTC) ---
const BOGOTA = 'America/Bogota';
const DAY_MS = 86_400_000;
const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: BOGOTA, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('es-CO', { timeZone: BOGOTA, hour: 'numeric', minute: '2-digit' });
/** Fechas sin zona (SQLite en desarrollo) se leen como UTC, igual que las guarda el backend. */
export function parseInboxDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const iso = /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value) ? `${value}Z` : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
export function inboxDayKey(value) {
  const date = parseInboxDate(value);
  return date ? dayKeyFormat.format(date) : '';
}
const capitalize = value => (value ? value[0].toUpperCase() + value.slice(1) : value);
export function inboxDayLabel(value, now = new Date()) {
  const date = parseInboxDate(value);
  if (!date) return '';
  const key = inboxDayKey(date);
  if (key === inboxDayKey(now)) return 'Hoy';
  if (key === inboxDayKey(new Date(now.getTime() - DAY_MS))) return 'Ayer';
  const sameYear = key.slice(0, 4) === inboxDayKey(now).slice(0, 4);
  return capitalize(
    new Intl.DateTimeFormat('es-CO', {
      timeZone: BOGOTA,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(sameYear ? {} : { year: 'numeric' }),
    }).format(date),
  );
}
export function inboxMessageTime(value) {
  const date = parseInboxDate(value);
  return date ? timeFormat.format(date) : '';
}
/** Hora corta para la lista: «ahora», «hace 5 min», la hora de hoy, «ayer», el día de la semana o la fecha. */
export function inboxRelativeTime(value, now = new Date()) {
  const date = parseInboxDate(value);
  if (!date) return '';
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const key = inboxDayKey(date);
  if (key === inboxDayKey(now)) return inboxMessageTime(date);
  if (key === inboxDayKey(new Date(now.getTime() - DAY_MS))) return 'ayer';
  if (minutes < 6 * 1440) return new Intl.DateTimeFormat('es-CO', { timeZone: BOGOTA, weekday: 'long' }).format(date);
  const sameYear = key.slice(0, 4) === inboxDayKey(now).slice(0, 4);
  return new Intl.DateTimeFormat('es-CO', { timeZone: BOGOTA, day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(
    date,
  );
}
// --- Plata y calculadoras (pesos colombianos) ---
/** Igual que `dian_links.money_text`: «$25.000» o «$25.000,50». */
export function formatCop(value) {
  const cents = Math.round(Math.abs(value) * 100);
  const grouped = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = cents % 100;
  return `$${value < 0 && cents ? '-' : ''}${grouped}${fraction ? `,${String(fraction).padStart(2, '0')}` : ''}`;
}
/** «25.000» = 25000, «25.000,50» = 25000.5, «2,5» = 2.5 y «1.5» = 1.5 (punto de miles solo en grupos de 3). */
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = (value ?? '').replace(/[$\s\u00a0]/g, '').replace(/^cop/i, '');
  if (!text) return null;
  const negative = /^[-−]/.test(text);
  if (negative) text = text.slice(1);
  if (!/^\d[\d.,]*$/.test(text)) return null;
  let normalized = text;
  if (text.includes(',')) {
    if (text.split(',').length > 2) return null;
    normalized = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    normalized = text.replace(/\./g, '');
  } else if (text.split('.').length > 2) {
    return null;
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return negative ? -amount : amount;
}
export const formatInboxNumber = value => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(value);
export const INBOX_CALCULATOR_ERRORS = {
  incomplete: 'La operación está incompleta.',
  zero: 'No se puede dividir entre cero.',
  symbol: 'Hay un símbolo que no entiendo: «{value}».',
  parens: 'Revisa los paréntesis.',
  number: 'Revisa el número «{value}».',
};
class CalculatorError extends Error {}
/**
 * Calculadora segura (sin eval): + - × ÷ ( ) y %. «a + b%» suma el b % de a, «a × b%» multiplica por b/100
 * y «b%» suelto vale b/100. Acepta $, x, ×, ÷ y el signo menos tipográfico.
 */
export function evaluateCalculator(input) {
  const source = (input ?? '')
    .replace(/[−–—]/g, '-')
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[$\s\u00a0]/g, '');
  if (!source) return { value: null, error: null };
  const tokens = [];
  for (let index = 0; index < source.length;) {
    const char = source[index];
    if (/\d/.test(char)) {
      let end = index;
      while (end < source.length && /[\d.,]/.test(source[end])) end += 1;
      const raw = source.slice(index, end);
      const amount = parseAmount(raw);
      if (amount === null) return { value: null, error: INBOX_CALCULATOR_ERRORS.number.replace('{value}', raw) };
      tokens.push(amount);
      index = end;
      continue;
    }
    if ('+-*/()%'.includes(char)) {
      tokens.push(char);
      index += 1;
      continue;
    }
    return { value: null, error: INBOX_CALCULATOR_ERRORS.symbol.replace('{value}', char) };
  }
  let position = 0;
  const fail = message => {
    throw new CalculatorError(message);
  };
  const peek = () => tokens[position];
  const parseFactor = () => {
    const token = peek();
    if (token === '-' || token === '+') {
      position += 1;
      const inner = parseFactor();
      return { value: token === '-' ? -inner.value : inner.value, percent: inner.percent };
    }
    let value = 0;
    if (typeof token === 'number') {
      position += 1;
      value = token;
    } else if (token === '(') {
      position += 1;
      value = parseExpression();
      if (peek() !== ')') fail(INBOX_CALCULATOR_ERRORS.parens);
      position += 1;
    } else if (token === ')') {
      fail(INBOX_CALCULATOR_ERRORS.parens);
    } else {
      fail(INBOX_CALCULATOR_ERRORS.incomplete);
    }
    if (peek() === '%') {
      position += 1;
      return { value: value / 100, percent: true };
    }
    return { value, percent: false };
  };
  const parseTerm = () => {
    let { value, percent } = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const operator = tokens[position];
      position += 1;
      const right = parseFactor().value;
      if (operator === '/' && right === 0) fail(INBOX_CALCULATOR_ERRORS.zero);
      value = operator === '*' ? value * right : value / right;
      percent = false;
    }
    return { value, percent };
  };
  const parseExpression = () => {
    let value = parseTerm().value;
    while (peek() === '+' || peek() === '-') {
      const operator = tokens[position];
      position += 1;
      const right = parseTerm();
      const amount = right.percent ? value * right.value : right.value;
      value = operator === '+' ? value + amount : value - amount;
    }
    return value;
  };
  try {
    const value = parseExpression();
    if (position < tokens.length) fail(peek() === '(' || peek() === ')' ? INBOX_CALCULATOR_ERRORS.parens : INBOX_CALCULATOR_ERRORS.incomplete);
    if (!Number.isFinite(value)) fail(INBOX_CALCULATOR_ERRORS.zero);
    return { value: Math.round(value * 1e6) / 1e6, error: null };
  } catch (error) {
    if (error instanceof CalculatorError) return { value: null, error: error.message };
    throw error;
  }
}
function percentValue(raw, label, errors) {
  if (!raw.trim()) return null;
  const value = parseAmount(raw.replace(/%/g, ''));
  if (value === null || value < 0 || value > 100) {
    errors.push(`${label} debe estar entre 0 y 100 %.`);
    return null;
  }
  return value;
}
/** Arma el resumen de un pedido para pegarlo en el chat (cantidades × precio, descuento, envío y anticipo opcional). */
export function calculateOrder(input) {
  const errors = [];
  const lines = [];
  input.lines.forEach((line, index) => {
    const name = line.name.trim();
    // La fila cuenta cuando tiene producto o precio: la cantidad sola (la fila nueva ya trae «1») no basta.
    if (!name && !line.unitPrice.trim()) return;
    const label = name || `Producto ${index + 1}`;
    const quantity = parseAmount(line.quantity.trim() || '1');
    const unitPrice = parseAmount(line.unitPrice);
    if (quantity === null || quantity <= 0 || !Number.isInteger(quantity)) {
      errors.push(`${label}: la cantidad debe ser un número entero mayor que cero.`);
      return;
    }
    if (unitPrice === null || unitPrice < 0) {
      errors.push(`${label}: revisa el precio.`);
      return;
    }
    lines.push({ name: label, quantity, unitPrice, total: quantity * unitPrice });
  });
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  const discountPercent = percentValue(input.discountPercent, 'El descuento', errors) ?? 0;
  const discount = Math.round((subtotal * discountPercent) / 100);
  let shipping = 0;
  if (input.shipping.trim()) {
    const parsed = parseAmount(input.shipping);
    if (parsed === null || parsed < 0) errors.push('Revisa el valor del envío.');
    else shipping = parsed;
  }
  const total = subtotal - discount + shipping;
  const depositPercent = percentValue(input.depositPercent, 'El anticipo', errors);
  const deposit = depositPercent === null ? null : Math.round((total * depositPercent) / 100);
  const balance = deposit === null ? null : total - deposit;
  const rows = lines.map(line => `• ${line.quantity} × ${line.name} a ${formatCop(line.unitPrice)} = ${formatCop(line.total)}`);
  const text = lines.length
    ? [
        'Resumen de tu pedido:',
        ...rows,
        ...(discount || shipping ? [`Subtotal: ${formatCop(subtotal)}`] : []),
        ...(discount ? [`Descuento ${formatInboxNumber(discountPercent)} %: -${formatCop(discount)}`] : []),
        ...(shipping ? [`Envío: ${formatCop(shipping)}`] : []),
        `Total: ${formatCop(total)}`,
        ...(deposit !== null && balance !== null
          ? [`Anticipo ${formatInboxNumber(depositPercent ?? 0)} %: ${formatCop(deposit)}`, `Saldo: ${formatCop(balance)}`]
          : []),
      ].join('\n')
    : '';
  return { lines, subtotal, discountPercent, discount, shipping, total, depositPercent, deposit, balance, errors, text };
}
// --- Errores en español para el equipo ---
// Palabras de errores en inglés: las de Pydantic y de Meta/TikTok, las frases estándar de HTTP
// («Internal Server Error», «Too Many Requests»…) y los detalles de la autenticación compartida («Inactive user»).
const ENGLISH_HINT =
  /\b(the|is|not|invalid|required|must|cannot|already|found|transition|disabled|requests?|field|bad|forbidden|conflict|gone|failed|too|unsupported|unprocessable|locked|unavailable|internal|server|gateway|timeout|inactive|user)\b/i;
const SPANISH_HINT = /[áéíóúñ¿¡]|\b(el|la|los|las|de|del|no|un|una|para|por|que)\b/i;
// --- Lista, borrador y archivos ---
/** Número de cada filtro según el resumen (las cerradas y «Todas» no llevan contador). */
export function inboxViewCount(summary, view) {
  if (!summary) return null;
  if (view === 'bandeja') return summary.open_conversations;
  if (view === 'unread') return summary.unread_conversations;
  if (view === 'pending') return summary.pending_conversations;
  return null;
}
/** Agrega texto al borrador separado por una línea en blanco (catálogo, precios, cotizaciones…). */
export function appendInboxText(current, addition) {
  const extra = (addition ?? '').trim();
  if (!extra) return current;
  const base = current.trimEnd();
  return base ? `${base}\n\n${extra}` : extra;
}
export function formatFileSize(bytes) {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatInboxNumber(Math.round(bytes / 102.4) / 10)} KB`;
  return `${formatInboxNumber(Math.round(bytes / (1024 * 102.4)) / 10)} MB`;
}
/** Mismos mensajes que `inbox_media.store_upload` / `create_sticker` para avisar antes de subir. */
export const INBOX_UPLOAD_ERRORS = {
  empty: 'El archivo está vacío.',
  type: 'Tipo de archivo no permitido. Usa fotos (JPG, PNG, WebP), PDF, Word, Excel, PowerPoint, MP4 o ZIP.',
  imageType: 'Formato de imagen no soportado.',
  imageSize: 'La foto pesa más de 10 MB.',
  fileSize: 'El archivo pesa más de 15 MB. Súbelo a Drive y guarda el enlace.',
};
const IMAGE_EXTENSIONS = ['jpg', 'png', 'webp', 'gif'];
/** Igual que `inbox_media.extension_for`: primero el tipo MIME de foto y si no, la extensión del nombre. */
export function inboxUploadKind(file) {
  const mime = (file.type || '').split(';')[0].trim().toLowerCase();
  if (INBOX_IMAGE_TYPES.includes(mime)) return 'image';
  const raw = file.name.includes('.') ? (file.name.split('.').pop() ?? '').toLowerCase() : '';
  const extension = raw === 'jpeg' ? 'jpg' : raw;
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (INBOX_DOCUMENT_EXTENSIONS.includes(extension)) return 'file';
  return null;
}
export function inboxUploadError(file, imagesOnly = false) {
  if (!file.size) return INBOX_UPLOAD_ERRORS.empty;
  const kind = inboxUploadKind(file);
  if (kind === null) return imagesOnly ? INBOX_UPLOAD_ERRORS.imageType : INBOX_UPLOAD_ERRORS.type;
  if (imagesOnly && kind !== 'image') return INBOX_UPLOAD_ERRORS.imageType;
  if (kind === 'image' && file.size > INBOX_IMAGE_MAX_BYTES) return INBOX_UPLOAD_ERRORS.imageSize;
  if (kind === 'file' && file.size > INBOX_FILE_MAX_BYTES) return INBOX_UPLOAD_ERRORS.fileSize;
  return null;
}
/** Qué impide enviar un adjunto por este canal (null = se puede). */
export function attachmentSendError(attachment, platformLabel, capabilities) {
  if (!attachment) return null;
  if (attachment.is_image && !capabilities.images) return fillLabel(INBOX_SEND_ERRORS.images, platformLabel);
  if (!attachment.is_image && !capabilities.files) return fillLabel(INBOX_SEND_ERRORS.files, platformLabel);
  return null;
}
/** El texto con [DATOS] sin completar no se envía (el backend responde 422 con este mismo mensaje). */
export function placeholderSendError(text) {
  const placeholders = findPlaceholders(text);
  return placeholders.length ? `Completa los datos marcados antes de enviar: ${placeholders.join(', ')}.` : null;
}
// Los errores del backend ya terminan en punto: sin quitarlo quedaría «(código 2).. Revisa…».
const errorClause = error => (error ?? '').trim().replace(/[\s.]+$/, '') || 'el canal no lo aceptó';
/** Aviso cuando la red rechaza un mensaje recién enviado. */
export const sendFailedFeedback = error => `No se pudo entregar el mensaje: ${errorClause(error)}. Revisa y toca «Reintentar».`;
/** Aviso cuando «Reintentar» tampoco logra enviarlo. */
export const retryFailedFeedback = error => `Sigue sin enviarse: ${errorClause(error)}.`;
/** Posición del primer [DATO …] para seleccionarlo en el cuadro de texto y escribir encima. */
export function firstPlaceholderRange(text) {
  const match = INBOX_PLACEHOLDER_PATTERN.exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}
export const INBOX_TAGS_ERROR = `Máximo ${INBOX_MAX_TAGS} etiquetas por conversación.`;
/** Igual que `inbox_messaging.clean_tags`: separadas por comas, sin espacios dobles, máximo 30 letras y sin repetir. */
export function parseInboxTags(value) {
  const tags = [];
  for (const raw of (value ?? '').split(',')) {
    const tag = Array.from(raw.split(/\s+/).filter(Boolean).join(' ')).slice(0, 30).join('').trimEnd();
    if (tag && !tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  }
  return tags;
}
/** Une los mensajes anteriores (paginados) con los últimos sin repetir, del más viejo al más nuevo. */
export function mergeInboxMessages(older, latest) {
  const byId = new Map();
  for (const message of [...older, ...latest]) byId.set(message.id, message);
  const time = message => parseInboxDate(message.occurred_at)?.getTime() ?? 0;
  return [...byId.values()].sort((a, b) => time(a) - time(b) || a.id - b.id);
}
// --- Herramientas del chat ---
export const INBOX_TOOLS_TABS = [
  { key: 'catalogo', label: 'Catálogo' },
  { key: 'precios', label: 'Precios' },
  { key: 'cotizaciones', label: 'Cotizaciones' },
  { key: 'calculadora', label: 'Calculadora' },
  { key: 'archivos', label: 'Archivos' },
];
/** Las cotizaciones solo aparecen si la empresa tiene el cotizador 3D (el backend responde 404 si no). */
export function inboxToolsTabs(quoteStudio) {
  return INBOX_TOOLS_TABS.filter(tab => tab.key !== 'cotizaciones' || quoteStudio !== null);
}
export const quickLinkText = link => `${link.title.trim()}: ${link.url.trim()}`;
export function priceItemText(item) {
  return `${item.name.trim()}: ${item.price_text?.trim() || 'precio por cotización'}\n${item.url.trim()}`;
}
/** Qué se puede hacer con un archivo rápido en este chat: enviarlo como foto/archivo o pegar su enlace. */
export function quickLinkSendKind(link, capabilities) {
  if (!link.asset_id) return null;
  if (link.is_image) return capabilities.images ? 'image' : null;
  return capabilities.files ? 'file' : null;
}
// --- Formularios de ajustes (mismas reglas y mensajes que el backend, para avisar antes de guardar) ---
/** Largo como lo cuenta Python (caracteres Unicode, no unidades UTF-16): un emoji cuenta 1. */
export const inboxTextLength = value => Array.from(value).length;
/** Inserta una variable donde está el cursor (con un espacio si va pegada a una palabra) y dice dónde queda el cursor. */
export function insertAtCursor(text, insertion, start, end = start) {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  const before = text.slice(0, from);
  const pad = /[\p{L}\d]$/u.test(before) ? ' ' : '';
  return { text: `${before}${pad}${insertion}${text.slice(to)}`, cursor: from + pad.length + insertion.length };
}

// --- Relieve3D (escritorio) ---

export const INBOX_OFFLINE_ERROR = 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.';

/**
 * Error de la bandeja en español. En Relieve3D el proceso principal responde { status, detail } (status 0 = sin
 * conexión o sin respuesta a tiempo); la web lanzaba «Request failed: NNN {json}». Se aceptan los dos.
 */
export function inboxErrorMessage(error, fallback = 'No pudimos completar la acción. Intenta de nuevo.') {
  let status = Number.isInteger(error?.status) ? error.status : null;
  let detail = status === null ? null : error.detail;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const match = status === null ? /^Request failed: (\d{3})\s*([\s\S]*)$/.exec(message) : null;
  if (match) {
    status = Number(match[1]);
    try {
      detail = JSON.parse(match[2]).detail;
    } catch {
      detail = null;
    }
  }
  if (status === 0) return typeof detail === 'string' && detail.trim() && SPANISH_HINT.test(detail) ? detail.trim() : INBOX_OFFLINE_ERROR;
  if (status !== null) {
    if (status === 401) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
    // Los errores del backend son en español aunque citen el detalle en inglés de Meta o TikTok.
    if (typeof detail === 'string' && detail.trim() && (SPANISH_HINT.test(detail) || !ENGLISH_HINT.test(detail))) return detail.trim();
    if (status === 403) return 'Tu rol no tiene permiso para hacer esto.';
    if (status === 404) return 'No encontramos esa información. Actualiza la bandeja.';
    if (status === 413) return 'El archivo es demasiado grande.';
    if (status === 422) return 'Revisa los datos e intenta de nuevo.';
    if (status === 429) return 'Hiciste muchas solicitudes seguidas. Espera un momento e intenta de nuevo.';
    if (status >= 500) return 'El servidor tuvo un problema. Intenta de nuevo en unos minutos.';
    return fallback;
  }
  if (error instanceof TypeError) return INBOX_OFFLINE_ERROR;
  if (message && !ENGLISH_HINT.test(message) && SPANISH_HINT.test(message)) return message;
  return fallback;
}

/** Error al iniciar sesión: el backend responde «Invalid email or password» (401) o «Tenant is not active» (403). */
export function inboxLoginError(error) {
  if (error?.status === 401) return 'Correo o contraseña incorrectos.';
  if (error?.status === 403 && /tenant is not active/i.test(String(error.detail ?? ''))) return 'Esta empresa no está activa en el servidor.';
  return inboxErrorMessage(error, 'No pudimos iniciar sesión. Intenta de nuevo.');
}

/** Cómo se muestra un adjunto (igual que MessageMedia en la web): foto o sticker, audio, video o archivo. */
export function inboxMediaKind(message) {
  const mime = (message?.media_mime ?? '').toLowerCase();
  if (message?.kind === 'image' || message?.kind === 'sticker' || mime.startsWith('image/')) return 'image';
  if (message?.kind === 'audio' || mime.startsWith('audio/')) return 'audio';
  if (message?.kind === 'video' || mime.startsWith('video/')) return 'video';
  return 'file';
}

/** Ruta para pedir el adjunto al proceso principal: la autenticada de la API o el enlace firmado público. */
export const inboxMediaRef = message => message?.media_api_path || message?.media_url || null;

export const LOCAL_QUOTE_STATUS_LABELS = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Vencida',
  converted: 'Convertida en pedido',
};

/**
 * Cotizaciones guardadas en este equipo (Cotizador 3D) listas para pegar en el chat: solo las que tienen una
 * versión emitida y con el mismo texto comercial del cotizador (nunca costos internos). La más reciente primero.
 */
export function localQuoteItems(library, query = '', today = new Date().toISOString().slice(0, 10)) {
  const needle = foldText(query.trim());
  const items = [];
  for (const record of library?.quotes ?? []) {
    const versions = Array.isArray(record?.versions) ? record.versions : [];
    const version = versions.reduce((best, item) => (!best || Number(item?.version) > Number(best.version) ? item : best), null);
    if (!version?.input || !version?.result || !version?.configSnapshot) continue;
    const input = version.input;
    const status = record.status === 'sent' && input.validUntil && input.validUntil < today ? 'expired' : record.status;
    const customer = input.customer?.name || '';
    const haystack = foldText(`${record.number} ${customer} ${input.customer?.contact ?? ''} ${input.product ?? ''}`);
    if (needle && !haystack.includes(needle)) continue;
    let text = '';
    try {
      text = commercialText(commercialQuote(version, record.number));
    } catch {
      continue;
    }
    items.push({
      id: record.id,
      number: record.number,
      status,
      statusLabel: LOCAL_QUOTE_STATUS_LABELS[status] ?? status ?? '',
      customer,
      contact: input.customer?.contact || '',
      product: input.product || '',
      quantity: version.result.quantity ?? null,
      total: version.result.total ?? null,
      validUntil: input.validUntil || '',
      version: version.version,
      date: input.date || '',
      text,
    });
  }
  return items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number), 'es', { numeric: true }));
}

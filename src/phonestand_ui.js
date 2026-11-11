import { PlacementHandles, openerHandle } from './placement_handles.js';
// Módulo «Soporte celular llavero»: llavero que se abre en soporte para el celular (bisagra impresa en su lugar).
// Formulario paramétrico → core/phonestand.js (manifold) → vista 3D (como se imprime, abierto con celular, cerrado,
// de arriba; la pata gira en la bisagra, la bandeja NFC entra en su ranura y el chip se ve en dorado a través del
// cuerpo) → 3MF por colores (una pieza por color del logo, como los llaveros; la bandeja NFC como objeto aparte o la
// pausa del chip), STL, foto PNG y proyecto .r3p.
import * as THREE from 'three';
import { parse as parseFont } from 'opentype.js';
import { Viewer3D } from './viewer3d.js';
import { imageReady } from './core/imageload.js';
import { ensureFont } from './core/text.js';
import { FontPicker } from './font_picker.js';
import { threeMF, stlBinary } from './core/exporters.js';
import {
  PHONESTAND_SHAPES, PHONESTAND_FONTS, PHONESTAND_SIZES, PHONESTAND_VARIANTS, DEFAULT_PHONESTAND, normalizePhoneStand,
  preparePhoneStand, buildPhoneStand, phoneStandExport, shapeThumbnails, phoneStandProject, readPhoneStandProject,
} from './core/phonestand.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const parseNum = (s) => parseFloat(String(s).trim().replace(',', '.'));
const getK = (o, k) => k.split('.').reduce((a, p) => a?.[p], o);
const setK = (o, k, v) => { const ps = k.split('.'); const last = ps.pop(); ps.reduce((a, p) => (a[p] ??= {}), o)[last] = v; };
// rAF is paused while the window is hidden/occluded: never wait more than 100 ms for it.
const nextFrame = () => new Promise((r) => { const t = setTimeout(r, 100); requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); r(); }, 0)); });
const f1 = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
const D2R = Math.PI / 180;
const fileBase = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, '').trim() || 'soporte-celular';

const TABS = [['print', '🖨️ Como se imprime'], ['stand', '📱 Abierto con celular'], ['closed', '🔑 Cerrado (llavero)'], ['top', '⬆️ Vista de arriba']];
// camera azimuth / elevation (degrees) and the leg's pose (core info.poses) when the tab is chosen
const VIEWS = {
  print: { az: -30, el: 46, pose: 'print' }, stand: { az: 35, el: 18, pose: 'stand' },
  closed: { az: -30, el: 40, pose: 'closed' }, top: { az: 0, el: 89.5, pose: 'closed' },
};
// fields that change the outline of the shapes (thumbnails); colours, logo, text and extras do not
const OUTLINE_KEYS = ['shapeScale', 'width', 'size', 'variant', 'clearance', 'latch', 'ring'];

function readDataURL(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('no se pudo leer el archivo'));
    fr.readAsDataURL(file);
  });
}
// RGBA pixels (ImageData) at most `max` px on the long side; reuse the same object so the core's trace cache hits
async function imageDataFrom(src, max) {
  const img = new Image();
  img.src = /^data:image\/svg\+xml/i.test(src) ? svgSized(src, max) : src;
  try { await imageReady(img); } catch { throw new Error('la imagen está dañada o no es compatible'); }
  if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) throw new Error('la imagen no tiene tamaño');
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.naturalWidth * k));
  cv.height = Math.max(1, Math.round(img.naturalHeight * k));
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, cv.width, cv.height);
  return cx.getImageData(0, 0, cv.width, cv.height);
}
// A vector logo (SVG) is drawn `max` px on its long side whatever its own size, so its curves and thin lines come out
// sharp. Some SVGs have no size (only a viewBox) or one in mm: they get it here, in px, with a viewBox to scale into.
const SVG_UNIT = { px: 1, '': 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 4 / 3, pc: 16 };
function svgSized(src, max) {
  try {
    const comma = src.indexOf(','), head = src.slice(0, comma), body = src.slice(comma + 1);
    const text = /;base64/i.test(head) ? new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))) : decodeURIComponent(body);
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), svg = doc.documentElement;
    if (svg.nodeName.toLowerCase() !== 'svg') return src;
    const len = (a) => { const m = /^\s*([\d.]+(?:e[-+]?\d+)?)\s*(px|mm|cm|in|pt|pc)?\s*$/i.exec(svg.getAttribute(a) || ''); return m ? +m[1] * SVG_UNIT[(m[2] || '').toLowerCase()] : 0; };
    const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const hasVB = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
    let w = len('width'), h = len('height');
    if (!(w > 0 && h > 0)) { if (!hasVB) return src; [w, h] = [vb[2], vb[3]]; }
    if (!hasVB) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const k = max / Math.max(w, h);
    svg.setAttribute('width', String(Math.max(1, Math.round(w * k))));
    svg.setAttribute('height', String(Math.max(1, Math.round(h * k))));
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(doc));
  } catch {
    return src;
  }
}
const isImageFile = (f) => /^image\//.test(f.type || '') || /\.(png|jpe?g|webp|bmp|gif|svg)$/i.test(f.name || '');
export { readDataURL, imageDataFrom, isImageFile };

export class PhoneStandStudio {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.cfg = DEFAULT_PHONESTAND();
    this.logoSrc = null;    // dataURL of the client's logo (saved in the project)
    this.logoImg = null;    // its pixels
    this.logoName = '';
    this.shapeSrc = null;   // dataURL of the custom silhouette ("Tu silueta")
    this.shapeImg = null;
    this.shapeVer = 0;
    this.fonts = new Map(); // family → Promise<opentype font>
    this.res = null;        // last buildPhoneStand() result
    this.tab = 'print';
    this.amt = -1;          // leg: 0 = closed (keychain) … 1 = open on its stop (stand); −1 = the tab's pose
    this.seq = 0;
    this.building = false;
    this.engineReady = false;
    this.thumbs = null;
    this.thumbKey = '';
    this.build();
  }

  build() {
    const N = 'inputmode="decimal" type="text"';
    const tt = (title) => (title ? ` title="${esc(title)}"` : '');
    const num = (label, k, title = '') => `<label class="row"${tt(title)}>${label} <input ${N} data-k="${k}" /></label>`;
    const chk = (label, k, title = '') => `<label class="row"${tt(title)}>${label} <input type="checkbox" data-k="${k}" /></label>`;
    const sel = (label, k, opts, title = '', type = '') => `<label class="row"${tt(title)}>${label} <select data-k="${k}"${type === 'num' ? ' data-num' : ''}>${opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>`;
    const col = (label, k, title = '') => `<label class="row"${tt(title)}>${label} <input type="color" data-k="${k}" /></label>`;
    const fontOpts = Object.keys(PHONESTAND_FONTS).map((f) => `<option>${esc(f)}</option>`).join('');
    this.root.innerHTML = `
    <header class="topbar">
      <button class="btn" data-a="home">⌂ Inicio</button>
      <div class="brand"><span class="logo">◆</span> Relieve3D <span class="module-name">· 📱 Soporte celular llavero</span></div>
      <div class="tb-group">
        <button class="btn" data-a="logo" title="Logo o marca del cliente: PNG, JPG o SVG con fondo liso o transparente">🖼️ Logo</button>
        <button class="btn" data-a="openCfg" title="Abrir un proyecto .r3p">📂 Abrir</button>
        <button class="btn" data-a="saveCfg" title="Guarda las medidas, el logo y la silueta en un archivo .r3p">💾 Guardar proyecto</button>
        <button class="btn" data-a="reset" title="Vuelve a las medidas y opciones por defecto; conserva el logo y la silueta cargados">↺ Por defecto</button>
        <button class="btn" data-a="photo" title="PNG de la vista actual con fondo claro, para mostrarle el diseño al cliente">📸 Foto</button>
      </div>
      <div class="spacer"></div>
      <button class="btn" data-a="stl" title="Un solo STL, sin la pausa del NFC: agrégala a mano en el laminador. Para llevar la pausa usa 3MF. Apaga los soportes">⬇ STL</button>
      <button class="btn primary" data-a="3mf" title="3MF con una pieza por color del logo, pausa para insertar el NFC antes de cerrar su bolsillo y soportes apagados (Bambu Studio / OrcaSlicer). Si eliges bandeja, sale como objeto aparte">⬇ Exportar 3MF</button>
    </header>
    <main class="layout studio-layout hb-layout ps-layout">
      <aside class="panel left">
        <section class="card">
          <h3>❤️ Forma de arriba</h3>
          <div class="ps-shapes" data-r="shapes"></div>
          ${num('Tamaño de la forma (%)', 'shapeScale', 'De 70 a 140 %: agrándala para que quepan el logo, el chip NFC o el abre latas')}
          <div data-show="custom">
            <button class="btn wide" data-a="shapeFile">⬆ Cambiar silueta (PNG/JPG/SVG)</button>
            <div class="muted small">Silueta oscura sobre fondo claro, o PNG transparente. Se une al cuerpo por abajo y se le abre el agujero de la argolla.</div>
          </div>
        </section>
        <section class="card">
          <h3>🏷️ Logo o marca del cliente</h3>
          <div class="ps-logo" data-r="logoBox"></div>
          <button class="btn wide" data-a="logo">🖼️ Cargar logo (PNG/JPG/SVG)</button>
          ${chk('Poner el logo', 'logo.enabled')}
          <div data-show="logo">
            <div data-show="barOk">${sel('Dónde', 'logo.where', [['top', 'En la forma de arriba'], ['bar', 'En la barra (detrás de la bisagra)']], 'La barra es la franja lisa entre la bisagra y la forma de arriba. En el modelo corto todo va en la forma de arriba')}</div>
            ${num('Tamaño (%)', 'logo.size', '100 % = lo más grande que cabe. Con más de 100 % se recorta en el borde')}
            ${num('Mover a la derecha (mm)', 'logo.dx', 'Negativo = hacia la izquierda')}
            ${num('Mover hacia arriba (mm)', 'logo.dy', 'Negativo = hacia abajo')}
            <div data-show="layers">
              <h4>🎨 Colores del logo</h4>
              <div class="st-palette ps-palette" data-r="layers"></div>
              ${sel('Colores a detectar', 'logo.colors', [['0', 'Automático'], ...[1, 2, 3, 4, 5, 6].map((n) => [String(n), String(n)])], 'Cuántos colores separar en el logo. Súbelo si dos colores salen juntos; bájalo para unir colores parecidos', 'num')}
            </div>
            <details class="ps-adv"><summary>Trazos finos y vectorizado</summary>
              ${num('Trazo mínimo (mm)', 'logo.minLine', 'Las líneas, puntas y puntos más delgados que esto se engruesan para que la impresora los haga (0,5 mm con boquilla de 0,4; 0,3 con boquilla de 0,2). De 0,3 a 1,2 mm')}
              ${num('Tolerancia del fondo', 'logo.tolerance', 'De 5 a 120: qué tan distinto del fondo debe ser un color para contar como logo')}
            </details>
          </div>
        </section>
        <section class="card">
          <h3>✍️ Texto o nombre</h3>
          ${chk('Agregar texto', 'text.enabled', 'Nombre de la marca, de la persona o una frase corta (máximo 40 letras)')}
          <div data-show="text">
            <label class="row">Texto <input type="text" data-k="text.value" maxlength="40" placeholder="Ej.: Pabonitas" /></label>
            <div data-show="barOk">${sel('Dónde', 'text.where', [['bar', 'En la barra (detrás de la bisagra)'], ['top', 'En la forma de arriba']])}</div>
            <label class="row">Fuente <select data-k="text.font">${fontOpts}</select></label>
            <div data-show="textSize">${num('Tamaño (%)', 'text.size', '100 % = lo más grande que cabe')}</div>
            <div data-show="textRel">${num('Alto de letra (% del logo)', 'text.rel', 'El texto va debajo del logo, con esta altura de letra')}</div>
            <label class="row" title="Color del filamento del texto. ↺ = el color de acento">Color del texto <span class="ps-tcol"><button class="btn mini" data-a="textAccent" title="Usar el color de acento">↺</button><input type="color" data-k="text.color" /></span></label>
            <div data-show="relief">${num('Alto del texto (mm)', 'text.height', '0 = el mismo alto del relieve del logo. De 0,4 a 3 mm')}</div>
          </div>
        </section>
        <section class="card">
          <h3>🎨 Acabado y colores</h3>
          ${sel('Logo y texto', 'logo.mode', [['relief', 'En relieve (sobresale)'], ['flat', 'Liso multicolor (tipo llavero)'], ['engrave', 'Grabado (hundido)']], 'Relieve: cada color sobresale a su altura. Liso: los colores quedan incrustados al ras de la cara, planos como un llavero multicolor (lo más nítido para logos pequeños). Grabado: hundido en la pieza. La señal 📶 del NFC se hace igual')}
          <div data-show="relief">${num('Alto del relieve (mm)', 'logo.height', 'Alto de las capas del logo, del texto y de la señal 📶 (cada capa del logo puede tener el suyo). De 0,4 a 3 mm')}</div>
          <div data-show="flat">${num('Profundidad del color (mm)', 'logo.flatDepth', 'En capas de 0,2 mm. 0,2 = todos los colores en una sola capa: lo más nítido para detalles pequeños. 0,4 o más tapa mejor un color claro sobre un cuerpo oscuro')}</div>
          <div data-show="engrave">${num('Profundidad (mm)', 'logo.depth')}</div>
          <div class="ps-tip muted small" data-show="relief">💡 ¿Logo pequeño o con líneas finas? Usa <b>Liso multicolor</b> a 0,2 mm: todos los colores quedan en una sola capa, planos y nítidos, como los llaveros.</div>
          <div class="ps-tip muted small" data-show="flat">💡 A 0,2 mm todos los colores van en la última capa: el llavero queda liso. Las líneas más delgadas que el trazo mínimo se engruesan para que salgan.</div>
          ${col('Color del cuerpo', 'colors.body')}
          ${col('Color de acento', 'colors.accent', 'Para un logo de un solo color, el texto y la señal 📶 (y la pata si la pones a color)')}
          ${chk('Logo y texto a color (AMS)', 'colors.twoColor', 'Cada color del logo, el texto y la señal 📶 en su filamento: necesita AMS o cambiar el filamento en una pausa. Apagado: todo sale del color del cuerpo')}
          ${chk('Pata en el color de acento', 'colors.flapAccent', 'La pata de la bisagra (la que sostiene el celular) en el color de acento')}
        </section>
      </aside>

      <section class="center">
        <div class="hb-tabs seg" data-r="tabs">${TABS.map(([k, l]) => `<button class="seg-btn" data-tab="${k}">${l}</button>`).join('')}
          <span class="spacer"></span>
          <label class="cs-explode" title="Gira la pata en la bisagra: a la izquierda cerrada (llavero), a la derecha abierta sobre su tope (soporte)">Mover la pata <input type="range" min="0" max="1" step="0.01" value="0" data-r="amt" /></label>
          <button class="btn mini" data-a="animate" title="Mira cómo se abre la pata y se apoya el celular">▶ Animar</button>
        </div>
        <div class="views mode-3d"><div class="view dark" data-r="view"></div></div>
        <div class="statusbar"><span data-r="status"></span><span class="spacer"></span><span data-r="time"></span></div>
      </section>

      <aside class="panel right">
        <section class="card">
          <h3>✨ Extras</h3>
          ${chk('📶 Chip NFC', 'nfc.enabled', 'Por defecto queda sellado dentro del llavero: la impresora pausa con el bolsillo abierto, colocas el chip y continúas para taparlo. Sin bandeja ni ranura lateral. En la vista se ve en dorado a través del cuerpo')}
          <div data-show="nfc">
            ${sel('Cómo va el chip', 'nfc.mount', [['pause', 'Sellado con pausa (recomendado)'], ['tray', 'Bandeja tipo SIM (opcional)']], 'Pausa: solo un bolsillo interno, sin pieza adicional ni abertura lateral; el 3MF incluye la pausa antes de la tapa. Bandeja: alternativa si necesitas cambiar el chip después')}
            <div data-show="nfcTray">${sel('Ranura por el lado', 'nfc.side', [['auto', 'Automático (lejos del abre latas)'], ['right', 'Derecho'], ['left', 'Izquierdo']], 'Por dónde entra la bandeja. Automático: el lado contrario al abre latas')}</div>
            ${num('Diámetro del chip (mm)', 'nfc.diameter', 'Los stickers NFC redondos (NTAG213/215) miden 25 mm: deja 0,5 mm de juego. Si no cabe, la forma de arriba se alarga sola')}
            ${num('Grosor del chip (mm)', 'nfc.depth', 'Se redondea a capas de 0,2 mm')}
            ${sel('Dónde', 'nfc.where', [['auto', 'Automático (debajo del logo)'], ['top', 'En la forma de arriba'], ['bar', 'Cerca de la bisagra']], 'Automático: debajo del logo, así el cliente sabe dónde tocar con el celular. Arriba: lo más alto que quepa sin tocar el aro del llavero')}
            ${chk('Señal 📶 encima del chip', 'nfc.mark', 'El símbolo de pago sin contacto sobre el chip, para saber dónde tocar con el celular. Se hace como el logo (relieve, liso o grabado) y en el color de acento. Si el logo ya está encima del chip no hace falta')}
          </div>
          <div class="small muted">Arrastra el punto naranja para mover el abre latas y el azul para mover el agujero del llavero.</div>
          ${chk('🥫 Abre latas', 'opener.enabled', 'Ranura en un borde: mete la pestaña de la lata y haz palanca. Si no hay borde libre, la forma de arriba se alarga sola')}
          <div data-show="opener">${chk('Muesca inferior en el abre latas', 'opener.notch')}</div>
          ${chk('🔑 Agujero para la argolla', 'ring.enabled')}
          <div data-show="ring">${num('Diámetro del agujero (mm)', 'ring.diameter')}</div>
        </section>
        <section class="card">
          <h3>📏 Medidas</h3>
          <label class="row">Nombre <input type="text" data-k="name" maxlength="60" /></label>
          ${sel('Tamaño', 'size', PHONESTAND_SIZES.map((s) => [s.id, s.name]), 'Pequeño: 11 mm de grueso, para celulares de hasta 11,6 mm con forro. Grande: 12 mm y pata más larga, para celulares de hasta 12,7 mm con forro')}
          ${sel('Modelo', 'variant', PHONESTAND_VARIANTS.map((s) => [s.id, s.name]), 'Estándar: con barra detrás de la bisagra; sostiene el celular parado y acostado. Corto: más pequeño, mejor con el celular acostado')}
          ${num('Ancho (mm)', 'width', 'De 30 a 46 mm (36 = como el modelo de referencia)')}
          ${num('Holgura de la bisagra (mm)', 'clearance', 'Juego de la bisagra impresa en su lugar. 0,3 mm sirve en la mayoría de impresoras bien calibradas; si la pata sale pegada súbela a 0,4; si queda floja bájala a 0,25')}
          <details class="ps-adv"><summary>Avanzado</summary>
            ${num('Clic de cierre (mm)', 'latch', 'De 0 a 0,6: cuánto se traba la pata cerrada para que no se abra en el bolsillo. 0 = sin clic')}
            ${num('Radio del pasador (mm)', 'pin', 'Radio de los conos de la bisagra; se limita solo según el grosor')}
            ${num('Pared de la argolla (mm)', 'ring.wall', 'Material mínimo alrededor del agujero de la argolla')}
          </details>
        </section>
        <section class="card grow">
          <h3>✅ Resultado</h3>
          <div class="hb-warn" data-r="warn"></div>
          <div class="hb-list small" data-r="list"></div>
          <div class="ps-tip muted small">🖨️ PLA · capas de 0,2 mm · <b>sin soportes</b> (el 3MF ya los apaga y bloquea; con STL apágalos tú) · imprímelo tal como sale: el cuerpo acostado y la pata parada en su ranura; la bisagra sale armada. Al terminar, mueve la pata con cuidado hacia adelante y hacia atrás para soltarla y dóblala hasta que haga clic. Para abrirla, mete la uña en la muesca del frente, debajo de la punta de la pata.<span data-show="nfcTray"> 📶 La bandeja sale al lado: pon el chip en su hueco y deslízala por la ranura del lado hasta que haga clic; para sacarla, hálala con la uña desde la muesca.</span><span data-show="nfcPause"> 📶 Exporta en <b>3MF</b>: la pausa deja el bolsillo abierto. Coloca el chip plano, sin que sobresalga, y continúa para sellarlo. No hay bandeja ni ranura lateral; una vez tapado no se puede cambiar el chip. Al abrir el 3MF en Bambu Studio, conserva la configuración y comprueba la pausa en la vista previa; no lo importes solo como geometría.</span></div>
        </section>
      </aside>
    </main>
    <input type="file" data-r="fileLogo" accept="image/*,.svg" hidden />
    <input type="file" data-r="fileShape" accept="image/*,.svg" hidden />
    <input type="file" data-r="fileCfg" accept=".r3p,.json" hidden />`;
    this.$ = (n) => this.root.querySelector(`[data-r="${n}"]`);
    this.picker = new FontPicker(this.root.querySelector('[data-k="text.font"]'), {
      sample: () => ({ text: this.cfg.text.value || 'Tu marca', weight: 400 }), label: 'Fuente del texto', onError: this.cb.toast,
      loadFont: (family) => ensureFont(family, 400, { file: PHONESTAND_FONTS[family] }),
    });
    this.renderShapes();
    this.bind();
  }

  bind() {
    const r = this.root;
    r.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]')?.dataset.tab;
      if (tab) { this.setTab(tab); return; }
      const shape = e.target.closest('[data-shape]')?.dataset.shape;
      if (shape) { this.pickShape(shape); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'home') { this.stopAnim(); this.cb.onBack(); }
      else if (a === 'logo') this.$('fileLogo').click();
      else if (a === 'clearLogo') this.clearLogo();
      else if (a === 'textAccent') this.setTextColor('');
      else if (a === 'shapeFile') this.$('fileShape').click();
      else if (a === 'openCfg') this.$('fileCfg').click();
      else if (a === 'saveCfg') this.saveProject();
      else if (a === 'reset') this.reset();
      else if (a === 'photo') this.photo();
      else if (a === 'stl') this.exportSTL();
      else if (a === '3mf') this.export3MF();
      else if (a === 'animate') this.animate();
    });
    const onInput = (e) => {
      const el = e.target;
      if (el.dataset.r === 'amt') { this.stopAnim(); this.setAmt(+el.value); return; }
      if (el.dataset.lm) { this.onLayer(el, e.type); return; }
      const k = el.dataset.k;
      if (!k) return;
      const decimal = el.getAttribute('inputmode') === 'decimal';
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (decimal) { v = parseNum(el.value); if (!Number.isFinite(v)) return; }
      else if ('num' in el.dataset) v = +el.value;
      else v = el.value;
      const prev = getK(this.cfg, k);
      setK(this.cfg, k, v);
      // on leaving a number field show the value really used (limited to its range)
      if (decimal && e.type === 'change') { const nv = getK(normalizePhoneStand(this.cfg), k); setK(this.cfg, k, nv); el.value = String(nv); }
      if (getK(this.cfg, k) === prev) return;
      if (k === 'name') return;   // only names the exported files
      if (k === 'colors.body' || k === 'colors.accent') { this.recolor(k, prev, v); return; }
      if (k === 'text.color') { this.setTextColor(v); return; }
      if (k === 'text.value') this.picker.sync();
      this.updateVisibility();
      if (k === 'logo.mode') this.renderLayers();
      this.schedule();
    };
    r.addEventListener('input', onInput);
    r.addEventListener('change', onInput);
    this.$('fileLogo').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await this.loadLogo(f); });
    this.$('fileShape').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await this.loadShape(f); });
    this.$('fileCfg').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { await this.openProject(await f.text()); } catch (err) { this.cb.toast('No se pudo abrir el proyecto: ' + err.message, true); }
    });
  }

  async open() {
    this.root.hidden = false;
    this.sync();
    if (!this.viewer) {
      this.viewer = new Viewer3D(this.$('view'));
      this.handles = new PlacementHandles(this.viewer, (id, point) => {
        if (id === 'opener') {
          this.cfg.opener.target = point;
          this.cfg.opener.side = point.x < 0 ? 'left' : 'right';
        } else this.cfg.ring.target = point;
        this.sync();
        this.schedule();
      });
    }
    this.viewer.resize();
    if (!this.engineReady) {
      this.cb.showBusy('Preparando el motor 3D…');
      try {
        await preparePhoneStand();
        this.engineReady = true;
      } catch (err) {
        console.error(err);
        this.cb.toast('No se pudo cargar el motor 3D: ' + err.message, true);
        return;
      } finally { this.cb.hideBusy(); }
    }
    if (!this.res) {
      this.cb.showBusy('Generando el soporte…');
      try { await this.rebuild(); } finally { this.cb.hideBusy(); }
    } else this.applyView(true);
  }

  // ------------------------------------------------------------------ form <-> cfg
  sync() {
    const c = this.cfg;
    for (const el of this.root.querySelectorAll('[data-k]')) {
      const k = el.dataset.k;
      // the text without its own colour uses the accent colour
      const v = k === 'text.color' ? c.text.color || c.colors.accent : getK(c, k);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v ?? '';
    }
    this.picker.sync();
    this.root.style.setProperty('--ps-accent', c.colors.accent);
    this.renderLogoBox();
    this.renderLayers();
    this.markShape();
    this.updateVisibility();
  }

  updateVisibility() {
    const c = this.cfg, m = c.logo.mode;
    // the short variant has no bar: logo and text both go on the shape
    const wh = (w) => (c.variant === 'short' ? 'top' : w);
    const share = c.logo.enabled && !!this.logoImg && c.text.enabled && wh(c.logo.where) === wh(c.text.where);
    const tray = c.nfc.enabled && c.nfc.mount === 'tray';
    const show = {
      custom: c.shape === 'custom', logo: c.logo.enabled, text: c.text.enabled, textRel: share, textSize: !share, barOk: c.variant !== 'short',
      relief: m === 'relief', flat: m === 'flat', engrave: m === 'engrave', layers: c.logo.enabled && !!this.logoImg,
      nfc: c.nfc.enabled, nfcTray: tray, nfcPause: c.nfc.enabled && !tray, opener: c.opener.enabled, ring: c.ring.enabled,
    };
    for (const el of this.root.querySelectorAll('[data-show]')) el.hidden = !show[el.dataset.show];
  }

  renderLogoBox() {
    this.$('logoBox').innerHTML = this.logoSrc
      ? `<img src="${esc(this.logoSrc)}" alt="logo" /><span class="muted small" title="${esc(this.logoName)}">${esc(this.logoName || 'Logo')}</span><button class="btn mini" data-a="clearLogo" title="Quitar el logo">✕</button>`
      : '<span class="muted small">Sin logo: carga el PNG, JPG o SVG del cliente (fondo liso o transparente). También puedes arrastrarlo aquí.</span>';
  }

  // «Colores del logo»: one row per colour found in the logo, like the keychains' palette: detected colour → filament
  // colour, print it / in the body's colour / leave it out, and (relief) its own height; engraved: carve it or not.
  // The rows are rebuilt only when the colours or the finish change; otherwise their values are refreshed in place
  // (never the field being typed in).
  renderLayers() {
    const box = this.$('layers');
    const L = this.cfg.logo.enabled && this.logoImg ? this.res?.info.logo : null;
    if (!L?.length) { if (this._layerSig) { box.innerHTML = ''; this._layerSig = ''; } return; }
    const c = this.cfg, fin = c.logo.mode, carve = fin === 'engrave';
    const sig = JSON.stringify([L.map((e) => e.key), fin]);
    if (sig !== this._layerSig) {
      box.innerHTML = L.map((e) => `<div class="st-pal ps-pal" data-layer="${e.idx}">
        <span class="num">${e.idx + 1}</span>
        <span class="sw" style="background:${esc(e.hex)}" title="Color ${e.idx + 1} del logo: ${esc(e.hex)} · ${Math.max(1, Math.round(e.area * 100))} % del dibujo"></span>${carve ? '' : '→'}
        ${carve ? `<select data-lm="mode" title="Grabar: esta parte del logo se marca hundida en el cuerpo. Quitar: no se graba">
          <option value="on">Grabar</option><option value="off">Quitar</option></select>`
        : `<input type="color" data-lm="color" title="Color del filamento para este color del logo" />
        <select data-lm="mode" title="Imprimir: en el color de la izquierda. Color del cuerpo: sale del mismo filamento del cuerpo. Quitar: esta parte del logo no se hace">
          <option value="on">Imprimir</option><option value="body">Color del cuerpo</option><option value="off">Quitar</option></select>`}
        ${fin === 'relief' ? '<span class="h-wrap" title="Alto de este color en mm (vacío = el alto del relieve)"><input type="text" inputmode="decimal" data-lm="height" /><span class="unit">mm</span></span>' : ''}
      </div>`).join('');
      this._layerSig = sig;
    }
    const rows = box.querySelectorAll('[data-layer]');
    L.forEach((e, i) => {
      const row = rows[i], mode = !e.on ? 'off' : !carve && e.color === c.colors.body ? 'body' : 'on';
      row.classList.toggle('off', !!e.skipped);
      row.title = e.skipped === 'body' ? 'En el acabado liso este color queda del color del cuerpo: no se imprime aparte'
        : e.on && !e.used ? 'Esta parte del logo es tan pequeña que no queda en la pieza: agranda el logo' : '';
      const set = (sel, v) => { const el = row.querySelector(sel); if (el && el !== document.activeElement) el.value = v; };
      set('[data-lm=color]', e.color);
      set('[data-lm=mode]', mode);
      set('[data-lm=height]', e.height ? String(e.height) : '');
      const h = row.querySelector('[data-lm=height]');
      if (h) h.placeholder = String(c.logo.height);
    });
  }

  // a change in a «Colores del logo» row: stored in cfg.logo.layers under the colour it was detected as
  onLayer(el, type) {
    const row = el.closest('[data-layer]'), e = this.res?.info.logo?.[+row?.dataset.layer];
    if (!e) return;
    const c = this.cfg, L = c.logo.layers;
    const cur = { color: e.color, height: e.height, on: e.on, ...L[e.key] };
    const own = this.res.info.logo.length === 1 ? c.colors.accent : e.hex;   // its colour when it has none chosen
    const lm = el.dataset.lm, modeEl = row.querySelector('[data-lm=mode]'), colEl = row.querySelector('[data-lm=color]');
    if (lm === 'color') {
      cur.color = el.value;
      cur.on = true;
      modeEl.value = cur.color === c.colors.body ? 'body' : 'on';
    } else if (lm === 'mode') {
      cur.on = el.value !== 'off';
      if (el.value === 'body') cur.color = c.colors.body;
      else if (el.value === 'on' && colEl && cur.color === c.colors.body) cur.color = own;
      if (colEl) colEl.value = cur.color;
    } else if (lm === 'height') {
      const v = parseNum(el.value);
      cur.height = el.value.trim() === '' || !(v > 0) ? 0 : v;
      if (type === 'change') {
        cur.height = cur.height ? Math.min(3, Math.max(0.2, cur.height)) : 0;
        el.value = cur.height ? String(cur.height) : '';
      }
    }
    const old = L[e.key];
    if (old && old.color === cur.color && old.height === cur.height && old.on === cur.on) return;
    L[e.key] = { color: cur.color, height: cur.height, on: cur.on };
    if (lm !== 'height') this.paint((p) => p.layer === e.key, cur.color);
    this.schedule();
  }

  setTextColor(v) {
    const c = this.cfg;
    c.text.color = v === c.colors.accent ? '' : v || '';
    const el = this.root.querySelector('[data-k="text.color"]');
    if (el && el !== document.activeElement) el.value = c.text.color || c.colors.accent;
    this.paint((p) => p.layer === 'text', c.text.color || c.colors.accent);
    this.schedule();
  }

  // shape buttons with a live outline of each shape (window and key-ring hole included)
  renderShapes() {
    if (this.engineReady) {
      const n = normalizePhoneStand(this.cfg);
      const key = JSON.stringify([OUTLINE_KEYS.map((k) => n[k]), this.shapeVer]);
      if (key !== this.thumbKey) {
        try { this.thumbs = shapeThumbnails(n, { shapeImage: this.shapeImg }); this.thumbKey = key; } catch (err) { console.warn('miniaturas', err); }
      } else if (this.$('shapes').childElementCount) { this.markShape(); return; }
    }
    const t = this.thumbs || {};
    this.$('shapes').innerHTML = PHONESTAND_SHAPES.map((s) => {
      const th = t[s.id];
      const art = s.id === 'custom' && (!th || th.custom) ? '<span class="ps-up">⬆</span>'
        : th ? `<svg viewBox="${th.viewBox}" preserveAspectRatio="xMidYMid meet"><path d="${th.d}" fill-rule="evenodd"/></svg>` : '<span class="ps-up ps-wait">…</span>';
      return `<button class="ps-shape" data-shape="${s.id}" title="${esc(s.id === 'custom' ? 'Tu silueta: sube una imagen con la forma que quieras' : s.name)}">${art}<span>${esc(s.name)}</span></button>`;
    }).join('');
    this.markShape();
  }

  markShape() {
    for (const b of this.root.querySelectorAll('[data-shape]')) b.classList.toggle('active', b.dataset.shape === this.cfg.shape);
  }

  pickShape(id) {
    if (id === 'custom' && !this.shapeImg) { this.$('fileShape').click(); return; }
    if (this.cfg.shape === id) return;
    this.cfg.shape = id;
    this.markShape();
    this.updateVisibility();
    this.schedule();
  }

  reset() {
    this.stopAnim();
    this.cfg = DEFAULT_PHONESTAND();
    this.sync();
    this.schedule();
    this.cb.toast('Valores por defecto (se conservan el logo y la silueta)');
  }

  // ------------------------------------------------------------------ build
  schedule() {
    clearTimeout(this._t);
    this._t = setTimeout(() => { this._t = null; this.rebuild(); }, 250);
  }

  // resolves when no rebuild is pending or running (exports and tests use the latest model)
  async whenIdle() {
    if (this._t) { clearTimeout(this._t); this._t = null; await this.rebuild(); }
    while (this.building) await new Promise((r) => setTimeout(r, 30));
  }

  async textFont() {
    const t = this.cfg.text;
    if (!t.enabled || !String(t.value || '').trim()) return null;
    const fam = PHONESTAND_FONTS[t.font] ? t.font : DEFAULT_PHONESTAND().text.font;
    if (!this.fonts.has(fam)) {
      this.fonts.set(fam, fetch('fonts/' + PHONESTAND_FONTS[fam])
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then((buf) => parseFont(buf)));
    }
    try { return await this.fonts.get(fam); } catch (err) {
      console.warn('fuente', fam, err);
      this.fonts.delete(fam);
      return null;   // the core warns that the text was left out
    }
  }

  async rebuild() {
    clearTimeout(this._t); this._t = null;
    const my = ++this.seq;
    this.building = true;
    this.$('status').textContent = '⏳ Generando…';
    try {
      await preparePhoneStand();
      this.engineReady = true;
      const font = await this.textFont();
      await nextFrame();
      if (my !== this.seq) return;
      const t0 = performance.now();
      this.renderShapes();
      const res = buildPhoneStand(this.cfg, { logoImage: this.logoImg, shapeImage: this.shapeImg, font });
      this.res = res;
      this.$('time').textContent = `${Math.round(performance.now() - t0)} ms`;
      this.renderInfo();
      this.render3D();
    } catch (err) {
      console.error(err);
      if (my === this.seq) {
        this.$('status').textContent = '⚠ No se pudo generar';
        this.cb.toast('No se pudo generar el soporte: ' + err.message, true);
      }
    } finally {
      if (my === this.seq) this.building = false;
    }
  }

  renderInfo() {
    const res = this.res;
    if (!res) return;
    const i = res.info;
    this.$('warn').innerHTML = res.warnings.length
      ? res.warnings.map((w) => `<div class="hb-w">⚠ ${esc(w)}</div>`).join('')
      : '<div class="hb-ok">✓ Listo para imprimir: sin soportes (el 3MF los apaga) y con la bisagra armada.</div>';
    const sw = (color) => `<span class="sw" style="background:${esc(color)}"></span>`;
    const row = (k, v) => `<div class="hb-pc"><span>${k}</span><span class="muted">${v}</span></div>`;
    const name = (list, id) => list.find((s) => s.id === id)?.name || id;
    const shapeName = name(PHONESTAND_SHAPES, i.shape.id);
    const real = res.parts.filter((p) => !p.preview);
    const dims = (s) => `${f1(s.w)} × ${f1(s.l)} × ${f1(s.h)} mm`;
    const ok = (v) => (v >= 0 ? '✓' : '⚠ puede voltearse');
    const grown = i.shape.grow ? ` · alargada ${f1(i.shape.grow)} mm para que quepa${i.shape.growFor.length > 1 ? 'n' : ''} ${i.shape.growFor.map((k) => (k === 'nfc' ? 'el chip NFC' : 'el abre latas')).join(' y ')}` : '';
    let h = row('Forma', esc(shapeName) + grown);
    h += row('Modelo', `${esc(name(PHONESTAND_SIZES, i.model.size))} · ${esc(name(PHONESTAND_VARIANTS, i.model.variant))}`);
    h += row('Llavero cerrado', dims(i.closedSize));
    h += row('Al imprimir', `${f1(i.size.h)} mm de alto (la pata sale parada)`);
    h += row('Peso aprox.', `${f1(i.grams)} g de PLA`);
    h += row('Filamentos', `${res.filaments.length} ${res.filaments.map(sw).join('')}`);
    h += row('Celular', `inclinado ${f1(i.phone.angle)}° · hasta ${f1(i.phone.tMax)} mm de grueso con forro`);
    h += row('Estabilidad', `vertical ${ok(i.stability.portrait)} · horizontal ${ok(i.stability.landscape)}${i.phone.landscape ? ' · úsalo horizontal' : ''}`);
    h += row('Bisagra', `conos Ø${f1(i.hinge.pinDiameter)} mm · holgura ${f1(i.hinge.clearance)} mm`);
    h += row('Cierre', i.latch ? `clic de ${f1(i.latch.interference)} mm (no se abre en el bolsillo)` : 'sin clic');
    h += row('Muesca para abrir', `${f1(i.notch.width)} mm al frente · ${f1(i.notch.under)} mm bajo la punta de la pata para la uña`);
    if (i.ring) h += row('Argolla', `agujero Ø${f1(2 * i.ring.r)} mm con chaflán, arriba en la forma${i.ring.r < i.ring.asked - 1e-9 ? ` (Ø${f1(2 * i.ring.asked)} no cabe en esta forma)` : ''}`);
    const br = { opener: 'abre latas', tray: 'ranura NFC', pocket: 'tapa del chip' };
    h += row('Soportes', `ninguno${i.print.bridges.length ? ` · puentes: ${i.print.bridges.map((b) => `${br[b.kind]} ${f1(b.span)} mm`).join(', ')}` : ''}`);
    const made = { relief: 'en relieve', flat: 'a ras', engrave: 'grabada' }[i.art.mode];
    if (i.nfc) {
      const n = i.nfc;
      const where = n.covered ? `debajo del ${n.under}: toca el ${n.under} con el celular` : n.where === 'bar' ? 'cerca de la bisagra' : 'en la forma de arriba';
      h += row('Chip NFC 📶', `Ø${f1(2 * n.r)} mm · ${where}${n.mark ? ` · señal 📶 ${made} encima: toca la señal con el celular` : ''}`);
      if (n.mount === 'tray') h += row('Bandeja NFC 📶', `entra por el lado ${n.side === 'left' ? 'izquierdo' : 'derecho'} hasta el clic · se imprime aparte, sin pausa`);
      else h += row('Pausa NFC', `a Z = ${f1(n.z1)} mm: mete el chip y continúa para sellarlo · sin bandeja ni ranura lateral`);
    }
    if (i.opener) h += row('Abre latas', `lado ${i.opener.side === 'left' ? 'izquierdo' : 'derecho'}${i.opener.angle ? ` · girado ${i.opener.angle}°` : ''}`);
    for (const w of ['top', 'bar']) {
      const a = i.art[w];
      if (a) h += row(a.logo && a.text ? 'Logo y texto' : a.logo ? 'Logo' : 'Texto', `${f1(a.w)} × ${f1(a.h)} mm ${w === 'top' ? 'en la forma' : 'en la barra'}`);
    }
    if (i.art.top || i.art.bar) {
      const c = res.cfg.logo, depth = i.art.mode === 'flat' ? c.flatDepth : c.depth;
      const fin = i.art.mode === 'relief' ? `en relieve ${f1(c.height)} mm` : i.art.mode === 'flat'
        ? `liso a ras · color de ${f1(depth)} mm (${Math.round(depth / 0.2)} capa${depth > 0.21 ? 's' : ''})` : `grabado ${f1(depth)} mm`;
      h += row('Acabado', `${fin} · trazo mínimo ${f1(i.art.minLine)} mm`);
    }
    h += '<h4>Piezas del 3MF</h4>';
    h += real.map((p) => `<div class="hb-pc"><span>${sw(p.color)} ${esc(p.name)}</span><span class="muted">filamento ${p.filamentIndex + 1}${p.apart ? ' · objeto aparte' : ''}</span></div>`).join('');
    if (real.length < res.parts.length) h += `<div class="hb-pc"><span>${sw('#d9a400')} Chip NFC</span><span class="muted">solo en la vista (va en ${i.nfc?.mount === 'tray' ? 'la bandeja' : 'la pausa'})</span></div>`;
    this.$('list').innerHTML = h;
    this.$('status').textContent = `${shapeName} · ${dims(i.closedSize)} · ${f1(i.grams)} g${res.warnings.length ? ` · ⚠ ${res.warnings.length} aviso(s)` : ''}`;
    this.renderLayers();
  }

  // body/accent colour: what had the old colour (body, leg, tray, accent-coloured logo/text/📶, logo colours set to it)
  // is repainted at once and keeps following it; the rebuild after it regroups the filaments
  recolor(k, prev, v) {
    const c = this.cfg;
    this.root.style.setProperty('--ps-accent', c.colors.accent);
    for (const l of Object.values(c.logo.layers)) if (l.color === prev) l.color = v;
    if (c.text.color === prev) c.text.color = v;
    const tc = this.root.querySelector('[data-k="text.color"]');
    if (tc) tc.value = c.text.color || c.colors.accent;
    for (const el of this.root.querySelectorAll('[data-lm=color]')) if (el.value === prev) el.value = v;
    this.paint((p) => p.color === prev, v);
    this.schedule();
  }

  // repaints the pieces that match at once (no rebuild); art follows the body when the logo is not in colour
  paint(match, color) {
    const res = this.res, c = this.cfg.colors;
    if (!res) return;
    res.parts.forEach((p, i) => {
      if (p.preview || !match(p)) return;
      p.color = p.art && !c.twoColor ? c.body : color;
      this.viewer?.meshes.get('p' + i)?.material.color.set(p.color);
    });
    this.viewer?.requestRender();
  }

  // ------------------------------------------------------------------ 3D view
  render3D() {
    const v = this.viewer, res = this.res;
    if (!v || !res) return;
    if (this.pivot) { v.model.remove(this.pivot); this.pivot = null; }
    this.handles.clear();
    v.clear();
    // the leg turns about the hinge axis (X through y = axis.y, z = axis.z)
    const { axis } = res;
    const pivot = new THREE.Group();
    pivot.position.set(0, axis.y, axis.z);
    v.model.add(pivot);
    this.pivot = pivot;
    res.parts.forEach((p, i) => {
      const m = v.addPiece('p' + i, p.geometry);
      v.updatePiece('p' + i, { color: p.color, height: 1, z: 0, visible: true });
      if (p.moving) { v.model.remove(m); m.position.set(0, -axis.y, -axis.z); pivot.add(m); }
      if (p.preview) {
        // the hidden NFC chip, seen through the body (x-ray) in gold
        Object.assign(m.material, { transparent: true, opacity: 0.5, depthTest: false, depthWrite: false });
        m.material.emissive.set(p.color);
        m.material.emissiveIntensity = 0.45;
        m.material.needsUpdate = true;
        m.renderOrder = 10;
      } else if (p.art) {
        // logo/text/📶 sign drawn after the chip (still hidden by whatever is in front), so they show over it
        m.material.transparent = true;
        m.material.needsUpdate = true;
        m.renderOrder = 11;
      }
    });
    v.setExtra('phone', res.phone, { color: '#1f2937' });
    const ph = v.extras.get('phone');
    Object.assign(ph.material, { transparent: true, opacity: 0.5, depthWrite: false, roughness: 0.25 });
    ph.material.needsUpdate = true;
    ph.renderOrder = 12;   // the glass last: it tints the chip and the art behind it too
    // centre the stand as printed on the grid (the NFC tray printed beside it does not count: it goes into the stand)
    const b = new THREE.Box3();
    for (const p of res.parts) { if (p.preview || p.apart) continue; p.geometry.computeBoundingBox(); b.union(p.geometry.boundingBox); }
    v.model.position.set(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, 0);
    const z = res.axis.z * 2 + 2;
    this.handles.set('opener', openerHandle(res.info.opener, z), '#ff942d');
    if (res.info.ring) this.handles.set('attachment', { x: res.info.ring.x, y: res.info.ring.y, z }, '#37a4ff');
    // re-frame when the NFC tray appears beside the stand (or goes away), so it is never cut off at the edge
    const apart = res.parts.some((p) => p.apart);
    this.applyView(!this.framed || (apart !== this._apart && this.tab === 'print'));
    this._apart = apart;
    this.framed = true;
  }

  applyView(fit) {
    for (const b of this.root.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === this.tab);
    this.placeApart();
    this.setAmt(this.amt);
    if (fit) this.fit();
  }

  // the NFC tray (and its chip) lie beside the stand in «Como se imprime»; in the other views they are in the slot
  placeApart() {
    const v = this.viewer, res = this.res;
    if (!v || !res) return;
    res.parts.forEach((p, i) => {
      if (!p.assembled) return;
      const m = v.meshes.get('p' + i);
      if (m) m.position.set(...(this.tab === 'print' ? [0, 0, 0] : p.assembled));
    });
    v.requestRender();
  }

  setTab(tab) {
    if (!VIEWS[tab]) return;
    this.stopAnim();
    this.tab = tab;
    this.amt = -1;
    this.applyView(true);
  }

  // slider 0 = closed (keychain) … 1 = open on its stop (stand) ↔ leg pose (deg from the print pose, core info.poses)
  poseAt(a) { const p = this.res.info.poses; return p.closed + (p.stand - p.closed) * a; }
  amtOf(pose) { const p = this.res.info.poses; return (p[pose] - p.closed) / (p.stand - p.closed); }

  setAmt(a) {
    const res = this.res;
    if (!(a >= 0)) {   // −1: the tab's pose
      if (!res) { this.amt = -1; return; }
      a = this.amtOf(VIEWS[this.tab].pose);
    }
    this.amt = Math.max(0, Math.min(1, +a || 0));
    this.$('amt').value = String(this.amt);
    if (!res || !this.pivot) return;
    this.pivot.rotation.x = this.poseAt(this.amt) * D2R;
    // the phone leans on the leg only when it is open on its stop
    const ph = this.viewer.extras.get('phone');
    if (ph) ph.visible = this.amt > 0.999;
    this.viewer.requestRender();
  }

  // camera at the tab's azimuth/elevation, far enough to see every visible piece (the phone too)
  fit() {
    const v = this.viewer, view = VIEWS[this.tab];
    if (!v) return;
    v.scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const m of [...v.meshes.values(), ...v.extras.values()]) if (m.visible) box.expandByObject(m);
    if (box.isEmpty()) return;
    const s = box.getBoundingSphere(new THREE.Sphere());
    const vHalf = (v.camera.fov / 2) * D2R, hHalf = Math.atan(Math.tan(vHalf) * v.camera.aspect);
    const dist = (s.radius / Math.sin(Math.min(vHalf, hHalf))) * 0.95;
    const az = view.az * D2R, el = view.el * D2R;
    v.controls.target.copy(s.center);
    v.camera.position.set(s.center.x + dist * Math.cos(el) * Math.sin(az), s.center.y + dist * Math.sin(el), s.center.z + dist * Math.cos(el) * Math.cos(az));
    v.camera.near = dist / 100;
    v.camera.far = dist * 20;
    v.camera.updateProjectionMatrix();
    v.controls.update();
    v.requestRender();
  }

  animate() {
    this.stopAnim();
    if (!this.res) return;
    // closed → open on its stop (the phone appears at the end)
    const from = this.amt > 0.999 || !(this.amt >= 0) ? 0 : this.amt, t0 = performance.now(), dur = 300 + 1700 * (1 - from);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.setAmt(from + (1 - from) * e);
      this.anim = k < 1 ? requestAnimationFrame(step) : null;
    };
    this.anim = requestAnimationFrame(step);
  }

  stopAnim() {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = null;
  }

  // ------------------------------------------------------------------ images
  async loadLogo(file) {
    if (!isImageFile(file)) { this.cb.toast('El logo debe ser una imagen (PNG, JPG o SVG).', true); return false; }
    try {
      const src = await readDataURL(file);
      const img = await imageDataFrom(src, 1000);
      this.logoSrc = src;
      this.logoImg = img;
      this.logoName = file.name || 'Logo';
      // another logo: its colours are found again (automatic count, default colours)
      Object.assign(this.cfg.logo, { enabled: true, colors: 0, layers: {} });
      this.sync();
      await this.rebuild();
      const n = this.res?.info.logo?.length || 0;
      this.cb.toast(`✓ Logo cargado${n > 1 ? ` · ${n} colores: cámbialos en «Colores del logo»` : ''}`);
      return true;
    } catch (err) {
      console.error(err);
      this.cb.toast('No se pudo leer el logo: ' + err.message, true);
      return false;
    }
  }

  clearLogo() {
    this.logoSrc = null;
    this.logoImg = null;
    this.logoName = '';
    this.renderLogoBox();
    this.updateVisibility();
    this.schedule();
  }

  async loadShape(file) {
    if (!isImageFile(file)) { this.cb.toast('La silueta debe ser una imagen (PNG, JPG o SVG).', true); return false; }
    try {
      const src = await readDataURL(file);
      const img = await imageDataFrom(src, 800);
      this.shapeSrc = src;
      this.shapeImg = img;
      this.shapeVer++;
      this.cfg.shape = 'custom';
      this.markShape();
      this.updateVisibility();
      await this.rebuild();
      return true;
    } catch (err) {
      console.error(err);
      this.cb.toast('No se pudo leer la silueta: ' + err.message, true);
      return false;
    }
  }

  // ------------------------------------------------------------------ files
  async ready() {
    await this.whenIdle();
    if (!this.res) { this.cb.toast('Todavía no hay un soporte generado.', true); return false; }
    return true;
  }

  async export3MF() {
    if (!(await this.ready())) return null;
    const res = this.res, name = this.cfg.name || 'Soporte celular';
    this.cb.showBusy('Generando 3MF…');
    await nextFrame();
    try {
      // the stand with its colour pieces as one object, the NFC tray (beside it on the plate) as another
      const ex = phoneStandExport(res);
      const parts = ex.parts.map(({ name: n, color, filamentIndex, geometry, blockSupports }) => ({ name: n, color, filamentIndex, geometry, blockSupports }));
      const assemblies = ex.assemblies.map((a, k) => (k ? a : { ...a, name }));
      const data = threeMF(parts, name, { assemblies, pauses: ex.pauses });
      const p = await window.api.saveFile({ defaultPath: fileBase(name) + '.3mf', filters: [{ name: '3MF', extensions: ['3mf'] }], data });
      const nf = res.filaments.length;
      if (p) {
        this.cb.toast(`✓ 3MF guardado · ${nf} filamento${nf > 1 ? 's' : ''} · soportes apagados${assemblies.length > 1 ? ' · la bandeja NFC va como objeto aparte' : ''}`
          + `${ex.pauses.length ? ` · pausa para el chip NFC a Z = ${f1(ex.pauses[0].z)} mm` : ''}`);
      }
      return p;
    } catch (err) {
      console.error(err);
      this.cb.toast('Error al exportar: ' + err.message, true);
      return null;
    } finally { this.cb.hideBusy(); }
  }

  async exportSTL() {
    if (!(await this.ready())) return null;
    const res = this.res, name = this.cfg.name || 'Soporte celular';
    try {
      const data = stlBinary(res.parts.filter((p) => !p.preview).map((p) => p.geometry));
      const p = await window.api.saveFile({ defaultPath: fileBase(name) + '.stl', filters: [{ name: 'STL', extensions: ['stl'] }], data });
      const tray = res.parts.some((q) => q.apart);
      if (p) this.cb.toast(`✓ STL guardado (un solo color${tray ? '; la bandeja NFC va al lado del soporte' : ''}${res.pauses.length ? `; agrega a mano la pausa del chip NFC a Z = ${f1(res.pauses[0].z)} mm` : ''}; apaga los soportes en el laminador)`);
      return p;
    } catch (err) {
      console.error(err);
      this.cb.toast('Error al exportar: ' + err.message, true);
      return null;
    }
  }

  // PNG of the current view on a light background (to show the client): the piece as it really looks, without the
  // see-through NFC chip
  async photo() {
    if (!(await this.ready()) || !this.viewer) return null;
    const v = this.viewer, old = { bg: v.scene.background, grid: v.grid.visible };
    const helpers = this.res.parts.map((p, i) => (p.preview ? v.meshes.get('p' + i) : null)).filter((m) => m?.visible);
    let url;
    try {
      v.scene.background = new THREE.Color(0xf3f4f6);
      v.grid.visible = false;
      for (const m of helpers) m.visible = false;
      url = v.snapshot();
    } finally {
      v.scene.background = old.bg;
      v.grid.visible = old.grid;
      for (const m of helpers) m.visible = true;
      v.requestRender();
    }
    const bin = atob(url.split(',')[1]), data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    const p = await window.api.saveFile({ defaultPath: fileBase(this.cfg.name) + '.png', filters: [{ name: 'Imagen PNG', extensions: ['png'] }], data });
    if (p) this.cb.toast('✓ Foto guardada');
    return p;
  }

  async saveProject() {
    const data = phoneStandProject(this.cfg, { logoSrc: this.logoSrc, shapeSrc: this.shapeSrc });
    const p = await window.api.saveFile({ defaultPath: fileBase(this.cfg.name) + '.r3p', filters: [{ name: 'Proyecto soporte celular', extensions: ['r3p'] }], data });
    if (p) this.cb.toast('✓ Proyecto guardado');
    return p;
  }

  // j: parsed project object or its JSON text; throws (in Spanish) when it is not a phone-stand project
  async openProject(j) {
    const p = readPhoneStandProject(j);
    const [logoImg, shapeImg] = await Promise.all([
      p.logoSrc ? imageDataFrom(p.logoSrc, 1000) : null,
      p.shapeSrc ? imageDataFrom(p.shapeSrc, 800) : null,
    ]);
    this.stopAnim();
    this.cfg = p.cfg;
    this.logoSrc = p.logoSrc;
    this.logoImg = logoImg;
    this.logoName = p.logoSrc ? 'Logo del proyecto' : '';
    this.shapeSrc = p.shapeSrc;
    this.shapeImg = shapeImg;
    this.shapeVer++;
    this.res = null;
    this.tab = 'print';
    this.amt = -1;
    this.framed = false;
    await this.open();
    this.cb.toast('✓ Proyecto abierto');
  }
}

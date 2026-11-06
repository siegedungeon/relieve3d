const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const SCRIPT = path.join('herramientas', 'tiktok3d.py');
const ESTADOS = ['idea', 'guion', 'grabado', 'editado', 'listo', 'publicado', 'medido'];
const CSV = {
  metricas: 'registro/metricas.csv',
  pedidos: 'registro/pedidos-tiktok.csv',
};
const DOCS = {
  perfil: 'estrategia/perfil-cuenta.md',
  voz: 'estrategia/voz-y-marca.md',
  hashtags: 'estrategia/hashtags-y-seo.md',
  campana: 'estrategia/campana-navidad-2026.md',
  videosCsv: 'registro/videos.csv',
  metricasCsv: CSV.metricas,
  pedidosCsv: CSV.pedidos,
  ideas: 'ideas/banco-de-ideas.md',
};
const COLECCIONES = { ganchos: 'gan', guiones: 'gui', ctas: 'cta', hashtags: 'has', ideas: 'ide', respuestas: 'res', sonidos: 'son' };
const RE_ITEM_ID = /^(gan|gui|cta|has|ide|res|son)-(b\d{2}|\d{3,})$/;
const MAX_LIB_BYTES = 5 * 1024 * 1024;
const MAX_LIB_ITEMS = 5000;
// Solo estas direcciones públicas (RSS/Atom); el Creative Center se lee desde su propia ventana o pegando el texto.
const TREND_URLS = {
  'google-co': 'https://trends.google.com/trending/rss?geo=CO',
  'reddit-bambulab': 'https://www.reddit.com/r/BambuLab/top/.rss?t=week',
  'reddit-3dprinting': 'https://www.reddit.com/r/3Dprinting/top/.rss?t=week',
};
const TREND_SOURCES = [...Object.keys(TREND_URLS), 'creative-center'];
const MAX_TREND_BYTES = 3 * 1024 * 1024;
const TREND_DAYS = 14;
const USER_AGENT = 'Relieve3D/1.18 (Estudio TikTok Pabonitas)';
const RE_ID = /^V\d{3,}$/;
const RE_CARPETA = /^videos\/V\d{3,}[^/\\]*$/;
const RE_FECHA_PLAN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_URL_TIKTOK = /^https:\/\/(www\.|vm\.|vt\.|m\.)?tiktok\.com\/[^\s"'<>]+$/i;
const MAX_TEXT = 200_000;

const defaultRoot = () => path.join(os.homedir(), 'Documents', 'TikTok-Impresion3D');
const exists = (p) => fs.access(p).then(() => true, () => false);
const isDir = (p) => fs.stat(p).then((s) => s.isDirectory(), () => false);

function createTiktokWorkspace({ configFile, env = process.env, fallbackRoot = defaultRoot(), fetchImpl = globalThis.fetch, fetchTimeoutMs = 15_000 } = {}) {
  let config = null;
  let busy = null;

  async function readConfig() {
    if (config) return config;
    try { config = JSON.parse(await fs.readFile(configFile, 'utf8')) || {}; }
    catch { config = {}; }
    return config;
  }
  async function settings() {
    const c = await readConfig();
    return {
      root: path.resolve(env.R3D_TIKTOK_DIR || c.root || fallbackRoot),
      python: c.python || 'python',
      fixed: !!env.R3D_TIKTOK_DIR,
      today: RE_FECHA.test(env.R3D_TIKTOK_TODAY || '') ? env.R3D_TIKTOK_TODAY : '',
    };
  }
  async function saveConfig(value = {}) {
    const c = { ...(await readConfig()) };
    if (value.root !== undefined) {
      if (typeof value.root !== 'string' || !value.root.trim()) throw new Error('Ruta del espacio TikTok inválida.');
      const root = path.resolve(value.root.trim());
      if (!(await exists(path.join(root, SCRIPT)))) throw new Error(`En ${root} no está ${SCRIPT}. Elige la carpeta TikTok-Impresion3D.`);
      c.root = root;
    }
    if (value.python !== undefined) {
      const py = String(value.python || '').trim();
      if (py && (/[\r\n"<>|&;]/.test(py) || py.length > 260)) throw new Error('Comando de Python inválido.');
      c.python = py || undefined;
    }
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(configFile, JSON.stringify(c, null, 2));
    config = c;
    return settings();
  }

  function inside(root, rel) {
    if (rel === '.') return root;
    if (typeof rel !== 'string' || !rel || rel.length > 400 || /[\0\r\n]/.test(rel)) throw new Error('Ruta inválida.');
    const abs = path.resolve(root, rel);
    const r = path.relative(root, abs);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new Error(`Ruta fuera del espacio TikTok: ${rel}`);
    return abs;
  }
  async function resolveInside(rel) {
    const { root } = await settings();
    const abs = inside(root, rel);
    if (!(await exists(abs))) throw new Error(`No existe ${rel}`);
    return abs;
  }
  const readText = (p) => fs.readFile(p, 'utf8').then((t) => t.replace(/^\uFEFF/, ''), () => '');
  const files = async (dir) => {
    try { return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name).sort(); }
    catch { return []; }
  };

  async function load() {
    const s = await settings();
    const base = { root: s.root, python: s.python, fixed: s.fixed, today: s.today, now: s.today ? `${s.today}T10:00` : '' };
    if (!(await exists(path.join(s.root, SCRIPT)))) {
      return { ...base, ok: false, motivo: `No encontré ${SCRIPT} en ${s.root}. Elige la carpeta TikTok-Impresion3D en Configuración.` };
    }
    const docs = {};
    for (const [k, rel] of Object.entries(DOCS)) docs[k] = await readText(path.join(s.root, rel));
    const videos = [];
    const vdir = path.join(s.root, 'videos');
    let entries = [];
    try { entries = await fs.readdir(vdir, { withFileTypes: true }); } catch {}
    for (const d of entries) {
      if (!d.isDirectory() || !/^V\d{3,}/.test(d.name)) continue;
      const dir = path.join(vdir, d.name);
      let spec = null;
      try { spec = JSON.parse(await readText(path.join(dir, 'video.json'))); } catch {}
      videos.push({
        carpeta: `videos/${d.name}`,
        guion: await readText(path.join(dir, 'guion.md')),
        spec,
        clips: await files(path.join(dir, 'clips')),
        salida: await files(path.join(dir, 'salida')),
        transcripcion: await exists(path.join(dir, 'voz.transcripcion.json')),
        vozGuia: await exists(path.join(dir, 'voz.wav')),
        kit: await exists(path.join(dir, 'kit.md')),
      });
    }
    return { ...base, ok: true, docs, videos, biblioteca: await loadBiblioteca(s.root), tendencias: await loadTrends(s.root) };
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const localDay = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  async function writeAtomic(file, text) {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, text, 'utf8');
    try { await fs.rename(tmp, file); }
    catch (e) { await fs.rm(tmp, { force: true }); throw e; }
  }

  // biblioteca/<colección>.json: null si no existe, { error } si está dañado (la app sigue con las semillas).
  async function loadBiblioteca(root) {
    const out = {};
    for (const col of Object.keys(COLECCIONES)) {
      const file = path.join(root, 'biblioteca', `${col}.json`);
      if (!(await exists(file))) { out[col] = null; continue; }
      try { out[col] = JSON.parse(await readText(file)); }
      catch (e) { out[col] = { error: `biblioteca/${col}.json está dañado (${e.message}). Al guardar, el archivo dañado se respalda en biblioteca/.anterior/` }; }
    }
    return out;
  }

  async function saveBiblioteca(col, archivo, resumen = '') {
    const pre = COLECCIONES[col];
    if (!pre) throw new Error(`Colección no permitida: ${col}`);
    if (!archivo || typeof archivo !== 'object' || !Array.isArray(archivo.items)) throw new Error('Biblioteca inválida.');
    if (archivo.items.length > MAX_LIB_ITEMS) throw new Error(`Máximo ${MAX_LIB_ITEMS} elementos por colección.`);
    const ids = new Set();
    for (const it of archivo.items) {
      const id = it && typeof it === 'object' ? String(it.id || '') : '';
      if (!RE_ITEM_ID.test(id) || !id.startsWith(`${pre}-`) || ids.has(id)) throw new Error(`Elemento con id inválido o repetido: ${id || '—'}`);
      ids.add(id);
    }
    const ocultos = [...new Set((Array.isArray(archivo.ocultos) ? archivo.ocultos : []).filter((id) => typeof id === 'string' && RE_ITEM_ID.test(id) && id.startsWith(`${pre}-b`)))];
    const ultimo = Math.max(0, Number.isInteger(archivo.ultimo) && archivo.ultimo > 0 && archivo.ultimo < 1e6 ? archivo.ultimo : 0, ...[...ids].map((id) => +((id.match(/-(\d{3,})$/) || [])[1] || 0)));
    const data = { coleccion: col, version: 1, actualizado: String(archivo.actualizado || '').slice(0, 40), ultimo, ocultos, items: archivo.items };
    const json = `${JSON.stringify(data, null, 2)}\n`;
    if (Buffer.byteLength(json) > MAX_LIB_BYTES) throw new Error('La colección pasa de 5 MB: exporta y divide.');
    const s = await settings();
    const dir = path.join(s.root, 'biblioteca');
    const file = path.join(dir, `${col}.json`);
    await fs.mkdir(path.join(dir, '.anterior'), { recursive: true });
    if (await exists(file)) {
      const prev = await fs.readFile(file, 'utf8');
      // Solo un archivo con el formato completo va a .anterior/<col>.json (que se pisa en cada guardado).
      // Uno dañado o con otra forma se guarda aparte con fecha para no perder nada de lo que tenía.
      let sano = false;
      try {
        const j = JSON.parse(prev.replace(/^\uFEFF/, ''));
        const vistos = new Set();
        sano = !!j && typeof j === 'object' && !Array.isArray(j) && Array.isArray(j.items) && j.items.every((it) => {
          const id = it && typeof it === 'object' ? String(it.id || '') : '';
          if (!RE_ITEM_ID.test(id) || !id.startsWith(`${pre}-`) || vistos.has(id)) return false;
          vistos.add(id);
          return true;
        });
      } catch { sano = false; }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      let destino = path.join(dir, '.anterior', sano ? `${col}.json` : `${col}.danado-${stamp}.json`);
      for (let k = 2; !sano && (await exists(destino)); k++) destino = path.join(dir, '.anterior', `${col}.danado-${stamp}-${k}.json`);
      await fs.writeFile(destino, prev, 'utf8');
    }
    await writeAtomic(file, json);
    await bitacora(`Relieve3D · Estudio TikTok: biblioteca/${col}.json — ${String(resumen || 'guardada').slice(0, 200)}.`);
    return { archivo: `biblioteca/${col}.json`, items: data.items.length, ocultos: ocultos.length };
  }

  // Lo último guardado de cada fuente (busca en los últimos 14 días con datos).
  async function loadTrends(root) {
    const base = path.join(root, 'tendencias');
    let dias = [];
    try { dias = (await fs.readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory() && RE_FECHA.test(d.name)).map((d) => d.name).sort().reverse().slice(0, TREND_DAYS); }
    catch { return {}; }
    const out = {};
    for (const fuente of TREND_SOURCES) {
      for (const dia of dias) {
        const file = path.join(base, dia, `${fuente}.json`);
        if (!(await exists(file))) continue;
        try { out[fuente] = { ...JSON.parse(await readText(file)), archivo: `tendencias/${dia}/${fuente}.json`, dia }; break; }
        catch {}
      }
    }
    return out;
  }

  async function fetchTrend(fuente) {
    const url = TREND_URLS[fuente];
    if (!url) throw new Error(`Fuente no permitida: ${fuente}`);
    if (typeof fetchImpl !== 'function') throw new Error('Esta versión no puede descargar (sin fetch).');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), fetchTimeoutMs);
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5' }, signal: ctrl.signal, redirect: 'follow' });
      if (!res.ok) throw new Error(`${fuente} respondió ${res.status}${res.status === 429 ? ' (demasiadas consultas: espera unos minutos)' : res.status === 403 ? ' (bloqueado: intenta más tarde o abre la página en el navegador)' : ''}`);
      const texto = await res.text();
      if (texto.length > MAX_TREND_BYTES) throw new Error(`${fuente}: la respuesta es demasiado grande`);
      return { fuente, url, texto, obtenido: new Date().toISOString() };
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`${fuente}: no respondió en ${Math.round(fetchTimeoutMs / 1000)} s (¿hay internet?)`);
      throw e;
    } finally { clearTimeout(timer); }
  }

  async function saveTrends(list) {
    if (!Array.isArray(list) || !list.length || list.length > TREND_SOURCES.length) throw new Error('Tendencias inválidas.');
    for (const snap of list) {
      if (!snap || !TREND_SOURCES.includes(snap.fuente) || !Array.isArray(snap.items) || snap.items.length > 500) throw new Error(`Tendencia inválida: ${snap?.fuente || '—'}`);
    }
    const s = await settings();
    const dia = s.today || localDay();
    const dir = path.join(s.root, 'tendencias', dia);
    await fs.mkdir(dir, { recursive: true });
    const out = [];
    for (const snap of list) {
      const { archivo, dia: _d, ...limpio } = snap;
      const json = `${JSON.stringify({ ...limpio, guardado: new Date().toISOString() }, null, 2)}\n`;
      if (Buffer.byteLength(json) > MAX_TREND_BYTES) throw new Error(`${snap.fuente}: demasiado grande para guardar`);
      await writeAtomic(path.join(dir, `${snap.fuente}.json`), json);
      out.push(`tendencias/${dia}/${snap.fuente}.json`);
    }
    await bitacora(`Relieve3D · Estudio TikTok: guardé tendencias de ${list.map((x) => `${x.fuente} (${x.items.length})`).join(', ')}.`);
    return out;
  }

  function validateArgs(args) {
    if (!Array.isArray(args) || !args.length || args.some((a) => typeof a !== 'string' || a.length > 400 || /[\0\r\n]/.test(a))) throw new Error('Comando inválido.');
    const [cmd, ...rest] = args;
    const folder = (rel) => {
      const r = rel.replace(/\\/g, '/');
      if (!RE_CARPETA.test(r)) throw new Error(`Carpeta de video inválida: ${rel}`);
      return r;
    };
    switch (cmd) {
      case 'voz':
      case 'video': {
        const flag = cmd === 'voz' ? '--forzar' : '--forzar-voz';
        if (rest.length < 1 || rest.length > 2 || (rest[1] && rest[1] !== flag)) throw new Error(`Uso: ${cmd} <carpeta> [${flag}]`);
        return { args: [cmd, folder(rest[0]), ...rest.slice(1)], check: [folder(rest[0])] };
      }
      case 'revisar': {
        const r = (rest[0] || '').replace(/\\/g, '/');
        if (rest.length !== 1 || !/^videos\/V\d{3,}[^/]*\/salida\/[^/]+\.mp4$/i.test(r)) throw new Error('Uso: revisar videos/VNNN-…/salida/archivo.mp4');
        return { args: ['revisar', r], check: [r] };
      }
      case 'estado': {
        const [id, estado, ...opts] = rest;
        if (!RE_ID.test(id || '') || !ESTADOS.includes(estado)) throw new Error('Uso: estado VNNN <estado>');
        const out = ['estado', id, estado];
        for (let i = 0; i < opts.length; i += 2) {
          const [k, v] = [opts[i], opts[i + 1] ?? ''];
          if (k === '--fecha-plan' && (RE_FECHA_PLAN.test(v) || v === '')) out.push(k, v);
          else if (k === '--url' && RE_URL_TIKTOK.test(v)) out.push(k, v);
          else throw new Error(`Opción inválida para estado: ${k} ${v}`);
        }
        return { args: out, check: [] };
      }
      case 'panel': if (rest.length) throw new Error('Uso: panel'); return { args: ['panel'], check: [] };
      case 'sfx': if (rest.length) throw new Error('Uso: sfx'); return { args: ['sfx'], check: [] };
      case 'nuevo': {
        const [titulo, ...opts] = rest;
        if (!titulo || titulo.length > 120 || titulo.startsWith('-')) throw new Error('Título inválido.');
        const out = ['nuevo', titulo];
        for (let i = 0; i < opts.length; i += 2) {
          if (!['--pilar', '--formula'].includes(opts[i]) || !/^[\w-]{0,40}$/.test(opts[i + 1] ?? '')) throw new Error('Opción inválida para nuevo.');
          out.push(opts[i], opts[i + 1]);
        }
        return { args: out, check: [] };
      }
      default: throw new Error(`Comando no permitido: ${cmd}`);
    }
  }

  function spawnPython(python, pre, script, args, root, onLine, timeoutMs) {
    return new Promise((resolve, reject) => {
      const child = spawn(python, [...pre, '-X', 'utf8', script, ...args], {
        cwd: root, windowsHide: true, shell: false,
        env: { ...env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      let out = '';
      let err = '';
      const pump = (stream, tag) => {
        let rest = '';
        stream.setEncoding('utf8');
        stream.on('data', (chunk) => {
          if (tag === 'out') out += chunk; else err += chunk;
          const lines = (rest + chunk).split(/\r?\n/);
          rest = lines.pop();
          for (const l of lines) if (l.trim()) onLine?.(l, tag);
        });
        stream.on('end', () => { if (rest.trim()) onLine?.(rest, tag); });
      };
      pump(child.stdout, 'out');
      pump(child.stderr, 'err');
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout: out, stderr: err }); });
    });
  }

  async function run(args, onLine, { timeoutMs = 30 * 60_000 } = {}) {
    const s = await settings();
    const { args: safe, check } = validateArgs(args);
    for (const rel of check) await resolveInside(rel);
    if (safe[0] === 'panel' && s.today) safe.push('--hoy', s.today);
    if (busy) throw new Error(`Espera: todavía corre «${busy}».`);
    busy = safe.slice(0, 2).join(' ');
    try {
      const script = path.join(s.root, SCRIPT);
      let res;
      try { res = await spawnPython(s.python, [], script, safe, s.root, onLine, timeoutMs); }
      catch (e) {
        if (e.code !== 'ENOENT') throw e;
        if (s.python !== 'python') throw new Error(`No encontré Python en «${s.python}». Corrígelo en Configuración.`);
        try { res = await spawnPython('py', ['-3'], script, safe, s.root, onLine, timeoutMs); }
        catch { throw new Error('No encontré Python. Instálalo desde python.org (marca «Add to PATH») o escribe su ruta en Configuración.'); }
      }
      const ok = res.code === 0 || (safe[0] === 'revisar' && res.code === 1);
      return { ok, code: res.code, stdout: res.stdout, stderr: res.stderr, args: safe };
    } finally { busy = null; }
  }

  function assertRun(res, label) {
    if (!res.ok) throw new Error(`${label}: ${(res.stderr || res.stdout).trim().split(/\r?\n/).pop() || `código ${res.code}`}`);
    return res;
  }

  async function createVideo(payload = {}, onLine) {
    const { titulo, pilar = '', formula = '', fechaPlan = '', guion, videoJson } = payload;
    if (typeof titulo !== 'string' || !titulo.trim() || titulo.length > 120) throw new Error('El video necesita un título (máx. 120 letras).');
    if (typeof guion !== 'string' || !guion.includes('__ID__') || guion.length > MAX_TEXT) throw new Error('Guion inválido.');
    if (typeof videoJson !== 'string' || videoJson.length > MAX_TEXT) throw new Error('video.json inválido.');
    if (fechaPlan && !RE_FECHA_PLAN.test(fechaPlan)) throw new Error('Fecha de publicación inválida (AAAA-MM-DDTHH:MM).');
    const s = await settings();
    const res = assertRun(await run(['nuevo', titulo.trim().replace(/^-+/, ''), '--pilar', pilar, '--formula', formula], onLine), 'No pude crear la carpeta');
    const abs = res.stdout.trim().split(/\r?\n/).pop().trim();
    const carpeta = path.relative(s.root, abs).split(path.sep).join('/');
    const id = (path.basename(abs).match(/^V\d{3,}/) || [])[0];
    if (!id || !RE_CARPETA.test(carpeta) || !(await isDir(abs))) throw new Error(`Respuesta inesperada de «nuevo»: ${abs}`);
    const fill = (t) => t.replace(/__ID__/g, id).replace(/__CARPETA__/g, carpeta);
    const spec = JSON.parse(fill(videoJson));
    await fs.writeFile(path.join(abs, 'guion.md'), fill(guion), 'utf8');
    await fs.writeFile(path.join(abs, 'video.json'), `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
    assertRun(await run(['estado', id, 'guion', ...(fechaPlan ? ['--fecha-plan', fechaPlan] : [])], onLine), 'No pude registrar el estado');
    await bitacora(`Relieve3D · Estudio TikTok: creé ${id} «${titulo.trim()}» (${formula || 'sin fórmula'}${fechaPlan ? `, para ${fechaPlan.replace('T', ' ')}` : ''}).`);
    return { id, carpeta };
  }

  async function saveKit(carpeta, md) {
    const rel = String(carpeta || '').replace(/\\/g, '/');
    if (!RE_CARPETA.test(rel)) throw new Error('Carpeta de video inválida.');
    if (typeof md !== 'string' || !md.startsWith('# ') || md.length > MAX_TEXT) throw new Error('Kit inválido.');
    const abs = await resolveInside(rel);
    const file = path.join(abs, 'kit.md');
    await fs.writeFile(file, md, 'utf8');
    return file;
  }

  const cell = (v) => {
    let t = String(v ?? '').replace(/[;\r\n\t]+/g, ' ').trim().slice(0, 300);
    if (/^[=+@]/.test(t) || /^-(?!\d)/.test(t)) t = `'${t}`;
    return t;
  };
  const num = (v, { min = 0, max = 1e10, dec = false } = {}) => {
    if (v === '' || v == null) return '';
    let t = String(v).trim().replace(/\s+/g, '');
    if (!dec && /^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, '');
    else if (t.includes('.') && t.includes(',')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    else t = t.replace(',', '.');
    const n = Number(t);
    if (!t || !Number.isFinite(n) || n < min || n > max) throw new Error(`Número inválido: ${v}`);
    return String(dec ? Math.round(n * 10) / 10 : Math.round(n));
  };

  function normalizeRow(kind, row) {
    if (!row || typeof row !== 'object') throw new Error('Fila inválida.');
    if (kind === 'metricas') {
      if (!RE_ID.test(row.id || '')) throw new Error('Elige el video.');
      if (!RE_FECHA.test(row.fecha_medicion || '')) throw new Error('Fecha de medición inválida.');
      if (row.vistas === '' || row.vistas == null) throw new Error('Escribe al menos las vistas.');
      const out = { id: row.id, fecha_medicion: row.fecha_medicion, horas_desde_publicacion: num(row.horas_desde_publicacion, { max: 10000 }) };
      for (const k of ['vistas', 'me_gusta', 'comentarios', 'compartidos', 'guardados', 'seguidores_nuevos']) out[k] = num(row[k]);
      out.tiempo_medio_s = num(row.tiempo_medio_s, { max: 600, dec: true });
      for (const k of ['vio_completo_pct', 'trafico_para_ti_pct', 'trafico_busqueda_pct', 'nuevos_espectadores_pct']) out[k] = num(row[k], { max: 100, dec: true });
      out.notas = cell(row.notas);
      return out;
    }
    if (kind === 'pedidos') {
      if (!RE_FECHA.test(row.fecha || '')) throw new Error('Fecha inválida.');
      if (row.video_id && !RE_ID.test(row.video_id)) throw new Error('Video inválido.');
      if (/(?:\+?57[\s.-]?)?3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)|\d{8,}|@\w/.test(`${row.notas || ''} ${row.producto || ''}`)) throw new Error('No anotes teléfonos ni usuarios de clientes: solo producto, cantidad, valor y estado.');
      return {
        fecha: row.fecha, video_id: row.video_id || '', tipo: cell(row.tipo), canal: cell(row.canal), producto: cell(row.producto),
        cantidad: num(row.cantidad, { max: 100000 }), valor_cop: num(row.valor_cop, { max: 1e9 }), estado: cell(row.estado || 'consulta'), notas: cell(row.notas),
      };
    }
    throw new Error('Registro no permitido.');
  }

  async function appendCsv(kind, row) {
    const s = await settings();
    if (!CSV[kind]) throw new Error('Registro no permitido.');
    const file = path.join(s.root, CSV[kind]);
    const raw = await fs.readFile(file, 'utf8').catch(() => '');
    if (!raw.trim()) throw new Error(`No encontré ${CSV[kind]} (o no tiene encabezado).`);
    const text = raw.replace(/^\uFEFF/, '');
    const header = text.split(/\r?\n/)[0].split(';').map((h) => h.trim());
    const data = normalizeRow(kind, row);
    const eol = /\r\n/.test(text) ? '\r\n' : '\n';
    const line = header.map((h) => data[h] ?? '').join(';');
    await fs.appendFile(file, `${/\r?\n$/.test(text) ? '' : eol}${line}${eol}`, 'utf8');
    const resumen = kind === 'metricas'
      ? `métricas de ${data.id} a las ${data.horas_desde_publicacion || '?'} h: ${data.vistas} vistas`
      : `${data.tipo || 'consulta'} por ${data.canal || 'TikTok'}${data.video_id ? ` (de ${data.video_id})` : ''}: ${data.producto || 'sin producto'} · ${data.estado}`;
    await bitacora(`Relieve3D · Estudio TikTok: anoté ${resumen}.`);
    return data;
  }

  async function bitacora(texto) {
    const s = await settings();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const day = s.today || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const dir = path.join(s.root, 'bitacora');
    const file = path.join(dir, `${day}.md`);
    await fs.mkdir(dir, { recursive: true });
    let prefix = '';
    if (!fss.existsSync(file)) prefix = `# Bitácora · ${day}\n\n## Desde Relieve3D\n`;
    else if (!(await fs.readFile(file, 'utf8')).includes('## Desde Relieve3D')) prefix = '\n## Desde Relieve3D\n';
    await fs.appendFile(file, `${prefix}- ${pad(now.getHours())}:${pad(now.getMinutes())} ${String(texto).replace(/[\r\n]+/g, ' ')}\n`, 'utf8');
  }

  return { settings, saveConfig, load, run, createVideo, saveKit, appendCsv, resolveInside, validateArgs, bitacora, saveBiblioteca, fetchTrend, saveTrends, isBusy: () => !!busy };
}

module.exports = { createTiktokWorkspace, defaultRoot, RE_URL_TIKTOK, TREND_URLS };

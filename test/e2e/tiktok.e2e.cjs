// Estudio TikTok, flujo completo sobre una COPIA del espacio real (run.mjs la prepara en test/out/e2e/tiktok):
// inicio → Hoy → kit → Crear guion → Prompts IA → crear el video con tiktok3d.py real → voz guía (edge-tts) →
// animatic → revisar → estado → publicar → métricas 24 h / 7 días → consulta sin datos de clientes → panel → configuración →
// biblioteca (bases, prompt de 50, importar/exportar/ocultar) → tendencias en vivo (Google Trends CO, Reddit, Creative Center)
// → ganchos de tendencia y de la biblioteca en Crear guion → segundo video desde un guion base.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { clipboard } = require('electron');

module.exports = async ({ win, run, shot, wait }) => {
  const out = process.env.E2E_DIR, ws = process.env.R3D_TIKTOK_DIR, src = process.env.R3D_TIKTOK_E2E_SRC, today = process.env.R3D_TIKTOK_TODAY;
  const errors = [], opened = global.__r3dTiktokOpened || [];
  win.webContents.on('console-message', (e) => {
    if ((e.level === 'error' || e.level >= 3) && !/disk_cache|WebGLProgram/.test(e.message)) errors.push(e.message);
  });
  const ok = (value, message) => { console.log('[e2e]', value ? 'ok  ' : 'FAIL', message); if (!value) throw new Error(message); };
  const TK = 'window.__r3d.tiktok';
  const read = async (expression) => JSON.parse(await run(`JSON.stringify(${expression})`) ?? 'null');
  const ready = async (ms = 30000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms;) {
      if (await run(`!!${TK}.ctx && !${TK}.busy && !document.querySelector('#tiktok .tk-loading')`)) return;
      await wait(100);
    }
    throw new Error(`El Estudio TikTok no terminó en ${ms / 1000} s`);
  };
  const click = async (selector, ms) => {
    await run(`(()=>{const b=document.querySelector(${JSON.stringify(`#tiktok ${selector}`)});if(!b||b.disabled)throw new Error('Control no disponible: '+${JSON.stringify(selector)});b.click();})()`);
    await wait(30); await ready(ms);
  };
  const set = async (selector, value) => {
    await run(`(()=>{const el=document.querySelector(${JSON.stringify(`#tiktok ${selector}`)});if(!el||el.disabled)throw new Error('Campo no disponible: '+${JSON.stringify(selector)});
      el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(30); await ready();
  };
  const step = async (id, ms) => click(`[data-step-id="${id}"] [data-action="step"]`, ms);
  const kitStep = (id) => read(`${TK}.kit.fases.flatMap(f=>f.pasos).find(s=>s.id===${JSON.stringify(id)})`);
  const capture = async (name) => { win.show(); win.focus(); await wait(300); await shot(path.join(out, `${name}.png`)); };
  const clean = async (where) => {
    const bad = await run(`(()=>{const t=document.getElementById('tiktok').textContent;return (t.match(/undefined|NaN|\\[object Object\\]|__ID__|__CARPETA__/)||[''])[0];})()`);
    ok(!bad, `${where}: sin textos rotos en pantalla${bad ? ` (${bad})` : ''}`);
  };
  const csv = (rel, base = ws) => {
    const lines = fs.readFileSync(path.join(base, rel), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
    const head = lines[0].split(';');
    return lines.slice(1).map((l) => Object.fromEntries(l.split(';').map((c, i) => [head[i], c])));
  };
  const snapshot = (base) => {
    const h = crypto.createHash('sha1');
    for (const rel of ['registro/videos.csv', 'registro/metricas.csv', 'registro/pedidos-tiktok.csv']) h.update(fs.readFileSync(path.join(base, rel)));
    h.update(fs.readdirSync(path.join(base, 'videos')).join('|'));
    for (const d of ['biblioteca', 'tendencias']) h.update(fs.existsSync(path.join(base, d)) ? fs.readdirSync(path.join(base, d), { recursive: true }).sort().join('|') : '-');
    return h.digest('hex');
  };
  const realBefore = snapshot(src);
  win.setSize(1500, 1000);

  // 1 · Inicio → Estudio TikTok → Hoy
  ok(await run(`!!document.querySelector('#homeGridSocial [data-mod="tiktok"]')`), 'la tarjeta Estudio TikTok está en «Contenido y redes» del inicio');
  await run(`document.querySelector('#homeGridSocial [data-mod="tiktok"]').click()`);
  await ready();
  const registro = csv('registro/videos.csv');
  ok(await run(`!document.getElementById('tiktok').hidden&&document.getElementById('home').hidden&&${TK}.tab==='hoy'`), 'abre en la pestaña Hoy y oculta el inicio');
  ok((await read(`${TK}.data.root`)) === ws && (await read(`${TK}.data.fixed`)), 'trabaja sobre la copia temporal del espacio (R3D_TIKTOK_DIR)');
  ok((await read(`${TK}.ctx.videos.length`)) === registro.length, `lee los ${registro.length} videos de registro/videos.csv`);
  ok((await read(`${TK}.ctx.avisos`)).length === 0, 'perfil, voz, hashtags y campaña se leen sin avisos');
  const catalogo = await read(`${TK}.ctx.catalogo`);
  const llavero = catalogo.find((p) => p.id === 'llaveros-personalizados-3d');
  ok(llavero && llavero.precio > 0, `el precio del llavero sale de perfil-cuenta.md (${llavero?.precio})`);
  const agenda = await read(`${TK}.agenda`);
  const header = await run(`document.querySelector('#tiktok .tk-header').innerText`);
  ok(/@pabonitaslaser/.test(header) && (!agenda.fase || header.includes(`Fase ${agenda.fase.letra}`)), `cabecera con la cuenta y la fase (${agenda.fase ? agenda.fase.letra : 'sin fase'})`);
  ok(await run(`document.querySelectorAll('#tiktok .tk-kpis > div').length===4`), 'Hoy muestra los 4 indicadores (publicados, vistas, consultas, ventas)');
  ok(!agenda.hueco || await run(`!!document.querySelector('#tiktok [data-action="to-create"][data-fecha="${agenda.hueco}"]')`), `ofrece crear el guion del siguiente hueco libre (${agenda.hueco || '—'})`);
  await clean('Hoy');
  await capture('tiktok_01_hoy');

  // 2 · Kit paso a paso de un video agendado
  const firstId = await run(`document.querySelector('#tiktok [data-action="kit"]')?.dataset.id||''`);
  ok(!!firstId, `Hoy lista videos con su kit (${firstId})`);
  await click(`[data-action="kit"][data-id="${firstId}"]`);
  ok((await read(`${TK}.tab`)) === 'kit' && (await read(`${TK}.videoId`)) === firstId, `abre el kit de ${firstId}`);
  ok((await read(`${TK}.kit.fases.map(f=>f.id)`)).join() === 'preparar,grabar,pasar,montar,publicar,responder,medir', 'el kit tiene las 7 fases: preparar, grabar, pasar, montar, publicar, responder, medir');
  ok(await read(`${TK}.kit.fases.every(f=>f.pasos.every(p=>p.donde||p.que||p.copiar||(p.items&&p.items.length)))`), 'cada paso dice dónde hacerlo o qué hacer');
  const tele = (await kitStep('grab-tele')).copiar;
  await run(`document.querySelector('#tiktok [data-step-id="grab-tele"] [data-copy]').click()`); await wait(300);
  ok((await read(`${TK}.lastCopied`)) === tele && String(await clipboard.readText()).replace(/\r\n/g, '\n') === tele, 'Copiar deja el texto del teleprompter en el portapapeles');
  const firstRow = registro.find((r) => r.id === firstId);
  await click('[data-action="save-kit"]');
  const firstKit = path.join(ws, firstRow.carpeta, 'kit.md');
  ok(fs.existsSync(firstKit) && fs.readFileSync(firstKit, 'utf8').startsWith(`# Kit paso a paso · ${firstId}`), `kit.md guardado en ${firstRow.carpeta}`);
  await clean('Kit');
  await capture('tiktok_02_kit');

  // 3 · Crear guion: producto, ocasión, fórmula, hook y escenas
  await click('[data-tab="crear"]');
  ok((await read(`${TK}.draft.fechaPlan`)) === (agenda.hueco || ''), 'el borrador se agenda en el siguiente hueco libre');
  await set('[data-draft="producto"]', llavero.id);
  await set('[data-draft="ocasion"]', 'amigo-secreto');
  await set('[data-draft="formula"]', 'T5');
  let draft = await read(`${TK}.draft`);
  ok(draft.producto.id === llavero.id && draft.formula === 'T5' && draft.escenas.length >= 3, `borrador T5 de ${llavero.nombre} con ${draft.escenas.length} escenas`);
  ok(draft.caption.includes(String(llavero.precio).replace(/\B(?=(\d{3})+(?!\d))/g, '.')), 'el caption lleva el precio real del catálogo');
  ok(!draft.avisos.length, `borrador sin avisos${draft.avisos.length ? `: ${draft.avisos.join(' / ')}` : ''}`);
  await run(`document.querySelectorAll('#tiktok [data-draft="hook"]')[1].click()`); await wait(50); await ready();
  ok((await read(`${TK}.draft.hookIndex`)) === 1, 'elegir otro hook cambia el borrador');
  const voz0 = 'Si no sabes qué darle a tu amigo secreto, mira esto';
  await set('[data-scene="0"][data-field="voz"]', voz0);
  ok((await read(`${TK}.draft.escenas[0].voz`)) === voz0 && (await run(`document.querySelector('#tiktok [data-side]').textContent.includes(${JSON.stringify(voz0)})`)), 'editar lo que dices actualiza el teleprompter al instante');
  await clean('Crear guion');
  await capture('tiktok_03_crear');

  // 4 · Prompts IA: copiar, pegar la respuesta de la IA y aplicarla al borrador
  await click('[data-action="to-prompts"][data-id="draft"]');
  const n = await read(`${TK}.draft.escenas.length`);
  ok((await read(`${TK}.tab`)) === 'prompts' && (await run(`document.querySelectorAll('#tiktok [data-prompt]').length`)) === 10, 'Prompts IA muestra los 10 prompts del borrador');
  await run(`document.querySelector('#tiktok [data-prompt="guion"] [data-copy]').click()`); await wait(200);
  const prompt = await read(`${TK}.lastCopied`);
  ok(prompt.includes(`EXACTAMENTE ${n} bloques`) && prompt.includes(String(llavero.precio).replace(/\B(?=(\d{3})+(?!\d))/g, '.')), 'el prompt del guion pide N bloques y lleva el precio real');
  await click('[data-prompt="guion"] [data-action="url"]');
  ok(/^https:\/\//.test(opened[opened.length - 1] || ''), `«Abrir» lleva a la IA (${opened[opened.length - 1]})`);
  await set('[data-resp]', 'Uno | Dos');
  await click('[data-action="apply-ai"]');
  ok(/2 bloques/.test(await read(`${TK}.lastError`)) && (await read(`${TK}.tab`)) === 'prompts', 'una respuesta con bloques de menos se rechaza con instrucciones');
  await capture('tiktok_04_prompts');
  const guionIA = ['¿Un llavero con tu nombre por diez mil pesos?', 'Lo diseño en el computador con tu nombre.', 'La Bambu lo imprime capa por capa.', 'Lo despego de la placa y listo.', 'Perfecto para el amigo secreto.'];
  const blocks = Array.from({ length: n }, (_, i) => (i === n - 1 ? 'Escribe tu nombre en los comentarios y el próximo es el tuyo.' : guionIA[i] || 'Y queda listo para regalar.'));
  await set('[data-resp]', blocks.map((b, i) => `${i + 1}. "${b}"`).join('\n'));
  await click('[data-action="apply-ai"]');
  draft = await read(`${TK}.draft`);
  ok((await read(`${TK}.tab`)) === 'crear' && draft.escenas.map((s) => s.voz).join('|') === blocks.join('|'), 'la respuesta numerada de la IA reemplaza la voz de cada escena');

  // 5 · Crear el video en el espacio (tiktok3d.py nuevo + estado) y el kit
  const nums = registro.map((r) => +r.id.slice(1)).concat(fs.readdirSync(path.join(ws, 'videos')).filter((d) => /^V\d+/.test(d)).map((d) => +d.match(/^V(\d+)/)[1]));
  const expected = `V${String(Math.max(...nums) + 1).padStart(3, '0')}`;
  await click('[data-action="create"]', 60000);
  const id = await read(`${TK}.videoId`);
  ok(id === expected && (await read(`${TK}.tab`)) === 'kit' && !(await read(`${TK}.lastError`)), `crea ${expected} y abre su kit`);
  const row = csv('registro/videos.csv').find((r) => r.id === id);
  ok(row && row.estado === 'guion' && row.fecha_plan === draft.fechaPlan && row.formula === 'T5' && row.titulo === draft.titulo, `registro/videos.csv: ${id} en guion, agendado ${row?.fecha_plan}`);
  const dir = path.join(ws, row.carpeta);
  ok(['guion.md', 'video.json', 'kit.md'].every((f) => fs.existsSync(path.join(dir, f))), `${row.carpeta} tiene guion.md, video.json y kit.md`);
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8'));
  const guionMd = fs.readFileSync(path.join(dir, 'guion.md'), 'utf8');
  ok(spec.id === id && spec.escenas.length === n && spec.voz.texto === blocks.join(' | '), 'video.json con las escenas y la voz aplicadas');
  ok(guionMd.includes(id) && !/__ID__|__CARPETA__/.test(guionMd + JSON.stringify(spec)) && blocks.every((b) => guionMd.includes(b)), 'guion.md con id, carpeta y el texto de la IA');
  const bitacora = fs.readFileSync(path.join(ws, 'bitacora', `${today}.md`), 'utf8');
  ok(/## Desde Relieve3D/.test(bitacora) && bitacora.includes(id), `bitácora del día anota ${id}`);
  ok((await read(`${TK}.draft.escenas[0].voz`)) !== blocks[0], 'el formulario queda limpio para el siguiente video');
  ok((await kitStep('grab-tele')).copiar === blocks.join('\n'), 'el teleprompter del kit es exactamente el guion creado');

  // 6 · Diseñar la pieza: el paso abre el módulo de Relieve3D y se vuelve al kit
  await step('prep-diseno');
  for (let i = 0; i < 100 && !(await run(`window.__r3d.S.module==='keychain'`)); i++) await wait(100);
  ok(await run(`document.getElementById('tiktok').hidden&&window.__r3d.S.module==='keychain'&&document.getElementById('home').hidden`), '«Abrir Llavero» abre el módulo Llavero de Relieve3D');
  await run('window.__r3d.showHome()');
  await run(`document.querySelector('#homeGridSocial [data-mod="tiktok"]').click()`); await wait(50); await ready();
  ok((await read(`${TK}.tab`)) === 'kit' && (await read(`${TK}.videoId`)) === id, `al volver, el Estudio sigue en el kit de ${id}`);

  // 7 · Montar con el tiktok3d.py real: voz guía, animatic, revisión
  await step('montar-voz', 180000);
  ok(!(await read(`${TK}.lastError`)) && fs.existsSync(path.join(dir, 'voz.wav')), 'voz guía generada (voz.wav)');
  ok((await kitStep('montar-voz')).estado === 'parcial', 'con la voz guía el paso queda a medias hasta grabar tu voz');
  ok(await run(`!document.querySelector('#tiktok .tk-log').hidden&&document.querySelector('#tiktok [data-log]').textContent.includes('tiktok3d.py voz')`), 'la salida de tiktok3d.py se ve en vivo');
  await click('[data-action="log-toggle"]');
  ok(await run(`getComputedStyle(document.querySelector('#tiktok [data-log]')).display==='none'&&document.querySelector('#tiktok [data-action="log-toggle"]').textContent==='Mostrar'`), '«Ocultar» recoge la salida para ver el kit completo');
  await step('montar-video', 300000);
  ok(await run(`getComputedStyle(document.querySelector('#tiktok [data-log]')).display!=='none'&&document.querySelector('#tiktok [data-log]').textContent.includes('tiktok3d.py video')`), 'al ejecutar otro comando la salida se vuelve a mostrar');
  const animatic = path.join(dir, 'salida', `${id}-animatic.mp4`);
  ok(!(await read(`${TK}.lastError`)) && fs.existsSync(animatic) && fs.statSync(animatic).size > 50000, `animatic renderizado (${Math.round((fs.existsSync(animatic) ? fs.statSync(animatic).size : 0) / 1024)} KB)`);
  ok((await kitStep('montar-video')).estado === 'parcial' && /animatic/.test(fs.readFileSync(path.join(dir, 'kit.md'), 'utf8')), 'kit y kit.md marcan el animatic (falta grabar los clips)');
  await step('montar-revisar', 120000);
  const frames = fs.existsSync(path.join(dir, 'salida', 'revision')) ? fs.readdirSync(path.join(dir, 'salida', 'revision')).filter((f) => f.endsWith('.jpg')) : [];
  ok(!(await read(`${TK}.lastError`)) && frames.length >= 2, `revisión con ${frames.length} fotogramas`);
  for (const f of frames) fs.copyFileSync(path.join(dir, 'salida', 'revision', f), path.join(out, `tiktok_frame_${f}`));
  await step('montar-abrir');
  ok(opened[opened.length - 1] === animatic, '«Abrir video» abre el animatic de la carpeta del video');
  ok((await kitStep('pub-subir')).copiar === animatic.replace(/\//g, '\\'), 'Subir copia la ruta completa del mp4');
  await set('[data-estado]', 'editado');
  ok(csv('registro/videos.csv').find((r) => r.id === id).estado === 'editado' && (await read(`${TK}.video().estado`)) === 'editado', 'el selector de estado actualiza el registro');
  await clean('Kit montado');
  await capture('tiktok_05_montado');

  // 8 · Publicar
  await step('pub-sonido');
  ok(/creativecenter/.test(opened[opened.length - 1]), 'el paso del sonido abre Creative Center');
  await set('[data-pub]', 'http://tiktok.com/x');
  await click('[data-action="publish"]');
  ok(/Pega la URL/.test(await read(`${TK}.lastError`)) && csv('registro/videos.csv').find((r) => r.id === id).estado === 'editado', 'una URL que no es de TikTok se rechaza');
  const url = `https://www.tiktok.com/@pabonitaslaser/video/7${Date.now()}`;
  await set('[data-pub]', url);
  await click('[data-action="publish"]', 60000);
  const pub = csv('registro/videos.csv').find((r) => r.id === id);
  ok(pub.estado === 'publicado' && pub.url === url && pub.fecha_publicado === today, `${id} publicado con su URL y fecha`);
  ok((await kitStep('pub-marcar')).estado === 'ok' && (await run(`!!document.querySelector('#tiktok [data-step-id="pub-marcar"] [data-action="url"]')`)), 'el kit muestra el enlace del video publicado');

  // 9 · Medir: métricas a las 24 h y a los 7 días (→ medido)
  await step('med-24');
  ok((await read(`${TK}.tab`)) === 'medir' && (await read(`${TK}.metric.id`)) === id && (await read(`${TK}.metric.horas_desde_publicacion`)) === '24', 'el paso de 24 h abre el formulario de métricas del video');
  for (const [k, v] of [['vistas', '1.234'], ['tiempo_medio_s', '6,5'], ['vio_completo_pct', '12'], ['me_gusta', '80'], ['comentarios', '9'], ['compartidos', '3'], ['guardados', '7'], ['seguidores_nuevos', '4'], ['trafico_para_ti_pct', '85'], ['notas', '=HYPERLINK("x");hola']]) await set(`[data-m="${k}"]`, v);
  await click('[data-action="metric-save"]');
  let met = csv('registro/metricas.csv').filter((r) => r.id === id);
  ok(met.length === 1 && met[0].vistas === '1234' && met[0].tiempo_medio_s === '6.5' && met[0].horas_desde_publicacion === '24' && met[0].fecha_medicion === today, 'metricas.csv: 1.234 vistas → 1234 y 6,5 s → 6.5');
  ok(/^'=HYPERLINK/.test(met[0].notas) && !met[0].notas.includes(';'), 'las notas no pueden inyectar fórmulas ni romper columnas');
  ok(await run(`[...document.querySelectorAll('#tiktok .tk-card h3')].some(h=>h.textContent.startsWith(${JSON.stringify(`Diagnóstico de ${id}`)}))`), 'aparece el diagnóstico del video');
  ok((await read(`${TK}.metric.id`)) === id && (await read(`${TK}.metric.horas_desde_publicacion`)) === '72', 'el formulario queda listo para la medición de 72 h');
  await set('[data-m="horas_desde_publicacion"]', '168');
  await set('[data-m="vistas"]', '2500');
  await click('[data-action="metric-save"]', 60000);
  ok(csv('registro/metricas.csv').filter((r) => r.id === id).length === 2 && csv('registro/videos.csv').find((r) => r.id === id).estado === 'medido', 'la medición de 7 días marca el video como medido');

  // 10 · Consulta/venta sin datos de clientes
  const pedidosAntes = csv('registro/pedidos-tiktok.csv').length, ventasAntes = await read(`${TK}.agenda.kpis.ventas`);
  await set('[data-p="video_id"]', id);
  await set('[data-p="tipo"]', 'pedido');
  await set('[data-p="producto"]', llavero.nombre);
  await set('[data-p="cantidad"]', '3');
  await set('[data-p="valor_cop"]', '30.000');
  await set('[data-p="estado"]', 'vendido');
  await set('[data-p="notas"]', 'me escribió al 317 262 9957');
  await click('[data-action="pedido-save"]');
  ok(/teléfonos/.test(await read(`${TK}.lastError`)) && !/invoking remote method/.test(await read(`${TK}.lastError`)) && csv('registro/pedidos-tiktok.csv').length === pedidosAntes, 'una nota con teléfono se rechaza con un mensaje claro y no se guarda');
  await set('[data-p="notas"]', 'tres llaveros para la familia');
  await click('[data-action="pedido-save"]');
  const ped = csv('registro/pedidos-tiktok.csv');
  const last = ped[ped.length - 1];
  ok(ped.length === pedidosAntes + 1 && last.video_id === id && last.valor_cop === '30000' && last.estado === 'vendido' && last.cantidad === '3', 'pedidos-tiktok.csv: venta de 30.000 atribuida al video');
  ok((await read(`${TK}.agenda.kpis.ventas`)) === ventasAntes + 1, 'el indicador de ventas sube');
  await clean('Responder y medir');
  await capture('tiktok_06_medir');

  // 11 · Panel del plan y configuración
  await click('.tk-header [data-action="panel"]', 60000);
  const panel = opened[opened.length - 1] || '';
  ok(/\.html$/i.test(panel) && panel.startsWith(ws) && fs.readFileSync(panel, 'utf8').includes(id), `panel del plan generado en la copia y con ${id}`);
  await click('[data-tab="config"]');
  ok(await run(`(()=>{const t=document.querySelector('#tiktok .tk-page').textContent;return t.includes('✓ Encontré')&&!t.includes('✗')&&t.includes('R3D_TIKTOK_DIR')&&t.includes('ideas/banco-de-ideas.md');})()`)
    && (await run(`[...document.querySelectorAll('#tiktok .tk-page td')].filter(td=>td.textContent==='✓').length`)) === 8, 'Configuración: carpeta fija, script y los 8 documentos encontrados (incluye el banco de ideas)');
  ok(await run(`document.querySelector('#tiktok [data-action="pick-root"]').disabled`), 'no deja cambiar la carpeta fijada por variable');
  await set('[data-cfg="python"]', 'python & del');
  await click('[data-action="save-python"]');
  ok(/Python inválido/.test(await read(`${TK}.lastError`)), 'rechaza un comando de Python peligroso');
  await set('[data-cfg="python"]', 'python');
  await click('[data-action="save-python"]');
  ok(!(await read(`${TK}.lastError`)) && fs.existsSync(path.join(out, 'tiktok-studio.json')), 'guarda la configuración de Python');
  await clean('Configuración');
  await capture('tiktok_07_config');

  // 12 · Biblioteca: bases siempre disponibles, prompt para la IA, importar 50 ganchos, buscar, exportar y ocultar
  await run('(window.confirm=()=>true,true)');
  const seedCount = { ganchos: 52, guiones: 30, ctas: 15, hashtags: 12, ideas: 25, respuestas: 10, sonidos: 13 };
  const libFile = (col) => path.join(ws, 'biblioteca', `${col}.json`);
  const libStart = {};
  for (const col of Object.keys(seedCount)) libStart[col] = fs.existsSync(libFile(col)) ? null : seedCount[col];
  await click('[data-tab="biblioteca"]');
  ok((await read(`${TK}.tab`)) === 'biblioteca' && (await read(`${TK}.lib.col`)) === 'ganchos', 'la pestaña Biblioteca abre en Ganchos');
  for (const [col, n0] of Object.entries(seedCount)) {
    const n = await read(`${TK}.libItems(${JSON.stringify(col)}).length`);
    const chip = await run(`document.querySelector('#tiktok [data-action="lib-col"][data-col="${col}"] b').textContent`);
    ok(n >= n0 && (libStart[col] == null || n === n0) && +chip === n, `${col}: ${n} disponibles (${n0} base incluidos) y el contador lo dice`);
  }
  ok((await run(`document.querySelectorAll('#tiktok [data-lib-list] .tk-libcard').length`)) === (await read(`${TK}.libItems('ganchos').length`)), 'cada gancho tiene su tarjeta con origen y acciones');
  await set('[data-lib="n"]', '50');
  await set('[data-lib="tema"]', 'amigo secreto');
  await click('[data-action="lib-prompt"][data-modo="nuevos"]');
  const libPrompt = String(await clipboard.readText()).replace(/\r\n/g, '\n');
  ok(/\b50\b/.test(libPrompt) && /JSON/.test(libPrompt) && /amigo secreto/i.test(libPrompt) && libPrompt.includes(String(llavero.precio).replace(/\B(?=(\d{3})+(?!\d))/g, '.')), `el prompt para pedir 50 ganchos se copia con el tema, el formato JSON y precios reales (${libPrompt.length} caracteres)`);
  await click('[data-action="url"][data-url*="chatgpt"]');
  ok(/^https:\/\/chatgpt\.com/.test(opened[opened.length - 1] || ''), '«Abrir ChatGPT» lleva a la IA');
  const seeds = await read(`${TK}.libItems('ganchos').filter(g=>g.id.startsWith('gan-b')).map(g=>({id:g.id,texto:g.texto}))`);
  const lote = Array.from({ length: 46 }, (_, i) => ({ texto: `Prueba E2E ${i + 1}: así sale {producto} de la Bambu`, pantalla: `PRUEBA ${i + 1}`, formula: 'T1', ocasion: 'general' }));
  lote.push({ id: seeds[0].id, texto: 'Mira lo que sale de mi Bambu en seis horas' });
  lote.push({ texto: seeds[1].texto });
  lote.push({ texto: 'Escríbeme al 317 262 9957 y te lo hago' });
  lote.push({ texto: 'Este llavero cuesta $7.000 nada más' });
  await set('[data-lib="fuente"]', 'ChatGPT');
  await set('[data-lib="pegar"]', `Claro, aquí tienes los 50 ganchos:\n\`\`\`json\n${JSON.stringify(lote, null, 2)}\n\`\`\`\n¿Quieres más?`);
  await click('[data-action="lib-review"]');
  const rev = await read(`(()=>{const r=${TK}.lib.revision;return r&&{n:r.nuevos.length,a:r.actualizados.length,r:r.repetidos.length,x:r.rechazados.map(z=>z.motivos.join(' '))};})()`);
  ok(rev && rev.n === 46 && rev.a === 1 && rev.r === 1 && rev.x.length === 2, `revisar 50 ganchos de la IA: 46 nuevos, 1 actualiza una base por id, 1 repetido, 2 rechazados (${JSON.stringify(rev && { ...rev, x: rev.x.length })})`);
  ok(/contacto/.test(rev.x.join()) && /catálogo/.test(rev.x.join()), 'se rechazan el teléfono y el precio inventado, con el motivo');
  ok(!fs.existsSync(libFile('ganchos')) || libStart.ganchos == null, 'revisar no guarda nada todavía');
  await clean('Biblioteca · revisión');
  await capture('tiktok_08_biblioteca_import');
  await click('[data-action="lib-import"]');
  const gFile = JSON.parse(fs.readFileSync(libFile('ganchos'), 'utf8'));
  ok(gFile.coleccion === 'ganchos' && gFile.items.filter((i) => /^gan-\d{3}$/.test(i.id)).length >= 46 && gFile.items.some((i) => i.id === seeds[0].id && i.texto === lote[46].texto), 'biblioteca/ganchos.json guarda los 46 nuevos y la base editada');
  ok(gFile.items.filter((i) => i.fuente === 'ChatGPT').length >= 46, 'cada gancho importado recuerda que lo hizo ChatGPT');
  ok(/biblioteca\/ganchos\.json — ChatGPT: Ganchos: 46 nuevos, 1 actualizados, 1 repetidos, 2 rechazados/.test(fs.readFileSync(path.join(ws, 'bitacora', `${today}.md`), 'utf8')), 'la bitácora del día anota la importación');
  ok((await read(`${TK}.libItems('ganchos').length`)) === seeds.length + 46 + (gFile.items.length - 47) && !(await read(`${TK}.lib.revision`)), 'la biblioteca se recarga con los nuevos');
  ok(await run(`document.querySelector('#tiktok [data-lib-id="${seeds[0].id}"] .tk-origen').textContent==='Base editada'`), 'la base actualizada se marca «Base editada»');
  await set('[data-lib="q"]', 'prueba e2e');
  ok((await run(`document.querySelectorAll('#tiktok [data-lib-list] .tk-libcard').length`)) === 46, 'buscar filtra al instante (46 de la prueba)');
  await click('[data-action="lib-export"]');
  const exported = JSON.parse(await clipboard.readText());
  ok(exported.length === 46 && exported.every((x) => /^gan-\d{3}$/.test(x.id) && !x.fuente), 'Exportar copia en JSON lo filtrado, con id y sin metadatos');
  await set('[data-lib="pegar"]', JSON.stringify(exported));
  await click('[data-action="lib-review"]');
  ok((await read(`${TK}.lib.revision.repetidos.length`)) === 46 && (await read(`${TK}.lib.revision.nuevos.length`)) === 0 && (await run(`document.querySelector('#tiktok [data-action="lib-import"]').disabled`)), 'volver a importar lo exportado no duplica nada');
  await click('[data-action="lib-discard"]');
  await set('[data-lib="q"]', '');
  await click(`[data-action="lib-hide"][data-id="${seeds[1].id}"]`);
  ok(JSON.parse(fs.readFileSync(libFile('ganchos'), 'utf8')).ocultos.includes(seeds[1].id) && !(await read(`${TK}.libItems('ganchos').some(g=>g.id===${JSON.stringify(seeds[1].id)})`)), 'Ocultar una base la quita de la lista y se recuerda en el archivo');
  ok(fs.existsSync(path.join(ws, 'biblioteca', '.anterior', 'ganchos.json')), 'cada guardado deja copia de la versión anterior');
  const editada = JSON.stringify(seeds[0].id);
  await click(`[data-action="lib-hide"][data-id="${seeds[0].id}"]`);
  ok(JSON.parse(fs.readFileSync(libFile('ganchos'), 'utf8')).items.some((i) => i.id === seeds[0].id && i.texto === lote[46].texto), 'ocultar una base editada conserva tu versión en el archivo');
  await click('[data-action="lib-ocultos"]');
  await click(`[data-action="lib-unhide"][data-id="${seeds[0].id}"]`);
  await click('[data-action="lib-ocultos"]');
  ok((await read(`${TK}.libItem('ganchos', ${editada}).texto`)) === lote[46].texto, 'al restaurarla vuelve con tu texto');
  await click(`[data-action="lib-revert"][data-id="${seeds[0].id}"]`);
  ok((await read(`${TK}.libItem('ganchos', ${editada}).texto`)) === seeds[0].texto && !JSON.parse(fs.readFileSync(libFile('ganchos'), 'utf8')).items.some((i) => i.id === seeds[0].id), '«Volver a la base» descarta tu versión');
  ok(JSON.parse(fs.readFileSync(libFile('ganchos'), 'utf8')).ultimo >= 46, 'el archivo guarda el último id usado (los ids no se reutilizan)');
  await click('[data-action="lib-col"][data-col="ideas"]');
  ok(await run(`document.querySelector('#tiktok .tk-page').textContent.includes('Banco de ideas del espacio')&&!!document.querySelector('#tiktok [data-action="lib-use-banco"]')`), 'Ideas muestra también el banco de ideas del espacio');
  await clean('Biblioteca');

  // 13 · Tendencias en vivo (sin IA): Google Trends Colombia y Reddit, fechas clave, lo que te funciona, Creative Center
  await click('[data-tab="tendencias"]');
  const ideasAntes = await read(`${TK}.libItems('ideas').length`), hashAntes = await read(`${TK}.libItems('hashtags').length`);
  await click('[data-action="trend-refresh"]', 90000);
  const snaps = await read(`${TK}.snaps.map(s=>({f:s.fuente,n:s.items.length,o:s.obtenido,u:s.url}))`);
  const terr = await read(`${TK}.trend.errores`);
  console.log('[e2e] tendencias:', JSON.stringify(snaps.map((s) => `${s.f}:${s.n}`)), JSON.stringify(terr));
  const goog = snaps.find((s) => s.f === 'google-co');
  ok(goog && goog.n >= 5 && /^https:\/\/trends\.google\.com\//.test(goog.u) && Date.now() - Date.parse(goog.o) < 600000, `Google Trends Colombia en vivo: ${goog?.n} temas con enlace y hora`);
  ok(fs.existsSync(path.join(ws, 'tendencias', today, 'google-co.json')), `guardado en tendencias/${today}/google-co.json`);
  ok(Object.values(terr).every((m) => m.length > 10 && !/invoking remote/.test(m)), `si una fuente falla, dice por qué${Object.keys(terr).length ? ` (${Object.keys(terr).join(', ')})` : ''}`);
  const reddit = snaps.filter((s) => s.f.startsWith('reddit-') && s.n > 0);
  if (reddit.length) {
    await click(`[data-action="trend-idea"][data-fuente="${reddit[0].f}"][data-k="0"]`);
    ok((await read(`${TK}.libItems('ideas').length`)) === ideasAntes + 1 && fs.existsSync(libFile('ideas')), `«Guardar como idea» desde ${reddit[0].f} la deja en biblioteca/ideas.json`);
  } else console.log('[e2e] nota: Reddit no respondió (límite de peticiones); se omite «Guardar como idea»');
  const pageT = await run(`document.querySelector('#tiktok .tk-page').textContent`);
  ok(/Black Friday/.test(pageT) && /Publica desde/.test(pageT), 'Fechas que vienen: Black Friday con cuándo empezar a publicar');
  const rank = await read(`${TK}.ranking`);
  ok(rank.some((r) => r.formula === 'T5' && r.videos.includes(id)) && /Lo que te funciona a ti/.test(pageT), `Lo que te funciona a ti usa tus métricas (${rank.map((r) => `${r.formula}:${r.n}`).join(' ')})`);
  await click('[data-action="cc-open"]', 60000);
  ok(!(await read(`${TK}.lastError`)), 'Abrir Creative Center abre su ventana con sesión propia');
  await click('[data-action="cc-capture"]', 30000);
  console.log('[e2e] captura del Creative Center:', (await read(`${TK}.lastError`)) || JSON.stringify(await read(`${TK}.snap('creative-center')&&{n:${TK}.snap('creative-center').items.length,region:${TK}.snap('creative-center').region}`)));
  await set('[data-trend="cc"]', fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tendencias', 'creative-center.txt'), 'utf8'));
  await click('[data-action="cc-parse"]');
  const cc = await read(`${TK}.snap('creative-center')`);
  ok(cc && cc.items.length === 3 && /Estados Unidos/.test(cc.aviso) && await run(`document.querySelector('#tiktok .tk-page').textContent.includes('no de Colombia')`), 'pegar el texto del Creative Center lee los hashtags y avisa que son de Estados Unidos');
  await click('[data-action="cc-set"]');
  ok((await read(`${TK}.libItems('hashtags').length`)) === hashAntes + 1 && fs.existsSync(libFile('hashtags')), '«Guardar como set de hashtags» lo agrega a la biblioteca');
  await clean('Tendencias');
  await capture('tiktok_09_tendencias');
  const tema = await run(`document.querySelector('#tiktok [data-action="trend-use"]')?.dataset.tema||''`);
  ok(!!tema, `hay temas seguros para un gancho de tendencia («${tema}»)`);
  await click(`[data-action="trend-use"][data-tema="${tema.replace(/"/g, '\\"')}"]`);
  ok((await read(`${TK}.tab`)) === 'crear' && (await read(`${TK}.draft.escenas[0].voz`)).toLowerCase().includes(tema.toLowerCase().slice(0, 5)), `«Gancho con esto» pone el tema en la escena 1: «${await read(`${TK}.draft.escenas[0].voz`)}»`);
  ok(await run(`(()=>{const t=document.querySelector('#tiktok [data-libpick]').textContent;return t.includes('Más ganchos de tu biblioteca')&&t.includes('En tendencia hoy');})()`), 'Crear guion muestra ganchos de la biblioteca y en tendencia');
  const gLine = await run(`document.querySelector('#tiktok [data-libpick] [data-action="lib-use"][data-col="ganchos"]').closest('.tk-line').querySelector('span').textContent`);
  const gUse = await run(`document.querySelector('#tiktok [data-libpick] [data-action="lib-use"][data-col="ganchos"]').dataset.id`);
  await click(`[data-libpick] [data-action="lib-use"][data-id="${gUse}"]`);
  const gVoz = await read(`${TK}.draft.escenas[0].voz`);
  ok(gVoz && !/\{/.test(gVoz) && gLine.includes(`«${gVoz}»`), `«Usar» un gancho sugerido lo pone en la escena 1 con los datos reales («${gVoz}»)`);
  await capture('tiktok_10_crear_tendencia');

  // 14 · Segundo video desde un guion base, con un cierre de la biblioteca
  await click('[data-tab="biblioteca"]');
  await click('[data-action="lib-col"][data-col="guiones"]');
  const gb = await read(`${TK}.libItems('guiones')[0]`);
  await click(`[data-action="lib-use"][data-col="guiones"][data-id="${gb.id}"]`);
  let d2 = await read(`${TK}.draft`);
  ok((await read(`${TK}.tab`)) === 'crear' && d2.formato === gb.formato && d2.escenas.length === gb.escenas.length && !d2.avisos.length, `el guion base «${gb.titulo}» llena el borrador (${d2.formato}, ${d2.escenas.length} escenas, sin avisos)`);
  ok(d2.escenas.every((s) => !/\{[A-Za-z_]+\}/.test(`${s.voz} ${s.texto}`)), 'los marcadores {producto}, {precio}… se reemplazan por los datos reales');
  const ctaId = await run(`document.querySelector('#tiktok [data-action="lib-use"][data-col="ctas"]').dataset.id`);
  await click(`[data-action="lib-use"][data-col="ctas"][data-id="${ctaId}"]`);
  d2 = await read(`${TK}.draft`);
  ok(/Colombia/.test(d2.escenas[d2.escenas.length - 1].voz) && !d2.avisos.length, `el cierre de la biblioteca va en la última escena («${d2.escenas[d2.escenas.length - 1].voz}»)`);
  const nums2 = csv('registro/videos.csv').map((r) => +r.id.slice(1)).concat(fs.readdirSync(path.join(ws, 'videos')).filter((x) => /^V\d+/.test(x)).map((x) => +x.match(/^V(\d+)/)[1]));
  const expected2 = `V${String(Math.max(...nums2) + 1).padStart(3, '0')}`;
  await click('[data-action="create"]', 60000);
  const id2 = await read(`${TK}.videoId`);
  const row2 = csv('registro/videos.csv').find((r) => r.id === id2);
  const guion2 = row2 ? fs.readFileSync(path.join(ws, row2.carpeta, 'guion.md'), 'utf8') : '';
  ok(id2 === expected2 && row2 && row2.estado === 'guion' && d2.escenas.every((s) => !s.voz || guion2.includes(s.voz)), `crea ${expected2} desde el guion base con todo su texto en guion.md`);
  await clean('Kit del guion base');

  await click('[data-action="reload"]');
  ok((await read(`${TK}.ctx.videos.length`)) === registro.length + 2, 'Recargar lee los 2 videos nuevos');
  ok((await read(`${TK}.libItems('ganchos').length`)) === seeds.length - 1 + 46 + (gFile.items.length - 47) && (await read(`${TK}.snaps.length`)) >= 2, 'Recargar conserva la biblioteca y las tendencias guardadas');

  // 15 · Volver al inicio; el espacio real queda intacto
  await click('[data-action="home"]');
  ok(await run(`document.getElementById('tiktok').hidden&&!document.getElementById('home').hidden`), '← Inicio vuelve al inicio de Relieve3D');
  ok(snapshot(src) === realBefore, 'el espacio TikTok real no se tocó');
  ok(!errors.length, `sin errores en la consola${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  console.log('[e2e] done');
};

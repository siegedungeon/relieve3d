// Estudio TikTok (proceso principal): lectura del espacio, ejecución segura de tiktok3d.py y escritura de registros.
// Usa una copia temporal de test/fixtures/tiktok con un tiktok3d.py de prueba que anota cada llamada.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as T from '../src/core/tiktok_studio.js';

const require = createRequire(import.meta.url);
const { createTiktokWorkspace } = require('../src/main/tiktok_workspace.cjs');
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tiktok');

const STUB = `import sys, json, pathlib, time
args = sys.argv[1:]
root = pathlib.Path.cwd()
with open(root / 'calls.log', 'a', encoding='utf-8') as f:
    f.write(json.dumps(args, ensure_ascii=False) + '\\n')
cmd = args[0]
if cmd == 'nuevo':
    d = root / 'videos' / 'V013-cana-de-navidad'
    d.mkdir(parents=True, exist_ok=True)
    print('Carpeta creada: ñandú ✓')
    print(str(d))
elif cmd == 'revisar':
    print('aviso: duración corta')
    sys.exit(1)
elif cmd == 'video':
    time.sleep(0.8)
    print('listo ✓')
elif cmd == 'estado' and args[2] == 'medido':
    print('error simulado', file=sys.stderr)
    sys.exit(2)
else:
    print('ok ' + ' '.join(args))
`;

function workspace({ stub = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-tiktok-'));
  fs.cpSync(fixtures, dir, { recursive: true });
  if (stub) { fs.mkdirSync(path.join(dir, 'herramientas')); fs.writeFileSync(path.join(dir, 'herramientas', 'tiktok3d.py'), STUB); }
  const ws = createTiktokWorkspace({ configFile: path.join(dir, '.cfg', 'tiktok.json'), env: { ...process.env, R3D_TIKTOK_DIR: dir, R3D_TIKTOK_TODAY: '2026-11-04' } });
  const calls = () => (fs.existsSync(path.join(dir, 'calls.log')) ? fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { dir, ws, calls, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('load: exige tiktok3d.py y entrega documentos y carpetas de video', async () => {
  const sin = workspace({ stub: false });
  try {
    const r = await sin.ws.load();
    assert.equal(r.ok, false);
    assert.match(r.motivo, /tiktok3d\.py/);
  } finally { sin.done(); }
  const { ws, dir, done } = workspace();
  try {
    fs.mkdirSync(path.join(dir, 'videos', 'V004-comenta-tu-nombre-y-te-lo-hago-en-3d', 'clips'));
    fs.writeFileSync(path.join(dir, 'videos', 'V004-comenta-tu-nombre-y-te-lo-hago-en-3d', 'clips', 'cara.mp4'), '');
    const r = await ws.load();
    assert.equal(r.ok, true);
    assert.equal(r.fixed, true);
    assert.equal(r.today, '2026-11-04');
    assert.ok(Object.values(r.docs).every((t) => typeof t === 'string' && t.length > 10));
    const v4 = r.videos.find((v) => v.carpeta.startsWith('videos/V004'));
    assert.deepEqual(v4.clips, ['cara.mp4']);
    assert.ok(v4.guion.startsWith('---') || v4.guion.startsWith('#'));
    assert.equal(r.videos.some((v) => v.carpeta.includes('_plantilla')), false);
    const ctx = T.buildContext({ ...r.docs, videos: r.videos, today: r.today, now: r.now });
    assert.deepEqual(ctx.avisos, []);
  } finally { done(); }
});

test('validateArgs: solo comandos permitidos y rutas dentro de videos/', () => {
  const { ws, done } = workspace();
  try {
    for (const bad of [[], ['borrar', 'videos'], ['voz', 'videos/../../Windows'], ['voz', 'C:\\Windows'], ['voz', 'videos/V004-x', '--rm'],
      ['video', 'videos/V004-x', '--forzar'], ['revisar', 'videos/V004-x/salida/../../x.mp4'], ['estado', 'V004', 'borrado'],
      ['estado', 'V004', 'publicado', '--url', 'http://www.tiktok.com/@x'], ['estado', 'V004', 'publicado', '--url', 'https://evil.com/tiktok.com/'],
      ['estado', '../V004', 'guion'], ['nuevo', '--pilar'], ['nuevo', 'x', '--exec', 'y'], ['panel', '--salida', 'C:\\'], ['estado', 'V004', 'guion\nmedido']]) {
      assert.throws(() => ws.validateArgs(bad), Error, JSON.stringify(bad));
    }
    assert.deepEqual(ws.validateArgs(['voz', 'videos\\V004-x', '--forzar']).args, ['voz', 'videos/V004-x', '--forzar']);
    assert.deepEqual(ws.validateArgs(['estado', 'V004', 'guion', '--fecha-plan', '']).args, ['estado', 'V004', 'guion', '--fecha-plan', '']);
  } finally { done(); }
});

test('cada botón "run" del kit pasa la lista permitida del proceso principal', async () => {
  const { ws, done } = workspace();
  try {
    const r = await ws.load();
    const ctx = T.buildContext({ ...r.docs, videos: r.videos.map((v) => ({ ...v, salida: [`${v.carpeta.slice(7, 11)}-final.mp4`] })), today: r.today, now: r.now });
    let n = 0;
    for (const v of ctx.videos) {
      for (const s of T.buildKit(v, ctx).fases.flatMap((f) => f.pasos)) {
        if (s.accion?.tipo !== 'run') continue;
        assert.doesNotThrow(() => ws.validateArgs(s.accion.args), `${v.id} ${s.id}`);
        n++;
      }
    }
    assert.ok(n >= 9);
  } finally { done(); }
});

test('run: salida UTF-8 en vivo, --hoy en panel, revisar con avisos y una ejecución a la vez', async () => {
  const { ws, calls, done } = workspace();
  try {
    const lines = [];
    const p = await ws.run(['panel'], (l) => lines.push(l));
    assert.equal(p.ok, true);
    assert.deepEqual(p.args, ['panel', '--hoy', '2026-11-04']);
    const rv = await ws.run(['revisar', 'videos/V004-comenta-tu-nombre-y-te-lo-hago-en-3d/salida/V004-final.mp4']).catch((e) => e);
    assert.match(rv.message, /No existe/, 'revisar exige que el video exista');
    const slow = ws.run(['video', 'videos/V004-comenta-tu-nombre-y-te-lo-hago-en-3d'], (l) => lines.push(l));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(ws.isBusy(), true);
    await assert.rejects(ws.run(['sfx']), /todavía corre/);
    const v = await slow;
    assert.equal(v.ok, true);
    assert.ok(lines.includes('listo ✓'), 'acentos y símbolos llegan intactos');
    assert.equal(ws.isBusy(), false);
    const bad = await ws.run(['estado', 'V004', 'medido']);
    assert.equal(bad.ok, false);
    assert.match(bad.stderr, /error simulado/);
    assert.deepEqual(calls().map((c) => c[0]), ['panel', 'video', 'estado']);
  } finally { done(); }
});

test('run: revisar devuelve ok con código 1 (avisos) si el video existe', async () => {
  const { ws, dir, done } = workspace();
  try {
    const sal = path.join(dir, 'videos', 'V004-comenta-tu-nombre-y-te-lo-hago-en-3d', 'salida');
    fs.mkdirSync(sal, { recursive: true });
    fs.writeFileSync(path.join(sal, 'V004-final.mp4'), '');
    const r = await ws.run(['revisar', 'videos\\V004-comenta-tu-nombre-y-te-lo-hago-en-3d\\salida\\V004-final.mp4']);
    assert.equal(r.ok, true);
    assert.equal(r.code, 1);
  } finally { done(); }
});

test('createVideo: carpeta nueva con guion.md, video.json, estado y bitácora', async () => {
  const { ws, dir, calls, done } = workspace();
  try {
    const r = await ws.load();
    const ctx = T.buildContext({ ...r.docs, videos: r.videos, today: r.today, now: r.now });
    const d = T.draftVideo({ producto: 'llaveros-personalizados-3d', formula: 'T1', fechaPlan: '2026-11-16T18:30' }, ctx);
    await assert.rejects(ws.createVideo({ titulo: d.titulo, guion: 'sin token', videoJson: '{}' }), /Guion inválido/);
    await assert.rejects(ws.createVideo({ titulo: d.titulo, guion: '__ID__', videoJson: '{}', fechaPlan: '16/11/2026' }), /Fecha/);
    const out = await ws.createVideo({
      titulo: d.titulo, pilar: d.pilar, formula: d.formula, fechaPlan: d.fechaPlan,
      guion: T.renderGuion(d, { id: '__ID__', fecha: ctx.today, carpeta: '__CARPETA__' }),
      videoJson: JSON.stringify(T.renderVideoJson(d, { id: '__ID__' })),
    });
    assert.deepEqual(out, { id: 'V013', carpeta: 'videos/V013-cana-de-navidad' });
    const g = fs.readFileSync(path.join(dir, out.carpeta, 'guion.md'), 'utf8');
    assert.ok(!g.includes('__ID__') && !g.includes('__CARPETA__'));
    assert.match(g, /V013/);
    const spec = JSON.parse(fs.readFileSync(path.join(dir, out.carpeta, 'video.json'), 'utf8'));
    assert.equal(spec.id, 'V013');
    assert.equal(spec.voz.texto.split('|').length, d.escenas.length);
    const c = calls();
    assert.deepEqual(c[0].slice(0, 2), ['nuevo', d.titulo]);
    assert.deepEqual(c[1], ['estado', 'V013', 'guion', '--fecha-plan', '2026-11-16T18:30']);
    const bit = fs.readFileSync(path.join(dir, 'bitacora', '2026-11-04.md'), 'utf8');
    assert.match(bit, /## Desde Relieve3D/);
    assert.match(bit, /creé V013/);
  } finally { done(); }
});

test('appendCsv: columnas del encabezado, CRLF, celdas seguras y sin datos de clientes', async () => {
  const { ws, dir, done } = workspace();
  try {
    await assert.rejects(ws.appendCsv('metricas', { id: 'V004', fecha_medicion: '2026-11-07', vistas: '' }), /vistas/);
    await assert.rejects(ws.appendCsv('metricas', { id: 'V004', fecha_medicion: '2026-11-07', vistas: '-5' }), /Número inválido/);
    await assert.rejects(ws.appendCsv('otro', {}), /no permitido/);
    const m = await ws.appendCsv('metricas', { id: 'V004', fecha_medicion: '2026-11-07', horas_desde_publicacion: '24', vistas: '1.234', me_gusta: '1,5', compartidos: '2.345,0', tiempo_medio_s: '6,46', vio_completo_pct: '31.27', notas: '=HYPERLINK("x");hola\nmundo' });
    assert.equal(m.vistas, '1234', 'separador de miles colombiano');
    assert.equal(m.me_gusta, '2');
    assert.equal(m.compartidos, '2345');
    const lines = fs.readFileSync(path.join(dir, 'registro', 'metricas.csv'), 'utf8').split('\r\n');
    const head = lines[0].replace(/^\uFEFF/, '').split(';');
    const row = lines[1].split(';');
    assert.equal(row.length, head.length);
    assert.equal(row[head.indexOf('tiempo_medio_s')], '6.5');
    assert.equal(row[head.indexOf('vio_completo_pct')], '31.3');
    assert.equal(row[head.indexOf('notas')], `'=HYPERLINK("x") hola mundo`);
    assert.equal(lines[2], '');

    for (const notas of ['me escribió al 317 262 9957', 'cliente @juanita', '+57 3001234567']) {
      await assert.rejects(ws.appendCsv('pedidos', { fecha: '2026-11-07', tipo: 'consulta', canal: 'WhatsApp', producto: 'Llavero', estado: 'consulta', notas }), /teléfonos/, notas);
    }
    await ws.appendCsv('pedidos', { fecha: '2026-11-07', video_id: 'V004', tipo: 'pedido', canal: 'DM TikTok', producto: 'Llavero con nombre', cantidad: '3', valor_cop: '30000', estado: 'vendido', notas: 'pagó 1.500.000 en total' });
    const ped = fs.readFileSync(path.join(dir, 'registro', 'pedidos-tiktok.csv'), 'utf8');
    assert.match(ped, /\r\n2026-11-07;V004;pedido;DM TikTok;Llavero con nombre;3;30000;vendido;pagó 1\.500\.000 en total\r\n$/);
    const bit = fs.readFileSync(path.join(dir, 'bitacora', '2026-11-04.md'), 'utf8');
    assert.match(bit, /métricas de V004 a las 24 h: 1234 vistas/);
    assert.match(bit, /pedido por DM TikTok \(de V004\)/);
  } finally { done(); }
});

test('saveKit, resolveInside y configuración no salen del espacio', async () => {
  const { ws, dir, done } = workspace();
  try {
    await assert.rejects(ws.saveKit('videos/../registro', '# x'), /inválida/);
    await assert.rejects(ws.saveKit('videos/V004-comenta-tu-nombre-y-te-lo-hago-en-3d', 'sin título'), /Kit inválido/);
    const f = await ws.saveKit('videos/V004-comenta-tu-nombre-y-te-lo-hago-en-3d', '# Kit V004\n');
    assert.equal(fs.readFileSync(f, 'utf8'), '# Kit V004\n');
    await assert.rejects(ws.resolveInside('..\\..\\Windows'), /fuera del espacio/);
    await assert.rejects(ws.resolveInside(path.join(os.tmpdir())), /fuera del espacio/);
    assert.equal(await ws.resolveInside('.'), dir);
    await assert.rejects(ws.saveConfig({ root: os.tmpdir() }), /tiktok3d\.py/);
    await assert.rejects(ws.saveConfig({ python: 'python & del x' }), /Python inválido/);
    const s = await ws.saveConfig({ python: 'C:\\Python314\\python.exe' });
    assert.equal(s.python, 'C:\\Python314\\python.exe');
    assert.equal(s.root, dir, 'R3D_TIKTOK_DIR manda sobre la configuración');
  } finally { done(); }
});

test('biblioteca: guarda solo colecciones e ids permitidos, de forma atómica, con respaldo y bitácora', async () => {
  const { ws, dir, done } = workspace();
  try {
    let r = await ws.load();
    assert.deepEqual(Object.keys(r.biblioteca).sort(), ['ctas', 'ganchos', 'guiones', 'hashtags', 'ideas', 'respuestas', 'sonidos']);
    assert.equal(r.biblioteca.ganchos, null);
    assert.match(r.docs.ideas, /\| I001 \|/);
    await assert.rejects(ws.saveBiblioteca('../x', { items: [] }), /no permitida/);
    await assert.rejects(ws.saveBiblioteca('ganchos', { items: [{ id: 'gui-001', texto: 'x' }] }), /id inválido/);
    await assert.rejects(ws.saveBiblioteca('ganchos', { items: [{ id: 'gan-001' }, { id: 'gan-001' }] }), /repetido/);
    await assert.rejects(ws.saveBiblioteca('ganchos', { items: 'x' }), /inválida/);
    const archivo = { actualizado: '2026-11-04T10:00', ocultos: ['gan-b03', 'gan-001', '../x'], items: [{ id: 'gan-001', texto: 'Uno', fuente: 'ChatGPT' }] };
    assert.deepEqual(await ws.saveBiblioteca('ganchos', archivo, 'ChatGPT: 1 nuevo'), { archivo: 'biblioteca/ganchos.json', items: 1, ocultos: 1 });
    const file = path.join(dir, 'biblioteca', 'ganchos.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).ocultos, ['gan-b03']);
    await ws.saveBiblioteca('ganchos', { ...archivo, items: [...archivo.items, { id: 'gan-002', texto: 'Dos' }] });
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'biblioteca', '.anterior', 'ganchos.json'), 'utf8')).items.length, 1);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'biblioteca')).filter((f) => f.endsWith('.tmp')), []);
    fs.writeFileSync(path.join(dir, 'biblioteca', 'ctas.json'), '{ roto');
    r = await ws.load();
    assert.equal(r.biblioteca.ganchos.items.length, 2);
    assert.match(r.biblioteca.ctas.error, /dañado/);
    await ws.saveBiblioteca('ctas', { items: [] });
    assert.ok(fs.readdirSync(path.join(dir, 'biblioteca', '.anterior')).some((f) => /^ctas\.danado-.*\.json$/.test(f)));
    assert.match(fs.readFileSync(path.join(dir, 'bitacora', '2026-11-04.md'), 'utf8'), /biblioteca\/ganchos\.json — ChatGPT: 1 nuevo/);
    // JSON válido pero con otra forma (un arreglo exportado, ids a mano): se respalda aparte con fecha, nunca en el respaldo que se pisa.
    const ideas = path.join(dir, 'biblioteca', 'ideas.json');
    const exportado = JSON.stringify([{ id: 'ide-001', idea: 'Idea exportada' }]);
    fs.writeFileSync(ideas, exportado);
    await ws.saveBiblioteca('ideas', { items: [] });
    await ws.saveBiblioteca('ideas', { items: [{ id: 'ide-002', idea: 'Otra' }] });
    const anterior = path.join(dir, 'biblioteca', '.anterior');
    const danadas = fs.readdirSync(anterior).filter((f) => /^ideas\.danado-.*\.json$/.test(f));
    assert.equal(danadas.length, 1);
    assert.equal(fs.readFileSync(path.join(anterior, danadas[0]), 'utf8'), exportado);
    fs.writeFileSync(ideas, JSON.stringify({ items: [{ id: 'ide-1', idea: 'Id escrito a mano' }] }));
    await ws.saveBiblioteca('ideas', { items: [] });
    assert.equal(fs.readdirSync(anterior).filter((f) => /^ideas\.danado-.*\.json$/.test(f)).length, 2);
    // El contador de ids se guarda y no baja del id más alto.
    await ws.saveBiblioteca('ideas', { ultimo: 9, items: [{ id: 'ide-003', idea: 'Tercera' }] });
    assert.equal(JSON.parse(fs.readFileSync(ideas, 'utf8')).ultimo, 9);
    await ws.saveBiblioteca('ideas', { ultimo: 'x', items: [{ id: 'ide-012', idea: 'Doce' }] });
    assert.equal(JSON.parse(fs.readFileSync(ideas, 'utf8')).ultimo, 12);
  } finally { done(); }
});

test('tendencias: descarga solo de las fuentes permitidas, con su User-Agent y errores claros; guarda por fecha', async () => {
  const { TREND_URLS } = require('../src/main/tiktok_workspace.cjs');
  const TR = await import('../src/core/tiktok_tendencias.js');
  for (const k of TR.FUENTES_AUTO) assert.equal(TREND_URLS[k], TR.FUENTES[k].url, `${k}: la URL del proceso principal y la del módulo deben coincidir`);
  const llamadas = [];
  const fakeFetch = async (url, opts) => {
    llamadas.push({ url, ua: opts.headers['User-Agent'] });
    if (url.includes('3Dprinting')) return { ok: false, status: 429, text: async () => '' };
    if (url.includes('BambuLab')) return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' }))));
    return { ok: true, status: 200, text: async () => '<rss><channel><item><title>superluna</title></item></channel></rss>' };
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-tiktok-'));
  try {
    fs.cpSync(fixtures, dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'herramientas'));
    fs.writeFileSync(path.join(dir, 'herramientas', 'tiktok3d.py'), STUB);
    const ws = createTiktokWorkspace({ configFile: path.join(dir, '.cfg', 't.json'), env: { R3D_TIKTOK_DIR: dir, R3D_TIKTOK_TODAY: '2026-11-06' }, fetchImpl: fakeFetch, fetchTimeoutMs: 200 });
    await assert.rejects(ws.fetchTrend('https://evil.example'), /no permitida/);
    await assert.rejects(ws.fetchTrend('creative-center'), /no permitida/);
    const g = await ws.fetchTrend('google-co');
    assert.match(g.texto, /superluna/);
    assert.equal(g.url, TREND_URLS['google-co']);
    assert.match(llamadas[0].ua, /^Relieve3D\//);
    await assert.rejects(ws.fetchTrend('reddit-3dprinting'), /429.*espera unos minutos/);
    await assert.rejects(ws.fetchTrend('reddit-bambulab'), /no respondió/);
    const snap = TR.snapshotDe('google-co', { texto: g.texto, obtenido: g.obtenido });
    await assert.rejects(ws.saveTrends([{ ...snap, fuente: '../../x' }]), /inválida/);
    assert.deepEqual(await ws.saveTrends([snap]), ['tendencias/2026-11-06/google-co.json']);
    const viejo = path.join(dir, 'tendencias', '2026-11-01');
    fs.mkdirSync(viejo);
    fs.writeFileSync(path.join(viejo, 'creative-center.json'), JSON.stringify({ fuente: 'creative-center', items: [{ hashtag: '#navidad' }] }));
    fs.writeFileSync(path.join(viejo, 'google-co.json'), JSON.stringify({ fuente: 'google-co', items: [{ termino: 'viejo' }] }));
    const r = await ws.load();
    assert.equal(r.tendencias['google-co'].items[0].termino, 'superluna', 'gana lo más reciente');
    assert.equal(r.tendencias['creative-center'].dia, '2026-11-01');
    assert.match(fs.readFileSync(path.join(dir, 'bitacora', '2026-11-06.md'), 'utf8'), /guardé tendencias de google-co \(1\)/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

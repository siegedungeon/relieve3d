// Accesos locales (solo escritorio): lectura y validación de <userData>/accesos-locales.json, y contrato con la
// versión web (que replica exactamente las claves de window.api y no debe ver este acceso).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createLocalLinks, MAX_LINKS } = require('../src/main/local_links.cjs');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function setup(config, { bom = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-local-'));
  const guide = path.join(dir, 'Mi guía ñ', 'guía.html');
  fs.mkdirSync(path.dirname(guide));
  fs.writeFileSync(guide, '<title>Guía</title>');
  const configFile = path.join(dir, 'accesos-locales.json');
  if (config !== undefined) {
    const text = typeof config === 'string' ? config : JSON.stringify(typeof config === 'function' ? config(guide, dir) : config);
    fs.writeFileSync(configFile, (bom ? '\uFEFF' : '') + text);
  }
  return { dir, guide, links: createLocalLinks({ configFile }), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('sin accesos-locales.json no hay accesos ni avisos', async (t) => {
  const s = setup();
  t.after(s.done);
  assert.deepEqual(await s.links.list(), { accesos: [], avisos: [] });
});

test('un acceso válido se normaliza (con BOM, en { accesos } o como lista)', async (t) => {
  const s = setup((guide) => ({ accesos: [{
    id: 'Entrevista', titulo: '  Entrevista\n Senior  ', descripcion: 'Guía .NET', icono: '👩‍💻', archivo: ` ${guide.replace(/\\/g, '/')} `,
  }] }), { bom: true });
  t.after(s.done);
  const expected = { id: 'entrevista', titulo: 'Entrevista Senior', descripcion: 'Guía .NET', icono: '👩‍💻', archivo: s.guide, nombre: 'guía.html', existe: true };
  assert.deepEqual(await s.links.list(), { accesos: [expected], avisos: [] });
  assert.deepEqual(await s.links.find('entrevista'), expected);

  fs.writeFileSync(s.links.configFile, JSON.stringify([{ id: 'guia', titulo: 'Guía', archivo: s.guide }]));
  const { accesos } = await s.links.list();
  assert.equal(accesos[0].icono, '🔗', 'sin icono se usa el genérico');
  assert.equal(accesos[0].descripcion, '');
});

test('las entradas inválidas se saltan con un aviso y las válidas siguen', async (t) => {
  const s = setup((guide, dir) => ({ accesos: [
    'texto',
    { id: 'sin-titulo', archivo: guide },
    { id: 'mi guía', titulo: 'Id con espacio', archivo: guide },
    { id: 'a', titulo: 'Primera', archivo: guide },
    { id: 'a', titulo: 'Repetida', archivo: guide },
    { id: 'relativa', titulo: 'Relativa', archivo: 'guia.html' },
    { id: 'programa', titulo: 'Programa', archivo: path.join(dir, 'calc.exe') },
    { id: 'imagen', titulo: 'Imagen', archivo: path.join(dir, 'foto.png') },
    { id: 'x'.repeat(41), titulo: 'Id largo', archivo: guide },
  ] }));
  t.after(s.done);
  const { accesos, avisos } = await s.links.list();
  assert.deepEqual(accesos.map((a) => a.titulo), ['Primera']);
  assert.equal(avisos.length, 8, avisos.join('\n'));
  assert.match(avisos[0], /Acceso 1: no es un objeto/);
  assert.match(avisos[1], /Acceso 2: falta "titulo"/);
  assert.match(avisos[2], /«Id con espacio»: "id"/);
  assert.match(avisos[3], /«Repetida»: el id "a" está repetido/);
  assert.match(avisos[4], /«Relativa»: "archivo" debe ser una ruta completa/);
  assert.match(avisos[5], /«Programa»: solo se abren archivos \.html/);
  assert.match(avisos[6], /«Imagen»: solo se abren archivos \.html/);
  assert.match(avisos[7], /«Id largo»: "id"/);
  await assert.rejects(s.links.find('programa'), /ya no está en accesos-locales\.json/);
});

test('un archivo que falta se lista con existe:false y no se puede abrir', async (t) => {
  const s = setup((guide, dir) => [{ id: 'movida', titulo: 'Movida', archivo: path.join(dir, 'ya-no-esta.html') }]);
  t.after(s.done);
  const { accesos, avisos } = await s.links.list();
  assert.deepEqual(avisos, []);
  assert.equal(accesos[0].existe, false);
  await assert.rejects(s.links.find('movida'), /No encuentro .*ya-no-esta\.html/);
  await assert.rejects(s.links.find('otra'), /ya no está/);
});

test('JSON inválido o con otra forma avisa sin lanzar', async (t) => {
  const s = setup('{ "accesos": [ ');
  t.after(s.done);
  const bad = await s.links.list();
  assert.deepEqual(bad.accesos, []);
  assert.match(bad.avisos[0], /accesos-locales\.json no es un JSON válido/);
  for (const shape of ['{}', '{"accesos":{}}', '"texto"', 'null']) {
    fs.writeFileSync(s.links.configFile, shape);
    assert.match((await s.links.list()).avisos[0], /debe tener la forma \{ "accesos"/, shape);
  }
});

test(`como mucho ${MAX_LINKS} accesos`, async (t) => {
  const s = setup((guide) => Array.from({ length: MAX_LINKS + 5 }, (_, i) => ({ id: `g${i}`, titulo: `Guía ${i}`, archivo: guide })));
  t.after(s.done);
  const { accesos, avisos } = await s.links.list();
  assert.equal(accesos.length, MAX_LINKS);
  assert.deepEqual(avisos, [`Solo se muestran los primeros ${MAX_LINKS} accesos.`]);
});

test('contrato con la versión web: el acceso local va fuera de window.api', () => {
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const start = preload.indexOf("exposeInMainWorld('api', {");
  const block = preload.slice(start, preload.indexOf('\n});', start));
  assert.ok(start >= 0 && block.length > 100);
  assert.doesNotMatch(block, /local-link/, 'window.api no debe tener canales de accesos locales');
  // La web cuenta las claves de window.api con esta expresión sobre todo preload.js: el puente local no debe sumar.
  const keys = (text) => [...text.matchAll(/^ {2}(\w+): /gm)].map((m) => m[1]);
  assert.deepEqual(keys(preload), keys(block));
  assert.match(preload, /\ncontextBridge\.exposeInMainWorld\('r3dLocal', \{ list: \(\) => ipcRenderer\.invoke\('local-links'\)/);
  const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
  assert.doesNotMatch(app, /window\.api\??\.\w*local/i);
});

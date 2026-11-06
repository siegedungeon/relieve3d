// Estudio TikTok · biblioteca (semillas + lo que agregas tú o una IA) y tendencias sin IA (RSS, Creative Center, fechas, métricas).
// Fixtures: test/fixtures/tiktok (espacio saneado) y test/fixtures/tendencias (respuestas reales recortadas del 2026-11-06).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '../src/core/tiktok_studio.js';
import * as B from '../src/core/tiktok_biblioteca.js';
import * as TR from '../src/core/tiktok_tendencias.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'fixtures', 'tiktok');
const rd = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/^\uFEFF/, '');
const tend = (f) => fs.readFileSync(path.join(here, 'fixtures', 'tendencias', f), 'utf8');

function context({ metricasCsv = rd('registro/metricas.csv'), videosCsv = rd('registro/videos.csv') } = {}) {
  return T.buildContext({
    perfil: rd('estrategia/perfil-cuenta.md'), voz: rd('estrategia/voz-y-marca.md'), hashtags: rd('estrategia/hashtags-y-seo.md'),
    campana: rd('estrategia/campana-navidad-2026.md'), videosCsv, metricasCsv, videos: [], root, today: '2026-11-06', now: '2026-11-06T10:00',
  });
}
const ctx = context();
const BASE = { producto: 'llaveros-personalizados-3d', ocasion: 'general', objetivo: 'comentarios', formula: 'T1', formato: 'F1', hook: 0, escenas: [], lista: [] };
const textoDe = (d) => d.escenas.map((e) => `${e.voz} ${e.texto}`).join(' | ');

// ------------------------------------------------------------------ semillas

test('semillas: 30 guiones base, 50+ ganchos y todas las colecciones válidas, sin ids ni textos repetidos', () => {
  assert.equal(B.SEMILLAS.guiones.length, 30);
  assert.ok(B.SEMILLAS.ganchos.length >= 50);
  for (const col of Object.keys(B.COLECCIONES)) {
    assert.ok(B.SEMILLAS[col].length >= 10, col);
    const ids = B.SEMILLAS[col].map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${col}: ids repetidos`);
    const claves = B.SEMILLAS[col].map((s) => B.claveDe(col, s));
    assert.equal(new Set(claves).size, claves.length, `${col}: textos repetidos`);
    for (const s of B.SEMILLAS[col]) {
      assert.ok(B.idValido(col, s.id) && B.esSemilla(col, s.id), s.id);
      const v = B.validarItem(col, s, ctx);
      assert.deepEqual(v.motivos, [], `${s.id}: ${v.motivos.join('; ')}`);
    }
  }
});

test('cada guion base produce un borrador de su formato, sin marcadores sueltos, precios inventados ni marcas', () => {
  for (const g of B.SEMILLAS.guiones) {
    const r = B.usarGuion(ctx, BASE, g);
    assert.deepEqual(r.avisos, [], g.id);
    const d = T.draftVideo(r.input, ctx);
    assert.equal(d.formato, g.formato, g.id);
    assert.equal(d.escenas.length, B.ESCENAS_POR_FORMATO[g.formato], g.id);
    const txt = textoDe(d);
    assert.doesNotMatch(txt, /\{[A-Za-z_]+\}/, `${g.id}: ${txt}`);
    assert.deepEqual(T.revisarTexto(ctx, txt), [], g.id);
  }
});

test('usarGuion respeta el producto que pide el guion y deja la funda (sublimación) en antes/después', () => {
  const funda = B.SEMILLAS.guiones.find((g) => /funda/i.test(g.producto || '') && g.formato === 'F5');
  const r = B.usarGuion(ctx, BASE, funda);
  assert.equal(r.input.producto, 'funda-navidena-para-puerta');
  assert.match(textoDe(T.draftVideo(r.input, ctx)), /35 mil/);
  const lista = B.SEMILLAS.guiones.find((g) => g.formato === 'F4');
  const d = T.draftVideo(B.usarGuion(ctx, BASE, lista).input, ctx);
  assert.equal(d.formula, 'T7');
  assert.equal(d.escenas.length, 5);
});

// ------------------------------------------------------------------ importar lo que devuelve una IA

const RESPUESTA_IA = `Aquí tienes los ganchos:
\`\`\`json
{ "ganchos": [
  { "hook": "¿Sabías que tu nombre cabe en un llavero?", "texto_en_pantalla": "TU NOMBRE EN 3D", "formula": "t6", "pilar": "Útil", "ocasion": "Amigo secreto" },
  { "texto": "Lo imprimí en 40 minutos y nadie lo cree", "pantalla": "40 MINUTOS", "formula": "T1", },
] }
\`\`\`
Espero que te sirvan.`;

test('importar: JSON con texto alrededor, alias de campos, comas sobrantes y valores normalizados', () => {
  const r = B.parseImport('ganchos', RESPUESTA_IA, ctx);
  assert.equal(r.error, '');
  assert.equal(r.formato, 'json');
  assert.equal(r.items.length, 2);
  const [a] = r.items.map((x) => x.item);
  assert.equal(a.texto, '¿Sabías que tu nombre cabe en un llavero?');
  assert.equal(a.pantalla, 'TU NOMBRE EN 3D');
  assert.equal(a.formula, 'T6');
  assert.equal(a.pilar, 'util');
  assert.equal(a.ocasion, 'amigo-secreto');
  const sinBloque = B.parseImport('ctas', 'Claro, aquí van: [{"voz":"Escribe NAVIDAD por DM y te paso el catálogo.","pantalla":"ESCRIBE NAVIDAD","objetivo":"DM"}]', ctx);
  assert.equal(sinBloque.formato, 'json');
  assert.equal(sinBloque.items[0].item.objetivo, 'dms');
});

test('importar: una línea por elemento (texto | pantalla | fotograma | fórmula) cuando la IA no devuelve JSON', () => {
  const r = B.parseImport('ganchos', 'Ganchos nuevos:\n1. Nadie adivina qué es esto | ¿QUÉ ES? | Timelapse sin pistas | T4\n2) Tu nombre, en tu llavero, hoy | TU NOMBRE', ctx);
  assert.equal(r.formato, 'lineas');
  assert.deepEqual(r.items.map((x) => [x.item.texto, x.item.formula || '']), [['Nadie adivina qué es esto', 'T4'], ['Tu nombre, en tu llavero, hoy', '']]);
  assert.match(B.parseImport('guiones', 'Escena 1: hola', ctx).error, /JSON/);
});

test('importar: rechaza contacto, precios inventados, marcas, descuentos, envío gratis, frases prohibidas, marcadores desconocidos y repetidos', () => {
  const malos = [
    { texto: 'Escríbeme al 300 555 1234 y te lo hago' },
    { texto: 'Llavero con tu nombre por $12.000' },
    { texto: 'El Grinch en tu llavero' },
    { texto: 'Solo hoy 2x1 en llaveros' },
    { texto: 'Envío gratis a toda Colombia' },
    { texto: 'Sígueme para más ideas de regalos' },
    { texto: 'Regálale {nombre_cliente} en 3D' },
    { texto: 'Tu nombre en un llavero por {precio}' },
    { texto: 'Tu nombre en un llavero por {precio}.' },
  ];
  const r = B.parseImport('ganchos', JSON.stringify(malos), ctx);
  assert.equal(r.items.length, 1);
  const motivos = r.rechazados.map((x) => x.motivos.join(' '));
  assert.equal(r.rechazados.length, 8);
  for (const re of [/contacto/, /Precio que no está en el catálogo.*\$12\.000.*\{precio\}/, /marca registrada/, /descuento/, /envío gratis/, /prohibida/, /Marcador desconocido \{nombre_cliente\}/, /Repetido dentro de lo pegado/]) {
    assert.ok(motivos.some((m) => re.test(m)), String(re));
  }
  const conPrecio = B.parseImport('ganchos', '[{"texto":"Llavero con tu nombre por $10.000"}]', ctx);
  assert.equal(conPrecio.items.length, 1, 'un precio real del catálogo se acepta');
  assert.match(conPrecio.items[0].avisos.join(' '), /\{precio\}/);
});

test('importar guiones: número de escenas por formato, fórmula forzada y escena 1 obligatoria', () => {
  const ok = { titulo: 'Probando', formato: 'F3', formula: 'T4', producto: 'figura', escenas: [{ voz: '¿Qué es?', texto: '¿QUÉ ES?' }, { voz: 'Ya casi', texto: '' }, { voz: '¡Es {producto}!', texto: '{PRODUCTO}' }, { voz: 'Enviamos a toda Colombia. {cta}', texto: '{CTA}' }] };
  const r = B.parseImport('guiones', JSON.stringify([ok, { ...ok, titulo: 'Corto', escenas: ok.escenas.slice(0, 3) }, { ...ok, titulo: 'Lista', formato: 'F1', escenas: [...ok.escenas, {}, {}] }, { ...ok, titulo: 'Vacía', escenas: [null, ...ok.escenas.slice(1)] }]), ctx);
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.rechazados.map((x) => x.motivos[0].replace(/\d+/g, 'N')), ['El formato FN lleva N escenas y trae N', 'La fórmula TN solo funciona con el formato FN', 'La escena N (el gancho) no puede ir vacía']);
  assert.ok(r.items[0].item.escenas.every((e) => 'voz' in e && 'texto' in e));
});

test('importar: más de 500 elementos o JSON cortado dan un error claro (no se guarda nada)', () => {
  assert.match(B.parseImport('ganchos', JSON.stringify(Array.from({ length: 501 }, (_, i) => ({ texto: `Gancho ${i}` }))), ctx).error, /máximo por importación es 500/);
  assert.match(B.parseImport('ganchos', '[{"texto":"a"}, {"texto":', ctx).error, /JSON/);
  assert.match(B.parseImport('ganchos', '   ', ctx).error, /No pegaste nada/);
});

// ------------------------------------------------------------------ guardar: nuevos, actualizados, repetidos, ocultos

test('fusionar: crea ids nuevos seguidos, actualiza una semilla por id y descarta repetidos por texto', () => {
  const seed = B.SEMILLAS.ganchos[0];
  let r = B.fusionar('ganchos', null, [
    { texto: 'Gancho nuevo uno' },
    { texto: 'Gancho nuevo dos', fuente: 'Gemini' },
    { id: seed.id, texto: seed.texto, pantalla: 'PANTALLA MEJORADA' },
    { texto: seed.texto.toUpperCase() },
  ], { ahora: '2026-11-06T10:00', fuente: 'ChatGPT' });
  assert.deepEqual(r.nuevos.map((x) => [x.id, x.fuente, x.creado]), [['gan-001', 'ChatGPT', '2026-11-06T10:00'], ['gan-002', 'Gemini', '2026-11-06T10:00']]);
  assert.deepEqual(r.actualizados.map((x) => [x.id, x.pantalla]), [[seed.id, 'PANTALLA MEJORADA']]);
  assert.deepEqual(r.repetidos.map((x) => x.igualA), [seed.id]);
  const lista = B.efectivos('ganchos', r.archivo);
  assert.equal(lista.length, B.SEMILLAS.ganchos.length + 2);
  assert.equal(lista.find((x) => x.id === seed.id).pantalla, 'PANTALLA MEJORADA');
  assert.equal(B.origenDe('ganchos', r.archivo, lista[0]), 'semilla-editada');
  assert.equal(B.origenDe('ganchos', r.archivo, lista.at(-1)), 'tuyo');
  r = B.fusionar('ganchos', r.archivo, [{ texto: 'Gancho nuevo tres' }, { id: 'gan-002', texto: 'Gancho nuevo dos', fuente: 'Gemini' }], { ahora: 'x' });
  assert.deepEqual(r.nuevos.map((x) => x.id), ['gan-003']);
  assert.equal(r.actualizados.length, 0, 'mismo contenido con el mismo id = repetido, no actualización');
  assert.equal(r.repetidos.length, 1);
  assert.match(B.resumenImport('ganchos', { ...r, rechazados: [] }), /1 nuevos, 0 actualizados, 1 repetidos, 0 rechazados/);
});

test('ocultar una semilla la saca de la lista; reimportarla por id o "mostrar ocultos" la devuelve; lo tuyo se borra', () => {
  const seed = B.SEMILLAS.ctas[2];
  let a = B.fusionar('ctas', null, [{ voz: 'Comenta FUNDA y te mando fotos de la funda.', objetivo: 'comentarios' }], { ahora: 't' }).archivo;
  a = B.ocultar('ctas', a, seed.id);
  a = B.ocultar('ctas', a, 'cta-001');
  assert.deepEqual(a.ocultos, [seed.id]);
  assert.equal(a.items.length, 0);
  assert.ok(!B.efectivos('ctas', a).some((x) => x.id === seed.id));
  assert.ok(B.efectivos('ctas', a, { ocultos: true }).some((x) => x.id === seed.id));
  assert.deepEqual(B.restaurarOcultos('ctas', a).ocultos, []);
  const r = B.fusionar('ctas', a, [{ ...seed }], { ahora: 't2' });
  assert.deepEqual(r.archivo.ocultos, []);
  assert.equal(r.actualizados.length, 1);
});

test('ocultar una base que editaste conserva tu versión; «Volver a la base» la descarta', () => {
  const seed = B.SEMILLAS.ganchos[0];
  let a = B.fusionar('ganchos', null, [{ id: seed.id, texto: 'Mi versión editada del gancho.' }], { ahora: 't' }).archivo;
  a = B.ocultar('ganchos', a, seed.id);
  assert.ok(!B.efectivos('ganchos', a).some((x) => x.id === seed.id));
  assert.equal(B.efectivos('ganchos', a, { ocultos: true }).find((x) => x.id === seed.id).texto, 'Mi versión editada del gancho.');
  a = B.restaurarOcultos('ganchos', a);
  assert.equal(B.efectivos('ganchos', a).find((x) => x.id === seed.id).texto, 'Mi versión editada del gancho.');
  a = B.volverABase('ganchos', a, seed.id);
  assert.equal(B.efectivos('ganchos', a).find((x) => x.id === seed.id).texto, seed.texto);
  assert.equal(B.origenDe('ganchos', a, seed), 'semilla');
});

test('los ids no se reutilizan: borrar el último y reimportar su exportación no pisa a otro', () => {
  let a = B.fusionar('ganchos', null, [{ texto: 'Primer gancho propio' }, { texto: 'Segundo gancho propio' }], { ahora: 't' }).archivo;
  const exportado = B.exportar('ganchos', a.items.filter((x) => x.id === 'gan-002'));
  a = B.ocultar('ganchos', a, 'gan-002');
  assert.equal(a.ultimo, 2);
  a = B.fusionar('ganchos', a, [{ texto: 'Tercer gancho propio' }], { ahora: 't2' }).archivo;
  assert.deepEqual(a.items.map((x) => x.id), ['gan-001', 'gan-003']);
  const r = B.revisarImport('ganchos', exportado, ctx, a, { ahora: 't3' });
  assert.deepEqual([r.nuevos.length, r.actualizados.length], [1, 0]);
  assert.equal(r.archivo.items.find((x) => x.id === 'gan-003').texto, 'Tercer gancho propio');
  // El contador se lee del archivo (y nunca queda por debajo del id más alto).
  assert.equal(B.leerArchivo('ganchos', { ultimo: 7, items: [{ id: 'gan-002', texto: 'x' }] }).archivo.ultimo, 7);
  assert.equal(B.leerArchivo('ganchos', { ultimo: 1, items: [{ id: 'gan-004', texto: 'x' }] }).archivo.ultimo, 4);
  assert.equal(B.fusionar('ganchos', B.leerArchivo('ganchos', { ultimo: 7, items: [] }).archivo, [{ texto: 'Nuevo' }]).nuevos[0].id, 'gan-008');
});

test('leerArchivo: tolera archivo inexistente, avisa de ids inválidos y no rompe con un archivo dañado', () => {
  assert.deepEqual(B.leerArchivo('ideas', null).archivo.items, []);
  const r = B.leerArchivo('ideas', { items: [{ id: 'ide-001', idea: 'Una idea' }, { id: 'gan-001', idea: 'De otra colección' }, { id: 'ide-001', idea: 'Repetida' }], ocultos: ['ide-b01', 'ide-999', 'x'] });
  assert.equal(r.archivo.items.length, 1);
  assert.equal(r.avisos.length, 2);
  assert.deepEqual(r.archivo.ocultos, ['ide-b01']);
  assert.match(B.leerArchivo('ideas', { hola: 1 }).error, /formato esperado/);
});

test('exportar → importar de nuevo no duplica; con cambios, actualiza por id', () => {
  const a = B.fusionar('hashtags', null, [{ nombre: 'Velitas', tags: '#diadelasvelitas #navidad #pabonitas', para: '7 de diciembre' }], { ahora: 't' }).archivo;
  const lista = B.efectivos('hashtags', a);
  const json = B.exportar('hashtags', lista);
  assert.doesNotMatch(json, /"creado"|"fuente"/);
  const otra = B.revisarImport('hashtags', json, ctx, a, { ahora: 't2' });
  assert.deepEqual([otra.nuevos.length, otra.actualizados.length, otra.repetidos.length, otra.rechazados.length], [0, 0, lista.length, 0]);
  const cambiado = JSON.parse(json).map((x) => (x.id === 'has-001' ? { ...x, para: 'Noche de velitas' } : x));
  const r = B.revisarImport('hashtags', JSON.stringify(cambiado), ctx, a, { ahora: 't3' });
  assert.deepEqual(r.actualizados.map((x) => [x.id, x.para]), [['has-001', 'Noche de velitas']]);
});

// ------------------------------------------------------------------ prompts para la IA

test('prompt por colección: trae la marca, las reglas, lo que ya tengo y un ejemplo que se importa sin errores', () => {
  for (const col of Object.keys(B.COLECCIONES)) {
    const p = B.promptColeccion(ctx, col, { n: 50, existentes: B.SEMILLAS[col] });
    assert.match(p.texto, /Pabonitas/);
    assert.match(p.texto, /Devuelve SOLO un arreglo JSON/);
    assert.match(p.texto, /con 50 objetos/);
    assert.match(p.texto, /no los repitas/);
    assert.ok(p.donde.some((x) => /^https:\/\//.test(x.url)));
    const ej = B.parseImport(col, JSON.stringify(B.EJEMPLOS[col]), ctx);
    assert.deepEqual(ej.rechazados, [], col);
  }
  assert.match(B.promptColeccion(ctx, 'ganchos', { n: 10, tema: 'Black Friday' }).texto, /sobre: Black Friday/);
});

test('prompt "mejorar los que tengo": manda los ids para que la respuesta actualice en vez de duplicar', () => {
  const p = B.promptColeccion(ctx, 'ganchos', { mejorar: B.SEMILLAS.ganchos.slice(0, 3) });
  assert.match(p.texto, /CONSERVA el "id"/);
  const json = p.texto.slice(p.texto.lastIndexOf('\n[') + 1);
  const mejorados = JSON.parse(json).map((x) => ({ ...x, pantalla: `${x.pantalla || ''} YA`.trim() }));
  const r = B.revisarImport('ganchos', JSON.stringify(mejorados), ctx, null, { ahora: 't' });
  assert.deepEqual([r.nuevos.length, r.actualizados.length], [0, 3]);
});

// ------------------------------------------------------------------ usar en Crear guion

test('usarGancho: rellena producto y precio reales en la escena 1 sin cambiar el formato del borrador', () => {
  const t3 = B.SEMILLAS.ganchos.find((g) => g.formula === 'T3' && /\{precio\}/.test(g.texto));
  const r = B.usarGancho(ctx, BASE, t3);
  assert.equal(r.input.formula, 'T3');
  const d = T.draftVideo(r.input, ctx);
  assert.match(d.escenas[0].voz, /10 mil/);
  assert.doesNotMatch(textoDe(d), /\{/);
  const t4 = B.SEMILLAS.ganchos.find((g) => g.formula === 'T4');
  const r4 = B.usarGancho(ctx, BASE, t4);
  assert.equal(r4.input.formula, 'T1', 'un gancho de timelapse no convierte el F1 en F3');
  assert.match(r4.avisos[0], /se dejó T1/);
  const t10 = B.SEMILLAS.ganchos.find((g) => /\{tema\}/.test(g.texto));
  const r10 = B.usarGancho(ctx, BASE, t10, { tema: 'superluna' });
  assert.equal(r10.input.tendencia, 'superluna');
  assert.match(r10.input.escenas[0].voz, /^Superluna|superluna/);
});

test('usarCta y usarIdea: CTA al final con "Enviamos a toda Colombia" e idea con su gancho entre comillas', () => {
  const cta = B.SEMILLAS.ctas.find((c) => c.objetivo === 'dms');
  const r = B.usarCta(ctx, BASE, cta, 6);
  assert.equal(r.input.objetivo, 'dms');
  assert.match(r.input.escenas[5].voz, /^Enviamos a toda Colombia\./);
  const d = T.draftVideo(r.input, ctx);
  assert.match(d.escenas[5].voz, /Enviamos a toda Colombia/);
  const idea = B.usarIdea(ctx, BASE, B.EJEMPLOS.ideas[0]);
  assert.equal(idea.input.formula, 'T4');
  assert.equal(idea.input.escenas[0].voz, 'Nadie adivina qué sale de aquí.');
  assert.equal(T.draftVideo(idea.input, ctx).formato, 'F3');
});

test('sugerirGanchos: solo compatibles con el formato, sin plantillas de tendencia y primero lo de la ocasión', () => {
  const f3 = B.sugerirGanchos(ctx, B.SEMILLAS.ganchos, BASE, { formato: 'F3', max: 20 });
  assert.ok(f3.length > 0 && f3.every((g) => ['T4', 'T1', 'T2', 'T10', ''].includes(g.formula || '')));
  assert.ok(f3.every((g) => !/\{|\[TEMA\]/.test(g.voz)));
  const as = B.sugerirGanchos(ctx, B.SEMILLAS.ganchos, { ...BASE, ocasion: 'amigo-secreto' }, { formato: 'F1', max: 3 });
  assert.match(as[0].voz, /amigo secreto/i);
  const rk = B.sugerirGanchos(ctx, B.SEMILLAS.ganchos, BASE, { formato: 'F1', ranking: [{ formula: 'T8' }], max: 1 });
  assert.equal(rk[0].formula, 'T8', 'lo que mejor te funciona sube');
});

// ------------------------------------------------------------------ tendencias (fuentes reales, sin IA)

test('Google Trends Colombia: lee términos, tráfico y noticias con su enlace; el filtro quita política y tragedias', () => {
  const s = TR.snapshotDe('google-co', { texto: tend('google-co.xml'), obtenido: '2026-11-06T10:00' });
  assert.equal(s.error, '');
  assert.equal(s.items.length, 8);
  assert.equal(s.items[0].termino, 'lucas gonzález vélez');
  assert.equal(s.items[0].trafico_n, 100);
  assert.match(s.items[0].noticias[0].url, /^https:\/\/www\.winsports\.co\//);
  assert.equal(s.items[0].fecha, '2026-11-06T15:20:00.000Z');
  assert.ok(s.items.some((x) => x.noticias.some((n) => n.titulo.startsWith('“James'))), 'decodifica comillas y acentos');
  const seguro = Object.fromEntries(s.items.map((x) => [x.termino, TR.tendenciaSegura(x.termino, x.noticias)]));
  assert.deepEqual([seguro.superluna.ok, seguro.ley.ok, seguro.ley.motivo], [true, false, 'política']);
  assert.equal(seguro['gonzalo moratorio'].ok, false);
});

test('Reddit r/BambuLab: título, enlace, autor y fecha de cada publicación', () => {
  const s = TR.snapshotDe('reddit-bambulab', { texto: tend('reddit-bambulab.xml') });
  assert.equal(s.items.length, 5);
  assert.deepEqual(s.items[0], { titulo: 'H4D 2027 Leaked', url: 'https://www.reddit.com/r/BambuLab/comments/1xnk1fo/h4d_2027_leaked/', autor: 'u/kane49', fecha: '2026-11-04T09:37:31.000Z' });
  assert.equal(s.items[3].titulo, "I'm gonna miss my wife");
  assert.match(TR.snapshotDe('reddit-3dprinting', { texto: '<html>Too Many Requests</html>' }).error, /no trae publicaciones/);
});

test('Creative Center: lee la tabla copiada (en una o varias líneas, en inglés o español) y avisa si no es Colombia', () => {
  const cc = tend('creative-center.txt');
  for (const texto of [cc, cc.replace(/\r?\n/g, ' ')]) {
    const s = TR.snapshotDe('creative-center', { texto, obtenido: 't' });
    assert.equal(s.region, 'Estados Unidos');
    assert.match(s.aviso, /no de Colombia/);
    assert.deepEqual(s.items.map((x) => [x.rank, x.hashtag, x.posts_n, x.vistas_n]), [[1, '#musteatinmycity', 1100000, 817900000], [2, '#saturween', 143200, 171000000], [3, '#happyhalloween', 263500, 300700000]]);
    assert.equal(s.items[1].categoria, 'News & Entertainment');
  }
  const es = TR.parseCreativeCenterText('Explora las tendencias en\nColombia\n1\n#navidad\nEducación\n143,2 mil\nPublicaciones\n1,1 M\nVisualizaciones\n2\n#regalos\n12 mil\nPublicaciones\n3 M\nVisualizaciones');
  assert.equal(es.region, 'Colombia');
  assert.equal(TR.avisoRegion(es.region), '');
  assert.deepEqual(es.items.map((x) => [x.hashtag, x.posts_n, x.vistas_n]), [['#navidad', 143200, 1100000], ['#regalos', 12000, 3000000]]);
  assert.deepEqual(TR.parseCreativeCenterText('Copié esto: #amigosecreto y #navidad2026').items.map((x) => x.hashtag), ['#amigosecreto', '#navidad2026']);
  assert.match(TR.snapshotDe('creative-center', { texto: 'nada útil' }).error, /No encontré hashtags/);
});

test('ganchos de tendencia: temas seguros con fuente y enlace, 2 ganchos listos para usar y el país del Creative Center', () => {
  const g = TR.snapshotDe('google-co', { texto: tend('google-co.xml'), obtenido: '2026-11-06T10:00' });
  const cc = TR.snapshotDe('creative-center', { texto: tend('creative-center.txt'), obtenido: '2026-11-06T10:05' });
  const out = TR.ganchosDeTendencia(ctx, [g, cc], B.SEMILLAS.ganchos, { input: BASE, max: 20 });
  const temas = out.map((x) => x.tema);
  assert.ok(temas.includes('superluna') && !temas.includes('ley') && !temas.includes('gonzalo moratorio'));
  assert.ok(temas.includes('#saturween'));
  assert.equal(out.find((x) => x.tema === '#saturween').region, 'Estados Unidos');
  for (const x of out) {
    assert.match(x.url, /^https:\/\//);
    assert.equal(x.opciones.length, 2);
    assert.ok(x.opciones.every((o) => o.voz.toLowerCase().includes(x.tema.toLowerCase()) && !/\{/.test(o.voz + o.pantalla)));
    assert.match(x.nota, /no en el producto/);
  }
  assert.equal(TR.ganchosDeTendencia(ctx, [{ ...g, error: 'caído' }], B.SEMILLAS.ganchos).length, 0);
});

test('fechas clave de Colombia: desde el 6 de noviembre salen Black Friday, Velitas, Novena, Prima y Nochebuena', () => {
  const f = Object.fromEntries(TR.fechasClave('2026-11-06').map((x) => [x.nombre, x]));
  assert.equal(f['Black Friday'].fecha, '2026-11-27');
  assert.equal(f['Cyber Monday'].fecha, '2026-11-30');
  assert.equal(f['Día de las Velitas'].fecha, '2026-12-07');
  assert.match(f['Día de las Velitas'].angulo, /LED/);
  assert.equal(f['Novena de aguinaldos'].hasta, '2026-12-24');
  assert.equal(f['Prima de diciembre'].fecha, '2026-12-20');
  assert.equal(f.Nochebuena.publicarDesde, '2026-12-03');
  assert.equal(f['Black Friday'].estado, 'prepara');
  assert.equal(TR.fechasClave('2026-11-20').find((x) => x.nombre === 'Black Friday').estado, 'publica ya');
  assert.equal(TR.fechasClave('2026-12-18').find((x) => x.nombre === 'Novena de aguinaldos').estado, 'en curso');
  const y27 = Object.fromEntries(TR.fechasClave('2027-01-01', 365).map((x) => [x.nombre, x.fecha]));
  assert.deepEqual([y27['Día del Niño'], y27['Día de la Madre'], y27['Día del Padre'], y27['Amor y Amistad'], y27['Black Friday']], ['2027-04-24', '2027-05-09', '2027-06-20', '2027-09-18', '2027-11-26']);
});

test('lo que te funciona: ranking de fórmulas con tus métricas (mediana de vistas y de compartidos+guardados)', () => {
  assert.deepEqual(TR.rankingFormulas(ctx), [], 'sin métricas no inventa nada');
  const cab = rd('registro/metricas.csv').split(/\r?\n/)[0];
  const fila = (id, h, vistas, completo, comp, guard) => `${id};2026-11-07;${h};${vistas};8;${completo};0;0;${comp};${guard};0;0;0;0;`;
  const m = [cab, fila('V004', 24, 300, 20, 1, 1), fila('V004', 72, 1000, 30, 10, 10), fila('V006', 72, 5000, 25, 10, 5), fila('V012', 72, 600, 40, 6, 6)].join('\n');
  const r = TR.rankingFormulas(context({ metricasCsv: m }));
  assert.deepEqual(r.map((x) => [x.formula, x.n, x.vistas]), [['T1', 2, 800], ['T7', 1, 5000]]);
  assert.equal(r[0].tasa, 2);
  assert.deepEqual(r[0].videos, ['V004', 'V012']);
});

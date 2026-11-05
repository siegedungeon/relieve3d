// Estudio TikTok (core puro): lectura de los documentos del espacio, agenda, borradores, kit paso a paso y prompts.
// Fixtures: copia saneada del espacio real (teléfono ficticio 300 123 4567) en test/fixtures/tiktok.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '../src/core/tiktok_studio.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tiktok');
const rd = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/^\uFEFF/, '');
const folders = fs.readdirSync(path.join(root, 'videos')).filter((d) => /^V\d/.test(d));

function context({ salida = {}, clips = {}, vozGuia = {}, videosCsv = rd('registro/videos.csv'), metricasCsv = rd('registro/metricas.csv'), today = '2026-11-04', now = '2026-11-04T10:00' } = {}) {
  const videos = folders.map((d) => {
    const id = d.slice(0, 4);
    return { carpeta: `videos/${d}`, guion: rd(`videos/${d}/guion.md`), spec: JSON.parse(rd(`videos/${d}/video.json`)), clips: clips[id] || [], salida: salida[id] || [], transcripcion: false, vozGuia: !!vozGuia[id], kit: false };
  });
  return T.buildContext({
    perfil: rd('estrategia/perfil-cuenta.md'), voz: rd('estrategia/voz-y-marca.md'), hashtags: rd('estrategia/hashtags-y-seo.md'),
    campana: rd('estrategia/campana-navidad-2026.md'), videosCsv, metricasCsv, pedidosCsv: rd('registro/pedidos-tiktok.csv'),
    videos, root, today, now,
  });
}
const steps = (kit) => Object.fromEntries(kit.fases.flatMap((f) => f.pasos).map((s) => [s.id, s]));

test('lee catálogo, perfil y campaña desde los .md del espacio (sin inventar precios)', () => {
  const ctx = context();
  assert.deepEqual(ctx.avisos, []);
  const precio = Object.fromEntries(ctx.catalogo.map((p) => [p.id, p.precio]));
  assert.equal(precio['llaveros-personalizados-3d'], 10000);
  assert.equal(precio['funda-navidena-para-puerta'], 35000);
  assert.equal(precio['microfono-viral'], null, 'lo que está bajo cotización no recibe precio');
  assert.equal(ctx.perfil.usuario, '@pabonitaslaser');
  assert.equal(ctx.perfil.whatsapp, '300 123 4567');
  assert.equal(ctx.perfil.links.cotizar, 'pabonitas.co/cotizar');
  assert.deepEqual(ctx.campana.fases.map((f) => f.letra), ['A', 'B', 'C', 'D', 'E']);
  assert.ok(ctx.campana.respuestas.length >= 3);
  assert.ok(ctx.campana.respuestas.every((r) => Array.isArray(r.pendientes)));
  assert.deepEqual(ctx.videos.map((v) => v.id), ['V004', 'V006', 'V012']);
});

test('agenda del día: fase, semana, próximos y siguiente hueco libre', () => {
  const ctx = context();
  const a = T.agenda(ctx);
  assert.equal(a.semana, 'W45');
  assert.equal(a.fase.letra, 'A');
  assert.deepEqual(a.proximos.map((v) => v.id), ['V004', 'V012', 'V006']);
  assert.ok(a.proximos.every((v) => v.siguiente));
  assert.match(a.hueco, /^2026-11-04T\d{2}:\d{2}$/);
  const ocupado = context({ videosCsv: `${rd('registro/videos.csv')}V013;X;util;T1;guion;2026-11-04;${a.hueco};;;10;videos/V013-x\r\n` });
  assert.notEqual(T.agenda(ocupado).hueco.slice(0, 10), '2026-11-04', 'un día con video ya no es hueco');
  assert.equal(T.agenda(context({ today: '2026-12-01', now: '2026-12-01T09:00' })).fase.letra, 'B');
});

test('borrador por formato: escenas grabables, precio real y caption completo', () => {
  const ctx = context();
  for (const formato of Object.keys(T.FORMATOS)) {
    const d = T.draftVideo({ producto: 'llaveros-personalizados-3d', formula: 'T1', formato, ocasion: 'amigo-secreto', fechaPlan: '2026-11-15T18:30' }, ctx);
    assert.equal(d.formato, formato);
    assert.ok(d.escenas.length >= 4, `${formato}: escenas`);
    assert.ok(d.escenas.some((s) => s.tipo === 'CARA' && s.sincronizar), `${formato}: toma de cara sincronizada`);
    assert.ok(d.escenas.every((s) => /^clips\/[\w-]+\.mp4$/.test(s.archivo) && s.voz && !s.voz.includes('|')), `${formato}: archivos y voz`);
    assert.deepEqual(d.avisos, [], `${formato}: sin avisos`);
    assert.equal(d.teleprompter.length, d.escenas.length);
    assert.ok(d.hashtags.length >= 3 && d.hashtags.length <= 6);
    assert.ok(d.caption.endsWith(d.hashtags.join(' ')));
    assert.match(d.comentarioFijado, /300 123 4567/);
    if (formato === 'F4') {
      assert.equal(new Set(d.lista.map((p) => p.id)).size, 3);
      assert.ok(d.lista.every((p) => p.precio != null));
    } else assert.match(d.caption, /\$10\.000/);
  }
});

test('producto sin precio: dice "cotiza gratis" una sola vez y avisa', () => {
  const ctx = context();
  const d = T.draftVideo({ producto: 'microfono-viral', formula: 'T1' }, ctx);
  assert.match(d.caption, /cotiza gratis/);
  assert.equal(d.comentarioFijado.match(/cotiza gratis/gi).length, 1);
  assert.ok(d.avisos.some((x) => /no tiene precio publicado/.test(x)));
  assert.ok(!d.hashtags.some((h) => /^#llavero/.test(h)), 'sin #llavero para productos que no son llaveros');
});

test('hooks alternativos sin plantillas vacías y ediciones del usuario revisadas', () => {
  const ctx = context();
  const d = T.draftVideo({ producto: 'llaveros-personalizados-3d', formula: 'T1' }, ctx);
  assert.ok(d.hooks.length >= 2);
  assert.ok(d.hooks.every((h) => !['T2', 'T10'].includes(h.formula)), 'T2/T10 solo si es la fórmula elegida');
  assert.ok(d.hooks.every((h) => !/\[[^\]]+\]/.test(h.hablado)));
  const e = T.draftVideo({ producto: 'llaveros-personalizados-3d', formula: 'T1', escenas: [{ voz: 'Hoy por $12.500 | sígueme para más' }] }, ctx);
  assert.equal(e.escenas[0].voz.includes('|'), false, 'el separador de escenas no puede colarse en la voz');
  assert.ok(e.avisos.some((x) => /\$12\.500/.test(x)), 'precio fuera del catálogo');
  assert.ok(e.avisos.some((x) => /sígueme para más/.test(x)), 'frase prohibida');
  const t10 = T.draftVideo({ producto: 'llaveros-personalizados-3d', formula: 'T10' }, ctx);
  assert.ok(t10.avisos.some((x) => /Tendencia/.test(x)));
});

test('textos en pantalla del animatic: palabras completas y sin paréntesis abiertos', () => {
  assert.equal(T.recortar('Macro: doblas la placa y sale el llavero con nombre (que se oiga el crac del plástico)', 60), 'Macro: doblas la placa y sale el llavero con nombre…');
  assert.equal(T.recortar('corto', 80), 'corto');
  const ctx = context();
  for (const formato of Object.keys(T.FORMATOS)) {
    const d = T.draftVideo({ producto: 'llaveros-personalizados-3d', formula: 'T5', formato, ocasion: 'amigo-secreto' }, ctx);
    const json = T.renderVideoJson(d).escenas;
    json.forEach((s, i) => {
      const full = `${d.escenas[i].tipo}: ${d.escenas[i].visual}`.replace(/\s+/g, ' ').trim();
      assert.ok(s.texto.length <= 81, `${formato}: ${s.texto}`);
      assert.ok((s.texto.match(/\(/g) || []).length === (s.texto.match(/\)/g) || []).length, `${formato}: paréntesis sin cerrar en «${s.texto}»`);
      if (s.texto.endsWith('…')) {
        const base = s.texto.slice(0, -1);
        assert.ok(full.startsWith(base) && /^[\s,;:.(—-]/.test(full.slice(base.length)), `${formato}: palabra cortada en «${s.texto}»`);
      } else assert.equal(s.texto, full);
    });
  }
});

test('guion.md y video.json generados se vuelven a leer igual (ida y vuelta)', () => {
  const ctx = context();
  const d = T.draftVideo({ producto: 'nombres-decorativos-3d', formula: 'T5', ocasion: 'amigo-secreto', fechaPlan: '2026-11-20T18:30' }, ctx);
  const md = T.renderGuion(d, { id: 'V099', fecha: '2026-11-04', carpeta: 'videos/V099-x' });
  const g = T.parseGuion(md);
  assert.equal(g.titulo, d.titulo);
  assert.equal(g.meta.estado, 'guion');
  assert.equal(g.meta.fecha_plan, '2026-11-20T18:30');
  assert.equal(g.meta.producto, d.producto.nombre);
  assert.deepEqual(g.teleprompter, d.teleprompter);
  assert.equal(g.caption, d.caption);
  const vj = T.renderVideoJson(d, { id: 'V099' });
  assert.equal(vj.escenas.length, d.escenas.length);
  assert.equal(vj.voz.texto.split('|').length, d.escenas.length, 'un bloque de voz por escena');
  assert.ok(vj.efectos.every((x) => /^audio\/sfx\/\w+\.wav$/.test(x.archivo)));
  const v = { id: 'V099', titulo: d.titulo, estado: 'guion', carpeta: 'videos/V099-x', clips: [], salida: [], guion: g, guionMd: md, spec: vj };
  assert.equal(T.productOfVideo(ctx, v).id, 'nombres-decorativos-3d');
});

test('kit paso a paso: estados según los archivos reales y el registro', () => {
  let kit = T.buildKit(context({ salida: { V004: ['V004-animatic.mp4'] } }).videos.find((v) => v.id === 'V004'), context({ salida: { V004: ['V004-animatic.mp4'] } }));
  let s = steps(kit);
  assert.equal(kit.hora, 'vie 6-nov · 18:30');
  assert.equal(s['montar-video'].estado, 'parcial', 'con animatic el render está a medias');
  assert.equal(s['pub-subir'].estado, 'espera');
  assert.equal(s['grab-tele'].estado, 'pendiente');
  assert.equal(s['montar-voz'].estado, 'pendiente');
  const conGuia = context({ vozGuia: { V004: true } });
  assert.equal(steps(T.buildKit(conGuia.videos.find((v) => v.id === 'V004'), conGuia))['montar-voz'].estado, 'parcial', 'la voz guía no reemplaza tu voz: queda a medias');
  assert.ok(kit.fases.every((f) => f.pasos.every((p) => p.donde || p.que || p.copiar || p.items)), 'cada paso dice dónde o qué hacer');
  assert.deepEqual(s['montar-video'].accion.args, ['video', kit.carpeta]);
  assert.equal(s['pub-sonido'].accion.url, T.ENLACES.creativeCenter);

  const clips = ['cara.mp4', 'diseno.mp4', 'timelapse.mp4', 'despegar.mp4'];
  const csv = rd('registro/videos.csv').replace(/^V004;(.*?);guion;2026-11-03;2026-11-06T18:30;;/m, 'V004;$1;publicado;2026-11-03;2026-11-06T18:30;2026-11-06;https://www.tiktok.com/@pabonitaslaser/video/1');
  const met = `${rd('registro/metricas.csv').trimEnd()}\r\nV004;2026-11-07;24;300;6;30;20;5;2;3;4;80;5;90;\r\n`;
  const ctx = context({ salida: { V004: ['V004-final.mp4'] }, clips: { V004: clips }, videosCsv: csv, metricasCsv: met, today: '2026-11-10', now: '2026-11-10T10:00' });
  kit = T.buildKit(ctx.videos.find((v) => v.id === 'V004'), ctx);
  s = steps(kit);
  assert.equal(kit.estado, 'publicado');
  for (const id of ['grab-tele', 'pasar-copiar', 'montar-video', 'pub-subir', 'pub-marcar', 'med-24']) assert.equal(s[id].estado, 'ok', id);
  assert.equal(s['med-72'].estado, 'pendiente');
  assert.equal(s['med-168'].estado, 'espera');
  assert.ok(s['med-diag'].items.length >= 0);
  assert.ok(kit.progreso.hechos > 5 && kit.progreso.hechos < kit.progreso.total);
  assert.deepEqual(T.agenda(ctx).porMedir.map((v) => [v.id, v.faltan]), [['V004', [72]]]);
  const md = T.kitMarkdown(kit, '2026-11-10');
  assert.ok(md.startsWith('# '));
  assert.match(md, /Creative Center/);
});

test('prompts con el contexto de la marca listos para pegar en la IA', () => {
  const ctx = context();
  const d = T.draftVideo({ producto: 'llaveros-personalizados-3d', formula: 'T1', ocasion: 'amigo-secreto' }, ctx);
  const ps = T.promptLibrary(ctx, d);
  const ids = ps.map((p) => p.id);
  for (const id of ['guion', 'hooks', 'caption', 'respuestas', 'tendencia', 'semana', 'diagnostico', 'portada']) assert.ok(ids.includes(id), id);
  for (const p of ps) {
    assert.ok(p.texto.length > 200 && p.despues && p.donde.length, p.id);
    assert.ok(!p.texto.includes('**'), `${p.id}: sin markdown suelto`);
    if (p.id !== 'portada') assert.match(p.texto, /\$10\.000/, `${p.id}: lleva los precios reales`);
    else assert.match(p.texto, /Sin texto, sin personas/);
  }
  assert.match(ps.find((p) => p.id === 'guion').texto, new RegExp(`EXACTAMENTE ${d.escenas.length} bloques`));
  const v4 = ctx.videos.find((v) => v.id === 'V004');
  assert.match(T.promptLibrary(ctx, v4).find((p) => p.id === 'guion').texto, /EXACTAMENTE \d+ bloques/);
  assert.ok(ps.every((p) => p.donde.every((x) => !x.url || x.url.startsWith('https://'))));
});

test('diagnóstico de métricas según la línea base', () => {
  const lento = T.diagnose({ vistas: '150', tiempo_medio_s: '2', vio_completo_pct: '5', compartidos: '0', guardados: '0', comentarios: '0', trafico_para_ti_pct: '20' }, { duracion: 17 });
  assert.ok(lento.some((x) => /Hook/.test(x.causa)));
  assert.deepEqual(T.diagnose(null), []);
  assert.equal(T.fechaHumana('2026-11-06T18:30'), 'vie 6-nov · 18:30');
  assert.equal(T.precioTexto({ precio: null }), 'cotiza gratis');
});

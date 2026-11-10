import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  attachmentSendError, calculateOrder, conversationVariables, estimateSendParts, evaluateCalculator,
  firstName, firstPlaceholderRange, inboxUploadError, localQuoteItems, matchSavedReplies,
  parseInboxTags, placeholderSendError, renderInboxText, splitInboxText,
} from '../src/core/inbox.js';
import { InboxStudio } from '../src/inbox_ui.js';
import { newQuote } from '../src/core/quotation.js';

const { createQuoteStore } = createRequire(import.meta.url)('../src/main/quote_store.cjs');

test('respuestas guardadas completan variables sin permitir enviar datos pendientes', () => {
  const variables = conversationVariables(
    [{ key: 'envio', value: '' }, { key: 'marca', value: 'Pabonitas' }],
    { display_name: 'MARÍA JOSÉ', platform: 'whatsapp' },
  );
  const result = renderInboxText('Hola {nombre}, somos {marca}. Entrega: {envio}.', variables);
  assert.equal(firstName('MARÍA JOSÉ'), 'María');
  assert.equal(result.text, 'Hola María, somos Pabonitas. Entrega: [DATO tiempos de entrega].');
  assert.equal(result.ready, false);
  assert.match(placeholderSendError(result.text), /\[DATO tiempos de entrega\]/);
  const range = firstPlaceholderRange(result.text);
  assert.equal(result.text.slice(range.start, range.end), '[DATO tiempos de entrega]');
  assert.equal(renderInboxText('Hola {nombre}!', { nombre: '' }).text, 'Hola!');
});

test('búsqueda prioriza el atajo y no muestra respuestas inactivas', () => {
  const reply = (id, shortcut, title, active = true) => ({
    id, shortcut, title, body: 'Consulta de envío', category: '', use_count: 0, sort_order: id, is_active: active,
  });
  const items = [reply(1, 'envios', 'Entrega'), reply(2, 'env', 'Otra'), reply(3, 'env', 'Inactiva', false)];
  assert.deepEqual(matchSavedReplies(items, 'ENV').map((item) => item.id), [2, 1]);
  assert.deepEqual(matchSavedReplies(items, 'entrega').map((item) => item.id), [1]);
});

test('texto y adjuntos respetan límites de red y caracteres Unicode', () => {
  assert.deepEqual(splitInboxText('😀😀abc', 4), ['😀😀ab', 'c']);
  const parts = splitInboxText('😀'.repeat(260), 8000, 1000);
  assert.equal(parts.join(''), '😀'.repeat(260));
  assert.ok(parts.every((part) => new TextEncoder().encode(part).length <= 1000));
  const caps = { images: true, files: false, max_text_chars: 1000 };
  assert.equal(estimateSendParts('Hola', 'whatsapp', caps, true), 1);
  assert.equal(estimateSendParts('Hola', 'instagram', caps, true), 2);
  assert.match(inboxUploadError({ name: 'programa.exe', type: 'application/octet-stream', size: 12 }), /no permitido/);
  assert.match(inboxUploadError({ name: 'foto.png', type: 'image/png', size: 10 * 1024 * 1024 + 1 }), /10 MB/);
  assert.match(attachmentSendError({ is_image: false }, 'Instagram', caps), /Instagram no permite enviar archivos/);
  assert.deepEqual(parseInboxTags(' Llavero, pagó  anticipo, llavero , Navidad '), ['Llavero', 'pagó anticipo', 'Navidad']);
});

test('calculadora y resumen aplican porcentajes y rechazan operaciones inválidas', () => {
  assert.deepEqual(evaluateCalculator('15.000 × 12 - 10%'), { value: 162000, error: null });
  assert.deepEqual(evaluateCalculator(''), { value: null, error: null });
  assert.match(evaluateCalculator('5 / 0').error, /dividir entre cero/);
  assert.ok(evaluateCalculator('globalThis.alert(1)').error);
  const order = calculateOrder({
    lines: [{ name: 'Llavero', quantity: '2', unitPrice: '15.000' }],
    discountPercent: '10', shipping: '3.000', depositPercent: '50',
  });
  assert.equal(order.total, 30000);
  assert.equal(order.deposit, 15000);
  assert.match(order.text, /Total: \$30\.000/);
  assert.match(order.text, /Anticipo 50 %: \$15\.000/);
  assert.ok(calculateOrder({
    lines: [{ name: 'Llavero', quantity: '0', unitPrice: '15.000' }],
    discountPercent: '', shipping: '', depositPercent: '',
  }).errors.length);
});

test('solo cotizaciones locales emitidas se comparten y muestran su total decimal', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r3d-inbox-quotes-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createQuoteStore(dir);
  const quote = newQuote();
  quote.customer.name = 'Cliente de prueba';
  quote.product = 'Llavero';
  const issued = await store.save({ input: quote, configVersion: 1, issue: true });
  await store.save({ input: quote, configVersion: 1, issue: false });
  const items = localQuoteItems(await store.load(), 'llavero');
  assert.equal(items.length, 1);
  assert.equal(items[0].id, issued.id);
  assert.ok(items[0].text.includes(issued.number));
  assert.equal(typeof items[0].total, 'string');
  const ui = Object.create(InboxStudio.prototype);
  ui.copied = new Map();
  const html = ui.localQuoteHtml({ canSend: true }, items[0]);
  assert.match(html, /class="ib-total">\$[\d.]+/);
  assert.match(html, /Pegar cotización/);
  assert.doesNotMatch(html, /costo de producción/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { newQuote, newQuickQuote } from '../src/core/quotation.js';
const { createQuoteStore } = createRequire(import.meta.url)('../src/main/quote_store.cjs');

test('an anonymous quick calculation persists and becomes a full quote without changing its costs', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r3d-quick-quote-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createQuoteStore(dir), q = newQuickQuote();
  q.print.minutes = '43'; q.materials[0].grams = '10';
  let saved = await store.save({ input: q, configVersion: 1 });
  const originalCost = saved.result.totalCost;
  assert.equal(saved.input.customer.name, ''); assert.equal(saved.versions.length, 0);
  saved = (await createQuoteStore(dir).load()).quotes[0];
  assert.equal(saved.input.entryMode, 'quick'); assert.equal(saved.result.totalCost, originalCost);
  await assert.rejects(() => store.save({ id: saved.id, revision: saved.revision, input: q, configVersion: 1, issue: true }), /Cliente/);
  q.entryMode = 'full'; q.customer.name = 'Cliente de demostración';
  saved = await store.save({ id: saved.id, revision: saved.revision, input: q, configVersion: 1, issue: true });
  assert.equal(saved.result.totalCost, originalCost); assert.equal(saved.versions.length, 1);
});

test('whole persistence flow: issue, edit, versions, costs, approval, order and audit', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r3d-quote-store-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const options = { actor: () => 'operador-prueba', clock: () => new Date('2030-01-10T12:00:00Z') };
  const store = createQuoteStore(dir, options), initial = await store.load();
  const q = newQuote(initial.configs[0].value, options.clock()); q.customer.name = 'Cliente prueba';
  let record = await store.save({ input: q, configVersion: 1, issue: false });
  assert.equal(record.number, 'PAB-2030-000001'); assert.equal(record.createdBy, 'operador-prueba');
  record = await store.save({ id: record.id, revision: record.revision, input: q, configVersion: 1, issue: true });
  const issued = JSON.stringify(record.versions[0]);
  const config = structuredClone(initial.configs[0].value); config.materials[0].kgCost = '180000';
  await store.saveConfig(config, 1);
  let data = await createQuoteStore(dir, options).load();
  assert.equal(JSON.stringify(data.quotes[0].versions[0]), issued);
  q.quantity = 20;
  record = await store.save({ id: record.id, revision: record.revision, input: q, configVersion: 2, issue: true });
  assert.equal(record.versions.length, 2); assert.equal(JSON.stringify(record.versions[0]), issued);
  assert.equal(record.versions[1].configSnapshot.materials[0].kgCost, '180000');
  const publicV1 = await store.commercial(record.id, 1); assert.equal(publicV1.quantity, 1);
  await assert.rejects(() => store.commercial(record.id, 99), /emitida/);
  await assert.rejects(() => store.saveConfig(config, 1), /cambió/);
  const revision = record.revision;
  record = await store.status({ id: record.id, revision, status: 'accepted' });
  await assert.rejects(() => store.status({ id: record.id, revision, status: 'rejected' }), /otra ventana/);
  await assert.rejects(() => store.save({ id: record.id, revision: record.revision, input: q, configVersion: 2 }), /Duplica/);
  record = await store.status({ id: record.id, revision: record.revision, status: 'converted' });
  assert.equal(record.order.version, 2);
  record = await store.actuals({ id: record.id, revision: record.revision, actuals: { totalCost: '100000', machineHours: '15', grams: '220' } });
  assert.equal(record.actuals.version, 2); assert.equal(JSON.stringify(record.versions[0]), issued);
  data = await store.load(); assert.equal(data.orders.length, 1); assert.ok(data.audit.every(a => a.actor === 'operador-prueba'));
  assert.ok(data.audit.some(a => a.action === 'issue'));
});

test('invalid/expired/unprofitable quotes are not issued; concurrent writes are detected', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r3d-quote-guard-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const now = new Date(), store = createQuoteStore(dir);
  const data = await store.load(), q = newQuote(data.configs[0].value, now);
  await assert.rejects(() => store.save({ input: q, configVersion: 1, issue: true }), /Cliente/);
  q.customer.name = 'Cliente'; q.strategy = 'manual'; q.manualPrice = '6000';
  await assert.rejects(() => store.save({ input: q, configVersion: 1, issue: true }), /mínimos/);
  q.strategy = 'markup'; q.validUntil = '2020-01-01';
  await assert.rejects(() => store.save({ input: q, configVersion: 1, issue: true }), /vigencia|vencida/i);
  q.validUntil = newQuote(data.configs[0].value, now).validUntil;
  const r = await store.save({ input: q, configVersion: 1 });
  const payload = { id: r.id, revision: r.revision, input: q, configVersion: 1 };
  const results = await Promise.allSettled([store.save(payload), store.save(payload)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal((await store.load()).quotes.length, 1);
});

test('corrupt history raises an error instead of silently replacing financial records', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r3d-quote-corrupt-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'quotations-v1.json'), '{invalid');
  await assert.rejects(() => createQuoteStore(dir).load(), /JSON|property|Unexpected/i);
  assert.equal(await fs.readFile(path.join(dir, 'quotations-v1.json'), 'utf8'), '{invalid');
});

test('independent store instances cannot overwrite concurrent transactions', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r3d-quote-lock-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const a = createQuoteStore(dir), b = createQuoteStore(dir), q = newQuote();
  const payload = { input: q, configVersion: 1 };
  const results = await Promise.allSettled([a.save(payload), b.save(payload)]);
  const saved = results.filter(r => r.status === 'fulfilled');
  assert.equal((await a.load()).quotes.length, saved.length);
  for (const failure of results.filter(r => r.status === 'rejected')) {
    assert.match(failure.reason.message, /ocupado/);
    await b.save(payload);
  }
  const data = await a.load();
  assert.equal(data.quotes.length, 2);
  assert.equal(new Set(data.quotes.map(q => q.number)).size, 2);
  const filename = path.join(dir, 'quotations-v1.json'), previous = await fs.readFile(filename, 'utf8');
  const lockname = path.join(dir, 'quotations-write.lock');
  await fs.writeFile(lockname, 'simulated interrupted writer');
  await assert.rejects(() => b.save(payload), /cierre inesperado/);
  assert.equal(await fs.readFile(filename, 'utf8'), previous);
  await fs.unlink(lockname);
  await b.save(payload);
  assert.equal((await a.load()).quotes.length, 3);
});

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function createQuoteStore(directory, { actor = () => require('node:os').userInfo().username, clock = () => new Date() } = {}) {
  const filename = path.join(directory, 'quotations-v1.json');
  const lockname = path.join(directory, 'quotations-write.lock');
  let chain = Promise.resolve();
  const domain = () => import('../core/quotation.js');
  const timestamp = () => clock().toISOString();
  async function read() {
    try {
      const data = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (data.schema !== 1 || !Number.isSafeInteger(data.nextNumber) || data.nextNumber < 1 ||
          !Array.isArray(data.configs) || !data.configs.length || !Array.isArray(data.quotes) ||
          !Array.isArray(data.orders) || !Array.isArray(data.audit)) throw new Error('Formato de historial de cotizaciones incompatible.');
      return data;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { schema: 1, nextNumber: 1, configs: [{ version: 1, createdAt: timestamp(), actor: actor(), value: (await domain()).defaultQuoteConfig() }], quotes: [], orders: [], audit: [] };
    }
  }
  async function write(data) {
    await fs.mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `quotations-${randomUUID()}.tmp`);
    const file = await fs.open(temporary, 'wx');
    try { await file.writeFile(JSON.stringify(data, null, 2)); await file.sync(); } finally { await file.close(); }
    try { await fs.rename(temporary, filename); }
    catch (error) { await fs.unlink(temporary); throw error; }
  }
  async function exclusive(action) {
    await fs.mkdir(directory, { recursive: true });
    let lock;
    try { lock = await fs.open(lockname, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      throw new Error(`Historial ocupado por otra instancia. Vuelve a intentarlo al terminar su guardado. Si hubo un cierre inesperado, cierra todas las instancias y elimina únicamente el bloqueo ${lockname}. No borres quotations-v1.json.`);
    }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, at: timestamp() }));
      return await action();
    } finally {
      await lock.close();
      await fs.unlink(lockname);
    }
  }
  function serial(fn, persist = false) {
    const action = async () => {
      const data = await read(), result = await fn(data);
      if (persist) await write(data);
      return structuredClone(result);
    };
    const work = chain.then(() => persist ? exclusive(action) : action());
    chain = work.then(() => undefined, () => undefined);
    return work;
  }
  const event = (data, action, quoteId, detail = '') => data.audit.push({ at: timestamp(), actor: actor(), action, quoteId, detail });
  function find(data, id, revision) {
    const record = data.quotes.find(q => q.id === id);
    if (!record) throw new Error('Cotización no encontrada.');
    if (revision !== undefined && record.revision !== revision) throw new Error('La cotización cambió en otra ventana. Recarga antes de guardar.');
    return record;
  }
  return {
    load: () => serial(data => ({ ...data, actor: actor() })),
    saveConfig: (value, expectedVersion) => serial(async data => {
      if (data.configs.at(-1).version !== expectedVersion) throw new Error('La configuración cambió. Recarga antes de guardarla.');
      (await domain()).validateQuoteConfig(value);
      const config = { version: expectedVersion + 1, createdAt: timestamp(), actor: actor(), value: structuredClone(value) };
      data.configs.push(config); event(data, 'config', null, `v${config.version}`);
      return config;
    }, true),
    save: payload => serial(async data => {
      const { calculateQuote, validateCommercial } = await domain();
      const config = data.configs.find(c => c.version === payload.configVersion);
      if (!config) throw new Error('Versión de costos inexistente.');
      const input = structuredClone(payload.input), result = calculateQuote(input, config.value);
      let record = payload.id ? find(data, payload.id, payload.revision) : null;
      if (record && ['accepted', 'converted'].includes(record.status)) throw new Error('Duplica la cotización aceptada para modificarla sin cambiar el compromiso original.');
      if (payload.issue) {
        validateCommercial(input);
        if (!result.canIssue) throw new Error('El precio está por debajo de los mínimos configurados.');
        if (input.validUntil < timestamp().slice(0, 10)) throw new Error('La cotización ya está vencida; actualiza su vigencia.');
      }
      if (!record) {
        record = { id: randomUUID(), number: `PAB-${clock().getFullYear()}-${String(data.nextNumber++).padStart(6, '0')}`, revision: 0,
          createdAt: timestamp(), createdBy: actor(), versions: [], status: 'draft', actuals: null };
        data.quotes.push(record);
      }
      Object.assign(record, { input, result, configVersion: config.version, updatedAt: timestamp(), updatedBy: actor(), status: payload.issue ? 'sent' : 'draft' });
      record.revision++;
      if (payload.issue) record.versions.push({
        version: record.versions.length + 1, issuedAt: timestamp(), issuedBy: actor(),
        input: structuredClone(input), result: structuredClone(result), configVersion: config.version, configSnapshot: structuredClone(config.value),
      });
      event(data, payload.issue ? 'issue' : 'draft', record.id, `r${record.revision}`);
      return record;
    }, true),
    status: ({ id, revision, status }) => serial(data => {
      const record = find(data, id, revision);
      const allowed = { sent: ['accepted', 'rejected'], accepted: ['converted'], rejected: [], draft: [], converted: [] };
      if (!allowed[record.status]?.includes(status)) throw new Error('Transición de estado no permitida.');
      if (status === 'accepted' && record.input.validUntil < timestamp().slice(0, 10)) throw new Error('Renueva la cotización vencida antes de aceptarla.');
      if (status === 'converted') {
        const order = { id: randomUUID(), number: `PED-${record.number}`, quoteId: id, version: record.versions.at(-1).version, createdAt: timestamp(), actor: actor() };
        data.orders.push(order); record.order = order;
      }
      record.status = status; record.revision++; record.updatedAt = timestamp(); record.updatedBy = actor();
      event(data, 'status', id, status); return record;
    }, true),
    actuals: ({ id, revision, actuals }) => serial(async data => {
      const record = find(data, id, revision), { decimal } = await domain();
      if (!record.versions.length) throw new Error('Emite la cotización antes de registrar costos reales.');
      decimal(actuals.totalCost, 'Costo real total');
      decimal(actuals.machineHours, 'Horas reales');
      decimal(actuals.grams, 'Gramos reales');
      record.actuals = { version: record.versions.at(-1).version, totalCost: String(actuals.totalCost), machineHours: String(actuals.machineHours), grams: String(actuals.grams), at: timestamp(), actor: actor() };
      record.revision++; event(data, 'actuals', id); return record;
    }, true),
    commercial: (id, version) => serial(async data => {
      const record = find(data, id);
      const issued = record.versions.find(v => v.version === version);
      if (!issued) throw new Error('Selecciona una versión emitida, no un borrador.');
      const { commercialQuote } = await import('../core/quote_document.js');
      return commercialQuote(issued, record.number);
    }),
  };
}

module.exports = { createQuoteStore };

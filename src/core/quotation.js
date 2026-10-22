import Decimal from 'decimal.js';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const sum = values => values.reduce((a, b) => a.plus(b), new D(0));
const str = value => new D(value).toFixed(8).replace(/\.?0+$/, '') || '0';
const money = value => new D(value).toFixed(2);
const clone = value => JSON.parse(JSON.stringify(value));

export function decimal(value, label, { min = 0, max = '1e18', positive = false } = {}) {
  if (!['string', 'number'].includes(typeof value) || !/^-?\d+(?:\.\d+)?$/.test(String(value))) throw new Error(`${label}: escribe un número válido, sin separadores de miles.`);
  const n = new D(value);
  if (!n.isFinite() || n.lt(min) || n.gt(max) || (positive && n.isZero())) throw new Error(`${label}: valor fuera del rango permitido.`);
  return n;
}
const pct = (value, label, max = 100) => decimal(value, label, { max }).div(100);
const count = (value, label, allowZero = false) => {
  const n = decimal(value, label, { max: Number.MAX_SAFE_INTEGER, positive: !allowZero });
  if (!n.isInteger()) throw new Error(`${label}: debe ser un entero.`);
  return n.toNumber();
};
const choice = (value, values, label) => {
  if (!values.includes(value)) throw new Error(`${label}: opción no válida.`);
  return value;
};
const required = (value, label, max = 4000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}: dato obligatorio o demasiado largo.`);
  return value.trim();
};
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function defaultQuoteConfig() {
  return {
    currency: 'COP', effectiveAt: '2020-01-01',
    brand: { name: 'Pabonitas', contact: '', taxId: '', address: '', logo: '' },
    materials: [{ id: 'pla', name: 'PLA', supplier: '', kgCost: '90000', spoolKg: '1', availableGrams: '0' }],
    printers: [
      { id: 'a1', name: 'Bambu Lab A1', hourlyRate: '1750', mode: 'bundled', kw: '0.15', kwhCost: '900', depreciation: '1000', maintenance: '300', factor: '1', availableMinutes: '0' },
      { id: 'p2s', name: 'Bambu Lab P2S', hourlyRate: '1750', mode: 'bundled', kw: '0.15', kwhCost: '900', depreciation: '1000', maintenance: '300', factor: '1', availableMinutes: '0' },
    ],
    purgePercent: '12', supportPercent: '0', wastePercent: '0',
    markup: '55', minimumMargin: '20', minimumUnitPrice: '0', roundTo: '500',
    vatPercent: '0', vatMode: 'excluded', feePercent: '0', feeFixed: '0', feeOnTax: true,
    defaultLabor: '5000', defaultPackaging: '500', ringStandard: '900', ringAlternative: '2000',
    scenarios: [
      { name: 'Económico', strategy: 'margin', value: '20' },
      { name: 'Competitivo', strategy: 'markup', value: '40' },
      { name: 'Recomendado', strategy: 'markup', value: '55' },
      { name: 'Premium', strategy: 'markup', value: '85' },
    ],
    tiers: [
      { from: 1, to: 9, discount: '0' }, { from: 10, to: 29, discount: '3' },
      { from: 30, to: 49, discount: '5' }, { from: 50, to: 99, discount: '8' },
      { from: 100, to: 199, discount: '10' }, { from: 200, to: null, discount: '12' },
    ],
  };
}

export function newQuote(config = defaultQuoteConfig(), now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  return {
    entryMode: 'full',
    customer: { name: '', contact: '', taxId: '', address: '' },
    product: 'Llavero personalizado', description: 'Impresión 3D con anillo metálico.',
    date, validUntil: new Date(now.getTime() + 15 * 86400000).toISOString().slice(0, 10),
    deliveryDate: '', profile: '', layerHeight: '0.2', quantity: 1,
    print: { mode: 'unit', minutes: '43', unitsPerBatch: 1, capacity: 1, turnaround: '0', partialMethod: 'estimate', partialMinutes: '', start: `${date}T08:00` },
    materials: [{ materialId: config.materials[0].id, color: 'Rosa', grams: '10', partialGrams: '', kgCost: '', includesPurge: false, includesSupports: false }],
    printers: [{ printerId: config.printers[0].id, copies: 1, hourlyRate: '' }],
    labor: [{ name: 'Preparación y acabado', basis: 'unit', method: 'fixed', amount: config.defaultLabor, minutes: '0', rate: '0' }],
    accessories: [{ name: 'Anillo metálico estándar', basis: 'unit', quantity: '1', cost: config.ringStandard, wastePercent: '0' }],
    packaging: { basis: 'unit', cost: config.defaultPackaging },
    extras: [], contingencyPercent: '0', failurePercent: '0', failureSource: 'assumption',
    strategy: 'markup', target: config.markup, manualPrice: '', discountPercent: '0', wholesale: true,
    internalNotes: '', commercialNotes: '', terms: 'Producción sujeta a confirmación del pedido y del anticipo.',
    depositPercent: '50',
  };
}

export function newQuickQuote(config = defaultQuoteConfig(), now = new Date()) {
  const q = newQuote(config, now);
  q.entryMode = 'quick'; q.product = 'Impresión 3D'; q.description = '';
  q.print.minutes = ''; q.materials[0].grams = ''; q.materials[0].color = 'Sin especificar';
  q.labor = []; q.accessories = []; q.packaging.cost = '0';
  return q;
}

export function validateQuoteConfig(c) {
  if (c.currency !== 'COP') throw new Error('Esta versión usa COP; no realiza conversiones de moneda.');
  if (!validDate(c.effectiveAt)) throw new Error('Vigencia de costos inválida.');
  required(c.brand?.name, 'Nombre comercial', 200);
  for (const key of ['contact', 'taxId', 'address', 'logo']) if (typeof c.brand[key] !== 'string') throw new Error(`Datos comerciales: ${key} inválido.`);
  if (c.brand.logo && (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(c.brand.logo) || c.brand.logo.length > 1500000)) throw new Error('El logo debe ser PNG/JPEG de hasta aproximadamente 1 MB.');
  for (const key of ['purgePercent', 'supportPercent', 'wastePercent', 'vatPercent']) pct(c[key], key);
  pct(c.minimumMargin, 'Margen mínimo', 99);
  pct(c.feePercent, 'Comisión', 99);
  decimal(c.markup, 'Recargo');
  for (const key of ['minimumUnitPrice', 'feeFixed', 'defaultLabor', 'defaultPackaging', 'ringStandard', 'ringAlternative']) decimal(c[key], key);
  decimal(c.roundTo, 'Múltiplo de redondeo', { positive: true });
  choice(c.vatMode, ['included', 'excluded'], 'Modalidad IVA');
  if (typeof c.feeOnTax !== 'boolean') throw new Error('Base de comisión inválida.');
  for (const [key, label] of [['materials', 'materiales'], ['printers', 'impresoras']]) {
    if (!Array.isArray(c[key]) || !c[key].length || c[key].length > 100) throw new Error(`Configura entre 1 y 100 ${label}.`);
    const ids = new Set();
    for (const item of c[key]) {
      required(item.id, 'Identificador', 100); required(item.name, 'Nombre', 200);
      if (ids.has(item.id)) throw new Error(`Identificador duplicado: ${item.id}`);
      ids.add(item.id);
    }
  }
  for (const m of c.materials) {
    decimal(m.kgCost, 'Precio por kilogramo'); decimal(m.spoolKg, 'Peso de bobina', { positive: true });
    decimal(m.availableGrams, 'Inventario disponible');
  }
  for (const p of c.printers) {
    choice(p.mode, ['bundled', 'components'], 'Tarifa de máquina');
    for (const k of ['hourlyRate', 'kw', 'kwhCost', 'depreciation', 'maintenance', 'availableMinutes']) decimal(p[k], `Impresora: ${k}`);
    decimal(p.factor, 'Factor de tiempo por impresora', { min: '0.01', max: '100' });
  }
  if (!Array.isArray(c.scenarios) || c.scenarios.length !== 4) throw new Error('Configura los cuatro escenarios comerciales.');
  for (const s of c.scenarios) {
    required(s.name, 'Escenario', 100); choice(s.strategy, ['markup', 'margin'], 'Estrategia');
    decimal(s.value, 'Objetivo de escenario', { max: s.strategy === 'margin' ? 99 : 10000 });
  }
  if (!Array.isArray(c.tiers) || !c.tiers.length || c.tiers.length > 30) throw new Error('Configura las escalas mayoristas.');
  let next = 1;
  for (let i = 0; i < c.tiers.length; i++) {
    const t = c.tiers[i];
    if (count(t.from, 'Inicio de escala') !== next) throw new Error('Las escalas deben ser continuas, sin huecos ni superposiciones, desde 1.');
    pct(t.discount, 'Descuento de escala', 99);
    if (t.to === null) {
      if (i !== c.tiers.length - 1) throw new Error('Solo la última escala puede no tener límite.');
    } else {
      if (count(t.to, 'Fin de escala') < next) throw new Error('Rango mayorista inválido.');
      next = count(t.to, 'Fin de escala') + 1;
    }
  }
  if (c.tiers.at(-1).to !== null) throw new Error('La última escala debe cubrir las cantidades restantes.');
  return c;
}

function schedule(full, partial, fullMinutes, partialMinutes, q, c) {
  if (!Array.isArray(q.printers) || !q.printers.length) throw new Error('Selecciona al menos una impresora.');
  const slots = [], ids = new Set();
  const turnaround = decimal(q.print.turnaround, 'Preparación entre tandas');
  for (const selection of q.printers) {
    if (ids.has(selection.printerId)) throw new Error('No repitas la misma impresora; usa su número de máquinas.');
    ids.add(selection.printerId);
    const printer = c.printers.find(p => p.id === selection.printerId);
    if (!printer) throw new Error('Impresora inexistente en esta versión de costos.');
    const copies = count(selection.copies, 'Número de impresoras');
    if (slots.length + copies > 100) throw new Error('El plan admite hasta 100 impresoras simultáneas.');
    const factor = decimal(printer.factor, 'Factor de tiempo', { positive: true });
    const rate = selection.hourlyRate !== '' ? decimal(selection.hourlyRate, 'Tarifa específica') :
      printer.mode === 'bundled' ? decimal(printer.hourlyRate, 'Tarifa horaria') :
        decimal(printer.kw, 'Consumo').times(printer.kwhCost).plus(printer.depreciation).plus(printer.maintenance);
    for (let i = 0; i < copies; i++) slots.push({
      printerId: printer.id, name: `${printer.name}${copies > 1 ? ` #${i + 1}` : ''}`, rate, factor,
      available: decimal(printer.availableMinutes, 'Disponibilidad').toNumber(),
      cycle: fullMinutes.times(factor).plus(turnaround).toNumber(), batches: 0, units: 0, minutes: new D(0), partial: false,
    });
  }
  if (full) {
    let lo = 0, hi = Math.min(...slots.map(s => s.available + full * s.cycle));
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      const done = slots.reduce((n, s) => n + Math.max(0, Math.floor((mid - s.available) / s.cycle)), 0);
      if (done >= full) hi = mid; else lo = mid;
    }
    let assigned = 0;
    for (const s of slots) { s.batches = Math.max(0, Math.floor((lo - s.available) / s.cycle)); assigned += s.batches; }
    while (assigned < full) {
      const s = slots.reduce((a, b) => a.available + (a.batches + 1) * a.cycle <= b.available + (b.batches + 1) * b.cycle ? a : b);
      s.batches++; assigned++;
    }
  }
  for (const s of slots) {
    s.units = s.batches * Number(q.print.unitsPerBatch);
    s.minutes = fullMinutes.times(s.factor).times(s.batches);
    s.end = s.available + s.batches * s.cycle;
  }
  if (partial) {
    const s = slots.reduce((a, b) => a.end + partialMinutes.times(a.factor).toNumber() <= b.end + partialMinutes.times(b.factor).toNumber() ? a : b);
    s.minutes = s.minutes.plus(partialMinutes.times(s.factor));
    s.end += partialMinutes.times(s.factor).plus(turnaround).toNumber();
    s.batches++; s.units += partial; s.partial = true;
  }
  return slots.filter(s => s.batches > 0);
}

function costQuote(q, c) {
  validateQuoteConfig(c);
  if (q.entryMode !== undefined) choice(q.entryMode, ['quick', 'full'], 'Modo de cotización');
  if (typeof q.wholesale !== 'boolean') throw new Error('La opción mayorista debe estar activada o desactivada.');
  const quantity = count(q.quantity, 'Cantidad');
  const batchSize = count(q.print.unitsPerBatch, 'Unidades por tanda');
  if (batchSize > count(q.print.capacity, 'Capacidad de placa')) throw new Error('La tanda supera la capacidad de la placa.');
  choice(q.print.mode, ['unit', 'batch'], 'Modalidad de impresión');
  choice(q.print.partialMethod, ['actual', 'estimate'], 'Tanda parcial');
  const minutes = decimal(q.print.minutes, 'Tiempo de impresión en minutos', { positive: true });
  const full = Math.floor(quantity / batchSize), partial = quantity % batchSize, batches = full + (partial ? 1 : 0);
  const fullMinutes = q.print.mode === 'unit' ? minutes.times(batchSize) : minutes;
  const partialMinutes = !partial ? new D(0) : q.print.mode === 'unit' ? minutes.times(partial) :
    q.print.partialMethod === 'actual' ? decimal(q.print.partialMinutes, 'Minutos de tanda parcial', { positive: true }) : minutes.times(partial).div(batchSize);
  const warnings = [];
  if (q.print.mode === 'unit' && batchSize > 1) warnings.push('Se suman tiempos unitarios: no es una medición real de una placa con varias piezas.');
  if (partial && q.print.mode === 'batch' && q.print.partialMethod === 'estimate') warnings.push('Tanda parcial aproximada proporcionalmente. Confirma tiempo y gramos en el laminador.');
  const failure = pct(q.failurePercent, 'Fallos previstos', 95), riskFactor = new D(1).div(new D(1).minus(failure));
  choice(q.failureSource, ['assumption', 'history'], 'Origen de fallos');
  if (failure.gt(0)) warnings.push(q.failureSource === 'history' ? 'Reserva basada en el porcentaje histórico ingresado; no es una garantía de finalización.' : 'El porcentaje de fallos es un supuesto, no una estadística medida.');
  if (!Array.isArray(q.materials) || !q.materials.length || q.materials.length > 100) throw new Error('Añade entre 1 y 100 materiales/colores.');
  const lines = [], usage = [];
  const add = (name, category, amount, basis = 'variable', cash = true) => {
    lines.push({ name, category, amount: new D(amount), basis, cash });
  };
  for (const row of q.materials) {
    const m = c.materials.find(x => x.id === row.materialId);
    if (!m) throw new Error('Material inexistente en esta versión de costos.');
    required(row.color, 'Color', 100);
    const grams = decimal(row.grams, 'Gramos', { positive: true });
    const base = q.print.mode === 'unit' ? grams.times(quantity) : grams.times(full).plus(!partial ? 0 :
      q.print.partialMethod === 'actual' ? decimal(row.partialGrams, 'Gramos de tanda parcial', { positive: true }) : grams.times(partial).div(batchSize));
    if (typeof row.includesPurge !== 'boolean' || typeof row.includesSupports !== 'boolean') throw new Error('Indica si el laminador incluye purgas y soportes.');
    const purge = row.includesPurge ? new D(0) : base.times(pct(c.purgePercent, 'Purgas'));
    const supports = row.includesSupports ? new D(0) : base.times(pct(c.supportPercent, 'Soportes'));
    const waste = base.times(pct(c.wastePercent, 'Merma adicional'));
    const normal = base.plus(purge).plus(supports).plus(waste), failed = normal.times(riskFactor.minus(1));
    const total = normal.plus(failed), price = decimal(row.kgCost === '' ? m.kgCost : row.kgCost, 'Precio/kg').div(1000);
    add(`${m.name} · ${row.color}: modelo`, 'material', base.times(price));
    if (purge.gt(0)) add(`${row.color}: purgas/reserva`, 'material', purge.times(price));
    if (supports.gt(0)) add(`${row.color}: soportes`, 'material', supports.times(price));
    if (waste.gt(0)) add(`${row.color}: merma de proceso`, 'material', waste.times(price));
    if (failed.gt(0)) add(`${row.color}: reserva de fallos`, 'risk', failed.times(price));
    usage.push({ materialId: m.id, material: m.name, color: row.color, grams: str(total), baseGrams: str(base), extraGrams: str(purge.plus(supports).plus(waste)), failureGrams: str(failed) });
  }
  const inventory = c.materials.filter(m => usage.some(u => u.materialId === m.id)).map(m => {
    const grams = sum(usage.filter(u => u.materialId === m.id).map(u => u.grams));
    const missing = D.max(0, grams.minus(m.availableGrams));
    return { material: m.name, grams: str(grams), kg: str(grams.div(1000)), availableGrams: m.availableGrams, missingGrams: str(missing), spoolsToBuy: missing.div(new D(m.spoolKg).times(1000)).ceil().toNumber() };
  });
  const slots = schedule(full, partial, fullMinutes, partialMinutes, q, c);
  if (slots.length > 1) warnings.push('Plan paralelo con los factores de tiempo configurados por impresora; verifica que el perfil y la placa sean compatibles.');
  for (const s of slots) {
    const cost = s.minutes.div(60).times(s.rate);
    add(s.name, 'machine', cost);
    if (failure.gt(0)) add(`${s.name}: reserva de reimpresión`, 'risk', cost.times(riskFactor.minus(1)));
  }
  const multiplier = basis => {
    choice(basis, ['order', 'unit', 'batch'], 'Aplicación del costo');
    return basis === 'order' ? 1 : basis === 'unit' ? quantity : batches;
  };
  let laborMinutes = new D(0);
  for (const [key, category] of [['labor', 'labor'], ['extras', 'indirect']]) {
    if (!Array.isArray(q[key]) || q[key].length > 100) throw new Error(`Lista de ${key} inválida.`);
    for (const row of q[key]) {
      required(row.name, 'Nombre del costo', 200);
      const n = multiplier(row.basis);
      choice(row.method, ['fixed', 'time'], 'Tipo de costo');
      const duration = row.method === 'time' ? decimal(row.minutes, 'Minutos de trabajo').times(n) : new D(0);
      const amount = row.method === 'time' ? duration.div(60).times(decimal(row.rate, 'Tarifa laboral')) : decimal(row.amount, 'Costo fijo').times(n);
      if (category === 'labor') laborMinutes = laborMinutes.plus(duration);
      add(row.name, category, amount, row.basis === 'order' ? 'fixed' : 'variable', row.cash !== false);
    }
  }
  if (!Array.isArray(q.accessories) || q.accessories.length > 100) throw new Error('Accesorios inválidos.');
  for (const a of q.accessories) {
    required(a.name, 'Accesorio', 200);
    const amount = decimal(a.quantity, 'Cantidad de accesorio', { positive: true }).times(multiplier(a.basis))
      .times(decimal(a.cost, 'Costo del accesorio')).times(new D(1).plus(pct(a.wastePercent, 'Merma de accesorio')));
    add(a.name, 'accessories', amount, a.basis === 'order' ? 'fixed' : 'variable');
  }
  add('Empaque', 'packaging', decimal(q.packaging.cost, 'Costo de empaque').times(multiplier(q.packaging.basis)), q.packaging.basis === 'order' ? 'fixed' : 'variable');
  const contingency = sum(lines.map(l => l.amount)).times(pct(q.contingencyPercent, 'Contingencia'));
  if (contingency.gt(0)) add('Contingencia general (adicional a fallos)', 'contingency', contingency);
  const cost = sum(lines.map(l => l.amount)), machineMinutes = sum(slots.map(s => s.minutes));
  const calendarMinutes = Math.max(...slots.map(s => s.end));
  if (typeof q.print.start !== 'string' || !validDate(q.print.start.slice(0, 10)) || !Number.isFinite(Date.parse(q.print.start))) throw new Error('Fecha de inicio de producción inválida.');
  const completion = new Date(Date.parse(q.print.start) + calendarMinutes * 60000);
  if (!Number.isFinite(completion.getTime())) throw new Error('El plazo excede el rango del calendario.');
  warnings.push('Calendario estimado con disponibilidad continua y esperas configuradas; no incluye festivos, transporte ni turnos laborales.');
  if (laborMinutes.isZero()) warnings.push('La mano de obra fija no informa duración: la rentabilidad por hora laboral no está disponible.');
  return {
    cost, lines, quantity, warnings, machineMinutes, laborMinutes,
    production: { batches, fullBatches: full, partialUnits: partial, machineHours: str(machineMinutes.div(60)), calendarHours: str(new D(calendarMinutes).div(60)),
      failureReserveHours: str(machineMinutes.times(riskFactor.minus(1)).div(60)), laborHours: str(laborMinutes.div(60)), completion: completion.toISOString(), usage, inventory,
      printers: slots.map(s => ({ name: s.name, units: s.units, batches: s.batches, partial: s.partial, hours: str(s.minutes.div(60)), finishHours: str(new D(s.end).div(60)), cost: money(s.minutes.div(60).times(s.rate)) })) },
  };
}

export function calculateQuote(input, config = defaultQuoteConfig()) {
  const q = clone(input), c = config;
  const base = costQuote(q, c), { cost, quantity } = base;
  choice(q.strategy, ['markup', 'margin', 'manual'], 'Estrategia de precio');
  const tax = pct(c.vatPercent, 'IVA'), taxFactor = new D(1).plus(tax);
  const fee = pct(c.feePercent, 'Comisión').times(c.feeOnTax ? taxFactor : 1), fixedFee = decimal(c.feeFixed, 'Comisión fija');
  const minMargin = pct(c.minimumMargin, 'Margen mínimo', 99);
  if (minMargin.plus(fee).gte(1)) throw new Error('El margen mínimo y la comisión hacen inviable el precio.');
  const floorTotal = D.max(cost.plus(fixedFee).div(new D(1).minus(minMargin).minus(fee)), decimal(c.minimumUnitPrice, 'Precio mínimo').times(quantity));
  const tier = c.tiers.find(t => quantity >= t.from && (t.to === null || quantity <= t.to));
  const discount = pct(q.discountPercent, 'Descuento', 100);
  const volumeDiscount = q.wholesale && q.strategy !== 'manual' ? pct(tier.discount, 'Descuento mayorista', 99) : new D(0);
  const displayFactor = c.vatMode === 'included' ? taxFactor : new D(1);
  let total, beforeDiscount, clamped = false;
  if (q.strategy === 'manual') {
    beforeDiscount = decimal(q.manualPrice, 'Precio de venta', { positive: true }).div(displayFactor).times(quantity);
    total = beforeDiscount.times(new D(1).minus(discount)).times(new D(1).minus(volumeDiscount));
  } else {
    const target = q.strategy === 'margin' ? pct(q.target, 'Margen objetivo', 99) : decimal(q.target, 'Markup', { max: 10000 }).div(100);
    const denominator = q.strategy === 'margin' ? new D(1).minus(target).minus(fee) : new D(1).minus(fee.times(new D(1).plus(target)));
    if (denominator.lte(0)) throw new Error('Objetivo inviable con la comisión configurada.');
    beforeDiscount = cost.plus(fixedFee).times(q.strategy === 'margin' ? 1 : new D(1).plus(target)).div(denominator);
    total = beforeDiscount.times(new D(1).minus(discount)).times(new D(1).minus(volumeDiscount));
    if (total.lt(floorTotal)) { total = floorTotal; clamped = true; base.warnings.push('El descuento/objetivo se limitó para respetar el precio y margen mínimos.'); }
    const step = decimal(c.roundTo, 'Redondeo', { positive: true });
    total = total.div(quantity).times(displayFactor).div(step).ceil().times(step).div(displayFactor).times(quantity);
  }
  const displayedUnit = new D(money(total.div(quantity).times(displayFactor)));
  const netSales = new D(money(displayedUnit.div(displayFactor).times(quantity)));
  const grand = c.vatMode === 'included' ? displayedUnit.times(quantity) : netSales.plus(new D(money(netSales.times(tax))));
  const vat = grand.minus(netSales);
  const commission = netSales.times(fee).plus(fixedFee), totalCost = cost.plus(commission), profit = netSales.minus(totalCost);
  const margin = netSales.isZero() ? null : profit.div(netSales).times(100);
  const canIssue = netSales.gte(floorTotal.minus('0.01')) && profit.gte(0);
  if (!canIssue) base.warnings.unshift('PRECIO NO VIABLE: por debajo del costo, del margen mínimo o del precio mínimo. Puedes simularlo, pero no emitirlo.');
  const categories = {};
  const lines = [...base.lines, { name: 'Comisiones de pago', category: 'fees', basis: 'variable', cash: true, amount: netSales.times(fee) }];
  if (fixedFee.gt(0)) lines.push({ name: 'Comisión fija por pedido', category: 'fees', basis: 'fixed', cash: true, amount: fixedFee });
  for (const l of lines) categories[l.category] = (categories[l.category] || new D(0)).plus(l.amount);
  const contribution = netSales.div(quantity).times(new D(1).minus(fee));
  const breakEvenUnits = contribution.gt(0) ? cost.plus(fixedFee).div(contribution).ceil().toNumber() : null;
  const deposit = pct(q.depositPercent, 'Anticipo');
  return {
    quantity, lines: lines.map(l => ({ ...l, amount: money(l.amount), exactAmount: str(l.amount) })),
    categories: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, money(v)])),
    categoryUnits: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, money(v.div(quantity))])),
    productionCost: money(cost), totalCost: money(totalCost), unitCost: money(totalCost.div(quantity)),
    unitNet: money(netSales.div(quantity)), unitPrice: money(displayedUnit),
    netSales: money(netSales), vat: money(vat), total: money(grand), profit: money(profit), unitProfit: money(profit.div(quantity)),
    margin: margin === null ? null : str(margin), markup: totalCost.isZero() ? null : str(profit.div(totalCost).times(100)),
    machineProfitPerHour: base.machineMinutes.gt(0) ? money(profit.div(base.machineMinutes.div(60))) : null,
    laborProfitPerHour: base.laborMinutes.gt(0) ? money(profit.div(base.laborMinutes.div(60))) : null,
    minimumUnitNet: money(floorTotal.div(quantity)), breakEvenUnits,
    fundingEstimate: money(sum(base.lines.filter(l => l.cash).map(l => l.amount))),
    deposit: money(grand.times(deposit)), discountAmount: money(D.max(0, beforeDiscount.minus(netSales))),
    appliedTier: clone(tier), discountLimited: clamped, canIssue, production: base.production, warnings: base.warnings,
    assumptions: ['Utilidad estimada del pedido, no ganancia neta del negocio ni liquidación tributaria.',
      'Capital estimado a financiar: costos productivos marcados como desembolso; la tarifa integrada puede contener depreciación.',
      'Equilibrio: unidades a vender para recuperar el costo del pedido actual, no el equilibrio global del negocio.',
      'Inventario referencial ingresado manualmente, compartido por material (no reservado por color).'],
  };
}

export function wholesaleTable(input, config, quantities = [1, 20, 50, 100, 130, 200]) {
  return [...new Set([...quantities, count(input.quantity, 'Cantidad')])].sort((a, b) => a - b).map(quantity => {
    const q = { ...clone(input), quantity };
    if (q.print.mode === 'batch' && q.print.partialMethod === 'actual' && quantity % Number(q.print.unitsPerBatch) !== Number(input.quantity) % Number(input.print.unitsPerBatch)) {
      q.print.partialMethod = 'estimate';
    }
    return { ...calculateQuote(q, config), approximate: q.print.mode === 'batch' && q.print.partialMethod === 'estimate' && quantity % Number(q.print.unitsPerBatch) !== 0 };
  });
}

export function scenarios(input, config) {
  return config.scenarios.map(s => ({ name: s.name, strategy: s.strategy, target: s.value,
    ...calculateQuote({ ...clone(input), strategy: s.strategy, target: s.value }, config) }));
}

export function compareQuotes(original, optimized, config, { samePrice = true } = {}) {
  if (Number(original.quantity) !== Number(optimized.quantity)) throw new Error('Compara la misma cantidad de unidades.');
  const b = calculateQuote(optimized, config);
  const originalInput = samePrice ? { ...clone(original), strategy: 'manual', manualPrice: b.unitPrice, discountPercent: '0', wholesale: false } : original;
  const a = calculateQuote(originalInput, config);
  const ga = sum(a.production.usage.map(u => u.grams)), gb = sum(b.production.usage.map(u => u.grams));
  return { original: a, optimized: b, samePrice, savedGrams: str(ga.minus(gb)), savedHours: str(new D(a.production.machineHours).minus(b.production.machineHours)),
    costSaving: money(new D(a.totalCost).minus(b.totalCost)), costReductionPercent: new D(a.totalCost).isZero() ? null : str(new D(a.totalCost).minus(b.totalCost).div(a.totalCost).times(100)),
    profitDifference: money(new D(b.profit).minus(a.profit)), capacityGainPercent: new D(b.production.machineHours).isZero() ? null : str(new D(a.production.machineHours).div(b.production.machineHours).minus(1).times(100)),
    recommended: new D(b.profit).gte(a.profit) ? 'optimized' : 'original' };
}

export function validateCommercial(input) {
  required(input.customer?.name, 'Cliente', 300); required(input.product, 'Producto', 300);
  for (const key of ['date', 'validUntil']) if (!validDate(input[key])) throw new Error(`Fecha inválida: ${key}`);
  if (input.validUntil < input.date) throw new Error('La vigencia no puede terminar antes de la fecha de cotización.');
  if (input.deliveryDate && (!validDate(input.deliveryDate) || input.deliveryDate < input.date)) throw new Error('Fecha de entrega inválida.');
  for (const key of ['description', 'internalNotes', 'commercialNotes', 'terms']) if (typeof input[key] !== 'string' || input[key].length > 10000) throw new Error(`Texto inválido: ${key}`);
}

export function quoteAnalytics(records) {
  const issued = records.filter(r => r.versions.length);
  const sold = issued.filter(r => ['accepted', 'converted'].includes(r.status));
  const total = (rows, key) => sum(rows.map(r => r.versions.at(-1).result[key]));
  function groups(key) {
    const map = new Map();
    for (const record of sold) {
      const v = record.versions.at(-1), name = key === 'customer' ? v.input.customer.name : v.input.product;
      const item = map.get(name) || { name, count: 0, sales: new D(0), profit: new D(0) };
      item.count++; item.sales = item.sales.plus(v.result.netSales); item.profit = item.profit.plus(v.result.profit); map.set(name, item);
    }
    return [...map.values()].map(x => ({ ...x, sales: money(x.sales), profit: money(x.profit), margin: x.sales.isZero() ? null : str(x.profit.div(x.sales).times(100)) })).sort((a, b) => new D(b.profit).cmp(a.profit));
  }
  const printers = new Map();
  for (const record of sold) {
    const r = record.versions.at(-1).result;
    for (const p of r.production.printers) {
      const x = printers.get(p.name) || { name: p.name, hours: new D(0), profit: new D(0) };
      x.hours = x.hours.plus(p.hours);
      if (new D(r.production.machineHours).gt(0)) x.profit = x.profit.plus(new D(r.profit).times(p.hours).div(r.production.machineHours));
      printers.set(p.name, x);
    }
  }
  return {
    quoted: money(total(issued, 'netSales')), sold: money(total(sold, 'netSales')), profit: money(total(sold, 'profit')),
    accepted: sold.length, issued: issued.length, conversion: issued.length ? str(new D(sold.length).div(issued.length).times(100)) : null,
    hours: str(sum(sold.map(r => r.versions.at(-1).result.production.machineHours))),
    estimatedGrams: str(sum(sold.flatMap(r => r.versions.at(-1).result.production.usage.map(u => u.grams)))),
    actualGrams: str(sum(records.filter(r => r.actuals).map(r => r.actuals.grams))),
    customers: groups('customer'), products: groups('product'),
    printers: [...printers.values()].map(p => ({ name: p.name, hours: str(p.hours), profit: money(p.profit) })),
    actuals: records.filter(r => r.actuals).map(r => {
      const v = r.versions.find(v => v.version === r.actuals.version) || r.versions.at(-1);
      return { number: r.number, version: v.version, estimated: v.result.totalCost, actual: r.actuals.totalCost,
        difference: money(new D(r.actuals.totalCost).minus(v.result.totalCost)), profit: money(new D(v.result.netSales).minus(r.actuals.totalCost)) };
    }),
  };
}

export { clone as cloneQuote };

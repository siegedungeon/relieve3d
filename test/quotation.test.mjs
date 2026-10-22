import test from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { defaultQuoteConfig, newQuote, newQuickQuote, calculateQuote, wholesaleTable, scenarios, compareQuotes, validateQuoteConfig, validateCommercial, quoteAnalytics } from '../src/core/quotation.js';
import { commercialQuote, commercialHTML, commercialText } from '../src/core/quote_document.js';

const fresh = () => { const c = defaultQuoteConfig(), q = newQuote(c); return { c, q }; };
const near = (actual, expected, tolerance = '0.000001') => assert.ok(new Decimal(actual).minus(expected).abs().lte(tolerance), `${actual} != ${expected}`);
test('quick quotes require only measured time and grams, without implicit finishing or customer data', () => {
  const c = defaultQuoteConfig(), q = newQuickQuote(c);
  assert.equal(q.entryMode, 'quick'); assert.equal(q.customer.name, '');
  assert.equal(q.print.minutes, ''); assert.equal(q.materials[0].grams, '');
  assert.throws(() => calculateQuote(q, c), /Tiempo/);
  q.print.minutes = '43'; q.materials[0].grams = '10';
  const r = calculateQuote(q, c);
  assert.equal(r.totalCost, '2262.17'); assert.equal(r.unitPrice, '4000.00'); assert.equal(r.profit, '1737.83');
  assert.equal(r.categories.labor, undefined); assert.equal(r.categories.accessories, undefined); assert.equal(r.categories.packaging, '0.00');
  assert.deepEqual(calculateQuote({ ...q, entryMode: 'full' }, c), r);
  assert.throws(() => validateCommercial(q), /Cliente/);
  const complete = newQuote(c);
  assert.equal(calculateQuote(complete, c).totalCost, '8662.17');
  q.accessories = complete.accessories; q.labor = complete.labor; q.packaging = complete.packaging;
  assert.equal(calculateQuote(q, c).totalCost, '8662.17');
});

test('quick quotes honor configured tariffs and keep plate totals distinct from per-unit inputs', () => {
  const c = defaultQuoteConfig(), q = newQuickQuote(c);
  q.print.minutes = '2460'; q.materials[0].grams = '500'; q.quantity = 10;
  q.print.mode = 'batch'; q.print.capacity = q.print.unitsPerBatch = 10;
  const batch = calculateQuote(q, c);
  assert.equal(batch.totalCost, '122150.00'); assert.equal(batch.production.machineHours, '41');
  q.print.mode = 'unit'; q.print.capacity = q.print.unitsPerBatch = 1;
  assert.equal(calculateQuote(q, c).totalCost, '1221500.00');
  q.quantity = 1; q.print.minutes = '60'; q.materials[0].grams = '10';
  c.materials[0].kgCost = '120000'; c.printers[0].hourlyRate = '3000'; c.defaultLabor = '9999';
  assert.equal(calculateQuote(q, c).totalCost, '4344.00');
});

const cases = [
  ['individual 39 min / 9 g', 39, 9, 1, 'unit', false],
  ['individual 1 h / 27 g', 60, 27, 1, 'unit', false],
  ['individual 6 h / 58 g', 360, 58, 1, 'unit', false],
  ['individual 17 h / 183 g', 1020, 183, 1, 'unit', false],
  ['placa 7 h / 163 g / 14', 420, 163, 14, 'batch', false],
  ['placa 41 h / 500 g / 10', 2460, 500, 10, 'batch', false],
  ['placa 41 h / 600 g / 8', 2460, 600, 8, 'batch', false],
  ['mayorista original 130', 90, 30, 130, 'unit', false],
  ['mayorista optimizado 130', 43, 10, 130, 'unit', false],
  ['mayorista con anillo 130', 43, 10, 130, 'unit', true],
  ['masivo 200 piezas de 6 h', 360, 58, 200, 'unit', false],
];
for (const [name, minutes, grams, quantity, mode, ring] of cases) test(name, () => {
  const { c, q } = fresh();
  q.quantity = quantity; q.print.mode = mode; q.print.minutes = String(minutes); q.materials[0].grams = String(grams);
  if (mode === 'batch') q.print.unitsPerBatch = q.print.capacity = quantity;
  if (!ring) q.accessories = [];
  const factor = mode === 'unit' ? quantity : 1;
  const expected = new Decimal(grams).times(factor).times(90).times('1.12')
    .plus(new Decimal(minutes).times(factor).div(60).times(1750)).plus(new Decimal(quantity).times(5500 + (ring ? 900 : 0)));
  const r = calculateQuote(q, c);
  assert.equal(r.totalCost, expected.toFixed(2));
  near(r.production.machineHours, new Decimal(minutes).times(factor).div(60));
  assert.equal(r.production.printers.reduce((n, p) => n + p.units, 0), quantity);
  assert.ok(r.canIssue);
});

test('130 llaveros a 6000: revenue 780000, ring charged once, actual loss', () => {
  const { c, q } = fresh(); q.quantity = 130; q.strategy = 'manual'; q.manualPrice = '6000';
  const r = calculateQuote(q, c);
  assert.equal(r.total, '780000.00'); assert.equal(r.totalCost, '1126081.67'); assert.equal(r.profit, '-346081.67');
  assert.equal(r.categories.accessories, '117000.00'); assert.equal(r.canIssue, false);
  assert.ok(Number(r.margin) < 0); assert.match(r.warnings[0], /NO VIABLE/);
});

test('markup is not margin; exact decimals survive small amounts', () => {
  const { c, q } = fresh(); c.purgePercent = '0'; c.minimumMargin = '0'; c.roundTo = '0.01';
  c.printers[0].hourlyRate = '0'; q.materials[0].grams = '100'; q.materials[0].kgCost = '1000';
  q.labor = []; q.accessories = []; q.packaging.cost = '0'; q.wholesale = false;
  let r = calculateQuote(q, c); assert.equal(r.totalCost, '100.00'); assert.equal(r.unitPrice, '155.00'); near(r.margin, '35.48387097');
  q.strategy = 'margin'; q.target = '55'; r = calculateQuote(q, c); assert.equal(r.unitPrice, '222.23');
  q.materials[0].grams = '0.1'; q.materials[0].kgCost = '90000'; r = calculateQuote(q, c); assert.equal(r.totalCost, '9.00');
});

test('partial batch is measured or explicitly approximate, never mistaken for unit data', () => {
  const { c, q } = fresh(); q.quantity = 13; q.print.mode = 'batch'; q.print.unitsPerBatch = q.print.capacity = 10;
  q.print.minutes = '2460'; q.materials[0].grams = '500';
  let r = calculateQuote(q, c);
  assert.equal(r.production.fullBatches, 1); assert.equal(r.production.partialUnits, 3); near(r.production.machineHours, '53.3');
  assert.equal(r.production.usage[0].baseGrams, '650'); assert.ok(r.warnings.some(w => /aproximada/.test(w)));
  q.print.partialMethod = 'actual'; q.print.partialMinutes = '1000'; q.materials[0].partialGrams = '170';
  r = calculateQuote(q, c); near(r.production.machineHours, new Decimal(3460).div(60));
  assert.equal(r.production.usage[0].baseGrams, '670'); assert.ok(!r.warnings.some(w => /parcial aproximada/.test(w)));
  const rows = wholesaleTable(q, c, [14]); assert.ok(rows.find(x => x.quantity === 14).approximate);
  q.materials[0].partialGrams = ''; assert.throws(() => calculateQuote(q, c), /Gramos de tanda parcial/);
});

test('separate purge/support flags avoid double charging; inventory aggregates colors', () => {
  const { c, q } = fresh(); c.supportPercent = '20'; c.materials[0].availableGrams = '15';
  q.materials[0].includesPurge = true; q.materials[0].includesSupports = true;
  q.materials.push({ ...q.materials[0], color: 'Blanco' });
  const r = calculateQuote(q, c);
  assert.equal(r.categories.material, '1800.00'); assert.equal(r.production.inventory[0].grams, '20');
  assert.equal(r.production.inventory[0].missingGrams, '5'); assert.equal(r.production.inventory[0].spoolsToBuy, 1);
});

test('machine all-inclusive and itemized modes are mutually exclusive', () => {
  const { c, q } = fresh(); q.print.minutes = '60';
  c.printers[0].kw = '1'; c.printers[0].kwhCost = '100'; c.printers[0].depreciation = '200'; c.printers[0].maintenance = '300';
  assert.equal(calculateQuote(q, c).categories.machine, '1750.00');
  c.printers[0].mode = 'components'; assert.equal(calculateQuote(q, c).categories.machine, '600.00');
  q.printers[0].hourlyRate = '800'; assert.equal(calculateQuote(q, c).categories.machine, '800.00');
});

test('parallel machine hours differ from calendar hours and tariffs follow actual assignments', () => {
  const { c, q } = fresh(); q.quantity = 130; q.printers[0].copies = 2;
  const r = calculateQuote(q, c);
  near(r.production.machineHours, new Decimal(43).times(130).div(60));
  near(r.production.calendarHours, new Decimal(43).times(65).div(60));
  assert.equal(r.production.printers.length, 2);
  q.quantity = 2; q.printers[0].copies = 1; q.printers.push({ printerId: 'p2s', copies: 1, hourlyRate: '3000' });
  const two = calculateQuote(q, c); assert.equal(two.production.printers.length, 2);
  near(two.categories.machine, new Decimal(43).div(60).times(4750).toFixed(2));
});

test('large quantities are scheduled without enumerating every piece', () => {
  const { c, q } = fresh(); q.quantity = 10000000; q.print.minutes = '1'; q.printers[0].copies = 100;
  const start = performance.now(), r = calculateQuote(q, c);
  assert.ok(performance.now() - start < 2000); assert.equal(r.production.printers.reduce((n, p) => n + p.units, 0), q.quantity);
});

test('shared preparation, timed labor, multiple accessories and packaging scopes', () => {
  const { c, q } = fresh(); q.quantity = 20; q.print.unitsPerBatch = q.print.capacity = 10;
  q.labor = [{ name: 'Archivo', basis: 'order', method: 'fixed', amount: '5000' },
    { name: 'Armado', basis: 'unit', method: 'time', minutes: '6', rate: '10000' }];
  q.accessories.push({ name: 'Imán', basis: 'unit', quantity: '2', cost: '100', wastePercent: '5' });
  q.packaging = { basis: 'batch', cost: '500' };
  const r = calculateQuote(q, c); assert.equal(r.categories.labor, '25000.00'); assert.equal(r.categories.accessories, '22200.00');
  assert.equal(r.categories.packaging, '1000.00'); assert.equal(r.production.laborHours, '2');
  q.labor = [q.labor[0]]; const rows = wholesaleTable(q, c);
  assert.ok(Number(rows.find(r => r.quantity === 20).unitCost) < Number(rows.find(r => r.quantity === 1).unitCost));
});

test('expected retries are explicit, separate from purges and from contingency', () => {
  const { c, q } = fresh(); q.failurePercent = '10';
  const r = calculateQuote(q, c);
  near(r.production.usage[0].grams, new Decimal('11.2').div('0.9'));
  assert.ok(Number(r.categories.risk) > 0); assert.ok(r.warnings.some(w => /supuesto/.test(w)));
  assert.ok(Number(r.production.failureReserveHours) > 0);
});

test('discount floors, VAT included/excluded, fees and monetary rounding', () => {
  const { c, q } = fresh();
  q.discountPercent = '99'; const floor = calculateQuote(q, c);
  assert.ok(floor.discountLimited); assert.ok(Number(floor.margin) >= 20); assert.ok(floor.canIssue);
  c.roundTo = '1000'; assert.equal(Number(calculateQuote(q, c).unitPrice) % 1000, 0);
  q.discountPercent = '0'; q.strategy = 'manual'; q.manualPrice = '20000'; q.quantity = 3;
  c.vatPercent = '19'; c.vatMode = 'included';
  let r = calculateQuote(q, c); assert.equal(r.total, '60000.00'); assert.equal(new Decimal(r.netSales).plus(r.vat).toFixed(2), r.total);
  c.vatMode = 'excluded'; r = calculateQuote(q, c); assert.equal(r.netSales, '60000.00'); assert.equal(r.vat, '11400.00');
  c.feePercent = '2'; c.feeFixed = '100'; c.feeOnTax = true; r = calculateQuote(q, c); assert.equal(r.categories.fees, '1528.00');
  assert.ok(r.lines.some(l => l.name === 'Comisión fija por pedido' && l.basis === 'fixed' && l.amount === '100.00'));
  q.strategy = 'margin'; q.target = '30'; r = calculateQuote(q, c); assert.ok(Number(r.margin) >= 30);
  q.strategy = 'manual'; q.manualPrice = '20000.123'; r = calculateQuote(q, c); assert.equal(r.unitPrice, '20000.12'); assert.equal(r.netSales, '60000.36');
});

test('invalid inputs, overlapping tiers and impossible margins fail explicitly', () => {
  for (const quantity of [0, -1, 1.5, 'NaN', '', Infinity]) {
    const { c, q } = fresh(); q.quantity = quantity; assert.throws(() => calculateQuote(q, c));
  }
  const { c, q } = fresh(); q.target = '100'; q.strategy = 'margin'; assert.throws(() => calculateQuote(q, c), /Margen objetivo/);
  q.target = '30'; q.print.capacity = 0; assert.throws(() => calculateQuote(q, c));
  q.print.capacity = 1; c.tiers[1].from = 9; assert.throws(() => validateQuoteConfig(c), /continuas/);
  c.tiers[1].from = '10'; c.tiers[0].to = '9'; validateQuoteConfig(c);
  c.feePercent = '90'; assert.throws(() => calculateQuote(q, c), /inviable/);
});

test('optimization uses identical quantities and visible configurable scenarios', () => {
  const { c, q } = fresh(); q.quantity = 130;
  const original = structuredClone(q); original.print.minutes = '90'; original.materials[0].grams = '30';
  const r = compareQuotes(original, q, c);
  near(r.savedHours, new Decimal(47).times(130).div(60)); assert.equal(r.savedGrams, '2912');
  assert.ok(Number(r.costReductionPercent) > 0); assert.equal(scenarios(q, c).length, 4);
  assert.equal(r.original.total, r.optimized.total);
  assert.equal(r.costSaving, r.profitDifference); assert.equal(r.recommended, 'optimized');
  const independent = compareQuotes(original, q, c, { samePrice: false });
  assert.notEqual(independent.original.total, independent.optimized.total);
  original.quantity = 10; assert.throws(() => compareQuotes(original, q, c), /misma cantidad/);
});

test('impossible calendar dates and nonboolean wholesale choices are rejected', () => {
  const { c, q } = fresh(); q.customer.name = 'Cliente';
  c.effectiveAt = '2030-02-30'; assert.throws(() => validateQuoteConfig(c), /Vigencia/);
  c.effectiveAt = '2028-02-29'; validateQuoteConfig(c);
  q.date = '2030-02-30'; assert.throws(() => validateCommercial(q), /Fecha/);
  q.date = '2030-02-01'; q.validUntil = '2030-03-15'; q.deliveryDate = '2030-02-30';
  assert.throws(() => validateCommercial(q), /entrega/);
  q.deliveryDate = '2030-03-01'; validateCommercial(q);
  q.print.start = '2030-02-30T08:00'; assert.throws(() => calculateQuote(q, c), /inicio/);
  q.print.start = '2030-03-01T08:00'; q.wholesale = 'false';
  assert.throws(() => calculateQuote(q, c), /mayorista/);
});

test('commercial DTO excludes all internal fields and escapes user-provided markup', () => {
  const { c, q } = fresh(); q.customer.name = '<script>bad()</script>'; q.internalNotes = 'INTERNAL_SECRET_123';
  q.description = '<img src=x onerror=bad()>'; const result = calculateQuote(q, c);
  const dto = commercialQuote({ version: 1, input: q, result, configSnapshot: c }, 'PAB-1');
  for (const output of [JSON.stringify(dto), commercialHTML(dto), commercialText(dto)]) {
    assert.ok(!output.includes('INTERNAL_SECRET_123')); assert.ok(!output.includes('"profit"')); assert.ok(!output.includes('"configSnapshot"'));
  }
  const html = commercialHTML(dto); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x')); assert.equal(dto.delivery, 'Por confirmar con producción');
  c.brand.logo = 'https://example.com/logo.png'; assert.throws(() => validateQuoteConfig(c), /PNG\/JPEG/);
});

test('analytics counts only issued and accepted work, preserving actual comparisons', () => {
  const { c, q } = fresh(); q.customer.name = 'Cliente de prueba'; const result = calculateQuote(q, c);
  const version = { version: 1, input: q, result, configSnapshot: c };
  const records = [{ number: 'PAB-1', status: 'accepted', versions: [version], actuals: { version: 1, totalCost: '8000', machineHours: '1', grams: '12' } },
    { number: 'PAB-2', status: 'sent', versions: [version], actuals: null }, { status: 'draft', versions: [] }];
  const a = quoteAnalytics(records);
  assert.equal(a.issued, 2); assert.equal(a.accepted, 1); assert.equal(a.conversion, '50');
  assert.equal(a.sold, result.netSales); assert.equal(a.actualGrams, '12'); assert.equal(a.actuals[0].profit, '5500.00');
});

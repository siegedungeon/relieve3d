export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const formatCOP = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value));
export const formatNumber = value => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(Number(value));

// A whitelist is intentional: commercial documents must never receive the internal model.
export function commercialQuote(version, number) {
  const { input: q, result: r, configSnapshot: c } = version;
  return {
    number, version: version.version, date: q.date, validUntil: q.validUntil,
    brand: { name: c.brand.name, contact: c.brand.contact, taxId: c.brand.taxId, address: c.brand.address, logo: c.brand.logo },
    customer: { name: q.customer.name, contact: q.customer.contact, taxId: q.customer.taxId, address: q.customer.address },
    product: q.product, description: q.description, quantity: r.quantity, unitPrice: r.unitPrice,
    includesVat: c.vatMode === 'included', vatPercent: c.vatPercent,
    subtotal: r.netSales, vat: r.vat, total: r.total, discount: r.discountAmount, deposit: r.deposit,
    delivery: q.deliveryDate || 'Por confirmar con producción', estimatedDelivery: !q.deliveryDate,
    notes: q.commercialNotes, terms: q.terms,
  };
}

export function commercialText(d) {
  return [
    d.brand.name, `Cotización ${d.number} · versión ${d.version}`, `Cliente: ${d.customer.name}`,
    `${d.product}${d.description ? `\n${d.description}` : ''}`, `Cantidad: ${d.quantity}`,
    `Precio unitario ${d.includesVat ? '(IVA incluido)' : '(antes de IVA)'}: ${formatCOP(d.unitPrice)}`,
    `Subtotal antes de IVA: ${formatCOP(d.subtotal)}`,
    ...(Number(d.discount) > 0 ? [`Descuento incluido: ${formatCOP(d.discount)}`] : []),
    `IVA (${d.vatPercent}%): ${formatCOP(d.vat)}`, `TOTAL: ${formatCOP(d.total)}`,
    `Anticipo: ${formatCOP(d.deposit)}`, `${d.estimatedDelivery ? 'Entrega estimada' : 'Entrega'}: ${d.delivery}`,
    `Válida hasta: ${d.validUntil}`, d.terms, d.notes, d.brand.contact,
  ].filter(Boolean).join('\n');
}

export function commercialHTML(d, compact = false) {
  const e = escapeHTML, cash = value => e(formatCOP(value));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
    <title>${e(d.number)} · ${e(d.brand.name)}</title><style>
    @page{size:A4;margin:15mm}*{box-sizing:border-box}body{margin:0;color:#252333;background:#fff;font:16px Arial,sans-serif}
    article{padding:38px;max-width:${compact ? '1080' : '900'}px;margin:auto}header{display:flex;justify-content:space-between;gap:25px;border-bottom:4px solid #a61b5c;padding-bottom:24px}
    h1{font-size:32px;margin:0 0 8px;color:#8b164d}h2{font-size:20px;margin:28px 0 10px}p{line-height:1.6;margin:6px 0;white-space:pre-wrap}
    .muted{color:#615c6c;font-size:14px}.tag{color:#8b164d;background:#fceaf2;padding:8px 12px;border-radius:8px;display:inline-block}
    .logo{max-width:150px;max-height:90px;object-fit:contain;margin-bottom:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}
    table{border-collapse:collapse;width:100%;margin:22px 0}th,td{padding:15px 10px;border-bottom:1px solid #ddd;text-align:left}
    th{background:#f8edf3;font-size:13px}td:last-child,th:last-child{text-align:right}.summary{max-width:420px;margin-left:auto}
    .summary p{display:flex;justify-content:space-between;gap:24px}.total{background:#8b164d;color:white;padding:20px;border-radius:12px;font-size:25px;font-weight:bold}
    .conditions{background:#f6f5f9;padding:20px;border-radius:12px;margin-top:25px}.foot{border-top:1px solid #ddd;margin-top:28px;padding-top:15px}
    tr,.summary,.conditions{break-inside:avoid}thead{display:table-header-group}@media print{article{padding:0;max-width:none}}
    ${compact ? 'article{font-size:21px;padding:48px}h1{font-size:40px}.total{font-size:34px}.muted{font-size:17px}' : ''}
    </style></head><body><article>
    <header><div>${d.brand.logo ? `<img class="logo" src="${e(d.brand.logo)}" alt="Logo">` : ''}<h1>${e(d.brand.name)}</h1>
    <p class="muted">${e(d.brand.contact)}${d.brand.taxId ? `\nNIT / identificación: ${e(d.brand.taxId)}` : ''}${d.brand.address ? `\n${e(d.brand.address)}` : ''}</p></div>
    <div><span class="tag">COTIZACIÓN</span><p><strong>${e(d.number)}</strong></p><p class="muted">Versión ${e(d.version)}<br>${e(d.date)}</p></div></header>
    <div class="grid"><section><h2>Preparada para</h2><p><strong>${e(d.customer.name)}</strong></p>${compact ? '' : `<p class="muted">${e(d.customer.contact)}\n${e(d.customer.taxId)}\n${e(d.customer.address)}</p>`}</section>
    <section><h2>${d.estimatedDelivery ? 'Entrega estimada' : 'Entrega'}</h2><p>${e(d.delivery)}</p><p class="muted">Vigencia: ${e(d.validUntil)}</p></section></div>
    <h2>${e(d.product)}</h2><p>${e(d.description)}</p>
    <table><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unitario ${d.includesVat ? '(IVA incluido)' : '(sin IVA)'}</th></tr></thead>
    <tbody><tr><td>${e(d.product)}</td><td>${e(d.quantity)}</td><td>${cash(d.unitPrice)}</td></tr></tbody></table>
    <div class="summary"><p><span>Subtotal sin IVA</span><strong>${cash(d.subtotal)}</strong></p>
    ${Number(d.discount) > 0 ? `<p class="muted"><span>Descuento ya incluido</span><span>${cash(d.discount)}</span></p>` : ''}
    <p><span>IVA (${e(d.vatPercent)}%)</span><strong>${cash(d.vat)}</strong></p>
    <p class="total"><span>Total COP</span><span>${cash(d.total)}</span></p><p><span>Anticipo</span><strong>${cash(d.deposit)}</strong></p></div>
    <div class="conditions"><strong>Condiciones comerciales</strong><p>${e(d.terms)}</p>${d.notes ? `<p>${e(d.notes)}</p>` : ''}</div>
    <p class="foot muted">Gracias por elegir ${e(d.brand.name)}. Esta cotización no es una factura.</p>
    </article></body></html>`;
}

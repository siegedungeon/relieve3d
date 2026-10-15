// A continuous translational sweep opens the hidden recess; checking a few poses misses undercuts.
import { dropSpecks, solidPieces } from './solidparts.js';

export function fitSculptParts({ w, parts, keep, progress, warnings }) {
  const { Manifold } = w, owned = new Set();
  const own = m => { owned.add(m); return m; };
  const release = m => { if (owned.delete(m)) m.delete(); };
  // Use the exported float coordinates, without inherited CSG face groups that prevent simplification.
  const snapshot = man => {
    const g = man.getMesh(), mesh = new w.Mesh({ numProp: g.numProp, vertProperties: g.vertProperties, triVerts: g.triVerts });
    mesh.merge();
    return own(new Manifold(mesh));
  };
  // Microscopic boolean edges can collapse in STL's float32 bed coordinates; limit cleanup to 0.005 mm.
  const clean = man => {
    const before = new Set(owned);
    const simple = own(snapshot(man).simplify(0.005));
    const out = dropSpecks(w, own(new Manifold(simple.getMesh())), own, 1e-5);
    for (const m of owned) if (!before.has(m) && m !== out) release(m);
    return out;
  };
  const bodies = parts.filter(p => p.kind === 'body'), covers = parts.filter(p => p.kind !== 'body').map(p => ({ ...p }));
  if (!bodies.length) throw new Error('Esculpido: falta el cuerpo para comprobar el montaje');
  const topology = m => {
    const components = m.decompose();
    try { return JSON.stringify(components.map(c => [Math.sign(c.volume()), c.genus()]).sort()); }
    finally { components.forEach(c => c.delete()); }
  };
  const pad = 0.04, tolerance = 0.015;
  const before = covers.map(() => new Set());
  const unit = n => {
    const l = Math.hypot(...n);
    if (!Number.isFinite(l) || l < 1e-8) throw new Error('Esculpido: una pieza no tiene dirección de montaje');
    return n.map(x => x / l);
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const volumeAt = (man, other, n, d) => {
    const moved = man.translate(n.map(x => x * d));
    let hit;
    try { hit = moved.intersect(other); return Math.max(0, hit.volume()); }
    finally { hit?.delete(); moved.delete(); }
  };
  try {
    let body = own(Manifold.union(bodies.map(p => p.man)));
    const initialVolume = body.volume(), initialTopology = topology(body);
    const bounds = parts.map(p => p.man.boundingBox());
    const length = 2 * Math.hypot(...[0, 1, 2].map(a => Math.max(...bounds.map(b => b.max[a])) - Math.min(...bounds.map(b => b.min[a]))));
    for (const p of covers) p.man = clean(p.man);
    for (let i = 0; i < covers.length; i++) {
      progress(`Esculpido: montaje ${i + 1}/${covers.length}`, 0.85 + 0.1 * i / covers.length);
      const p = covers[i], normal = unit(p.up), a = normal.reduce((best, x, j) => Math.abs(x) > Math.abs(normal[best]) ? j : best, 0);
      const axis = [0, 0, 0]; axis[a] = Math.sign(normal[a]);
      const candidates = [normal];
      if (Math.abs(normal[a]) < 0.99999) candidates.push(axis);
      let n = normal, best = Infinity;
      for (const candidate of candidates) {
        let score = 0;
        for (const d of [0.1, 0.5, 1, 3, 10]) score += volumeAt(p.man, body, candidate, d);
        if (score < best) { best = score; n = candidate; }
      }
      const u = unit(cross(Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], n)), v = cross(n, u);
      const matrix = [...u, 0, ...v, 0, ...n, 0, 0, 0, 0, 1];
      const simple = own(p.man.simplify(tolerance));
      progress(`Esculpido: rebaje ${i + 1}/${covers.length}`, 0.85 + 0.1 * (i + 0.2) / covers.length);
      const box = own(Manifold.cube([2 * pad, 2 * pad, length + 2 * pad]));
      const shifted = own(box.translate([-pad, -pad, -pad])), rod = own(shifted.transform(matrix));
      const sweep = own(simple.minkowskiSum(rod));
      const cut = own(body.subtract(sweep));
      if (cut.status() !== 'NoError') throw new Error('Esculpido: el rebaje de montaje no es un sólido válido');
      release(body); body = cut;
      // The inflated sweep starts slightly behind the seat. Check the final approach separately with the exact part.
      const ahead = own(sweep.translate(n.map(x => x * (2 * pad + tolerance))));
      for (let j = 0; j < covers.length; j++) if (i !== j) {
        const hit = own(ahead.intersect(covers[j].man));
        let blocked = Math.max(0, hit.volume());
        release(hit);
        for (const d of [0, 0.025, 0.05, 0.095]) blocked = Math.max(blocked, volumeAt(p.man, covers[j].man, n, d));
        if (blocked > 0.001) before[j].add(i);
      }
      p.up = n;
      for (const m of [simple, box, shifted, rod, sweep, ahead]) release(m);
    }
    const checked = clean(body), removed = Math.max(0, initialVolume - checked.volume());
    if (removed > Math.min(100, 0.005 * initialVolume)) throw new Error('Esculpido: liberar las piezas alteraría demasiado el cuerpo; no se permite exportarlo');
    if (topology(checked) !== initialTopology) throw new Error('Esculpido: el montaje creó agujeros o fragmentos en la base; no se permite exportarlo');
    const ordered = [], pending = new Set(covers.map((_, i) => i));
    while (pending.size) {
      const next = [...pending].find(i => [...before[i]].every(j => !pending.has(j)));
      if (next === undefined) throw new Error(`Esculpido: las piezas se bloquean entre sí; no hay un orden de montaje seguro (${[...pending].map(i => `${i + 1}: ${[...before[i]].map(j => j + 1).join(',')}`).join('; ')})`);
      pending.delete(next); ordered.push(covers[next]);
    }
    const components = solidPieces(w, checked, own, 0);
    if (components.length !== bodies.length) throw new Error('Esculpido: el rebaje dejó componentes sueltos o cavidades nuevas');
    const out = components.map(({ man }, i) => ({ ...bodies[i], man, assemblyStep: 0 }));
    ordered.forEach((p, i) => { p.assemblyStep = i + 1; out.push(p); });
    for (const p of out) if (owned.delete(p.man)) keep(p.man);
    warnings.push(`Montaje por traslación: ${removed.toFixed(2)} mm³ de rebajes para montaje; colocar las piezas en el orden indicado`);
    return out;
  } finally {
    for (const m of owned) m.delete();
  }
}

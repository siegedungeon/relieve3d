import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import opentype from 'opentype.js';
import { phoneStandShared } from '../src/core/phonestand.js';
import { read3MF } from '../src/core/threemf_read.js';
import {
  CAN_OPENER_SHAPES, prepareCanOpener, canOpenerSolids, buildCanOpener, exportCanOpener,
  canOpenerProject, readCanOpenerProject,
} from '../src/core/canopener.js';

const { Manifold } = await prepareCanOpener();
const png = PNG.sync.read(fs.readFileSync(new URL('./logo.png', import.meta.url)));
const logoImage = { data: png.data, width: png.width, height: png.height };
const overlap = (a, b) => { const i = a.intersect(b); const volume = i.volume(); i.delete(); return volume; };

function slotBox(op, [x0, x1], [y0, y1], [z0, z1]) {
  const a = Manifold.cube([x1 - x0, y1 - y0, z1 - z0]), b = a.translate([x0, y0, z0]), c = b.rotate([0, 0, op.angle]);
  a.delete(); b.delete();
  if (op.sg > 0) return c;
  const d = c.mirror([1, 0, 0]); c.delete(); return d;
}

function checkSolidAndSlot(s) {
  const components = s.body.decompose();
  try {
    assert.equal(s.body.status(), 'NoError');
    assert.equal(components.filter((c) => c.volume() > 1e-6).length, 1, 'the opener must be one connected solid');
    assert.ok(s.body.volume() > 0);
    const op = s.info.opener;
    assert.ok(op, 'the functional opening cannot silently disappear');
    const slit = slotBox(op, [op.xin + 4, op.edge + 9], [op.ys + 4, op.ys + op.len - 4], [2.2, Math.min(3.2, op.slot.top - 0.1)]);
    const lip = op.slot.notchDepth && op.notch
      ? slotBox(op, [op.edge - 3, op.edge - 0.3], [op.ys + 2, op.ys + 4], [0.1, 0.9])
      : slotBox(op, [op.edge - 3, op.edge - 0.3], [op.ys + 4, op.ys + op.len - 4], [0.1, 0.9]);
    try {
      assert.ok(overlap(s.body, slit) < 1e-3, 'the slot must open all the way to the edge');
      assert.ok(overlap(s.body, lip) > lip.volume() * 0.98, 'the lip under the slot must be solid');
    } finally { slit.delete(); lip.delete(); }
  } finally { components.forEach((c) => c.delete()); }
}

test('every advertised shape is one solid with a usable open slot', () => {
  for (const shape of CAN_OPENER_SHAPES.filter((s) => s.id !== 'custom')) {
    const s = canOpenerSolids({ shape: shape.id });
    try { checkSolidAndSlot(s); } finally { s.dispose(); }
  }
});

test('keyring variants have open holes, safe walls and a separate connector when requested', () => {
  for (const [mount, kind] of [
    ['integrated', 'round'], ['integrated', 'double-horizontal'], ['integrated', 'double-vertical'],
    ['external', 'slot'], ['external', 'lateral'], ['separate', 'round'], ['separate', 'slot'],
  ]) {
    const s = canOpenerSolids({ attachment: { mount, kind, wall: 2.5 } });
    try {
      checkSolidAndSlot(s);
      assert.ok(s.info.attachment.wall >= 2.5);
      for (const hole of s.info.attachment.bodyHoles) {
        const c = Manifold.cylinder(s.cfg.thickness + 2, hole.diameter / 2 - 0.2, hole.diameter / 2 - 0.2, 48);
        const probe = c.translate([hole.x, hole.y, -1]); c.delete();
        try { assert.ok(overlap(s.body, probe) < 1e-3, `${mount}/${kind}: the hole goes through the body`); }
        finally { probe.delete(); }
      }
      if (mount === 'separate') {
        assert.ok(s.connector, 'a printable connector is generated as a separate object');
        const pieces = s.connector.decompose();
        try {
          assert.equal(pieces.length, 1);
          assert.equal(s.connector.status(), 'NoError');
          assert.ok(s.connector.minGap(s.body, 6) >= 4, 'separate pieces must not fuse on the plate');
          for (const hole of s.info.attachment.connectorHoles) {
            const c = Manifold.cylinder(s.cfg.thickness + 2, hole.diameter / 2 - 0.2, hole.diameter / 2 - 0.2, 48);
            const probe = c.translate([hole.x, hole.y, -1]); c.delete();
            try { assert.ok(overlap(s.connector, probe) < 1e-3, `${mount}/${kind}: the connector hole is open`); }
            finally { probe.delete(); }
          }
        } finally { pieces.forEach((p) => p.delete()); }
      }
    } finally { s.dispose(); }
  }
  assert.throws(() => canOpenerSolids({ thickness: 6, attachment: { kind: 'lateral', diameter: 6 } }), /lateral|grosor/i);
});

test('the external ring eyelet has a through hole and a thin outer rim', () => {
  const s = canOpenerSolids({ attachment: { mount: 'external', kind: 'round' } });
  try {
    const { x, y, diameter } = s.info.attachment.bodyHoles[0];
    const rimY = y + diameter / 2 + 1;
    const c = Manifold.cylinder(1, 0.3, 0.3, 32);
    const lower = c.translate([x, rimY, 1]);
    const upper = c.translate([x, rimY, 4]);
    try {
      assert.ok(overlap(s.body, lower) > 0.1, 'the eyelet has material around the hole');
      assert.ok(overlap(s.body, upper) < 1e-3, 'the outer rim is 3.5 mm thick');
    } finally { c.delete(); lower.delete(); upper.delete(); }
  } finally { s.dispose(); }
});

test('the cord loop has two separate entrances joined by an open internal channel', () => {
  for (const mount of ['external', 'integrated', 'separate']) {
    const s = canOpenerSolids({ attachment: { mount, kind: 'cord-loop', diameter: 3.2, wall: 2.5 } });
    try {
      const holes = mount === 'separate' ? s.info.attachment.connectorHoles.slice(1) : s.info.attachment.bodyHoles;
      const solid = mount === 'separate' ? s.connector : s.body;
      assert.equal(holes.length, 2);
      const [a, b] = holes;
      const cylinder = Manifold.cylinder(b.x - a.x, 1.4, 1.4, 48);
      const rotated = cylinder.rotate([0, 90, 0]);
      const probe = rotated.translate([a.x, a.y, s.cfg.thickness / 2]);
      try { assert.ok(overlap(solid, probe) < 1e-3, mount + ': channel joins both holes'); }
      finally { cylinder.delete(); rotated.delete(); probe.delete(); }
      const wall = Manifold.cylinder(1, 0.2, 0.2, 32);
      const top = wall.translate([(a.x + b.x) / 2, a.y, s.cfg.thickness - 1]);
      try { assert.ok(overlap(solid, top) > 0.05, mount + ': material remains above the channel'); }
      finally { wall.delete(); top.delete(); }
    } finally { s.dispose(); }
  }
});

test('edge loop joins two edge openings without cutting through the faces', () => {
  for (const position of ['center', 'left', 'right', 'side-left', 'side-right']) {
    const s = canOpenerSolids({ shape: 'circle', attachment: { kind: 'edge-loop', mount: 'integrated', diameter: 3, wall: 2, position } });
    try {
      const { angle, center, tops } = s.info.attachment.edgeData;
      const dx = (s.cfg.attachment.diameter + s.cfg.attachment.wall) / 2;
      for (const [i, offset] of [-dx, dx].entries()) {
        const c = Manifold.cylinder(tops[i] - center[1] + 1, 1.3, 1.3, 48);
        const r = c.rotate([-90, 0, 0]);
        const t = r.translate([center[0] + offset, center[1], s.cfg.thickness / 2]);
        const probe = t.rotate([0, 0, -angle]);
        try { assert.ok(overlap(s.body, probe) < 1e-3, position + ': open edge entrance'); }
        finally { c.delete(); r.delete(); t.delete(); probe.delete(); }
      }
      const c = Manifold.cylinder(2 * dx, 1.3, 1.3, 48);
      const r = c.rotate([0, 90, 0]);
      const t = r.translate([center[0] - dx, center[1], s.cfg.thickness / 2]);
      const probe = t.rotate([0, 0, -angle]);
      try { assert.ok(overlap(s.body, probe) < 1e-3, position + ': entrances connect'); }
      finally { c.delete(); r.delete(); t.delete(); probe.delete(); }
      const face = Manifold.cylinder(1, 0.2, 0.2, 32);
      const p = face.translate([center[0], center[1], s.cfg.thickness - 1]);
      const top = p.rotate([0, 0, -angle]);
      try { assert.ok(overlap(s.body, top) > 0.05, position + ': top face remains closed'); }
      finally { face.delete(); p.delete(); top.delete(); }
    } finally { s.dispose(); }
  }
});

test('raised border recesses the heart face and supports artwork', () => {
  const plain = canOpenerSolids({ shape: 'heart' });
  const bordered = canOpenerSolids({ shape: 'heart', border: { enabled: true, width: 3, depth: 1.2 } });
  try {
    checkSolidAndSlot(bordered);
    assert.equal(bordered.info.border.surfaceZ, 6.8);
    assert.ok(bordered.body.volume() < plain.body.volume() - 100);
    const c = Manifold.cylinder(1, 0.5, 0.5, 32);
    const probe = c.translate([0, 15, 7]);
    try { assert.ok(overlap(bordered.body, probe) < 1e-3, 'the interior is recessed'); }
    finally { c.delete(); probe.delete(); }
  } finally { plain.dispose(); bordered.dispose(); }
  for (const mode of ['relief', 'flat', 'engrave']) {
    const s = canOpenerSolids({ border: { enabled: true }, logo: { mode, colors: 2 } }, { logoImage });
    try {
      assert.ok(s.info.logo?.length);
      if (mode === 'relief') for (const art of s.artPieces) {
        assert.ok(Math.abs(art.solid.boundingBox().min[2] - 6.8) < 0.01, 'art rests on recessed face');
      }
    } finally { s.dispose(); }
  }
  assert.throws(() => canOpenerSolids({ border: { enabled: true }, thickness: 6, logo: { mode: 'engrave', depth: 1 } }), /techo/i);
  assert.throws(() => canOpenerSolids({ border: { enabled: true }, attachment: { kind: 'edge-loop', diameter: 6 } }), /grosor|paso/i);
  const edge = canOpenerSolids({ border: { enabled: true }, attachment: { kind: 'edge-loop', diameter: 3 } });
  try { checkSolidAndSlot(edge); } finally { edge.dispose(); }
  const loaded = readCanOpenerProject(canOpenerProject({ border: { enabled: true, width: 2, depth: 1 } }));
  assert.deepEqual(loaded.cfg.border, { enabled: true, width: 2, depth: 1 });
});

test('external ring and ribbon are joined, open and follow the chosen side', () => {
  for (const kind of ['round', 'slot']) {
    const cfg = { shape: 'circle', attachment: { mount: 'external', kind, diameter: 4, wall: 2, slotWidth: 10 } };
    const top = canOpenerSolids({ ...cfg, attachment: { ...cfg.attachment, target: { x: 0, y: 70 } } });
    const side = canOpenerSolids({ ...cfg, attachment: { ...cfg.attachment, target: { x: -70, y: 24 } } });
    try {
      checkSolidAndSlot(top);
      checkSolidAndSlot(side);
      assert.ok(top.info.attachment.position[1] > 49, kind + ': top hole is outside the figure');
      assert.ok(side.info.attachment.position[0] < -24.5, kind + ': side hole is outside the figure');
      assert.ok(Math.hypot(top.info.attachment.position[0] - side.info.attachment.position[0],
        top.info.attachment.position[1] - side.info.attachment.position[1]) > 10);
      for (const hole of side.info.attachment.bodyHoles) {
        const c = Manifold.cylinder(side.cfg.thickness + 2, hole.diameter / 2 - 0.2, hole.diameter / 2 - 0.2, 48);
        const probe = c.translate([hole.x, hole.y, -1]); c.delete();
        try { assert.ok(overlap(side.body, probe) < 1e-3, kind + ': the opening is free'); }
        finally { probe.delete(); }
      }
    } finally { top.dispose(); side.dispose(); }
  }
});

test('the nail polish colour outline leaves a body-coloured outer margin', () => {
  const sol = canOpenerSolids({ shape: 'nailpolish-reference', width: 28,
    polish: { outline: true, width: 1.2 }, text: { enabled: false } });
  try {
    const y = 15, edge = phoneStandShared.maxAt(sol.outline.toPolygons(), 1, y);
    const sample = (x) => {
      const cylinder = Manifold.cylinder(0.4, 0.12, 0.12, 32);
      const probe = cylinder.translate([x, y, 7.5]); cylinder.delete();
      return probe;
    };
    const margin = sample(edge - 0.35), stripeBase = sample(edge - 1.6);
    const stripe = stripeBase.translate([0, 0, 0.8]); stripeBase.delete();
    try {
      assert.ok(overlap(sol.body, margin) > 0.01, 'outer margin keeps the body colour');
      assert.ok(sol.polishPieces.every((part) => overlap(part.solid, margin) < 1e-4), 'outline does not reach edge');
      assert.ok(sol.polishPieces.some((part) => overlap(part.solid, stripe) > 0.01), 'coloured stripe is inset');
    } finally { margin.delete(); stripe.delete(); }
  } finally { sol.dispose(); }
});

test('reference nail polish dimensions match the measured source', () => {
  const sol = canOpenerSolids({ shape: 'nailpolish-reference', width: 28, thickness: 4, notch: true,
    openerTarget: { x: 0, y: 0 }, attachment: { kind: 'round', diameter: 4, target: { x: 0, y: 51 } } });
  try {
    checkSolidAndSlot(sol);
    assert.ok(Math.abs(sol.info.size.w - 28) < 0.02);
    assert.ok(Math.abs(sol.info.size.l - 56) < 0.02);
    assert.equal(sol.info.size.h, 4);
    assert.equal(sol.info.size.totalHeight, 5);
    assert.equal(sol.info.opener.len, 20);
    assert.equal(sol.info.opener.depth, 21);
    assert.equal(sol.info.attachment.bodyHoles[0].diameter, 4);
    const ridge = sol.polishPieces[0].solid.boundingBox();
    assert.equal(ridge.min[2], 4);
    assert.equal(ridge.max[2], 5);
    assert.ok(Math.abs(sol.info.volume * 1000 - 3959.5173) / 3959.5173 < 0.01,
      'volume stays within 1% of the supplied model before text');
  } finally { sol.dispose(); }
});

test('reference nail polish has optional colour outline, multiline text and keyring options', () => {
  const bytes = fs.readFileSync(new URL('../src/fonts/Montserrat-Black.ttf', import.meta.url));
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const cfg = { shape: 'nailpolish-reference', width: 28, polish: { outline: true, color: '#ffffff' },
    text: { enabled: true, value: 'ANA\nPABON' }, colors: { body: '#ecb3c3', accent: '#ffffff', twoColor: true } };
  for (const attachment of [{ mount: 'integrated', kind: 'round' }, { mount: 'integrated', kind: 'edge-loop' },
    { mount: 'external', kind: 'round' }, { mount: 'external', kind: 'slot' }]) {
    const sol = canOpenerSolids({ ...cfg, attachment }, { font });
    try {
      checkSolidAndSlot(sol);
      assert.ok(sol.polishPieces.length > 0, 'colour outline exists');
      assert.ok(sol.artPieces.some((p) => p.kind === 'text'), 'multiline text exists');
      assert.ok(sol.info.size.l > 55 && sol.info.size.l < 70);
      for (const part of sol.polishPieces) assert.ok(overlap(sol.body, part.solid) < 0.001, 'colour inlay does not overlap body');
    } finally { sol.dispose(); }
  }
  const thinEdge = canOpenerSolids({ ...cfg, thickness: 4, attachment: { kind: 'edge-loop', diameter: 2 },
    logo: { mode: 'relief' } }, { font });
  try {
    checkSolidAndSlot(thinEdge);
    assert.equal(thinEdge.info.attachment.kind, 'edge-loop');
  } finally { thinEdge.dispose(); }
  const thinFlat = canOpenerSolids({ ...cfg, thickness: 4, logo: { mode: 'flat' } }, { font });
  try {
    checkSolidAndSlot(thinFlat);
    assert.ok(thinFlat.info.opener.slot.top <= 2.81, 'space remains over the opening with flat artwork');
  } finally { thinFlat.dispose(); }
  const threeLines = canOpenerSolids({ ...cfg, text: { enabled: true, value: 'YOUR\nTEXT\nHERE' } }, { font });
  try { assert.ok(threeLines.artPieces.some((p) => p.kind === 'text'), 'three-line text is printable'); }
  finally { threeLines.dispose(); }
  const plain = buildCanOpener({ ...cfg, polish: { outline: false } }, { font });
  const colored = buildCanOpener(cfg, { font });
  try {
    assert.ok(!plain.parts.some((p) => p.name === 'Borde de esmalte'));
    assert.ok(colored.parts.some((p) => p.name === 'Borde de esmalte' && p.color === '#ffffff'));
    assert.ok(colored.parts.some((p) => p.name === 'Texto'));
    const model = read3MF(exportCanOpener(colored));
    assert.ok(model.parts.some((p) => /Borde de esmalte/.test(p.name)));
    assert.ok(model.parts.some((p) => /Texto/.test(p.name)));
  } finally { [...plain.parts, ...colored.parts].forEach((p) => p.geometry.dispose()); }
  const saved = readCanOpenerProject(canOpenerProject(cfg));
  assert.equal(saved.cfg.text.value, 'ANA\nPABON');
  assert.equal(saved.cfg.polish.outline, true);
});

test('the perpendicular opening reaches the outside and left-hand narrow shapes gain a functional lip', () => {
  const s = canOpenerSolids({ shape: 'heart', attachment: { mount: 'integrated', kind: 'lateral', diameter: 4 } });
  try {
    const [x, y] = s.info.attachment.position;
    const end = s.outline.bounds().max[1] + 2;
    const c = Manifold.cylinder(end - y, 1.8, 1.8, 48), r = c.rotate([-90, 0, 0]), probe = r.translate([x, y, s.cfg.thickness / 2]);
    c.delete(); r.delete();
    try { assert.ok(overlap(s.body, probe) < 1e-3, 'the side hole joins the vertical hole to the outside'); }
    finally { probe.delete(); }
  } finally { s.dispose(); }
  for (const shape of ['star', 'crown']) {
    const a = canOpenerSolids({ shape, side: 'left', attachment: { position: 'left', kind: 'double-horizontal' } });
    try {
      checkSolidAndSlot(a);
      assert.ok(a.warnings.some((w) => /borde lateral/i.test(w)), `${shape}: the extra functional edge is disclosed`);
    } finally { a.dispose(); }
  }
});

test('logos use the same multicolour, flat and engraved pipeline and export the separate connector', () => {
  for (const mode of ['relief', 'flat', 'engrave']) {
    const result = buildCanOpener({ logo: { mode, colors: 2 }, attachment: { mount: 'separate' } }, { logoImage });
    try {
      assert.ok(result.info.logo?.length >= 1);
      assert.equal(result.info.art.mode, mode);
      assert.equal(result.parts.some((p) => p.art), mode !== 'engrave');
      const file = exportCanOpener(result);
      const model = read3MF(file);
      assert.equal(model.instances.length, 2, 'the connector is its own printable object');
      assert.ok(model.parts.some((p) => /Conector/i.test(p.name)));
      for (const p of model.parts) for (let i = 0; i < p.V.length; i += 3) {
        assert.ok(p.V[i] >= 0 && p.V[i] <= 256 && p.V[i + 1] >= 0 && p.V[i + 1] <= 256);
      }
    } finally { result.parts.forEach((p) => p.geometry.dispose()); }
  }
});

test('rejects invalid custom silhouettes and unsafe measurements instead of exporting a misleading part', () => {
  assert.throws(() => canOpenerSolids({ attachment: { kind: 'edge-loop', diameter: 4 }, logo: { mode: 'engrave', depth: 1.5 } }), /grosor|paso/i);
  assert.throws(() => canOpenerSolids({ shape: 'custom' }), /imagen|silueta/i);
  assert.throws(() => canOpenerSolids({ width: 30 }), /ancho/i);
  assert.throws(() => canOpenerSolids({ thickness: 6, logo: { mode: 'engrave', depth: 2 } }), /techo|grosor/i);
  assert.throws(() => canOpenerSolids({ attachment: { kind: 'slot', diameter: 9, slotWidth: 6 } }), /ranura/i);
});

test('projects preserve custom settings and embedded logo without accepting other project types', () => {
  const text = canOpenerProject({ shape: 'flower', width: 60, attachment: { mount: 'external', kind: 'slot', diameter: 3, slotWidth: 9 } }, { logoSrc: 'data:image/png;base64,AAAA' });
  const p = readCanOpenerProject(text);
  assert.equal(p.cfg.shape, 'flower');
  assert.equal(p.cfg.width, 60);
  assert.equal(p.cfg.attachment.kind, 'slot');
  assert.equal(p.logoSrc, 'data:image/png;base64,AAAA');
  assert.throws(() => readCanOpenerProject('{"app":"other","cfg":{}}'), /proyecto/i);
});

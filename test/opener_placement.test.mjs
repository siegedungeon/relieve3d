import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import opentype from 'opentype.js';
import { prepareCanOpener, canOpenerSolids, canOpenerProject, readCanOpenerProject } from '../src/core/canopener.js';
import { preparePhoneStand, phoneStandSolids, phoneStandProject, readPhoneStandProject } from '../src/core/phonestand.js';

await prepareCanOpener();
await preparePhoneStand();

test('the notch removes material from the opener in both modules', () => {
  for (const make of [
    (notch) => canOpenerSolids({ notch }),
    (notch) => phoneStandSolids({ opener: { enabled: true, notch } }),
  ]) {
    const plain = make(false), notched = make(true);
    try {
      assert.ok(plain.info.opener && notched.info.opener);
      assert.ok(plain.body.volume() - notched.body.volume() > 1, 'notch removes material');
      assert.equal(notched.body.status(), 'NoError');
      const pieces = notched.body.decompose();
      try { assert.equal(pieces.length, 1); } finally { pieces.forEach((p) => p.delete()); }
    } finally { plain.dispose(); notched.dispose(); }
  }
});

test('dragged positions are preserved in opener projects and affect the model', () => {
  const initial = canOpenerSolids({});
  const config = { openerTarget: { x: 20, y: 15 }, attachment: { target: { x: -10, y: 25 } } };
  const moved = canOpenerSolids(config);
  try {
    assert.ok(Math.hypot(moved.info.attachment.position[0] - initial.info.attachment.position[0],
      moved.info.attachment.position[1] - initial.info.attachment.position[1]) > 1);
    const project = readCanOpenerProject(canOpenerProject(config));
    assert.deepEqual(project.cfg.openerTarget, config.openerTarget);
    assert.deepEqual(project.cfg.attachment.target, config.attachment.target);
  } finally { initial.dispose(); moved.dispose(); }
});

test('phone stand project preserves the dragged targets and notch setting', () => {
  const cfg = { opener: { enabled: true, notch: true, target: { x: 18, y: 44 } },
    ring: { target: { x: -4, y: 52 } } };
  const project = readPhoneStandProject(phoneStandProject(cfg));
  assert.deepEqual(project.cfg.opener.target, cfg.opener.target);
  assert.deepEqual(project.cfg.ring.target, cfg.ring.target);
  assert.equal(project.cfg.opener.notch, true);
});

test('phone stand retains single-line text and supports multiline text', () => {
  const bytes = fs.readFileSync(new URL('../src/fonts/Montserrat-Black.ttf', import.meta.url));
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  for (const value of ['Pabonitas', 'ANA\nPABON']) {
    const stand = phoneStandSolids({ text: { enabled: true, value, where: 'top' } }, { font });
    try { assert.ok(stand.artPieces.some((p) => p.kind === 'text'), value + ' produces text'); }
    finally { stand.dispose(); }
  }
});

test('the nail polish opener can move from the side to the bottom edge', () => {
  const point = (op) => {
    const a = op.angle * Math.PI / 180, x = op.xin + op.depth, y = op.ys + op.len / 2;
    return { x: op.sg * (x * Math.cos(a) - y * Math.sin(a)), y: x * Math.sin(a) + y * Math.cos(a) };
  };
  const base = { shape: 'nailpolish-reference', width: 28 };
  const bottom = canOpenerSolids({ ...base, openerTarget: { x: 0, y: 0 } });
  const side = canOpenerSolids({ ...base, openerTarget: { x: 20, y: 14 } });
  try {
    const b = point(bottom.info.opener), s = point(side.info.opener);
    assert.ok(Math.abs(b.x) < 2 && b.y < 2, 'opening is on the bottom');
    assert.ok(s.x > 10 && s.y > 5, 'opening also moves to the side');
    assert.equal(bottom.body.status(), 'NoError');
    assert.equal(side.body.status(), 'NoError');
  } finally { bottom.dispose(); side.dispose(); }
});

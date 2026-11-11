import test from 'node:test';
import assert from 'node:assert/strict';
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

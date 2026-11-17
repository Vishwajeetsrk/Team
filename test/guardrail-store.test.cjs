'use strict';

/** #716: GuardrailStore durability — backup on save, atomic, defensive load. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const store = loadTs('src/main/guardrailStore.ts');

function home() { return fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-test-')); }

test('missing file reads as OFF with no rules', () => {
  const h = home();
  assert.deepEqual(store.loadGuardrail(h), { enabled: false, rules: [] });
  fs.rmSync(h, { recursive: true, force: true });
});

test('enable seeds three starter rules and turns it on', () => {
  const h = home();
  const cfg = store.enableGuardrail(h);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.rules.length, 3);
  assert.ok(cfg.rules.some((r) => r.backstop === 'block'));
  assert.deepEqual(store.loadGuardrail(h), cfg);
  fs.rmSync(h, { recursive: true, force: true });
});

test('save keeps a backup of the previous file', () => {
  const h = home();
  store.enableGuardrail(h);
  const first = fs.readFileSync(store.guardrailPath(h), 'utf8');
  store.saveGuardrail(h, { enabled: true, rules: [{ id: 'x', sentence: 'never push', backstop: 'block', enabled: true }] });
  assert.ok(fs.existsSync(store.guardrailBackupPath(h)), 'backup exists');
  assert.equal(fs.readFileSync(store.guardrailBackupPath(h), 'utf8'), first, 'backup is the old content');
  fs.rmSync(h, { recursive: true, force: true });
});

test('corrupt file reads as OFF, never throws', () => {
  const h = home();
  fs.writeFileSync(store.guardrailPath(h), '{not json');
  assert.deepEqual(store.loadGuardrail(h), { enabled: false, rules: [] });
  fs.rmSync(h, { recursive: true, force: true });
});

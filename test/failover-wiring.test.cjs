'use strict';

/**
 * #731 (Option B) wiring contract: a read-only lifecycle stream with generation
 * correlation, and NONE of the risky control hooks (restart / seed / spend gate).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const index = read('src/main/index.ts');
const preload = read('src/preload/index.ts');

test('generation is claimed before spawn and carried on spawn events', () => {
  const claim = index.indexOf('failoverEvents.claim(');
  const spawn = index.indexOf('ptyManager.spawn(opts, owner)', claim);
  assert.ok(claim > 0, 'generation claim missing');
  assert.ok(spawn > claim, 'claim must precede spawn');
  assert.ok(index.slice(spawn, spawn + 500).includes('kind: \'spawned\''), 'spawn event emitted after spawn');
});

test('onExit emits a correlated failed/exited event', () => {
  const handler = index.indexOf('ptyManager.setExitHandler');
  const emit = index.indexOf("kind: abnormal ? 'failed' : 'exited'", handler);
  assert.ok(handler > 0 && emit > handler, 'exit event not emitted in exit handler');
  assert.ok(index.slice(handler, emit).includes('generationOf'), 'exit event carries generation');
});

test('the stream is read-only — no restart / seed / spend authority is exposed', () => {
  // IPC handlers are getters only.
  assert.ok(index.includes("ipcMain.handle('failover:events'"));
  assert.ok(index.includes("ipcMain.handle('failover:generation'"));
  assert.ok(!/ipcMain\.handle\(['"]failover:(restart|seed|approve|spend)/.test(index), 'no control handlers');
  assert.ok(preload.includes('failoverEvents:') && preload.includes('onFailoverEvent:'));
  assert.ok(!/failover(Restart|Seed|Approve)/.test(preload), 'no control methods in preload');
});

test('renderer fan-out is best-effort (window may be gone)', () => {
  assert.ok(index.includes("send('failover:event', e)"));
  assert.ok(index.slice(index.indexOf('failoverEvents.subscribe'), index.indexOf('failoverEvents.subscribe') + 220).includes('catch'));
});

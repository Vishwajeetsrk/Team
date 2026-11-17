'use strict';

/** PRD-10: the transient needs-manual-Enter signal (pure module map). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { markNeedsManual, clearNeedsManual, needsManualEnter } = loadTs('src/renderer/src/components/submitSignal.ts');

test('mark then read; clear removes the flag', () => {
  const id = 'pty-a';
  clearNeedsManual(id);
  assert.equal(needsManualEnter(id), false);
  markNeedsManual(id);
  assert.equal(needsManualEnter(id), true);
  clearNeedsManual(id);
  assert.equal(needsManualEnter(id), false);
});

test('missing pty and stale flags fail closed', () => {
  assert.equal(needsManualEnter(undefined), false);
  const id = 'pty-b';
  clearNeedsManual(id);
  markNeedsManual(id);
  assert.equal(needsManualEnter(id, Date.now() + 10 * 60 * 1000), false); // stale -> false + purged
  assert.equal(needsManualEnter(id), false);
});

test('flags are per-pty', () => {
  clearNeedsManual('pty-c'); clearNeedsManual('pty-d');
  markNeedsManual('pty-c');
  assert.equal(needsManualEnter('pty-c'), true);
  assert.equal(needsManualEnter('pty-d'), false);
});

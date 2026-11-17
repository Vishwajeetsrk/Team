'use strict';

/** PRD-10 / #695: submit-proof classification (pure). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const {
  SUBMIT_PROOF_MIN_BYTES, newOutputBytes, classifySubmitEvidence, shouldRetry
} = loadTs('src/shared/submitProof.ts');

const TAIL = '> pasted text #1 +7 lines\r\n> ';

test('no new output means the Enter was swallowed', () => {
  assert.equal(classifySubmitEvidence(TAIL, TAIL), 'stuck');
});

test('a new turn emits enough output to confirm submit', () => {
  const after = TAIL + '\r\n> Thinking...' + 'x'.repeat(30);
  assert.equal(classifySubmitEvidence(TAIL, after), 'submitted');
});

test('small redraw noise below the threshold stays stuck', () => {
  const after = TAIL + '\r\n> ';
  assert.equal(classifySubmitEvidence(TAIL, after), 'stuck');
});

test('newOutputBytes handles append, wrap, and full turnover', () => {
  assert.equal(newOutputBytes('abc', 'abcdef'), 3);
  assert.equal(newOutputBytes('abcdef', 'defxyz'), 3);   // ring wrapped, 'def' survived
  assert.equal(newOutputBytes('abc', 'xyz'), 3);          // no overlap
  assert.equal(newOutputBytes('', 'hello'), 5);
});

test('missing snapshots fail OPEN as submitted — never a false retry', () => {
  assert.equal(classifySubmitEvidence(undefined, TAIL), 'submitted');
  assert.equal(classifySubmitEvidence(TAIL, undefined), 'submitted');
  assert.equal(classifySubmitEvidence(undefined, undefined), 'submitted');
});

test('at most ONE retry, and only on a stuck submit', () => {
  assert.equal(shouldRetry('stuck', 0), true);
  assert.equal(shouldRetry('stuck', 1), false);
  assert.equal(shouldRetry('submitted', 0), false);
  assert.ok(SUBMIT_PROOF_MIN_BYTES >= 8);
});

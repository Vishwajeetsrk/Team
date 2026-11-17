'use strict';

/** #731 Option B: read-only lifecycle event bus with generation correlation. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const {
  FAILOVER_RING_MAX, validateFailoverEvent, FailoverEventBus
} = loadTs('src/shared/failoverEvents.ts');

const base = (gen, kind, extra = {}) => ({ generation: gen, agentId: 'a-1', kind, provider: 'claude', at: 1000, ...extra });

test('generation is monotonic per agent, independent across agents', () => {
  const b = new FailoverEventBus();
  assert.equal(b.claim('a-1'), 1);
  assert.equal(b.claim('a-1'), 2);
  assert.equal(b.claim('a-2'), 1);
  assert.equal(b.generationOf('a-1'), 2);
  assert.equal(b.generationOf('never'), 0);
});

test('validateFailoverEvent enforces shape without echoing values', () => {
  assert.equal(validateFailoverEvent(base(1, 'spawned')), null);
  assert.ok(validateFailoverEvent(base(0, 'spawned')));
  assert.ok(validateFailoverEvent(base(1, 'bogus')));
  assert.ok(validateFailoverEvent(base(1, 'spawned', { reason: 42 })));
  assert.ok(validateFailoverEvent(null));
});

test('emit records, fans out, and returns newest-first', () => {
  const b = new FailoverEventBus();
  const seen = [];
  const off = b.subscribe((e) => seen.push(e));
  b.emit(base(1, 'spawned'));
  b.emit(base(1, 'failed', { exitCode: 1, reason: 'provider 429' }));
  assert.equal(seen.length, 2);
  assert.deepEqual(b.list().map((e) => e.kind), ['failed', 'spawned']);
  off();
});

test('invalid events are dropped without reaching listeners', () => {
  const b = new FailoverEventBus();
  let n = 0; b.subscribe(() => n++);
  assert.equal(b.emit({ bad: true }), false);
  assert.equal(b.emit(base(1, 'spawned')), true);
  assert.equal(n, 1);
  assert.equal(b.list().length, 1);
});

test('ring is bounded — a chatty stream cannot grow without limit', () => {
  const b = new FailoverEventBus();
  for (let i = 0; i < FAILOVER_RING_MAX + 25; i++) b.emit(base(1, 'exited', { at: i }));
  assert.equal(b.list().length, FAILOVER_RING_MAX);
  assert.equal(b.list()[0].at, FAILOVER_RING_MAX + 24); // newest first
});

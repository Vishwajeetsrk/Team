'use strict';

/** Office floor pathfinding: correctness + the O(n²)->O(n) traversal fix. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { findPath } = loadTs('src/renderer/src/scene/office/pathfinding.ts');

function grid(w, h, blocked = []) {
  const set = new Set(blocked.map(([x, y]) => `${x},${y}`));
  return { width: w, height: h, isWalkable: (x, y) => x >= 0 && y >= 0 && x < w && y < h && !set.has(`${x},${y}`) };
}

test('same tile returns an empty path', () => {
  assert.deepEqual(findPath(grid(10, 10), { x: 2, y: 2 }, { x: 2, y: 2 }), []);
});

test('finds an adjacent step', () => {
  const p = findPath(grid(10, 10), { x: 2, y: 2 }, { x: 3, y: 2 });
  assert.deepEqual(p, [{ x: 3, y: 2 }]);
});

test('returns a contiguous path from start to goal (not reversed)', () => {
  const p = findPath(grid(10, 10), { x: 0, y: 0 }, { x: 5, y: 5 });
  assert.ok(p, 'path exists');
  assert.equal(Math.abs(p[0].x - 0) + Math.abs(p[0].y - 0), 1, 'first step is adjacent to start');
  assert.deepEqual(p[p.length - 1], { x: 5, y: 5 }); // last step is the goal
  for (let i = 1; i < p.length; i++) {
    const d = Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y);
    assert.equal(d, 1, 'steps are unit-adjacent');
  }
});

test('routes around a wall', () => {
  // A vertical wall at x=3 with a gap at y=0 forces a detour upward.
  const wall = [];
  for (let y = 1; y < 10; y++) wall.push([3, y]);
  const p = findPath(grid(10, 10, wall), { x: 0, y: 5 }, { x: 6, y: 5 });
  assert.ok(p, 'a route exists');
  assert.ok(p.some((pt) => pt.x === 3 && pt.y === 0), 'crosses through the gap');
});

test('unreachable goal returns null', () => {
  const wall = [];
  for (let y = 0; y < 10; y++) wall.push([3, y]);
  assert.equal(findPath(grid(10, 10, wall), { x: 0, y: 5 }, { x: 6, y: 5 }), null);
});

test('long corridor resolves quickly and in order (O(n) traversal)', () => {
  const p = findPath(grid(2000, 3), { x: 0, y: 1 }, { x: 1999, y: 1 });
  assert.ok(p && p.length >= 1999, 'full corridor traversed');
  assert.equal(Math.abs(p[0].x - 0) + Math.abs(p[0].y - 1), 1, 'first step adjacent to start');
  assert.deepEqual(p[p.length - 1], { x: 1999, y: 1 });
});

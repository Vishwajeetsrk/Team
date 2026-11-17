'use strict';

/**
 * PRD-10 / #694: the standing Slack-post authorization must live in the TRUSTED
 * hook context (additionalContext), never inside a pasted [SLACK REQUEST] block
 * which the model treats as untrusted and refuses to act on.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const hooks = fs.readFileSync(path.join(root, 'src/main/hooks.ts'), 'utf8');

test('the standing grant is injected via the trusted additionalContext channel', () => {
  assert.ok(hooks.includes('slackGrant'), 'no slackGrant constant in hooks.ts');
  assert.ok(/authorized to reply in your own team Slack channel/i.test(hooks), 'grant text missing');
  assert.ok(/const rosterLine = roster \? \(slackGrant/.test(hooks), 'grant must be appended to the roster line');
  const ctx = hooks.indexOf('additionalContext: [rosterLine, goal, steer]');
  assert.ok(ctx > 0, 'roster line with grant not used in additionalContext');
});

test('the grant is god-only and keyed off the trusted isGod check', () => {
  const wantsRoster = hooks.indexOf('const wantsRoster');
  const grant = hooks.indexOf('const slackGrant = wantsRoster');
  assert.ok(wantsRoster > 0 && grant > wantsRoster, 'grant must ride the god-only wantsRoster gate');
  assert.ok(/this\.hive\.isGod\(agentId\)/.test(hooks.slice(wantsRoster, grant)), 'wantsRoster must use isGod');
});

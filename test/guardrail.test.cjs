'use strict';

/** #716: guardrail pure schema, bash parser, exact-token matcher, evaluator. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const g = loadTs('src/shared/guardrail.ts');

const rule = (sentence, backstop, enabled = true) => ({ id: sentence, sentence, backstop, enabled });

test('off / empty config is the zero-behavior-change invariant', () => {
  assert.deepEqual(g.evaluateGuardrail(null, 'Bash', 'git push origin main'), { verdict: 'allow' });
  assert.deepEqual(g.evaluateGuardrail({ enabled: false, rules: [rule('never push', 'block')] }, 'Bash', 'git push'), { verdict: 'allow' });
  assert.deepEqual(g.evaluateGuardrail({ enabled: true, rules: [] }, 'Bash', 'git push'), { verdict: 'allow' });
});

test('parseConfig drops malformed rules and refuses to enable with none', () => {
  const cfg = g.parseConfig({ enabled: true, rules: [rule('never push', 'block'), { bad: true }] });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.rules.length, 1);
  assert.equal(g.parseConfig({ enabled: true, rules: [{ bad: true }] }).enabled, false);
  assert.equal(g.parseConfig(null).enabled, false);
});

test('validateRule enforces shape', () => {
  assert.equal(g.validateRule(rule('never push', 'block')), null);
  assert.ok(g.validateRule({ ...rule('never push', 'block'), backstop: 'nope' }));
  assert.ok(g.validateRule({ ...rule('never push', 'block'), enabled: 'yes' }));
});

test('ruleTokens extracts operative verbs, ignores fluff', () => {
  assert.deepEqual(g.ruleTokens('Never merge a pull request'), ['merge']);
  assert.deepEqual(g.ruleTokens('Push only with my approval'), ['push']);
  assert.deepEqual(g.ruleTokens('Please do the needful'), []);
});

test('bash parser splits pipes, &&, ; and unwraps sh -c / xargs / find -exec', () => {
  const parts = g.parseBashCommands("git checkout main && git push origin main | tee log; echo done");
  assert.ok(parts.some((p) => p.includes('git push')));
  assert.ok(parts.some((p) => p.includes('git checkout')));
  assert.ok(g.parseBashCommands("sh -c 'git push origin main'").some((p) => p.includes('git push')));
  assert.ok(g.parseBashCommands("find . -exec rm {} +").some((p) => p.includes('rm')));
  assert.ok(g.parseBashCommands("echo hi | xargs git push").some((p) => p.includes('git push')));
});

test('matching is exact-token: a push buried in a pipeline is caught', () => {
  const cfg = { enabled: true, rules: [rule('never push to a protected branch', 'block')] };
  assert.equal(g.evaluateGuardrail(cfg, 'Bash', 'echo hi && git push origin main').verdict, 'block');
  assert.equal(g.evaluateGuardrail(cfg, 'Bash', 'git status').verdict, 'allow');
  assert.equal(g.evaluateGuardrail(cfg, 'Bash', 'git pushx').verdict, 'allow');
});

test('strictest matching backstop wins', () => {
  const cfg = { enabled: true, rules: [rule('push only with approval', 'ask'), rule('never push', 'block')] };
  assert.equal(g.evaluateGuardrail(cfg, 'Bash', 'git push').verdict, 'block');
  const logAsk = { enabled: true, rules: [rule('push once', 'log'), rule('push with ok', 'ask')] };
  assert.equal(g.evaluateGuardrail(logAsk, 'Bash', 'git push').verdict, 'ask');
});

test('a quote containing a pipe is not split', () => {
  const parts = g.parseBashCommands('echo "a | b" && git push');
  assert.ok(parts.some((p) => p.includes('a | b')));
});

'use strict';

/**
 * Free-win (md-secret) server-side contract. The broker is electron-free, so
 * we bind a real loopback server and drive it with the exact routes/headers the
 * bundled md-secret.cjs client sends. No secret values are ever logged here.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { IntegrationBroker } = loadTs('src/main/integrationBroker.ts');

const SECRETS = new Map([
  ['apikey:anthropic', 'sk-ant-test'],
  ['custom:GITHUB_TOKEN', 'ghp-test']
]);
const NAMES = [
  { name: 'ANTHROPIC_API_KEY', kind: 'provider' },
  { name: 'GITHUB_TOKEN', kind: 'custom' }
];
const REFS = { ANTHROPIC_API_KEY: 'apikey:anthropic', GITHUB_TOKEN: 'custom:GITHUB_TOKEN' };

function makeBroker(audit = []) {
  return new IntegrationBroker({
    getRecord: () => undefined,
    getSecret: (ref) => SECRETS.get(ref),
    listSecretNames: () => NAMES,
    secretRefForName: (n) => REFS[n],
    onSecretRead: (worker, name) => audit.push([worker, name])
  });
}

function call(url, route, { method = 'GET', token, body } = {}) {
  const u = new URL(url);
  const data = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolve) => {
    const req = require('node:http').request({
      method, host: u.hostname, port: Number(u.port), path: route,
      headers: {
        'x-md-broker-token': token,
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', (e) => resolve({ netError: e }));
    if (data) req.write(data);
    req.end();
  });
}

async function withBroker(fn, audit) {
  const broker = makeBroker(audit);
  const r = await broker.start();
  assert.equal(r.ok, true, r.error);
  const token = broker.grant('worker-1', []);
  try { await fn(broker.url(), token, broker); } finally { broker.stop(); }
}

test('GET /secrets lists names+kinds but never values', async () => {
  await withBroker(async (url, token) => {
    const res = await call(url, '/secrets', { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.secrets, NAMES);
    assert.equal(JSON.stringify(res.json).includes('sk-ant-test'), false);
    assert.equal(JSON.stringify(res.json).includes('ghp-test'), false);
  });
});

test('POST /secrets/read returns the value for a known name', async () => {
  await withBroker(async (url, token) => {
    const res = await call(url, '/secrets/read', { method: 'POST', token, body: { name: 'GITHUB_TOKEN' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.value, 'ghp-test');
  });
});

test('POST /secrets/read 404s an unknown name without echoing it as a value', async () => {
  await withBroker(async (url, token) => {
    const res = await call(url, '/secrets/read', { method: 'POST', token, body: { name: 'NOPE' } });
    assert.equal(res.status, 404);
    assert.equal(res.json.value, undefined);
  });
});

test('secret routes require the capability token', async () => {
  await withBroker(async (url) => {
    const res = await call(url, '/secrets', { token: 'bad' });
    assert.equal(res.status, 401);
  });
});

test('invalid name is rejected; every successful read is audited by worker+name', async () => {
  const audit = [];
  await withBroker(async (url, token) => {
    const bad = await call(url, '/secrets/read', { method: 'POST', token, body: { name: 'bad-name!' } });
    assert.equal(bad.status, 400);
    const ok = await call(url, '/secrets/read', { method: 'POST', token, body: { name: 'ANTHROPIC_API_KEY' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(audit, [['worker-1', 'ANTHROPIC_API_KEY']]);
  }, audit);
});

test('a read with no stored value fails closed', async () => {
  await withBroker(async (url, token) => {
    const res = await call(url, '/secrets/read', { method: 'POST', token, body: { name: 'MISSING_KEY' } });
    assert.equal(res.status, 404);
  });
});

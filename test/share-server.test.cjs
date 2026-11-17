'use strict';

/**
 * Free-win (md-share) server contract. Real loopback server, injected tunnel,
 * real temp files. No external network; path containment + one-time enforced.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { ShareServer } = loadTs('src/main/shareServer.ts');

function tmpWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-share-test-'));
  fs.mkdirSync(path.join(root, 'site'));
  fs.writeFileSync(path.join(root, 'site', 'index.html'), '<h1>hello</h1>');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'one-time payload');
  return root;
}

function call(url, route, { method = 'GET', token, body, headers = {} } = {}) {
  const u = new URL(url);
  const data = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolve) => {
    const req = http.request({
      method, host: u.hostname, port: Number(u.port), path: route,
      headers: { ...(token ? { 'x-md-broker-token': token } : {}), ...headers,
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null; try { json = JSON.parse(raw.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, json, raw: raw.toString('utf8'), headers: res.headers });
      });
    });
    req.on('error', (e) => resolve({ netError: e }));
    if (data) req.write(data);
    req.end();
  });
}

async function withServer(fn) {
  const root = tmpWorkspace();
  const server = new ShareServer({
    workerForToken: (t) => (t === 'good' ? 'worker-1' : undefined),
    workspaceRootFor: (id) => (id === 'worker-1' ? root : undefined),
    openTunnel: async () => 'https://tunnel.example'
  });
  const r = await server.start();
  assert.equal(r.ok, true, r.error);
  try { await fn(server, server.url ? server.url() : `http://127.0.0.1:${r.port}`, root); }
  finally { server.stop(); fs.rmSync(root, { recursive: true, force: true }); }
}
// ShareServer has no url() helper; build it from the bound port.
ShareServer.prototype.url = function () { return `http://127.0.0.1:${this.port}`; };

test('management routes require the broker token', async () => {
  await withServer(async (s, url) => {
    const res = await call(url, '/share/list', { method: 'POST', token: 'bad', body: {} });
    assert.equal(res.status, 401);
  });
});

test('create a page link, list it, stop it', async () => {
  await withServer(async (s, url, root) => {
    const created = await call(url, '/share', { method: 'POST', token: 'good', body: { kind: 'page', path: path.join(root, 'site') } });
    assert.equal(created.status, 200, created.raw);
    assert.equal(created.json.ok, true);
    const share = created.json.share;
    assert.ok(share.id.startsWith('fs-'));
    assert.ok(share.url.startsWith('https://tunnel.example/s/'));
    assert.ok(share.password && share.password.length >= 12);
    const listed = await call(url, '/share/list', { method: 'POST', token: 'good', body: {} });
    assert.equal(listed.json.shares.length, 1);
    const stopped = await call(url, '/share/stop', { method: 'POST', token: 'good', body: { id: share.id } });
    assert.equal(stopped.json.stopped, 1);
    const after = await call(url, '/share/list', { method: 'POST', token: 'good', body: {} });
    assert.equal(after.json.shares.length, 0);
  });
});

test('path outside the workspace is refused', async () => {
  await withServer(async (s, url, root) => {
    const res = await call(url, '/share', { method: 'POST', token: 'good', body: { kind: 'file', path: path.join(os.tmpdir(), 'nope.txt') } });
    assert.equal(res.status, 400);
  });
});

test('public page serves a password gate, then content with the password', async () => {
  await withServer(async (s, url, root) => {
    const created = await call(url, '/share', { method: 'POST', token: 'good', body: { kind: 'page', path: path.join(root, 'site') } });
    const share = created.json.share;
    const gate = await call(url, `/s/${share.id}`);
    assert.equal(gate.status, 200);
    assert.ok(gate.raw.includes('Password'));
    const open = await call(url, `/s/${share.id}?pw=${encodeURIComponent(share.password)}`);
    assert.equal(open.status, 200);
    assert.ok(open.raw.includes('hello'));
  });
});

test('md-share path works through the broker port (real CLI route)', async () => {
  const { IntegrationBroker } = loadTs('src/main/integrationBroker.ts');
  const root = tmpWorkspace();
  const broker = new IntegrationBroker({
    getRecord: () => undefined, getSecret: () => undefined
  });
  const shareServer = new ShareServer({
    workerForToken: (t) => broker.workerForToken(t),
    workspaceRootFor: () => root,
    openTunnel: async () => 'https://tunnel.example'
  });
  broker.setShareServer(shareServer);
  const bs = await broker.start();
  assert.equal(bs.ok, true, bs.error);
  try {
    const token = broker.grant('worker-1', []);
    const res = await call(`http://127.0.0.1:${bs.port}`, '/share', {
      method: 'POST', token, body: { kind: 'file', path: path.join(root, 'secret.txt') }
    });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.json.ok, true);
    assert.ok(res.json.share.id.startsWith('fs-'));
  } finally { broker.stop(); shareServer.stop(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('a file link is single-use', async () => {
  await withServer(async (s, url, root) => {
    const created = await call(url, '/share', { method: 'POST', token: 'good', body: { kind: 'file', path: path.join(root, 'secret.txt') } });
    const share = created.json.share;
    const auth = 'Basic ' + Buffer.from('x:' + share.password).toString('base64');
    const one = await call(url, `/s/${share.id}`, { headers: { authorization: auth } });
    assert.equal(one.status, 200);
    assert.ok(one.raw.includes('one-time payload'));
    const two = await call(url, `/s/${share.id}`, { headers: { authorization: auth } });
    assert.equal(two.status, 404);
  });
});

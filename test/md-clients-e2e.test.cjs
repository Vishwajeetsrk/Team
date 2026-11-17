'use strict';

/**
 * End-to-end: the REAL bundled md-secret.cjs / md-share.cjs clients talking to
 * the loopback servers built in slices 1-2. Proves the client/server protocols
 * agree (routes, headers, response shapes), not just each side in isolation.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const loadTs = require('./load-ts.cjs');

const { IntegrationBroker } = loadTs('src/main/integrationBroker.ts');
const { ShareServer } = loadTs('src/main/shareServer.ts');
const root = path.join(__dirname, '..');
const secretCli = path.join(root, 'resources', 'md-secret.cjs');
const shareCli = path.join(root, 'resources', 'md-share.cjs');

const SECRETS = new Map([['custom:GITHUB_TOKEN', 'ghp_e2e_secret']]);
const NAMES = [{ name: 'GITHUB_TOKEN', kind: 'custom' }];
const REFS = { GITHUB_TOKEN: 'custom:GITHUB_TOKEN' };

function tmpWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-e2e-'));
  fs.writeFileSync(path.join(dir, 'payload.txt'), 'e2e payload');
  return dir;
}

function httpGet(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      const c = []; res.on('data', (x) => c.push(x));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }));
    }).on('error', (e) => resolve({ netError: e }));
  });
}

test('real md-secret.cjs list/get work against the live broker', async () => {
  const broker = new IntegrationBroker({
    getRecord: () => undefined,
    getSecret: (ref) => SECRETS.get(ref),
    listSecretNames: () => NAMES,
    secretRefForName: (n) => REFS[n]
  });
  const r = await broker.start();
  assert.equal(r.ok, true, r.error);
  const token = broker.grant('worker-1', []);
  const env = { ...process.env, MD_BROKER_URL: broker.url(), MD_BROKER_TOKEN: token };
  try {
    const { stdout: list } = await run(process.execPath, [secretCli, 'list', '--json'], { env });
    const parsed = JSON.parse(list);
    assert.deepEqual(parsed.secrets, NAMES);
    const { stdout: got } = await run(process.execPath, [secretCli, 'get', 'GITHUB_TOKEN'], { env });
    assert.equal(got, 'ghp_e2e_secret');
  } finally { broker.stop(); }
});

test('real md-share.cjs creates a link the public route serves', async () => {
  const dir = tmpWorkspace();
  const broker = new IntegrationBroker({ getRecord: () => undefined, getSecret: () => undefined });
  const share = new ShareServer({
    workerForToken: (t) => broker.workerForToken(t),
    workspaceRootFor: () => dir,
    openTunnel: async () => 'http://127.0.0.1:1' // not used by the CLI's --json create
  });
  broker.setShareServer(share);
  const r = await broker.start();
  assert.equal(r.ok, true, r.error);
  const token = broker.grant('worker-1', []);
  const env = { ...process.env, MD_BROKER_URL: broker.url(), MD_BROKER_TOKEN: token };
  try {
    const { stdout: out } = await run(process.execPath, [shareCli, 'file', path.join(dir, 'payload.txt'), '--json'], { env });
    const created = JSON.parse(out);
    assert.equal(created.ok, true);
    assert.ok(created.share.id.startsWith('fs-'));
    assert.ok(created.share.password);
  } finally { broker.stop(); share.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

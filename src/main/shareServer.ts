/**
 * Ephemeral file/page sharing (free-win md-share). Electron-free, node-testable.
 *
 * A loopback HTTP server that mints password-protected, expiring links to files
 * inside an agent's OWN workspace, and serves them through a lazily-opened
 * tunnel (tunnelmole, same proven dependency as the webhook tunnel). Management
 * routes (create/list/stop) authenticate with the agent's loopback broker token;
 * the public /s/<id> surface never accepts a broker token.
 *
 * No secret is ever logged or echoed into a response beyond the one-time link
 * password the CLI prints for the operator.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { realpathSync, statSync, readFileSync, createReadStream } from 'node:fs';
import { join, resolve, sep, basename } from 'node:path';

const MAX_BODY_BYTES = 1 * 1024 * 1024;
const MIN_MINUTES = 5;
const MAX_MINUTES = 1440;
const ID_PREFIX = 'fs-';

export interface ShareRecord {
  id: string;
  ownerAgentId: string;
  password: string;
  kind: 'page' | 'file' | 'folder';
  workspaceRoot: string;
  targetPath: string;   // realpath, confirmed under workspaceRoot
  name: string;
  audience: 'people' | 'agents' | 'both';
  expiresAt: number;
  once: boolean;
  opened: boolean;
  /** short HMAC-style token baked into the cookie for repeat browser loads. */
  cookie: string;
}

export interface ShareServerDeps {
  /** Resolve a broker capability token to its worker id (scopes management calls). */
  workerForToken: (token: string | undefined) => string | undefined;
  /** The agent's workspace root (the only area a share may expose). */
  workspaceRootFor: (agentId: string) => string | undefined;
  /** Open the public tunnel to our loopback port; returns the base URL. Injected
   *  so tests never open a real tunnel. */
  openTunnel?: (port: number) => Promise<string>;
}

const tokenFrom = (req: IncomingMessage): string | undefined => {
  const x = req.headers['x-md-broker-token'];
  if (typeof x === 'string' && x) return x;
  const a = req.headers['authorization'];
  if (typeof a === 'string') { const m = /^Bearer\s+(.+)$/i.exec(a.trim()); if (m) return m[1].trim(); }
  return undefined;
};

/** Constant-time-ish password comparison, length-guarded. */
function pwOk(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Confirm `target` is inside `root` after resolving symlinks. Throws otherwise. */
function contained(root: string, target: string): string {
  const realRoot = realpathSync(resolve(root));
  const realTarget = realpathSync(resolve(target));
  const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realTarget !== realRoot && !realTarget.startsWith(prefix)) throw new Error('path is outside this agent workspace');
  return realTarget;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) { try { res.end(); } catch {} return; }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export class ShareServer {
  private server: Server | null = null;
  private port = 0;
  private tunnelBase = '';
  private tunnelPromise: Promise<string> | null = null;
  private readonly timer: NodeJS.Timeout;
  private readonly shares = new Map<string, ShareRecord>();

  constructor(private readonly deps: ShareServerDeps) {
    this.timer = setInterval(() => this.purge(), 60_000);
    this.timer.unref?.();
  }

  start(preferredPort = 0): Promise<{ ok: boolean; port?: number; error?: string }> {
    return new Promise((resolve) => {
      if (this.server) { resolve({ ok: true, port: this.port }); return; }
      const server = createServer((req, res) => { void this.handle(req, res); });
      const onError = (e: Error): void => { server.off('listening', onListening); resolve({ ok: false, error: e.message }); };
      const onListening = (): void => {
        server.off('error', onError);
        this.server = server;
        const addr = server.address();
        this.port = addr && typeof addr === 'object' ? addr.port : preferredPort;
        resolve({ ok: true, port: this.port });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(preferredPort, '127.0.0.1');
    });
  }

  stop(): void {
    try { this.server?.close(); } catch {}
    this.server = null; this.port = 0; this.tunnelBase = ''; this.tunnelPromise = null;
    clearInterval(this.timer); this.shares.clear();
  }

  running(): boolean { return !!this.server && this.port > 0; }

  private purge(): void {
    const now = Date.now();
    for (const [id, s] of this.shares) if (now >= s.expiresAt) this.shares.delete(id);
  }

  /** Public so the integration broker can delegate /share* on the same loopback
   *  port the md-* CLIs already read from MD_BROKER_URL. */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.handle(req, res);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const route = url.pathname;
    if (route === '/share' || route === '/share/list' || route === '/share/stop') {
      await this.handleManage(req, res, route);
      return;
    }
    if (route.startsWith('/s/')) { this.handlePublic(req, res, route.slice(3), url); return; }
    json(res, 404, { ok: false, error: 'not found' });
  }

  private async handleManage(req: IncomingMessage, res: ServerResponse, route: string): Promise<void> {
    const worker = this.deps.workerForToken(tokenFrom(req));
    if (!worker) { json(res, 401, { ok: false, error: 'missing or invalid broker token' }); return; }
    if ((req.method ?? '').toUpperCase() !== 'POST') { json(res, 405, { ok: false, error: 'use POST' }); return; }
    let body: Record<string, unknown>;
    try {
      const raw = await this.readBody(req);
      body = JSON.parse(raw.toString('utf8'));
    } catch { json(res, 400, { ok: false, error: 'invalid JSON body' }); return; }

    if (route === '/share/list') {
      this.purge();
      const shares = [...this.shares.values()].filter((s) => s.ownerAgentId === worker).map((s) => this.publicView(s));
      json(res, 200, { ok: true, shares });
      return;
    }
    if (route === '/share/stop') {
      let stopped = 0;
      if (body.all === true) {
        for (const [id, s] of this.shares) if (s.ownerAgentId === worker) { this.shares.delete(id); stopped++; }
      } else if (typeof body.id === 'string') {
        const s = this.shares.get(body.id);
        if (s && s.ownerAgentId === worker) { this.shares.delete(body.id); stopped = 1; }
      }
      json(res, 200, { ok: true, stopped });
      return;
    }
    // /share create
    await this.createShare(req, res, worker, body);
  }

  private readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []; let size = 0;
      req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY_BYTES) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  private publicView(s: ShareRecord) {
    return {
      id: s.id, kind: s.kind, name: s.name, audience: s.audience,
      once: s.once, expiresAt: s.expiresAt,
      url: `${this.tunnelBase}/s/${s.id}`, password: s.password
    };
  }

  private async createShare(req: IncomingMessage, res: ServerResponse, worker: string, body: Record<string, unknown>): Promise<void> {
    const kind = body.kind;
    if (kind !== 'page' && kind !== 'file' && kind !== 'folder') { json(res, 400, { ok: false, error: 'kind must be page, file or folder' }); return; }
    if (typeof body.path !== 'string' || !body.path) { json(res, 400, { ok: false, error: 'path required' }); return; }
    const audience = body.for === 'people' || body.for === 'agents' ? body.for : 'both';
    let minutes = 60;
    if (body.minutes !== undefined) {
      const n = Number(body.minutes);
      if (!Number.isInteger(n) || n < MIN_MINUTES || n > MAX_MINUTES) { json(res, 400, { ok: false, error: `minutes must be ${MIN_MINUTES}-${MAX_MINUTES}` }); return; }
      minutes = n;
    }
    const once = body.once === true && kind === 'page';
    const root = this.deps.workspaceRootFor(worker);
    if (!root) { json(res, 400, { ok: false, error: 'agent has no workspace' }); return; }
    let target: string;
    try {
      target = contained(root, body.path);
      const st = statSync(target);
      if (kind === 'page') {
        if (st.isDirectory()) { if (!statSync(join(target, 'index.html')).isFile()) throw new Error('folder has no index.html'); }
        else if (!/\.(html?|htm)$/i.test(target)) throw new Error('page must be .html or a folder with index.html');
      } else if (kind === 'file' && st.isDirectory()) { /* folder goes as zip */ }
    } catch (e) { json(res, 400, { ok: false, error: (e as Error).message }); return; }

    try {
      if (!this.tunnelBase) {
        if (!this.tunnelPromise) {
          this.tunnelPromise = (this.deps.openTunnel
            ? this.deps.openTunnel(this.port)
            : Promise.reject(new Error('no tunnel configured')))
            .then((u) => { this.tunnelBase = u.replace(/\/$/, ''); return this.tunnelBase; })
            .finally(() => { this.tunnelPromise = null; });
        }
        await this.tunnelPromise;
      }
    } catch (e) { json(res, 503, { ok: false, error: `tunnel unavailable: ${(e as Error).message}` }); return; }

    const now = Date.now();
    const s: ShareRecord = {
      id: ID_PREFIX + randomBytes(9).toString('hex'), ownerAgentId: worker,
      password: randomBytes(9).toString('base64url'), kind,
      workspaceRoot: resolve(root), targetPath: target, name: basename(target),
      audience, expiresAt: now + minutes * 60_000, once, opened: false,
      cookie: createHash('sha256').update(randomBytes(32)).digest('hex')
    };
    this.shares.set(s.id, s);
    json(res, 200, { ok: true, share: this.publicView(s) });
  }

  private handlePublic(req: IncomingMessage, res: ServerResponse, id: string, url: URL): void {
    this.purge();
    const s = this.shares.get(id);
    if (!s) { json(res, 404, { ok: false, error: 'link not found or expired' }); return; }
    if (s.audience !== 'people' && s.audience !== 'both') {
      // agents only: require -u x:<password>. People gate is disabled on purpose.
    }
    const cookieMatch = /(?:^|;\s*)md_share=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    let supplied = url.searchParams.get('pw') ?? (cookieMatch && cookieMatch === s.cookie ? s.password : '');
    if (!supplied) {
      const auth = req.headers.authorization;
      if (auth && /^Basic\s+/i.test(auth)) {
        const decoded = Buffer.from(auth.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
        const colon = decoded.indexOf(':');
        if (colon >= 0 && decoded.slice(0, colon) === 'x') supplied = decoded.slice(colon + 1);
      }
    }
    if (!supplied || !pwOk(supplied, s.password)) {
      if (s.audience === 'agents' || (req.method ?? 'GET').toUpperCase() !== 'GET') {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="md-share"', 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'password required' }));
      } else {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(this.gateHtml(id));
      }
      return;
    }
    // Correct password: honor once semantics and the browser cookie.
    const now = Date.now();
    if (s.once && !s.opened) { s.opened = true; s.expiresAt = Math.min(s.expiresAt, now + 10 * 60_000); }
    if (!cookieMatch) res.setHeader('set-cookie', `md_share=${s.cookie}; Path=/s/${id}; HttpOnly; SameSite=Lax`);
    this.serveContent(req, res, s);
  }

  private gateHtml(id: string): string {
    return `<!doctype html><meta name="viewport" content="width=device-width"><title>md-share</title>
<form method="get" action="/s/${id}" style="font:16px system-ui;max-width:340px;margin:15vh auto;display:flex;flex-direction:column;gap:12px">
<h2>Shared link</h2><label>Password<input name="pw" type="password" required autofocus style="padding:8px;font-size:16px"></label>
<button type="submit" style="padding:8px;font-size:16px">Open</button></form>`;
  }

  private serveContent(req: IncomingMessage, res: ServerResponse, s: ShareRecord): void {
    // A sub-path after the id is only allowed for pages (files inside the page).
    const extra = (req.url ?? '').split('?')[0].split('/').slice(3).join('/');
    try {
      if (s.kind === 'page') {
        let target = s.targetPath;
        if (statSync(target).isDirectory()) target = join(target, 'index.html');
        if (extra) {
          const candidate = contained(s.workspaceRoot, join(s.targetPath, extra));
          if (statSync(candidate).isFile()) target = candidate;
        }
        const body = readFileSync(target);
        const ext = target.toLowerCase();
        const ctype = ext.endsWith('.css') ? 'text/css' : ext.endsWith('.js') ? 'application/javascript'
          : ext.endsWith('.png') ? 'image/png' : ext.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
        res.writeHead(200, { 'content-type': `${ctype}; charset=utf-8` });
        res.end(body);
        return;
      }
      const isDir = statSync(s.targetPath).isDirectory();
      if (isDir) {
        const zip = zipFolder(s.targetPath);
        this.finishDownload(res, zip, `${s.name}.zip`, 'application/zip');
      } else {
        const body = readFileSync(s.targetPath);
        this.finishDownload(res, body, s.name, 'application/octet-stream');
      }
      // Files and folders are single-use: the link is gone after one download.
      this.shares.delete(s.id);
    } catch (e) {
      json(res, 404, { ok: false, error: (e as Error).message });
    }
  }

  private finishDownload(res: ServerResponse, body: Buffer, name: string, ctype: string): void {
    res.writeHead(200, {
      'content-type': ctype,
      'content-disposition': `attachment; filename="${name.replace(/["\r\n]/g, '_')}"`,
      'content-length': body.length
    });
    res.end(body);
  }

  /** Exposed for tests: inject a share directly (no tunnel needed). */
  _testInsert(s: ShareRecord): void { this.shares.set(s.id, s); }
}

/* ---- dependency-free ZIP (STORE method) for folder shares ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry { name: string; data: Buffer; crc: number; offset: number }
function zipFolder(root: string): Buffer {
  const { readdirSync, lstatSync } = require('node:fs') as typeof import('node:fs');
  const files: Array<{ rel: string; data: Buffer }> = [];
  const walk = (dir: string, prefix: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(full, rel);
      else if (ent.isFile()) files.push({ rel, data: readFileSync(full) });
      else lstatSync(full); // skip symlinks / special files
    }
  };
  walk(root, '');
  const local: Buffer[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.rel, 'utf8');
    const crc = crc32(f.data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(0, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(f.data.length, 18); h.writeUInt32LE(f.data.length, 22);
    h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, name, f.data);
    entries.push({ name: f.rel, data: f.data, crc, offset });
    offset += h.length + name.length + f.data.length;
  }
  const central: Buffer[] = [];
  let centralSize = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6);
    h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0, 12); h.writeUInt16LE(0, 14);
    h.writeUInt32LE(e.crc, 16); h.writeUInt32LE(e.data.length, 20); h.writeUInt32LE(e.data.length, 24);
    h.writeUInt16LE(name.length, 28); h.writeUInt16LE(0, 30); h.writeUInt16LE(0, 32);
    h.writeUInt16LE(0, 34); h.writeUInt16LE(0, 36); h.writeUInt32LE(0, 38); h.writeUInt32LE(e.offset, 42);
    central.push(h, name); centralSize += h.length + name.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...local, ...central, eocd]);
}


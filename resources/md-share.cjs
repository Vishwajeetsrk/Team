#!/usr/bin/env node
/**
 * md-share.cjs: share a page or a file from this agent's workspace on a
 * temporary link with a password, served by the Munder Difflin app on this
 * machine through its tunnel (0.5.6).
 *
 * Usage:
 *   md-share page <abs path> [--for people|agents|both] [--minutes N] [--once]
 *       One .html file, or a folder with an index.html at its top, served
 *       live from disk: edit it and the next load shows the change. Opens any
 *       number of times for an hour, or N minutes (5 to 1440). --once: the
 *       first right password keeps it open 10 minutes, then it ends.
 *   md-share file <abs path> [--for people|agents|both] [--minutes N]
 *       One download, then the link is gone. A day at most; --minutes can
 *       only make that shorter. A folder goes as a zip.
 *   md-share list                 your links that are still open
 *   md-share stop <id> | --all    end one of your links now, or all of them
 *   Add --json to any of them for the answer as JSON.
 *
 *   --for people   a browser: a page that asks for the password
 *   --for agents   only curl with the password (-u x:<password>)
 *   --for both     either (the default)
 *
 * The app only shares what is inside this agent's own workspace. It knows
 * which agent is asking from the broker token (MD_BROKER_URL and
 * MD_BROKER_TOKEN, set on every agent). When the app restarted since this
 * agent started, those are stale; the helper then reads $AGENT_DIR/.broker,
 * which the app rewrites, and tries once more.
 *
 * No dependencies: plain Node, like md-slack-reply.cjs.
 */
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const AUDIENCES = ['people', 'agents', 'both'];
const MINUTES_MIN = 5;
const MINUTES_MAX = 1440;
const VALUE_FLAGS = new Set(['for', 'minutes']);
const BOOL_FLAGS = new Set(['once', 'all', 'json', 'help']);
const REQUEST_TIMEOUT_MS = 60_000;

/** The way this helper is run, for the "stop it" line. */
const SELF = `"${process.execPath}" "${__filename}"`;

function fail(msg, code = 1) {
  process.stderr.write(`md-share: ${String(msg).replace(/\s+/g, ' ').trim()}\n`);
  process.exit(code);
}

const USAGE = 'usage: md-share page <abs path> [--for people|agents|both] [--minutes N] [--once] | file <abs path> [--for people|agents|both] [--minutes N] | list | stop <id>|--all, with --json for JSON';

/** `cmd`, the positional words after it, and the flags. Exported for tests. */
function parseArgs(argv) {
  const words = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { words.push(a); continue; }
    const eq = a.indexOf('=');
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (VALUE_FLAGS.has(key)) {
      let value = eq === -1 ? argv[i + 1] : a.slice(eq + 1);
      if (eq === -1) i++;
      if (value === undefined || value === '' || value.startsWith('--')) return { error: `--${key} needs a value` };
      flags[key] = value;
    } else if (BOOL_FLAGS.has(key)) {
      if (eq !== -1) return { error: `--${key} takes no value` };
      flags[key] = true;
    } else {
      return { error: `unknown option --${key}` };
    }
  }
  const cmd = words.shift();
  return { cmd, words, flags };
}

/** What to send, or an error. Exported for tests. */
function requestFor(parsed) {
  if (parsed.error) return { error: parsed.error };
  const { cmd, words, flags } = parsed;
  if (flags.help) return { help: true };
  if (cmd === 'list') {
    if (words.length) return { error: 'list takes no path' };
    return { route: 'list', body: {} };
  }
  if (cmd === 'stop') {
    if (flags.all && words.length) return { error: 'stop takes an id or --all, not both' };
    if (flags.all) return { route: 'stop', body: { all: true } };
    if (words.length !== 1) return { error: 'stop takes the id of one link (it starts with fs-), or --all' };
    return { route: 'stop', body: { id: words[0] } };
  }
  if (cmd !== 'page' && cmd !== 'file') return { error: cmd ? `unknown command ${cmd}` : 'say page, file, list or stop' };
  if (words.length !== 1) return { error: `${cmd} takes one path` };
  if (flags.all) return { error: '--all is for stop' };
  const body = { kind: cmd, path: path.resolve(words[0]) };
  if (flags.for !== undefined) {
    if (!AUDIENCES.includes(flags.for)) return { error: '--for takes people, agents or both' };
    body.for = flags.for;
  }
  if (flags.minutes !== undefined) {
    const n = /^\d{1,5}$/.test(flags.minutes) ? Number(flags.minutes) : NaN;
    if (!Number.isInteger(n) || n < MINUTES_MIN || n > MINUTES_MAX) return { error: `--minutes takes a whole number from ${MINUTES_MIN} to ${MINUTES_MAX}` };
    body.minutes = n;
  }
  if (flags.once) {
    if (cmd === 'file') return { error: '--once is for a page; a file link already works for one download' };
    body.once = true;
  }
  return { route: 'create', body };
}

/* ---- reaching the broker ------------------------------------------------- */

/** Only a loopback broker is ever sent the token. */
function cleanUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || !u.port) return null;
    return `http://${u.hostname}:${u.port}`;
  } catch {
    return null;
  }
}

function fromEnv() {
  const url = cleanUrl(process.env.MD_BROKER_URL);
  const token = process.env.MD_BROKER_TOKEN;
  return url && typeof token === 'string' && token ? { url, token, from: 'env' } : null;
}

function fromFile() {
  const dir = process.env.AGENT_DIR;
  if (!dir) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, '.broker'), 'utf8'));
    const url = cleanUrl(j && j.url);
    return url && typeof j.token === 'string' && j.token ? { url, token: j.token, from: 'file' } : null;
  } catch {
    return null;
  }
}

const ROUTES = { create: '/share', list: '/share/list', stop: '/share/stop' };

function post(creds, route, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const u = new URL(creds.url);
    const req = http.request({
      method: 'POST',
      host: u.hostname.replace(/^\[|\]$/g, ''),
      port: Number(u.port),
      path: ROUTES[route],
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data),
        'x-md-broker-token': creds.token
      },
      timeout: REQUEST_TIMEOUT_MS
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, raw });
      });
      res.on('error', (e) => resolve({ netError: e }));
    });
    req.on('timeout', () => { req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })); });
    req.on('error', (e) => resolve({ netError: e }));
    req.write(data);
    req.end();
  });
}

/** A dead or refused connection, or a token the broker no longer knows: the
 *  app restarted, and the .broker file has the new address. */
function stale(r) {
  if (r.netError) return ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'EHOSTUNREACH', 'ENOTFOUND', 'EADDRNOTAVAIL'].includes(r.netError.code);
  return r.status === 401;
}

async function call(route, body) {
  let creds = fromEnv() || fromFile();
  if (!creds) fail('cannot reach the app: MD_BROKER_URL and MD_BROKER_TOKEN are not set and $AGENT_DIR/.broker cannot be read. Run this from an agent the app started.');
  let r = await post(creds, route, body);
  if (stale(r)) {
    const again = fromFile();
    if (again && !(creds.from === 'file' && again.url === creds.url && again.token === creds.token)) {
      creds = again;
      r = await post(creds, route, body);
    }
  }
  if (r.netError) fail(`cannot reach the app at ${creds.url} (${r.netError.code || r.netError.message}). Is it still running?`);
  return r;
}

/* ---- what is printed ----------------------------------------------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

/** "16 Oct 2026, 18:42 UTC", the same way the app writes it. */
function formatUntil(ms) {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

const groupPassword = (p) => String(p || '').replace(/(.{4})(?=.)/g, '$1 ');
const forWhom = (a) => (a === 'people' ? 'for people' : a === 'agents' ? 'for agents' : 'for people and agents');
/** A name that is safe inside single quotes and cannot be read as an option. */
const safeName = (n) => String(n || '').replace(/[^A-Za-z0-9._ ()+,=@-]/g, '_').replace(/^[-.\s]+/, '').trim().slice(0, 120) || 'download';

/** The lines for one new link. Exported for tests. */
function shareLines(s, self = SELF) {
  const page = s.kind === 'page';
  const lines = [];
  lines.push(`Shared the ${page ? 'page' : s.kind === 'folder' ? 'folder (as a zip)' : 'file'} ${s.name}, ${forWhom(s.audience)}.`);
  lines.push(`Link: ${s.url}`);
  lines.push(`Password: ${groupPassword(s.password)}`);
  const how = !page
    ? 'It works for one download.'
    : s.once
      ? 'It opens once: the first right password keeps it open 10 minutes, then it ends.'
      : 'It opens any number of times until then.';
  lines.push(`Until: ${formatUntil(s.expiresAt)}. ${how}`);
  if (s.audience !== 'agents') lines.push('For people: open the link in a browser and enter the password.');
  if (s.audience !== 'people') {
    lines.push(`For agents: curl -fsSL -u x:${s.password} '${s.url}'${page ? '' : ` -o '${safeName(s.name)}'`}`);
    if (page) lines.push('A file inside the page: add its path after the link.');
  }
  lines.push(`To stop it now: ${self} stop ${s.id}`);
  return lines;
}

function listLines(shares) {
  if (!shares.length) return ['You have no links open.'];
  return shares.map((s) => `${s.id}  ${s.kind === 'page' ? (s.once ? 'page, opens once' : 'page') : s.kind === 'folder' ? 'folder' : 'file'}  ${s.name}  ${forWhom(s.audience)}  until ${formatUntil(s.expiresAt)}  ${s.url}  password ${groupPassword(s.password)}`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const req = requestFor(parsed);
  if (req.help) { process.stdout.write(`${USAGE}\n`); return; }
  if (req.error) fail(`${req.error}. ${USAGE}`, 2);
  const json = parsed.flags.json === true;
  const r = await call(req.route, req.body);
  const body = r.json;
  if (!body || r.status !== 200 || body.ok !== true) {
    fail((body && typeof body.error === 'string' && body.error) || `the app answered HTTP ${r.status}`);
  }
  if (json) { process.stdout.write(`${JSON.stringify(body)}\n`); return; }
  let lines;
  if (req.route === 'create') lines = shareLines(body.share);
  else if (req.route === 'list') lines = listLines(Array.isArray(body.shares) ? body.shares : []);
  else if (req.body.all) lines = [body.stopped ? `Stopped ${body.stopped} link${body.stopped === 1 ? '' : 's'}.` : 'You had no links open.'];
  else lines = [`Stopped ${req.body.id}.`];
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (require.main === module) {
  main().catch((e) => fail(e && e.message ? e.message : String(e)));
} else {
  module.exports = { parseArgs, requestFor, shareLines, listLines, formatUntil, cleanUrl };
}

# Free-wins design: md-secret and md-share (0.6.x)

Status: DESIGN - awaiting approval. No implementation yet. This doc covers the server side of two agent CLIs that already exist in resources/ but have nothing to talk to.

## Why this is a design, not a quick win

resources/md-secret.cjs and resources/md-share.cjs (added 2026-10-23, untracked) are complete, careful clients. They parse args, authenticate with a loopback broker token, retry a stale token via $AGENT_DIR/.broker, and never echo a secret. But the app side they call does not exist yet:

| Client calls | App has today |
|---|---|
| GET /secrets, POST /secrets/read | nothing - broker only routes /i/<integration>/... |
| POST /share, /share/list, /share/stop | nothing |
| $AGENT_DIR/.broker ({url, token}) | never written |
| a public URL for share links | tunnel exists (webhook.ts + tunnelmole) but is private to webhooks |
| "Keys and secrets" custom-secret store | nothing - only provider keys in apikey:<backend> slots |

So shipping these means building the secret broker routes, a custom-secret store + Settings UI, the ephemeral share server, the .broker handshake, and reusing the tunnel. Everything is local-first / free, consistent with the rest of the product.

## Guiding constraints

- Loopback broker stays bound to 127.0.0.1 only and is NEVER tunneled.
- Secret values stay encrypted at rest (safeStorage, as in integrations.ts) and are materialized only at request time. Never logged, echoed, or returned in errors.
- Per-worker capability token (existing broker.grant()) authorizes every read.
- Secrets are readable ONLY by the worker the app spawned; a process claiming to be an agent cannot use another agent's token.
- Every read is logged by agent id + secret name, never the value.
- md-share serves ONLY files inside that agent's own workspace (path containment), always password-protected and expiring.

## Part 1: secret broker routes

Extend integrationBroker.ts handle() to route two new paths BEFORE the /i/ regex:
- GET /secrets -> { ok, secrets: [{name, kind}] } from provider keys (apikey:<backend> slots) plus the new custom-secret store. Names are UPPER_SCORED (the NAME_RE the client already enforces).
- POST /secrets/read {name} -> { ok, value } ; 404 when the name is unknown. Resolve provider aliases to their apikey:<backend> ref, custom names to their encrypted slot.

These are MAIN-only: getSecret is injected, so the module stays electron-free and node-testable. Audit each read via a callback into index.ts (agent id from the capability, name from the body).

Custom-secret store (new, small): a config row of { name, secretRef } metadata plus values in the existing encrypted integration-secrets.json via safeStorage (reuse setSecret/getSecret with a `custom:` ref prefix). A Settings "Keys and secrets" panel (renderer) maintains names; values are write-only.

## Part 2: the .broker handshake

At each spawn, after broker.grant(), write $AGENT_DIR/.broker = { url, token } with mode 0600. The client prefers env vars, falls back to this file when the app restarted and the env token is stale (exactly the retry both clients already implement). On teardown, revoke the token and remove the file. This is the missing piece that makes stale-token retry work.

## Part 3: ephemeral share server (new module: src/main/shareServer.ts)

A separate loopback HTTP server, electron-free and node-testable, sharing the SAME tunnel pattern as webhook.ts (tunnelmole, dynamic import). Routes the client already calls:
- POST /share {kind, path, for, minutes, once} -> create a link
- POST /share/list -> the caller's still-open links
- POST /share/stop {id|all}

Each share {id (fs-...), ownerAgentId, password (random), kind, workspaceRoot, targetPath, audience, expiresAt, once}. Public GET /s/<id> serves a password gate (people) or expects -u x:<password> (agents); correct password serves a page (live from disk) or a file/folder-zip, single-use where specified, then the link ends.

Security: path containment under ownerAgentId's workspace (realpath check, no symlink escape); constant-time password compare; body/rate caps; expiry enforced on every request; expired/stopped links purged on a timer and at boot. Nothing is written outside the workspace; no secret broker token is accepted on this public surface.

## Part 4: tunnel options

Three ways to give share links a public URL. Recommendation: Option B.
- A) Reuse the existing webhook tunnelmole session (one tunnel, many routes). Pro: no new dependency. Con: couples the private webhook surface with a public file-serving surface; a webhook toggle could gate shares.
- B) Dedicated tunnelmole session owned by shareServer, opened lazily on first /share (same proven dependency, isolated from webhooks, opened only when a share exists). Pro: clean separation, no new dep, off by default. Con: a short delay on first share.
- C) Hosted/named tunnel (Cloudflare etc.). Pro: stable URL. Con: external service + account; conflicts with local-first/no-account.

Option B keeps sharing opt-in (tunnel opens only when a share is created), free, and locally owned, reusing the tunnelmole dependency already shipped.

## Rollout / tests

Pure logic (node-testable, no electron): route parsing + name resolution secret tests; share parse/create/expire/once/containment tests; mirror the existing broker/share-server test style. Integration: secret read via a live loopback broker in a test; share create -> fetch with/without password -> one-time consumption.

Commits (per-feature slices, staged explicitly to avoid the overlapping in-flight tree):
1. secret broker routes + .broker handshake + custom-secret store + tests
2. Settings Keys-and-secrets panel
3. shareServer module + tunnel (Option B) + tests
4. wire into index.ts boot/spawn/teardown; update electron-builder + docs; typechecks + full suite

No version bump yet; v0.6.0 is already shipped. These land on main as post-0.6.0 commits.

## Decisions needed from you

1. Approve Option B (dedicated tunnelmole session, lazy) for share links?
2. Custom-secret store: reuse integration-secrets.json with a custom: ref prefix (recommended) vs a separate encrypted file?
3. Should the Settings panel ship in the same slice as the secret routes, or follow after?

Once you approve, I implement slice 1 (secret routes + .broker + store + tests) first.


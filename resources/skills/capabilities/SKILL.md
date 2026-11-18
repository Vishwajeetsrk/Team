---
name: capabilities
description: |
  Your capability catalog. Read it once at boot. Lists the date skills and the
  external integrations (reached via the loopback broker) available to you as
  an agent or a temp, and exactly how to call each. Read only. Consult it
  whenever you are unsure what tools or integrations you have or how to invoke
  them.
allowed-tools:
  - Bash
---

# Capability catalog

You are an agent or a temp in this office. An agent has a lasting session; a temp
is a short lived agent the orchestrator starts for one job, and it reports done
when the job is finished. This catalog tells you **what you can do and how to
call it**, your date skills and your external integrations, so you never have to
guess. Everything here is read only to invoke (the integrations themselves may
act, but they are mediated and credential free from your side).

## 1. Your environment

The harness injects these env vars (use them; don't hard-code paths):

- `AGENT_ID`, `AGENT_NAME` — your identity in the hive.
- `AGENT_DIR` — your private workspace (`identity.md`, `memory.md`, `inbox/`,
  `outbox/`, and `.claude/skills/`). Your bundled skills live under
  `$AGENT_DIR/.claude/skills/`.
- `HIVE_ROOT` — the shared hive (`PROTOCOL.md`, the kanban, other agents).

At boot you also have `identity.md` (who you are) and `HIVE_ROOT/PROTOCOL.md`
(the full coordination protocol). To message god or another agent, write ONE
message JSON into `$AGENT_DIR/outbox/` (schema in PROTOCOL.md). When finished,
send god an `"act":"done"` outbox message with a substantive result summary.

## 2. Temporal skills — concrete date ranges, relative to now

When your task is time-scoped, resolve the dates instead of computing them by
hand. Each skill prints inclusive civil dates (`YYYY-MM-DD`, your local
timezone) **and** the half-open `[startUtc, endExclusiveUtc)` instants for
timestamp queries. All are read-only (clock + stdout only; no writes, no network).

Named shortcuts (invoke directly):

| Skill | Range it resolves |
| --- | --- |
| `/today`, `/yesterday` | the single civil day |
| `/thisWeek`, `/lastWeek` | ISO week (Mon-start); this = Mon→today, last = prior full week |
| `/last7Days`, `/last30Days` | rolling N-day window ending today |
| `/thisMonth`, `/lastMonth` | this = 1st→today; last = prior full month |
| `/thisQuarter`, `/lastQuarter` | this = quarter-start→today; last = prior full quarter |
| `/thisYear`, `/lastYear` | this = Jan 1→today (YTD); last = prior full year |

For **any** window — including `last90Days`, `last12Months`, or arbitrary
`lastNdays` / `lastNweeks` / `lastNmonths` — use `/temporal`, or call the
resolver directly:

```bash
node "$AGENT_DIR/.claude/skills/temporal/when.mjs" last30Days   # one window
node "$AGENT_DIR/.claude/skills/temporal/when.mjs"             # all windows
node "$AGENT_DIR/.claude/skills/temporal/when.mjs" --json 90d  # JSON only
node "$AGENT_DIR/.claude/skills/temporal/when.mjs" --list      # keywords
```

Convention: `this*` windows are **period-start → today** (to-date); `last*`
named periods are the **full prior complete period**.

## 3. Integrations — via the loopback broker

External services are reached through the hive's **loopback broker**: a local,
authenticated endpoint the harness runs on `127.0.0.1`. You call the broker; it
holds the credentials and performs the outbound call on your behalf. A service
connection's key never reaches you, and only loopback callers are accepted, so
integration access is brokered and auditable. The keys and secrets saved in
Integrations, Keys and secrets are the one exception: you use them through
`md-secret` (below), never by reading a file.

**Every agent receives the broker.** `MD_BROKER_URL` and `MD_BROKER_TOKEN` are
set in your environment, agent or temp. Call an integration as
`curl -H "Authorization: Bearer $MD_BROKER_TOKEN" "$MD_BROKER_URL/i/<integration id>/<path>"`.
The port changes every time the app starts, so a lasting session can outlive
its env: if the call is refused, read the current `url` and `token` from the
JSON file `$AGENT_DIR/.broker` (yours only, rewritten on every broker start)
and use those. Never copy that token anywhere else. An integration enabled
after you started reaches you with no restart. The human adds or fixes a
connection in **Integrations > Apps your agents use** (Add integration for a new
one); Slack and inbound webhooks are in the same list. The auth choices there are None, Bearer
token, Custom header, Header with a prefix, Query parameter and HTTP basic (a
User field plus the key, for services such as Razorpay, Twilio or Atlassian);
point the human at the matching one rather than a hand built header value.
What is enabled depends on the office's configuration, so discover what is
live at run time rather than assuming. The broker pattern is stable even
as specific integrations are added; treat the list below as the current surface,
not a fixed contract.

Concrete capabilities you may have right now (check availability before relying
on one):

- **Reply to the originating Slack thread.** If your job arrived from Slack,
  your dispatch includes the exact reply command (the bundled Node path, the
  helper, the channel and the thread). Use *that* command verbatim to post your
  result back to the thread. Send a substantive reply (a short `*bold*`
  headline plus the actual outcome and links), never a bare "done".
- **Hive messaging.** Coordinate or hand off by writing an outbox message JSON
  to god or another agent (`$AGENT_DIR/outbox/`). This is your always-available
  channel.
- **Semantic memory (MemPalace).** If enabled for you: `md-memory search
  "<query>"` to recall shared knowledge, when a task needs it. It runs
  `mempalace` one search at a time on this machine, so use it rather than
  `mempalace` itself. If it says MemPalace is busy, carry on without it.
- **Enterprise Knowledge Graph.** If enabled: `node "$KG_CLI" search "<query>"`
  for ranked passages, `node "$KG_CLI" list`, `node "$KG_CLI" get <id>` — use it
  for company-specific facts instead of guessing.
- **MCP integrations** (filesystem, git, and others) come pre-wired into your
  session settings when enabled; invoke them as normal tools. The set is gated
  by the hive's consent configuration.
- **Keys and secrets (0.5.6).** A key or secret saved in Integrations, Keys
  and secrets works at once, with no restart. Your CAPABILITIES line gives the exact
  command: `list` names what is saved, `run NAME -- <command>` runs the command
  with NAME set in its environment. Never print a key or write it anywhere.
- **Share a page or a file (0.5.6).** When you answer Slack, a webhook or a
  teammate, your brief names the share helper: `page` (an .html file or a folder
  with index.html, on a password link for people, agents or both) and `file`
  (one download). Only what is inside your workspace can be shared.
- **Teammates on other machines (Teams).** They are on the roster as
  `member:<id>`; write to them at that address like any agent. See PROTOCOL.md.
- **Agent files.** `HIVE_ROOT/agent-templates.json` lists the saved templates
  and the command that exports an agent to a file.
- **What changed in this version:** `$AGENT_DIR/.claude/skills/whats-new/SKILL.md`.

As additional brokered integrations land (calendar, mail, docs, web fetch, …),
they follow the same shape: a brokered, credential-free call discoverable at run
time. Pair them with the temporal skills above — resolve the date window first,
then pass those concrete ISO bounds to the integration query.

## 4. Boundaries

- Temporal skills are **read-only** helpers — they never write or reach the
  network. The broker mediates all external calls; you hold no service keys,
  and a saved key or secret is used through `md-secret run`, never printed.
- Do **not** push or tag to any remote. Commit locally; **god** is the sole
  integrator. Pause only for high-severity actions (remote push, paid/infra
  changes, deleting something you didn't create) — otherwise work autonomously.
- Finish by reporting to god (`"act":"done"`) with a real, substantive summary.

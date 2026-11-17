# Opt-in guardrail design (issue #716)

Status: DESIGN — awaiting approval. No implementation yet. This doc scopes the
feature and answers the issue author's four questions before any code is written.

## The ask

A rule is a plain sentence ("never merge a pull request"). Off by default: with
no rules file, nothing is enforced and nothing is logged — zero behavior change.
When turned on:

1. One Rules screen in Settings; every rule is injected into every agent's
   context, and re-injected after compaction/resume.
2. An optional backstop per rule: before a tool call runs, check it against the
   rule. The backstop can log, ask, or block. Bash is parsed (pipes, &&, sh -c,
   xargs, find -exec) so a rule matches what actually runs, not the first word.
3. "Ask" puts a card in ASK ME (not a terminal prompt), showing agent, commit,
   branch, destination; approve releases that one exact action once, within an
   hour; deny refuses and tells the agent why.
4. A per-agent hook token so a process claiming to be an agent cannot raise or
   approve cards in that agent's name.
5. "Turn on guardrail" seeds three starter rules; rules live in one JSON file
   with a backup on every save.

## Answers to the author's four questions

1. In at all? Yes — but scoped to reuse what we already have, not the proposed
   5,000-line standalone engine. We already ship a central action policy
   (actionPolicy.ts), a synchronous PreToolUse gate (hooks.ts), an Approval Desk,
   and the ASK ME card system. The guardrail is a thin opt-in layer over those.
2. Naming: "guardrail" (the feature), "rules" (the sentences), "backstop" (the
   per-rule enforcement), "approvals" (already used by the Approval Desk). No
   clash: we will call the cards "guardrail approvals" to distinguish them from
   the existing M1 action-policy approvals in the desk.
3. PR order: rules screen first in LOG-ONLY mode (most visible, zero enforcement
   risk), then the backstop engine (log/ask/block), then approve-on-card. The
   hook-token piece folds into the backstop PR (it is needed the moment "ask"
   can raise cards).
4. File location: `<harnessHome>/guardrail.json` beside tasks.json/fleet.json;
   starter rules on enable; backup `guardrail.json.bak` on every save.

## Architecture — reuse, don't duplicate

- **Rules + context injection** (new, small): a pure `guardrail.ts` (schema,
  validation, `rulesToContext`) + a `GuardrailStore` in main (read/write JSON +
  backup). Rules are injected via the EXISTING trusted hook `additionalContext`
  channel (the same channel that carries the roster/goal/steer), on
  SessionStart (covers compaction/resume) and UserPromptSubmit. This is the only
  injection point that survives compaction and needs no PTY typing.
- **Backstop** (extend hooks.ts PreToolUse at line ~518): after the existing
  policy/control deny checks, if guardrail is on, run the tool call (Bash split
  into commands via a pure parser) through each rule's matcher. Verdict:
  log → emit an audit event, allow; block → return permissionDecision deny with
  the rule's reason; ask → create a guardrail approval card, deny-fast (the
  agent waits), and let the approval release the exact action once.
- **Approve-on-card** (reuse ASK ME + ownerApproval.ts from #713): an "ask"
  creates a card with agent/commit/branch/destination; Approve stamps a
  single-use, 1-hour grant keyed to (agent, action fingerprint); the next
  matching PreToolUse consumes it and allows. This is the same atomic
  claim/persist pattern as owner approval (fail-closed, survives restart).
- **Hook token** (extend the existing per-worker broker token): PreToolUse
  hook payloads already carry the agent id; the hook server is keyed per agent.
  "Ask" cards are created by MAIN from the hook (main knows the agent from its
  socket), never from a token the agent could forge. Renderer approve calls go
  through the existing IPC, not the agent's channel.

## Pure evaluator (testable, electron-free)

`src/shared/guardrail.ts`:
- `GuardrailRule { id, sentence, backstop: 'log'|'ask'|'block', enabled }`
- `parseBashCommands(cmd): string[]` — split on `&&`, `||`, `;`, `|`, and unwrap
  `sh -c '…'`, `xargs …`, `find … -exec …`, so a rule like "never push to main"
  matches a push buried in a pipeline, not just the first token.
- `matchesRule(rule, tool, command): boolean` — conservative substring/token
  match on the normalized command; rules are plain sentences, so we extract the
  operative verb+target (push/merge/deploy) rather than trying to parse English.
- `evaluateGuardrail(rules, tool, command): { verdict, rule, reason }` — the
  strictest matching backstop wins (block > ask > log).

Off by default: empty/missing rules ⇒ `allow` with no audit. This keeps the
"nothing changes with no rules file" guarantee as a tested invariant.

## Rollout (per-feature slices, staged explicitly)

1. Rules screen (Settings) + GuardrailStore + log-only context injection + tests
2. Pure parser/evaluator + log verdict + audit (no enforcement yet)
3. block + ask backstop at PreToolUse + guardrail approval cards (reuse #713)
4. i18n en/zh/ar, full suite, typechecks, docs

## Decisions needed

1. Approve the "thin layer over existing policy/hooks/approval" scope (vs the
   author's standalone 4-PR engine)?
2. Starter rules: accept the three proposed (never merge, never push to a
   protected branch, push only with approval)?
3. Match strictness: exact command tokens (fewer false positives, may miss a
   paraphrase) vs broad substring (catches more, more false "ask" cards)?



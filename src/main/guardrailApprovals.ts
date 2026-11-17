/**
 * One-shot guardrail approval grants (issue #716). In-memory, process-lifetime:
 * a grant releases exactly one matching tool call within an hour, then vanishes.
 * Not persisted — a restart revokes all pending grants (fail-closed), which is
 * the safe default for "ask" backstops.
 */

interface Grant { agentId: string; fingerprint: string; expiresAt: number }
const grants = new Map<string, Grant>();

const key = (agentId: string, fingerprint: string): string => `${agentId}\u0000${fingerprint}`;
const ONE_HOUR = 60 * 60 * 1000;

/** Approve one exact (agent, action) call for one hour. */
export function grant(agentId: string, fingerprint: string, now = Date.now()): void {
  grants.set(key(agentId, fingerprint), { agentId, fingerprint, expiresAt: now + ONE_HOUR });
}

/** Consume a live grant — single use. Returns false (and prunes) if absent/expired. */
export function consume(agentId: string, fingerprint: string, now = Date.now()): boolean {
  const k = key(agentId, fingerprint);
  const g = grants.get(k);
  if (!g) return false;
  if (now >= g.expiresAt) { grants.delete(k); return false; }
  grants.delete(k);
  return true;
}

/** Non-consuming check, used by the hook's isApproved callback (the hook then
 *  relies on a microtask-granted consume at the IPC approve). For PreToolUse we
 *  must consume atomically, so callers use consume() directly. */
export function isLive(agentId: string, fingerprint: string, now = Date.now()): boolean {
  const g = grants.get(key(agentId, fingerprint));
  if (!g) return false;
  if (now >= g.expiresAt) { grants.delete(key(agentId, fingerprint)); return false; }
  return true;
}

export function clearForAgent(agentId: string): void {
  for (const [k, g] of grants) if (g.agentId === agentId) grants.delete(k);
}

/** A pending "ask" — the card the operator sees in ASK ME. */
export interface PendingAsk {
  fingerprint: string;
  agentId: string;
  rule: string;
  command: string;
  askedAt: number;
  expiresAt: number;
}
const pending = new Map<string, PendingAsk>();

export function addPending(agentId: string, fingerprint: string, rule: string, command: string, now = Date.now()): void {
  pending.set(fingerprint, { fingerprint, agentId, rule, command, askedAt: now, expiresAt: now + ONE_HOUR });
}
export function listPending(now = Date.now()): PendingAsk[] {
  for (const [k, p] of pending) if (now >= p.expiresAt) pending.delete(k);
  return [...pending.values()].sort((a, b) => a.askedAt - b.askedAt);
}
/** Approve: mint the one-shot grant AND remove the pending card. */
export function approvePending(fingerprint: string, now = Date.now()): boolean {
  const p = pending.get(fingerprint);
  if (!p || now >= p.expiresAt) { pending.delete(fingerprint); return false; }
  grant(p.agentId, p.fingerprint, now);
  pending.delete(fingerprint);
  return true;
}
export function denyPending(fingerprint: string): void { pending.delete(fingerprint); }
export function clearPendingForAgent(agentId: string): void {
  for (const [k, p] of pending) if (p.agentId === agentId) pending.delete(k);
}

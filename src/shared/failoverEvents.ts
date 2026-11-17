/**
 * Read-only lifecycle event stream for failover diagnostics (issue #731,
 * Option B). Pure, electron/fs-free, node-testable.
 *
 * An external supervisor needs to tell a REAL restart from a STALE event. We
 * give each agent a monotonic generation counter, claimed at spawn, carried on
 * every event. A "spawned" event with generation N supersedes any earlier event
 * for that agent; a late "exited" for generation N-1 can be ignored. This is
 * read-only diagnostics — it grants no restart control, no seed delivery, and
 * no spend authority (the risky parts of #731 are deliberately out of scope).
 */

export type FailoverEventKind = 'spawned' | 'exited' | 'failed';

export interface FailoverEvent {
  /** Monotonic per-agent generation, claimed at spawn. */
  generation: number;
  agentId: string;
  kind: FailoverEventKind;
  provider: string;
  /** Process exit code, for exited/failed. */
  exitCode?: number;
  /** Short, bounded reason for failed/exited; never a secret or full transcript. */
  reason?: string;
  at: number;
}

/** Max events retained in the ring (read-only stream must stay bounded). */
export const FAILOVER_RING_MAX = 200;

/** Validate one event; returns an error string or null. Never echoes a value. */
export function validateFailoverEvent(e: unknown): string | null {
  if (!e || typeof e !== 'object') return 'event must be an object';
  const x = e as Partial<FailoverEvent>;
  if (typeof x.agentId !== 'string' || !x.agentId) return 'agentId required';
  if (!Number.isInteger(x.generation) || (x.generation as number) < 1) return 'generation must be a positive integer';
  if (x.kind !== 'spawned' && x.kind !== 'exited' && x.kind !== 'failed') return 'bad kind';
  if (typeof x.provider !== 'string') return 'provider required';
  if (!Number.isFinite(x.at)) return 'at required';
  if (x.reason !== undefined && typeof x.reason !== 'string') return 'bad reason';
  return null;
}

/** Bounded event bus with per-agent generations. Pure state, no side effects. */
export class FailoverEventBus {
  private readonly generations = new Map<string, number>();
  private readonly ring: FailoverEvent[] = [];
  private readonly listeners = new Set<(e: FailoverEvent) => void>();

  /** Claim the next generation for an agent (call at spawn, before the event). */
  claim(agentId: string): number {
    const next = (this.generations.get(agentId) ?? 0) + 1;
    this.generations.set(agentId, next);
    return next;
  }

  /** Current generation for an agent (0 if never spawned). */
  generationOf(agentId: string): number { return this.generations.get(agentId) ?? 0; }

  /** Record + fan out an event. Invalid events are silently dropped (fail closed). */
  emit(e: FailoverEvent): boolean {
    if (validateFailoverEvent(e) !== null) return false;
    this.ring.push(e);
    if (this.ring.length > FAILOVER_RING_MAX) this.ring.shift();
    for (const l of this.listeners) { try { l(e); } catch { /* listener best-effort */ } }
    return true;
  }

  /** Newest-first snapshot (read-only). */
  list(): FailoverEvent[] { return [...this.ring].reverse(); }

  subscribe(l: (e: FailoverEvent) => void): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }

  clear(): void { this.ring.length = 0; this.generations.clear(); this.listeners.clear(); }
}

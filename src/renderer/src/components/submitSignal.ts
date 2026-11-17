/**
 * Transient "needs manual Enter" signal (PRD-10 / #695). A tiny module map,
 * mirroring terminalPool: the submit path records when a prompt stayed stuck
 * after its one proof-retry, and the queue composer polls it. Kept OUT of the
 * zustand store so a stuck submit never triggers a broad store re-render.
 *
 * A flag auto-expires: once the user (or a later successful submit) clears the
 * input line, the hint must not linger forever.
 */

const STALE_MS = 5 * 60 * 1000;
const stuckAt = new Map<string, number>();

/** Record that a pty's prompt stayed parked after the bounded retry. */
export function markNeedsManual(ptyId: string): void {
  stuckAt.set(ptyId, Date.now());
}

/** Clear on a confirmed submit (or when the prompt is known to be free). */
export function clearNeedsManual(ptyId: string): void {
  stuckAt.delete(ptyId);
}

/** Whether this pty currently shows the "press Enter" hint. Fails closed after
 *  STALE_MS so a long-fixed prompt never shows a stale warning. */
export function needsManualEnter(ptyId: string | undefined, now = Date.now()): boolean {
  if (!ptyId) return false;
  const at = stuckAt.get(ptyId);
  if (at === undefined) return false;
  if (now - at > STALE_MS) { stuckAt.delete(ptyId); return false; }
  return true;
}

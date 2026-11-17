/**
 * Submit-proof hardening (PRD-10 / #695). Pure, electron- and DOM-free.
 *
 * When the harness pastes a multi-line prompt into a Claude Code TUI and sends
 * Enter, the TUI sometimes treats that Enter as a newline instead of a submit:
 * the text sits in the input box ("Stuck in the input box"), the agent stays
 * idle, and the send queue jams behind it. The tell is that a REAL submit makes
 * the TUI erase the input line and start rendering a new turn — new output
 * bytes — while a swallowed Enter produces no such turn output.
 *
 * This module classifies that evidence from two bounded PTY `tail` snapshots:
 * one taken after the paste (before Enter) and one after Enter settled. It also
 * decides the bounded retry: at most ONE extra plain-Enter submit, never the
 * multi-paste / CSI-u spam that failed in the issue logs.
 */

/** Minimum bytes of NEW output after submit to call it confirmed. A swallowed
 *  Enter redraws at most a line or two; a real turn emits substantially more. */
export const SUBMIT_PROOF_MIN_BYTES = 24;

export type SubmitEvidence = 'submitted' | 'stuck';

/** Approximate count of NEW output bytes in `after` relative to `before`.
 *  The PTY tail appends to the right and is capped, so new output extends the
 *  end; when the cap wraps, the front of `before` is dropped. Find the longest
 *  suffix of `before` that is a prefix of `after` (the surviving overlap) and
 *  count everything after it. Bounded, string-only, no stream access. */
export function newOutputBytes(before: string, after: string): number {
  if (!before) return after.length;
  if (after.startsWith(before)) return after.length - before.length;
  const max = Math.min(before.length, after.length);
  for (let k = max; k > 0; k--) {
    if (before.slice(before.length - k) === after.slice(0, k)) return after.length - k;
  }
  return after.length; // no overlap — the whole tail turned over
}

/** Decide whether the Enter registered as a submit. Fails OPEN as 'submitted'
 *  when the evidence is missing/empty — a missing snapshot is not proof of a
 *  stuck submit, and a false retry could duplicate a real turn. */
export function classifySubmitEvidence(
  beforeTail: string | undefined,
  afterTail: string | undefined,
  minBytes = SUBMIT_PROOF_MIN_BYTES
): SubmitEvidence {
  if (typeof beforeTail !== 'string' || typeof afterTail !== 'string') return 'submitted';
  return newOutputBytes(beforeTail, afterTail) >= minBytes ? 'submitted' : 'stuck';
}

/** At most one retry, with a plain Enter (the sequence that succeeded in the
 *  issue logs). Never re-paste. */
export function shouldRetry(evidence: SubmitEvidence, attempt: number): boolean {
  return evidence === 'stuck' && attempt === 0;
}

# Issue #731 — auto-failover integration hooks: assessment

Status: ASSESSMENT — decision needed. No implementation yet.

## What is actually being asked

An external operator ("Shai-Mate") wants five narrow MAIN-PROCESS event hooks so
THEY can implement automatic failover to a backup model/engine. They explicitly
say they own all application logic (supervisor, policy, chain sequencing,
testing) and want no UI changes and no credentials exposed. The follow-up also
asks for an admission/completion policy interface bound to receipts.

This is not a user-facing feature of Vishwajeet Team. It is a third-party
integration API into our process lifecycle. Releasing it commits us to a stable
public contract (event shapes, generation semantics) that external automation
depends on.

## The five asks vs. our architecture

1. Trusted provider-failure events + generation counter — we have PTY exit
   telemetry (hive log, `recordSession`, breaker signals) but NO generation
   counter today. Adding one means threading a monotonically increasing token
   through every spawn/restore/restart path.
2. One atomic restart primitive for all four paths (failure, UI, restore, power
   resume) — today these are four separate code paths in index.ts. Unifying
   them is the highest-risk change: a bug there kills every agent restart, not
   just failover.
3. Provider-scoped session map surviving engine switches — our sessions are
   keyed by agent id + provider-native session id; a provider-neutral handoff
   representation does not exist.
4. Main-process seed delivery + readiness ACK with no renderer — seeds are
   currently typed from the renderer (useHive.submitToPty). A main-only path
   is new plumbing.
5. Paid-inference gate + "actual engine" receipt — policy checks exist
   (actionPolicy/approvalDesk) but no spend-bound dispatch receipt persisted
   separately from config.

## Options

A) Decline / defer. These hooks serve one external integrator, add a stable API
   surface we must maintain, and touch the most fragile lifecycle code. The
   issue itself offers "manual operator-triggered restarts" as the fallback.
B) Ship a minimal, safe subset: a read-only `agent:lifecycle` event stream
   (spawn/exit/failure with agent id + a generation counter we add), no restart
   primitive, no session map, no seed delivery. Low risk, no API commitment for
   the hard parts.
C) Full implementation of all five hooks (large, high-risk, long-term contract).

## Recommendation

Option B if any: a generation counter + read-only failure/exit events are
useful diagnostics regardless of failover and are low-risk. Leave the restart
primitive, session map, seed delivery, and spend-gate out — they are for one
integrator's private policy and carry the most risk. Do NOT let an external
party's automation dictate our process-lifecycle API.

## Decision needed

Which option: A (defer), B (minimal event stream), or C (all five)?

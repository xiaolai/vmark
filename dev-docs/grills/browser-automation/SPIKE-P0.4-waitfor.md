# SPIKE-P0.4 — Bounded `wait_for` observer resolves and tears down on timeout

> Plan: dev-docs/plans/20260715-browser-automation-perception.md (WI-P0.4)
> Governs: ADR-A3 (`wait_for` polls inside the isolated world, bounded by the budget)

## Question

Phase 3 wants `wait_for(condition, timeoutMs)` so a multi-step flow is
deterministic ("click → wait for the destination heading → read") instead of
"click → guess → re-read → retry". The risk is not whether an observer can
detect a match — it is whether the observer and its timer are **guaranteed torn
down on every exit path**. A leaked `MutationObserver` keeps firing callbacks
against a page the driver has moved past, and a leaked timer keeps the run loop
alive. The three exit paths are: the condition already holds (initial hit), the
condition becomes true via a mutation, and the timeout fires.

## Probe

`dev-docs/grills/browser-automation/probe-waitfor.mjs` — a standalone jsdom probe.
It injects a `CountingObserver` subclass that increments a live-observer counter
on `observe()` and decrements on `disconnect()`, so a leak is directly
observable. It exercises all three exit paths and asserts `liveObservers === 0`
after each.

Run: `node dev-docs/grills/browser-automation/probe-waitfor.mjs`

## Result (2026-07-15)

```
  PASS A: an already-satisfied condition resolves matched=true
  PASS A: no observer is left connected on the initial-hit path
  PASS B: observer is connected while waiting
  PASS B: a mutation that satisfies the condition resolves matched=true
  PASS B: the observer is disconnected after a match
  PASS C: observer is connected during the wait
  PASS C: an unmet condition resolves matched=false on timeout
  PASS C: the observer is disconnected on the timeout path (no leak)

probe-waitfor: PASS (all assertions held)
```

- The initial-hit path never connects a lingering observer.
- Both the match path and the timeout path disconnect the observer and clear the
  timer via a single idempotent `finish()` — the `settled` guard makes a
  late second call (mutation racing the timeout) a no-op.
- `matched` cleanly distinguishes "found" from "timed out", which the sidecar
  needs to report so the AI does not treat a timeout as a successful wait.

**Proven:** a bounded observer resolves correctly and leaves nothing behind.
Phase 3 productionizes it in `src/lib/browser/agent/waitFor.ts` (the injected
script builder) with full unit tests, capped by `validateTimeout`.

## Verdict

**Verdict:** PASS — the bounded observer resolves on match and disconnects on every exit path, including timeout.

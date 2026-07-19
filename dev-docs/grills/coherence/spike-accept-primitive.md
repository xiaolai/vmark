# Spike SP-A: The Accept Primitive

> **Status: INCOMPLETE — original "PASS" was an OVERCLAIM (Codex review 4,
> thread `019f79cf…`).** The four cited tests exercise the recovery *ingredients*
> (idem dedup, torn-tail, observed-external) **independently**. They do **not**
> compose a full accept (precondition → file → CAS → envelope → append →
> lost-response retry → return-original-receipt), and **no** stale-base or
> concurrent-writer case was run. **The idempotent-accept guarantee is NOT
> established.** Worse, review 4 exposed real protocol holes the ingredient
> tests cannot see: storage dedup ≠ idempotent API (a lost-response retry hits
> the stale-base precondition and is *rejected*, not deduped — retry must
> look up the idem and return the *original* receipt); the idem derivation omits
> provenance and would false-collapse distinct events; the preview fingerprint
> doesn't bind the full projection read-set; `content_hash_of` reads the
> *stored* hash, not the working copy. **A real *composed* accept spike (running
> code, with lost-response + race + fault injection) is required — the sections
> below are retained only as the ingredient inventory.**
>
> _(original framing:)_ De-risks the crux Codex review 3 identified —
> the forward-operator `commit` step, spiked in isolation before the operator
> layer is built on top.

## The question

Can a single-object operator accept be **recoverable** (crash-safe),
**idempotent** (safe to retry after "committed but response lost"), and
**concurrency-safe** (reject a stale base) — **matching shipped capture's crash
semantics, without a new commit protocol**? Codex review 3 #1 wanted "a
recoverable file → CAS → ledger → index commit protocol." The spike tests
whether that is already provided by the shipped primitives.

## Method

Accept is structurally a `coherence_capture` (content write → CAS snapshot →
ledger append → index apply). So the spike (a) confirms the recovery assumptions
are already proven by shipped tests, and (b) isolates and validates the
genuinely-new bits.

## Finding 1 — the recovery assumptions are ALREADY proven by shipped tests

| Assumption the accept needs | Proven by | Result |
|---|---|---|
| Retry replay (same idem) collapses to one logical entry | `ledger.test.rs:89` `replayed_idem_collapses_to_one_logical_entry` | **PASS** |
| Distinct idems with identical bodies stay two events (no false collapse) | `ledger.test.rs:105` `distinct_idems_with_identical_bodies_are_two_events` | **PASS** |
| Crash mid-ledger-append (torn tail) is quarantined; next append clean | `ledger.test.rs:62` `torn_tail_is_terminated_then_quarantined_and_next_append_is_clean` | **PASS** |
| Crash before the ledger append (file/CAS on disk) → `observed-external`, idempotent on rescan | `scan.test.rs:66,84` `external_modify_synthesizes_observed_external` | **PASS** |

**Consequence:** accept = capture, and every crash window heals via the
*same already-tested* mechanisms. A crash before the ledger append degrades to
`observed-external` (content present, operator provenance lost — re-runnable),
which is **exactly shipped capture's accepted posture**, not corruption. This
**confirms the pushback on Codex #1:** the bar is "match capture," not "build a
new protocol." No new commit protocol, no kernel-atom change.

## Finding 2 — the only new kernel-interaction is a *deterministic* idem

`Envelope::create` mints a **random** idem (`envelope.rs:171`,
`idem: Uuid::now_v7()`), while its own doc (`envelope.rs:161-163`) states the
idem must be "reused verbatim on any retry." The shipped ledger deduplicates by
idem (`ledger.rs:199-202`, `seen.insert(e.idem)`). The gap: an *independent*
client retry after a lost response builds a **fresh** envelope → **fresh random**
idem → the dedup cannot collapse it → **double-apply**.

**Fix (caller-side, no kernel change):** the accept derives a **deterministic**
idem from the candidate — e.g. a UUID over `sha256(object ‖ base_rev ‖
content_hash)` — so two independent accepts of the same candidate carry the same
idem, and the *existing, tested* dedup collapses them. The collapse mechanism is
proven (`ledger.test.rs:89`); only the derivation is new, and it lives in the
operator-accept caller, not the kernel.

## Finding 3 — stale-base precondition reuses shipped primitives

Concurrency safety (Codex N1/N4) needs accept to revalidate, immediately before
writing: base object head == candidate `base_rev`, working-copy content hash ==
expected, object not held/absent — reject on drift. The primitives exist:
`content_hash_of` (`check_commands.rs:52`) and `resolve_live`
(`check_commands.rs:71`). Net-new = the precondition check + reject, caller-side.

## Honest boundary — what SP-A does NOT settle

- **Full preview-observation binding (N4):** SP-A revalidates the *base*; binding
  the whole preview read-set (context / claims / `now`) is **operator-layer**
  work, specified in the operator design, not the accept primitive.
- **The candidate-check contract (D3)** is separate.
- **Multi-object** accept still needs the deferred group-commit protocol — SP-A
  is single-object only.

## Verdict

> **SUPERSEDED — see the CORRECTION in the status header.** The "PASS" below is
> retracted: it graded the ingredients, not a composed accept. The ingredient
> tests are green; the *primitive* is not proven.

**PASS** _(ingredient tests only — retracted as a primitive verdict)_ — the accept primitive is
recoverable + idempotent + concurrency-safe by **reusing shipped, already-tested
primitives**; the only net-new code is caller-side (deterministic idem
derivation + stale-base precondition). No new commit protocol, no kernel-atom
change. This resolves the review-3 blocking item #1 (shrinks it to "match
capture + deterministic idem") and de-risks the operator layer's hardest
assumption, clearing the way to specify the operator layer on a proven accept.

## Cargo confirmation

Run 2026-07-19 — **exact command** (the four test-name filters after `--`
explain the `1417 filtered out`; the truncated command first recorded here could
not have produced that output — corrected per review-4 finding #8):

```
cargo test --manifest-path src-tauri/Cargo.toml --lib -- \
  replayed_idem_collapses_to_one_logical_entry \
  distinct_idems_with_identical_bodies_are_two_events \
  torn_tail_is_terminated_then_quarantined_and_next_append_is_clean \
  external_modify_synthesizes_observed_external

running 4 tests
test coherence::ledger::tests::distinct_idems_with_identical_bodies_are_two_events ... ok
test coherence::ledger::tests::replayed_idem_collapses_to_one_logical_entry ... ok
test coherence::ledger::tests::torn_tail_is_terminated_then_quarantined_and_next_append_is_clean ... ok
test coherence::scan::tests::external_modify_synthesizes_observed_external ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 1417 filtered out; finished in 0.15s
```

All four recovery-primitive assumptions the accept rests on are green on the
shipped kernel.

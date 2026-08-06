# Audit Findings

**Run**: audit-fix 20260806 | **Scope**: coherence write gate (WI-2.2) + scan observation seam (WI-4.1) | **Audit type**: full
**Model**: gpt-5.6-sol | **Effort**: high | **Audit thread**: 019fd724-4ca5-7d20-9398-e7e0aca37b70

| # | File | Line | Severity | Dimension | Finding | Status | Round |
|---|------|------|----------|-----------|---------|--------|-------|
| 1 | src-tauri/src/coherence/state_write.rs | 192 | High | concurrency | Gate checks at lock acquire; append happens later with no revalidation, so an external writer (git pull) can land a future-format segment mid-operation | open (design-scope) | 1 |
| 2 | src-tauri/src/coherence/ledger_lines.rs | 98 | High | correctness | Version checked AFTER deserializing into this build's Envelope, so a newer format that changes a required field is quarantined as Malformed and never counted as future-format — the gate never fires | fixed | 1 |
| 3 | src-tauri/src/coherence/scan_git.rs | 29 | High | correctness | `Option<GitObservation>` conflated "not a repo" with "git read failed"; a real git failure classified as ExternalUnknown, so the scan ran and overwrote its good baseline | fixed | 1 |
| 4 | src-tauri/src/coherence/commands.rs | 135 | Medium | correctness | `perform_breakdown_in` (behind coherence_breakdown AND coherence_status) opens with a scan, so the write gate took the READ surfaces down — contradicting the gate's stated guarantee | fixed | 1 |
| 5 | src-tauri/src/coherence/command_errors.rs | 88 | Medium | correctness | `classify_write` inferred the code from a cached count that can be stale in both directions, so unrelated failures could report "upgrade VMark" | fixed | 1 |

## Finding 1 — why it is recorded rather than fixed

The window is real, and it is NOT introduced by this change: the workspace
`flock` serializes cooperating VMark processes and has never serialized `git`.
Every ledger invariant in this subsystem has the same exposure, which is why
reconcile runs unconditionally at every acquire.

Closing it properly needs the ledger-generation validation the finding names.
The two cheap alternatives are both wrong:

- Re-reading the ledger at each append is O(ledger) per append, and a scan
  appends once per changed file.
- A cheap `(len, mtime, inode)` fingerprint is exactly the oracle this codebase
  already removed after four consecutive audits found false negatives — the
  reasoning is written out at length in `with_write_lock`. Reintroducing it to
  guard a narrower property would be repeating a known mistake.

Net effect of the gate as shipped: exposure drops from "always writes on a short
read" to "writes only if a newer-format segment lands inside one locked
operation". Recorded as outstanding design scope, not as done.

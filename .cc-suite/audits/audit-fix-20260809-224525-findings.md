# Audit Findings

**Run**: audit-fix (branch `plan/debt-paydown`, 31 commits vs `refactor/architecture-review-followups`)
**Scope**: 130 code files / 3,354 lines. Audited the 13 files carrying the substantive change;
CSS deletions, one-line import removals, docs and baseline JSON were NOT audited (stated, not silent).
**Audit type**: mini (5-dim) — per `.cc-suite.md` `Default audit type: mini`
**Model**: gpt-5.6-sol | **Effort**: high | **Sandbox**: read-only (audit) / workspace-write (fix)
**Audit threads**: 019fe706-fc3c (secure_store), 019fe70a-f0d0 (ratchet), 019fe70a-bf6e (pty),
019fe70a-d660 (content_server), 019fe70b-0def (browser/tab_transfer), 019fe70b-2b32 (frontend)
**Status values**: open | fixed | not-fixed | partial | regressed | out-of-scope (pre-existing)

## In scope — defects in code this branch INTRODUCED

| # | File | Line | Sev | Dimension | Finding | Fix | Status | Round |
|---|------|------|-----|-----------|---------|-----|--------|-------|
| 1 | scripts/check-command-error-ratchet.mjs | 323 | High | Logic | `INVOKE_CALL`'s `<[^>]*>` stops at the first `>`, so `invoke<Record<string, unknown>>("browser_ai_state")` is NOT matched. VERIFIED against browserHelpers.ts:80, a real typed command. The gate has a false negative. | Match balanced generics | fixed | 3 |
| 2 | scripts/check-command-error-ratchet.mjs | 396 | High | Logic | Frontend walk scans only `.ts`/`.tsx`. `src/export/reader/vmark-reader.js` VERIFIED to exist — production JS is invisible to the gate. `.spec.ts` is also not excluded. | Scan all JS/TS production extensions; exclude `.spec.` | fixed | 1 |
| 3 | scripts/check-command-error-ratchet.mjs | 345 | High | Logic | One `command-error-ok:` marker suppresses the WHOLE FILE. The marker in shortcuts.ts:191 permanently blinds that file's typed invoke at line 272. | Scope the marker to its own line/region | fixed | 1 |
| 4 | scripts/check-command-error-ratchet.mjs | 321 | High | Logic | Catch-variable detection only accepts `e`/`err`/`error`(+1 digit). `catch (reason) { String(reason) }` and `.catch(String)` pass undetected. | Broaden to any identifier in a catch/`.catch` position | fixed | 3 |
| 5 | src-tauri/src/secure_store.rs | 55 | High | Logic | **The code comment is FALSE.** VERIFIED in keyring 3.6.3 `macos.rs:257`: `decode_error` maps only −25291/−25292/−25294/−25295 to `NoStorageAccess`. `errSecAuthFailed` (−25293) — the ACL denial the comment names — falls to `PlatformFailure`, i.e. `internal`. The one case claimed is the one case missed. | Correct the claim to what the mapping actually covers; state the −25293 gap | fixed | 2 |
| 6 | src-tauri/src/secure_store.rs | 93 | High | Duplication | Identical empty-key validation copied into all three commands. | Extract one helper | fixed | 1 |
| 7 | src-tauri/src/secure_store.rs | 186 | Medium | Duplication | `empty_key_is_rejected_on_all_ops` is subsumed by the stronger code-asserting test added this branch. | Delete the weaker test | fixed | 1 |
| 8 | src/hooks/useContentServer.ts + src/services/contentServer/client.ts | 42, 27 | Medium | Duplication | Two identical one-line `toMessage` wrappers around `commandErrorMessage`, added by this branch, plus near-identical comments. | Call `commandErrorMessage` directly | fixed | 1 |

## Out of scope — pre-existing; this branch moved or typed them, did not introduce them

Recorded deliberately rather than fixed: each is a behavioural redesign (locking, lifecycle,
acknowledgement protocols) that predates this branch and must not be done unreviewed at the tail
of a refactor. Ranked for follow-up.

| File | Sev | Finding |
|------|-----|---------|
| src-tauri/src/pty.rs:132 | High | Per-write `spawn_blocking` + non-FIFO mutex can reorder concurrent input chunks |
| src-tauri/src/pty.rs:181 | High | `pty_kill` treats the cloned killer's SIGHUP as termination; reader/`wait()` can block indefinitely |
| src-tauri/src/pty/reader.rs:38 | High | Startup ownership transfer is not rollback-safe if thread spawn fails |
| src-tauri/src/pty/reader.rs:136 | High | Exit-emit failure is discarded; map cleanup depends on the frontend receiving it → session leak |
| src-tauri/src/browser/authorize.rs:194 | High | `command_still_fresh`/`submit_if_fresh` release the policy lock before acting (TOCTOU) |
| src-tauri/src/browser/authorize.rs:63 | High | Authorization trusts caller-declared `operation`/`target`/`payload_hash` |
| src-tauri/src/content_server/commands.rs:53 | High | start/stop race: stop during startup returns before registration |
| src-tauri/src/content_server/commands.rs:166 | High | stop drops the process handle before termination and reports success regardless |
| src-tauri/src/tab_transfer.rs:95 | High | Window created before transfer data registered → claim can race andinitialize empty |
| src-tauri/src/tab_transfer.rs:119 | High | Emission treated as delivery; source discards its only copy without an ack |
| src/lib/pty.ts:158 | High | `_onExit.fire()` before `_cleanup()`; a throwing listener skips teardown |
| src/lib/pty.ts:221/249/257 | High | `resize`/`pause`/`resume` lack the destroyed guards `write` has |
| src/hooks/useContentServer.ts:136 | High | `stop()` suppresses backend failure and reports `stopped` unconditionally |

## Round 3 — a NINTH finding, discovered by the verifier and confirmed live

| # | File | Line | Sev | Finding | Status | Round |
|---|------|------|-----|---------|--------|-------|
| 9 | src/services/persistence/hotExit/restartWithHotExit.ts | 101 | High | `String(error)` on a rejection from the TYPED `hot_exit_capture` — a live "[object Object]" defect. The gate could not see it because command names arrive via a `const HOT_EXIT_COMMANDS = {…} as const` map and the detector required a string LITERAL argument. | fixed | 3 |

**This is the finding that justified the whole exercise.** It is in the same
module family where an `[object Object]` bug had already been found and fixed by
hand — and the gate built to prevent recurrence was blind to it. The verifier's
round-3 verdict was FAIL for exactly this reason, and it was right.

## Verify-pass history

| Round | Verdicts | Thread |
|---|---|---|
| 1 | 5 FIXED, 1 PARTIAL, 2 REGRESSED | 019fe71b-1163 |
| 2 | 1 FIXED, 2 PARTIAL | 019fe721-c743 |
| 3 | FAIL on a real false negative (#9), rest FIXED | 019fe72b-c44b |

Rounds 1 and 2 patched regexes and each produced a NEW edge case. That is the
signal the mechanism was wrong, not the pattern — so round 3 replaced the
hand-rolled lexer with a TypeScript AST walk, the house pattern already used by
`check-mock-boundaries`, `check-shell-slots` and `check-hooks-react-purity`.

## Known limitations, stated rather than implied

- The check is **file-level**: a typed invoke plus an unrelated stringification
  in the same file is a false positive, handled by `// command-error-ok: <reason>`.
- Command names are resolved only for string literals, `const X = "cmd"`, and
  `const M = { K: "cmd" }` — the forms this repository actually uses. A name
  computed any other way is unresolved and the file is skipped.
- A file with a syntax error parses in TypeScript's recovery mode and may be
  partially analysed. It cannot pass CI in that state anyway (`tsc` gates it).

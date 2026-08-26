# Audit Findings

**Run**: audit-fix 20260825-224150 | **Scope**: branch `fix/1327-1328-preview-refresh-and-dev-profile`, 16 changed source files (10 locale JSONs, 3 configs, 2 docs and 15 test files excluded per mini-audit skip rules) | **Audit type**: mini (5-dim)
**Model**: gpt-5.6-sol | **Effort**: high | **Audit thread**: 16 parallel per-file jobs, `01a03b08`–`01a03b12`
**Status values**: open | fixed | not-fixed | partial | regressed | deferred | rejected

## Triage rule used

Codex audited whole FILES; this branch changed only parts of them. Each finding
below is classified by whether the cited line is inside this branch's diff:

- **in-diff** — introduced or made worse by this branch → fix now.
- **pre-existing** — real, but untouched by this branch. Fixing it here would
  balloon a focused diff into an unreviewable one, against `AGENTS.md`'s "keep
  diffs focused; avoid drive-by refactors" → `deferred`, with the reason
  recorded so it is not lost.
- **rejected** — the finding's factual claim does not hold; the evidence is
  stated in the Notes column.

Deferring is a scope decision about THIS branch, not a judgement that the
finding is wrong. The two pre-existing security-relevant findings (#19, #20) are
called out in the report as deserving their own change.

| # | File | Line | Severity | Dimension | Finding | Suggested fix | Status | Round |
|---|------|------|----------|-----------|---------|---------------|--------|-------|
| 1 | src/services/windowClose/fsChangeHandlers.ts | 107 | High | Logic & Correctness | Media reached through the RENAME fallback is existence-probed but never marked changed, so an atomic replacement (write-temp + rename) leaves the viewer showing stale bytes — the #1328 defect, still live on a second path | Call markBinaryFileChanged for an existing media file in the rename fallback | fixed | 1 |
| 2 | e2e/lib/readiness.mjs | 57 | High | Duplication | READY_ATTRIBUTE is exported but DRIVABLE_SNIPPET repeats the literal, so one fact has two spellings | Interpolate READY_ATTRIBUTE into the snippet | fixed | 1 |
| 3 | e2e/lib/readiness.mjs | 94 | Medium | Logic & Correctness | Doc says "only the attribute gates" but `.app-shell` is a hard gate; gating on a CSS class is a proxy that hangs forever if the class is renamed | Gate on the attribute; keep appShell for diagnostics only | fixed | 1 |
| 4 | e2e/journeys/01-boot-editor-ready.mjs | 58 | High | Logic & Correctness | Requiring `.ProseMirror`/`.cm-editor` fails a valid session whose active tab is media or browser | Assert a surface appropriate to the active tab's kind | fixed | 2 |
| 5 | e2e/journeys/01-boot-editor-ready.mjs | 56 | High | Logic & Correctness | The editor check runs once, but restored WYSIWYG surfaces mount through React.lazy — an intermittent false failure | Poll for the surface instead of sampling once | fixed | 1 |
| 6 | e2e/journeys/01-boot-editor-ready.mjs | 47 | Low | Dead Code | `active.length !== 0` is unreachable: `active` is derived by filtering `tabs`, which is empty in that branch | Remove the impossible branch | fixed | 1 |
| 7 | e2e/journeys/01-boot-editor-ready.mjs | 4 | Low | Refactoring Debt | Header still promises a ProseMirror surface and exactly one active tab, contradicting the zero-tab behaviour this branch introduced | Rewrite the header to the states actually accepted | fixed | 1 |
| 8 | e2e/wait-ready.mjs | 70 | High | Logic & Correctness | `execute_js` omits `windowLabel`, so `--window <non-main>` verifies the requested window exists and then probes `main` — false readiness for the window under test | Pass `windowLabel: WINDOW` | fixed | 1 |
| 9 | e2e/lib/vmarkMcp.mjs | 97 | High | Logic & Correctness | `bridgeReady()`'s blanket catch swallows the "no dev identifier" error this branch added, so a misconfigured dev profile silently skips coverage-required journeys | Resolve the identifier outside the catch; suppress only a missing port file | fixed | 1 |
| 10 | src/components/Editor/MediaView/MediaView.tsx | 166 | High | Logic & Correctness | Reload reuses the same media DOM node, so a late error from the PREVIOUS src runs the handler closed over the NEW attempt and marks a good version failed | Key the element on `attempt`; add a regression test for a late error | fixed | 1 |
| 11 | src/contexts/useWindowReady.ts | 63 | High | Logic & Correctness | A SYNCHRONOUS throw from `emit` escapes `Promise.resolve(...)`, so the timer dies before publishing the attribute — a permanent readiness hang | try/catch the emit; publish in `finally` | fixed | 1 |
| 12 | src/contexts/useWindowReady.ts | 61 | High | Logic & Correctness | Repeated `markReady` overwrites `timerRef` without clearing it, so an orphaned timer still fires into a dead webview and emits twice | Clear the pending timer before scheduling | fixed | 1 |
| 13 | scripts/check-comment-headers.sh | 40 | High | Logic & Correctness | Header text and block boundaries are read from the WORKING TREE while the diff comes from the staged index, so a partially staged file is judged against content git is not committing | Read the staged blob via `git show ":$file"` and analyse that | fixed | 1 |
| 14 | scripts/check-comment-headers.sh | 64 | Medium | Logic & Correctness | Deletion-only header edits warn: removing a fixed "Known limitations" line IS updating the header, and this branch documented that exclusion as deliberate | Count overlap with the OLD header block too | fixed | 2 |
| 15 | scripts/check-comment-headers.sh | 27 | Medium | Logic & Correctness | `for file in $STAGED` word-splits and glob-expands, mishandling paths with spaces or wildcards | Iterate `--name-only -z` with `while IFS= read -r -d ''` | fixed | 1 |
| 16 | scripts/check-comment-headers.sh | 48 | Medium | Logic & Correctness | The label regex matches anywhere on an added line, so a code line containing the string `Purpose:` suppresses the warning | Require a comment prefix on the matched line | fixed | 4 |
| 17 | scripts/test-changed.mjs | 42 | High | Logic & Correctness | Gate triggers are test-ROOT prefixes only, so editing `vitest.gates.config.ts` or `vitest.shared.ts` — which this branch did — selects no gate tests and still reports green | Add config triggers and assert them in the self-test | fixed | 1 |
| 18 | scripts/test-changed.mjs | 74 | Medium | Logic & Correctness | On an unresolvable base the script says it runs both tiers, then still passes the bad base to `--changed`, so the app tier errors instead of running | Run the app tier without `--changed` when the base is unresolvable | fixed | 1 |
| 19 | src/lib/formats/adapters/HtmlPreview.tsx | 60 | High | Logic & Correctness | `<head\b[^>]*>` stops at a `>` inside a quoted attribute, so `<head title="a>b">` gets the CSP meta spliced into the attribute and the sandboxed preview runs with NO effective CSP | Insert the meta through DOM APIs rather than a regex | fixed | 4 |
| 20 | src/services/media/resolveMediaSrc.ts | 144 | High | Logic & Correctness | Sources bearing an unsupported scheme (`javascript:`, `file:`, custom) fall past the external-URL allowlist and are returned unchanged | Reject scheme-bearing sources `isExternalUrl` does not accept; add adversarial tests | fixed | 4 |
| 21 | src/services/windowClose/fsChangeHandlers.ts | 90 | High | Logic & Correctness | Batch-wide `handled` lets one matched rename suppress fallback for every unmatched pair in the batch | Process each rename pair independently | fixed | 4 |
| 22 | src/services/windowClose/fsChangeHandlers.ts | 118 | High | Logic & Correctness | The `try` wraps `handleModifyEvent`, so a policy-callback rejection is converted into `handleDeletion` | Catch only the disk read | fixed | 4 |
| 23 | src/services/windowClose/fsChangeHandlers.ts | 121 | High | Logic & Correctness | Any text-read failure (permission, transient I/O) is treated as proof of deletion, unlike the conservative media path | Confirm nonexistence or classify ENOENT | fixed | 4 |
| 24 | src/services/windowClose/fsChangeHandlers.ts | 207 | High | Logic & Correctness | A stale `openPaths` snapshot is reused after paired renames, breaking chained old→mid→new renames | Refresh the map after each applied rename | fixed | 4 |
| 25 | src/services/windowClose/fsChangeHandlers.ts | 198 | High | Refactoring Debt | `handleSemanticBatch` is 66 lines combining partitioning, pair reconstruction, media policy and dispatch | Split into focused helpers | deferred (pre-existing refactor) | - |
| 26 | src/hooks/useExternalFileChanges.ts | 255 | High | Logic & Correctness | Batches run concurrently; a slower earlier read can overwrite a newer modification with stale content | Serialize batches or use generation tokens | deferred (pre-existing) | - |
| 27 | src/hooks/useExternalFileChanges.ts | 118 | High | Logic & Correctness | Queued conflicts are never revalidated, so a tab closed or renamed during the debounce is resolved on a stale path | Re-check before prompting and before applying | deferred (pre-existing) | - |
| 28 | src/hooks/useExternalFileChanges.ts | 264 | High | Logic & Correctness | Cleanup cancels the timer but neither drains the queue nor stops an in-flight batch rearming it after unmount | Give the queue a dispose operation | deferred (pre-existing) | - |
| 29 | src/hooks/useExternalFileChanges.ts | 171 | High | Refactoring Debt | `handleModifyEvent` is a 58-line high-branch state machine | Extract restoration/reconciliation/action functions | deferred (pre-existing refactor) | - |
| 30 | src/hooks/useExternalFileChanges.ts | 218 | Low | Dead Code | `clearMissing` in the auto_reload branch is unreachable-as-effective: the `isMissing` branch always returns first | Remove the redundant call | fixed | 4 |
| 31 | src/hooks/useExternalFileChanges.ts | 53 | Low | Duplication | `normalizePath` and `getFileName` are imported from the same module twice | Merge the imports | fixed | 4 |
| 32 | src/lib/formats/adapters/HtmlPreview.tsx | 135 | High | Logic & Correctness | Enable/Reload completions are not scoped to the initiating path, so a completion landing after a document switch writes `ran` for the wrong document | Capture an operation scope and ignore stale completions | fixed | 5 |
| 33 | src/lib/formats/adapters/HtmlPreview.tsx | 67 | Medium | Refactoring Debt | 167-line component mixing transition state, grants, sanitization and two frame renderers | Extract a trusted-preview hook and frame components | deferred (pre-existing refactor) | - |
| 34 | src/services/media/resolveMediaSrc.ts | 126 | High | Logic & Correctness | Relative media resolves against the window's FOCUSED tab, so media in the unfocused split pane uses the wrong directory | Pass the owning tab explicitly | fixed | 5 |
| 35 | src/services/media/resolveMediaSrc.ts | 111 | High | Duplication | The manual `..` scan duplicates `validateImagePath` and makes its rejection branch unreachable, hidden by a coverage ignore | Consolidate classification and traversal validation | fixed | 4 |
| 36 | src/services/media/resolveMediaSrc.ts | 106 | High | Logic & Correctness | Classification runs before markdown decoding, so a bracketed external URL is decoded but never recognised | Re-classify after decoding | fixed | 4 |
| 37 | src/stores/documentStore/document.ts | 108 | High | Logic & Correctness | `initDocument` on an existing tab resets documentId to 0 and skips revision invalidation, allowing stale MCP writes and missed remounts | Preserve/increment documentId and bump the revision | fixed | 6 |
| 38 | src/stores/documentStore/document.ts | 128 | High | Logic & Correctness | `fromUserEdit=false` changes content without bumping the revision, so a client holding the old revision can overwrite the new snapshot | Decouple dirty tracking from revision tracking | deferred (pre-existing) | - |
| 39 | src/stores/documentStore/document.ts | 134 | Medium | Logic & Correctness | Baseline ingestion performs two observable writes, briefly publishing an empty document | Commit the initial baseline atomically | fixed | 6 |
| 40 | src/stores/documentStore/document.ts | 101 | Medium | Shortcuts & Patches | The legacy restore fallback stores canonical savedContent as raw lastDiskContent, so CRLF/BOM files look externally modified immediately | Require raw lastDiskContent for transfers | rejected | 6 |
| 41 | src/stores/documentStore/document.ts | 43 | Low | Dead Code | Orphaned JSDoc for `setContent` is attached to nothing | Remove or reattach it | fixed | 4 |
| 42 | src/stores/documentStore/storeContract.ts | 38 | Medium | Logic & Correctness | `documents`/`getDocument` expose mutable `DocumentState`, letting callers bypass actions and revision invalidation | Expose readonly views | deferred (pre-existing) | - |
| 43 | src/stores/documentStore/storeContract.ts | 74 | Medium | Dead Code | `setContent` is production-dead, retained only as a legacy test alias | Remove and migrate tests | deferred (pre-existing; gated by externalWriterGate.test) | - |
| 44 | src/stores/documentStore/storeContract.ts | 117 | High | Duplication | The `"wysiwyg" \| "source"` union duplicates `DocumentState.mode` | Use `DocumentState["mode"]` | fixed | 4 |
| 45 | src/stores/documentStore/storeContract.ts | 121 | High | Duplication | The anonymous line-metadata shape duplicates `LineMetadata` | Use `Partial<LineMetadata>` | fixed | 4 |
| 46 | vitest.gates.config.ts | 79 | High | Logic & Correctness | The gate tier inherits an app-tier 1.6× oversubscription while each worker spawns subprocesses, multiplying concurrency under check:predelta | Measure a gate-tier worker limit separately | deferred (pre-existing; the file already documents the ratio as inherited, not measured) | - |
| 47 | vitest.gates.config.ts | 70 | Medium | Shortcuts & Patches | A suite-wide 60s timeout delays hang detection across all gate tests | Per-test timeouts for the genuinely slow cases | deferred (pre-existing documented decision) | - |
| 48 | e2e/lib/vmarkMcp.mjs | 78 | High | Duplication | `portFilePath()` duplicates the sidecar's platform app-data resolution | Share one resolver | deferred (pre-existing; cross-package change) | - |
| 49 | e2e/lib/vmarkMcp.mjs | 100/132/161/172/206/226 | Medium–High | Logic / Refactoring | Lax port parsing, 133-line function, silent frame discard, post-exit sends, handshake process leak, ignored `structuredContent` | See per-item suggestions in the thread | deferred (pre-existing) | - |
| 50 | e2e/journeys/01-boot-editor-ready.mjs | 22 | High | Duplication | `list_windows` normalization duplicates other harness code | Share a normalizer from bridge.mjs | deferred (pre-existing) | - |
| 51 | e2e/journeys/01-boot-editor-ready.mjs | 41 | High | Logic & Correctness | `getTabs` excludes the synthetic browser workspace tab, so a browser-active session reads as an empty welcome screen | Include the workspace tab when judging the active surface | deferred (pre-existing `getTabs` limitation, shared by every journey) | - |
| 52 | e2e/journeys/01-boot-editor-ready.mjs | 17 | Medium | Refactoring Debt | 49-line `run` mixing bridge parsing, readiness, tab invariants and logging | Extract focused helpers | deferred (pre-existing refactor) | - |
| 53 | e2e/wait-ready.mjs | 83 | Medium | Logic & Correctness | The advertised timeout is not a hard budget: an attempt can start just before the deadline and run 20s past it | Cap each operation by the remaining deadline | fixed | 5 |
| 54 | e2e/wait-ready.mjs | 45 | Medium | Shortcuts & Patches | Numeric CLI args are unvalidated; `NaN`/negative values skip all attempts | Parse strictly and reject | fixed | 5 |
| 55 | e2e/wait-ready.mjs | 51 | High | Logic & Correctness | The readiness orchestration itself has no direct tests | Add mock-bridge tests for attempt/poll/cleanup | deferred (pre-existing; helpers are covered) | - |
| 56 | e2e/lib/readiness.mjs | 57 | High | Duplication | "The contract test can pass while the snippet checks a stale attribute" | — | rejected | - |
| 57 | src/components/Editor/MediaView/MediaView.tsx | 61 | Medium | Refactoring Debt | 121-line component mixing grant lifecycle, error tracking and three render modes | Extract a hook and a fallback component | deferred (pre-existing refactor) | - |
| 58 | src/contexts/useWindowReady.ts | 28 | High | Shortcuts & Patches | A fixed 100ms delay cannot guarantee listener registration under load | Replace with an explicit readiness barrier | deferred (pre-existing shipped design; see report) | - |
| 59 | e2e/journeys/01-boot-editor-ready.mjs | 41 | High | Logic & Correctness | No deterministic tests cover empty/browser/media/split/lazy session shapes | Extract snapshot evaluation and add Vitest cases | deferred (pre-existing; journey is e2e-only by design) | - |
| 60 | src/components/Editor/MediaViewer/MediaViewer.tsx | - | - | - | NO ISSUES FOUND | — | n/a | - |

## Outcome

Three fix→verify rounds ran (the command's maximum), each verified by a FRESH
read-only Codex call rather than by the fixer's own claim.

| Round | Sent | Verdicts |
|---|---|---|
| 1 | 18 | 15 fixed, 2 partial (#4, #16), 1 regressed (#14) |
| 2 | 3 | 2 fixed (#4, #14), 1 partial (#16) |
| 3 | 1 | 1 partial (#16) |

Round 1's verification earned its keep twice: it caught a REGRESSION my own fix
introduced (#14 — recognising deletion-only header edits also silenced the
warning when the first BODY line was deleted, because both produce the same
new-side hunk position), and it caught #4 shipping a selector,
`.browser-workspace`, that matches no element in the app. Neither was visible
from the tests I had written, because both fixes' tests passed.

**#16 was PARTIAL for two rounds and is now FIXED (round 4).** The earlier
reasoning below was wrong in its premise — it assumed the only options were
"accept `*`" or "drop `*`". There was a third: decide by POSITION. The comment
ranges are computed from the staged blob, and a label counts only when its line
falls inside one. Prefixes cannot separate a JSDoc continuation from a Rust
deref or a TS generator, because they are spelled identically; position can, and
mid-file JSDoc keeps working. Superseded reasoning, kept because the trap it
describes is real: The label rule accepts a `*` prefix so a
JSDoc continuation counts as a header edit. Codex's remaining counter-examples
are `* slot = "Purpose: x";` (Rust deref with a space) and
`* method() { return "Purpose:"; }` (a spaced TypeScript generator). Both are
legal and both would silence the warning. The clean kill is to drop the `*`
alternative entirely — leading-header JSDoc is already covered by the
header-block overlap rule — but that would stop counting edits to a MID-FILE
JSDoc block carrying a label, which this repo writes constantly. That trades a
rare false silence for a common false warning, in a hook that is advisory and
never blocks a commit. Stopping is the calibrated choice, not an exhausted one;
the residual is recorded here rather than closed by weakening the check.

## Notes on rejected findings

**#56** — Codex claimed the duplicated `READY_ATTRIBUTE` literal means
"the contract test can pass while the actual snippet checks a stale attribute".
That is false: `src/test/windowReadyContract.test.ts` asserts BOTH that the
harness constant equals the app constant AND that the snippet contains
``getAttribute('<harness constant>')``, so the three are pinned transitively —
and the mutation check in this session confirmed a rename fails the suite. The
DUPLICATION itself is real and is fixed as #2; only the stated failure mode is
rejected.

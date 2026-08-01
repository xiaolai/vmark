# Codex mini-audit — Phase 1 completion (post-routing)

Model `gpt-5.6-sol`, effort `high`, sandbox `read-only`, 5-dimension mini audit.
Two batches over the 18 production files changed since the previous audit closed
(`49355b36..HEAD`): the store core, and the ingress paths the routing touched.

Run 2026-08-01, as the audit-fix pass following the R11 plan re-review.

**Verdicts are tagged inline.** The store-core batch found regressions genuinely
introduced by the Phase 1 work — those are FIXED. Most ingress-batch findings are
PRE-EXISTING defects in files the routing merely touched (crash-recovery snapshot
dedup, the external-change dialog state machine, Finder-open's duplicated
flows); they are recorded here rather than silently absorbed, because fixing them
is its own scoped work with its own tests, not a tail on this one.

---

## Batch: phase1-core (store core)

`threadId: 019fbad9-9e18-75f2-a6c2-010b5513ba0d` · `jobId: audit-ms9o4xc9-panjan`

Found 7 code-quality issues: 4 High, 3 Medium. No dead code, unused imports, TODOs, or commented-out implementations were found.

**[OPEN — real. `loadContent` now has TWO production callers (one passes ""), so the honest fix is to route them and DELETE buildLoadState, not extract a shared builder. Scoped work.]** src/stores/documentStore/ingestState.ts:99-112,134-147 | Duplication | High | The baseline branch of `buildIngestState` and `buildLoadState` duplicate nearly the entire state patch. They have already drifted: one derives line metadata while the other silently retains existing metadata when `meta` is omitted, potentially rewriting CRLF or hard-break conventions on the next preserve save. | Extract a shared baseline-state builder that receives resolved metadata; when loading disk content without explicit metadata, use values detected by `ingestExternalText`.

**[FIXED 2026-08-01 — but NOT as prescribed: `hardBreakStyle` derives (it survives canonicalisation), `lineEnding` stays unknown (deriving would assert "lf" for a transferred CRLF document, worse than unknown)]** src/stores/documentStore/documentState.ts:94-110 | Logic & Correctness | High | `createInitialDocument` calls `ingestExternalText` but discards its detected `lineEnding` and `hardBreakStyle`, hardcoding both to `"unknown"`. A CRLF or backslash-hard-break document initialized through this path can subsequently be normalized to LF/two-spaces under preserve settings. This critical round-trip path is not tested. | Retain the detected metadata from `ingestExternalText`, with explicit unknown metadata reserved for genuinely content-free new documents.

**[FIXED 2026-08-01 — the assertion now covers the whole invariant, BOM included]** src/stores/documentStore/documentState.ts:138-150 | Logic & Correctness | Medium | The documented canonical invariant is “LF-only, BOM-free,” but `assertCanonicalEditorText` checks only carriage returns. `setEditorContent` can therefore accept a leading BOM in development and place it directly into the editor buffer. | Also reject a leading U+FEFF and add a corresponding invariant test.

**[OPEN — real, and the transfer payload types carry no line metadata at all, so the fix spans them too. Tracked with the WI-1.8 reader-family note.]** src/stores/documentStore/document.ts:161-175 | Logic & Correctness | High | `initDocument` overloads `savedContent` across incompatible domains: it canonicalizes it for `savedContent`, then copies the raw argument into `lastDiskContent`, while `hasBom` and metadata remain derived from the current content. Callers passing the store’s canonical saved snapshot — such as tab transfer — cannot preserve the actual CRLF/BOM disk snapshot. | Replace the optional string with an explicit structure carrying canonical saved content, raw disk content, BOM, and line metadata, or migrate these paths through origin-aware ingestion.

**[FIXED 2026-08-01 — revision compare uses the same canonicalisation the door stores]** src/stores/documentStore/document.ts:218-224 | Logic & Correctness | Medium | `loadContent` stores BOM-free text through `buildLoadState`, but revision comparison uses `canonicalizeLineEndings`, which does not strip a leading BOM. Reloading identical BOM-prefixed disk content therefore creates a false revision bump and can reject an otherwise current MCP write as stale. | Compare against `ingestExternalText(content).canonicalEditorText`, or return the canonical next content from the state builder and use that value.

src/utils/ingestOrigin.ts | No issues found.

**[OPEN — PRE-EXISTING concurrency defect, not introduced here. Needs a per-path save queue and reverse-completion tests.]** src/services/persistence/saveToPath.ts:251-280 | Logic & Correctness | High | Saves to the same path are not serialized or generation-checked. If a newer atomic write completes before an older one, the older content can overwrite the disk and then replace the saved-state snapshot. Pending-save tokens only protect cleanup; they do not enforce write ordering. The coherence capture is submitted even later, after history work, which can further reorder stale content. Existing overlap coverage checks only token uniqueness, not reversed completion. | Add a per-normalized-path save queue or mutex covering write, state application, history, and capture. Test with deferred writes completed in reverse order.

**[FIXED 2026-08-01 (doc) — "fire-and-forget" described the ERROR policy, not the scheduling; the header now says so and names the bounded-timeout fix if the hang ever bites]** src/services/persistence/saveToPath.ts:212-235,261-262 | Async Issues | Medium | Version history is described as fire-and-forget and non-blocking, but `saveToPath` awaits it. A slow or hung history backend prevents the save promise from resolving after the file and stores have already been updated, potentially holding save/close reentry guards indefinitely. | Either launch history recording asynchronously with internal error reporting or apply a bounded timeout if close flows require best-effort completion.

---

## Batch: phase1-ingress (routed ingresses)

`threadId: 019fbae0-c13e-7261-88f4-b2706b054c0f` · `jobId: audit-ms9oey8a-r34prz`

Found 18 issues: 14 High and 4 Medium. The most serious risks are recovery-data loss, stale-content saves, and Finder-open paths bypassing established media and race guards.

**[OPEN — pre-existing]** src/services/persistence/hotExit/restoreHelpers.ts:28 | Duplication | High | Sidebar bounds are copied as 150–500, but `uiStore.setSidebarWidth()` actually clamps to 180–480. Restore therefore accepts values that cannot be restored, and its mocked tests miss the integration mismatch. | Move sidebar constraints into a shared constants module and use the same clamp in resizing, persistence, and the store.

**[OPEN — pre-existing]** src/services/persistence/hotExit/restoreHelpers.ts:269 | Logic & Correctness | High | Restore destructively clears all current tabs before rebuilding them. Any exception from `createTab`, metadata restoration, or document ingestion leaves a partially restored window with the fallback state already destroyed; no test covers a mid-loop failure. | Prevalidate the complete payload and add transactional rollback or a defined fallback reconstruction path on failure.

**[OPEN — pre-existing]** src/services/persistence/hotExit/restoreHelpers.ts:194 | Refactoring Debt | Medium | The file is 397 lines; `restoreUiState` and `restoreDocumentState` are both long, multi-responsibility routines despite the project’s ~300-line limit. | Extract UI-state validation/restoration and document/history conversion into focused modules.

**[OPEN — pre-existing]** src/hooks/resilience/_crashRecoveryStartup.ts:72 | Logic & Correctness | High | Snapshots are deduplicated solely by `filePath`, even though snapshots are written per tab. Two dirty tabs for the same path can contain different unsaved edits; the older one is deleted at lines 111–115, causing permanent recovery-data loss. Existing tests explicitly entrench this unsafe policy. | Restore every distinct tab snapshot, or deduplicate only when tab identity and recoverable content are provably identical.

**[OPEN — pre-existing]** src/hooks/resilience/_crashRecoveryStartup.ts:185 | Logic & Correctness | Medium | The comment says the original title is restored, but the code only calls `updateTabPath` for file-backed snapshots. `snapshot.title` is never applied, so untitled recovery tabs lose their original names/numbers. | Call `updateTabTitle(tabId, snapshot.title)` after tab creation, with a validated fallback.

**[OPEN — pre-existing]** src/hooks/resilience/_crashRecoveryStartup.ts:54 | Refactoring Debt | High | `runCrashRecovery` is a 94-line high-complexity coordinator handling waiting, cleanup, deduplication, restoration, deletion, focus restoration, counting, logging, and toast policy. | Extract snapshot selection, per-snapshot restoration, cleanup, and result-notification helpers with direct unit tests.

**[OPEN — pre-existing]** src/hooks/useExternalFileChanges.ts:107 | Logic & Correctness | High | `doc` is captured before awaiting the native decision and Save As dialogs, then its stale `content` is written at line 149. Edits arriving while either dialog is open can be omitted from the saved copy. | Re-read the document immediately before `saveToPath` and abort safely if the tab/document no longer exists.

**[OPEN — pre-existing]** src/hooks/useExternalFileChanges.ts:209 | Logic & Correctness | High | Pending conflicts are removed from the queue before dialog processing. If `message()` or review processing rejects, the timer-level catch only logs the error and the pending conflicts are permanently lost without a user decision. This rejection path is untested. | Preserve/requeue the batch on failure and surface a user-visible error or conservative “keep local” resolution.

**[OPEN — pre-existing]** src/hooks/useExternalFileChanges.ts:253 | Duplication | High | Batch scheduling is duplicated at lines 253–262 and 279–288. When another change arrives during an active dialog, one timer is created by `queueDirtyChange` and another by `finally`; the latter overwrites the ref without clearing the first, leaving an untracked timer that cleanup cannot cancel. | Create one `scheduleBatchProcessing()` helper that always clears the previous timer before scheduling.

**[OPEN — pre-existing]** src/hooks/useExternalFileChanges.ts:130 | Shortcuts & Patches | Medium | The registry-failure fallback exposes the hardcoded user-facing label `"Markdown"`, violating the project’s i18n rule. | Use the existing localized Markdown filter name.

**[OPEN — pre-existing]** src/hooks/useExternalFileChanges.ts:71 | Refactoring Debt | High | The 391-line hook contains several long callbacks and an intertwined timer/dialog/filesystem state machine, creating high cyclomatic complexity and making lifecycle races difficult to reason about. | Move dirty-change resolution and batch scheduling into dedicated tested services/hooks.

**[OPEN — pre-existing]** src/hooks/useFinderFileOpen.ts:45 | Logic & Correctness | High | `loadFileIntoTab` always calls `readTextFile`; Finder opens never use the binary-media short circuit. Images, audio, and video are read as UTF-8 and fail instead of opening in `MediaViewer`, while large media also unnecessarily passes through size routing at line 264. No Finder media test exists. | Route binary paths through `tryOpenMediaFile`/`replaceTabWithMediaFile` before size checks or text reads.

**[FIXED 2026-08-01 — close-during-read guard added, mirroring fileOpen.ts (WI-0.2/C1)]** src/hooks/useFinderFileOpen.ts:49 | Logic & Correctness | High | After the asynchronous read, `loadFileIntoTab` ingests without verifying that the tab still exists. Closing a tab during the read resurrects an orphan document. In the create branch, `createTab` can also deduplicate to a tab opened concurrently, causing that existing tab’s potentially dirty content to be overwritten. Neither race is tested. | Reuse the guarded navigation services or recheck tab identity/existence and dedup status after every await before ingestion.

**[OPEN — pre-existing]** src/hooks/useFinderFileOpen.ts:115 | Duplication | High | Finder-open locally reimplements both replace-tab and create-tab flows instead of using `replaceTabWithFile` and `openFileInNewTabCore`. The copies have already drifted by omitting media handling, close-during-read guards, and dedup protection. | Centralize branch execution in the navigation services and keep this hook limited to event queuing/routing.

**[OPEN — pre-existing]** src/hooks/useFinderFileOpen.ts:378 | Logic & Correctness | High | `pendingFetchedRef` is set before `get_pending_file_opens` succeeds. If the invoke rejects, the outer catch only logs; the flag remains true and the cold-start queue is never retried during this mount. | Set the flag only after a successful fetch, or reset it in the catch and schedule a bounded retry.

**[OPEN — pre-existing]** src/services/navigation/fileOpen.ts:184 | Duplication | High | The Markdown extension list is hardcoded separately from the format registry. It already duplicates the adapter’s extension metadata and can silently drift when Markdown support changes. | Read the Markdown format’s registered extensions when building the filter.

**[OPEN — pre-existing]** src/services/navigation/fileOpen.ts:227 | Logic & Correctness | Medium | `openWorkspaceForNewTab` swallows workspace-open failure at lines 280–284, after which `handleOpen` still opens the file. This contradicts the stated requirement that the workspace be opened first and can claim the tab under the wrong context without notifying the user. | Return a success result and abort or deliberately fall back with explicit ownership handling and a localized error.

**[OPEN — pre-existing]** src/services/navigation/fileOpen.ts:37 | Refactoring Debt | High | The 308-line file exceeds the project guideline; `openFileInNewTabCore` and `handleOpen` are both roughly 100-line, high-branching workflows. | Extract dialog/filter construction and open-decision execution into focused services.

No unused imports, unreachable branches, or commented-out dead code were found in the five files. This was a static review; I inspected the direct tests but did not execute them.

---

## Round 3 — independent verification (2026-08-01)

Fresh `read-only` Codex call (`gpt-5.6-sol`, effort `high`), not a resume of the
audit session, checking the five claimed fixes against the working tree.
`threadId: 019fbaf1-b3be-7d20-b10a-e9e352bbaac8` · `jobId: verify-ms9p2ppa-nqphgy`

| # | Finding | Verdict |
|---|---|---|
| 1 | `createInitialDocument` discards derived line metadata | **FIXED** |
| 2 | `assertCanonicalEditorText` ignores a leading BOM | **FIXED** |
| 3 | `loadContent` revision compare disagrees with what it stores | **FIXED** |
| 4 | Finder-open ingests without re-checking the tab | **PARTIAL** |
| 5 | `saveToPath` header misdescribes the awaited history snapshot | **FIXED** |

Finding 1 was fixed **against the audit's own prescription**, so the verifier
was asked to check the reasoning rather than the diff, and it independently
confirmed both halves: `detectHardBreakStyle` normalises EOLs at
`linebreakDetection.ts:49` before scanning (so deriving from canonical text is
sound), and no `initDocument` caller passes raw disk text.

**The PARTIAL was acted on, not filed.** Two things remained:

- *No test took the guard's false branch.* Correct, and the sharpest finding of
  the round — the Finder suites' tabStore mocks return a tab for every ID, so
  the regression would have passed there unnoticed.
  `useFinderFileOpen.closeDuringRead.test.ts` now pins it, including the
  ordering (the close happens DURING the read, so a pre-await check would not
  catch it). Verified RED: with the guard removed, 3 of its 5 cases fail.
- *The `createTab` dedup race is still open.* Confirmed still present. It is
  part of the Finder-open/navigation-service consolidation recorded above, not
  something to bolt on here.

"No new code defect was introduced by these five edits."

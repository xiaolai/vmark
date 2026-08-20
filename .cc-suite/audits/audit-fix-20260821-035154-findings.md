# Audit Findings

**Run**: audit-fix | **Scope**: uncommitted changes (#1313) | **Audit type**: mini (5-dim)
**Model**: gpt-5.6-sol | **Effort**: high | **Audit threads**: 01a020b0-4c23-7f20-be2b-f18ed9fa36f7 (+2)
**Status values**: open | fixed | not-fixed | partial | regressed | skipped

Scope filtered per audit.md: mini audits skip `*.json` and test files, leaving 3 production files.

| # | File | Line | Sev | Dimension | Finding | Suggested fix | Status | Round |
|---|------|------|-----|-----------|---------|---------------|--------|-------|
| 1 | src/services/navigation/restoreWorkspaceTabs.ts | 45 | High | Logic | `replaceable` captured before async reads, closed at the end without revalidation — can discard a tab the user dirtied during restore | revalidate immediately before closing | fixed | 1 |
| 2 | src/services/navigation/restoreWorkspaceTabs.ts | 56 | High | Logic | dedup check goes stale across `await readTextFile` | atomic create-if-absent API | skipped (deferred: pre-existing) | - |
| 3 | src/services/navigation/restoreWorkspaceTabs.ts | 58 | High | Duplication | hand-rolled read/create/ingest bypasses the shared open pipeline (media routing, large-file guards) | route through shared pipeline | skipped (deferred: pre-existing) | - |
| 4 | src/services/navigation/restoreWorkspaceTabs.ts | 64 | Med | Shortcuts | broad catch conflates read failure with post-create failure; can orphan a tab | split the catch | skipped (deferred: pre-existing) | - |
| 5 | src/services/navigation/restoreWorkspaceTabs.ts | 111 | Med | Logic | `restoreSplitLayout` calls `toggleSyncScroll` instead of assigning persisted value | explicit setter | fixed | 1 |
| 6 | src/services/navigation/restoreWorkspaceTabs.ts | 36 | Low | Refactor | function >50 lines, mixes validation/IO/dedup/cleanup | extract helpers | skipped (deferred: pre-existing) | - |
| 7 | src/contexts/WindowContext.tsx | 94 | High | Refactor | `init` ~159 lines, high cyclomatic complexity | split into focused functions | skipped (deferred: pre-existing) | - |
| 8 | src/contexts/WindowContext.tsx | 142 | High | Duplication | ready+emit sequence copied at 5 sites | extract `markWindowReady` | skipped (deferred: pre-existing) | - |
| 9 | src/contexts/WindowContext.tsx | 131 | High | Duplication | document-window / launch-window predicates repeated, `"main"` hardcoded | shared helpers | skipped (deferred: pre-existing) | - |
| 10 | src/contexts/WindowContext.tsx | ~100 | High | Logic | StrictMode double-init race; `ready` may emit twice | guard the effect | skipped (deferred: pre-existing) | - |
| 11 | src/contexts/WindowContext.tsx | 143 | Med | Logic | `window.emit()` promise neither awaited nor caught; timers not cleared on unmount | centralise + cleanup | skipped (deferred: pre-existing) | - |
| 12 | src/contexts/WindowContext.tsx | 25 | Low | Refactor | header still claims a cold start creates a blank tab — contradicted by #1313 | update header | fixed | 1 |
| 13 | src/contexts/startupFileOpen.ts | 48 | High | Logic | zero-tab fallback also fires when user closed the tab mid-read, defeating the close-during-read guard | explicit outcome | skipped (deferred: pre-existing) | - |
| 14 | src/contexts/startupFileOpen.ts | 47 | High | Shortcuts | a rejection skips the fallback and aborts remaining startup files | settle per path | skipped (deferred: pre-existing) | - |
| 15 | src/contexts/startupFileOpen.ts | 65 | High | Duplication | `parseStartupFilesParam` has no direct tests; WindowContext.test hand-copies it | direct tests + importActual | skipped (deferred: pre-existing) | - |
| 16 | src/contexts/startupFileOpen.ts | 60 | Med | Refactor | `createBlankStartupTab` doc claims non-launch-only, but it accepts `"main"`; policy lives in the caller | encode or reword | fixed | 1 |
| 17 | src/contexts/startupFileOpen.ts | 70 | Med | Logic | parser accepts empty strings as paths (`files=[""]`) | reject empty | fixed | 1 |
| 18 | src/contexts/startupFileOpen.ts | 8 | Low | Refactor | module doc still claims startup always produces a live document | narrow the invariant | fixed | 1 |
| 19 | src/contexts/startupFileOpen.ts | 44 | Med | Logic | multi-file startup: a failed first path creates a blank tab, later successes land beside it | fallback after batch | skipped (deferred: pre-existing) | - |

## Round 1 verdict

Verified independently by Codex (thread `01a020be-4f10-71e2-8e4c-5e2a4ba1816b`): all 6 attempted
findings FIXED, no fix-induced problems.

### Why 13 findings were deferred rather than fixed

The command's default is fix-all. I deviated deliberately and state it here rather than
silently: the 13 deferred findings are PRE-EXISTING debt on the app's startup path, not
defects introduced by #1313. Fixing them means splitting a 159-line `init`, adding an
atomic create-if-absent tab API, and routing workspace restore through the shared open
pipeline — a startup-path rewrite stacked onto an uncommitted tab-cleanup fix. That trades
a reviewable change for an unreviewable one on the most fragile path in the app.

The 6 fixed are exactly those this change introduced or invalidated, plus two small verified
bugs found in passing (`toggleSyncScroll`, empty-string paths).

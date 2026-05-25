# Error Recovery Matrix

Maps every known failure mode to its recovery path and test coverage.

## Persistence Layer

| # | Failure Mode | Recovery Path | Tested? | Test File |
|---|-------------|---------------|---------|-----------|
| 1 | Auto-save write fails (ENOSPC) | Error toast shown, retried next cycle, doc stays dirty | Yes | `useAutoSave.fault.test.ts` |
| 2 | Auto-save write fails (EACCES) | Same as ENOSPC — error toast, retry | Yes | `useAutoSave.fault.test.ts` |
| 3 | Hot exit capture timeout (>15s) | Coordinator proceeds without state, fresh start on restart | Partial | `hotExitCoordination.test.ts` |
| 4 | Hot exit storage write fails | Session not saved, logged to stderr | Yes | `storage.rs` tests |
| 5 | Hot exit session.json corrupted | Falls back to session.prev.json backup | Yes | `src-tauri/src/hot_exit/storage.rs` (Rust tests) |
| 6 | Hot exit both session files corrupted | Fresh start, no session restored | Yes | `src-tauri/src/hot_exit/storage.rs` (Rust tests) |
| 7 | Crash recovery snapshot write fails | Silent, retried next 10s cycle | Yes | `crashRecovery.test.ts` |
| 8 | Crash recovery snapshot corrupted | Skipped individually, other snapshots still restored | Partial | `useCrashRecoveryStartup.test.ts` |
| 9 | Crash recovery dir not readable | Silent failure, no recovery | No | — |
| 10 | Atomic write temp file creation fails | Error returned to caller, original file untouched | Yes | `app_paths.rs` tests |

## File Operations

| # | Failure Mode | Recovery Path | Tested? | Test File |
|---|-------------|---------------|---------|-----------|
| 11 | Save to path fails | Error toast, document stays dirty | Yes | `useFileSave.test.ts` |
| 12 | File watcher startup fails | No external change detection, logged | No | — |
| 13 | File watcher crash during operation | External changes undetected until restart | No | — |
| 14 | Reload from disk fails | Error shown, "keep current changes" fallback | Partial | `useExternalFileChanges.ts` |
| 15 | Two windows edit same file — save race | Pending save token prevents false-positive watcher trigger | Partial | — |
| 16 | File deleted externally while open | Tab marked as "missing", user notified | Yes | `useExternalFileChanges.ts` |

## Configuration

| # | Failure Mode | Recovery Path | Tested? | Test File |
|---|-------------|---------------|---------|-----------|
| 17 | Workspace config JSON corrupted | Falls back to defaults, customization lost | Yes | `settingsStore.fault.test.ts` |
| 18 | Workspace config missing | Created fresh with defaults | Yes | `workspaceConfig.test.ts` |
| 19 | Settings store hydration fails | In-memory defaults, settings lost after restart | Partial | `settingsStore.test.ts` |
| 20 | Secure storage (Tauri store) init fails | Falls back to localStorage, logged | Yes | `secureStorage.test.ts` |

## Application Lifecycle

| # | Failure Mode | Recovery Path | Tested? | Test File |
|---|-------------|---------------|---------|-----------|
| 21 | App build fails (Tauri) | Controlled exit with error message (not panic) | Yes | `lib.rs` tests |
| 22 | Updater header creation fails | Updater runs without machine ID header | Yes | `lib.rs` tests |
| 23 | Window close during quit coordination | Window removed from quit targets, finalize proceeds | Yes | `quit.rs` tests |
| 24 | Quit with poisoned mutex | `unwrap_or_else` recovers from poisoned lock | Yes | `quit.rs` tests |
| 25 | Finder open — window disappears between check and emit | Fallback: queue files + create new window | Yes | `lib.rs` TOCTOU fix |

## MCP Bridge

| # | Failure Mode | Recovery Path | Tested? | Test File |
|---|-------------|---------------|---------|-----------|
| 26 | MCP handler throws | Error sent back to client, other handlers unaffected | Yes | `mcpBridge/__tests__/` |
| 27 | MCP bridge WebSocket drops | Client gets no response, timeout on their side | Partial | — |
| 28 | MCP client sends invalid auth token | Connection rejected with error message | Partial | `state.rs` (token generation only — server handshake needs integration test) |
| 29 | MCP bridge respond() fails | Logged, client gets no response (timeout) | Partial | — |

## Editor

| # | Failure Mode | Recovery Path | Tested? | Test File |
|---|-------------|---------------|---------|-----------|
| 30 | Markdown parse fails | Error logged, empty document shown | Yes | `TiptapEditor.test.tsx` |
| 31 | Undo stack memory exhaustion | No protection (unbounded) | No | — |
| 32 | ProseMirror plugin throws | Editor continues, plugin disabled | Partial | — |

## Legend

- **Yes**: Automated test exists and covers the path
- **Partial**: Test exists but doesn't cover all edge cases
- **No**: No automated test; recovery path exists but is unverified

---

## T07 — Document resilience state machine

The four per-window persistence hooks (hot-exit capture/restore,
crash-recovery writer/cleanup) and the two main-window startup hooks
(hot-exit startup, crash-recovery startup) are unified behind
`useDocumentResilience` in `src/services/persistence/resilience/`.

States: `idle | restoring | ready | snapshotting | cleaning`.

Transition table:

| From         | To           | Trigger                                  |
|--------------|--------------|------------------------------------------|
| idle         | restoring    | hook mount, isMainWindow=true            |
| idle         | ready        | hook mount, non-main (skip restore)      |
| restoring    | ready        | restore complete (or no session found)   |
| restoring    | cleaning     | restore aborted (corrupt JSON, unmount)  |
| ready        | snapshotting | periodic snapshot timer fires            |
| snapshotting | ready        | snapshot persisted                       |
| ready        | cleaning     | save / close / unmount                   |
| cleaning     | idle         | cleanup complete                         |
| any          | same         | re-entry (no-op for guards)              |

```
                 ┌───────────┐
        ┌────────►   ready   ◄────────┐
        │        └─────┬─────┘        │
        │              │              │
        │              ▼              │
        │      ┌──────────────┐       │
        │      │ snapshotting │───────┘
        │      └──────────────┘
        │
restoring
    ▲
    │ (mount, main)
    │
  idle ◄──── cleaning ◄──── ready (save/unmount)
```

Invariants enforced by the machine:

- A snapshot cannot run while restoring (prevents torn writes during
  startup race).
- Cleaning cannot interrupt snapshotting (the snapshot writer always
  completes its current iteration before cleanup runs).
- A second restoring entry is rejected — the module-level guard in
  `_hotExitRestore.ts` already prevents double-restore; the machine
  documents that invariant explicitly.

Per-test invariant coverage lives alongside each internal helper:
`_crashRecoveryWriter.test.ts`, `_hotExitRestore.test.ts`, etc.

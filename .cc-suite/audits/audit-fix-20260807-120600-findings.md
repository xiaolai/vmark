# Audit Findings

**Run**: audit-fix 20260807-120600 | **Scope**: this branch (`fix/1224-file-explorer-visibility`, 3 commits vs origin/main; 12 production files, test files skipped per mini-audit policy) | **Audit type**: mini (5 dimensions)
**Model**: gpt-5.6-sol | **Effort**: high | **Audit threads**: one per file, see `.cc-suite` job log (first: `019fda41-b689-7d80-b3e5-7af1bdcd039a`)
**Status values**: open | fixed | not-fixed | partial | regressed | skipped (pre-existing)

**Scope note.** The audit reads whole files; this branch changed only parts of them.
Findings in code the branch did not touch are marked `skipped (pre-existing)` — fixing
them would violate the project's scope discipline (AGENTS.md: "keep diffs focused;
avoid drive-by refactors") and inflate a bug-fix PR. They are recorded here in full so
nothing is lost, and several deserve their own issues.

| # | File | Line | Severity | Dimension | Finding | Suggested fix | Status | Round |
|---|------|------|----------|-----------|---------|---------------|--------|-------|
| 1 | src/components/Sidebar/FileExplorer/FileExplorer.tsx | 235 | High | Logic | In-flight create can complete after a workspace switch and its stale refresh replaces the new tree | Capture a root generation, verify after await | skipped (pre-existing) | - |
| 2 | src/components/Sidebar/FileExplorer/FileExplorer.tsx | 241 | High | Logic | `pendingEditPath` single slot: overlapping creates overwrite each other | Queue pending entries per workspace | skipped (pre-existing) | - |
| 3 | src/components/Sidebar/FileExplorer/FileExplorer.tsx | 212 | High | Logic | `openFileByType` drops the promise from `openFile`; emitter rejection becomes unhandled | Return `Promise<void>`, await both branches | skipped (pre-existing) | - |
| 4 | src/components/Sidebar/FileExplorer/fileTreeFilters.ts | 37 | High | Logic | With extensions hidden, `showAllFiles` restores extensions for registered non-markdown (`.txt`, `.yaml`) — contradicts the global setting and relabels the tree on toggle | Drop the special case; return `formatFileDisplayName(name, showExtensions)` | fixed | 1 |
| 5 | src/components/Sidebar/FileExplorer/FileExplorer.tsx | 136 | Medium | Refactoring | A display preference is threaded into `useFileTree`, so flipping it re-walks the filesystem and resubscribes the watcher | Keep raw names in the tree, derive labels in memory | not-fixed (deliberate) | 1 |
| 6 | src/components/Sidebar/FileExplorer/FileExplorer.tsx | 223 | High | Logic | Component wiring untested — the only direct test takes the no-workspace early return | Add component tests for create/rename/move/activate | skipped (pre-existing) | - |
| 7 | src/components/Sidebar/FileExplorer/FileExplorer.tsx | 93 | Medium | Refactoring | 417-line component owning loading, CRUD, menus, keyboard, scroll, render | Split | skipped (pre-existing) | - |
| 8 | src/components/Sidebar/FileExplorer/useFileTree.ts | 149 | High | Logic | Root→null or unmount does not invalidate an in-flight request | Bump `requestIdRef` on cleanup | skipped (pre-existing) | - |
| 9 | src/components/Sidebar/FileExplorer/useFileTree.ts | 146 | Medium | Logic | `excludeFolders.join(",")` collides: `["a,b","c"]` == `["a","b,c"]` | `JSON.stringify` | skipped (pre-existing) | - |
| 10 | src/components/Sidebar/FileExplorer/useFileTree.ts | 154 | Medium | Logic | No single-flight: focus + fs events can launch concurrent full traversals | Single-flight with one pending rerun | skipped (pre-existing) | - |
| 11 | src/components/Sidebar/FileExplorer/useFileTree.ts | 54 | Medium | Dead code | Listing failures become empty arrays at two layers, so the outer catch is unreachable and unreadable dirs look empty | Propagate a structured error state | skipped (pre-existing) | - |
| 12 | src/components/Sidebar/FileExplorer/useFileTree.ts | 63 | Low | Refactoring | `loadDirectoryRecursive` mixes IPC, filter, node build, recursion, sort, error policy | Extract converter + comparator | skipped (pre-existing) | - |
| 13 | src/components/Sidebar/Sidebar.tsx | 75 | High | Logic | Header renders FILES actions from the remembered document viewMode even when `sidebar.kind === "browser"` | Derive header state from `sidebar.kind` | skipped (pre-existing) | - |
| 14 | src/components/Sidebar/Sidebar.tsx | 102 | High | Logic | `emitHistoryCleared()` fires even when `deleteDocumentHistory` swallowed a failure | Return a result, emit on success | skipped (pre-existing) | - |
| 15 | src/components/Sidebar/Sidebar.tsx | 158 | Medium | Shortcuts | New toggle is fire-and-forget: no pending guard, persistence failure swallowed downstream | Await a result-returning service, guard while pending | not-fixed (deliberate) | 1 |
| 16 | src/components/Sidebar/Sidebar.tsx | 54 | High | Refactoring | ~190-line component mixing navigation, destructive async, persistence, dispatch, render | Extract per-kind header/content | skipped (pre-existing) | - |
| 17 | src/components/Sidebar/Sidebar.tsx | 140 | High | Duplication | Five near-identical action buttons; shortcut label computed twice per button | Extract `SidebarActionButton` | skipped (pre-existing) | - |
| 18 | src/components/Tabs/Tab.test.tsx | 178 | High | Logic | Reactivity untested: the test sets the store BEFORE render, so a non-reactive implementation passes | Render, then toggle, then assert relabel in place | fixed | 1 |
| 19 | src/components/Tabs/Tab.tsx | 102 | Medium | Logic | A file named exactly `.md` / `.txt` strips to an EMPTY label when extensions are hidden | Keep the original when stripping empties it | fixed | 1 |
| 20 | src/components/Tabs/Tab.tsx | 214 | Medium | Logic | Close button's accessible name uses the stripped label, so `config.json` and `config.yaml` both read "Close config" | Use `tab.title` in the aria-label | fixed | 1 |
| 21 | src/components/TitleBar/TitleBar.tsx | 123 | High | Logic | With extensions VISIBLE, deleting the extension while renaming silently fails — `renameFile` re-attaches it, so `notes.md` → `notes` returns "unchanged" | Only re-attach when the extension was hidden from the editor | fixed | 2 |
| 22 | src/components/TitleBar/TitleBar.tsx | 123 | High | Logic | Edit state survives a programmatic tab switch; stale `editValue` submits against the new `filePath` | Capture the editing path, cancel on change | skipped (pre-existing) | - |
| 23 | src/components/TitleBar/TitleBar.tsx | 134 | High | Logic | `onBlur` closes the editor even while a rename is pending, contradicting "keep editing on failure" | Ignore blur while renaming | skipped (pre-existing) | - |
| 24 | src/components/TitleBar/TitleBar.tsx | 120 | High | Logic | Trim-before-compare silently renames when confirming an unchanged name with surrounding whitespace | Compare raw, trim only to detect empty | skipped (pre-existing) | - |
| 25 | src/components/TitleBar/TitleBar.tsx | 73 | Medium | Refactoring | `DocumentTitleBar` mixes selection, formatting, save dispatch, rename state, focus, render | Extract a rename state-machine hook | skipped (pre-existing) | - |
| 26 | src/pages/settings/FilesImagesSettings.tsx | 76 | High | Logic | The new toggle's UI wiring is untested — no test renders the stored value or asserts the click updates it | Add `FilesImagesSettings.test.tsx` | fixed | 1 |
| 27 | src/pages/settings/FilesImagesSettings.tsx | 56,69 | Medium | Shortcuts | Workspace-config write failures are invisible (optimistic store update, discarded promise) | Make failure observable, roll back | skipped (pre-existing) | - |
| 28 | src/pages/settings/FilesImagesSettings.tsx | 16 | Medium | Refactoring | ~247-line component owning several unrelated settings groups | Extract per-group components | skipped (pre-existing) | - |
| 29 | src/stores/settingsStore/shortcutDefinitions.ts | 41 | High | Duplication | `DEFAULT_SHORTCUTS` duplicates id/key/menuId with `keybindingManifest.ts`; both claim source of truth | Derive the manifest from this registry | skipped (pre-existing) | - |
| 30 | src/stores/settingsStore/shortcutDefinitions.ts | 14 | High | Duplication | Category ids repeated in the union, `CATEGORY_LABELS`, `CATEGORY_ORDER` | One `as const` structure, derive the rest | skipped (pre-existing) | - |
| 31 | src/stores/settingsStore/shortcutDefinitions.ts | 151 | Medium | Logic | Giving `toggleAllFiles` a default changes behaviour for a config that stored `""` deliberately: `getShortcut` tests truthiness, so the cleared binding now resolves to the new default | Use presence (`??`) not truthiness in `shortcuts.ts` | skipped (pre-existing) | - |
| 32 | src/stores/settingsStore/shortcutDefinitions.ts | 22 | Medium | Dead code | `ShortcutScope` / `.scope` unused by production; runtime scope comes from `KEYBINDINGS` | Remove or make authoritative | skipped (pre-existing) | - |
| 33 | src/stores/settingsStore/shortcutDefinitions.ts | 33 | Medium | Shortcuts | Shortcut descriptions are hardcoded English, rendered directly, bypassing i18n | Store translation keys | skipped (pre-existing) | - |
| 34 | src/stores/settingsStore/shortcutDefinitions.ts | 126 | Low | Dead code | Comment references `useViewShortcuts`, a hook that no longer exists | Point at the keybinding registry | skipped (pre-existing) | - |
| 35 | src/stores/tabStoreHelpers.ts | 47 | High | Logic | Hot-exit restore overwrites the new full-name title with a legacy extensionless persisted title | Derive file-backed restored titles from the path | fixed | 1 |
| 36 | src/stores/tabStoreHelpers.ts | 151 | High | Logic | `applyPathUpdate` cannot represent `null`; a caller coerces to `""` | Accept `string \| null` | skipped (pre-existing) | - |
| 37 | src/stores/tabStoreHelpers.ts | 91 | High | Duplication | `updateTabTitle` re-implements `mapDocumentTabById`, rescanning and cloning every window | Reuse the keyed-update primitive | skipped (pre-existing) | - |
| 38 | src/stores/tabStoreHelpers.ts | 47 | Medium | Logic | Tab drag ghost renders `dragTab.title` raw, so extensions reappear while the setting is off | Apply `formatFileDisplayName` to the ghost | fixed | 1 |
| 39 | src/stores/tabStoreHelpers.ts | 68 | Medium | Shortcuts | `deriveFormatId` swallows every registry error and hardcodes `"markdown"` | Handle only the uninitialised case | skipped (pre-existing) | - |
| 40 | src/stores/tabStoreHelpers.ts | 29 | Low | Logic | `Date.now()` + `Math.random()` id is not collision-proof though uniqueness is load-bearing | `crypto.randomUUID()` | skipped (pre-existing) | - |
| 41 | src/stores/tabStoreHelpers.ts | 182 | Low | Dead code | `removeTabAt` doc comment orphaned and describes obsolete `closedTabs` behaviour | Move and correct | skipped (pre-existing) | - |
| 42 | src/utils/displayFileName.ts | 25 | High | Logic | Output depends on mutable global registry state while the API exposes only `(name, showExtensions)`; re-registration will not rerender consumers | Pass a policy/version explicitly | skipped (pre-existing) | - |
| 43 | src/utils/displayFileName.ts | 25 | Medium | Logic | Supported dotfiles (`.md`, `.txt`, `.yaml`) become an EMPTY label when hiding — the `.gitignore` test misses it because that extension is unregistered | Preserve the name when stripping empties it | fixed | 1 |
| 44 | src/components/Sidebar/FileExplorer/FileExplorer.tsx | 132 | Medium | Logic | Same as #4, seen from the consumer side: tree and tab strip disagree for registered non-markdown files | See #4 | fixed | 1 |


## Round 1 — decisions on the two findings not fixed

**#5 — threading `showExtensions` into `useFileTree` reloads the tree.** Accepted.
The hook already takes `showHidden` and `showAllFiles`, which trigger exactly the
same reload; flipping any of the three is a rare settings action. The proposed
alternative — keep raw names in the tree and format at render — splits naming
across two layers and desynchronises the inline rename prefill from what the row
displays, which is the class of bug #21 turned out to be. Not worth trading a
correctness seam for a reload the user asks for.

**#15 — the header toggle is fire-and-forget.** Accepted for now, and tracked.
`toggleShowAllFiles` is the same call the keyboard shortcut and the settings row
already make; the swallowing happens one level down in `updateWorkspaceConfig`,
which catches write errors after optimistically updating the store (finding #27,
pre-existing). Guarding only the new button would leave three callers of one
service behaving differently. The real fix is #27 — make the service return an
outcome — and it belongs to its own change.


## Round 1 verification (independent Codex read-only pass, thread `019fda70-26a4-79b1-aa9b-9f3cc21cb9f2`)

9 FIXED, 1 REGRESSED.

**#21 REGRESSED — and correctly so.** The ordinary rename was fixed, but
`handleConfirm` read the LIVE `showExtensions` and the recomputed `displayName`
instead of the values in effect when the editor opened. Settings sync across
windows, so a flip mid-rename reinterpreted text the user had already typed:
`notes.md` → `notes`, begun as "drop the extension", silently became "no change"
and cancelled.

Worth recording how close this came to being missed: the first draft of the
regression test PASSED. Its `beforeEach` had no `vi.clearAllMocks()`, so the
assertion matched a `renameFile` call left over from an earlier test in the same
file. With the mock cleared the test failed with `Number of calls: 0` — the
silent cancel, exactly as reported.

**Round 2 fix.** `editOpenedWith` snapshots `{ name, showExtensions }` when the
editor opens; `handleConfirm` compares and derives `preserveExtension` from the
snapshot. Three interaction tests now cover the TitleBar's own option
derivation, including the mid-rename flip.


## Round 2 verification (independent Codex read-only pass, thread `019fda75-a9c6-77f1-8153-8d7624dd7599`)

**#21 FIXED.** The snapshot is taken when editing begins and drives both the
equality check and `preserveExtension`. Asked specifically whether the new test
could pass vacuously, the verifier confirmed it could not: the store update is
real, mock history is cleared per test, and without the snapshot the live
`displayName` would equal `"notes"`, no rename would fire, and the assertion
would fail. Asked specifically about ref lifetime across tab switches, unmount,
Escape, blur and a second rename, it found no new defect — unmount destroys the
ref, Escape and blur make it unreachable, and each rename overwrites it.

It re-flagged that stale edit text can still be submitted against a new
`filePath` after a programmatic tab switch — finding #22, pre-existing and
unchanged by this work.

**Result: 10 of 10 in-scope findings FIXED. Loop ended at round 2 of 3.**

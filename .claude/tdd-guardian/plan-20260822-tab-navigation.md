# Plan — Tab navigation and split-view surfacing

**Source of truth:** `dev-docs/plans/20260822-tab-navigation-and-split-surfacing.md`
(revision 2, Codex refute-reviewed 2026-08-22). This file is the TDD-Guardian
*projection* of that plan into `### WI-N:` work items. It does not restate the
decisions (D0–D10), the edge-case register, or the review ledger — read the
source for those. Where the two disagree, the source wins.

**Why this was adapted rather than re-planned.** `/tdd-guardian:workflow` was
invoked with a PLAN PATH, not a task description. Dispatching `tdd-planner` to
regenerate would have discarded two revisions, a Codex refute pass with 10 BLOCK
findings, four closed decisions, and three already-implemented work items — and
produced ids that no longer matched the code on disk. Step 2's deliverable is
"a plan file with extractable work items"; that is what this file is.

**Stack:** react-ts-vitest · lane `unit` (`pnpm test`, migrated from schema v1).
**Coverage authority:** `vitest.config.ts` ratchet floors via `pnpm test:coverage`
— NOT `config.json`'s thresholds, which are `null` by deliberate project
decision and which the loader defaults to 100%.

---

## Phase 0 — Repairs the feature work stands on

### WI-TNAV0.1: Browser activations reach the activation bus
**Status:** DONE (2026-08-22)
`addBrowserPage` wrote `activeTabId` without announcing, so no MRU could see a
browser activation and `paneStore`'s split convergence silently skipped them.
**Acceptance:** every tabStore action that changes `activeTabId` announces.
**Tests:** `src/stores/tabActivationBus.test.ts` (RED verified by reverting the
fix: 5 of 8 fail without it).

### WI-TNAV0.2: Activation origin on the bus
**Status:** DONE (2026-08-22)
`ActivationOrigin = "user" | "restore" | "background"`, defaulting to `"user"`.
**Acceptance:** existing call sites behaviourally unchanged; origin reaches listeners.
**Tests:** `src/stores/tabActivationBus.test.ts`.

### WI-TNAV0.3: Canonical duplicate-shortcut detection
**Status:** DONE (2026-08-22)
Detector keyed raw strings; `canonicalChord` normalizes modifier order and
resolves `Mod`→ctrl off macOS. First run found a live shipped collision
(`paragraph` vs `toggleSidebar` on Windows/Linux).
**Acceptance:** a canonically-duplicate pair fails the detector; shipped set clean.
**Tests:** `src/stores/settingsStore/shortcutDefinitions.test.ts`.

---

## Phase 1 — The tab strip tells the truth

### WI-TNAV1.1: Overflow detection that survives a capped box
Hook `useTabStripOverflow` returning `{canScrollLeft, canScrollRight}`.
**Acceptance:** correct when content changes without a resize event — the strip
is `max-width`-capped, so once capped its box stops changing while `scrollWidth`
still moves as tabs are added, removed or renamed. A `ResizeObserver` alone
cannot see that.
**Required tests:** fixed `clientWidth` + changed `scrollWidth` with NO resize
callback ⇒ `canScrollRight` updates; no overflow ⇒ both false; scrolled to end
⇒ left true / right false.
**Files:** `src/hooks/useTabStripOverflow.ts` (+ test)

### WI-TNAV1.2: Fade masks and conditional chevrons
**Acceptance:** absent without overflow; present and clickable with it;
absolutely positioned so they cannot themselves cause overflow; not inside the
`role="tablist"` child order.
**Required tests:** all four above.
**Files:** `src/components/StatusBar/StatusBarTabStrip.tsx`, `StatusBar.css`

### WI-TNAV1.3: Scroll the active pill into view
**Acceptance:** fires on activation change with `block: "nearest"`; honours
`prefers-reduced-motion`; suppressed during drag-reorder; **also fires for the
synthetic browser pill**, which `StatusBar.tsx:216` drives with
`activeTabId={null}` so an `activeTabId`-only trigger can never reveal it.
**Required tests:** all four, including the browser-pill case.
**Files:** `src/components/StatusBar/scrollActiveTabIntoView.ts` (+ test)

### WI-TNAV1.4: Scroll region is keyboard-reachable
**Acceptance:** container focusable and accessibly named (a11y requirement for
a scrollable region with a suppressed scrollbar).
**Required tests:** focusable; has an accessible name.
**Files:** `src/components/StatusBar/StatusBarTabStrip.tsx`

---

## Phase 2 — Most-recently-used navigation

### WI-TNAV2.1: The MRU store
`src/stores/tabMruStore.ts`, subscribing to `tabActivationBus`.
**Acceptance:** move-to-front on `origin: "user"` only; ignores `null`, `restore`
and `background`; prunes on `onTabRemoved`; clears on `removeWindow`; the
browser workspace is ONE entry, not one per page (D6).
**Required tests:** A→B→C ⇒ `[C,B,A]`; re-activation idempotent; each non-user
origin ignored; closed tab pruned; `removeWindow` clears; two browser pages
collapse to one entry.
**Files:** `src/stores/tabMruStore.ts` (+ test)

### WI-TNAV2.2: The `tab.lastUsed` command
**Acceptance:** activates MRU[1] of the visible projection; two presses return
to origin **under the stated preconditions** (active tab is MRU[0]; visible set
stable); no-op at 0 or 1 tabs; skips hidden and closed tabs.
**Required tests:** the above, plus an **integration test against the real bus**
— create A, create B, create browser page P, then two presses must return to P.
An isolated store test cannot decide this; that gap is what hid WI-TNAV0.1.
**Files:** `src/services/commands/tabCommands.ts`

### WI-TNAV2.3: `Ctrl-Tab`, native-menu-owned
**Acceptance:** bound via `nativeMenuBinding` (`captureOwner: "native-menu"`)
because a DOM binding is dead while the WKWebView browser holds first responder.
Takes a `menuId` and therefore the full seven-surface menu contract.
**Required tests:** resolves to a registered command with the right
`captureOwner`; `KeyCapture` yields `Ctrl-Tab` for physical Ctrl, **not**
`Mod-Tab` (`KeyCapture.tsx:42` maps physical Ctrl to `Mod`, which is Cmd on
macOS); canonical duplicate detector stays clean.
**Files:** `shortcutDefinitions.ts`, `keybindingDefinitions.ts`, Rust menu, docs,
`MENU_ICONS`, `VIEW_BINDINGS`, `EXCLUDED_MENU_IDS`, locales

### WI-TNAV2.4: MRU-order QuickOpen's open tier — and fix the dedup
**Acceptance:** the `open` tier is MRU-ordered AND actually reachable. Recents
are emitted first and win dedup, while opening a file adds it to recents, so
most open files never enter the `open` tier at all — ordering it alone is a no-op.
**Required tests:** recents `[B,A]`, both open, tab MRU `[A,B]` ⇒ first result is
**A**; partial MRU `[C]` with A/B/C open ⇒ A and B must not disappear.
**Files:** `src/components/QuickOpen/useQuickOpenItems.ts`

### WI-TNAV2.5: Hot-exit restore does not fabricate an MRU
**Acceptance:** restore-origin activations ignored; bulk clear via
`removeWindow` handled. Restoring A,B,C with A active must NOT yield `[A,C,B]`.
**Required tests:** real-bus restore integration test (an isolated empty-store
test cannot decide this).
**Files:** `src/services/persistence/hotExit/*`

---

## Phase 3 — The #1081 follow-ups

### WI-DSPL1.1: Pane indicator computed from focus, not position
**Acceptance:** derived from `focusedPane`, never from `secondaryTabId` —
`openSplit` focuses secondary, so marking by position marks the FOCUSED pill.
Exactly one `aria-selected` throughout; empty secondary is a legal state.
**Required tests:** split off ⇒ none; A/B split with focus flipped
secondary→primary ⇒ indicator follows the non-selected pill; empty secondary ⇒
no indicator, no crash.
**Files:** `src/components/StatusBar/StatusBarTabStrip.tsx`, `Tab.tsx`

### WI-DSPL1.2: Native View-menu items for the four pane commands
**Acceptance:** all seven surfaces updated (definitions, Rust mirror, real
`accel()`, docs table, `MENU_ICONS`, `VIEW_BINDINGS`, `EXCLUDED_MENU_IDS`) plus
`en.yml` + 9 locales. Without `VIEW_BINDINGS` the items are DEAD.
**Required tests:** `check-keybinding-manifest`; `useCommandBootstrap.test.tsx`;
`menuIdExtraction.test.ts`; `actionRegistry.test.ts`.

### WI-DSPL1.3: Shortcuts for focusOtherPane / closePane
**Acceptance:** chords verified free under the canonical detector from
WI-TNAV0.3. `Alt-Mod-[` / `Alt-Mod-]` are NOT available — they canonicalize to
the shipped heading commands.
**Required tests:** canonical duplicate scan; manifest gate.

### WI-DSPL1.4: Website documentation
**Acceptance:** `website/guide/tab-navigation.md` documents MRU and split navigation.
**Required tests:** `pnpm lint:emdash`; `pnpm lint:keybinding-manifest`;
`cd website && pnpm build`.

### WI-DSPL1.5: Tab context-menu "Open to the Side"
The #1081 plan's other named follow-up, and the discoverable trigger the split
has never had.
**Acceptance:** present with ≥1 document tab; absent for a browser tab; opening
an already-paned tab focuses it rather than duplicating.
**Required tests:** the three above.
**Files:** `src/components/Tabs/useTabContextMenuActions.ts`

### WI-DSPL1.6: Promote the survivor instead of collapsing (D10)
**Acceptance:** closing secondary keeps the split; closing primary promotes
secondary; last document still collapses; a declined (pinned) close still no-ops.
**Required tests:** the four above.
**Files:** `src/stores/paneStore.ts`

### WI-DSPL1.7: Resolve the A/A split contract (D9)
A/A is legal live, illegal on `replaceWindowSplit`, and unpersistable — so a
toggle plus a workspace round-trip silently collapses.
**Acceptance:** `toggleSplitDocuments` opens with the NEXT document and no-ops
below two document tabs; no-ops when a browser tab is active
(`activeDocument.ts:25` accepts any kind today).
**Required tests:** the three above, plus toggle → workspace switch away/back.
**Files:** `src/services/navigation/toggleSplitDocuments.ts`

<!-- WI-DSPL1.8 was DROPPED before implementation: 62 production files cite
     dev-docs/ paths, so paneStore.ts:19 is a convention, not an anomaly.
     Recorded as R5 in the source plan. Removed from the work-item list so
     check-wi-linkage.sh does not demand linkage for work that is not done. -->

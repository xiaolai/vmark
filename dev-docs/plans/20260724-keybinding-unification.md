# Keybinding Unification — one binding registry, many capture adapters

**Status:** ✅ BUILD COMPLETE (2026-07-24) — all 8 phases + 3 audit rounds banked to refactor/vmark-core. Was: READY TO BUILD — recon done; **three Codex passes folded**
(RETHINK → NEEDS AMENDMENT → NEEDS AMENDMENT → READY). The confirming pass cleared
the plan once the containment-binding chord source was specified (the `ChordSource`
union below). Next: write ADR-018, then run **WI-0.1 (the canonicalizer spike) FIRST** —
an unsound identity contract there pauses the whole design.
**Branch:** `refactor/keybinding-unification` off `refactor/vmark-core`, parked
(no release) per `landing/local-integration-strategy.md`.
**ADR:** ADR-018 (Phase 1) — *the CommandBus is the single command authority; a
declarative binding registry owns resolution + precedence; PM, CM, window,
native-menu, and WKWebView are capture adapters over it.*
**Depends on:** command-registry unification (Phases 0–5, ✅).
**Unblocks:** MCP-bridge-through-the-bus; "single command surface" (ADR-017).

## The problem (grounded in recon)

One key event may be handled by **five layers** with **no central precedence
arbiter** — emergent from attach-point + `preventDefault`: (1) PM `editorKeymapExtension`
(`editorPlugins.tiptap.ts:62-381`) + ~10 feature extensions; (2) CM keymaps
(`sourceShortcuts.ts` + order-load-bearing `sourceEditorKeymap.ts:28-122`); (3) ~10
un-namespaced `window` hooks, none `stopPropagation`; (4) native accelerators →
`menu:{id}`; (5) **two concurrent `menu:{id}` dispatchers**, split unenforced.
Debts: triple-defined `Mod-z/Mod-y`; hardcoded `Mod+W`; manual three-file sync;
only two paths reach the bus.

## The model (ADR-018 core)

A declarative registry; every capture surface is an adapter that canonicalizes the
chord, asks the registry for candidates, resolves by context, and acts. A binding is
a **discriminated union** so a browser-default-containment entry needs no fake command
(Codex R2 #2):

```ts
type Scope =
  | "modal" | "terminal" | "editor-wysiwyg" | "editor-source"
  | "input" | "panel" | "window";           // native ownership is NOT a scope (below)

interface Policies {
  scope: Scope;
  when?: (ctx: BindingContext) => boolean;
  priority: number;                          // see the priority contract (WI-1.1)
  captureOwner: "window" | "prosemirror" | "codemirror" | "native-menu" | "wkwebview";
  repeat: "deny" | "allow" | "coalesce";
  reentrancy?: "drop" | "queue" | "parallel";     // async commands
  ime: "block" | "chord-exempt" | "editor-local"; // per binding, NOT one gate
}
// Every binding — command OR containment — needs a chord source to key the index
// (Codex R3): a rebindable `shortcutId`, or a `fixedChord` for non-configurable
// browser-default guards (useSelectAllScope → fixedChord: canonicalize("Mod-a")).
type ChordSource = { shortcutId: string } | { fixedChord: CanonicalChord };
type Consumption = "preventDefault" | "preventAndStop" | "passthrough";

type Binding =
  | (Policies & ChordSource & { kind: "command"; commandId: string; consumption: Consumption })
  | (Policies & ChordSource & { kind: "containment"; consumption: Exclude<Consumption, "passthrough"> });

type ResolutionOutcome = "execute" | "consumeOnly" | "pass"; // adapter result, separate
```

Index: `Map<CanonicalChord, Binding[]>` — a chord → an **ordered candidate list**, not
one command (Codex R1 #2). Canonicalization is the **same primitive the runtime matcher
uses** (`shortcutMatch.ts`), so index and match never diverge.

**Resolution is independent dimensions, NOT one total ladder (Codex R2 #1):**
1. Determine the active **context stack** (modal/KeyCapture, terminal, PM or CM editor
   owner, ordinary input/contenteditable, panel, window) — noting both editors *are*
   contenteditable (`useSelectAllScope.ts:35` recognizes CM via contenteditable before
   `.cm-editor`; xterm focuses an internal textarea), so "input" must NOT outrank the
   terminal/editor owner.
2. Filter candidates by `captureOwner` eligibility for the current focus context.
3. Filter by `when(ctx)`.
4. Select by **context specificity, then declared priority** (contract in WI-1.1).
5. If no executable candidate handles it, apply the **containment fallback**.

**The invariant (Codex R1 #6) — AMENDED during Phase 4 (build log v4):** there is a
single command authority *per surface*, not a single global entry point.
- **Window / global bindings** enter through `executeCommand` (`useKeybindingRouter`).
- **Editor-surface bindings** (WYSIWYG + Source formatting/editing keys) enter through
  the shared **editor executor `runEditorAction`** — the SAME path the editor menu uses
  (`dispatchMenuAction` → `runEditorAction`), so keyboard, menu, and toolbar share one
  editor-action authority.

The original text ("everything through `executeCommand`; direct `runEditorAction` from a
keymap is a violation") was **falsified by implementation**: routing editor keys through
`executeCommand("editor.X")` applies the palette `actionAvailability` gate (requires
`ctx.editorAvailable` + node/selection context), which is stricter than the executor's
`isActionExecutable` and **silently dropped keyboard formatting** (Cmd+B no-op while
`menu:bold` worked — caught only by live E2E). Editor keymaps therefore call
`runEditorAction` directly BY DESIGN. This is the reconciled invariant; ADR-018 should be
read with this amendment.

## Decisions — settled with Codex (rule 60 §6)

| D | Settled (v3) |
|---|---|
| D1 | No feature-category boundary. `scope` + `when(ctx)` per binding; ambiguous chords (`wordWrap`, `Mod+A`, `sourceMode`, `Mod+Y`) are one binding per scope, resolved by context |
| D2 | `Map<CanonicalChord, Binding[]>`; canonicalizer shared with `shortcutMatch.ts`; conflicts scope/when/platform-aware. **Cross-scope coexistence allowed; equal-scope + equal-priority overlap is a registry error, not first-wins.** "Assign Anyway" allowed only across non-overlapping scopes (WI-1.4) |
| D3 | Merge the two menu dispatchers behind a menu-dispatch **policy object** (focus-gate for editor actions only; owns `disposeEditorActionOwner`; payload→args; partial-registration rollback) |
| D4 | Centralize policy *representation*; evaluate `ime`/`focus`/`repeat` per binding/source. PM/CM composition checks stay in their adapters |
| D5 | `repeat: deny\|allow\|coalesce` + async `reentrancy: drop\|queue\|parallel`; settled in the Phase-0 spike |

## Phase 0 — Recon (done) + COMPLETE inventory + spikes (blockers)

- **Recon: COMPLETE** (five-layer map, 8 conflict surfaces, file:line anchored).
- **WI-0.0 — complete the migration matrix NOW (Codex R2 #5).** One row per
  listener/keymap producer, no grouping: `useViewShortcuts`, `useTabShortcuts`,
  `useFileExplorerShortcuts`, `useSelectAllScope`, `useFileShortcuts`,
  `useGenieShortcuts`, `useQuickOpenShortcuts`, `useContentSearchShortcuts`,
  `useCommandPaletteShortcut`, `useUniversalToolbar`, each of the ~10 feature Tiptap
  `addKeyboardShortcuts` producers, `editorKeymapExtension`, `sourceShortcuts`, each
  structural group in `sourceEditorKeymap`, native accelerators, `KeyCapture`
  interception. Columns: captureOwner, scope, ime, focus, repeat, reentrancy,
  consumption, `when`, commandId | mechanic-id, removal-test. A phase cannot estimate
  scope or write RED tests from an incomplete matrix.
- **WI-0.1 — canonicalizer spike (highest-risk; run FIRST).** Prove ONE canonicalizer
  (derived from `shortcutMatch.ts`) establishes a stable **logical-vs-physical key
  identity contract** and round-trips across: US / non-US / CJK-IME / shifted symbols /
  macOS-Ctrl control chars; **the `-` separator-escaping problem** (`Alt-Mod--`,
  `Mod--`; `shortcutMatch.ts:81` splits on `-` and its own `:67` comment admits `-` is
  unreachable); dead keys / `event.key==="Dead"`; `AltGraph` (Ctrl+Alt layouts);
  numpad identity (`Enter` vs `NumpadEnter`, digits, decimal, add/subtract);
  `Process`/`Unidentified`/229; modifier-only + left/right modifiers; how Caps/Fn are
  **ignored**; media/system keys iff Settings accepts them; and **serialization
  stability** across KeyCapture ⇄ persisted settings ⇄ PM syntax ⇄ CM syntax ⇄ Tauri
  accelerator syntax. If a stable identity contract can't be established, **the
  registry design pauses** (Codex R2 #3).
- **WI-0.2 — ambiguous-binding spike.** One pure-global + one context-ambiguous chord
  (`Mod+A`/`wordWrap`) through a prototype registry: context resolution picks the right
  candidate, no double-fire, IME + focus hold.
- **WI-0.3 — repeat/reentrancy spike** (held-key repeat; async reentrancy).
- **WI-0.4 — manifest feasibility.** Prove a language-neutral JSON/JSON5 manifest can
  drive TS (runtime) + Rust accelerator generation + the website table, preserving
  menu-less bindings and `defaultKeyMac`/`defaultKeyOther`.

## Phase 1 — Precedence contract + registry + referential integrity (FIRST)

| WI | Change |
|---|---|
| WI-1.1 | ADR-018: the independent-dimensions resolution above + the **priority contract** — capture-owner eligibility → context specificity → declared priority (higher wins) → unique-binding validation; **registration-order tie-breaking is forbidden; equal surviving candidates are a registry error** (Codex R2 #12) |
| WI-1.2 | The registry data model (discriminated union) + `Map<CanonicalChord, Binding[]>` + the shared canonicalizer (from WI-0.1) |
| WI-1.3 | **Definition classification + referential integrity moved here (Codex R2 #7):** every `shortcutDefinitions.ts` entry declares a consumer + capture owner; the registry rejects a `shortcutId` that is missing, unclassified, or incompatible with its captureOwner; unknown imported ids can't enter the index; empty defaults stay unbound |
| WI-1.4 | Scope-aware conflict model + "Assign Anyway" semantics (D2): cross-scope OK; equal-scope/equal-priority rejected; dynamic-`when` overlap approximated + surfaced in Settings |
| WI-1.5 | **Adopt the WI-0.4 manifest as the source now (Codex R2 #9)** if the spike passed — before bulk migration, so consumers don't churn later. (Doc/Rust generation still lands in Phase 8.) |

**DoD:** registry + canonicalizer unit-tested against the WI-0.1 corpus; the conflict
model distinguishes real same-scope clashes from valid cross-scope coexistence and
flags equal-priority overlap as an error; referential-integrity gate rejects a dangling
`shortcutId`.

## Phase 2 — One menu dispatcher + capture-ownership + min DOM/native dedup (Codex R2 #4)

Menu topology AND native/DOM ownership become deterministic before the keyboard
migration, so exactly-once is establishable.

| WI | Change |
|---|---|
| WI-2.1 | Menu-dispatch policy object (source-aware: focus-gate for editor actions only; `disposeEditorActionOwner`; payload→args; partial-registration rollback) |
| WI-2.2 | Move editor-action `menu:{id}` bindings into `menuListener`/`useCommandBootstrap`; delete `useUnifiedMenuCommands`; **mount-time** duplicate rejection |
| WI-2.3 | Declare per-chord capture ownership (context-dependent) + **minimum DOM↔native mutual exclusion** so an accelerator isn't delivered twice during the window migration |

**DoD:** one `menu:{id}` path with mount-time duplicate rejection; a test proves a
native-owned chord isn't also DOM-delivered in the same context.

## Phase 3 — Window/global capture adapters (migration matrix, RED-before-delete)

One window (bubble) + one capture-phase adapter over the registry. Each hook migrates
only after its WI-0.0 matrix row has a RED test on the resolver; the hook's suite is
the regression net, deleted only when re-covered (Codex R1 #13).

| WI | Change |
|---|---|
| WI-3.1 | The window + capture adapters; the `ResolutionOutcome` (`execute`/`consumeOnly`/`pass`) is separate from `Binding.consumption` |
| WI-3.2 | Migrate view toggles (terminal-toggle-under-IME `useViewShortcuts.ts:49`; INPUT suppression `:125`) |
| WI-3.3 | Migrate tabs — `Mod+W` becomes a real rebindable binding; keep doc-window restriction + async dirty-close |
| WI-3.4 | Migrate genie / quick-open / content-search / palette / file-save (per-binding repeat + reentrancy) — **each its own matrix row** |
| WI-3.5 | `useSelectAllScope` → a **`kind:"containment"`** binding (browser-default guard, no command, no `stopPropagation`) |
| WI-3.6 | `useFileExplorerShortcuts` keeps capture-phase; workspace/config availability is a `when` predicate |

**DoD (narrowed, Codex R2 #4):** window/capture-adapter exactly-once with all DOM
adapters mounted; IME/focus/repeat parity per matrix row; the containment path preserves
propagation. Whole-system exactly-once (incl. native) is asserted in Phase 5.

## Phase 4 — Editor capture adapters through the bus (machine-checkable mechanic gate)

PM/CM keep capture; registered-command bindings execute via `executeCommand`. Every
PM/CM binding is classified with a **machine-checkable criterion — not a prose escape
hatch (Codex R2 #6).**

| WI | Change |
|---|---|
| WI-4.1 | Mechanic gate: an "editor mechanic" has NO `shortcutId`, NO menu/palette command, a stable mechanic-id + rationale, lives on an allowlist, and cannot share an id with any command/shortcut. The gate compares extracted binding ids against `registeredCommandIds ∪ approvedMechanicIds`, rejects duplicate classification, and rejects a "mechanic" that has a `menuId` or configurable shortcut (guards `sourceEditorKeymap.ts:27`, which mixes true mechanics with word-wrap / occurrence-select / task-toggle / undo-redo) |
| WI-4.2 | WYSIWYG + Source command-bindings execute through `executeCommand`; composition / multi-selection guards stay in the adapter |
| WI-4.3 | Single source of truth for `Mod-z`/`Mod-Shift-z`/`Mod-y` |

**DoD:** the mechanic gate fails on an unclassified or mis-classified PM/CM binding;
command-bindings prove a palette↔keyboard bus-path differential (not just an equal
`runEditorAction` call).

## Phase 5 — Native + WKWebView ownership + whole-system exactly-once (Codex R1 #8, R2 #10)

| WI | Change |
|---|---|
| WI-5.1 | Full context-dependent capture ownership; `newBrowserTab`-class chords stay native while WKWebView has focus (`shortcutDefinitions.ts:155`) |
| WI-5.2 | Whole-system exactly-once: the window adapter **rejects a candidate when its resolved ownership for the current context is native-only** (not "globally unreachable") |
| WI-5.3 | Rebinding native accelerators + failure behavior when `update_menu_accelerators` fails; Tauri + VMark/WKWebView E2E for browser-first-responder cases |

**DoD:** an E2E proves no double-execution when both DOM and native can see a chord in
a given context; a context-native chord is rejected by the window adapter in that context.

## Phase 6 — KeyCapture UX + the ~105-entry cleanup (integrity already in Phase 1)

| WI | Change |
|---|---|
| WI-6.1 | `KeyCapture.tsx` uses the same parser/serializer/canonicalizer as runtime matching (WI-0.1); "Assign Anyway" is deterministic + scope-aware (WI-1.4) |
| WI-6.2 | Complete the ~105-definition cleanup; menu-less/unbound entries verified absent from the index |

**DoD:** KeyCapture output round-trips through the canonicalizer; a bulk audit confirms
every definition's classification (the gate itself lives in Phase 1).

## Phase 7 — Cross-window propagation (multi-window integration, Codex R1 #9)

`useShortcutsSync.ts:43` applies remote state via `setState` and skips native-menu sync;
PM/CM rebuild via their own subscriptions.

**DoD (a named integration suite, not one scenario):** a Settings rebind updates the
window adapter index, PM keymap, CM keymap, native accelerator, and the conflict display
in every open window; covers reset / reset-all / import / rapid edits / malformed storage
/ window teardown.

## Phase 8 — Manifest-driven generation + docs (Codex R2 #9, #11)

| WI | Change |
|---|---|
| WI-8.1 | Generate Rust accelerator defaults (only `menuId` entries — a menu-less binding produces **no** Rust entry and must not be **invented or lost**), the website table, and TS types from the Phase-1 manifest; a drift gate fails on divergence |
| WI-8.2 | Update `website/guide/shortcuts.md` + rewrite rule 41 around the manifest |

**DoD:** editing the manifest regenerates all surfaces; the drift gate catches a hand-edit
that diverges; generation neither invents an accelerator for a menu-less binding nor loses
its TS/docs definition.

## Test taxonomy (Codex R2 #11 — named categories, matched to surfaces)

1. **canonicalizer corpus** (pure) — WI-0.1. 2. **registry resolver** (pure) — Phase 1.
3. **mounted DOM adapters** (jsdom, all adapters) — Phase 3/4 exactly-once + parity.
4. **Tauri native-accelerator E2E** — Phase 5. 5. **VMark/WKWebView E2E** — Phase 5
browser-first-responder. 6. **multi-window sync integration** — Phase 7. No DoD claims a
guarantee its category can't establish (no synthetic event proving native behavior).

## Build log v2 (2026-07-24) — 24 bindings migrated, router per-window

**Phase 3 migrations COMPLETE for 6 hooks (all green, banked to vmark-core):**
command-palette, find-in-files, quick-open, all 18 `useViewShortcuts` actions,
2 file-explorer toggles, and select-all containment (the `containment` binding
kind + capture-phase adapter both now exercised in production). **24 bindings.**
The router-mounting-scope decision was resolved: the router moved from
main-window-only (`MainWindowRunners`) to per-document-window
(`useEditorLifecycle`) — fixing a latent bug where the overlay shortcuts didn't
work in secondary windows. Several misfiled modules relocated to their tiers
along the way (`commandPaletteStore`, `quickOpenStore` → `stores/`;
`workspaceConfig` → `services/workspaces/`).

**`useTabShortcuts`: DONE** (2026-07-24). Registered tab.new/next/prev/close +
view.toggleStatusBar from the **hooks tier** (`hooks/tabCommands.ts`, called by
`useCommandBootstrap`) — this sidesteps the deep save/cleanup cascade
(`useTabOperations`→`closeSave`→`useDefaultSaveFolder`; `tabCleanup`→
`contentSearchNav`): hooks→hooks is tier-valid and the commands call the exact
existing functions, so `closeTabWithDirtyCheck` is behavior-neutral. `closeTab`
now a real rebindable binding (WI-3.3). **The hooks-tier command-registration
pattern is the key that unblocks the last two hooks.**

**Remaining Phase-3 hooks (2 of 9) — the hardest, each a real refactor:**
- `useFileShortcuts`: menu-heavy — keyboard save/saveAs PLUS `menu:new/open/save/
  save-as/move-to/save-all-quit` listeners (save-all-quit is quit-adjacent). Needs
  `file.save`/`file.saveAs`/… commands (register from hooks tier per the pattern
  above) and the menu events routed to them. All-or-nothing (one hook), so it's a
  whole-file-menu slice.
- `useGenieShortcuts`: **React-coupled** — the `aiPrompts` handler invokes a genie
  via `useGenieInvocation()` (a hook returning `invokeGenie`). A bus command's
  `run()` can't call a hook, so this needs the genie-invocation logic extracted to
  a plain function FIRST. Also carries `menu:search-genies`/`reload-genies`.

These two warrant a fresh, careful pass (quit-adjacent save + a genie-invocation
extraction) — not a fatigued rush.

## Build log — completed slices + discovered decisions (2026-07-24)

**Landed on `refactor/vmark-core` (all green, behavior-neutral):**
- Phase 0/1: `utils/keybinding/canonicalChord.ts` (identity contract, 15-case
  corpus), `services/keybinding/bindingRegistry.ts` (resolver, ~12 tests),
  `keybindingRegistry.ts` (live service + rebind reactivity), ADR-018.
- Phase 3: `hooks/useKeybindingRouter.ts` (window capture adapter) +
  `bindingContext.ts` + `keybindingDefinitions.ts`; **3 shortcuts migrated**
  (command palette, find-in-files, quick-open). Two misfiled UI stores
  (`commandPaletteStore`, `quickOpenStore`) relocated to `stores/`.
- Phase 2: WI-2.3 mount-time menu duplicate rejection. `view.toggleSidebar`
  command registered (the one view action lacking a bus command).

**Two decisions discovered mid-build — resolve BEFORE the next slices:**
1. **Router mounting scope (blocks the remaining Phase-3 migrations).** The
   router mounts main-window-only (`MainWindowRunners`), but `useViewShortcuts`
   (and tabs/file hooks) mount per-document-window (`useEditorLifecycle`).
   Migrating a per-window hook onto the main-only router would double-fire in the
   main window and break secondary windows. Decision needed: move the router to
   `useEditorLifecycle` (all document windows) — which changes palette/quick-open/
   find-in-files from main-only to all-windows (a behavior change that interacts
   with where those overlays render), OR give bindings a window-scope axis. The
   18 `useViewShortcuts` bindings are already authored + verified 1:1 against the
   command set (in a reverted commit) — ready to re-apply once this is decided.
2. **Menu-dispatch gate policy (blocks the Phase-2 full merge, sharpens WI-2.1).**
   Routing the 87 editor `menu:{id}` events through `executeCommand(editor.*)`
   applies the palette's stricter `actionAvailability` `when()` instead of the
   executor's looser `isActionExecutable` gate the menu path intentionally uses —
   a real behavior change. The unified dispatcher's policy object must route
   editor actions via the executor gate (not the palette `when`), while other
   commands go through `executeCommand`.

## Build log v3 (2026-07-24) — Phase 3 complete (9/9 hooks); Phase 2 merged

**Phase 3 COMPLETE — all 9 window keydown hooks migrated + banked to vmark-core:**
command-palette, content-search, quick-open, view-toggles (18), file-explorer (2),
select-all containment, tabs (Mod+W now rebindable), **file save/open**, and
**AI genie picker**. The registry holds **33 bindings** (12 global + 18 view + 2
explorer + 1 containment). Both mid-build blockers are RESOLVED:
1. **Router mounting scope** — router moved to `useEditorLifecycle` (per document
   window). Palette/quick-open/content-search/genie became per-window; verified
   safe because each Tauri window is a separate webview with its own Zustand store
   instances, so the "global singleton" overlay stores are effectively per-window.
   This lifted the former main-window-only limitation (a latent bug), not a
   regression.
2. **Menu-dispatch gate policy** — see Phase 2 below.

**Phase 2 COMPLETE — one menu dispatcher (WI-2.1/2.2):** `useUnifiedMenuCommands`
deleted; its 86 editor `menu:{id}` events folded into `mountMenuCommands` via a new
`editorAction` binding kind. Source-aware dispatch: editor actions run
`runEditorAction` (executor `isActionExecutable` gate) + the menu-only focus gate,
NEVER `executeCommand`'s stricter palette `when()`; command bindings keep
`executeCommand`. One mount-time duplicate-rejection pass now covers the whole
menu space. `dispatchMenuAction` lives in `menuListener.ts` (separate from
`runEditorAction` so the bus↔menu differential gate can mock the executor). The
61-test hook suite migrated to `menuListener.editorActions.test.tsx`. **E2E-verified**
against the running dev app (Tauri MCP): `menu:insert-table` → exactly one table;
`menu:undo` → removed via unified history — behavior-neutral, exactly-once.

**Remaining:** Phase 1 tail (WI-1.3 classification / WI-1.4 conflict model / WI-1.5
manifest), Phase 4 (editor keymaps through the bus), Phase 5 (native/WKWebView
exactly-once — E2E), Phase 6 (KeyCapture UX + ~105-entry cleanup), Phase 7
(cross-window — E2E), Phase 8 (manifest codegen + docs).

## Build log v4 (2026-07-24) — Phase 4 complete (editor keymaps through the executor)

- **WI-4.1 (mechanic gate):** `services/keybinding/editorMechanics.ts` — the
  approved-mechanic allowlist + gate; rejects a "mechanic" that collides with a
  registered command, shortcut, or menu id. Additive, tested vs the real registries.
- **WI-4.3 (undo/redo single source):** `services/keybinding/undoRedoChords.ts` —
  both editor keymaps bind Mod-z / Mod-Shift-z / Mod-y from one place;
  `redoChords(isMac)` gates Mod-y off-mac (macOS reserves Cmd+Y for `aiPrompts`).
- **WI-4.2 (executor routing):** the ~76 WYSIWYG + Source formatting/editing
  keybindings now run through **`runEditorAction`** (the menu's executor path), NOT
  `executeCommand`. **Key finding (E2E-caught):** routing keyboard through
  `executeCommand("editor.X")` applies the palette `actionAvailability` gate
  (requires `ctx.editorAvailable` + node/selection context) — stricter than the
  executor's `isActionExecutable` — and **silently dropped keyboard formatting**.
  Unit tests (which mock the dispatch) passed; only the live-app E2E (Cmd+B
  no-opped while `menu:bold` worked) surfaced it. The executor path is the correct
  one and matches Phase 2's editor-menu gate decision. Also broke the import cycle
  the reroute introduced (adapter chain's `expandedToggleMark` now imports the
  original module, not the `editorPlugins.tiptap` re-export barrel).
  **Lesson:** mock-based unit tests cannot verify gate behavior; editor-facing
  keybinding changes need live E2E.

**Remaining:** Phase 1 tail (WI-1.3/1.4/1.5), Phase 5 (native/WKWebView
exactly-once — E2E), Phase 6 (KeyCapture UX + ~105-entry cleanup), Phase 7
(cross-window — E2E), Phase 8 (manifest codegen + docs). Then 3 audit-fix rounds.

## Build log v5 (2026-07-24) — Phase 5, manifest, Phase 6 (6.2), 3 audit rounds

**Banked since v4:** Phase 5 (native-only ownership + exactly-once rejection, WI-5.1/5.2),
WI-1.5 + Phase 8 (keybinding manifest + `lint:keybinding-manifest` drift gate — the
rule-41 three-file sync is now machine-enforced), WI-6.2 (canonicalization gate over
all 123 shortcut defs), and WI-1.3/1.4 (referential-integrity + conflict detection).

**Three cross-model audit rounds (Codex) — 5 active bugs found + fixed:**
1. **Round 1** (registry/router/context): split-view editor scope read the global
   `sourceMode` flag → mis-scoped the focused pane; now scoped by focused surface.
   `installBindings` stale-disposer could tear down a newer installation → token guard.
2. **Round 2** (editor keymaps → executor): **WI-4.2 regressed keyboard link editing** —
   `runEditorAction` passes `context.context=null`, so `openLinkEditor` read
   `inLink=false` and overwrote/toggled an existing link instead of editing it. Fixed by
   deriving the link at the caret from the live view. (Plus earlier E2E-caught fixes: the
   `executeCommand` palette-gate dropping keyboard formatting, and the `closeTab`→`closeFile`
   broken Mod+W binding.)
3. **Round 3** (command bootstrap / manifest): **no active bugs** (Codex confirmed no id
   collisions, gate passes, windowLabel correct, no stale-window bug). 5 LATENT robustness
   findings documented for a fresh-session fix: register* batches use a first-id guard +
   non-atomic registration (a future id collision could leave a partial batch — convert
   tab/file/genie to owner-based `registerCommands`); the drift-gate TS parser only matches
   `id: "..."`-first object literals (reformatting a def could make it fail open — parse via
   AST); and menu listeners wait on the lazy Pandoc import (pre-existing latency).

**Remaining:** WI-6.1 (KeyCapture should capture `event.code`, not `event.key` — Codex flagged
shifted-symbol custom rebinds silently failing), WI-8.2 (website `shortcuts.md` + rule-41
rewrite around the manifest), Phase 7 (cross-window propagation — needs a stable multi-window
E2E harness; the dev app must be relaunched from this worktree), and the round-3 latent
robustness fixes. Non-QWERTY physical-vs-logical matching (Codex round 1 #1) is a deliberate
design choice, not a bug.

## Build log v6 (2026-07-24) — ALL PHASES COMPLETE + 3 audit rounds done

Every phase is implemented, tested, and banked to `refactor/vmark-core` (green
`pnpm check:all` throughout):

- **Phase 1** (registry + precedence + referential integrity + conflict model +
  manifest) — 1.1/1.2 registry, 1.3 integrity gate, 1.4 conflict detection, 1.5 manifest.
- **Phase 2** — one source-aware menu dispatcher.
- **Phase 3** — all 9 window keydown hooks migrated (33 bindings).
- **Phase 4** — mechanic gate, undo/redo single source, keymaps through the executor.
- **Phase 5** — native-only ownership + exactly-once rejection.
- **Phase 6** — 6.1 KeyCapture validates against the canonicalizer (rejects unmappable
  chords); 6.2 canonicalization gate over all 123 defs.
- **Phase 7** — cross-window propagation, verified end-to-end
  (`crossWindowPropagation.test.ts`): a rebind arrives as a shared-localStorage
  `storage` event → `useShortcutsSync` → store → registry rebuild. **Live two-window
  GUI E2E confirmed** the platform half the integration test mocks: writing a rebind to
  `localStorage` in one document window (`doc-1`) fired a `storage` event in the other
  (`doc-0`) carrying the rebind payload, and both windows saw the shared value — Tauri v2
  webviews share localStorage and propagate cross-window events. Satisfied by construction
  (registry store-subscription + the existing sync bridge), integration- AND GUI-verified.
- **Phase 8** — manifest + `lint:keybinding-manifest` drift gate; rule 41 rewritten
  around the manifest (WI-8.2).
- **3 cross-model audit rounds (Codex)** — 5 active bugs found + fixed (split-view
  scope, disposer identity, keyboard link editing, plus the E2E-caught executeCommand
  gate + closeTab binding); round-3 atomic command registration applied.

**Follow-ups closed since v6:** Phase 7 GUI E2E (done, above); the drift-gate parser is
now a fail-closed comment-aware lexer (audit round-3 #5) — which surfaced that the old
regex silently parsed only 98 of 123 defs (comment apostrophe swallowed ~25), a real
fail-open now fixed.

**The one remaining item is a settled DESIGN choice, not a bug:** the "deeper WI-6.1"
(capture `event.code` so custom rebinds store the physical position on non-QWERTY layouts)
would relitigate the physical-vs-logical key-identity decision this plan deliberately
settled on *physical* (`canonicalizeEvent` matches `event.code`). Codex round-1 #1 notes
non-QWERTY users get physical-position mapping for logical-authored defaults — that is the
chosen behavior, consistent with positional shortcuts, not a defect. The actual *bug* in
that area (a shifted-symbol capture silently producing a dead binding, Codex round-2) is
already fixed: KeyCapture validates against the runtime canonicalizer and refuses to assign
an unmappable chord (WI-6.1). No further change is warranted without an explicit product
decision to switch to logical matching.

## Gap audit v7 (2026-07-24) — plan-vs-implementation, findings + resolutions

A rigorous plan-vs-code audit checked whether each WI/DoD was actually delivered. Seven
findings; the machine-checkable ones are now closed or tracked.

| # | Finding | Verdict | Resolution |
|---|---|---|---|
| 1 | **Mechanic gate does not EXTRACT keymap ids** — `editorMechanics.ts` validates a hand-maintained allowlist against command/shortcut ids (namespaced ids are disjoint by construction, so the collision check is near-vacuous); it never scans the real keymaps, so a new unclassified chord (e.g. `multiCursor/keymap.ts` hardcodes `Mod-d`/`Mod-Shift-l`/…) is invisible. | CONFIRMED (High) | Partly closed by the reverse-closure gate (below); full keymap-chord extraction recommended as follow-up. |
| 2 | **Phase 8 does not GENERATE** — `check-keybinding-manifest.mjs` is drift-CHECK only (no Rust/TS/website emission); the website table is uncovered even by the check; the Rust side is checked against `localized.test.rs` (a test mirror), not `localized.rs`. | CONFIRMED (High vs plan, Medium practical) | **Recommended, not done:** a drift *check* delivers most of the safety value; full manifest→codegen + checking the real `localized.rs` + website table is a follow-up. |
| 3 | **`executeCommand` invariant contradicted** — editor keymaps call `runEditorAction` directly (~40 sites), the opposite of the plan/ADR-018 "one invariant". | CONFIRMED deviation (deliberate, justified) | **FIXED (docs):** plan + ADR-018 invariant amended to the two-executor reality (window/global → `executeCommand`; editor → `runEditorAction`), with the palette-gate rationale. |
| 4 | **No `consumer`/`captureOwner` on `shortcutDefinitions` entries** — WI-1.3 built a forward integrity gate only; entries carry no self-classification. | CONFIRMED (Medium) | Reverse-closure gate (below) enforces "every entry has a consumer" without adding fields; a discriminator field is an optional follow-up. |
| 5 | **Dead rebind rows (real UX bug)** — `addCursorAbove`, `addCursorBelow`, `skipOccurrence`, `softUndoCursor` (and the occurrence selectors) appear rebindable in Settings but `multiCursor/keymap.ts` hardcodes their chords, so rebinding does nothing; no `~105` cleanup occurred (123 defs remain). | CONFIRMED (Medium) | **Tracked + regression-proofed** by the reverse-closure gate (documents the dead set, fails on any NEW dead entry). Actually wiring them through `getShortcut` vs removing them is a product decision (recommended: wire, since Settings advertises them). |
| 6 | **No committed native/DOM double-execution E2E** — only `nativeOwnership.test.ts` (unit resolver) + a one-time manual Tauri-MCP check. | CONFIRMED → **RESOLVED (manual E2E)** | **DONE via AppleScript** (the webview harness can't dispatch one physical key to AppKit + webview; `osascript` can). `Cmd+O` (native `quick-open` accelerator + DOM `quickOpen` toggle) fired ONCE — quick-open opened, not double-toggled shut — proving AppKit routes the accelerator to the native menu and does not also propagate to the webview. Procedure documented in `dev-docs/e2e-testing.md`. Not CI-automatable (needs GUI/Accessibility). |
| 7 | **AltGraph unhandled** — `canonicalizeEvent` read only meta/ctrl/alt/shift, so an AltGr char-compose (reported as ctrl+alt) would spuriously fire a `Ctrl-Alt-X` binding. | CONFIRMED (Low-Med) | **FIXED:** `canonicalizeEvent` now returns null when `getModifierState("AltGraph")` is set; corpus test added (AltGr→null; real Ctrl+Alt still resolves). |

**Root cause of 1/4/5:** the registry had a forward gate (`KEYBINDINGS → commands/shortcuts`)
but no reverse check (`shortcutDefinitions → some consumer`) — added as
`shortcutConsumerClosure.test.ts`.

## Out of scope

- MCP-bridge routing (next unit); `Contribution.commands` (ADR-015).

## Review

Recon done; **two Codex passes folded (RETHINK → NEEDS AMENDMENT → v3).** Codex: the
architecture is settled and, with the type-model / scope-resolution / native-sequencing /
inventory corrections now applied, "should be READY TO BUILD." Recommend one confirming
Codex pass on v3, then write ADR-018 and run **WI-0.1 first** (the canonicalizer — unsound
there ⇒ pause). Highest residual risk: WI-0.1 logical-vs-physical identity, then Phase 4
editor-adapter IME timing.

# ADR-018: One Binding Registry, Many Capture Adapters

> Status: **Proposed** | Date: 2026-07-24
> Depends on: ADR-017 (the CommandBus is the single command authority)
> Plan: `dev-docs/plans/20260724-keybinding-unification.md`
> Unblocks: the "single command surface" ADR-017 deferred (keyboard + MCP)

## Context

A single key event can be handled independently by **five layers** with **no
central precedence arbiter** — precedence is emergent from where each listener
attaches and whether it calls `preventDefault`/`stopPropagation`:

1. the ProseMirror `editorKeymapExtension` + ~10 feature Tiptap extensions;
2. the CodeMirror keymaps (`sourceShortcuts` + the order-load-bearing
   `sourceEditorKeymap`);
3. ~10 un-namespaced `window` keydown hooks, none calling `stopPropagation`;
4. native menu accelerators (`menu/localized.rs`) → `menu:{id}`;
5. **two concurrent `menu:{id}` dispatchers** (`useUnifiedMenuCommands` for editor
   actions; `useCommandBootstrap`→`mountMenuCommands` for the rest), split
   unenforced.

Only two paths reach the CommandBus today; every other shortcut calls a store
action or editor command directly. `Mod-z`/`Mod-y` is defined in three places;
`Mod+W` is hardcoded; the "three-file sync" (rule 41) is manual.

## Decision

**The CommandBus is the single command-execution authority. A declarative binding
registry owns resolution + precedence. Capture stays layered — ProseMirror,
CodeMirror, the window, native menus, and WKWebView are *capture adapters* over
one registry.** Unify *resolution and precedence*, not physical listeners.

### The invariant

> Every user-visible command invocation enters through `executeCommand`; a
> command's definition may delegate internally to `runEditorAction`.

Calling `runEditorAction` (or a store action) directly from a keymap is a
violation — "same executor" is not sufficient (it bypasses bus availability,
instrumentation, ownership).

### The identity contract (WI-0.1, implemented)

A `CanonicalChord` is derived IDENTICALLY from a definition string and a runtime
`KeyboardEvent`, using **physical `event.code` key names + platform-resolved
modifiers** (`Mod` → `meta` on macOS, `ctrl` elsewhere). Physical position is
stable across layouts and CJK IMEs (which remap `event.key` but preserve
`event.code`) and sidesteps dead keys / `Process` / `Unidentified`. Shifted
symbols need no special case (shift is a modifier). Numpad keeps its own identity;
Caps Lock / Fn never enter a chord. On non-mac `Mod-n` and `Ctrl-n` collide (both
`ctrl+KeyN`) — a real, detectable clash. (`utils/keybinding/canonicalChord.ts`.)

### The binding model (WI-1.2, implemented)

```ts
type ChordSource = { shortcutId: string } | { fixedChord: CanonicalChord };
type Binding =
  | (Policies & ChordSource & { kind: "command"; commandId: string; consumption })
  | (Policies & ChordSource & { kind: "containment"; consumption /* not passthrough */ });
```

`kind: "command"` runs `commandId` through `executeCommand`. `kind: "containment"`
executes nothing — it only prevents a browser default (e.g. `useSelectAllScope`'s
`Mod-a`), so it is not a fake command and cannot be `passthrough`. Policies carry
`scope`, `when(ctx)`, `priority`, `captureOwner`, `repeat` (deny/allow/coalesce),
`reentrancy` (drop/queue/parallel), and `ime` (block/chord-exempt/editor-local) —
**per binding**, because these differ intentionally across the legacy hooks and
PM/CM editor-local composition state cannot be inferred by a window gate.

### The precedence contract (WI-1.1)

Resolution is **independent dimensions**, not one total ladder. For a chord in a
context, for the adapter that owns `owner`:

1. index the chord → its ordered candidate list;
2. keep candidates whose `captureOwner === owner`;
3. keep those whose `scope` is active in the context AND whose `when(ctx)` holds
   (a throwing `when` disables only its own binding);
4. choose highest **scope specificity**, then highest declared **priority**;
5. an exact tie (same specificity AND priority) is a **registry error**
   (`AmbiguousBindingError`), never "first registered wins".

**Scope specificity** (higher wins): `modal` (60) > `terminal` (50) >
`editor-wysiwyg`/`editor-source` (40) > `input` (30) > `panel` (20) > `window`
(10). Both editors are contenteditable, so **`input` must not out-rank an editor
or the terminal** — the ranks encode that. Native ownership and browser-default
containment are handled as capture-source / fallback, not as scopes.

### Conflicts & rebinding (D2)

Conflicts are scope/when/platform-aware, not a first-textual-hit. **Cross-scope
coexistence of one chord is allowed; an equal-scope + equal-priority overlap is a
registry error.** "Assign Anyway" (Settings) is permitted only across
non-overlapping scopes. Referential integrity: a binding whose `shortcutId` is
missing/unresolved is dropped from the index and reported, never indexed as a
bogus chord (`buildIndex`).

## Consequences

- The palette, menu, and keyboard run an action identically (the invariant).
- The two menu dispatchers collapse to one (Phase 2), with mount-time duplicate
  rejection.
- Editor keymaps keep in-context capture but route command execution through the
  bus (Phase 4), with a machine-checkable mechanic gate (a keymap entry is either
  a registered command or an allow-listed editor mechanic).
- `Mod-z`/`Mod-y` gets one source of truth; `Mod+W` becomes rebindable.
- A JSON manifest becomes the single source for the TS registry, Rust
  accelerators, and the website table (Phase 8), retiring the manual three-file
  sync.

## Status of the build

Phases 0–1 core landed: the canonicalizer (WI-0.1) and the registry + resolver +
referential integrity (WI-1.2/1.3), each fully tested. Remaining: menu-dispatcher
unification + native/DOM dedup (P2), the window/global capture adapters over the
registry (P3), the editor adapters + mechanic gate (P4), native/WKWebView + whole-
system exactly-once (P5), KeyCapture + the ~105-definition cleanup (P6), cross-
window propagation (P7), and manifest-driven generation (P8).

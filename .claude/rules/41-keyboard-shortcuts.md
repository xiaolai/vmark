# 41 - Keyboard Shortcuts

Rules for adding, changing, or deleting keyboard shortcuts.

## The keybinding drift gate (ADR-018, WI-1.5/Phase 8)

For every shortcut that has a **native menu accelerator**, the frontend default,
the Rust accelerator, and the docs table are now cross-checked automatically. The
synced subset is DERIVED by the gate from `shortcutDefinitions.ts` — every entry
carrying a `menuId`, minus the dynamically-bound ones — and
`scripts/check-keybinding-manifest.mjs`
(`pnpm lint:keybinding-manifest`, wired into `pnpm check:all`) fails if any of
these **three** surfaces drift apart:

1. `shortcutDefinitions.ts` — frontend defaults and the source of truth,
2. the Rust accelerator contract mirror (`src-tauri/src/menu/localized.test.rs`)
   and the **real** Rust menu builder (`src-tauri/src/menu/localized/*.rs`
   `accel(...)` call sites — so a mirror-vs-real drift is caught here, not only
   in the macOS-only Rust test), and
3. the website docs table (`website/guide/shortcuts.md`, matched order-insensitively).

So a frontend-vs-Rust, mirror-vs-real, or docs accelerator mismatch is caught at
gate time, not in review.

**When you add or change a menu-backed shortcut**, update `shortcutDefinitions.ts`,
the Rust menu builder AND `website/guide/shortcuts.md`, then run
`pnpm lint:keybinding-manifest`.

A hand-written `keybindingManifest.ts` used to restate each entry's keys as a
fourth surface. It had no runtime consumer and no independent semantics — the
gate compared it against the definitions it had been copied from, so it could
only ever catch a forgotten copy, never real drift. Deriving it deleted 167
lines of duplication and two tautological test suites while every cross-language
check survived unchanged. Do not reintroduce it — and that is enforced, not
merely asked: both the path and `KEYBINDING_MANIFEST` are registered in
`scripts/check-deleted-names.mjs`, so a file or symbol under either name fails
CI (settled with Codex, thread 019fdb16).

Allowed exceptions the gate encodes (with reasons): `undo`/`redo`/`quit` bind real
accelerators but are not customizable shortcuts (no `menuId` entry); headings 2–5
are documented as the compressed range "Mod + 1 through Mod + 6" rather than
individual rows. (`aiPrompts`/`search-genies` is excluded as dynamic: its accelerator
is registered dynamically at runtime by `useGenieShortcuts`, not in the static Rust
contract.)

## Files That Must Stay in Sync

When modifying shortcuts, update ALL of these files:

| File | Purpose | Format |
|------|---------|--------|
| `src-tauri/src/menu/localized.rs` | Menu accelerators — single `create_localized_menu` function | `Some("Alt+CmdOrCtrl+L")` |
| `src/stores/settingsStore/shortcuts.ts` | Frontend defaults | `defaultKey: "Alt-Mod-l"` |
| `website/guide/shortcuts.md` | Documentation (now covered by the gate) | `Alt + Mod + L` |

### Format Differences

| Context | Example | Notes |
|---------|---------|-------|
| Rust menu | `CmdOrCtrl+Shift+N` | Uses `+` separator, full modifier names |
| Frontend store | `Mod-Shift-n` | Uses `-` separator, `Mod` for Cmd/Ctrl |
| Documentation | `Mod + Shift + N` | Human-readable with spaces |

## Before Adding or Changing a Shortcut

### 1. Check for Conflicts

```bash
# Check localized.rs for existing accelerators
grep -i "Some(\".*YourKey" src-tauri/src/menu/localized.rs

# Check shortcutsStore.ts for existing defaults
grep -i "defaultKey.*your-key" src/stores/settingsStore/shortcuts.ts

# Find all uses of a key combination
grep -riE "Mod-Shift-n|CmdOrCtrl\+Shift\+N" src-tauri/ src/stores/
```

### 2. Check for Duplicates in Store

```bash
# List all shortcuts sorted by frequency (duplicates show count > 1)
grep -oE 'defaultKey: "[^"]*"' src/stores/settingsStore/shortcuts.ts | sort | uniq -c | sort -rn
```

## Update Procedure

### Step 1: Update localized.rs (ONE place)

The file has a single menu creation function that handles both default and custom shortcuts with i18n labels:

1. `create_localized_menu()` — in `src-tauri/src/menu/localized.rs`

Also update the corresponding label keys in `src-tauri/locales/en.yml` if the menu item text changes.

### Step 2: Update settingsStore/shortcuts.ts

Find the shortcut definition and update `defaultKey`:

```typescript
{ id: "lineNumbers", label: "Toggle Line Numbers", category: "view", defaultKey: "Alt-Mod-l", menuId: "line-numbers" },
```

### Step 3: Update Documentation

Update `website/guide/shortcuts.md` in the appropriate table.

### Step 4: Verify

```bash
# Check Rust compiles
cargo check --manifest-path src-tauri/Cargo.toml

# Verify no duplicates
grep -oE 'defaultKey: "[^"]*"' src/stores/settingsStore/shortcuts.ts | sort | uniq -c | sort -rn | head -5
```

## Common Pitfalls

### 1. Duplicate Shortcuts

If two menu items share the same accelerator, only one will work. The other is silently blocked.

**Example conflict we fixed:**
- `Cmd+Shift+N` was assigned to both "New Window" and "Toggle Line Numbers"
- Only "Toggle Line Numbers" responded; "New Window" appeared broken

### 2. Frontend Interception

Some shortcuts are handled by frontend hooks that call `e.preventDefault()`:

| Hook | Shortcuts Handled |
|------|-------------------|
| `useViewShortcuts.ts` | sourceMode, focusMode, typewriterMode, wordWrap, lineNumbers, toggleTerminal |
| `useTabShortcuts.ts` | newTab, closeTab (Mod+W), toggleStatusBar, nextTab/prevTab (Mod+Shift+]/[) |
| `useFileExplorerShortcuts.ts` | toggleHiddenFiles |

If you add a shortcut to the menu but the frontend intercepts it first, the menu event won't fire.

### 3. Forgetting to Update Locale Keys

`menu/localized.rs` uses rust-i18n translated labels. If you add or rename a menu item without updating `src-tauri/locales/en.yml` (and other locale files), the menu item will show a missing-key placeholder instead of its label.

## Standard Shortcut Conventions

| Pattern | Use For | Examples |
|---------|---------|----------|
| `Mod+Key` | Common actions | Save, Open, New, Close |
| `Mod+Shift+Key` | Variants of common actions | Save As, New Window |
| `Alt+Mod+Key` | View toggles, block formatting | Toggle Outline, Blockquote |
| `Alt+Mod+Shift+Key` | Less common actions | Format CJK File |
| `F1-F12` | Mode toggles | F7=StatusBar, F8=Focus, F9=Typewriter |

## Mnemonic Guidelines

Choose shortcuts that are memorable:

| Shortcut | Action | Mnemonic |
|----------|--------|----------|
| `Alt+Mod+L` | Toggle Line Numbers | **L**ines |
| `Alt+Mod+N` | Insert Note | **N**ote |
| `Alt+Mod+Q` | Blockquote | **Q**uote |
| `Alt+Mod+C` | Code Block | **C**ode |

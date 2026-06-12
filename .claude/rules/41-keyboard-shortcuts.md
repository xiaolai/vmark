# 41 - Keyboard Shortcuts

Rules for adding, changing, or deleting keyboard shortcuts.

## Files That Must Stay in Sync

When modifying shortcuts, update ALL of these files:

| File | Purpose | Format |
|------|---------|--------|
| `src-tauri/src/menu/localized.rs` | Menu accelerators — single `create_localized_menu` function | `Some("Alt+CmdOrCtrl+L")` |
| `src/stores/settingsStore/shortcuts.ts` | Frontend defaults | `defaultKey: "Alt-Mod-l"` |
| `website/guide/shortcuts.md` | Documentation | `Alt + Mod + L` |

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

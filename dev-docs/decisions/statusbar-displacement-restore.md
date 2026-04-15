# StatusBar Displacement & Restore

> Date: 2026-04-14

## Bug

**Repro:** StatusBar visible -> Ctrl+F -> Esc -> StatusBar gone.

Opening the FindBar (or UniversalToolbar) hides the StatusBar for mutual
exclusion, but closing the transient bar never restored it. The hide was
one-directional — the StatusBar stayed hidden until the user manually pressed
F7.

Same bug for UniversalToolbar: open toolbar -> Esc -> StatusBar gone.

## Root Cause

`useSearchCommands.ts` called `setStatusBarVisible(false)` when opening the
FindBar. `useUniversalToolbar.ts` did the same when opening the toolbar.
Neither had any restore logic on close.

```
Before (one-way):

  Cmd+F opens FindBar
    -> setStatusBarVisible(false)       // StatusBar hidden
  Esc closes FindBar
    -> searchStore.close()              // StatusBar stays hidden
```

## Solution: Save & Restore Pattern

Added `displaceStatusBar()` and `restoreStatusBar()` to `uiStore`. When a
transient bar opens, the current StatusBar state is saved. When it closes, the
saved state is restored.

```
After (round-trip):

  Cmd+F opens FindBar
    -> displaceStatusBar()              // saves true, hides StatusBar
  Esc closes FindBar
    -> searchStore.close()
    -> restoreStatusBar()               // restores to true
```

### Edge cases handled

| Scenario | Behavior |
|---|---|
| StatusBar was hidden by user (F7) before FindBar opened | Saved as `false`, restored to `false` — user preference honored |
| FindBar opens, then Toolbar opens (displaces twice) | First save wins — `_savedStatusBarVisible` not overwritten on second `displaceStatusBar()` |
| User presses F7 while displaced | `setStatusBarVisible()` clears saved state — explicit user action overrides saved displacement |
| Toolbar close while FindBar still open | No restore (check `!searchStore.isOpen` first) |
| FindBar close while Toolbar still open | No restore (check `!universalToolbarVisible` first) |

### State model

```
uiStore._savedStatusBarVisible: boolean | null

  null   = no displacement in progress
  true   = StatusBar was visible before displacement
  false  = StatusBar was hidden before displacement (user had F7'd it)
```

### API

| Method | Effect |
|---|---|
| `displaceStatusBar()` | Save current `statusBarVisible` (if not already saved), set `statusBarVisible = false` |
| `restoreStatusBar()` | Set `statusBarVisible = _savedStatusBarVisible`, clear saved state. No-op if null. |
| `setStatusBarVisible(v)` | Set `statusBarVisible = v`, clear `_savedStatusBarVisible` (explicit user override) |

## Files Changed

| File | Change |
|---|---|
| `src/stores/uiStore.ts` | Added `_savedStatusBarVisible`, `displaceStatusBar()`, `restoreStatusBar()`. Modified `setStatusBarVisible()` to clear saved state. |
| `src/stores/__tests__/uiStore.test.ts` | New test file — 9 tests for displacement/restoration behavior |
| `src/hooks/useSearchCommands.ts` | `setStatusBarVisible(false)` -> `displaceStatusBar()` |
| `src/hooks/useUniversalToolbar.ts` | `setStatusBarVisible(false)` -> `displaceStatusBar()`. Added `restoreStatusBar()` on Esc close. |
| `src/hooks/contentSearchNavigation.ts` | `setStatusBarVisible(false)` -> `displaceStatusBar()` |
| `src/components/FindBar/FindBar.tsx` | Routed all close paths through `handleClose()` which calls `restoreStatusBar()`. |

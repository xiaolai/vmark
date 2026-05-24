# ADR-007: Shell as composition root

> Status: **Accepted** | Date: 2026-05-24 | Spike landed: 2026-05-24

## Context

`MainLayout` in `src/App.tsx:212-353` hardcodes window composition: title bar,
sidebar, editor area, status bar, overlays. The `MainLayout` body runs 24
hooks in series and renders 9 fixed regions. Adding a new top-level surface
(Assistant pane, command palette overlay, side rail) requires editing this
142-line function. No type or seam exists between "the window" and "what
fills it."

The reskin will introduce at least two new surfaces (Assistant pane,
command palette). Without a shell contract, the reskin team edits
`MainLayout` directly, which guarantees merge-conflict pressure during the
refactor window and locks the app into a single composition forever.

## Considered Options

1. **Keep MainLayout** — add new surfaces inline as before.
2. **Per-feature wrappers** — break MainLayout into feature-specific
   components that MainLayout composes; lifecycle hooks stay where they are.
3. **AppShell as a pure layout primitive** — slot-based composition; Shell
   knows nothing about features.

## Decision

Chosen: **Option 3 — `AppShell` as a pure layout primitive** with slot props.

```tsx
<AppShell
  chrome={<TitleBar />}
  sidebar={sidebarVisible ? <Sidebar /> : null}
  primary={<EditorArea />}
  bottomBar={<BottomBar />}        // status / find / toolbar mux
  panels={<PanelHost />}           // slot host for terminal, assistant, etc.
  overlays={<OverlayHost />}       // GeniePicker, QuickOpen, palette
/>
```

The Shell owns: window chrome, slot positions, theme provider boundary,
error boundaries. The Shell does NOT own: features, stores, plugins,
lifecycle hooks. Lifecycle composites (per ADR-009-related work) mount
outside `AppShell` from the route.

## Verification gate

- `grep -rn "from.*['\"]@/stores" src/shell/` returns empty.
- `grep -rn "useEditor\|useDocument\|useWorkspace" src/shell/` returns empty.
- `wc -l src/shell/AppShell.tsx` < 200.
- `App.tsx` body: only routes, providers, and shell mounts. No feature hooks.

## Consequences

- **Good**: reskin re-themes by wrapping or composing a different Shell; never
  edits internals. New surfaces become slot registrations, not layout edits.
  `App.tsx` shrinks from 398 → ~80 LOC. Window composition becomes
  type-checked.
- **Bad**: introduces a new layer; existing slot-less features need
  migration. Slot positioning becomes a contract that must accommodate
  alternate layouts (terminal-right vs terminal-bottom; future split-pane).

## Negative space

`AppShell` is NOT a component library. It does NOT provide theme tokens
(ADR-014) or commands (ADR-012). It does NOT mediate state. It is the
wiring of a window, nothing more.

## Dependencies

- Enables panel/overlay slot registration consumed by ADR-011 plugin manifests.
- Pairs with ADR-014 (theme provider boundary lives at Shell root).

## Spike outcome (2026-05-24)

Implemented on branch `refactor/appshell-spike`:

- `src/shell/AppShell.tsx` — 76 LOC, pure layout primitive.
- `src/shell/EditorArea.tsx` — pure layout helper that owns the dynamic
  panel-position (right vs bottom) logic for the terminal panel.
- `src/shell/app-shell.css` — three layout rules, leans on existing
  `html, body, #root { height: 100% }` global.
- `src/App.tsx` — `MainLayout` body migrated to compose AppShell.

**Verification gates — all pass:**

- `grep -rn "from.*['\"]@/stores" src/shell/` → zero matches.
- `grep -rn "useEditor\|useDocument\|useWorkspace" src/shell/` → zero
  matches.
- `wc -l src/shell/AppShell.tsx` → 76 (target < 200).
- 15 new tests (`AppShell.test.tsx` 9 + `EditorArea.test.tsx` 6) green.
- Full suite 18,827 tests pass.
- `pnpm tsc --noEmit` clean; `pnpm lint` clean (0 errors, 2 pre-existing
  warnings); `pnpm lint:design-tokens` clean; `pnpm lint:deps` 0 errors
  (6 pre-existing warnings, none introduced).

**Findings against the ADR's predictions:**

- **App.tsx body reduction was modest.** Predicted ~80 LOC; actual 356
  LOC (down from 398, −42 LOC). The remaining bulk is the 24 lifecycle
  hook calls and the runner / DocumentWindowHooks / MainWindowHooks
  composites — those are ADR-009-adjacent work (existing plan task T03),
  deliberately out of this spike's scope. Once lifecycle composites land,
  App.tsx will hit the ~80 LOC projection.
- **Dynamic terminal positioning cleanly accommodated.** The "panels = a
  Shell slot or a primary-area concern?" question resolved cleanly:
  panel positioning lives in `EditorArea`, not in `AppShell`. The Shell
  stays free of layout dynamics. This was the highest-risk question and
  it answered well.
- **`--sidebar-offset` CSS variable was dead.** Set in the original
  `MainLayout` style prop, consumed nowhere. Dropped during the
  refactor — pure cleanup, no behavior change.
- **Chrome reservation mechanism.** TitleBar uses `position: absolute,
  top: 0`. AppShell reserves 40px via `paddingTop` on the primary
  region. No layout breakage.

**Open issues / follow-ups:**

- Manual smoke test of focus mode, typewriter mode, find bar open, and
  terminal repositioning under window resize is still recommended before
  release; jsdom-driven unit tests don't exercise the full layout flow.
- The `100vh` → `100%` switch in the shell CSS depends on the global
  `html, body, #root { height: 100% }` rule staying in place. Documented
  in the CSS file header.

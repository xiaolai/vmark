# ADR-007: Shell as composition root

> Status: **Proposed** | Date: 2026-05-24

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

# 00 - Engineering Principles (Local)

Follow the shared rules in `AGENTS.md`.
This file exists to mirror local-only references from dev docs.

Key points:
- Read before editing; keep diffs focused.
- No Zustand store destructuring in components.
- Prefer `useXStore.getState()` inside callbacks.
- Keep features local; avoid cross-feature imports unless shared.
- **Plugins must not import `@/stores/`.** A plugin that reaches into the app's
  Zustand singletons cannot ship as a standalone extension — this is the binding
  constraint on ADR-015's goal. Enforced by
  `scripts/check-plugin-store-coupling.mjs` (`pnpm lint:store-coupling`, in
  `check:all`) against a per-plugin baseline that ratchets DOWN only. Read state
  at the call site or pass it in as a parameter; never raise a baseline number.
  Improving a plugin also fails the gate until the win is written into
  `scripts/plugin-store-coupling-baseline.json`.
- Keep code files under ~300 lines. Enforced by `scripts/check-file-size.mjs`
  (`pnpm lint:file-size`, in `check:all`): it fails on any NEW file over the
  limit or growth of a baselined file. `scripts/file-size-baseline.json` freezes
  the 153 pre-existing violators — the gate ratchets down only, so split a file
  and lower/remove its baseline number; never raise one.

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

  **Two ways to decouple one, in order of preference:**

  1. **An extension option** — the plugin declares what it needs as a GETTER
     (`getConfig`, `isEnabled`, `getTabSize`), with a default that works when
     nothing configures it, and the host `configure`s it from
     `src/services/assembly/`. A getter, not a value: config re-read per
     keystroke means a settings change takes effect without rebuilding the
     editor. Prefer this — an explicit parameter beats an ambient lookup.
  2. **`plugins/shared/hostSettings.ts`** — only when an option cannot reach:
     a value read by a leaf utility several calls below the plugin boundary,
     where threading a parameter through every signature obscures more than it
     reveals. The app binds it once in `main.tsx`.

  Three rules learned the hard way:

  - **A type-only import still counts, and the gate is right.** A plugin that
    depends on the app's *type* module cannot be lifted out either. Declare
    the plugin's own vocabulary (`plugins/shared/pasteSettings.ts`) and let the
    host map onto it. Writing that union by hand caught a real mistake once —
    a guessed `"auto" | "always" | "never"` against the actual `"auto" | "off"`.
  - **A seam default must MATCH the app's default**, not merely be sane. When
    `hostSettings.tabSize` defaulted to 4 (CommonMark's unit) against VMark's
    2, Source indented list items where WYSIWYG did not — in a configuration
    that ships nowhere. Pinned by a test now.
  - **Do not write `@/stores` in a comment.** The detector greps for the
    literal, so prose about the coupling counts as coupling. Cost two
    debugging rounds.
- Keep code files under ~300 lines. Enforced by `scripts/check-file-size.mjs`
  (`pnpm lint:file-size`, in `check:all`): it fails on any NEW file over the
  limit or growth of a baselined file. `scripts/file-size-baseline.json` freezes
  the 153 pre-existing violators — the gate ratchets down only, so split a file
  and lower/remove its baseline number; never raise one.

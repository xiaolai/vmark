# 00 - Engineering Principles (Local)

Follow the shared rules in `AGENTS.md`.
This file exists to mirror local-only references from dev docs.

Key points:
- Read before editing; keep diffs focused.
- No Zustand store destructuring in components.
- Prefer `useXStore.getState()` inside callbacks.
- Keep features local; avoid cross-feature imports unless shared.
- **Plugins must not import `@/stores/`, `@/services/`, `@/hooks/` or
  `@/components/`.** A plugin that reaches into the app's Zustand singletons
  cannot ship as a standalone extension — this is the binding constraint on
  ADR-015's goal. The other three channels are the same constraint one hop out:
  the app's services are themselves store-coupled (`resolveMediaSrc` →
  documentStore + tabStore; `unifiedHistory` → five stores), so an
  `@/services` import is transitive store coupling that a stores-only count
  reads as zero. Enforced by `scripts/check-plugin-store-coupling.mjs`
  (`pnpm lint:store-coupling`, in `check:all`) against a per-plugin,
  **per-channel** baseline that ratchets DOWN only. Read state at the call site
  or pass it in as a parameter; never raise a baseline number. Improving a
  plugin also fails the gate until the win is written into
  `scripts/plugin-store-coupling-baseline.json`.

  **Two ways to decouple one, in order of preference:**

  1. **An extension option** — the plugin declares what it needs as a GETTER
     (`getConfig`, `isEnabled`, `getTabSize`), with a default that works when
     nothing configures it, and the host `configure`s it from
     `src/services/assembly/`. A getter, not a value: config re-read per
     keystroke means a settings change takes effect without rebuilding the
     editor. Prefer this — an explicit parameter beats an ambient lookup.
  2. **A seam under `plugins/shared/`** — when an option cannot reach: a value
     read by a leaf utility several calls below the plugin boundary, or a node
     view ProseMirror constructs rather than the host. Interface + working
     defaults + `bindX()` called once in `main.tsx`. Three exist:
     `hostSettings` (values), `hostDocument` (current window label + the
     active document's path, content and dirty state),
     `hostPopups` (chrome the plugin asks the host to show).
  3. **A PORT, for a plugin that drives its own popup state.** The plugin
     declares the state shape it needs (`StoreApi<MathPopupState>`, where
     `MathPopupState` lives plugin-side) and receives a store satisfying it.
     `WysiwygPopupView` is already generic over `StoreApi<TState>`, so usually
     only the `super(view, useXStore)` line and the extension option change.

     **Do not pass the app's store TYPE.** `UseBoundStore<StoreApi<AppSlice>>`
     from `@/stores` satisfies the grep and not the architecture — the port
     type must be plugin-side. The boundary is not "no shape dependency": a
     math popup intrinsically needs a latex string and a way to set it, and
     hiding that would be fake decoupling. It is "the plugin declares the shape
     it needs, and the host adapts to it". (Decided with Codex, thread
     `019fbf7b`, after rejecting both moving the stores into `plugins/shared/`
     — which inverts the dependency so the app imports plugin-land — and
     declaring the class as a baseline exception.)

     A port has **no default**, unlike a setting: there is no sensible stand-in
     for "the state this popup drives". Throw a named error at wiring time.

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
  - **Prose is safe: the detector parses imports, it does not grep.** All four
    channels resolve real module specifiers through a TS AST, so the literal
    `@/stores` in a comment or a string is prose, not coupling — write the
    explanation. This replaced the grep, which counted prose as coupling and
    cost two debugging rounds; the migration was safe precisely because the
    stores baseline was already zero, so zero stayed zero under either counting
    rule and the parser could not mask a regression. Relative specifiers that
    climb into `src/stores/` &co. (`../../stores/tabStore`) count exactly like
    their `@/` spelling — the disguise buys nothing.
- Keep code files under ~300 lines. Enforced by `scripts/check-file-size.mjs`
  (`pnpm lint:file-size`, in `check:all`): it fails on any NEW file over the
  limit or growth of a baselined file. `scripts/file-size-baseline.json` freezes
  the pre-existing violators it lists — the gate ratchets down only, so split a file
  and lower/remove its baseline number; never raise one.

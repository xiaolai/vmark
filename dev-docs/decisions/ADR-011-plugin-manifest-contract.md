# ADR-011: Plugin manifest contract

> Status: **Accepted (manifest exports complete)** | Date: 2026-05-24

## Context

81 plugin directories under `src/plugins/` with no declared contract.
Plugins import each other freely (`plugins/toolbarActions/` consumes
popup stores; `plugins/codemirror/` imports from `editorStore`). Plugins
mount via ad-hoc registration in
`src/plugins/editorPlugins.tiptap.ts` — a 200+ line composition root
maintained by hand. Plugin state lives in arbitrary global stores under
`src/stores/` (12 popup-state stores belong inside their owning plugins,
not at the top level). There is no way to ask "what does this plugin
need" or "what does it provide."

The existing T10 introduces a registry, but does not enforce a contract
that downstream tooling (palette, slot host, dependency tracker) can
consume.

## Considered Options

1. **Status quo with conventions in `AGENTS.md`** — document the pattern,
   keep `editorPlugins.tiptap.ts` as the composition file.
2. **Registry without contract** — existing T10; lists plugins, composes
   them, but plugins still vary internally.
3. **`PluginManifest` as the export contract** — every plugin declares
   modes, slots, commands, state, and dependencies; cross-plugin imports
   forbidden.

## Decision

Chosen: **Option 3 — every plugin exports a `PluginManifest`**.
Registry composes manifests per mode and format. Cross-plugin imports
are forbidden except via `src/plugins/shared/`.

```ts
type PluginManifest = {
  id: PluginId;
  formats: FormatId[];                      // ['markdown']
  modes: ('source' | 'wysiwyg')[];
  slots?: SlotDescriptor[];                 // panels/overlays it mounts
  commands?: CommandDescriptor[];           // from ADR-012
  state?: () => Slice;                      // plugin-local Zustand slice
  dependsOn?: PluginId[];
  mount: (ctx: PluginContext) => Cleanup;
};
```

`editorPlugins.tiptap.ts` is replaced by
`pluginRegistry.composeFor({ mode: 'wysiwyg', format: 'markdown' })`.

## Verification gate

- `grep -rn "from.*['\"]@/plugins/" src/plugins/ | grep -v "/shared/\|/registry"`
  returns zero.
- Every directory under `src/plugins/` (excluding utility dirs
  `shared/`, `actions/`, `editorPlugins/`, `codemirror/`, `toolbarActions/`)
  exports a `manifest`.
- 12 plugin-internal popup stores have moved from `src/stores/` into their
  owning plugin folders (`src/plugins/linkPopup/state.ts`, etc.).
- Dev-only `/debug/plugins` route renders the active manifest set.

## Consequences

- **Good**: plugin dependencies become explicit and tooling-readable. The
  reskin asks "what mounts in this slot?" — the registry answers. Adding
  a feature stops requiring edits to a central composition file. Plugin-
  internal popup stores co-locate naturally. ADR-010 popup unification
  (T11) operates on manifests, not directories.
- **Bad**: ~80 plugins need manifest migration. Estimated 2–3 days of
  mostly mechanical work plus careful cases (codemirror cluster, format-
  specific plugins). Existing cross-plugin imports become rule violations
  that must be unwound atomically with the migration.

## Negative space

Manifest does NOT regulate internal file structure — that is the plugin's
business. Does NOT define UI primitives — those come from Shell (ADR-007)
and Theme (ADR-014). Does NOT replace `formats/` registry — plugins
declare which formats they target; the format registry remains separate.

## Dependencies

- Slot descriptors consumed by ADR-007 (`PanelHost`, `OverlayHost`).
- Command descriptors registered into ADR-012 (command bus).
- Plugin-local state slices follow the pattern enabled by ADR-013
  (service tier) for non-React logic.
- Supersedes existing T10; constrains T11.

## Foundation landed (2026-05-24)

`src/plugins/registry.ts` ships:

- `PluginManifest` type — `id`, `formats`, `modes`, optional `slots`,
  `commands`, `dependsOn`, lazy `tiptap()` / `codemirror()` factories.
- `registerPlugin`, `getPlugin`, `listPlugins`, `pluginsFor(mode, format)`
  — registry operations.
- `_resetRegistry` for tests.

`src/plugins/linkPopup/manifest.ts` declares the first manifest as the
demonstrator pattern. `linkPopup` is `modes: ["wysiwyg", "source"]`,
`formats: ["markdown"]`, with a single overlay slot.

5 tests in `registry.test.ts` cover registration, duplicate detection,
mode/format filtering.

**What is NOT yet wired**:

- The remaining ~80 plugins do not yet export manifests. Each is a
  one-line file (mechanical migration).
- `editorPlugins.tiptap.ts` continues to compose plugins by hand.
  Switching it to `pluginsFor("wysiwyg", "markdown").map(p => p.tiptap?.())`
  is the migration target, but waits on every plugin having a manifest.
- Cross-plugin import rule (`grep -rn "from.*['\"]@/plugins/"
  src/plugins/`) not yet enforced — that's structural enforcement
  that needs every plugin migrated first.

**Verification**:

- `pnpm vitest run src/plugins/registry.test.ts` — 5/5 pass.
- `pnpm tsc --noEmit` clean.

Per-plugin manifest exports and the registry-based composition switch
are tracked as mechanical follow-up.

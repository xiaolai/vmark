---
paths:
  - "src/plugins/**"
  - "src/services/assembly/**"
  - "scripts/check-plugin-store-coupling.mjs"
  - "scripts/plugin-store-coupling-baseline.json"
---

# 00 - Plugin Boundary

General principles are in `AGENTS.md`. This rule covers plugins.

**Plugins must not import `@/stores/`, `@/services/`, `@/hooks/` or
`@/components/`** — including type-only imports and relative paths that climb
into those directories. `pnpm lint:store-coupling`
(`scripts/check-plugin-store-coupling.mjs`) parses imports (prose in comments is
safe) against a per-plugin, per-channel baseline that ratchets DOWN only: never
raise a number, and record an improvement in
`scripts/plugin-store-coupling-baseline.json`.

Ways to decouple, in order of preference:

1. **Extension option** — the plugin declares a GETTER (`getConfig`,
   `isEnabled`, `getTabSize`) with a working default; the host configures it
   from `src/services/assembly/`.
2. **Seam under `plugins/shared/`** — for values read deep below the plugin
   boundary or in node views the host does not construct: interface + defaults
   + `bindX()`, called once from `bindPluginHostSettings()` in
   `src/services/assembly/bindHostSettings.ts` (run by `src/bootstrap.tsx`).
   Existing: `hostSettings`, `hostDocument`, `hostPopups`, `hostShortcuts`,
   `hostSearch`, `hostViewModes`, `hostEditors`, `hostLinks`, `hostNotify`.
   A seam default must MATCH the app's default.
3. **Port** for plugin-driven popup state: the plugin declares its own state
   type (`StoreApi<MathPopupState>`) and receives a store satisfying it. Never
   pass the app's store type. A port has no default — throw a named error at
   wiring time.

Declare the plugin's own vocabulary for shared types
(`plugins/shared/pasteSettings.ts`) and let the host map onto it.

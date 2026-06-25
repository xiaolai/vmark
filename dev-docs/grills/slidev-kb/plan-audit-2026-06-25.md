# Plan Audit — content-server / Slidev feature

> Date: 2026-06-25
> Plan: `dev-docs/plans/20260624-1500-slidev-kb-content-server.md`
> Branch: `feature/content-server-slidev-kb` (uncommitted working tree)
> Method: inspection pass (no tests run) — implementation mapped against
> per-phase DoD, WIs, and ADRs.

The shipped code is real and tested, but measured against the plan's per-phase
Definition of Done and ADRs, several promised capabilities are missing,
dev-only, or unwired. The *engine* (server, render, index, graph, auth, Slidev
preview/export, signature verify) is implemented and live-verified; the feature
is **not shippable as planned**, chiefly because there is no production entry
point (C-1) and the runtime is never provisioned outside dev (H-1).

---

## Findings (ordered by severity)

### CRITICAL

**C-1 — The KB panel has no production entry point (WI-5.1).**
`togglePanel` / `setPanelOpen` (`src/stores/contentServerStore.ts`) have **zero
production callers** — only the DEV `window.__contentServerStore` global and
tests. There is no menu item, no shortcut, no button. A shipped user cannot open
the Knowledge Base panel at all. WI-5.1 requires "AppShell slot + panel shell
(toggle, **menu item, shortcut** — sync the three shortcut files per rule 41)."
The slot mounts (`src/App.tsx`) but nothing toggles `panelOpen` in production.
- *Evidence:* `grep togglePanel|setPanelOpen src` (excl. tests/store) → none;
  `src-tauri/src/menu/`, `src/stores/settingsStore/shortcuts.ts` → no entries.
- *Fix:* menu item (`menu/localized.rs`) + shortcut (3-file sync, rule 41) +
  a `menu:` event handler calling `togglePanel`.

### HIGH

**H-1 — Runtime provisioning / downloader unbuilt; "bundled runtime" is dev-only
(WI-1.1, ADR-2).**
The provisioning state machine (`content_server/provision.rs`), atomic swap
(`swap.rs`), and signature verify (`signature.rs`) exist and are tested, but
**nothing drives them** — no downloader, no per-bundle lock file, no resumable
download, no disk-space preflight. In dev the Node CLI is located via the
`VMARK_CONTENT_SERVER_CLI` env var + `node` on PATH (`commands.rs` `resolve_cli`/
`resolve_node`). ADR-2's signed-in-bundle Node + CI tarballs is not realized; a
packaged build would fail `resolve_cli` ("content-server runtime not
provisioned"). The WI-1.1 sub-items are unimplemented, not merely "infra."

**H-2 — No crash-restart / supervisor; child stdio not logged (WI-1.2, ADR-10).**
`ContentServerManager` registers/kills children and has `Drop` cleanup, but
WI-1.2's "crash-restart policy" and "child stdout/stderr → `tauri-plugin-log`"
are absent — the spawned Node's stdio is never piped to `log` (`commands.rs`
spawn uses default stdio). ADR-10's "supervisor owns two children" is realized
only inside the Node process (SlidevManager); Rust does not restart the KB
process if it dies.

**H-3 — Slidev preview has no editor→preview live sync (WI-6.3 / Phase 6 DoD).**
Preview reads the deck from disk (`/api/slidev/preview`). WI-6.3 requires "live
sync to the editor buffer (loadData callback / save)" and the DoD requires
"editing reflects." Unsaved editor edits do not appear; no save→reload wiring.

**H-4 — Slidev export not integrated into the export menu (WI-7.2).**
Export works as a standalone command, but WI-7.2 requires integration into the
existing export menu/dialog. `grep src/export/` → no Slidev/content_server
references. Combined with C-1, there is no UI path to trigger export.

**H-5 — Mermaid/Markmap client bundles not shipped (WI-3.2).**
`render/renderMarkdown.ts` emits client-rendered placeholders, but the served
page ships only `kb.js`/`kb.css` (`server/assets.ts`) — no Mermaid/Markmap
browser bundle. Diagrams render as inert placeholders.

### MEDIUM

- **M-1 — `.gitignore` not honored in the walker (WI-2.1).** `index/walk.ts`
  honors `ALWAYS_SKIP_DIRS` + caller excludes only.
- **M-2 — No performance benches (WI-2.4, WI-8.4, Phase 2 DoD).** No
  `*.bench.*` for the content-server; "1k-note workspace" bench absent.
- **M-3 — No fidelity-vs-editor fixtures or light/dark snapshots (Phase 3
  DoD).** Render tests assert structure/XSS only.
- **M-4 — Served site has no graph view (WI-4.4).** The native in-app panel has
  the graph (`KbGraphView.tsx`); the browser-served site does not.
- **M-5 — Deck detection not integrated with the format-adapter registry
  (WI-6.1).** `slidev/detect.ts` is standalone; no `src/lib/formats/` coordination.
- **M-6 — No settings UI; no offline/missing-runtime prompt (WI-1.4 / Phase 1
  DoD).** Store models the states; no settings panel and no offline-first-run
  prompt (provisioning unwired).
- **M-7 — Export not cancellable (WI-7.3).** Timeout added (`slidev/export.ts`);
  AbortSignal/cancellation-token not implemented.
- **M-8 — Rust i18n + translate-docs not done (WI-8.1).** `src-tauri/locales/
  en.yml` has no content-server keys; Rust errors are raw `format!` strings.
  React i18n is English-only (no 9-locale `translate-docs` pass).
- **M-9 — Website docs incomplete (WI-8.2).** `website/guide/knowledge-base.md`
  exists; `formats.md`/`settings.md` not updated; no sidebar entry.

### LOW

- **L-1 — `scripts/check-slidev-kb-phase.sh` not created (rule 3 / phase DoD).**
  Every phase DoD references it; absent.
- **L-2 — No WI-linkage, nothing committed (rule 2).** Test files carry
  `// grill …` comments, not `// WI-N.M —` headers; branch has no commits, so
  WI→artifact linkage is unverifiable.
- **L-3 — Capabilities entries not added (WI-1.4).** Functionally moot (raw
  `std::process::Command` + `std::fs`, not the shell/fs plugins) — documented
  divergence.
- **L-4 — Spike write-ups consolidated (Phase 0 DoD).** DoD wants 6 write-ups;
  S0.2/S0.3/S0.5 are merged. S0.5's substantive criteria (CI tarball build,
  native-addon ban, macOS quarantine, "KB offline without Slidev") are recorded
  as unproven/external — Phase 0's gate is not strictly met.

---

## Plan Gaps Summary

| WI | Status | Missing |
|----|--------|---------|
| WI-1.1 | Partial | downloader, lock file, resumable download, disk preflight |
| WI-1.2 | Partial | crash-restart, child stdio → log |
| WI-1.4 | Partial | settings UI, offline prompt, capabilities |
| WI-2.1 | Partial | `.gitignore` honoring |
| WI-3.2 | Partial | Mermaid/Markmap client bundles |
| WI-4.4 | Partial | served-site graph view |
| WI-5.1 | **Missing** | menu item + shortcut + production toggle |
| WI-6.1 | Partial | format-adapter integration |
| WI-6.3 | **Missing** | editor→preview live sync |
| WI-7.2 | Partial | export-menu integration |
| WI-7.3 | Partial | cancellation |
| WI-8.1 | Partial | Rust i18n + translate-docs |
| WI-8.2 | Partial | formats.md / settings.md + sidebar |
| WI-8.4 | Partial | perf benches |

**Fully met:** WI-1.3, WI-1.5.2, WI-1.5.3, WI-2.2, WI-2.3, WI-2.4, WI-2.5,
WI-3.1, WI-3.4, WI-4.1, WI-4.2, WI-4.3, WI-5.2, WI-5.3, WI-6.2, WI-7.1 (dev), and
all S0.x as software probes.

---

## Test Coverage Gaps

- No SSE-client reload test (Phase 4 DoD "SSE reload proven") — only the
  watcher→index refresh is tested, not an `EventSource` receiving `reload`.
- No perf benches (Phase 2 / 8 DoD).
- No editor↔preview / live-sync test (feature absent).
- No fidelity-vs-editor or light/dark snapshot tests (Phase 3 DoD).
- WI-2.1 rules (`.gitignore`, case-insensitive-FS, permission-error-skip) not
  each directly fixtured ("one fixture per rule").

---

## Notes / Risks

- The biggest functional gap is **C-1**: the feature is fully built and
  live-verified, but has **no user-facing way to open it** — every live
  verification used the DEV store global.
- The provisioning/bundling layer (ADR-2) being unwired means the feature only
  runs under `pnpm tauri dev` (env-var CLI path); a packaged build cannot start
  the server.
- Governance (rules 2/3) is unmet: no commits, no WI headers, no
  `check-slidev-kb-phase.sh` — the plan's "phase advances only when the check
  script exits 0" gate was never enforceable.

---

## Evidence

- C-1: `grep togglePanel|setPanelOpen src` (excl. tests/store) → no production
  callers; `src-tauri/src/menu/` + `shortcuts.ts` → no content-server entries.
- H-1: `content_server/commands.rs` `resolve_cli` (env-var/provisioned path);
  `provision.rs`/`swap.rs`/`signature.rs` tested but no caller.
- H-2: `commands.rs` spawn (default stdio); no restart logic in `mod.rs`.
- H-4 / H-5: `grep src/export/` → none; `server/assets.ts` → only kb.css/kb.js.
- M-8 / L-1 / L-3: `src-tauri/locales/en.yml`, `capabilities/default.json`,
  `scripts/check-slidev-kb-phase.sh` → none.

---

## Recommended close-out order

1. **C-1** — add the menu item + shortcut + toggle handler (makes the feature
   reachable; ~half a day).
2. **H-1** — the provisioning downloader + `resolve_cli` real path (or, for a
   first ship, bundle the Node CLI as a Tauri resource and point `resolve_cli`
   at it) so packaged builds work.
3. **H-2** — pipe child stdio to `tauri-plugin-log` + a restart-on-exit policy.
4. **H-3 / H-4 / H-5** — editor→preview sync, export-menu integration, diagram
   client bundles.
5. MEDIUM/LOW + governance (commit with WI headers, add
   `check-slidev-kb-phase.sh`, run `translate-docs`, finish docs).

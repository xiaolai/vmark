# Audit: Dead-Code Re-Sweep + Snapshot Deep-Dive

**Date:** 2026-05-31
**Status:** Active
**Scope:** whole repo — `src/` (984 non-test TS/TSX), `src-tauri/src/` (82 Rust files), deps.
**Method:** `knip@latest` (no project config → defaults), `cargo check` (zero dead-code warnings), targeted `grep` calibration of every flagged category, and a focused read of `workflow/snapshots.rs` + its call sites.

> **This is a follow-up, not a fresh discovery.** It independently re-runs the same
> tooling as [`20260530-dead-code-and-optimization.md`](20260530-dead-code-and-optimization.md)
> (dated one day earlier) to (a) verify that audit's remediation held and
> (b) characterise the explicitly-deferred tail more precisely. The headline:
> **the high-value dead code is gone; what remains is low-severity export hygiene
> that the remediation plan deliberately deferred.**

---

## TL;DR

| Area | Verdict |
|---|---|
| **Rust** | Clean. Zero `dead_code` warnings. Every `#[allow(dead_code)]` is legitimate (re-verified). |
| **High-value dead code (per 2026-05-30 audit)** | **Remediated** — all sampled items verified *gone* (see delta table). |
| **Export-hygiene sweep** | **Complete** (§3b, 3 rounds) — removed 22 defaults/dead-decls/test-helpers + a stray `.d.ts`, 100 dead barrel re-export members, 5 more dead decls, and dropped `export` on 14 alive-in-file symbols. **Exports 164→22, duplicates 15→2.** Every removal verified dead-vs-alive first; 5+ items that `--fix` would have wrongly deleted were caught (kept/restored). **Net −522/+43 lines.** |
| **knip gate** | **Wired into `check:all`** (§3b) with an `error`/`warn` rule split (reliable categories fail CI; export/type hygiene reported non-blocking). |
| **Remaining 22 export warnings** | 21 are internal helpers in one **website demo** file; 1 is `ACTION_IDS` (type-derivation const, must stay exported for eslint). Both benign/warn-level — see §3b. |
| **No regressions** | main `tsc` + mcp-server `tsc` + eslint clean; **19,256** app tests + **185** mcp tests pass; `check:all` (coverage + production build + size) exit 0. |
| **Snapshot half-feature** | KEEP decision (2026-05-30, WI-1.5) is **sound and current**. Deep-dive confirms it and refines the cost: snapshotting is **conditional**, not per-run. |

No new logic-level dead code surfaced beyond what the prior audit already catalogued.

---

## 1. Remediation delta — what the 2026-05-30 fix actually cleaned

Verified by grep against the current tree (`main`):

| Prior-flagged item | Source | Now |
|---|---|---|
| `source-popup-shared.css` (whole 230-line file) | `src/styles/` | **GONE** ✓ |
| `mcp_server_start` / `mcp_server_stop` commands | `lib.rs` | **GONE** ✓ |
| `mcp_config_get_status`, `open_folder_dialog` | `lib.rs` | **GONE** ✓ |
| `@actions/expressions` unused dep | `package.json` | **GONE** ✓ |
| mcpBridge v1 `utils.ts` cluster (`getDocumentContent`, …) | `src/hooks/mcpBridge/` | **GONE** ✓ |

**Still present (deferred per remediation-plan Status header — T4/O8/D8 deferrals):**

| Item | Source | Status |
|---|---|---|
| `.math-block*` dead CSS (block-math never shipped) | `src/plugins/latex/latex.css` (~13 refs) | Deferred dead CSS |
| `useSourceEditorShowInvisiblesSync` | `src/hooks/useSourceEditorSync.ts` | Still exported, zero callers |
| ~14 redundant `export default` on barrel-named components | see §2 | "Safe micro-sweep" — deferred |

The remediation was correctly prioritised: it removed the items with real weight
(a whole CSS file, four registered-but-dead Tauri commands, a superseded
IPC-helper cluster, an unused dependency) and parked the cosmetic tail.

---

## 2. The deferred tail, precisely categorised

`knip` flags **142 unused exports** in `src/` (non-test). Categorising by *kind*
(this is the distinction that decides the fix):

| Category | Count | What it means | Fix |
|---|---|---|---|
| Redundant `default` exports | 14 | Component imported by **name** through its `index.ts` barrel; the `export default` is never reached (confirmed: `App.tsx` → `import { Editor }`). | Delete the `export default X;` line. Zero behaviour change. |
| Dead barrel re-exports | 91 | An `index.ts` re-exports a symbol that consumers reach by importing the **source module directly** (confirmed: `multiCursorExtension` consumed from `multiCursor/tiptap.ts`, not the barrel). | Trim the re-export, or delete the barrel if fully bypassed. |
| Named non-barrel exports | 37 | Mixed — see breakdown below. | Per-item. |

### The 37 named exports break down further

The reference count (non-test, including the symbol's own definition) separates
**dead** from merely **over-exported**:

- **Genuinely dead (count = 1 → only its own definition):** `composeCodeMirrorExtensions`
  (`plugins/registry.ts`), `copyHtmlToClipboard` (`export/htmlExport.ts`),
  `isGenieV1` (`types/aiGenies.ts`), `TableWithSourceLine` (`plugins/shared/sourceLineNodes.ts`).
  **Candidates for full deletion** (confirm no dynamic/string reference first).
- **Likely dead (count = 2 → definition + one re-export, no real consumer):**
  `composeTiptapExtensions`, `pairQuotes`, `createSourceWorkflowPreviewPlugin`,
  `getLocalActionMetadata`. Verify the second reference isn't a live call before deleting.
- **Over-exported but ALIVE (high count → used internally, `export` keyword is superfluous):**
  `maybeMarkLargeMarkdownAsSource` (15), `getDirectory` (12), `escapeHtml` (11),
  `getEditorContentCSS` (10), `navigateToHeadingById` (8), `themeTokensToColors` (7),
  `SUPPORTED_LOCALES` (5), `ImagePasteToastView` (5), `handleMultiCursorEnter` (4),
  `ACTION_IDS` (3). **Do NOT delete the function** — just drop the `export` keyword
  (or keep if it's a deliberate public-API surface).
- **Genuinely-dead shared test helpers (NOT false positives — corrected on closer
  inspection):** `createMockStore`, `getFocusableElements`, `waitForRAF`, `waitMs`
  in `src/test/popupTestUtils.ts`. The individual test files define their *own local*
  `createMockStore`/`getFocusableElements`; only `createMockRect` is imported from the
  shared util (and knip correctly does **not** flag that one). So these shared exports
  really are dead.
- **The only true dynamic-access false positives:** `__resetSessionFlags`
  (`saveToPath.ts`) and `__resetQuotaWarnedKeys` (`workspaceStorage.ts`), accessed via
  `("x" in mod)` property checks that static analysis can't trace. Both are now tagged
  `@public` so knip stops reporting them — verified.

### Dependencies

- `@xterm/addon-serialize` — flagged unused; only referenced as a `vi.mock` in
  `src/test/setup.ts`, never imported in production. Mock + dep are likely both
  removable. **Cross-check with the terminal audit** — that audit
  ([`20260531-terminal-integration.md`](20260531-terminal-integration.md)) lists
  "SerializeAddon loaded-but-unused (C3)" and is being remediated by the terminal
  plan's Phase 5 (session persistence), which *would* use it. **Resolve there, not here.**
- `@tauri-apps/cli`, `@hypothesi/tauri-mcp-server`, `@yao-pkg/pkg`, `esbuild`
  (devDeps) — flagged unused, but invoked indirectly (binaries / build steps shell out).
  Verify before removing; knip can't see shell invocations.

---

## 3. Snapshot half-feature — deep-dive (task c)

The 2026-05-30 audit flagged `restore_snapshot` / `list_snapshots`
(`workflow/snapshots.rs`, both `#[allow(dead_code)]`) as a "parked half-feature —
decision needed," and **WI-1.5 recorded an explicit KEEP** (finish, don't delete).
This deep-dive validates that decision and refines the cost picture.

### Wiring (verified)

| Function | State | Evidence |
|---|---|---|
| `create_snapshot` | **LIVE** | Called from `workflow/commands.rs:235` before execution. |
| `restore_snapshot` | **DEAD** | `#[allow(dead_code)]`; no caller, no Tauri command, no frontend. |
| `list_snapshots` | **DEAD** | Same. |

So the **write side runs but the read side is dead** — snapshots are created on disk
(up to `MAX_SNAPSHOTS = 50`, with `cleanup_old_snapshots`) yet can never be
restored or listed by a user. This is the read-side of roadmap **WI-5.4 "File
Snapshots for Undo"** (`dev-docs/plans/20260331-workflow-engine.md:1013`).

### Refinement the prior audit didn't state: the cost is *conditional*

`create_snapshot` is **not** invoked on every workflow run. `commands.rs:218-234`
collects `files_to_snapshot` only from steps where `uses == "action/save-file"`,
and the call is guarded by `if !files_to_snapshot.is_empty()`. A workflow with no
`save-file` step does **zero** snapshot I/O. So the dead read-side is carrying a
bounded, opt-in write cost — not a per-run tax. This materially weakens any
"it's wasting disk on every run" argument for deletion.

### Verdict

**The KEEP decision is sound and I do not recommend re-opening it.** Reasons:

1. The decision is **one day old** (2026-05-30) and tied to a documented roadmap
   item — there is nothing new to re-evaluate.
2. The write side is a deliberate, *correct*, already-shipped safety mechanism
   (atomic pre-modification backup). Deleting `restore_snapshot` would orphan it
   and throw away the harder half of the feature.
3. The cost is conditional (above), so "dead weight" framing doesn't hold.

**One genuine refinement for the backlog (Low):** the `#[allow(dead_code)]` on the
`Raw*` structs in `workflow/types.rs:18,49,69,133` is applied at **struct level**.
Those structs are heavily used (`RawWorkflow` deserialized at `commands.rs:159`;
`RawStep`/`RawDefaults`/`RawLimits` consumed across `runner.rs` and `step_config.rs`)
— the attribute exists only to silence *unread serde fields*. A struct-level
`#[allow]` is a blunt instrument: it will also silence a *future* genuinely-dead
field. If precision is wanted later, move the `#[allow(dead_code)]` to the specific
unread fields (`#[allow(dead_code)] field: T`) so the compiler keeps warning on the rest.

---

## 3a. `knip.json` — created (2026-05-31)

Recommendation #1 below is **done**. `knip.json` now declares three workspaces
(root app, `vmark-mcp-server`, `website`) with the entry points the plugins miss
(`src/bench`, non-package.json `scripts/*`, `.claude/hooks/*.mjs`, and the
markdown-imported `website/.vitepress/**/*.vue`) and scoped `ignoreDependencies`
for build/binary-invoked and CSS-/dynamically-imported packages
(`tailwindcss`, `@tauri-apps/cli`, `@hypothesi/tauri-mcp-server`, `esbuild`,
`@yao-pkg/pkg`, and Mermaid's optional-feature peers). `knip` is pinned as a
devDependency (`6.15.0`); run via `pnpm knip` (or `pnpm knip:files` for the
files+deps subset).

The `__tests__/` of `vmark-mcp-server` are analysed at `src/**` only — knip can't
resolve that package's `./x.js`→`x.ts` ESM-extension test imports without a
per-package resolver config (it produced one false positive, `McpTestClient.ts`,
which *is* used by its sibling `.test.ts`). Excluding the test dir keeps the gate
false-positive-free.

The two genuine dynamic-access false positives (`__resetSessionFlags`,
`__resetQuotaWarnedKeys`, accessed via `("x" in mod)`) are tagged `@public` so
knip stops reporting them.

## 3b. Sweep executed + gate wired (2026-05-31)

Recommendations #1 and #2 are **done**. The sweep was deliberately **surgical**:
`knip --fix` was evaluated and **rejected** — it leaves cruft (empty `export {}`
blocks, lone `;`) in this codebase's multi-line barrels *and* drops the `export`
keyword off fully-dead symbols, which violates `noUnusedLocals` and breaks `tsc`.
So removals were done by exact-match script with fail-loud assertions, then
verified by `tsc` + the full test suite.

**Round 1 — removed (clean, whole-declaration deletes):**
- 14 redundant `export default` lines (12 components + the `FindBar/index.ts`
  `as default` re-export + the `cjkLetterSpacing` plugin default).
- 5 genuinely-dead standalone declarations: `composeCodeMirrorExtensions`
  (`plugins/registry.ts`), `isGenieV1` (`types/aiGenies.ts`), `FULL_TO_HALF`
  (`mcpBridge/v2/cjkMaps.ts`), `OPERATION_MODES` + `MATCH_POLICIES`
  (`mcpBridge/types.ts`).
- The stray `vmark-mcp-server/__tests__/utils/McpTestClient.d.ts`.

**Round 2 — removed after per-symbol verification (each checked: dead vs alive-in-file):**
- Deleted (genuinely dead, no caller): `composeTiptapExtensions` (`plugins/registry.ts`,
  sibling of the round-1 deletion), `copyHtmlToClipboard` (`export/htmlExport.ts`),
  `TableWithSourceLine` + its now-orphaned `Table` import (`plugins/shared/sourceLineNodes.ts`),
  and 4 dead shared test helpers `createMockStore` + `MockStoreApi` + `waitForRAF` +
  `waitMs` + `getFocusableElements` (`test/popupTestUtils.ts` — verified: test files use
  *local* copies; only `createMockRect` is imported and survives).
- **`export` keyword dropped only** (alive in-file, would break if deleted — `--fix`
  would have wrongly removed these): `pairQuotes` (`cjkFormatter/quotePairing.ts`),
  `createSourceWorkflowPreviewPlugin` (`codemirror/sourceWorkflowPreview.ts`),
  `getLocalActionMetadata` (`ghaWorkflow/actions/registry.ts`).

**Round 3 — full barrel sweep (scripted, exact-match, tsc-guided):**
- **100 dead barrel re-export members** removed across ~30 `index.ts` files
  (multiCursor, sourcePopup, theme, codeDetection, commands, formats, cjkFormatter,
  lifecycle, all the source-popup plugins, …) — each statement rebuilt cleanly
  (no empty `{}`/lone-`;` cruft) or dropped when fully emptied.
- **11 over-exported-but-alive symbols** had `export` dropped (used in-file).
- **5 more fully-dead declarations** deleted with a brace-matcher: `getDirectory`
  (`FileExplorer/useFileTree.ts`) + its orphaned `basename` import; `navigateToHeadingById`
  re-export + orphaned import (`linkPopup/operations.ts`); `requireStringArgAllowEmpty`,
  `validateByIndex`, `validateHeadingLevel` (`vmark-mcp-server/src/server.ts`).
- **Two near-misses caught by the gates (no regression shipped):**
  - `validateNonNegativeInteger` — initially deleted as a `validateByIndex` cascade,
    but **`index.ts` imports it** → mcp-server `tsc` failed → **restored** identically.
  - `ACTION_IDS` — `export` was dropped, but it's a `const` used **only** as a type
    (`typeof ACTION_IDS[number]`), so eslint flagged the now-"unused" value →
    **re-exported** (a harmless warn-level knip finding, not a lint error).

**Verified-and-left-alone (prior notes were stale):**
- `.math-block*` CSS — the 2026-05-30 audit called it dead, but block math **is**
  wired: `mathBlock` shortcut → `insertMath`, `menu:math-block`, and the font-embedder
  detects `class="math-block"`. **Not removed.**
- `useSourceEditorShowInvisiblesSync` — the prior "zero callers" note is stale; it is
  a *non-exported* in-file function called at `useSourceEditorSync.ts:281`. Nothing to do.

**Verification (all rounds):** main `tsc --noEmit` exit 0; **mcp-server `tsc` exit 0**
(separate tsconfig — caught the `validateNonNegativeInteger` cascade); `pnpm lint`
exit 0; `pnpm test` **19,256 passed / 10 skipped**; **mcp-server `pnpm test` 185 passed**;
full **`pnpm check:all` exit 0** (lint + knip + coverage + production build + size).

**Gate wiring:** `pnpm knip` is now in `check:all` (between `lint:themes` and
`test:coverage`). Per-category `rules` make it a *meaningful* gate without false
failures:

| Severity | Rules | Why |
|---|---|---|
| `error` (fails CI) | `files`, `dependencies`, `unlisted`, `unresolved`, `binaries` | High-signal, reliable in this repo — catch new dead files, unused/unlisted deps, broken imports. All currently 0. |
| `warn` (reported, non-blocking) | `exports`, `nsExports`, `types`, `nsTypes`, `duplicates`, `enumMembers` | knip's export/type analysis can't see this repo's `require()`-in-`vi.mock` and `("x" in mod)` dynamic patterns, and the barrel style makes a hard gate noisy. Surfaced for hygiene, not enforced. |

`@xterm/addon-serialize` moved to `ignoreDependencies` (reserved for terminal-plan
Phase 5 session persistence) so the `dependencies=error` rule stays green.

**Resulting state:** files 0, error-level deps 0, **exports 164 → 22**,
**duplicates 15 → 2**, types 210 → 209 (warn). Net **+43 / −522 lines** across 67 files.

**Remaining 22 export warnings — all explained, none worth churning:**
- **21** are internal helpers in one website demo file
  (`website/.vitepress/components/demos/cjkFormatter.ts`) — a standalone copy of the
  CJK formatter for the docs site. Touching them risks the VitePress build for zero
  app value; left as documented residue.
- **1** is `ACTION_IDS` (`plugins/actions/types.ts`) — a type-derivation `const`
  (`typeof ACTION_IDS[number]`) that must stay `export`ed to satisfy eslint; a benign
  warn.

Exports stay at **warn** (not `error`) by design: even at 0 today, an exports-hard-gate
would be **fragile** because new code using this repo's `require()`-in-`vi.mock` /
`("x" in mod)` dynamic patterns would false-positive and fail CI. The high-signal
categories (`files`/`dependencies`/`unlisted`/`unresolved`/`binaries`) remain `error`.

## 4. Recommendations (priority order)

1. ~~**Add a `knip.json`**~~ — **DONE** (§3a). 46 file false positives gone.
2. ~~**Execute the export-hygiene sweep**~~ — **DONE in full** (§3b, 3 rounds): defaults,
   dead standalone decls, stray `.d.ts`, **all 100 dead barrel re-exports**, and the
   over-exported-alive symbols. Down to 22 warn-level (21 website demo + `ACTION_IDS`).
3. ~~**Wire knip into `check:all`**~~ — **DONE** (§3b) with `error`/`warn` rule split.
4. ~~**Residual dead CSS / dead hook**~~ — **investigated, both stale claims**: `.math-block`
   is live (block math is wired); `useSourceEditorShowInvisiblesSync` is a used private
   function. Nothing to remove.
5. **Leave the snapshot feature and `@xterm/addon-serialize` alone here** — both
   are owned by other in-flight plans (workflow-engine WI-5.4; terminal Phase 5).
6. *(Optional, low value)* the 21 website-demo helpers in `cjkFormatter.ts` could be
   un-exported, but it's isolated demo code at warn-level — not worth the VitePress-build risk.

### Do NOT

- Run `knip --fix` on this repo — it produces cruft + `noUnusedLocals` breakage (§3b).
- Delete the over-exported-but-alive functions (§2) — only drop their `export` keyword.
- Re-litigate the snapshot KEEP decision (§3).
- Run `/ui-tokenize:fix` or trust knip's "unused files" without the config from (1).

---
title: "Open cost — a heavy document never starves the window, and opening it does no redundant or quadratic work (#1565)"
created_at: "2026-10-17 local"
mode: "full-plan"
---

# Open cost

**Status:** PLANNED (v3, after two Codex refute rounds).
**Branch:** `fix/issue-1565-open-cost`, stacked on `fix/issue-1565-image-heavy-doc-opens-sluggishly` (PR #1566, images load near the viewport).
**Issue:** #1565 — a 0.5 MB CJK document with 338 images, 340 headings and 154 code blocks opens sluggishly on Linux (WebKitGTK 2.52.6) and logs `menu commands did not mount within 5000ms`.
**Namespace:** `WI-OC<phase>.<n>` (rule 60 §1). Decisions are `D<n>`.
**DoD:** `bash scripts/check-open-cost-phase.sh <OC1|OC2|OC3|all>` (rule 60 §3; lands in OC1 with its gates-tier test and gains each phase's checks as the phase starts; per phase it asserts the named regression tests exist and `bash scripts/check-wi-linkage.sh .claude/tdd-guardian/plan-20261017-open-cost.md --phase=<n>` is green). Whole plan: `pnpm check:predelta`, `pnpm check:all`, `pnpm test:browser` exit 0, plus the acceptance protocol below.

## Evidence (measured before planning)

Reproduction: the issue's own fixture generator; VMark pinned to one core and capped at 25% of it (`systemd-run --user --scope -p CPUQuota=25%` + `taskset -c 0`) on WebKitGTK 2.52.6, the reporter's version. A throwaway in-page probe recorded frame stalls (rAF gaps over 50 ms) and the app's own `PERF_LOG` events; the timeout line comes from the app log.

| Document, throttled | Main-thread stalls at open | Menu timeout |
|---|---|---|
| Tiny (control) | ~3.2 s (app startup) | no |
| Fixture, text only | ~7.5 s | yes |
| Full fixture, PR #1566 | 10.4–11.4 s | yes |
| Full fixture, `main` | 12.0–12.6 s | yes |

Timeline of the throttled text-only open: startup stalls until 3.9 s, then ONE 2.7 s task (parse 0.9 s: `remarkParse` 880 ms, mdast→PM 11 ms; then the load `dispatch` ~1.8 s), then a 0.8 s first layout. Content-visibility is already on for this document on Linux (202k chars ≥ 50k).

Editor-only breakdown, real WebKit (vitest browser tier, Apple silicon, the production `createTiptapExtensions()`):

| Phase | Text only (678 blocks) | Full (1,170 blocks) |
|---|---|---|
| remark → mdast | 155–160 ms | 217–234 ms |
| mdast → ProseMirror | 1–3 ms | 3 ms |
| Load `dispatch` total | 186 ms | 276 ms |
| … `cjkLetterSpacing` state field (applied twice) | 102 ms (cold) | 81 ms |
| … lowlight state fields | — | ~47 ms across **5** plugins |
| … 154 code-block node views | — | 39 ms |
| … 338 image node views | — | 5 ms |
| Longest frame after load (layout) | 188 ms | 214 ms |
| `DecorationSet.create`, 12,168 CJK decorations (warm) | 30–35 ms | 35 ms |

Four structural findings:

1. **The window's readiness races the document.** `WindowProvider` renders its children only after `markReady`, so the menu mount (`useCommandBootstrap`), the editor's deferred initial load and the 5 s budget start together. The load is one synchronous task; the menu mount awaits a dynamic import and then **~155 `listen()` IPC round trips in sequence** (`mountMenuCommands`), each needing its own main-thread turn. Under load it finishes seconds late. Source mode builds its whole CodeMirror state synchronously too, so this is not a WYSIWYG-only race.
2. **Code blocks are highlighted five times.** Five identical lowlight plugins, each holding the same 1,078 decorations. `CodeBlockLowlight.addProseMirrorPlugins` returns `[...this.parent?.(), LowlightPlugin]`; Tiptap 3.31.4's `extend()` carries the inherited field into every level, so each wrapper (`CodeBlockWithLineNumbers`, `withoutShortcuts`, `withSourceLine`, `withBlankLinesBefore`) calls it again and adds a copy (Codex reproduced: 5 before a pass-through override, 1 after, `codeBlockVSCodeHandler` kept). Every edit in a code block pays it too.
3. **Building a decoration set is quadratic in document size.** `prosemirror-view`'s `buildTree` walks the top-level blocks and, for each, `takeSpansForNode` scans the WHOLE decoration array: O(blocks × decorations) — 678 × 12,168 ≈ 8.2M iterations for the CJK set alone, plus five lowlight sets. Codex measured the indexed reads growing 202k → 804k → 3.2M for 100 → 200 → 400 blocks. Every plugin that decorates the whole document pays it at open, and the guide's own 2,250-block / 15 s figure is where a quadratic term dominates.
4. **An editor that has not loaded its document can be serialized by an explicit flush.** `flushToStore` has no loaded-state check. Save and Save All (`flushActiveWysiwygNow` → the registered flusher) and the MCP bridge's flush serialize the empty placeholder if they land between mount and the initial load; the store then holds `""` and the load's drift check syncs the editor to it. Auto-save and the unmount flush are already guarded by a pending-edit check (`useAutoSave.ts`, `useTiptapUnmountFlush.ts`), so the exposure is explicit flushes in a one-macrotask window. Narrow, but data loss.

`website/guide/large-files.md` says parsing "is not the bottleneck". On this document the parse is 26–40% of the editor's open cost — but moving it to a Worker does not by itself bring content sooner, and doing it safely is a project of its own (D2).

## Operating rules

1. Test first; every behaviour change has a test seen failing (rule 10).
2. No baseline growth, no raised thresholds, no skipped tests.
3. Mechanism, not instance: findings 2 and 3 are classes; their tests cover the class.
4. Files stay under the size gate; extract rather than grow.
5. Every new module is in `scripts/feature-map.json` and the feature ledger in the same change.

## Decisions

| # | Decision | Outcome |
|---|---|---|
| D1 | How readiness stops depending on the document. (a) gate the editor's initial LOAD; (b) gate the document SURFACE's mount; (c) mount the menu before `WindowProvider` renders children. | **(b), wrapping `<DocumentSplitContainer />` in `App.tsx`** so the whole split container mounts fresh once the gate opens (Codex round 2 #4: gating inside it left `useSyncPaneScroll` bound to the empty pane wrappers). Codex showed (a) lengthens the "editor mounted, document not loaded" interval, exposing every consumer of the live editor (print, lint, find, outline navigation, MCP selection, cursor tracking, split-pane context) and leaving Source mode ungated. Gating the mount keeps each surface's own lifecycle exactly as today: before the gate opens there is simply no editor, which every consumer already handles (it is the state before `markReady` today). `DocumentSplitContainer` is the only mount of `Editor.tsx`, where every document surface is chosen, so WYSIWYG, Source, split and media are all covered. (c) moves command registration out of the React tree that owns its lifecycle. |
| D2 | Parse on a Worker in this plan? | **No — a follow-up plan.** It frees the main thread for the parse (0.9 s of the 2.7 s task, throttled) but does not bring content sooner unless the parse also starts at file open, and Codex's review lists what a safe version needs: the canonical store snapshot (CRLF/BOM, hot-exit replacement) as the cache key, discovery at `ingestExternalContent` and every restore/transfer path, byte- and queue-bounded memo with visible-tab priority and consumer ownership, worker liveness with every request settling once, parser errors kept distinct from transport errors, handled prefetch rejections, drift re-requests instead of a synchronous re-parse, a production-CSP acceptance that proves the worker ran, and a loading affordance for 32k–300 KiB documents. Those become that plan's acceptance criteria. A cheaper middle step — yielding between parse and load to split the task — was planned in v2 and dropped: Codex round 2 (#1, #2, #5) showed the yield opens a window for IME composition into the placeholder, lets the 200 ms cursor-tracking timer record the placeholder's selection, and turns content drift into stale load + fresh parse + fresh load in one task. |
| D3 | A wall-clock budget test in CI? | **No.** Each mechanism gets a deterministic guard: plugin-family counts per extension, call/operation counts, ordering assertions, CPU-clock growth (`src/test/cpuClock.ts`) for the decoration build, and a differential test for the patch. Timing evidence comes from the acceptance protocol; `src/bench/openCost.bench.ts` tracks it manually. |
| D4 | The store→editor sync (`syncMarkdownToEditor`) also parses synchronously. | Out of scope; it benefits from findings 2 and 3 like every load. |
| D5 | Defer code-block chrome (line numbers, copy button, language picker) to near the viewport? | Not in this plan; 39 ms for 154 blocks. Re-measure after OC2. |
| D6 | How to stop the lowlight multiplication. | `CodeBlockWithLineNumbers` overrides `addProseMirrorPlugins` with a pure pass-through (`this.parent?.() ?? []`), so the levels above inherit a function that adds nothing. Verified by Codex's probe. |
| D7 | How to make decoration sets linear. | **A `pnpm` patch of `prosemirror-view`** (precedent: `patches/` for micromark, mdast-util-*), patching the shipped entry points (`dist/index.js` ESM and `dist/index.cjs`; Codex round 2 #8). `buildTree` partitions with one sweep over decorations sorted once by start (stable, so equal ranges keep their order; strict containment, boundary widgets, node decorations, leaves and recursive offsets as upstream), and `forChild` finds its child by binary search instead of a scan from zero on every call (round 2 #3: `iterDeco` calls it per child, so rendering stayed quadratic). `addInner` has the same per-child scan and gets the same treatment if the differential test can pin it. A differential test compares the patched package (imported the way the app imports it) against the unpatched algorithm on generated decoration sets, including the rendered DOM; CPU-clock growth tests pin `create` and the render path. An upstream PR to ProseMirror is drafted for the maintainer to send (outward-facing). |

## Phases

### Phase OC1 — The window is never starved by its document

- **WI-OC1.1 — An explicit flush never serializes an editor that has not loaded.** Finding 4. `flushToStore` returns without writing until the initial content has actually been APPLIED — distinct from `editorInitialized`, which today flips to true even when `setContentWithoutHistory` returned `"deferred"` behind an IME composition (Codex round 2 #1). The applied state is set only by the write itself (immediately, or when the deferred write runs); an editor whose document could not be parsed stays unapplied behind the refused-tab guard, so lifting that refusal cannot expose the placeholder to a flush. RED: invoke the registered flusher (the path Save and Save All take) before the deferred load runs, and again while the load waits behind a composition; the store must keep its text both times. After load it flushes as today; the unparseable-document guard is unchanged.
- **WI-OC1.2 — The menu mounts in one round of IPC.** Finding 1. `mountMenuCommands` issues every `listen()` at once, keeping the duplicate and missing-command preflights, per-binding failure isolation and the `failed` report. Lifetime (Codex #13): once the pass is torn down, each registration that resolves later is unlistened as it resolves (a hung registration cannot pin the others); each listener checks the pass is live at DISPATCH time; `disposeEditorActionOwner` is made generation-aware so a cancelled pass cannot dispose its replacement's queued actions. The existing sequential-abort test is replaced deliberately, with the reason in its header. Tests: all `listen()` calls are issued before any resolves; abort after issue removes every resolved listener at once and every late one as it resolves; a torn-down pass dispatches nothing; pass B's queued retry survives pass A's late teardown; partial failure mounts the rest and reports `false`.
- **WI-OC1.3 — No document surface mounts before the window is listening.** Finding 1, D1. A level-triggered "window listening" signal (reusing `utils/readinessBarrier.ts`), published by `useWindowReady`'s announcement on every path and exposed as a hook; a small gate component wraps `<DocumentSplitContainer />` in `App.tsx` and mounts it only once the signal is true (a document window that has announced, or any window that never armed it). `lint:shell-slots` is checked for the wrapper. Codex #14: tested through the REAL `WindowProvider` under StrictMode — document window with a file, pre-existing tabs, both transfer early-returns, init error — plus the settings/pdf-export replay path, where a cancelled announcement timer must be re-armed. Tests: the surface does not mount before the announcement and mounts after it; every `markReady` path opens it; a window that never armed it (tests, non-document windows) mounts at once; the menu barrier is signalled before any document surface exists; a two-pane split with synchronized scrolling binds to the real scrollers after the gate opens.
- **WI-OC1.4 — The menu mount does not wait for the export chunk.** Codex round 2 #6: `registerPandocFormatCommands` awaits `import("@/export/pandocExport")` only to read the static `PANDOC_FORMAT_KEYS`, so a slow chunk can still exhaust the 5 s budget with no document involved. The keys move to a leaf module imported statically; the commands still load the exporter lazily when run. Tests: registering the Pandoc commands imports nothing; running one loads the exporter; the menu mount completes with the export chunk unresolved.
- **WI-OC1.5 — DoD script.** `scripts/check-open-cost-phase.sh` + its gates-tier test (template: `check-repo-audit-phase.sh`), landed here so each phase is gated as it completes (round 2 #9).

**DoD OC1:** the tests above exist and pass; `check-wi-linkage --phase=OC1` green.

### Phase OC2 — No redundant or quadratic work at load

- **WI-OC2.1 — One highlighter per code block.** Finding 2, D6. Tests: the production extension list yields exactly one lowlight plugin; highlighting applies and updates on edit; the code-block extension keeps its other plugins. Class test (Codex #15: keys are unique by construction, so it counts FAMILIES): for every extension in `createTiptapExtensions()`, resolve its plugins and input/paste rules and assert no plugin-key family (key without its `$N` suffix) and no rule (by its `find` source) appears twice within one extension's output. Seen failing on the current chain.
- **WI-OC2.2 — Building a decoration set is linear.** Finding 3, D7. `patches/prosemirror-view@1.42.6.patch` + `package.json` `patchedDependencies`. Tests, through the public `prosemirror-view` import: a differential test (generated documents and decoration sets — inline, node, widget with both sides; overlapping, nested, equal ranges, boundary-touching, leaf children) asserting the patched `DecorationSet.create`/`add`/`forChild` give the same `find()` output and the same rendered DOM as the reference algorithm; CPU-clock growth tests for `DecorationSet.create` and for rendering a decorated document, n vs k·n blocks with proportional decorations (both seen failing: quadratic today); a parity check that the ESM and CJS entry points carry the patch.
- **WI-OC2.3 — `cjkLetterSpacing` does its whole-document work once per load.** The second apply comes from Tiptap's `trailingNode` appending an empty paragraph after a document that ends in a non-paragraph block (Codex round 2): the insertion resolves at depth 0, so `applyIncrementalUpdate` expands its range to the whole document and rescans it. The changed range is expanded to the enclosing TEXTBLOCKS, never to the document, and a whole-document replace rebuilds with one `createCJKDecorations`. Tests (production extensions, a document ending in a code block): the load scans the text once (call count); decorations equal a fresh full scan after a full replace and after an EOF insertion; incremental edits behave as today.

**DoD OC2:** tests exist and pass; `check-wi-linkage --phase=OC2` green.

### Phase OC3 — Guards, documentation, acceptance

- **WI-OC3.1 — An open-cost bench.** `src/bench/openCost.bench.ts`: the #1565 fixture shapes through parse and load, for manual before/after tracking (D3).
- **WI-OC3.2 — Documentation.** `website/guide/large-files.md` (the measured parse share, the quadratic decoration fix, the document appearing once the window is ready) and every locale page (`lint:doc-joins`); feature ledger and map entries for every new module; the upstream ProseMirror PR text in the PR description.
- **WI-OC3.3 — Acceptance on the reporter's stack.** Protocol below; results in this plan's status trail and the PR.

## Acceptance protocol

WebKitGTK 2.52.6 (the issue's version), production frontend in a debug binary, the issue's fixture and its text-only variant, 3 runs each, throttled (25% of one core) and unthrottled. Codex #11: startup and document cost are reported separately — the tiny-document control is re-measured on the same build, and "document cost" is total stalls minus the control.

| Measure | Before (PR #1566) | Target |
|---|---|---|
| `menu commands did not mount` lines, throttled | 3/3 runs, every document | **0/3**, every document, WYSIWYG and Source mode |
| Document cost, throttled, full fixture | ~7.2–8.2 s (10.4–11.4 s − 3.2 s) | lower, with each OC2 mechanism's share attributed by re-profiling after it lands |
| `DecorationSet.create` / decorated render growth exponent | ~2 (quadratic) | ≤ 1.2 (CPU-clock growth test) |
| Unthrottled: images loaded, memory, stalls | as recorded | no regression |

Honest expectation, stated up front (Codex round 2 #7): OC2 removes redundant and quadratic work, so the saving grows with document size, but on THIS document the parse (0.9 s throttled), the ProseMirror DOM build and the first layout remain — roughly 80% of the document cost by the Apple-silicon subtotal. Those are the follow-up's (Worker parse started at open) and WYSIWYG's floor. The acceptance report states what remains, by phase.

macOS: the dev app opens the fixture with code highlighting, CJK spacing and images intact; Save pressed during the open leaves the file unchanged.

### Acceptance results

Build `19cdc8d7f` on WebKitGTK 2.52.6, protocol as above, 3 runs per row. Stalls are the sum of frame gaps over 50 ms in the first 22 s; document cost is stalls minus the tiny control on the same build (3.14–3.22 s).

Throttled (25% of one core):

| Document | Menu timeouts | Stalls | Document cost | Longest frame | Before (PR #1566) |
|---|---|---|---|---|---|
| Tiny (control) | 0/3 | 3.14–3.22 s | — | 0.3–0.5 s | ~3.2 s, no timeout |
| Full fixture | **0/3** | 8.67–8.97 s | **5.5–5.8 s** | 2.3–2.4 s | 10.4–11.4 s (7.2–8.2 s), timeout in 3/3 runs, longest 3.9–4.0 s |
| Text only | **0/3** | 5.86–6.14 s | **2.7–3.0 s** | 1.3 s | 7.3–7.7 s (~4.3 s), timeout in 2/2 runs, longest 2.5–2.6 s |
| Source mode (fixture ×3, 1.5 MB, opens in Source) | **0/3** | 5.64–5.69 s | 2.5 s | 0.5–0.6 s | not measured |

Unthrottled — no regression:

| Document | Stalls | Longest frame | Web process RSS | Images with `src` | Before (PR #1566) |
|---|---|---|---|---|---|
| Tiny | 52–104 ms | 52–59 ms | 297–302 MiB | — | — |
| Full fixture | 859–909 ms | 370–374 ms | 442–449 MiB | 6 of 338, all loaded | 1,057–1,501 ms, 495–620 ms, 516–521 MiB, 6 of 338 |
| Text only | 321–431 ms | 162–169 ms | 387–390 MiB | — | not measured |

Each OC2 mechanism's share, by reverting it alone (build `aa344caa3`, same load path; throttled stalls, full / text only, against 8.66–9.14 s / 5.94–6.13 s with everything on):

| Reverted | Full | Text only | Share |
|---|---|---|---|
| CJK spacing (host gate + textblock ranges, WI-OC2.3) | 10.2–11.2 s | 7.3–7.8 s | ~1.7 s / ~1.5 s |
| Lowlight duplicates (WI-OC2.1) | 9.2–9.5 s | 6.0–6.1 s | ~0.4 s / none (no code) |
| `prosemirror-view` patch (WI-OC2.2) | 8.7–9.3 s | 5.9–6.1 s | within noise |

The patch shows nothing at the default setting because spacing off leaves almost no decorations at load; with spacing on, a load decorates 12,168 CJK runs and the patch turns their quadratic build and draw linear. CPU-clock growth exponents, idle (unpatched ~2; target ≤ 1.2): `create` 1.09–1.19, `add` 1.01–1.08 (2,000–20,000 blocks), `forChild` 1.01–1.07. CI holds them under 1.35, this repo's bound for linear growth tests. Every attribution variant also had 0/3 timeouts: OC1's window gate alone removes the reported symptom.

What remains, throttled (PERF timeline of the final build): text only — startup until 3.9 s, then ONE 1.30 s task (parse 0.90 s: `remarkParse` 796 ms, mdast→ProseMirror 86 ms; the load dispatch ~0.4 s, was ~1.8 s), then a 0.71 s first layout. Full fixture — a 2.31 s task (parse 1.30 s, then the dispatch and the 154 code-block and 338 image node views ~1.0 s) and a 2.09 s layout. The parse and the first layout are the follow-ups' (D2's Worker parse started at open) and WYSIWYG's floor.

macOS (dev app, Apple silicon), a fresh copy of the fixture opened through `open-file`:

- Save pressed 33 ms into the open, before the editor existed: the file is byte-identical (SHA-256 and size unchanged; Save rewrote the store's text, the original).
- 1,171 blocks; 154 code blocks with 1,078 highlight spans.
- CJK spacing on: 12,168 runs decorated at 0.05 em, none in code; off: none.
- Images load as they near the viewport once the window is visible (3 loaded). While the window is hidden WebKit runs no animation frames, so the render queue waits — as on PR #1566.

## Risks and how each is checked

| Risk | Check |
|---|---|
| The surface gate never opens on some path → a document window shows no content. | WI-OC1.3 drives every `markReady` path through the real provider under StrictMode; unarmed windows are open by default. |
| The prosemirror-view patch changes behaviour, not just speed. | WI-OC2.2 differential test against the reference algorithm, including rendered DOM; a Dependabot bump fails install until the patch is re-made (intended, as for the existing patches). |
| The lowlight fix drops `CodeBlock`'s own plugins. | WI-OC2.1 asserts the full plugin family set of the code-block extension minus the duplicates. |
| Concurrent listener registration races StrictMode replays. | WI-OC1.2 lifetime tests (late registrations, owner generations). |

## Follow-ups (not in this plan)

- Off-main-thread parse started at file open — D2 lists its acceptance criteria.
- Code-block chrome near the viewport — D5.
- Upstream (ProseMirror now lives at code.haverbeke.berlin): the `buildTree`/`addInner`/`forChild` speed-up as a patch, and the `mapChildren` bug (a later step that replaces a touched child's opening token leaves its content unshifted) as an issue with its reproduction — both drafted in the PR description for the maintainer to send.

## Status trail

- 2026-10-17 — v1 planned from the measurements above.
- 2026-10-17 — v2 after Codex refute review (18 objections). Accepted: #1 (the CJK cost is the quadratic decoration build, now WI-OC2.2), #7 and #2–#5, #18 (by gating the surface instead of the load, D1), #11 (separate startup and document cost), #13 (listener lifetime), #14 (real-provider StrictMode tests), #15 (family counts, growth test), #17 (corrected finding 4 and its RED entry point). The Worker parse (#6, #8–#10, #12, #16) moved to a follow-up with those objections as its criteria.
- 2026-10-17 — v3 after Codex round 2 (9 objections), all accepted: flush gate keyed on content APPLIED (#1); the parse/load yield dropped (#1, #2, #5); `forChild` added to the patch (#3); the gate wraps `DocumentSplitContainer` (#4); Pandoc keys made eager, WI-OC1.4 (#6); honest acceptance expectation (#7); both dist entry points patched (#8); DoD script moved to OC1 (#9).
- 2026-10-17 — OC1 implemented. Three departures from v3, each for a checked reason:
  - WI-OC1.3's gate sits INSIDE `DocumentSplitContainer.tsx`, above every hook (the old body is now an inner component that mounts fresh when the gate opens), not as a wrapper in `App.tsx`. `lint:shell-slots` only lets its surface list shrink, and a wrapper would be a new surface. Codex round 2 #4 is still met: the scroll-sync test fails with the gate placed below the hooks (checked by mutation).
  - The signal is a small external store (`contexts/windowListening.ts`, read with `useSyncExternalStore`), not a `readinessBarrier`. The consumer is a render decision, and about 23 test files stub the `WindowContext` module, so a context field would have taken their document surface away.
  - WI-OC1.2's cancellation is an `AbortSignal` (`shouldAbort` is gone): with every listener requested at once there is no gap between registrations to poll in.
  - Found while testing through the real provider under StrictMode, and fixed: a settings or pdf-export window never announced itself in dev builds. The simulated unmount cleared its timer, and the provider's once-only init never called `markReady` again.
- 2026-10-17 — OC2 implemented. Departures from v3, each for a checked reason:
  - The growth test times `forChild` alone, not a decorated jsdom render: a render buries the quadratic term under DOM construction and passes either way, and the per-child step's memory outgrows the cache between sizes (1.42–1.65 measured with it, 1.00–1.16 without).
  - The growth bound is 1.35, not 1.2: idle readings reach 1.19, and 1.35 is this repo's bound for linear growth tests, whose worst reading under coverage and load was 1.27. The measured exponents are reported against 1.2 above.
  - `addInner` is patched too (v3: "if the differential test can pin it" — it does).
  - Found and fixed: the WYSIWYG host never passed the CJK spacing setting to the plugin, so spacing off still decorated every CJK run (regression from `b760fbb25`). The fix shares one predicate with the export path.
- 2026-10-17 — OC3: bench, guide and its nine translations, ledger, AGENTS.md; acceptance above.
- 2026-10-17 — Codex audit round 1 (8 findings). Fixed: `addInner` still spliced each new child in, quadratic (now merged; growth test reshaped, seen failing); a compound transaction left CJK decorations unshifted inside a blockquote — an upstream `mapChildren` bug, now fixed in the patch with an independent map oracle (each decoration mapped alone), a rendered-DOM differential and a 200-case CJK structural fuzz (7 cases fail on the old patch); a reversed span went to a different child than upstream's; the phase gate now requires every regression test; the bench now has the fixture's 338 images and 0.5 MB, sized in UTF-8; acceptance and this trail recorded. Overruled: "enforce ≤ 1.2" — the bound is 1.35, for the reason in the OC2 entry.

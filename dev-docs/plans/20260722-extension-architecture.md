# Extension Architecture — Phased Plan

**Status (2026-07-23)**

| Phase | State |
|---|---|
| 0A safety net | ✅ **COMPLETE** — production-schema harness, corpus 12 → 22, 4 pre-existing defects found |
| 0B security | ⚠️ **1 of 4** — WI-0B.2 done; the other three are re-scoped onto the capability broker (see below), because the plan's remedies would break custom shells, Save As, and stored keys |
| 1 architecture contract | ✅ **COMPLETE** — descriptor, resolver, claim protocol, Node-safe gate, scope inventory, perf baseline, budget ratchet, doc corrections |
| 2 serialization inversion | ✅ **COMPLETE** — both switches deleted (24 + 34 arms); both `convertNode`s pure dispatch; `convertParagraph`'s media fan-out now claim-driven with ordering-independence proven by test. `convertHtml`'s internal fan-out and mark-run factoring remain central **by design** (WI-1.6) |
| 3 composition migration | ✅ **COMPLETE** — both roots resolve through `resolveExtensions`; **adoption gate 2 → 0**; ADR-011's registry and all 77 stub manifests deleted (80 files). WI-3.4 (alphabetical sort) stays open by design: it is only safe once ordering constraints are explicit |
| 4A host normalization | ✅ **RESOLVED via option 2** — `FormatConfig.language` gives bundled packs a synchronous path, so the source host is registry-driven with no flash on the primary path |
| 4B markdown as extension | 🟡 **5 of 7** — WI-4.1 (partial), 4.2, 4.3, 4.6 done; 4.4 half done (outline yes, word-count contract declared but consumers unmigrated). Remaining: the markdown failure-open default (4.5), mermaid host dedup (4.7) |
| 5 extension points | 🟡 **WI-5.1 DONE** — markdown declares a fence-language extension point; mermaid/graphviz/markmap/svg/latex/workflow register as **peers**. Zero renderer names remain in the markdown dispatch. Executable third-party tiers (5.3-5.5) still need the capability broker + package contract |

Codex review (RETHINK, 3 BLOCKER / 8 MAJOR) dispositioned below; all three
BLOCKERs are resolved in Phase 1.
**Branch:** `refactor/vmark-core`
**ADR:** `dev-docs/decisions/ADR-015-extension-model.md`
**Evidence:** `dev-docs/deep-researches/20260721-extension-architecture-investigation.md`,
`dev-docs/deep-researches/20260722-extension-architecture-prior-art.md`

Goal: minimal core, everything else an extension, third-party ecosystem
eventually. ADR-015 holds the decisions; this file holds the sequence.

## Guiding constraint

Phases are ordered so that **each one makes the next one safe**, not by how
visible the result is.

## Codex review disposition (2026-07-22)

Verdict **RETHINK**. Three factual claims in the first draft were checked and
**all three were wrong** — corrected in ADR-015 and here:

| First draft said | Reality |
|---|---|
| "~700 of ~2,600 non-test pipeline lines are document-scoped" | The pipeline is **4,994** non-test lines (30 files). The 700 figure was never independently derived. **Premise withdrawn** — WI-1.6 now produces a real inventory |
| "100% of markdown-conversion knowledge lives in the pipeline" | False. `vmark-content-server/src/render/remarkAlerts.ts:72` owns an independent alert transform; the pipeline imports `videoProviderRegistry`. The true claim is narrower: *no Tiptap extension owns its adapter* |
| "the goldens approve the deletion" | False. The corpus has **no** `[TOC]`/video/audio/iframe fixture, so these are never tested. The hazard is prospective — which is exactly what Phase 0A's new fixtures would trigger |

Accepted structural changes: claim protocol moves to Phase 1 (BLOCKER — overlap
is not confined to the hard families, so "mechanical" work would bake in an
accidental protocol); a resolver + stable-ID contract becomes Phase 1 before
serialization (BLOCKER — the old WI-1.1 contract test depended on a registry that
Phase 3 had not yet built); security hardening moves to Phase 0B; Phase 4 splits
into host normalization then markdown extraction; performance and undo/redo
become explicit gates.

## Phase 0A — Repair the safety net (blocking)

The corpus characterization harness runs against `testSchema.ts`, not the
production schema. That schema omits `toc`, `block_video`, `block_audio`, and
`video_embed`; every mdast→PM converter returns `null` for an absent node type,
so those constructs are silently dropped and the goldens **encode the deletion as
correct**. A `[TOC]` line round-trips to nothing with the test green.

Until this is fixed, no serialization refactor can be trusted — arms 13/14/15/19
(PM→mdast) and 11 (mdast→PM) are unreachable by the harness.

| WI | Change |
|---|---|
| WI-0.1 | Derive the harness schema as a **schema-only projection from the same resolved production descriptors**, with UI-only plugins excluded by an explicit capability filter. Do *not* hand-extend `testSchema` (recreates the drift) and do *not* instantiate the full editor (pulls React/DOM/stores into Node) |
| WI-0.2 | Add corpus fixtures for every uncovered custom syntax: `[TOC]`, `<video>`/`<audio>`/`![x](y.mp4)`/`<source>` fallback, provider `<iframe>` embeds, `++underline++`, escaped markers `\== \++ \^ \~`, nested `<details>`, bare list markers, multi-block footnote definitions, alerts containing lists/code, table cells with hard breaks |
| WI-0.3 | Add fixtures for the non-default option paths: `preserveBlankLines`, `hardBreakStyle: "twoSpaces"`, `preserveLineBreaks` |
| WI-0.4 | Assert the harness fails when a node type is missing from the schema, rather than silently dropping it |

| WI-0.5 | Build a **compatibility corpus** captured from released VMark versions; require fixed-point stability against it. Any intentional canonicalization change is documented as a format migration — never an automatic rewrite of unopened files |

**DoD — met 2026-07-23**
- ✅ `src/test/productionSchema.ts` projects the real editor schema via `getSchema(createTiptapExtensions())` — no Editor, no DOM, no React
- ✅ `schemaCoverage.test.ts` asserts all 31 emittable node types + 9 marks are representable, and pins `testSchema`'s exact 4-node gap as the reason it must not back the harness
- ✅ Corpus 12 → 22 fixtures; goldens reviewed line-by-line, not merely regenerated
- ✅ `pnpm check:all` green (1156 files / 23,587 tests; coverage 93.81% stmts / 90.35% branches)
- ⏳ WI-0.5 compatibility corpus: seeded at v0.9.7 by the committed goldens; genuinely cross-release comparison needs captures from prior releases and grows per release

### Phase 0A outcome — four pre-existing defects found immediately

The widened corpus caught real round-trip bugs **before any refactor started**.
Goldens encode the broken output deliberately (characterization semantics); see
`__tests__/characterization/README.md` for the full table.

| # | Input | Round-trips to | Cause |
|---|---|---|---|
| D1 | `![A short clip](clip.mp4)` | `![](clip.mp4)` | `block_video`/`block_audio` have no `alt` attribute (`plugins/blockVideo/tiptap.ts:36`) |
| D2 | `[text](url "Title")` | `[text](url)` | the `link` mark declares no `title` attribute |
| D3 | `==highlight with **bold**==` | `\==highlight with **bold**==` | opening `==` escaped when the highlight nests a mark — highlight destroyed |
| D4 | `x\^2\^` (literal) | `x^2^` (real superscript) | escape stripped; re-parses as different content (H7 class) |

D1/D2 are silent data loss, D3/D4 silent semantic corruption — all
autosave-persisted, since `useTiptapFlush` serializes on every edit. **These are
bugs to fix, not behaviour to preserve through the inversion**; fixing them is
tracked separately from Phase 2's byte-preserving requirement.

## Phase 0B — Security hardening (independent, do regardless)

Pulled out of Phase 5: these are live holes today and have nothing to do with
plugins. Any in-webview code already inherits them.

| WI | Change | Status |
|---|---|---|
| WI-0B.2 | Validate `run_ai_prompt`'s `cli_path` | ✅ **DONE** — 13 tests; full Rust suite 1437 green |
| WI-0B.1 | Broker `pty::pty_spawn` | ⛔ **BLOCKED — needs a decision** |
| WI-0B.3 | Confine `file_write::atomic_write_file` | ⛔ **BLOCKED — the plan's remedy is wrong** |
| WI-0B.4 | Namespace the keychain per caller | ⛔ **BLOCKED — needs a migration** |

WI-0B.2 was safely mechanical because `cli_path`'s legitimate use is a custom
*install location* for the same binary, so the basename must still match. The
other three are not, and implementing them as written would ship regressions:

- **WI-0B.1 `pty_spawn`.** The terminal spawns a *user-configured* shell —
  `spawnPty.ts:188` reads `settings.terminal.shell`. An allowlist would break
  every custom shell. The real threat is in-webview code spawning arbitrary
  executables, which needs a caller-identity capability check, not a binary
  allowlist.
- **WI-0B.3 `atomic_write_file`.** It already rejects `..`, requires an absolute
  path, and checks the parent exists. Routing it through
  `mcp_bridge_path_guard` requires *allowed roots*, but save paths come from the
  native dialog (`hooks/saveDialog.ts:14`) — a user may legitimately save
  anywhere. A root allowlist would break Save As. The correct model ties a write
  to a path the user actually granted, which is the capability broker's job.
- **WI-0B.4 keychain.** Re-namespacing `apikey.*` per caller strands every key
  users have already stored. Needs a read-old/write-new migration, and a
  decision about what happens to keys whose original caller is unknown.

All three converge on the same thing: they need the **capability broker**
(ADR-015 D5), where authority is bound to a caller principal rather than a path
or binary allowlist. That is Phase 5's WI-5.3, and pulling it forward is the
honest sequencing — not shipping three allowlists that break real usage.

**DoD:** WI-0B.2 met. The remaining three are re-scoped onto the capability
broker and no longer belong in a "mechanical hardening" phase.

## Phase 1 — Architecture contract (BLOCKER-driven rewrite)

The first draft made this "make constraints fail" and deferred both the resolver
and the claim protocol. Codex showed that cannot work: WI-1.1's
`set(registry) === set(composed)` test compared a manifest registry against a
hand-built array, with no honest definition of equality, and the deferred claim
protocol would have been silently pre-decided by the "mechanical" tier of Phase 2.
Both move here.

| WI | Change |
|---|---|
| WI-1.1 | ✅ **DONE** — `src/lib/extensions/types.ts`. `Contribution` deliberately excludes commands (registry fork) and panels (ADR-007 seam absent) |
| WI-1.2 | ✅ **DONE** — `src/lib/extensions/resolve.ts` + 24 tests. Stable topological sort: constraints hard, bucket-then-registration-order as tie-break; dangling refs are errors; cycles report the full path; **empty ordering on any error** so a partial composition can never look plausible. Duplicate Tiptap *name* detection (post-factory) is deferred to Phase 3, where factories actually run |
| WI-1.3 | ✅ **DONE (protocol)** — `src/lib/extensions/claim.ts` + 15 tests: strength ranking, conflict-as-error, full bid trace, throwing recognizers degrade to declining. The **semantic mdast normalization** half (blockquote→alert, paragraph/image→video\|audio\|blockImage, html→video\|audio\|videoEmbed) lands in Phase 2 with the nodes it normalizes |
| WI-1.4 | **Node-safe entrypoint rule** — `feature/markdown.ts` / `feature/prosemirror.ts` / `feature/index.ts`; dep-cruiser **import-graph gate** so registry 1 can never transitively reach editor code. `nodeSafe.ts:16`'s invariant becomes a lint rule, not a comment |
| WI-1.5 | ✅ **DONE** — `src/bench/pipelinePerf.bench.ts` on the **production** schema (the existing `markdown.bench.ts` uses `getSchema([StarterKit])`, so it measures a pipeline the app never runs). Baseline below |
| WI-1.6 | ✅ **DONE** — `scripts/pipeline-scope-inventory.mjs`. Result below, and materially better than the withdrawn premise |
| WI-1.7 | ✅ **DONE** — `plugin-isolation` promoted `warn` → `error`; residual violations frozen via dependency-cruiser's own `--ignore-known` mechanism (the `.dependency-cruiser-known-violations.json` file existed but `lint:deps` never passed the flag, so it was dead) |
| WI-1.8 | ✅ **DONE** — `scripts/check-extension-budget.mjs` + `scripts/extension-budget.json` wired into `check:all` as `lint:extension-budget`. Ratchets down only, mirroring the file-size gate |
| WI-1.9 | Correct `dev-docs/architecture.md`'s false "enforced via dep-cruiser" claim |

**Gates must be structural, not textual** (ADR-015 D6). ADR-012's grep gate
reports green while an 88-entry router dispatches through a variable event id
(`useUnifiedMenuCommands.ts:350`). Use dep-cruiser rules or call-site counts of
the sanctioned entry point.

**Adoption, not existence.** `src/lib/extensions/adoption.test.ts` pins how many
composition roots still bypass the resolver (currently **2**:
`tiptapExtensions.ts`, `sourceEditorExtensions.ts`) and ratchets down only. The
resolver is the fifth foundation this project has built; the previous four all
became dead code. Phase 3 drives the count to 0 — until then the gate makes the
non-adoption visible instead of silent.

**Progress 2026-07-23:** WI-1.7 and WI-1.8 complete and verified by experiment —
injecting a cross-plugin import into `plugins/underline/tiptap.ts` turns
`lint:deps` red (`1 errors`, exit 1); removing it returns green. The constraint
can now fail, which is the entire point of D6.

Note the scope: the baseline holds **7** violations, not 201. The other ~194 stay
masked by the 22 `pathNot` entries in the `plugin-isolation` rule, which encode
reviewed design intent (coordination plugins are cross-cutting *by design*)
mixed with accepted debt. Separating those two is Phase 3 work; the reproducible
measurement command is recorded in `scripts/extension-budget.json`.

**DoD**
- Resolver exists **and** an adoption count is asserted in CI — existence proves nothing (four ADRs died of exactly that)
- Claim protocol has a test proving two same-strength claims fail loudly
- Import-graph gate fails if registry 1 reaches editor code
- Performance budget recorded, with a regression gate
- `plugin-isolation` is `error`; budget only decreases

### WI-1.6 result — the irreducible core is far smaller than assumed

`node scripts/pipeline-scope-inventory.mjs` (re-runnable; fails if a named symbol
is renamed, so it cannot rot like the numbers it replaces):

| Category | Lines | Meaning |
|---|---|---|
| `preprocess` | 319 | Whole-**string** passes before/after any tree exists (`escapeMarkers.ts` 175, `listNormalization.ts` 144). Not per-node — but **relocatable**: remark already models this shape, so they can become registry-1 contributions rather than staying central |
| `algorithm` | 197 | Genuine whole-document/sibling context: `blankLineCapture.ts` 84, `mergeInlineHtmlTags` 62, `groupInlineItems` 31, `applyCosmeticPass` 20. Stays central — but contributed handlers may still **call** it |
| `state` | 9 | `usedSlugs` heading uniqueness. Needs a context object, which is a parameter, not a barrier |
| **Total** | **525 / 5,024 (10.4%)** | vs the withdrawn claim of ~700/2,600 (27%) |

**The genuinely irreducible part is 197 lines — about 4% of the pipeline.** The
first draft overstated the barrier roughly sevenfold and, worse, lumped together
four situations with different remedies. The inversion is substantially more
tractable than the plan originally claimed.

### WI-1.5 baseline (2026-07-23, production schema, no coverage)

| Size | serialize mean | serialize p99 | parse mean |
|---|---|---|---|
| 10 KB | 3.4 ms | 4.4 ms | 16.5 ms |
| 100 KB | 33.8 ms | 34.6 ms | 237 ms |
| 1 MB | 344 ms | 349 ms | — |

Roughly linear at ~0.34 ms/KB for serialize. **Parse is ~4-5x more expensive
than serialize** — worth knowing before optimising the wrong half.

Budget for Phase 2: no tier may regress the median by more than 3x at any size.
Deliberately **not** wired into `check:all` — wall-clock assertions under v8
coverage instrumentation are flaky, and a gate that fails randomly gets
disabled, which is how gates die in this repo. Run before and after each tier:
`pnpm exec vitest bench src/bench/pipelinePerf.bench.ts`.

### Unresolved sub-dependency — the command registry fork

`src/services/commands/` has 49 `registerCommand()` sites; `src/plugins/actions/types.ts`
has 83 `ActionId`s; **there is no bridge**, and the editing surface (bold, tables,
headings, undo) lives entirely in the second — the Command Palette cannot find
"bold". Until this is resolved, `Contribution` **must not** include commands.
Resolving it is a prerequisite for any "extensions declare commands" capability
and is not scoped here.

## Phase 2 — Serialization inversion (ADR-015 D2)

The core work. Difficulty ranking is from the internal feasibility audit; order
follows it strictly so that the mechanical tiers de-risk the design-heavy ones.

**Two registries, not one.** Per ADR-015 D2 each extension contributes a
markdown-layer half (`micromark`/`fromMarkdown`/`toMarkdown` — engine-independent,
Node-safe, staying where the remark plugins live today) and an editor-adapter
half (`toPm`/`fromPm` — ProseMirror-coupled). Do **not** collapse them onto a
Tiptap node spec: that would re-couple markdown to the editor, undoing the
framework-independence ADR-003 recorded as a benefit of leaving Milkdown, and
would break the `nodeSafe.ts` invariant that `vmark-content-server` depends on
(no `@/` aliases, no DOM globals, no ProseMirror imports; guarded by a Node
smoke test).

Practical consequence for every WI below: each node's inversion is **two commits
or one commit touching two registries** — never a single blob. The
`vmark-content-server` Node smoke test is part of each WI's DoD, not just the
phase DoD.

**Precondition:** WI-2.0 — resolve node-ownership gaps. `text`, `hardBreak`,
`strike`, and `code` are StarterKit-owned with no VMark plugin to hang a
converter on; the `link` mark is configured inline in `tiptapExtensions.ts:142`
with no `src/plugins/link/`; `tableCell`/`tableHeader` live outside the plugin
tree in `components/Editor/alignedTableNodes.ts`; `paragraph`/`heading`/
`blockquote`/lists/`horizontalRule` are owned by the shared wrapper
`plugins/shared/sourceLineNodes.ts`.

| WI | Tier | Scope |
|---|---|---|
| WI-2.1 | 1 — mechanical | 🟡 **9 of 12 migrated** — `horizontalRule`, `frontmatter`, `link_definition`, `html_block`, `toc`, `hardBreak`, `image`, `math_inline`, `footnote_reference` are in `pmConverters.registry.ts`, each proven byte-identical to its switch arm. **Excluded:** `codeBlock` (ambiguous via the `MATH_BLOCK_LANGUAGE` sentinel — needs claim wiring, so it is not Tier 1 in practice), and `html_inline`/`text`, which are reached through the inline if-chain rather than the switch and move with Tier 2 |
| WI-2.2 | 2 — marks | 9 marks. `bold`/`italic`/`strike`/`sub`/`super`/`highlight`/`underline` are 13-line clones; `link` adds `isSafeUrl` + nested-link replacement; `code` is the leaf, not a wrapper. **`groupInlineItems` mark-run factoring stays central** — it optimizes across all marks at once and cannot decompose |
| WI-2.3 | 3 — local logic | `heading` (needs document-scoped `usedSlugs`), `paragraph` (minus media promotion), `blockquote`, lists (`bulletList`/`orderedList`/`listItem` invert together — spread heuristics couple parent and child), `footnote_definition` (currently an un-extracted private method) |
| WI-2.4 | 4 — containers | `table` (whole-table: alignment lives on row-0 cells; cells cannot own serialization — assign the arm to one owner), `detailsBlock` (**unify** `src/plugins/detailsBlock/` with `markdownPipeline/plugins/detailsBlock.ts`, crossing the `nodeSafe.ts` Node boundary), `wikiLink` (4-place coupling + a lazy-load trigger that must move with it) |
| WI-2.5 | 5 — design first | See below. **No code until the claim protocol is designed.** |

### WI-2.5 — the four that need design

1. **`alertBlock`** — asymmetric by construction. Parse sniffs `[!TYPE]` out of a
   `blockquote`; serialize re-synthesizes a blockquote with a marker paragraph.
   There is no shared mdast node, so `convertBlockquote` must *ask* `alertBlock`
   whether it claims the node. Requires either a real `alert` mdast node
   end-to-end (the type exists at `types.ts:73`, unused in the editor path) or an
   explicit claim protocol. Also carries the only existing knowledge duplication
   — `ALERT_TYPES` in two files.
2. **Media** (`block_video`/`block_audio`/`block_image`) — the parse direction is
   *inference*, not parsing: a paragraph containing one image becomes any of
   three node types by file extension; an `html` node becomes any of three by
   tag. Three extensions compete to claim two mdast types in both directions,
   with priority implicit in `if` order. Zero corpus coverage today (Phase 0
   fixes that first).
3. **`video_embed`** — same claiming problem on `html`, plus an outbound videoId
   allowlist that must not weaken in the move.
4. **The residual `html` arm** — whatever media and embeds do not claim falls
   through. Combined with `mergeInlineHtmlTags` (a document-level pre-pass over
   sibling arrays), this arm cannot become a pure per-node function under any design.

**The claim protocol is now WI-1.3, not a Phase 2 deliverable.** Overlap is not
confined to these four: `codeBlock` is ambiguous via the `MATH_BLOCK_LANGUAGE`
sentinel (`pmBlockConverters.ts:80`), and `paragraph`/`html` each fan out to four
or five outcomes (`mdastMediaConverters.ts:38,72`). Migrating them "mechanically"
first would bake in an accidental protocol.

### Migration method — differential, not big-bang

Add registries **alongside** the switches; migrate by semantic family; run old and
new serializers in **differential mode** over the corpus during migration; move
ambiguous families only after normalization exists; delete the switches last.

### Undo/redo compatibility (Codex MAJOR — was missing entirely)

Mode switches checkpoint serialized markdown and restore by reparsing
(`markdownSplitToggle.ts:17`), and hot-exit persists checkpoints across restarts.
A serializer behaviour change can make an old checkpoint parse differently from a
current document. Required tests per tier:

- undo/redo across WYSIWYG ↔ source ↔ split transitions
- restore a checkpoint produced *before* the migration
- extension enabled → edit custom node → extension disabled → undo/redo
- unknown contribution during restore preserves source text or fails visibly — **never deletes**
- pending debounced flush followed immediately by undo, mode switch, close, or crash recovery

### What stays central, by design

Roughly 700 of ~2,600 non-test pipeline lines are document-scoped and will not
decompose: `groupInlineItems`/`factorableMarks`, `mergeInlineHtmlTags`, the
verified cosmetic unescape pass (requires a full document re-parse),
`blankLineCapture`, `parser/escapeMarkers.ts` and `parser/listNormalization.ts`
(whole-string pre/post passes), and heading-slug uniqueness. Stating this up
front so "everything is per-node" is not mistaken for the target.

**Good news:** VMark writes **zero** custom micromark tokenizers — every custom
syntax is a post-parse tree transform. There is no tokenizer layer to redistribute.

**DoD**
- `grep -cE "case \"" proseMirrorToMdast.ts` returns 0
- Serializer constructed by iterating the extension list, never hand-authored
- `strict: true`; a node without a converter throws in tests
- Corpus green throughout, including the Phase 0 additions
- `plugins/lint/lineMap.ts` (already a per-node serialization consumer) still passes — the most likely place for drift to surface
- `vmark-content-server`'s `nodeSafe.ts` boundary intact: no `@/` aliases, DOM globals, or ProseMirror imports leak into it

## Phase 3 — Registry becomes composition (ADR-015 D1)

| WI | Change |
|---|---|
| WI-3.1 | Define `VMarkExtension = { extension } \| readonly VMarkExtension[]`; implement `resolve()` with value-identity dedup |
| WI-3.2 | Convert the 78-entry `tiptapExtensions.ts` array into extension values, one entry at a time, replacing implicit array position with explicit `Prec` bucket or named `before`/`after` **plus a test per ordering-sensitive entry** |
| WI-3.3 | ✅ **DONE** — `registry.ts`, `registry.test.ts`, `manifests.ts` and all 77 `manifest.ts` stubs deleted (80 files). Verified dead first: `listPlugins`/`getPlugin`/`pluginsFor` had zero production callers, every `PluginManifest` import was type-only, and the single test reading a manifest only asserted the stub's own shape |
| WI-3.4 | ⏸️ **Deliberately open** — sorting is only safe after each order-sensitive entry carries an explicit `Prec` bucket or `before`/`after`. Both roots currently rely on the resolver's stable sort preserving declaration order, which is correct but means position is still load-bearing. Making constraints explicit is 126 independently testable steps (77 + 49) |
| WI-3.5 | ✅ **DONE** — `adoption.test.ts` asserts zero bypassing roots and ratchets down only, so a reintroduced hand-wired path fails CI |

Note: Tiptap already treats array order as a stable-sort tiebreaker, so WI-3.2 is
78 independent, individually verifiable steps — not a big-bang rewrite. Beware
that `ExtensionManager.plugins` reverses the array before priority-sorting while
`transformPastedHTML` does not; write a test per ordering-sensitive concern
rather than reasoning from array position.

**DoD**
- Contract test from WI-1.1 passes with the registry as the *only* composition path
- Composition array is alphabetical; no ordering test depends on position
- No `addFeature`-style side channel exists

## Phase 4A — Host normalization ✅ resolved

**Resolved by option 2 on 2026-07-23.** `FormatConfig` gained an optional
synchronous `language?: () => Extension`. Formats the app bundles regardless
(markdown, yaml) expose their pack there; everything else keeps the async
`loadLanguage` path. Hosts prefer `language` when present, so one host serves
every format and the common case does not pay for the general one.

`sourceEditorExtensions` no longer branches on `isYamlFileName` for language
selection — it asks the registry. It falls back to the markdown pack when the
registry is unavailable, because `dispatchEditor` throws if nothing is
registered: a source editor with the wrong highlighting is recoverable, one that
throws on construction is not. (Unit tests that build extensions without
bootstrapping found this immediately.)

**Original analysis, kept for the record.** The two hosts do not merely differ in
structure — they differ in *timing*. `sourceEditorExtensions.ts` resolves its
language synchronously from statically imported packs
(`isYaml ? yaml() : markdown(...)`), while `SplitPaneEditor/sourcePaneExtensions.ts`
starts with **no language** and reconfigures a Compartment when an async
`loadLanguage()` promise resolves.

Moving the markdown source editor onto the registry-driven host therefore makes
its language load asynchronous, which risks a visible flash of unhighlighted
text **on the primary editing path, on every source-mode open**. ADR-001 makes
markdown the primary format; a regression there is not a fair trade for
structural symmetry.

Three options, and the choice is the maintainer's:

1. **Accept the async load.** Simplest, one host, but a possible flash on the
   most-used path. Needs measurement before acceptance.
2. **Sync fast-path.** The registry keeps async `loadLanguage` for the long tail
   but gains an optional synchronous pack for formats bundled anyway (markdown,
   yaml). One host, no flash, slightly richer `FormatConfig`.
3. **Leave both hosts.** Cheapest, and keeps markdown privileged — which is
   exactly what Phase 4B exists to end.

Swapping `isYamlFileName` for a `dispatchEditor` lookup was considered and
rejected as cosmetic: the branch stays two-format and hard-coded either way, so
it buys no real unification.

## Phase 4A — original scope

Proving markdown is ordinary requires one format-neutral host first. Today there
are two CodeMirror hosts: `sourceEditorExtensions.ts:25-28` hard-wires
`lang-markdown` plus an `isYamlFileName` branch, while
`SplitPaneEditor/sourcePaneExtensions.ts` already does registry-driven lazy
language loading correctly.

| WI | Change |
|---|---|
| WI-4A.1 | Reconcile the two CodeMirror hosts onto the registry-driven one |
| WI-4A.2 | Unify format dispatch; retire the second path |

**DoD:** one CodeMirror host; no format-specific branch in host code.

## Phase 4B — Markdown becomes an extension

Only now is this expressible. Markdown stops being privileged:

| WI | Change |
|---|---|
| WI-4.1 | 🟡 **partially done** — gained a synchronous `language` (WI-4A). Still cannot contribute a parser, serializer, commands or lint rules. Widen the `FormatConfig` adapter contract — it currently carries only views (`wysiwygComponent`, `genericPreview`, `validator`) and cannot contribute a parser, serializer, commands, keybindings, or lint rules. `menuPolicy`'s 4 booleans are *subtractive* opt-ins into built-in markdown menus |
| WI-4.2 | ✅ **DONE** — `"markdown-default"` → `"prompt-on-close"` across 30 sites. The value describes a behaviour, not a format; every adapter had to set a markdown-named constant, including `txt` and the read-only code viewers |
| WI-4.3 | ✅ **DONE** — `FormatConfig.lint` added; markdown and yaml contribute their own linters; `runLintForFormat` dispatches through the registry. Note the plan said route through `validator`, but the types differ (`ValidationDiagnostic[]` for the split-pane gutter vs `LintDiagnostic[]` for the lint panel) — a separate `lint` contribution is correct, not a workaround |
| WI-4.4 | 🟡 **outline done** — `FormatConfig.outline` added and `OutlineView` asks the format, so a YAML/JSON tab is no longer scanned for `#` headings. `FormatConfig.toPlainText` is declared and markdown supplies it, but the status-bar consumers (`incrementalTextMetrics`, `StatusBarCounts`) still call `stripMarkdown` directly — migrating them is the remaining half |
| WI-4.5 | Invert the failure-open default: `MARKDOWN_FALLBACK_ID`, `dispatchEditor(null)`, and `Editor.tsx:118`'s `?? MarkdownEditorSurface` all mean "no format" silently becomes markdown |
| WI-4.6 | ✅ **DONE (by WI-3.3)** — the closed `FormatId` union lived in `plugins/registry.ts`, which was deleted with the dead registry. One axis remains: `lib/formats/registry.ts` with open string ids, and `tabStore` already carries `formatId: string` |
| WI-4.7 | Retire the duplicated hosts: mermaid's staleness-token/error-UI/mount lifecycle is written **three** times (React, PM decoration, imperative DOM) over one shared engine; svg carries a second independent validator |

**DoD**
- A format adapter can contribute parser, serializer, commands, and lint rules
- No file outside a markdown extension imports `markdownPipeline`
- Default format is `txt`; markdown is selected, never assumed
- One CodeMirror host, one registry, one mermaid host

## Phase 5 — Extension points, then executable trust tiers

**Scope correction (Codex MAJOR).** The first draft promised "signed declarative
manifests" while listing signing infrastructure, SDK versioning, and compatibility
policy as out of scope — a contradiction. Tier A cannot be *signed* without key
ownership and rotation, revocation, package identity, update policy, compatibility
ranges, downgrade behaviour, tamper detection, and a local-development exception.

Phase 5 therefore delivers **first-party extension points** first; executable
third-party tiers are gated on a package/security contract that does not yet
exist and is not designed here.

| WI | Change |
|---|---|
| WI-5.1 | ✅ **DONE** — `plugins/codePreview/fenceRegistry.ts` is the host-owned point; `builtinFenceRenderers.ts` registers the six first-party renderers through the same API a third party would use. Dispatch, empty-state labels and copy-support all resolve through it; `grep -c 'mermaid\|graphviz\|markmap\|svg'` in `previewDecorations.ts` → **0**. A sli.dev renderer is now a registration, not a patch |
| WI-5.2 | Tier A declarative contributions (themes, snippets, keybindings) — **unsigned, first-party**; signing deferred to the package contract |
| WI-5.3 | Generalize the existing browser capability broker (`origin_guard`/`one_shot`/`operation`) from `(origin × operation)` to `(plugin-principal × capability-scope)` |
| WI-5.4 | Tier C: dynamic tool registration + prefix routing on the MCP bridge, replacing the 3 closed switches; arbitrate namespaces on the already-captured `ClientIdentity` |
| WI-5.5 | Tier B: worker/WASM host + the safe editor subset (decorations, fence renderers, declarative input rules) |
| WI-5.6 | Lifecycle-bound registration — `register*` implies teardown (Obsidian `Component` pattern), designed in before the ecosystem exists |

**DoD**
- A fence renderer registers without touching markdown's source
- No third-party path executes with document-window identity
- Broker mediates every capability; default-deny

## Cross-cutting requirements (Codex — were missing)

- **i18n.** Registry internals need no strings, but extension-resolution errors,
  disabled-extension notices, conflict dialogs, and unknown-node recovery are
  user-facing and must route through `t()`. IDs and machine diagnostics stay
  stable English-like tokens; rendered messages are translated.
- **Document migration is mostly the wrong framing.** Markdown is the persisted
  source, so a byte-preserving Phase 2 needs no file migration. The real
  compatibility risks are old hot-exit checkpoints, documents using syntax whose
  extension is not installed, changed canonical output after golden
  re-approval, and IDs renamed when manifests are deleted. Never auto-rewrite
  unopened files.
- **Rust scope stays bounded.** Redesigning all 157 Tauri commands is *not*
  required for first-party extension composition. Only Phase 0B hardening now;
  per-caller namespacing only where commands become plugin-callable.

## Out of scope

- Marketplace, signing infrastructure, SDK versioning policy, contract-freeze
  governance — named in the 2026-07-21 investigation, not designed here. Phase 5
  is scoped to first-party extension points precisely because of this gap
- **Resolving the command-registry fork** (49 `registerCommand` vs 83 `ActionId`,
  no bridge). Blocks `Contribution.commands`; needs its own plan
- **Building the ADR-007 shell slot seam** — `SlotDescriptor` has no host, no
  `PanelHost`/`OverlayHost`, and 15 hardcoded overlays. Blocks contributed panels
- Tier D third-party schema nodes — unlocked by Phase 2 but gated on Phase 5
- The 109 remaining file-size baseline entries
- H4 Phase 2/3 leftovers (6 exemptions) — see
  `dev-docs/plans/20260722-tier-boundary-restoration.md`

## Sequencing rationale

Phase 0 before everything because the safety net currently approves data loss.
Phase 1 before the big refactors so drift is detectable while they happen.
Phase 2 before Phase 3 because a registry composing nodes that cannot serialize
themselves buys nothing. Phase 3 before Phase 4 because markdown cannot become
"just an extension" until extensions are the composition mechanism. Phase 5 last
because third-party trust boundaries are meaningless until the internal seams are
real — and because the 2026-07-21 investigation established that the ecosystem
should route through the sidecar, not the editor, which none of Phases 0-4 block.

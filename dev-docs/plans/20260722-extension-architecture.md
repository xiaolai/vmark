# Extension Architecture — Phased Plan

**Status:** Phase 0A **COMPLETE** (2026-07-23) — harness now runs the production
schema projection; corpus 12 → 22 fixtures; 4 pre-existing round-trip defects
found. Phase 0B next. Codex review (RETHINK, 3 BLOCKER / 8 MAJOR) dispositioned
below.
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

| WI | Change |
|---|---|
| WI-0B.1 | Broker `pty::pty_spawn` (arbitrary exe + args + env + cwd, ungated) as deny-by-default one-shot |
| WI-0B.2 | Validate `ai_provider::run_ai_prompt`'s `cli_path` (`cli_path="/bin/sh"` → RCE) |
| WI-0B.3 | Confine `file_write::atomic_write_file` through `mcp_bridge_path_guard` (today rejects only `..`) |
| WI-0B.4 | Namespace the keychain per caller (`secure_store::get_secret` is a flat keyspace) |

**DoD:** each command deny-by-default with an explicit allow path; regression test per hole.

## Phase 1 — Architecture contract (BLOCKER-driven rewrite)

The first draft made this "make constraints fail" and deferred both the resolver
and the claim protocol. Codex showed that cannot work: WI-1.1's
`set(registry) === set(composed)` test compared a manifest registry against a
hand-built array, with no honest definition of equality, and the deferred claim
protocol would have been silently pre-decided by the "mechanical" tier of Phase 2.
Both move here.

| WI | Change |
|---|---|
| WI-1.1 | **Stable extension descriptor** (ADR-015 D1) — `id`, `version`, `requires`, `ordering`, `contributions`. Not value identity: composition builds values inline (`tiptapExtensions.ts:114,142`), so factory calls yield fresh objects |
| WI-1.2 | **Resolver** — flatten groups, reject duplicate IDs, validate `requires`/ordering references, topological sort with deterministic tie-breaks, report full cycle paths, detect duplicate Tiptap extension names after factories run |
| WI-1.3 | **Claim protocol + normalization** (ADR-015 D2b) — semantic mdast normalization, `exact`/`semantic`/`fallback` strengths, two winning-strength claims = error, diagnostics + dev trace API |
| WI-1.4 | **Node-safe entrypoint rule** — `feature/markdown.ts` / `feature/prosemirror.ts` / `feature/index.ts`; dep-cruiser **import-graph gate** so registry 1 can never transitively reach editor code. `nodeSafe.ts:16`'s invariant becomes a lint rule, not a comment |
| WI-1.5 | **Performance baseline** — benchmark serialization at 10 KB / 100 KB / 1 MB and set a p95 + allocation budget *before* any registry indirection lands |
| WI-1.6 | **Document-scoped inventory** — replace the withdrawn "~700 lines" premise with a reproducible file/range/category/line-count table, distinguishing genuinely document-scoped state from ordered tree transforms, whole-string preprocessing, and shared algorithms a contributed handler can still call |
| WI-1.7 | ✅ **DONE** — `plugin-isolation` promoted `warn` → `error`; residual violations frozen via dependency-cruiser's own `--ignore-known` mechanism (the `.dependency-cruiser-known-violations.json` file existed but `lint:deps` never passed the flag, so it was dead) |
| WI-1.8 | ✅ **DONE** — `scripts/check-extension-budget.mjs` + `scripts/extension-budget.json` wired into `check:all` as `lint:extension-budget`. Ratchets down only, mirroring the file-size gate |
| WI-1.9 | Correct `dev-docs/architecture.md`'s false "enforced via dep-cruiser" claim |

**Gates must be structural, not textual** (ADR-015 D6). ADR-012's grep gate
reports green while an 88-entry router dispatches through a variable event id
(`useUnifiedMenuCommands.ts:350`). Use dep-cruiser rules or call-site counts of
the sanctioned entry point.

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
| WI-2.1 | 1 — mechanical | 12 node types, ≤10 lines each, pure attribute↔field mapping: `horizontalRule`, `frontmatter`, `html_block`, `html_inline`, `toc`, `hardBreak`, `image`, `math_inline`, `link_definition`, `footnote_reference`, `text`, `codeBlock` (after factoring out the `MATH_BLOCK_LANGUAGE` sentinel duplicated across two files) |
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
| WI-3.3 | Delete `src/plugins/registry.ts` and all 77 manifests, or convert them to values (ADR-011 superseded) |
| WI-3.4 | Sort the composition array alphabetically once no test depends on its order |
| WI-3.5 | Remove every side channel; verify no path to composition bypasses `resolve()` |

Note: Tiptap already treats array order as a stable-sort tiebreaker, so WI-3.2 is
78 independent, individually verifiable steps — not a big-bang rewrite. Beware
that `ExtensionManager.plugins` reverses the array before priority-sorting while
`transformPastedHTML` does not; write a test per ordering-sensitive concern
rather than reasoning from array position.

**DoD**
- Contract test from WI-1.1 passes with the registry as the *only* composition path
- Composition array is alphabetical; no ordering test depends on position
- No `addFeature`-style side channel exists

## Phase 4A — Host normalization (prerequisite, was buried in Phase 4)

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
| WI-4.1 | Widen the `FormatConfig` adapter contract — it currently carries only views (`wysiwygComponent`, `genericPreview`, `validator`) and cannot contribute a parser, serializer, commands, keybindings, or lint rules. `menuPolicy`'s 4 booleans are *subtractive* opt-ins into built-in markdown menus |
| WI-4.2 | Rename `closeSavePolicy: "markdown-default"` — a markdown-named enum in the format-neutral contract that every adapter must set, including `txt` |
| WI-4.3 | Route lint through `FormatConfig.validator`; `stores/documentStore/lint.ts` currently hard-codes `lintMarkdown`/`lintYaml` and rule ids `M001`/`M002` |
| WI-4.4 | Make outline and word-count format-contributed. `outlineUtils.extractHeadings` (markdown ATX scanner, duplicated in `useSourceOutlineSync`) and `statusTextMetrics.stripMarkdown` (13 regexes) run for **every** format today |
| WI-4.5 | Invert the failure-open default: `MARKDOWN_FALLBACK_ID`, `dispatchEditor(null)`, and `Editor.tsx:118`'s `?? MarkdownEditorSurface` all mean "no format" silently becomes markdown |
| WI-4.6 | Unify the two extension axes — reconcile `plugins/registry.ts`'s closed `FormatId` union (6 ids, cannot name `txt`/`svg`/`mermaid`/`media`/`code-*`) with `lib/formats`' open registry |
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
| WI-5.1 | Markdown declares a keyed fence-language extension point (ADR-015 D3); mermaid/graphviz/markmap/svg/sli.dev register as **peers**. These need no pipeline work at all — they are `codeBlock` + language string |
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

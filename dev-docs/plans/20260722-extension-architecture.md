# Extension Architecture — Phased Plan

**Status:** Phase 0 — not started
**Branch:** `refactor/vmark-core`
**ADR:** `dev-docs/decisions/ADR-015-extension-model.md`
**Evidence:** `dev-docs/deep-researches/20260721-extension-architecture-investigation.md`,
`dev-docs/deep-researches/20260722-extension-architecture-prior-art.md`

Goal: minimal core, everything else an extension, third-party ecosystem
eventually. ADR-015 holds the decisions; this file holds the sequence.

## Guiding constraint

Phases are ordered so that **each one makes the next one safe**, not by how
visible the result is. Phase 0 exists because the safety net currently approves
data loss, and every later phase leans on it.

## Phase 0 — Repair the safety net (blocking)

The corpus characterization harness runs against `testSchema.ts`, not the
production schema. That schema omits `toc`, `block_video`, `block_audio`, and
`video_embed`; every mdast→PM converter returns `null` for an absent node type,
so those constructs are silently dropped and the goldens **encode the deletion as
correct**. A `[TOC]` line round-trips to nothing with the test green.

Until this is fixed, no serialization refactor can be trusted — arms 13/14/15/19
(PM→mdast) and 11 (mdast→PM) are unreachable by the harness.

| WI | Change |
|---|---|
| WI-0.1 | Run the characterization harness against the **production** schema (or extend `testSchema` to cover all node types), and re-approve goldens under review |
| WI-0.2 | Add corpus fixtures for every uncovered custom syntax: `[TOC]`, `<video>`/`<audio>`/`![x](y.mp4)`/`<source>` fallback, provider `<iframe>` embeds, `++underline++`, escaped markers `\== \++ \^ \~`, nested `<details>`, bare list markers, multi-block footnote definitions, alerts containing lists/code, table cells with hard breaks |
| WI-0.3 | Add fixtures for the non-default option paths: `preserveBlankLines`, `hardBreakStyle: "twoSpaces"`, `preserveLineBreaks` |
| WI-0.4 | Assert the harness fails when a node type is missing from the schema, rather than silently dropping it |

**DoD**
- Harness exercises all 24 PM→mdast and 31 mdast→PM arms; a coverage assertion names any arm with no fixture
- Deliberately deleting one switch arm turns the suite red (verified by experiment, not assumed)
- `pnpm check:all` green

## Phase 1 — Make constraints able to fail

ADR-015 D6. Nothing here changes behaviour; it makes drift detectable before the
large refactors begin.

| WI | Change |
|---|---|
| WI-1.1 | Contract test: `set(registryEntries) === set(composedExtensions)` — red on drift |
| WI-1.2 | Promote `plugin-isolation` from `warn` to `error`, freezing the current 201 violations in a ratcheting exemption budget (see `scripts/file-size-baseline.json` for the pattern) |
| WI-1.3 | Add `scripts/check-extension-budget.mjs` to `check:all` — the exemption count may only decrease |
| WI-1.4 | Correct `dev-docs/architecture.md`, which claims the services-tier rule is "enforced via dep-cruiser" |

**DoD**
- `pnpm check:all` fails if the registry and composition disagree
- `plugin-isolation` severity is `error`; budget script rejects any increase
- No architectural claim in docs is unbacked by a gate

## Phase 2 — Serialization inversion (ADR-015 D2)

The core work. Difficulty ranking is from the internal feasibility audit; order
follows it strictly so that the mechanical tiers de-risk the design-heavy ones.

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

**Deliverable before WI-2.5 code:** a written claim protocol — how competing
extensions bid for an mdast node, how ties resolve, and how the resolution is
tested. This is the one genuinely novel design in the plan.

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

## Phase 4 — Markdown becomes an extension

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
| WI-4.8 | Reconcile the two CodeMirror hosts — `sourceEditorExtensions.ts` hard-wires `lang-markdown` + an `isYamlFileName` branch, while `SplitPaneEditor/sourcePaneExtensions.ts` already does registry-driven lazy language loading correctly |

**DoD**
- A format adapter can contribute parser, serializer, commands, and lint rules
- No file outside a markdown extension imports `markdownPipeline`
- Default format is `txt`; markdown is selected, never assumed
- One CodeMirror host, one registry, one mermaid host

## Phase 5 — Extension points and trust tiers (third-party)

| WI | Change |
|---|---|
| WI-5.0 | **Security pre-req, do regardless:** broker `pty_spawn` and `run_ai_prompt`'s `cli_path` as deny-by-default one-shots; confine `atomic_write_file` through `mcp_bridge_path_guard`; namespace the keychain per caller |
| WI-5.1 | Markdown declares a keyed fence-language extension point (ADR-015 D3); mermaid/graphviz/markmap/svg/sli.dev register as **peers**. These need no pipeline work at all — they are `codeBlock` + language string |
| WI-5.2 | Tier A: signed declarative manifests (themes, snippets, keybindings) |
| WI-5.3 | Generalize the existing browser capability broker (`origin_guard`/`one_shot`/`operation`) from `(origin × operation)` to `(plugin-principal × capability-scope)` |
| WI-5.4 | Tier C: dynamic tool registration + prefix routing on the MCP bridge, replacing the 3 closed switches; arbitrate namespaces on the already-captured `ClientIdentity` |
| WI-5.5 | Tier B: worker/WASM host + the safe editor subset (decorations, fence renderers, declarative input rules) |
| WI-5.6 | Lifecycle-bound registration — `register*` implies teardown (Obsidian `Component` pattern), designed in before the ecosystem exists |

**DoD**
- A fence renderer registers without touching markdown's source
- No third-party path executes with document-window identity
- Broker mediates every capability; default-deny

## Out of scope

- Marketplace, signing infrastructure, SDK versioning policy, contract-freeze
  governance — named in the 2026-07-21 investigation, not designed here
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

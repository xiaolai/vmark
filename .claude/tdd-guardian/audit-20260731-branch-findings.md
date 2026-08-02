# Codex mini-audit — investigate/markdown-editor-gaps
Model `gpt-5.6-sol`, effort `high`, sandbox `read-only`, 5-dimension mini audit.
Six module batches over the 45 production source files changed vs `main`.
Run 2026-07-31 via `/cc-suite:audit-fix`.

**Severity-tagged findings across all batches: 69**

---

## Batch: ingest

`threadId: 019fb85f-d6ff-7e22-99f5-4e21b8daafc9` · `jobId: audit-ms8zeoiq-gqjpwp` · status `completed`

Found 6 issues: 5 High, 1 Low.

**[FIXED 2026-07-31 round 1 — snapshot policy is now edit; recovered work stays dirty]** - `src/utils/ingestOrigin.ts:74 | Logic & Correctness | High | "crash-recovery" is classified as a clean baseline, but the actual recovery path explicitly restores snapshots as dirty unsaved work. Once this policy is wired in, recovered edits could close without a save prompt. | Change the snapshot policy to "edit"; initialize the saved baseline separately and add a recovery integration test asserting isDirty remains true.`

- `src/utils/editorText.ts | No issues found | The canonicalization, leading-BOM handling, and pre-canonicalization metadata detection are internally consistent.`

**[FIXED 2026-07-31 — all three constructors converge on ingestExternalText, safe now that D1 re-emits]** - `src/stores/documentStore/documentState.ts:94 | Duplication | High | createInitialDocument, buildIngestState at line 182, and buildLoadState at line 231 independently implement external-text baseline construction. They have already drifted: only buildIngestState strips BOMs, sets hasBom, and derives metadata; the other paths leave a leading BOM inside editor content and retain stale/false hasBom metadata. | Create one shared baseline-ingest helper using ingestExternalText, then layer filePath and caller-supplied metadata overrides on its result.`

**[FIXED 2026-07-31 — saveToPath re-emits the BOM (D1 built); open-save round-trip keeps the mark]** - `src/stores/documentStore/documentState.ts:70 | Dead Code | High | hasBom is recorded and documented as enabling BOM re-emission, but no production save or hot-exit code reads or persists it. If ingestExternalContent is adopted, it strips the BOM and the next save permanently loses it. | Consume hasBom when constructing save output, persist/restore it in hot-exit state, and add an open-save-reopen BOM round-trip test.`

**[FIXED 2026-07-31 — dual-snapshot markSaved across all callers (WI-1.4); strict same-domain dirty compare]** - `src/stores/documentStore/documentState.ts:257 | Logic & Correctness | High | buildPostSaveState assigns raw disk-formatted content to savedContent, violating the documented LF-canonical/BOM-free contract. After saving CRLF output, the next no-op setContent compares LF editor text against CRLF savedContent and marks the document dirty again. Existing tests only check isDirty immediately after markSaved and miss the next edit. | Store canonicalized, BOM-free disk content in savedContent while retaining raw bytes only in lastDiskContent; test a no-op editor update after a CRLF save.`

**[FIXED 2026-07-31 — softContentEquals removed from the save path; final-newline TOCTOU edit stays dirty]** - `src/stores/documentStore/documentState.ts:259 | Logic & Correctness | High | softContentEquals ignores one trailing newline during the async-save TOCTOU check. The save pipeline shown does not add or remove trailing newlines, so a user adding or deleting the final newline while a save is in flight is incorrectly treated as clean, allowing that edit to be discarded. | Compare against the written content after only transformations the save actually performs—principally line-ending canonicalization and BOM removal—not general cloud-sync soft equality; add both final-newline race cases.`

**[FIXED 2026-07-31 round 1 — JSDoc moved to buildPostSaveState]** - `src/stores/documentStore/documentState.ts:135 | Dead Code | Low | The post-save JSDoc is orphaned above assertCanonicalEditorText after code was moved, so it documents the wrong location and leaves buildPostSaveState undocumented at its declaration. | Move the comment directly above buildPostSaveState at line 251.`

**[FIXED 2026-07-31 — six production setContent callers migrated (canonicalising at untrusted inputs); deprecated alias now delegates INTO the guard; externalWriterGate.test enforces both rules]** - `src/stores/documentStore/document.ts:63 | Shortcuts & Patches | High | The claimed two-door API is not enforced. Deprecated setContent remains public and bypasses canonicalization at lines 197–205; production MCP, selection, history, and hot-exit paths still call it. Conversely, ingestExternalContent at line 183 has no production caller, so its origin policies and BOM handling are currently dormant. | Classify and migrate every caller to setEditorContent or ingestExternalContent, then make setContent private or remove it. Add integration tests through real disk-open, MCP-write, crash-recovery, and hot-exit entry points.`

Targeted Vitest execution could not start because the read-only environment prevented Vite from creating `node_modules/.vite-temp/vitest.config.*.mjs`; findings are based on direct source, call-site, and test inspection.

---

## Batch: shared

`threadId: 019fb865-0ae5-7613-ab0b-84556d675c66` · `jobId: audit-ms8zlzlu-6ptbnl` · status `completed`

Findings, ordered by severity:

**[FIXED 2026-07-31 — indented code kept literal; CommonMark whitespace only (NBSP is content)]** - src/plugins/shared/lineContent.ts:74 | Logic & Correctness | High | `^\s*` treats four-space indentation and Unicode whitespace as structural indentation, after which lines 79–85 strip list/heading markers. Confirmed examples: `"    # literal"`, `"    - literal"`, and `"\u00a0- literal"` all lose literal markup, despite parsing as indented code/plain text. This destructive conversion path is untested. | Determine block context from the syntax tree/CommonMark parser, or conservatively preserve markers when indentation is not valid structural Markdown indentation; add regression tests.

**[FIXED 2026-07-31 — fence indent is 0-3 SPACES; a tab is indented code]** - src/plugins/shared/lineContent.ts:131 | Logic & Correctness | High | `[ \t]{0,3}` accepts a leading tab as legal fence indentation. CommonMark expands that tab to four columns, making it indented code rather than a fence. The scanner nevertheless classifies `["\\t```", "x", "\\t```"]` as a closed fence, allowing toggle/unfence operations to delete literal lines. | Enforce column-aware indentation with a maximum of three spaces; add tab-indented opener/closer tests.

**[FIXED 2026-07-31 — list-item (and quoted-list) fence openers recognised]** - src/plugins/shared/lineContent.ts:128 | Logic & Correctness | High | The fence parser only understands blockquote prefixes, not list containers. A valid list-item fence such as `- ``` /  x /  ```` is missed at its opener, while the indented closer is misclassified as a new unclosed opener. Fence-protected transformations can consequently rewrite code or misclassify the remainder of the document. | Use the CodeMirror syntax tree or a shared container-aware CommonMark scanner; test bullet, ordered, nested-list, and quoted-list fences.

**[PARTIAL 2026-07-31; drift gate added 2026-08-01 — multiSelectionContext now uses the shared scanner; codeFenceDetection's delimiter grammar aligned, and fenceGrammarAgreement.test.ts ENFORCES the agreement while pinning both sides of every deliberate divergence (opener inclusion, deep indent, container prefixes). The remaining traversal consolidation is a concrete adapter task in design-20260731-source-structure-service.md]** - src/plugins/shared/lineContent.ts:176 | Duplication | High | The comment acknowledges three independent fence parsers. Inspection confirms they implement materially different grammars in `lineContent.ts`, `codeFenceDetection.ts`, and `multiSelectionContext.ts`, including different tilde, indentation, info-string, and unclosed-fence behavior. This is a safety-critical DRY violation. | Consolidate parsing and range resolution into one shared implementation with adapters for language/position metadata.

**[FIXED 2026-07-31 — endpoints resolve independently; blank endpoints stay put]** - src/plugins/shared/blockSpan.ts:64 | Logic & Correctness | High | Blank endpoints are treated as boundaries only for collapsed selections. For `["a", "", "b"]`, a selection from the blank line through `"b"` expands backward and includes untouched `"a"`; an end on the blank similarly expands into `"b"`. | Resolve each endpoint independently: blank endpoints remain on the blank line, while nonblank endpoints expand only within their own block. Add both start-blank and end-blank tests.

**[FIXED 2026-07-31 — mixed fence/paragraph selections widen BOTH endpoints]** - src/plugins/shared/blockSpan.ts:80 | Logic & Correctness | High | When either endpoint is inside a fence, the function returns immediately after expanding only fenced endpoints. The non-fence endpoint is not widened to its whole paragraph, violating the module contract and allowing partial paragraph replacement. This mixed fence/paragraph path is untested. | Resolve both endpoints independently to fence, blank, or paragraph bounds before constructing the final span; test selections entering and leaving fences.

**[FIXED 2026-07-31 round 1 — commit 069e5ba6]** - src/plugins/shared/wrapBlocks.ts:36 | Logic & Correctness | High | `$to.after(1)` ignores that ProseMirror’s `to` is exclusive. When a selection ends at the start of the next paragraph, that untouched paragraph is included in the wrapper — the same off-by-one already corrected in `selectionBlockSpan`. | When `$to.parentOffset === 0`, resolve the end block from `$to.pos - 1`; add a two-paragraph boundary regression test.

**[FIXED 2026-07-31 — isDelimiterLine(ranges, i) replaces it; the three inlined predicates now share it]** - src/plugins/shared/lineContent.ts:163 | Dead Code | Low | `isFenceDelimiter` has no production caller; only its own test uses it. Production code repeats the delimiter predicate three times instead. | Remove the export, or expose a helper accepting precomputed ranges and replace the duplicated predicates.

**[FIXED 2026-07-31 — per-line fence membership precomputed (Int32Array)]** - src/plugins/shared/blockSpan.ts:72 | Refactoring Debt | Medium | `fenceOf` performs a linear `find` for every line visited by both expansion loops. A long paragraph following many fences becomes quadratic and can stall editor actions on large documents. | Index fence membership once, or use the sorted ranges with a cursor/binary search.

**[FIXED 2026-07-31 — AllSelection/top-level NodeSelection wrap their exact bounds]** - src/plugins/shared/wrapBlocks.ts:35 | Shortcuts & Patches | Medium | AllSelection and top-level NodeSelection are deliberately rejected solely because their endpoints have depth zero. Callers then append an empty block, ignoring a non-empty whole-document or node selection and contradicting the stated “whole top-level blocks touched” rule. Existing tests encode only the no-throw fallback. | Handle AllSelection and top-level NodeSelection using their exact `from`/`to` boundaries, with behavioral tests asserting selected content is wrapped.

src/plugins/shared/blockTemplates.ts — No issues found.

Targeted Vitest execution was blocked because the read-only workspace prevented Vite from creating `node_modules/.vite-temp`; direct ProseMirror, Remark, and function probes confirmed the cited boundary behaviors.

---

## Batch: source-actions

`threadId: 019fb86c-1b10-7d93-a456-312203836865` · `jobId: audit-ms8zvws2-9xsarf` · status `completed`

Found 15 issues: 12 High, 2 Medium, and 1 Low. No async defects, unused imports, TODOs, or unreachable branches were found.

### sourceBlockMove.ts

**[FIXED 2026-07-31]** `src/plugins/toolbarActions/sourceBlockMove.ts:91-96 | Logic & Correctness | High | Moving a selected blank line takes the ordinary-swap path. For ["a", "", "b"], moving the blank up produces ["", "a", "b"], merging two paragraphs — exactly the structural damage this module claims to prevent. This critical path is untested. | Detect blank selections before the adjacent-line branch and either refuse the move or define a block-level operation; add up/down regression tests.`

**[FIXED 2026-07-31 — list items move as full spans, continuations and children included]** `src/plugins/toolbarActions/sourceBlockMove.ts:89-96 | Logic & Correctness | High | A list marker is moved independently from its continuation lines or nested children. Moving "- parent" down in ["- parent", "  continuation", "- next"] leaves the continuation before its owner and corrupts the list. crossesListDepth does not help because the continuation is not recognized as a list item. This critical path is untested. | Resolve complete Markdown list-item spans, including continuations and descendants, before moving; test multiline and nested items in both directions.`

**[FIXED 2026-07-31 — quote-peeling structural classifier]** `src/plugins/toolbarActions/sourceBlockMove.ts:173-182 | Logic & Correctness | High | joinWouldFuseBlocks recognizes only raw list markers. Quoted list items such as "> - one" and "> - two" are not detected, so joining produces malformed "> - one > - two". Headings and other distinct structural blocks are likewise allowed to fuse. | Strip container prefixes and use a shared structural-line classifier rather than listIndent alone; add quoted-list, heading, thematic-break, and table tests.`

**[FIXED 2026-07-31 — same classifier: breaks, indented code, HTML, math]** `src/plugins/toolbarActions/sourceBlockMove.ts:194-207 | Logic & Correctness | High | duplicateNeedsHardBreak treats several structural lines as paragraphs. Duplicating "---" appends a backslash to the first copy, turning a thematic break into "---\\"; indented code and HTML block lines are similarly corrupted. The critical structural classifications are untested. | Base this decision on the Markdown syntax tree or a shared block classifier covering thematic breaks, indented code, HTML, alerts, and other block constructs.`

**[FIXED 2026-07-31 — fenceRanges computed once, threaded through]** `src/plugins/toolbarActions/sourceBlockMove.ts:126-154 | Duplication | High | Fence ranges and delimiter predicates are recomputed in spanTouchesFence and crossesFenceBoundary. The blank-line path scans the entire document three times and maintains two copies of delimiter logic that can drift. | Compute fenceRanges once in moveBlockAware and pass the parsed ranges or a delimiter Set to both checks.`

### sourceBlockPlacement.ts

**[FIXED 2026-07-31 — cursor offset mapped through the indent prefix]** `src/plugins/toolbarActions/sourceBlockPlacement.ts:58-80 | Logic & Correctness | Medium | cursorOffset is relative to the unindented template, but indentBlock inserts a prefix on every line. Tables, alerts, details, math, and diagram blocks inserted inside lists or blockquotes therefore place the caret too early, sometimes inside markup rather than the intended cell/body. | Translate the raw offset through the prefix transformation, or have indentBlock return both transformed text and mapped cursor offset; test nested table and multiline-builder insertion.`

**[FIXED 2026-07-31 — range required, fallback deleted]** `src/plugins/toolbarActions/sourceBlockPlacement.ts:129-136 | Dead Code | Low | range is optional, but the only caller always supplies an explicit range. The fallback selection-to-line expansion is currently orphaned and untested. | Make range required and remove the fallback, or add an actual caller and focused tests if the optional API is intentional.`

### sourceInsertActions.ts

**[FIXED 2026-07-31 — common enclosing quote depth; remaining depth preserved as content]** `src/plugins/toolbarActions/sourceInsertActions.ts:98-100 | Logic & Correctness | High | Code-block conversion keeps only parts[0].quote and ignores every later p.quote. Mixed or nested quote depths are silently normalized; converting "> outer\\n> > inner" loses the inner quote level. This is an untested data-loss path. | Determine the common enclosing quote prefix and preserve each line's remaining quote depth as content, preferably using the parsed Markdown structure; add mixed-depth tests.`

### sourceTextTransforms.ts

**[FIXED 2026-07-31 — selectedLineRange helper, exclusive-to everywhere]** `src/plugins/toolbarActions/sourceTextTransforms.ts:43-46,105-109,146-148 | Logic & Correctness | High | Non-empty selection ends are treated as inclusive via lineAt(to), although CodeMirror's to is exclusive. A selection ending at the next line's start moves that untouched line, classifies the wrong line for duplicate hard-break insertion, and can make the join guard reject a valid operation. touchesFenceDelimiter already implements the correct to - 1 rule, showing the inconsistency. | Centralize selected-line resolution using to > from ? to - 1 : to and reuse it in move, duplicate, join, and fence checks; add exact-line-start boundary tests.`

**[FIXED 2026-07-31 — moveBlockAware now returns the landing line]** `src/plugins/toolbarActions/sourceTextTransforms.ts:54-55 | Logic & Correctness | Medium | The post-move selection uses newText.indexOf(movedText). When identical text occurs earlier, the selection jumps to the first copy rather than the block that was moved. | Calculate the destination from source and neighboring span lengths, or return the destination span from moveBlockAware; test repeated identical lines and blocks.`

**[FIXED 2026-07-31 — touchesFenceDelimiter guard; content-only fence sort still allowed]** `src/plugins/toolbarActions/sourceTextTransforms.ts:160-185 | Logic & Correctness | High | Sorting has no fence-delimiter guard even though sortLinesAsc/Desc are explicitly allowed inside code blocks. Selecting an opener or closer can reorder delimiters with content and destroy the fence. Existing fence-action tests cover only duplicate and delete. | Refuse sorting selections touching delimiters while allowing fence-content-only sorting; add opener, closer, whole-fence, and unclosed-fence tests.`

**[FIXED 2026-07-31 — handleSortLines(view, sorter)]** `src/plugins/toolbarActions/sourceTextTransforms.ts:160-185 | Duplication | High | The ascending and descending handlers are copy-paste implementations differing only in the transformation function. | Introduce handleSortLines(view, sorter) or a direction parameter and keep the two exports as one-line wrappers.`

**[FIXED 2026-07-31 — applySelectedTextTransform extracted]** `src/plugins/toolbarActions/sourceTextTransforms.ts:188-234 | Duplication | High | handleRemoveBlankLines and handleTransformCase duplicate selection validation, slicing, unchanged-result handling, dispatch, selection restoration, and focus logic. | Extract a shared applySelectedTextTransform(view, transform) helper.`

### sourceBlockActions.ts

**[FIXED 2026-07-31 — discriminated result; per-cursor semantics; shared-block dedupe; final-document tests]** `src/plugins/toolbarActions/sourceBlockActions.ts:97-99 | Logic & Correctness | High | The boolean returned by applyMultiSelectionListAction conflates “not in multi-selection,” “nothing applied,” and “handled.” With multiple cursors on plain paragraphs it returns false and handleListAction edits only the primary cursor; with multiple cursors on existing bullet items it returns true after no-op conversions, bypassing toggle-off behavior. Multiple cursors in the same structural block can also process that block repeatedly. Current integration tests assert only that the result is a boolean. | Use an explicit tri-state result, apply the same toggle/create semantics to every cursor, deduplicate shared structural blocks, and assert final documents in integration tests.`

**[FIXED 2026-07-31 — LIST_TARGETS map; toggle/convert split from indent/outdent]** `src/plugins/toolbarActions/sourceBlockActions.ts:96-147 | Duplication | High | handleListAction has high cyclomatic complexity and repeats nearly identical bullet/ordered/task branches in both the existing-list and creation switches. This makes semantic drift between list types likely. | Map actions to target type and marker, then separate list-type toggling/conversion from indent/outdent/removal in smaller helpers.`

---

## Batch: wysiwyg-actions

`threadId: 019fb874-a159-7e00-befa-0ae2dfa4b2e0` · `jobId: audit-ms907vut-br643u` · status `completed`

Found 10 issues: 6 High, 3 Medium, 1 Low.

### Findings

**[FIXED 2026-07-31 — line = range between hardBreak delimiters; move/delete/duplicate act per line; parity 1162 green]** - [src/plugins/toolbarActions/wysiwygLineUnit.ts:47](/Users/joker/github/xiaolai/myprojects/vmark/.claude/worktrees/vmark-md-gaps/src/plugins/toolbarActions/wysiwygLineUnit.ts:47) | Logic & Correctness | High | A textblock is assumed to equal one Markdown line. A paragraph containing `hardBreak` nodes represents multiple source lines, but move/delete/duplicate therefore operate on the entire paragraph. The parity fixtures do not cover pre-existing hard breaks. | Resolve a range delimited by adjacent hard breaks, not only a node depth, and add real-schema tests for every line operation on multi-line paragraphs.

**[FIXED 2026-07-31]** - [src/plugins/toolbarActions/wysiwygHeadingLevel.ts:54](/Users/joker/github/xiaolai/myprojects/vmark/.claude/worktrees/vmark-md-gaps/src/plugins/toolbarActions/wysiwygHeadingLevel.ts:54) | Logic & Correctness | Medium | Both heading functions ignore the boolean returned by `.run()` and report success even when ProseMirror rejects the conversion. Existing tests mock `run` without testing failure. | Return `.run()` directly for each attempted conversion and test `run() === false`.

**[FIXED 2026-07-31 — one direction-parameterized helper; orphaned lineOperationCommands DELETED with its 1037-line test, baseline entry removed]** - [src/plugins/toolbarActions/wysiwygAdapterBlockOps.ts:33](/Users/joker/github/xiaolai/myprojects/vmark/.claude/worktrees/vmark-md-gaps/src/plugins/toolbarActions/wysiwygAdapterBlockOps.ts:33) | Duplication | High | The move-up and move-down handlers are near-duplicates: identical validation, line resolution, sibling lookup, transaction setup, selection restoration, dispatch, and focus logic. Similar legacy implementations also remain in `editorPlugins/lineOperationCommands.ts`, whose exports are referenced only by its tests. | Introduce one direction-parameterized move helper and remove the orphaned legacy implementation/tests after confirming no runtime registration.

**[FIXED 2026-07-31 — collapseEmptyAncestors widening; success only when !tr.doc.eq; table-cell guard added]** - [src/plugins/toolbarActions/wysiwygAdapterBlockOps.ts:220](/Users/joker/github/xiaolai/myprojects/vmark/.claude/worktrees/vmark-md-gaps/src/plugins/toolbarActions/wysiwygAdapterBlockOps.ts:220) | Logic & Correctness | High | “Empty list items, etc.” are not actually removed. The code skips containers and deletes only their empty paragraph; a real ProseMirror list schema repairs that deletion back to an empty paragraph, so the transaction is a no-op while the handler reports success. Tests use transaction mocks and miss this critical path. | Resolve empty textblocks to removable semantic ancestors, avoid invalid intermediate content, check `tr.docChanged`, and test empty list items and blockquotes with a real schema.

**[FIXED 2026-07-31 — per-text-node transform in reverse doc order; marks, atoms, block boundaries survive]** - [src/plugins/toolbarActions/wysiwygAdapterFormatting.ts:137](/Users/joker/github/xiaolai/myprojects/vmark/.claude/worktrees/vmark-md-gaps/src/plugins/toolbarActions/wysiwygAdapterFormatting.ts:137) | Logic & Correctness | High | Case transformation concatenates every selected text node and replaces the entire selection with one text node. A multi-block selection loses block boundaries; mixed marks collapse to one mark set; inline atoms such as hard breaks or images are discarded. The tests exercise only one mocked text node. | Transform individual text-node ranges in reverse document order, preserve each node’s marks and structural boundaries, and add mixed-mark, multi-block, hard-break, and inline-atom tests.

**[FIXED 2026-07-31 — returns the helper's result]** - [src/plugins/toolbarActions/wysiwygAdapterFormatting.ts:72](/Users/joker/github/xiaolai/myprojects/vmark/.claude/worktrees/vmark-md-gaps/src/plugins/toolbarActions/wysiwygAdapterFormatting.ts:72) | Logic & Correctness | Medium | The active-blockquote branch discards `handleRemoveBlockquote`’s result and always returns `true`, violating that helper’s explicit “return whether changed” contract. | Return `handleRemoveBlockquote(editor.view)`.

**[FIXED 2026-07-31 — pure wysiwygTextPositionMap extracted, suppressions removed]** - [src/plugins/toolbarActions/wysiwygAdapterFormatting.ts:192](/Users/joker/github/xiaolai/myprojects/vmark/.claude/worktrees/vmark-md-gaps/src/plugins/toolbarActions/wysiwygAdapterFormatting.ts:192) | Refactoring Debt | Medium | `toggleQuoteStyleAtCursor` is 66 lines and combines text-position mapping, cursor coordinate conversion, settings lookup, replacement ordering, and dispatch. Several branches are coverage-suppressed rather than tested. | Extract pure `buildTextPositionMap` and `parentOffsetToTextOffset` helpers and test inline atoms explicitly.

**[FIXED 2026-07-31]** - [src/plugins/toolbarActions/wysiwygAdapterCjk.ts:60](/Users/joker/github/xiaolai/myprojects/vmark/.claude/worktrees/vmark-md-gaps/src/plugins/toolbarActions/wysiwygAdapterCjk.ts:60) | Dead Code | Low | The missing-editor/view guard is unreachable: this private function’s sole caller performs the identical guard at lines 42–43. The coverage suppression masks that redundancy. | Keep the guard in only one function.

**[FIXED 2026-07-31 — went further: metadata-only per WI-1.7; no transform to fail]** - [src/plugins/toolbarActions/wysiwygAdapterCjk.ts:147](/Users/joker/github/xiaolai/myprojects/vmark/.claude/worktrees/vmark-md-gaps/src/plugins/toolbarActions/wysiwygAdapterCjk.ts:147) | Logic & Correctness | High | `handleLineEndings` ignores failure from `applyFullDocumentTransform`, still updates line-ending metadata, and always returns `true`. Missing context or parse failure can therefore leave metadata claiming a conversion that never occurred. | Return immediately on transformation failure; update metadata only after success and return the actual result.

**[FIXED 2026-07-31]** - [src/plugins/toolbarActions/actionApplicability.ts:165](/Users/joker/github/xiaolai/myprojects/vmark/.claude/worktrees/vmark-md-gaps/src/plugins/toolbarActions/actionApplicability.ts:165) | Shortcuts & Patches | High | Both data-safety policy sets erase action IDs to `string`, and no integrity test validates their members. A typo or stale table-blocked ID silently fails open; a typo in the code-block allowlist silently disables an action. Current entries are valid, but this critical boundary has no compile-time or exhaustive runtime protection. | Build the sets from arrays satisfying `readonly AdapterAction[]`, handle generated heading IDs through a typed helper, and add integrity tests using `isAdapterAction`.

No files were changed.

---

## Batch: context-detection

`threadId: 019fb87c-d56b-7f21-8872-b250aeffb7d1` · `jobId: audit-ms90jeoh-11w5ef` · status `completed`

Static audit completed; no files changed. Markdown-conformance findings were checked against the [CommonMark specification](https://spec.commonmark.org/spec) and [GFM specification](https://github.github.com/gfm/).

### headingDetection.ts

**[FIXED 2026-07-31 — shared 0-3 space block prefix]** src/plugins/sourceContextDetection/headingDetection.ts:32 | Logic & Correctness | Medium | Whitespace parsing is inconsistent: `QUOTE_RE` accepts unlimited leading whitespace, while `HEADING_RE` accepts none. Valid headings indented 1–3 spaces are missed, while four-space-indented quoted code can be misclassified as a heading. | Parse a shared CommonMark block prefix capped at three spaces and reject deeper indentation.

**[FIXED 2026-07-31 — closing hash run stripped per CommonMark; escaped hashes kept]** src/plugins/sourceContextDetection/headingDetection.ts:63 | Logic & Correctness | Medium | `splitLine` removes only the opening ATX marker. Converting `## title ##` to a paragraph produces `title ##`, exposing closing heading syntax as text. | Parse an optional valid, unescaped closing hash sequence and remove it when converting to paragraph; add escaped-hash regression tests.

### listBlockConversion.ts

**[FIXED 2026-07-31 — parseListMarker handles ordered tasks; checkbox state preserved]** src/plugins/sourceContextDetection/listBlockConversion.ts:128 | Logic & Correctness | High | Checkbox preservation only recognizes bullet tasks. Ordered tasks such as `1. [x] done` are valid GFM, but conversion produces `- [ ] [x] done`, duplicating the checkbox and losing its state. This critical path is untested. | Use one marker parser supporting bullet and ordered task items, consume the checkbox from content, and preserve its state.

**[FIXED 2026-07-31 — base indent from marker lines only]** src/plugins/sourceContextDetection/listBlockConversion.ts:104 | Logic & Correctness | Medium | `innermostListRange` gives blank selected lines indentation zero. Selecting nested items separated by a blank line therefore sets `base` to zero and can widen conversion to the outer list. | Compute the base from selected list-marker lines only, or make blank lines inherit their enclosing list indentation.

### listDetection.ts

**[FIXED 2026-07-31 — container-aware continuation scanning (content-column stack)]** src/plugins/sourceContextDetection/listDetection.ts:252 | Logic & Correctness | High | List-bound scanning stops at every non-marker, nonblank line. Valid continuation paragraphs or child blocks therefore split one Markdown list into partial ranges, causing whole-list conversion to rewrite only part of the list. This critical path has no regression test. | Derive bounds from the Markdown syntax tree or implement container-aware continuation scanning based on marker width and indentation.

**[FIXED 2026-07-31 — delimiter changes split lists per CommonMark; the two codifying tests rewritten to spec]** src/plugins/sourceContextDetection/listDetection.ts:255 | Logic & Correctness | High | Bounds merge adjacent lists without comparing their delimiter. CommonMark explicitly starts a new list when bullet or ordered delimiters change, but `- one`, `* two`, and `1. three` are treated as one block; existing tests even codify this incorrect behavior. | Track delimiter and nesting context while scanning, allowing different delimiters only in nested child lists.

**[FIXED 2026-07-31 — spaced thematic breaks recognised]** src/plugins/sourceContextDetection/listDetection.ts:225 | Logic & Correctness | High | Thematic-break detection accepts only uninterrupted runs. Common forms such as `* * *` and `- - -` are classified as list items and can be destructively converted or removed. | Reuse the correct spaced thematic-break logic already present in `shared/lineContent.ts`.

**[FIXED 2026-07-31 — one typed parseListMarker consumed by every path]** src/plugins/sourceContextDetection/listDetection.ts:41 | Duplication | High | List parsing is duplicated across three near-identical detection branches and again in `LIST_LINE_PATTERN`; the copies have already drifted — ordered `)` markers and ordered tasks are unsupported in some paths. | Introduce one typed `parseListMarker` result consumed by item detection, block scanning, and conversion.

**[FIXED 2026-07-31 — one conversion helper + thin wrappers]** src/plugins/sourceContextDetection/listDetection.ts:139 | Duplication | High | `toBulletList`, `toOrderedList`, and `toTaskList` are copy-pasted functions differing mainly in target marker. | Replace them with a shared single-line conversion helper and thin target wrappers.

**[FIXED 2026-07-31 — split into listMarkerParsing/listMutations/listBlockBounds; listDetection now 75 lines, baseline pruned]** src/plugins/sourceContextDetection/listDetection.ts:237 | Refactoring Debt | High | `getListBlockBounds` is 84 lines with mirrored upward/downward scans, nested lookahead loops, and high cyclomatic complexity. The file is also 337 lines, over the project limit. | Extract a bidirectional list-boundary scanner and move list mutations into a separate module.

### tableActions.ts

**[FIXED 2026-07-31 — insert lands after the separator for header/separator contexts, all 4 combinations tested]** src/plugins/sourceContextDetection/tableActions.ts:72 | Logic & Correctness | High | Structural rows are handled incorrectly: inserting below the header or above the separator places a data row between them, making the second line no longer the separator and invalidating table detection. Both actions are exposed by callers, and these paths are untested. | For either header or separator context, insert after the separator; add tests for all four above/below combinations.

**[FIXED 2026-07-31]** src/plugins/sourceContextDetection/tableActions.ts:54 | Logic & Correctness | Medium | `buildEmptyCells` measures raw cells including their existing wrapper spaces, then `newRow` adds another wrapper space on each side. For `| A   | B   |`, the generated empty row is wider than the source row. | Either emit the measured raw-width cells without another wrapper or measure only the inner formatted cell width.

**[FIXED 2026-07-31 — max row width preserved, no truncation]** src/plugins/sourceContextDetection/tableActions.ts:353 | Logic & Correctness | High | `formatTable` emits only `info.colCount` cells. Any body row containing extra cells is silently truncated, deleting user content. This data-loss path is untested. | Reject inconsistent tables or preserve all parsed cells by using the maximum row width; add an explicit extra-cell regression test.

**[FIXED 2026-07-31 — one insertColumn helper]** src/plugins/sourceContextDetection/tableActions.ts:122 | Duplication | High | `insertColumnRight` and `insertColumnLeft` are near-identical row-rewrite loops differing only in insertion index. | Extract a column insertion helper parameterized by side/index.

**[FIXED 2026-07-31 — rewriteSeparatorRow helper]** src/plugins/sourceContextDetection/tableActions.ts:258 | Duplication | High | `setColumnAlignment` and `setAllColumnsAlignment` duplicate separator lookup, parsing, rebuilding, dispatch, and focus logic. | Extract a separator-row rewrite helper receiving a cell transformation callback.

**[FIXED 2026-07-31 — separator width preserved]** src/plugins/sourceContextDetection/tableActions.ts:269 | Logic & Correctness | Medium | Setting alignment hardcodes separator width to five, shrinking previously formatted wide columns and leaving the table visually ragged. | Preserve the current separator or column display width when rebuilding the alignment cell.

**[FIXED 2026-07-31 — pure helpers in new tableFormat.ts; file 281 lines, baseline pruned]** src/plugins/sourceContextDetection/tableActions.ts:323 | Refactoring Debt | Medium | `formatTable` is 59 lines with multiple passes and nested loops, while the containing file is 381 lines — both exceed project guidance. | Extract alignment parsing, width calculation, and row rendering into pure, independently tested helpers.

**[FIXED 2026-07-31 — removed, no production consumer]** src/plugins/sourceContextDetection/tableActions.ts:247 | Dead Code | Low | `getColumnAlignment` has no production consumer anywhere under `src`; only its unit test imports it. | Remove it, or connect it to UI state if displaying current alignment is intended.

---

## Batch: pipeline

`threadId: 019fb884-94e2-73e1-86d9-bf1e19901530` · `jobId: audit-ms90uah9-ojoqn7` · status `completed`

Found 8 issues. One file is clean.

**[FIXED 2026-07-31 — CommonMark-aware scanner: 3-space cap, matching closer >= opener, indented code excluded]** src/utils/markdownPipeline/parser/remarkPlugins.ts:105 | Logic & Correctness | High | The ambiguity detector mishandles CommonMark code regions: indented code containing `    -` is treated as ambiguity, fences may have unlimited indentation, and a shorter closing fence is accepted. This creates both false positives and false negatives, potentially corrupting real setext headings on save. | Replace the regex stripping with a CommonMark-aware scanner/tokenizer enforcing ≤3-space indentation, matching fence characters, and closing length ≥ opening length; exclude indented code and add regression tests for these cases.

src/lib/formats/markdownLanguageSupport.ts | No issues found.

**[FIXED 2026-07-31 — success path no longer returns null; the input rule actually FIRES now (verified end-to-end with a real Editor)]** src/plugins/detailsBlock/tiptap.ts:178 | Logic & Correctness | High | The successful input-rule handler returns `null`. Tiptap v3 interprets `null` as cancellation and does not dispatch the accumulated transaction, so typing `<details>` or `:::details` never applies the rule. Existing tests incorrectly encode the `null` return. | Return `undefined` after successful commands; reserve `null` for failure. Add an editor-level test verifying the resulting document and caret.

**[FIXED 2026-07-31 — non-wrappable non-empty selections return false instead of inserting a blank]** src/plugins/detailsBlock/tiptap.ts:142 | Logic & Correctness | Medium | A non-empty selection that cannot be wrapped falls through to blank insertion. This includes `AllSelection` and top-level `NodeSelection`, contradicting lines 11–12, which state that every selection is wrapped and only empty selections insert blank blocks. | Distinguish empty from non-wrappable selections; support depth-0 wrapping or return `false` instead of silently inserting unrelated content.

**[FIXED 2026-07-31 — strategies split into listToggle.ts with discriminated results]** src/plugins/formatToolbar/nodeActions.tiptap.ts:108 | Refactoring Debt | High | `toggleListType` is a 52-line, high-cyclomatic-complexity dispatcher combining range conversion, task cleanup, lifting, type conversion, heading normalization, and wrapping. Boolean helper results also conflate “not applicable” with “attempted but failed.” | Split range and cursor strategies into focused helpers and use a tri-state result such as `applied/notApplicable/failed`.

**[FIXED 2026-07-31 — one transaction, one undo step; wrap failure leaves the heading intact]** src/plugins/formatToolbar/nodeActions.tiptap.ts:151 | Logic & Correctness | Medium | Heading-to-list conversion dispatches heading flattening first, then dispatches list wrapping separately. One toolbar action therefore creates two undo steps and can leave a flattened paragraph behind if wrapping fails. | Build both transformations on one transaction and dispatch only after wrapping succeeds.

**[FIXED 2026-07-31 — shared liftBlockquote primitive]** src/plugins/formatToolbar/nodeActions.tiptap.ts:250 | Duplication | High | `handleBlockquoteUnnest` and `removeOutermostBlockquote` duplicate the same range lookup, `liftTarget` guard, and lift dispatch, differing mainly in range direction and focusing. | Extract a shared `liftBlockquote(view, innermost)` primitive; keep focus policy in callers.

**[FIXED 2026-07-31 — parseTauriArgs handles global flags and every config form; never overrides a caller config]** scripts/tauri-wrapper.mjs:70 | Logic & Correctness | High | Argument detection assumes the subcommand is `args[0]` and config flags are standalone tokens. Valid forms such as `--verbose dev`, `--config=path`, `-c=path`, and `-cpath` bypass preflight or cause the development config to be appended after the caller’s config, overriding it. | Parse supported Tauri argument forms explicitly in a pure helper and test global flags plus attached config values.

**[FIXED 2026-07-31 — --target derives the sidecar triple from TARGET_MAP]** scripts/tauri-wrapper.mjs:75 | Logic & Correctness | Medium | Sidecar preflight always checks the host platform/architecture, ignoring Tauri’s `--target`/`-t` option. Cross-target builds can pass with the wrong sidecar or fail despite having the required target sidecar. | Derive required sidecar triples from the requested target, including attached-value forms and universal macOS builds.

**[FIXED 2026-07-31 — injectable runTauri runner, every branch tested]** scripts/tauri-wrapper.mjs:68 | Refactoring Debt | High | The critical `main` path — argument rewriting, preflight exit, spawning, child errors, and status propagation — is untested; tests cover only the two exported helpers. | Extract an injected, testable invocation runner and add tests for every exit and argument-rewriting branch.

No unused imports, orphaned functions, commented-out implementations, or other dead code were found.

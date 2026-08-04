# Audit Findings

**Run**: audit-fix 20260805-round1 | **Scope**: branch test/md-testing-adoption vs main (source files, 7 groups) | **Audit type**: mini
**Model**: gpt-5.6-sol | **Effort**: medium | **Audit threads**: 019fce5a-d2cc-7450-9589-e7e5709246d7, 019fce5f-5d0a-7dd0-9c6f-4ef226ec6fc4, 019fce63-5da0-75f3-a28e-326a6e49a509, 019fce68-4649-7392-92fd-72beb8bfc181, 019fce6c-afbb-7872-8edd-df0bb3bb5085, 019fce71-cee9-75c2-8b37-1c63d4536980, 019fce7a-363e-73c0-8fd9-a491a8657ac8
**Status values**: open | fixed | not-fixed | partial | regressed | skipped


## Group 1 (completed)

Found 10 code-quality issues. No reviewed file is clean.

src/utils/markdownPipeline/__tests__/spec/corpusRegistry.ts:255 | Logic & Correctness | High | Vendored JSON is blindly cast to `VendoredFileShape`. The digest proves byte identity, not schema correctness: missing or wrongly typed example fields, duplicate example numbers, invalid metadata, and unexpected structures are not validated. | Parse with a runtime schema and enforce nonempty strings, positive unique example numbers, expected metadata, and an `examples` array.

src/utils/markdownPipeline/__tests__/spec/corpusRegistry.ts:264 | Logic & Correctness | High | ID uniqueness is checked only among corpora enabled for the requested route. Duplicate prefixes or IDs across disjoint routes, or in route-less corpora such as Tiptap, remain undetected and make globally referenced ledger IDs ambiguous. | Validate corpus prefixes, files, and all generated IDs globally before route filtering.

src/utils/markdownPipeline/__tests__/spec/corpusRegistry.ts:55 | Duplication | High | Provenance is maintained both in `CORPORA` and inside each corpus JSON, but the JSON values declared at lines 220–224 are never compared. The copies have already drifted for `gfm-extensions.json`, `pulldown-cjk-emphasis.json`, and `tiptap-conversion.json`. | Keep provenance in one canonical location, or validate exact equality and move commentary such as “12 of 16 fixtures” into a separate notes field.

src/utils/markdownPipeline/__tests__/spec/corpusRegistry.ts:220 | Dead Code | Medium | `VendoredFileShape.source`, `revision`, and `license` are declared but never read. Their presence misleadingly suggests provenance validation that does not happen. | Validate these fields in `loadExamples`, or remove them from this interface and eliminate the duplicated JSON metadata.

src/utils/markdownPipeline/__tests__/spec/specLedgers.ts:83 | Logic & Correctness | High | Ledger JSON is blindly cast to generic types. In particular, invalid or missing verdicts are never inspected by matching, so a record with a misspelled verdict can still suppress a divergence and pass every test. This is an untested critical gate path. | Add runtime schema validation for every record, including exact verdict enums, required fields, value types, unknown-key rejection, and array presence.

src/utils/markdownPipeline/__tests__/spec/specLedgers.ts:31 | Logic & Correctness | Medium | `"__undefined__"` is an ambiguous sentinel. A genuine Markdown attribute containing that literal string is revived as `undefined`, making that value impossible to represent accurately in a ledger. | Use a tagged encoding such as `{ "$type": "undefined" }` with escaping or schema-discriminated value objects.

src/utils/markdownPipeline/__tests__/spec/specLedgers.ts:137 | Shortcuts & Patches | Low | “Reason stated” is reduced to the hardcoded threshold of 20 characters. Twenty punctuation characters or meaningless filler pass, while a concise valid explanation fails. | Validate nonempty normalized prose and, if a length policy is retained, name and document the constant; meaningfulness still requires review.

src/utils/markdownPipeline/__tests__/spec/specConformance.test.ts:71 | Logic & Correctness | High | The corpus-shape test asserts counts only for `cm`, `gfm`, and `vmark`. All later routed corpora are omitted, so changing or disabling an external corpus route can silently remove an entire critical test tier while this test remains green. | Compare the complete prefix-to-count map against an explicit expected map, including every routed corpus, and reject missing or unexpected prefixes.

src/utils/markdownPipeline/__tests__/spec/specConformance.test.ts:85 | Logic & Correctness | High | Ledger matching is existential in both directions (`some` here and at lines 101–106). Two identical declarations — even with conflicting verdicts or reasons — can match the same divergence and both be considered live. The same flaw exists for stability and fidelity at `specRoundtrip.test.ts:134`, `:150`, `:165`, and `:183`. | Enforce unique full signatures and perform a one-to-one reconciliation between divergences and ledger records.

src/utils/markdownPipeline/__tests__/spec/specConformance.test.ts:47 | Duplication | High | VMark and reference parsing helpers are duplicated almost exactly at `specRoundtrip.test.ts:58`. This creates two implementations of the same oracle setup that can drift independently. | Extract shared `vmarkMdastOf` and `referenceMdastOf` helpers into a local spec-test utility module.

src/utils/markdownPipeline/__tests__/spec/specRoundtrip.test.ts:148 | Duplication | High | Fidelity and independent-ruler gate/staleness logic is copy-pasted across lines 148–177 and 196–220, including matching, diagnostics, and stale-record traversal. Future changes can easily update only one leg. | Define a parameterized ledger-leg descriptor and run the same gate and staleness assertions for both divergence sources.

src/utils/markdownPipeline/__tests__/spec/specConformance.test.ts:52 | Refactoring Debt | Medium | A new stock Remark processor is constructed for every corpus example; the same repeated setup appears at `specRoundtrip.test.ts:63`. With over a thousand examples, this adds avoidable gate overhead. | Create one module-scoped frozen reference processor and reuse it for parsing.

No high-cyclomatic-complexity function was found, and there were no unused imports or unreachable branches.

The targeted Vitest run could not start because the read-only environment prevented Vite from writing its generated config under `node_modules/.vite-temp`; this is an environment limitation, not a test failure. Static inspection and direct ledger scans found no duplicate signatures or invalid verdicts in the current JSON, but the gates do not prevent either regression.

## Group 2 (completed)

Found 14 code-quality issues. No reviewed file is clean.

`src/utils/markdownPipeline/__tests__/spec/specTriage.dump.test.ts:37-126 | Duplication | High | The dump independently reimplements the conformance and round-trip measurement algorithms from specConformance.test.ts and specRoundtrip.test.ts, including duplicate parser helpers. Any future gate change can silently leave the ledger-authoring tool measuring different semantics. | Extract shared parser and measurement functions used by both gates and the dump.`

`src/utils/markdownPipeline/__tests__/spec/specTriage.dump.test.ts:37-126 | Shortcuts & Patches | High | This critical ledger generator is disabled during normal runs and contains no assertions or automated test of its output schema, completeness, crash handling, or filesystem behavior. A broken generator can produce authoritative-looking ledger input without any gate failing. | Move generation into a pure function, unit-test its complete result, and leave only the optional file-writing wrapper conditional on SPEC_TRIAGE_DUMP.`

`src/utils/markdownPipeline/__tests__/spec/specTriage.dump.test.ts:49-65 | Logic & Correctness | Medium | Conformance processing has no per-example error handling. One parser/projection failure aborts the entire run before writeFileSync, whereas round-trip failures are recorded in crashes; the promised dump of every observation is therefore not produced. | Capture conformance crashes with example ID and processing phase, then continue with the remaining corpus.`

`src/utils/markdownPipeline/__tests__/spec/specTriage.dump.test.ts:71-119 | Logic & Correctness | Medium | Results are pushed directly into global arrays before all processing for an example completes. If a later operation throws, earlier stability or fidelity records remain alongside a crash, yielding an ambiguous partial result for that example. | Compute all per-example records in local arrays and append atomically after success, or record phase-specific partial status explicitly.`

`src/utils/markdownPipeline/__tests__/spec/specTxtConverter.test.ts:31-83 | Logic & Correctness | High | The critical spec.txt trust boundary has no malformed-input tests. In particular, a missing lone-dot separator currently produces slices based on index -1, and an unterminated 32-backtick block is silently accepted. Both cases can vendor corrupt examples without failing. | Add tests requiring explicit errors for missing separators, missing closing fences, unexpected closing fences, and truncated input.`

`src/utils/markdownPipeline/__tests__/spec/specTxtConverter.test.ts:106-141 | Logic & Correctness | High | parseMarkdownItFixtures is tested only with complete triples. Missing middle/closing delimiters and truncated blocks are untested even though the implementation advances past EOF and can emit malformed fixtures. This is another untested critical ingestion path. | Add malformed and EOF cases and require the converter to reject incomplete triples with contextual errors.`

`src/utils/markdownPipeline/__tests__/spec/specTxtConverter.test.ts:143-151 | Logic & Correctness | Medium | The “strips to corpus shape” test supplies no extra input properties, so it does not prove stripping; wrapCorpus checks only source and example count, leaving revision, license, and exact output structure untested. | Include extra source fields and assert exact deep equality for both transformed examples and the complete wrapped corpus.`

`src/utils/markdownPipeline/__tests__/spec/specXss.test.ts:59-72 | Logic & Correctness | High | The security assertion uses isSafeUrl as its oracle even though production conversion uses that same function. If the allow-list accidentally broadens to accept vbscript:, file:, or another unsafe scheme, production and this test agree and the regression passes; the single JavaScript probe does not cover the rest. | Assert against an independent, fixed table of allowed schemes and expected rewrites for every dangerous corpus category.`

`src/utils/markdownPipeline/__tests__/spec/specXss.test.ts:69-72 | Logic & Correctness | High | Arbitrary data: URLs are accepted because isSafeUrl allows the entire scheme. Consequently the corpus’s data:text/html;base64 script payload satisfies this test unchanged despite the test claiming that no dangerous scheme survives. | Apply context-specific data-URI validation: reject data: for links and allow only explicitly approved image MIME types, then assert the malicious fixture becomes about:blank.`

`src/utils/markdownPipeline/__tests__/spec/specXss.test.ts:59-74 | Logic & Correctness | High | Each parameterized security case passes vacuously when collectUrls returns an empty array. A parser regression that drops or converts all links/images to text would make the whole corpus pass without exercising sanitization. | For fixtures expected to create URLs, assert the expected URL count and node kind before checking their sanitized values; separately classify intentionally non-link inputs.`

`src/utils/markdownPipeline/__tests__/spec/specXss.test.ts:48-56 | Shortcuts & Patches | Medium | Corpus validity is reduced to a raw regex count. It misses entity-obfuscated schemes and does not establish that any matched string becomes a live URL, so the exact count of nine is incidental rather than a meaningful security invariant. | Classify fixtures explicitly by attack vector and expected parsed/sanitized outcome instead of counting textual substrings.`

`src/utils/markdownPipeline/__tests__/spec/specTiptapOracle.test.ts:37-44 | Logic & Correctness | High | The oracle reads the corpus through corpusFileBytes rather than loadExamples or another digest-verifying loader. Because this corpus is routed to neither standard gate, its registry SHA-256 is never checked on this path; altered oracle data can become the new expected truth silently. | Add a typed loader that verifies entry.sha256 before returning the full expectedOutput records, and use it here.`

`src/utils/markdownPipeline/__tests__/spec/specTiptapOracle.test.ts:139-144 | Shortcuts & Patches | High | A declared fixture is accepted when any mismatch exists. An intended divergence can disappear while an unrelated regression takes its place, and the test still passes. This is a blanket suppression rather than the exact-signature discipline claimed in the file header. | Declare and compare exact mismatch signatures — path, mismatch kind, expected value, and actual value — and reject missing, additional, or changed mismatches.`

`src/utils/markdownPipeline/__tests__/spec/specTiptapOracle.test.ts:77-127 | Refactoring Debt | High | The untested recursive comparator has high cyclomatic complexity and combines node existence, types, text, attributes, marks, child counts, recursion, and diagnostic formatting. A comparator defect can invalidate the entire independent oracle. | Split it into focused type/text/attribute/mark/child comparators and add mutation-style unit tests proving each mismatch class is detected.`

`src/utils/markdownPipeline/__tests__/spec/specTiptapOracle.test.ts:90-108 | Logic & Correctness | Medium | Attribute equality uses JSON.stringify, making object-valued attributes depend on property insertion order and conflating serialization behavior with semantic equality. This can report false divergences for equivalent objects. | Use a real deep-equality comparison and stable diagnostic formatting.`

`src/utils/markdownPipeline/__tests__/spec/specTiptapOracle.test.ts:49-73 | Dead Code | Medium | DECLARED keys are never checked against the fixture set. A removed or renamed fixture leaves an unused declaration indefinitely, especially if another fixture keeps the pinned total at 12. | Assert that every declaration key matches exactly one fixture and that fixture section identifiers are unique.`

`src/utils/markdownPipeline/__tests__/spec/specTiptapOracle.test.ts:47 | Dead Code | Low | NAME_MAP is permanently empty while every comparison consults it, adding indirection for behavior that does not exist. | Remove it until a real mapping is required, or populate and test the documented schema-name differences.`

Static audit only; no files were changed.

## Group 3 (completed)

Found 12 issues. No reviewed file is clean.

src/utils/markdownPipeline/pmInlineConverters.ts:169 | Logic & Correctness | High | Edge-whitespace expulsion only examines direct text children and ignores nested marks and surrounding delimiter context. The expected-failure test demonstrates that nested bold-plus-strike content can serialize as literal `~~`, corrupting text and losing the strike mark. | Make delimiter emission context-aware and recursively inspect boundary text through nested phrasing nodes; add passing tests for nested marks on both boundaries and adjacent word/punctuation characters.

src/utils/markdownPipeline/pmInlineConverters.ts:217 | Refactoring Debt | High | `wrapWithMark` is a high-cyclomatic-complexity dispatcher with 13 branches, mixed whitespace policy, reference-link construction, logging, and legacy code conversion. The file is also 325 lines, exceeding the project’s approximately 300-line limit. | Split standard marks, dialect marks, and links into focused handlers or a typed handler registry; isolate boundary normalization into a dedicated module.

src/utils/markdownPipeline/pmInlineConverters.ts:227 | Dead Code | Low | The `"code"` wrapper branch is unreachable through the production grouping path: `textToInlineItems` creates the `inlineCode` leaf and `factorableMarks` always removes the code mark. Only direct unit tests exercise this branch. | Remove the branch and its direct tests, or redesign the public API so code marks have one documented conversion path.

src/utils/markdownPipeline/pmInlineConverters.ts:250 | Shortcuts & Patches | Medium | A `linkReference` node is forced through `unknown as Link`, suppressing type checking against the wrong MDAST node type. Future schema mistakes in `identifier`, `label`, or `referenceType` will compile unnoticed. | Import the MDAST `LinkReference` type and construct or validate the object as that type without the double assertion.

src/utils/markdownPipeline/parser/remarkPlugins.ts:31 | Shortcuts & Patches | High | The depth limiter is enabled in every parse mode and mutates arbitrary deep trees, but there is no direct test of it. Existing deep-tree coverage tests `remarkValidateMath`, not `remarkDepthLimit`; boundary behavior, ordering, and flattening are unverified critical paths. | Add direct tests at depths 199, 200, and 201, a very deep non-recursive case, sibling-order preservation, and mixed leaf-node behavior.

src/utils/markdownPipeline/parser/remarkPlugins.ts:39 | Logic & Correctness | Medium | Flattening replaces a subtree with a newly created, positionless text node. In `source-position` mode this violates the mode’s range-preservation purpose; `textOf` also silently drops visible non-`value` leaves such as breaks, image alt text, and references. | Preserve the replaced subtree’s encompassing position and define a loss-aware plaintext extractor for breaks, images, references, and other non-value phrasing nodes.

src/utils/markdownPipeline/dialectDescriptors.ts:160 | Logic & Correctness | Medium | `remarkMath` is disabled for `inline-summary` because block math is not representable, but the plugin also parses inline math. Consequently summary text cannot support `$x$` despite summaries explicitly supporting inline formatting. | Enable math and validation for inline summaries, and update the inline parser’s fast-path marker detection to include `$`; otherwise document inline math as intentionally unsupported with a correct rationale.

src/utils/markdownPipeline/dialectDescriptors.ts:188 | Logic & Correctness | High | The details-body dialect enables `remarkMath` but omits `remarkValidateMath`. Currency-like text such as `$100 and $200` is therefore protected in normal documents but can become malformed inline math inside `<details>`. The existing details math test checks only that a details node exists, not its children. | Enable `remarkValidateMath` in `details-body`, update the fallback processor, and assert that currency remains text while valid math remains `inlineMath`.

src/utils/markdownPipeline/plugins/detailsBodyParser.ts:60 | Duplication | High | The details-body processor manually duplicates plugin membership, order, and options from `DIALECT`. A drift test detects divergence only after duplication has occurred; production still has two independently maintained constructions. | Extract the details-body descriptor subset into a cycle-free shared module or inject a descriptor-driven factory without module-load side effects.

src/utils/markdownPipeline/__tests__/markEdgeWhitespace.test.ts:25 | Duplication | High | Mark discovery is copy-pasted three times at lines 40–44, 51–55, and 100–104. | Introduce a `hasMark(doc, markName)` helper and use it consistently.

src/utils/markdownPipeline/__tests__/markEdgeWhitespace.test.ts:58 | Shortcuts & Patches | High | The leading-whitespace test deliberately removes an optional leading space before asserting, so it passes whether serialization preserves or loses user content. This leaves the critical whitespace-fidelity path untested. | Assert exact text preservation. If Markdown requires an entity or escape at paragraph start, require the serializer to emit that representation.

src/utils/markdownPipeline/__tests__/markEdgeWhitespace.test.ts:62 | Shortcuts & Patches | High | `it.fails` converts a known data-corruption defect into a passing suite: valid ProseMirror content can reparse with literal `~~` and no strike mark. | Fix context-sensitive delimiter serialization and convert this to a normal passing regression test; do not ship it as an expected failure.

Targeted tests could not start because the read-only environment prevented Vite from creating `node_modules/.vite-temp/vitest.config…mjs`. Static inspection nevertheless confirms the expected-failure defect and the missing depth-limiter coverage.

## Group 4 (completed)

src/test/typingHarness.ts:89 | Logic & Correctness | High | Creating or destroying one session resets module-global backtick state used by every live editor. Overlapping sessions can corrupt each other, making concurrent tests and multi-editor behavior order-dependent. | Make backtick state editor/plugin-scoped; until then, explicitly prohibit concurrent sessions rather than resetting shared state during another session’s lifetime.

src/test/typingHarness.ts:223 | Logic & Correctness | High | `withTypingSession` accepts callbacks returning promises, but its synchronous `finally` destroys the editor immediately after the promise is returned — before asynchronous callback work finishes. | Add overloads and await promise-like results before teardown, or restrict the callback type to synchronous returns.

src/test/typingHarness.ts:193 | Logic & Correctness | High | Simulated Backspace/Delete is only surrogate-pair-aware, not grapheme-aware. Combining text and ZWJ emoji such as those generated by `editingFuzz.test.ts` are deleted piecemeal, unlike native browser editing, so the fuzz suite exercises unrealistic document states and misses real deletion behavior. | Segment adjacent text with `Intl.Segmenter` using grapheme granularity, or delegate these cases to real-WebKit tests.

src/test/typingHarness.test.ts:40 | Logic & Correctness | High | Critical deletion paths are untested: only a collapsed Backspace is covered. Delete, range deletion, block-boundary deletion, combining marks, ZWJ emoji, and inline atoms have no deterministic harness tests; the fuzz suite also does not guarantee Delete or selection coverage. | Add explicit tests for both directions, non-empty selections, grapheme clusters, block edges, and inline nodes.

src/test/typedInputMatrix.test.ts:48 | Dead Code | High | `backspaceReverts` is never populated by any matrix case, so the filtered `it.each` at line 219 runs zero cases. The advertised `undoInputRule` contract is therefore completely untested. | Populate the property for applicable block and mark rules, or remove the dead abstraction and add explicit reversal cases.

src/test/typedInputMatrix.test.ts:214 | Logic & Correctness | High | History restoration is checked only through serialized Markdown. Structurally different documents can serialize identically — especially empty paragraphs or other normalized nodes — allowing broken undo behavior to pass. | Capture the initial ProseMirror document and compare `doc.eq(initialDoc)` or normalized document JSON after undoing.

src/test/editingFuzz.test.ts:30 | Shortcuts & Patches | High | The generator deliberately excludes `[` because it exposes a known production escape-growth defect. This suppresses a common editing path and prevents the stateful fuzz test from finding interactions involving links and brackets. | Fix the defect and restore bracket generation; meanwhile, retain a focused failing regression/expected-failure test instead of removing the input class from fuzzing.

src/test/editingFuzz.test.ts:85 | Refactoring Debt | High | `applyOp` has high cyclomatic complexity: a large switch plus another four-way conditional for list operations. Adding operations or variants requires editing this central dispatcher and makes coverage accounting error-prone. | Split operations into typed handlers or a dispatch table, with list operations handled by a dedicated helper.

src/test/editingFuzz.test.ts:118 | Logic & Correctness | High | The fingerprint removes every empty textblock at every tree depth, not merely the documented trailing paragraph. An empty heading, list-item paragraph, blockquote paragraph, or other meaningful textblock can change type or disappear without failing the invariant. | Normalize only the precise known-lossy top-level trailing paragraph case; retain node type and position for all other empty textblocks.

src/test/editingFuzz.test.ts:121 | Logic & Correctness | High | The fingerprint silently trims line-edge whitespace, allowing serializer loss or reinterpretation of spaces as hard breaks to pass despite the claimed first-pass preservation invariant. | Model expected Markdown normalization explicitly and compare against that model, or generate representable whitespace separately from cases that assert intentional normalization.

src/test/editingFuzz.test.ts:169 | Logic & Correctness | High | Operations are recorded as “applied” merely because `applyOp` was called. Failed/no-op list commands, undo at depth zero, redo without history, and ineffective mark toggles still count, contradicting the stated applied-operation coverage guarantee. | Return an outcome from `applyOp`, compare document/selection/history state before and after, and record only effective operations.

src/test/editingFuzz.test.ts:201 | Logic & Correctness | High | Coverage assertions omit `delete`, `select`, `list`, and `redo`. They also aggregate all mark and list variants, so individual commands such as sink/lift or code toggling can remain entirely untested. | Require every operation and variant, or generate mandatory prefix operations before the random suffix and assert effective execution per variant.

src/test/typingHarness.ts:90 | Shortcuts & Patches | Medium | If Markdown parsing or `setContent` throws during session construction, the already-created editor is leaked and plugin state is not cleaned up. | Wrap initialization in `try/catch`, destroy the editor and reset state on failure, then rethrow.

src/test/typingHarness.test.ts:104 | Shortcuts & Patches | Medium | The manually created first session is not protected by `try/finally`; a failure in `type()` prevents `destroy()` and leaks editor/plugin state into subsequent tests. | Use `try/finally` or a teardown helper that guarantees cleanup.

src/test/typingHarness.ts:41 | Refactoring Debt | Low | Declaring `KEYS` as `Record<string, …>` widens `HarnessKey` to `string`, so TypeScript accepts arbitrary key names and the intended compile-time restriction is lost. | Define the object with `as const satisfies Record<string, KeySpec>` and derive `HarnessKey` from its literal keys.

src/test/typingHarness.test.ts:65 | Shortcuts & Patches | Low | The list test hardcodes ProseMirror position `3`, coupling it to the current parsed structure and making unrelated schema/parser changes produce opaque failures. | Locate the list-item text position through document traversal and resolve the cursor from that node.

src/test/editingFuzz.test.ts:156 | Shortcuts & Patches | Low | `FUZZ_RUNS` and `FUZZ_SEED` accept `NaN`, fractional, negative, or zero values without validation, leading to confusing failures or invalid test budgets. | Parse and validate finite integer ranges before invoking fast-check.

No reviewed file is clean.

Test execution could not start because the read-only environment prevented Vite from creating `node_modules/.vite-temp/vitest.config...mjs`; findings are based on direct static inspection.

## Group 5 (completed)

src/plugins/autoPair/backtickToggle.ts:25 | Logic & Correctness | High | Consecutive-backtick state and its timer are module-global. Inputs from two editor instances can corrupt each other: a first backtick in editor A followed by one at the same position in editor B is interpreted as editor B’s second backtick. Editor destruction also leaves the shared timer alive. | Store state per `EditorView` using a `WeakMap`, or move the state machine into per-editor ProseMirror plugin state; clear timers during view destruction.

src/plugins/autoPair/backtickToggle.ts:136 | Logic & Correctness | Medium | The state machine consumes the first two backticks before checking whether `codeBlock` exists. In a schema with a code mark but no code-block node, the third press returns `false`, producing one literal backtick after two swallowed inputs. | Validate `codeBlockType` before entering triple-backtick tracking, or implement a consistent fallback that restores/inserts all three literal backticks.

src/plugins/autoPair/utils.ts:53,91 | Duplication | High | Character-before extraction is duplicated in `isAfterWordChar()` and `shouldAutoPair()` even though `getCharBefore()` already exists in this module. The same logic is also repeated in `backtickToggle.ts`, creating several implementations that can drift on position and Unicode handling. | Centralize the operation in `getCharBefore()` and reuse it for word-character and escape checks.

src/plugins/autoPair/utils.ts:62 | Logic & Correctness | Medium | Smart-apostrophe detection recognizes only ASCII `\\w` plus selected CJK ranges. Letters in Arabic, Cyrillic, Greek, accented Latin, and many other scripts are treated as non-word characters, so typing a quote after them incorrectly inserts a quote pair. | Use Unicode property escapes such as `/[\\p{L}\\p{N}_]/u`, with tests for accented Latin, Cyrillic, Arabic, supplementary Han, and combining sequences.

src/plugins/cjkLetterSpacing/plugin.ts:74,102 | Duplication | High | Full-document and incremental scanning contain near-identical stateful-regex loops and decoration construction. Any future Unicode-range or matching correction must be made twice. | Extract one text-node scanning helper and reuse it from both traversal strategies.

src/plugins/cjkLetterSpacing/plugin.ts:172 | Logic & Correctness | High | `isEnabled` defaults to always true. The primary editor registers the extension unconfigured, so the default-off setting never disables scanning or decoration creation; the CSS variable merely makes those decorations visually inert. This contradicts the documented zero-cost disabled path and adds DOM decorations and rescanning to every editor by default. | Require the host predicate or configure the primary registration with a live settings-store predicate, then add an integration test proving the default-off editor has an empty decoration set.

src/plugins/cjkLetterSpacing/plugin.ts:63 | Logic & Correctness | Medium | The manually enumerated BMP ranges omit supplementary Han ideographs (Extensions B and later), Katakana Phonetic Extensions, halfwidth Katakana, and Hangul Jamo. Valid CJK text therefore receives inconsistent spacing. | Use tested Unicode script-property matching with the `u` flag, or maintain a comprehensive range table with supplementary-plane tests.

src/test/editorComposition.webkit.test.ts:105 | Logic & Correctness | High | The comment says update events have `isComposing: true`, but the constructed `InputEvent` omits that property, so it defaults to false. The suite therefore does not exercise handlers that gate on the input event’s composition flag and does not accurately simulate its declared IME event stream. | Pass `isComposing: true`, assert it on the dispatched event, and model the final commit event separately according to WebKit’s observed sequence.

src/test/editorComposition.webkit.test.ts:122 | Logic & Correctness | High | `cancel()` directly removes the marked node and fires `compositionend`; it never dispatches Escape. Consequently the test described as “Escape-cancel” does not cover the critical Escape keyboard path or interactions with composition-aware key handlers. | Dispatch a composing Escape `KeyboardEvent`, verify it is handled through the production stack, and then reproduce WebKit’s cancellation input/composition-end sequence.

src/test/editorComposition.webkit.test.ts:184 | Logic & Correctness | High | The mid-text regression test uses three independent `toContain` assertions. Duplicated, reordered, or otherwise corrupted surrounding text can satisfy all three, so this critical composition path remains inadequately tested. | Assert the exact result, `before中 after`, and its exact Markdown serialization.

src/test/editorComposition.webkit.test.ts:58 | Shortcuts & Patches | Medium | Every synchronization point uses an arbitrary 20 ms timeout. This makes the browser suite slower and susceptible to load-dependent flakes without proving that the relevant MutationObserver, microtask, or animation-frame work completed. | Replace fixed delays with a deterministic flush helper tied to the editor/DOM-observer lifecycle and animation frames, with a bounded timeout only as failure protection.

## Group 6 (completed)

scripts/baselineRatchetSpecLedgers.mjs:43 | Logic & Correctness | High | Conformance identities exclude `vmarkValue` and `referenceValue`; changing behavior and updating those values in the same commit leaves the identity unchanged, defeating the merge-base ratchet. The same defect affects roundtrip fidelity records at lines 63–73 and TS expected deltas at lines 91–97. | Include every enforcement-relevant expected value in a canonical identity or hash; exclude only explanatory prose such as `reason`.

scripts/baselineRatchetSpecLedgers.mjs:78 | Logic & Correctness | High | Corpus identities hash only `example` and `markdown`. Changes to `section`, `html`, and especially Tiptap’s consumed `expectedOutput` are invisible. A commit can rewrite the independent oracle, update the registry digest, and pass the ratchet. | Hash a canonical representation of the complete consumed example. At minimum include `section`, `markdown`, and `expectedOutput`; define explicit per-corpus projections if fields legitimately differ.

scripts/baselineRatchetSpecLedgers.mjs:47 | Logic & Correctness | Medium | Composite identities are constructed with an unescaped `" | "` delimiter. Distinct records containing that sequence can collapse to the same `Set` identity. Lines 60, 65, 72, and the TS helpers use the same unsafe encoding. | Serialize identity tuples with `JSON.stringify([...fields])` or length-prefix each component.

scripts/baselineRatchetTsAllowlist.mjs:260 | Logic & Correctness | High | Declaration lookup uses `source.indexOf(declName)`. A preceding comment such as `// EXPECTED_DELTAS = []` is treated as the declaration and returns an empty set. Because removals normally pass, this completely disables the ledger ratchet. The same bypass exists for `FIDELITY_LEDGER` at line 288 and `IDENTICAL_ALLOWLIST` at line 331. | Locate actual variable declarations through the TypeScript AST, or at minimum tokenize first and ignore comments/strings before matching a declaration.

scripts/baselineRatchetTsAllowlist.mjs:39 | Refactoring Debt | High | This 364-line handwritten partial TypeScript parser has high cyclomatic complexity and repeats string/comment/bracket traversal across `matchingBracket`, `splitTopLevel`, `splitField`, `arrayAfterAssignment`, and record parsing. It also exceeds the project’s approximately 300-line limit. | Replace it with the TypeScript compiler AST or a maintained parser. If that is impossible, introduce one tokenizer/cursor abstraction and split declaration extraction from identity projection.

scripts/baselineRatchetModes.mjs:187 | Logic & Correctness | High | Configuration is fail-open: an unknown or misspelled `direction` silently behaves as the default, and any `onAdd` value other than exactly `"fail"` silently reports instead of failing at lines 201–208. A typo can disable `no-remove` protection. | Validate each check against a strict schema before comparison; reject unknown `direction`, `onAdd`, shape, and unexpected combinations.

scripts/check-baseline-ratchet.mjs:189 | Logic & Correctness | High | Every `git show` failure is interpreted as “file added since merge base.” Repository corruption, invalid object reads, permissions, or other Git failures therefore bypass comparison despite the script’s fail-closed contract. | First determine path existence at the merge base using a dedicated tree query; treat only confirmed absence as a new file and report all other Git failures as fatal.

scripts/check-baseline-ratchet.mjs:125 | Shortcuts & Patches | Medium | Argument parsing accepts unknown options as positional refs and does not require values after `--root` or `--manifest`. Mistyped CI arguments can select the wrong base or silently fall back to the repository defaults. | Reject unknown flags, excess positional arguments, and missing option values with usage output and exit code 2.

scripts/vendor-spec-corpus.mjs:47 | Logic & Correctness | High | `parseSpecTxt` never verifies the separator or closing fence. With no dot, `indexOf` returns `-1` and silently rearranges the body; with no closing fence, EOF is accepted as a complete example. This trust-boundary path is untested. | Require exactly one separator and a closing 32-backtick fence; throw an error containing the example number and input line when malformed.

scripts/vendor-spec-corpus.mjs:86 | Logic & Correctness | High | `parseMarkdownItFixtures` similarly accepts missing middle or closing delimiters and manufactures empty/truncated output after advancing past EOF. | Parse each fixture as a validated three-delimiter state machine and reject incomplete blocks.

scripts/vendor-spec-corpus.mjs:145 | Shortcuts & Patches | Medium | Missing provenance environment variables are silently written as `"unknown"`, allowing an apparently valid vendored corpus with no auditable source, revision, or license. | Require all three provenance values and abort before writing when any is absent.

scripts/check-baseline-ratchet-spec-ledgers.test.mjs:68 | Logic & Correctness | High | Critical bypass paths are untested: semantic-value-only ledger edits, Tiptap `expectedOutput` edits, declaration names spoofed in comments, delimiter collisions, and malformed corpus records. The final “real files parse” test at lines 205–224 only proves the current happy-path syntax. | Add subprocess regressions for each bypass and assert both failure status and diagnostic text.

scripts/check-baseline-ratchet-spec-ledgers.test.mjs:19 | Duplication | High | `writeFiles`, `scratchRepo`, `mutate`, and `run` duplicate the harness in `scripts/check-baseline-ratchet.test.mjs:22–64`. Changes to Git setup or subprocess behavior must be maintained twice. | Extract a shared baseline-ratchet test harness module.

scripts/check-baseline-ratchet-spec-ledgers.test.mjs:27 | Shortcuts & Patches | Low | Scratch repositories are never removed, so repeated test runs leak directories under the system temporary directory. | Track created directories and remove them in `afterEach`/`afterAll` using `rmSync(..., { recursive: true, force: true })`.

No reviewed file was clean. I also directly reproduced the comment-spoof parser bypass and silent acceptance of truncated corpus fixtures.

## Group 7 (stalled)



## Group 7 (manual Claude audit — Codex stalled)

Files reviewed by Claude directly (pathological/*, externalCorpora.soak.test.ts, run-ime.mjs, journey 25): no High findings beyond those already recorded for sibling files; run-ime.mjs error-path macism restore duplicated between finally and top-level catch (Low, acceptable defensive duplication, documented).

## Round 1 dispositions (Claude fixer)

FIXED (verified by runnable tests, 5710 passing):
- G6 ratchet identities exclude values / delimiter collision → JSON-tuple identities incl. values; corpus digest now covers section+html+expectedOutput (+ test: value rewrite reported)
- G6 indexOf declaration lookup comment-bypass → declarationIndex (string/comment-aware) in all 3 comparators (+ decoy tests both directions)
- G2 converter silent mis-slice on malformed spec.txt/markdown-it input → fail-loud throws (+3 tests)
- G1 corpus JSON blind cast → loadExamples validates shape, duplicate numbers, provenance equality vs registry; validateRegistry() global prefix uniqueness (+ test)
- G5/G4 backtickToggle module-global state across editors → per-EditorView Map keyed state, timers cleared on reset (+ two-views isolation test); handlers/harness pass view
- G5 utils duplicated char-before extraction → getCharBefore() reused
- G3 linkReference double-assert → `satisfies LinkReference`
- G3 remarkDepthLimit untested → direct semantics tests (inert below, flattens past limit)
- G4 backspaceReverts dead abstraction (zero cases) → removed; header documents the measured heading-Backspace behavior
- G4 withTypingSession sync-finally vs async callbacks → promise-aware teardown
- G4 missing deletion-path tests → forward-Delete + range-Backspace harness tests

NOT FIXED (deliberate, with reasons):
- G3 nested-mark strike flanking → already pinned it.fails OPEN DEFECT (WI-4.1); fixing = delimiter-policy redesign, out of round scope
- G4 grapheme-aware deletion → documented harness limit; real grapheme semantics belong to the WebKit tier
- G3 wrapWithMark size/complexity + file >300 → file-size-baselined; split is a refactor beyond audit-fix's no-refactor rule
- G2 triage-dump measurement duplication → drift is pinned by both gates reddening together; extraction touches gate internals, deferred
- G5 smart-quote \w Unicode narrowness → behavior change affecting quote UX; recorded as outstanding follow-up
- G6 handwritten TS parser complexity → working + heavily tested; AST rewrite out of scope
- G2 dump not exercised in CI → it runs (skipped) in every suite; generation is manual by design (re-triage tool)
- G1/G2/G3 remaining Medium/Low items → accepted as-is this round; see group texts above

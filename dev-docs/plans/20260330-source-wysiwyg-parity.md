# Source Mode ↔ WYSIWYG Parity Plan (v2 — post-Codex review)

> **Status:** Effectively complete — all work items shipped except WI-4 (iframe-popup edit parity), which remains open.

---
title: "Source Mode ↔ WYSIWYG Feature Parity"
created_at: "2026-03-30 CST"
revised_at: "2026-03-30 CST"
mode: "full-plan"
branch: "feature/source-mode-parity"
codex_thread: "019d3e0a-030e-7fe1-9827-38c50d92e599"
---

## Revision Notes (v2)

Codex review found **6 work items that were already implemented** or partially done. Those have been
removed or reframed. Three previously deferred items (regex search, drag-and-drop, image resize) are
now in scope per owner request. Cross-cutting checklist added per Codex recommendation.

**Removed (already exist in codebase):**
- ~~WI-4: Heading Picker~~ — `sourceAdapterLinks.ts` already calls the shared `HeadingPicker` via `headingPickerStore`
- ~~WI-7: Popup Lifecycle~~ — `SourcePopupView` base class already provides click-outside, scroll-close, Tab trapping
- ~~WI-10: Lint UI in WYSIWYG~~ — `src/plugins/lint/tiptap.ts` + `LintBadge.tsx` already exist
- ~~WI-12: Copy as HTML~~ — already available via menu/shortcut (`useExportMenuEvents.ts`)
- ~~WI-14: Table Mod+Enter~~ — already bound in `tableUI/tiptap.ts:103-104`

**Reframed:**
- WI-1/WI-2 (Multi-cursor) — CodeMirror already binds `Mod-d`/`Mod-Shift-l` via `@codemirror/search`; reframed as evaluating whether existing behavior matches WYSIWYG semantics or needs replacement
- WI-6 (Footnote) — Codex flagged that Source popup edits raw markdown directly; round-tripping through `parseMarkdown()` would corrupt source formatting. Reframed as a formatting-preservation audit.
- WI-15 (MCP) — moved to explicit scope exception (read-only MCP parity), not deferred

---

## Outcomes

- **Desired behavior:**
  - Source Mode gains the WYSIWYG features users expect: math editing, smart paste, media popup parity, drag-and-drop, image resize, and regex-on-markdown search
  - WYSIWYG gains the Source Mode features that improve editing quality: smart select-all and frontmatter panel
  - Both modes feel like first-class editing experiences with different strengths, not primary vs fallback

- **Constraints:**
  - macOS is primary platform — all changes must preserve macOS behavior
  - AI features (Genie, AI Suggestions) are **deferred** — out of scope for this plan
  - MCP bridge **write** operations are deferred; **read-only** MCP parity is in scope
  - Keep diffs focused; no drive-by refactors
  - TDD: write failing test first for every behavioral change
  - `pnpm check:all` must pass at every commit
  - Keep code files under ~300 lines

- **Non-goals:**
  - Side-by-side split view (decided against — see prior research)
  - Removing Source Mode (decided against — escape hatch is essential)
  - AI/Genie support in Source Mode (deferred to separate plan)
  - MCP bridge write operations in Source Mode (deferred — coupled to AI plan)

## Cross-Cutting Checklist (applies to every WI)

Per Codex finding and AGENTS.md requirements:

- [ ] **i18n**: All new user-facing strings use `t()` (React) or `t!()` (Rust); keys added to `src/locales/en/*.json`
- [ ] **Shortcuts sync**: Any new keyboard shortcut added to all 3 files (`localized.rs`, `shortcutsStore.ts`, `website/guide/shortcuts.md`)
- [ ] **keepAlive/hidden**: New features work correctly when `keepBothEditorsAlive` is enabled (hidden editor must not interfere)
- [ ] **Read-only mode**: New features are disabled or no-op when document is read-only
- [ ] **Dark theme**: All new UI works in both light and dark themes
- [ ] **CJK/IME**: New keyboard features have IME guards; new text operations work with CJK text

---

## Work Items

### Phase 0 — Plan Normalization (Spike)

#### WI-0: Audit Existing Multi-Cursor Behavior

**What:** CodeMirror's `@codemirror/search` already provides `Mod-d` (selectNextOccurrence) and `Mod-Shift-l` (selectAll). Evaluate whether this existing behavior matches WYSIWYG's multi-cursor semantics or needs custom replacement.

**Current state:**
- `src/utils/sourceEditorExtensions.ts` — loads CodeMirror search extensions which include `Mod-d`
- `src/plugins/codemirror/sourceMultiCursorPlugin.ts` — Alt+Click and Escape only
- WYSIWYG: `src/plugins/multiCursor/` — custom Cmd+D with code fence boundary awareness

**Acceptance criteria:**
- [ ] Document: does CM's `selectNextOccurrence` respect code fence boundaries? (likely no)
- [ ] Document: does CM's `selectAll` match WYSIWYG's select-all-occurrences behavior?
- [ ] Document: are there CJK word-boundary differences?
- [ ] Decision: replace CM defaults with custom implementation, or extend with boundary guards
- [ ] If CM defaults are sufficient, close WI-1/WI-2 as already-done

**Files to read:**
- `src/utils/sourceEditorExtensions.ts` — where CM search extensions are loaded
- `@codemirror/search` source — `selectNextOccurrence` behavior
- `src/plugins/multiCursor/` — WYSIWYG reference implementation

**Estimated complexity:** 2/10 (research only)

---

### Phase 1 — Source Mode: Multi-Cursor Parity (conditional on WI-0)

#### WI-1: Enhanced Select Next Occurrence (Cmd+D) in Source Mode

**What:** If WI-0 finds that CodeMirror's built-in `selectNextOccurrence` lacks code fence boundary awareness or CJK handling, replace it with a custom implementation that matches WYSIWYG behavior.

**Current state:**
- `@codemirror/search` provides basic `selectNextOccurrence`
- Custom multi-cursor infrastructure exists in `sourceAltClick.ts` with code fence boundary detection
- WYSIWYG: `src/plugins/multiCursor/` — full Cmd+D with word boundary detection

**Acceptance criteria:**
- [ ] Cmd+D with no selection: selects word under cursor
- [ ] Cmd+D with selection: finds and selects next occurrence of selected text
- [ ] Repeated Cmd+D: adds additional occurrences as new selections
- [ ] Code fence boundary respected (don't select across fence boundaries)
- [ ] Works with CJK text (word boundary detection)
- [ ] IME guard (don't fire during composition)
- [ ] Test: unit tests covering word selection, repeated selection, boundary cases, CJK

**Files to modify:**
- `src/utils/sourceEditorExtensions.ts` — override or extend CM search keymap
- `src/plugins/codemirror/sourceMultiCursorPlugin.ts` — add custom keybinding if CM default is insufficient

**Estimated complexity:** 5/10 (may be 0/10 if CM defaults are sufficient)

**Depends on:** WI-0

---

#### WI-2: Enhanced Select All Occurrences (Cmd+Shift+L) in Source Mode

**What:** Same as WI-1 but for select-all-occurrences. If CM default is sufficient, close as done.

**Acceptance criteria:**
- [ ] Selects all occurrences of current word (if no selection) or selected text
- [ ] Creates multi-cursor selection for all matches
- [ ] Code fence boundary respected
- [ ] Test: unit tests covering all-match selection, empty results

**Files to modify:**
- `src/utils/sourceEditorExtensions.ts` — override or extend
- `src/plugins/codemirror/sourceMultiCursorPlugin.ts`

**Estimated complexity:** 3/10

**Depends on:** WI-0, WI-1

---

### Phase 2 — Source Mode: Popup & Editing Parity

#### WI-3: Math Inline Editing Popup for Source Mode

**What:** Add a math editing popup in Source Mode that appears when the cursor is inside `$...$`, `$$...$$`, or ` ```latex `, with a textarea for editing and live KaTeX preview — matching the WYSIWYG math popup.

**Current state:**
- WYSIWYG: `src/plugins/mathPopup/MathPopupView.ts` — textarea + live preview + save/cancel
- Source: `src/plugins/codemirror/sourceMathPreview.ts` — read-only floating preview (singleton)

**Design decisions to make first:**
1. **Supported syntaxes:** `$...$` (inline), `$$...$$` (block), ` ```latex ` (code fence) — all three must be handled
2. **Delimiter tracking:** How to track the active delimiter range while the user edits (cursor may move within range)
3. **Preview ownership:** Does this replace `sourceMathPreview.ts` or coexist? (Recommend: replace — the editable popup subsumes the read-only preview)
4. **Cursor-leaves-range behavior:** Auto-save? Discard? Prompt? (Recommend: auto-save, matching Source Peek behavior)

**Acceptance criteria:**
- [ ] Popup appears when cursor enters any math syntax (`$`, `$$`, ` ```latex `)
- [ ] Textarea for editing LaTeX expression
- [ ] Live KaTeX preview with error display
- [ ] Cmd+Enter to save, Escape to cancel
- [ ] Changes apply to the source markdown in-place, preserving delimiters
- [ ] Cursor leaving math range auto-saves (no discard)
- [ ] Click-outside closes popup (auto-save)
- [ ] Scroll-close behavior
- [ ] Test: popup show/hide for each syntax, save/cancel, error handling, delimiter preservation

**Files to create:**
- `src/plugins/sourceMathPopup/SourceMathPopupView.ts` — new popup view extending `SourcePopupView`
- `src/plugins/sourceMathPopup/source-math-popup.css` — styles

**Files to modify:**
- `src/plugins/codemirror/sourceMathPreview.ts` — replace with editable popup, or remove and redirect

**Estimated complexity:** 6/10

---

#### WI-4: Media Popup Parity (Video/Audio/Iframe Support in Source)

**What:** Extend Source image popup to handle video, audio, and iframe embeds — matching WYSIWYG's unified MediaPopupView.

**Current state:**
- WYSIWYG: `src/plugins/mediaPopup/MediaPopupView.ts` — handles image, video, audio with conditional fields
- Source: `src/plugins/sourceImagePopup/SourceImagePopupView.ts` — images only (regex matches `![alt](src)` only)
- Source detection: `sourceImagePopupPlugin.ts` — regex is image-only
- Source actions: `sourceImageActions.ts` — hardcoded to image markdown
- Source store: `mediaPopupStore.ts` — has no iframe type

**This requires three layers of work (per Codex):**

**Layer 1 — Parser/Detection:** Extend `sourceImagePopupPlugin.ts` to detect `<video>`, `<audio>`, `<iframe>` HTML tags in addition to `![]()`

**Layer 2 — Actions/Serialization:** Extend `sourceImageActions.ts` with save/remove/browse logic for each media type, including attribute serialization (poster, title, controls)

**Layer 3 — View:** Extend `SourceImagePopupView.ts` with conditional fields per media type

**Acceptance criteria:**
- [ ] Detect media type from markdown syntax: `![alt](src)`, `<video>`, `<audio>`, `<iframe>`
- [ ] Show type-specific fields (poster for video, title for audio)
- [ ] Display image dimensions when available
- [ ] Browse button works for all media types
- [ ] Save correctly serializes each media type back to its original syntax
- [ ] Remove correctly deletes the entire media tag
- [ ] Test: media type detection, field visibility by type, round-trip serialization

**Files to modify:**
- `src/plugins/sourceImagePopup/sourceImagePopupPlugin.ts` — extend detection regex
- `src/plugins/sourceImagePopup/sourceImageActions.ts` — add media-type-specific actions
- `src/plugins/sourceImagePopup/SourceImagePopupView.ts` — conditional field rendering
- `src/plugins/sourceImagePopup/source-image-popup.css` — layout for conditional rows
- `src/stores/mediaPopupStore.ts` — add iframe type if needed

**Estimated complexity:** 6/10

---

#### WI-5: Footnote Popup — Formatting Preservation Audit

**What:** Audit whether Source footnote popup correctly preserves markdown formatting in footnote definitions. The Source popup edits raw markdown directly — unlike WYSIWYG which round-trips through `parseMarkdown()`. The question is whether the raw-text save path loses any formatting.

**Codex finding:** Adding `parseMarkdown()` to Source save would corrupt source formatting. The issue is not "parse on save" but whether the current text-based save drops anything.

**Acceptance criteria:**
- [ ] Audit: save footnote with bold, italic, links, inline code — verify formatting preserved in document
- [ ] If formatting IS preserved (likely, since it's raw text): close as no-action-needed
- [ ] If formatting is lost somewhere: fix at the text serialization layer
- [ ] Test: round-trip footnote content with various formatting

**Files to audit:**
- `src/plugins/sourceFootnotePopup/sourceFootnoteActions.ts` — save logic
- `src/plugins/sourceFootnotePopup/SourceFootnotePopupView.ts`

**Estimated complexity:** 1/10 (audit only, likely no change needed)

---

### Phase 3 — Source Mode: Paste & Media

#### WI-6: Smart Paste — HTML to Markdown Conversion in Source Mode

**What:** When pasting HTML content (from Word, web pages, etc.) in Source Mode, convert it to clean markdown instead of inserting raw HTML.

**Current state:**
- WYSIWYG: `src/plugins/htmlPaste/tiptap.ts` — converts HTML to markdown via turndown
- Source: `src/plugins/codemirror/smartPaste.ts` — only handles URL-over-selection and image paste

**Design checkpoint (before implementation):** Identify the reuse path. The WYSIWYG pipeline goes HTML → ProseMirror → markdown. Source needs HTML → markdown directly. Determine whether to:
1. Extract turndown conversion from `htmlPaste/tiptap.ts` into a shared utility, or
2. Use a different HTML-to-markdown converter (e.g., direct turndown call)

Avoid creating a parallel image pipeline — reuse `smartPasteImage.ts` existing infrastructure.

**Acceptance criteria:**
- [ ] Paste from Word/web inserts clean markdown, not raw HTML
- [ ] Respects paste mode setting ("smart" / "plain" / "rich")
- [ ] Size limit (100KB) prevents freezes on large HTML pastes
- [ ] Skips conversion inside code fences (paste raw)
- [ ] Reuses the same conversion pipeline as WYSIWYG (no second converter)
- [ ] Test: HTML conversion, code fence bypass, size limit, paste mode setting

**Files to modify:**
- `src/plugins/codemirror/smartPaste.ts` — add HTML detection + conversion
- Possibly extract shared utility from `src/plugins/htmlPaste/tiptap.ts`

**Estimated complexity:** 5/10

---

#### WI-7: Image Paste to Upload in Source Mode

**What:** Pasting a clipboard image in Source Mode should trigger the same upload-to-assets flow as WYSIWYG, inserting `![](path)` markdown.

**Current state:**
- WYSIWYG: `src/plugins/imageHandler/tiptap.ts` — full paste→upload→insert pipeline
- Source: `src/plugins/codemirror/smartPasteImage.ts` — handles URL/path paste but not clipboard image data

**Design note:** Reuse the existing asset-save pipeline from `useImageDragDrop.ts` / `sourceImageActions.ts` — don't build a third image pipeline.

**Acceptance criteria:**
- [ ] Paste clipboard image (e.g., screenshot) triggers asset save
- [ ] Inserts `![](relative-path)` at cursor
- [ ] Respects `copyToAssets` setting
- [ ] Shows error toast if document is unsaved and copyToAssets is enabled
- [ ] Test: image paste, path generation, unsaved doc guard

**Files to modify:**
- `src/plugins/codemirror/smartPasteImage.ts` — add clipboard image handling

**Estimated complexity:** 5/10

---

#### WI-8: Drag-and-Drop File Insertion in Source Mode

**What:** Enable dragging files (images, markdown files) from Finder into the Source Mode editor to insert them, matching WYSIWYG behavior.

**Current state:**
- WYSIWYG: `src/hooks/useImageDragDrop.ts` — handles Tauri `onDragDropEvent`, copies to assets, inserts block_image nodes
- Source: The same hook already supports Source Mode — it inserts `![](path)` text via CodeMirror dispatch

**Audit first:** The hook already has source mode support. Verify it works correctly for:
1. Single image drop
2. Multiple image drop
3. Non-image file drop (should it insert `[filename](path)` link?)
4. Drop zone visual feedback in Source Mode

**Acceptance criteria:**
- [ ] Drag image from Finder → inserts `![](path)` at drop position in Source
- [ ] Multiple images dropped at once — each gets its own line
- [ ] Asset copying works (`copyToAssets` setting respected)
- [ ] Drop zone indicator appears in Source Mode
- [ ] Non-image files: insert as `[filename](path)` link (or ignore — match WYSIWYG behavior)
- [ ] Test: single drop, multi drop, asset copy, unsaved doc guard

**Files to audit/modify:**
- `src/hooks/useImageDragDrop.ts` — verify Source Mode path works, extend if needed
- CodeMirror drop position detection (may need `posAtCoords` to insert at drop point instead of cursor)

**Estimated complexity:** 3/10 (may already work; audit first)

---

#### WI-9: Image Width/Resize in Source Mode

**What:** Allow users to change image width in Source Mode via the media popup, since drag-to-resize is a fundamentally visual operation.

**Current state:**
- WYSIWYG: Drag handles on images for visual resize
- Source: No width editing in popup; users must manually edit `width="..."` or `{width=...}` in markdown

**Design decision:** Don't replicate drag-to-resize (impossible in text mode). Instead, add a width field to the Source image popup. The popup already shows src and alt — add a width input that reads/writes the `width` attribute in the HTML tag or the `{width=N}` attribute syntax.

**Acceptance criteria:**
- [ ] Source image popup shows width field when image has width attribute
- [ ] Width field allows entering px or % value
- [ ] Save updates the width attribute in the markdown source
- [ ] For `![](src){width=300}` syntax: read and write the attribute
- [ ] For `<img src="..." width="300">` syntax: read and write the attribute
- [ ] Empty width field removes the width attribute
- [ ] Test: read width from both syntaxes, save width, remove width

**Files to modify:**
- `src/plugins/sourceImagePopup/SourceImagePopupView.ts` — add width field
- `src/plugins/sourceImagePopup/sourceImageActions.ts` — read/write width attribute
- `src/plugins/sourceImagePopup/source-image-popup.css` — layout adjustment

**Estimated complexity:** 4/10

---

### Phase 4 — WYSIWYG: Gains from Source Mode

#### WI-10: Smart Select-All (Block Expansion) in WYSIWYG

**What:** Cmd+A should expand selection progressively: current block content → current block → whole document, matching Source Mode behavior.

**Current state:**
- Source: `src/plugins/codemirror/sourceShortcuts.ts:215-275` — detects code fence, table, blockquote, list; selects block first, then document on second press
- WYSIWYG: Standard ProseMirror select-all (selects everything immediately)

**Acceptance criteria:**
- [ ] First Cmd+A: selects content of current block (code block, table cell, blockquote, list item)
- [ ] Second Cmd+A: selects entire document
- [ ] Cmd+Z after Cmd+A: restores previous selection
- [ ] Works correctly in nested blocks (list inside blockquote)
- [ ] Test: expansion sequence, undo, nested blocks

**Files to create:**
- `src/plugins/smartSelectAll/tiptap.ts` — Tiptap extension overriding Cmd+A

**Estimated complexity:** 4/10

---

#### WI-11: Frontmatter Panel in WYSIWYG Mode

**What:** Provide a UI for viewing and editing YAML frontmatter without switching to Source Mode.

**Current state:**
- `src/plugins/markdownArtifacts/frontmatter.ts` — atom node, `contenteditable: false`, no visual editing
- Users must switch to Source Mode to edit frontmatter

**Design decisions (must be resolved before implementation — per Codex):**

1. **State model:** Draft (uncommitted edits in the panel) vs Committed (written to atom node `value` attr). Only one source of truth at a time.
2. **Commit triggers:** Cmd+Enter commits. Blur commits (with debounce to avoid losing work on accidental blur). Escape reverts to last committed value.
3. **Invalid YAML:** Show warning indicator but DO commit — the user's YAML is their YAML, even if invalid. Don't gatekeep saves.
4. **Node attrs update:** Panel writes to `frontmatter` node's `value` attr via a ProseMirror transaction. This creates an undo point.
5. **Mode switch guard:** If user switches to Source Mode while panel is open, commit current draft first.

**Acceptance criteria:**
- [ ] Collapsed indicator shows "Frontmatter" label when frontmatter exists
- [ ] Click expands to show YAML editor (CodeMirror with YAML mode, lazy-loaded)
- [ ] YAML syntax highlighting
- [ ] Cmd+Enter commits and collapses
- [ ] Blur commits (after 300ms debounce)
- [ ] Escape reverts to last committed value and collapses
- [ ] Invalid YAML shows warning but doesn't block save
- [ ] Mode switch auto-commits
- [ ] Works with keepBothEditorsAlive (hidden state must not interfere)
- [ ] Test: expand/collapse, commit triggers, revert, invalid YAML, mode switch

**Prototype first:** Build the collapsible panel shell and confirm it can read/write the atom node before tackling YAML highlighting.

**Files to create:**
- `src/plugins/frontmatterPanel/tiptap.ts` — Tiptap extension with node view
- `src/plugins/frontmatterPanel/FrontmatterPanel.tsx` — React component
- `src/plugins/frontmatterPanel/frontmatter-panel.css` — styles

**Estimated complexity:** 7/10

---

#### WI-12: Regex Search on Markdown Syntax in WYSIWYG

**What:** Allow WYSIWYG find/replace to optionally search the underlying markdown syntax, not just rendered text.

**Current state:**
- WYSIWYG: `src/plugins/search/tiptap.ts` — searches `node.text` (rendered text only). Cannot match `**`, `[`, `]`, `#`, etc.
- Source: `src/utils/sourceEditorSearch.ts` — searches raw markdown directly (regex works on syntax)

**Design decision:** Add a "Search markdown" toggle to the FindBar. When enabled, serialize the document to markdown and search that string instead of the ProseMirror text nodes. Match positions are mapped back to ProseMirror positions for highlighting.

**Key challenge:** Position mapping. A match at markdown offset N needs to be translated to a ProseMirror `(nodePos, offset)` for decoration. This requires building a line-to-node position map, similar to what `sourceLint.ts` already does for lint diagnostics.

**Acceptance criteria:**
- [ ] FindBar has a "Markdown" toggle (icon or checkbox) alongside regex/case/whole-word toggles
- [ ] When "Markdown" is enabled: searches raw markdown source
- [ ] Match highlighting appears on the correct text/node in WYSIWYG view
- [ ] Replace operations apply to the markdown source and re-parse the affected region
- [ ] When "Markdown" is disabled: current text-only search behavior preserved
- [ ] Performance: serialize-and-search is debounced; acceptable up to 100KB documents
- [ ] Test: toggle behavior, syntax pattern matching, position mapping, replace

**Files to modify:**
- `src/plugins/search/tiptap.ts` — add markdown search path
- `src/components/FindBar/FindBar.tsx` — add markdown toggle UI
- `src/stores/searchStore.ts` — add `searchMarkdown` boolean

**Estimated complexity:** 7/10

---

### Phase 5 — MCP Bridge: Read Operations in Source Mode

#### WI-13: Unblock Read-Only MCP Operations in Source Mode

**What:** Unblock MCP operations that only read data and can work from the markdown document store or CodeMirror state, not Tiptap DOM.

**Current state:**
- `src/hooks/mcpBridge/sourceModeGuard.ts` — blocks 60+ operations
- Read ops like `document.getContent` are blocked even though they could return raw markdown

**Codex finding:** Cannot solve by just removing ops from the blocklist — handlers in `documentHandlers.ts`, `astHandlers.ts`, `cursorHandlers.ts` all assume Tiptap. Need markdown-native alternative handlers.

**Phased approach (per Codex):**
1. **Start with two trivial ops:** `document.getContent` (return markdown from documentStore) and `editor.focus` (focus CodeMirror view)
2. **Then add:** `outline.get` (reuse `extractHeadings()` from OutlineView)
3. **Then add:** `metadata.get` — **NOTE:** current handler returns file metadata (path, title, word count, dirty state), NOT frontmatter. If frontmatter access is needed, add a new `metadata.getFrontmatter` operation instead of redefining `metadata.get`.
4. **Then evaluate:** `structure.getDigest`, `structure.listBlocks`, `cursor.getContext` — each needs a markdown-native implementation

**Operations that remain blocked (require Tiptap mutations):**
- All write/mutation operations
- Selection operations (different API in CodeMirror)
- Suggestion operations (Tiptap marks only)
- Format operations (Tiptap marks only)

**Acceptance criteria:**
- [ ] `document.getContent` returns markdown in Source Mode
- [ ] `editor.focus` focuses CodeMirror in Source Mode
- [ ] `outline.get` returns heading list in Source Mode
- [ ] `metadata.get` returns same shape as WYSIWYG (file metadata, not frontmatter)
- [ ] Existing blocked operations remain blocked with clear error
- [ ] MCP response shapes are identical between modes (clients don't need to know which mode)
- [ ] Test: each unblocked operation returns expected data in Source Mode

**Files to modify:**
- `src/hooks/mcpBridge/sourceModeGuard.ts` — move unblocked ops to a new "source-capable" set
- `src/hooks/mcpBridge/index.ts` — route source-capable ops to source handlers
- New file: `src/hooks/mcpBridge/sourceHandlers.ts` — Source-specific handler implementations

**Estimated complexity:** 5/10

---

## Phase Summary & Ordering

| Phase | Theme | Work Items | Estimated Effort |
|-------|-------|------------|-----------------|
| **0** | Normalization spike | WI-0 | Small |
| **1** | Source: Multi-cursor | WI-1, WI-2 (conditional on WI-0) | Small–Medium |
| **2** | Source: Popups & editing | WI-3, WI-4, WI-5 | Large |
| **3** | Source: Paste, drag, resize | WI-6, WI-7, WI-8, WI-9 | Large |
| **4** | WYSIWYG: Gains from Source | WI-10, WI-11, WI-12 | Large |
| **5** | MCP: Read ops in Source | WI-13 | Medium |

**Recommended execution order:** Phase 0 → 1 → 2 → 3 → 4 → 5

Rationale: Phase 0 is a quick spike that may eliminate Phase 1 entirely. Phase 2 (popups) closes the most visible quality gap. Phase 3 (paste/drag/resize) groups all media-handling improvements. Phase 4 (WYSIWYG gains) and Phase 5 (MCP) are mostly independent and can be parallelized.

---

## Deferred Items (Separate Plan Required)

| Feature | Why Deferred | Prerequisite |
|---------|-------------|-------------|
| **AI Genie in Source Mode** | Requires designing how AI suggestions render in CodeMirror (different decoration model than ProseMirror) | AI suggestion architecture decision |
| **AI Suggestions in Source Mode** | Same as above | AI suggestion architecture decision |
| **MCP Bridge write operations** | Each operation needs a CodeMirror-native implementation — massive scope | WI-13 (read ops first to validate pattern) |
| **Split view orientation** | Research completed; not a parity issue | Separate UX feature |

---

## Testing Strategy

- **Unit tests required** for all work items (TDD: RED → GREEN → REFACTOR)
- **Pattern:** Follow existing test patterns in `src/plugins/multiCursor/__tests__/` and `src/stores/__tests__/`
- **Coverage:** All new code must maintain or improve current coverage thresholds
- **Manual verification:** Test both light and dark themes, CJK text, edge cases (empty doc, single char, very long lines)
- **Gate:** `pnpm check:all` must pass at every commit

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Multi-cursor Cmd+D conflicts with CodeMirror defaults | Phase 0 spike evaluates this first — may be a non-issue |
| Source media detection regexes are fragile for HTML tags | Use the existing markdown parser for tag detection, not custom regex |
| Frontmatter panel CodeMirror adds bundle size | Lazy-load the YAML mode; CodeMirror is already lazy-loaded for Source Mode |
| Regex-on-markdown search: position mapping complexity | Reuse the line-to-node mapping from `lint/tiptap.ts` as reference |
| MCP response shape divergence between modes | Acceptance criteria require identical response shapes — test both modes |
| HTML paste conversion quality | Reuse the same turndown/conversion pipeline as WYSIWYG — don't build a second converter |
| Parallel image/paste pipelines | Design checkpoint before Phase 3 to pick the reuse strategy |

# Phase 0 — WI-0.7 — Editor.tsx surface refactor risk audit

**Date:** 2026-05-06  
**Auditor:** Explore (Phase 0 spike)  
**Status:** Complete

## Executive Summary

The Editor.tsx refactor from hardcoded markdown mount to registry-driven dispatch spans **13 distinct coordination surfaces** across the codebase. The long pole is not Editor.tsx itself (118 LOC, straightforward conditional logic) but the surrounding orchestration: menu command dispatch, store dependencies, search wiring, large-file forced-source paths, and side-panel lifecycle. A naive "just make Editor generic" approach leaves dangling markdown-specific logic in 8+ files.

**Critical finding:** `useUnifiedMenuCommands` (hooks/useUnifiedMenuCommands.ts) is the true coordination hub. Every format adapter (markdown/YAML/JSON/etc.) must eventually integrate with this dispatcher to inherit the menu event routing infrastructure. This is non-obvious and blocks Phase 1A sprint planning.

---

## Coordination sites

### 1. Direct mount sites

| File:Line | Component | Wrapper | Markdown-coupled |
|-----------|-----------|---------|------------------|
| `src/App.tsx:327` | `<Editor />` | `<div role="main">` in MainLayout | No — agnostic at mount |
| `src/components/Editor/Editor.tsx:107` | `<TiptapEditorInner>` or `<SourceEditor>` | `<div className="editor-content">` | **Yes** — hardcoded switch on `sourceMode` |
| `src/components/Editor/Editor.tsx:110` | `<WorkflowSidePanel>` | `<Suspense>` (lazy-loaded) | **Yes** — markdown-only genie workflows |
| `src/components/Editor/Editor.tsx:111` | `<GhaWorkflowSidePanel>` | Eager-loaded (no Suspense) | **Yes** — YAML-specific workflow preview |

**Action for Phase 1A:** The mount site (App.tsx:327) stays unchanged. Editor.tsx's internal conditional (lines 89–100) becomes the domain of `<SplitPaneEditor>` wrapper. Workflow panels move to a **tab-kind dispatch system** — keyed off document extension, not markdown-only signal. See coordination site #5.

---

### 2. Store dependencies — which ones are markdown-specific?

**Editor.tsx reads these stores:**

| Store | Fields read | Markdown-specific? | Migration target |
|-------|------------|------------------|------------------|
| `useEditorStore` | `sourceMode` | **Critical** — mode toggle is markdown-only affordance. Non-markdown tabs should be rendered stateless or via per-format switch. | Format registry: `FormatConfig.editorKind` → "source"\|"wysiwyg"\|"readonly" |
| `useLargeFileSessionStore` | `forcedSourceTabs[tabId]` | **Critical** — only markdown has dual path. Data formats are source-only. Code formats are readonly-only. | Markdown adapter internal: remove from Editor.tsx entirely, push into TiptapEditor lifecycle. |
| `useSettingsStore` | `markdown.*` (mediaBorder, mediaAlign, headingAlign, htmlRendering, tableFitToWidth) | **Critical** — all markdown-specific render hints. | Move to markdown format adapter as styling props. |
| `useDocumentStore` | `documents[tabId].readOnly` | **No** — generic flag. | Keep in Editor.tsx as read-only prop. |
| `useTabStore` | (not directly read in Editor.tsx but via hooks) | No | Keep unchanged. |

**Action for Phase 1A:** `useEditorStore.sourceMode` becomes `FormatConfig.editorKind` lookup. Markdown render settings become namespace-scoped: `settings.formats.markdown.*` instead of `settings.markdown.*`. The store reads themselves don't change, but their _usage_ is format-qualified.

---

### 3. Menu handler dispatch — `useUnifiedMenuCommands` markdown-coupled actions

**Mount site:** `src/components/Editor/Editor.tsx:77` calls `useUnifiedMenuCommands()` once.

**Handler routing logic:**
- Location: `src/hooks/useUnifiedMenuCommands.ts:300–365`
- Reads: `useEditorStore.sourceMode`, `useLargeFileSessionStore.isForcedSource(activeTabId)`, `useTabStore.activeTabId[windowLabel]`
- Routes to either `dispatchToWysiwyg()` or `dispatchToSource()` based on effective mode
- **Capability check** (lines 334–345): each action declares `.supports.source` and `.supports.wysiwyg`

**Markdown-coupled actions** (must move to format adapter or registry):

| Action | Handler | File:Line | Why coupled | Phase 1A plan |
|--------|---------|-----------|------------|--------------|
| `setHeading` (all levels) | Dispatch to `setWysiwygHeadingLevel` or `setSourceHeadingLevel` | `useUnifiedMenuCommands.ts:207–223` | Markdown block type. JSON/YAML have no heading concept. | Remove from generic dispatcher; move to markdown action set. New dispatcher route: format → adapter dispatcher. |
| `paragraph` | Convert heading to paragraph (markdown-specific) | `useUnifiedMenuCommands.ts:216–220` | Markdown block type. | Remove; markdown-only. |
| `bulletList`, `orderedList`, `taskList` | Toggle markdown list types | `useUnifiedMenuCommands.ts:225` via adapter | Markdown-specific. Code/JSON never list. | Remove; markdown-only. |
| `blockquote` | Toggle markdown blockquote | `wysiwygAdapter.ts:181`, `sourceAdapter.ts` | Markdown block. | Remove; markdown-only. |
| `insertCodeBlock` | Insert fenced code block | `wysiwygAdapter.ts:146` | Markdown block. JSON gets syntax tree. | Remove; markdown-only. |
| `insertMath`, `insertMathInline` | LaTeX math via Tiptap/CodeMirror | `wysiwygAdapterInsert.ts`, `sourceAdapter.ts` | Markdown extension (KaTeX). | Remove; markdown-only. |
| `insertDiagram` (mermaid) | Insert Mermaid syntax block | `wysiwygAdapterInsert.ts` | Markdown extension. | Remove; markdown-only. |
| `insertTable` | Insert markdown table | `wysiwygAdapter.ts:195` | Markdown table syntax. JSON gets object editor. | Remove; markdown-only. |
| `insertFootnote` | Pandoc footnotes (markdown syntax) | `wysiwygAdapter.ts:196` | Markdown extension. | Remove; markdown-only. |
| `cjkFull2Half`, `cjkHalf2Full`, `cjkInsertSpaces` | CJK formatting, punctuation conversion | `wysiwygAdapterCjk.ts`, `sourceAdapterCjk.ts` | Markdown text-only. NA for structured data. | **Keep but flag as markdown-only.** Add `.supports.source/.supports.wysiwyg` check; disable in non-markdown tabs. |
| `toggleSourceMode` | Switch between WYSIWYG and Source | `useEditorStore.setState({sourceMode: !sourceMode})` | Markdown-only toggle. | **Critical:** Remove from global menu. Move to markdown format adapter as context-menu action. Non-markdown tabs have fixed view mode. |
| `formatCJKFile` | CJK formatting for entire document | `wysiwygAdapterCjk.ts` | Markdown document transform. | Remove; markdown-only. |
| `findInDocument` | Find (Ctrl+F) dispatch | `useSearchCommands.ts` or direct CodeMirror search | Mode-aware but markdown-coupled data source | See coordination site #6. |

**Action for Phase 1A:** Every menu handler must declare capability via `ACTION_DEFINITIONS[actionId].supports.markdown` (new field). The global dispatcher becomes:
```
1. Resolve active tab's format from tabId
2. Route MENU_TO_ACTION event to format dispatcher
3. Format dispatcher checks .supports[format] and delegates to adapter
```

New registry required: per-format action dispatcher function. Markdown gets the existing wysiwygAdapter + sourceAdapter as a bundle.

---

### 4. TiptapEditor and SourceEditor rendering branches — conditional logic

**Current logic (Editor.tsx:89–100):**
```tsx
const editorContent = keepAlive ? (
  <>
    <Suspense><SourceEditor hidden={!sourceMode} /></Suspense>
    <TiptapEditorInner hidden={sourceMode} />
  </>
) : (
  sourceMode 
    ? <Suspense><SourceEditor /></Suspense>
    : <TiptapEditorInner />
)
```

**Markdown-coupled decisions:**
- `keepAlive` setting (advanced.keepBothEditorsAlive) — only meaningful for markdown's dual-path architecture
- `hidden` attribute — CSS hides inactive editor but keeps DOM alive for undo history

**Action for Phase 1A:** Wrap each branch in `<SplitPaneEditor kind={formatConfig.editorKind} />`:
- `editorKind: "wysiwyg"` → TiptapEditor only (or both if keepAlive)
- `editorKind: "source"` → SourceEditor only
- `editorKind: "readonly"` → SourceEditor + CodeMirror readOnly=true
- New format adapters for JSON, YAML, etc. return their own `<JsonEditor>`, `<YamlEditor>` components

The keepAlive logic itself becomes format-specific: only markdown opts in.

---

### 5. Side-panel lifecycle — WorkflowSidePanel, GhaWorkflowSidePanel

**Current mount sites:**

| Panel | File:Line | Trigger | Markdown-specific |
|-------|-----------|---------|------------------|
| `WorkflowSidePanel` | `Editor.tsx:110` | `workflowEnabled && <Suspense>` | **Yes** — Genie workflow editor for YAML genie files (`.genie.yml`). Only mounted if `settings.advanced.workflowEngine`. |
| `GhaWorkflowSidePanel` | `Editor.tsx:111` | Eager-loaded (always mounted) | **Yes** — GitHub Actions workflow preview. Detects `.github/workflows/*.yml` at tab open. |

**Integration points:**
- Both panels read document content via `useDocumentStore`
- GhaWorkflowSidePanel internally triggers validation and AST parse on content change
- Neither panel is aware of markdown mode or WYSIWYG/source; they render independently

**Action for Phase 1A:** Create a generic **"panel registry"** alongside format registry. Each format declares optional `sidePanel?: (tabId, documentId) => React.ReactNode`. Today:
- Markdown: `null` (no side panel)
- YAML (genie): `WorkflowSidePanel` (if workflowEngine enabled)
- YAML (GitHub Actions): `GhaWorkflowSidePanel` (auto-detected via path)
- Other formats: `null`

Location for panel dispatcher: wrap the current `{workflowEnabled && <WorkflowSidePanel />}` blocks into a `<SidePanelDispatcher tabId={tabId} />` component that reads the format and invokes the registry.

---

### 6. Search wiring — find-in-document dispatch

**Current architecture:**
- Find bar (Ctrl+F) is global, rendered in App.tsx:333 as `<FindBar />`
- Dispatches to editor-specific search:
  - **Markdown WYSIWYG:** Tiptap's native `findIndex` extension
  - **Markdown Source / all Source modes:** CodeMirror's search plugin
- Content search (Cmd+Shift+F) is separate: searches workspace files matching `MARKDOWN_EXTENSIONS` constant

**Search hooks:**
| Hook | File | Markdown-coupled | Migration |
|------|------|-----------------|-----------|
| `useSourceEditorSearch` | `src/hooks/useSourceEditorSearch.ts` | **No** — generic CodeMirror search integration, works for any source format | Keep; becomes searchAdapter for all source-mode formats |
| `useSearchCommands` | `src/hooks/useSearchCommands.ts` | **Yes** — menu events dispatch to `useSearchStore` (which triggers editor search). Navigation between search results is editor-specific. | Keep but dispatch search to format adapter. |
| Content search store | `src/stores/contentSearchStore.ts:147` | **Critical** — hardcoded `MARKDOWN_EXTENSIONS` in the scope filter | Replace with registry lookup: `listFormats().filter(f => f.searchable)` |

**Find-in-document dispatch path:**
1. Ctrl+F → `useSearchCommands.ts` → `useSearchStore.setQuery(query)`
2. Zustand subscriber in FindBar → dispatch to active editor
3. **Markdown WYSIWYG:** Tiptap findIndex (via `expandedToggleMarkTiptap` + custom action)
4. **Markdown Source / all Source:** CodeMirror search plugin (via `useSourceEditorSearch`)

**Action for Phase 1A:** Keep the global Find bar. Add format lookup before dispatch:
```tsx
if (isSourceMode || currentFormat.editorKind === "source") {
  dispatchToSourceSearch(query);
} else if (currentFormat.editorKind === "wysiwyg") {
  dispatchToWysiwygSearch(query);
}
```

Content search scope: instead of hardcoded `MARKDOWN_EXTENSIONS`, iterate `registry.listFormats()` and check `format.capabilities.includes("contentSearch")`.

---

### 7. Large-file forced-source path

**Current wiring:**
- `useFileOpen.ts:88`, `useDragDropOpen.ts:78`, `useFinderFileOpen.ts:88` → `maybeForceSourceForYaml(tabId, path)`
- `maybeForceSourceForYaml` also invokes `useLargeFileSessionStore.markForcedSource(tabId)` for files > 5MB
- `Editor.tsx:61–64` reads the forced-source flag and overrides `sourceMode` for that tab

**Location:** `src/utils/largeFileRouting.ts:37` defines `routeOpenBySize(filePath) → { kind?, force }`.

**Markdown-coupled logic:**
1. Only markdown has a WYSIWYG path to force away from
2. Data formats (YAML, JSON) are source-only anyway
3. Code formats are readonly-only

**Action for Phase 1A:** Remove `useLargeFileSessionStore` from Editor.tsx entirely. Move forced-source detection into the markdown format adapter's mount hook. The tab's format is already resolved in `Editor.tsx` via the registry; if format is "markdown", the adapter checks file size and configures its own mode.

New flow:
```
useFileOpen → registry.getFormat(path) → format.adapter.getInitialMode(path) → {sourceMode, reason}
```

---

### 8. External-change reload wiring

**Current architecture:**
- `useWindowFileWatcher.ts` starts a Rust file watcher on window mount
- `useExternalFileChanges.ts` listens for file-changed events and handles reload/prompt
- Reload path: `reloadFromDisk.ts` → parse markdown → set Tiptap content

**Markdown-coupled logic (src/utils/reloadFromDisk.ts):**
```tsx
const parsed = parseMarkdown(newContent);
setContent(parsed); // Tiptap-specific
```

**Action for Phase 1A:** Make reload generic:
```tsx
const format = registry.getFormat(path);
const parsed = format.parser(newContent);
format.adapter.setContent(parsed);
```

---

### 9. Tab kind labeling — where is "kind" exposed in UI?

**Current state:** No per-tab "kind" field exists. The tab title is computed from filename:
- `src/components/Tabs/TitleBar.tsx` renders `tabTitle` from `useTabStore((s) => s.getActiveTab(windowLabel)?.title)`
- Title is set at tab creation: `getTabTitle(filePath)` extracts filename and strips markdown extension

**Where kind info would appear:**
1. **Tab context menu** → "Format: Markdown" (informational)
2. **Status bar** → "Markdown" | "JSON" | "YAML" (already has mode, extend with format)
3. **File icons** → show format-specific icon (not currently done; could be Phase 1B)

**Action for Phase 1A:** Add `kind` to Tab interface:
```tsx
export interface Tab {
  id: string;
  filePath: string | null;
  title: string;
  isPinned: boolean;
  kind?: FormatId; // "markdown" | "json" | "yaml" | etc.
}
```

Derive kind from path on tab creation. UI components (status bar, context menu) can then reference this without re-computing.

---

### 10. Tiptap lifecycle hooks — markdown-specific onCreate/onUpdate

**File:** `src/components/Editor/TiptapEditor.tsx`

| Hook | Line | Markdown-specific behavior | Migration |
|------|------|---------------------------|-----------|
| `onCreate` | ~line 300 | Deserialize document content from `documentStore` (markdown parse). Register flusher for on-demand serialization. | Move to markdown format adapter. Generic `<SplitPaneEditor>` doesn't call editor lifecycle hooks directly; each format adapter does. |
| `onUpdate` | ~line 320 | Serialize Tiptap transaction back to markdown, debounced. Write to `documentStore`. | Markdown adapter internal. |
| `onSelectionUpdate` | ~line 340 | Update cursor info store and publish tiptap context. | Keep in `<SplitPaneEditor>` as generic lifecycle, but route context publishing to format adapter. |
| `onDestroy` (implicit) | ~line 360 | Clear flusher registration. | Markdown adapter cleanup. |

**Action for Phase 1A:** Tiptap lifecycle stays unchanged but is **wrapped by a format adapter**:
```tsx
<MarkdownFormatAdapter>
  <TiptapEditorInner onCreate={...} onUpdate={...} />
</MarkdownFormatAdapter>
```

The outer adapter handle content parse/serialize; Tiptap only deals with ProseMirror transactions.

---

## Files that must move into format adapters

### Markdown adapter receives:
- `useEditorStore` (sourceMode, showLineNumbers, wordWrap) — becomes internal state
- `useLargeFileSessionStore` (forcedSourceTabs) — moved to adapter's mode selector
- `useSettingsStore` (markdown.*, advanced.keepBothEditorsAlive) — scoped to `markdown.*`
- TiptapEditor lifecycle (onCreate, onUpdate, onSelectionUpdate, onDestroy)
- Menu adapters: `wysiwygAdapter.ts`, `sourceAdapter.ts` (entire modules; or wrapped via format dispatch layer)
- Search routing: Tiptap find + CodeMirror find dispatch
- Save filters: `MARKDOWN_FILTERS` in `closeSave.ts` → `markdown.saveDialogFilters` in adapter config

### Format adapters new (not yet exist):
- YAML (genie + GitHub Actions workflows)
- JSON
- TOML
- Plain text (read-only or editable)
- SVG (read-only)
- Mermaid (read-only)
- HTML (read-only, sandboxed)

---

## Files that stay registry-agnostic

- `App.tsx` — renders `<Editor />` without format knowledge
- `Sidebar.tsx` — file explorer; oblivious to format
- `StatusBar.tsx` — can be extended with format label but no format dispatch
- `FindBar.tsx` — dispatches to editor, which is now format-aware (change is in Editor, not here)
- `useSearchCommands.ts` — dispatcher; stays unchanged (delegates to Editor)
- `useExternalFileChanges.ts` — listens to file changes; stays unchanged (delegates reload to Editor)
- `tabStore.ts` — tab metadata; can add `kind` field but logic stays generic

---

## Estimated PR breakdown for Phase 1A

**Total estimated: 7–9 atomic PRs, ~3–4 week sprint**

1. **PR 1: Registry + types scaffold** (3–4 days)
   - Add `src/lib/formats/registry.ts` with `FormatConfig` type
   - Define markdown entry; stub JSON, YAML, others as read-only placeholders
   - Export `getFormat(path)`, `listFormats()`, `isKindChangePointTrigger(oldFormat, newFormat)`
   - Tests: registry lookup, list iteration

2. **PR 2: Tab store extension + tab creation refactor** (2–3 days)
   - Add `Tab.kind` field
   - Derive `kind` from path in `createTab()`, `createUntitledTab()`
   - Update `updateTabPath()` to recompute kind on rename/save-as
   - Tests: tab creation with kind, path-to-kind resolution

3. **PR 3: Editor.tsx → SplitPaneEditor wrapper** (4–5 days)
   - Extract conditional mount logic into new `<SplitPaneEditor kind={kind} />` component
   - Keep Editor.tsx as dispatcher; SplitPaneEditor as presentational
   - Add `useFormatConfig()` hook that reads tab and registry
   - Update menu command to dispatch via format (temporary: still markdown-only)
   - Tests: SplitPaneEditor mount branches, keepAlive logic

4. **PR 4: useUnifiedMenuCommands format routing** (4–5 days)
   - Add `supports.markdown` to ACTION_DEFINITIONS (or per-format capability)
   - Create format dispatcher wrapper around menu event listener
   - Routes menu event → format dispatcher → adapter action
   - Markdown adapter still uses existing wysiwygAdapter + sourceAdapter
   - Tests: menu event routing, capability checks, markdown dispatch

5. **PR 5: Store scoping — settings, large-file** (3–4 days)
   - Move `useEditorStore.sourceMode` read into markdown format adapter
   - Remove `useLargeFileSessionStore` from Editor.tsx; move to TiptapEditor lifecycle hook
   - Update settings store key from `markdown.*` to `formats.markdown.*`
   - Tests: store reads in markdown adapter, settings namespace

6. **PR 6: Search + content search registry scope** (3–4 days)
   - Extract search routing into `dispatchSearch(format, query)` function
   - Content search: replace MARKDOWN_EXTENSIONS with `registry.listFormats().filter(f => f.searchable)`
   - Update drag-drop extension allow-list generator
   - Tests: search dispatch, content search scope generation

7. **PR 7: Side-panel registry + dispatch** (3–4 days)
   - Add `sidePanel?: PanelDescriptor` to FormatConfig
   - Create `<SidePanelDispatcher tabId={tabId} />` component
   - Move WorkflowSidePanel and GhaWorkflowSidePanel into markdown format config
   - Tests: panel registry lookup, panel mount/unmount

8. **PR 8: Reload + save filters generic** (2–3 days)
   - Move markdown parse/serialize out of global reloadFromDisk.ts
   - Add `format.serializer(content) → string` to FormatConfig
   - Update save dialog filters to use `format.saveDialogFilters`
   - Tests: format-aware reload, save dialog filter generation

9. **PR 9: Cross-format integration test + format adapter scaffold** (3–4 days)
   - E2E test: open markdown, switch mode, open YAML, verify correct adapter mounted
   - Create stub adapters for JSON, YAML (source-only)
   - Verify menu dispatch disables markdown-only actions in non-markdown tabs
   - Tests: tab kind change, adapter swap, menu capability filtering

---

## Key risks and mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `useUnifiedMenuCommands` dispatcher becomes bottleneck if not refactored early (PR 4) | High | Schedule PR 4 immediately after PR 1 (registry). No dependent PRs can proceed without format routing in place. |
| Settings namespace collision (`markdown.*` vs `formats.markdown.*`) | Medium | Add migration path in settings load (Phase 1B). Use feature flag to toggle namespace until all adapters updated. |
| Large-file forced-source removal breaks undo history if not coordinated with markdown adapter | Medium | PR 5 coordinates with TiptapEditor.tsx:onCreate. Flusher registration stays in TiptapEditor; only the large-file *detection* moves to adapter. |
| Content search inclusion list explodes if all formats marked `searchable` | Low | ADR-9 bounds scope: only "text-like" formats (markdown, txt, json, yaml, toml, html, svg, mmd). Explicitly exclude code. Document in registry. |
| Tab kind change (markdown → JSON) loses undo history — UI surprise | Medium | ADR-10: reset undo, keep dirty state, show toast. Test this explicitly in PR 2. |

---

## Summary: coordination surface inventory

**13 coordination surfaces identified:**
1. Direct mount sites (App.tsx, Editor.tsx internal branch)
2. Store dependencies (5 stores, 3 markdown-coupled)
3. Menu handler dispatch (11 markdown-only actions, 2 markdown-flagged)
4. Rendering branches (sourceMode conditional)
5. Side-panel lifecycle (2 panels, both markdown-coupled)
6. Search wiring (3 hooks, 1 markdown-coupled scope)
7. Large-file forced-source (forced-source flag + mode override)
8. External reload (markdown parse/serialize)
9. Tab kind labeling (new field to add)
10. Tiptap lifecycle hooks (4 hooks, all markdown-coupled)
11. Format registry contract (new, enables PR 1)
12. Format adapter dispatcher (new, enables menu routing)
13. Content search scope (hardcoded extension list)

**Long pole is PR 4 (menu dispatch refactor).** All other PRs can proceed in parallel once PR 1 (registry) lands, but menu routing blocks validation of actions in non-markdown tabs.


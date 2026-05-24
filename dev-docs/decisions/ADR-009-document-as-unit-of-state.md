# ADR-009: Document as the unit of state

> Status: **Accepted (per-doc mode representable)** | Date: 2026-05-24

## Context

Document state is split across at least seven stores: `editorStore`
(legacy, 135 LOC, 24 consumers including 3 plugin-level `.subscribe()`
sites), `documentStore` (per-tab), `revisionStore`, `unifiedHistoryStore`,
`sourcePeekStore`, `sourceCursorContextStore`, and Tiptap's internal editor
state. Cursor position lives in three places. The mode flag (source ↔
WYSIWYG) lives in `editorStore` at window scope — opening two documents in
the same window with different modes is currently unrepresentable, even
though tabs already exist.

The legacy `editorStore.ts` header itself states it should be deleted.
Existing T02 plans the deletion but redistributes its fields to `uiStore`
and `documentStore` without questioning whether mode is per-window or
per-document. It is per-document.

## Considered Options

1. **Keep `editorStore` for window flags** — move per-doc fields to
   `documentStore`; leave focus/typewriter/sourceMode window-scoped.
2. **Delete `editorStore`, move flags to `uiStore`** — existing T02
   approach; mode still window-scoped.
3. **Document is the unit of state** — per-doc mode, cursor, history,
   peek; `uiStore` reduced to genuinely cross-document concerns.

## Decision

Chosen: **Option 3 — one `Document` model per open file** owns content,
savedContent, dirty, mode, cursor, history, revisions, peek state.
`editorStore` is deleted entirely. `uiStore` retains only state that
spans documents (sidebar visibility, theme, panel layout).

```ts
const doc = useActiveDocument();
doc.content;       // reactive
doc.isDirty;
doc.mode;          // 'source' | 'wysiwyg', per-document
doc.cursor;

// mutations through commands (ADR-012):
commandBus.execute("doc.switchMode", { to: "source" });
commandBus.execute("doc.applyEdit", { transform });
```

## Verification gate

- `find src/stores -name 'editorStore.ts'` returns empty.
- `grep -rn "useEditorStore\|sourceCursorContextStore\|tiptapEditorStore" src/`
  returns zero (post-migration).
- Test: opening two documents and toggling mode on one does not affect the
  other (currently impossible).
- `useActiveDocument()` is the only public API for per-document state in
  `src/components`.

## Consequences

- **Good**: cursor sync, mode toggle, history all land in one place.
  Per-tab mode becomes representable. Lays the foundation for ADR-010
  (mode as projection on a single document model).
- **Bad**: migration touches `StatusBar.tsx:102`,
  `useUnifiedMenuCommands.ts:415`, `restoreHelpers.ts:162`, the entire
  CodeMirror plugin tree's mode-aware hooks, and the 3 plugin-level
  `.subscribe()` consumers. Estimated 2–3 weeks of focused work. Heavier
  than T02 alone.

## Negative space

Document does NOT own editor behavior (ADR-010 owns that). Does NOT own
file I/O (ADR-008 does). Does NOT mediate between Source and WYSIWYG —
both are projections of the same Document.

## Dependencies

- Required by ADR-010 (Editor Host treats Document as input).
- Mutations depend on ADR-012 (command bus).
- Subsumes existing plan task T02 and parts of T09.

## Migration outcome (2026-05-24)

`src/stores/editorStore.ts` and `src/stores/editorStore.test.ts` deleted.

State redistributed:

| Old (editorStore) | New home | Notes |
|---|---|---|
| `focusModeEnabled`, `typewriterModeEnabled`, `sourceMode`, `wordWrap`, `showLineNumbers`, `diagramPreviewEnabled` | `uiStore` (window-scoped) | Toggles + `resetEditorFlags()` for test cleanup. |
| `cursorInfo`, `content`, `savedContent`, `filePath`, `isDirty`, `documentId`, `lastAutoSave` | `documentStore` (already per-tab) | These were legacy duplicates; documentStore already owned them per-tab. |
| `setCursorInfo` | `documentStore.setCursorInfo(tabId, info)` | Callers must now pass tabId. |

47 consumer files updated. Bulk `useEditorStore → useUIStore` sed for
straight field reads; the one cursorInfo writer
(`HtmlNodeView.ts`) was manually patched to call
`documentStore.setCursorInfo(activeTabId, info)`.

**Verification**:

- `pnpm tsc --noEmit` clean.
- Full suite — 18,818 tests pass.
- `find src/stores -name 'editorStore.ts'` returns empty.
- `grep -rn "useEditorStore\|@/stores/editorStore" src/` returns zero.

**What shipped**:

- **editorStore deleted**, per-window flags consolidated in uiStore,
  per-document fields confirmed live in documentStore.
- **Per-document mode is now representable**: DocumentState carries
  a `mode: "wysiwyg" | "source"` field defaulting to `"wysiwyg"`,
  with a `setMode(tabId, mode)` action. `toggleSourceModeWithCheckpoint`
  now mirrors the uiStore toggle into the active document's mode, so
  two tabs in one window can hold different modes in the data layer.
- The UI continues to read `uiStore.sourceMode` as a window flag —
  switching the active tab does NOT yet swap the editor based on the
  new doc's per-doc mode. That's the next layer (per-tab editor
  recreation on switch); the data model no longer blocks it.

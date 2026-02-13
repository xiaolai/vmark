# MCP Tools Reference

This page documents all MCP tools available when Claude (or other AI assistants) connects to VMark.

VMark exposes **77 tools** across 18 categories — from high-level section editing to low-level AST manipulation. All tools are always available; no configuration needed.

::: tip Recommended Workflow
For most writing tasks, you only need a handful of tools:

**Understand:** `get_document_digest`, `document_search`
**Read:** `get_section`, `read_paragraph`, `document_get_content`
**Write:** `update_section`, `insert_section`, `write_paragraph`, `smart_insert`
**Control:** `editor_undo`, `editor_redo`, `suggestion_accept`, `suggestion_reject`
**Files:** `workspace_save_document`, `tabs_switch`, `tabs_list`

The remaining tools provide fine-grained control for advanced automation scenarios.
:::

---

## Document Tools

Tools for reading and writing document content.

### document_get_content

Get the full document content as markdown text.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. Defaults to focused window. |

**Returns:** The complete document content in markdown format.

### document_set_content

Replace the entire document content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | Yes | New document content (markdown supported). |
| `windowId` | string | No | Window identifier. |

::: warning Empty Documents Only
For safety, this tool is only allowed when the target document is **empty**. If the document has existing content, an error is returned.

For non-empty documents, use `document_insert_at_cursor`, `apply_diff`, or `selection_replace` instead. These tools create suggestions that require user approval.
:::

### document_insert_at_cursor

Insert text at the current cursor position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | Text to insert (markdown supported). |
| `windowId` | string | No | Window identifier. |

**Returns:** `{ message, position, suggestionId?, applied }`

::: tip Markdown Support
The `text` parameter supports markdown syntax. Content like `# Heading`, `**bold**`, `- list items`, and `` `code` `` will be parsed and rendered as rich formatted content.
:::

- `suggestionId` - Present when edit is staged (auto-approve disabled). Use with `suggestion_accept` to apply.
- `applied` - `true` if immediately applied, `false` if staged as suggestion.

::: tip Suggestion System
By default, this tool creates a **suggestion** that requires user approval. The text appears as ghost text preview. Users can accept (Enter) or reject (Escape) the suggestion. This preserves undo/redo integrity.

If **Auto-approve edits** is enabled in Settings → Integrations, changes are applied immediately without preview.
:::

### document_insert_at_position

Insert text at a specific character position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | Text to insert (markdown supported). |
| `position` | number | Yes | Character position (0-indexed). |
| `windowId` | string | No | Window identifier. |

**Returns:** `{ message, position, suggestionId?, applied }`

### document_search

Search for text in the document.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Text to search for. |
| `caseSensitive` | boolean | No | Case-sensitive search. Default: false. |
| `windowId` | string | No | Window identifier. |

**Returns:** Array of matches with positions and line numbers.

### document_replace_in_source

Replace text at the markdown source level, bypassing ProseMirror node boundaries. Use when `apply_diff` returns "No matches found" because the search text spans formatting boundaries (e.g. partially bold text).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search` | string | Yes | Text to find in the markdown source. |
| `replace` | string | Yes | Replacement text (markdown supported). |
| `all` | boolean | No | Replace all occurrences. Default: false. |
| `windowId` | string | No | Window identifier. |

**Returns:** `{ count, message, suggestionIds?, applied }`

- `count` - Number of replacements made.
- `suggestionIds` - Array of suggestion IDs when edits are staged (auto-approve disabled).
- `applied` - `true` if immediately applied, `false` if staged as suggestions.

::: tip When to use
Use `apply_diff` first — it's faster and more precise. Fall back to `document_replace_in_source` only when the search text crosses formatting boundaries (bold, italic, links, etc.) and `apply_diff` can't find it.

**Important:** The `search` string must match the raw markdown source, including syntax markers like `**` for bold, `_` for italic, `[]()` for links, etc. Use `document_get_content` to see the exact markdown source before searching.
:::

---

## Selection Tools

Tools for working with text selection and cursor.

### selection_get

Get the current text selection.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

**Returns:** `{ text, from, to, isEmpty }`

### selection_set

Set the selection range.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `from` | number | Yes | Start position (inclusive). |
| `to` | number | Yes | End position (exclusive). |
| `windowId` | string | No | Window identifier. |

::: tip
Use the same value for `from` and `to` to position the cursor without selecting text.
:::

### selection_replace

Replace selected text with new text.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | Replacement text (markdown supported). |
| `windowId` | string | No | Window identifier. |

**Returns:** `{ message, range, originalContent, suggestionId?, applied }`

::: tip Suggestion System
By default, this tool creates a **suggestion** that requires user approval. The original text appears with strikethrough, and the new text appears as ghost text. Users can accept (Enter) or reject (Escape) the suggestion.

If **Auto-approve edits** is enabled in Settings → Integrations, changes are applied immediately without preview.
:::

### cursor_get_context

Get text surrounding the cursor for context understanding, including block type information.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `linesBefore` | number | No | Lines before cursor. Default: 3. |
| `linesAfter` | number | No | Lines after cursor. Default: 3. |
| `windowId` | string | No | Window identifier. |

**Returns:** `{ before, after, currentLine, currentParagraph, block }`

The `block` object contains:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Block type: `paragraph`, `heading`, `codeBlock`, `blockquote`, etc. |
| `level` | number | Heading level 1-6 (only for headings) |
| `language` | string | Code language (only for code blocks with language set) |
| `inList` | string | List type if inside a list: `bullet`, `ordered`, or `task` |
| `inBlockquote` | boolean | `true` if inside a blockquote |
| `inTable` | boolean | `true` if inside a table |
| `position` | number | Document position where the block starts |

### cursor_set_position

Set the cursor position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `position` | number | Yes | Character position (0-indexed). |
| `windowId` | string | No | Window identifier. |

---

## Formatting Tools

Tools for applying text formatting.

### format_toggle

Toggle a formatting mark on the current selection.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mark` | string | Yes | Mark type: `bold`, `italic`, `code`, `strike`, `underline`, `highlight` |
| `windowId` | string | No | Window identifier. |

### format_set_link

Create a hyperlink on the selected text.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `href` | string | Yes | Link URL. |
| `title` | string | No | Link title (tooltip). |
| `windowId` | string | No | Window identifier. |

### format_remove_link

Remove hyperlink from the selection.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

### format_clear

Remove all formatting from the selection.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

---

## Block Tools

Tools for managing block-level elements.

### block_set_type

Convert the current block to a specific type.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | Yes | Block type: `paragraph`, `heading`, `codeBlock`, `blockquote` |
| `level` | number | No | Heading level 1-6 (required for `heading`). |
| `language` | string | No | Code language (for `codeBlock`). |
| `windowId` | string | No | Window identifier. |

### block_insert_horizontal_rule

Insert a horizontal rule (`---`) at the cursor.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

---

## List Tools

Tools for managing lists.

### list_toggle

Toggle list type on the current block.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | Yes | List type: `bullet`, `ordered`, `task` |
| `windowId` | string | No | Window identifier. |

### list_indent

Increase indentation of the current list item.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

### list_outdent

Decrease indentation of the current list item.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

---

## Table Tools

Tools for creating and editing tables.

### table_insert

Insert a new table at the cursor.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `rows` | number | Yes | Number of rows (must be at least 1). |
| `cols` | number | Yes | Number of columns (must be at least 1). |
| `withHeaderRow` | boolean | No | Whether to include a header row. Default: true. |
| `windowId` | string | No | Window identifier. |

### table_delete

Delete the table at the cursor position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

::: tip Use `table_modify` for row/column operations
To add rows, delete columns, toggle headers, or update cells, use [`table_modify`](#table_modify). It handles all table structure changes in a single atomic operation.
:::

---

## Editor Tools

Tools for editor state and actions.

### editor_undo

Undo the last action.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

### editor_redo

Redo the last undone action.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

### editor_focus

Focus the editor (bring it to front).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

---

## VMark Special Tools

VMark-specific features for math, diagrams, and CJK text.

### insert_math_inline

Insert inline LaTeX math.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `latex` | string | Yes | LaTeX expression (e.g., `E = mc^2`). |
| `windowId` | string | No | Window identifier. |

### insert_math_block

Insert a block-level math equation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `latex` | string | Yes | LaTeX expression. |
| `windowId` | string | No | Window identifier. |

### insert_mermaid

Insert a Mermaid diagram.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | Yes | Mermaid diagram code. |
| `windowId` | string | No | Window identifier. |

**Example:**
```
flowchart TD
    A[Start] --> B[Process]
    B --> C[End]
```

### insert_markmap

Insert a Markmap mindmap. Uses standard Markdown headings to define the tree.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | Yes | Markdown with headings defining the mindmap tree. |
| `windowId` | string | No | Window identifier. |

**Example:**
```markdown
# Project

## Research
### Papers
### Interviews

## Development
### Frontend
### Backend
```

### insert_svg

Insert an SVG graphic. The SVG renders inline with pan, zoom, and PNG export.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | Yes | SVG markup (valid XML with `<svg>` root). |
| `windowId` | string | No | Window identifier. |

**Example:**
```xml
<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="100" rx="10" fill="#4a6fa5"/>
  <text x="100" y="55" text-anchor="middle" fill="white"
        font-size="18" font-family="system-ui">Hello SVG</text>
</svg>
```

### insert_wiki_link

Insert a wiki-style link.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | string | Yes | Link target (page name). |
| `displayText` | string | No | Display text (if different from target). |
| `windowId` | string | No | Window identifier. |

**Result:** `[[target]]` or `[[target|displayText]]`

### cjk_punctuation_convert

Convert punctuation between half-width and full-width.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `direction` | string | Yes | `to-fullwidth` or `to-halfwidth`. |
| `windowId` | string | No | Window identifier. |

### cjk_spacing_fix

Add or remove spacing between CJK and Latin characters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `add` or `remove`. |
| `windowId` | string | No | Window identifier. |

---

## Workspace Tools

Tools for managing windows and documents.

### workspace_list_windows

List all open VMark windows.

**Returns:** Array of `{ label, title, filePath, isFocused, isAiExposed }`

### workspace_get_focused

Get the focused window's label.

**Returns:** Window label string.

### workspace_focus_window

Focus a specific window.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | Yes | Window label to focus. |

### workspace_new_document

Create a new empty document.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | No | Optional document title. |

### workspace_open_document

Open a document from the filesystem.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | File path to open. |

### workspace_save_document

Save the current document.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

### workspace_save_document_as

Save the document to a new path.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | New file path. |
| `windowId` | string | No | Window identifier. |

### workspace_get_document_info

Get document metadata.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

**Returns:** `{ filePath, isDirty, title, wordCount, charCount }`

### workspace_close_window

Close a window.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window to close. Defaults to focused. |

### workspace_list_recent_files

List recently opened files.

**Returns:** Array of `{ path, name, timestamp }` (up to 10 files, most recent first).

Useful for quickly accessing previously edited documents without knowing their full paths.

### workspace_get_info

Get information about the current workspace state.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

**Returns:** `{ isWorkspaceMode, rootPath, workspaceName }`

- `isWorkspaceMode` - `true` if a folder was opened, `false` for single-file mode.
- `rootPath` - The workspace root directory path (null if not in workspace mode).
- `workspaceName` - The folder name (null if not in workspace mode).

### workspace_reload_document

Reload the active document from disk. Use after editing the file externally (e.g. with sed or a script) to pick up changes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `force` | boolean | No | Force reload even if document has unsaved changes. Default: false. |
| `windowId` | string | No | Window identifier. |

**Returns:** Success message with the reloaded file path.

Fails if:
- The document is untitled (no file path on disk).
- The document has unsaved changes and `force` is not `true`. Save first with `workspace_save_document` or pass `force: true`.

---

## Tab Management Tools

Tools for managing tabs within windows.

### tabs_list

List all tabs in a window.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

**Returns:** Array of `{ id, title, filePath, isDirty, isActive }`

### tabs_switch

Switch to a specific tab.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tabId` | string | Yes | Tab ID to switch to. |
| `windowId` | string | No | Window identifier. |

### tabs_close

Close a tab.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tabId` | string | No | Tab ID to close. Defaults to active tab. |
| `windowId` | string | No | Window identifier. |

### tabs_create

Create a new empty tab.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

**Returns:** `{ tabId }`

### tabs_get_info

Get detailed tab information.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tabId` | string | No | Tab ID. Defaults to active tab. |
| `windowId` | string | No | Window identifier. |

**Returns:** `{ id, title, filePath, isDirty, isActive }`

### tabs_reopen_closed

Reopen the most recently closed tab.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

**Returns:** `{ tabId, filePath, title }` or `"No closed tabs to reopen"` if none available.

VMark keeps track of the last 10 closed tabs per window. Use this to restore accidentally closed tabs.

---

## AI Suggestion Tools

Tools for managing AI-generated content suggestions. When AI uses `document_insert_at_cursor`, `document_insert_at_position`, `document_replace_in_source`, `selection_replace`, `apply_diff`, or `batch_edit`, the changes are staged as suggestions that require user approval.

::: info Undo/Redo Safety
Suggestions don't modify the document until accepted. This preserves full undo/redo functionality - users can undo after accepting, and rejecting leaves no trace in history.
:::

::: tip Auto-Approve Mode
If **Auto-approve edits** is enabled in Settings → Integrations, these tools apply changes directly without creating suggestions. The suggestion management tools below are only needed when auto-approve is disabled (the default).
:::

### suggestion_list

List all pending suggestions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

**Returns:** `{ suggestions: [...], count, focusedId }`

Each suggestion includes:
- `id` - Unique identifier
- `type` - `insert`, `replace`, or `delete`
- `from`, `to` - Document positions
- `newContent` - Content to be inserted (for insert/replace)
- `originalContent` - Content being modified (for replace/delete)

### suggestion_accept

Accept a specific suggestion, applying its changes to the document.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `suggestionId` | string | Yes | ID of the suggestion to accept. |
| `windowId` | string | No | Window identifier. |

### suggestion_reject

Reject a specific suggestion, discarding it without changes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `suggestionId` | string | Yes | ID of the suggestion to reject. |
| `windowId` | string | No | Window identifier. |

### suggestion_accept_all

Accept all pending suggestions in document order.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

### suggestion_reject_all

Reject all pending suggestions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

---

## Protocol Tools

Tools for querying server capabilities and document state.

### get_capabilities

Get the MCP server's capabilities and available tools.

**Returns:** `{ version, tools[], resources[], features }`

### get_document_revision

Get the current document revision for optimistic locking.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

**Returns:** `{ revision, hash, timestamp }`

Use the revision in mutation tools to detect concurrent edits.

---

## Structure Tools

Tools for analyzing and navigating document structure.

### get_document_ast

Get the document's abstract syntax tree.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

**Returns:** Full AST with node types, positions, and content.

### get_document_digest

Get a compact digest of the document structure.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

**Returns:** `{ sections[], headingCount, paragraphCount, wordCount }`

### list_blocks

List all blocks in the document with their node IDs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | No | Filter by block type. |
| `windowId` | string | No | Window identifier. |

**Returns:** Array of `{ nodeId, type, level?, content, position }`

Node IDs use prefixes: `h-0` (heading), `p-0` (paragraph), `code-0` (code block), etc.

### resolve_targets

Resolve node IDs or queries to document positions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `targets` | string[] | Yes | Node IDs or queries to resolve. |
| `windowId` | string | No | Window identifier. |

**Returns:** Array of `{ target, found, from?, to?, type? }`

### get_section

Get content of a document section (heading and its content until next same-or-higher level heading).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | Node ID of the heading (e.g., `h-0`). |
| `windowId` | string | No | Window identifier. |

**Returns:** `{ nodeId, level, title, content, from, to }`

---

## Advanced Mutation Tools

Precision tools for AI agents that need deterministic, position-aware edits.

### batch_edit

Apply multiple operations atomically.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operations` | array | Yes | Array of operations to apply. |
| `baseRevision` | string | No | Expected revision for conflict detection. |
| `mode` | string | No | `apply`, `suggest`, or `dryRun`. Default: `suggest`. |
| `windowId` | string | No | Window identifier. |

Each operation requires:
- `type`: `update`, `insert`, `delete`, `format`, or `move`
- `nodeId`: Target node ID (required for update/delete/format/move)
- `after`: Node ID to insert after (for insert operations)
- `text`/`content`: New content

**Returns:** `{ success, changedNodeIds[], suggestionIds[] }`

### apply_diff

Find and replace text with match policy control.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `original` | string | Yes | Text to find. |
| `replacement` | string | Yes | Text to replace with. |
| `matchPolicy` | string | No | `first`, `all`, `nth`, or `error_if_multiple`. Default: `first`. |
| `nth` | number | No | Which match to replace (0-indexed, for `nth` policy). |
| `mode` | string | No | `apply`, `suggest`, or `dryRun`. Default: `suggest`. |
| `windowId` | string | No | Window identifier. |

**Returns:** `{ matchCount, appliedCount, matches[], suggestionIds[] }`

### replace_text_anchored

Replace text using context anchoring for precise targeting.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `anchor` | object | Yes | `{ text, beforeContext, afterContext }` |
| `replacement` | string | Yes | Replacement text. |
| `mode` | string | No | `apply`, `suggest`, or `dryRun`. Default: `suggest`. |
| `windowId` | string | No | Window identifier. |

The anchor's context fields help disambiguate when the same text appears multiple times.

---

## Section Tools

Tools for manipulating document sections (heading + content).

### update_section

Update a section's content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | Heading node ID. |
| `content` | string | Yes | New section content (markdown). |
| `mode` | string | No | `apply`, `suggest`, or `dryRun`. |
| `windowId` | string | No | Window identifier. |

### insert_section

Insert a new section.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `after` | string | Yes | Node ID to insert after. |
| `level` | number | Yes | Heading level (1-6). |
| `title` | string | Yes | Section heading text. |
| `content` | string | No | Section body content. |
| `mode` | string | No | `apply`, `suggest`, or `dryRun`. |
| `windowId` | string | No | Window identifier. |

### move_section

Move a section to a new location.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | Section to move. |
| `after` | string | Yes | Node ID to move after. |
| `mode` | string | No | `apply`, `suggest`, or `dryRun`. |
| `windowId` | string | No | Window identifier. |

---

## Batch Operation Tools

Tools for complex table and list modifications.

### table_modify

Batch modify a table's structure and content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | Table node ID. |
| `operations` | array | Yes | Array of table operations. |
| `windowId` | string | No | Window identifier. |

Operations: `setCellContent`, `addRow`, `deleteRow`, `addColumn`, `deleteColumn`, `setHeaderRow`

### list_modify

Batch modify a list's structure and content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | List node ID. |
| `operations` | array | Yes | Array of list operations. |
| `windowId` | string | No | Window identifier. |

Operations: `setItemContent`, `addItem`, `deleteItem`, `indent`, `outdent`, `setChecked`

---

## Paragraph Tools

Tools for working with flat documents without headings. Complements Section Tools for structured documents.

### read_paragraph

Read a paragraph from the document by index or content match.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | object | Yes | How to identify the paragraph. |
| `includeContext` | boolean | No | Include surrounding paragraphs. Default: false. |
| `windowId` | string | No | Window identifier. |

**Target options:**
- `{ index: 0 }` — Paragraph by 0-indexed position
- `{ containing: "text" }` — First paragraph containing the text

**Returns:** `{ index, content, wordCount, charCount, position, context? }`

### write_paragraph

Modify a paragraph in the document.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `baseRevision` | string | Yes | Document revision for conflict detection. |
| `target` | object | Yes | How to identify the paragraph. |
| `operation` | string | Yes | Operation: `replace`, `append`, `prepend`, `delete`. |
| `content` | string | Conditional | New content (required except for `delete`). |
| `mode` | string | No | `apply` or `suggest`. Default: `suggest`. |
| `windowId` | string | No | Window identifier. |

**Returns:** `{ success, message, suggestionId?, applied, newRevision? }`

### smart_insert

Insert content at common document locations. A unified tool for intuitive insertion scenarios.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `baseRevision` | string | Yes | Document revision for conflict detection. |
| `destination` | varies | Yes | Where to insert (see options below). |
| `content` | string | Yes | Markdown content to insert. |
| `mode` | string | No | `apply` or `suggest`. Default: `suggest`. |
| `windowId` | string | No | Window identifier. |

**Destination options:**
- `"end_of_document"` — Insert at the end
- `"start_of_document"` — Insert at the beginning
- `{ after_paragraph: 2 }` — Insert after paragraph at index 2
- `{ after_paragraph_containing: "conclusion" }` — Insert after paragraph containing text
- `{ after_section: "Introduction" }` — Insert after section heading

**Returns:** `{ success, message, suggestionId?, applied, newRevision?, insertedAt? }`

::: tip When to Use
- **Structured documents** (with headings): Use `get_section`, `update_section`, `insert_section`
- **Flat documents** (no headings): Use `read_paragraph`, `write_paragraph`, `smart_insert`
- **End of document**: Use `smart_insert` with `"end_of_document"`
:::

---

## Genie Tools

AI genies are prompt templates stored as markdown files. These tools let AI assistants discover and invoke them.

### list_genies

List all available AI genies from the global genies directory.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

**Returns:** Array of genie entries with `name`, `path`, `source`, and `category`.

### read_genie

Read a specific genie's metadata and template.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | File path of the genie (from `list_genies`). |
| `windowId` | string | No | Window identifier. |

**Returns:** Genie metadata (`name`, `description`, `scope`, `category`, `model`) and `template`.

### invoke_genie

Invoke a genie against the current editor content. The genie template is filled with content based on the scope and sent to the active AI provider. The result appears as an AI suggestion.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `geniePath` | string | Yes | File path of the genie to invoke. |
| `scope` | string | No | Content scope: `selection`, `block`, or `document`. Defaults to `selection`. |
| `windowId` | string | No | Window identifier. |

::: tip Workflow
1. Call `list_genies` to discover available genies
2. Optionally call `read_genie` to inspect a genie's template
3. Call `invoke_genie` to run the genie — the result will appear as an AI suggestion
4. Use `suggestion_accept` or `suggestion_reject` to handle the result
:::

---

## MCP Resources

In addition to tools, VMark exposes these read-only resources:

| Resource URI | Description |
|--------------|-------------|
| `vmark://document/outline` | Document heading hierarchy |
| `vmark://document/metadata` | Document metadata (path, word count, etc.) |
| `vmark://windows/list` | List of open windows |
| `vmark://windows/focused` | Currently focused window label |

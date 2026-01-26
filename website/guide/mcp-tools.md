# MCP Tools Reference

This page documents all MCP tools available when Claude (or other AI assistants) connects to VMark.

## Document Tools

Tools for reading and writing document content.

### document_get_content

Get the full document content as markdown text.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. Defaults to focused window. |

**Returns:** The complete document content in markdown format.

### document_set_content

::: danger Blocked
This tool is **disabled** for AI safety. AI assistants cannot replace the entire document content.

Use `document_insert_at_cursor` or `selection_replace` for content modifications instead. These tools create suggestions that require user approval.
:::

### document_insert_at_cursor

Insert text at the current cursor position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | Text to insert. |
| `windowId` | string | No | Window identifier. |

::: tip Suggestion System
By default, this tool creates a **suggestion** that requires user approval. The text appears as ghost text preview. Users can accept (Enter) or reject (Escape) the suggestion. This preserves undo/redo integrity.

If **Auto-approve edits** is enabled in Settings → Integrations, changes are applied immediately without preview.
:::

### document_insert_at_position

Insert text at a specific character position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | Text to insert. |
| `position` | number | Yes | Character position (0-indexed). |
| `windowId` | string | No | Window identifier. |

### document_search

Search for text in the document.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Text to search for. |
| `caseSensitive` | boolean | No | Case-sensitive search. Default: false. |
| `windowId` | string | No | Window identifier. |

**Returns:** Array of matches with positions and line numbers.

### document_replace

Replace text occurrences in the document.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search` | string | Yes | Text to find. |
| `replace` | string | Yes | Replacement text. |
| `all` | boolean | No | Replace all occurrences. Default: false. |
| `windowId` | string | No | Window identifier. |

**Returns:** Number of replacements made.

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
| `text` | string | Yes | Replacement text. |
| `windowId` | string | No | Window identifier. |

::: tip Suggestion System
By default, this tool creates a **suggestion** that requires user approval. The original text appears with strikethrough, and the new text appears as ghost text. Users can accept (Enter) or reject (Escape) the suggestion.

If **Auto-approve edits** is enabled in Settings → Integrations, changes are applied immediately without preview.
:::

### selection_delete

Delete the selected text.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

::: tip Suggestion System
By default, this tool creates a **suggestion** that requires user approval. The text to be deleted appears with strikethrough. Users can accept (Enter) or reject (Escape) the deletion.

If **Auto-approve edits** is enabled in Settings → Integrations, the deletion is applied immediately without preview.
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

### block_toggle

Toggle block type (converts back to paragraph if same type).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | Yes | Block type to toggle. |
| `level` | number | No | Heading level (for `heading`). |
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

### table_add_row

Add a row to the current table.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `position` | string | Yes | Position: `before` or `after` current row. |
| `windowId` | string | No | Window identifier. |

### table_delete_row

Delete the current row.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

### table_add_column

Add a column to the current table.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `position` | string | Yes | Position: `before` or `after` current column. |
| `windowId` | string | No | Window identifier. |

### table_delete_column

Delete the current column.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

### table_toggle_header_row

Toggle the header row styling.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

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
graph TD
    A[Start] --> B[Process]
    B --> C[End]
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

---

## Tab Management Tools

Tools for managing tabs within windows.

### tabs_list

List all tabs in a window.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

**Returns:** Array of `{ id, title, filePath, isDirty, isActive }`

### tabs_get_active

Get the active tab information.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | No | Window identifier. |

**Returns:** `{ id, title, filePath, isDirty, isActive }`

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

---

## AI Suggestion Tools

Tools for managing AI-generated content suggestions. When AI uses `document_insert_at_cursor`, `document_insert_at_position`, `document_replace`, `selection_replace`, or `selection_delete`, the changes are staged as suggestions that require user approval.

::: info Undo/Redo Safety
Suggestions don't modify the document until accepted. This preserves full undo/redo functionality - users can undo after accepting, and rejecting leaves no trace in history.
:::

::: tip Auto-Approve Mode
If **Auto-approve edits** is enabled in Settings → Integrations, these tools apply changes directly without creating suggestions. The suggestion management tools below are only needed when auto-approve is disabled (the default).
:::

### suggestion_list

List all pending suggestions.

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

### suggestion_reject

Reject a specific suggestion, discarding it without changes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `suggestionId` | string | Yes | ID of the suggestion to reject. |

### suggestion_accept_all

Accept all pending suggestions in document order.

### suggestion_reject_all

Reject all pending suggestions.

---

## MCP Resources

In addition to tools, VMark exposes these read-only resources:

| Resource URI | Description |
|--------------|-------------|
| `vmark://document/outline` | Document heading hierarchy |
| `vmark://document/metadata` | Document metadata (path, word count, etc.) |
| `vmark://windows/list` | List of open windows |
| `vmark://windows/focused` | Currently focused window label |

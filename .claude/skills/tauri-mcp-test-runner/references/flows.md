# Common MCP Flows (VMark)

Use these as entry points; expand with the full guide when needed.

## Basic Flows

- App startup sanity: open app, ensure main window visible.
- Open file: open recent, open from picker, verify content loaded.
- Mode toggle: switch WYSIWYG <-> Source (F7 / Cmd/Ctrl + /).
- Toolbar: invoke format toolbar (Ctrl+E) and verify context.
- Settings: open settings, change a toggle, ensure persists.
- Save: modify content, save, verify dirty flag cleared.

## AI Content Acceptance Pattern

**Critical**: When using vmark MCP tools to insert text (`document_insert_at_cursor`), the content appears as an AI suggestion that must be accepted.

```
1. mcp__vmark__document_insert_at_cursor (text: "Your content")
2. mcp__tauri__tauri_webview_keyboard (action: "press", key: "Enter")  # Accept suggestion
3. mcp__tauri__tauri_webview_keyboard (action: "press", key: "Escape") # Dismiss follow-up
```

## Multi-Paragraph Document Creation

To create a document with multiple paragraphs for testing:

```
# Clear document first
1. tauri_webview_keyboard: Cmd+A (select all)
2. tauri_webview_keyboard: Backspace (delete)

# Add first paragraph
3. vmark document_insert_at_cursor: "First paragraph."
4. tauri_webview_keyboard: Enter (accept AI suggestion)
5. tauri_webview_keyboard: Escape (dismiss follow-up)

# Add second paragraph
6. tauri_webview_keyboard: Enter (create new paragraph)
7. vmark document_insert_at_cursor: "Second paragraph."
8. tauri_webview_keyboard: Enter (accept)
9. tauri_webview_keyboard: Escape (dismiss)

# Repeat for additional paragraphs...
```

## Cursor Context Testing

To verify `cursor_get_context` returns correct block boundaries:

```
1. Create multi-paragraph document (see above)
2. mcp__vmark__cursor_set_position (position: N)  # Position in target paragraph
3. mcp__vmark__cursor_get_context (linesBefore: 3, linesAfter: 3)
4. Verify currentLine matches expected paragraph text
```

Test positions at different paragraphs to confirm block detection works.

## Format Command Testing

To test format toggles (bold, italic, underline, highlight):

```
1. Insert test text and accept it
2. mcp__vmark__selection_set (from: X, to: Y)  # Select text to format
3. mcp__vmark__format_toggle (format: "bold")  # or italic, underline, highlight
4. tauri_webview_screenshot to verify visual change
```

## Port Configuration

- Use the default port 9223 for Tauri MCP.
- Start session: `tauri_driver_session(action: "start")` or `tauri_driver_session(action: "start", port: 9223)`

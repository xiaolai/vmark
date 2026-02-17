---
name: tauri-mcp-test-runner
description: Run Tauri MCP-driven E2E checks for VMark. Use when asked to execute or update automated UI flows that must use Tauri MCP tools (not browser DevTools), or when validating behavior in a running desktop session.
---

# Tauri MCP Test Runner

## Overview
Run VMark end-to-end UI flows using the Tauri MCP tools and summarize results.

## Workflow
1) Confirm the desktop app is running. If not, ask the user to start it.
2) Start MCP session via `mcp__tauri__tauri_driver_session` (action: `start`, port: `9223` or omit for default).
3) List windows (`mcp__tauri__tauri_manage_window` action: `list`) and pick the target window.
4) Execute test flows using the patterns in `references/flows.md`.
5) Capture logs when needed (`mcp__tauri__tauri_read_logs`) and stop the session when done.
6) Report results: passed/failed flows, errors, repro steps, and any follow-up fixes.

## Key Tools

### Tauri MCP Tools (tauri-mcp server)
- `tauri_driver_session` - Start/stop driver session
- `tauri_webview_screenshot` - Capture current state
- `tauri_webview_keyboard` - Send keystrokes (Enter, Escape, shortcuts)
- `tauri_webview_interact` - Click, focus elements
- `tauri_webview_find_element` - Inspect DOM state

### VMark MCP Tools (vmark server)
- `document_insert_at_cursor` - Insert text (appears as AI suggestion)
- `cursor_set_position` - Move cursor to position
- `cursor_get_context` - Get surrounding text context
- `selection_set` / `selection_get` - Manage text selection
- `format_toggle` - Toggle formatting (bold, italic, etc.)

## Critical Pattern: AI Content Acceptance

When using vmark MCP to insert content, it appears as an AI suggestion that must be **accepted with Enter** via tauri-mcp:

```
1. vmark: document_insert_at_cursor("text")
2. tauri: keyboard(action: "press", key: "Enter")   # Accept
3. tauri: keyboard(action: "press", key: "Escape")  # Dismiss follow-up
```

This pattern is required for all content insertion operations.

## References
- Load `references/flows.md` for detailed flow patterns and examples.

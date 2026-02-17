---
name: tauri-mcp-testing
description: E2E testing expert for Tauri applications using Tauri MCP server. Use when testing running Tauri apps - session management, webview interaction, IPC verification, screenshot capture, and debugging. ALWAYS use tauri_* tools, NEVER Chrome DevTools MCP for Tauri apps.
---

# Tauri MCP E2E Testing

**CRITICAL:** For E2E testing of Tauri applications, ALWAYS use `tauri_*` MCP tools. NEVER use Chrome DevTools MCP - that's for browser pages only.

## Quick Reference

| Task | MCP Tool |
|------|----------|
| Connect to app | `tauri_driver_session` |
| Take screenshot | `tauri_webview_screenshot` |
| Find elements | `tauri_webview_find_element` |
| Click/scroll/swipe | `tauri_webview_interact` |
| Type text | `tauri_webview_keyboard` |
| Wait for element | `tauri_webview_wait_for` |
| Execute JS | `tauri_webview_execute_js` |
| Get CSS styles | `tauri_webview_get_styles` |
| Test IPC commands | `tauri_ipc_execute_command` |
| Monitor IPC calls | `tauri_ipc_monitor` |
| Read console logs | `tauri_read_logs` |
| Manage windows | `tauri_manage_window` |

## Prerequisites

1. **MCP Bridge Plugin installed** in the Tauri app
2. **App running** in development mode (`pnpm tauri dev`)
3. **Port 9223** accessible (default MCP Bridge port)

If connection fails, run `tauri_get_setup_instructions` to get plugin installation guide.

## Core Workflow

```
1. START SESSION    → Connect to running Tauri app
2. VERIFY STATE     → Screenshot + find elements
3. INTERACT         → Click, type, scroll
4. WAIT             → Wait for expected results
5. VERIFY           → Check IPC, logs, DOM state
6. CLEANUP          → Stop session when done
```

## Session Management

### Start Session

```typescript
// Connect to app on default port
tauri_driver_session({ action: 'start' })

// Connect to specific port
tauri_driver_session({ action: 'start', port: 9224 })

// Connect to remote host (mobile testing)
tauri_driver_session({ action: 'start', host: '<device-ip>', port: 9223 })
```

### Check Status

```typescript
tauri_driver_session({ action: 'status' })
// Returns: connected apps, default app, identifiers
```

### Stop Session

```typescript
// Stop all sessions
tauri_driver_session({ action: 'stop' })

// Stop specific app
tauri_driver_session({ action: 'stop', appIdentifier: 9223 })
```

## Testing Patterns

### Pattern 1: Visual Verification

```typescript
// 1. Take screenshot to see current state
tauri_webview_screenshot()

// 2. Take screenshot of specific element
tauri_webview_screenshot({ uid: 'editor-content' })

// 3. Save to file for comparison
tauri_webview_screenshot({ filePath: 'dev-docs/archive/test-screenshots/test-screenshot.png' })
```

### Pattern 2: Element Interaction

```typescript
// 1. Find element first
tauri_webview_find_element({ selector: '.save-button' })

// 2. Click element
tauri_webview_interact({ action: 'click', selector: '.save-button' })

// 3. Double-click
tauri_webview_interact({ action: 'double-click', selector: '.editor' })

// 4. Long-press (touch simulation)
tauri_webview_interact({ action: 'long-press', selector: '.item', duration: 500 })

// 5. Scroll
tauri_webview_interact({ action: 'scroll', selector: '.content', scrollY: 500 })

// 6. Swipe
tauri_webview_interact({
  action: 'swipe',
  fromX: 300, fromY: 400,
  toX: 100, toY: 400,
  duration: 300
})
```

### Pattern 3: Keyboard Input

```typescript
// Type into focused element
tauri_webview_keyboard({
  action: 'type',
  selector: '.editor-input',
  text: '# Hello World'
})

// Press key
tauri_webview_keyboard({ action: 'press', key: 'Enter' })

// Key with modifiers
tauri_webview_keyboard({
  action: 'press',
  key: 's',
  modifiers: ['Control']  // Ctrl+S
})

// Key combinations
tauri_webview_keyboard({
  action: 'press',
  key: 'z',
  modifiers: ['Meta', 'Shift']  // Cmd+Shift+Z (redo on macOS)
})
```

### Pattern 4: Wait for State

```typescript
// Wait for element to appear
tauri_webview_wait_for({
  type: 'selector',
  value: '.success-toast',
  timeout: 5000
})

// Wait for text to appear
tauri_webview_wait_for({
  type: 'text',
  value: 'File saved successfully',
  timeout: 3000
})

// Wait for IPC event
tauri_webview_wait_for({
  type: 'ipc-event',
  value: 'file-saved',
  timeout: 5000
})
```

### Pattern 5: IPC Testing

```typescript
// Start monitoring IPC calls
tauri_ipc_monitor({ action: 'start' })

// Perform action that triggers IPC
tauri_webview_interact({ action: 'click', selector: '.save-button' })

// Get captured IPC calls
tauri_ipc_get_captured({ filter: 'save_file' })

// Execute IPC command directly
tauri_ipc_execute_command({
  command: 'get_document_state',
  args: { id: 'doc-123' }
})

// Emit event to test handlers
tauri_ipc_emit_event({
  eventName: 'file-changed',
  payload: { path: '/test/file.md' }
})

// Stop monitoring
tauri_ipc_monitor({ action: 'stop' })
```

### Pattern 6: JavaScript Execution

```typescript
// Get value from DOM (MUST use IIFE for return values)
tauri_webview_execute_js({
  script: '(() => { return document.querySelector(".editor").textContent; })()'
})

// Check Tauri API available
tauri_webview_execute_js({
  script: '(() => { return typeof window.__TAURI__ !== "undefined"; })()'
})

// Get computed style
tauri_webview_execute_js({
  script: '(() => { return getComputedStyle(document.body).backgroundColor; })()'
})

// Trigger custom event
tauri_webview_execute_js({
  script: 'document.dispatchEvent(new CustomEvent("test-event", { detail: { test: true } }))'
})
```

## Debugging

### Read Console Logs

```typescript
// Get recent console logs
tauri_read_logs({ source: 'console', lines: 50 })

// Filter logs
tauri_read_logs({ source: 'console', filter: 'error', lines: 100 })

// Logs since specific time
tauri_read_logs({
  source: 'console',
  since: '2024-01-01T10:00:00Z',
  lines: 50
})
```

### Platform-Specific Logs

```typescript
// Desktop system logs
tauri_read_logs({ source: 'system', lines: 100 })

// Android logcat
tauri_read_logs({ source: 'android', filter: 'vmark', lines: 100 })

// iOS simulator logs
tauri_read_logs({ source: 'ios', lines: 100 })
```

### Window Management

```typescript
// List all windows
tauri_manage_window({ action: 'list' })

// Get window info
tauri_manage_window({ action: 'info', windowId: 'main' })

// Resize window for responsive testing
tauri_manage_window({ action: 'resize', width: 800, height: 600 })

// Resize specific window
tauri_manage_window({
  action: 'resize',
  windowId: 'settings',
  width: 400,
  height: 300
})
```

### Get CSS Styles

```typescript
// Get all computed styles
tauri_webview_get_styles({ selector: '.editor' })

// Get specific properties
tauri_webview_get_styles({
  selector: '.editor',
  properties: ['font-size', 'color', 'background-color']
})

// Get styles from multiple elements
tauri_webview_get_styles({
  selector: '.toolbar button',
  multiple: true,
  properties: ['opacity', 'visibility']
})
```

## Common Test Scenarios

### Scenario: File Operations

```typescript
// 1. Connect
tauri_driver_session({ action: 'start' })

// 2. Open file dialog
tauri_webview_keyboard({ action: 'press', key: 'o', modifiers: ['Control'] })

// 3. Wait for content to load (using IPC)
tauri_ipc_monitor({ action: 'start' })
// ... file selection happens externally or via mocked dialog ...
tauri_ipc_get_captured({ filter: 'read_file' })

// 4. Verify content loaded
tauri_webview_find_element({ selector: '.editor-content' })
tauri_webview_execute_js({
  script: '(() => { return document.querySelector(".editor-content").textContent.length > 0; })()'
})
```

### Scenario: Editor Typing

```typescript
// 1. Focus editor
tauri_webview_interact({ action: 'click', selector: '.editor' })

// 2. Type content
tauri_webview_keyboard({
  action: 'type',
  selector: '.editor [contenteditable]',
  text: '# Test Document\n\nThis is a test.'
})

// 3. Verify dirty state
tauri_webview_find_element({ selector: '[data-dirty="true"]' })

// 4. Save with Ctrl+S
tauri_webview_keyboard({ action: 'press', key: 's', modifiers: ['Control'] })

// 5. Verify saved
tauri_webview_wait_for({ type: 'selector', value: '[data-dirty="false"]' })
```

### Scenario: Responsive Testing

```typescript
// Test mobile viewport
tauri_manage_window({ action: 'resize', width: 375, height: 667 })
tauri_webview_screenshot({ filePath: 'dev-docs/archive/test-screenshots/mobile.png' })
tauri_webview_find_element({ selector: '.mobile-menu-button' })

// Test tablet viewport
tauri_manage_window({ action: 'resize', width: 768, height: 1024 })
tauri_webview_screenshot({ filePath: 'dev-docs/archive/test-screenshots/tablet.png' })

// Test desktop viewport
tauri_manage_window({ action: 'resize', width: 1920, height: 1080 })
tauri_webview_screenshot({ filePath: 'dev-docs/archive/test-screenshots/desktop.png' })
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Connection refused | Ensure app is running with `pnpm tauri dev` |
| No elements found | Check selector, take screenshot to verify DOM |
| IPC not captured | Start monitor BEFORE the action |
| Timeout on wait | Increase timeout, check if element ever appears |
| JS returns undefined | Use IIFE syntax: `(() => { return value; })()` |
| Plugin not found | Run `tauri_get_setup_instructions` |

## Reference Files

| Topic | File |
|-------|------|
| Session management | [references/session-management.md](references/session-management.md) |
| Webview testing | [references/webview-testing.md](references/webview-testing.md) |
| IPC testing | [references/ipc-testing.md](references/ipc-testing.md) |
| Debugging | [references/debugging.md](references/debugging.md) |

## Related Skills
- **`tauri-app-dev`** — General Tauri 2.0 patterns (commands, state, plugins, security)
- **`tauri-v2-integration`** — VMark-specific IPC patterns (invoke/emit bridges, menu accelerators)
- **`rust-tauri-backend`** — VMark Rust backend implementation

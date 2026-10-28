---
name: tauri-mcp-testing
description: E2E testing of a running VMark debug build through the Tauri MCP server - session management, webview interaction, IPC verification, screenshots, logs - and when to use VMark MCP instead. Use when running or updating UI flows in the desktop app. ALWAYS use the mcp__tauri__* tools, NEVER Chrome DevTools MCP.
---

# Tauri MCP E2E Testing (VMark)

**CRITICAL:** VMark is a Tauri app. Drive it with the Tauri MCP tools
(`mcp__tauri__driver_session`, `mcp__tauri__webview_screenshot`, …; this skill
writes them without the `mcp__tauri__` prefix). NEVER use Chrome DevTools MCP.

## Which server tests what

| What is under test | Drive it through |
|---|---|
| Non-AI UI and plumbing: tabs, modes, toolbar, settings, save, find bar | Tauri MCP (`127.0.0.1:9323`, debug builds only) |
| AI features and anything an MCP client does | VMark MCP (`mcp__vmark__session`, `document`, `selection`, `workspace`, `workflow`, `browser`, `browser_read`, `coherence`) |

`pnpm tauri:dev` runs as `app.vmark.dev`, with its own settings and `mcp-port`;
point a VMark MCP client at it with `VMARK_APP_IDENTIFIER=app.vmark.dev`. The
VMark MCP port is dynamic (read from `mcp-port`). The scripted journeys
(`pnpm e2e:journeys`) and their guide are in `e2e/README.md`.

## Running a flow

1. Confirm `pnpm tauri:dev` is running; if not, ask the user to start it.
2. `driver_session({ action: 'start', port: 9323 })`, then
   `manage_window({ action: 'list' })` and pick the target window.
3. Run the flow. VMark MCP calls: `session.get_state` to orient,
   `document.read` before `document.write` (pass `revision` back as
   `expected_revision`), `selection.get`/`selection.set` for targeted edits.
4. Verify with a screenshot, `webview_find_element` or `document.read`; read
   `read_logs` on failure. Stop the session when done.
5. Report each flow as passed or failed, with errors and repro steps.

Common flows: app startup (main window visible); open recent and open from
the picker; WYSIWYG ↔ Source toggle (F7); format toolbar (Ctrl+E); change a
setting and confirm it persists; edit, save, and confirm the dirty flag clears.

## Quick Reference

| Task | MCP Tool |
|------|----------|
| Connect to app | `driver_session` |
| Take screenshot | `webview_screenshot` |
| Find elements | `webview_find_element` |
| Click/scroll/swipe | `webview_interact` |
| Type text | `webview_keyboard` |
| Wait for element | `webview_wait_for` |
| Execute JS | `webview_execute_js` |
| Get CSS styles | `webview_execute_js` with `getComputedStyle` |
| Test IPC commands | `ipc_execute_command` |
| Monitor IPC calls | `ipc_monitor` |
| Read console logs | `read_logs` |
| Manage windows | `manage_window` |

## Prerequisites

1. **MCP Bridge Plugin installed** in the Tauri app
2. **App running** in development mode (`pnpm tauri:dev`)
3. **Port 9323** accessible for VMark automation. VMark pins the debug-only
   Tauri MCP bridge to `127.0.0.1:9323`; port 9223 is VMark's own
   auth-protected MCP server and is not valid for E2E automation.

If connection fails, run `get_setup_instructions` to get plugin installation guide.

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
// Connect to VMark's automation bridge
driver_session({ action: 'start', port: 9323 })

// Connect to specific port
driver_session({ action: 'start', port: 9324 })

// Connect to remote host (mobile testing)
driver_session({ action: 'start', host: '<device-ip>', port: 9323 })
```

### Check Status

```typescript
driver_session({ action: 'status' })
// Returns: connected apps, default app, identifiers
```

### Stop Session

```typescript
// Stop all sessions
driver_session({ action: 'stop' })

// Stop specific app
driver_session({ action: 'stop', appIdentifier: 9323 })
```

## Testing Patterns

### Pattern 1: Visual Verification

```typescript
// 1. Take screenshot to see current state
webview_screenshot()

// 2. Take screenshot of specific element
webview_screenshot({ uid: 'editor-content' })

// 3. Save to file for comparison
webview_screenshot({ filePath: 'dev-docs/archive/test-screenshots/test-screenshot.png' })
```

### Pattern 2: Element Interaction

```typescript
// 1. Find element first
webview_find_element({ selector: '.save-button' })

// 2. Click element
webview_interact({ action: 'click', selector: '.save-button' })

// 3. Double-click
webview_interact({ action: 'double-click', selector: '.editor' })

// 4. Long-press (touch simulation)
webview_interact({ action: 'long-press', selector: '.item', duration: 500 })

// 5. Scroll
webview_interact({ action: 'scroll', selector: '.content', scrollY: 500 })

// 6. Swipe
webview_interact({
  action: 'swipe',
  fromX: 300, fromY: 400,
  toX: 100, toY: 400,
  duration: 300
})
```

### Pattern 3: Keyboard Input

```typescript
// Type into focused element
webview_keyboard({
  action: 'type',
  selector: '.editor-input',
  text: '# Hello World'
})

// Press key
webview_keyboard({ action: 'press', key: 'Enter' })

// Key with modifiers
webview_keyboard({
  action: 'press',
  key: 's',
  modifiers: ['Control']  // Ctrl+S
})

// Key combinations
webview_keyboard({
  action: 'press',
  key: 'z',
  modifiers: ['Meta', 'Shift']  // Cmd+Shift+Z (redo on macOS)
})
```

### Pattern 4: Wait for State

```typescript
// Wait for element to appear
webview_wait_for({
  type: 'selector',
  value: '.success-toast',
  timeout: 5000
})

// Wait for text to appear
webview_wait_for({
  type: 'text',
  value: 'File saved successfully',
  timeout: 3000
})

// Wait for IPC event
webview_wait_for({
  type: 'ipc-event',
  value: 'file-saved',
  timeout: 5000
})
```

### Pattern 5: IPC Testing

```typescript
// Start monitoring IPC calls
ipc_monitor({ action: 'start' })

// Perform action that triggers IPC
webview_interact({ action: 'click', selector: '.save-button' })

// Get captured IPC calls
ipc_get_captured({ filter: 'save_file' })

// Execute IPC command directly
ipc_execute_command({
  command: 'get_document_state',
  args: { id: 'doc-123' }
})

// Emit event to test handlers
ipc_emit_event({
  eventName: 'file-changed',
  payload: { path: '/test/file.md' }
})

// Stop monitoring
ipc_monitor({ action: 'stop' })
```

### Pattern 6: JavaScript Execution

```typescript
// Get value from DOM (MUST use IIFE for return values)
webview_execute_js({
  script: '(() => { return document.querySelector(".editor").textContent; })()'
})

// Check Tauri API available
webview_execute_js({
  script: '(() => { return typeof window.__TAURI__ !== "undefined"; })()'
})

// Get computed style
webview_execute_js({
  script: '(() => { return getComputedStyle(document.body).backgroundColor; })()'
})

// Trigger custom event
webview_execute_js({
  script: 'document.dispatchEvent(new CustomEvent("test-event", { detail: { test: true } }))'
})
```

## Debugging

### Read Console Logs

```typescript
// Get recent console logs
read_logs({ source: 'console', lines: 50 })

// Filter logs
read_logs({ source: 'console', filter: 'error', lines: 100 })

// Logs since specific time
read_logs({
  source: 'console',
  since: '2024-01-01T10:00:00Z',
  lines: 50
})
```

### Platform-Specific Logs

```typescript
// Desktop system logs
read_logs({ source: 'system', lines: 100 })

// Android logcat
read_logs({ source: 'android', filter: 'vmark', lines: 100 })

// iOS simulator logs
read_logs({ source: 'ios', lines: 100 })
```

### Window Management

```typescript
// List all windows
manage_window({ action: 'list' })

// Get window info
manage_window({ action: 'info', windowId: 'main' })

// Resize window for responsive testing
manage_window({ action: 'resize', width: 800, height: 600 })

// Resize specific window
manage_window({
  action: 'resize',
  windowId: 'settings',
  width: 400,
  height: 300
})
```

### Get CSS Styles

```typescript
// Get all computed styles
webview_execute_js({ script: `(() => { const s = getComputedStyle(document.querySelector('.editor')); return Object.fromEntries([...s].map(p => [p, s.getPropertyValue(p)])); })()` })

// Get specific properties
webview_execute_js({ script: `(() => { const s = getComputedStyle(document.querySelector('.editor')); return Object.fromEntries(["font-size", "color", "background-color"].map(p => [p, s.getPropertyValue(p)])); })()` })

// Get styles from multiple elements
webview_execute_js({ script: `[...document.querySelectorAll('.toolbar button')].map(el => { const s = getComputedStyle(el); return Object.fromEntries(["opacity", "visibility"].map(p => [p, s.getPropertyValue(p)])); })` })
```

## Common Test Scenarios

### Scenario: File Operations

```typescript
// 1. Connect
driver_session({ action: 'start', port: 9323 })

// 2. Open file dialog
webview_keyboard({ action: 'press', key: 'o', modifiers: ['Control'] })

// 3. Wait for content to load (using IPC)
ipc_monitor({ action: 'start' })
// ... file selection happens externally or via mocked dialog ...
ipc_get_captured({ filter: 'read_file' })

// 4. Verify content loaded
webview_find_element({ selector: '.editor-content' })
webview_execute_js({
  script: '(() => { return document.querySelector(".editor-content").textContent.length > 0; })()'
})
```

### Scenario: Editor Typing

```typescript
// 1. Focus editor
webview_interact({ action: 'click', selector: '.editor' })

// 2. Type content
webview_keyboard({
  action: 'type',
  selector: '.editor [contenteditable]',
  text: '# Test Document\n\nThis is a test.'
})

// 3. Verify dirty state
webview_find_element({ selector: '[data-dirty="true"]' })

// 4. Save with Ctrl+S
webview_keyboard({ action: 'press', key: 's', modifiers: ['Control'] })

// 5. Verify saved
webview_wait_for({ type: 'selector', value: '[data-dirty="false"]' })
```

### Scenario: Responsive Testing

```typescript
// Test mobile viewport
manage_window({ action: 'resize', width: 375, height: 667 })
webview_screenshot({ filePath: 'dev-docs/archive/test-screenshots/mobile.png' })
webview_find_element({ selector: '.mobile-menu-button' })

// Test tablet viewport
manage_window({ action: 'resize', width: 768, height: 1024 })
webview_screenshot({ filePath: 'dev-docs/archive/test-screenshots/tablet.png' })

// Test desktop viewport
manage_window({ action: 'resize', width: 1920, height: 1080 })
webview_screenshot({ filePath: 'dev-docs/archive/test-screenshots/desktop.png' })
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Connection refused | Ensure app is running with `pnpm tauri:dev` |
| No elements found | Check selector, take screenshot to verify DOM |
| IPC not captured | Start monitor BEFORE the action |
| Timeout on wait | Increase timeout, check if element ever appears |
| JS returns undefined | Use IIFE syntax: `(() => { return value; })()` |
| Plugin not found | Run `get_setup_instructions` |

## Reference Files

| Topic | File |
|-------|------|
| Session management | [references/session-management.md](references/session-management.md) |
| Webview testing | [references/webview-testing.md](references/webview-testing.md) |
| IPC testing | [references/ipc-testing.md](references/ipc-testing.md) |
| Debugging | [references/debugging.md](references/debugging.md) |

## Related Skills
- **`rust-tauri-backend`** — VMark Rust backend, commands and invoke/emit bridges
- **`mcp-dev`** — VMark MCP tools and server registration

# Debugging

## Overview

When E2E tests fail or behave unexpectedly, use these debugging tools and techniques to identify issues.

## Console Logs

### Read Recent Logs

```typescript
// Get last 50 console messages
read_logs({ source: 'console', lines: 50 })
```

### Filter by Pattern

```typescript
// Find errors only
read_logs({ source: 'console', filter: 'error', lines: 100 })

// Find specific component logs
read_logs({ source: 'console', filter: 'Editor', lines: 50 })

// Find warnings
read_logs({ source: 'console', filter: 'warn', lines: 50 })
```

### Time-Based Filtering

```typescript
// Logs since test started
read_logs({
  source: 'console',
  since: '2024-01-01T10:00:00Z',
  lines: 100
})
```

### Log Response Format

```json
{
  "logs": [
    {
      "level": "log",
      "message": "Document loaded: /path/to/file.md",
      "timestamp": 1704067200000
    },
    {
      "level": "error",
      "message": "Failed to save: Permission denied",
      "timestamp": 1704067210000,
      "stack": "Error: Permission denied\n    at save (/app/editor.js:123)"
    }
  ]
}
```

## Platform Logs

### Desktop System Logs

```typescript
// macOS/Windows/Linux system logs
read_logs({ source: 'system', lines: 100 })

// Filter Rust backend logs
read_logs({ source: 'system', filter: 'tauri', lines: 50 })
```

### Android Logcat

```typescript
// Android device/emulator logs
read_logs({ source: 'android', lines: 100 })

// Filter by app
read_logs({ source: 'android', filter: 'com.vmark', lines: 100 })
```

### iOS Simulator Logs

```typescript
// iOS simulator logs
read_logs({ source: 'ios', lines: 100 })
```

## Screenshots

### Capture Current State

```typescript
// When test fails, capture what's visible
webview_screenshot()
```

### Save for Comparison

```typescript
// Save with descriptive names
webview_screenshot({ filePath: 'dev-docs/archive/test-screenshots/debug-before-click.png' })

// ... action fails ...

webview_screenshot({ filePath: 'dev-docs/archive/test-screenshots/debug-after-failure.png' })
```

### Element Screenshots

```typescript
// Screenshot specific element
const elem = webview_find_element({ selector: '.problematic-element' })
webview_screenshot({ uid: elem.elements[0].uid })
```

## DOM Inspection

### Find Element Details

```typescript
// Get full element info
webview_find_element({ selector: '.my-element' })
```

### Check Element Visibility

```typescript
// Get visibility-related styles
webview_execute_js({ script: `(() => { const s = getComputedStyle(document.querySelector('.hidden-element')); return Object.fromEntries(["display", "visibility", "opacity", "z-index"].map(p => [p, s.getPropertyValue(p)])); })()` })
```

### Check Element Position

```typescript
webview_execute_js({
  script: `(() => {
    const el = document.querySelector('.my-element');
    const rect = el.getBoundingClientRect();
    return {
      visible: rect.width > 0 && rect.height > 0,
      inViewport: rect.top >= 0 && rect.left >= 0 &&
                  rect.bottom <= window.innerHeight &&
                  rect.right <= window.innerWidth,
      rect: rect
    };
  })()`
})
```

### List All Elements

```typescript
webview_execute_js({
  script: `(() => {
    const elements = document.querySelectorAll('.toolbar button');
    return Array.from(elements).map(el => ({
      text: el.textContent,
      disabled: el.disabled,
      visible: el.offsetParent !== null
    }));
  })()`
})
```

## IPC Debugging

### Monitor All Traffic

```typescript
ipc_monitor({ action: 'start' })

// ... perform suspicious action ...

const traffic = ipc_get_captured()
console.log('Commands:', traffic.commands)
console.log('Events:', traffic.events)
```

### Check Command Errors

```typescript
const captured = ipc_get_captured()
const failed = captured.commands.filter(c => !c.response.success)
console.log('Failed commands:', failed)
```

### Test Command Isolation

```typescript
// Test command directly without UI
const result = ipc_execute_command({
  command: 'save_file',
  args: { path: '/tmp/test.md', content: 'test' }
})

if (!result.success) {
  console.log('Command error:', result.error)
}
```

## Window State

### Check Window Info

```typescript
// Get current window state
manage_window({ action: 'info', windowId: 'main' })
```

### List All Windows

```typescript
// See all open windows
manage_window({ action: 'list' })
```

### Window Response

```json
{
  "windows": [
    {
      "label": "main",
      "title": "vmark - Untitled",
      "url": "tauri://localhost/",
      "focused": true,
      "visible": true,
      "size": { "width": 1200, "height": 800 },
      "position": { "x": 100, "y": 50 }
    }
  ]
}
```

## Backend State

### Query App State

```typescript
const state = ipc_get_backend_state()
console.log('App version:', state.appVersion)
console.log('Environment:', state.environment)
```

### Check Custom State

```typescript
// If app exposes debug command
ipc_execute_command({
  command: 'debug_get_state',
  args: {}
})
```

## Common Issues

### Element Not Found

**Symptoms:**
```
Error: Element not found: .my-button
```

**Debug Steps:**
```typescript
// 1. Take screenshot to see current state
webview_screenshot()

// 2. Check if element exists with different selector
webview_find_element({ selector: 'button' })

// 3. Check if element is dynamically loaded
webview_wait_for({ type: 'selector', value: '.my-button', timeout: 10000 })

// 4. Check console for render errors
read_logs({ source: 'console', filter: 'error' })
```

### Click Not Working

**Symptoms:** Element found but click has no effect

**Debug Steps:**
```typescript
// 1. Check if element is obscured
webview_execute_js({ script: `(() => { const s = getComputedStyle(document.querySelector('.my-button')); return Object.fromEntries(["z-index", "position", "pointer-events"].map(p => [p, s.getPropertyValue(p)])); })()` })

// 2. Check for overlays
webview_execute_js({
  script: `(() => {
    const el = document.querySelector('.my-button');
    const rect = el.getBoundingClientRect();
    const topElement = document.elementFromPoint(
      rect.left + rect.width/2,
      rect.top + rect.height/2
    );
    return topElement === el ? 'clickable' : topElement.className;
  })()`
})

// 3. Check if disabled
webview_execute_js({
  script: '(() => document.querySelector(".my-button").disabled)()'
})
```

### Timing Issues

**Symptoms:** Test works sometimes but fails randomly

**Debug Steps:**
```typescript
// 1. Add explicit waits
webview_wait_for({ type: 'selector', value: '.loaded', timeout: 10000 })

// 2. Check for async operations
ipc_monitor({ action: 'start' })
// ... action ...
const captured = ipc_get_captured()
console.log('IPC timing:', captured.commands.map(c => ({
  command: c.command,
  duration: c.duration
})))

// 3. Wait for IPC to complete
webview_wait_for({ type: 'ipc-event', value: 'operation-complete' })
```

### IPC Errors

**Symptoms:** Command fails with error

**Debug Steps:**
```typescript
// 1. Check error message
const result = ipc_execute_command({ command: 'my_command', args: {} })
console.log('Error:', result.error)

// 2. Check if command is registered
ipc_get_backend_state()

// 3. Check argument format
// Remember: Rust snake_case -> JS camelCase
ipc_execute_command({
  command: 'save_document',
  args: {
    filePath: 'test.md',  // Not file_path
    autoSave: true        // Not auto_save
  }
})

// 4. Check Rust logs
read_logs({ source: 'system', filter: 'error' })
```

## Debug Checklist

When a test fails:

1. [ ] Take screenshot of current state
2. [ ] Check console logs for errors
3. [ ] Verify element exists with `find_element`
4. [ ] Check element styles (visibility, z-index)
5. [ ] Monitor IPC traffic during action
6. [ ] Check backend state
7. [ ] Verify window focus and size
8. [ ] Add explicit waits if timing-related
9. [ ] Test command in isolation with `ipc_execute_command`
10. [ ] Check system/platform logs for Rust errors

# IPC Testing

## Overview

Tauri apps communicate between the frontend (JavaScript) and backend (Rust) via IPC (Inter-Process Communication). The `ipc_*` tools allow you to:

1. Execute Rust commands directly
2. Monitor IPC traffic during tests
3. Emit events to test handlers
4. Verify backend state

## IPC Architecture

```
┌─────────────────────────────────────┐
│           Frontend (JS)             │
│                                     │
│  invoke('command', args)  ──────────┼───┐
│                                     │   │
│  listen('event-name', callback) ←───┼───┤
└─────────────────────────────────────┘   │
                                          │ IPC Bridge
┌─────────────────────────────────────┐   │
│           Backend (Rust)            │   │
│                                     │   │
│  #[tauri::command]        ←─────────┼───┘
│  fn command(args) -> Result         │
│                                     │
│  app.emit('event-name', payload)    │
└─────────────────────────────────────┘
```

## Execute Commands

### Basic Command

```typescript
// Call Rust command directly
ipc_execute_command({ command: 'greet', args: { name: 'World' } })
```

### Response

```json
{
  "success": true,
  "result": "Hello, World!"
}
```

### Error Response

```json
{
  "success": false,
  "error": "File not found: /path/to/file.md"
}
```

### Complex Arguments

```typescript
// Nested objects
ipc_execute_command({
  command: 'save_document',
  args: {
    path: '/tmp/doc.md',
    content: '# Hello',
    options: {
      createBackup: true,
      encoding: 'utf-8'
    }
  }
})

// Arrays
ipc_execute_command({
  command: 'batch_process',
  args: {
    files: ['/file1.md', '/file2.md', '/file3.md'],
    operation: 'export'
  }
})
```

## Monitor IPC Traffic

### Start Monitoring

```typescript
// Start capturing all IPC calls
ipc_monitor({ action: 'start' })
```

### Perform Actions

After starting the monitor, perform user actions that trigger IPC:

```typescript
// User clicks save button
webview_interact({ action: 'click', selector: '.save-button' })

// User types in editor (may trigger auto-save)
webview_keyboard({
  action: 'type',
  selector: '.editor',
  text: 'New content'
})
```

### Get Captured Traffic

```typescript
// Get all captured IPC calls
ipc_get_captured()

// Filter by command name
ipc_get_captured({ filter: 'save_file' })
```

### Captured Data Format

```json
{
  "commands": [
    {
      "id": "cmd-001",
      "command": "save_file",
      "args": { "path": "/tmp/doc.md", "content": "..." },
      "timestamp": 1704067200000,
      "response": { "success": true, "result": true },
      "duration": 15
    }
  ],
  "events": [
    {
      "id": "evt-001",
      "name": "file-saved",
      "payload": { "path": "/tmp/doc.md" },
      "timestamp": 1704067200015
    }
  ]
}
```

### Stop Monitoring

```typescript
ipc_monitor({ action: 'stop' })
```

## Emit Events

### Basic Event

```typescript
// Emit event to test frontend handlers
ipc_emit_event({
  eventName: 'file-changed',
  payload: { path: '/test/file.md' }
})
```

### Complex Payloads

```typescript
// Simulate external file change
ipc_emit_event({
  eventName: 'fs-watch',
  payload: {
    type: 'modify',
    path: '/documents/note.md',
    timestamp: Date.now()
  }
})

// Simulate update available
ipc_emit_event({
  eventName: 'update-available',
  payload: {
    version: '2.0.0',
    releaseNotes: 'New features...',
    downloadUrl: 'https://...'
  }
})
```

## Get Backend State

```typescript
// Query Tauri app metadata and state
ipc_get_backend_state()
```

### Response

```json
{
  "appName": "vmark",
  "appVersion": "1.0.0",
  "tauriVersion": "2.0.0",
  "environment": "development",
  "platform": {
    "os": "macos",
    "arch": "aarch64"
  }
}
```

## Testing Patterns

### Pattern: Verify Command Called

```typescript
// 1. Start monitoring
ipc_monitor({ action: 'start' })

// 2. Trigger save via UI
webview_keyboard({ action: 'press', key: 's', modifiers: ['Control'] })

// 3. Wait for save to complete
webview_wait_for({ type: 'selector', value: '[data-saved="true"]' })

// 4. Verify IPC call
const captured = ipc_get_captured({ filter: 'save_file' })
// Check: captured.commands[0].args.path === expected
// Check: captured.commands[0].response.success === true

// 5. Cleanup
ipc_monitor({ action: 'stop' })
```

### Pattern: Test Event Handlers

```typescript
// 1. Prepare UI state
webview_interact({ action: 'click', selector: '.open-file' })

// 2. Emit external change event
ipc_emit_event({
  eventName: 'file-changed',
  payload: { path: '/test.md', type: 'external-modify' }
})

// 3. Verify UI responds
webview_wait_for({
  type: 'selector',
  value: '.reload-prompt',
  timeout: 3000
})
```

### Pattern: Command Error Handling

```typescript
// 1. Call command that will fail
const result = ipc_execute_command({
  command: 'read_file',
  args: { path: '/nonexistent/file.md' }
})

// 2. Verify error response
// Check: result.success === false
// Check: result.error contains "not found"

// 3. Verify UI error state
webview_find_element({ selector: '.error-toast' })
```

### Pattern: State Verification

```typescript
// 1. Perform action
webview_keyboard({
  action: 'type',
  selector: '.editor',
  text: 'New content'
})

// 2. Query state directly
const state = ipc_execute_command({
  command: 'get_document_state',
  args: {}
})

// 3. Verify state
// Check: state.result.isDirty === true
// Check: state.result.content === 'New content'
```

### Pattern: Sequence Verification

```typescript
// 1. Monitor IPC
ipc_monitor({ action: 'start' })

// 2. Complex user flow
webview_keyboard({ action: 'type', selector: '.editor', text: '# New Doc' })
webview_keyboard({ action: 'press', key: 's', modifiers: ['Control'] })
webview_wait_for({ type: 'selector', value: '.saved-indicator' })

// 3. Verify command sequence
const captured = ipc_get_captured()
const commands = captured.commands.map(c => c.command)

// Verify expected sequence: update_content -> save_file
// Check: commands[0] === 'update_content'
// Check: commands[1] === 'save_file'

// 4. Verify timing
const saveDuration = captured.commands[1].duration
// Check: saveDuration < 1000 (under 1 second)
```

## Argument Name Conventions

Remember: Rust uses `snake_case`, JavaScript uses `camelCase`:

```rust
// Rust command
#[tauri::command]
fn save_document(file_path: String, auto_backup: bool) -> Result<(), String>
```

```typescript
// JavaScript call
ipc_execute_command({
  command: 'save_document',
  args: {
    filePath: 'test.md',    // Note: camelCase
    autoBackup: true
  }
})
```

## Debugging IPC Issues

### Check Available Commands

```typescript
// Execute with invalid command to see error
ipc_execute_command({ command: '__invalid__' })
// Error message may list available commands
```

### Log All Traffic

```typescript
// Monitor everything
ipc_monitor({ action: 'start' })

// ... perform actions ...

// Get full log
const all = ipc_get_captured()
console.log(JSON.stringify(all, null, 2))
```

### Verify Serialization

```typescript
// Test with known good data
ipc_execute_command({
  command: 'echo',
  args: { data: { test: true, array: [1, 2, 3] } }
})
```

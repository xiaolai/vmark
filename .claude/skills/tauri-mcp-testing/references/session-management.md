# Session Management

## Overview

The `tauri_driver_session` tool manages connections to running Tauri applications. A session must be active before using any other `tauri_webview_*` or `tauri_ipc_*` tools.

## Connection Architecture

```
┌────────────────────┐     WebSocket      ┌────────────────────┐
│    Claude Code     │ ←───────────────── │    Tauri App       │
│    (MCP Client)    │     Port 9223      │  (MCP Bridge)      │
└────────────────────┘                    └────────────────────┘
```

The MCP Bridge plugin runs inside the Tauri app and exposes a WebSocket server that Claude Code connects to.

## Starting a Session

### Basic Connection

```typescript
// Connect to app on default port (9223)
tauri_driver_session({ action: 'start' })
```

### Custom Port

```typescript
// Connect to app on different port
tauri_driver_session({ action: 'start', port: 9224 })
```

### Remote Connection (Mobile Testing)

```typescript
// Connect to app running on another machine
tauri_driver_session({
  action: 'start',
  host: '<device-ip>',
  port: 9223
})
```

### Environment Variables

The tool checks these env vars as fallbacks:
- `MCP_BRIDGE_HOST` - Default host address
- `TAURI_DEV_HOST` - Alternative host variable

## Multiple App Connections

You can connect to multiple Tauri apps simultaneously:

```typescript
// Connect to first app
tauri_driver_session({ action: 'start', port: 9223 })

// Connect to second app
tauri_driver_session({ action: 'start', port: 9224 })
```

### Default App Behavior

- The **most recently connected** app becomes the default
- Tools without `appIdentifier` target the default app
- Use `appIdentifier` to target a specific app

```typescript
// Target specific app by port
tauri_webview_screenshot({ appIdentifier: 9223 })

// Target by bundle ID
tauri_webview_screenshot({ appIdentifier: 'com.vmark.app' })
```

## Checking Session Status

```typescript
tauri_driver_session({ action: 'status' })
```

### Single App Response

```json
{
  "connected": true,
  "identifier": "com.vmark.app",
  "port": 9223
}
```

### Multiple Apps Response

```json
{
  "connected": true,
  "apps": [
    { "identifier": "com.vmark.app", "port": 9223, "isDefault": false },
    { "identifier": "com.other.app", "port": 9224, "isDefault": true }
  ]
}
```

## Stopping Sessions

### Stop All Sessions

```typescript
tauri_driver_session({ action: 'stop' })
```

### Stop Specific App

```typescript
// Stop by port
tauri_driver_session({ action: 'stop', appIdentifier: 9223 })

// Stop by bundle ID
tauri_driver_session({ action: 'stop', appIdentifier: 'com.vmark.app' })
```

## Connection Lifecycle

```
1. START      → WebSocket connection established
2. HANDSHAKE  → Protocol version negotiated
3. READY      → Session active, tools available
4. COMMANDS   → Execute tauri_webview_*, tauri_ipc_* tools
5. STOP       → Clean disconnect
```

## Error Handling

### Connection Refused

```
Error: Connection refused on port 9223
```

**Solutions:**
1. Ensure app is running: `pnpm tauri dev`
2. Check port isn't blocked
3. Verify MCP Bridge plugin is installed

### Plugin Not Found

```
Error: MCP Bridge not responding
```

**Solution:** Run `tauri_get_setup_instructions` and follow the installation guide.

### Timeout

```
Error: Connection timeout after 5000ms
```

**Solutions:**
1. Check network connectivity
2. Ensure app has fully started
3. Try increasing timeout in env vars

## Best Practices

1. **Always check status first** before running tests
   ```typescript
   tauri_driver_session({ action: 'status' })
   ```

2. **Clean up after tests** to free resources
   ```typescript
   tauri_driver_session({ action: 'stop' })
   ```

3. **Use specific ports** when testing multiple apps to avoid confusion

4. **Handle reconnection** if app restarts during testing
   ```typescript
   // Check and reconnect if needed
   const status = tauri_driver_session({ action: 'status' })
   if (!status.connected) {
     tauri_driver_session({ action: 'start' })
   }
   ```

## Window Targeting

By default, tools target the `"main"` window. Use `windowId` to target others:

```typescript
// List available windows
tauri_manage_window({ action: 'list' })

// Target specific window
tauri_webview_screenshot({ windowId: 'settings' })
tauri_webview_interact({ action: 'click', selector: '.btn', windowId: 'modal' })
```

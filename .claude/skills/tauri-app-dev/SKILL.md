---
name: tauri-app-dev
description: Expert guidance for building cross-platform desktop applications with Tauri 2.0 and Rust. Use when developing Tauri apps including commands and IPC, file system operations, window management, state management, system tray, menus, plugin development, security configuration (capabilities/permissions), bundling/distribution, and auto-updates. Covers patterns for editor applications requiring file dialogs, native menus, and frontend-backend communication.
---

# Tauri 2.0 App Development

Tauri is a framework for building small, fast, secure desktop apps using web frontends and Rust backends.

## Architecture Overview

```
┌─────────────────────────────────────────┐
│           Frontend (Webview)            │
│     HTML/CSS/JS • React/Vue/Svelte      │
└────────────────┬────────────────────────┘
                 │ IPC (invoke/events)
┌────────────────▼────────────────────────┐
│           Tauri Core (Rust)             │
│  Commands • State • Plugins • Events    │
└────────────────┬────────────────────────┘
                 │ TAO (windows) + WRY (webview)
┌────────────────▼────────────────────────┐
│          Operating System               │
│   macOS • Windows • Linux • Mobile      │
└─────────────────────────────────────────┘
```

## Project Structure

```
my-app/
├── src/                    # Frontend source
├── src-tauri/
│   ├── Cargo.toml          # Rust dependencies
│   ├── tauri.conf.json     # Tauri configuration
│   ├── capabilities/       # Security permissions (v2)
│   │   └── default.json
│   ├── src/
│   │   ├── main.rs         # Desktop entry point
│   │   └── lib.rs          # Main app logic + mobile entry
│   └── icons/
└── package.json
```

## Commands (Frontend → Rust)

Define commands in Rust with `#[tauri::command]`:

```rust
// src-tauri/src/lib.rs
#[tauri::command]
fn greet(name: String) -> String {
    format!("Hello, {}!", name)
}

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet, read_file])
        .run(tauri::generate_context!())
        .expect("error running app");
}
```

Call from frontend (direct):

```typescript
import { invoke } from '@tauri-apps/api/core';

const greeting = await invoke<string>('greet', { name: 'World' });
const content = await invoke<string>('read_file', { path: '/tmp/test.txt' });
```

**Project convention:** Wrap `invoke()` with TanStack Query for caching and state management:

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';

// Query (read operations)
const { data: content } = useQuery({
  queryKey: ['file', path],
  queryFn: () => invoke<string>('read_file', { path }),
});

// Mutation (write operations)
const { mutate: saveFile } = useMutation({
  mutationFn: (content: string) => invoke('write_file', { path, content }),
});
```

**Key rules:**
- Arguments must implement `serde::Deserialize`
- Return types must implement `serde::Serialize`
- Use `Result<T, E>` for fallible operations
- Async commands run on thread pool (non-blocking)
- Snake_case in Rust → camelCase in JS arguments

## State Management

Share state across commands:

```rust
use std::sync::Mutex;
use tauri::State;

struct AppState {
    counter: Mutex<i32>,
    db: Mutex<Option<Database>>,
}

#[tauri::command]
fn increment(state: State<'_, AppState>) -> i32 {
    let mut counter = state.counter.lock().unwrap();
    *counter += 1;
    *counter
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            counter: Mutex::new(0),
            db: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![increment])
        .run(tauri::generate_context!())
        .expect("error running app");
}
```

**Access via AppHandle** (for background threads):

```rust
use tauri::Manager;

#[tauri::command]
async fn background_task(app: tauri::AppHandle) {
    let state = app.state::<AppState>();
    // use state...
}
```

## Events (Rust → Frontend)

Emit events from Rust:

```rust
use tauri::Emitter;

#[tauri::command]
fn start_process(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        for i in 0..100 {
            app.emit("progress", i).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        app.emit("complete", "Done!").unwrap();
    });
}
```

Listen in frontend:

```typescript
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen<number>('progress', (event) => {
    console.log(`Progress: ${event.payload}%`);
});

// Clean up when done
unlisten();
```

## Essential Plugins

Install plugins: `cargo add <plugin>` in src-tauri, `pnpm add <package>` in frontend.

| Plugin | Cargo Crate | NPM Package | Purpose |
|--------|-------------|-------------|---------|
| File System | `tauri-plugin-fs` | `@tauri-apps/plugin-fs` | Read/write files |
| Dialog | `tauri-plugin-dialog` | `@tauri-apps/plugin-dialog` | Open/save dialogs |
| Clipboard | `tauri-plugin-clipboard-manager` | `@tauri-apps/plugin-clipboard-manager` | Copy/paste |
| Shell | `tauri-plugin-shell` | `@tauri-apps/plugin-shell` | Run external commands |
| Store | `tauri-plugin-store` | `@tauri-apps/plugin-store` | Key-value persistence |
| Updater | `tauri-plugin-updater` | `@tauri-apps/plugin-updater` | Auto-updates |

Register in Rust:

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .run(tauri::generate_context!())
        .expect("error running app");
}
```

## Security: Capabilities & Permissions

Tauri 2.0 uses capabilities (in `src-tauri/capabilities/`) to control what APIs each window can access.

**src-tauri/capabilities/default.json:**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "fs:default",
    "fs:allow-read-text-file",
    "dialog:default",
    {
      "identifier": "fs:scope",
      "allow": [{ "path": "$APPDATA/**" }, { "path": "$DOCUMENT/**" }]
    }
  ]
}
```

**Scope variables:** `$APPDATA`, `$APPCONFIG`, `$DOCUMENT`, `$DOWNLOAD`, `$HOME`, `$TEMP`, etc.

## File Operations (Editor Pattern)

```typescript
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

// Open file dialog
const path = await open({
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    multiple: false,
});

if (path) {
    const content = await readTextFile(path);
    // Edit content...
    await writeTextFile(path, modifiedContent);
}

// Save as dialog
const savePath = await save({
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    defaultPath: 'untitled.md',
});

if (savePath) {
    await writeTextFile(savePath, content);
}
```

## Window Management

**Create windows at runtime:**

```rust
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
async fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Settings")
        .inner_size(600.0, 400.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

**Configure in tauri.conf.json:**

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "My App",
        "width": 1200,
        "height": 800,
        "decorations": true,
        "resizable": true
      }
    ]
  }
}
```

## Custom Titlebar

Set `decorations: false` in config, then:

```html
<div data-tauri-drag-region class="titlebar">
    <span>My App</span>
    <button id="minimize">−</button>
    <button id="maximize">□</button>
    <button id="close">×</button>
</div>
```

```typescript
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();
document.getElementById('minimize')?.addEventListener('click', () => appWindow.minimize());
document.getElementById('maximize')?.addEventListener('click', () => appWindow.toggleMaximize());
document.getElementById('close')?.addEventListener('click', () => appWindow.close());
```

## Building & Distribution

```bash
# Development
pnpm tauri dev

# Production build
pnpm tauri build

# Build specific targets
pnpm tauri build --target universal-apple-darwin  # macOS universal
pnpm tauri build --bundles deb,appimage           # Linux only
pnpm tauri build --bundles nsis                   # Windows NSIS
```

**Output locations:**
- macOS: `target/release/bundle/macos/*.app`, `*.dmg`
- Windows: `target/release/bundle/nsis/*-setup.exe`, `msi/*.msi`
- Linux: `target/release/bundle/deb/*.deb`, `appimage/*.AppImage`

## Quick Reference

| Task | Resource |
|------|----------|
| Commands, IPC, channels | See [references/commands-and-ipc.md](references/commands-and-ipc.md) |
| Plugin usage & development | See [references/plugins.md](references/plugins.md) |
| Security configuration | See [references/security.md](references/security.md) |
| Bundling & distribution | See [references/bundling.md](references/bundling.md) |
| Common app patterns | See [references/patterns.md](references/patterns.md) |

## Test-Driven Development (TDD)

**CRITICAL:** Always follow TDD - write tests BEFORE implementation.

### TDD Workflow

```
1. RED    → Write failing test first
2. GREEN  → Write minimal code to pass
3. REFACTOR → Clean up, keep tests green
```

### Testing Stack

| Layer | Tool | Purpose |
|-------|------|---------|
| Rust Unit | `cargo test` | Test commands, business logic |
| React Unit | Vitest | Test components, hooks, stores |
| Integration | Vitest + MSW | Test frontend with mocked IPC |
| E2E | **Tauri MCP** | Test running app (NOT Chrome DevTools) |

### E2E Testing with Tauri MCP

**IMPORTANT:** Always use `tauri_*` MCP tools for testing the running app. Do NOT use `chrome-devtools` MCP - it's for browser pages only.

```typescript
// Tauri MCP workflow for E2E tests:

// 1. Start session (connect to running Tauri app)
tauri_driver_session({ action: 'start', port: 9223 })

// 2. Take snapshot (get DOM state)
tauri_webview_screenshot()
tauri_webview_find_element({ selector: '.editor-content' })

// 3. Interact with app
tauri_webview_interact({ action: 'click', selector: '#save-button' })
tauri_webview_keyboard({ action: 'type', selector: 'input', text: 'hello' })

// 4. Wait for results
tauri_webview_wait_for({ type: 'selector', value: '.success-toast' })

// 5. Verify IPC calls
tauri_ipc_monitor({ action: 'start' })
tauri_ipc_get_captured({ filter: 'save_file' })

// 6. Check backend state
tauri_ipc_execute_command({ command: 'get_app_state' })

// 7. Read logs for debugging
tauri_read_logs({ source: 'console', lines: 50 })
```

### Rust Unit Tests

```rust
// src-tauri/src/lib.rs

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_greet() {
        let result = greet("World".to_string());
        assert_eq!(result, "Hello, World!");
    }

    #[test]
    fn test_parse_markdown() {
        let input = "# Hello";
        let result = parse_markdown(input);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().title, "Hello");
    }

    #[tokio::test]
    async fn test_async_command() {
        let result = read_file("/tmp/test.txt".to_string()).await;
        // Test with temp files or mocks
    }
}
```

Run: `cd src-tauri && cargo test`

### React Component Tests (Vitest)

```typescript
// src/components/Editor.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Editor } from './Editor'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('Editor', () => {
  it('should render editor content', () => {
    render(<Editor initialValue="# Hello" />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('should call save on Ctrl+S', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    render(<Editor initialValue="test" />)

    await userEvent.keyboard('{Control>}s{/Control}')

    expect(invoke).toHaveBeenCalledWith('save_file', expect.any(Object))
  })
})
```

### Zustand Store Tests

```typescript
// src/stores/editorStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './editorStore'

describe('editorStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useEditorStore.setState({
      content: '',
      isDirty: false,
      filePath: null
    })
  })

  it('should update content and mark dirty', () => {
    const { setContent } = useEditorStore.getState()

    setContent('new content')

    const state = useEditorStore.getState()
    expect(state.content).toBe('new content')
    expect(state.isDirty).toBe(true)
  })

  it('should clear dirty flag after save', () => {
    useEditorStore.setState({ isDirty: true })
    const { markSaved } = useEditorStore.getState()

    markSaved()

    expect(useEditorStore.getState().isDirty).toBe(false)
  })
})
```

### Integration Tests with Mocked IPC

```typescript
// src/features/file/useFileOperations.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFileOperations } from './useFileOperations'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn()
}))

describe('useFileOperations', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    vi.clearAllMocks()
  })

  it('should open file and load content', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const { open } = await import('@tauri-apps/plugin-dialog')

    vi.mocked(open).mockResolvedValue('/path/to/file.md')
    vi.mocked(invoke).mockResolvedValue('# File Content')

    const { result } = renderHook(() => useFileOperations(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    })

    await result.current.openFile()

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('read_file', { path: '/path/to/file.md' })
    })
  })
})
```

### TDD Example: Adding a New Feature

```typescript
// Step 1: RED - Write failing test first
// src/features/wordcount/useWordCount.test.ts
describe('useWordCount', () => {
  it('should count words in content', () => {
    const { result } = renderHook(() => useWordCount('hello world'))
    expect(result.current.words).toBe(2)
  })

  it('should handle empty content', () => {
    const { result } = renderHook(() => useWordCount(''))
    expect(result.current.words).toBe(0)
  })

  it('should count characters', () => {
    const { result } = renderHook(() => useWordCount('hello'))
    expect(result.current.characters).toBe(5)
  })
})

// Step 2: GREEN - Minimal implementation
// src/features/wordcount/useWordCount.ts
export function useWordCount(content: string) {
  return {
    words: content.trim() ? content.trim().split(/\s+/).length : 0,
    characters: content.length
  }
}

// Step 3: REFACTOR - Add memoization, types, etc.
export function useWordCount(content: string): WordCountResult {
  return useMemo(() => ({
    words: content.trim() ? content.trim().split(/\s+/).length : 0,
    characters: content.length,
    charactersNoSpaces: content.replace(/\s/g, '').length
  }), [content])
}
```

### Running Tests

```bash
# All tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage

# Rust tests only
cd src-tauri && cargo test

# Type check + lint + test
pnpm check:all
```

## Debugging Tips

- **DevTools:** Right-click → Inspect, or `Cmd+Option+I` (macOS) / `Ctrl+Shift+I` (Windows/Linux)
- **Rust logs:** Use `log` crate + `tauri-plugin-log` or `println!` (visible in terminal)
- **Check capabilities:** "Not allowed" errors mean missing permissions in capabilities
- **IPC errors:** Ensure argument names match (snake_case Rust → camelCase JS)
- **E2E debugging:** Use `tauri_read_logs({ source: 'console' })` to see webview console

## Related Skills

- **`tauri-v2-integration`** — VMark-specific Tauri IPC patterns (invoke/emit bridges, menu accelerators)
- **`tauri-mcp-testing`** — E2E testing of the running Tauri app via MCP tools
- **`rust-tauri-backend`** — VMark Rust backend (commands, menu items, filesystem)

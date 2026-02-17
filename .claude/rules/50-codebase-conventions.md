# 50 - Codebase Conventions

Undocumented patterns found across the codebase. Follow these for consistency.

## 1. Store Conventions

Zustand stores follow a strict naming and structure pattern.

**Naming:** `use[Name]Store` for the hook, file named `[name]Store.ts`.

**Creation:**
```ts
// Without middleware:
export const useFooStore = create<FooState>((set, get) => ({...}));

// With middleware (persist, etc.) — note the extra ():
export const useFooStore = create<FooState>()(persist(...));
```

**Safe partial updates:** Use a local `updateDoc`-style helper to guard against missing keys:

```ts
function updateDoc(state, id, updater) {
  const doc = state.documents[id];
  if (!doc) return state;  // No-op if missing
  return { documents: { ...state.documents, [id]: { ...doc, ...updater(doc) } } };
}
```

**Rule:** Always guard keyed state updates — never assume the key exists.

## 2. Hook Cleanup

Hooks that attach DOM event listeners use a refs-based cleanup pattern.

**Pattern:**
- Store handler references in `handlersRef` so cleanup can access the exact functions.
- Clean up on `mouseup`, `blur`, AND component unmount.
- Use `isClosingRef` or similar boolean ref as a re-entry guard.

```ts
const handlersRef = useRef<{ move: ((e: MouseEvent) => void) | null }>({ move: null });

const cleanup = useCallback(() => {
  if (handlersRef.current.move) document.removeEventListener("mousemove", handlersRef.current.move);
  handlersRef.current = { move: null };
}, []);

useEffect(() => cleanup, [cleanup]); // unmount cleanup
```

**Rule:** Never attach anonymous listeners without storing a reference for removal.

## 3. Plugin Structure

Plugins live in `src/plugins/<name>/` with a consistent layout:

| File | Purpose |
|------|---------|
| `index.ts` | ProseMirror plugin factory (main export) |
| `tiptap.ts` | Tiptap `Extension.create()` / `Mark.create()` wrapper |
| `<name>.css` | Co-located styles (imported in `index.ts` or `tiptap.ts`) |

**CSS import location:** Import the CSS file in whichever `.ts` file creates the plugin:

```ts
// index.ts or tiptap.ts
import "./focus-mode.css";
```

**Tiptap-only variant:** Plugins that are purely Tiptap extensions (no separate ProseMirror plugin) may omit `index.ts` and use only `tiptap.ts` as their entry point. This applies to: `aiSuggestion`, `alertBlock`, `autoPair`, `codePaste`, `codePreview`, `detailsBlock`, `focusMode`, `highlight`, `htmlPaste`, `listBackspace`, `listContinuation`.

**Note:** `codemirror/` is a module cluster (40+ files) rather than a single plugin. New Source mode features should consider whether they belong there or in their own top-level plugin directory.

**Rule:** Plugin styles live ONLY in the plugin directory. Never define plugin CSS in global `editor.css`.

## 4. MCP Bridge Handlers

The MCP bridge uses a central dispatcher pattern in `src/hooks/mcpBridge/`.

**Dispatcher** (`index.ts`): A single `switch` on `event.type` routes to handler functions.

**Handler signature:**
```ts
export async function handleFoo(id: string, args: Record<string, unknown>): Promise<void> {
  try {
    // ... operation
    await respond({ id, success: true, data: result });
  } catch (error) {
    await respond({ id, success: false, error: error instanceof Error ? error.message : String(error) });
  }
}
```

**Shared utils** (`utils.ts`): `respond()` sends results back to Rust, `getEditor()` fetches the active editor instance, `getDocumentContent()` serializes current content.

**Rule:** Every handler must wrap its body in try/catch and call `respond()` in both paths.

## 5. Test Conventions

Tests use Vitest. Follow these patterns:

**Setup:** `vi.mock()` calls MUST appear before the import of the module being tested (hoisting).

**Store reset:** Clear store state in `beforeEach` to isolate tests:

```ts
beforeEach(() => {
  const store = useFooStore.getState();
  Object.keys(store.items).forEach((k) => store.removeItem(k));
});
```

**ProseMirror helpers:** Create a minimal schema and helper functions for doc/state creation:

```ts
const schema = new Schema({
  nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: { inline: true } },
});
function createState(text: string) { return EditorState.create({ doc: createDoc(text), schema }); }
```

**Rule:** Tests go next to the source (`foo.test.ts`) or in a `__tests__/` subdirectory for larger suites.

## 6. CSS Organization

**Co-location:** Component/plugin CSS lives next to the `.ts` file that uses it.

| Location | Contains |
|----------|----------|
| `src/plugins/<name>/<name>.css` | Plugin-specific styles |
| `src/components/<path>/*.css` | Component-specific styles |
| `src/styles/` | Global styles, shared popup base, tokens |
| `src/styles/index.css` | Design token definitions (source of truth) |
| `src/styles/popup-shared.css` | Shared popup surface styles |

**Rule:** Never scatter one component's styles across multiple CSS files. One component = one CSS file.

## 7. Error Handling

**TypeScript:** Always narrow `unknown` errors before accessing `.message`:

```ts
error instanceof Error ? error.message : String(error)
```

**Rust:** Tauri commands return `Result<T, String>`. Convert library errors with `.map_err()`:

```rust
fs::read(path).map_err(|e| format!("Failed to read: {}", e))?;
```

**Rule:** Never use `error as Error` (unsafe cast). Always use `instanceof` or `String()`.

## 8. Import Conventions

**`@/` alias:** Use for cross-module imports (anything outside the current feature directory):

```ts
import { useSettingsStore } from "@/stores/settingsStore";
```

**Relative paths:** Use for same-module imports (files in the same plugin/feature directory):

```ts
import { respond, getEditor } from "./utils";
```

**Barrel exports:** Keep minimal. Prefer direct file imports over re-exporting everything through `index.ts`.

**Rule:** Never use `../../../` chains. If you need to go up more than one level, use `@/`.

## 9. Debug Logging

Conditional loggers live in `src/utils/debug.ts`. They compile to no-ops in production.

**Pattern:**
```ts
export const fooLog = import.meta.env.DEV
  ? (...args: unknown[]) => console.log("[Foo]", ...args)
  : () => {};
```

**Naming:** `[category]Log` — e.g., `historyLog`, `autoSaveLog`.

**Usage:** Import and call like a regular function. Zero cost in production builds because Vite tree-shakes the dead branch.

**Rule:** Never use bare `console.log` for debug output. Add a named logger to `debug.ts` instead.

## 10. Rust Command Pattern

Tauri commands follow a module-based organization.

**Module layout:**
```
src-tauri/src/<feature>/
  mod.rs          # pub mod commands; (+ other submodules)
  commands.rs     # #[tauri::command] functions
```

**Command signature:**
```rust
#[tauri::command]
pub async fn my_command(app: AppHandle, arg: String) -> Result<MyData, String> {
    do_thing(&app).map_err(|e| format!("Failed: {}", e))
}
```

**Registration:** Commands are registered in `lib.rs` via `.invoke_handler(tauri::generate_handler![...])`.

**Rule:** All Tauri commands must return `Result<T, String>` — never panic on user input.

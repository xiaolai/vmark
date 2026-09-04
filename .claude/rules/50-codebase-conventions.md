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

The MCP bridge lives in **`src/services/mcpBridge/`** — it moved out of
`src/hooks/` in the WI-10 tier restoration, because a request handler is not a
React adapter (ADR-013).

| File | Role |
|---|---|
| `handleRequest.ts` | Top-level router. Dedup, then hand off to `dispatchV2`; an unmatched type gets a diagnostic error listing `SUPPORTED_TOOL_PREFIXES`. |
| `v2/dispatch.ts` | Typed route tables over the 5-tool surface (`vmark.session.*`, `.workspace.*`, `.document.*`, `.workflow.*`, `.selection.*`): `EAGER_ROUTES` (operation → handler) plus a SEPARATE lazily-imported `BROWSER_ROUTES` (operation → handler name in `./browser`), looked up by own property so a client-sent `constructor` cannot route. Returns `true` iff the operation matched. Also the single source of truth for `SUPPORTED_TOOL_PREFIXES` — never carry a second list; `__tests__/dispatch.test.ts` and `operationManifestParity.test.ts` read the tables and fail on a missing route. |
| `v2/wrapHandler.ts` | The error contract, in one place. |
| `utils.ts` | `respond()` — sends the result back to Rust via `invoke("mcp_bridge_respond")` and records it for duplicate-delivery re-send. |

**Handler signature** — the happy path only. `wrapHandler` turns anything thrown
into `respond({ success: false, error })`, so a hand-written try/catch per
handler is duplicated error policy, not safety:

```ts
export async function handleFoo(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const result = await doTheThing(args);
    await respond({ id, success: true, data: result });
  });
}
```

**Rule:** Every handler body goes through `wrapHandler` and calls `respond()`
on its success path. Validation failures inside the body use
`structuredError()`. Payload shapes are NOT declared in the handler — see the
next section.

### The wire contract is generated, not hand-written (WI-15)

Payload shapes have ONE declaration: the per-operation zod schemas in
`server/mcp/src/bridge/operationSchemas.ts`. Everything else is generated from
them by `pnpm gen:mcp-contracts`:

| Generated file | Consumed by |
|---|---|
| `server/mcp/src/bridge/generated/bridgeRequests.ts` | the sidecar's `BridgeRequest` union (re-exported from `core-types.ts`) |
| `src/services/mcpBridge/v2/generated/bridgeContracts.ts` | webview field descriptors, argument types, unknown-field posture |

**To add or change a field:** edit the schema, run `pnpm gen:mcp-contracts`,
commit the regenerated files. `pnpm lint:mcp-contracts` (in `check:all`) fails
if they are stale or hand-edited.

Handlers read payloads through `readOperationArgs(operation, args)` — one typed
parse from the generated contract — rather than a per-field `typeof` chain. A
chain is a hand-written restatement of a contract that lives elsewhere, which is
how `routing.rs` came to route on `args.windowId` and `workspaceOpenFolder.ts`
to read `args.clientId`: fields nothing sends, behind branches nothing could
reach. Three tests keep that class dead — `bridgeFieldParity.test.ts` (no
consumer reads an undeclared field), `operationSends.test.ts` (no contract field
goes unsent), and `operationPosture.test.ts` (unknown-field posture per class,
ledger D5/D5a).

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
pub async fn my_command(app: AppHandle, arg: String) -> Result<MyData, CommandError> {
    do_thing(&app).map_err(|e| localized_error!(ErrorCode::Io, "errors.mine.failed", detail = e))
}
```

**Registration:** Commands are registered in `lib.rs` via `.invoke_handler(tauri::generate_handler![...])`.

### Backend state lives in `.manage()`, not in a static (WI-20)

**Rule:** new mutable backend state is a struct held by Tauri —
`.manage(MyState::default())` in `lib.rs`, reached as a `State<'_, MyState>`
command parameter or `app.state::<MyState>()` from anything holding an
`AppHandle`. `WorkflowRunnerState`, `McpBridgeState`, `HotExitState`,
`BrowserSurface`, `WindowStatusRegistry` and `ContentServerManager` are the
shape to copy. A process-global `static` is allowed **only where no
`AppHandle` can reach** — the pre-setup file-open queue is the standing
example — and that exception must be stated at the declaration. Statics that
are not mutable *state* stay static and need no exception: `LazyLock<Regex>`
and other compiled constants, monotonic id counters
(`NEXT_REQUEST_ID`, `CAPTURE_SEQUENCE`), and the `OnceLock`'d HTTP client.

The decision boundary is **reachability, not convenience**: if the code path
already carries an `AppHandle` (every command, every window callback, every
task spawned from one), the state belongs to the app. A static is not simply a
shortcut — it welds the state to the *process*, so every test in the binary
shares one instance. That is what the migrated modules were paying for: a
file-wide test mutex plus `clear_pending_restore()` in `hot_exit`, a
`GLOBAL_STATE_TEST_LOCK` plus `__test_…__` marker keys and hand-written
teardown in `mcp_bridge`, a webview-liveness suite collapsed into one `#[test]`
because parallel tests raced the flag, and a comment conceding that assertions
could only be "structural" because other tests mutated the same maps. Under
`.manage()` a test gets its own state by constructing one (or by
`.manage()`-ing it on a `mock_builder()` app), and all of that deletes.

An **epoch counter is not automatically cope**. `McpBridgeState::
connection_generation` survived the migration on purpose: the bridge can be
stopped and restarted inside one process while the managed state outlives both,
so a handshake that authenticates after a drain still has to be refused. Keep a
counter when it distinguishes *rounds within one lifetime*; delete it when it
only existed to tell tests apart. Where a round genuinely needs identity,
prefer an owned token over a number — `HotExitState`'s `RestoreRound` replaced a
`u64` that had to be threaded by hand from one function into another, and took
a `JoinHandle` static and its `#[cfg(test)]` type fork with it.

**Rule:** All Tauri commands must return a `Result` — never panic on user input.
**New commands return `Result<T, CommandError>`** (`src-tauri/src/command_error.rs`).
`Result<T, String>` is LEGACY and under a ratchet.

### Why `CommandError`, and what the String form cost (WI-14)

A `String` error carries no class, so the frontend had to reconstruct one by
matching TEXT: `saveToPath.ts` tested a `"PARENT_MISSING:"` prefix, and the MCP
browser handlers ran `String(error).includes("APPROVAL_REQUIRED")` at four
sites. A substring match fires on any payload that happens to contain the token
and stops firing the day someone rewords the message — and it could not tell
`approval-required` (raise a prompt, retry) from `permission-denied` (nothing
the user approves can lift it). Eight hand-rolled error enums were flattened at
the boundary, `genie_step.rs` with a literal `impl From<GenieStepError> for
String`. And ~370 raw-English `format!` error sites were invisible to
`lint:i18n`, against an `AGENTS.md` rule that mandates `t!()`.

`CommandError` serializes exactly `{code, message, i18nKey?, detail?}` (absent
optionals are absent, never `null`). The vocabulary is a closed set —
`invalid-input`, `not-found`, `permission-denied`, `approval-required`,
`conflict`, `io`, `network`, `timeout`, `cancelled`, `feature-disabled`,
`unsupported`, `internal` — each named after a class this crate already
produces.

**Writing one:**

| Need | Use |
|---|---|
| User-facing message | `localized_error!(ErrorCode::X, "errors.a.b", arg = v)` — the key is written once, so message and `i18nKey` cannot drift |
| Internal / caller-bug message | `CommandError::invalid_input("…")` and the other per-code constructors |
| Machine-readable context | `.with_detail(json!({ "dir": … }))` — never user prose |
| Converting an existing error enum | `CommandError::from(e)` (eight `From` impls live in `command_error_from.rs`) |

Every `i18nKey` must resolve in **all ten** `src-tauri/locales/*.yml` bundles;
a Rust test scans the crate for the keys and fails otherwise.

**Frontend side:** `src/services/commands/commandError.ts` — `parseCommandError`,
`isCommandErrorCode`, `classifyCommandError`, `commandErrorMessage`. Branch on
`code`, never on message text. Use `commandErrorMessage`, not `errorMessage`, at
any boundary that can receive a typed rejection: a typed error is a plain
object, and `String(object)` renders as `"[object Object]"`.

**The ratchet:** `pnpm lint:command-errors`
(`scripts/check-command-error-ratchet.mjs`, in `check:all`) counts remaining
`Result<T, String>` command signatures per file against
`scripts/command-error-baseline.json`. Two-way, house standard: a new legacy
signature fails, and a file that improved fails until its number is lowered.
Numbers only go down.

**The gate also refuses `String(error)` on a TYPED command (WI-DP2.7).** A
`CommandError` serialises as a plain OBJECT, so `String(error)` on one renders
the literal `"[object Object]"` — and that shipped to users at four boundaries
(`useContentServer.ts`, `contentServer/client.ts`, `HotExitDevTools.tsx`,
`McpConfigInstaller.tsx`) before it was found by hand. The ratchet now also
walks `src/`, and fails when a file invokes a command whose Rust signature
returns `CommandError` while rendering errors through `String(...)` instead of
`commandErrorMessage`. It is deliberately SILENT for files that only invoke
legacy commands: `String(e)` is correct while the command still returns
`Result<T, String>`, and flagging it would demand a change that is wrong until
the conversion lands. **So converting a command means checking its callers in
the same change** — which is the point, since the gate that drives the
conversions is the one asserting against their fallout.

It catches **both spellings**. `errorMessage()` in `src/utils/errorMessage.ts` is
literally `error instanceof Error ? error.message : String(error)`, so it is the
same defect under a second name — seven live instances were found the moment the
gate learned to see it (`close_window`, `pty_close`/`pty_kill`,
`browser_navigate`, `open_workspace_in_new_window`).

**It parses a TypeScript AST; it does not grep.** Three rounds of hand-rolled
lexing each shipped a fresh FALSE NEGATIVE — a generic argument that nested
(`invoke<Record<string, unknown>>`), a `}` inside a string closing a catch block
early, `.catch(async (e) => …)`, a shadowing inner parameter. The mechanism was
the defect, so the detector walks `ts.createSourceFile` like
`check-mock-boundaries`, `check-shell-slots` and `check-hooks-react-purity`.
Scope, shadowing and string contents then come from the parser. Two consequences
worth knowing:

- **A command name need not be a literal.** `restartWithHotExit.ts` invokes
  `HOT_EXIT_COMMANDS.CAPTURE` from a `const … as const` map, and requiring a
  literal left the gate blind to a LIVE `"[object Object]"` defect there — in the
  same module family one had already been fixed by hand. The detector resolves
  `const X = "cmd"` and `const M = { K: "cmd" }`; anything less tractable stays
  unresolved rather than guessed.
- **Every production JS/TS extension is scanned**, not just `.ts`/`.tsx` —
  `src/export/reader/vmark-reader.js` is real production source. `.spec.*` is
  excluded alongside `.test.*`.

**What remains file-level is the INVOKE↔handler association**, not the binding:
the walker knows exactly which caught name a helper was applied to, but it does
not prove that name came from *this* command's rejection. So a file that invokes
a typed command AND separately stringifies, say, a `JSON.parse` failure is
correct as written. Mark that line `// command-error-ok: <reason>`. The reason is
REQUIRED — a bare marker is rejected, the same rule the i18n allowlist and the
caret-only focus marker carry, and the marker scopes to its own site rather than
the whole file (suppressing a file would hide its other violations). One
exemption exists today, in `settingsStore/shortcuts.ts`.


**During the migration both shapes are live.** A caller that branches on a
typed code keeps its legacy-string branch until the ratchet reaches zero —
`saveToPath.ts` and `browserNavigation.ts` are the worked examples, each with
tests for both shapes.

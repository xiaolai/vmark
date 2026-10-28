---
paths:
  - "src/**"
  - "src-tauri/src/**"
  - "server/**"
---

# 50 - Codebase Conventions

## 1. Stores

- `use[Name]Store` in `[name]Store.ts`. With middleware: `create<FooState>()(persist(...))`.
- Always guard keyed updates — return `state` unchanged when the key is missing (a local `updateDoc` helper).
- Stores are created only under `src/stores/`; elsewhere take a `StoreApi` type, never `create` one (`scripts/source-layout.test.mjs`).

## 2. Hook cleanup

Store DOM listener references (`handlersRef`) so cleanup removes the exact
functions; clean up on `mouseup`, `blur`, and unmount; use a re-entry guard ref.
Never attach anonymous listeners you cannot remove.

## 3. Plugins

`src/plugins/<name>/`: `index.ts` (ProseMirror factory), `tiptap.ts` (Tiptap
wrapper; may be the only entry), `<name>.css` imported by whichever creates the
plugin. Plugin CSS lives only in the plugin directory, never in `editor.css`.

Module clusters, not single plugins (shared helpers, views and registries that
plugins use; `scripts/source-layout.test.mjs` fails on a directory with no entry
that is not listed here): `actions/`, `codemirror/`, `editorPlugins/`,
`formatToolbar/`, `frontmatterPanel/`, `imagePreview/`, `mathPreview/`,
`sourceMathPopup/`, `svg/`, `syntaxReveal/`, `toolbarActions/`, `workflowPreview/`.

## 4. MCP bridge (`src/services/mcpBridge/`)

- `handleRequest.ts` routes to `v2/dispatch.ts` (`EAGER_ROUTES`, lazy
  `BROWSER_ROUTES`; the single source of `SUPPORTED_TOOL_PREFIXES`).
- Every handler body runs inside `wrapHandler(id, async () => …)` and calls
  `respond()` on success; no per-handler try/catch. Validation failures use
  `structuredError()`.
- Payload shapes are declared once, as zod schemas in
  `server/mcp/src/bridge/operationSchemas.ts`. Edit the schema, run
  `pnpm gen:mcp-contracts`, commit the generated files (`lint:mcp-contracts`
  fails on stale or hand-edited output). Handlers read payloads with
  `readOperationArgs(operation, args)`, never a hand-written `typeof` chain.

## 5. Tests

`vi.mock()` before importing the subject; reset store state in `beforeEach`;
minimal ProseMirror schemas with a `createState` helper. Tests sit beside the
source or in `__tests__/`.

## 6. CSS

Co-locate component/plugin CSS with its `.ts`. One component = one CSS file.
Global styles and tokens live in `src/styles/` (`index.css` defines tokens).

## 7. Errors (TypeScript)

Narrow `unknown` with `instanceof Error` or `String()`; never `error as Error`.
For errors from typed Tauri commands use `commandErrorMessage` (see §10).

## 8. Imports

`@/` for cross-module imports, relative within a feature; never `../../../`.
Keep barrels minimal.

## 9. Debug logging

No bare `console.log`. Add a named `[category]Log` to `src/utils/debug.ts`
(`import.meta.env.DEV ? … : () => {}`).

## 10. Rust commands

- Layout: `src-tauri/src/<feature>/{mod.rs,commands.rs}`; register in the
  `all_commands!` list in `command_registry.rs` (`lint:ipc-contract` reads it).
  Commands never panic on input.
- **New commands return `Result<T, CommandError>`** (`command_error.rs`);
  `Result<T, String>` is legacy under `pnpm lint:command-errors` (per-file
  count, ratchets down).
  - User-facing: `localized_error!(ErrorCode::X, "errors.a.b", arg = v)`; the
    key must exist in all ten `src-tauri/locales/*.yml`.
  - Internal: `CommandError::invalid_input("…")` etc.; context via
    `.with_detail(json!(…))`; existing enums via `CommandError::from(e)`.
  - Frontend: branch on `code` via `src/services/commands/commandError.ts`
    (`parseCommandError`, `isCommandErrorCode`, `classifyCommandError`). Render
    with `commandErrorMessage`, never `String(e)`/`errorMessage(e)` —
    a typed error is an object and prints `"[object Object]"`. Converting a
    command means fixing its callers in the same change; the gate checks it.
    A deliberate exception is `// command-error-ok: <reason>`.
  - During migration, callers branching on a code keep their legacy-string
    branch (`saveToPath.ts`, `browserNavigation.ts`).
- **Backend state lives in `.manage()`**, reached via `State<'_, T>` or
  `app.state::<T>()`. A mutable `static` only where no `AppHandle` can reach,
  with the reason stated at the declaration. Compiled constants, id counters and
  `OnceLock` clients may stay static.

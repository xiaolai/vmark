# MCP Tools Reference

VMark exposes **five composite MCP tools** to AI assistants: `session`, `workspace`, `document`, `workflow`, and `selection`. Together they cover **15 actions** — the read/write spine plus the file/window lifecycle plus CST-safe edits for GitHub Actions YAML plus targeted edits on the user's current selection.

The previous 12-tool / 76-action surface was pruned because in-document formatting tools (bold, headings, tables, etc.) duplicate work that AI agents already do trivially via Markdown round-trip. `selection` was kept (per ADR-7 of the pruning plan) because the full-doc round-trip is uneconomical on large files — every edit pays the whole document in input tokens, the whole document in output tokens (~5× input price), and a longer write window that widens the stale-revision retry loop. See [the MCP pruning plan](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md) for the full rationale.

::: tip Recommended Workflow
1. Call `session.get_state` once to see open windows, tabs, and per-tab `{filePath, dirty, revision, kind}`.
2. For small Markdown changes or wholesale rewrites: `document.read` → reason → `document.write` (passing `expected_revision` for safe concurrency).
3. For targeted edits on a large Markdown file when the user has selected the region to change: `selection.get` → reason → `selection.set` (cuts both input and output token cost to the selection).
4. For GitHub Actions YAML (`kind: "yaml-workflow"`): `workflow.apply_patch` for CST-safe edits that preserve comments and anchors; `workflow.validate` for actionlint diagnostics.
5. File operations (open, save, close, switch tabs) live on `workspace`.
:::

::: tip Mermaid Diagrams
When using AI to generate Mermaid via MCP, consider installing the [mermaid-validator MCP server](/guide/mermaid#mermaid-validator-mcp-server-syntax-checking) — it catches syntax errors using the same Mermaid v11 parsers before diagrams reach your document.
:::

---

## `session`

One-shot orientation. Discover every window, every tab, and the server's capabilities in a single call.

### `get_state`

No arguments.

**Returns** `{windows, capabilities}`:

```json
{
  "windows": [
    {
      "label": "main",
      "focused": true,
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown"
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow"
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.1.0"
  }
}
```

The `kind` discriminator tells you whether to use `document.write` (for markdown) or `workflow.apply_patch` (for yaml-workflow) on that tab.

---

## `workspace`

File and window lifecycle. Nothing in-document.

### `new`

Create a new untitled tab.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `kind` | string | No | `"markdown"` (default) or `"yaml-workflow"` |
| `windowLabel` | string | No | Target window; defaults to focused |

Returns `{tabId}`.

### `open`

Open a file from disk.

| Parameter | Type | Required |
|-----------|------|----------|
| `filePath` | string | Yes |
| `windowLabel` | string | No |

Returns `{tabId}`.

### `save`

Save a tab to its existing path.

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | No (defaults to focused) |

Returns `{filePath, revision}`.

### `save_as`

Save a tab to a new path.

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | No |
| `filePath` | string | Yes |

Returns `{revision}`.

### `close`

Close a tab. Refuses to discard unsaved work without `force`.

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | Yes |
| `force` | boolean | No |

Returns `{closed: true}` on success, `{closed: false, reason: "DIRTY"}` if the tab is dirty and `force` was not supplied.

### `switch_tab`

Activate a tab.

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | Yes |

### `focus_window`

Focus a window.

| Parameter | Type | Required |
|-----------|------|----------|
| `windowLabel` | string | Yes |

---

## `document`

Read, write, transform. The spine of the surface.

### `read`

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | No (defaults to focused) |

Returns `{content, revision, filePath, kind, dirty}`. Always read before writing — the `revision` token must accompany the next `write`.

### `write`

Replace full document content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tabId` | string | No | Target tab (defaults to focused) |
| `content` | string | Yes | New full content |
| `expected_revision` | string | No | Revision token from the most recent read |

If `expected_revision` is supplied and the document has changed since that read, the response is a `STALE` structured-error envelope with the current revision; re-read and retry.

```json
// success
{ "revision": "rev-newAfterWrite" }

// stale
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "rev-currentNow" }
```

### `transform`

Apply a deterministic rewrite. Currently supports CJK-specific transforms (full-width ↔ ASCII punctuation conversion, CJK ↔ Latin spacing).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tabId` | string | No | Target tab |
| `kind` | string | Yes | `"cjk-format"`, `"cjk-spacing"`, or `"cjk-punctuation"` |
| `expected_revision` | string | No | Concurrency token |

`cjk-format` applies the user's CJK formatting settings end-to-end. `cjk-spacing` inserts single spaces between CJK characters and adjacent Latin/digits. `cjk-punctuation` converts ASCII punctuation that sits beside CJK characters to its full-width form.

Returns `{revision}`.

---

## `workflow`

`actionlint` validation and **CST-safe surgical edits** for GitHub Actions workflow YAML. Available only for tabs whose `kind` is `"yaml-workflow"`.

::: info `document.read` / `document.write` work on every tab — including workflow YAML
The `workflow` tool is **not** a substitute for the read/write spine. For a workflow tab, you can:

- `document.read` to get the raw YAML text (with all comments)
- `document.write` to replace it wholesale (whatever string you send is stored verbatim — comments preserved if you include them)
- `workflow.apply_patch` when you want **the server itself to guarantee** that comments, anchors, and key order survive a partial edit

Use `apply_patch` when changing one field and leaving everything else untouched (the server can't drop comments it doesn't change). Use `document.write` when you're rewriting wholesale or generating a new workflow from scratch.
:::

### `apply_patch`

Apply an array of `IRPatch` objects. Patches are dispatched through VMark's CST-aware mutators, which preserve comments, anchors, and key order. Raw `document.write` to a YAML file would lose them.

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | No |
| `patches` | IRPatch[] | Yes |
| `expected_revision` | string | No |

`IRPatch` is a discriminated union (`kind` field). Supported kinds:

| `kind` | Effect |
|---|---|
| `workflow.set` | Set top-level fields (`{path, value}`) — `name`, `env.X`, etc. |
| `job.set` | Set a field on a job (`{jobId, path, value}`) |
| `step.set` | Set a field on a step (`{jobId, stepIndex, path, value}`) |
| `with.set` | Set a key in a step's `with:` block (`{jobId, stepIndex, key, value}`) |
| `with.remove` | Remove a key from a step's `with:` block |
| `needs.add` / `needs.remove` | Add or remove a job ID from `needs:` |
| `trigger.setFilters` | Replace a trigger filter array — branches, paths, types, etc. (`{event, filter, value: string[]}`) |

Returns `{revision}` on success or a structured `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW` error envelope.

### `validate`

Run `actionlint` over the workflow YAML.

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | No |

Returns `{ok, diagnostics, binaryAvailable}`. Each diagnostic carries `{line, col, message, severity}`. `binaryAvailable: false` means `actionlint` is not installed locally; install via Homebrew or upstream releases.

---

## `selection`

Read or replace the user's current editor selection. Use this instead of `document.read`/`document.write` when the user has highlighted the region to change — `selection.get` returns just the selected slice, and `selection.set` rewrites just that range, so token cost scales with the edit, not the document.

::: warning Selection is view-state — focused tab only
The selection only exists in the editor that's currently rendered. If `tabId` is supplied it must match the focused tab; mismatch returns `INVALID_TAB`. If the focused tab has no live editor (e.g. read-only viewer), the response is `NO_EDITOR`.
:::

### `get`

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | No |

Returns:

| Field | Type | Notes |
|---|---|---|
| `text` | string | Markdown serialization of the selected slice (WYSIWYG mode), or raw selected text (source mode). Empty string when collapsed. |
| `isEmpty` | boolean | `true` when the selection is collapsed (cursor only). |
| `range` | `{from, to}` | ProseMirror positions in WYSIWYG mode; character offsets in source mode. |
| `mode` | `"wysiwyg"` \| `"source"` | Disambiguates the position space of `range`. |
| `kind` | `"markdown"` \| `"yaml-workflow"` | Document kind discriminator. |
| `tabId` | string | Echoed for confirmation. |
| `revision` | string | Pass back into `set` for optimistic concurrency. |

### `set`

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | No |
| `content` | string | Yes |
| `expected_revision` | string | No (recommended) |

Replaces whatever the editor reports as the current selection. **In WYSIWYG mode**, plain inline text inserts as a literal text node so leading/trailing whitespace round-trips exactly; content carrying markdown markers (`**bold**`, `*italic*`, `` `code` ``, fenced code, blockquotes, lists, etc.) is parsed as markdown and inserted as the corresponding nodes. **In source mode**, `content` is always spliced as raw text — the source surface is already markdown bytes. Empty `content` deletes the selection. When the selection is collapsed, `content` is inserted at the cursor.

Returns `{revision, replaced_chars}` on success. `replaced_chars` is the length of the text that was selected before the call — useful for the AI to confirm it edited what it expected.

`STALE` returns `{error: "STALE", message, current_revision}` exactly like `document.write`. The doc-level revision catches keystrokes between `get` and `set`. Pure cursor movement (without a keystroke) is not arbitrated by the server — if the user moved the cursor between `get` and `set`, the edit lands at the new position.

---

## Errors

Two error shapes appear:

**Domain errors** — set `success: false` and return a JSON-encoded envelope in `error`:

```json
{ "error": "STALE", "message": "...", "current_revision": "rev-..." }
```

**Argument-shape errors** — for missing/invalid required arguments (e.g., `document.write` without a `content` field), `error` is a plain string describing the problem. The structured envelope is reserved for domain-level conditions.

| Code | Surfaced as | Meaning |
|---|---|---|
| `STALE` | envelope | `expected_revision` did not match; re-read and retry |
| `INVALID_PATCH` | envelope | `workflow.apply_patch` received a malformed `patches` array |
| `INVALID_TAB` | envelope | `tabId` could not be resolved |
| `INVALID_PATH` | envelope | `workspace.open` received a `filePath` that could not be read |
| `NOT_WORKFLOW` | envelope | `workflow.*` was called on a non-YAML-workflow tab |
| `READ_ONLY` | envelope | A mutation was attempted on a read-only document |
| `NO_EDITOR` | envelope | `selection.*` was called but the focused tab has no live editor |
| `INTERNAL` | envelope | Unexpected handler error |
| (plain string) | string | Required argument missing or wrong type |

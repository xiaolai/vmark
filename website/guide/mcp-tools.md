---
vmark:
  id: 019f758c-550e-7582-b14e-1de8b3ec45a5
---
# MCP Tools Reference

VMark exposes **ten composite MCP tools** to AI assistants: `session`, `workspace`, `document`, `workflow`, `selection`, `comments`, `browser`, `browser_read`, `coherence`, and `coherence_resolve`. Together they cover the editor spine, file/window lifecycle, CST-safe workflow edits, targeted selection edits, bounded browser navigation, and a view of the workspace coherence layer.

Three of the ten — `session`, `browser_read`, and `coherence` — declare `readOnlyHint: true`, so an MCP client can auto-approve them. That is why `browser`/`browser_read` and `coherence`/`coherence_resolve` are separate tools at all: annotations are **per tool**, not per action, so a tool that bundles an ARIA snapshot with `execute_js` has to advertise the danger of `execute_js`. Splitting along "does this modify anything?" lets each half state the truth, and keeps the surface's genuinely destructive actions conspicuous in the tool list.

The previous 12-tool / 76-action surface was pruned because in-document formatting tools (bold, headings, tables, etc.) duplicate work that AI agents already do trivially via Markdown round-trip. `selection` was kept (per ADR-7 of the pruning plan) because the full-doc round-trip is uneconomical on large files — every edit pays the whole document in input tokens, the whole document in output tokens (~5× input price), and a longer write window that widens the stale-revision retry loop. See [the MCP pruning plan](https://github.com/xiaolai/vmark/blob/main/.claude/adr/plans/20260504-mcp-pruning.md) for the full rationale.

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
      "activeWorkspaceInstanceId": "wsi-a1b2c3",
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown",
          "active": true,
          "visible": true
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow",
          "active": false,
          "visible": false
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.2.0"
  }
}
```

#### Knowing what is actually on screen

A tab can exist, be addressable, and still not be showing. Three fields say so:

| Field | Meaning |
|---|---|
| `tab.active` | This tab is its window's current tab. |
| `tab.visible` | This tab renders right now. It is `false` when the tab belongs to a workspace instance the window is not currently showing. |
| `window.activeWorkspaceInstanceId` | The workspace instance the window is showing, or `null` when the workspace rail is off (then every tab is visible). |

`window.focused` is the window the **user** is looking at, read from the operating system. It is not "the window that answered this request" — VMark routes a request to whichever window owns the relevant workspace, which in a multi-window session is often a different one.

`windows` lists every document window — `main` and each window opened from Finder or the command line — because VMark asks all of them. When you are typing in your AI client, no VMark window holds focus and every `focused` is `false`; a request without a `tabId` or a workspace path then goes to the document window you used last, not to `main`.

Treat these as the confirmation step: after `workspace.switch_tab`, a follow-up `get_state` tells you whether the tab is really in front of the user. `switch_tab` itself re-reads the stores before answering, so it reports `activated: false` when an activation did not land rather than echoing the request back.

The `kind` discriminator tells you whether to use `document.write` (for markdown) or `workflow.apply_patch` (for yaml-workflow) on that tab.

---

## `workspace`

File and window lifecycle. Nothing in-document.

> **Path scope.** File operations (`open`, `save`, `save_as`) are confined to
> the open workspace root and the directories of already-open documents. A
> request for a path outside that scope is refused with `INVALID_PATH`. With
> no workspace and no open document, there is no scope, so file operations are
> refused. This keeps an automated client acting within what you have opened.

### `new`

Create a new untitled tab.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `kind` | string | No | `"markdown"` (default) or `"yaml-workflow"` |
| `windowLabel` | string | No | Target window; defaults to focused |

Returns `{tabId}`.

### `open`

Open a **file** from disk into a **background** tab — the user's visible tab
and workspace do not change. Chain the returned `tabId` into `document` /
`selection` calls; use `switch_tab` only when the user should *see* the tab.

| Parameter | Type | Required |
|-----------|------|----------|
| `filePath` | string | Yes |
| `windowLabel` | string | No |

Returns `{tabId, workspaceInstanceId, activationChanged, workspaceSwitched}`.

### `open_workspace`

Open a **folder** as the active workspace. Unlike `open` (a single file inside an
already-consented tree), this grants the assistant access to a whole new file
tree, so it is **gated by a one-time user approval** and is not covered by the
path scope above.

| Parameter | Type | Required |
|-----------|------|----------|
| `folderPath` | string | Yes |

`windowLabel` is **not** accepted here, unlike `new` and `open`. The folder
always opens in the window the request arrives on. This is deliberate: the
approval dialog and the open must land in the same window, and a
client-supplied label could put the prompt in front of one window while
mutating another — approving one thing and getting another. Multi-window
targeting needs request routing that does not exist yet.

**Approval flow.** The first call returns `{needsApproval: true}` and raises a
consent dialog naming the *canonical* folder path (symlinks resolved). The
assistant should ask the user, then **retry the same call**; once the user
approves, the retry opens the folder. The approval belongs to the connection that asked for it: only a retry from the same MCP connection can use it. Another connected assistant gets its own prompt, and a client that reconnected (a new connection) must be approved again. The approval also expires if it is not used within five minutes. A denied request keeps failing until it is
re-approved. There is no "remember" option — each open is approved individually.

**Folder access.** Approving the dialog does not by itself let VMark read a folder outside the places it can always read (your home folder and mounted volumes). For such a folder, the approved retry opens VMark's folder picker at that folder and returns `APPROVAL_REQUIRED`, asking the user to choose it there; once they do, the next retry opens it. If another folder dialog is already open, nothing is shown and the reply is `BUSY` — the approval is kept, so retry once the user has closed that dialog. `BUSY` is also the reply while a workspace switch is already running in that window.

### `save`

Save a tab to its existing path.

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | No (defaults to focused) |

Returns `{filePath, revision, journaled}`.

### `save_as`

Save a tab to a new path.

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | No |
| `filePath` | string | Yes |

Returns `{revision, journaled}`.

Saving to a path other than the tab's own current file is treated as a new
write. When **Auto-approve saves to a new location and genie results** (Settings → Integrations) is off (the
default), such a request is refused with `APPROVAL_REQUIRED` and a toast tells
you what was blocked. Saving back to the tab's own path is always allowed.

The path check runs again when the save's turn comes in the queue of saves to that file. A path that has left the scope by then (for example, the workspace was closed while the save waited) is refused with `INVALID_PATH`, and nothing is written.

`save_as` never replaces a file that is not the tab's own. A destination that already holds a file is refused with `APPROVAL_REQUIRED` — including a file created after the request was checked, while the save was in flight: the file is written only if nothing is at that path at the moment it is put in place, and the file found there keeps its contents. If the disk cannot write that way, the save is refused rather than overwriting.

A `save` or `save_as` is refused with `STALE` when a save made after this one — from any document or window — already reached that file, for example through a symlink and the file it points to, so this older one wrote nothing. Read the document before writing again. `document.write` reports the same case as `saved: false` with a `save_error`.

### `close`

Close a document tab. Refuses to discard unsaved work without `force`, and never closes a pinned tab.

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | Yes |
| `force` | boolean | No |

Returns `{closed: true}` on success. Otherwise `{closed: false, reason}`:

| `reason` | Meaning |
|----------|---------|
| `DIRTY` | The tab has unsaved changes and `force` was not supplied |
| `DIVERGENT` | The file changed on disk and the user kept the tab's version; without `force` the close would lose it |
| `PINNED` | The tab is pinned — refused even with `force`; the user must unpin it |

Keystrokes the editor has not yet passed on are counted as unsaved before the check. A browser tab is refused with an `INVALID_TAB` error — close it with the `browser` tool's `close` action.

### `switch_tab`

Activate a tab and make it **visible**. With the [workspace rail](/guide/workspace-rail)
enabled this may switch the user's active workspace context — the response
reports `workspaceSwitched: true` when it does, so the assistant should tell
the user.

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | Yes |

Returns `{activated, workspaceSwitched, workspaceInstanceId, activeTabId}`.

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
| `addresses` | string[] | No | Comment ids from `comments.list` this edit answers (at most 64) |
| `save` | boolean | No | Also save to disk (default `true`); `false` changes the tab only |

By default the write is saved: the response carries `saved: true`, or `saved: false` with `save_skipped` (`"untitled"` — the tab has no file yet, use `save_as`; `"opt_out"` — you passed `save: false`) or `save_error` (the disk write failed). When the target is the active WYSIWYG tab of a Markdown document, the text is loaded into the live editor (as one undoable step), and what is saved is the editor's serialization of it — the same Markdown, possibly normalized, not necessarily the exact characters sent. Other tabs save the text as sent, line endings normalized.

If the tab is closed after the write changed it but before the save ran, the reply is `saved: false` with a `save_error` saying the tab was closed. Nothing is written to the path the tab held.

Every save an AI client makes — through `write`, `workspace.save` or `workspace.save_as` — is filed in the document's history as an `mcp` snapshot (labelled *(mcp)* in the History sidebar), so the versions an AI wrote stand apart from yours. Like a manual save, it is never merged into a neighbouring autosave or skipped for its size.

Each save reply also carries `journaled` — on `write` only when a save ran. `"yes"`: VMark's agent edit journal recorded the saved text. `"pending"`: it is recorded, and takes its place in the document's history once a write still being recorded finishes. `"no"`: the file is saved, but the journal did not record it. A save is never an error because of the journal.

If `expected_revision` is supplied and the document has changed since that read, the response is a `STALE` structured-error envelope with the current revision; re-read and retry.

```json
// success
{ "revision": "rev-newAfterWrite", "applied": true, "durable": true, "saved": true }

// stale
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "rev-currentNow" }
```

While the user is composing text with an input method (IME) in the editor showing the tab, in WYSIWYG or Source mode, the write is refused with `BUSY` and nothing changes: the text being composed belongs to the input method until it is committed. A Source editor is also treated as composing for a short grace period just after the composition ends. Retry shortly.

Every write is recorded in VMark's agent edit journal before anything changes. The success response carries `applied: true` and `durable`: `durable: false` means the content was written but its journal record could not be stored yet — VMark retries it in the background, and until it lands the next write to that document is refused with `JOURNAL_DEGRADED`. If the journal refuses the record outright, the write stays applied, it is logged as unrecorded, and the next write goes ahead. A write is refused, changing nothing, with `JOURNAL_BUSY` while another write to the same document is being recorded (two windows showing one file share one document), with `STALE_PARENT` when another window wrote the document after this tab last did (re-read and retry), with `JOURNAL_UNAVAILABLE` when the journal is not running or does not answer in time, and with `INVALID_TEXT` when `content` holds a lone UTF-16 surrogate. If the user edits the document, closes the tab, starts composing with an input method, or moves the selection (or switches tabs, when no `tabId` was given) while the write is being recorded, the write is refused with `ABORTED` and a `reason` (`edited`, `closed`, `composing`, `selection`) and nothing changes; re-read and retry. An `INTERNAL` error that carries `applied: true` is different: the editor failed after the write had changed the document, and the text it then held was recorded (`durable` as above, `current_revision` the document's revision) — re-read before writing again. An `INTERNAL` error without `applied` after a failed write means the document may be partly changed; re-read it too.

### `transform`

Apply a deterministic rewrite. Currently supports CJK-specific transforms (full-width ↔ ASCII punctuation conversion, CJK ↔ Latin spacing).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tabId` | string | No | Target tab |
| `kind` | string | Yes | `"cjk-format"`, `"cjk-spacing"`, or `"cjk-punctuation"` |
| `expected_revision` | string | No | Concurrency token |
| `addresses` | string[] | No | Comment ids from `comments.list` this edit answers (at most 64) |

`cjk-format` applies the user's CJK formatting settings end-to-end. `cjk-spacing` inserts single spaces between CJK characters and adjacent Latin/digits. `cjk-punctuation` converts ASCII punctuation that sits beside CJK characters to its full-width form.

Returns `{revision, applied, durable}`. Like `write`, it is refused with `BUSY`, changing nothing, while the user is composing with an input method in the editor showing the tab, in WYSIWYG or Source mode. Like `write`, it is recorded in VMark's agent edit journal before anything changes: `applied`, `durable` and the journal refusals (`JOURNAL_BUSY`, `STALE_PARENT`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE`, `INVALID_TEXT`, `ABORTED`) mean the same; a call that changes nothing is not recorded.

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
| `addresses` | string[] | No |

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

Returns `{revision, applied, durable}` on success or a structured `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW` error envelope. Like `write`, it is recorded in VMark's agent edit journal before anything changes: `applied`, `durable` and the journal refusals (`JOURNAL_BUSY`, `STALE_PARENT`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE`, `INVALID_TEXT`, `ABORTED`) mean the same; a call that changes nothing is not recorded.

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
| `addresses` | string[] | No |

Replaces whatever the editor reports as the current selection. **In WYSIWYG mode**, plain inline text inserts as a literal text node so leading/trailing whitespace round-trips exactly; content carrying markdown markers (`**bold**`, `*italic*`, `` `code` ``, fenced code, blockquotes, lists, etc.) is parsed as markdown and inserted as the corresponding nodes. **In source mode**, `content` is always spliced as raw text — the source surface is already markdown bytes. Empty `content` deletes the selection. When the selection is collapsed, `content` is inserted at the cursor.

Returns `{revision, replaced_chars, applied, durable}` on success. `replaced_chars` is the length of the text that was selected before the call — useful for the AI to confirm it edited what it expected. Like `write`, it is recorded in VMark's agent edit journal before anything changes: `applied`, `durable` and the journal refusals (`JOURNAL_BUSY`, `STALE_PARENT`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE`, `INVALID_TEXT`, `ABORTED`) mean the same; a call that changes nothing is not recorded.

`STALE` returns `{error: "STALE", message, current_revision}` exactly like `document.write`. The doc-level revision catches keystrokes between `get` and `set`. Pure cursor movement (without a keystroke) is not arbitrated by the server — if the user moved the cursor between `get` and `set`, the edit lands at the new position.

`set` returns `BUSY`, changing nothing, while the user is composing text with an input method in the focused editor, in WYSIWYG or Source mode; retry shortly. `get` is never refused for this.

---

## `comments`

Read and answer the user's review comments on a document. Resolving, reopening and deleting a comment are the user's decisions: the tool has no such action, and a call that asks for one is refused before it reaches VMark.

### `list`

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | No |
| `cursor` | string | No |

Returns `{doc, generation, threads, nextCursor?}`, oldest thread first. Each thread carries its `comment` id, its `state` (`open`, `addressed`, `resolved` or `reopened`), its `commentGen`, the quoted text it is anchored to, and its replies.

A long list comes in pages, each small enough to arrive whole. While `nextCursor` is present, call `list` again with `cursor` set to it. A thread split across pages carries `repliesFrom` and `repliesTotal`; its later parts carry only `comment`, `state`, `commentGen`, `continued: true` and the next replies. A body too long for any page as JSON text (only heavily escaped text) comes as `bodyBase64`, its UTF-8 bytes in base64, in place of `body`. A cursor whose thread was deleted, or one issued for another document, is refused with `STALE_COMMENT`: list again without one.

### `reply`

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | No |
| `commentId` | string | Yes |
| `body` | string | Yes |
| `expectedCommentGen` | string | Yes |

Adds a reply to the thread. VMark mints the reply id itself, so a retried call is answered with the first result and never adds a second reply.

### `mark_addressed`

| Parameter | Type | Required |
|-----------|------|----------|
| `tabId` | string | No |
| `commentId` | string | Yes |
| `expectedCommentGen` | string | Yes |

Marks the thread addressed. Whether to resolve it stays with the user.

`comments.reply` and `comments.mark_addressed` both name the thread's `commentGen` as `list` returned it. They are refused, changing nothing, with `STALE_COMMENT` when the thread changed or was deleted since (list again), `INVALID_COMMENT` when the comment id is malformed or names no comment of this document, `COMMENT_NOT_ALLOWED` when the thread is resolved, `COMMENT_LIMIT` when the thread has too many replies, the body is too long or the thread can change no more, and the journal refusals `JOURNAL_BUSY`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE` and `INVALID_TEXT`.

To say an edit answers comments, pass their ids as `addresses` to `document.write`, `document.transform`, `workflow.apply_patch` or `selection.set`. The link is recorded with the revision and shown in the document's history (a comment deleted later shows as a deleted comment); it moves no thread. More than 64 ids, a repeated id, or an id that is unknown, deleted, resolved or of another document is refused with `INVALID_ADDRESSES`, and nothing changes.

---

## `browser`

The **mutating** half of the embedded browser surface — everything that changes the page,
the tab, or a stored login. Read the page first with [`browser_read`](#browser-read):
every targeting mode here refers to what a read returned.

The browser tools follow **Settings → Advanced → macOS → Embedded browser**, which is
**on by default** on macOS — so these tools are available to a connected AI client
unless you turn it off. Every action fails with `BROWSER_DISABLED` while it is off.
URLs returned to MCP are redacted through the same boundary used by the app's browser
session state.

Annotated `readOnlyHint: false, destructiveHint: true` — accurate rather than merely
conservative, because every action here mutates something.

**Errors are typed.** A refusal arrives as `TOKEN: message` (`STALE_COMMAND`,
`NOT_GRANTED`, `EVAL_TIMEOUT`, `TAB_LIMIT`, …) with the same token — and any structured
data the app attached (a navigation ticket, an act's `reason`, the retry verb) — in
`structuredContent`. Match on the token, not the prose.

An `EVAL_TIMEOUT` is **indeterminate**, not a clean failure: the submitted script may
still have run to completion after the driver stopped waiting, so it carries
`data.detail.indeterminate: true` and must not be retried as though nothing happened —
read the page (`browser_read`) to learn what state it is in before acting again.

### `act`

Arguments: `tabId?`, `operation: "click" | "type" | "scroll" | "key"`, and per-operation
targets:

- **click / type** — a target, either `ref` (from a prior read) **or** `role` + `name`,
  and `text?` for typing. A `ref` is precise and order-independent but is only honored for
  an **already-granted** operation; if the action may need approval, use `role` + `name` so
  the prompt shows the user a readable element.
- **scroll** — `ref` (scroll it into view) **or** `dy` (a vertical pixel delta).
- **key** — `key` (e.g. `"Enter"`, `"Escape"`, `"Tab"`), optional `ref` to target, and
  optional `modifiers: {ctrl, shift, alt, meta}`.

`scroll` and `key` are act-class (approval-gated) and dispatch **synthetic** DOM events, so
a site gating on `event.isTrusted` may ignore them. Mutating operations require an
origin-scoped approval; AI-chosen uploads are never permitted.

**A click verifies its effect before reporting success, and refuses rather than
guesses.** The target is scrolled into view, must be visibly rendered (computed styles
and collapsed or transparent ancestors are checked, so a duplicate button inside a closed
accordion step is skipped, not clicked), and the click point is hit-tested — a target
covered by an overlay is refused with the occluder named (`covered by div.cmp-overlay`,
page data) rather than clicked through. When several visible elements share the role and
name the act is refused as `ambiguous` and `candidates` lists their refs — it never picks
one by document order. Other refusal reasons: `hidden`, `offscreen` (cannot be scrolled
into the viewport), `disabled` (including `pointer-events: none` and inert subtrees),
`upload` (file inputs are never automated) and `rejected-value` (the field sanitised the
text). Open shadow roots are walked; the response includes `matchedTotal` /
`matchedVisible` counts, the tab's current `url` and `generation` on success **and**
failure, and `popup: {url}` when the page tried to open a window during the act (VMark
blocks popups; the URL is what it wanted). `type` handles text fields, `<select>`
controls (pass the option's label or value; a missing option is refused as
`no-such-option`), and `contenteditable` regions. `key` emulates the default actions
synthetic events lack — Enter inside a form submits it, Tab moves focus — and reports
`defaultAction`.

**What an approval binds.** A `click` approval binds the element (role + name). A
`type`, `key` or `scroll` approval also binds the exact text, key (with modifiers) or
delta you asked for — the prompt shows it — so a retry with different content asks again.

### `workflow_run` / `workflow_cancel`

`workflow_run` runs a workflow you supply as `source` text on an AI-owned tab. Arguments:
`tabId?`, `source` (the workflow text — a small line-oriented grammar; you write it, the AI
does, or [`workflow_record`](#workflow-record) captures it from your own actions), `inputs?`
(a `{name: value}` map substituted into `{name}` references; every declared input must be
supplied and undeclared ones are refused), `allowRepeat?`, and `resumeRunId?` (see below).
It returns `{runId, steps, firstStep}` **immediately** — the run executes
**asynchronously**, because a multi-step run can outlive a single request. Poll
[`browser_read`](#browser-read)'s `workflow_status` for progress; while the run is waiting
on you it reports `pendingApproval`.

Deterministic steps — `click` / `type` / `navigate` in that grammar, and `extract`
— run inside VMark and are **individually approval-gated**, exactly like a hand-issued
`act`: the run authorizes each one on its own, so a workflow is not a way around the
approval prompts. `goal`, `confirm`, `api`, and any free-prose step **pause** the run for
the AI to handle by hand. **Resuming after a pause:** do the paused step (or have the AI
help you), then start a new run with `resumeRunId` set to the paused run — it inherits the
completed steps and treats the paused step as done, so nothing is submitted twice. A
re-run of the **same source and the same inputs** also skips write steps that already
succeeded this session (the completed-write ledger; skipped steps are reported as
`skipped`), unless `allowRepeat` is set. Different inputs are a different job and run in
full.

`workflow_cancel {tabId?, runId}` stops a run. It is **never approval-gated** — stopping is
always allowed — and it withdraws the run's pending prompts, aborts a step that is waiting
for your approval, and hands the tab back to you. A finished run reports `already-terminal`
and is left as it was; an unknown `runId` is `RUN_NOT_FOUND`. The run also stops the
moment you take over the browser (any interaction with the page or its chrome reclaims
control) — including while it is waiting on a prompt.

Runs are bounded (≤ 25 steps, source ≤ 64 KiB, and 120 s of **running** time — time spent
waiting on you does not count) and one at a time per tab.

### `workflow_record`

Records **your own actions** on an AI-owned tab into a replayable workflow. Arguments:
`tabId?`, `recordOp` (`"start"` or `"stop"`), and `site?` (the recorded workflow's
front-matter site id; defaults to `recording`).

`start` is **consent-gated** by the `record` permission, which — like `execute_js` and
`session` — is **never a standing grant**: every recording asks you fresh, so the AI can
never silently record you. Until you allow it, `start` returns `needsApproval`; once you do,
VMark arms a dormant page-world capture shim and begins recording the **clicks and field
edits** you perform. `stop` returns `{source, inputs, eventCount}` — the `source` is workflow
text you can save or hand straight to [`workflow_run`](#workflow-run-workflow-cancel).

The recording is **value-free by construction**, and this is not a filter that trusts the
page: nothing you type is ever captured. Every text field becomes a named `{input}` variable
(the value is supplied at replay, never recorded); a **password or one-time-code field**
becomes a `confirm:` step — a human gate you complete by hand at replay — so a secret is
never even parameterized; and every URL is stripped to origin + path, so a token in a query
string cannot survive. What is recorded is the **locators** you touched (ARIA role +
accessible name), never their data. Recording follows you across page navigations and is
bounded (200 events per page, 1,000 per session).

### `open`

Arguments: `url`, optional `timeoutMs` (1–9,000 ms), and optional `profile`
(`[A-Za-z0-9._-]`, macOS 14+, sandbox posture): a **named persistent context** so a login
can be reused by name — opening one needs a fresh per-use approval, and the AI never sees
the credentials. Creates an AI-owned tab using the current Sandbox or Shared posture,
brings it to the front, and returns its `tabId`, `navigationId`, URL, title, and generation
after the load completes. At most **8 AI-owned tabs** may be open (`TAB_LIMIT`); the AI
closes what it is done with. In Shared posture an `open` that needs your destination
approval keeps its tab and tells the AI to retry with `navigate` on that `tabId`
(`data.retry`) — a fresh `open` would create a tab the approval cannot cover.

### `navigate`

Arguments: `tabId?`, `url`, and optional `timeoutMs`. Navigates an AI-owned tab (bringing
it to the front) and returns the navigation ticket result. A `TIMEOUT` still carries the
ticket so a later `wait` can retrieve the terminal result.

### `close`

Arguments: `tabId`. Closes an AI-owned tab the AI opened. **Never approval-gated** —
stopping is always allowed. A human tab is refused (`TAB_NOT_AI_OWNED`). The result is
`{tabId, closed: true, destroyed: true}` once the native view is confirmed gone; a
teardown the driver could not confirm after its retries is reported as
`TAB_TEARDOWN_FAILED` with `data.destroyed: false` — the tab record is already gone,
so do not retry the close; tell the user a native view may still be running.

**Gate detection.** A loaded `open` / `navigate` / `wait` result may carry
`gate: {kind, hint}` when the landed page reads as a **login wall**, **consent
interstitial**, **human-verification challenge**, or **rate limit** — so the AI learns it
is not looking at the content it asked for, at the moment it reads the result. Detection
is precision-first (a rendered challenge widget, or at least two independent signals on a
terse page — a `$429` price, a "Protected by Cloudflare" footer, or an article *about*
CAPTCHAs never classify) and purely advisory: it changes what the AI is told, never what
is authorized, and every hint points at involving you rather than routing around the
gate.

### `style`

Arguments: `tabId?`, a target (`ref` **or** `selector`), and one of `set: {prop: value}`,
`addClasses`, `removeClasses`, or `injectCss`. Dismiss a blocking overlay, highlight a
target, etc. **Act-class** (approval-gated, op `style`). Isolated content world.

### `execute_js`

Arguments: `tabId?`, `script` — an async function body that `return`s (or awaits) a
JSON-serializable value. The escape hatch for what the structured verbs cannot express.
It runs in the **isolated content world** — it shares the DOM (so `querySelector`,
`element.style` work) but **cannot** see the page's own JS heap/globals. The value comes
back as `result` (`undefined` becomes `null`); a throw, or a value JSON cannot encode, is a
**failure naming the error**, never a result. It is approved **per call only** (never a
standing grant, enforced in the Rust driver), the approval shows the script, and the
return value is flagged **untrusted** and never auto-fed into a later `act`. Prefer
`query`/`style` first.

### `session_save` / `session_load`

Arguments: `tabId?`, `handle` (`[A-Za-z0-9._-]`, 1–128 chars). `session_save` snapshots
the tab's session into an **OS-keychain** entry named by `handle` and returns a
value-free summary (counts); `session_load` restores it and returns `{loaded: true,
handle}` — a confirmation plus the AI-supplied handle, never any values. A `session_load`
only applies to a page with the **same origin** the session was saved from. This is
credential-**by-reference** (ADR-A7): the AI names a saved session and never receives
cookie/token values, which are never logged. Both are the `session` permission —
**never a standing grant** (approved per call), and an approval for one handle cannot
be spent on another. A saved session covers `localStorage` **and cookies**, both scoped
to the origin the page was committed to when you saved.

### `console_clear`

Arguments: `tabId?`. Returns `{entries: [{level, text}], url}` exactly like
[`browser_read`](#browser-read)'s `console`, **and drains the buffer** so the next read
sees only new output. It lives here rather than with the other console read because
draining evaluates `element.textContent = "[]"` in the page — a DOM write.

Shared posture asks for destination approval for every new origin unless a matching
`navigate` grant exists. A human-created tab requires an ephemeral attachment approval
before AI read/act. Sandbox tabs use a separate non-persistent AI cookie store.

---

## `browser_read`

The **read-only** half: observe the tab without changing it. Annotated
`readOnlyHint: true`, so an MCP client may auto-approve it — which is the point of the
split. These actions used to live on `browser`, where one tool-level annotation had to
describe `execute_js` as well, so taking an ARIA snapshot cost a human approval.

`openWorldHint` stays `true`: read-only describes what the tool *changes*, not whether
the bytes can be trusted. Everything returned is page-controlled and **untrusted** —
never feed a result straight back as a `browser` act target.

### `read`

Returns `{url, snapshot, truncated?, unreachable?}` for the focused browser tab, or the
tab named by `tabId`. `snapshot` is an ARIA-oriented list of `{role, name, ref}` nodes —
plus `level` for headings, `checked`, `disabled`, and `upload: true` for a file input the
AI can never operate — each `ref` (e.g. `"e5"`) a stable handle for that element, valid for
the life of the current view. The walk enters open shadow roots; `unreachable` counts the
closed shadow roots and frames it could not enter, and `truncated: true` means the node cap
(2,000) or the name cap (200 characters) bit.

### `screenshot`

Arguments: `tabId?`. Returns an **image content block** (base64 JPEG, quality-bounded) of
the tab's current rendering, plus a text line naming the page — a visual channel onto
layout and rendered state the ARIA snapshot cannot describe. It is captured natively
(`takeSnapshot`) and reads no page DOM or JavaScript. Read-class: authorized exactly like
`read` (allowed on an AI-owned tab; a human tab needs an attachment, consumed on capture).
A tab that is not the visible page may render blank — `open` and `navigate` bring a tab
to the front.

### `query`

Arguments: `tabId?`, `selector` (CSS), and optional `fields: {attributes, box, styles:[...]}`.
Returns `{count, elements: [{ref, tag, text, …}], truncated?}` — structured DOM data the
ARIA snapshot cannot name (tables, computed values) — capped at 50 elements and 500
characters of text each (`truncated: true` when the selector matched more). **Read-class.**
Runs in the isolated content world.

### `extract`

Arguments: `tabId?`. Returns `{title, byline, url, markdown, textLength, truncated}` — the
page as **reader-mode Markdown**, for pages the AI wants to *read* rather than operate.
One capped capture exports the page's HTML; the extraction itself runs in VMark, never in
the page: a **site plugin** registered for the origin gets first claim (the built-in
Wikipedia plugin strips wiki chrome — infoboxes, navboxes, hatnotes, edit links — by
name), and a generic density-heuristic reader is the fallback for every other site.
`truncated: true` means the page exceeded the capture cap and the tail went unread.
**Read-class.** Everything returned is page-derived and untrusted.

### `workflow_status`

Arguments: `tabId?`, `runId` (from `workflow_run`). Returns `{status, completedSteps,
skippedSteps, stepCount, firstStep, pausedAt?, pendingApproval?, reasonCode?, reason?,
resumedFrom?, stepResults}` where `status` is one of `running` / `paused` / `completed` /
`failed` / `cancelled` / `superseded`, `stepResults` holds one entry per step
(`{index, status, attempts, reason?, data?}`), and `pendingApproval` is present while the
run is waiting for your decision. A `paused` status names the step that needs you in
`pausedAt`. **Read-class** — poll it freely.

### `console`

Arguments: `tabId?`. Returns `{entries: [{level, text}], url}` — the page's captured
`console.*` output, plus **uncaught errors and unhandled promise rejections** (recorded as
`level: "error"` entries prefixed `Uncaught` / `Unhandled rejection:` — the signal
`console.*` patching alone never sees). AI-owned tabs only (Sandbox and Shared posture
alike; a human tab carries no capture shim), main frame only. The capture works by a
page-world shim that writes into a hidden DOM buffer which the driver reads from the
isolated world — so **no messaging channel** is opened back into VMark (the no-bridge
guarantee holds). The output is page-controlled and **untrusted** — treat it like a
`read`, never as an `act` target.

The buffer is a bounded ring, so consecutive reads overlap. To drain it as you read, use
[`browser`](#browser)'s `console_clear` — draining writes `[]` into the page's buffer
element, which is a DOM write and therefore cannot live under `readOnlyHint: true`.

### `wait`

Arguments: `tabId?`, optional `navigationId` (omit it for the tab's latest ticket), and
optional `timeoutMs` (1–9,000 ms). It never starts a navigation, never changes focus or
the active tab, and never creates a view — it only observes, which is what lets it live
on the read-only tool. AI-owned tabs only. It returns a buffered load/failure result,
`NAVIGATION_SUPERSEDED`, or `TIMEOUT` when the ticket does not finish within the bound.

### `wait_for`

Arguments: `tabId?`, exactly one of `ref` (from a read), `role` (+ optional `name`),
`text` (a substring of visible text), or `urlContains` (a substring the tab's URL must
contain — confirms a click-triggered navigation landed, answered from the tab state with
no page round-trip), and optional `timeoutMs` (1–9,000 ms). Polls until the condition
holds or the timeout elapses and returns `{matched: true|false}` (plus the matched
element's `ref` for a ref/role condition) — so you can tell "found" from "timed out".
Read-class. Use it to make a flow deterministic: act, `wait_for` the result, then read.

Two rules follow from what it may see. `urlContains` matches the **redacted** URL — the
query string and fragment are stripped, because a token a redirect planted there must not
be probeable — so a needle containing `?` or `#` is refused up front. And on a human tab
attached with **Allow once** it is refused (`ATTACHMENT_ONCE_INSUFFICIENT`): polling is many
reads, and a one-read attachment cannot cover it — ask for **Allow until navigation**.

---

## `coherence`

A **read-only** view of the workspace coherence layer — which derived documents are stale against the upstreams they were generated from. No action modifies documents or editor state. `status` is read-only; `edges` reconciles first and may append provenance records to the workspace ledger, but never changes document content. All are answered entirely by the Rust backend from the per-workspace kernel, so they work even when no editor window is in the foreground.

Two further read-only actions expose the semantic layer:

- `claims` — the current canon claims: `{claim, entryId, statement, maturity, invalidAt, visible}`. Only `established` claims constrain semantic checks; `visible` reflects the default context.
- `contexts` — the context set (the implicit `default` is always present): `{id, name, parent, enforcement, visibleClaims, errors}`.

Annotated `readOnlyHint: true`. The one mutating action, `resolve`, lives in its own tool — see [`coherence_resolve`](#coherence-resolve) — which is what lets this one be auto-approvable. Claim and context mutation are never exposed at all: canon stays human-controlled.

All actions require `workspace_root`: the absolute path of the workspace to query. Learn it from `session.get_state` (open tabs' `filePath`) or the workspace tool. A path that is missing, not absolute, or not a directory is refused with a plain-string error.

### `status`

Kernel status counters for one workspace.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workspace_root` | string | Yes | Absolute path of the workspace to query |

**Returns:**

```json
{
  "initialized": true,
  "objects": 12,
  "open_items": 2,
  "quarantined": 0,
  "writer": "0198c0de-0000-7000-8000-000000000001"
}
```

| Field | Meaning |
|---|---|
| `initialized` | `false` when the workspace has no coherence ledger yet (no `.vmark/` directory). All counters except `objects` are 0 in that case. |
| `objects` | Tracked objects (files with a coherence identity). |
| `open_items` | Live, non-fresh edges — the current breakdown size. |
| `quarantined` | Malformed ledger lines quarantined on the last read. |
| `writer` | This installation's writer id (UUID). |

### `edges`

The breakdown: every live dependency edge whose upstream has moved. Runs a scan-reconcile first, so the answer reflects the files on disk at call time.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workspace_root` | string | Yes | Absolute path of the workspace to query |

**Returns** an array — empty when everything is coherent:

```json
[
  {
    "txf": "0198c0de-0000-7000-8000-00000000000a",
    "input": 0,
    "upstream": "0198c0de-0000-7000-8000-00000000000b",
    "upstream_path": "characters/elena.md",
    "pinned": "rev-a1b2c3",
    "downstream": "0198c0de-0000-7000-8000-00000000000c",
    "downstream_path": "scenes/chapter-3.md",
    "downstream_rev": "rev-d4e5f6",
    "state": "version-stale"
  }
]
```

| Field | Meaning |
|---|---|
| `txf` / `input` | The transformation entry and input slot identifying this edge (pass these to the in-app resolution actions). |
| `upstream` / `upstream_path` | The object the downstream depends on, and its last-known path. |
| `pinned` | The upstream revision the downstream was generated from. |
| `downstream` / `downstream_path` / `downstream_rev` | The derived object, its path, and its current revision. |
| `state` | `"version-stale"`, `"stale-valid"`, `"stale-contradicted"`, `"stale-unknown"`, `"waived"`, `"diverged"`, `"diverged-multi-head"`, or `"unpinnable"`. |

Resolving an edge (accept-newer / waive) is normally a human action performed in VMark's Coherence Breakdown panel. An AI can do it only through [`coherence_resolve`](#coherence-resolve), and only when the workspace owner has explicitly delegated that to it.

---

## `coherence_resolve`

The **one mutating action** on the coherence layer, in its own tool so that
[`coherence`](#coherence) can stay auto-approvable — and so that something non-undoable is
conspicuous in the tool list rather than buried as one enum value among five. Annotated
`readOnlyHint: false, destructiveHint: true`.

### `resolve`

Arguments: `{workspace_root, txf, input, resolution: "accept-newer" | "waive", reason? (required for waive)}`.
`txf` and `input` come from a `coherence` → `edges` row.

Resolve a live stale edge as an explicitly delegated agent. Authorization is **fail-closed**:
the workspace owner must have granted **your authenticated bridge identity** a live,
unexpired delegation covering the resolution kind (granted in-app, from the Coherence Breakdown panel), and
the edge must still be live. Every delegated resolution is audit-logged against the grant,
and the entry cannot be undone. `coherence_resolve` cannot set an expiry, so an AI's waiver never
lapses on its own.

A refusal means the grant is missing or expired — ask the user to grant it rather than
retrying. Splitting this out of `coherence` changed no security property: authorization has
always keyed off the authenticated bridge principal, never off anything the client asserts.

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
| `STALE` | envelope | `expected_revision` did not match; re-read and retry. Or `save` / `save_as`: a save made after this one already reached that file, so this one wrote nothing — read before writing again |
| `INVALID_PATCH` | envelope | `workflow.apply_patch` received a malformed `patches` array |
| `INVALID_TAB` | envelope | `tabId` could not be resolved |
| `INVALID_PATH` | envelope | A `filePath` could not be read, or is outside the open workspace / document scope |
| `APPROVAL_REQUIRED` | envelope | `save_as` to a new location while **Auto-approve saves to a new location and genie results** is off; `save_as` to a path that already holds a file other than the tab's own; or `open_workspace` waiting for the user's approval, or for them to choose the folder in VMark's folder dialog |
| `BUSY` | envelope | `open_workspace` could not proceed: another folder dialog is open, or a workspace switch is running in that window; the approval is kept — retry. Or `document.write`, `document.transform` or `selection.set` arrived while the user was composing text with an input method; nothing was changed — retry shortly |
| `JOURNAL_BUSY` | envelope | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch` arrived while another write to the same document was being recorded; nothing was changed — retry shortly |
| `WRITE_BUSY` | string | A write-class call (`document.write` / `document.transform`, `selection.set`, `workflow.apply_patch`, `comments.reply` / `mark_addressed`, `coherence_resolve`, …) waited 3 s behind another write without its turn; it was not applied — retry |
| `TIMEOUT` | string | A `coherence` or `coherence_resolve` call did not finish within 20 s. For a write (`edges`, `resolve`) it is still running and its outcome is unknown — read the current state before retrying |
| `STALE_PARENT` | envelope | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: another window wrote the document after this tab last did; nothing was changed — re-read and retry |
| `JOURNAL_DEGRADED` | envelope | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: an earlier journal record for this document is still waiting to be stored; nothing was changed — retry in a few seconds |
| `JOURNAL_UNAVAILABLE` | envelope | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: the agent edit journal is not running or cannot record; nothing was changed |
| `INVALID_TEXT` | envelope | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: `content` contains a lone UTF-16 surrogate; nothing was changed |
| `REVIEW_BACKLOG_FULL` | envelope | `document.write`: the document has too many unreviewed AI changes; nothing was changed |
| `ABORTED` | envelope | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: the user edited, closed, composed in or moved the selection of the document while the write was being recorded; `reason` says which; nothing was changed — re-read and retry |
| `NOT_WORKFLOW` | envelope | `workflow.*` was called on a non-YAML-workflow tab |
| `READ_ONLY` | envelope | A mutation was attempted on a read-only document |
| `NO_EDITOR` | envelope | `selection.*` was called but the focused tab has no live editor |
| `INTERNAL` | envelope | Unexpected handler error |
| (plain string) | string | Required argument missing or wrong type |

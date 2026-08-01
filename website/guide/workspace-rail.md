# Workspace Rail

::: warning Experimental
The workspace rail is experimental and **off by default**. Enable it in **Settings → Workspace → Workspace rail mode**. With the rail off, VMark behaves exactly as before — one workspace per window.
:::

The workspace rail lets one window hold **several workspaces at once**, shown as a vertical strip of colored glyphs on the left edge. Clicking a workspace performs a **full context switch**: the editor tabs, the sidebar file tree, the split-pane layout, and the sidebar/outline state all swap to that workspace's own set — like switching Spaces in a browser, not just changing a filter.

## What switches, what stays

| Surface | On a rail switch |
|---------|------------------|
| Editor tab strip | Shows only the active workspace's tabs (plus browser pages) |
| Sidebar file tree | Re-roots to the active workspace, with its own folder-open and scroll state |
| Split panes | Each workspace remembers its own split layout |
| Outline | Per-tab collapse/filter/scroll state follows the workspace |
| Next/previous tab, tab context menu, Quick Open "open tabs" | Scoped to the active workspace |
| Reopen Closed Tab history | Partitioned per workspace (plus a shared browser history) |
| **Browser pages** | **Window-global** — reachable from every workspace |
| Recent Files / Recent Workspaces menus | Global |
| Autosave, save prompts, file watching | Cover **every** tab, hidden or not |

Switching never closes anything: a hidden workspace's tabs stay open in the background, keep autosaving, and still get a save prompt if you close the window with unsaved changes.

## Loose Files

Files opened from outside every workspace root live in a synthetic **Loose Files** entry (the stacked-files icon). Switching to it shows those tabs; it appears automatically when needed.

## Moving files between workspaces

Ownership follows the file's path:

- **Save As** into another workspace's folder moves the tab there — and, if it is the tab you're looking at, the visible workspace follows it.
- Renames or moves on disk (including from Finder) re-home the tab the same way.
- Opening a file that belongs to a *hidden* workspace (via Quick Open, recents, or a file dialog) switches to that workspace first, so the tab you asked for is the tab you see.

## Sessions and restart

Each workspace's config remembers **only its own tabs** and split layout. Human-opened browser pages persist per window. Hot exit restores every workspace of the window — including per-workspace sidebar state and reopen history — and reactivates the workspace you were in.

## AI (MCP) behavior

AI clients opening documents through MCP never yank your visible workspace: `workspace.open` creates a **background tab** and returns its `tabId` for follow-up document calls. Only the explicit `workspace.switch_tab` action changes what you see, and its response reports `workspaceSwitched: true` so the AI can tell you it happened. See the [MCP Tools Reference](/guide/mcp-tools).

## Rail actions

| Action | How |
|--------|-----|
| Switch workspace | Click its glyph |
| Add a workspace | **File > Open Workspace** (an already-railed folder switches to it instead of duplicating) |
| Reorder | Drag a glyph over another |
| Move to its own window | Drag a glyph out of the window |
| Duplicate to a new window | The **⧉** button on hover |
| Close a workspace | Right-click → Close (prompts per dirty tab) |

## Known limitation

On macOS, two spellings of the same folder that differ only in letter case (possible on case-insensitive volumes) are treated as **different** workspaces. This is deliberate: workspace identity is byte-exact on macOS and Linux, and case-folded on Windows.

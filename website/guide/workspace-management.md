# Workspace Management

A workspace in VMark is a folder opened as the root of your project. When you open a workspace, the sidebar shows a file tree, Quick Open indexes every markdown file, the terminal starts in the project root, and your open tabs are remembered for next time.

Without a workspace you can still open individual files, but you lose the file explorer, in-project search, and session restore.

## Opening a Workspace

| Method | How |
|--------|-----|
| Menu | **File > Open Workspace** |
| Quick Open | `Mod + O`, then select **Browse...** at the bottom |
| Drag and drop | Drag a markdown file from Finder into the window — VMark detects its project root and opens the workspace automatically |
| Recent Workspaces | **File > Recent Workspaces** and pick a previous project |

When you open a workspace, VMark shows the sidebar with the file explorer. If the workspace was opened before, previously open tabs are restored.

::: tip
If the current window has unsaved changes, VMark offers to open the workspace in a new window instead of replacing your work.
:::

## File Explorer

The file explorer appears in the sidebar whenever a workspace is open. It shows a tree of markdown files rooted at the workspace folder.

### Navigation

- **Single-click** a folder to expand or collapse it
- **Double-click** or **Enter** on a file to open it in a tab
- Non-markdown files open with your system's default application
- Folders start collapsed when a workspace is first opened; their open state is preserved while you switch between the Files, Outline, and History views

### Expand / Collapse All

Two buttons in the Files-view header toggle the entire tree at once:

- **Expand All Folders** — opens every folder in the tree
- **Collapse All Folders** — closes every folder back to the root

### File Operations

Right-click any file or folder to access the context menu:

| Action | Description |
|--------|-------------|
| Open | Open the file in a new tab |
| Rename | Edit the file or folder name inline (also `F2`) |
| Duplicate | Create a copy of the file |
| Move To... | Move the file to a different folder via a dialog |
| Delete | Move the file or folder to the system trash |
| Copy Path | Copy the absolute file path to the clipboard |
| Reveal in Finder | Show the file in Finder (macOS) |
| New File | Create a new markdown file in this location |
| New Folder | Create a new folder in this location |

You can also **drag and drop** files between folders directly in the tree.

### Visibility Toggles

By default the explorer shows only markdown files and hides dotfiles. Two toggles change this:

| Toggle | Shortcut | What it does |
|--------|----------|-------------|
| Show Hidden Files | `Mod + Shift + .` (macOS) / `Ctrl + H` (Win/Linux) | Reveals dotfiles and hidden folders |
| Show All Files | *(Settings or context menu)* | Shows non-markdown files alongside your documents |

Both settings are saved per-workspace and persist across sessions.

### Excluded Folders

Certain folders are excluded from the tree by default:

- `.git`
- `node_modules`

These defaults are applied when a workspace is first opened.

## Quick Open

Press `Mod + O` to open the Quick Open overlay. It provides fuzzy search across three sources:

1. **Recent files** you have opened before
2. **Open tabs** in the current window (marked with a dot indicator)
3. **All markdown files** in the workspace

Type a few characters to filter — matching is fuzzy, so `rme` finds `README.md`. Use arrow keys to navigate and **Enter** to open. A pinned **Browse...** row at the bottom opens a file dialog.

| Action | Shortcut |
|--------|----------|
| Open Quick Open | `Mod + O` |
| Navigate results | `Up / Down` |
| Open selected file | `Enter` |
| Close | `Escape` |

::: tip
Without a workspace, Quick Open still works — it shows recent files and open tabs but cannot search the file tree.
:::

## Recent Workspaces

VMark remembers up to 10 recently opened workspaces. Access them from **File > Recent Workspaces** in the menu bar.

- Workspaces are sorted by last-opened time (most recent first)
- The list syncs to the native menu on every change
- Choose **Clear Recent Workspaces** to reset the list

## Workspace Settings

Each workspace has its own configuration that persists between sessions. Settings are stored in the VMark application data directory — not inside the project folder — so your workspace stays clean.

The following settings are saved per workspace:

| Setting | Description |
|---------|-------------|
| Excluded folders | Folders hidden from the file explorer |
| Show hidden files | Whether dotfiles are visible |
| Show all files | Whether non-markdown files are visible |
| Last open tabs | File paths for session restore on next open |

::: tip
Workspace configuration is tied to the folder path. Opening the same folder on the same machine always restores your settings, even from a different window.
:::

## Session Restore

When you close a window that has a workspace open, VMark saves the list of open tabs to the workspace config. The next time you open the same workspace, those tabs are restored automatically.

- Only tabs with a saved file path are restored (untitled tabs are not persisted)
- If a file has been moved or deleted since the last session, it is silently skipped
- Session data is saved on window close and on workspace close (`File > Close Workspace`)

## Multi-Window

Each VMark window can have its own independent workspace. This lets you work on multiple projects simultaneously.

- **File > New Window** opens a fresh window
- Opening a workspace in a new window does not affect other windows
- Window size and position are remembered per window

When you drag a markdown file from Finder and the current window already has unsaved work, VMark opens the file's project in a new window automatically.

### Detaching Tabs into New Windows

You can pull a tab out of its window to create a new one:

- **Drag a tab downward** past the tab bar (about 40 px) to detach it into a new window at the cursor position
- **Drag a tab horizontally** within the tab bar to reorder it among other tabs
- Pinned tabs cannot be dragged

The gesture is direction-locked: horizontal movement starts a reorder, while vertical movement triggers a detach. You can switch from reorder to detach mid-drag by moving the pointer outside the tab bar.

## External Changes

VMark watches your workspace for changes made by other programs (Git, external editors, build tools, etc.) and keeps open documents in sync.

- **Unmodified files** are reloaded automatically when their contents change on disk. A brief toast notification confirms the reload.
- **Files with unsaved changes** trigger a prompt dialog with three options: **Save As** (save your version to a new location), **Reload** (discard your changes and load from disk), or **Keep** (preserve your edits and mark the file as divergent).
- **Deleted files** are marked as missing in their tab but not closed — you can still save the content to a new location.
- When multiple dirty files change at once (e.g., after a `git checkout`), VMark batches them into a single dialog so you can reload all, keep all, or review each file individually.
- If a divergent file's disk content later matches what you have in the editor (e.g., a `git checkout` restores the same text), VMark auto-clears the divergent state so normal auto-save resumes.

VMark filters out its own saves so you are never prompted by changes you made within the app.

## macOS Dock Recent Documents

Documents you open in VMark are registered with macOS, so they appear in the **Open Recent** submenu when you right-click the VMark icon in the Dock.

## Terminal Integration

The integrated terminal automatically uses the workspace root as its working directory. When you open or switch workspaces, all terminal sessions `cd` to the new root.

The `VMARK_WORKSPACE` environment variable is set to the workspace path in every terminal session, so your scripts can reference the project root.

[Learn more about the terminal →](/guide/terminal)

## Shell CLI Command

VMark can install a `vmark` shell command so you can open files and folders from the terminal.

### Installing

Go to **Help > Install 'vmark' Command**. VMark writes a small launcher script to `/usr/local/bin/vmark` and asks for your administrator password (the same approach VS Code uses for its `code` command).

### Usage

```bash
# Open a file
vmark README.md

# Open a folder as a workspace
vmark ~/projects/my-blog

# Open multiple files
vmark chapter1.md chapter2.md
```

The command delegates to `open -b app.vmark`, so macOS handles single-instance behavior — files open in your existing VMark window rather than spawning a new process.

### Uninstalling

Go to **Help > Uninstall 'vmark' Command** to remove `/usr/local/bin/vmark`. If the file at that path was not installed by VMark, the operation is blocked and you are asked to remove it manually.

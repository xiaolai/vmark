# Smart Tab Navigation

VMark's Tab and Shift+Tab keys are context-aware — they help you navigate efficiently through formatted text, brackets, and links without reaching for arrow keys.

> With the experimental [workspace rail](/guide/workspace-rail), tab cycling and the tab strip cover only the active workspace's tabs.

## Quick Overview

| Context | Tab Action | Shift+Tab Action |
|---------|------------|------------------|
| Inside brackets `()` `[]` `{}` | Jump past closing bracket | Jump before opening bracket |
| Inside quotes `""` `''` | Jump past closing quote | Jump before opening quote |
| Inside CJK brackets `「」` `『』` | Jump past closing bracket | Jump before opening bracket |
| Inside **bold**, *italic*, `code`, ~~strike~~ | Jump after the formatting | Jump before the formatting |
| Inside a link | Jump after the link | Jump before the link |
| In a table cell | Move to next cell | Move to previous cell |
| In a list item | Indent the item | Outdent the item (stops at the outermost level) |

## Bracket & Quote Escape

When your cursor is right before a closing bracket or quote, pressing Tab jumps over it. When your cursor is right after an opening bracket or quote, pressing Shift+Tab jumps back before it.

### Supported Characters

**Standard brackets and quotes:**
- Parentheses: `( )`
- Square brackets: `[ ]`
- Curly braces: `{ }`
- Double quotes: `" "`
- Single quotes: `' '`
- Backticks: `` ` ``

**CJK brackets:**
- Fullwidth parentheses: `（ ）`
- Lenticular brackets: `【 】`
- Corner brackets: `「 」`
- White corner brackets: `『 』`
- Double angle brackets: `《 》`
- Angle brackets: `〈 〉`

**Curly quotes:**
- Double curly quotes: `" "`
- Single curly quotes: `' '`

### How It Works

```text
function hello(world|)
                    ↑ cursor before )
```

Press **Tab**:

```text
function hello(world)|
                     ↑ cursor after )
```

This works with nested brackets too — Tab jumps over the immediately adjacent closing character.

Press **Shift+Tab** reverses the action — if cursor is right after an opening character:

```text
function hello(|world)
               ↑ cursor after (
```

Press **Shift+Tab**:

```text
function hello|(world)
              ↑ cursor before (
```

### CJK Example

```text
这是「测试|」文字
         ↑ cursor before 」
```

Press **Tab**:

```text
这是「测试」|文字
          ↑ cursor after 」
```

## Formatting Escape (WYSIWYG Mode)

In WYSIWYG mode, Tab and Shift+Tab can escape from inline formatting marks.

### Supported Formats

- **Bold** text
- *Italic* text
- `Inline code`
- ~~Strikethrough~~
- Links

### How It Works

When your cursor is anywhere inside formatted text:

```text
This is **bold te|xt** here
                 ↑ cursor inside bold
```

Press **Tab**:

```text
This is **bold text**| here
                     ↑ cursor after bold
```

Shift+Tab works in reverse — it jumps to the start of the formatting:

```text
This is **bold te|xt** here
                 ↑ cursor inside bold
```

Press **Shift+Tab**:

```text
This is |**bold text** here
        ↑ cursor before bold
```

### Link Escape

Tab and Shift+Tab also escape from links:

```text
Check out [VMark|](https://vmark.app)
               ↑ cursor inside link text
```

Press **Tab**:

```text
Check out [VMark](https://vmark.app)| and...
                                    ↑ cursor after link
```

Press **Shift+Tab** inside a link moves to the start:

```text
Check out |[VMark](https://vmark.app) and...
          ↑ cursor before link
```

## Link Navigation (Source Mode)

In Source mode, Tab provides smart navigation within Markdown link syntax.

### Nested and Escaped Brackets

VMark handles complex link syntax correctly:

```markdown
[text [with nested] brackets](url)     ✓ Works
[text \[escaped\] brackets](url)       ✓ Works
[link](https://example.com/page(1))    ✓ Works
```

Tab navigation correctly identifies link boundaries even with nested or escaped brackets.

### Standard Links

```markdown
[link text|](url)
          ↑ cursor in text
```

Press **Tab** → cursor moves to URL:

```markdown
[link text](|url)
            ↑ cursor in URL
```

Press **Tab** again → cursor exits the link:

```markdown
[link text](url)|
                ↑ cursor after link
```

### Wiki Links

```markdown
[[page name|]]
           ↑ cursor in link
```

Press **Tab**:

```markdown
[[page name]]|
             ↑ cursor after link
```

## Source Mode: Markdown Character Escape

In Source mode, Tab also jumps over Markdown formatting characters:

| Characters | Used For |
|------------|----------|
| `*` | Bold/italic |
| `_` | Bold/italic |
| `^` | Superscript |
| `~~` | Strikethrough (jumped as a unit) |
| `==` | Highlight (jumped as a unit) |

### Example

```markdown
This is **bold|** text
              ↑ cursor before **
```

Press **Tab**:

```markdown
This is **bold**| text
                ↑ cursor after **
```

::: info
Source mode does not have Shift+Tab escape for markdown characters — Shift+Tab only outdents (removes leading spaces).
:::

## Source Mode: Auto-Pair

In Source mode, typing a formatting character auto-inserts its closing pair:

| Character | Pairing | Behavior |
|-----------|---------|----------|
| `*` | `*\|*` or `**\|**` | Delay-based — waits 150ms to detect single vs double |
| `~` | `~\|~` or `~~\|~~` | Delay-based |
| `_` | `_\|_` or `__\|__` | Delay-based |
| `=` | `==\|==` | Always pairs as double |
| `` ` `` | `` `\|` `` | Single backtick pairs after delay |
| ` ``` ` | Code fence | Triple backtick at line start creates a fenced code block |

Auto-pairing is **disabled inside fenced code blocks** — typing `*` in a code block inserts a literal `*` without pairing.

Backspace between a pair deletes both halves: `*\|*` → Backspace → empty.

## Table Navigation

When cursor is inside a table:

| Action | Key |
|--------|-----|
| Next cell | Tab |
| Previous cell | Shift + Tab |
| Add row (at last cell) | Tab |

Tab at the last cell of the last row automatically adds a new row.

## List Indentation

When cursor is in a list item:

| Action | Key |
|--------|-----|
| Indent item | Tab |
| Outdent item | Shift + Tab |

Outdent removes one level of nesting and **stops at the outermost level** — it
will not lift an item out of the list. To leave a list entirely, use **Remove
List**, or press the list button again to toggle it off.

## Settings

Tab escape behavior can be customized in **Settings → Editor**:

| Setting | Effect |
|---------|--------|
| **Auto-pair Brackets** | Enable/disable bracket pairing and Tab escape |
| **CJK Brackets** | Include CJK bracket pairs |
| **Curly Quotes** | Include curly quote pairs (`""` `''`) |

::: tip
If Tab escape conflicts with your workflow, you can disable auto-pair brackets entirely. Tab will then insert spaces (or indent in lists/tables) as normal.
:::

## Comparison: WYSIWYG vs Source Mode

| Feature | Tab (WYSIWYG) | Shift+Tab (WYSIWYG) | Tab (Source) | Shift+Tab (Source) |
|---------|---------------|---------------------|--------------|-------------------|
| Bracket escape | ✓ | ✓ | ✓ | — |
| CJK bracket escape | ✓ | ✓ | ✓ | — |
| Curly quote escape | ✓ | ✓ | ✓ | — |
| Mark escape (bold, etc.) | ✓ | ✓ | N/A | N/A |
| Link escape | ✓ | ✓ | ✓ (field navigation) | — |
| Markdown char escape (`*`, `_`, `~~`, `==`) | N/A | N/A | ✓ | — |
| Markdown auto-pair (`*`, `~`, `_`, `=`) | N/A | N/A | ✓ (delay-based) | N/A |
| Table navigation | Next cell | Previous cell | N/A | N/A |
| List indentation | Indent | Outdent | Indent | Outdent |
| Multi-cursor support | ✓ | ✓ | ✓ | — |
| Skipped inside code blocks | ✓ | ✓ | ✓ | N/A |

## Multi-Cursor Support

Tab escape works with multiple cursors — each cursor is processed independently.

### How It Works

When you have multiple cursors and press Tab or Shift+Tab:
- **Tab**: Cursors inside formatting escape to the end; cursors before closing brackets jump over them
- **Shift+Tab**: Cursors inside formatting escape to the start; cursors after opening brackets jump before them
- Cursors in plain text stay in place

### Example

```text
**bold|** and [link|](url) and plain|
     ^1          ^2            ^3
```

Press **Tab**:

```text
**bold**| and [link](url)| and plain|
        ^1               ^2         ^3
```

Each cursor escapes independently based on its context.

::: tip
This is particularly powerful for bulk editing — select multiple occurrences with `Mod + D`, then use Tab to escape from all of them at once.
:::

## Priority & Code Block Behavior

### Escape Priority

When multiple escape targets overlap, Tab processes them **innermost-first**:

```text
**bold text(|)** here
               ↑ Tab jumps ) first (bracket is innermost)
```

Press **Tab** again:

```text
**bold text()**| here
               ↑ Tab escapes bold mark
```

This means bracket jump always fires before mark escape — you can rely on Tab to exit brackets first, then formatting.

### Code Block Guard

Tab and Shift+Tab bracket jumps are **disabled inside code blocks** — both `code_block` nodes and inline code spans. This prevents Tab from jumping over brackets in code, where brackets are literal syntax:

```text
`array[index|]`
              ↑ Tab does NOT jump ] in inline code — inserts spaces instead
```

Auto-pair insertion is also disabled inside code blocks for both WYSIWYG and Source modes.

## Tips

1. **Muscle memory** — Once you get used to Tab escape, you'll find yourself navigating much faster without arrow keys.

2. **Works with auto-pair** — When you type `(`, VMark auto-inserts `)`. After typing inside, just Tab to jump out.

3. **Nested structures** — Tab escapes one level at a time. For `((nested))`, you need two Tabs to fully exit.

4. **Shift + Tab** — The mirror of Tab. Escapes backward from marks, links, and opening brackets. In tables, moves to the previous cell. In lists, outdents the item.

5. **Multi-cursor** — Tab escape works with all your cursors simultaneously, making bulk edits even faster.

## Switching between open tabs

Tabs live in the status bar at the bottom of the window. Three ways to move
between them:

| Action | Shortcut | Notes |
|---|---|---|
| Last Used Tab | `Ctrl + Tab` | Jumps to the tab you were in before this one. Press it again to come straight back. |
| Next / Previous Tab | `Mod + Shift + ]` / `Mod + Shift + [` | Moves along the strip in order, regardless of what you used recently. |
| Quick Open | `Mod + O` | Type to filter. Open tabs are listed first, most recently used at the top. |

**Last Used Tab is a toggle, not a cycle.** It takes you to the document you
were in most recently, and pressing it a second time returns you to where you
started — the fast way to work between two files. Next and Previous Tab walk
the strip positionally instead, which is what you want when you are looking for
something rather than going back to it.

It is a menu item as well as a shortcut (**View → Last Used Tab**), which is
what lets it keep working while the embedded browser has keyboard focus.

### When you have more tabs than fit

The tab strip scrolls. When there are tabs off either edge, the strip fades at
that edge and a small arrow appears — click it to scroll a screenful. Switching
tabs by any means also scrolls the new tab into view, so the highlighted tab is
never hidden off-screen.

The strip itself is keyboard-reachable: Tab to it and use the arrow keys.

## Two documents side by side

**View → Split Editor — Two Documents** (`Alt + Mod + \`) puts a second
document beside the current one. To choose which document, right-click any tab
and pick **Open to the Side**.

| Action | Shortcut |
|---|---|
| Split Editor — Two Documents | `Alt + Mod + \` |
| Close Pane | `Alt + Mod + Shift + \` |
| Focus Other Pane | `Alt + Mod + Shift + O` |
| Sync Pane Scroll | *(no default)* |

Notes on how it behaves:

- The tab showing in the **other** pane is marked in the tab strip with a faint
  underline, so you can always tell which two documents are on screen and which
  one your typing will go to.
- **Closing one of the two collapses onto the other**, rather than jumping you
  to an unrelated tab. Your remaining document stays put.
- **Sync Pane Scroll** ties the two panes' scrolling together proportionally.
  It is off by default and is per-split.
- **Both panes share one view mode.** Source mode (`F6`) switches both panes
  at once, and moving between the panes keeps the mode you are in.
- Splitting needs two documents open. Browser tabs are not documents, so the
  split does not apply to them.

## The tab context menu

Right-click a tab to open its menu. Arrow keys, Home and End move through it; Enter or Space runs an item; Escape closes it.

| Item | What it does | Available when |
|---|---|---|
| Move to New Window | Moves the tab into a new window, with an **Undo** in the confirmation. A secondary window left empty closes. | The document is loaded, and it is not the only tab of the main window |
| Pin / Unpin | Pins or unpins the tab — see [Pinned tabs](#pinned-tabs). | Always |
| Open to the Side | Shows the tab in the other split pane — see [Two documents side by side](#two-documents-side-by-side). | Both this tab and the active one are documents, and this one is not the active tab (not shown for browser tabs) |
| Rename | Renames the file in place in the tab — see [Renaming a file](#renaming-a-file). | The document has been saved |
| Copy Path | Copies the file's absolute path. | The document has been saved |
| Copy Relative Path | Copies the path relative to the workspace folder. | A workspace is open and the file is inside it |
| Reveal in Finder | Shows the file in Finder (**Show in Explorer** on Windows, **Show in File Manager** on Linux). | The document has been saved |
| Restore to Disk | Writes the tab's content back to its path. | The file was deleted from disk while open |
| Revert to Saved | After a confirmation, discards your changes and reloads the file from disk. | The tab has unsaved changes and its file still exists |
| Close | Closes the tab (asks to save first if it has unsaved changes). | The tab is not pinned |
| Close Others | Closes every other unpinned tab. | Another unpinned tab exists |
| Close Tabs to the Right | Closes the unpinned tabs to its right. | One exists |
| Close All Unpinned Tabs | Closes every unpinned tab, this one included. | An unpinned tab exists |
| Close All | Closes every tab, pinned ones included. If a pinned tab would close, it asks first and names how many; cancelling closes nothing. | Always |

Bulk closes act on the tabs of the current workspace and close them one at a time. Each tab with unsaved changes asks first, and cancelling any of those prompts stops the rest.

## Pinned tabs

Pin a tab from its context menu to keep it at hand:

- It moves to the pinned group at the left of the strip, shows a pin icon, and loses its close button. Tabs cannot be dragged across the boundary between pinned and unpinned tabs (*"Pinned tabs stay at the left. Drop blocked."*), and a pinned tab cannot be dragged out of its window.
- It cannot be closed by any means — `Mod + W`, middle-click, **Close**, or a bulk close — until you unpin it; trying shows *"Unpin tab before closing"*. Two deliberate closes are the exception: **Close All** closes pinned tabs too once you confirm, and closing a workspace from the rail closes its pinned tabs with the rest.
- Closing a window that holds pinned tabs asks for confirmation — *"This window has N pinned tabs. Close anyway?"* — unless a save dialog was already shown.
- A pin survives moving the tab to another window or workspace and an update restart, but not quitting VMark: tabs reopened at the next launch are unpinned.

There is no keyboard shortcut for pinning.

## Renaming a file

Choose **Rename** in a tab's context menu. The name becomes editable in the tab, with the part before the extension selected. Enter or clicking away commits; Escape cancels. The file is renamed on disk and every open tab that points to it follows. VMark never overwrites: if the name is taken, a dialog says *A file named “X” already exists.* A name that is empty, unchanged, `.` or `..`, or contains `/` or `\` is refused or ignored. What you type is the whole name — delete the extension and the file loses it.

On **macOS**, with **Settings → Appearance → Show filename in titlebar** on, you can also double-click the file name in the title bar to rename it. The same rules and messages apply; after a collision or error the name stays editable so you can try another. If **Show file extensions** is off, the original extension is kept when you type a name without one. Double-clicking the title of an unsaved document opens **Save** instead.

## Closing tabs and windows

Nothing with unsaved changes is closed without asking.

- **Closing one tab** with unsaved changes (`Mod + W`, the tab's ×, or **Close**) asks *"Do you want to save changes to …?"* with **Save**, **Don't Save** and **Cancel**. **Save** on a never-saved document opens a save dialog in your default save folder, with the tab's title as the suggested name. Cancelling that dialog, or a failed save, keeps the tab open.
- **Closing a window** with one unsaved document asks the same question. With two or more, one dialog lists them all — never-saved documents are marked *(new)* — with **Save All**, **Don't Save** and **Cancel**.
- **Save All** saves every document that has a file. For never-saved documents it asks for a location: one save dialog if there is one, or **one folder picker** for several (*"Choose folder for N new documents"*). Each is then saved in that folder under its title, and a name that is already taken gets a number (`Untitled 2.md`), so nothing is overwritten.
- **Quitting** (`Mod + Q`) runs the same check in every window, one window at a time; cancelling in any window cancels the quit. With **Settings → Files & Images → Confirm quit** on (the default), the first press only shows *"Press ⌘Q again to quit"* — press it again within two seconds. A quit from the operating system (shutting down, say) skips the double press.
- **Save All and Quit** saves the unsaved documents in every window without the dialog — it still asks where to put never-saved ones (one save dialog, or one folder picker for several, in the window that holds them) — then quits. If a document cannot be saved, or you cancel that dialog, the quit stops: that window stays open, and a failed save says why.

On macOS, VMark keeps running after its last window closes; on Windows and Linux, closing the last window quits — unless, on Windows, **Settings → Files & Images → Minimize to tray on close** is on: then the last window is hidden in the system tray instead, with nothing closed and no save prompt (see [Settings](/guide/settings)).

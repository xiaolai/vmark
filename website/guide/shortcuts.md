# Keyboard Shortcuts

VMark is designed for keyboard-first workflows. All shortcuts can be customized in Settings.

## Notation

- **Mod** = Cmd on macOS, Ctrl on Windows/Linux
- **Alt** = Option on macOS

## Edit

| Action | Shortcut |
|--------|----------|
| Undo | `Mod + Z` |
| Redo | `Mod + Shift + Z` |

## Text Formatting

| Action | Shortcut |
|--------|----------|
| Bold | `Mod + B` |
| Italic | `Mod + I` |
| Underline | `Mod + U` |
| Strikethrough | `Mod + Shift + X` |
| Inline Code | `Mod + Shift + `` ` `` |
| Highlight | `Mod + Shift + M` |
| Subscript | `Alt + Mod + =` |
| Superscript | `Alt + Mod + Shift + =` |
| Link | `Mod + K` |
| Open Link (Source mode) | `Cmd + Click` |
| Remove Link | `Alt + Shift + K` |
| Wiki Link | `Alt + Mod + K` |
| Bookmark Link | `Alt + Mod + B` |
| Clear Formatting | `Mod + \` |

## Block Formatting

| Action | Shortcut |
|--------|----------|
| Heading 1-6 | `Mod + 1` through `Mod + 6` |
| Paragraph | `Mod + Shift + 0` |
| Increase Heading Level | `Alt + Mod + ]` |
| Decrease Heading Level | `Alt + Mod + [` |
| Blockquote | `Alt + Mod + Q` |
| Code Block | `Alt + Mod + C` |
| Bullet List | `Alt + Mod + U` |
| Ordered List | `Alt + Mod + O` |
| Task List | `Alt + Mod + X` |
| Indent | `Mod + ]` |
| Outdent | `Mod + [` |
| Horizontal Line | `Alt + Mod + -` |

## Line Operations

| Action | Shortcut |
|--------|----------|
| Move Line Up | `Alt + Up` |
| Move Line Down | `Alt + Down` |
| Duplicate Line | `Shift + Alt + Down` |
| Delete Line | `Mod + Shift + K` |
| Join Lines | `Mod + J` |
| Sort Lines Ascending | `F5` |
| Sort Lines Descending | `Shift + F5` |

## Text Transformations

| Action | Shortcut |
|--------|----------|
| UPPERCASE | `Ctrl + Shift + U` |
| lowercase | `Ctrl + Shift + L` |
| Title Case | `Ctrl + Shift + T` |

## Insert

| Action | Shortcut |
|--------|----------|
| Insert Image | `Mod + Shift + I` |
| Insert Table | `Mod + Shift + T` |
| Inline Math | `Alt + Mod + M` |
| Math Block | `Alt + Mod + Shift + M` |
| Insert Note | `Alt + Mod + N` |
| Insert Tip | `Alt + Mod + Shift + T` |
| Insert Warning | `Mod + Shift + W` |
| Insert Important | `Alt + Mod + Shift + I` |
| Insert Caution | `Mod + Shift + U` |
| Insert Collapsible | `Alt + Mod + D` |
| Insert Diagram | `Alt + Shift + Mod + D` |
| Toggle Comment | `Mod + Shift + /` |

## Selection & Multi-Cursor

| Action | Shortcut |
|--------|----------|
| Select Line | `Mod + L` |
| Expand Selection | `Ctrl + Shift + Up` |
| Select Next Occurrence | `Mod + D` |
| Select All Occurrences | `Mod + Shift + L` |
| Collapse Multi-Cursor | `Escape` |

## Find & Replace

| Action | Shortcut |
|--------|----------|
| Find & Replace | `Mod + F` |
| Find Next | `Mod + G` |
| Find Previous | `Mod + Shift + G` |

## View & Mode

| Action | Shortcut |
|--------|----------|
| Toggle Source Mode | `Mod + /` |
| Toggle Status Bar | `F7` |
| Focus Mode | `F8` |
| Typewriter Mode | `F9` |
| Word Wrap | `Alt + Z` |
| Toggle Sidebar | `Mod + Shift + B` |
| Toggle Outline | `Alt + Mod + 1` |
| Toggle Line Numbers | `Alt + Mod + L` |
| Toggle Diagram Preview | `Alt + Mod + P` |
| Universal Toolbar | `Mod + Shift + P` |
| Source Peek | `Alt + Mod + /` |

## File Operations

| Action | Shortcut |
|--------|----------|
| New File | `Mod + N` |
| Open File | `Mod + O` |
| Open Folder | `Mod + Shift + O` |
| Save | `Mod + S` |
| Save As | `Mod + Shift + S` |
| Move to | Menu only |
| Close | `Mod + W` |
| Export HTML | `Alt + Mod + E` |
| Print | `Mod + P` |
| Settings | `Mod + ,` |

## Clipboard

| Action | Shortcut |
|--------|----------|
| Copy as HTML | `Mod + Shift + C` |
| Paste Plain Text | `Mod + Shift + V` |

## CJK Formatting

| Action | Shortcut |
|--------|----------|
| Format Selection | `Mod + Shift + F` |
| Format Document | `Alt + Mod + Shift + F` |

## Window & Tabs

| Action | Shortcut |
|--------|----------|
| New Window | `Mod + Shift + N` |
| New Tab | `Mod + T` |
| Close Tab | `Mod + W` |
| View History | `Mod + Shift + H` |
| Toggle Hidden Files | `Mod + Shift + .` |

::: tip Windows/Linux Note
Toggle Hidden Files uses `Ctrl + H` on Windows and Linux.
:::

## Smart Tab Navigation

Tab has context-aware behavior throughout the editor:

### In Formatted Text (WYSIWYG)

| Context | Tab Action |
|---------|------------|
| Inside **bold**/`code`/*italic*/~~strike~~ | Jump after the formatting |
| Inside a link | Jump after the link |

### In Markdown Links (Source Mode)

| Context | Tab Action |
|---------|------------|
| Inside `[text]` | Jump to `(url)` |
| Inside `(url)` | Jump after `)` |

### Before Closing Characters (Source Mode)

Tab jumps over: `)`, `]`, `}`, `*`, `_`, `` ` ``, `~~`, `==`, and quotes.

## Table Editing

When cursor is inside a table:

| Action | Shortcut |
|--------|----------|
| Next Cell | `Tab` |
| Previous Cell | `Shift + Tab` |
| Add Row Below | `Mod + Enter` |
| Add Row Above | `Mod + Shift + Enter` |
| Delete Row | `Mod + Backspace` |
| Exit Table | Arrow keys at table edge |

## Popup Navigation

When a popup is open (link, image, math, etc.):

| Action | Shortcut |
|--------|----------|
| Close Popup | `Escape` |
| Confirm/Save | `Enter` |
| Navigate Fields | `Tab` / `Shift + Tab` |

## Math Block Editing

When editing a math block:

| Action | Shortcut |
|--------|----------|
| Commit & Exit | `Mod + Enter` |
| Cancel & Exit | `Escape` |

## Customizing Shortcuts

1. Open Settings with `Mod + ,`
2. Navigate to the **Shortcuts** tab
3. Click on any shortcut to edit
4. Press your desired key combination
5. Changes are saved automatically

::: tip
Shortcuts sync with menu accelerators when applicable, so menu items will show your customized shortcuts.
:::

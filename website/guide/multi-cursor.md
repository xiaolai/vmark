# Multi-Cursor Editing

VMark supports powerful multi-cursor editing in both WYSIWYG and Source modes, allowing you to edit multiple locations simultaneously.

## Quick Start

| Action | Shortcut |
|--------|----------|
| Add cursor at next match | `Mod + D` |
| Skip match, jump to next | `Mod + Shift + D` |
| Add cursors at all matches | `Mod + Shift + L` |
| Undo last cursor addition | `Alt + Mod + Z` |
| Add cursor above | `Mod + Alt + Up` |
| Add cursor below | `Mod + Alt + Down` |
| Add/remove cursor at click | `Alt + Click` |
| Collapse to single cursor | `Escape` |

::: tip
**Mod** = Cmd on macOS, Ctrl on Windows/Linux
**Alt** = Option on macOS
:::

## Adding Cursors

### Select Next Occurrence (`Mod + D`)

1. Select a word or place cursor on a word
2. Press `Mod + D` to add a cursor at the next occurrence
3. Press again to add more cursors
4. Type to edit all locations at once

<div class="feature-box">
<strong>Example:</strong> To rename a variable <code>count</code> to <code>total</code>:
<ol>
<li>Double-click <code>count</code> to select it</li>
<li>Press <code>Mod + D</code> repeatedly to select each occurrence</li>
<li>Type <code>total</code> — all occurrences update simultaneously</li>
</ol>
</div>

### Select All Occurrences (`Mod + Shift + L`)

Select all occurrences of the current word or selection at once:

1. Select a word or text
2. Press `Mod + Shift + L`
3. All matching occurrences in the current block are selected
4. Type to replace all at once

### Alt + Click

Hold `Alt` (Option on macOS) and click to:
- **Add** a cursor at that position
- **Remove** a cursor if one already exists there

This is useful for placing cursors at arbitrary positions that aren't matching text.

### Skip Occurrence (`Mod + Shift + D`)

When `Mod + D` selects a match you don't want, skip it:

1. Press `Mod + D` to start adding matches
2. If the latest match is unwanted, press `Mod + Shift + D` to skip it
3. The skipped match is removed and the next match is selected instead

This is the multi-cursor equivalent of "Find Next" — it lets you cherry-pick which occurrences to edit.

### Soft Undo (`Alt + Mod + Z`)

Undo the last cursor addition without losing all your cursors:

1. Press `Mod + D` several times to build up cursors
2. If you added one too many, press `Alt + Mod + Z`
3. The last-added cursor is removed, restoring the previous state

Unlike `Escape` (which collapses everything), soft undo steps back one cursor at a time.

### Add Cursor Above / Below (`Mod + Alt + Up/Down`)

Add cursors vertically, one line at a time:

1. Place your cursor on a line
2. Press `Mod + Alt + Down` to add a cursor on the next line
3. Press again to keep adding cursors downward
4. Use `Mod + Alt + Up` to add cursors upward instead

This is ideal for editing column-aligned text or making the same edit across consecutive lines.

## Editing with Multiple Cursors

Once you have multiple cursors, all standard editing works at each cursor:

### Typing
- Characters are inserted at all cursor positions
- Selections are replaced at all positions

### Deletion
- **Backspace** — deletes character before each cursor
- **Delete** — deletes character after each cursor

### Navigation
- **Arrow keys** — move all cursors together
- **Shift + Arrow** — extend selection at each cursor
- **Mod + Arrow** — jump by word/line at each cursor

### Tab Escape

Tab escape works independently for each cursor:

- Cursors inside **bold**, *italic*, `code`, or ~~strike~~ jump to the end of that formatting
- Cursors inside links escape from the link
- Cursors before closing brackets `)` `]` `}` jump over them
- Cursors in plain text stay in place

This lets you escape from multiple formatted regions simultaneously. See [Smart Tab Navigation](./tab-navigation.md#multi-cursor-support) for details.

### Clipboard

**Copy** (`Mod + C`):
- Copies text from all selections, joined by newlines

**Paste** (`Mod + V`):
- If the clipboard has the same number of lines as cursors, each line goes to each cursor
- Otherwise, the full clipboard content is pasted at all cursors

## Block Scoping

Multi-cursor operations are **scoped to the current block** to prevent unintended edits across unrelated sections.

### In WYSIWYG Mode
- Cursors cannot cross code block boundaries
- If your primary cursor is inside a code block, new cursors stay within that block

### In Source Mode
- Blank lines act as block boundaries
- `Mod + D` and `Mod + Shift + L` only match within the current paragraph

<div class="feature-box">
<strong>Why block scoping?</strong>
<p>This prevents accidentally editing a variable name in unrelated code sections or changing text in different paragraphs that happen to match.</p>
</div>

## Collapsing Cursors

Press `Escape` to collapse back to a single cursor at the primary position.

## Visual Feedback

- **Primary cursor** — standard blinking cursor
- **Secondary cursors** — additional blinking cursors with distinct styling
- **Selections** — each cursor's selection is highlighted

In dark mode, cursor and selection colors automatically adjust for visibility.

## Mode Comparison

| Feature | WYSIWYG | Source |
|---------|---------|--------|
| `Mod + D` | ✓ | ✓ |
| `Mod + Shift + D` (Skip) | ✓ | ✓ |
| `Mod + Shift + L` | ✓ | ✓ |
| `Alt + Mod + Z` (Soft Undo) | ✓ | ✓ |
| `Mod + Alt + Up/Down` | ✓ | ✓ |
| `Alt + Click` | ✓ | ✓ |
| Block scoping | Code fences | Blank lines |
| Wrap-around search | ✓ | ✓ |

## Tips & Best Practices

### Renaming Variables
1. Double-click the variable name
2. `Mod + Shift + L` to select all in the block
3. Type the new name

### Adding Prefixes/Suffixes
1. Place cursor before/after repeated text
2. `Mod + D` to add cursors at each occurrence
3. Type the prefix or suffix

### Editing List Items
1. Select the common pattern (like `- ` at line starts)
2. `Mod + Shift + L` to select all
3. Edit all list items at once

### When to Use Each Shortcut

| Scenario | Best Shortcut |
|----------|---------------|
| Careful, incremental selection | `Mod + D` |
| Skip unwanted match | `Mod + Shift + D` |
| Replace all in block | `Mod + Shift + L` |
| Undo last cursor step | `Alt + Mod + Z` |
| Edit consecutive lines | `Mod + Alt + Up/Down` |
| Arbitrary positions | `Alt + Click` |
| Quick exit | `Escape` |

## Limitations

- **Atom nodes**: Cannot place cursors inside images, embedded content, or math blocks in WYSIWYG mode
- **IME input**: When using input methods (Chinese, Japanese, etc.), composition only affects the primary cursor
- **Document-wide**: Selections are scoped to blocks, not the entire document

## Keyboard Reference

| Action | Shortcut |
|--------|----------|
| Select next occurrence | `Mod + D` |
| Skip occurrence | `Mod + Shift + D` |
| Select all occurrences | `Mod + Shift + L` |
| Soft undo cursor | `Alt + Mod + Z` |
| Add cursor above | `Mod + Alt + Up` |
| Add cursor below | `Mod + Alt + Down` |
| Add/remove cursor | `Alt + Click` |
| Collapse to single cursor | `Escape` |
| Move all cursors | Arrow keys |
| Extend all selections | `Shift + Arrow` |
| Jump by word | `Alt + Arrow` |
| Jump by line | `Mod + Arrow` |

<!-- Styles in style.css -->

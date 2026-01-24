# Multi-Cursor Editing

VMark supports powerful multi-cursor editing in both WYSIWYG and Source modes, allowing you to edit multiple locations simultaneously.

## Quick Start

| Action | Shortcut |
|--------|----------|
| Add cursor at next match | `Mod + D` |
| Add cursors at all matches | `Mod + Shift + L` |
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
| `Mod + Shift + L` | ✓ | ✓ |
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
| Replace all in block | `Mod + Shift + L` |
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
| Select all occurrences | `Mod + Shift + L` |
| Add/remove cursor | `Alt + Click` |
| Collapse to single cursor | `Escape` |
| Move all cursors | Arrow keys |
| Extend all selections | `Shift + Arrow` |
| Jump by word | `Alt + Arrow` |
| Jump by line | `Mod + Arrow` |

<!-- Styles in style.css -->

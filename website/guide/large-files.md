# Large Files

VMark opens most markdown files instantly, but very large files need extra care to stay responsive. This page describes how VMark handles them and how you can tune the behavior.

## What counts as "large"

VMark classifies a file by size before it opens:

| Size | Tier | What happens |
|------|------|--------------|
| < 1 MB | Small | Opens in WYSIWYG (rich-text) mode instantly. |
| 1 MB – 5 MB | Large | Opens in **Source mode** by default — sub-second. StatusBar offers "Switch to WYSIWYG". |
| 5 MB – 50 MB | Huge | Confirmation dialog appears first. Opens in Source mode only. |
| ≥ 50 MB | Refused | VMark refuses to open the file. Use `less`, `bat`, or a similar tool instead. |

Size is checked via the operating system without reading the file, so the decision is fast and does not preload data.

## Why Source mode for large files

Source mode uses CodeMirror with viewport virtualization — only the visible portion of the document is rendered. WYSIWYG mode uses Tiptap/ProseMirror, which must build a DOM node for every block in the document. On a 1.4 MB / ~2,250-block markdown file this takes about 15 seconds on first open; Source mode opens the same file in under a second.

Most of that time is building and laying out the view, not parsing. On a long CJK document measured on a slow machine, the parse was between a quarter and two fifths of the editor's open cost.

## While a document opens

A window answers its menus, shortcuts and close button before VMark builds the document's rich-text view, and the document appears just after. A long document used to be built first, and on a slow machine that could keep the window from becoming ready: menus responded late, and the log said *menu commands did not mount within 5000ms*.

What WYSIWYG does at open also stays in proportion to the document:

- Images load as they come near the visible area.
- **CJK Letter Spacing** (**Settings → Editor → Typography**) does no work while it is off, its default, and scans the document once when it is on.
- Decorations such as code highlighting, CJK spacing and lint marks cost about linearly in the document's length. Very long documents used to cost quadratically.

## Status bar cues

- **Opening a large file in WYSIWYG:** an indeterminate spinner with the label *"Opening large file (N MB)…"* appears at the left of the status bar while the editor mounts. It disappears as soon as the editor is interactive.
- **File opened in Source mode automatically:** the status bar shows *"Opened in Source mode (large file)."* with a **Switch to WYSIWYG** link. Clicking the link flips the active tab to WYSIWYG. Closing and reopening the file returns to Source mode — the override is per-session.
- **Document WYSIWYG cannot display:** a document with blockquotes or lists nested more than 1000 levels deep cannot be parsed as rich text, whatever its size. It opens in Source mode with a message saying how deep it is, and the status bar shows *"Opened in Source mode (cannot be displayed in WYSIWYG)."* Reduce the nesting, then use **Switch to WYSIWYG**.

## Settings

Open **Settings → Editor → Large Files**:

- **Open files over 1 MB in Source mode automatically** *(on by default)* — turn off if you prefer WYSIWYG for files up to 5 MB, accepting the longer open time.
- **Warn before opening files over 5 MB** *(on by default)* — turn off to skip the confirmation dialog for files between 5 MB and 50 MB. They will still open in Source mode.

The 50 MB hard refusal is not user-adjustable. The webview cannot safely hold arbitrarily large strings without risk of out-of-memory crashes.

## Tips

- If you have to keep editing a very large file in WYSIWYG, consider splitting it into smaller files linked from an index document. Markdown works well as a set of smaller chapters.
- If you only need to read or search a large file, Source mode with the line-number ruler and `Find` (`Mod + F`) is usually the fastest workflow.
- **Format → CJK → Format Entire File** and other whole-document commands still run correctly on Source-mode documents.

## Edge cases

- **File grows while open.** VMark decides the tier based on the size at open time. A file that grows to 2 MB while you edit it stays in whatever mode you chose.
- **Symlinks.** Sizes reflect the target file, so a symlink to a 10 MB file is treated as huge.
- **Empty files.** Zero-byte files count as small and open in WYSIWYG.
- **File vanishes between size-check and read.** The normal "file not found" error surfaces — no extra warning is raised.

## Known limitations

- The thresholds are byte sizes, which are a proxy for the real cost (block count). A 600 KB file with thousands of short blocks can be slower than a 1.2 MB file of long paragraphs. The defaults are conservative.
- WYSIWYG still builds every block of the document when it opens — only images and inline math formulas wait until they come near the visible area — so switching a large file to WYSIWYG costs the full open time described above.

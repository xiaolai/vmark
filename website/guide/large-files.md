# Large Files

VMark opens most markdown files instantly, but very large files need extra care to stay responsive. This page describes how VMark handles them and how you can tune the behavior.

## What counts as "large"

VMark classifies a file by size and, for markdown, by an estimated block count before it opens:

| Size or block count | Tier | What happens |
|------|------|--------------|
| < 1 MB and fewer than 1,200 estimated blocks | Small | Opens in WYSIWYG (rich-text) mode instantly. |
| 1 MB – 5 MB, or 1,200+ estimated blocks | Large | Opens in **Source mode** by default — sub-second. StatusBar offers "Switch to WYSIWYG". |
| 5 MB – 50 MB | Huge | Confirmation dialog appears first. Opens in Source mode only. |
| ≥ 50 MB | Refused | VMark refuses to open the file. Use `less`, `bat`, or a similar tool instead. |

Size is checked via the operating system without reading the file. When a markdown file is under 1 MB, VMark then estimates its block count with a line scan of the file's bytes — not a markdown parse — so the decision stays fast and never loads the document into the webview.

## Why Source mode for large files

Source mode uses CodeMirror with viewport virtualization — only the visible portion of the document is rendered. WYSIWYG mode uses Tiptap/ProseMirror, which must build a DOM node for every block in the document. On a 1.4 MB / ~2,250-block markdown file this takes about 15 seconds on first open; Source mode opens the same file in under a second.

Most of that time is building and laying out the view, not parsing. On a long CJK document measured on a slow machine, the parse was between a quarter and two fifths of the editor's open cost.

Block count, not file size, is what the view-building cost follows. Three fixtures of nearly identical size (377–397 KB) differing only in how their bytes are cut into blocks opened in 3.6, 5.2 and 18 seconds at 601, 1,201 and 3,401 blocks. A 524 KB document of 3,773 short blocks took over 30 seconds on that machine — under the 1 MB byte threshold, but far past the point where the window stops answering. That is why the block estimate can route a file to Source mode on its own.

## While a document opens

A window answers its menus, shortcuts and close button before VMark builds the document's rich-text view, and the document appears just after. A long document used to be built first, and on a slow machine that could keep the window from becoming ready: menus responded late, and the log said *menu commands did not mount within 5000ms*.

What WYSIWYG does at open also stays in proportion to the document:

- Images load as they come near the visible area.
- **CJK Letter Spacing** (**Settings → Editor → Typography**) does no work while it is off, its default, and scans the document once when it is on.
- Decorations such as code highlighting, CJK spacing and lint marks cost about linearly in the document's length. Very long documents used to cost quadratically.
- Above 100,000 characters, WYSIWYG turns the system spellchecker off for that document, because rescanning after every edit makes typing lag. It turns back on if the document shrinks below that size. Source mode is unaffected.

## Status bar cues

- **Opening a large file in WYSIWYG:** an indeterminate spinner with the label *"Opening large file (N MB)…"* appears at the left of the status bar while the editor mounts. It disappears as soon as the editor is interactive.
- **File opened in Source mode automatically:** the status bar shows *"Opened in Source mode (large file)."* with a **Switch to WYSIWYG** link. Clicking the link flips the active tab to WYSIWYG. Closing and reopening the file returns to Source mode — the override is per-session.
- **Document WYSIWYG cannot display:** a document with blockquotes or lists nested more than 1000 levels deep cannot be parsed as rich text, whatever its size. It opens in Source mode with a message saying how deep it is, and the status bar shows *"Opened in Source mode (cannot be displayed in WYSIWYG)."* Reduce the nesting, then use **Switch to WYSIWYG**.

## Settings

Open **Settings → Editor → Large Files**:

- **Open large files in Source mode automatically** *(on by default)* — covers files over 1 MB and block-dense markdown. Turn off if you prefer WYSIWYG for files up to 5 MB, accepting the longer open time.
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

- The block count is an estimate, not a parse: blank-separated text, headings, list items, table rows and each fenced code block count as one block, while code inside a fence and frontmatter lines are skipped. A document shaped unusually may be routed to Source mode when WYSIWYG would have been fast enough; **Switch to WYSIWYG** is one click. Non-markdown files are never routed by block count.
- WYSIWYG still builds every block of the document when it opens — only images and inline math formulas wait until they come near the visible area — so switching a large file to WYSIWYG costs the full open time described above.

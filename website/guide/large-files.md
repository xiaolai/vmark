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

Parsing is not the bottleneck — it is ProseMirror's view construction. Moving parse off the main thread would not meaningfully improve the perceived wait.

## Status bar cues

- **Opening a large file in WYSIWYG:** an indeterminate spinner with the label *"Opening large file (N MB)…"* appears at the left of the status bar while the editor mounts. It disappears as soon as the editor is interactive.
- **File opened in Source mode automatically:** the status bar shows *"Opened in Source mode (large file)."* with a **Switch to WYSIWYG** link. Clicking the link flips the active tab to WYSIWYG. Closing and reopening the file returns to Source mode — the override is per-session.

## Settings

Open **Settings → Editor → Large files**:

- **Open files over 1 MB in Source mode automatically** *(on by default)* — turn off if you prefer WYSIWYG for files up to 5 MB, accepting the longer open time.
- **Warn before opening files over 5 MB** *(on by default)* — turn off to skip the confirmation dialog for files between 5 MB and 50 MB. They will still open in Source mode.

The 50 MB hard refusal is not user-adjustable. The webview cannot safely hold arbitrarily large strings without risk of out-of-memory crashes.

## Tips

- If you have to keep editing a very large file in WYSIWYG, consider splitting it into smaller files linked from an index document. Markdown works well as a set of smaller chapters.
- If you only need to read or search a large file, Source mode with the line-number ruler and `Find` (`Mod + F`) is usually the fastest workflow.
- `Format > Format CJK Text` and other whole-document commands still run correctly on Source-mode documents.

## Edge cases

- **File grows while open.** VMark decides the tier based on the size at open time. A file that grows to 2 MB while you edit it stays in whatever mode you chose.
- **Symlinks.** Sizes reflect the target file, so a symlink to a 10 MB file is treated as huge.
- **Empty files.** Zero-byte files count as small and open in WYSIWYG.
- **File vanishes between size-check and read.** The normal "file not found" error surfaces — no extra warning is raised.

## Known limitations

- The thresholds are byte sizes, which are a proxy for the real cost (block count). A 600 KB file with thousands of short blocks can be slower than a 1.2 MB file of long paragraphs. The defaults are conservative.
- Phase C of the large-file initiative (deferred WYSIWYG rendering) is not shipped yet — see `dev-docs/plans/20260422-large-file-open-ux.md` for status.

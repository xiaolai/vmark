# Changelog

All notable changes to VMark are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and VMark uses
[Semantic Versioning](https://semver.org/).

Each release's section is its release notes: the release workflow publishes it
as the GitHub release body and as the "what's new" text of the in-app update
card, and refuses to release a version that has no section here. Write the
section as part of the version bump (`.claude/rules/40-version-bump.md`).

## [Unreleased]

## [0.9.94] - 2026-10-07

### Changed

- Updated the app framework, Tauri, to 2.12. The protection that keeps a
  trusted HTML preview from calling into VMark was checked again on the new
  version.

### Fixed

- Mermaid diagrams in documents no longer go blank when you stop editing
  them on older macOS versions. A style meant for standalone `.mmd` files was
  leaking into documents and shrinking diagrams to nothing
  ([#1215](https://github.com/xiaolai/vmark/issues/1215)).

### Security

- The framework update drops the unmaintained `unic-*` Rust crates, clearing
  five advisories (RUSTSEC-2025-0075, -0080, -0081, -0098 and -0100).

## [0.9.93] - 2026-10-06

### Changed

- Linux: the terminal follows the usual Linux terminal convention. Plain
  Ctrl+letter goes to the shell, so readline and editors such as nano and vim
  get Ctrl+A, Ctrl+K, Ctrl+F and the rest. Ctrl+C copies a selection and
  otherwise interrupts, and Ctrl+V pastes. Terminal actions use Ctrl+Shift
  (C, V, A, K, F), plus Ctrl+Insert and Shift+Insert
  ([#1508](https://github.com/xiaolai/vmark/issues/1508)).
- Command-line tools in the terminal now print clickable links where they
  support them.

### Fixed

- The ↓ button in a footnote preview jumps to the footnote text again
  ([#1506](https://github.com/xiaolai/vmark/issues/1506)).
- Fast typing in the terminal no longer reaches the shell out of order
  ([#1507](https://github.com/xiaolai/vmark/issues/1507)).
- Linux: typed characters in the terminal appear right away instead of one
  keystroke late. The terminal now always uses its DOM renderer there, and the
  WebGL option is hidden ([#1511](https://github.com/xiaolai/vmark/issues/1511)).
- Ctrl+K (Cmd+K on macOS) in the terminal clears it without also reaching the
  editor's Insert Link shortcut.

### Security

- Updated `source-map-js`, a build-time dependency, for GHSA-68fv-2mgg-jv7q.

## [0.9.92] - 2026-10-04

### Added

- Settings → About has a **Third-party notices** link that opens the license
  notices of the open-source software bundled with VMark.
- The update card shows the new version's release notes instead of a link to
  them.
- **Close All** now also closes pinned tabs, after asking you to confirm.

### Changed

- With no AI provider set up, AI features say so instead of quietly trying
  Ollama.
- **Save All and Quit** saves the documents in every window, then quits.
- Closing a workspace also closes its pinned tabs.
- The version-history retention setting can no longer go below one day.
- Faster: typing, Enter, paste and cut with hundreds of cursors; startup; the
  split preview of a large document, which now waits for typing to pause;
  auto-save of an unchanged document; and the word count.

### Fixed

- Footnote previews open at the right height when you move straight from one
  footnote to another, in both modes
  ([#1494](https://github.com/xiaolai/vmark/issues/1494)).
- Windows and Linux: a large document no longer jumps in height a moment after
  you stop typing or after it loads.
- **Close All** closes every unpinned tab; it used to close nothing.
- A file that starts with a byte-order mark keeps it when saved.
- Markdown is written back the way it was read in more cases: hard line
  breaks, loose lists, code-fence info, image alt text, `<details>` summaries,
  inline HTML, and a horizontal rule at the start of a document.
- Renumbering footnotes no longer damages text next to their definitions.
- Find and Replace continues after the inserted text, and the Source-mode
  match counter follows the current match.
- CJK formatting no longer pairs a bracket or quote across paragraphs, and
  currency and unit spacing no longer joins lines.
- Input methods: a composition in progress is no longer disturbed by an
  external file change or an AI write, and the Enter that confirms a
  composition no longer triggers a Source-mode popup.
- Copying in Source mode copies the Markdown exactly as written.
- The AI status bar's **Retry** runs the failed request again, and **Cancel**
  stops the provider.
- Windows: AI command-line tools installed as `.cmd` launchers start correctly.
- Embedded YouTube, Vimeo and Bilibili videos play in the released app.
- The math editor keeps your edit when you click outside it, and math
  rendering recovers after a failed load.
- PDF export: margin fields can be cleared while editing, exports to a drive
  root work, and a failed export no longer leaves a window behind.
- Version history restores a version through the normal save, so the file on
  disk matches.
- Moving a file with **Move To** removes the original.
- A skipped update is no longer announced again.
- Terminal: a shell that exits is noticed, and a stuck shell can be stopped.
- Workflows: a step's condition decides whether it runs, cancelling stops the
  run cleanly, and Alt+Arrow follows the current job.
- Context menus stay on screen, and a tab drag ends when the window loses
  focus.
- More of the interface is translated, including save dialogs, file errors and
  the file-manager name; Korean sentences end with a period.

### Security

- Links and forms inside rendered previews and diagrams can no longer navigate
  the app, an SVG's styles stay inside that SVG, and app windows refuse to
  navigate away from VMark's own pages.
- Pasted HTML is read without loading any images or running anything in it.
- The terminal and AI features run only shells and editors VMark found on your
  system, with checked arguments.
- MCP: each request acts for the window that sent it, file access follows the
  tabs that are actually open, and the local preview server no longer puts its
  session token in page addresses.
- Text from web pages and the system is escaped before it is written to logs.
- Dependencies with published security fixes were updated.

## [0.9.91] - 2026-10-01

### Fixed

- Source mode: editing a footnote definition no longer loses the editor's
  focus, and footnote previews stay out of the way while text is selected
  ([#1491](https://github.com/xiaolai/vmark/issues/1491)).

## [0.9.90] - 2026-10-01

### Added

- Terminal: Claude Code and Codex replies that contain a Markdown table or a
  Mermaid diagram can be rendered beside the terminal. Turn it on with
  Settings → Terminal → Automatic transcript rendering (off by default).

### Fixed

- Moving the terminal panel between top and bottom, or left and right, no
  longer restarts every running shell.

## [0.9.89] - 2026-09-30

### Fixed

- macOS: programs run in the integrated terminal can ask for the microphone,
  the camera and Apple Events. Recording tools such as FFmpeg previously got
  silence with no permission prompt
  ([#1483](https://github.com/xiaolai/vmark/issues/1483)).

## [0.9.88] - 2026-09-30

### Changed

- Documents with many formulas open and scroll faster: inline math renders as
  it nears the viewport, KaTeX fonts load while the editor is still empty, and
  images decode off the main thread.
- Find and replace, and list handling in long documents, take time linear in
  the document's size.

### Fixed

- The editor keeps block sizes steady while idle, so the view no longer jumps
  ([#1472](https://github.com/xiaolai/vmark/issues/1472)).
- Switching back to a tab restores the reading position by block, and the view
  holds still when formulas finish rendering above it.
- An edited formula re-renders at once, without flashing its source.
- Printing exports the document's Markdown even when the live editor went away
  during the export.
- Terminal: every new shell starts on a reset terminal, clipboard writes from
  programs (OSC 52) are bounded, and "press any key" after a program exits
  waits until its last lines are shown.

### Security

- Raised the `markdown-it` version floor past GHSA-253c-mchw-3w2r.

[Unreleased]: https://github.com/xiaolai/vmark/compare/v0.9.94...HEAD
[0.9.94]: https://github.com/xiaolai/vmark/releases/tag/v0.9.94
[0.9.93]: https://github.com/xiaolai/vmark/releases/tag/v0.9.93
[0.9.92]: https://github.com/xiaolai/vmark/releases/tag/v0.9.92
[0.9.91]: https://github.com/xiaolai/vmark/releases/tag/v0.9.91
[0.9.90]: https://github.com/xiaolai/vmark/releases/tag/v0.9.90
[0.9.89]: https://github.com/xiaolai/vmark/releases/tag/v0.9.89
[0.9.88]: https://github.com/xiaolai/vmark/releases/tag/v0.9.88

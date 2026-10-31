# Changelog

All notable changes to VMark are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and VMark uses
[Semantic Versioning](https://semver.org/).

Each release's section is its release notes: the release workflow publishes it
as the GitHub release body and as the "what's new" text of the in-app update
card, and refuses to release a version that has no section here. Write the
section as part of the version bump (`.claude/rules/40-version-bump.md`).

## [Unreleased]

## [0.9.109] - 2026-10-31

### Changed

- **CJK quote spacing now follows the switch that names it.** "Fix double
  quote spacing" and "Fix single quote spacing" (Settings → Language → CJK
  Formatting) now put a space beside CJK text as well as beside Latin text.
  The switches used to leave CJK text untouched, so a selection containing
  `那些“自己也不会解魔方”的家长` came back unchanged with both switches on.
  Turn either switch off to keep curly quotes tight against CJK text, the
  GB/T 15834 and JLREQ treatment. Bracket quotes (`「」`, `『』`) and terminal
  punctuation still take no space (#1615).
- **Reassigning a shortcut says what it does.** When a key combination is
  already taken, Settings → Shortcuts now offers **Reassign** and tells you
  the other action will be left without a shortcut. A new **Remove Shortcut**
  button clears a shortcut, and if the menu bar cannot apply a change you now
  see an error instead of a silent mismatch (#1616).
- **PDF export starts from your CJK letter spacing.** The PDF dialog's CJK
  letter spacing now starts at your Settings → Appearance value, which is off
  by default, instead of always starting at 0.05em (#1616).

### Fixed

- **Menus and Find in Files in your language.** The app menu (Services,
  Hide VMark, Hide Others, Show All), Cut, Copy, Paste, Select All, Minimize
  and Zoom now follow VMark's language instead of the system's, and the Find
  in Files panel is translated (#1616).
- **Clearer setting descriptions.** Heading alignment, media borders and
  media alignment now say they apply in the editor only, not to export or
  print; curly quotes, developer mode and auto-approve describe what they
  actually do (#1616).

### Security

- **Exports go only where you chose.** PDF, Pandoc and Slidev exports now
  write only to the location you picked in the save dialog, once. Any other
  path is refused and you are asked to export again (#1616).
- **Approval prompts show hidden characters.** The browser, workflow-step and
  workspace-folder approval prompts show invisible characters (zero-width
  spaces, text-direction overrides, variation selectors and the like) as
  visible `\u{…}` escapes, so a name or script cannot disguise what you are
  approving (#1616).
- **Files from a second launch open from the right folder.** On Windows and
  Linux, a relative path passed to a second VMark launch is resolved against
  that launch's own folder, and dropped when that folder is unknown, instead
  of being resolved against the running VMark's folder (#1616).
- **Tighter internal permissions.** The secure settings store is opened by the
  app itself and the window can no longer open arbitrary store files, the
  workspace-open approval is tied to the connection that asked, and release
  builds no longer carry the debug automation bridge's permission (#1616).

### Removed

- Unused code paths: the coherence accept and operators flow, the merge
  audit, and the unused `@xterm/addon-serialize` dependency (#1616).

## [0.9.108] - 2026-10-30

### Fixed

- **AI clients now see every VMark window.** When you have more than one
  window open, such as a file opened from Finder beside the main window,
  `session.get_state` used to report only the main window, so its tabs were
  invisible to your AI client. It now lists every document window with its
  tabs (#1612).
- **AI requests go to the window you were using.** While you type in your AI
  client, no VMark window has focus; a request that names no tab used to land
  in the main window. It now goes to the document window you used last
  (#1612).

## [0.9.107] - 2026-10-29

### Added

- **Every theme on Windows 11.** Settings → Appearance now offers the full
  theme catalog on Windows 11, and the window's title bar, title text and
  border take the theme's colours. Windows 10 and Linux still offer White and
  Night (#1606).

### Fixed

- **Press-and-hold accents work in the terminal on macOS.** Holding a letter
  and picking an accent from the popup now types just the accented letter
  (`ü`) instead of the letter followed by the accent (`uü`) (#1608).

## [0.9.106] - 2026-10-28

### Added

- **Choose how the sidebar looks.** Settings → Appearance → Sidebar has a new
  **Sidebar style**: **Full height** (the default) runs the sidebar from the
  top of the window to the bottom with a thin divider, as macOS 27 apps do;
  **Card** keeps the earlier rounded, inset card.

### Fixed

- **The sidebar's header buttons no longer get cut off.** Dragging the sidebar
  to its narrowest pushed New File and New Folder past its edge. The narrowest
  sidebar is now 220px, wide enough for every button, and the view title
  shortens with an ellipsis before any button is hidden.
- **Search finds text that wraps onto the next source line** (#1590). A query
  such as "a chat assis" missed text whose words were split by a soft line
  break; the break now counts as a space when searching outside code blocks.
- Updated the Tauri plugins and other dependencies to their latest patch
  releases.

## [0.9.105] - 2026-10-28

### Fixed

- **Right-click menus open at the pointer again.** Since 0.9.55 the editor's
  right-click menu and the image menu opened in the window's top-left corner,
  pushed the rest of the window sideways while open, and could leave the
  selection highlight behind after they closed. Both now open where you click,
  over the page, and close cleanly.
- **Find in Files accepts two-character searches** (#1598). The minimum was
  three characters, which blocked common two-character Chinese, Japanese and
  Korean words such as 选址 or 招聘. Two characters is now enough, counted the
  same way for every script, and the "type at least" hint is translated.

## [0.9.104] - 2026-10-28

### Added

- **A durable, reviewable history of AI edits** (#1591). Every edit an AI
  client makes through VMark's MCP tools is now recorded before it changes
  anything, in an edit history that survives restarts. The status-bar
  **history** button opens a panel that lists each revision with when it
  happened, the tool, and who made it: the client's provider, connection and
  session. Set `VMARK_SESSION_LABEL` in a client's MCP configuration to tell
  its sessions apart. A client with no token, an unknown token or a shared
  token is shown as such, never as the name it gives itself. Any revision can
  be restored, or the document put back to just before it.
- **Review AI changes one by one.** *Review AI Changes* groups the changes you
  have not reviewed yet by client and session. **Keep** or **Revert** each one,
  and undo either. A revert that would overwrite text you edited since is not
  applied: the change is marked as conflicting, so your own edits are never
  lost to it.
- **Comments you can hand back to the AI.** Select text and choose
  **Comment on selection** to start a thread. Threads can be replied to, and are open,
  addressed, resolved or reopened. A new MCP tool, `comments`, lets an AI
  client read your comments, reply, and mark them addressed. Resolving stays
  with you. An edit can say which comments it answers, and the history shows
  the link.
- **Export Edit History to Git.** *File → Document History → Export Edit
  History to Git…* copies a document's history into a Git repository as one
  commit per revision, on a branch of its own. Exporting again adds only what
  is new.

### Changed

- AI edit replies now say whether the edit was recorded (`applied`,
  `durable`). New refusals (`JOURNAL_BUSY`, `STALE_PARENT`,
  `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE`, `INVALID_TEXT`,
  `REVIEW_BACKLOG_FULL`, `ABORTED`) change nothing, so a client can safely
  re-read and retry. See the MCP tools guide.
- Checkpoints from earlier versions are imported once and listed under
  **Earlier checkpoints** in the history panel.

### Fixed

- Saves to one file now land in the order they were asked for, across
  documents and windows. A save that a later one has already overtaken is
  reported as stale instead of silently overwriting it.
- A **Save As** from an AI client never replaces a file that is not the
  document's own, even one created while the save was in flight.

### Security

- Dependencies with published security advisories are updated to their
  patched releases, among them DOMPurify, markdown-it, the MCP SDK, undici,
  rustls-webpki and tokio.

## [0.9.103] - 2026-10-20

### Fixed

- Opening a workspace no longer deletes the `.vmark` folder inside it. VMark
  migrates the old `.vmark/vmark.code-workspace` settings into its own app data
  and then used to remove that file and the folder — in a repository that
  tracks them in git, the first open destroyed tracked files with no prompt
  and no undo (#1579). The legacy file is now left exactly as it was, and a
  `.vmark` entry in the workspace's excluded folders still applies.

### Changed

- The terminal guide now separates VMark's integrated terminal, VMark's MCP
  tools, and the browser tools an AI client such as Codex CLI may have of its
  own. It also explains how to verify that a browser connection really read the
  page, and why remote debugging or copied trust overrides are not the way to
  make one work (#1571).

### Security

- The edit-checkpoint history VMark keeps for AI changes is now private to your
  user account (`0600` on macOS and Linux) and can be inspected and cleared
  from the status-bar history popover. Its footer shows how much space the
  checkpoint file occupies on disk, and **Clear all checkpoint history**
  removes it for every file and every open window (#1580). Checkpoints still
  hold the full previous text of each recorded edit — that text is what restore
  uses.

## [0.9.102] - 2026-10-20

### Fixed

- Opening a Markdown file made of many short blocks no longer freezes the
  window. WYSIWYG builds a node for every block, so a 524 KB document with
  3,773 blocks could keep the window unresponsive for 31–35 seconds on Linux.
  VMark now estimates the block count before opening and sends block-dense
  documents (1,200 or more estimated blocks) to Source mode, which opens in
  about a second (#1570). The status bar's **Switch to WYSIWYG** link still
  opens it in WYSIWYG on request, and the **Open large files in Source mode**
  setting turns the automatic routing off.

## [0.9.101] - 2026-10-17

### Fixed

- Large, image-heavy documents open much faster, and the window no longer
  gives up waiting for its menus while one loads (#1565). Images now load
  only as they scroll near the screen, the window sets up its menus before
  it builds the document, and long CJK documents no longer spend seconds
  laying out decorations. On a slow machine, a 484 KB document with 338
  images opens about a quarter faster and uses less memory.
- CJK letter spacing is no longer worked out in WYSIWYG mode while the
  setting is off. Before, every CJK run was processed anyway, which slowed
  down opening long documents for no visible change.
- Saving in the instant before a just-opened document has loaded no longer
  empties it. On a slow machine that instant could last seconds.
- Fixed several cases where a highlight or other editor marking drew in the
  wrong place, or vanished, after an edit that wrapped, lifted or moved
  blocks.

### Security

- The updater no longer includes the `zip` library, which three newly
  published advisories cover (RUSTSEC-2026-0367 to 0369). It was only there
  to unpack an old update format that VMark does not publish.

## [0.9.100] - 2026-10-16

### Fixed

- Exporting to PDF or HTML embeds local images again. Since the symlink
  check for exported images was added, every local image was replaced with
  "Image not found", on every platform (#1555). Re-exporting an HTML folder
  over an earlier export no longer fails for the same reason, and a failed
  image check is now logged with its cause.
- Switching between tabs returns each document to where you were reading.
  Before, a document with a cursor in it always jumped back to that cursor,
  even after you had scrolled away (#1556). Switching between WYSIWYG and
  Source mode still follows the cursor.
- Pressing F6 in a two-document split no longer makes the window flicker
  endlessly between the two documents (#1554). Both panes now share one view
  mode, and clicking a pane no longer switches the window to that
  document's saved mode. Clicking a heading in the outline now moves only
  the focused pane.

### Security

- Updated `rustls`, which VMark uses for its network connections, past four
  newly published advisories (RUSTSEC-2026-0346 to 0349).

## [0.9.99] - 2026-10-13

### Changed

- Updated Tauri to 2.12.2, the editor engine (Tiptap 3.31.4 and its
  ProseMirror packages), Mermaid 12.1, KaTeX 0.19 and the diagram renderer
  (Graphviz 16.1), along with other routine dependency updates. The trusted
  HTML preview's isolation was re-checked against the new Tauri release: a
  previewed document still cannot reach VMark.

### Security

- Updated `quinn-proto` past five newly published advisories
  (RUSTSEC-2026-0338 to 0342). It was listed among VMark's dependencies but
  not built into the app, so no released version was exposed.

## [0.9.98] - 2026-10-12

### Added

- Terminal: scroll up to read earlier output and keep typing. While the
  prompt is out of view, a floating copy of the rows you are typing into —
  the shell prompt, or the input box of a tool such as Claude Code — appears
  at the bottom of the terminal, and typing no longer snaps the view back
  down. Keys still go to the shell, so tab completion, history and input
  methods work as before. Pressing Enter or Ctrl+C, or clicking the arrow on
  the floating row, jumps back to the prompt. Thanks to @ijerrywong for the
  idea and the implementation (#1545).

### Security

- Genie, workflow and GitHub Action YAML files are now read by a parser
  written in safe Rust. The previous one was built on an unmaintained
  machine translation of C code (RUSTSEC-2024-0449). Files that parsed before
  parse the same way: only `true` and `false` count as booleans, and a
  duplicate key is still an error.

## [0.9.97] - 2026-10-10

### Fixed

- In rich-text mode, a few unlisted shortcuts inherited from the editor
  library (Cmd+Option+0 to 6, Cmd+Shift+7 and Cmd+Shift+8; Ctrl on Windows and
  Linux) no longer reformat text behind VMark's back. Pressed inside a code
  block they could turn the whole block into a heading or a list and lose its
  fence. VMark's own heading and list shortcuts are unchanged.

## [0.9.96] - 2026-10-09

### Fixed

- On Windows, launching VMark while an earlier VMark is stuck in the
  background no longer starts a broken second copy that shows an empty
  window. VMark now explains that the earlier process is not responding and
  asks you to end it in Task Manager before starting again
  ([#1527](https://github.com/xiaolai/vmark/issues/1527)).
- On Windows and Linux, VMark no longer retries a browser setting every few
  seconds in the background, which filled the log with
  "embedded browser surface is macOS-only" warnings.

## [0.9.95] - 2026-10-09

### Fixed

- The first press of Cmd+Q is now clearly acknowledged. VMark asks for a
  second press to quit, but the "press again" hint could go unseen when no
  window had focus (for example after choosing Quit from the menu) or when
  the status bar was hidden, so quitting looked broken
  ([#1528](https://github.com/xiaolai/vmark/issues/1528)).
- The welcome screen no longer cuts off its title and buttons when a long
  list of recent files and workspaces is taller than the window; you can
  scroll back to the top.
- On Windows and Linux, if opening a second VMark window fails during a
  relaunch and no window is left, VMark now exits instead of staying alive as
  an invisible process that blocks every later launch. This is a partial fix
  for [#1527](https://github.com/xiaolai/vmark/issues/1527); the underlying
  cause of the reported crash is still being investigated.

### Security

- Updated the MCP SDK used by the AI tool server to 1.31.0, which fixes a
  high-severity flaw (GHSA-6qxp-vccf-f47h) where its OAuth client could send
  saved credentials to a server it should not trust.

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

[Unreleased]: https://github.com/xiaolai/vmark/compare/v0.9.109...HEAD
[0.9.109]: https://github.com/xiaolai/vmark/releases/tag/v0.9.109
[0.9.108]: https://github.com/xiaolai/vmark/releases/tag/v0.9.108
[0.9.107]: https://github.com/xiaolai/vmark/releases/tag/v0.9.107
[0.9.106]: https://github.com/xiaolai/vmark/releases/tag/v0.9.106
[0.9.105]: https://github.com/xiaolai/vmark/releases/tag/v0.9.105
[0.9.104]: https://github.com/xiaolai/vmark/releases/tag/v0.9.104
[0.9.103]: https://github.com/xiaolai/vmark/releases/tag/v0.9.103
[0.9.102]: https://github.com/xiaolai/vmark/releases/tag/v0.9.102
[0.9.101]: https://github.com/xiaolai/vmark/releases/tag/v0.9.101
[0.9.100]: https://github.com/xiaolai/vmark/releases/tag/v0.9.100
[0.9.99]: https://github.com/xiaolai/vmark/releases/tag/v0.9.99
[0.9.98]: https://github.com/xiaolai/vmark/releases/tag/v0.9.98
[0.9.97]: https://github.com/xiaolai/vmark/releases/tag/v0.9.97
[0.9.96]: https://github.com/xiaolai/vmark/releases/tag/v0.9.96
[0.9.95]: https://github.com/xiaolai/vmark/releases/tag/v0.9.95
[0.9.94]: https://github.com/xiaolai/vmark/releases/tag/v0.9.94
[0.9.93]: https://github.com/xiaolai/vmark/releases/tag/v0.9.93
[0.9.92]: https://github.com/xiaolai/vmark/releases/tag/v0.9.92
[0.9.91]: https://github.com/xiaolai/vmark/releases/tag/v0.9.91
[0.9.90]: https://github.com/xiaolai/vmark/releases/tag/v0.9.90
[0.9.89]: https://github.com/xiaolai/vmark/releases/tag/v0.9.89
[0.9.88]: https://github.com/xiaolai/vmark/releases/tag/v0.9.88

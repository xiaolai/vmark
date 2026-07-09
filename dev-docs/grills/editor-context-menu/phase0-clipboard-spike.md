# Phase 0 spike — clipboard via macOS responder chain

Plan: `dev-docs/plans/20260709-editor-context-menu.md` (ADR-3).
Result: **PASS — ADR-3 confirmed** (with one addendum, below).

Method: live probes against a dev build (`pnpm tauri dev`) driven over the
Tauri MCP bridge (port 9323), using the new `trigger_webview_edit` command
(`src-tauri/src/webview_edit.rs`, registered in `lib.rs`) and
`window.__VMARK_DEBUG__.editorView` (dev-only handle from `editorStore.ts`).

## WI-0.1 — responder chain reaches the webview (PASS)

- `trigger_webview_edit("selectAll")` changed the ProseMirror selection to
  the full document.
- `trigger_webview_edit("copy")` on a `TextSelection` over
  `Hello **bold** world` wrote the clipboard (plugin `read_text` returned
  the text; the text flavor follows the `copyFormat` setting via
  `markdownCopy`).
- `trigger_webview_edit("paste")` at a collapsed caret appended the content
  **with the bold mark intact** (2 bold text runs after paste) — the native
  `paste:` flows through the webview clipboard (text/html flavor) and the
  existing PM paste pipeline. Full fidelity, no fork.

## WI-0.2 — the menu focus path (PASS, contract validated both ways)

Worst case simulated: a real `<button>` (stand-in for a keyboard-focused
menu item) holding DOM focus.

- **Negative control**: `paste:` with the button focused did **not** insert
  into the editor. The Codex-flagged failure mode is real.
- **Contract path**: remove menu → `editorView.focus()` → PM restored its
  own selection (collapsed caret at the pre-menu position, no manual
  bookkeeping) → `paste:` landed exactly there.

Conclusion: the clipboard bridge MUST close the menu and refocus the
editor surface before invoking the command (ADR-3's contract). No
selection save/restore code is needed — PM/CM restore selection on focus.

## WI-0.3 — fallbacks (PASS)

- `document.execCommand("copy")` and `("cut")` both returned true, wrote
  the clipboard, and cut removed the selected content from the doc.
- `prosemirror-view` is pinned at **1.41.9**; `EditorView.pasteText` /
  `pasteHTML` exist (added in 1.29) — the non-macOS paste fallback can use
  `pasteText`.

## Addendum — key-window requirement

`NSApp sendAction:` targets the first responder of the **key window**.
During automation the command silently no-ops until the window is focused
(`setFocus()` first). In real usage this is a non-issue — the user just
right-clicked inside the window, so it is key by definition — but E2E
tests must focus the window before asserting clipboard behavior, and the
bridge should not be invoked from background/blurred windows.

## Cleanup

Test document cleared; the user's original clipboard content was saved
before the probes and restored after.

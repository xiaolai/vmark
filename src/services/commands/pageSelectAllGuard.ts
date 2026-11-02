/**
 * Page-wide Select All guard — keeps a Select All that reaches no editing
 * surface from highlighting every piece of text in the window.
 *
 * Purpose: macOS and Linux keep the predefined Edit > Select All item, which goes
 * down the responder chain to the webview and bypasses both the keydown
 * containment binding and the `edit.selectAll` command. With focus outside any
 * field, the engine then selects the whole page: sidebar, editor and status bar.
 * WebKit announces this with a `selectstart` aimed at `<body>` (a Select All in a
 * contenteditable or a text field targets that element), and cancelling the
 * event cancels the selection.
 *
 * Key decisions:
 *   - The target is the only test. A mouse selection targets the node under the
 *     pointer, and `#root` fills the window, so read-only text stays selectable.
 *   - A cancelled Select All is sent to `edit.selectAll`, so the menu item still
 *     does what it says. The command refuses when no editor exists, which leaves
 *     the Welcome screen and the Settings window with nothing selected.
 *   - The command re-issues the native action after focusing the editor, so
 *     `redirecting` stops a failed focus from looping back through this guard.
 *
 * @coordinates-with services/commands/clipboardCommands.ts — the redirect target
 * @coordinates-with bootstrap.tsx — installs it once per window, before App
 * @module services/commands/pageSelectAllGuard
 */

import { selectAllError } from "@/utils/debug";
import { executeCommand } from "./CommandBus";

/** Start cancelling page-wide Select All in this window. Returns the uninstaller. */
export function installPageSelectAllGuard(): () => void {
  let redirecting = false;

  const onSelectStart = (event: Event): void => {
    const { target } = event;
    if (target !== document.body && target !== document.documentElement) return;

    event.preventDefault();
    if (redirecting) return;

    redirecting = true;
    executeCommand("edit.selectAll")
      .catch((error: unknown) => {
        selectAllError("redirect to the editor failed:", error);
      })
      .finally(() => {
        redirecting = false;
      });
  };

  document.addEventListener("selectstart", onSelectStart, true);
  return () => document.removeEventListener("selectstart", onSelectStart, true);
}

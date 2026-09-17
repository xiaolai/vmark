/**
 * terminalGate — the ONE policy for "the user asked for the terminal".
 *
 * Two halves, and both belong to that one request: whether the panel may open
 * at all (it needs a working directory), and where the caret goes when it does.
 * Focus is policy, not decoration — a panel you must click into is a panel the
 * keyboard cannot reach, and a panel that hides while holding the caret leaves
 * the next keystroke with nowhere to go.
 *
 * Only the USER-initiated paths route through here. `hot_exit` restore and the
 * session-reveal path call `uiStore.toggleTerminal()` directly, and must keep
 * doing so: a window restoring its session at launch must not steal focus from
 * the document the user is about to read.
 *
 * @coordinates-with services/terminal/terminalFocus.ts — the focus primitives
 * @coordinates-with services/commands/viewCommands.ts — view.toggleTerminal / view.focusTerminal
 * @module services/terminal/terminalGate
 */
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { terminalHasFocus } from "@/utils/terminalSurface";
import {
  focusActiveTerminal,
  focusActiveTerminalSoon,
  focusEditorNow,
  restoreEditorFocusIfOrphaned,
} from "./terminalFocus";

/** Pure check — testable without side effects. */
export function canOpenTerminal(): boolean {
  if (useWorkspaceStore.getState().isWorkspaceMode) return true;

  // Allow terminal when active tab has a saved file (use its parent dir as cwd)
  const windowLabel = getCurrentWindowLabel();
  const activeTabId = useTabStore.getState().activeTabId[windowLabel];
  if (activeTabId) {
    const doc = useDocumentStore.getState().getDocument(activeTabId);
    if (doc?.filePath) return true;
  }

  return false;
}

/** Gate terminal toggle: show toast if no workspace when opening. */
export function requestToggleTerminal(): void {
  const isVisible = useUIStore.getState().terminalVisible;
  if (!isVisible && !canOpenTerminal()) {
    toast.info(i18n.t("dialog:toast.terminalNeedsWorkspace"));
    return;
  }
  useUIStore.getState().toggleTerminal();
  if (useUIStore.getState().terminalVisible) {
    // Deferred: the panel is still display:none in this tick.
    focusActiveTerminalSoon();
  } else {
    restoreEditorFocusIfOrphaned();
  }
}

/**
 * Move the caret between the editor and the terminal, leaving the panel's
 * VISIBILITY alone — the user wants to keep seeing the shell they just left.
 *
 * A hidden panel is the one exception: "focus the terminal" when there is no
 * terminal on screen means open it, which routes back through the gate above
 * so the workspace refusal and its toast still apply.
 */
export function toggleTerminalFocus(): void {
  if (!useUIStore.getState().terminalVisible) {
    requestToggleTerminal();
    return;
  }
  if (terminalHasFocus()) {
    focusEditorNow();
    return;
  }
  // A miss means the session's xterm is not mounted yet; try again next frame.
  if (!focusActiveTerminal()) focusActiveTerminalSoon();
}

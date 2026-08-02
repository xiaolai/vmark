/**
 * Purpose: the DOM the suggestion decorations render — ghost text, icons, and
 * the accept/reject buttons.
 *
 * Split out of `tiptap.ts`, which was past its size cap. The division is by
 * concern, not by line count: everything here builds detached DOM and knows
 * nothing about ProseMirror plugin state, while `tiptap.ts` decides WHICH
 * decorations exist and when.
 *
 * Key decisions:
 *   - The buttons act on the view ProseMirror hands the widget, not on a
 *     globally-registered editor. A stale global view made the accept button
 *     silently do nothing; a passed-in one cannot.
 *   - mousedown, not click: ProseMirror's own mousedown handler rebuilds
 *     widget decorations, replacing this DOM before a click would fire.
 *
 * @coordinates-with plugins/aiSuggestion/tiptap.ts — builds the decorations
 * @module plugins/aiSuggestion/widgets
 */

import i18n from "@/i18n";
import type { EditorView } from "@tiptap/pm/view";
import { hostDocument } from "@/plugins/shared/hostDocument";
import { captureAiEdit } from "@/services/coherence/captureFunnel";
import { runOrQueueProseMirrorAction } from "@/utils/imeGuard";
import { cleanMarkdownForClipboard } from "@/plugins/markdownCopy/tiptap";
import { applySuggestionToTr } from "./applySuggestion";
import type { AiSuggestion, AiSuggestionStore } from "./types";

/**
 * Create Lucide-style SVG icon element.
 */
function createIcon(pathD: string | string[]): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");

  const paths = Array.isArray(pathD) ? pathD : [pathD];
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }

  return svg;
}

// Lucide icon paths
const ICON_CHECK = "M20 6 9 17l-5-5";
const ICON_X = ["M18 6 6 18", "m6 6 12 12"];

/**
 * Create ghost text element for insert/replace preview.
 */
export function createGhostText(text: string, isFocused: boolean): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `ai-suggestion-ghost${isFocused ? " ai-suggestion-ghost-focused" : ""}`;
  // Strip markdown backslash escapes (\$, \~, \@ …) and collapse autolinks
  // so ghost text matches what the user will see after accepting.
  span.textContent = cleanMarkdownForClipboard(text);
  return span;
}
/**
 * Coherence capture (WI-1.6): report an accepted suggestion to the kernel
 * after the buffer settles. Dirty state is read BEFORE the apply — it
 * decides exact vs. inferred provenance (spec §8). Fire-and-forget.
 */
export function captureAcceptedSuggestion(tabId: string, bufferWasDirty: boolean): void {
  // Called synchronously after dispatch: tiptap's onUpdate has already
  // synced the store, and captureAiEdit snapshots at entry (audit T3) —
  // a rapid second apply cannot change what this capture records.
  void captureAiEdit({
    tabId,
    intentKind: "ai-suggestion",
    summary: "suggestion accepted",
    bufferWasDirty,
  }).catch(() => {});
}

/**
 * Apply a suggestion directly on the editor view.
 * Uses runOrQueueProseMirrorAction for IME safety.
 */
function applySuggestion(view: EditorView, suggestion: AiSuggestion): void {
  runOrQueueProseMirrorAction(view, () => {
    const bufferWasDirty = hostDocument.isTabDirty(suggestion.tabId);
    const { state } = view;
    view.dispatch(applySuggestionToTr(state, state.tr, suggestion));
    captureAcceptedSuggestion(suggestion.tabId, bufferWasDirty);
  });
}

/**
 * Create accept/reject buttons container.
 * Buttons apply changes directly via the editor store — no CustomEvent
 * indirection — for immediate visual response.
 */
export function createButtons(
  suggestion: AiSuggestion,
  view: EditorView,
  store: AiSuggestionStore
): HTMLSpanElement {
  const container = document.createElement("span");
  container.className = "ai-suggestion-buttons";

  // Use mousedown instead of click — ProseMirror's mousedown handler
  // triggers state updates that rebuild widget decorations, so the button
  // DOM is replaced before the click event fires.
  const acceptBtn = document.createElement("button");
  acceptBtn.className = "ai-suggestion-btn ai-suggestion-btn-accept";
  const acceptLabel = i18n.t("editor:plugin.acceptSuggestion");
  acceptBtn.title = acceptLabel;
  acceptBtn.setAttribute("aria-label", acceptLabel);
  acceptBtn.appendChild(createIcon(ICON_CHECK));
  acceptBtn.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    applySuggestion(view, suggestion);
    store.getState().removeSuggestion(suggestion.id);
  };

  // Reject button with X icon
  const rejectBtn = document.createElement("button");
  rejectBtn.className = "ai-suggestion-btn ai-suggestion-btn-reject";
  const rejectLabel = i18n.t("editor:plugin.rejectSuggestion");
  rejectBtn.title = rejectLabel;
  rejectBtn.setAttribute("aria-label", rejectLabel);
  rejectBtn.appendChild(createIcon(ICON_X));
  rejectBtn.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    store.getState().removeSuggestion(suggestion.id);
  };

  container.appendChild(acceptBtn);
  container.appendChild(rejectBtn);
  return container;
}

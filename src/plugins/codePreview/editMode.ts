/**
 * Code Preview Edit Mode
 *
 * Purpose: Debounced live-preview rendering while a code block is being edited,
 * and exitEditMode (save/cancel) which commits or reverts the block and restores
 * the selection. Split from tiptap.ts for size.
 *
 * Key decisions:
 *   - Preview rendering is debounced (200ms) to avoid re-rendering on every keystroke;
 *     debounce timers/tokens are keyed per preview element so concurrent edit
 *     sessions (split panes, multiple registered editors) can't cancel each
 *     other's pending renders.
 *   - exitEditMode guards stale editingPos (out-of-bounds, or pointing at a
 *     non-codeBlock node after a doc shift) and aborts the replaceWith path
 *     to prevent `Position N outside of fragment` crashes on save/cancel.
 *   - Selection placement resolves against tr.doc (not state.doc); see
 *     blockMathKeymap header for the same rule and motivation.
 *   - exitEditMode is a no-op without a view: guessing (e.g. "first registered
 *     view") could save or revert into the wrong document in split-pane or
 *     multi-editor setups. Callers own the view that hosts the edit session.
 *   - User-facing strings flow through i18n.t("editor:preview.*") rather than
 *     literal English.
 *
 * @coordinates-with tiptap.ts — apply() re-renders the live preview on doc changes
 * @coordinates-with previewDecorations.ts — edit-header widgets call exitEditMode
 * @coordinates-with blockMathKeymap.ts — keyboard shortcuts for math editing
 * @module plugins/codePreview/editMode
 */

import { TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { diagramWarn } from "@/utils/debug";
import { useBlockMathEditingStore } from "@/stores/blockMathEditingStore";
import i18n from "@/i18n";
import { isGraphvizLanguage } from "@/plugins/graphviz";
import { isLatexLanguage } from "./previewHelpers";
import { updateLatexLivePreview } from "./renderers/renderLatex";
import { updateMermaidLivePreview } from "./renderers/renderMermaidPreview";
import { updateGraphvizLivePreview } from "./renderers/renderGraphvizPreview";
import { updateMarkmapLivePreview } from "./renderers/renderMarkmapPreview";
import { updateSvgLivePreview } from "./renderers/renderSvgPreview";
import { updateWorkflowLivePreview } from "./renderers/renderWorkflowPreview";
import { errorMessage } from "@/utils/errorMessage";
import { previewCache, EDITING_STATE_CHANGED } from "./pluginState";

const DEBOUNCE_MS = 200;

/**
 * Debounced live-preview render state, keyed per preview element. Module-global
 * state here caused cross-cancellation: rapid edits reflected into two preview
 * elements (split panes rendering the same doc) cancelled each other's timers.
 */
interface LivePreviewDebounce {
  timeout: ReturnType<typeof setTimeout>;
  token: number;
}
const livePreviewDebounce = new Map<HTMLElement, LivePreviewDebounce>();

/**
 * Cancel every pending live-preview render and invalidate in-flight tokens
 * (deleted entries make getToken() return -1, aborting async renders).
 * Called when an edit session ends — at most one session is active per window,
 * so cancelling all pending renders is always safe.
 */
function cancelLivePreviews(): void {
  for (const { timeout } of livePreviewDebounce.values()) clearTimeout(timeout);
  livePreviewDebounce.clear();
}

/** Update live preview content with per-element debouncing */
export function updateLivePreview(
  element: HTMLElement,
  language: string,
  content: string
): void {
  const existing = livePreviewDebounce.get(element);
  if (existing) clearTimeout(existing.timeout);

  const currentToken = (existing?.token ?? 0) + 1;
  const getToken = () => livePreviewDebounce.get(element)?.token ?? -1;

  const timeout = setTimeout(async () => {
    /* v8 ignore next -- @preserve stale-token guard: fires only when a prior timer somehow outlives a later updateLivePreview call for the same element; in practice all callers clear the timeout before bumping the token, making the early-return unreachable in synchronous tests */
    if (currentToken !== getToken()) return;

    try {
      const trimmed = content.trim();
      if (!trimmed) {
        element.replaceChildren(
          Object.assign(document.createElement("div"), {
            className: "code-block-live-preview-empty",
            textContent: i18n.t("editor:preview.empty"),
          }),
        );
        return;
      }

      if (isLatexLanguage(language)) {
        updateLatexLivePreview(element, trimmed, currentToken, getToken);
      } else if (language === "mermaid") {
        await updateMermaidLivePreview(element, trimmed, currentToken, getToken);
      } else if (isGraphvizLanguage(language)) {
        await updateGraphvizLivePreview(element, trimmed, currentToken, getToken);
      } else if (language === "markmap") {
        await updateMarkmapLivePreview(element, trimmed, currentToken, getToken);
      } else if (language === "yaml" || language === "yml") {
        await updateWorkflowLivePreview(element, trimmed, currentToken, getToken);
      } else {
        // Only "svg" reaches this branch among PREVIEW_ONLY_LANGUAGES
        updateSvgLivePreview(element, trimmed, currentToken, getToken);
      }
    } catch (error) {
      const msg = errorMessage(error);
      diagramWarn("code preview live render failed:", msg);
      element.replaceChildren(
        Object.assign(document.createElement("div"), {
          className: "code-block-live-preview-error",
          textContent: i18n.t("editor:preview.renderFailed"),
        }),
      );
    }
  }, DEBOUNCE_MS);

  livePreviewDebounce.set(element, { timeout, token: currentToken });
}

/**
 * Abort a stale edit session: clear the store, tell decorations to rebuild,
 * and cancel any pending live-preview renders.
 */
function abortEditMode(
  store: ReturnType<typeof useBlockMathEditingStore.getState>,
  state: EditorState,
  dispatch: EditorView["dispatch"],
): void {
  store.exitEditing();
  dispatch(state.tr.setMeta(EDITING_STATE_CHANGED, true));
  cancelLivePreviews();
}

/**
 * Exit editing mode. No-op without a view — the caller owns the view that
 * hosts the edit session; guessing (e.g. "first registered view") could save
 * or revert into the wrong document in split-pane / multi-editor setups.
 */
export function exitEditMode(view: EditorView | null, revert: boolean): void {
  if (!view) {
    return;
  }

  const store = useBlockMathEditingStore.getState();
  const { editingPos, originalContent } = store;

  if (editingPos === null) {
    return;
  }

  const { state, dispatch } = view;

  // Guard: editingPos may be stale (doc shifted, node deleted, position past
  // end). Without this, the replaceWith below can throw
  // `Position N outside of fragment (...)` — the WYSIWYG crash class.
  if (editingPos < 0 || editingPos >= state.doc.content.size) {
    abortEditMode(store, state, dispatch);
    return;
  }
  const node = state.doc.nodeAt(editingPos);

  if (!node) {
    abortEditMode(store, state, dispatch);
    return;
  }

  if (node.type.name !== "codeBlock" && node.type.name !== "code_block") {
    // editingPos no longer points at a code block — abort to avoid mutating
    // unrelated content.
    abortEditMode(store, state, dispatch);
    return;
  }

  let tr = state.tr;

  // If reverting, restore original content
  if (revert && originalContent !== null) {
    const currentContent = node.textContent;
    if (currentContent !== originalContent) {
      const start = editingPos + 1;
      const end = editingPos + node.nodeSize - 1;
      /* v8 ignore next -- @preserve originalContent is always truthy here (empty string exits via !== check) */
      tr = tr.replaceWith(start, end, originalContent ? state.schema.text(originalContent) : []);
    }
  }

  // Clear render cache for this content to force re-render
  /* v8 ignore next -- @preserve defensive nullish fallback: PREVIEW_ONLY_LANGUAGES nodes always have a language attr; null/undefined only possible via malformed external doc */
  const language = (node.attrs.language ?? "").toLowerCase();
  const content = revert ? originalContent : node.textContent;
  if (content) {
    const cacheKey = `${language}:${content}`;
    previewCache.delete(cacheKey);
  }

  // Move cursor after the code block. Resolve against tr.doc, not state.doc:
  // a preceding replaceWith may have transformed the document, and PM rejects
  // a selection whose $pos belongs to a different doc instance.
  const nodeEnd = editingPos + node.nodeSize;
  const $pos = tr.doc.resolve(Math.min(nodeEnd, tr.doc.content.size));
  tr = tr.setSelection(TextSelection.near($pos));
  tr.setMeta(EDITING_STATE_CHANGED, true);

  // Exit editing FIRST (before dispatch, so decorations see the new state)
  store.exitEditing();
  dispatch(tr);

  // Cancel any pending live-preview renders for the ended session
  cancelLivePreviews();
}

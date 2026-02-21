/**
 * Source Copy-on-Select Plugin
 *
 * Purpose: Auto-copies selected text to clipboard on mouseup in Source mode,
 * matching the WYSIWYG copy-on-select behavior for consistent cross-mode UX.
 *
 * Key decisions:
 *   - copyFormat setting is not applicable — source mode text IS already markdown
 *   - Only fires on mouseup (not keyboard selection) to avoid clipboard spam
 *   - Cleans text before copying (trailing whitespace, etc.)
 *   - Gated by the copyOnSelect setting from settingsStore
 *
 * @coordinates-with stores/settingsStore.ts — reads general.copyOnSelect setting
 * @module plugins/codemirror/sourceCopyOnSelect
 */

import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";
import { useSettingsStore } from "@/stores/settingsStore";
import { cleanTextForClipboard } from "@/plugins/markdownCopy/tiptap";
import { clipboardWarn } from "@/utils/debug";

export function createSourceCopyOnSelectPlugin(): Extension {
  return ViewPlugin.fromClass(
    class {
      private view: EditorView;
      private destroyed = false;

      constructor(view: EditorView) {
        this.view = view;
        view.dom.addEventListener("mouseup", this.handleMouseUp);
      }

      handleMouseUp = () => {
        if (!useSettingsStore.getState().markdown.copyOnSelect) return;

        const view = this.view;
        requestAnimationFrame(() => {
          if (this.destroyed) return;

          const { from, to } = view.state.selection.main;
          if (from === to) return;

          const raw = view.state.sliceDoc(from, to);
          const text = cleanTextForClipboard(raw);
          if (text) {
            navigator.clipboard.writeText(text).catch((error: unknown) => {
              clipboardWarn("Clipboard write failed:", error instanceof Error ? error.message : String(error));
            });
          }
        });
      };

      destroy() {
        this.destroyed = true;
        this.view.dom.removeEventListener("mouseup", this.handleMouseUp);
      }
    }
  );
}

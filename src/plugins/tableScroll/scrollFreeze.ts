/**
 * Table Scroll Freeze
 *
 * Prevents WebKit's native contenteditable caret-scroll on .editor-content
 * when the cursor is inside a table. WebKit's scroll fires asynchronously
 * (outside PM's dispatch cycle) and can't be prevented by CSS overflow or
 * JS scroll event handlers.
 *
 * Strategy: on mousedown inside a table (or keyboard nav into one), freeze
 * .editor-content's scrollTop by overriding the property descriptor for a
 * brief window (250ms). The setter is a true no-op — it discards all writes,
 * including WebKit's attempted caret-scroll. After the freeze window, the
 * native descriptor is restored and correct vertical-only scroll is applied
 * using the shared scrollVerticalOnly helper from scrollGuard.
 *
 * Only active on WebKit (Safari / Tauri WKWebView). Other engines are
 * unaffected — the extension is a no-op on non-WebKit platforms.
 *
 * @coordinates-with scrollGuard.ts — handleScrollToSelection for PM-triggered scroll
 * @coordinates-with scrollGuard.ts — scrollVerticalOnly for post-unfreeze correction
 * @module plugins/tableScroll/scrollFreeze
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { isSelectionInTable, scrollVerticalOnly } from "./scrollGuard";

const scrollFreezeKey = new PluginKey("tableScrollFreeze");

/** Duration to freeze scrollTop after a table interaction (ms). */
const FREEZE_DURATION_MS = 250;

/** WebKit detection — only WebKit has this bug. */
const isWebKit =
  typeof navigator !== "undefined" &&
  /AppleWebKit/.test(navigator.userAgent) &&
  !/Chrome/.test(navigator.userAgent);

export const tableScrollFreezeExtension = Extension.create({
  name: "tableScrollFreeze",
  addProseMirrorPlugins() {
    // No-op on non-WebKit engines (#4: cross-platform regression risk)
    if (!isWebKit) return [];

    let scrollContainer: HTMLElement | null = null;
    let frozen = false;
    let baselineScrollTop = 0; // Immutable snapshot at freeze time
    let unfreezeTimer: ReturnType<typeof setTimeout> | null = null;

    function freeze(container: HTMLElement) {
      if (frozen) return;
      // Capture immutable baseline — this is what we restore to (#1)
      baselineScrollTop = container.scrollTop;
      frozen = true;

      Object.defineProperty(container, "scrollTop", {
        configurable: true,
        get() {
          return baselineScrollTop;
        },
        set(_val: number) {
          // True no-op: discard ALL writes including WebKit's caret-scroll (#1)
        },
      });
    }

    function unfreeze(container: HTMLElement, view: EditorView) {
      if (!frozen) return;
      frozen = false;

      // Remove instance override, restoring native behavior
      delete (container as unknown as Record<string, unknown>).scrollTop;

      // If cursor left the table, let the native scroll position stand —
      // baselineScrollTop is stale and restoring it would jump back to the table.
      if (!isSelectionInTable(view)) return;

      // Restore to the immutable baseline
      container.scrollTop = baselineScrollTop;

      // Apply correct vertical-only scroll if cursor is off-screen (#5: shared helper)
      scrollVerticalOnly(view, container);
    }

    function scheduleUnfreeze(container: HTMLElement, view: EditorView) {
      if (unfreezeTimer) clearTimeout(unfreezeTimer);
      unfreezeTimer = setTimeout(() => {
        unfreezeTimer = null;
        unfreeze(container, view);
      }, FREEZE_DURATION_MS);
    }

    return [
      new Plugin({
        key: scrollFreezeKey,
        props: {
          handleDOMEvents: {
            // Capture phase via PM's handleDOMEvents for normal clicks (#2 partial)
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;
              if (!target?.closest("table")) return false;

              if (!scrollContainer) {
                scrollContainer = view.dom.closest(".editor-content") as HTMLElement | null;
              }
              if (!scrollContainer) return false;

              freeze(scrollContainer);
              scheduleUnfreeze(scrollContainer, view);
              return false;
            },
          },
        },
        view(editorView) {
          // Capture-phase listener on the editor DOM catches mousedown on resize
          // handles, which stopPropagation and never reach PM's handleDOMEvents (#2).
          const onCapture = (e: Event) => {
            const target = e.target as HTMLElement | null;
            if (!target?.closest("table")) return;
            if (!scrollContainer) {
              scrollContainer = editorView.dom.closest(".editor-content") as HTMLElement | null;
            }
            if (scrollContainer) {
              freeze(scrollContainer);
              scheduleUnfreeze(scrollContainer, editorView);
            }
          };
          editorView.dom.addEventListener("mousedown", onCapture, true);

          return {
            update(view) {
              if (!scrollContainer) {
                scrollContainer = view.dom.closest(".editor-content") as HTMLElement | null;
              }
              if (!scrollContainer) return;

              // Freeze on any PM update that lands in a table —
              // catches keyboard nav, resize handle interactions (#2), and
              // any path that bypasses the mousedown handler
              if (isSelectionInTable(view) && !frozen) {
                freeze(scrollContainer);
                scheduleUnfreeze(scrollContainer, view);
              } else if (isSelectionInTable(view) && frozen) {
                // Still in table — restart timer
                scheduleUnfreeze(scrollContainer, view);
              }
            },
            destroy() {
              editorView.dom.removeEventListener("mousedown", onCapture, true);
              if (scrollContainer && frozen) {
                delete (scrollContainer as unknown as Record<string, unknown>).scrollTop;
              }
              if (unfreezeTimer) clearTimeout(unfreezeTimer);
            },
          };
        },
      }),
    ];
  },
});

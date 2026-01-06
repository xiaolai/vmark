import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { useEditorStore } from "@/stores/editorStore";

const typewriterPluginKey = new PluginKey("typewriterMode");

const SCROLL_THRESHOLD = 30;
const SKIP_INITIAL_UPDATES = 3;

export const typewriterModeExtension = Extension.create({
  name: "typewriterMode",
  addProseMirrorPlugins() {
    let updateCount = 0;
    let rafId: number | null = null;

    return [
      new Plugin({
        key: typewriterPluginKey,
        view: () => ({
          update: (view, prevState) => {
            const typewriterEnabled = useEditorStore.getState().typewriterModeEnabled;
            if (!typewriterEnabled) return;

            if (view.state.selection.eq(prevState.selection)) return;

            updateCount++;
            if (updateCount <= SKIP_INITIAL_UPDATES) return;

            if (rafId !== null) {
              cancelAnimationFrame(rafId);
            }

            rafId = requestAnimationFrame(() => {
              rafId = null;

              try {
                const { from } = view.state.selection;
                const coords = view.coordsAtPos(from);

                const scrollContainer = view.dom.closest(".editor-content") || view.dom.parentElement;
                if (!scrollContainer) return;

                const containerRect = scrollContainer.getBoundingClientRect();
                const containerHeight = containerRect.height;
                const targetY = containerRect.top + containerHeight * 0.4;
                const scrollOffset = coords.top - targetY;

                if (Math.abs(scrollOffset) > SCROLL_THRESHOLD) {
                  scrollContainer.scrollBy({
                    top: scrollOffset,
                    behavior: "smooth",
                  });
                }
              } catch {
                // coordsAtPos can throw if position is invalid
              }
            });
          },
          destroy: () => {
            if (rafId !== null) {
              cancelAnimationFrame(rafId);
            }
          },
        }),
      }),
    ];
  },
});


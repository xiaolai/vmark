import type { EditorView } from "@tiptap/pm/view";
import type { AnchorRect } from "@/utils/popupPosition";
import { calculatePopupPosition, getBoundaryRects, getViewportBounds } from "@/utils/popupPosition";

export function positionTiptapToolbar(opts: {
  container: HTMLElement;
  editorView: EditorView;
  anchorRect: AnchorRect;
}) {
  const containerEl = opts.editorView.dom.closest(".editor-container") as HTMLElement;
  const bounds = containerEl
    ? getBoundaryRects(opts.editorView.dom as HTMLElement, containerEl)
    : getViewportBounds();

  const toolbarWidth = opts.container.offsetWidth || 280;
  const toolbarHeight = opts.container.offsetHeight || 36;

  const { top, left } = calculatePopupPosition({
    anchor: opts.anchorRect,
    popup: { width: toolbarWidth, height: toolbarHeight },
    bounds,
    gap: 8,
    preferAbove: true,
  });

  opts.container.style.top = `${top}px`;
  opts.container.style.left = `${left}px`;
}


import { useEffect, useMemo, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import type { EditorView as TiptapEditorView } from "@tiptap/pm/view";
import { useSourcePeekStore } from "@/stores/sourcePeekStore";
import { applySourcePeekMarkdown } from "@/utils/sourcePeek";
import { codeHighlightStyle } from "@/plugins/codemirror";

const MAX_WIDTH_PX = 560;
const OVERLAY_MARGIN_PX = 12;
const MIN_HEIGHT_PX = 140;

interface SourcePeekProps {
  getEditorView: () => TiptapEditorView | null;
}

function buildOverlayStyle(anchorRect: { top: number; left: number; right: number; bottom: number } | null) {
  if (!anchorRect || typeof window === "undefined") return {};

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(MAX_WIDTH_PX, Math.max(280, viewportWidth - OVERLAY_MARGIN_PX * 2));

  const preferredLeft = anchorRect.left;
  const clampedLeft = Math.min(
    Math.max(preferredLeft, OVERLAY_MARGIN_PX),
    viewportWidth - width - OVERLAY_MARGIN_PX
  );

  const preferredTop = anchorRect.bottom + OVERLAY_MARGIN_PX;
  const availableBelow = viewportHeight - preferredTop - OVERLAY_MARGIN_PX;
  const availableAbove = anchorRect.top - OVERLAY_MARGIN_PX;

  let top = preferredTop;
  let maxHeight = Math.max(MIN_HEIGHT_PX, availableBelow);

  if (availableBelow < MIN_HEIGHT_PX && availableAbove > MIN_HEIGHT_PX) {
    maxHeight = Math.max(MIN_HEIGHT_PX, availableAbove);
    top = Math.max(OVERLAY_MARGIN_PX, anchorRect.top - OVERLAY_MARGIN_PX - maxHeight);
  }

  return {
    left: clampedLeft,
    top,
    width,
    maxHeight,
  };
}

export function SourcePeek({ getEditorView }: SourcePeekProps) {
  const isOpen = useSourcePeekStore((state) => state.isOpen);
  const markdownText = useSourcePeekStore((state) => state.markdown);
  const anchorRect = useSourcePeekStore((state) => state.anchorRect);
  const range = useSourcePeekStore((state) => state.range);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const overlayStyle = useMemo(() => buildOverlayStyle(anchorRect), [anchorRect]);

  useEffect(() => {
    if (!isOpen) {
      viewRef.current?.destroy();
      viewRef.current = null;
      return;
    }

    if (!containerRef.current || viewRef.current) return;

    const theme = EditorView.theme({
      "&": {
        height: "100%",
      },
      ".cm-content": {
        fontFamily: "var(--font-mono, monospace)",
        fontSize: "13px",
        lineHeight: "1.5",
        padding: "0",
      },
      ".cm-line": {
        padding: "0",
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--selection-color, rgba(0, 122, 255, 0.2)) !important",
      },
    });

    const applyAndClose = () => {
      const view = getEditorView();
      const currentRange = useSourcePeekStore.getState().range;
      if (!view || !currentRange) return;
      const text = viewRef.current?.state.doc.toString() ?? markdownText;
      if (applySourcePeekMarkdown(view, currentRange, text)) {
        useSourcePeekStore.getState().close();
        view.focus();
      }
    };

    const closeOnly = () => {
      useSourcePeekStore.getState().close();
      const view = getEditorView();
      if (view) view.focus();
    };

    const state = EditorState.create({
      doc: markdownText,
      extensions: [
        EditorView.lineWrapping,
        history(),
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              applyAndClose();
              return true;
            },
          },
          {
            key: "Escape",
            run: () => {
              closeOnly();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        markdown({ codeLanguages: languages }),
        syntaxHighlighting(codeHighlightStyle, { fallback: true }),
        theme,
      ],
    });

    viewRef.current = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current.focus();
  }, [getEditorView, isOpen, markdownText]);

  useEffect(() => {
    if (!isOpen) return;
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === markdownText) return;
    view.dispatch({
      changes: {
        from: 0,
        to: current.length,
        insert: markdownText,
      },
    });
  }, [isOpen, markdownText]);

  if (!isOpen || !anchorRect || !range) return null;

  return (
    <div
      className="source-peek"
      style={overlayStyle}
      role="dialog"
      aria-label="Source Peek"
    >
      <div className="source-peek-header">
        <div className="source-peek-title">Source Peek</div>
        <div className="source-peek-hint">Mod+Enter apply, Esc cancel</div>
      </div>
      <div className="source-peek-editor" ref={containerRef} />
    </div>
  );
}

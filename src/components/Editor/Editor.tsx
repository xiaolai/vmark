import { useEffect, useRef, useCallback } from "react";
import {
  Editor as MilkdownEditor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
} from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
} from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { indent } from "@milkdown/kit/plugin/indent";
import { trailing } from "@milkdown/kit/plugin/trailing";
import { replaceAll, callCommand } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isWindowFocused } from "@/utils/windowFocus";
import { useEditorStore } from "@/stores/editorStore";
import {
  useDocumentContent,
  useDocumentId,
  useDocumentCursorInfo,
  useDocumentActions,
} from "@/hooks/useDocumentState";
import { useParagraphCommands } from "@/hooks/useParagraphCommands";
import { useFormatCommands } from "@/hooks/useFormatCommands";
import { useTableCommands } from "@/hooks/useTableCommands";
import { useCJKFormatCommands } from "@/hooks/useCJKFormatCommands";
import { useSelectionCommands } from "@/hooks/useSelectionCommands";
import { useImageDrop } from "@/hooks/useImageDrop";
import { useImageContextMenu } from "@/hooks/useImageContextMenu";
import { ImageContextMenu } from "./ImageContextMenu";
import { restoreCursorInProseMirror } from "@/utils/cursorSync/prosemirror";
import { overrideKeymapPlugin, cursorSyncPlugin, blankDocFocusPlugin } from "@/plugins/editorPlugins";
import { syntaxRevealPlugin } from "@/plugins/syntaxReveal";
import { linkPopupPlugin } from "@/plugins/linkPopup";
import { alertBlockPlugin } from "@/plugins/alertBlock";
import { detailsBlockPlugin } from "@/plugins/detailsBlock";
import { focusModePlugin } from "@/plugins/focusMode";
import { typewriterModePlugin } from "@/plugins/typewriterMode";
import { searchPlugin } from "@/plugins/search/searchPlugin";
import { imageHandlerPlugin, imageInputRule } from "@/plugins/imageHandler";
import { imageViewPlugin } from "@/plugins/imageView";
import {
  remarkMathPlugin,
  mathInlineSchema,
  mathInlineInputRule,
  mathBlockInputRule,
  mathBlockSchema,
  mathBlockView,
} from "@/plugins/latex";
import {
  mermaidBlockSchema,
  mermaidBlockView,
} from "@/plugins/mermaid";
import { codePreviewPlugin } from "@/plugins/codePreview";
import { slashMenu, configureSlashMenu } from "@/plugins/triggerMenu";
import { SourceEditor } from "./SourceEditor";
import "./editor.css";
import "@/plugins/syntaxReveal/syntax-reveal.css";
import "@/plugins/linkPopup/link-popup.css";
import "@/plugins/alertBlock/alert-block.css";
import "@/plugins/detailsBlock/details-block.css";
import "@/plugins/focusMode/focus-mode.css";
import "@/plugins/typewriterMode/typewriter-mode.css";
import "@/plugins/search/search.css";
import "@/plugins/codePreview/code-preview.css";
import "@/plugins/latex/latex.css";
import "@/plugins/mermaid/mermaid.css";
import "katex/dist/katex.min.css";


function MilkdownEditorInner() {
  const content = useDocumentContent();
  const cursorInfo = useDocumentCursorInfo();
  const { setContent } = useDocumentActions();

  // Track if content change is from editor (internal) or external (store)
  const isInternalChange = useRef(false);
  // Use empty string to force sync on mount
  const lastExternalContent = useRef<string>("");
  const formatUnlistenRefs = useRef<UnlistenFn[]>([]);

  const handleMarkdownUpdate = useCallback((_: unknown, markdown: string) => {
    isInternalChange.current = true;
    setContent(markdown);
    // Reset flag after state update propagates
    requestAnimationFrame(() => {
      isInternalChange.current = false;
    });
  }, [setContent]);

  const { get } = useEditor((root) =>
    MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, content);
      })
      .use(overrideKeymapPlugin)
      .use(commonmark)
      .use(gfm)
      .use(alertBlockPlugin.flat())
      .use(detailsBlockPlugin.flat())
      .use(history)
      .use(clipboard)
      .use(imageHandlerPlugin)
      .use(imageViewPlugin)
      .use(imageInputRule)
      .use(listener)
      .use(cursor)
      .use(indent)
      .use(trailing)
      .use(cursorSyncPlugin)
      .use(blankDocFocusPlugin)
      .use(syntaxRevealPlugin)
      .use(linkPopupPlugin)
      .use(focusModePlugin)
      .use(typewriterModePlugin)
      .use(searchPlugin)
      .use(remarkMathPlugin)
      .use(mathInlineSchema)
      .use(mathInlineInputRule)
      .use(mathBlockSchema)
      .use(mathBlockView)
      .use(mathBlockInputRule)
      .use(mermaidBlockSchema)
      .use(mermaidBlockView)
      .use(codePreviewPlugin)
      .use(slashMenu)
      .config((ctx) => {
        // Configure listener AFTER the plugin is loaded
        ctx.get(listenerCtx).markdownUpdated(handleMarkdownUpdate);
      })
      .config(configureSlashMenu)
  );

  // Auto-focus on mount - poll until editor is ready
  useEffect(() => {
    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval>;
    let focusTimeout: ReturnType<typeof setTimeout>;

    const tryFocus = () => {
      const editor = get();
      if (!editor) return false;

      // Editor is ready, focus it
      focusTimeout = setTimeout(() => {
        if (cancelled) return;
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.focus();

          // Restore cursor position from previous mode if available
          // Note: cursorInfo is captured from closure at mount time
          if (cursorInfo) {
            restoreCursorInProseMirror(view, cursorInfo);
          } else {
            // Default to start of document
            const { state } = view;
            const selection = Selection.atStart(state.doc);
            view.dispatch(state.tr.setSelection(selection).scrollIntoView());
          }
        });
      }, 50);
      return true;
    };

    // Try immediately, then poll if not ready
    if (!tryFocus()) {
      pollInterval = setInterval(() => {
        if (cancelled || tryFocus()) {
          clearInterval(pollInterval);
        }
      }, 50);
    }

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      if (focusTimeout) clearTimeout(focusTimeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external content changes TO the editor
  useEffect(() => {
    const editor = get();
    if (!editor) return;

    // Skip if this change originated from the editor itself
    if (isInternalChange.current) return;

    // Skip if content hasn't changed externally
    if (content === lastExternalContent.current) return;

    // Update editor with external content
    lastExternalContent.current = content;
    editor.action(replaceAll(content));
  }, [content, get]);

  // Handle Paragraph menu events
  useParagraphCommands(get);

  // Handle extended Format menu events (Image, Clear Format)
  useFormatCommands(get);

  // Handle Table menu events
  useTableCommands(get);

  // Handle CJK Format menu events
  useCJKFormatCommands(get);

  // Handle Selection menu events
  useSelectionCommands(get);

  // Handle Tauri file drop events for images
  useImageDrop(get);

  // Handle image context menu actions
  const handleImageContextMenuAction = useImageContextMenu(get);

  // Keep editor focused - refocus when editor loses focus (-style)
  useEffect(() => {
    const editor = get();
    if (!editor) return;

    let blurTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleBlur = () => {
      // Small delay to allow intentional focus changes (e.g., to dialogs)
      blurTimeout = setTimeout(() => {
        const currentEditor = get();
        if (!currentEditor) return;

        currentEditor.action((ctx) => {
          const view = ctx.get(editorViewCtx);

          // Check if focus went to a dialog, input, or interactive element - don't steal focus back
          const activeElement = document.activeElement;
          if (activeElement?.tagName === "INPUT" ||
              activeElement?.tagName === "TEXTAREA" ||
              activeElement?.tagName === "SELECT" ||
              activeElement?.tagName === "BUTTON" ||
              activeElement?.closest("[role='dialog']") ||
              activeElement?.closest("[role='menu']") ||
              activeElement?.closest(".find-bar")) {
            return;
          }

          // Refocus editor and restore selection
          view.focus();
        });
      }, 10);
    };

    // Get the ProseMirror DOM element and add blur listener
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dom.addEventListener("blur", handleBlur);
    });

    return () => {
      if (blurTimeout) clearTimeout(blurTimeout);
      const currentEditor = get();
      if (currentEditor) {
        currentEditor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.dom.removeEventListener("blur", handleBlur);
        });
      }
    };
  }, [get]);

  // Handle Format menu events
  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      // Clean up any existing listeners first
      formatUnlistenRefs.current.forEach((fn) => fn());
      formatUnlistenRefs.current = [];

      if (cancelled) return;

      const unlistenBold = await listen("menu:bold", async () => {
        if (!(await isWindowFocused())) return;
        const editor = get();
        if (editor) {
          editor.action(callCommand(toggleStrongCommand.key));
        }
      });
      if (cancelled) { unlistenBold(); return; }
      formatUnlistenRefs.current.push(unlistenBold);

      const unlistenItalic = await listen("menu:italic", async () => {
        if (!(await isWindowFocused())) return;
        const editor = get();
        if (editor) {
          editor.action(callCommand(toggleEmphasisCommand.key));
        }
      });
      if (cancelled) { unlistenItalic(); return; }
      formatUnlistenRefs.current.push(unlistenItalic);

      const unlistenStrikethrough = await listen("menu:strikethrough", async () => {
        if (!(await isWindowFocused())) return;
        const editor = get();
        if (editor) {
          editor.action(callCommand(toggleStrikethroughCommand.key));
        }
      });
      if (cancelled) { unlistenStrikethrough(); return; }
      formatUnlistenRefs.current.push(unlistenStrikethrough);

      const unlistenCode = await listen("menu:code", async () => {
        if (!(await isWindowFocused())) return;
        const editor = get();
        if (editor) {
          editor.action(callCommand(toggleInlineCodeCommand.key));
        }
      });
      if (cancelled) { unlistenCode(); return; }
      formatUnlistenRefs.current.push(unlistenCode);

      const unlistenLink = await listen("menu:link", async () => {
        if (!(await isWindowFocused())) return;
        const editor = get();
        if (editor) {
          editor.action(callCommand(toggleLinkCommand.key, { href: "" }));
        }
      });
      if (cancelled) { unlistenLink(); return; }
      formatUnlistenRefs.current.push(unlistenLink);
    };

    setupListeners();

    return () => {
      cancelled = true;
      const fns = formatUnlistenRefs.current;
      formatUnlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Milkdown />
      <ImageContextMenu onAction={handleImageContextMenuAction} />
    </>
  );
}

export function Editor() {
  const sourceMode = useEditorStore((state) => state.sourceMode);
  const documentId = useDocumentId();

  // Key ensures editor recreates when document changes (new file, open file, etc.)
  const editorKey = `doc-${documentId}`;

  return (
    <div className="editor-container">
      <div className="editor-content">
        {sourceMode ? (
          <SourceEditor key={editorKey} />
        ) : (
          <MilkdownProvider key={editorKey}>
            <MilkdownEditorInner />
          </MilkdownProvider>
        )}
      </div>
    </div>
  );
}

export default Editor;

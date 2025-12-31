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
import { useSettingsStore } from "@/stores/settingsStore";
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
import { useOutlineSync } from "@/hooks/useOutlineSync";
import { ImageContextMenu } from "./ImageContextMenu";
import { restoreCursorInProseMirror } from "@/utils/cursorSync/prosemirror";
import { overrideKeymapPlugin, cursorSyncPlugin, blankDocFocusPlugin } from "@/plugins/editorPlugins";
import { syntaxRevealPlugin } from "@/plugins/syntaxReveal";
import { linkPopupPlugin } from "@/plugins/linkPopup";
import { imagePopupPlugin } from "@/plugins/imagePopup";
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
import "@/plugins/imagePopup/image-popup.css";
import "@/plugins/alertBlock/alert-block.css";
import "@/plugins/detailsBlock/details-block.css";
import "@/plugins/focusMode/focus-mode.css";
import "@/plugins/typewriterMode/typewriter-mode.css";
import "@/plugins/search/search.css";
import "@/plugins/codePreview/code-preview.css";
import "@/plugins/latex/latex.css";
import "@/plugins/mermaid/mermaid.css";
import "katex/dist/katex.min.css";

// Timing constants for focus behavior
const FOCUS_DELAY_MS = 50;
const BLUR_REFOCUS_DELAY_MS = 10;

// Helper to wait for editor ready, then execute action with optional delay
function whenEditorReady(
  getEditor: () => MilkdownEditor | undefined,
  action: (editor: MilkdownEditor) => void,
  options: { pollMs?: number; delayMs?: number } = {}
): { cancel: () => void } {
  const { pollMs = FOCUS_DELAY_MS, delayMs = 0 } = options;
  let cancelled = false;
  let pollInterval: ReturnType<typeof setInterval> | undefined;
  let actionTimeout: ReturnType<typeof setTimeout> | undefined;

  const tryExecute = () => {
    const editor = getEditor();
    if (!editor) return false;

    // Editor ready - execute action (with optional delay)
    if (delayMs > 0) {
      actionTimeout = setTimeout(() => {
        if (!cancelled) action(editor);
      }, delayMs);
    } else {
      action(editor);
    }
    return true;
  };

  // Try immediately, then poll if not ready
  if (!tryExecute()) {
    pollInterval = setInterval(() => {
      if (cancelled || tryExecute()) {
        if (pollInterval) clearInterval(pollInterval);
      }
    }, pollMs);
  }

  return {
    cancel: () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      if (actionTimeout) clearTimeout(actionTimeout);
    },
  };
}

// Focus editor and restore cursor position
function focusEditorWithCursor(
  editor: MilkdownEditor,
  getCursorInfo: () => ReturnType<typeof useDocumentCursorInfo>
) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.focus();

    const cursorInfo = getCursorInfo();
    if (cursorInfo) {
      restoreCursorInProseMirror(view, cursorInfo);
    } else {
      // Default to start of document
      const { state } = view;
      const selection = Selection.atStart(state.doc);
      view.dispatch(state.tr.setSelection(selection).scrollIntoView());
    }
  });
}

// Helper to create menu command listeners with common pattern
type EditorGetter = () => MilkdownEditor | undefined;

async function createMenuListener(
  event: string,
  getEditor: EditorGetter,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  command: any,
  args?: Record<string, unknown>
): Promise<UnlistenFn> {
  return listen(event, async () => {
    if (!(await isWindowFocused())) return;
    const editor = getEditor();
    if (editor) {
      editor.action(callCommand(command, args));
    }
  });
}

function MilkdownEditorInner() {
  const content = useDocumentContent();
  const cursorInfo = useDocumentCursorInfo();
  const { setContent } = useDocumentActions();

  // Track if content change is from editor (internal) or external (store)
  const isInternalChange = useRef(false);
  // Use empty string to force sync on mount
  const lastExternalContent = useRef<string>("");
  const formatUnlistenRefs = useRef<UnlistenFn[]>([]);
  // Keep latest cursorInfo in ref to avoid stale closure in mount effect
  const cursorInfoRef = useRef(cursorInfo);
  cursorInfoRef.current = cursorInfo;

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
      .use(imagePopupPlugin)
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

  // Auto-focus on mount - wait for editor ready, then focus with cursor restore
  useEffect(() => {
    const handle = whenEditorReady(
      get,
      (editor) => focusEditorWithCursor(editor, () => cursorInfoRef.current),
      { delayMs: FOCUS_DELAY_MS }
    );
    return () => handle.cancel();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external content changes TO the editor
  // Also handles case where editor becomes ready after content is set
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

  // Ensure sync happens when editor first becomes ready
  // This catches the case where content was set before editor initialized
  useEffect(() => {
    const handle = whenEditorReady(get, (editor) => {
      // Sync if content differs from initial and not from internal change
      if (content !== lastExternalContent.current && !isInternalChange.current) {
        lastExternalContent.current = content;
        editor.action(replaceAll(content));
      }
    });
    return () => handle.cancel();
  // Only run on mount to catch late editor initialization
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Sync outline sidebar with cursor position
  useOutlineSync(get);

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

          // Re-check activeElement at refocus time to avoid stale reference
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

          // Only refocus if editor doesn't already have focus
          if (!view.hasFocus()) {
            view.focus();
          }
        });
      }, BLUR_REFOCUS_DELAY_MS);
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

      // Define menu commands to register
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const menuCommands: Array<{ event: string; command: any; args?: Record<string, unknown> }> = [
        { event: "menu:bold", command: toggleStrongCommand.key },
        { event: "menu:italic", command: toggleEmphasisCommand.key },
        { event: "menu:strikethrough", command: toggleStrikethroughCommand.key },
        { event: "menu:code", command: toggleInlineCodeCommand.key },
        { event: "menu:link", command: toggleLinkCommand.key, args: { href: "" } },
      ];

      for (const { event, command, args } of menuCommands) {
        if (cancelled) break;
        const unlisten = await createMenuListener(event, get, command, args);
        if (cancelled) {
          unlisten();
          break;
        }
        formatUnlistenRefs.current.push(unlisten);
      }
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
  const mediaBorderStyle = useSettingsStore((s) => s.markdown.mediaBorderStyle);

  // Key ensures editor recreates when document changes (new file, open file, etc.)
  const editorKey = `doc-${documentId}`;

  // Build class name with media border style
  const containerClass = `editor-container media-border-${mediaBorderStyle}`;

  return (
    <div className={containerClass}>
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

import { useEffect, useRef, useCallback } from "react";
import {
  Editor as MilkdownEditor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  remarkStringifyOptionsCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import {
  gfm,
  remarkGFMPlugin,
  strikethroughInputRule,
} from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { indent } from "@milkdown/kit/plugin/indent";
import { trailing, trailingConfig } from "@milkdown/kit/plugin/trailing";
import { prism, prismConfig } from "@milkdown/plugin-prism";
import { refractor } from "refractor";
import { replaceAll } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
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
import {
  whenEditorReady,
  focusEditorWithCursor,
  isInteractiveElementFocused,
  FOCUS_DELAY_MS,
  BLUR_REFOCUS_DELAY_MS,
} from "./editorUtils";
import { overrideKeymapPlugin, expandedMarkTogglePlugin, cursorSyncPlugin, blankDocFocusPlugin } from "@/plugins/editorPlugins";
import { smartPastePlugin } from "@/plugins/smartPaste";
import { taskTogglePlugin } from "@/plugins/taskToggle";
import { listContinuationPlugin } from "@/plugins/listContinuation";
import { toggleBlockquoteCommand } from "@/plugins/blockquoteToggle";
import { formatToolbarKeymapPlugin, formatToolbarViewPlugin, cursorContextPlugin } from "@/plugins/formatToolbar";
import { cursorAwarePlugin } from "@/plugins/cursorAware";
import { linkPopupPlugin } from "@/plugins/linkPopup";
import { imagePopupPlugin } from "@/plugins/imagePopup";
import { footnotePopupPlugin } from "@/plugins/footnotePopup";
import { tableUIPlugin, tableKeymapPlugin } from "@/plugins/tableUI";
import { alertBlockPlugin } from "@/plugins/alertBlock";
import { detailsBlockPlugin } from "@/plugins/detailsBlock";
import { focusModePlugin } from "@/plugins/focusMode";
import { typewriterModePlugin } from "@/plugins/typewriterMode";
import { searchPlugin } from "@/plugins/search/searchPlugin";
import { spellCheck } from "@/plugins/spellCheck";
import { autoPairPlugin } from "@/plugins/autoPair";
import { imageHandlerPlugin, imageInputRule } from "@/plugins/imageHandler";
import { imageViewPlugin } from "@/plugins/imageView";
import {
  remarkMathPlugin,
  mathInlineSchema,
  mathInlineInputRule,
  mathInlinePlugin,
  mathInlineView,
  mathBlockInputRule,
  mathBlockSchema,
  mathBlockView,
  mathBlockKeymap,
} from "@/plugins/latex";
import {
  mermaidBlockSchema,
  mermaidBlockView,
} from "@/plugins/mermaid";
import { codePreviewPlugin } from "@/plugins/codePreview";
import { slashMenu, configureSlashMenu } from "@/plugins/triggerMenu";
import { subSuperscriptPlugin } from "@/plugins/subSuperscript";
import { highlightPlugin } from "@/plugins/highlight";
import { SourceEditor } from "./SourceEditor";
import { TiptapEditorInner } from "./TiptapEditor";
import "./editor.css";
import "@/plugins/cursorAware/cursor-aware.css";
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
import "@/plugins/tableUI/table-ui.css";
import "@/plugins/subSuperscript/sub-super.css";
import "@/plugins/highlight/highlight.css";
import "@/plugins/formatToolbar/format-toolbar.css";
import "katex/dist/katex.min.css";

function MilkdownEditorInner() {
  const content = useDocumentContent();
  const cursorInfo = useDocumentCursorInfo();
  const { setContent } = useDocumentActions();

  // Track if content change is from editor (internal) or external (store)
  const isInternalChange = useRef(false);
  // Use empty string to force sync on mount
  const lastExternalContent = useRef<string>("");
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
        // Disable single-tilde strikethrough to free ~ for subscript
        ctx.set(remarkGFMPlugin.options.key, { singleTilde: false });
        // Add serialization handlers for subscript/superscript/highlight
        ctx.update(remarkStringifyOptionsCtx, (options) => ({
          ...options,
          handlers: {
            ...options.handlers,
            subscript: (node: { children?: Array<{ value?: string }> }) => {
              const text = node.children?.[0]?.value ?? "";
              return `~${text}~`;
            },
            superscript: (node: { children?: Array<{ value?: string }> }) => {
              const text = node.children?.[0]?.value ?? "";
              return `^${text}^`;
            },
            highlight: (node: { children?: Array<{ value?: string }> }) => {
              const text = node.children?.[0]?.value ?? "";
              return `==${text}==`;
            },
          },
          // Prevent remark-stringify from escaping our custom syntax markers
          unsafe: [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...((options as any).unsafe || []),
            // Don't escape == used for highlight
            { character: "=", after: "=", inConstruct: "phrasing" },
            // Don't escape ~ used for subscript (single tilde)
            { character: "~", inConstruct: "phrasing" },
            // Don't escape ^ used for superscript
            { character: "^", inConstruct: "phrasing" },
          ],
        }));
      })
      .use(overrideKeymapPlugin)
      .use(mathBlockKeymap) // Before commonmark to intercept arrow keys into math blocks
      .use(expandedMarkTogglePlugin)
      .use(listContinuationPlugin) // Before commonmark to override Enter
      .use(commonmark)
      .use(toggleBlockquoteCommand) // Register command for menu handlers
      .use(smartPastePlugin)
      .use(taskTogglePlugin)
      .use(formatToolbarKeymapPlugin)
      .use(formatToolbarViewPlugin)
      .use(cursorContextPlugin)
      // Filter out default strikethrough input rule (accepts single ~)
      .use(gfm.filter((plugin) => plugin !== strikethroughInputRule))
      // Syntax highlighting for code blocks
      .use(prism)
      .config((ctx) => {
        ctx.set(prismConfig.key, {
          configureRefractor: () => refractor,
        });
      })
      // Add subscript/superscript plugin
      .use(subSuperscriptPlugin.flat())
      // Add highlight plugin
      .use(highlightPlugin.flat())
      .use(tableUIPlugin)
      .use(tableKeymapPlugin)
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
      .config((ctx) => {
        // Exclude footnote_definition from triggering trailing paragraph insertion
        // This prevents <br /> appearing after footnotes in Source mode
        ctx.set(trailingConfig.key, {
          shouldAppend: (lastNode) => {
            if (!lastNode) return false;
            const excludeTypes = ["heading", "paragraph", "footnote_definition"];
            return !excludeTypes.includes(lastNode.type.name);
          },
          getNode: (state) => state.schema.nodes.paragraph!.create(),
        });
      })
      .use(cursorSyncPlugin)
      .use(blankDocFocusPlugin)
      .use(cursorAwarePlugin)
      .use(linkPopupPlugin)
      .use(imagePopupPlugin)
      .use(footnotePopupPlugin)
      .use(focusModePlugin)
      .use(typewriterModePlugin)
      .use(searchPlugin)
      .use(spellCheck)
      .use(autoPairPlugin)
      .use(remarkMathPlugin)
      .use(mathInlineSchema)
      .use(mathInlineInputRule)
      .use(mathInlinePlugin)
      .use(mathInlineView)
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
  useEffect(() => {
    const editor = get();
    if (!editor) return;
    if (isInternalChange.current) return;
    if (content === lastExternalContent.current) return;

    lastExternalContent.current = content;
    editor.action(replaceAll(content));
  }, [content, get]);

  // Ensure sync happens when editor first becomes ready
  useEffect(() => {
    const handle = whenEditorReady(get, (editor) => {
      if (content !== lastExternalContent.current && !isInternalChange.current) {
        lastExternalContent.current = content;
        editor.action(replaceAll(content));
      }
    });
    return () => handle.cancel();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle menu commands
  useParagraphCommands(get);
  useFormatCommands(get);
  useTableCommands(get);
  useCJKFormatCommands(get);
  useSelectionCommands(get);
  useImageDrop(get);
  useOutlineSync(get);
  const handleImageContextMenuAction = useImageContextMenu(get);

  // Keep editor focused - refocus when editor loses focus (-style)
  useEffect(() => {
    const editor = get();
    if (!editor) return;

    let blurTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleBlur = () => {
      blurTimeout = setTimeout(() => {
        const currentEditor = get();
        if (!currentEditor) return;

        currentEditor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          if (!isInteractiveElementFocused() && !view.hasFocus()) {
            view.focus();
          }
        });
      }, BLUR_REFOCUS_DELAY_MS);
    };

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

  const editorKey = `doc-${documentId}`;
  const containerClass = `editor-container media-border-${mediaBorderStyle}`;
  const useTiptapWysiwyg = (import.meta.env.VITE_WYSIWYG_ENGINE ?? "tiptap") === "tiptap";

  return (
    <div className={containerClass}>
      <div className="editor-content">
        {sourceMode ? (
          <SourceEditor key={editorKey} />
        ) : useTiptapWysiwyg ? (
          <TiptapEditorInner key={editorKey} />
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

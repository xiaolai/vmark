import { useEffect, useRef, useCallback } from "react";
import {
  Editor as MilkdownEditor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
} from "@milkdown/kit/core";
import { Selection, Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
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
import { useEditorStore } from "@/stores/editorStore";
import { useParagraphCommands } from "@/hooks/useParagraphCommands";
import { useFormatCommands } from "@/hooks/useFormatCommands";
import { useTableCommands } from "@/hooks/useTableCommands";
import {
  getCursorInfoFromProseMirror,
  restoreCursorInProseMirror,
} from "@/utils/cursorSync/prosemirror";
import { syntaxRevealPlugin } from "@/plugins/syntaxReveal";
import { alertBlockPlugin } from "@/plugins/alertBlock";
import { detailsBlockPlugin } from "@/plugins/detailsBlock";
import { SourceEditor } from "./SourceEditor";
import "./editor.css";
import "@/plugins/syntaxReveal/syntax-reveal.css";
import "@/plugins/alertBlock/alert-block.css";
import "@/plugins/detailsBlock/details-block.css";

// Plugin key for cursor tracking
const cursorSyncPluginKey = new PluginKey("cursorSync");


function MilkdownEditorInner() {
  const content = useEditorStore((state) => state.content);

  // Track if content change is from editor (internal) or external (store)
  const isInternalChange = useRef(false);
  // Use empty string to force sync on mount
  const lastExternalContent = useRef<string>("");
  const formatUnlistenRefs = useRef<UnlistenFn[]>([]);

  const handleMarkdownUpdate = useCallback((_: unknown, markdown: string) => {
    isInternalChange.current = true;
    useEditorStore.getState().setContent(markdown);
    // Reset flag after state update propagates
    requestAnimationFrame(() => {
      isInternalChange.current = false;
    });
  }, []);

  // ProseMirror plugin to track cursor position for mode sync
  const cursorSyncPlugin = $prose(() => {
    let trackingEnabled = false;
    // Delay tracking to allow cursor restoration to complete first
    setTimeout(() => {
      trackingEnabled = true;
    }, 200);

    return new Plugin({
      key: cursorSyncPluginKey,
      view: () => ({
        update: (view, prevState) => {
          // Skip tracking until restoration is complete
          if (!trackingEnabled) return;
          // Track selection changes
          if (!view.state.selection.eq(prevState.selection)) {
            const cursorInfo = getCursorInfoFromProseMirror(view);
            useEditorStore.getState().setCursorInfo(cursorInfo);
          }
        },
      }),
    });
  });

  const { get } = useEditor((root) =>
    MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, content);
      })
      .use(commonmark)
      .use(gfm)
      .use(alertBlockPlugin.flat())
      .use(detailsBlockPlugin.flat())
      .use(history)
      .use(clipboard)
      .use(listener)
      .use(cursor)
      .use(indent)
      .use(trailing)
      .use(cursorSyncPlugin)
      .use(syntaxRevealPlugin)
      .config((ctx) => {
        // Configure listener AFTER the plugin is loaded
        ctx.get(listenerCtx).markdownUpdated(handleMarkdownUpdate);
      })
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
          const cursorInfo = useEditorStore.getState().cursorInfo;
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

  // Handle Format menu events
  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      // Clean up any existing listeners first
      formatUnlistenRefs.current.forEach((fn) => fn());
      formatUnlistenRefs.current = [];

      if (cancelled) return;

      const unlistenBold = await listen("menu:bold", () => {
        const editor = get();
        if (editor) {
          editor.action(callCommand(toggleStrongCommand.key));
        }
      });
      if (cancelled) { unlistenBold(); return; }
      formatUnlistenRefs.current.push(unlistenBold);

      const unlistenItalic = await listen("menu:italic", () => {
        const editor = get();
        if (editor) {
          editor.action(callCommand(toggleEmphasisCommand.key));
        }
      });
      if (cancelled) { unlistenItalic(); return; }
      formatUnlistenRefs.current.push(unlistenItalic);

      const unlistenStrikethrough = await listen("menu:strikethrough", () => {
        const editor = get();
        if (editor) {
          editor.action(callCommand(toggleStrikethroughCommand.key));
        }
      });
      if (cancelled) { unlistenStrikethrough(); return; }
      formatUnlistenRefs.current.push(unlistenStrikethrough);

      const unlistenCode = await listen("menu:code", () => {
        const editor = get();
        if (editor) {
          editor.action(callCommand(toggleInlineCodeCommand.key));
        }
      });
      if (cancelled) { unlistenCode(); return; }
      formatUnlistenRefs.current.push(unlistenCode);

      const unlistenLink = await listen("menu:link", () => {
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

  return <Milkdown />;
}

export function Editor() {
  const sourceMode = useEditorStore((state) => state.sourceMode);
  const documentId = useEditorStore((state) => state.documentId);

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

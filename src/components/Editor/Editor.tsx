import { useEffect, useRef, useCallback } from "react";
import {
  Editor as MilkdownEditor,
  rootCtx,
  defaultValueCtx,
} from "@milkdown/kit/core";
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
import { SourceEditor } from "./SourceEditor";
import "./editor.css";

const DEFAULT_CONTENT = `# Welcome to VMark

A **-style** markdown editor built with:

- [Tauri](https://tauri.app) - Desktop framework
- [Milkdown](https://milkdown.dev) - WYSIWYG editor
- [React](https://react.dev) - UI framework

## Features

- Seamless WYSIWYG editing
- Focus mode
- Typewriter mode
- File management

Start writing...
`;

function MilkdownEditorInner() {
  const content = useEditorStore((state) => state.content);
  const filePath = useEditorStore((state) => state.filePath);

  // Compute initial content once
  const initialContent = filePath !== null || content.length > 0
    ? content
    : DEFAULT_CONTENT;

  // Track if content change is from editor (internal) or external (store)
  const isInternalChange = useRef(false);
  const lastExternalContent = useRef<string>(initialContent);
  const formatUnlistenRefs = useRef<UnlistenFn[]>([]);

  const handleMarkdownUpdate = useCallback((_: unknown, markdown: string) => {
    isInternalChange.current = true;
    useEditorStore.getState().setContent(markdown);
    // Reset flag after state update propagates
    requestAnimationFrame(() => {
      isInternalChange.current = false;
    });
  }, []);

  const { get } = useEditor((root) =>
    MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialContent);
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(listener)
      .use(cursor)
      .use(indent)
      .use(trailing)
      .config((ctx) => {
        // Configure listener AFTER the plugin is loaded
        ctx.get(listenerCtx).markdownUpdated(handleMarkdownUpdate);
      })
  );

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

  return (
    <div className="editor-container">
      <div className="editor-content">
        {sourceMode ? (
          <SourceEditor />
        ) : (
          <MilkdownProvider>
            <MilkdownEditorInner />
          </MilkdownProvider>
        )}
      </div>
    </div>
  );
}

export default Editor;

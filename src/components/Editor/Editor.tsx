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
import { listen } from "@tauri-apps/api/event";
import { useEditorStore } from "@/stores/editorStore";
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

  // Track if content change is from editor (internal) or external (store)
  const isInternalChange = useRef(false);
  const lastExternalContent = useRef<string | null>(null);

  const handleMarkdownUpdate = useCallback((_: unknown, markdown: string) => {
    isInternalChange.current = true;
    useEditorStore.getState().setContent(markdown);
    // Reset flag after state update propagates
    requestAnimationFrame(() => {
      isInternalChange.current = false;
    });
  }, []);

  const initialContent = filePath !== null || content.length > 0
    ? content
    : DEFAULT_CONTENT;

  // Store initial content reference
  if (lastExternalContent.current === null) {
    lastExternalContent.current = initialContent;
  }

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

  // Handle Format menu events
  useEffect(() => {
    const unlisten: Promise<() => void>[] = [];

    unlisten.push(
      listen("menu:bold", () => {
        const editor = get();
        if (editor) {
          editor.action(callCommand(toggleStrongCommand.key));
        }
      })
    );

    unlisten.push(
      listen("menu:italic", () => {
        const editor = get();
        if (editor) {
          editor.action(callCommand(toggleEmphasisCommand.key));
        }
      })
    );

    unlisten.push(
      listen("menu:strikethrough", () => {
        const editor = get();
        if (editor) {
          editor.action(callCommand(toggleStrikethroughCommand.key));
        }
      })
    );

    unlisten.push(
      listen("menu:code", () => {
        const editor = get();
        if (editor) {
          editor.action(callCommand(toggleInlineCodeCommand.key));
        }
      })
    );

    unlisten.push(
      listen("menu:link", () => {
        const editor = get();
        if (editor) {
          editor.action(callCommand(toggleLinkCommand.key, { href: "" }));
        }
      })
    );

    return () => {
      Promise.all(unlisten).then((fns) => fns.forEach((fn) => fn()));
    };
  }, [get]);

  return <Milkdown />;
}

export function Editor() {
  return (
    <div className="editor-container">
      <div className="editor-content">
        <MilkdownProvider>
          <MilkdownEditorInner />
        </MilkdownProvider>
      </div>
    </div>
  );
}

export default Editor;

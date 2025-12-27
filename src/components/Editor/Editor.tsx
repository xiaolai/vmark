import { useCallback } from "react";
import { Editor as MilkdownEditor, rootCtx, defaultValueCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
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

  const handleMarkdownUpdate = useCallback((_: unknown, markdown: string) => {
    useEditorStore.getState().setContent(markdown);
  }, []);

  const initialContent = filePath !== null || content.length > 0
    ? content
    : DEFAULT_CONTENT;

  useEditor((root) =>
    MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialContent);
        ctx.get(listenerCtx).markdownUpdated(handleMarkdownUpdate);
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(listener)
  );

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

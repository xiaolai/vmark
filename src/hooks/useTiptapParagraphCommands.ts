import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { liftListItem, sinkListItem } from "@tiptap/pm/schema-list";
import { isWindowFocused } from "@/utils/windowFocus";

function getCurrentHeadingLevel(editor: TiptapEditor): number | null {
  const { $from } = editor.state.selection;
  const parent = $from.parent;
  if (parent.type.name === "heading") {
    return parent.attrs.level as number;
  }
  return null;
}

export function useTiptapParagraphCommands(editor: TiptapEditor | null) {
  const editorRef = useRef<TiptapEditor | null>(null);
  editorRef.current = editor;

  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      for (let level = 1; level <= 6; level++) {
        if (cancelled) break;
        const unlisten = await listen(`menu:heading-${level}`, async () => {
          if (!(await isWindowFocused())) return;
          const editor = editorRef.current;
          if (!editor) return;
          editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
        });
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenRefs.current.push(unlisten);
      }

      const unlistenParagraph = await listen("menu:paragraph", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().setParagraph().run();
      });
      if (cancelled) {
        unlistenParagraph();
        return;
      }
      unlistenRefs.current.push(unlistenParagraph);

      const unlistenIncreaseHeading = await listen("menu:increase-heading", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;

        const currentLevel = getCurrentHeadingLevel(editor);
        if (currentLevel === null) {
          editor.chain().focus().setHeading({ level: 6 }).run();
        } else if (currentLevel > 1) {
          editor.chain().focus().setHeading({ level: (currentLevel - 1) as 1 | 2 | 3 | 4 | 5 }).run();
        }
      });
      if (cancelled) {
        unlistenIncreaseHeading();
        return;
      }
      unlistenRefs.current.push(unlistenIncreaseHeading);

      const unlistenDecreaseHeading = await listen("menu:decrease-heading", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;

        const currentLevel = getCurrentHeadingLevel(editor);
        if (currentLevel === null) return;
        if (currentLevel < 6) {
          editor.chain().focus().setHeading({ level: (currentLevel + 1) as 2 | 3 | 4 | 5 | 6 }).run();
        } else {
          editor.chain().focus().setParagraph().run();
        }
      });
      if (cancelled) {
        unlistenDecreaseHeading();
        return;
      }
      unlistenRefs.current.push(unlistenDecreaseHeading);

      const unlistenQuote = await listen("menu:quote", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().toggleBlockquote().run();
      });
      if (cancelled) {
        unlistenQuote();
        return;
      }
      unlistenRefs.current.push(unlistenQuote);

      const unlistenCodeFences = await listen("menu:code-fences", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().setCodeBlock().run();
      });
      if (cancelled) {
        unlistenCodeFences();
        return;
      }
      unlistenRefs.current.push(unlistenCodeFences);

      const unlistenOrderedList = await listen("menu:ordered-list", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().toggleOrderedList().run();
      });
      if (cancelled) {
        unlistenOrderedList();
        return;
      }
      unlistenRefs.current.push(unlistenOrderedList);

      const unlistenUnorderedList = await listen("menu:unordered-list", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().toggleBulletList().run();
      });
      if (cancelled) {
        unlistenUnorderedList();
        return;
      }
      unlistenRefs.current.push(unlistenUnorderedList);

      const unlistenTaskList = await listen("menu:task-list", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().toggleBulletList().run();
      });
      if (cancelled) {
        unlistenTaskList();
        return;
      }
      unlistenRefs.current.push(unlistenTaskList);

      const unlistenIndent = await listen("menu:indent", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;

        const listItemType = editor.state.schema.nodes.listItem;
        if (!listItemType) return;
        editor.commands.focus();
        sinkListItem(listItemType)(editor.state, editor.view.dispatch);
      });
      if (cancelled) {
        unlistenIndent();
        return;
      }
      unlistenRefs.current.push(unlistenIndent);

      const unlistenOutdent = await listen("menu:outdent", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;

        const listItemType = editor.state.schema.nodes.listItem;
        if (!listItemType) return;
        editor.commands.focus();
        liftListItem(listItemType)(editor.state, editor.view.dispatch);
      });
      if (cancelled) {
        unlistenOutdent();
        return;
      }
      unlistenRefs.current.push(unlistenOutdent);

      const unlistenHorizontalLine = await listen("menu:horizontal-line", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().setHorizontalRule().run();
      });
      if (cancelled) {
        unlistenHorizontalLine();
        return;
      }
      unlistenRefs.current.push(unlistenHorizontalLine);
    };

    setupListeners();

    return () => {
      cancelled = true;
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  }, []);
}

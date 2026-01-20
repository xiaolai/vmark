import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { liftListItem, sinkListItem } from "@tiptap/pm/schema-list";
import type { EditorView } from "@tiptap/pm/view";
import { ALERT_TYPES, type AlertType } from "@/plugins/alertBlock/tiptap";
import { insertFootnoteAndOpenPopup } from "@/plugins/footnotePopup/tiptapInsertFootnote";
import { handleBlockquoteNest, handleBlockquoteUnnest, handleRemoveList } from "@/plugins/formatToolbar/nodeActions.tiptap";
import { toggleTaskList } from "@/plugins/taskToggle/tiptapTaskListUtils";
import { isTerminalFocused } from "@/utils/focus";

const DEFAULT_MATH_BLOCK = "c = \\pm\\sqrt{a^2 + b^2}";

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

      // Get current window for filtering - menu events include target window label
      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      for (let level = 1; level <= 6; level++) {
        if (cancelled) break;
        const unlisten = await currentWindow.listen<string>(`menu:heading-${level}`, (event) => {
          if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
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

      const unlistenParagraph = await currentWindow.listen<string>("menu:paragraph", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().setParagraph().run();
      });
      if (cancelled) {
        unlistenParagraph();
        return;
      }
      unlistenRefs.current.push(unlistenParagraph);

      const unlistenIncreaseHeading = await currentWindow.listen<string>("menu:increase-heading", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
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

      const unlistenDecreaseHeading = await currentWindow.listen<string>("menu:decrease-heading", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
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

      const unlistenQuote = await currentWindow.listen<string>("menu:quote", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().toggleBlockquote().run();
      });
      if (cancelled) {
        unlistenQuote();
        return;
      }
      unlistenRefs.current.push(unlistenQuote);

      const unlistenCodeFences = await currentWindow.listen<string>("menu:code-fences", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().setCodeBlock().run();
      });
      if (cancelled) {
        unlistenCodeFences();
        return;
      }
      unlistenRefs.current.push(unlistenCodeFences);

      const unlistenOrderedList = await currentWindow.listen<string>("menu:ordered-list", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().toggleOrderedList().run();
      });
      if (cancelled) {
        unlistenOrderedList();
        return;
      }
      unlistenRefs.current.push(unlistenOrderedList);

      const unlistenUnorderedList = await currentWindow.listen<string>("menu:unordered-list", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().toggleBulletList().run();
      });
      if (cancelled) {
        unlistenUnorderedList();
        return;
      }
      unlistenRefs.current.push(unlistenUnorderedList);

      const unlistenTaskList = await currentWindow.listen<string>("menu:task-list", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        toggleTaskList(editor);
      });
      if (cancelled) {
        unlistenTaskList();
        return;
      }
      unlistenRefs.current.push(unlistenTaskList);

      const unlistenIndent = await currentWindow.listen<string>("menu:indent", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
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

      const unlistenOutdent = await currentWindow.listen<string>("menu:outdent", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
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

      const unlistenHorizontalLine = await currentWindow.listen<string>("menu:horizontal-line", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().setHorizontalRule().run();
      });
      if (cancelled) {
        unlistenHorizontalLine();
        return;
      }
      unlistenRefs.current.push(unlistenHorizontalLine);

      // Info Boxes (Alert Blocks)
      for (const alertType of ALERT_TYPES) {
        if (cancelled) break;
        const unlisten = await currentWindow.listen<string>(`menu:info-${alertType.toLowerCase()}`, (event) => {
          if (event.payload !== windowLabel) return;
          const editor = editorRef.current;
          if (!editor) return;
          editor.commands.insertAlertBlock(alertType as AlertType);
        });
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenRefs.current.push(unlisten);
      }

      // Collapsible Block (Details)
      const unlistenCollapsible = await currentWindow.listen<string>("menu:collapsible-block", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.commands.insertDetailsBlock();
      });
      if (cancelled) {
        unlistenCollapsible();
        return;
      }
      unlistenRefs.current.push(unlistenCollapsible);

      // Nest Quote (inside blockquote)
      const unlistenNestQuote = await currentWindow.listen<string>("menu:nest-quote", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        handleBlockquoteNest(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenNestQuote();
        return;
      }
      unlistenRefs.current.push(unlistenNestQuote);

      // Unnest Quote (inside blockquote)
      const unlistenUnnestQuote = await currentWindow.listen<string>("menu:unnest-quote", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        handleBlockquoteUnnest(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenUnnestQuote();
        return;
      }
      unlistenRefs.current.push(unlistenUnnestQuote);

      // Remove List
      const unlistenRemoveList = await currentWindow.listen<string>("menu:remove-list", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        handleRemoveList(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenRemoveList();
        return;
      }
      unlistenRefs.current.push(unlistenRemoveList);

      // Math Block
      const unlistenMathBlock = await currentWindow.listen<string>("menu:math-block", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor
          .chain()
          .focus()
          .insertContent({
            type: "codeBlock",
            attrs: { language: "latex" },
            content: [{ type: "text", text: DEFAULT_MATH_BLOCK }],
          })
          .run();
      });
      if (cancelled) {
        unlistenMathBlock();
        return;
      }
      unlistenRefs.current.push(unlistenMathBlock);

      // Footnote
      const unlistenFootnote = await currentWindow.listen<string>("menu:footnote", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        insertFootnoteAndOpenPopup(editor);
      });
      if (cancelled) {
        unlistenFootnote();
        return;
      }
      unlistenRefs.current.push(unlistenFootnote);
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

import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { liftListItem, sinkListItem } from "@tiptap/pm/schema-list";
import { ALERT_TYPES, type AlertType } from "@/plugins/alertBlock/tiptap";
import { insertFootnoteAndOpenPopup } from "@/plugins/footnotePopup/tiptapInsertFootnote";
import { handleBlockquoteNest, handleBlockquoteUnnest, handleRemoveList } from "@/plugins/formatToolbar/nodeActions.tiptap";
import { toggleTaskList } from "@/plugins/taskToggle/tiptapTaskListUtils";
import { getEditorView } from "@/types/tiptap";
import { registerMenuListener } from "@/utils/menuListenerHelper";

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
      const cancelledRef = { current: false };

      // Update cancelledRef when cancelled changes
      const checkCancelled = () => { cancelledRef.current = cancelled; };
      checkCancelled();

      const ctx = { currentWindow, windowLabel, editorRef, unlistenRefs, cancelledRef };
      const register = (eventName: string, handler: (editor: TiptapEditor) => void) =>
        registerMenuListener(ctx, eventName, handler);

      // Headings 1-6
      for (let level = 1; level <= 6; level++) {
        if (cancelled) break;
        const ok = await register(`menu:heading-${level}`, (editor) => {
          editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
        });
        if (!ok) return;
      }

      if (!(await register("menu:paragraph", (editor) => {
        editor.chain().focus().setParagraph().run();
      }))) return;

      if (!(await register("menu:increase-heading", (editor) => {
        const currentLevel = getCurrentHeadingLevel(editor);
        if (currentLevel === null) {
          editor.chain().focus().setHeading({ level: 6 }).run();
        } else if (currentLevel > 1) {
          editor.chain().focus().setHeading({ level: (currentLevel - 1) as 1 | 2 | 3 | 4 | 5 }).run();
        }
      }))) return;

      if (!(await register("menu:decrease-heading", (editor) => {
        const currentLevel = getCurrentHeadingLevel(editor);
        if (currentLevel === null) return;
        if (currentLevel < 6) {
          editor.chain().focus().setHeading({ level: (currentLevel + 1) as 2 | 3 | 4 | 5 | 6 }).run();
        } else {
          editor.chain().focus().setParagraph().run();
        }
      }))) return;

      if (!(await register("menu:quote", (editor) => {
        editor.chain().focus().toggleBlockquote().run();
      }))) return;

      if (!(await register("menu:code-fences", (editor) => {
        editor.chain().focus().setCodeBlock().run();
      }))) return;

      if (!(await register("menu:ordered-list", (editor) => {
        editor.chain().focus().toggleOrderedList().run();
      }))) return;

      if (!(await register("menu:unordered-list", (editor) => {
        editor.chain().focus().toggleBulletList().run();
      }))) return;

      if (!(await register("menu:task-list", (editor) => {
        toggleTaskList(editor);
      }))) return;

      if (!(await register("menu:indent", (editor) => {
        const listItemType = editor.state.schema.nodes.listItem;
        if (!listItemType) return;
        editor.commands.focus();
        sinkListItem(listItemType)(editor.state, editor.view.dispatch);
      }))) return;

      if (!(await register("menu:outdent", (editor) => {
        const listItemType = editor.state.schema.nodes.listItem;
        if (!listItemType) return;
        editor.commands.focus();
        liftListItem(listItemType)(editor.state, editor.view.dispatch);
      }))) return;

      if (!(await register("menu:horizontal-line", (editor) => {
        editor.chain().focus().setHorizontalRule().run();
      }))) return;

      // Info Boxes (Alert Blocks)
      for (const alertType of ALERT_TYPES) {
        if (cancelled) break;
        const ok = await register(`menu:info-${alertType.toLowerCase()}`, (editor) => {
          editor.commands.insertAlertBlock(alertType as AlertType);
        });
        if (!ok) return;
      }

      if (!(await register("menu:collapsible-block", (editor) => {
        editor.commands.insertDetailsBlock();
      }))) return;

      if (!(await register("menu:nest-quote", (editor) => {
        handleBlockquoteNest(getEditorView(editor));
      }))) return;

      if (!(await register("menu:unnest-quote", (editor) => {
        handleBlockquoteUnnest(getEditorView(editor));
      }))) return;

      if (!(await register("menu:remove-list", (editor) => {
        handleRemoveList(getEditorView(editor));
      }))) return;

      if (!(await register("menu:math-block", (editor) => {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "codeBlock",
            attrs: { language: "latex" },
            content: [{ type: "text", text: DEFAULT_MATH_BLOCK }],
          })
          .run();
      }))) return;

      if (!(await register("menu:footnote", (editor) => {
        insertFootnoteAndOpenPopup(editor);
      }))) return;
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

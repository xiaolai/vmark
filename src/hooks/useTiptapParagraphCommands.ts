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

      // Helper to reduce boilerplate for menu event listeners
      const createListener = async (
        eventName: string,
        handler: (editor: TiptapEditor) => void
      ): Promise<UnlistenFn | null> => {
        const unlisten = await currentWindow.listen<string>(eventName, (event) => {
          if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
          const editor = editorRef.current;
          if (!editor) return;
          handler(editor);
        });
        if (cancelled) {
          unlisten();
          return null;
        }
        return unlisten;
      };

      // Helper to register listener and handle cancellation
      const registerListener = async (
        eventName: string,
        handler: (editor: TiptapEditor) => void
      ): Promise<boolean> => {
        const unlisten = await createListener(eventName, handler);
        if (!unlisten) return false;
        unlistenRefs.current.push(unlisten);
        return true;
      };

      // Headings 1-6
      for (let level = 1; level <= 6; level++) {
        if (cancelled) break;
        const ok = await registerListener(`menu:heading-${level}`, (editor) => {
          editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
        });
        if (!ok) return;
      }

      if (!(await registerListener("menu:paragraph", (editor) => {
        editor.chain().focus().setParagraph().run();
      }))) return;

      if (!(await registerListener("menu:increase-heading", (editor) => {
        const currentLevel = getCurrentHeadingLevel(editor);
        if (currentLevel === null) {
          editor.chain().focus().setHeading({ level: 6 }).run();
        } else if (currentLevel > 1) {
          editor.chain().focus().setHeading({ level: (currentLevel - 1) as 1 | 2 | 3 | 4 | 5 }).run();
        }
      }))) return;

      if (!(await registerListener("menu:decrease-heading", (editor) => {
        const currentLevel = getCurrentHeadingLevel(editor);
        if (currentLevel === null) return;
        if (currentLevel < 6) {
          editor.chain().focus().setHeading({ level: (currentLevel + 1) as 2 | 3 | 4 | 5 | 6 }).run();
        } else {
          editor.chain().focus().setParagraph().run();
        }
      }))) return;

      if (!(await registerListener("menu:quote", (editor) => {
        editor.chain().focus().toggleBlockquote().run();
      }))) return;

      if (!(await registerListener("menu:code-fences", (editor) => {
        editor.chain().focus().setCodeBlock().run();
      }))) return;

      if (!(await registerListener("menu:ordered-list", (editor) => {
        editor.chain().focus().toggleOrderedList().run();
      }))) return;

      if (!(await registerListener("menu:unordered-list", (editor) => {
        editor.chain().focus().toggleBulletList().run();
      }))) return;

      if (!(await registerListener("menu:task-list", (editor) => {
        toggleTaskList(editor);
      }))) return;

      if (!(await registerListener("menu:indent", (editor) => {
        const listItemType = editor.state.schema.nodes.listItem;
        if (!listItemType) return;
        editor.commands.focus();
        sinkListItem(listItemType)(editor.state, editor.view.dispatch);
      }))) return;

      if (!(await registerListener("menu:outdent", (editor) => {
        const listItemType = editor.state.schema.nodes.listItem;
        if (!listItemType) return;
        editor.commands.focus();
        liftListItem(listItemType)(editor.state, editor.view.dispatch);
      }))) return;

      if (!(await registerListener("menu:horizontal-line", (editor) => {
        editor.chain().focus().setHorizontalRule().run();
      }))) return;

      // Info Boxes (Alert Blocks)
      for (const alertType of ALERT_TYPES) {
        if (cancelled) break;
        const ok = await registerListener(`menu:info-${alertType.toLowerCase()}`, (editor) => {
          editor.commands.insertAlertBlock(alertType as AlertType);
        });
        if (!ok) return;
      }

      if (!(await registerListener("menu:collapsible-block", (editor) => {
        editor.commands.insertDetailsBlock();
      }))) return;

      if (!(await registerListener("menu:nest-quote", (editor) => {
        handleBlockquoteNest(editor.view as unknown as EditorView);
      }))) return;

      if (!(await registerListener("menu:unnest-quote", (editor) => {
        handleBlockquoteUnnest(editor.view as unknown as EditorView);
      }))) return;

      if (!(await registerListener("menu:remove-list", (editor) => {
        handleRemoveList(editor.view as unknown as EditorView);
      }))) return;

      if (!(await registerListener("menu:math-block", (editor) => {
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

      if (!(await registerListener("menu:footnote", (editor) => {
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

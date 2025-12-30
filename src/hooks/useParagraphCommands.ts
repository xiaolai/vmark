import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { callCommand } from "@milkdown/kit/utils";
import {
  wrapInHeadingCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  sinkListItemCommand,
  liftListItemCommand,
  insertHrCommand,
} from "@milkdown/kit/preset/commonmark";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import {
  insertAlertBlockCommand,
  type AlertType,
} from "@/plugins/alertBlock";
import { insertDetailsBlockCommand } from "@/plugins/detailsBlock";
import { isWindowFocused } from "@/utils/windowFocus";

type GetEditor = () => Editor | undefined;

function getCurrentHeadingLevel(editor: Editor): number | null {
  let level: number | null = null;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    if (!view) return;
    const { state } = view;
    const { $from } = state.selection;
    const parent = $from.parent;
    if (parent.type.name === "heading") {
      level = parent.attrs.level as number;
    }
  });
  return level;
}

export function useParagraphCommands(getEditor: GetEditor) {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      // Clean up any existing listeners first
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      // Heading commands (Cmd+1 through Cmd+6)
      for (let level = 1; level <= 6; level++) {
        if (cancelled) break;
        const unlisten = await listen(`menu:heading-${level}`, async () => {
          if (!(await isWindowFocused())) return;
          const editor = getEditor();
          if (editor) {
            editor.action(callCommand(wrapInHeadingCommand.key, level));
          }
        });
        if (cancelled) { unlisten(); return; }
        unlistenRefs.current.push(unlisten);
      }

      if (cancelled) return;

      // Paragraph (turn into text)
      const unlistenParagraph = await listen("menu:paragraph", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(turnIntoTextCommand.key));
        }
      });
      if (cancelled) { unlistenParagraph(); return; }
      unlistenRefs.current.push(unlistenParagraph);

      // Increase heading level (H3 -> H2 -> H1, or paragraph -> H6)
      const unlistenIncreaseHeading = await listen("menu:increase-heading", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          const currentLevel = getCurrentHeadingLevel(editor);
          if (currentLevel === null) {
            editor.action(callCommand(wrapInHeadingCommand.key, 6));
          } else if (currentLevel > 1) {
            editor.action(callCommand(wrapInHeadingCommand.key, currentLevel - 1));
          }
        }
      });
      if (cancelled) { unlistenIncreaseHeading(); return; }
      unlistenRefs.current.push(unlistenIncreaseHeading);

      // Decrease heading level (H1 -> H2 -> H3, or H6 -> paragraph)
      const unlistenDecreaseHeading = await listen("menu:decrease-heading", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          const currentLevel = getCurrentHeadingLevel(editor);
          if (currentLevel === null) {
            return;
          } else if (currentLevel < 6) {
            editor.action(callCommand(wrapInHeadingCommand.key, currentLevel + 1));
          } else {
            editor.action(callCommand(turnIntoTextCommand.key));
          }
        }
      });
      if (cancelled) { unlistenDecreaseHeading(); return; }
      unlistenRefs.current.push(unlistenDecreaseHeading);

      // Quote
      const unlistenQuote = await listen("menu:quote", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(wrapInBlockquoteCommand.key));
        }
      });
      if (cancelled) { unlistenQuote(); return; }
      unlistenRefs.current.push(unlistenQuote);

      // Code Fences
      const unlistenCodeFences = await listen("menu:code-fences", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(createCodeBlockCommand.key));
        }
      });
      if (cancelled) { unlistenCodeFences(); return; }
      unlistenRefs.current.push(unlistenCodeFences);

      // Ordered List
      const unlistenOrderedList = await listen("menu:ordered-list", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(wrapInOrderedListCommand.key));
        }
      });
      if (cancelled) { unlistenOrderedList(); return; }
      unlistenRefs.current.push(unlistenOrderedList);

      // Unordered List
      const unlistenUnorderedList = await listen("menu:unordered-list", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(wrapInBulletListCommand.key));
        }
      });
      if (cancelled) { unlistenUnorderedList(); return; }
      unlistenRefs.current.push(unlistenUnorderedList);

      // Task List
      const unlistenTaskList = await listen("menu:task-list", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(wrapInBulletListCommand.key));
        }
      });
      if (cancelled) { unlistenTaskList(); return; }
      unlistenRefs.current.push(unlistenTaskList);

      // Indent (sink list item)
      const unlistenIndent = await listen("menu:indent", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(sinkListItemCommand.key));
        }
      });
      if (cancelled) { unlistenIndent(); return; }
      unlistenRefs.current.push(unlistenIndent);

      // Outdent (lift list item)
      const unlistenOutdent = await listen("menu:outdent", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(liftListItemCommand.key));
        }
      });
      if (cancelled) { unlistenOutdent(); return; }
      unlistenRefs.current.push(unlistenOutdent);

      // Horizontal Line
      const unlistenHorizontalLine = await listen("menu:horizontal-line", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(insertHrCommand.key));
        }
      });
      if (cancelled) { unlistenHorizontalLine(); return; }
      unlistenRefs.current.push(unlistenHorizontalLine);

      // Info Boxes (Alert Blocks)
      const alertTypes: AlertType[] = [
        "NOTE",
        "TIP",
        "IMPORTANT",
        "WARNING",
        "CAUTION",
      ];
      for (const alertType of alertTypes) {
        if (cancelled) break;
        const unlisten = await listen(
          `menu:info-${alertType.toLowerCase()}`,
          async () => {
            if (!(await isWindowFocused())) return;
            const editor = getEditor();
            if (editor) {
              editor.action(callCommand(insertAlertBlockCommand.key, alertType));
            }
          }
        );
        if (cancelled) { unlisten(); return; }
        unlistenRefs.current.push(unlisten);
      }

      // Collapsible Block (Details)
      const unlistenCollapsible = await listen("menu:collapsible-block", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(insertDetailsBlockCommand.key));
        }
      });
      if (cancelled) { unlistenCollapsible(); return; }
      unlistenRefs.current.push(unlistenCollapsible);
    };

    setupListeners();

    return () => {
      cancelled = true;
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

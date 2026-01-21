import { useEffect, useRef, type MutableRefObject } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  performSourceToolbarAction,
  setSourceHeadingLevel,
} from "@/plugins/toolbarActions/sourceAdapter";
import { getSourceMultiSelectionContext } from "@/plugins/toolbarActions/multiSelectionContext";
import { useSourceCursorContextStore } from "@/stores/sourceCursorContextStore";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import {
  getSourceBlockRange,
  getSourceExpandedRange,
  getSourceLineRange,
  getSourceSelectionRange,
  getSourceWordRange,
} from "@/utils/sourceSelection";
import { convertToHeading, getHeadingInfo, setHeadingLevel } from "@/plugins/sourceContextDetection/headingDetection";
import { isTerminalFocused } from "@/utils/focus";

const ALERT_ACTIONS = [
  { event: "menu:info-note", action: "insertAlertNote" },
  { event: "menu:info-tip", action: "insertAlertTip" },
  { event: "menu:info-important", action: "insertAlertImportant" },
  { event: "menu:info-warning", action: "insertAlertWarning" },
  { event: "menu:info-caution", action: "insertAlertCaution" },
] as const;

const FORMAT_ACTIONS = [
  { event: "menu:bold", action: "bold" },
  { event: "menu:italic", action: "italic" },
  { event: "menu:strikethrough", action: "strikethrough" },
  { event: "menu:code", action: "code" },
  { event: "menu:link", action: "link" },
  { event: "menu:subscript", action: "subscript" },
  { event: "menu:superscript", action: "superscript" },
  { event: "menu:highlight", action: "highlight" },
  { event: "menu:clear-format", action: "clearFormatting" },
  { event: "menu:image", action: "insertImage" },
] as const;

const LIST_ACTIONS = [
  { event: "menu:ordered-list", action: "orderedList" },
  { event: "menu:unordered-list", action: "bulletList" },
  { event: "menu:task-list", action: "taskList" },
  { event: "menu:indent", action: "indent" },
  { event: "menu:outdent", action: "outdent" },
] as const;

const INSERT_ACTIONS = [
  { event: "menu:code-fences", action: "insertCodeBlock" },
  { event: "menu:quote", action: "insertBlockquote" },
  { event: "menu:horizontal-line", action: "insertDivider" },
  { event: "menu:insert-table", action: "insertTable" },
  { event: "menu:collapsible-block", action: "insertDetails" },
] as const;

const TABLE_ACTIONS = [
  { event: "menu:add-row-before", action: "addRowAbove" },
  { event: "menu:add-row-after", action: "addRow" },
  { event: "menu:add-col-before", action: "addColLeft" },
  { event: "menu:add-col-after", action: "addCol" },
  { event: "menu:align-left", action: "alignLeft" },
  { event: "menu:align-center", action: "alignCenter" },
  { event: "menu:align-right", action: "alignRight" },
  { event: "menu:format-table", action: "formatTable" },
] as const;

function buildSourceContext(view: EditorView) {
  const cursorContext = useSourceCursorContextStore.getState().context;
  const multiSelection = getSourceMultiSelectionContext(view, cursorContext);
  return {
    surface: "source" as const,
    view,
    context: cursorContext,
    multiSelection,
  };
}

function applySourceAction(view: EditorView, action: string): void {
  performSourceToolbarAction(action, buildSourceContext(view));
}

function handleHeadingAdjust(view: EditorView, direction: "increase" | "decrease"): void {
  const info = getHeadingInfo(view);

  if (!info) {
    if (direction === "increase") {
      convertToHeading(view, 6);
    }
    return;
  }

  if (direction === "increase") {
    if (info.level > 1) {
      setHeadingLevel(view, info, info.level - 1);
    }
    return;
  }

  if (info.level < 6) {
    setHeadingLevel(view, info, info.level + 1);
  } else {
    setHeadingLevel(view, info, 0);
  }
}

function deleteSelection(view: EditorView): void {
  const transaction = view.state.changeByRange((range) => {
    if (range.from === range.to) return { range };
    return {
      changes: { from: range.from, to: range.to, insert: "" },
      range: EditorSelection.cursor(range.from),
    };
  });

  if (transaction.changes.empty) return;

  view.dispatch(transaction);
  view.focus();
}

function applySelectionRange(view: EditorView, range: { from: number; to: number } | null): void {
  if (!range) return;
  view.dispatch({ selection: EditorSelection.range(range.from, range.to) });
  view.focus();
}

export function useSourceMenuCommands(viewRef: MutableRefObject<EditorView | null>) {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      const withView = (handler: (view: EditorView) => void) => {
        // Skip editor-scoped shortcuts when terminal has focus
        if (isTerminalFocused()) return;
        const view = viewRef.current;
        if (!view) return;
        runOrQueueCodeMirrorAction(view, () => handler(view));
      };

      const bindAction = async (eventName: string, action: string) => {
        const unlisten = await currentWindow.listen<string>(eventName, (event) => {
          if (event.payload !== windowLabel) return;
          withView((view) => applySourceAction(view, action));
        });
        if (cancelled) {
          unlisten();
          return null;
        }
        return unlisten;
      };

      for (const mapping of FORMAT_ACTIONS) {
        const unlisten = await bindAction(mapping.event, mapping.action);
        if (unlisten) unlistenRefs.current.push(unlisten);
        if (cancelled) return;
      }

      for (const mapping of LIST_ACTIONS) {
        const unlisten = await bindAction(mapping.event, mapping.action);
        if (unlisten) unlistenRefs.current.push(unlisten);
        if (cancelled) return;
      }

      for (const mapping of INSERT_ACTIONS) {
        const unlisten = await bindAction(mapping.event, mapping.action);
        if (unlisten) unlistenRefs.current.push(unlisten);
        if (cancelled) return;
      }

      for (const mapping of TABLE_ACTIONS) {
        const unlisten = await bindAction(mapping.event, mapping.action);
        if (unlisten) unlistenRefs.current.push(unlisten);
        if (cancelled) return;
      }

      for (const mapping of ALERT_ACTIONS) {
        const unlisten = await bindAction(mapping.event, mapping.action);
        if (unlisten) unlistenRefs.current.push(unlisten);
        if (cancelled) return;
      }

      for (let level = 1; level <= 6; level += 1) {
        if (cancelled) return;
        const eventName = `menu:heading-${level}`;
        const unlisten = await currentWindow.listen<string>(eventName, (event) => {
          if (event.payload !== windowLabel) return;
          withView((view) => {
            setSourceHeadingLevel(buildSourceContext(view), level);
          });
        });
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenRefs.current.push(unlisten);
      }

      const unlistenParagraph = await currentWindow.listen<string>("menu:paragraph", (event) => {
        if (event.payload !== windowLabel) return;
        withView((view) => {
          setSourceHeadingLevel(buildSourceContext(view), 0);
        });
      });
      if (cancelled) {
        unlistenParagraph();
        return;
      }
      unlistenRefs.current.push(unlistenParagraph);

      const unlistenIncreaseHeading = await currentWindow.listen<string>("menu:increase-heading", (event) => {
        if (event.payload !== windowLabel) return;
        withView((view) => handleHeadingAdjust(view, "increase"));
      });
      if (cancelled) {
        unlistenIncreaseHeading();
        return;
      }
      unlistenRefs.current.push(unlistenIncreaseHeading);

      const unlistenDecreaseHeading = await currentWindow.listen<string>("menu:decrease-heading", (event) => {
        if (event.payload !== windowLabel) return;
        withView((view) => handleHeadingAdjust(view, "decrease"));
      });
      if (cancelled) {
        unlistenDecreaseHeading();
        return;
      }
      unlistenRefs.current.push(unlistenDecreaseHeading);

      const unlistenDeleteCells = await currentWindow.listen<string>("menu:delete-selected-cells", (event) => {
        if (event.payload !== windowLabel) return;
        withView((view) => deleteSelection(view));
      });
      if (cancelled) {
        unlistenDeleteCells();
        return;
      }
      unlistenRefs.current.push(unlistenDeleteCells);

      const unlistenSelectWord = await currentWindow.listen<string>("menu:select-word", (event) => {
        if (event.payload !== windowLabel) return;
        withView((view) => {
          const pos = view.state.selection.main.from;
          applySelectionRange(view, getSourceWordRange(view.state, pos));
        });
      });
      if (cancelled) {
        unlistenSelectWord();
        return;
      }
      unlistenRefs.current.push(unlistenSelectWord);

      const unlistenSelectLine = await currentWindow.listen<string>("menu:select-line", (event) => {
        if (event.payload !== windowLabel) return;
        withView((view) => {
          const pos = view.state.selection.main.from;
          applySelectionRange(view, getSourceLineRange(view.state, pos));
        });
      });
      if (cancelled) {
        unlistenSelectLine();
        return;
      }
      unlistenRefs.current.push(unlistenSelectLine);

      const unlistenSelectBlock = await currentWindow.listen<string>("menu:select-block", (event) => {
        if (event.payload !== windowLabel) return;
        withView((view) => {
          const selection = getSourceSelectionRange(view.state);
          const range = getSourceBlockRange(view.state, selection.from, selection.to);
          applySelectionRange(view, range);
        });
      });
      if (cancelled) {
        unlistenSelectBlock();
        return;
      }
      unlistenRefs.current.push(unlistenSelectBlock);

      const unlistenExpandSelection = await currentWindow.listen<string>("menu:expand-selection", (event) => {
        if (event.payload !== windowLabel) return;
        withView((view) => {
          const selection = getSourceSelectionRange(view.state);
          const expanded = getSourceExpandedRange(view.state, selection.from, selection.to);
          applySelectionRange(view, expanded);
        });
      });
      if (cancelled) {
        unlistenExpandSelection();
        return;
      }
      unlistenRefs.current.push(unlistenExpandSelection);
    };

    setupListeners();

    return () => {
      cancelled = true;
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  }, [viewRef]);
}

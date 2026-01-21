import type { KeyBinding } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { toggleBlockComment, selectLine } from "@codemirror/commands";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { useSearchStore } from "@/stores/searchStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useSourceCursorContextStore } from "@/stores/sourceCursorContextStore";
import { getSourceMultiSelectionContext } from "@/plugins/toolbarActions/multiSelectionContext";
import { performSourceToolbarAction, setSourceHeadingLevel } from "@/plugins/toolbarActions/sourceAdapter";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";
import { copyAsHtml } from "@/hooks/useExportOperations";
import { formatMarkdown, formatSelection } from "@/lib/cjkFormatter";
import { resolveHardBreakStyle } from "@/utils/linebreaks";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { getHeadingInfo, setHeadingLevel, convertToHeading } from "@/plugins/sourceFormatPopup/headingDetection";
import { getListItemInfo, toBulletList, toOrderedList, toTaskList, removeList } from "@/plugins/sourceFormatPopup/listDetection";
import { getBlockquoteInfo, removeBlockquote } from "@/plugins/sourceFormatPopup/blockquoteDetection";

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

function runSourceAction(action: string) {
  return (view: EditorView) => {
    performSourceToolbarAction(action, buildSourceContext(view));
    return true;
  };
}

function bindIfKey(bindings: KeyBinding[], key: string, run: (view: EditorView) => boolean) {
  if (!key) return;
  bindings.push(
    guardCodeMirrorKeyBinding({
      key,
      run,
      preventDefault: true,
    })
  );
}

// --- Block formatting helpers ---

function setHeading(level: number) {
  return (view: EditorView) => {
    const context = buildSourceContext(view);
    return setSourceHeadingLevel(context, level);
  };
}

function increaseHeadingLevel(view: EditorView): boolean {
  const info = getHeadingInfo(view);
  if (info && info.level < 6) {
    setHeadingLevel(view, info, info.level + 1);
    return true;
  }
  if (!info) {
    convertToHeading(view, 1);
    return true;
  }
  return false;
}

function decreaseHeadingLevel(view: EditorView): boolean {
  const info = getHeadingInfo(view);
  if (info && info.level > 1) {
    setHeadingLevel(view, info, info.level - 1);
    return true;
  }
  if (info && info.level === 1) {
    // Convert to paragraph
    setHeadingLevel(view, info, 0);
    return true;
  }
  return false;
}

function toggleBlockquote(view: EditorView): boolean {
  const info = getBlockquoteInfo(view);
  if (info) {
    // Already in blockquote - remove it
    removeBlockquote(view, info);
  } else {
    // Not in blockquote - add it
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    view.dispatch({
      changes: { from: line.from, to: line.from, insert: "> " },
    });
    view.focus();
  }
  return true;
}

function toggleList(view: EditorView, type: "bullet" | "ordered" | "task"): boolean {
  const info = getListItemInfo(view);
  if (info && info.type === type) {
    // Already in this list type - remove it
    removeList(view, info);
    return true;
  }
  if (info) {
    // In a different list type - convert it
    switch (type) {
      case "bullet":
        toBulletList(view, info);
        break;
      case "ordered":
        toOrderedList(view, info);
        break;
      case "task":
        toTaskList(view, info);
        break;
    }
    return true;
  }
  // Not in a list - insert list marker
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const marker = type === "bullet" ? "- " : type === "ordered" ? "1. " : "- [ ] ";
  view.dispatch({
    changes: { from: line.from, to: line.from, insert: marker },
  });
  view.focus();
  return true;
}

// --- Navigation helpers ---

function openFindBar(): boolean {
  useSearchStore.getState().open();
  return true;
}

function findNextMatch(_view: EditorView): boolean {
  const store = useSearchStore.getState();
  if (!store.isOpen || store.matchCount === 0) return false;
  store.findNext();
  return true;
}

function findPreviousMatch(_view: EditorView): boolean {
  const store = useSearchStore.getState();
  if (!store.isOpen || store.matchCount === 0) return false;
  store.findPrevious();
  return true;
}

// --- CJK formatting helpers ---

function getActiveDocument() {
  const windowLabel = getWindowLabel();
  const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  if (!tabId) return null;
  return { tabId, doc: useDocumentStore.getState().getDocument(tabId) };
}

function shouldPreserveTwoSpaceBreaks(): boolean {
  const active = getActiveDocument();
  const hardBreakStyleOnSave = useSettingsStore.getState().markdown.hardBreakStyleOnSave;
  return resolveHardBreakStyle(active?.doc?.hardBreakStyle ?? "unknown", hardBreakStyleOnSave) === "twoSpaces";
}

function formatCJKSelection(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  if (from === to) {
    // No selection - format entire file
    return formatCJKFile(view);
  }

  const config = useSettingsStore.getState().cjkFormatting;
  const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();
  const selectedText = view.state.doc.sliceString(from, to);
  const formatted = formatSelection(selectedText, config, { preserveTwoSpaceHardBreaks });

  if (formatted !== selectedText) {
    view.dispatch({
      changes: { from, to, insert: formatted },
      selection: { anchor: from, head: from + formatted.length },
    });
    view.focus();
  }
  return true;
}

function formatCJKFile(view: EditorView): boolean {
  const config = useSettingsStore.getState().cjkFormatting;
  const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();
  const content = view.state.doc.toString();
  const formatted = formatMarkdown(content, config, { preserveTwoSpaceHardBreaks });

  if (formatted !== content) {
    const active = getActiveDocument();
    if (active) {
      useDocumentStore.getState().setContent(active.tabId, formatted);
    }
  }
  return true;
}

// --- Copy as HTML helper ---

function copySelectionAsHtml(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const markdown = from === to
    ? view.state.doc.toString()
    : view.state.doc.sliceString(from, to);

  void copyAsHtml(markdown);
  return true;
}

export function buildSourceShortcutKeymap(): KeyBinding[] {
  const shortcuts = useShortcutsStore.getState();
  const bindings: KeyBinding[] = [];

  // --- View shortcuts ---
  bindIfKey(bindings, shortcuts.getShortcut("toggleSidebar"), () => {
    useUIStore.getState().toggleSidebar();
    return true;
  });

  // Capture sourceMode shortcut to prevent CodeMirror's default comment toggle.
  // The actual toggle is handled by useViewShortcuts hook at window level.
  bindIfKey(bindings, shortcuts.getShortcut("sourceMode"), () => {
    // Just mark as handled - window handler does the actual toggle
    return true;
  });

  // --- Inline formatting ---
  bindIfKey(bindings, shortcuts.getShortcut("bold"), runSourceAction("bold"));
  bindIfKey(bindings, shortcuts.getShortcut("italic"), runSourceAction("italic"));
  bindIfKey(bindings, shortcuts.getShortcut("code"), runSourceAction("code"));
  bindIfKey(bindings, shortcuts.getShortcut("strikethrough"), runSourceAction("strikethrough"));
  bindIfKey(bindings, shortcuts.getShortcut("underline"), runSourceAction("underline"));
  bindIfKey(bindings, shortcuts.getShortcut("link"), runSourceAction("link"));
  bindIfKey(bindings, shortcuts.getShortcut("highlight"), runSourceAction("highlight"));
  bindIfKey(bindings, shortcuts.getShortcut("subscript"), runSourceAction("subscript"));
  bindIfKey(bindings, shortcuts.getShortcut("superscript"), runSourceAction("superscript"));
  bindIfKey(bindings, shortcuts.getShortcut("inlineMath"), runSourceAction("insertInlineMath"));
  bindIfKey(bindings, shortcuts.getShortcut("clearFormat"), runSourceAction("clearFormatting"));
  bindIfKey(bindings, shortcuts.getShortcut("toggleComment"), (view) => toggleBlockComment(view));

  // --- Block formatting: Headings ---
  bindIfKey(bindings, shortcuts.getShortcut("heading1"), setHeading(1));
  bindIfKey(bindings, shortcuts.getShortcut("heading2"), setHeading(2));
  bindIfKey(bindings, shortcuts.getShortcut("heading3"), setHeading(3));
  bindIfKey(bindings, shortcuts.getShortcut("heading4"), setHeading(4));
  bindIfKey(bindings, shortcuts.getShortcut("heading5"), setHeading(5));
  bindIfKey(bindings, shortcuts.getShortcut("heading6"), setHeading(6));
  bindIfKey(bindings, shortcuts.getShortcut("paragraph"), setHeading(0));
  bindIfKey(bindings, shortcuts.getShortcut("increaseHeading"), increaseHeadingLevel);
  bindIfKey(bindings, shortcuts.getShortcut("decreaseHeading"), decreaseHeadingLevel);

  // --- Block formatting: Lists ---
  bindIfKey(bindings, shortcuts.getShortcut("bulletList"), (view) => toggleList(view, "bullet"));
  bindIfKey(bindings, shortcuts.getShortcut("orderedList"), (view) => toggleList(view, "ordered"));
  bindIfKey(bindings, shortcuts.getShortcut("taskList"), (view) => toggleList(view, "task"));
  bindIfKey(bindings, shortcuts.getShortcut("indent"), runSourceAction("indent"));
  bindIfKey(bindings, shortcuts.getShortcut("outdent"), runSourceAction("outdent"));

  // --- Block formatting: Other blocks ---
  bindIfKey(bindings, shortcuts.getShortcut("blockquote"), toggleBlockquote);
  bindIfKey(bindings, shortcuts.getShortcut("codeBlock"), runSourceAction("insertCodeBlock"));
  bindIfKey(bindings, shortcuts.getShortcut("insertTable"), runSourceAction("insertTable"));
  bindIfKey(bindings, shortcuts.getShortcut("horizontalLine"), runSourceAction("insertDivider"));
  bindIfKey(bindings, shortcuts.getShortcut("insertImage"), runSourceAction("insertImage"));

  // --- Block formatting: Alerts and details ---
  bindIfKey(bindings, shortcuts.getShortcut("insertNote"), runSourceAction("insertAlertNote"));
  bindIfKey(bindings, shortcuts.getShortcut("insertTip"), runSourceAction("insertAlertTip"));
  bindIfKey(bindings, shortcuts.getShortcut("insertWarning"), runSourceAction("insertAlertWarning"));
  bindIfKey(bindings, shortcuts.getShortcut("insertImportant"), runSourceAction("insertAlertImportant"));
  bindIfKey(bindings, shortcuts.getShortcut("insertCaution"), runSourceAction("insertAlertCaution"));
  bindIfKey(bindings, shortcuts.getShortcut("insertCollapsible"), runSourceAction("insertDetails"));

  // --- Navigation ---
  bindIfKey(bindings, shortcuts.getShortcut("selectLine"), (view) => selectLine(view));
  bindIfKey(bindings, shortcuts.getShortcut("findReplace"), () => openFindBar());
  bindIfKey(bindings, shortcuts.getShortcut("findNext"), findNextMatch);
  bindIfKey(bindings, shortcuts.getShortcut("findPrevious"), findPreviousMatch);

  // --- Editing ---
  bindIfKey(bindings, shortcuts.getShortcut("formatCJKSelection"), formatCJKSelection);
  bindIfKey(bindings, shortcuts.getShortcut("formatCJKFile"), formatCJKFile);
  bindIfKey(bindings, shortcuts.getShortcut("copyAsHTML"), copySelectionAsHtml);

  return bindings;
}

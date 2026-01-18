import type { KeyBinding } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { toggleBlockComment } from "@codemirror/commands";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { useSourceCursorContextStore } from "@/stores/sourceCursorContextStore";
import { getSourceMultiSelectionContext } from "@/plugins/toolbarActions/multiSelectionContext";
import { performSourceToolbarAction } from "@/plugins/toolbarActions/sourceAdapter";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";

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

export function buildSourceShortcutKeymap(): KeyBinding[] {
  const shortcuts = useShortcutsStore.getState();
  const bindings: KeyBinding[] = [];

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
  bindIfKey(bindings, shortcuts.getShortcut("toggleComment"), (view) => toggleBlockComment(view));

  return bindings;
}
